import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import {
  initializeWorkspace,
  openWorkspace,
} from "../packages/universal/vendor/tools/lib/workspace.mjs";
import { openRunJournal } from "../packages/universal/vendor/tools/lib/run-journal.mjs";
import {
  openCatalog,
  upgradeCatalog,
} from "../packages/universal/src/catalog.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const start = (runId, date = "2026-11-10T10:00:00.000Z") => ({
  runId,
  command: "save",
  recipe: false,
  startedAt: date,
  identity: { application: "Independent fixture" },
});
const report = (runId) => ({
  format: "browser-driver-report/1",
  runId,
  identity: { application: "Independent fixture" },
  lastResult: {
    runId,
    ok: true,
    execution: "completed",
    outcome: { kind: "success", label: "Saved" },
    effect: { status: "saved" },
  },
  events: [],
  resources: [],
  eventRange: { first: 1, last: 201, retainedFirst: 2, truncated: true },
});
async function fixture(t) {
  const base = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "daedlo-universal-catalog-")),
  );
  const root = join(base, "workspace");
  const target = (id = "stage") => ({
    id,
    label: id,
    environment: id,
    origin: "http://localhost:5555",
    authProfileRef: `profile-${id}`,
    projectId: `project-${id}`,
    store: join(base, `store-${id}`),
    sourceRoot: join(base, `source-${id}`),
    configPath: join(base, `${id}.json`),
    configSha256: "a".repeat(64),
    sourceSha256: "b".repeat(64),
    model: { id: "fixture", version: "1" },
  });
  const config = (value) => ({
    schemaVersion: 2,
    workspace: { id: "customer-a", root, journal: 1 },
    store: value.store,
    registration: { projectId: value.projectId, sourceRoot: value.sourceRoot },
  });
  await initializeWorkspace(config(target()));
  const handles = [];
  const open = async (create = true) => {
    const db = await openCatalog({ root, create });
    handles.push(db);
    return db;
  };
  const write = async (id, runId, { finished = true, date } = {}) => {
    const value = target(id);
    const workspace = await openWorkspace(config(value));
    const writer = await openRunJournal({
      workspace,
      installation: {
        id: "slot-a",
        version: "1.0.0",
        sourceSha256: value.sourceSha256,
        model: value.model,
      },
    });
    await writer.begin(start(runId, date));
    if (finished) await writer.finish({ runId, report: report(runId) });
    await writer.close();
    return join(workspace.journalRoot, `${runId}.jsonl`);
  };
  t.after(async () => {
    for (const handle of handles) await handle.close();
    await fs.rm(base, { recursive: true, force: true });
  });
  return {
    base,
    root,
    target,
    config,
    open,
    write,
    path: join(root, "workspace.sqlite"),
  };
}

test("catalog is explicit, private, immutable and isolates same-origin target namespaces", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.open(false), { code: "catalog_missing" });
  const before = await fs.readFile(join(f.root, "workspace.json"));
  const db = await f.open();
  assert.deepEqual(await db.registerTarget(f.target()), {
    ...f.target(),
    revision: 1,
  });
  await db.registerTarget(f.target("production"));
  assert.equal((await db.listTargets()).length, 2);
  assert.deepEqual(await db.registerTarget(f.target()), {
    ...f.target(),
    revision: 1,
  });
  await assert.rejects(
    db.registerTarget({ ...f.target(), origin: "https://changed.example" }),
    { code: "target_conflict" },
  );
  await assert.rejects(
    db.registerTarget({
      ...f.target("third"),
      projectId: f.target().projectId,
    }),
    { code: "target_conflict" },
  );
  await assert.rejects(
    db.registerTarget({ ...f.target("third"), store: f.target().store }),
    { code: "target_conflict" },
  );
  await assert.rejects(
    db.registerTarget({
      ...f.target("third"),
      authProfileRef: f.target().authProfileRef,
    }),
    { code: "target_conflict" },
  );
  assert.equal((await fs.stat(f.path)).mode & 0o777, 0o600);
  assert.deepEqual(await fs.readFile(join(f.root, "workspace.json")), before);
});

test("explicit projection preserves canonical reports and identical run IDs remain target-scoped", async (t) => {
  const f = await fixture(t);
  const db = await f.open();
  await db.registerTarget(f.target());
  await db.registerTarget(f.target("production"));
  const stagePath = await f.write("stage", "same-run");
  await f.write("production", "same-run", { finished: false });
  assert.deepEqual((await db.listRuns({ targetId: "stage" })).items, []);
  await db.indexTarget("stage");
  await db.indexTarget("production");
  assert.equal(
    (await db.listRuns({ targetId: "stage" })).items[0].status,
    "finished",
  );
  assert.equal(
    (await db.listRuns({ targetId: "production" })).items[0].status,
    "incomplete",
  );
  assert.deepEqual(
    (await db.getRun({ targetId: "stage", runId: "same-run" })).report,
    report("same-run"),
  );
  const before = await fs.readFile(stagePath);
  const result = await db.indexTarget("stage");
  assert.equal(result.unchangedRuns, 1);
  assert.equal(result.indexedRuns, 0);
  assert.deepEqual(await fs.readFile(stagePath), before);
});

test("history reads are strictly read-only and need no config, source, or browser", async (t) => {
  const f = await fixture(t);
  const db = await f.open();
  await db.registerTarget(f.target());
  await f.write("stage", "run-a");
  await db.indexTarget("stage");
  const before = await fs.readFile(f.path);
  const names = await fs.readdir(f.root);
  const stat = await fs.stat(f.path, { bigint: true });
  await fs.chmod(f.path, 0o400);
  const reader = await f.open(false);
  await reader.listTargets();
  await reader.getTarget("stage");
  await reader.listRuns({ targetId: "stage" });
  await reader.getRun({ targetId: "stage", runId: "run-a" });
  await reader.close();
  assert.deepEqual(await fs.readFile(f.path), before);
  assert.deepEqual(await fs.readdir(f.root), names);
  assert.equal((await fs.stat(f.path, { bigint: true })).mtimeNs, stat.mtimeNs);
  await fs.chmod(f.path, 0o600);
});

test("keyset cursors are target and generation bound and rebuild preserves authoritative registration", async (t) => {
  const f = await fixture(t);
  const db = await f.open();
  await db.registerTarget(f.target());
  await db.registerTarget(f.target("production"));
  for (let i = 0; i < 3; i++)
    await f.write("stage", `run-${i}`, { date: `2026-11-10T10:0${i}:00.000Z` });
  await db.indexTarget("stage");
  const catalog = await db.listTargets();
  const page = await db.listRuns({ targetId: "stage", limit: 1 });
  assert.equal(page.items[0].runId, "run-2");
  assert.ok(page.nextCursor);
  assert.equal(
    (
      await db.listRuns({
        targetId: "stage",
        limit: 1,
        cursor: page.nextCursor,
      })
    ).items[0].runId,
    "run-1",
  );
  await assert.rejects(
    db.listRuns({ targetId: "production", cursor: page.nextCursor }),
    { code: "catalog_cursor" },
  );
  await db.indexTarget("stage", { rebuild: true });
  assert.deepEqual(await db.listTargets(), catalog);
  await assert.rejects(
    db.listRuns({ targetId: "stage", cursor: page.nextCursor }),
    { code: "catalog_cursor" },
  );
  assert.equal((await db.listRuns({ targetId: "stage" })).items.length, 3);
});

