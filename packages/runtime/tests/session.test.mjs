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
test("unexpected adapter errors give safe guidance without inventing saved diagnostics", async () => {
  for (const afterEffect of [false, true]) {
    let f;
    f = await fixture({
      handlers: {
        edit: async () => {},
        save: async (_params, execution) => {
          if (afterEffect)
            await execution.effect(() => {
              f.facts.saved = true;
            });
          throw Error("PRIVATE_ADAPTER_DETAIL");
        },
      },
    });
    try {
      const snapshot = await f.driver.snapshot();
      const result = await f.driver.execute("save", {}, snapshot.revision);
      assert.equal(result.error_code, "adapter_error");
      assert.equal(result.execution, afterEffect ? "failed" : "rejected");
      assert.equal(
        result.effect.status,
        afterEffect ? "uncertain" : "not_attempted",
      );
      assert.doesNotMatch(
        JSON.stringify(f.driver.report()),
        /PRIVATE_ADAPTER_DETAIL/,
      );
      assert.match(result.error, /Review the integration/);
      assert.doesNotMatch(result.error, /diagnostics|logs/);
    } finally {
      await f.driver.close();
    }
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

test("pause verifies a dispatched recipe step and guards its next step before resume", async () => {
  let f,
    entered,
    release,
    effects = 0;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  f = await fixture({
    handlers: {
      edit: async ({ text }, x) =>
        x.effect(async () => {
          effects++;
          f.facts.text = text;
          entered();
          await gate;
        }),
      save: async (_, x) =>
        x.effect(() => {
          effects++;
          f.facts.saved = true;
        }),
    },
  });
  let running;
  try {
    const before = await f.driver.snapshot();
    running = f.driver.runRecipe("sample", before.revision);
    await ready;
    f.driver.pause();
    release();
    const end = Date.now() + 1000;
    while (
      !f.driver.report().events.some((e) => e.type === "verified") &&
      Date.now() < end
    )
      await pause(10);
    assert.equal(
      f.driver.report().events.filter((e) => e.type === "verified").length,
      1,
      "Read-only verification must finish without Resume",
    );
    assert.equal(effects, 1);
    assert.equal((await f.driver.snapshot()).paused, true);
    f.facts.text = "Human edit while paused";
    f.driver.resume();
    const result = await running;
    assert.equal(result.error_code, "stale_observation");
    assert.equal(
      effects,
      1,
      "The next recipe effect still requires the verified revision",
    );
    assert.equal(f.facts.text, "Human edit while paused");
  } finally {
    release();
    f.driver.stop();
    await running;
    await f.driver.close();
  }
});
