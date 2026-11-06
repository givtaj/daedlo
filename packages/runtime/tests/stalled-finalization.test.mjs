import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createDriverSession } from "../src/session.mjs";

const enginePath = fileURLToPath(new URL("./fake-engine.mjs", import.meta.url));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
async function observed(promise, milliseconds = 300) {
  let timer;
  const result = await Promise.race([
    promise.then(
      (value) => ({ value }),
      (error) => ({ error }),
    ),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ stillWaiting: true }), milliseconds);
    }),
  ]);
  clearTimeout(timer);
  return result;
}
async function fixture(t, phase, { throws = false, cooperative = false } = {}) {
  const entered = deferred(),
    release = deferred();
  const facts = { text: "original", saved: false };
  const calls = { effects: 0, evidence: 0, end: 0, close: 0 };
  let hookContext, running;
  const held = async (context) => {
    hookContext = context;
    entered.resolve();
    if (cooperative && context?.signal) {
      if (!context.signal.aborted)
        await new Promise((resolve) =>
          context.signal.addEventListener("abort", resolve, { once: true }),
        );
    } else await release.promise;
    if (throws) throw Error("private fixture diagnostic");
  };
  const driver = await createDriverSession({
    page: { isClosed: () => false },
    enginePath,
    finalizationWaitMs: 20,
    adapter: {
      model: { id: "test", version: "1" },
      observe: async () => ({
        connected: true,
        session: "alpha",
        facts: { ...facts },
      }),
      handlers: {
        edit: async (p, x) =>
          x.effect(() => {
            facts.text = p.text;
            calls.effects++;
          }),
        save: async (_, x) =>
          x.effect(() => {
            facts.saved = true;
            calls.effects++;
          }),
      },
      effectStatus: async (context) => {
        calls.evidence++;
        if (phase === "effect_evidence") await held(context);
        return { status: "saved" };
      },
      endRun: async (context) => {
        calls.end++;
        if (phase === "run_cleanup") await held(context);
      },
      close: async () => {
        calls.close++;
      },
    },
  });
  t.after(async () => {
    release.resolve();
    driver.stop();
    await running;
    await driver.close();
  });
  running = driver.execute("save", {}, (await driver.snapshot()).revision);
  await entered.promise;
  return {
    driver,
    running,
    entered,
    release,
    calls,
    context: () => hookContext,
  };
}