test("partial, malformed, unsupported, changed and missing journals never retain projected success", async (t) => {
  const f = await fixture(t);
  const db = await f.open();
  await db.registerTarget(f.target());
  const paths = {};
  for (const id of ["partial", "malformed", "future", "changed", "missing"])
    paths[id] = await f.write("stage", id);
  await db.indexTarget("stage");
  await fs.appendFile(paths.partial, '{"unfinished":');
  await fs.appendFile(paths.malformed, "not json\n");
  const future = await fs.readFile(paths.future, "utf8");
  await fs.writeFile(
    paths.future,
    future.replaceAll("daedlo-run-journal/1", "daedlo-run-journal/9"),
  );
  const changed = await fs.readFile(paths.changed, "utf8");
  await fs.writeFile(
    paths.changed,
    changed.replace('"command":"save"', '"command":"evil"'),
  );
  await fs.unlink(paths.missing);
  await db.indexTarget("stage");
  const rows = Object.fromEntries(
    (await db.listRuns({ targetId: "stage" })).items.map((row) => [
      row.runId,
      row,
    ]),
  );
  assert.equal(rows.partial.status, "incomplete");
  for (const id of ["malformed", "future", "changed"])
    assert.equal(rows[id].status, "corrupt");
  assert.equal(rows.missing.status, "missing");
  for (const row of Object.values(rows)) {
    assert.equal(row.historyComplete, false);
    assert.notEqual(row.effect?.status, "saved");
  }
  await assert.rejects(db.getRun({ targetId: "stage", runId: "changed" }), {
    code: "catalog_source_changed",
  });
});

test("new unknown journal format is unsupported without rewriting source", async (t) => {
  const f = await fixture(t);
  const db = await f.open();
  await db.registerTarget(f.target());
  const path = await f.write("stage", "future");
  await fs.writeFile(
    path,
    (await fs.readFile(path, "utf8")).replaceAll(
      "daedlo-run-journal/1",
      "daedlo-run-journal/9",
    ),
  );
  const bytes = await fs.readFile(path);
  await db.indexTarget("stage");
  assert.equal(
    (await db.listRuns({ targetId: "stage" })).items[0].status,
    "unsupported",
  );
  assert.deepEqual(await fs.readFile(path), bytes);
});

test("future SQL versions and replaced database/workspace ownership fail before writes", async (t) => {
  const f = await fixture(t);
  const db = await f.open();
  await db.registerTarget(f.target());
  const sql = new DatabaseSync(f.path);
  sql.exec("PRAGMA user_version=99");
  sql.close();
  const bytes = await fs.readFile(f.path);
  await assert.rejects(db.registerTarget(f.target("other")), {
    code: "catalog_incompatible",
  });
  assert.deepEqual(await fs.readFile(f.path), bytes);
  await assert.rejects(f.open(false), { code: "catalog_incompatible" });
});

test("projection rows and checkpoints roll back together on a transaction failure", async (t) => {
  const f = await fixture(t);
  const db = await f.open();
  await db.registerTarget(f.target());
  await f.write("stage", "run-a");
  await db.indexTarget("stage");
  await f.write("stage", "run-b");
  const before = await db.listRuns({ targetId: "stage" });
  const exec = DatabaseSync.prototype.exec;
  const writing = new WeakSet();
  const prepare = DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare = function (sql) {
    const statement = prepare.call(this, sql);
    const owner = this;
    if (sql.startsWith("INSERT INTO runs")) {
      const run = statement.run;
      statement.run = function (...args) {
        const result = run.apply(this, args);
        writing.add(owner);
        return result;
      };
    }
    return statement;
  };
  DatabaseSync.prototype.exec = function (sql) {
    if (sql === "COMMIT" && writing.has(this))
      throw Object.assign(Error("injected commit failure"), {
        code: "SQLITE_IOERR",
      });
    const result = exec.call(this, sql);
    if (sql === "ROLLBACK") writing.delete(this);
    return result;
  };
  try {
    await assert.rejects(db.indexTarget("stage"), { code: "catalog_storage" });
  } finally {
    DatabaseSync.prototype.exec = exec;
    DatabaseSync.prototype.prepare = prepare;
  }
  assert.deepEqual(await db.listRuns({ targetId: "stage" }), before);
  await db.indexTarget("stage");
  assert.equal((await db.listRuns({ targetId: "stage" })).items.length, 2);
});

test("pages use indexed rows without reading historical journal files", async (t) => {
  const f = await fixture(t);
  const db = await f.open();
  await db.registerTarget(f.target());
  await f.write("stage", "run-a");
  await db.indexTarget("stage");
  const open = fs.open;
  fs.open = async function (path, ...args) {
    if (String(path).endsWith(".jsonl")) throw Error("history scan forbidden");
    return open.call(this, path, ...args);
  };
  try {
    assert.equal((await db.listRuns({ targetId: "stage" })).items.length, 1);
  } finally {
    fs.open = open;
  }
});

test("invalid identities, overlapping stores and symlink databases are refused", async (t) => {
  const f = await fixture(t);
  const db = await f.open();
  await assert.rejects(db.registerTarget({ ...f.target(), id: "../outside" }), {
    code: "target_invalid",
  });
  await assert.rejects(
    db.registerTarget({
      ...f.target(),
      origin: "http://user:secret@example.test/",
    }),
    { code: "target_invalid" },
  );
  await assert.rejects(
    db.registerTarget({ ...f.target(), store: join(f.root, "store") }),
    { code: "workspace_path" },
  );
  await db.close();
  await fs.rename(f.path, f.path + ".retained");
  await fs.symlink(f.path + ".retained", f.path);
  await assert.rejects(f.open(false), { code: "catalog_ownership_changed" });
});

