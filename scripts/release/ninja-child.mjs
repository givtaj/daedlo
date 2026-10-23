import { pathToFileURL } from "node:url";
import { ninjaWrite } from "./ninja-manager.mjs";
import { verifyBrowserIdentity } from "./ninja-installation.mjs";

let installation,
  resources,
  handle,
  session,
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
async function status() {
  const s = await session?.snapshot();
  const dirty = handle?.draftState ? await handle.draftState() : null;
  return {
    ready,
    quiesced,
    busy: s?.busy !== false,
    paused: s?.paused !== false,
    dirty: typeof dirty === "boolean" ? dirty : null,
    cleanupPending:
      resources?.snapshot().some((r) => r.status === "cleanup_failed") || false,
    viewerUrl: handle?.viewerUrl || null,
  };
}
async function close() {
  if (closing) return closing;
  closing = (async () => {
    ready = false;
    quiesced = true;
    await resources?.close();
    await handle?.close?.();
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
    ({ installation, marker, token } = m);
    const original = await import(pathToFileURL(installation.runtimePath));
    resources = original.createResourceScope();
    const runtime = {
      ...original,
      async registerBrowser({ browser, executablePath }) {
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
      },
      createDriverSession: async (args) => {
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
        creatingSession = true;
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
          close: () => raw.close(),
        });
        session = new Proxy(raw, {
          get(target, key) {
            const value = target[key];
            if (typeof value !== "function") return value;
            return (...args) => {
              if (effectMethods.has(key) && (!ready || !accepted || quiesced))
                error(
                  "startup_effect",
                  "Application commands are blocked during startup or before readiness.",
                );
              return value.apply(target, args);
            };
          },
        });
        return session;
      },
      createEngineClient() {
        error(
          "runtime_bypass",
          "Managed integrations must use the selected driver session.",
        );
      },
      createViewer: async (args) => {
        if (args.session !== session)
          error(
            "runtime_bypass",
            "Viewer must use the selected managed session.",
          );
        const viewer = await original.createViewer(args);
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
      });
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
          `@browser-driver/runtime@${installation.version}`
      )
        error(
          "boot_failed",
          "Selected runtime/model failed its readiness identity checks.",
        );
      ready = true;
      await ninjaWrite(marker, {
        pid: process.pid,
        token,
        status: "running",
        installationId: installation.id,
      });
      return status();
    } catch (e) {
      try {
        await close();
      } catch {
        e.code = "cleanup_incomplete";
      }
      throw e;
    }
  }
  if (m.action === "status") return status();
  if (m.action === "accept") {
    if (!ready) error("not_ready", "Managed session is not ready.");
    accepted = true;
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
      session.resume();
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
    session.resume();
    return { quiesced: false };
  }
  if (m.action === "close") {
    if (m.requireSafe && ready) {
      const s = await status();
      if (s.busy || s.dirty !== false) {
        quiesced = false;
        session.resume();
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
  queue = queue.then(async () => {
    try {
      const result = await perform(m);
      process.send?.({ id: m.id, result }, () => {
        if (m.action === "close") process.disconnect?.();
      });
    } catch (e) {
      process.send?.({
        id: m.id,
        error: { code: e.code || "launcher_failed", message: e.message },
      });
    }
  });
});
process.on("disconnect", () => {
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
    queue = queue.then(close).then(
      () => {
        process.disconnect?.();
      },
      () => {
        process.exitCode = 1;
      },
    );
  });
