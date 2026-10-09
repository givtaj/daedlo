import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createDriverSession } from "../src/session.mjs";
import { createResourceScope } from "../src/resources.mjs";

const enginePath = fileURLToPath(new URL("./fake-engine.mjs", import.meta.url));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = (holdMs = 10000, manual = true) => ({
  id: "walkthrough",
  title: "Edit and save",
  explanation: "Watch real behavior",
  recipe: "sample",
  stages: [
    {
      title: "Draft",
      explanation: "Inspect the draft before saving",
      holdMs,
      manual,
    },
    { title: "Saved", explanation: "Inspect the model outcome", holdMs: 0 },
  ],
});
async function fixture(t, presentations = [profile()], failSave = false) {
  const facts = { text: "original", saved: false };
  let observeHook = async () => {};
  let connected = true,
    session = "alpha",
    effects = 0,
    pageClosed = false;
  const resources = createResourceScope();
  const page = resources.attach(
    { isClosed: () => pageClosed },
    {
      label: "supplied page",
      close: () => {
        pageClosed = true;
      },
    },
  );
  const driver = await createDriverSession({
    page,
    context: {},
    enginePath,
    resources,
    presentations,
    adapter: {
      model: { id: "test", version: "1" },
      observe: async () => {
        await observeHook();
        return { connected, session, facts: { ...facts } };
      },
      handlers: {
        edit: async (p, x) =>
          x.effect(() => {
            facts.text = p.text;
            effects++;
          }),
        save: async (_, x) =>
          x.effect(() => {
            facts.saved = !failSave;
            effects++;
          }),
      },
    },
  });
  t.after(() => driver.close());
  return {
    driver,
    setObserveHook: (hook) => {
      observeHook = hook;
    },
    facts,
    page,
    resources,
    effects: () => effects,
    disconnect: () => {
      connected = false;
    },
    switchSession: () => {
      session = "beta";
    },
  };
}
async function holding(driver, stage = 1) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const s = await driver.snapshot();
    if (s.presentation?.phase === "holding" && s.presentation.stage === stage)
      return s;
    await delay(10);
  }
  assert.fail("Presentation did not reach the requested holding stage");
}
async function begin(f) {
  const s = await f.driver.snapshot();
  assert.deepEqual(
    s.presentations.map(({ id, enabled }) => ({ id, enabled })),
    [{ id: "walkthrough", enabled: true }],
  );
  return { run: f.driver.startPresentation("walkthrough", s.revision) };
}