test("explicit registration revisions preserve old evidence and invalidate prior cursors", async (t) => {
  const f = await fixture(t);
  const db = await f.open();
  await db.registerTarget(f.target());
  await f.write("stage", "old-a");
  await f.write("stage", "old-b");
  await db.indexTarget("stage");
  const page = await db.listRuns({ targetId: "stage", limit: 1 });
  const changed = {
    ...f.target(),
    label: "Updated integration",
    configSha256: "c".repeat(64),
    sourceSha256: "d".repeat(64),
    model: { id: "fixture", version: "2" },
  };
  assert.equal(
    typeof db.reviseTarget,
    "function",
    "catalog must expose explicit revision CAS",
  );
  assert.deepEqual(await db.reviseTarget(changed, { expectedRevision: 1 }), {
    ...changed,
    revision: 2,
  });
  assert.deepEqual(await db.getTarget("stage"), { ...changed, revision: 2 });
  await assert.rejects(db.reviseTarget(changed, { expectedRevision: 1 }), {
    code: "target_conflict",
  });
  await assert.rejects(
    db.reviseTarget(
      { ...changed, origin: "https://other.example" },
      { expectedRevision: 2 },
    ),
    { code: "target_conflict" },
  );
  await assert.rejects(
    db.listRuns({ targetId: "stage", cursor: page.nextCursor }),
    { code: "catalog_cursor" },
  );
  assert.deepEqual(
    (await db.getRun({ targetId: "stage", runId: "old-a" })).report,
    report("old-a"),
  );
  const sql = new DatabaseSync(f.path, { readOnly: true });
  const revisions = sql
    .prepare(
      "SELECT revision,registration FROM target_revisions ORDER BY revision",
    )
    .all();
  sql.close();
  assert.deepEqual(
    revisions.map((row) => ({
      revision: row.revision,
      ...JSON.parse(row.registration),
    })),
    [
      { revision: 1, ...f.target() },
      { revision: 2, ...changed },
    ],
  );
  await db.indexTarget("stage", { rebuild: true });
  const after = new DatabaseSync(f.path, { readOnly: true });
  assert.deepEqual(
    after
      .prepare(
        "SELECT revision,registration FROM target_revisions ORDER BY revision",
      )
      .all(),
    revisions,
  );
  after.close();
});

test("unexpected SQL triggers are refused before projection can mutate authoritative records", async (t) => {
  const f = await fixture(t);
  const db = await f.open();
  await db.registerTarget(f.target());
  await f.write("stage", "run-a");
  const sql = new DatabaseSync(f.path);
  sql.exec(
    "CREATE TRIGGER unsafe_history AFTER INSERT ON runs BEGIN DELETE FROM targets; END",
  );
  sql.close();
  const before = await fs.readFile(f.path);
  await assert.rejects(db.indexTarget("stage"), {
    code: "catalog_incompatible",
  });
  assert.deepEqual(await fs.readFile(f.path), before);
});

