import { randomUUID } from "node:crypto";
import childProcess from "node:child_process";
import fs from "node:fs/promises";

const instance = randomUUID();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) =>
  object(value) &&
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const decimal = (value, positive = false) =>
  typeof value === "string" &&
  value.length <= 20 &&
  (positive ? /^[1-9][0-9]*$/ : /^(0|[1-9][0-9]*)$/).test(value);
let hostPromise;

function hostIdentity(value) {
  if (
    !object(value) ||
    typeof value.bootId !== "string" ||
    !uuid.test(value.bootId)
  )
    return null;
  const bootId = value.bootId.toLowerCase();
  if (value.platform === "darwin" && exact(value, ["platform", "bootId"]))
    return Object.freeze({ platform: "darwin", bootId });
  if (
    value.platform === "linux" &&
    exact(value, ["platform", "bootId", "pidNamespace"]) &&
    exact(value.pidNamespace, ["dev", "ino"]) &&
    decimal(value.pidNamespace.dev) &&
    decimal(value.pidNamespace.ino, true)
  )
    return Object.freeze({
      platform: "linux",
      bootId,
      pidNamespace: Object.freeze({
        dev: value.pidNamespace.dev,
        ino: value.pidNamespace.ino,
      }),
    });
  return null;
}

async function probeHost() {
  if (process.platform === "darwin") {
    const stdout = await new Promise((resolve, reject) => {
      childProcess.execFile(
        "/usr/sbin/sysctl",
        ["-n", "kern.bootsessionuuid"],
        { encoding: "utf8", timeout: 2000, maxBuffer: 1024 },
        (error, output) => (error ? reject(error) : resolve(output)),
      );
    });
    return { platform: "darwin", bootId: stdout.trim() };
  }
  if (process.platform === "linux") {
    const [bootId, namespace] = await Promise.all([
      fs.readFile("/proc/sys/kernel/random/boot_id", "utf8"),
      fs.stat("/proc/self/ns/pid", { bigint: true }),
    ]);
    return {
      platform: "linux",
      bootId: bootId.trim(),
      pidNamespace: {
        dev: namespace.dev.toString(),
        ino: namespace.ino.toString(),
      },
    };
  }
  return null;
}

async function safeHost(probe) {
  try {
    return hostIdentity(await probe());
  } catch {
    return null;
  }
}
function currentHost(options) {
  // Only production probing is cached. Injected probes let focused tests model
  // unavailable/foreign hosts without changing the process or kernel namespace.
  if (options.probeHost !== undefined) return safeHost(options.probeHost);
  return (hostPromise ??= safeHost(probeHost));
}
const result = (state, reason) => Object.freeze({ state, reason });

/** Capture lazily. Failure to identify this host never prevents ordinary use. */
export async function captureProcessOwner(options = {}) {
  const host = hostIdentity(await currentHost(options));
  return Object.freeze({ schemaVersion: 1, pid: process.pid, instance, host });
}

/** Structural validation only; historical receipts need no live host probe. */
export function isProcessOwnerRecord(owner, { requireHost = false } = {}) {
  try {
    return (
      exact(owner, ["schemaVersion", "pid", "instance", "host"]) &&
      owner.schemaVersion === 1 &&
      Number.isSafeInteger(owner.pid) &&
      owner.pid >= 1 &&
      owner.pid <= 0x7fffffff &&
      typeof owner.instance === "string" &&
      uuid.test(owner.instance) &&
      (owner.host === null ? !requireHost : hostIdentity(owner.host) !== null)
    );
  } catch {
    return false;
  }
}

/** A dead result proves only process absence, never resource cleanup or effects. */
export async function inspectProcessOwner(owner, options = {}) {
  let recorded;
  try {
    if (!isProcessOwnerRecord(owner)) return result("unknown", "invalid_owner");
    if (owner.host === null) return result("unknown", "owner_host_unavailable");
    const host = hostIdentity(owner.host);
    if (!host) return result("unknown", "invalid_owner");
    recorded = { pid: owner.pid, host };
  } catch {
    return result("unknown", "invalid_owner");
  }
  const current = await currentHost(options);
  if (!current) return result("unknown", "host_unavailable");
  if (current.platform !== recorded.host.platform)
    return result("unknown", "platform_mismatch");
  if (current.bootId !== recorded.host.bootId)
    return result("unknown", "boot_mismatch");
  if (
    current.platform === "linux" &&
    (current.pidNamespace.dev !== recorded.host.pidNamespace.dev ||
      current.pidNamespace.ino !== recorded.host.pidNamespace.ino)
  )
    return result("unknown", "namespace_mismatch");
  try {
    const signalProcess =
      options.signalProcess ?? ((pid, signal) => process.kill(pid, signal));
    // Signal zero checks existence only. A live/reused PID stays conservatively
    // live; no token, executable name or elapsed time authorizes termination.
    await signalProcess(recorded.pid, 0);
    return result("live", "process_present");
  } catch (error) {
    if (error?.code === "ESRCH") return result("dead", "process_absent");
    return result(
      "unknown",
      error?.code === "EPERM"
        ? "permission_denied"
        : "process_status_unavailable",
    );
  }
}
