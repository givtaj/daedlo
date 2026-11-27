import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  createKnowledge,
  KNOWLEDGE_SCHEMA,
} from "../packages/universal/src/knowledge.mjs";

function fixture(t, realEvidence = false) {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "PRAGMA foreign_keys=ON; CREATE TABLE targets(id TEXT PRIMARY KEY) STRICT; INSERT INTO targets VALUES('a'),('b');" +
      KNOWLEDGE_SCHEMA,
  );
  t.after(() => db.close());
  const target = {
    id: "a",
    revision: 1,
    configSha256: "a".repeat(64),
    sourceSha256: "b".repeat(64),
    model: { id: "fixture", version: "1" },
  };
  const run = {
    targetId: "a",
    runId: "run-a",
    status: "finished",
    historyComplete: true,
    events: [
      {
        sequence: 1,
        eventId: "event-1",
        type: "run_started",
        payload: {
          installation: {
            id: "installation",
            version: "fixture.1",
            model: target.model,
            sourceSha256: target.sourceSha256,
          },
        },
      },
      {
        sequence: 2,
        eventId: "event-2",
        type: "run_finished",
        payload: {
          report: {
            lastResult: { execution: "completed", effect: { status: "saved" } },
          },
        },
      },
    ],
  };
  const targets = new Map([
    ["a", target],
    ["b", { ...target, id: "b" }],
  ]);
  const getTarget = async (id) => {
    if (!targets.has(id))
      throw Object.assign(Error(), { code: "target_not_found" });
    return structuredClone(targets.get(id));
  };
  let integrity = "available",
    inspectionHook;
  const evidence = {
    id: "evidence-a",
    targetId: "a",
    runId: "run-a",
    eventSequence: 2,
    bytes: 3,
    sha256: "c".repeat(64),
    mimeType: "text/plain",
  };
  const api = createKnowledge({
    root: "/unused-fixture",
    catalogId: randomUUID(),
    assertV2() {},
    getTarget,
    targetIn: (_, id) => {
      if (!targets.has(id))
        throw Object.assign(Error(), { code: "target_not_found" });
      return structuredClone(targets.get(id));
    },
    async getRun({ targetId, runId }) {
      if (targetId !== "a" || runId !== "run-a")
        throw Object.assign(Error(), { code: "run_not_found" });
      return structuredClone(run);
    },
    async getEvidence({ targetId, evidenceId }) {
      if (targetId !== "a" || evidenceId !== "evidence-a")
        throw Object.assign(Error(), { code: "evidence_not_found" });
      return structuredClone(evidence);
    },
    ...(realEvidence
      ? {}
      : {
          async inspectEvidence() {
            if (inspectionHook) {
              const hook = inspectionHook;
              inspectionHook = undefined;
              await hook();
            }
            return { ...evidence, integrity };
          },
        }),
    async use(readonly, operation) {
      db.exec(readonly ? "BEGIN" : "BEGIN IMMEDIATE");
      try {
        const value = operation(db);
        db.exec("COMMIT");
        return value;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  });
  const create = (extra) =>
    api.createRecord({
      targetId: "a",
      kind: "knowledge",
      title: "Verified save behavior",
      body: "The synthetic saved result was observed.",
      refs: [{ runId: "run-a", eventSequence: 2, evidenceId: "evidence-a" }],
      expectedTargetRevision: targets.get("a").revision,
      ...extra,
    });
  return {
    api,
    create,
    targets,
    run,
    onInspect(hook) {
      inspectionHook = hook;
    },
    setIntegrity(value) {
      integrity = value;
    },
  };
}

test("manual knowledge remains proposed until explicit review and accepted summary retains provenance", async (t) => {
  const f = fixture(t),
    record = await f.create();
  assert.equal(record?.state, "proposed");
  assert.equal(
    (await f.api.getTargetSummary({ targetId: "a" })).items.length,
    0,
  );
  const accepted = await f.api.reviewRecord({
    targetId: "a",
    recordId: record.id,
    expectedRevision: 1,
    expectedTargetRevision: 1,
    decision: "accepted",
    note: "Inspected synthetic evidence",
  });
  assert.equal(accepted.state, "accepted");
  const summary = await f.api.getTargetSummary({ targetId: "a" });
  assert.equal(summary.items[0].id, record.id);
  assert.equal(summary.items[0].refs[0].runId, "run-a");
  assert.equal(summary.items[0].integration.model.version, "1");
});

test("references cannot cross targets or invent run events", async (t) => {
  const f = fixture(t);
  await assert.rejects(f.create({ targetId: "b" }), {
    code: "knowledge_reference",
  });
  await assert.rejects(
    f.create({ refs: [{ runId: "run-a", eventSequence: 99 }] }),
    { code: "knowledge_reference" },
  );
  await assert.rejects(
    f.create({ refs: [{ runId: "run-a", evidenceId: "other-target" }] }),
    { code: "knowledge_reference" },
  );
});

test("target revision changes invalidate old acceptance without deleting its history", async (t) => {
  const f = fixture(t),
    record = await f.create();
  await f.api.reviewRecord({
    targetId: "a",
    recordId: record.id,
    expectedRevision: 1,
    expectedTargetRevision: 1,
    decision: "accepted",
  });
  f.targets.get("a").revision = 2;
  f.targets.get("a").model = { id: "fixture", version: "2" };
  const old = await f.api.getRecord({ targetId: "a", recordId: record.id });
  assert.equal(old.state, "accepted");
  assert.equal(old.needsRevalidation, true);
  assert.equal(
    (await f.api.getTargetSummary({ targetId: "a" })).items.length,
    0,
  );
  await assert.rejects(
    f.api.reviewRecord({
      targetId: "a",
      recordId: record.id,
      expectedRevision: 1,
      expectedTargetRevision: 1,
      decision: "accepted",
    }),
    { code: "target_changed" },
  );
});

test("revisions retain superseded content and reject stale review decisions", async (t) => {
  const f = fixture(t),
    record = await f.create();
  await f.api.reviewRecord({
    targetId: "a",
    recordId: record.id,
    expectedRevision: 1,
    expectedTargetRevision: 1,
    decision: "accepted",
  });
  const revised = await f.api.reviseRecord({
    targetId: "a",
    recordId: record.id,
    expectedRevision: 1,
    expectedTargetRevision: 1,
    title: "Revised observation",
    body: "A manually reviewed update.",
    refs: [{ runId: "run-a" }],
  });
  assert.equal(revised.revision, 2);
  assert.equal(revised.state, "proposed");
  const previous = await f.api.getRecord({
    targetId: "a",
    recordId: record.id,
    revision: 1,
  });
  assert.equal(previous.state, "superseded");
  assert.equal(previous.title, record.title);
  assert.deepEqual(
    previous.reviews.map((item) => item.state),
    ["proposed", "accepted", "superseded"],
  );
  await assert.rejects(
    f.api.reviewRecord({
      targetId: "a",
      recordId: record.id,
      expectedRevision: 1,
      expectedTargetRevision: 1,
      decision: "accepted",
    }),
    { code: "knowledge_conflict" },
  );
});

test("missing or changed evidence and rewritten journal references cannot produce accepted summary", async (t) => {
  const f = fixture(t),
    record = await f.create();
  await f.api.reviewRecord({
    targetId: "a",
    recordId: record.id,
    expectedRevision: 1,
    expectedTargetRevision: 1,
    decision: "accepted",
  });
  f.setIntegrity("missing");
  assert.equal(
    (await f.api.getTargetSummary({ targetId: "a" })).items.length,
    0,
  );
  assert.equal(
    (await f.api.getRecord({ targetId: "a", recordId: record.id })).validation
      .status,
    "unavailable",
  );
  f.setIntegrity("available");
  f.run.events[1].eventId = "replaced-event";
  assert.equal(
    (await f.api.getTargetSummary({ targetId: "a" })).items.length,
    0,
  );
});

test("finding bodies are private manual text, rejected records stay retained, scoped cursors are refused", async (t) => {
  const f = fixture(t);
  const one = await f.create({ kind: "finding" });
  await f.create({ kind: "finding" });
  await f.api.reviewRecord({
    targetId: "a",
    recordId: one.id,
    expectedRevision: 1,
    expectedTargetRevision: 1,
    decision: "rejected",
    note: "Not established by this evidence",
  });
  assert.equal(
    (await f.api.getRecord({ targetId: "a", recordId: one.id })).state,
    "rejected",
  );
  const page = await f.api.listRecords({ targetId: "a", limit: 1 });
  assert.ok(page.nextCursor);
  await assert.rejects(
    f.api.listRecords({ targetId: "b", limit: 1, cursor: page.nextCursor }),
    { code: "knowledge_cursor" },
  );
  await assert.rejects(f.create({ body: "x".repeat(20000) }), {
    code: "knowledge_invalid",
  });
});

test("accepted summary refuses a concurrent rejection during evidence verification", async (t) => {
  const f = fixture(t),
    record = await f.create();
  const review = (decision) =>
    f.api.reviewRecord({
      targetId: "a",
      recordId: record.id,
      expectedRevision: 1,
      expectedTargetRevision: 1,
      decision,
    });
  await review("accepted");
  f.onInspect(() => review("rejected"));
  await assert.rejects(f.api.getTargetSummary({ targetId: "a" }), {
    code: "knowledge_conflict",
  });
  assert.equal(
    (await f.api.getTargetSummary({ targetId: "a" })).items.length,
    0,
  );
});

test("failed lazy evidence initialization does not poison catalog cleanup", async (t) => {
  const f = fixture(t, true);
  await assert.rejects(f.create());
  await assert.doesNotReject(f.api.closeKnowledge());
});

test("knowledge cursors cannot cross workspaces with matching target and generation", async (t) => {
  const one = fixture(t),
    two = fixture(t);
  for (const f of [one, two]) {
    await f.create();
    await f.create();
  }
  const page = await one.api.listRecords({ targetId: "a", limit: 1 });
  await assert.rejects(
    two.api.listRecords({ targetId: "a", limit: 1, cursor: page.nextCursor }),
    { code: "knowledge_cursor" },
  );
});