test("a killed SQLite transaction is recovered only by explicit indexing, without partial rows or lost registration", async (t) => {
  const f = await fixture(t);
  const db = await f.open();
  await db.registerTarget(f.target());
  await f.write("stage", "run-a");
  await db.indexTarget("stage");
  const before = await db.listRuns({ targetId: "stage" });
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import {DatabaseSync} from "node:sqlite";
    const db=new DatabaseSync(${JSON.stringify(f.path)});
    db.exec("PRAGMA cache_size=1; PRAGMA synchronous=EXTRA; BEGIN IMMEDIATE");
    const catalogId=db.prepare("SELECT catalog_id FROM catalog_meta").get().catalog_id;
    const guard=db.prepare("UPDATE catalog_meta SET catalog_id=? WHERE singleton=1");guard.run((catalogId[0]==='0'?'1':'0')+catalogId.slice(1));guard.run(catalogId);
    const insert=db.prepare("INSERT INTO runs SELECT target_id,?,sort_at,?,source_dev,source_ino,source_size,source_hash,checkpoint_offset,checkpoint_hash,checkpoint_sequence FROM runs WHERE run_id='run-a'");
    for(let i=0;i<100;i++)insert.run('uncommitted-'+i,'x'.repeat(16000));
    db.exec("UPDATE history_state SET generation=999");
    process.stdout.write("ready");setInterval(()=>{},1000);
  `,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("child transaction did not reach crash barrier")),
      10000,
    );
    child.stdout.once("data", () => {
      clearTimeout(timer);
      resolve();
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(Error(`transaction child exited ${code}`));
    });
  });
  child.kill("SIGKILL");
  await exited;
  assert.ok((await fs.stat(f.path + "-journal")).size > 0);
  const pending = await fs.readFile(f.path);
  const rollback = await fs.readFile(f.path + "-journal");
  const probe = new DatabaseSync(f.path, { readOnly: true });
  try {
    assert.throws(() => probe.prepare("SELECT * FROM targets").all(), {
      errcode: 776,
    });
  } finally {
    probe.close();
  }
  // A foreign hot rollback journal alone must not gain the authority to undo
  // the otherwise unchanged local database.
  const journalOnly = await fixture(t);
  await journalOnly.open();
  const localBytes = await fs.readFile(journalOnly.path);
  await fs.copyFile(f.path + "-journal", journalOnly.path + "-journal");
  await assert.rejects(journalOnly.open(false), {
    code: "catalog_ownership_changed",
  });
  assert.deepEqual(await fs.readFile(journalOnly.path), localBytes);
  assert.deepEqual(await fs.readFile(journalOnly.path + "-journal"), rollback);
  // Overwrite an existing owned inode with a different catalog and its hot
  // journal. The independent metadata-page binding must refuse before rollback.
  const other = await fixture(t);
  await other.open();
  const otherInode = (await fs.stat(other.path, { bigint: true })).ino;
  await fs.copyFile(f.path, other.path);
  await fs.copyFile(f.path + "-journal", other.path + "-journal");
  assert.equal((await fs.stat(other.path, { bigint: true })).ino, otherInode);
  const foreignBytes = await fs.readFile(other.path),
    foreignJournal = await fs.readFile(other.path + "-journal");
  await assert.rejects(other.open(false), {
    code: "catalog_ownership_changed",
  });
  assert.deepEqual(await fs.readFile(other.path), foreignBytes);
  assert.deepEqual(await fs.readFile(other.path + "-journal"), foreignJournal);
  const ownership = JSON.parse(await fs.readFile(f.path + ".owner.json"));
  const offset = ownership.metadataPage.offset,
    size = ownership.metadataPage.size;
  const wrongPage = (await fs.readFile(journalOnly.path)).subarray(
    offset,
    offset + size,
  );
  const altered = await fs.open(f.path, "r+");
  await altered.write(wrongPage, 0, size, offset);
  await altered.close();
  const mixed = await fs.readFile(f.path);
  await assert.rejects(f.open(false), { code: "catalog_ownership_changed" });
  assert.deepEqual(await fs.readFile(f.path), mixed);
  assert.deepEqual(await fs.readFile(f.path + "-journal"), rollback);
  const restore = await fs.open(f.path, "r+");
  await restore.write(pending.subarray(offset, offset + size), 0, size, offset);
  await restore.close();
  const reader = await f.open(false);
  await assert.rejects(reader.listRuns({ targetId: "stage" }), {
    code: "catalog_recovery_required",
  });
  assert.deepEqual(await fs.readFile(f.path), pending);
  assert.deepEqual(await fs.readFile(f.path + "-journal"), rollback);
  await reader.indexTarget("stage");
  const after = await reader.listRuns({ targetId: "stage" });
  assert.equal(after.items.length, 1);
  assert.equal(after.items[0].runId, "run-a");
  assert.equal(after.generation, before.generation + 1);
  assert.deepEqual(await reader.getTarget("stage"), {
    ...f.target(),
    revision: 1,
  });
});

test("partial tails checkpoint only committed records and later complete without duplicate history", async (t) => {
  const f = await fixture(t);
  const db = await f.open();
  await db.registerTarget(f.target());
  const path = await f.write("stage", "growing");
  const bytes = await fs.readFile(path);
  const offset = bytes.indexOf(10) + 1;
  await fs.truncate(path, offset);
  await db.indexTarget("stage");
  const checkpoint = () => {
    const sql = new DatabaseSync(f.path, { readOnly: true });
    try {
      return sql
        .prepare("SELECT checkpoint_offset,checkpoint_sequence FROM runs")
        .get();
    } finally {
      sql.close();
    }
  };
  assert.deepEqual(
    { ...checkpoint() },
    { checkpoint_offset: offset, checkpoint_sequence: 1 },
  );
  const split = offset + 10;
  await fs.appendFile(path, bytes.subarray(offset, split));
  await db.indexTarget("stage");
  assert.deepEqual(
    { ...checkpoint() },
    { checkpoint_offset: offset, checkpoint_sequence: 1 },
  );
  assert.equal(
    (await db.getRun({ targetId: "stage", runId: "growing" })).partialTail,
    true,
  );
  await fs.appendFile(path, bytes.subarray(split));
  await db.indexTarget("stage");
  assert.deepEqual(
    { ...checkpoint() },
    { checkpoint_offset: bytes.length, checkpoint_sequence: 2 },
  );
  const item = (await db.listRuns({ targetId: "stage" })).items[0];
  assert.equal(item.status, "finished");
  assert.equal(item.eventCount, 2);
});

test("competing projections cannot overwrite a newer generation or newly approved target revision", async (t) => {
  const f = await fixture(t);
  const db = await f.open();
  await db.registerTarget(f.target());
  const path = await f.write("stage", "run-a");
  const originalOpen = fs.open;
  let release, entered;
  const reached = new Promise((resolve) => (entered = resolve));
  const hold = new Promise((resolve) => (release = resolve));
  let blocked = false;
  fs.open = async function (file, ...args) {
    if (file === path && !blocked) {
      blocked = true;
      entered();
      await hold;
    }
    return originalOpen.call(this, file, ...args);
  };
  let pending;
  try {
    pending = db.indexTarget("stage", { expectedRevision: 1 });
    await reached;
    await db.reviseTarget(
      { ...f.target(), label: "new revision" },
      { expectedRevision: 1 },
    );
    release();
    await assert.rejects(pending, { code: "catalog_changed" });
    assert.deepEqual((await db.listRuns({ targetId: "stage" })).items, []);
  } finally {
    release();
    fs.open = originalOpen;
    await pending?.catch(() => {});
  }
  await assert.rejects(db.indexTarget("stage", { expectedRevision: 1 }), {
    code: "catalog_changed",
  });
  const results = await Promise.allSettled([
    db.indexTarget("stage", { expectedRevision: 2 }),
    db.indexTarget("stage", { expectedRevision: 2 }),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.find((result) => result.status === "rejected").reason.code,
    "catalog_changed",
  );
  assert.equal((await db.listRuns({ targetId: "stage" })).items.length, 1);
});

test("cursor anchors must match the indexed source identity and cannot invent skipped runs", async (t) => {
  const f = await fixture(t);
  const db = await f.open();
  await db.registerTarget(f.target());
  await f.write("stage", "a");
  await f.write("stage", "b");
  await db.indexTarget("stage");
  const cursor = (await db.listRuns({ targetId: "stage", limit: 1 }))
    .nextCursor;
  const anchor = JSON.parse(Buffer.from(cursor, "base64url"));
  anchor.runId = "absent";
  await assert.rejects(
    db.listRuns({
      targetId: "stage",
      cursor: Buffer.from(JSON.stringify(anchor)).toString("base64url"),
    }),
    { code: "catalog_cursor" },
  );
  anchor.runId = "b";
  anchor.source = "0".repeat(64);
  await assert.rejects(
    db.listRuns({
      targetId: "stage",
      cursor: Buffer.from(JSON.stringify(anchor)).toString("base64url"),
    }),
    { code: "catalog_cursor" },
  );
});

test("manager stores cannot overlap another target store or authored source", async (t) => {
  const f = await fixture(t);
  const db = await f.open();
  await db.registerTarget(f.target());
  await assert.rejects(
    db.registerTarget({
      ...f.target("production"),
      store: join(f.target().store, "nested"),
    }),
    { code: "target_conflict" },
  );
  await assert.rejects(
    db.registerTarget({
      ...f.target("production"),
      store: join(f.target().sourceRoot, "data"),
    }),
    { code: "target_conflict" },
  );
  await assert.rejects(
    db.registerTarget({
      ...f.target("production"),
      sourceRoot: join(f.target().store, "code"),
    }),
    { code: "target_conflict" },
  );
});

test("an empty registered target indexes without creating journal directories", async (t) => {
  const f = await fixture(t);
  const db = await f.open();
  await db.registerTarget(f.target());
  const before = await fs.readdir(f.root);
  assert.equal((await db.indexTarget("stage")).indexedRuns, 0);
  assert.deepEqual(await fs.readdir(f.root), before);
  assert.deepEqual((await db.listRuns({ targetId: "stage" })).items, []);
});

test("projection bounds and changed immutable metadata preserve authority", async (t) => {
  const f = await fixture(t);
  const db = await f.open();
  await db.registerTarget(f.target());
  await assert.rejects(db.listRuns({ targetId: "stage", limit: 101 }), {
    code: "catalog_limit",
  });
  const sql = new DatabaseSync(f.path);
  sql.exec("UPDATE catalog_meta SET projection_version=99");
  sql.close();
  const before = await fs.readFile(f.path);
  await assert.rejects(db.indexTarget("stage", { rebuild: true }), {
    code: "catalog_ownership_changed",
  });
  assert.deepEqual(await fs.readFile(f.path), before);
});

test("replaced database inode is refused and a vanished database is never recreated", async (t) => {
  const f = await fixture(t);
  const db = await f.open();
  await db.registerTarget(f.target());
  await fs.rename(f.path, f.path + ".retained");
  await fs.copyFile(f.path + ".retained", f.path);
  const replacement = await fs.readFile(f.path);
  await assert.rejects(db.indexTarget("stage"), {
    code: "catalog_ownership_changed",
  });
  assert.deepEqual(await fs.readFile(f.path), replacement);
  await fs.unlink(f.path);
  await assert.rejects(db.registerTarget(f.target("other")), {
    code: "catalog_ownership_changed",
  });
  await assert.rejects(fs.stat(f.path), { code: "ENOENT" });
});

test("generated thousand-run workload pages are bounded SQL reads without journal scans", async (t) => {
  const f = await fixture(t);
  const db = await f.open();
  await db.registerTarget(f.target());
  const original = await f.write("stage", "generated-0000");
  const template = await fs.readFile(original, "utf8");
  const directory = join(
    f.root,
    "projects",
    f.target().projectId,
    "run-journals",
  );
  for (let i = 1; i < 1000; i++) {
    const id = `generated-${String(i).padStart(4, "0")}`;
    await fs.writeFile(
      join(directory, id + ".jsonl"),
      template.replaceAll("generated-0000", id),
      { mode: 0o600 },
    );
  }
  const began = performance.now();
  const indexed = await db.indexTarget("stage");
  const indexMs = performance.now() - began;
  assert.equal(indexed.indexedRuns, 1000);
  const originalOpen = fs.open;
  let journalReads = 0;
  fs.open = async function (path, ...args) {
    if (String(path).endsWith(".jsonl")) {
      journalReads++;
      throw Error("unexpected page journal scan");
    }
    return originalOpen.call(this, path, ...args);
  };
  const beforeMemory = process.memoryUsage().heapUsed;
  const pageStart = performance.now();
  let first, second;
  try {
    first = await db.listRuns({ targetId: "stage", limit: 25 });
    second = await db.listRuns({
      targetId: "stage",
      limit: 25,
      cursor: first.nextCursor,
    });
  } finally {
    fs.open = originalOpen;
  }
  const pageMs = performance.now() - pageStart;
  assert.equal(first.items.length, 25);
  assert.equal(second.items.length, 25);
  assert.equal(journalReads, 0);
  assert.equal(
    new Set([...first.items, ...second.items].map((row) => row.runId)).size,
    50,
  );
  t.diagnostic(
    JSON.stringify({
      workload: "generated fixture, not customer usage",
      runs: 1000,
      events: 2000,
      indexMs: Number(indexMs.toFixed(2)),
      indexedSourceBytesRead: indexed.bytesRead,
      twoPages: 50,
      pageMs: Number(pageMs.toFixed(2)),
      heapDeltaBytes: process.memoryUsage().heapUsed - beforeMemory,
      journalReads,
    }),
  );
});

test("rebuild retains the original journal inode binding after a byte-identical replacement", async (t) => {
  const f = await fixture(t);
  const db = await f.open();
  await db.registerTarget(f.target());
  const path = await f.write("stage", "original");
  await db.indexTarget("stage");
  const bytes = await fs.readFile(path);
  await fs.rename(path, path + ".retained");
  await fs.writeFile(path, bytes, { mode: 0o600 });
  await db.indexTarget("stage");
  assert.equal(
    (await db.listRuns({ targetId: "stage" })).items[0].status,
    "corrupt",
  );
  await db.indexTarget("stage", { rebuild: true });
  assert.equal(
    (await db.listRuns({ targetId: "stage" })).items[0].status,
    "corrupt",
  );
  await assert.rejects(db.getRun({ targetId: "stage", runId: "original" }), {
    code: "catalog_source_changed",
  });
  assert.deepEqual(await fs.readFile(path + ".retained"), bytes);
  assert.deepEqual(await fs.readFile(path), bytes);
});

test("malformed derived summaries, checkpoints and state refuse false completion", async (t) => {
  const f = await fixture(t);
  const db = await f.open();
  await db.registerTarget(f.target());
  await f.write("stage", "run-a");
  await db.indexTarget("stage");
  const sql = new DatabaseSync(f.path);
  const original = sql.prepare("SELECT * FROM runs").get();
  const state = sql.prepare("SELECT * FROM history_state").get();
  sql.prepare("UPDATE runs SET summary=?").run(
    JSON.stringify({
      ...JSON.parse(original.summary),
      runId: "different-run",
    }),
  );
  await assert.rejects(db.listRuns({ targetId: "stage" }), {
    code: "catalog_corrupt",
  });
  await assert.rejects(db.indexTarget("stage"), { code: "catalog_corrupt" });
  sql
    .prepare("UPDATE runs SET summary=?,checkpoint_hash='bad'")
    .run(original.summary);
  await assert.rejects(db.getRun({ targetId: "stage", runId: "run-a" }), {
    code: "catalog_corrupt",
  });
  sql
    .prepare("UPDATE runs SET checkpoint_hash=?")
    .run(original.checkpoint_hash);
  sql.exec("UPDATE history_state SET generation=-1");
  await assert.rejects(db.listRuns({ targetId: "stage" }), {
    code: "catalog_corrupt",
  });
  sql
    .prepare("UPDATE history_state SET generation=?,indexed_at=?")
    .run(state.generation, state.indexed_at);
  sql.prepare("UPDATE runs SET summary=?").run(
    JSON.stringify({
      ...JSON.parse(original.summary),
      status: "incomplete",
      historyComplete: true,
    }),
  );
  await assert.rejects(db.listRuns({ targetId: "stage" }), {
    code: "catalog_corrupt",
  });
  sql.close();
});

test("an immutable owner receipt binds initialization and missing receipt never adopts a database", async (t) => {
  const f = await fixture(t);
  const db = await f.open();
  const ownerPath = f.path + ".owner.json";
  assert.ok(
    (await fs.readdir(f.root)).includes("workspace.sqlite.owner.json"),
    "catalog initialization must publish an independent ownership receipt",
  );
  const receipt = await fs.readFile(ownerPath);
  await db.registerTarget(f.target());
  await f.write("stage", "run-a");
  await db.indexTarget("stage", { rebuild: true });
  assert.deepEqual(await fs.readFile(ownerPath), receipt);
  await fs.rename(ownerPath, ownerPath + ".retained");
  const bytes = await fs.readFile(f.path);
  await assert.rejects(f.open(false), { code: "catalog_unowned" });
  await assert.rejects(f.open(true), { code: "catalog_unowned" });
  assert.deepEqual(await fs.readFile(f.path), bytes);
});

test("interrupted owner publication and concurrent initializers preserve the winning database", async (t) => {
  const f = await fixture(t);
  const link = fs.link;
  fs.link = async function (source, destination) {
    if (destination === f.path + ".owner.json")
      throw Object.assign(Error("injected owner publication failure"), {
        code: "EIO",
      });
    return link.call(this, source, destination);
  };
  try {
    await assert.rejects(f.open(), { code: "catalog_storage" });
  } finally {
    fs.link = link;
  }
  const bytes = await fs.readFile(f.path);
  await assert.rejects(f.open(), { code: "catalog_unowned" });
  assert.deepEqual(await fs.readFile(f.path), bytes);
  const second = await fixture(t);
  const outcomes = await Promise.allSettled([second.open(), second.open()]);
  assert.ok(outcomes.some((result) => result.status === "fulfilled"));
  for (const result of outcomes)
    if (result.status === "rejected")
      assert.match(result.reason.code, /^catalog_/);
  const accepted = await second.open(false);
  await accepted.registerTarget(second.target());
  assert.equal((await accepted.listTargets()).length, 1);
});

test("future ownership formats refuse before any SQLite connection", async (t) => {
  const f = await fixture(t);
  await f.open();
  const ownerPath = f.path + ".owner.json";
  const owner = JSON.parse(await fs.readFile(ownerPath));
  owner.projectionVersion = 99;
  await fs.writeFile(ownerPath, JSON.stringify(owner));
  const bytes = await fs.readFile(f.path);
  await assert.rejects(f.open(false), { code: "catalog_incompatible" });
  assert.deepEqual(await fs.readFile(f.path), bytes);
});

test("initialization never adopts an orphan SQLite sidecar", async (t) => {
  const f = await fixture(t);
  const journal = f.path + "-journal";
  await fs.writeFile(journal, "unowned recovery bytes");
  await assert.rejects(f.open(), { code: "catalog_unowned" });
  assert.equal(await fs.readFile(journal, "utf8"), "unowned recovery bytes");
  await assert.rejects(fs.stat(f.path), { code: "ENOENT" });
});

for (const phase of [0, 1, 2])
  test(`catalog process loss at ownership guard boundary ${phase} preserves registration`, async (t) => {
    const f = await fixture(t);
    const db = await f.open();
    await db.registerTarget(f.target());
    const moduleURL = new URL(
      "../packages/universal/src/catalog.mjs",
      import.meta.url,
    ).href;
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
    import {DatabaseSync} from 'node:sqlite';import {writeSync} from 'node:fs';
    const {openCatalog}=await import(${JSON.stringify(moduleURL)});
    const catalog=await openCatalog({root:${JSON.stringify(f.root)}});
    const stop=()=>{writeSync(1,'ready');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};
    const exec=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){const result=exec.call(this,sql);if(sql==='BEGIN IMMEDIATE' && ${phase}===0)stop();return result;};
    let writes=0;const prepare=DatabaseSync.prototype.prepare;DatabaseSync.prototype.prepare=function(sql){const statement=prepare.call(this,sql);if(sql==='UPDATE catalog_meta SET catalog_id=? WHERE singleton=1'){const run=statement.run;statement.run=function(...args){const result=run.apply(this,args);if(++writes===${phase})stop();return result;};}return statement;};
    await catalog.registerTarget(${JSON.stringify(f.target())});throw Error('guard barrier not reached');
  `,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const exited = new Promise((resolve) => child.once("exit", resolve));
    t.after(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(Error("guard child did not reach boundary")),
        10000,
      );
      child.stdout.once("data", () => {
        clearTimeout(timeout);
        resolve();
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        clearTimeout(timeout);
        reject(Error(`guard child exited ${code}`));
      });
    });
    child.kill("SIGKILL");
    await exited;
    const before = await fs.readFile(f.path);
    const journalBefore = await fs
      .readFile(f.path + "-journal")
      .catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
    const reader = await f.open(false);
    try {
      assert.deepEqual(await reader.getTarget("stage"), {
        ...f.target(),
        revision: 1,
      });
    } catch (error) {
      assert.equal(error.code, "catalog_recovery_required");
    }
    assert.deepEqual(await fs.readFile(f.path), before);
    assert.deepEqual(
      await fs.readFile(f.path + "-journal").catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      }),
      journalBefore,
    );
    await reader.indexTarget("stage");
    assert.deepEqual(await reader.getTarget("stage"), {
      ...f.target(),
      revision: 1,
    });
  });

