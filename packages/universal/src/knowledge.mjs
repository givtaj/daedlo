import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

// Authoritative R4 records. Schema additions are versioned by catalog.mjs.
export const KNOWLEDGE_SCHEMA = `
CREATE TABLE knowledge_records (target_id TEXT NOT NULL REFERENCES targets(id), id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('finding','knowledge')), head_revision INTEGER NOT NULL CHECK(head_revision>=1), PRIMARY KEY(target_id,id)) STRICT;
CREATE TABLE knowledge_revisions (target_id TEXT NOT NULL, record_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=1), record TEXT NOT NULL, PRIMARY KEY(target_id,record_id,revision), FOREIGN KEY(target_id,record_id) REFERENCES knowledge_records(target_id,id)) STRICT;
CREATE TABLE knowledge_reviews (target_id TEXT NOT NULL, record_id TEXT NOT NULL, revision INTEGER NOT NULL, sequence INTEGER NOT NULL CHECK(sequence>=1), state TEXT NOT NULL CHECK(state IN ('proposed','accepted','superseded','rejected')), note TEXT NOT NULL, reviewed_at TEXT NOT NULL, PRIMARY KEY(target_id,record_id,revision,sequence), FOREIGN KEY(target_id,record_id,revision) REFERENCES knowledge_revisions(target_id,record_id,revision)) STRICT;
`;

const id = (value) =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const integer = (value) => Number.isSafeInteger(value) && value > 0;
const text = (value, max) =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= max &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value);
const sha = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = (code = "knowledge_invalid") => {
  throw Object.assign(
    Error(
      {
        knowledge_invalid: "The manual record or reference is invalid.",
        knowledge_reference:
          "A reference is unavailable or belongs to another target.",
        knowledge_not_found:
          "The requested record does not exist in this target.",
        knowledge_conflict:
          "The record changed. Read its current revision before reviewing it.",
        knowledge_revalidation:
          "Review requires available evidence and the current integration identity.",
        knowledge_corrupt:
          "The retained record needs inspection; its data was preserved.",
        knowledge_limit: "The operation exceeds the supported knowledge bound.",
        knowledge_cursor:
          "The record cursor is stale or belongs to a different target.",
        target_changed:
          "The target changed. Read its current revision before continuing.",
      }[code] ?? "The record operation was refused.",
    ),
    { code },
  );
};
const pin = (target) => ({
  revision: target.revision,
  model: structuredClone(target.model),
  sourceSha256: target.sourceSha256,
  configSha256: target.configSha256,
});
const inputRefs = (refs) => {
  if (!Array.isArray(refs) || !refs.length || refs.length > 8) fail();
  const result = refs.map((ref) => {
    if (
      !ref ||
      Object.keys(ref).some(
        (key) => !["runId", "eventSequence", "evidenceId"].includes(key),
      ) ||
      !id(ref.runId) ||
      !(ref.eventSequence == null || integer(ref.eventSequence)) ||
      !(ref.evidenceId == null || id(ref.evidenceId))
    )
      fail();
    return {
      runId: ref.runId,
      eventSequence: ref.eventSequence ?? null,
      evidenceId: ref.evidenceId ?? null,
    };
  });
  if (new Set(result.map(sha)).size !== result.length) fail();
  return result;
};

