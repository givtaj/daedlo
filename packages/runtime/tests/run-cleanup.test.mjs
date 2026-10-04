import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createDriverSession } from "../src/session.mjs";

const enginePath = fileURLToPath(new URL("./fake-engine.mjs", import.meta.url));

async function fixture(t, behavior = "stop") {
  const facts = { text: "original", saved: false };
  let ownedFault = false,
    cleanupCalls = 0,
    writes = 0,
    driver;
  const adapter = {
    model: { id: "test", version: "1" },
    observe: async () => ({ connected: true, session: "alpha", facts }),
    handlers: {
      edit: async () => {},
      save: async (_, x) => {
        await x.effect(() => {
          ownedFault = true;
          writes++;
          facts.saved = true;
        });
        if (behavior === "stop") driver.stop();
        else if (behavior === "fail") throw Error("Private fixture failure");
      },
    },
    effectStatus: () => ({
      status: "uncertain",
      operations: [
        { id: "setup", label: "Setup entry", status: "saved" },
        { id: "target", label: "Requested edit", status: "uncertain" },
      ],
    }),
    endRun: async (info) => {
      assert.equal(info.command, "save");
      assert.equal(info.recipe, false);
      assert.equal(typeof info.runId, "string");
      cleanupCalls++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (behavior === "cleanup-failure")
        throw Error("Private cookie and route payload");
      ownedFault = false;
    },
  };
  driver = await createDriverSession({
    page: { isClosed: () => false },
    enginePath,
    adapter,
  });
  t.after(() => driver.close());
  return {
    driver,
    adapter,
    facts,
    owned: () => ownedFault,
    cleanupCalls: () => cleanupCalls,
    writes: () => writes,
  };
}

for (const behavior of ["stop", "fail", "complete"])
  test(`${behavior} awaits owned transient cleanup before capturing the completed report`, async (t) => {
    const f = await fixture(t, behavior);
    const result = await f.driver.execute(
      "save",
      {},
      (await f.driver.snapshot()).revision,
    );
    assert.equal(
      f.owned(),
      false,
      "Owned fault must be removed before the run returns",
    );
    assert.equal(f.cleanupCalls(), 1);
    assert.equal(f.writes(), 1, "Cleanup must never replay the write");
    assert.equal(
      result.execution,
      { stop: "stopped", fail: "failed", complete: "completed" }[behavior],
    );
    assert.equal(result.effect.status, "uncertain");
    assert.equal(result.cleanupFailed, undefined);
    assert.deepEqual(
      f.driver.report({ runId: result.runId }).lastResult,
      result,
    );
  });

test("initial rejection still finalizes the active adapter run without attempting an effect", async (t) => {
  const f = await fixture(t);
  const revision = (await f.driver.snapshot()).revision;
  f.facts.text = "Human edit";
  const result = await f.driver.execute("save", {}, revision);
  assert.equal(
    f.cleanupCalls(),
    1,
    "Rejected active runs must release per-run resources",
  );
  assert.equal(f.writes(), 0);
  assert.equal(result.execution, "rejected");
  assert.deepEqual(result.effect, { status: "not_attempted" });
});

test("failed cleanup retains truthful effect evidence and exposes only a safe cleanup marker", async (t) => {
  const f = await fixture(t, "cleanup-failure");
  const result = await f.driver.execute(
    "save",
    {},
    (await f.driver.snapshot()).revision,
  );
  assert.equal(
    result.cleanupFailed,
    true,
    "Failed owned cleanup cannot disappear from the result",
  );
  assert.equal(result.ok, false);
  assert.equal(result.execution, "completed");
  assert.equal(result.effect.status, "uncertain");
  assert.equal(f.owned(), true);
  assert.deepEqual(result.cleanupError, {
    error_code: "cleanup_incomplete",
    error: "Owned transient cleanup is incomplete.",
  });
  const report = f.driver.report({ runId: result.runId });
  assert.deepEqual(report.lastResult, result);
  assert.equal(report.events.at(-1).type, "cleanup_failed");
  assert.doesNotMatch(JSON.stringify(report), /Private cookie|route payload/);
  assert.equal((await f.driver.snapshot()).busy, false);
});