test("incomplete rollback ownership proof is preserved without opening SQLite", async (t) => {
  const f = await fixture(t);
  await f.open();
  const journal = f.path + "-journal";
  await fs.writeFile(journal, Buffer.alloc(10));
  const before = await fs.readFile(f.path);
  await assert.rejects(f.open(false), { code: "catalog_rollback_unproven" });
  assert.deepEqual(await fs.readFile(f.path), before);
  assert.deepEqual(await fs.readFile(journal), Buffer.alloc(10));
});

test("frozen public R3 v1 data reads unchanged and rebuilds only after explicit preserved upgrade", async (t) => {
  const directory = new URL("./fixtures/storage-r3/", import.meta.url);
  const [schema, fixtureBytes, journalBytes] = await Promise.all([
    fs.readFile(new URL("schema-v1.sql", directory), "utf8"),
    fs.readFile(new URL("fixture-v1.json", directory)),
    fs.readFile(new URL("retained-run-v1.jsonl", directory)),
  ]);
  const retained = JSON.parse(fixtureBytes);
  assert.equal(hash(schema), retained.schemaSha256);
  assert.equal(hash(journalBytes), retained.run.journalSha256);
  assert.equal(journalBytes.length, retained.run.checkpointOffset);
  const base = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "daedlo-r3-frozen-v1-")),
  );
  const root = join(base, "workspace");
  let catalog;
  t.after(async () => {
    await catalog?.close();
    await fs.rm(base, { recursive: true, force: true });
  });
  const paths = {
    "@store": join(base, "store"),
    "@source": join(base, "source"),
    "@config": join(base, "config.json"),
  };
  const revisions = retained.revisions.map(({ revision, registration }) => ({
    revision,
    registration: {
      ...registration,
      store: paths[registration.store],
      sourceRoot: paths[registration.sourceRoot],
      configPath: paths[registration.configPath],
    },
  }));
  const current = revisions.at(-1);
  const journalRoot = join(
    root,
    "projects",
    current.registration.projectId,
    "run-journals",
  );
  await fs.mkdir(journalRoot, { recursive: true, mode: 0o700 });
  const manifestBytes = Buffer.from(JSON.stringify(retained.workspace) + "\n");
  await fs.writeFile(join(root, "workspace.json"), manifestBytes, {
    mode: 0o600,
  });
  const journalPath = join(journalRoot, retained.run.runId + ".jsonl");
  await fs.writeFile(journalPath, journalBytes, { mode: 0o600 });
  const sourceIdentity = await fs.stat(journalPath, { bigint: true });
  const databasePath = join(root, "workspace.sqlite");
  const empty = await fs.open(databasePath, "wx", 0o600);
  await empty.close();
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(
      "PRAGMA page_size=4096; PRAGMA journal_mode=DELETE; PRAGMA synchronous=EXTRA; PRAGMA foreign_keys=ON; BEGIN IMMEDIATE",
    );
    database.exec(schema);
    database.exec(
      `PRAGMA application_id=${retained.applicationId}; PRAGMA user_version=${retained.sqlUserVersion}`,
    );
    database
      .prepare("INSERT INTO catalog_meta VALUES(1,?,?,?,?,?)")
      .run(
        retained.catalogFormat,
        retained.catalogVersion,
        retained.projectionVersion,
        retained.workspace.workspaceId,
        retained.catalogId,
      );
    database
      .prepare("INSERT INTO catalog_migrations VALUES(1,?)")
      .run(retained.schemaSha256);
    database
      .prepare("INSERT INTO targets VALUES(?,?,?,?,?,?)")
      .run(
        current.registration.id,
        current.registration.projectId,
        current.registration.store,
        current.registration.authProfileRef,
        current.revision,
        JSON.stringify(current.registration),
      );
    for (const revision of revisions)
      database
        .prepare("INSERT INTO target_revisions VALUES(?,?,?)")
        .run(
          revision.registration.id,
          revision.revision,
          JSON.stringify(revision.registration),
        );
    database
      .prepare("INSERT INTO history_state VALUES(?,?,?)")
      .run(
        current.registration.id,
        retained.historyState.generation,
        retained.historyState.indexedAt,
      );
    database
      .prepare("INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(
        current.registration.id,
        retained.run.runId,
        retained.run.summary.startedAt,
        JSON.stringify(retained.run.summary),
        String(sourceIdentity.dev),
        String(sourceIdentity.ino),
        journalBytes.length,
        retained.run.journalSha256,
        retained.run.checkpointOffset,
        retained.run.journalSha256,
        retained.run.checkpointSequence,
      );
    database.exec("COMMIT");
    assert.equal(
      database
        .prepare("SELECT rootpage FROM sqlite_schema WHERE name='catalog_meta'")
        .get().rootpage,
      2,
    );
  } finally {
    database.close();
  }
  const databaseIdentity = await fs.stat(databasePath, { bigint: true });
  const owner = {
    format: "daedlo-universal-owner/1",
    workspaceId: retained.workspace.workspaceId,
    catalogId: retained.catalogId,
    catalogVersion: retained.catalogVersion,
    projectionVersion: retained.projectionVersion,
    database: {
      dev: String(databaseIdentity.dev),
      ino: String(databaseIdentity.ino),
    },
    metadataPage: {
      offset: 4096,
      size: 4096,
      sha256: hash((await fs.readFile(databasePath)).subarray(4096, 8192)),
    },
  };
  const ownerBytes = Buffer.from(JSON.stringify(owner) + "\n");
  await fs.writeFile(databasePath + ".owner.json", ownerBytes, { mode: 0o600 });
  const readAuthority = () => {
    const db = new DatabaseSync(databasePath, { readOnly: true });
    try {
      return {
        targets: db.prepare("SELECT * FROM targets ORDER BY id").all(),
        revisions: db
          .prepare("SELECT * FROM target_revisions ORDER BY target_id,revision")
          .all(),
        migrations: db
          .prepare("SELECT * FROM catalog_migrations ORDER BY version")
          .all(),
      };
    } finally {
      db.close();
    }
  };
  const authority = readAuthority();
  catalog = await openCatalog({ root, create: false });
  assert.deepEqual(await catalog.getTarget(current.registration.id), {
    ...current.registration,
    revision: 2,
  });
  const before = await catalog.listRuns({ targetId: current.registration.id });
  assert.equal(before.generation, 4);
  assert.deepEqual(before.items, [retained.run.summary]);
  const detail = await catalog.getRun({
    targetId: current.registration.id,
    runId: retained.run.runId,
  });
  assert.deepEqual(detail.report, retained.run.report);
  assert.equal(detail.events[0].payload.installation.model.version, "1");
  assert.equal(
    (await catalog.getTarget(current.registration.id)).model.version,
    "2",
  );
  await assert.rejects(fs.stat(current.registration.configPath), {
    code: "ENOENT",
  });
  await assert.rejects(
    catalog.indexTarget(current.registration.id, { rebuild: true }),
    { code: "catalog_upgrade_required" },
  );
  assert.deepEqual(readAuthority(), authority);
  assert.deepEqual(await fs.readFile(databasePath + ".owner.json"), ownerBytes);
  await catalog.close();
  const upgraded = await upgradeCatalog({ root, toVersion: 2 });
  assert.deepEqual(await fs.readFile(upgraded.backup.owner), ownerBytes);
  catalog = await openCatalog({ root });
  const upgradedAuthority = readAuthority(),
    upgradedOwner = await fs.readFile(databasePath + ".owner.json");
  const rebuilt = await catalog.indexTarget(current.registration.id, {
    rebuild: true,
  });
  assert.equal(rebuilt.generation, 5);
  assert.equal(rebuilt.indexedRuns, 1);
  const after = await catalog.listRuns({ targetId: current.registration.id });
  assert.deepEqual(after.items, [
    { ...retained.run.summary, indexedAt: after.items[0].indexedAt },
  ]);
  assert.deepEqual(readAuthority(), upgradedAuthority);
  assert.deepEqual(
    (
      await catalog.getRun({
        targetId: current.registration.id,
        runId: retained.run.runId,
      })
    ).report,
    retained.run.report,
  );
  assert.deepEqual(await fs.readFile(journalPath), journalBytes);
  assert.deepEqual(
    await fs.readFile(join(root, "workspace.json")),
    manifestBytes,
  );
  assert.deepEqual(
    await fs.readFile(databasePath + ".owner.json"),
    upgradedOwner,
  );
});

