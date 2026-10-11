import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { createDriverSession } from "../src/session.mjs";

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
async function until(check) {
  const end = Date.now() + 3000;
  while (!check()) {
    assert.ok(Date.now() < end, "Expected lifecycle event was not observed");
    await nextTurn();
  }
}

async function fixture(t, kind, command = "edit", direct = false) {
  const folder = await mkdtemp(join(tmpdir(), "driver-recipe-finalization-"));
  const enginePath = join(folder, "engine.mjs");
  await writeFile(
    enginePath,
    await readFile(new URL("./fake-engine.mjs", import.meta.url)),
    { mode: 0o755 },
  );
  await writeFile(
    join(folder, "fixture-config.json"),
    JSON.stringify({
      verifyOutcomes: { [command]: { kind, label: `Observed ${kind}` } },
    }),
  );
  t.after(() => rm(folder, { recursive: true, force: true }));
  const dispatched = deferred(),
    release = deferred();
  const facts = { text: "original", saved: false };
  const effects = [],
    ended = [];
  let armed = false,
    settled = false,
    settleCount = 0;
  const handler = (id) => async (params, x) => {
    await x.effect(async () => {
      if (id === "edit") facts.text = params.text;
      else facts.saved = true;
      if (armed) effects.push(id);
      if (armed && id === command) {
        dispatched.resolve();
        await release.promise;
      }
    });
  };
  const driver = await createDriverSession({
    page: { isClosed: () => false },
    enginePath,
    adapter: {
      model: { id: "test", version: "1" },
      observe: async () => ({
        connected: true,
        session: "alpha",
        facts: { ...facts },
      }),
      handlers: { edit: handler("edit"), save: handler("save") },
      settle: async () => {
        if (armed) settleCount++;
      },
      effectStatus: () => ({ status: "uncertain" }),
      endRun: async (info) => {
        ended.push(info);
      },
    },
  });
  t.after(async () => {
    release.resolve();
    await driver.close();
  });
  const previous = await driver.execute(
    "save",
    {},
    (await driver.snapshot()).revision,
  );
  const previousReport = driver.report({ runId: previous.runId });
  const previousRunIds = driver.report().completedRunIds;
  const previousEnds = ended.length;
  armed = true;
  const revision = (await driver.snapshot()).revision;
  const running = direct
    ? driver.execute(
        command,
        command === "edit" ? { text: "direct" } : {},
        revision,
      )
    : driver.runRecipe("sample", revision);
  running.then(() => {
    settled = true;
  });
  await dispatched.promise;
  const runId = driver.report().runId;
  driver.pause();
  release.resolve();
  await until(() =>
    driver
      .report()
      .events.some(
        (e) =>
          e.runId === runId && e.type === "verified" && e.command === command,
      ),
  );
  // This observation passes through the same protocol process after verification;
  // assertions below never rely on sleeping to keep the recipe alive.
  const snapshot = await driver.snapshot();
  return {
    driver,
    running,
    runId,
    snapshot,
    previous,
    previousReport,
    previousRunIds,
    effects,
    ended: () => ended.length - previousEnds,
    settled: () => settled,
    settleCount: () => settleCount,
  };
}

function assertHeld(f, kind, command) {
  const expectedEffects = command === "save" ? ["edit", "save"] : ["edit"];
  const events = f.driver.report().events.filter((e) => e.runId === f.runId);
  assert.ok(
    events.some(
      (e) =>
        e.type === "verified" && e.command === command && e.outcome === kind,
    ),
    "Read-only verification must finish while paused",
  );
  assert.equal(f.settleCount(), expectedEffects.length);
  assert.deepEqual(
    f.effects,
    expectedEffects,
    "Pause cannot dispatch a later recipe step",
  );
  assert.equal(f.snapshot.paused, true);
  assert.equal(
    f.snapshot.busy,
    true,
    "Verified recipe must remain active until Resume or Stop",
  );
  assert.equal(f.snapshot.execution, "paused");
  assert.equal(
    f.settled(),
    false,
    "Recipe promise must not publish a paused terminal result",
  );
  assert.equal(
    f.ended(),
    0,
    "Per-run cleanup must wait for the explicit control decision",
  );
  assert.equal(f.driver.report({ runId: f.runId }), null);
  assert.deepEqual(f.driver.report().completedRunIds, f.previousRunIds);
  assert.deepEqual(f.snapshot.lastResult, f.previous);
  assert.deepEqual(
    f.driver.report({ runId: f.previous.runId }),
    f.previousReport,
  );
  assert.ok(
    events.every((e) => !["run_completed", "run_finished"].includes(e.type)),
  );
}

for (const [kind, command, action] of [
  ["unknown", "edit", "stop"],
  ["unknown", "edit", "resume"],
  ["unknown", "edit", "close"],
  ["validation", "edit", "resume"],
  ["recoverable_error", "edit", "resume"],
  ["success", "save", "resume"],
  ["validation", "save", "resume"],
  ["recoverable_error", "save", "resume"],
  ["unknown", "save", "resume"],
  ["success", "save", "stop"],
]) {
  test(
    `paused recipe ${kind} at ${command} awaits ${action} before finalizing`,
    { timeout: 5000 },
    async (t) => {
      const f = await fixture(t, kind, command);
      assertHeld(f, kind, command);
      const expectedEffects = [...f.effects];
      const closing = action === "close" ? f.driver.close() : null;
      if (!closing) f.driver[action]();
      const result = await f.running;
      if (closing) await closing;
      assert.equal(
        result.execution,
        action === "resume" ? "completed" : "stopped",
      );
      assert.equal(result.ok, action === "resume");
      if (action === "resume")
        assert.deepEqual(result.outcome, { kind, label: `Observed ${kind}` });
      else {
        assert.equal(result.error_code, "stopped");
        assert.equal(
          result.outcome,
          undefined,
          "Interruption cannot imply a successful application outcome",
        );
      }
      assert.equal(result.effect.status, "uncertain");
      assert.deepEqual(
        f.effects,
        expectedEffects,
        "Finalization/control must not replay or advance an effect",
      );
      assert.equal(f.ended(), 1);
      assert.deepEqual(f.driver.report().completedRunIds, [
        ...f.previousRunIds,
        f.runId,
      ]);
      assert.deepEqual(f.driver.report({ runId: f.runId }).lastResult, result);
      assert.deepEqual(
        f.driver.report({ runId: f.previous.runId }),
        f.previousReport,
      );
    },
  );
}

for (const kind of ["success", "validation", "recoverable_error", "unknown"]) {
  test(
    `paused dispatched direct command still completes ${kind} without Resume`,
    { timeout: 5000 },
    async (t) => {
      const f = await fixture(t, kind, "edit", true);
      const result = await f.running;
      assert.equal(result.execution, "completed");
      assert.deepEqual(result.outcome, { kind, label: `Observed ${kind}` });
      assert.equal(result.effect.status, "uncertain");
      assert.equal(f.ended(), 1);
      assert.deepEqual(f.effects, ["edit"]);
      const snapshot = await f.driver.snapshot();
      assert.equal(snapshot.paused, true);
      assert.equal(snapshot.busy, false);
      assert.equal(snapshot.execution, "paused");
      assert.deepEqual(
        f.driver.report({ runId: result.runId }).lastResult,
        result,
      );
    },
  );
}
