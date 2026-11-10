#!/usr/bin/env node
import fs from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openNinja, readNinjaConfig } from "./ninja.mjs";
import { ninjaDirectory, ninjaRead, ninjaWrite } from "./ninja-manager.mjs";
import { createNinjaServer } from "./ninja-server.mjs";

import { frontendIdentity, startupError } from "./native-session.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (code, message) => {
  throw Object.assign(Error(message), { code });
};
const commands = [
  "doctor",
  "setup",
  "start",
  "status",
  "stop",
  "refresh",
  "restart",
  "retry-evidence",
  "migrate-prepare",
  "migrate-review",
  "migrate-activate",
  "abandon-review",
  "abandon",
];
const operationPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
function commandArguments(command, { operation, reviewSha256, reviewId }) {
  if (
    (["migrate-review", "migrate-activate"].includes(command) &&
      !operationPattern.test(operation ?? "")) ||
    (command === "migrate-activate" &&
      !/^[a-f0-9]{64}$/.test(reviewSha256 ?? "")) ||
    (command === "abandon" && !operationPattern.test(reviewId ?? ""))
  )
    fail(
      "usage",
      "Supply the exact operation and review identity printed by the review command.",
    );
  return {
    ...(["migrate-review", "migrate-activate"].includes(command)
      ? { operation }
      : {}),
    ...(command === "migrate-activate" ? { reviewSha256 } : {}),
    ...(command === "abandon" ? { reviewId } : {}),
  };
}
async function toolsIdentity() {
  const root = dirname(fileURLToPath(import.meta.url));
  const files = (await fs.readdir(root))
    .filter((name) => /\.(mjs|html)$/.test(name))
    .sort();
  const values = await Promise.all(
    files.map(async (name) => [
      name,
      hash(await fs.readFile(join(root, name))),
    ]),
  );
  return hash(JSON.stringify(values));
}
function controlUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.username ||
    url.password ||
    !/^#token=[a-f0-9]{64}$/.test(url.hash)
  )
    fail(
      "invalid_record",
      "Invalid native control receipt; inspect the retained record.",
    );
  return url;
}
async function request(record, action, generation, arguments_ = {}) {
  const url = controlUrl(record.controlUrl);
  const response = await fetch(url.origin + "/native", {
    method: action ? "POST" : "GET",
    redirect: "error",
    headers: {
      Authorization: `Bearer ${url.hash.slice(7)}`,
      ...(action
        ? { Origin: url.origin, "Content-Type": "application/json" }
        : {}),
    },
    ...(action
      ? { body: JSON.stringify({ action, generation, ...arguments_ }) }
      : {}),
    // Commands are never automatically retried, including after a timeout.
    signal: AbortSignal.timeout(action ? 30 * 60 * 1000 : 5000),
  });
  const value = await response.json();
  if (!response.ok || value.ok !== true)
    throw Object.assign(
      Error(
        value.requestError?.message ?? "Native session status is unavailable.",
      ),
      {
        code: value.requestError?.code ?? "session_unavailable",
        ...(value.doNotReplay === true
          ? {
              doNotReplay: true,
              actionCompleted: value.actionCompleted === true ? true : null,
            }
          : {}),
      },
    );
  if (value.native?.instance !== record.instance)
    fail(
      "stale_session",
      "The control endpoint no longer belongs to this runner.",
    );
  return value;
}
function handoff(value, record, reused) {
  const observation = value.native.observation ?? value.status.observation;
  const observationFailure = ["failed", "unreachable"].includes(
    observation?.status,
  );
  return {
    schemaVersion: 1,
    ...(value.native.recovery ||
    value.native.startup?.phase === "failed" ||
    observationFailure
      ? { ok: false }
      : {}),
    status: value.native.recovery
      ? "recovery_required"
      : value.native.startup?.phase === "failed"
        ? "failed"
        : value.native.starting
          ? "starting"
          : observation?.status === "failed"
            ? "observation_failed"
            : observation?.status === "unreachable"
              ? "unreachable"
              : value.status.running
                ? "running"
                : "stopped",
    reused,
    project: value.status.project,
    selected: value.status.selected,
    running: value.status.running,
    dirty: value.status.dirty,
    ...(observation ? { observation } : {}),
    viewerUrl: value.native.viewerUrl,
    startupUrl: record.controlUrl.replace("/#", "/session#"),
    startup: value.native.startup,
    frontend: value.native.frontend,
    updateUrl: record.controlUrl,
    evidence: value.native.evidence,
    blockers: value.status.blockers,
    operation: value.status.operation,
    ...(value.migration ? { migration: value.migration } : {}),
    ...(value.abandonment ? { abandonment: value.abandonment } : {}),
    ...(value.action === "abandon-review" && value.abandonment
      ? {
          ok: true,
          status: "review_required",
          action: "abandon-review",
        }
      : {}),
  };
}

