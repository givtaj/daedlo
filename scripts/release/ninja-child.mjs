import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { dirname, join } from "node:path";
import { ninjaDirectory, ninjaWrite } from "./ninja-manager.mjs";
import { verifyBrowserIdentity } from "./ninja-installation.mjs";
import { createNinjaEvidence } from "./ninja-evidence.mjs";
import { createRecoveryArchive } from "./ninja-recovery.mjs";

import {
  safeFrontend,
  safeObservation,
  startupError,
} from "./native-session.mjs";

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
  closing,
  handleClosed = false,
  managedCalls = 0,
  recoveryReview = null,
  recoveryArchive;
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
  let s,
    dirty = null,
    failure;
  try {
    s = await session?.snapshot();
  } catch (error) {
    failure = error?.code ?? "observation_failed";
  }
  if (!failure && s?.connected !== true)
    failure = s?.error_code ?? "observation_failed";
  if (
    !failure &&
    (typeof s?.busy !== "boolean" || typeof s?.paused !== "boolean")
  )
    failure = "invalid_observation";
  try {
    dirty = handle?.draftState ? await handle.draftState() : null;
  } catch {
    failure ??= "draft_observation_failed";
  }
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
  if (!matchingTarget) failure = "target_mismatch";
  if (typeof dirty !== "boolean") failure ??= "draft_unknown";
  const observation = safeObservation({
    status: failure ? "failed" : "available",
    ...(failure ? { error: { code: failure } } : {}),
  });
  // A runtime observation failure is recoverable by a fresh read. Startup
  // history describes startup only; it must not latch a later page fault.
  const observedReady = ready && observation.status === "available";
  return {
    ready: observedReady,
    accepted,
    observation,
    startup,
    frontend,
    quiesced,
    busy: typeof s?.busy === "boolean" ? s.busy : null,
    paused: typeof s?.paused === "boolean" ? s.paused : null,
    dirty: observation.status === "available" ? dirty : null,
    cleanupPending:
      resources?.snapshot().some((r) => r.status === "cleanup_failed") ||
      (evidence?.status().failed ?? 0) > 0 ||
      (evidence?.status().pending ?? 0) > 0 ||
      (recoveryArchive?.status().pending ?? 0) > 0,
    viewerUrl: handle?.viewerUrl || null,
    evidence: evidence?.status() ?? null,
  };
}
async function close({ deferMarker = false } = {}) {
  if (closing) return closing;
  closing = (async () => {
    ready = false;
    quiesced = true;
    const failed = startup.phase === "failed";
    progress("cleanup");
    try {
      await resources?.close();
      if (!handleClosed) {
        await handle?.close?.();
        handleClosed = true;
      }
    } catch {
      progress("failed", {
        cleanup: "incomplete",
        error: startup.error ?? startupError({ code: "cleanup_incomplete" }),
      });
      error(
        "cleanup_incomplete",
        "Owned cleanup is incomplete; retained handles require repair.",
      );
    }
    progress(failed ? "failed" : "stopped", { cleanup: "complete" });
    if (marker && !deferMarker)
      await ninjaWrite(marker, {
        pid: process.pid,
        token,
        status: "closed",
        installationId: installation?.id,
        ...(recoveryReview?.completed
          ? { recoveryId: recoveryReview.public.id }
          : {}),
      });
  })().finally(() => {
    closing = null;
  });
  return closing;
}
async function releasePause() {
  const ownedGate = quiesced;
  quiesced = false;
  try {
    await session.resume();
  } catch (error) {
    // Failed fresh observation must not turn our retained pause into an
    // unrelated user pause that no subsequent guarded stop can drain.
    quiesced = ownedGate;
    throw error;
  }
}

