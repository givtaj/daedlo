import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createDriverSession } from "../src/session.mjs";
import { createResourceScope } from "../src/resources.mjs";

const enginePath = fileURLToPath(new URL("./fake-engine.mjs", import.meta.url));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

for (const nesting of ["direct", "nested scope", "nested session scope"]) {
  test(`pending session finalization preserves dependencies through ${nesting} ownership`, async (t) => {
    const entered = deferred(),
      release = deferred();
    const outer = createResourceScope();
    const inner = nesting === "direct" ? outer : createResourceScope();
    const closed = [];
    const calls = { effect: 0, endRun: 0, adapterClose: 0 };
    const facts = { text: "fixture", saved: false };
    let session,
      running,
      closeTimeoutMs = 20;
    outer.attach(
      {},
      { label: "Attached application", close: () => closed.push("attached") },
    );
    outer.own({}, { label: "Fixture", close: () => closed.push("fixture") });
    if (nesting === "nested scope")
      outer.own(inner, {
        label: "Nested run scope",
        close: (scope) => scope.close(),
      });
    if (nesting === "nested session scope") {
      const enclosing = await createDriverSession({
        page: { isClosed: () => false },
        enginePath,
        resources: inner,
        adapter: {
          model: { id: "test", version: "1" },
          observe: async () => ({
            connected: true,
            session: "enclosing",
            facts: { ...facts },
          }),
          handlers: { edit: async () => {}, save: async () => {} },
        },
      });
      // The enclosing session must forward the child's pending marker rather
      // than waiting out its own deadline or converting it to a settled error.
      outer.own(enclosing, {
        label: "Enclosing session",
        close: (driver) => driver.close(),
      });
    }
    inner.own({}, { label: "Browser", close: () => closed.push("browser") });
    t.after(async () => {
      closeTimeoutMs = 5000;
      release.resolve();
      await running;
      await outer.close();
    });
    session = await createDriverSession({
      page: { isClosed: () => closed.includes("browser") },
      enginePath,
      adapter: {
        model: { id: "test", version: "1" },
        observe: async () => ({
          connected: true,
          session: "scope-fixture",
          facts: { ...facts },
        }),
        handlers: {
          edit: async () => {},
          save: async (_, execution) =>
            execution.effect(() => {
              calls.effect++;
              facts.saved = true;
            }),
        },
        effectStatus: () => ({ status: "saved" }),
        endRun: async () => {
          calls.endRun++;
          entered.resolve();
          await release.promise;
          assert.equal(
            closed.includes("browser"),
            false,
            "Retained finalization still has its browser",
          );
          assert.equal(
            closed.includes("fixture"),
            false,
            "Retained finalization still has its fixture",
          );
        },
        close: () => {
          calls.adapterClose++;
        },
      },
    });
    inner.own(session, {
      label: "Driver session",
      close: (driver) => driver.close({ timeoutMs: closeTimeoutMs }),
    });
    inner.own({}, { label: "Viewer", close: () => closed.push("viewer") });
    running = session.execute("save", {}, (await session.snapshot()).revision);
    await entered.promise;
    const first = outer.close();
    assert.equal(
      first,
      outer.close(),
      "Concurrent callers share the same scope cleanup",
    );
    const error = await first.then(
      () => null,
      (failure) => failure,
    );
    assert.deepEqual(
      closed,
      ["viewer"],
      "A pending session must retain earlier browser and fixture dependencies",
    );
    assert.equal(error?.code, "cleanup_incomplete");
    assert.equal(error?.cleanupPending, true);
    assert.equal(session.report().finalization.phase, "run_cleanup");
    assert.deepEqual(session.report().completedRunIds, []);
    assert.equal(calls.adapterClose, 0);
    await assert.rejects(outer.close(), {
      code: "cleanup_incomplete",
      cleanupPending: true,
    });
    assert.deepEqual(closed, ["viewer"]);
    release.resolve();
    const result = await running;
    assert.equal(result.effect.status, "saved");
    assert.equal(result.cleanupFailed, undefined);
    closeTimeoutMs = 5000;
    await outer.close();
    await outer.close();
    assert.deepEqual(closed, ["viewer", "browser", "fixture"]);
    assert.deepEqual(calls, { effect: 1, endRun: 1, adapterClose: 1 });
    assert.equal(outer.snapshot()[0].status, "attached");
  });
}
