import { fork } from "node:child_process";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { ninjaDirectory, ninjaRead, ninjaWrite } from "./ninja-manager.mjs";

/** A stable owner outside the selected runtime. The child drains on IPC disconnect. */
export async function createNinjaSupervisor({
  root,
  settings = {},
  timeoutMs = 30000,
}) {
  root = resolve(root);
  const marker = join(root, "child.json");
  let child = null,
    installation = null,
    sequence = 0,
    exited = null;
  const pending = new Map();
  async function orphan() {
    const r = await ninjaRead(marker, { optional: true });
    return !r || r.status === "closed" ? null : r;
  }
  async function request(action, payload = {}) {
    if (!child || child.exitCode !== null || !child.connected)
      throw Error("Managed driver is unavailable.");
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        const e = Error(
          "Managed driver timed out; retained owned child requires cleanup.",
        );
        e.code = "cleanup_incomplete";
        reject(e);
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.send({ id, action, ...payload }, (e) => {
        if (e) {
          clearTimeout(timer);
          pending.delete(id);
          reject(e);
        }
      });
    });
  }
  async function idle() {
    const retained = await orphan();
    return {
      running: null,
      busy: false,
      paused: false,
      dirty: false,
      cleanupPending: !!retained,
    };
  }
  return {
    async status() {
      if (!child || child.exitCode !== null) return idle();
      try {
        const s = await request("status");
        return {
          ...s,
          running: s.ready
            ? {
                id: installation.id,
                version: installation.version,
                sourceSha256: installation.sourceSha256,
                viewerUrl: s.viewerUrl,
              }
            : null,
        };
      } catch {
        return {
          running: null,
          busy: false,
          paused: false,
          dirty: null,
          cleanupPending: true,
        };
      }
    },
    async start(receipt) {
      if (child || (await orphan()))
        throw Error(
          "A managed driver still owns resources; finish cleanup first.",
        );
      await ninjaDirectory(root, { create: true });
      installation = receipt;
      const token = randomUUID();
      const env = Object.fromEntries(
        [
          "PATH",
          "HOME",
          "TMPDIR",
          "TMP",
          "TEMP",
          "SystemRoot",
          "PLAYWRIGHT_BROWSERS_PATH",
        ]
          .filter((k) => process.env[k])
          .map((k) => [k, process.env[k]]),
      );
      child = fork(
        fileURLToPath(new URL("./ninja-child.mjs", import.meta.url)),
        [],
        {
          cwd: root,
          env,
          stdio: ["ignore", "ignore", "ignore", "ipc"],
          serialization: "json",
        },
      );
      exited = new Promise((resolve) =>
        child.once("exit", (code, signal) => {
          for (const p of pending.values()) {
            clearTimeout(p.timer);
            p.reject(
              Error("Managed driver exited before completing its request."),
            );
          }
          pending.clear();
          resolve({ code, signal });
        }),
      );
      child.on("error", () => {});
      child.on("message", (m) => {
        const p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        clearTimeout(p.timer);
        if (m.error) {
          const e = Error(m.error.message);
          e.code = m.error.code;
          p.reject(e);
        } else p.resolve(m.result);
      });
      await ninjaWrite(marker, {
        pid: child.pid,
        token,
        status: "starting",
        installationId: receipt.id,
      });
      await request("start", {
        installation: receipt,
        settings,
        marker,
        token,
      });
    },
    async quiesce() {
      if (child) await request("quiesce");
      else if (await orphan())
        throw Error("Previous managed driver cleanup is pending.");
    },
    async unquiesce() {
      if (child) await request("unquiesce");
    },
    async accept() {
      await request("accept");
    },
    async report() {
      return request("report");
    },
    async close({ requireSafe = false } = {}) {
      if (!child) {
        if (await orphan())
          throw Error(
            "Previous managed driver cleanup is pending; retained child is not owned by this process.",
          );
        return;
      }
      let cleanup;
      if (child.exitCode === null && child.connected)
        cleanup = await request("close", { requireSafe });
      let timer;
      const result = await Promise.race([
        exited,
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                Error("Managed child did not exit; cleanup handle retained."),
              ),
            timeoutMs,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      const record = await ninjaRead(marker, { optional: true });
      if (record?.status !== "closed") {
        const e = Error(
          "Managed child exited without complete cleanup; retained recovery record.",
        );
        e.code = "cleanup_incomplete";
        throw e;
      }
      if (result.signal)
        throw Error(
          "Managed child was terminated; cleanup cannot be established.",
        );
      child = null;
      installation = null;
      exited = null;
      return cleanup;
    },
  };
}
