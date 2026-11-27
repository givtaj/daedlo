import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  createArchiveImports,
  ARCHIVE_SCHEMA,
  archiveSummary,
} from "../packages/universal/src/archive-imports.mjs";

const installation = {
  id: "historical-install",
  version: "0.1.0-alpha.7",
  sourceSha256: "a".repeat(64),
  model: { id: "fixture", version: "1" },
};
const makeArchive = (runId = "historical-run") => ({
  schemaVersion: 1,
  kind: "daedlo-managed-run",
  installation: structuredClone(installation),
  recordedAt: "2026-11-01T10:00:02.000Z",
  report: {
    format: "browser-driver-report/1",
    runId,
    identity: { model: installation.model },
    lastResult: {
      runId,
      ok: false,
      execution: "failed",
      effect: { status: "saved" },
      command: "save",
      recipe: false,
      startedAt: "2026-11-01T10:00:00.000Z",
      finishedAt: "2026-11-01T10:00:01.000Z",
    },
    events: [
      {
        runId,
        sequence: 9,
        at: "2026-11-01T10:00:00.000Z",
        type: "run_started",
        command: "save",
      },
      {
        runId,
        sequence: 10,
        at: "2026-11-01T10:00:01.000Z",
        type: "run_finished",
        execution: "failed",
      },
    ],
    eventRange: { first: 9, last: 10, retainedFirst: 9, truncated: false },
    resources: [],
  },
});
async function fixture(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "universal-import-")),
  );
  const db = new DatabaseSync(":memory:");
  db.exec(
    "PRAGMA foreign_keys=ON; CREATE TABLE targets(id TEXT PRIMARY KEY) STRICT; INSERT INTO targets VALUES('a'),('b'); CREATE TABLE history_state(target_id TEXT PRIMARY KEY,generation INTEGER,indexed_at TEXT); INSERT INTO history_state VALUES('a',0,NULL),('b',0,NULL); CREATE TABLE runs(target_id TEXT,run_id TEXT,source_hash TEXT,checkpoint_hash TEXT,checkpoint_sequence INTEGER,summary TEXT);" +
      ARCHIVE_SCHEMA,
  );
  t.after(async () => {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const targets = new Map(
    ["a", "b"].map((id) => [
      id,
      {
        id,
        revision: 2,
        projectId: "project-" + id,
        model: { id: "fixture", version: "2" },
        sourceSha256: "b".repeat(64),
      },
    ]),
  );
  const journals = new Map();
  let beforeJournal;
  const getTarget = async (id) => {
    if (!targets.has(id))
      throw Object.assign(Error(), { code: "target_not_found" });
    return structuredClone(targets.get(id));
  };
  const api = createArchiveImports({
    root,
    catalogId: "00000000-0000-0000-0000-000000000001",
    assertV3() {},
    getTarget,
    targetIn: (_, id) => {
      if (!targets.has(id))
        throw Object.assign(Error(), { code: "target_not_found" });
      return structuredClone(targets.get(id));
    },
    getRun: async ({ targetId, runId }) => {
      await beforeJournal?.();
      const value = journals.get(targetId + "/" + runId);
      if (!value) throw Object.assign(Error(), { code: "ENOENT" });
      return structuredClone(value);
    },
    use: async (readonly, operation) => {
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
  const save = async (value, name = "source.json", pretty = true) => {
    const file = join(root, name);
    await fs.writeFile(
      file,
      JSON.stringify(value, null, pretty ? 2 : undefined) + "\n",
    );
    return file;
  };
  return {
    root,
    db,
    api,
    save,
    targets,
    journals,
    beforeJournal(hook) {
      beforeJournal = hook;
    },
    importFile: (sourceFile, targetId = "a") =>
      api.importManagedArchive({
        sourceFile,
        targetId,
        expectedTargetRevision: 2,
      }),
  };
}

test("managed report import preserves exact source bytes and original provenance while remaining report-only", async (t) => {
  const f = await fixture(t),
    archive = makeArchive(),
    file = await f.save(archive),
    before = await fs.readFile(file),
    saved = await f.importFile(file);
  assert.equal(
    saved.imported,
    true,
    "An explicitly mapped archive must become retained history",
  );
  const detail = await f.api.getImportedRun({
    targetId: "a",
    runId: archive.report.runId,
  });
  assert.deepEqual(detail.report, archive.report);
  assert.equal(detail.format, "daedlo-imported-report/1");
  assert.equal(detail.historyComplete, false);
  assert.deepEqual(detail.events, []);
  assert.deepEqual(detail.provenance.installation, installation);
  assert.equal(detail.provenance.mapping.targetRevision, 2);
  assert.ok(detail.provenance.limitations.includes("completed_report_only"));
  assert.equal(detail.report.lastResult.execution, "failed");
  assert.equal(detail.report.lastResult.effect.status, "saved");
  assert.deepEqual(
    Buffer.from(
      f.db.prepare("SELECT source_bytes FROM archive_imports").get()
        .source_bytes,
    ),
    before,
  );
  assert.deepEqual(await fs.readFile(file), before);
});
test("unknown formats and session snapshots are refused without changing original source", async (t) => {
  const f = await fixture(t);
  for (const archive of [
    { ...makeArchive(), schemaVersion: 9 },
    { ...makeArchive(), kind: "other" },
    {
      ...makeArchive(),
      report: { ...makeArchive().report, completedRunIds: ["historical-run"] },
    },
  ]) {
    const file = await f.save(archive),
      before = await fs.readFile(file);
    await assert.rejects(f.importFile(file), (error) =>
      ["archive_unsupported", "archive_invalid"].includes(error.code),
    );
    assert.deepEqual(await fs.readFile(file), before);
  }
  assert.equal(
    f.db.prepare("SELECT count(*) AS n FROM archive_imports").get().n,
    0,
  );
});
test("duplicate file or equivalent report keeps first archive bytes while conflicting identity and target mappings refuse", async (t) => {
  const f = await fixture(t),
    archive = makeArchive(),
    file = await f.save(archive),
    first = await f.importFile(file),
    bytes = await fs.readFile(file);
  const repeated = await f.importFile(file);
  assert.equal(repeated.imported, false);
  assert.equal(repeated.importId, first.importId);
  const copy = await f.save(
    { ...archive, recordedAt: "2026-11-02T10:00:02.000Z" },
    "copy.json",
    false,
  );
  assert.equal((await f.importFile(copy)).importId, first.importId);
  await assert.rejects(f.importFile(copy, "b"), {
    code: "archive_target_conflict",
  });
  const changed = structuredClone(archive);
  changed.report.lastResult.effect.status = "uncertain";
  await assert.rejects(f.importFile(await f.save(changed, "changed.json")), {
    code: "archive_conflict",
  });
  assert.equal(
    f.db.prepare("SELECT count(*) AS n FROM archive_imports").get().n,
    1,
  );
  assert.deepEqual(
    Buffer.from(
      f.db.prepare("SELECT source_bytes FROM archive_imports").get()
        .source_bytes,
    ),
    bytes,
  );
});

test("import history uses actual archive time and does not invent a journal index timestamp", async (t) => {
  const f = await fixture(t),
    archive = makeArchive();
  await f.importFile(await f.save(archive));
  assert.equal(
    JSON.parse(
      f.db.prepare("SELECT summary FROM archive_imports").get().summary,
    ).archivedAt,
    archive.recordedAt,
  );
  const state = f.db
    .prepare("SELECT * FROM history_state WHERE target_id='a'")
    .get();
  assert.equal(state.generation, 1);
  assert.equal(state.indexed_at, null);
});

test("a concurrent first journal index cannot bind an unverified replacement checkpoint to an import", async (t) => {
  const f = await fixture(t),
    archive = makeArchive(),
    runId = archive.report.runId;
  f.journals.set("a/" + runId, {
    format: "daedlo-run-journal/1",
    targetId: "a",
    runId,
    status: "finished",
    historyComplete: true,
    partialTail: false,
    events: [{ type: "run_started", sequence: 1, payload: { installation } }],
    report: archive.report,
  });
  f.beforeJournal(() => {
    f.db
      .prepare("INSERT INTO runs VALUES(?,?,?,?,?,?)")
      .run(
        "a",
        runId,
        "c".repeat(64),
        "c".repeat(64),
        1,
        JSON.stringify({ status: "finished" }),
      );
  });
  const file = await f.save(archive),
    before = await fs.readFile(file);
  await assert.rejects(f.importFile(file), { code: "archive_conflict" });
  assert.equal(
    f.db.prepare("SELECT count(*) AS n FROM archive_imports").get().n,
    0,
  );
  assert.deepEqual(await fs.readFile(file), before);
});

test("an otherwise valid imported row cannot be read as history in a foreign catalog", async (t) => {
  const f = await fixture(t);
  await f.importFile(await f.save(makeArchive()));
  const row = f.db.prepare("SELECT * FROM archive_imports").get();
  assert.throws(
    () =>
      archiveSummary(row, {
        catalogId: "00000000-0000-0000-0000-000000000002",
      }),
    { code: "archive_corrupt" },
  );
  assert.equal(
    archiveSummary(row, { catalogId: "00000000-0000-0000-0000-000000000001" })
      .sourceKind,
    "archive",
  );
});

test("impossible archive calendar dates are rejected without normalizing original history", async (t) => {
  const f = await fixture(t),
    archive = makeArchive();
  archive.recordedAt = "2026-02-30T10:00:00.000Z";
  await assert.rejects(f.importFile(await f.save(archive)), {
    code: "archive_invalid",
  });
});

test("source removal during journal validation refuses the import with retained-source status", async (t) => {
  const f = await fixture(t),
    file = await f.save(makeArchive());
  f.beforeJournal(() => fs.rename(file, file + ".preserved"));
  await assert.rejects(f.importFile(file), { code: "archive_source_changed" });
  assert.equal(
    f.db.prepare("SELECT count(*) AS n FROM archive_imports").get().n,
    0,
  );
  assert.ok((await fs.stat(file + ".preserved")).size > 0);
});

test("legacy missing fields and truncated runtime events retain their original evidence limits", async (t) => {
  const f = await fixture(t),
    legacy = {
      schemaVersion: 1,
      kind: "daedlo-managed-run",
      installation: { id: "legacy-install" },
      recordedAt: "2026-10-01T00:00:00.000Z",
      report: {
        format: "browser-driver-report/1",
        runId: "legacy-run",
        lastResult: {
          runId: "legacy-run",
          execution: "failed",
          effect: { status: "saved" },
        },
      },
    };
  await f.importFile(await f.save(legacy));
  const minimal = await f.api.getImportedRun({
    targetId: "a",
    runId: "legacy-run",
  });
  assert.deepEqual(minimal.report, legacy.report);
  assert.deepEqual(minimal.provenance.installation, legacy.installation);
  for (const code of [
    "completed_report_only",
    "event_history_missing",
    "event_range_missing",
    "installation_source_missing",
    "installation_model_missing",
    "run_timestamps_missing",
  ])
    assert.ok(minimal.provenance.limitations.includes(code));
  const truncated = makeArchive("long-run");
  truncated.installation.sourceSha256 = "A".repeat(64);
  truncated.report.eventRange = {
    first: 1,
    last: 10,
    retainedFirst: 9,
    truncated: true,
  };
  await f.importFile(await f.save(truncated, "long.json"));
  const detail = await f.api.getImportedRun({
    targetId: "a",
    runId: "long-run",
  });
  assert.deepEqual(detail.report.eventRange, truncated.report.eventRange);
  assert.equal(detail.provenance.installation.sourceSha256, "A".repeat(64));
  assert.ok(detail.provenance.limitations.includes("events_truncated"));
  assert.equal(detail.historyComplete, false);
});

test("run identity and runtime event boundaries are validated before any imported row is written", async (t) => {
  const f = await fixture(t);
  const patches = [
    (archive) => {
      archive.report.lastResult.runId = "wrong";
    },
    (archive) => {
      archive.report.events[0].runId = "other-target-run";
    },
    (archive) => {
      archive.report.eventRange.last = 11;
    },
    (archive) => {
      archive.report.events[1].sequence = 9;
    },
    (archive) => {
      archive.report.identity.model.version = "different";
    },
    (archive) => {
      archive.report.eventRange.truncated = true;
    },
  ];
  for (const patch of patches) {
    const archive = makeArchive();
    patch(archive);
    const file = await f.save(archive),
      before = await fs.readFile(file);
    await assert.rejects(f.importFile(file), { code: "archive_invalid" });
    assert.deepEqual(await fs.readFile(file), before);
  }
  assert.equal(
    f.db.prepare("SELECT count(*) AS n FROM archive_imports").get().n,
    0,
  );
});

test("source symlinks, hardlinks, oversized data and invalid UTF8 are refused without rewriting originals", async (t) => {
  const f = await fixture(t),
    file = await f.save(makeArchive()),
    before = await fs.readFile(file);
  const link = join(f.root, "linked.json");
  await fs.symlink(file, link);
  await assert.rejects(f.importFile(link), { code: "archive_source_changed" });
  await fs.unlink(link);
  await fs.link(file, link);
  await assert.rejects(f.importFile(file), { code: "archive_source_changed" });
  await fs.unlink(link);
  assert.deepEqual(await fs.readFile(file), before);
  const large = join(f.root, "large.json");
  await fs.writeFile(large, "{}");
  await fs.truncate(large, 16 * 1024 * 1024 + 1);
  await assert.rejects(f.importFile(large), { code: "archive_limit" });
  assert.equal((await fs.stat(large)).size, 16 * 1024 * 1024 + 1);
  const invalid = join(f.root, "invalid.json"),
    bytes = Buffer.from([0xff, 0xfe, 0x7b, 0x7d]);
  await fs.writeFile(invalid, bytes);
  await assert.rejects(f.importFile(invalid), { code: "archive_invalid" });
  assert.deepEqual(await fs.readFile(invalid), bytes);
});

test("a target changed during source validation cannot acquire the import", async (t) => {
  const f = await fixture(t),
    file = await f.save(makeArchive()),
    before = await fs.readFile(file);
  f.beforeJournal(() => {
    f.targets.get("a").revision = 3;
  });
  await assert.rejects(f.importFile(file), { code: "target_changed" });
  assert.equal(
    f.db.prepare("SELECT count(*) AS n FROM archive_imports").get().n,
    0,
  );
  assert.deepEqual(await fs.readFile(file), before);
});

test("a matching journal can be linked only with unchanged checkpoint proof and conflicting reports never overwrite history", async (t) => {
  const f = await fixture(t),
    archive = makeArchive(),
    runId = archive.report.runId,
    file = await f.save(archive);
  const history = {
    format: "daedlo-run-journal/1",
    targetId: "a",
    runId,
    status: "finished",
    historyComplete: true,
    partialTail: false,
    events: [{ type: "run_started", sequence: 1, payload: { installation } }],
    report: archive.report,
  };
  f.journals.set("a/" + runId, history);
  f.db
    .prepare("INSERT INTO runs VALUES(?,?,?,?,?,?)")
    .run(
      "a",
      runId,
      "c".repeat(64),
      "c".repeat(64),
      1,
      JSON.stringify({ status: "finished" }),
    );
  await f.importFile(file);
  assert.equal(
    f.db.prepare("SELECT journal_checkpoint_hash FROM archive_imports").get()
      .journal_checkpoint_hash,
    "c".repeat(64),
  );
  history.report = structuredClone(archive.report);
  history.report.lastResult.effect.status = "uncertain";
  await assert.rejects(f.importFile(file), { code: "archive_conflict" });
  assert.equal(
    (await f.api.getImportedRun({ targetId: "a", runId })).report.lastResult
      .effect.status,
    "saved",
  );
});

test("corrupt retained bytes refuse detail without altering the original source", async (t) => {
  const f = await fixture(t),
    archive = makeArchive(),
    file = await f.save(archive),
    before = await fs.readFile(file);
  await f.importFile(file);
  f.db
    .prepare("UPDATE archive_imports SET source_bytes=?")
    .run(Buffer.from("altered original bytes"));
  await assert.rejects(
    f.api.getImportedRun({ targetId: "a", runId: archive.report.runId }),
    { code: "archive_corrupt" },
  );
  assert.deepEqual(await fs.readFile(file), before);
});

test("failed source-handle cleanup retains the exact handle for explicit close retry before any SQL write", async (t) => {
  const f = await fixture(t),
    file = await f.save(makeArchive()),
    before = await fs.readFile(file),
    open = fs.open;
  let retained,
    injected = true,
    closes = 0;
  const patched = mock.method(fs, "open", async (...args) => {
    const handle = await open(...args);
    if (args[0] === file) {
      retained = handle;
      const close = handle.close.bind(handle);
      handle.close = async () => {
        closes++;
        if (injected)
          throw Object.assign(Error("Synthetic close failure"), {
            code: "EIO",
          });
        return close();
      };
    }
    return handle;
  });
  try {
    await assert.rejects(f.importFile(file), {
      code: "archive_cleanup_incomplete",
    });
    assert.ok(retained.fd >= 0);
    await assert.rejects(f.api.closeArchiveImports(), {
      code: "archive_cleanup_incomplete",
    });
    injected = false;
    await f.api.closeArchiveImports();
    assert.equal(retained.fd, -1);
    assert.equal(closes, 3);
  } finally {
    injected = false;
    patched.mock.restore();
    await f.api.closeArchiveImports();
  }
  assert.equal(
    f.db.prepare("SELECT count(*) AS n FROM archive_imports").get().n,
    0,
  );
  assert.deepEqual(await fs.readFile(file), before);
});

test("a target at the combined history bound refuses an additional archive without copying it", async (t) => {
  const f = await fixture(t),
    insert = f.db.prepare("INSERT INTO runs VALUES(?,?,?,?,?,?)");
  f.db.exec("BEGIN");
  for (let i = 0; i < 10000; i++)
    insert.run(
      "a",
      "journal-" + i,
      "c".repeat(64),
      "c".repeat(64),
      1,
      JSON.stringify({ status: "finished" }),
    );
  f.db.exec("COMMIT");
  const file = await f.save(makeArchive()),
    before = await fs.readFile(file);
  await assert.rejects(f.importFile(file), { code: "archive_limit" });
  assert.equal(
    f.db.prepare("SELECT count(*) AS n FROM archive_imports").get().n,
    0,
  );
  assert.deepEqual(await fs.readFile(file), before);
});