// This boundary deliberately uses the existing independent draftState contract.
// A disconnected model alone cannot supply application safety; absent or stale
// draft/pending-effect measurement still refuses recovery.
async function recoverySnapshot() {
  try {
    return await session.snapshot();
  } catch {
    error(
      "observation_failed",
      "Current local run lifecycle cannot be established; retain the owner.",
    );
  }
}
async function recoverySafety() {
  const current = await recoverySnapshot();
  if (
    current.busy !== false ||
    current.activeRun != null ||
    current.finalization != null ||
    managedCalls !== 0
  )
    error("busy", "Active work or finalization blocks abandonment.");
  if (current.paused !== true)
    error("busy", "The retained recovery pause is no longer established.");
  if (targetPage && !targetPage.isClosed()) {
    let matches = false;
    try {
      matches =
        !frontend?.targetOrigin ||
        new URL(targetPage.url()).origin === frontend.targetOrigin;
    } catch {}
    if (!matches)
      error(
        "target_mismatch",
        "The controlled page no longer matches this frontend.",
      );
  }
  await evidence.drain();
  evidence.assertCanRun();
  const after = await recoverySnapshot();
  if (
    after.busy !== false ||
    after.activeRun != null ||
    after.finalization != null ||
    managedCalls !== 0 ||
    after.paused !== true
  )
    error("busy", "Work changed while checking the recovery boundary.");
  let dirty;
  try {
    dirty = await handle.draftState();
  } catch {
    error(
      "draft_unknown",
      "Fresh independent draft and pending-effect safety is unavailable.",
    );
  }
  if (dirty !== false)
    error(
      dirty === true ? "dirty_draft" : "draft_unknown",
      "Fresh independent draft and pending-effect safety blocks abandonment.",
    );
  if (managedCalls !== 0)
    error("busy", "Work changed during independent safety measurement.");
  let report;
  try {
    report = session.report();
  } catch {}
  if (report?.format !== "browser-driver-report/1")
    error("evidence_incomplete", "The retained session report is unavailable.");
  return { snapshot: after, report };
}
function recoveryIdentity(snapshot, report) {
  return {
    runId: snapshot.runId ?? report.runId ?? null,
    lastResult: report.lastResult ?? null,
    completedRunIds: report.completedRunIds ?? null,
  };
}
async function recoveryRecord(suffix, value) {
  try {
    await recoveryArchive.write(
      `${recoveryReview.public.id}.${suffix}.json`,
      value,
    );
  } catch {
    error(
      "evidence_incomplete",
      "Recovery evidence could not be saved; retain this owner and retry the same review.",
    );
  }
}
async function reviewAbandonment() {
  if (!ready || !accepted || !session)
    error("not_ready", "Recovery review requires this accepted owned session.");
  if (recoveryReview?.closingStarted)
    error(
      "cleanup_incomplete",
      "Retry the retained recovery review to finish cleanup.",
    );
  // Gate new proxy actions before any asynchronous measurement. Do not claim a
  // user's pause: first inspect local lifecycle state while only our gate is set.
  const previousGate = quiesced;
  quiesced = true;
  try {
    await recoveryArchive.retry();
  } catch {
    quiesced = previousGate;
    error(
      "evidence_incomplete",
      "Retained recovery evidence requires repair before a new review.",
    );
  }
  let current;
  try {
    current = await recoverySnapshot();
    if (
      current.busy !== false ||
      current.activeRun != null ||
      current.finalization != null ||
      managedCalls !== 0 ||
      (current.paused !== false && !previousGate)
    )
      error(
        "busy",
        "Active work, finalization or a user pause blocks abandonment.",
      );
  } catch (failure) {
    quiesced = previousGate;
    throw failure;
  }
  session.pause();
  const measured = await recoverySafety();
  const id = randomUUID();
  const review = {
    schemaVersion: 1,
    kind: "daedlo-abandonment-review",
    id,
    recordedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    installation: {
      id: installation.id,
      version: installation.version,
      sourceSha256: installation.sourceSha256,
      model: installation.model,
    },
    observation: safeObservation({
      status: measured.snapshot.connected === true ? "available" : "failed",
      error: { code: measured.snapshot.error_code },
    }),
    safety: {
      independentDraftAndPendingEffects: "safe",
      idle: true,
      evidence: "complete",
    },
    originalReport: structuredClone(measured.report),
    resources: resources.snapshot(),
  };
  recoveryReview = {
    public: review,
    token,
    identity: recoveryIdentity(measured.snapshot, measured.report),
    closingStarted: false,
  };
  await ninjaDirectory(join(dirname(marker), "recovery"), { create: true });
  await recoveryRecord("review", review);
  return structuredClone(review);
}
async function abandon(reviewId) {
  const retained = recoveryReview;
  if (!retained || reviewId !== retained.public.id || retained.token !== token)
    error(
      "stale_recovery_review",
      "Select the exact recovery review for this owned session.",
    );
  if (!retained.closingStarted) {
    if (Date.parse(retained.public.expiresAt) < Date.now())
      error(
        "stale_recovery_review",
        "The recovery review expired; obtain a fresh review.",
      );
    const measured = await recoverySafety();
    if (
      !isDeepStrictEqual(
        recoveryIdentity(measured.snapshot, measured.report),
        retained.identity,
      )
    )
      error(
        "stale_recovery_review",
        "Run evidence changed since review; obtain a fresh review.",
      );
    retained.beforeClose ??= {
      schemaVersion: 1,
      kind: "daedlo-abandonment",
      reviewId,
      recordedAt: new Date().toISOString(),
      disposition: "abandoned",
      cleanup: "pending",
      originalReport: retained.public.originalReport,
      resources: resources.snapshot(),
    };
    await recoveryRecord("before-close", retained.beforeClose);
    // Storage took time. Recheck application safety after it and before draining.
    const final = await recoverySafety();
    if (
      !isDeepStrictEqual(
        recoveryIdentity(final.snapshot, final.report),
        retained.identity,
      )
    )
      error(
        "stale_recovery_review",
        "Run evidence changed before cleanup; obtain a fresh review.",
      );
    retained.closingStarted = true;
  }
  // After draining starts some observations are necessarily destroyed. Retain
  // this proof and retry only registered incomplete cleanup/receipt steps.
  await close({ deferMarker: true });
  retained.completed ??= {
    schemaVersion: 1,
    kind: "daedlo-abandonment",
    reviewId,
    recordedAt: new Date().toISOString(),
    disposition: "abandoned",
    cleanup: "complete",
    originalReport: retained.public.originalReport,
    resources: resources.snapshot(),
  };
  await recoveryRecord("complete", retained.completed);
  await ninjaWrite(marker, {
    pid: process.pid,
    token,
    status: "closed",
    installationId: installation.id,
    recoveryId: reviewId,
  });
  return {
    closed: true,
    abandoned: true,
    reviewId,
    report: retained.public.originalReport,
    recovery: retained.completed,
  };
}

