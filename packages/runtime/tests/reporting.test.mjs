import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createDriverSession } from "../src/session.mjs";

const enginePath = fileURLToPath(new URL("./fake-engine.mjs", import.meta.url));
async function fixture(t, { effect, identity = {}, repetitions = 1 } = {}) {
  const facts = { text: "original", saved: false };
  let effects = 0;
  const driver = await createDriverSession({
    page: { isClosed: () => false },
    enginePath,
    identity,
    adapter: {
      model: { id: "test", version: "1" },
      observe: async () => ({ connected: true, session: "alpha", facts }),
      effectStatus: () => effect,
      handlers: {
        edit: async (params, x) =>
          x.effect(() => {
            facts.text = params.text;
            facts.saved = false;
            effects++;
          }),
        save: async (_, x) => {
          for (let i = 0; i < repetitions; i++)
            await x.effect(() => {
              facts.saved = true;
              effects++;
            });
        },
      },
    },
  });
  t.after(() => driver.close());
  const command = async (id = "save", params = {}) =>
    driver.execute(id, params, (await driver.snapshot()).revision);
  return { driver, facts, command, effects: () => effects };
}

for (const targetStatus of ["not_attempted", "uncertain"])
  test(`recipe reports saved setup separately from ${targetStatus} target`, async (t) => {
    const operations = [
      { id: "setup-1", label: "Setup record", status: "saved" },
      { id: "target-1", label: "Target edit", status: targetStatus },
    ];
    const f = await fixture(t, {
      effect: { status: targetStatus, operations },
    });
    const result = await f.driver.runRecipe(
      "sample",
      (await f.driver.snapshot()).revision,
    );
    assert.deepEqual(result.effect.operations, operations);
    assert.equal(result.command, "sample");
    assert.equal(result.recipe, true);
    assert.ok(Number.isFinite(Date.parse(result.startedAt)));
    assert.ok(Date.parse(result.finishedAt) >= Date.parse(result.startedAt));
  });

test("a prior successful save cannot give a stale rejected run operation evidence", async (t) => {
  const f = await fixture(t, {
    effect: {
      status: "saved",
      operations: [{ id: "write-1", label: "Note", status: "saved" }],
    },
  });
  assert.equal((await f.command()).effect.status, "saved");
  const revision = (await f.driver.snapshot()).revision;
  const count = f.effects();
  f.facts.text = "Human changed draft";
  const rejected = await f.driver.execute("save", {}, revision);
  assert.equal(rejected.execution, "rejected");
  assert.deepEqual(rejected.effect, { status: "not_attempted" });
  assert.equal(f.effects(), count);
});

test("effect reports retain only bounded public operation fields", async (t) => {
  const privateValue = "private-session-cookie-and-payload";
  const operations = [
    {
      id: "write-1",
      label: "Note save",
      status: "saved",
      operationKey: privateValue,
      payload: { notes: privateValue },
    },
  ];
  const f = await fixture(t, {
    effect: { status: "saved", operations, cookie: privateValue },
  });
  const result = await f.command("edit", { text: privateValue });
  assert.deepEqual(result.effect, {
    status: "saved",
    operations: [{ id: "write-1", label: "Note save", status: "saved" }],
  });
  assert.doesNotMatch(
    JSON.stringify(f.driver.report({ runId: result.runId })),
    new RegExp(privateValue),
  );
  operations[0].label = "Changed after return";
  assert.equal(result.effect.operations[0].label, "Note save");
});

for (const [name, operations] of [
  ["missing label", [{ id: "write-1", status: "saved" }]],
  ["invalid status", [{ id: "write-1", label: "Note", status: "success" }]],
  [
    "raw URL identifier",
    [{ id: "https://private.example/request", label: "Note", status: "saved" }],
  ],
  [
    "oversized identifier",
    [{ id: "x".repeat(65), label: "Note", status: "saved" }],
  ],
  [
    "oversized label",
    [{ id: "write-1", label: "x".repeat(121), status: "saved" }],
  ],
  [
    "control character",
    [{ id: "write-1", label: "Note\ncookie", status: "saved" }],
  ],
  [
    "duplicate operation",
    [
      { id: "write-1", label: "Note", status: "saved" },
      { id: "write-1", label: "Other note", status: "uncertain" },
    ],
  ],
  [
    "more than sixteen operations",
    Array.from({ length: 17 }, (_, i) => ({
      id: `write-${i}`,
      label: "Note",
      status: "saved",
    })),
  ],
  ["non-array operations", { saved: true }],
])
  test(`malformed ${name} cannot retain a successful effect status`, async (t) => {
    const f = await fixture(t, { effect: { status: "saved", operations } });
    assert.deepEqual((await f.command()).effect, { status: "uncertain" });
  });

test("completed reports keep command, identity, resources, and event boundaries from their own run", async (t) => {
  const identity = { app: { revision: "first" } };
  const f = await fixture(t, { identity, effect: { status: "saved" } });
  const first = await f.command();
  const frozen = structuredClone(f.driver.report({ runId: first.runId }));
  assert.equal(frozen.lastResult.command, "save");
  assert.equal(frozen.lastResult.recipe, false);
  assert.equal(frozen.events[0].type, "run_started");
  assert.equal(frozen.events.at(-1).type, "run_completed");
  assert.ok(frozen.events.every((event) => event.runId === first.runId));
  assert.deepEqual(frozen.eventRange, {
    first: frozen.events[0].sequence,
    last: frozen.events.at(-1).sequence,
    retainedFirst: frozen.events[0].sequence,
    truncated: false,
  });
  identity.app.revision = "external mutation";
  const returned = f.driver.report({ runId: first.runId });
  returned.lastResult.effect.status = "uncertain";
  returned.identity.app.revision = "caller mutation";
  returned.events.length = 0;
  await f.command("edit", { text: "later draft" });
  f.driver.pause();
  assert.deepEqual(f.driver.report({ runId: first.runId }), frozen);
  assert.equal(f.driver.report({ runId: "unavailable" }), null);
});

test("completed run history and long run events stay bounded with explicit truncation", async (t) => {
  const f = await fixture(t, { effect: { status: "saved" }, repetitions: 105 });
  const long = await f.command();
  const report = f.driver.report({ runId: long.runId });
  assert.equal(report.events.length, 200);
  assert.ok(
    report.eventRange,
    "Long completed reports must disclose event truncation",
  );
  assert.equal(report.eventRange.truncated, true);
  assert.ok(report.eventRange.retainedFirst > report.eventRange.first);
  for (let i = 0; i < 16; i++) await f.command("edit", { text: `draft-${i}` });
  assert.equal(f.driver.report({ runId: long.runId }), null);
  assert.equal(f.driver.report().completedRunIds.length, 16);
});