for (const phase of ["effect_evidence", "run_cleanup"]) {
  test(`${phase}: stalled hooks stay active and block overlapping effects`, async (t) => {
    const f = await fixture(t, phase);
    const snapshot = await f.driver.snapshot();
    assert.equal(
      snapshot.finalization?.phase,
      phase,
      "Expose the actual pending finalization phase",
    );
    assert.equal(snapshot.finalization.runId, snapshot.runId);
    assert.equal(snapshot.finalization.stopRequested, false);
    assert.deepEqual(f.driver.report().finalization, snapshot.finalization);
    assert.equal(f.driver.report({ runId: snapshot.runId }), null);
    await delay(30);
    assert.equal((await f.driver.snapshot()).finalization.status, "stalled");
    assert.equal((await f.driver.snapshot()).busy, true);
    const blocked = await f.driver.execute("save", {}, snapshot.revision);
    assert.equal(blocked.error_code, "busy");
    assert.equal(f.calls.effects, 1);
    f.driver.stop();
    assert.equal(f.context().signal.aborted, true);
    assert.equal((await f.driver.snapshot()).finalization.stopRequested, true);
    assert.equal(
      f.driver.report({ runId: snapshot.runId }),
      null,
      "Stop is not proof that a hook settled",
    );
    f.release.resolve();
    const result = await f.running;
    assert.equal(
      result.execution,
      phase === "effect_evidence" ? "stopped" : "completed",
    );
    assert.equal(result.effect.status, "saved");
    assert.equal((await f.driver.snapshot()).finalization, null);
    assert.equal(f.calls.evidence, 1);
    assert.equal(f.calls.end, 1);
    const frozen = f.driver.report({ runId: result.runId });
    await f.driver.close();
    assert.deepEqual(f.driver.report({ runId: result.runId }), frozen);
  });

  test(`${phase}: close has a retryable deadline without duplicating or abandoning the hook`, async (t) => {
    const f = await fixture(t, phase);
    const a = f.driver.close({ timeoutMs: 25 });
    const b = f.driver.close({ timeoutMs: 25 });
    assert.equal(a, b, "Concurrent close calls share the same attempt");
    const first = await observed(a);
    assert.equal(
      first.error?.code,
      "cleanup_incomplete",
      "Close must reject within its budget while the hook is unresolved",
    );
    assert.doesNotMatch(first.error.message, /private fixture/);
    assert.equal(
      f.calls.close,
      0,
      "Adapter cleanup must not overlap an unresolved finalization hook",
    );
    if (phase === "effect_evidence") assert.equal(f.calls.end, 0);
    assert.deepEqual(f.driver.report().completedRunIds, []);
    const blocked = await f.driver.execute("save", {}, "unused");
    assert.equal(blocked.error_code, "closed");
    const second = await observed(f.driver.close({ timeoutMs: 25 }));
    assert.equal(second.error?.code, "cleanup_incomplete");
    f.release.resolve();
    const result = await f.running;
    await f.driver.close({ timeoutMs: 1000 });
    await f.driver.close({ timeoutMs: 1000 });
    assert.equal(result.effect.status, "saved");
    assert.equal(f.calls.evidence, 1);
    assert.equal(f.calls.end, 1);
    assert.equal(f.calls.close, 1);
    assert.equal(f.calls.effects, 1);
  });

  test(`${phase}: cooperative Stop can settle the original hook`, async (t) => {
    const f = await fixture(t, phase, { cooperative: true });
    assert.ok(
      f.context()?.signal instanceof AbortSignal,
      "Finalization hooks receive cooperative cancellation context",
    );
    f.driver.stop();
    const done = await observed(f.running);
    assert.ok(done.value, "The original cooperative hook settles after Stop");
    assert.equal(done.value.effect.status, "saved");
    assert.equal(f.calls.effects, 1);
  });

  test(`${phase}: late hook rejection is redacted and never crosses runs`, async (t) => {
    const f = await fixture(t, phase, { throws: true });
    await delay(30);
    f.release.resolve();
    const result = await f.running;
    assert.equal(
      result.effect.status,
      phase === "effect_evidence" ? "uncertain" : "saved",
    );
    if (phase === "run_cleanup") assert.equal(result.cleanupFailed, true);
    assert.doesNotMatch(JSON.stringify(f.driver.report()), /private fixture/);
    const frozen = f.driver.report({ runId: result.runId });
    const next = await f.driver.execute(
      "save",
      {},
      (await f.driver.snapshot()).revision,
    );
    assert.notEqual(next.runId, result.runId);
    assert.equal(f.calls.effects, 2);
    assert.deepEqual(f.driver.report({ runId: result.runId }), frozen);
  });
}

test("close retains a pending adapter cleanup and retries only rejected cleanup", async (t) => {
  const entered = deferred(),
    release = deferred();
  let closeCalls = 0;
  const driver = await createDriverSession({
    page: { isClosed: () => false },
    enginePath,
    adapter: {
      model: { id: "test", version: "1" },
      observe: async () => ({
        connected: true,
        session: "alpha",
        facts: { text: "", saved: false },
      }),
      handlers: { edit: async () => {}, save: async () => {} },
      close: async () => {
        closeCalls++;
        entered.resolve();
        await release.promise;
      },
    },
  });
  t.after(async () => {
    release.resolve();
    await driver.close();
  });
  const first = driver.close({ timeoutMs: 25 });
  await entered.promise;
  assert.equal((await observed(first)).error?.code, "cleanup_incomplete");
  assert.equal(
    (await observed(driver.close({ timeoutMs: 25 }))).error?.code,
    "cleanup_incomplete",
  );
  assert.equal(closeCalls, 1, "Retry must await the original cleanup promise");
  release.resolve();
  await driver.close();
  assert.equal(closeCalls, 1);
});
