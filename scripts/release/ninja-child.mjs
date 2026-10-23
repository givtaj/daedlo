import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { ninjaWrite } from "./ninja-manager.mjs";
import { verifyBrowserIdentity } from "./ninja-installation.mjs";
import { createNinjaEvidence } from "./ninja-evidence.mjs";

import { safeFrontend, startupError } from "./native-session.mjs";

let frontend,
  registeredBrowserObject,
  targetPage,
  driverPage,
  driverContext,
  cancelling = false;
const startupAbort = new AbortController();
function checkStartup() {
  if (cancelling) error("startup_cancelled", "Startup was cancelled.");
}
const ownership = new WeakMap();
let startup = {
  phase: "bootstrap",
  cleanup: "pending",
  history: ["bootstrap"],
};
function send(message, callback) {
  if (process.connected) process.send(message, callback ?? (() => {}));
  else callback?.();
}
function progress(phase, extra = {}) {
  startup = {
    ...startup,
    phase,
    ...extra,
    history: [...new Set([...startup.history, phase])],
  };
  send({ event: "startup", startup, frontend });
}
let installation,
  resources,
  handle,
  session,
  evidence,
  ready = false,
  accepted = false,
  creatingSession = false,
  registeredBrowser = false,
  quiesced = false,
  marker,
  token,
  closing;
