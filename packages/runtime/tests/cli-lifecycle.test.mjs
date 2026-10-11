import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createDriverSession, createResourceScope } from "../src/index.mjs";

// Exercise the actual launcher control flow without starting a browser or server.
// Only its module boundaries are replaced; the first regression uses the real
// session and resource scope, including its protocol process and final reports.
const source = (
  await readFile(new URL("../src/cli.mjs", import.meta.url), "utf8")
)
  .replace(/^#!.*\n/, "")
  .replace(/^import .*?;\n/gms, "")
  .replace(/main\(\)\.catch\([\s\S]*$/, "return main();")
  .replace("await import(pathToFileURL(opt.project).href)", "injectedProject");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const launch = new AsyncFunction(
  "resolve",
  "writeFile",
  "chromium",
  "createDriverSession",
  "createResourceScope",
  "createViewer",
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
const tick = () => new Promise((r) => setImmediate(r));
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
function harness(overrides = {}) {
  const process = new EventEmitter();
  process.argv = [
    "node",
    "cli",
    "--project",
    "/mock/project.mjs",
    "--report",
    "/mock/report.json",
  ];
  const calls = { browser: 0, session: 0, viewer: 0, attached: 0, reports: [] };
  const diagnostics = [];
  const diagnostic = deferred();
  const ready = deferred();
  const intervals = new Set();
  let scope;
  const page = { goto: async () => {}, isClosed: () => false };
  const browser = {
    newContext: async () => ({ newPage: async () => page }),
    close: async () => {
      calls.browser++;
      await overrides.closeBrowser?.();
    },
  };
  const session = {
    stop() {},
    close: async () => {
      calls.session++;
      await overrides.closeSession?.();
    },
    report: () => ({ settled: true }),
  };
  const run = launch(
    resolve,
    async (_, text) => {
      calls.reports.push(JSON.parse(text));
      await overrides.writeReport?.();
    },
    {
      launch: async (options) => {
        await overrides.launchBrowser?.(options, { process, browser });
        return browser;
      },
    },
    overrides.createSession ?? (async () => session),
    () => {
      scope = createResourceScope();
      scope.attach(
        {},
        { label: "existing app", close: () => calls.attached++ },
      );
      return scope;
    },
    async (args) => {
      await overrides.createViewer?.(args);
      ready.resolve(args.session);
      return {
        url: "mock:viewer",
        close: async () => {
          calls.viewer++;
        },
      };
    },
    process,
    {
      log() {},
      error(text) {
        diagnostics.push(text);
        diagnostic.resolve();
      },
    },
    {
      createProject: async ({ resources }) =>
        overrides.project
          ? overrides.project({ resources, page, browser })
          : {
              url: "about:blank",
              enginePath: overrides.enginePath ?? enginePath,
              presentations: overrides.presentations,
              createAdapter:
                overrides.createAdapter ??
                (async () =>
                  overrides.adapter ?? { model: { id: "test", version: "1" } }),
            },
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
  // Observe the rejection immediately; individual tests still assert its value.
  run.catch(() => {});
  return {
    process,
    calls,
    diagnostics,
    diagnostic,
    ready,
    intervals,
    run,
    scope: () => scope,
    async dispose() {
      for (const timer of intervals) clearInterval(timer);
      await scope?.close().catch(() => {});
    },
  };
}

test("CLI exports the stopped active run only after endRun, preserving saved effects", async (t) => {
  const entered = deferred(),
    release = deferred(),
    finalized = deferred();
  const facts = { text: "original", saved: false };
  let action,
    writes = 0,
    endCalls = 0,
    endFinished = false;
  const h = harness({
    createSession: createDriverSession,
    adapter: {
      model: { id: "test", version: "1" },
      observe: async () => ({ connected: true, session: "alpha", facts }),
      effectStatus: () => ({ status: facts.saved ? "saved" : "not_attempted" }),
      handlers: {
        edit: async (p, x) =>
          x.effect(() => {
            facts.text = p.text;
          }),
        save: async (_, x) => {
          await x.effect(() => {
            writes++;
            facts.saved = true;
          });
          entered.resolve();
          await release.promise;
          await x.boundary();
        },
      },
      endRun: async ({ command }) => {
        if (command === "save") {
          endCalls++;
          await finalized.promise;
          endFinished = true;
        }
      },
    },
    createViewer: async ({ session }) => {
      await session.execute(
        "edit",
        { text: "prior" },
        (await session.snapshot()).revision,
      );
      action = session.execute("save", {}, (await session.snapshot()).revision);
      await entered.promise;
    },
    writeReport: () =>
      assert.equal(endFinished, true, "Report must wait for endRun"),
  });
  t.after(() => h.dispose());
  await bounded(h.ready.promise);
  await tick();
  h.process.emit("SIGINT");
  release.resolve();
  await tick();
  finalized.resolve();
  await bounded(h.run);
  const result = await action;
  const report = h.calls.reports[0];
  assert.equal(
    report.lastResult.runId,
    result.runId,
    "Final report must contain the active run, not the previous one",
  );
  assert.equal(report.lastResult.command, "save");
  assert.equal(report.lastResult.execution, "stopped");
  assert.equal(report.lastResult.effect.status, "saved");
  assert.ok(report.completedRunIds.includes(result.runId));
  assert.equal(writes, 1);
  assert.equal(endCalls, 1);
  assert.equal(h.calls.browser, 1);
  assert.equal(h.calls.attached, 0);
  assert.equal(h.process.listenerCount("SIGINT"), 0);
  assert.equal(h.intervals.size, 0);
});

test("CLI keeps failed owned cleanup recoverable by a later signal", async (t) => {
  let attempts = 0;
  const h = harness({
    closeBrowser: () => {
      if (++attempts === 1) throw Error("temporary failure");
    },
  });
  t.after(() => h.dispose());
  await h.ready.promise;
  await tick();
  h.process.emit("SIGINT");
  await bounded(h.diagnostic.promise);
  await tick();
  assert.equal(h.scope().snapshot()[1].status, "cleanup_failed");
  assert.equal(h.calls.reports[0].resources?.[1]?.status, "cleanup_failed");
  assert.equal(
    h.process.listenerCount("SIGINT"),
    1,
    "Failed cleanup must retain a retry signal handler",
  );
  assert.equal(h.process.listenerCount("SIGTERM"), 1);
  assert.equal(
    h.intervals.size,
    1,
    "A failed cleanup with no remaining handles must keep the CLI alive",
  );
  assert.equal(h.process.emit("SIGTERM"), true);
  await bounded(h.run);
  assert.equal(attempts, 2);
  assert.equal(h.calls.session, 1);
  assert.equal(h.calls.viewer, 1);
  assert.equal(h.calls.attached, 0);
  assert.equal(h.process.exitCode, undefined);
  assert.equal(h.intervals.size, 0);
});

test("CLI retries failed session cleanup once per signal without replaying the run", async (t) => {
  const facts = { text: "original", saved: false };
  let writes = 0,
    endCalls = 0,
    closeCalls = 0;
  const h = harness({
    createSession: createDriverSession,
    adapter: {
      model: { id: "test", version: "1" },
      observe: async () => ({ connected: true, session: "alpha", facts }),
      effectStatus: () => ({ status: facts.saved ? "saved" : "not_attempted" }),
      handlers: {
        edit: async () => {},
        save: async (_, x) =>
          x.effect(() => {
            writes++;
            facts.saved = true;
          }),
      },
      endRun: async () => {
        endCalls++;
      },
      close: async () => {
        if (++closeCalls === 1)
          throw Error("temporary adapter cleanup failure");
      },
    },
    createViewer: async ({ session }) => {
      await session.execute("save", {}, (await session.snapshot()).revision);
    },
  });
  t.after(() => h.dispose());
  await h.ready.promise;
  await tick();
  h.process.emit("SIGINT");
  await bounded(h.diagnostic.promise);
  await tick();
  assert.equal(
    closeCalls,
    1,
    "One signal must not retry failed adapter cleanup implicitly",
  );
  assert.equal(h.calls.reports[0].lastResult.execution, "completed");
  assert.equal(h.calls.reports[0].lastResult.effect.status, "saved");
  assert.equal(h.calls.reports[0].resources?.[2]?.status, "cleanup_failed");
  h.process.emit("SIGTERM");
  await bounded(h.run);
  assert.equal(closeCalls, 2);
  assert.equal(writes, 1);
  assert.equal(endCalls, 1);
  assert.equal(h.calls.browser, 1);
  assert.equal(h.calls.viewer, 1);
  assert.equal(h.calls.attached, 0);
  assert.equal(h.calls.reports[1].resources?.[2]?.status, "closed");
  assert.equal(h.intervals.size, 0);
});

test("CLI report write failure still closes owned resources and exits with failure", async (t) => {
  const h = harness({
    writeReport: () => {
      throw Error("report disk unavailable");
    },
  });
  t.after(() => h.dispose());
  await h.ready.promise;
  await tick();
  h.process.emit("SIGTERM");
  await bounded(h.run);
  await tick();
  assert.equal(h.calls.browser, 1);
  assert.equal(h.calls.session, 1);
  assert.equal(h.calls.viewer, 1);
  assert.equal(h.calls.attached, 0);
  assert.equal(h.process.exitCode, 1);
  assert.ok(
    h.diagnostics.some((text) => text.includes("report disk unavailable")),
  );
  assert.equal(h.process.listenerCount("SIGINT"), 0);
  assert.equal(h.intervals.size, 0);
});

test("CLI stop during startup owns and closes a browser acquired after the signal", async (t) => {
  const launching = deferred(),
    release = deferred();
  const h = harness({
    launchBrowser: async () => {
      launching.resolve();
      await release.promise;
    },
  });
  t.after(() => h.dispose());
  await launching.promise;
  h.process.emit("SIGINT");
  h.process.emit("SIGTERM");
  release.resolve();
  await h.run.catch(() => {});
  assert.equal(h.calls.browser, 1);
  assert.equal(h.calls.session, 0);
  assert.equal(h.calls.viewer, 0);
  assert.equal(h.calls.attached, 0);
  assert.equal(h.calls.reports.length, 0);
  assert.equal(h.process.listenerCount("SIGINT"), 0);
  assert.equal(h.intervals.size, 0);
});

test("CLI repeated signals do not overlap cleanup or repeat successful cleanup", async (t) => {
  const entered = deferred(),
    release = deferred();
  const h = harness({
    closeBrowser: async () => {
      entered.resolve();
      await release.promise;
    },
  });
  t.after(() => h.dispose());
  await h.ready.promise;
  await tick();
  h.process.emit("SIGINT");
  await entered.promise;
  h.process.emit("SIGINT");
  h.process.emit("SIGTERM");
  await tick();
  assert.equal(h.calls.browser, 1);
  release.resolve();
  await bounded(h.run);
  assert.equal(h.calls.browser, 1);
  assert.equal(h.calls.session, 1);
  assert.equal(h.calls.viewer, 1);
  assert.equal(h.calls.reports.length, 1);
  assert.equal(h.intervals.size, 0);
});

test("CLI stop while the adapter starts does not subsequently launch an engine", async (t) => {
  const entered = deferred(),
    release = deferred();
  let created = 0,
    adapterClosed = 0;
  const h = harness({
    createAdapter: async () => {
      entered.resolve();
      await release.promise;
      return {
        model: { id: "test", version: "1" },
        close: async () => {
          adapterClosed++;
        },
      };
    },
    createSession: async () => {
      created++;
      return { stop() {}, close: async () => {}, report: () => ({}) };
    },
  });
  t.after(() => h.dispose());
  await entered.promise;
  h.process.emit("SIGINT");
  release.resolve();
  await bounded(h.run);
  assert.equal(
    created,
    0,
    "An interrupted startup must not acquire the next resource",
  );
  assert.equal(h.calls.browser, 1);
  assert.equal(
    adapterClosed,
    1,
    "The newly returned adapter must still be cleaned up",
  );
  assert.equal(h.calls.viewer, 0);
  assert.equal(h.calls.attached, 0);
});

test("CLI startup failure keeps cleanup retry available and preserves the failing exit code", async (t) => {
  let attempts = 0;
  const h = harness({
    createViewer: () => {
      throw Error("viewer startup failed");
    },
    closeBrowser: () => {
      if (++attempts === 1) throw Error("temporary browser cleanup failure");
    },
  });
  t.after(() => h.dispose());
  await bounded(h.diagnostic.promise);
  await tick();
  assert.equal(h.process.exitCode, 1);
  assert.ok(
    h.diagnostics.some((text) => text.includes("viewer startup failed")),
  );
  assert.ok(h.diagnostics.some((text) => text.includes("retained for retry")));
  assert.equal(h.process.listenerCount("SIGINT"), 1);
  h.process.emit("SIGINT");
  await bounded(h.run);
  assert.equal(attempts, 2);
  assert.equal(h.calls.session, 1);
  assert.equal(h.calls.attached, 0);
  assert.equal(h.process.exitCode, 1);
  assert.equal(h.intervals.size, 0);
});

test("CLI seals an existing session immediately while viewer startup is pending", async (t) => {
  const entered = deferred(),
    release = deferred();
  const h = harness({
    createViewer: async () => {
      entered.resolve();
      await release.promise;
    },
  });
  t.after(async () => {
    release.resolve();
    await h.dispose();
  });
  await entered.promise;
  h.process.emit("SIGINT");
  await tick();
  assert.equal(
    h.calls.session,
    1,
    "Pending viewer startup must not leave session commands accepting effects",
  );
  release.resolve();
  await bounded(h.run);
  assert.equal(h.calls.session, 1);
  assert.equal(h.calls.browser, 1);
  assert.equal(h.calls.viewer, 1);
  assert.equal(h.calls.attached, 0);
  assert.equal(h.intervals.size, 0);
});

for (const failure of ["missing engine", "descriptor mismatch"])
  test(`CLI retains adapter cleanup when session creation fails: ${failure}`, async (t) => {
    let adapterCloses = 0;
    const h = harness({
      enginePath:
        failure === "missing engine" ? "/missing-cli-test/engine" : enginePath,
      createSession: createDriverSession,
      adapter: {
        model: {
          id: failure === "descriptor mismatch" ? "mismatch" : "test",
          version: "1",
        },
        observe: async () => ({ connected: true, session: "alpha", facts: {} }),
        handlers: { edit: async () => {}, save: async () => {} },
        close: async () => {
          if (++adapterCloses === 1)
            throw Error("temporary startup adapter cleanup failure");
        },
      },
    });
    t.after(() => h.dispose());
    await bounded(h.diagnostic.promise);
    await tick();
    assert.equal(
      adapterCloses,
      1,
      "Failed session creation must retain and close its adapter",
    );
    assert.equal(h.scope().snapshot().at(-1).status, "cleanup_failed");
    assert.equal(h.calls.browser, 1);
    assert.equal(h.calls.viewer, 0);
    assert.equal(h.calls.reports.length, 0);
    assert.equal(h.process.listenerCount("SIGTERM"), 1);
    h.process.emit("SIGTERM");
    await bounded(h.run);
    assert.equal(adapterCloses, 2);
    assert.equal(h.calls.browser, 1);
    assert.equal(h.calls.attached, 0);
    assert.equal(h.process.exitCode, 1);
    assert.equal(h.intervals.size, 0);
  });

for (const signal of ["SIGINT", "SIGTERM"])
  test(`CLI retains ${signal} ownership while finalization is pending`, async (t) => {
    const entered = deferred(),
      release = deferred();
    let browserClosedByLibrarySignal = false;
    const h = harness({
      launchBrowser: (options, { process, browser }) => {
        // Playwright defaults these options to true and installs competing
        // handlers that close its browser immediately. SIGINT also exits the
        // host process after browser closure; model the premature browser close
        // here without terminating the test runner.
        if (options[`handle${signal}`] !== false)
          process.on(signal, () => {
            browserClosedByLibrarySignal = true;
            void browser.close();
          });
      },
      closeSession: async () => {
        entered.resolve();
        await release.promise;
      },
    });
    t.after(async () => {
      release.resolve();
      await h.dispose();
    });
    await h.ready.promise;
    await tick();
    h.process.emit(signal);
    await entered.promise;
    assert.equal(
      browserClosedByLibrarySignal,
      false,
      "Playwright must not bypass CLI finalization on its documented shutdown signals",
    );
    assert.equal(
      h.calls.browser,
      0,
      "Browser must stay available until session finalization settles",
    );
    assert.equal(h.calls.reports.length, 0);
    release.resolve();
    await bounded(h.run);
    assert.equal(h.calls.browser, 1);
    assert.equal(h.calls.session, 1);
    assert.equal(h.calls.reports.length, 1);
    assert.equal(h.calls.attached, 0);
    assert.equal(h.intervals.size, 0);
  });

test("CLI passes customer presentation metadata into its session without auto-start", async (t) => {
  const presentations = [
    {
      id: "show",
      title: "Show",
      command: "save",
      stages: [{ title: "Saved", holdMs: 15000 }],
    },
  ];
  let received;
  const h = harness({
    presentations,
    createSession: async (options) => {
      received = options.presentations;
      return { stop() {}, close: async () => {}, report: () => ({}) };
    },
  });
  t.after(() => h.dispose());
  await h.ready.promise;
  await tick();
  h.process.emit("SIGTERM");
  await bounded(h.run);
  assert.deepEqual(received, presentations);
});

function customSession(overrides = {}) {
  const snapshot = async () => ({ descriptor: { id: "test", version: "1" } });
  return {
    snapshot,
    observe: snapshot,
    execute: async () => ({}),
    runRecipe: async () => ({}),
    command: async () => ({}),
    startPresentation: async () => ({}),
    advancePresentation: () => ({ ok: true }),
    pause: () => ({ ok: true }),
    resume: () => ({ ok: true }),
    stop() {},
    setSpeed: () => ({ ok: true }),
    close: async () => {},
    report: () => ({
      identity: { model: { id: "custom", version: "1" } },
      facade: true,
    }),
    ...overrides,
  };
}

test("CLI custom factory supplies the exact facade to viewer, shutdown and final report", async (t) => {
  let closes = 0,
    stops = 0,
    commands = 0,
    defaults = 0,
    supplied;
  const facade = customSession({
    close: async () => closes++,
    stop: () => stops++,
    command: async () => {
      commands++;
      return { ok: true };
    },
  });
  const h = harness({
    project: () => ({
      url: "about:blank",
      createSession: async (options) => {
        supplied = options;
        return facade;
      },
    }),
    createSession: async () => {
      defaults++;
      throw Error("default path must not run");
    },
    createViewer: async ({ session }) => {
      assert.equal(session, facade);
      await session.command({ id: "fixture" });
    },
  });
  t.after(() => h.dispose());
  await bounded(h.ready.promise);
  assert.ok(supplied.page && supplied.context && supplied.resources);
  assert.equal(defaults, 0);
  h.process.emit("SIGTERM");
  await bounded(h.run);
  assert.equal(closes, 1);
  assert.ok(stops >= 1);
  assert.equal(commands, 1);
  assert.equal(h.calls.reports[0].facade, true);
  assert.equal(h.calls.browser, 1);
  assert.equal(h.calls.attached, 0);
});

test("CLI owns a custom session returned after startup interruption before validating or viewing it", async (t) => {
  const entered = deferred(),
    release = deferred();
  let closes = 0;
  const h = harness({
    project: () => ({
      url: "about:blank",
      createSession: async () => {
        entered.resolve();
        await release.promise;
        return customSession({ close: async () => closes++ });
      },
    }),
  });
  t.after(async () => {
    release.resolve();
    await h.dispose();
  });
  await bounded(entered.promise);
  h.process.emit("SIGINT");
  release.resolve();
  await bounded(h.run);
  assert.equal(closes, 1);
  assert.equal(h.calls.viewer, 0);
  assert.equal(h.calls.browser, 1);
  assert.equal(h.calls.attached, 0);
});

test("CLI cleans resources registered by a failing custom factory", async (t) => {
  let partial = 0;
  const h = harness({
    project: () => ({
      url: "about:blank",
      createSession: async ({ resources }) => {
        resources.own(
          {},
          { label: "partially started custom fixture", close: () => partial++ },
        );
        throw Error("custom initialization failed");
      },
    }),
  });
  t.after(() => h.dispose());
  await bounded(h.run);
  assert.equal(h.process.exitCode, 1);
  assert.equal(partial, 1);
  assert.equal(h.calls.browser, 1);
  assert.equal(h.calls.viewer, 0);
  assert.equal(h.calls.attached, 0);
  assert.ok(
    h.diagnostics.some((s) => s.includes("custom initialization failed")),
  );
});

for (const invalid of [
  "missing command",
  "missing stop",
  "missing report",
  "missing close",
  "null",
  "ambiguous",
])
  test(`CLI rejects invalid custom project/session: ${invalid}`, async (t) => {
    let closes = 0,
      factories = 0;
    const h = harness({
      project: () => ({
        url: "about:blank",
        ...(invalid === "ambiguous"
          ? { enginePath, createAdapter: async () => ({}) }
          : {}),
        createSession: async () => {
          factories++;
          if (invalid === "null") return null;
          const session = customSession({ close: async () => closes++ });
          delete session[invalid.slice("missing ".length)];
          return session;
        },
      }),
    });
    t.after(() => h.dispose());
    await bounded(h.run);
    assert.equal(h.process.exitCode, 1);
    assert.equal(h.calls.viewer, 0);
    assert.equal(h.calls.attached, 0);
    assert.equal(factories, invalid === "ambiguous" ? 0 : 1);
    assert.equal(
      closes,
      invalid.startsWith("missing ") && invalid !== "missing close" ? 1 : 0,
      "A returned closable invalid session remains owned",
    );
  });

test("CLI retries custom facade cleanup without repeating commands or closing attached resources", async (t) => {
  let closes = 0,
    commands = 0;
  const facade = customSession({
    close: async () => {
      if (++closes === 1) throw Error("retry custom close");
    },
    command: async () => {
      commands++;
    },
  });
  const h = harness({
    project: () => ({ url: "about:blank", createSession: async () => facade }),
    createViewer: async ({ session }) => session.command({ id: "once" }),
  });
  t.after(() => h.dispose());
  await bounded(h.ready.promise);
  h.process.emit("SIGINT");
  await bounded(h.diagnostic.promise);
  await tick();
  assert.equal(closes, 1);
  assert.equal(commands, 1);
  assert.equal(h.calls.reports[0].facade, true);
  assert.ok(
    h.calls.reports[0].resources.some(
      (r) => r.label === "driver session" && r.status === "cleanup_failed",
    ),
  );
  h.process.emit("SIGTERM");
  await bounded(h.run);
  assert.equal(closes, 2);
  assert.equal(commands, 1);
  assert.equal(h.calls.browser, 1);
  assert.equal(h.calls.attached, 0);
  assert.ok(
    h.calls.reports[1].resources.some(
      (r) => r.label === "driver session" && r.status === "closed",
    ),
  );
});

test("CLI custom facade settles an active write before final report and browser closure", async (t) => {
  const entered = deferred(),
    release = deferred();
  let writes = 0,
    endCalls = 0,
    running;
  const facts = { text: "retained", saved: false };
  const h = harness({
    project: () => ({
      url: "about:blank",
      createSession: async ({ page, context }) => {
        const inner = await createDriverSession({
          page,
          context,
          enginePath,
          adapter: {
            model: { id: "test", version: "1" },
            observe: async () => ({ connected: true, session: "alpha", facts }),
            effectStatus: () => ({
              status: facts.saved ? "saved" : "not_attempted",
            }),
            handlers: {
              edit: async () => {},
              save: async (_, x) => {
                await x.effect(() => {
                  facts.saved = true;
                  writes++;
                });
                entered.resolve();
                await release.promise;
              },
            },
            endRun: async () => {
              endCalls++;
            },
          },
        });
        return {
          ...inner,
          report: () => ({ ...inner.report(), customFacade: true }),
        };
      },
    }),
    createViewer: async ({ session }) => {
      running = session.execute(
        "save",
        {},
        (await session.snapshot()).revision,
      );
    },
  });
  t.after(async () => {
    release.resolve();
    await h.dispose();
  });
  await bounded(entered.promise);
  h.process.emit("SIGTERM");
  await tick();
  assert.equal(h.calls.browser, 0);
  assert.equal(h.calls.reports.length, 0);
  release.resolve();
  await bounded(h.run);
  await running;
  assert.equal(writes, 1);
  assert.equal(endCalls, 1);
  assert.equal(h.calls.browser, 1);
  assert.equal(h.calls.attached, 0);
  assert.equal(h.calls.reports[0].customFacade, true);
  assert.equal(h.calls.reports[0].lastResult.execution, "stopped");
  assert.equal(h.calls.reports[0].lastResult.effect.status, "saved");
});

test("CLI immediately cancels paused factory startup before its next command and owns the partial facade once", async (t) => {
  const entered = deferred(),
    release = deferred();
  const facts = { text: "retained", saved: false };
  let facade,
    factorySignal,
    firstResult,
    firstCommands = 0,
    nextCommands = 0,
    effects = 0,
    closes = 0;
  const h = harness({
    project: () => ({
      url: "about:blank",
      createSession: async ({
        page,
        context,
        signal,
        ownSession,
        resources,
      }) => {
        factorySignal = signal;
        const inner = await createDriverSession({
          page,
          context,
          enginePath,
          adapter: {
            model: { id: "test", version: "1" },
            observe: async () => ({ connected: true, session: "alpha", facts }),
            handlers: {
              edit: async (_, x) => {
                entered.resolve();
                await release.promise;
                await x.effect(() => effects++);
              },
              save: async () => nextCommands++,
            },
          },
        });
        facade = {
          ...inner,
          close: async () => {
            closes++;
            await inner.close();
          },
        };
        // Keep the pre-feature run observable: only the new cancellation/ownership
        // behavior is asserted, while fallback cleanup prevents a leaked engine.
        if (ownSession) ownSession(facade);
        else
          resources.own(facade, {
            label: "fallback partial",
            close: (value) => value.close(),
          });
        const abort = () => facade.stop();
        signal?.addEventListener("abort", abort, { once: true });
        try {
          signal?.throwIfAborted();
          firstCommands++;
          firstResult = await facade.execute(
            "edit",
            { text: "first" },
            (await facade.snapshot()).revision,
          );
          signal?.throwIfAborted();
          nextCommands++;
          await facade.execute("save", {}, (await facade.snapshot()).revision);
          return facade;
        } finally {
          signal?.removeEventListener("abort", abort);
        }
      },
    }),
  });
  t.after(async () => {
    facade?.stop();
    release.resolve();
    await h.dispose();
  });
  await bounded(entered.promise);
  facade.pause();
  release.resolve();
  await tick();
  h.process.emit("SIGINT");
  assert.equal(
    factorySignal?.aborted,
    true,
    "Shutdown must synchronously abort pending startup",
  );
  await bounded(h.run);
  assert.equal(firstCommands, 1);
  assert.equal(firstResult.error_code, "stopped");
  assert.equal(nextCommands, 0);
  assert.equal(effects, 0);
  assert.equal(closes, 1);
  assert.equal(h.calls.viewer, 0);
  assert.equal(h.calls.browser, 1);
  assert.equal(h.calls.attached, 0);
});

test("CLI transfers early custom session ownership without a second close", async (t) => {
  let closes = 0;
  const facade = customSession({ close: async () => closes++ });
  const h = harness({
    project: () => ({
      url: "about:blank",
      createSession: async ({ ownSession, resources }) => {
        if (ownSession) ownSession(facade);
        else
          resources.own(facade, {
            label: "fallback partial",
            close: (value) => value.close(),
          });
        return facade;
      },
    }),
  });
  t.after(() => h.dispose());
  await bounded(h.ready.promise);
  h.process.emit("SIGTERM");
  await bounded(h.run);
  assert.equal(closes, 1, "An early owned and returned facade must close once");
  assert.equal(
    h
      .scope()
      .snapshot()
      .filter((r) => r.label === "driver session").length,
    1,
  );
});