test("configured presentation is advertised without navigating or executing", async (t) => {
  const f = await fixture(t);
  const s = await f.driver.snapshot();
  assert.deepEqual(s.presentations, [
    {
      id: "walkthrough",
      title: "Edit and save",
      explanation: "Watch real behavior",
      enabled: true,
    },
  ]);
  assert.equal(s.presentation, null);
  assert.equal(f.effects(), 0);
  assert.equal(f.facts.text, "original");
});
test("invalid or mismatched stage plans fail closed at setup", async (t) => {
  for (const bad of [
    { ...profile(), stages: [] },
    { ...profile(), recipe: "missing" },
    { ...profile(), stages: [{ title: "Wrong", holdMs: -1 }, {}] },
    { ...profile(), command: "save" },
    {
      ...profile(),
      stages: [
        { title: "Draft", holdMs: 1, command: "save" },
        { title: "Saved" },
      ],
    },
  ])
    await assert.rejects(fixture(t, [bad]), /presentation/i);
});
test("manual advance is scoped to one hold; pause freezes time; speed does not remove holds", async (t) => {
  const f = await fixture(t, [profile(400, false)]);
  f.driver.setSpeed("fast");
  const { run } = await begin(f);
  const s = await holding(f.driver);
  assert.equal(f.effects(), 1);
  f.driver.pause();
  const remaining = (await f.driver.snapshot()).presentation.remainingMs;
  assert.equal(f.driver.advancePresentation(s.presentation.stageId).ok, false);
  await delay(500);
  assert.equal(f.effects(), 1);
  assert.ok(
    Math.abs((await f.driver.snapshot()).presentation.remainingMs - remaining) <
      60,
  );
  f.driver.resume();
  assert.equal(f.driver.advancePresentation(s.presentation.stageId).ok, true);
  assert.equal(f.driver.advancePresentation(s.presentation.stageId).ok, false);
  const result = await run;
  assert.equal(result.execution, "completed");
  assert.equal(result.outcome.kind, "success");
  assert.equal(result.presentation.status, "completed");
  assert.equal(f.effects(), 2);
  assert.equal(
    f.driver.report({ runId: result.runId }).lastResult.presentation.status,
    "completed",
  );
});
test("timed holds actually delay the next effect independently of fast speed", async (t) => {
  const f = await fixture(t, [profile(300, false)]);
  f.driver.setSpeed("fast");
  const { run } = await begin(f);
  await holding(f.driver);
  const started = performance.now();
  await delay(80);
  assert.equal(f.effects(), 1);
  await run;
  assert.ok(performance.now() - started >= 200);
});
for (const action of ["draft", "session", "disconnect"]) {
  test(`a ${action} change during a hold halts without replay or draft overwrite`, async (t) => {
    const f = await fixture(t);
    const { run } = await begin(f);
    const s = await holding(f.driver);
    if (action === "draft") f.facts.text = "human input";
    if (action === "session") f.switchSession();
    if (action === "disconnect") f.disconnect();
    f.driver.advancePresentation(s.presentation.stageId);
    const r = await run;
    assert.equal(r.execution, "failed");
    assert.equal(
      r.error_code,
      {
        draft: "stale_observation",
        session: "session_changed",
        disconnect: "disconnected",
      }[action],
    );
    assert.equal(r.presentation.status, "halted");
    assert.equal(f.effects(), 1);
    if (action === "draft") assert.equal(f.facts.text, "human input");
  });
}
test("external changes halt even during a manually paused hold", async (t) => {
  const f = await fixture(t);
  const { run } = await begin(f);
  await holding(f.driver);
  f.driver.pause();
  f.facts.text = "external";
  const r = await Promise.race([
    run,
    delay(1500).then(() =>
      assert.fail("Hold failed to observe external change"),
    ),
  ]);
  assert.equal(r.error_code, "stale_observation");
  assert.equal(f.effects(), 1);
});
test("stop and close promptly interrupt a hold and preserve supplied resources", async (t) => {
  for (const control of ["stop", "close"]) {
    const f = await fixture(t);
    const { run } = await begin(f);
    await holding(f.driver);
    const started = performance.now();
    await f.driver[control]();
    const r = await run;
    assert.ok(performance.now() - started < 1000);
    assert.equal(r.execution, "stopped");
    assert.equal(r.presentation.status, "stopped");
    assert.equal(f.effects(), 1);
    assert.equal(f.page.isClosed(), false);
  }
});
test("application non-success halts presentation while keeping outcome distinct", async (t) => {
  const f = await fixture(t, [profile(0, false)], true);
  const { run } = await begin(f);
  const r = await run;
  assert.equal(r.execution, "completed");
  assert.equal(r.outcome.kind, "recoverable_error");
  assert.equal(r.presentation.status, "halted");
  assert.match(r.presentation.reason, /Observed/);
});
test("ordinary commands and recipes ignore presentation holds and reject competing runs", async (t) => {
  const f = await fixture(t);
  const { run } = await begin(f);
  await holding(f.driver);
  assert.equal(
    (await f.driver.execute("save", {}, (await f.driver.snapshot()).revision))
      .error_code,
    "busy",
  );
  f.driver.stop();
  await run;
  const s = await f.driver.snapshot();
  const r = await f.driver.runRecipe("sample", s.revision);
  assert.equal(r.execution, "completed");
  assert.equal(r.presentation, undefined);
  assert.equal((await f.driver.snapshot()).presentation, null);
});

for (const control of ["stop", "pause", "close"]) {
  test(`${control} during a pending final hold observation cannot complete the presentation`, async (t) => {
    const f = await fixture(t, [
      {
        id: "walkthrough",
        title: "Save",
        command: "save",
        stages: [{ title: "Saved", holdMs: 0 }],
      },
    ]);
    let entered,
      release,
      gated = false,
      holdReads = 0;
    const waiting = new Promise((resolve) => {
      entered = resolve;
    });
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    t.after(() => release());
    f.setObserveHook(async () => {
      if (
        !gated &&
        f.driver.report().events.some((e) => e.type === "presentation_hold") &&
        ++holdReads >= (control === "pause" ? 2 : 1)
      ) {
        gated = true;
        entered();
        await gate;
      }
    });
    const { run } = await begin(f);
    await waiting;
    if (control === "stop") f.driver.pause();
    const action = f.driver[control]();
    if (control === "pause") {
      release();
      await delay(150);
      assert.equal((await f.driver.snapshot()).busy, true);
      assert.equal((await f.driver.snapshot()).presentation.phase, "holding");
      f.driver.resume();
      assert.equal((await run).presentation.status, "completed");
    } else {
      let timer;
      try {
        const r = await Promise.race([
          run,
          new Promise((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  Error("Stop must interrupt an unresolved hold observation"),
                ),
              500,
            );
          }),
        ]);
        assert.equal(r.execution, "stopped");
        assert.equal(r.presentation.status, "stopped");
        await action;
        assert.equal(f.page.isClosed(), false);
      } finally {
        clearTimeout(timer);
        release();
      }
    }
  });
}

test("pause time is excluded even when pause and resume occur inside one slow observation", async (t) => {
  const f = await fixture(t, [profile(400, false)]);
  let entered,
    release,
    gated = false;
  const waiting = new Promise((resolve) => {
    entered = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  t.after(() => release());
  f.setObserveHook(async () => {
    if (
      !gated &&
      f.driver.report().events.some((e) => e.type === "presentation_hold")
    ) {
      gated = true;
      entered();
      await gate;
    }
  });
  const { run } = await begin(f);
  await waiting;
  f.driver.pause();
  await delay(500);
  f.driver.resume();
  release();
  await delay(100);
  assert.equal(f.effects(), 1, "Presenter-paused time must not drain the hold");
  assert.equal((await run).execution, "completed");
});