function error(code, message) {
  const e = Error(message);
  e.code = code;
  throw e;
}
const effectMethods = new Set([
  "execute",
  "command",
  "runRecipe",
  "startPresentation",
  "advancePresentation",
  "resume",
]);
const runMethods = new Set([
  "execute",
  "command",
  "runRecipe",
  "startPresentation",
]);
async function status() {
  const s = await session?.snapshot();
  const dirty = handle?.draftState ? await handle.draftState() : null;
  let matchingTarget = true;
  if (targetPage) {
    try {
      matchingTarget =
        !targetPage.isClosed() &&
        (!frontend?.targetOrigin ||
          new URL(targetPage.url()).origin === frontend.targetOrigin);
    } catch {
      matchingTarget = false;
    }
  }
  const observedReady = ready && s?.connected === true && matchingTarget;
  if (accepted && ready && !observedReady)
    progress("failed", {
      error: startupError({
        code: matchingTarget ? "boot_failed" : "target_mismatch",
      }),
    });
  return {
    ready: observedReady,
    accepted,
    startup,
    frontend,
    quiesced,
    busy: s?.busy !== false,
    paused: s?.paused !== false,
    dirty: typeof dirty === "boolean" ? dirty : null,
    cleanupPending:
      resources?.snapshot().some((r) => r.status === "cleanup_failed") ||
      (evidence?.status().failed ?? 0) > 0 ||
      (evidence?.status().pending ?? 0) > 0,
    viewerUrl: handle?.viewerUrl || null,
    evidence: evidence?.status() ?? null,
  };
}
async function close() {
  if (closing) return closing;
  closing = (async () => {
    ready = false;
    quiesced = true;
    const failed = startup.phase === "failed";
    progress("cleanup");
    try {
      await resources?.close();
      await handle?.close?.();
    } catch (e) {
      progress("failed", {
        cleanup: "incomplete",
        error: startup.error ?? startupError({ code: "cleanup_incomplete" }),
      });
      throw e;
    }
    progress(failed ? "failed" : "stopped", { cleanup: "complete" });
    if (marker)
      await ninjaWrite(marker, {
        pid: process.pid,
        token,
        status: "closed",
        installationId: installation?.id,
      });
  })().finally(() => {
    closing = null;
  });
  return closing;
}
async function perform(m) {
  if (m.action === "start") {
    if (installation)
      error("already_started", "Managed launcher already started.");
    ({ installation, marker, token, frontend } = m);
    if (frontend)
      frontend = safeFrontend({ ...frontend, model: installation.model });
    progress("bootstrap");
    const original = await import(pathToFileURL(installation.runtimePath));
    resources = original.createResourceScope();
    for (const key of ["own", "attach"]) {
      const register = resources[key];
      resources[key] = (resource, options) => {
        const value = register(resource, options);
        if (resource && ["object", "function"].includes(typeof resource)) {
          ownership.set(resource, key === "own" ? "owned" : "attached");
          if (
            frontend &&
            registeredBrowserObject &&
            typeof resource.browser === "function" &&
            typeof resource.newPage === "function" &&
            resource.browser() === registeredBrowserObject
          ) {
            frontend = {
              ...frontend,
              ownership: {
                ...frontend.ownership,
                context: ownership.get(resource),
              },
            };
            progress(startup.phase);
          }
        }
        return value;
      };
    }
    evidence = createNinjaEvidence({
      root: join(dirname(marker), "run-reports"),
      installation,
    });
    const runtime = {
      ...original,
      async registerBrowser({ browser, executablePath }) {
        checkStartup();
        if (registeredBrowser)
          error(
            "browser_changed",
            "Only one selected browser may be registered.",
          );
        const expected = await verifyBrowserIdentity(installation.browser);
        if (
          executablePath !== expected.executablePath ||
          (await browser.version()) !== expected.version
        )
          error(
            "browser_changed",
            "Browser does not match the accepted executable and version.",
          );
        registeredBrowser = true;
        registeredBrowserObject = browser;
        if (frontend) {
          frontend = {
            ...frontend,
            ownership: {
              ...frontend.ownership,
              browser: ownership.get(browser) ?? "unknown",
            },
          };
          progress(startup.phase);
        }
      },
      createDriverSession: async (args) => {
        checkStartup();
        if (!registeredBrowser)
          error(
            "browser_changed",
            "Register the accepted browser before creating a session.",
          );
        if (session || creatingSession)
          error(
            "invalid_launcher",
            "Exactly one session must use the selected runtime.",
          );
        driverPage = args.page;
        driverContext = args.context ?? args.page?.context?.();
        targetPage = driverPage;
        creatingSession = true;
        progress("model_validation");
        const sessionResources = original.createResourceScope();
        const raw = await original.createDriverSession({
          ...args,
          enginePath: installation.enginePath,
          resources: {
            snapshot: () => resources.snapshot(),
            close: () => sessionResources.close(),
          },
        });
        resources.own(raw, {
          label: "Managed driver session",
          close: async () => {
            await raw.close();
            await evidence.drain();
          },
        });
        session = new Proxy(raw, {
          get(target, key) {
            const value = target[key];
            if (typeof value !== "function") return value;
            return (...args) => {
              const invoke = () => {
                if (!runMethods.has(key)) return value.apply(target, args);
                evidence.assertCanRun();
                return Promise.resolve(value.apply(target, args)).then(
                  async (result) => {
                    await evidence.retain(result, () =>
                      target.report({ runId: result.runId }),
                    );
                    return result;
                  },
                );
              };
              if (!effectMethods.has(key)) return invoke();
              const assertTarget = () => {
                if (!ready || !accepted || quiesced)
                  error(
                    "startup_effect",
                    "Application commands are blocked during startup or before readiness.",
                  );
                if (
                  driverPage &&
                  (driverPage.isClosed?.() ||
                    (frontend?.targetOrigin &&
                      new URL(driverPage.url()).origin !==
                        frontend.targetOrigin))
                )
                  error(
                    "target_mismatch",
                    "The controlled page no longer matches this frontend.",
                  );
              };
              assertTarget();
              return Promise.resolve(target.snapshot()).then((current) => {
                assertTarget();
                if (
                  current.connected !== true ||
                  current.descriptor?.id !== installation.model.id ||
                  current.descriptor?.version !== installation.model.version
                )
                  error(
                    "boot_failed",
                    "The selected session no longer confirms its model and connection.",
                  );
                return invoke();
              });
            };
          },
        });
        progress("target_attachment");
        return session;
      },
      createEngineClient() {
        error(
          "runtime_bypass",
          "Managed integrations must use the selected driver session.",
        );
      },
      createViewer: async (args) => {
        checkStartup();
        if (args.session !== session)
          error(
            "runtime_bypass",
            "Viewer must use the selected managed session.",
          );
        progress("target_attachment");
        if (args.page !== driverPage || args.context !== driverContext)
          error(
            "target_mismatch",
            "Viewer must use the exact driver page and context.",
          );
        if (frontend) {
          let origin;
          try {
            origin = new URL(args.page.url()).origin;
          } catch {}
          if (
            (frontend.targetOrigin && origin !== frontend.targetOrigin) ||
            args.page.context() !== args.context ||
            args.context.browser() !== registeredBrowserObject
          )
            error(
              "target_mismatch",
              "Controlled target does not match the configured frontend.",
            );
          frontend = safeFrontend({
            ...frontend,
            ownership: {
              browser: ownership.get(registeredBrowserObject) ?? "unknown",
              context: ownership.get(args.context) ?? "unknown",
              application: "unknown",
            },
          });
          progress("target_attachment");
        }
        targetPage = args.page;
        const viewer = await original.createViewer({
          ...args,
          ...(frontend ? { frontend } : {}),
        });
        resources.own(viewer, {
          label: "Managed viewer",
          close: () => viewer.close(),
        });
        return viewer;
      },
    };
    try {
      const launcher = await import(pathToFileURL(installation.launcherPath));
      if (typeof launcher.createManagedLaunch !== "function")
        error(
          "invalid_launcher",
          "Registered entrypoint must export createManagedLaunch.",
        );
      handle = await launcher.createManagedLaunch({
        runtime: Object.freeze(runtime),
        resources,
        enginePath: installation.enginePath,
        sourceRoot: installation.sourcePath,
        installation,
        settings: m.settings,
        signal: startupAbort.signal,
      });
      checkStartup();
      if (
        !session ||
        handle?.session !== session ||
        typeof handle.draftState !== "function"
      )
        error(
          "runtime_bypass",
          "Launcher must return the selected session and draftState hook.",
        );
      await session.observe();
      const s = await session.snapshot();
      if (
        s.connected !== true ||
        s.busy ||
        s.descriptor?.id !== installation.model.id ||
        s.descriptor?.version !== installation.model.version ||
        s.identity?.runtime !==
          `${installation.runtimePackage ?? "@browser-driver/runtime"}@${installation.version}`
      )
        error(
          "boot_failed",
          "Selected runtime/model failed its readiness identity checks.",
        );
      checkStartup();
      ready = true;
      await ninjaWrite(marker, {
        pid: process.pid,
        token,
        status: "running",
        installationId: installation.id,
      });
      return status();
    } catch (e) {
      if (cancelling) {
        e.code = "startup_cancelled";
        e.message = "Startup was cancelled.";
      }
      progress("failed", { error: startupError(e) });
      try {
        await close();
      } catch {
        e.code = "cleanup_incomplete";
      }
      throw e;
    }
  }
  if (m.action === "status") return status();
  if (m.action === "retryEvidence") return evidence?.retry() ?? null;
  if (m.action === "accept") {
    if (!ready) error("not_ready", "Managed session is not ready.");
    accepted = true;
    progress("ready");
    return { accepted: true };
  }
  if (m.action === "quiesce") {
    const s = await status();
    if (s.busy || s.paused || s.dirty !== false || s.cleanupPending)
      error(
        s.dirty !== false ? "dirty_draft" : "busy",
        "Run or draft state is not safe for restart.",
      );
    // Synchronous gate and pause prevent any new effect between status and close.
    quiesced = true;
    session.pause();
    const after = await session.snapshot();
    if (after.busy) {
      quiesced = false;
      await session.resume();
      error("busy", "A run started before the restart boundary.");
    }
    return { quiesced: true };
  }
  if (m.action === "report") {
    if (!quiesced)
      error("not_quiesced", "Persist reports only at the drained boundary.");
    return session.report();
  }
  if (m.action === "unquiesce") {
    if (!ready) error("not_ready", "Closed or unready session cannot resume.");
    quiesced = false;
    await session.resume();
    return { quiesced: false };
  }
  if (m.action === "close") {
    if (m.requireSafe && ready) {
      const s = await status();
      if (s.evidence?.failed || s.evidence?.pending)
        error(
          "evidence_incomplete",
          "Completed-run evidence is not saved; repair the local archive and retry evidence before cleanup.",
        );
      if (s.busy || s.dirty !== false) {
        quiesced = false;
        await session.resume();
        error(
          s.dirty !== false ? "dirty_draft" : "busy",
          "Run or draft changed before cleanup; session remains open.",
        );
      }
    }
    await close();
    return { closed: true, report: session?.report() ?? null };
  }
  error("unknown_action", "Unknown supervisor operation.");
}
let queue = Promise.resolve();
process.on("message", (m) => {
  if (m.action === "cancelStartup") {
    if (accepted) {
      send({
        id: m.id,
        error: {
          code: "already_started",
          message: "Startup already completed; use the safe stop boundary.",
        },
      });
      return;
    }
    cancelling = true;
    startupAbort.abort();
    progress("cleanup");
    send({ id: m.id, result: { requested: true } });
    return;
  }
  queue = queue.then(async () => {
    try {
      const result = await perform(m);
      send({ id: m.id, result }, () => {
        if (m.action === "close") process.disconnect?.();
      });
    } catch (e) {
      send({
        id: m.id,
        error: { code: e.code || "launcher_failed", message: e.message },
      });
    }
  });
});
process.on("disconnect", () => {
  cancelling = true;
  startupAbort.abort();
  queue = queue.then(close).then(
    () => {
      process.exitCode = 0;
    },
    () => {
      process.exitCode = 1;
    },
  );
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    if (!accepted) {
      cancelling = true;
      startupAbort.abort();
    }
    queue = queue.then(close).then(
      () => {
        process.disconnect?.();
      },
      () => {
        process.exitCode = 1;
      },
    );
  });
