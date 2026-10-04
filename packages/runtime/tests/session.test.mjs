import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDriverSession } from "../src/session.mjs";
const enginePath = fileURLToPath(new URL("./fake-engine.mjs", import.meta.url));
chmodSync(enginePath, 0o755);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function fixture(extra = {}) {
  let facts = { text: "original", saved: false },
    session = "alpha",
    calls = 0;
  const page = { isClosed: () => false };
  const adapter = {
    model: { id: "test", version: "1" },
    observe: async () => ({ connected: true, session, facts: { ...facts } }),
    handlers: {
      edit: async (p, x) => {
        await x.effect(() => {
          facts.text = p.text;
          facts.saved = false;
          calls++;
        });
      },
      save: async (p, x) => {
        await x.effect(() => {
          facts.saved = true;
          calls++;
        });
      },
    },
    ...extra,
  };
  const driver = await createDriverSession({
    page,
    context: {},
    enginePath,
    adapter,
  });
  return {
    driver,
    adapter,
    facts,
    setSession: (v) => (session = v),
    calls: () => calls,
  };
}
test("attach preserves input; stale edits and account switches cause no effects", async () => {
  const f = await fixture();
  try {
    const s = await f.driver.snapshot();
    assert.equal(f.facts.text, "original");
    assert.match(s.identity.runtimeBuild, /^[a-f0-9]{64}$/);
    assert.match(s.identity.engineSha256, /^[a-f0-9]{64}$/);
    assert.equal(f.calls(), 0);
    f.facts.text = "human edit";
    const r = await f.driver.execute("save", {}, s.revision);
    assert.equal(r.execution, "rejected");
    assert.equal(f.calls(), 0);
    assert.equal(f.facts.text, "human edit");
    const next = await f.driver.snapshot();
    f.setSession("beta");
    assert.equal(
      (await f.driver.execute("save", {}, next.revision)).execution,
      "rejected",
    );
    assert.equal(f.calls(), 0);
  } finally {
    await f.driver.close();
  }
});
test("parameters and handler coverage fail before effects", async () => {
  await assert.rejects(fixture({ handlers: {} }), /handler/i);
  const f = await fixture();
  try {
    const s = await f.driver.snapshot();
    const r = await f.driver.execute(
      "edit",
      { text: "x", extra: 1 },
      s.revision,
    );
    assert.equal(r.execution, "rejected");
    assert.equal(f.calls(), 0);
  } finally {
    await f.driver.close();
  }
});
test("single execution, cooperative pause/stop, and stop reports a completed effect", async () => {
  let f, entered;
  const ready = new Promise((r) => (entered = r));
  f = await fixture({
    handlers: {
      edit: async () => {},
      save: async (p, x) => {
        await x.effect(() => {
          f.facts.saved = true;
        });
        entered();
        await pause(60);
        await x.boundary();
      },
    },
    effectStatus: () => ({ status: f.facts.saved ? "saved" : "not_attempted" }),
  });
  try {
    const s = await f.driver.snapshot();
    const run = f.driver.execute("save", {}, s.revision);
    await ready;
    assert.equal(
      (await f.driver.execute("save", {}, s.revision)).execution,
      "rejected",
    );
    f.driver.stop();
    const result = await run;
    assert.equal(result.execution, "stopped");
    assert.equal(result.effect.status, "saved");
    assert.equal((await f.driver.snapshot()).busy, false);
  } finally {
    await f.driver.close();
  }
});
test("a paused multi-action handler rechecks intervening input before resuming", async () => {
  let f, entered;
  const ready = new Promise((r) => (entered = r));
  let effects = 0;
  f = await fixture({
    handlers: {
      edit: async () => {},
      save: async (p, x) => {
        await x.effect(() => effects++);
        f.driver.pause();
        entered();
        await x.effect(() => effects++);
      },
    },
  });
  try {
    const s = await f.driver.snapshot();
    const run = f.driver.execute("save", {}, s.revision);
    await ready;
    f.facts.text = "intervening";
    f.driver.resume();
    const r = await run;
    assert.notEqual(r.execution, "completed");
    assert.equal(effects, 1);
    assert.equal(f.facts.text, "intervening");
  } finally {
    await f.driver.close();
  }
});
test("recipe runs canonical steps and observe/reconnect never replays", async () => {
  const f = await fixture();
  try {
    const s = await f.driver.snapshot();
    assert.equal(
      (await f.driver.runRecipe("sample", s.revision)).execution,
      "completed",
    );
    assert.equal(f.calls(), 2);
    await f.driver.snapshot();
    await f.driver.snapshot();
    assert.equal(f.calls(), 2);
  } finally {
    await f.driver.close();
  }
});