export function createKnowledge({
  root,
  catalogId,
  use,
  targetIn,
  getTarget,
  getRun,
  getEvidence,
  assertV2,
  inspectEvidence,
}) {
  let evidenceStore;
  const inspect =
    inspectEvidence ??
    (async (query) => {
      if (!evidenceStore) {
        const opening = import("./evidence.mjs").then(
          ({ createEvidenceStore }) =>
            createEvidenceStore({
              root,
              catalog: { getTarget, getRun, getEvidence },
            }),
        );
        evidenceStore = opening;
        // A failed constructor has no returned store or retained handles to close.
        void opening.catch(() => {
          if (evidenceStore === opening) evidenceStore = undefined;
        });
      }
      return (await evidenceStore).inspect(query);
    });
  const context = () => ({ runs: new Map(), artifacts: new Map(), bytes: 0 });
  const spend = (ctx, bytes) => {
    ctx.bytes += bytes;
    if (ctx.bytes > 64 * 1024 * 1024) fail("knowledge_limit");
  };
  async function reference(targetId, ref, ctx, checkIntegrity) {
    const key = targetId + "/" + ref.runId;
    let run = ctx.runs.get(key);
    if (!run) {
      try {
        run = await getRun({ targetId, runId: ref.runId });
      } catch {
        fail("knowledge_reference");
      }
      if (
        run.targetId !== targetId ||
        run.runId !== ref.runId ||
        !Array.isArray(run.events) ||
        !run.events.length
      )
        fail("knowledge_reference");
      spend(ctx, Buffer.byteLength(JSON.stringify(run)));
      ctx.runs.set(key, run);
    }
    const sequence =
      ref.throughSequence ?? ref.eventSequence ?? run.events.at(-1).sequence;
    const event = run.events.find((value) => value.sequence === sequence);
    const installation = run.events[0]?.payload?.installation;
    if (
      !event ||
      !installation?.model ||
      typeof installation.sourceSha256 !== "string"
    )
      fail("knowledge_reference");
    const result = {
      runId: ref.runId,
      eventSequence: ref.eventSequence,
      evidenceId: ref.evidenceId,
      throughSequence: sequence,
      eventId: event.eventId,
      journalPrefixSha256: sha(
        run.events.filter((value) => value.sequence <= sequence),
      ),
      installation: structuredClone(installation),
    };
    if (ref.evidenceId) {
      const artifactKey = targetId + "/" + ref.evidenceId;
      let metadata = ctx.artifacts.get(artifactKey);
      if (!metadata) {
        try {
          metadata = await getEvidence({
            targetId,
            evidenceId: ref.evidenceId,
          });
        } catch {
          fail("knowledge_reference");
        }
        if (
          metadata.targetId !== targetId ||
          metadata.id !== ref.evidenceId ||
          !Number.isSafeInteger(metadata.bytes) ||
          metadata.bytes < 0
        )
          fail("knowledge_reference");
        if (checkIntegrity) {
          spend(ctx, metadata.bytes);
          const inspected = await inspect({
            targetId,
            evidenceId: ref.evidenceId,
          });
          if (inspected.integrity !== "available") fail("knowledge_reference");
        }
        ctx.artifacts.set(artifactKey, metadata);
      }
      if (
        metadata.runId !== ref.runId ||
        (ref.eventSequence !== null &&
          metadata.eventSequence !== ref.eventSequence)
      )
        fail("knowledge_reference");
      result.evidenceSha256 = metadata.sha256;
    }
    return result;
  }
  function read(db, targetId, recordId, revision) {
    if (
      !id(targetId) ||
      !id(recordId) ||
      (revision !== undefined && !integer(revision))
    )
      fail();
    targetIn(db, targetId);
    const head = db
      .prepare("SELECT * FROM knowledge_records WHERE target_id=? AND id=?")
      .get(targetId, recordId);
    if (!head) fail("knowledge_not_found");
    const selected = revision ?? head.head_revision;
    const row = db
      .prepare(
        "SELECT record FROM knowledge_revisions WHERE target_id=? AND record_id=? AND revision=?",
      )
      .get(targetId, recordId, selected);
    if (!row) fail("knowledge_not_found");
    let record;
    try {
      record = JSON.parse(row.record);
    } catch {
      fail("knowledge_corrupt");
    }
    if (
      record.id !== recordId ||
      record.targetId !== targetId ||
      record.revision !== selected ||
      record.kind !== head.kind ||
      !text(record.title, 160) ||
      !text(record.body, 12000) ||
      !Array.isArray(record.refs) ||
      !record.refs.length ||
      record.refs.length > 8 ||
      !integer(record.integration?.revision)
    )
      fail("knowledge_corrupt");
    const reviews = db
      .prepare(
        "SELECT sequence,state,note,reviewed_at AS reviewedAt FROM knowledge_reviews WHERE target_id=? AND record_id=? AND revision=? ORDER BY sequence",
      )
      .all(targetId, recordId, selected);
    if (
      !reviews.length ||
      reviews.some(
        (item, index) =>
          item.sequence !== index + 1 ||
          !["proposed", "accepted", "rejected", "superseded"].includes(
            item.state,
          ),
      )
    )
      fail("knowledge_corrupt");
    return {
      ...record,
      state: reviews.at(-1).state,
      reviewedAt: reviews.at(-1).reviewedAt,
      reviews,
      headRevision: head.head_revision,
    };
  }
  async function present(record, ctx = context()) {
    const target = await getTarget(record.targetId),
      reasons = [];
    let stale = !isDeepStrictEqual(record.integration, pin(target));
    if (stale) reasons.push("integration_changed");
    for (const ref of record.refs) {
      try {
        const actual = await reference(record.targetId, ref, ctx, true);
        if (!isDeepStrictEqual(actual, ref)) reasons.push("reference_changed");
        if (
          !isDeepStrictEqual(
            actual.installation.model,
            record.integration.model,
          ) ||
          actual.installation.sourceSha256 !== record.integration.sourceSha256
        ) {
          stale = true;
          reasons.push("historical_integration");
        }
      } catch (error) {
        if (error.code === "knowledge_limit")
          reasons.push("verification_limit");
        else reasons.push("reference_unavailable");
      }
    }
    if (
      !isDeepStrictEqual(pin(await getTarget(record.targetId)), pin(target))
    ) {
      stale = true;
      reasons.push("integration_changed");
    }
    const unique = [...new Set(reasons)];
    return {
      ...record,
      needsRevalidation: stale,
      validation: {
        status: unique.some(
          (reason) =>
            !["integration_changed", "historical_integration"].includes(reason),
        )
          ? "unavailable"
          : stale
            ? "stale"
            : "valid",
        reasons: unique,
      },
    };
  }
  async function capture(input) {
    assertV2();
    if (
      !id(input.targetId) ||
      !integer(input.expectedTargetRevision) ||
      !text(input.title, 160) ||
      !text(input.body, 12000)
    )
      fail();
    const target = await getTarget(input.targetId);
    if (target.revision !== input.expectedTargetRevision)
      fail("target_changed");
    const ctx = context(),
      refs = [];
    for (const ref of inputRefs(input.refs))
      refs.push(await reference(input.targetId, ref, ctx, true));
    return { target, refs };
  }
  const ensureTarget = (db, target) => {
    if (!isDeepStrictEqual(targetIn(db, target.id), target))
      fail("target_changed");
  };
  const addReview = (db, record, state, note = "") => {
    const count = db
      .prepare(
        "SELECT count(*) AS count FROM knowledge_reviews WHERE target_id=? AND record_id=? AND revision=?",
      )
      .get(record.targetId, record.id, record.revision).count;
    if (count >= 100) fail("knowledge_limit");
    db.prepare("INSERT INTO knowledge_reviews VALUES(?,?,?,?,?,?,?)").run(
      record.targetId,
      record.id,
      record.revision,
      count + 1,
      state,
      note,
      new Date().toISOString(),
    );
  };
  async function createRecord(input) {
    if (!["finding", "knowledge"].includes(input.kind)) fail();
    const { target, refs } = await capture(input);
    const record = {
      id: randomUUID(),
      targetId: target.id,
      kind: input.kind,
      revision: 1,
      title: input.title.trim(),
      body: input.body.trim(),
      refs,
      integration: pin(target),
      createdAt: new Date().toISOString(),
    };
    await use(false, (db) => {
      ensureTarget(db, target);
      if (
        db
          .prepare(
            "SELECT count(*) AS count FROM knowledge_records WHERE target_id=?",
          )
          .get(target.id).count >= 1000
      )
        fail("knowledge_limit");
      db.prepare("INSERT INTO knowledge_records VALUES(?,?,?,1)").run(
        target.id,
        record.id,
        record.kind,
      );
      db.prepare("INSERT INTO knowledge_revisions VALUES(?,?,1,?)").run(
        target.id,
        record.id,
        JSON.stringify(record),
      );
      addReview(db, record, "proposed");
    });
    return getRecord({ targetId: target.id, recordId: record.id });
  }
  async function reviseRecord(input) {
    if (!id(input.recordId) || !integer(input.expectedRevision)) fail();
    const { target, refs } = await capture(input);
    await use(false, (db) => {
      ensureTarget(db, target);
      const previous = read(db, target.id, input.recordId);
      if (previous.revision !== input.expectedRevision)
        fail("knowledge_conflict");
      if (previous.revision >= 100) fail("knowledge_limit");
      const record = {
        id: previous.id,
        targetId: target.id,
        kind: previous.kind,
        revision: previous.revision + 1,
        title: input.title.trim(),
        body: input.body.trim(),
        refs,
        integration: pin(target),
        createdAt: new Date().toISOString(),
      };
      if (previous.state !== "superseded")
        addReview(db, previous, "superseded");
      db.prepare("INSERT INTO knowledge_revisions VALUES(?,?,?,?)").run(
        target.id,
        record.id,
        record.revision,
        JSON.stringify(record),
      );
      db.prepare(
        "UPDATE knowledge_records SET head_revision=? WHERE target_id=? AND id=?",
      ).run(record.revision, target.id, record.id);
      addReview(db, record, "proposed");
    });
    return getRecord({ targetId: target.id, recordId: input.recordId });
  }
  async function reviewRecord(input) {
    assertV2();
    if (
      !id(input.targetId) ||
      !id(input.recordId) ||
      !integer(input.expectedRevision) ||
      !integer(input.expectedTargetRevision) ||
      !["accepted", "rejected"].includes(input.decision) ||
      !(input.note === undefined || input.note === "" || text(input.note, 2000))
    )
      fail();
    const target = await getTarget(input.targetId);
    if (target.revision !== input.expectedTargetRevision)
      fail("target_changed");
    const record = await getRecord({
      targetId: input.targetId,
      recordId: input.recordId,
    });
    if (record.revision !== input.expectedRevision) fail("knowledge_conflict");
    if (input.decision === "accepted" && record.validation.status !== "valid")
      fail("knowledge_revalidation");
    await use(false, (db) => {
      ensureTarget(db, target);
      const current = read(db, target.id, record.id);
      if (
        current.revision !== record.revision ||
        current.reviews.length !== record.reviews.length
      )
        fail("knowledge_conflict");
      if (current.state === "superseded") fail("knowledge_conflict");
      if (current.state !== input.decision)
        addReview(db, current, input.decision, input.note?.trim() ?? "");
    });
    return getRecord({ targetId: target.id, recordId: record.id });
  }
  const generationIn = (db, targetId) =>
    db
      .prepare(
        "SELECT count(*) AS count FROM knowledge_reviews WHERE target_id=?",
      )
      .get(targetId).count;
  async function getRecord({ targetId, recordId, revision } = {}) {
    assertV2();
    const snapshot = await use(true, (db) => {
      const record = read(db, targetId, recordId, revision);
      const revisions = db
        .prepare(
          "SELECT revision FROM knowledge_revisions WHERE target_id=? AND record_id=? ORDER BY revision DESC",
        )
        .all(targetId, recordId)
        .map((row) => {
          const previous = read(db, targetId, recordId, row.revision);
          return {
            revision: previous.revision,
            title: previous.title,
            state: previous.state,
            createdAt: previous.createdAt,
            reviewedAt: previous.reviewedAt,
          };
        });
      return { record, revisions };
    });
    const value = await present(snapshot.record);
    await use(true, (db) => {
      if (
        !isDeepStrictEqual(
          read(db, targetId, recordId, revision),
          snapshot.record,
        )
      )
        fail("knowledge_conflict");
    });
    return { ...value, revisions: snapshot.revisions };
  }
  async function listRecords({
    targetId,
    kind,
    limit = 25,
    cursor = null,
  } = {}) {
    assertV2();
    if (
      !id(targetId) ||
      (kind !== undefined && !["finding", "knowledge"].includes(kind)) ||
      !integer(limit) ||
      limit > 100
    )
      fail();
    const target = await getTarget(targetId);
    const page = await use(true, (db) => {
      const generation = generationIn(db, targetId);
      let anchor = "";
      if (cursor !== null) {
        let parsed;
        try {
          if (
            typeof cursor !== "string" ||
            cursor.length > 1024 ||
            !/^[A-Za-z0-9_-]+$/.test(cursor)
          )
            throw Error();
          parsed = JSON.parse(Buffer.from(cursor, "base64url"));
        } catch {
          fail("knowledge_cursor");
        }
        if (
          Object.keys(parsed).sort().join() !==
            "catalogId,generation,id,kind,revision,targetId,version" ||
          parsed.version !== 1 ||
          parsed.catalogId !== catalogId ||
          parsed.targetId !== targetId ||
          parsed.revision !== target.revision ||
          parsed.generation !== generation ||
          parsed.kind !== (kind ?? null) ||
          !id(parsed.id)
        )
          fail("knowledge_cursor");
        anchor = parsed.id;
      }
      const rows = db
        .prepare(
          "SELECT id FROM knowledge_records WHERE target_id=? AND id>? AND (? IS NULL OR kind=?) ORDER BY id LIMIT ?",
        )
        .all(targetId, anchor, kind ?? null, kind ?? null, limit + 1);
      const more = rows.length > limit;
      if (more) rows.pop();
      return {
        generation,
        records: rows.map((row) => read(db, targetId, row.id)),
        nextCursor: more
          ? Buffer.from(
              JSON.stringify({
                version: 1,
                catalogId,
                targetId,
                revision: target.revision,
                generation,
                kind: kind ?? null,
                id: rows.at(-1).id,
              }),
            ).toString("base64url")
          : null,
      };
    });
    const ctx = context(),
      records = [];
    for (const record of page.records) records.push(await present(record, ctx));
    await use(true, (db) => {
      ensureTarget(db, target);
      if (generationIn(db, targetId) !== page.generation)
        fail("knowledge_conflict");
    });
    return { targetId, records, nextCursor: page.nextCursor };
  }
  async function getTargetSummary({ targetId } = {}) {
    assertV2();
    if (!id(targetId)) fail();
    const target = await getTarget(targetId);
    const snapshot = await use(true, (db) => {
      targetIn(db, targetId);
      return {
        generation: generationIn(db, targetId),
        candidates: db
          .prepare(
            "SELECT id FROM knowledge_records WHERE target_id=? AND kind='knowledge' ORDER BY id",
          )
          .all(targetId)
          .map((row) => read(db, targetId, row.id))
          .filter((record) => record.state === "accepted"),
      };
    });
    const ctx = context(),
      items = [],
      excluded = [];
    for (const record of snapshot.candidates) {
      if (items.length >= 25) {
        excluded.push({ id: record.id, reason: "summary_limit" });
        continue;
      }
      const value = await present(record, ctx);
      if (value.validation.status === "valid") items.push(value);
      else
        excluded.push({
          id: value.id,
          reason: value.needsRevalidation
            ? "needs_revalidation"
            : "evidence_unavailable",
        });
    }
    await use(true, (db) => {
      ensureTarget(db, target);
      if (generationIn(db, targetId) !== snapshot.generation)
        fail("knowledge_conflict");
    });
    return {
      targetId,
      targetRevision: target.revision,
      items,
      excluded,
      historicalOnly: true,
    };
  }
  async function closeKnowledge() {
    if (!evidenceStore) return;
    // Keep the store and its failed-close handles reachable until cleanup succeeds.
    await (await evidenceStore).close();
    evidenceStore = undefined;
  }
  return {
    createRecord,
    reviseRecord,
    reviewRecord,
    listRecords,
    getRecord,
    getTargetSummary,
    closeKnowledge,
  };
}