test("evidence metadata is immutable, target scoped and bound to real journal provenance", async (t) => {
  const f = await fixture(t),
    catalog = await f.open();
  await catalog.registerTarget(f.target());
  await catalog.registerTarget(f.target("production"));
  await f.write("stage", "evidence-run");
  const history = await catalog.getRun({
    targetId: "stage",
    runId: "evidence-run",
  });
  const first = history.events[0];
  const value = {
    id: "evidence-a",
    targetId: "stage",
    runId: "evidence-run",
    eventSequence: 1,
    eventId: first.eventId,
    label: "Source evidence",
    mediaType: "text/plain",
    sha256: "e".repeat(64),
    bytes: 8,
    createdAt: "2026-11-10T10:00:00.000Z",
    provenance: {
      installationId: "slot-a",
      runtimeVersion: "1.0.0",
      sourceSha256: f.target().sourceSha256,
      model: f.target().model,
    },
  };
  assert.deepEqual(
    await catalog.addEvidence(value, { expectedTargetRevision: 1 }),
    value,
    "committed evidence must return its immutable metadata",
  );
  assert.deepEqual(
    await catalog.addEvidence(value, { expectedTargetRevision: 1 }),
    value,
  );
  await assert.rejects(
    catalog.addEvidence(
      { ...value, label: "Replacement" },
      { expectedTargetRevision: 1 },
    ),
    { code: "evidence_conflict" },
  );
  await assert.rejects(
    catalog.getEvidence({ targetId: "production", evidenceId: value.id }),
    { code: "evidence_not_found" },
  );
  await assert.rejects(
    catalog.addEvidence(
      {
        ...value,
        id: "forged",
        provenance: { ...value.provenance, sourceSha256: "f".repeat(64) },
      },
      { expectedTargetRevision: 1 },
    ),
    { code: "evidence_reference" },
  );
  await assert.rejects(
    catalog.addEvidence(
      { ...value, id: "cross", targetId: "production" },
      { expectedTargetRevision: 1 },
    ),
    (error) => /^(journal_|evidence_)/.test(error.code),
  );
  await assert.rejects(
    catalog.addEvidence(
      { ...value, id: "stale" },
      { expectedTargetRevision: 2 },
    ),
    { code: "target_changed" },
  );
  await catalog.addEvidence(
    { ...value, id: "evidence-b" },
    { expectedTargetRevision: 1 },
  );
  const firstPage = await catalog.listEvidence({ targetId: "stage", limit: 1 });
  assert.equal(firstPage.items.length, 1);
  assert.ok(firstPage.nextCursor);
  assert.deepEqual(
    (
      await catalog.listEvidence({
        targetId: "stage",
        limit: 1,
        cursor: firstPage.nextCursor,
      })
    ).items.map((row) => row.id),
    ["evidence-b"],
  );
  await assert.rejects(
    catalog.listEvidence({
      targetId: "production",
      cursor: firstPage.nextCursor,
    }),
    { code: "catalog_cursor" },
  );
  assert.deepEqual(
    (await catalog.listEvidence({ targetId: "production" })).items,
    [],
  );
});

