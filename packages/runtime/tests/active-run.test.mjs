import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createDriverSession } from "../src/session.mjs";

const enginePath = fileURLToPath(new URL("./fake-engine.mjs", import.meta.url));

function gate() {
  let arrive, release;
  const entered = new Promise((resolve) => (arrive = resolve));
  const waiting = new Promise((resolve) => (release = resolve));
  return {
    entered,
    release,
    hold() {
      arrive();
      return waiting;
    },
  };
}

async function fixture(t) {
  const begin = gate(),
    handler = gate(),
    end = gate();
  const facts = { text: "original", saved: false };
  let observationFailed = false,
    cleanupFailed = false;
  const driver = await createDriverSession({
    page: { isClosed: () => false },
    enginePath,
    adapter: {
      model: { id: "test", version: "1" },
      observe: async () => {
        if (observationFailed) throw Error("Private observation detail");
        return { connected: true, session: "alpha", facts };
      },
      beginRun: () => begin.hold(),
      handlers: {
        edit: async (params, context) => {
          await handler.hold();
          await context.effect(() => {
            facts.text = params.text;
          });
        },
        save: async (_, context) => {
          await context.effect(() => {
            facts.saved = true;
          });
        },
      },
      endRun: async () => {
        await end.hold();
        if (cleanupFailed) throw Error("Private cleanup detail");
      },
    },
  });
  driver.setSpeed("fast");
  t.after(async () => {
    begin.release();
    handler.release();
    end.release();
    await driver.close();
  });
  return {
    driver,
    begin,
    handler,
    end,
    failObservation(value) {
      observationFailed = value;
    },
    failCleanup() {
      cleanupFailed = true;
    },
  };
}

for (const recipe of [false, true]) {
  test(`${recipe ? "recipe" : "command"} identity remains detached and attributable through startup, effects and cleanup`, async (t) => {
    const f = await fixture(t);
    const command = recipe ? "sample" : "edit";
    const expected = { command, recipe };
    const revision = (await f.driver.snapshot()).revision;
    const run = recipe
      ? f.driver.runRecipe(command, revision)
      : f.driver.execute(command, { text: "private-command-input" }, revision);
    await f.begin.entered;
    const beginning = await f.driver.snapshot();
    assert.deepEqual(
      beginning.activeRun,
      expected,
      "A viewer joining during beginRun must identify the active authored flow",
    );
    assert.equal(beginning.busy, true);
    assert.equal(beginning.lastResult, null);
    assert.doesNotMatch(
      JSON.stringify(beginning.activeRun),
      /private-command-input/,
    );

    beginning.activeRun.command = "caller-mutation";
    const snapshots = await Promise.all([
      f.driver.snapshot(),
      f.driver.snapshot(),
    ]);
    for (const snapshot of snapshots) {
      assert.deepEqual(snapshot.activeRun, expected);
      assert.equal(snapshot.runId, beginning.runId);
    }
    const refused = await f.driver.execute("save", {}, revision);
    assert.equal(refused.error_code, "busy");
    assert.deepEqual(
      (await f.driver.snapshot()).activeRun,
      expected,
      "A refused competing command cannot replace the active flow",
    );

    f.begin.release();
    await f.handler.entered;
    const executing = await f.driver.snapshot();
    assert.deepEqual(executing.activeRun, expected);
    assert.equal(executing.progress.lastAction, "edit");
    f.failObservation(true);
    const unavailable = await f.driver.snapshot();
    assert.equal(unavailable.connected, false);
    assert.deepEqual(
      unavailable.activeRun,
      expected,
      "Observation failure must not erase run ownership",
    );
    f.failObservation(false);

    f.handler.release();
    await f.end.entered;
    const finalizing = await f.driver.snapshot();
    assert.equal(finalizing.busy, true);
    assert.deepEqual(
      finalizing.activeRun,
      expected,
      "The active flow remains identifiable until cleanup has completed",
    );
    assert.equal(finalizing.lastResult.runId, beginning.runId);
    f.end.release();
    const result = await run;
    assert.equal(result.execution, "completed");
    const finished = await f.driver.snapshot();
    assert.equal(finished.busy, false);
    assert.equal(finished.activeRun, null);
    assert.equal(finished.lastResult.command, command);
    assert.equal(finished.lastResult.recipe, recipe);
  });
}

for (const recipe of [false, true]) {
  test(`unknown ${recipe ? "recipe" : "command"} input is never published as an active flow ID`, async (t) => {
    const f = await fixture(t);
    const revision = (await f.driver.snapshot()).revision;
    const run = recipe
      ? f.driver.runRecipe("private-unknown-input", revision)
      : f.driver.execute("private-unknown-input", {}, revision);
    await f.begin.entered;
    const snapshot = await f.driver.snapshot();
    assert.deepEqual(snapshot.activeRun, { command: null, recipe });
    assert.doesNotMatch(
      JSON.stringify(snapshot.activeRun),
      /private-unknown-input/,
    );
    f.begin.release();
    await f.end.entered;
    assert.deepEqual((await f.driver.snapshot()).activeRun, {
      command: null,
      recipe,
    });
    f.end.release();
    assert.equal((await run).execution, "rejected");
    assert.equal((await f.driver.snapshot()).activeRun, null);
  });
}

test("idle refusals never create active flow metadata and failed cleanup clears it only when final", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.driver.snapshot()).activeRun, null);
  assert.equal(
    (await f.driver.execute("save", {}, "")).error_code,
    "revision_required",
  );
  assert.equal((await f.driver.snapshot()).activeRun, null);
  f.driver.pause();
  const revision = (await f.driver.snapshot()).revision;
  assert.equal(
    (await f.driver.execute("save", {}, revision)).error_code,
    "paused",
  );
  assert.equal((await f.driver.snapshot()).activeRun, null);
  f.driver.resume();

  f.failCleanup();
  const run = f.driver.execute("save", {}, revision);
  f.begin.release();
  await f.end.entered;
  assert.deepEqual((await f.driver.snapshot()).activeRun, {
    command: "save",
    recipe: false,
  });
  f.end.release();
  const result = await run;
  assert.equal(result.cleanupFailed, true);
  assert.equal(result.execution, "completed");
  assert.equal((await f.driver.snapshot()).activeRun, null);
});