/** Native convenience layer; Ninja remains the only installation/update owner. */
export async function nativeCommand(
  command,
  configPath,
  {
    version,
    operation,
    reviewSha256,
    reviewId,
    readConfig = readNinjaConfig,
    open = openNinja,
    doctor = async (path) =>
      (await import("./native-doctor.mjs")).nativeDoctor(path),
    toolsSha256,
    onProgress,
    startupStopTimeoutMs = 30000,
    signal,
  } = {},
) {
  if (signal?.aborted) fail("startup_cancelled", "Startup was cancelled.");
  if (!commands.includes(command)) fail("usage", "Unknown native command.");
  const arguments_ = commandArguments(command, {
    operation,
    reviewSha256,
    reviewId,
  });
  configPath = resolve(configPath);
  if (command === "doctor") return { result: await doctor(configPath) };
  const { config, keys } = await readConfig(configPath, {
    validateSource: false,
  });
  const frontend = frontendIdentity(config);
  toolsSha256 ??= await toolsIdentity();
  const configSha256 = hash(JSON.stringify({ config, keys }));
  const path = join(config.store, "native-session.json");
  await ninjaDirectory(config.store).catch((e) => {
    if (e.code !== "ENOENT") throw e;
  });
  const existing = await ninjaRead(path, { optional: true });
  if (existing) {
    if (
      existing.schemaVersion !== 1 ||
      existing.projectId !== config.registration.projectId ||
      existing.configPath !== configPath ||
      !/^[a-f0-9]{32}$/.test(existing.instance)
    )
      fail(
        "ownership_changed",
        "Native session belongs to different configuration; inspect its retained record.",
      );
    let current;
    try {
      current = await request(existing);
    } catch (cause) {
      if (["operation_busy", "status_unavailable"].includes(cause.code))
        throw cause;
      throw Object.assign(
        Error(
          "The recorded runner cannot be authenticated. Inspect native-session.json and supervisor/child.json; preserve possible live resources. No process was killed or flow replayed.",
          { cause },
        ),
        { code: "recovery_required" },
      );
    }
    if (
      command !== "stop" &&
      (current.native.configSha256 !== configSha256 ||
        current.native.toolsSha256 !== toolsSha256)
    )
      fail(
        "stale_session",
        "Configuration or tools changed. Stop the authenticated runner before starting the new setup.",
      );
    if (["setup", "start", "status"].includes(command))
      return { result: handoff(current, existing, true) };
    const changed = await request(
      existing,
      command,
      current.generation,
      arguments_,
    );
    return { result: handoff(changed, existing, true) };
  }
  if (["status", "stop"].includes(command)) {
    // Read existing ownership records without opening/recovering a manager or
    // adopting a legacy launcher's child. A dead PID is not cleanup evidence.
    const supervisorRoot = join(config.store, "supervisor");
    await ninjaDirectory(supervisorRoot).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
    const child = await ninjaRead(join(supervisorRoot, "child.json"), {
      optional: true,
    });
    const transaction = await ninjaRead(
      join(config.store, "transaction.json"),
      { optional: true },
    );
    if (
      (child && child.status !== "closed") ||
      (transaction && !["committed", "recovered"].includes(transaction.phase))
    )
      fail(
        "recovery_required",
        "An external managed child or unfinished transaction is retained. Use its owning launcher or inspect recovery records; this native command cannot adopt or stop it.",
      );
    return {
      result: {
        schemaVersion: 1,
        status: "stopped",
        reused: false,
        viewerUrl: null,
      },
    };
  }
  if (["retry-evidence", "abandon-review", "abandon"].includes(command))
    fail(
      "not_running",
      "Start the native runner before requesting this action.",
    );
  if (command === "setup") {
    const preflight = await doctor(configPath);
    if (!preflight.ok)
      throw Object.assign(
        Error(
          "Native preflight is blocked. Run doctor and resolve its listed prerequisites.",
        ),
        { code: "preflight_blocked", preflight },
      );
  }
  // Initialization does not recover/switch a selection before exclusive runner ownership.
  const { manager, supervisor } = await open(configPath, { recover: false });
  const live = await supervisor.status();
  if (live.running || live.cleanupPending)
    fail(
      "recovery_required",
      "Another managed child or retained cleanup record exists. Use its owning launcher; do not start a second runner.",
    );
  const instance = randomBytes(16).toString("hex");
  let record = {
    schemaVersion: 1,
    projectId: config.registration.projectId,
    configPath,
    instance,
    configSha256,
    toolsSha256,
    pid: process.pid,
    host: hostname(),
    controlUrl: null,
  };
  const claim = await fs.open(path, "wx", 0o600).catch((cause) => {
    throw Object.assign(
      Error(
        "Another native command owns this store. Reconnect after it becomes ready.",
        { cause },
      ),
      { code: "operation_busy" },
    );
  });
  await claim.writeFile(JSON.stringify(record));
  await claim.sync();
  await claim.close();
  let server,
    closed = false,
    closing,
    recovery = false,
    starting = true,
    startedSuccessfully = false,
    startup = { phase: "bootstrap", cleanup: "pending" },
    cancellationRequested = false;
  let startupSettled;
  const settled = new Promise((done) => {
    startupSettled = done;
  });
  let finish;
  const closedPromise = new Promise((done) => {
    finish = done;
  });
  async function release() {
    const owner = await ninjaRead(path);
    if (owner.instance !== instance)
      fail(
        "ownership_changed",
        "Native session receipt was replaced; retained for inspection.",
      );
    await fs.unlink(path);
    signal?.removeEventListener("abort", cancelForSignal);
    closed = true;
    finish();
  }
  async function close() {
    if (closed) return;
    if (closing) return closing;
    closing = (async () => {
      await closeDriver();
      await server?.close();
      await release();
    })();
    try {
      await closing;
    } finally {
      closing = null;
    }
  }
  async function closeDriver() {
    if ((recovery || startup.phase === "failed") && !startedSuccessfully) {
      const partial = await supervisor.status();
      if (
        partial.ready === false &&
        !partial.running &&
        partial.dirty !== true
      ) {
        // A failed launcher may never have created a session. Its unknown
        // busy/draft fields cannot pass the normal manager quiesce boundary.
        // Only this original owner may retry its already-owned startup cleanup;
        // ready/running or known-dirty sessions keep the normal safe boundary.
        await supervisor.close({ requireSafe: true });
        recovery = false;
        startup.cleanup = "complete";
        return;
      }
    }
    await manager.close();
    recovery = false;
    startup = { ...startup, cleanup: "complete" };
  }
  const available = () => {
    if (starting)
      fail("operation_busy", "Native startup is still in progress.");
  };
  async function ensureServer() {
    if (server) return;
    server = await createNinjaServer({
      manager,
      lifecycle: {
        snapshot: async () => {
          const s = await supervisor.status();
          return {
            instance,
            configSha256,
            toolsSha256,
            starting,
            recovery,
            runningId: s.running?.id ?? null,
            viewerUrl: s.running?.viewerUrl ?? null,
            ...(s.observation ? { observation: s.observation } : {}),
            evidence: s.evidence ?? null,
            frontend: s.frontend ?? frontend,
            startup:
              startup.phase === "failed" ? startup : (s.startup ?? startup),
          };
        },
        stop: async () => {
          if (starting) {
            cancellationRequested = true;
            await supervisor.cancelStartup?.();
            let timer;
            try {
              await Promise.race([
                settled,
                new Promise((_, reject) => {
                  timer = setTimeout(
                    () =>
                      reject(
                        Object.assign(
                          Error(
                            "Startup has not acknowledged cancellation; owned resources are retained.",
                          ),
                          { code: "cleanup_incomplete" },
                        ),
                      ),
                    startupStopTimeoutMs,
                  );
                }),
              ]);
            } finally {
              clearTimeout(timer);
            }
          }
          await closeDriver();
        },
        refresh: () => {
          available();
          return manager.refresh();
        },
        prepareMigration: () => {
          available();
          return manager.prepareMigration();
        },
        reviewMigration: ({ operation }) => {
          available();
          return manager.reviewMigration(operation);
        },
        activateMigration: async ({ operation, reviewSha256 }) => {
          available();
          const result = await manager.activateMigration(operation, {
            reviewSha256,
            acknowledgeRestart: true,
          });
          startedSuccessfully = true;
          recovery = false;
          startup = { phase: "ready", cleanup: "pending" };
          return result;
        },
        reviewAbandonment: () => {
          available();
          return manager.reviewAbandonment();
        },
        abandon: async ({ reviewId }) => {
          available();
          const result = await manager.abandon({ reviewId });
          recovery = false;
          startup = { ...startup, phase: "stopped", cleanup: "complete" };
          return result;
        },
        restart: async () => {
          available();
          const s = await manager.status();
          if (s.operation?.status !== "ready")
            fail("action_unavailable", "No validated candidate is ready.");
          return manager.activate(s.operation.id, { acknowledgeRestart: true });
        },
        retryEvidence: async () => {
          available();
          const result = await supervisor.retryEvidence();
          if (result?.failed || result?.pending)
            fail(
              "evidence_incomplete",
              "Completed-run evidence remains unsaved. Repair storage before retrying.",
            );
          return result;
        },
        afterStop: () => {
          void (async () => {
            await server.close();
            await release();
          })().catch((e) => {
            recovery = true;
            process.stderr.write(`Native cleanup retained: ${e.message}\n`);
          });
        },
      },
    });
    record = { ...record, controlUrl: server.url };
    await ninjaWrite(path, record);
  }
  const cancelForSignal = () => {
    cancellationRequested = true;
    void supervisor.cancelStartup?.().catch(() => {
      recovery = true;
    });
  };
  signal?.addEventListener("abort", cancelForSignal, { once: true });
  if (signal?.aborted) cancelForSignal();
  try {
    let state = await manager.status();
    if (command === "setup") {
      if (
        !state.selected &&
        state.operation?.status === "ready" &&
        version &&
        state.available?.version !== version
      )
        fail(
          "version_unavailable",
          "The prepared installation does not match the requested catalog version. Review Ninja status before resuming setup.",
        );
      if (!state.selected && state.operation?.status !== "ready") {
        if (!version)
          fail(
            "version_required",
            "Initial setup requires --version with the reviewed catalog version.",
          );
        state = await manager.check();
        if (state.available?.version !== version)
          fail(
            "version_unavailable",
            "The authenticated compatible catalog candidate does not match the requested version. Review Ninja status before installing.",
          );
        state = await manager.prepare(state.available.id);
      }
      const result = {
        schemaVersion: 1,
        status: state.selected ? "installed" : "ready",
        selected: state.selected,
        operation: state.operation,
      };
      await close();
      return { result };
    }
    if (command === "refresh") {
      state = await manager.refresh();
      await close();
      return {
        result: {
          schemaVersion: 1,
          status: "ready",
          operation: state.operation,
        },
      };
    }
    if (["migrate-prepare", "migrate-review"].includes(command)) {
      const migration =
        command === "migrate-prepare"
          ? await manager.prepareMigration()
          : await manager.reviewMigration(operation);
      await close();
      return {
        result: {
          schemaVersion: 1,
          status: "review_required",
          ...(command === "migrate-prepare"
            ? { operation: migration.operation }
            : { migration }),
        },
      };
    }
    // A review refusal is not a failed startup. Validate before publishing a
    // foreground owner, then revalidate again inside the guarded activation.
    if (command === "migrate-activate") {
      const migration = await manager.reviewMigration(operation);
      if (migration.reviewSha256 !== reviewSha256)
        fail(
          "migration_review_required",
          "Supply the matching SHA256 from the exact migration review.",
        );
    }
    if (command === "restart" && state.operation?.status !== "ready")
      fail("action_unavailable", "No validated candidate is ready.");
    await ensureServer();
    await onProgress?.(handoff(await request(record), record, false));
    if (cancellationRequested)
      fail("startup_cancelled", "Startup was cancelled before launch.");
    if (command === "migrate-activate") {
      await manager.activateMigration(operation, {
        reviewSha256,
        acknowledgeRestart: true,
      });
    } else if (command === "restart") {
      if (state.operation?.status !== "ready")
        fail("action_unavailable", "No validated candidate is ready.");
      await manager.activate(state.operation.id, { acknowledgeRestart: true });
    } else if (state.selected) await manager.start();
    else if (state.operation?.status === "ready")
      await manager.activate(state.operation.id, { acknowledgeRestart: true });
    else
      fail(
        "setup_required",
        "Run setup with a reviewed version before starting this project.",
      );
    startedSuccessfully = true;
    starting = false;
    startup = { phase: "ready", cleanup: "pending" };
    startupSettled();
    if (cancellationRequested)
      return {
        result: {
          schemaVersion: 1,
          status: "stopping",
          viewerUrl: null,
          startupUrl: record.controlUrl.replace("/#", "/session#"),
          frontend,
        },
        close,
        closed: closedPromise,
      };
    const current = await request(record);
    return {
      result: handoff(current, record, false),
      close,
      closed: closedPromise,
    };
  } catch (error) {
    starting = false;
    const lastStartup = (await supervisor.status()).startup;
    startup = {
      ...lastStartup,
      phase: "failed",
      cleanup: "pending",
      error: startupError(error),
    };
    if (!server) {
      await close().catch(() => {
        error.cleanupFailed = true;
      });
      throw error;
    }
    try {
      await closeDriver();
    } catch {
      recovery = true;
      startup.cleanup = "incomplete";
    }
    startupSettled();
    if (cancellationRequested)
      return {
        result: {
          schemaVersion: 1,
          status: "stopping",
          viewerUrl: null,
          startupUrl: record.controlUrl.replace("/#", "/session#"),
          frontend,
        },
        close,
        closed: closedPromise,
      };
    return {
      result: {
        ...handoff(await request(record), record, false),
        ok: false,
        error: startup.error,
        ...(recovery ? { cleanupFailed: true } : {}),
      },
      close,
      closed: closedPromise,
    };
  }
}