test("imported history remains separate from journals and survives projection rebuild with stable mixed pagination", async (t) => {
  const f = await fixture(t),
    catalog = await f.open();
  await catalog.registerTarget(f.target());
  await f.write("stage", "journal-a");
  await catalog.indexTarget("stage");
  const existing = await catalog.listRuns({ targetId: "stage", limit: 1 });
  const source = {
    schemaVersion: 1,
    kind: "daedlo-managed-run",
    installation: {
      id: "slot-a",
      version: "1.0.0",
      sourceSha256: f.target().sourceSha256,
      model: f.target().model,
    },
    recordedAt: "2026-11-10T11:00:00.000Z",
    report: report("archive-b"),
  };
  const file = join(f.base, "archive.json");
  await fs.writeFile(file, JSON.stringify(source));
  const imported = await catalog.importManagedArchive({
    targetId: "stage",
    expectedTargetRevision: 1,
    sourceFile: file,
  });
  assert.equal(
    imported.imported,
    true,
    "import must commit its authoritative archive",
  );
  const first = await catalog.listRuns({ targetId: "stage", limit: 1 });
  assert.equal(first.items[0].runId, "archive-b");
  assert.equal(first.items[0].sourceKind, "archive");
  assert.equal(first.items[0].startedAt, null);
  assert.equal(first.items[0].historyComplete, false);
  const second = await catalog.listRuns({
    targetId: "stage",
    limit: 1,
    cursor: first.nextCursor,
  });
  assert.equal(second.items[0].runId, "journal-a");
  assert.equal(second.nextCursor, null);
  await assert.rejects(
    catalog.getRun({ targetId: "stage", runId: "archive-b" }),
    { code: "ENOENT" },
  );
  assert.deepEqual(
    (await catalog.getImportedRun({ targetId: "stage", runId: "archive-b" }))
      .report,
    source.report,
  );
  await catalog.indexTarget("stage", { rebuild: true });
  assert.equal((await catalog.listRuns({ targetId: "stage" })).items.length, 2);
  assert.deepEqual(JSON.parse(await fs.readFile(file)), source);
});