async function perform(m) {
  if (m.action === "start") {
    if (installation)
      error("already_started", "Managed launcher already started.");
    ({ installation, marker, token, frontend } = m);
    recoveryArchive = createRecoveryArchive(join(dirname(marker), "recovery"));
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
                managedCalls++;
                let action;
                try {
                  action = value.apply(target, args);
                } catch (failure) {
                  managedCalls--;
                  throw failure;
                }
                return Promise.resolve(action)
                  .then(async (result) => {
                    await evidence.retain(result, () =>
                      target.report({ runId: result.runId }),
                    );
                    return result;
                  })
                  .finally(() => {
                    managedCalls--;
                  });
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
  if (m.action === "reviewAbandonment") return reviewAbandonment();
  if (m.action === "abandon") return abandon(m.reviewId);
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
    if (s.observation.status !== "available")
      error(
        "observation_failed",
        "Current application and draft observations are unavailable; session remains owned.",
      );
    if (
      s.busy !== false ||
      (s.paused !== false && !quiesced) ||
      s.dirty !== false ||
      s.cleanupPending
    )
      error(
        s.dirty !== false ? "dirty_draft" : "busy",
        "Run or draft state is not safe for restart.",
      );
    // Synchronous gate and pause prevent any new effect between status and close.
    quiesced = true;
    session.pause();
    const after = await session.snapshot();
    if (
      after.connected !== true ||
      typeof after.busy !== "boolean" ||
      after.paused !== true
    )
      error(
        "observation_failed",
        "Observation failed at the paused boundary; the owned gate and resources are retained.",
      );
    if (after.busy !== false) {
      await releasePause();
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
    await releasePause();
    return { quiesced: false };
  }
  if (m.action === "close") {
    if (m.requireSafe && ready) {
      const s = await status();
      if (s.observation.status !== "available")
        error(
          "observation_failed",
          "Current application and draft observations are unavailable; session remains owned.",
        );
      if (s.evidence?.failed || s.evidence?.pending)
        error(
          "evidence_incomplete",
          "Completed-run evidence is not saved; repair the local archive and retry evidence before cleanup.",
        );
      if (s.busy !== false || s.dirty !== false) {
        await releasePause();
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
        if (["close", "abandon"].includes(m.action)) process.disconnect?.();
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
