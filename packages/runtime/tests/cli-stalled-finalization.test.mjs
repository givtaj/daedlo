import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createDriverSession, createResourceScope } from "../src/index.mjs";
import { viewerAddress } from "../src/viewer/address.mjs";

// Execute the actual CLI shutdown/signal flow with its real session, protocol
// process and resource scope. Browser and viewer boundaries are controlled here;
// browser acceptance separately proves the real Chromium lifecycle.
const source = (
  await readFile(new URL("../src/cli.mjs", import.meta.url), "utf8")
)
  .replace(/^#!.*\n/, "")
  .replace(/^import .*?;\n/gms, "")
  .replace(/main\(\)\.catch\([\s\S]*$/, "return main();")
  .replace("await import(pathToFileURL(opt.project).href)", "injectedProject")
  .replace("await import(playwrightSpecifier)", "injectedPlaywright");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const launch = new AsyncFunction(
  "resolve",
  "writeFile",
  "injectedPlaywright",
  "pathToFileURL",
  "createDriverSession",
  "createResourceScope",
  "createViewer",
  "viewerAddress",
  "process",
  "console",
  "injectedProject",
  "setInterval",
  "clearInterval",
  source,
);
const enginePath = fileURLToPath(new URL("./fake-engine.mjs", import.meta.url));
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error("CLI did not settle within 2s")),
          2000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

for (const phase of ["effect_evidence", "run_cleanup", "adapter_close"]) {
  test(`CLI preserves dependencies and retries ${phase} after its close budget`, async (t) => {
    const process = new EventEmitter();
    process.env = {};
    process.argv = [
      "node",
      "cli",
      "--project",
      "/fixture/project.mjs",
      "--report",
      "/fixture/report.json",
    ];
    const entered = deferred(),
      release = deferred(),
      ready = deferred();
    const diagnostics = [],
      diagnosticWaiters = [],
      reports = [];
    const intervals = new Set();
    const facts = { text: "retained", saved: false };
    const calls = {
      writes: 0,
      evidence: 0,
      endRun: 0,
      adapter: 0,
      browser: 0,
      attached: 0,
      viewer: 0,
    };
    let pageClosed = false,
      driver,
      running,
      hookSignal,
      scope;
    const page = { goto: async () => {}, isClosed: () => pageClosed };
    const browser = {
      newContext: async () => ({ newPage: async () => page }),
      close: async () => {
        calls.browser++;
        pageClosed = true;
      },
    };
    const waitDiagnostic = () =>
      new Promise((resolve) => diagnosticWaiters.push(resolve));
    const pauseHook = async (context) => {
      hookSignal = context?.signal;
      entered.resolve();
      await release.promise;
      assert.equal(
        pageClosed,
        false,
        "An unsettled hook must retain its browser dependency until it settles",
      );
    };
    const run = launch(
      resolve,
      async (_, text) => reports.push(JSON.parse(text)),
      { chromium: { launch: async () => browser } },
      pathToFileURL,
      createDriverSession,
      () => {
        scope = createResourceScope();
        scope.attach(
          {},
          { label: "attached application", close: () => calls.attached++ },
        );
        return scope;
      },
      async ({ session }) => {
        running = session.execute(
          "save",
          {},
          (await session.snapshot()).revision,
        );
        if (phase === "adapter_close") await running;
        else await entered.promise;
        ready.resolve();
        return { url: "mock:viewer", close: async () => calls.viewer++ };
      },
      viewerAddress,
      process,
      {
        log() {},
        error(message) {
          diagnostics.push(message);
          for (const resolve of diagnosticWaiters.splice(0)) resolve();
        },
      },
      {
        createProject: async () => ({
          url: "about:blank",
          createSession: async ({ page, context }) => {
            driver = await createDriverSession({
              page,
              context,
              enginePath,
              finalizationWaitMs: 10,
              adapter: {
                model: { id: "test", version: "1" },
                observe: async () => ({
                  connected: true,
                  session: "alpha",
                  facts,
                }),
                handlers: {
                  edit: async () => {},
                  save: async (_, x) =>
                    x.effect(() => {
                      calls.writes++;
                      facts.saved = true;
                    }),
                },
                effectStatus: async (context) => {
                  calls.evidence++;
                  if (phase === "effect_evidence") await pauseHook(context);
                  return { status: "saved" };
                },
                endRun: async (context) => {
                  calls.endRun++;
                  if (phase === "run_cleanup") await pauseHook(context);
                },
                close: async () => {
                  calls.adapter++;
                  if (phase === "adapter_close") await pauseHook();
                },
              },
            });
            // Exercise the same production close method with a short, explicit
            // caller wait budget. The default five seconds is not a test timer.
            return { ...driver, close: () => driver.close({ timeoutMs: 25 }) };
          },
        }),
      },
      (callback, delay) => {
        const timer = setInterval(callback, delay);
        intervals.add(timer);
        return timer;
      },
      (timer) => {
        clearInterval(timer);
        intervals.delete(timer);
      },
    );
    run.catch(() => {});
    t.after(async () => {
      release.resolve();
      await running?.catch(() => {});
      process.emit("SIGTERM");
      await bounded(run).catch(() => {});
      for (const timer of intervals) clearInterval(timer);
      await driver?.close().catch(() => {});
      await scope?.close().catch(() => {});
    });

    await bounded(ready.promise);
    await tick();
    const firstDiagnostic = waitDiagnostic();
    process.emit("SIGINT");
    await bounded(firstDiagnostic);
    await tick();
    if (phase !== "adapter_close") assert.equal(hookSignal.aborted, true);
    assert.equal(
      calls.browser,
      0,
      "An unresolved hook must not lose owned browser dependencies after the close deadline",
    );
    assert.equal(calls.adapter, phase === "adapter_close" ? 1 : 0);
    assert.equal(calls.attached, 0);
    assert.equal(
      driver.report().completedRunIds.length,
      phase === "adapter_close" ? 1 : 0,
    );
    if (phase === "adapter_close") {
      assert.equal(
        reports[0].finalization,
        null,
        "Pending adapter close is separate from run finalization",
      );
      assert.equal(reports[0].lastResult.execution, "completed");
    } else {
      assert.equal(reports[0].finalization.phase, phase);
      assert.equal(reports[0].finalization.status, "stalled");
    }
    assert.ok(diagnostics.some((message) => message.includes("retry")));
    assert.equal(process.listenerCount("SIGTERM"), 1);
    assert.equal(intervals.size, 1);

    // An explicit retry while the original hook is still pending must not call
    // it again or acquire permission to tear down its browser.
    const secondDiagnostic = waitDiagnostic();
    process.emit("SIGTERM");
    await bounded(secondDiagnostic);
    await tick();
    assert.equal(calls.evidence, 1);
    assert.equal(calls.endRun, phase === "effect_evidence" ? 0 : 1);
    assert.equal(
      calls.adapter,
      phase === "adapter_close" ? 1 : 0,
      "A retry must await the existing close hook instead of invoking it again",
    );
    assert.equal(calls.browser, 0);
    assert.equal(calls.writes, 1);

    release.resolve();
    const result = await bounded(running);
    process.emit("SIGTERM");
    await bounded(run);
    assert.equal(result.effect.status, "saved");
    assert.equal(
      result.execution,
      phase === "effect_evidence" ? "stopped" : "completed",
    );
    assert.equal(calls.writes, 1);
    assert.equal(calls.evidence, 1);
    assert.equal(calls.endRun, 1);
    assert.equal(calls.adapter, 1);
    assert.equal(calls.browser, 1);
    assert.equal(calls.viewer, 1);
    assert.equal(calls.attached, 0);
    assert.equal(reports.at(-1).finalization, null);
    assert.deepEqual(reports.at(-1).lastResult, result);
    assert.equal(intervals.size, 0);
    assert.equal(process.listenerCount("SIGINT"), 0);
  });
}