test("journal matching imports is preferred only after exact verification, while conflicting journals preserve retained history", async (t) => {
  const f = await fixture(t),
    catalog = await f.open();
  await catalog.registerTarget(f.target());
  const save = async (runId, payload = report(runId)) => {
    const path = join(f.base, runId + ".json");
    await fs.writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        kind: "daedlo-managed-run",
        installation: {
          id: "slot-a",
          version: "1.0.0",
          sourceSha256: f.target().sourceSha256,
          model: f.target().model,
        },
        recordedAt: "2026-11-10T11:00:00.000Z",
        report: payload,
      }),
    );
    return catalog.importManagedArchive({
      targetId: "stage",
      expectedTargetRevision: 1,
      sourceFile: path,
    });
  };
  await save("match");
  assert.equal(
    (await catalog.listRuns({ targetId: "stage" })).items[0].sourceKind,
    "archive",
  );
  await f.write("stage", "match");
  await catalog.indexTarget("stage");
  let rows = (await catalog.listRuns({ targetId: "stage" })).items;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sourceKind, undefined);
  assert.equal(rows[0].historyComplete, true);
  assert.equal(
    (await catalog.getImportedRun({ targetId: "stage", runId: "match" })).report
      .runId,
    "match",
  );
  const different = report("conflict");
  different.identity = { application: "Different original outcome" };
  await save("conflict", different);
  await f.write("stage", "conflict");
  const before = await fs.readFile(f.path);
  await assert.rejects(catalog.indexTarget("stage", { rebuild: true }), {
    code: "archive_conflict",
  });
  assert.deepEqual(await fs.readFile(f.path), before);
  assert.equal(
    (await catalog.getImportedRun({ targetId: "stage", runId: "conflict" }))
      .report.identity.application,
    "Different original outcome",
  );
});

test("legacy journal cursor shape remains valid until imported history changes", async (t) => {
  const f = await fixture(t),
    catalog = await f.open();
  await catalog.registerTarget(f.target());
  await f.write("stage", "cursor-a");
  await f.write("stage", "cursor-b");
  await catalog.indexTarget("stage");
  const first = await catalog.listRuns({ targetId: "stage", limit: 1 });
  const old = JSON.parse(Buffer.from(first.nextCursor, "base64url"));
  delete old.sourceKind;
  assert.equal(
    (
      await catalog.listRuns({
        targetId: "stage",
        cursor: Buffer.from(JSON.stringify(old)).toString("base64url"),
      })
    ).items.length,
    1,
  );
  const sourceFile = join(f.base, "cursor-archive.json");
  await fs.writeFile(
    sourceFile,
    JSON.stringify({
      schemaVersion: 1,
      kind: "daedlo-managed-run",
      installation: {
        id: "slot-a",
        version: "1.0.0",
        sourceSha256: f.target().sourceSha256,
        model: f.target().model,
      },
      recordedAt: "2026-11-10T11:00:00.000Z",
      report: report("cursor-import"),
    }),
  );
  await catalog.importManagedArchive({
    targetId: "stage",
    expectedTargetRevision: 1,
    sourceFile,
  });
  await assert.rejects(
    catalog.listRuns({ targetId: "stage", cursor: first.nextCursor }),
    { code: "catalog_cursor" },
  );
});

test("retained archive reappears when its previously matching journal becomes missing", async (t) => {
  const f = await fixture(t),
    catalog = await f.open();
  await catalog.registerTarget(f.target());
  const journal = await f.write("stage", "retained-copy");
  await catalog.indexTarget("stage");
  const sourceFile = join(f.base, "retained-copy.json");
  await fs.writeFile(
    sourceFile,
    JSON.stringify({
      schemaVersion: 1,
      kind: "daedlo-managed-run",
      installation: {
        id: "slot-a",
        version: "1.0.0",
        sourceSha256: f.target().sourceSha256,
        model: f.target().model,
      },
      recordedAt: "2026-11-10T11:00:00.000Z",
      report: report("retained-copy"),
    }),
  );
  await catalog.importManagedArchive({
    targetId: "stage",
    expectedTargetRevision: 1,
    sourceFile,
  });
  assert.equal((await catalog.listRuns({ targetId: "stage" })).items.length, 1);
  await fs.unlink(journal);
  await catalog.indexTarget("stage", { rebuild: true });
  const items = (await catalog.listRuns({ targetId: "stage" })).items;
  assert.equal(
    items.filter((item) => item.sourceKind === "archive").length,
    1,
    "retained report must remain visible when canonical history is missing",
  );
  assert.equal(
    items.find((item) => item.sourceKind !== "archive").status,
    "missing",
  );
});