export async function runNativeCli(
  args = process.argv.slice(2),
  { command = nativeCommand } = {},
) {
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(
      "Daedlo native\n  daedlo-native doctor|setup|start|status|stop|refresh|restart|retry-evidence --config FILE\n  daedlo-native setup --config FILE --version VERSION\n  daedlo-native migrate-prepare --config FILE\n  daedlo-native migrate-review --config FILE --operation ID\n  daedlo-native migrate-activate --config FILE --operation ID --review-sha256 SHA256\n  daedlo-native abandon-review --config FILE\n  daedlo-native abandon --config FILE --review ID\n\nReview commands print private evidence; retain it locally. Migration activation and abandonment require the exact reviewed identity.\nStart and migrate-activate own a foreground runner; repeated start reconnects without replay.\nOpen the returned viewerUrl in Codex Browser; updateUrl opens Ninja-Update.\nKeep private control URLs and records local. Setup never upgrades an existing selection.\n",
    );
    return;
  }
  const expectedOptions =
    args[0] === "migrate-activate"
      ? ["--operation", "--review-sha256"]
      : args[0] === "migrate-review"
        ? ["--operation"]
        : args[0] === "abandon"
          ? ["--review"]
          : args[0] === "setup" && args.length === 5
            ? ["--version"]
            : [];
  if (
    args.length !== 3 + expectedOptions.length * 2 ||
    !commands.includes(args[0]) ||
    args[1] !== "--config" ||
    expectedOptions.some((option, index) => args[3 + index * 2] !== option)
  )
    fail("usage", "Use daedlo-native --help for supported commands.");
  const options = {
    ...(args[0] === "setup" ? { version: args[4] } : {}),
    ...(["migrate-review", "migrate-activate"].includes(args[0])
      ? { operation: args[4] }
      : {}),
    ...(args[0] === "migrate-activate" ? { reviewSha256: args[6] } : {}),
    ...(args[0] === "abandon" ? { reviewId: args[4] } : {}),
  };
  commandArguments(args[0], options);
  let handle;
  const abort = new AbortController();
  const close = async () => {
    abort.abort();
    if (handle?.close) {
      try {
        await handle.close();
      } catch (e) {
        process.stderr.write(`Shutdown deferred: ${e.message}\n`);
      }
    }
  };
  const onSignal = () => {
    void close();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    handle = await command(args[0], args[2], {
      ...options,
      signal: abort.signal,
      onProgress: (value) =>
        process.stdout.write(
          JSON.stringify({ event: "startup", ...value }) + "\n",
        ),
    });
    process.stdout.write(JSON.stringify(handle.result, null, 2) + "\n");
    if (handle.result.ok === false) process.exitCode = 1;
    if (handle.close) {
      if (abort.signal.aborted) await close();
      await handle.closed;
    }
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  runNativeCli().catch((e) => {
    process.stderr.write(
      JSON.stringify(
        {
          ok: false,
          code: e.code ?? "native_failed",
          message: e.message,
          ...(e.doNotReplay
            ? { doNotReplay: true, actionCompleted: e.actionCompleted }
            : {}),
          ...(e.preflight ? { preflight: e.preflight } : {}),
          ...(e.cleanupFailed
            ? { cleanupFailed: true, cleanupMessage: e.cleanupMessage }
            : {}),
        },
        null,
        2,
      ) + "\n",
    );
    process.exitCode = 1;
  });
