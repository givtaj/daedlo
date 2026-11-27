import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { materializeV1 } from "./fixtures/storage-r3/materialize.mjs";
import {
  openCatalog,
  upgradeCatalog,
} from "../packages/universal/src/catalog.mjs";

async function fixture(t) {
  const base = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "daedlo-r5a-migration-")),
  );
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  return { base, ...(await materializeV1(base)) };
}
function retained(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return Object.fromEntries(
      [
        "targets",
        "target_revisions",
        "runs",
        "history_state",
        "evidence",
        "knowledge_records",
        "knowledge_revisions",
        "knowledge_reviews",
      ].map((name) => [name, db.prepare(`SELECT * FROM ${name}`).all()]),
    );
  } finally {
    db.close();
  }
}

async function prepareV2(t) {
  const f = await fixture(t);
  await upgradeCatalog({ root: f.root, toVersion: 2 });
  const catalog = await openCatalog({ root: f.root });
  const original = f.revisions[0].registration;
  const target = await catalog.reviseTarget(
    {
      ...f.current,
      sourceSha256: original.sourceSha256,
      model: original.model,
    },
    { expectedRevision: 2 },
  );
  const history = await catalog.getRun({
      targetId: target.id,
      runId: f.retained.run.runId,
    }),
    installation = history.events[0].payload.installation;
  const evidence = {
    id: "retained-r4-evidence",
    targetId: target.id,
    runId: history.runId,
    eventSequence: 1,
    eventId: history.events[0].eventId,
    label: "Retained synthetic metadata",
    mediaType: "text/plain",
    bytes: 0,
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    createdAt: "2026-11-10T10:00:00.000Z",
    provenance: {
      installationId: installation.id,
      runtimeVersion: installation.version,
      sourceSha256: installation.sourceSha256,
      model: installation.model,
    },
  };
  await catalog.addEvidence(evidence, {
    expectedTargetRevision: target.revision,
  });
  let record = await catalog.createRecord({
    targetId: target.id,
    kind: "knowledge",
    title: "Retained R4 knowledge",
    body: "Original accepted content",
    refs: [{ runId: history.runId }],
    expectedTargetRevision: target.revision,
  });
  await catalog.reviewRecord({
    targetId: target.id,
    recordId: record.id,
    expectedRevision: 1,
    expectedTargetRevision: target.revision,
    decision: "accepted",
  });
  record = await catalog.reviseRecord({
    targetId: target.id,
    recordId: record.id,
    expectedRevision: 1,
    expectedTargetRevision: target.revision,
    title: record.title,
    body: "Revised accepted content",
    refs: [{ runId: history.runId }],
  });
  await catalog.reviewRecord({
    targetId: target.id,
    recordId: record.id,
    expectedRevision: 2,
    expectedTargetRevision: target.revision,
    decision: "accepted",
  });
  await catalog.close();
  return { ...f, target, evidence, record };
}
async function pauseV3(t, root, phase) {
  const { spawn } = await import("node:child_process");
  const source = `import fs from "node:fs/promises";import {upgradeCatalog} from ${JSON.stringify(new URL("../packages/universal/src/catalog.mjs", import.meta.url).href)};
 const phase=${JSON.stringify(phase)},pause=async()=>{setInterval(()=>{},1000);process.stdout.write("READY\\n");await new Promise(()=>{});};
 if(phase.startsWith("linked:")){const original=fs.link;fs.link=async(...args)=>{const value=await original(...args);if(args[1].endsWith("/"+phase.slice(7)))await pause();return value;};}
 await upgradeCatalog({root:${JSON.stringify(root)},onProgress:async value=>{if(value.phase===phase)await pause();}});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "",
    errors = "";
  child.stderr.on("data", (part) => (errors += part));
  const exited = new Promise((resolve) =>
    child.once("exit", (code, signal) => resolve({ code, signal })),
  );
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await exited;
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error(errors || "No migration checkpoint")),
      10000,
    );
    child.stdout.on("data", (part) => {
      output += part;
      if (output.includes("READY\n")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(Error(errors || "Migration exited before checkpoint"));
    });
  });
  return { child, exited };
}

test("explicit schema3 upgrade retains R4 tables and validates the earlier migration receipt chain", async (t) => {
  const f = await prepareV2(t);
  const old = await openCatalog({ root: f.root });
  assert.equal(old.catalogVersion, 2);
  await old.close();
  const before = retained(f.path),
    bytes = await fs.readFile(f.path),
    owner = await fs.readFile(f.path + ".owner.json"),
    journal = await fs.readFile(f.journalPath);
  const result = await upgradeCatalog({ root: f.root });
  assert.equal(
    result.catalogVersion,
    3,
    "R5a must explicitly migrate R4 storage before imports",
  );
  assert.deepEqual(retained(f.path), before);
  assert.deepEqual(await fs.readFile(result.backup.database), bytes);
  assert.deepEqual(await fs.readFile(result.backup.owner), owner);
  assert.deepEqual(await fs.readFile(f.journalPath), journal);
  const current = await openCatalog({ root: f.root });
  assert.equal(current.catalogVersion, 3);
  assert.deepEqual(
    (
      await current.getRun({
        targetId: f.current.id,
        runId: f.retained.run.runId,
      })
    ).report,
    f.retained.run.report,
  );
  assert.equal(
    (await current.getRecord({ targetId: f.target.id, recordId: f.record.id }))
      .revision,
    2,
  );
  assert.equal(
    (await current.getTargetSummary({ targetId: f.target.id })).items.length,
    1,
  );
  assert.deepEqual(
    await current.getEvidence({
      targetId: f.target.id,
      evidenceId: f.evidence.id,
    }),
    f.evidence,
  );
  await current.close();
  assert.equal((await upgradeCatalog({ root: f.root })).upgraded, false);
  await assert.rejects(upgradeCatalog({ root: f.root, toVersion: 2 }), {
    code: "catalog_incompatible",
  });
});

for (const phase of [
  "claimed",
  "snapshot_saved",
  "candidate_saved",
  "prepared",
  "migrating",
  "committed",
  "owner_rebound",
  "linked:claim-0001.json",
  "linked:owner-v2.json",
  "linked:intent.json",
  "linked:complete.json",
])
  test(`schema3 upgrade resumes after ${phase} and retains every R4 table`, async (t) => {
    const f = await prepareV2(t),
      before = retained(f.path),
      journal = await fs.readFile(f.journalPath);
    const { child, exited } = await pauseV3(t, f.root, phase);
    if (phase !== "linked:complete.json") {
      await assert.rejects(openCatalog({ root: f.root }), {
        code: "catalog_migration_pending",
      });
      await assert.rejects(upgradeCatalog({ root: f.root }), {
        code: "catalog_migration_busy",
      });
    }
    child.kill("SIGKILL");
    assert.equal((await exited).signal, "SIGKILL");
    assert.equal((await upgradeCatalog({ root: f.root })).catalogVersion, 3);
    assert.deepEqual(retained(f.path), before);
    assert.deepEqual(await fs.readFile(f.journalPath), journal);
    const current = await openCatalog({ root: f.root });
    assert.equal(
      (await current.getTargetSummary({ targetId: f.target.id })).items.length,
      1,
    );
    await current.close();
  });

test("receipt-chain tampering blocks upgraded storage without replacing any client rows", async (t) => {
  const f = await prepareV2(t);
  await upgradeCatalog({ root: f.root });
  const bytes = await fs.readFile(f.path);
  const path = join(f.root, "workspace-upgrade-v2-v3", "intent.json"),
    intent = JSON.parse(await fs.readFile(path));
  intent.sourceOwnerSha256 = "f".repeat(64);
  await fs.writeFile(path, JSON.stringify(intent) + "\n");
  await assert.rejects(openCatalog({ root: f.root }), (error) =>
    error.code.startsWith("catalog_migration_"),
  );
  assert.deepEqual(await fs.readFile(f.path), bytes);
});

test("schema3 recovery preserves newer R4 review writes made after a dead upgrader", async (t) => {
  const f = await prepareV2(t),
    { child, exited } = await pauseV3(t, f.root, "prepared"),
    old = new DatabaseSync(f.path);
  old.exec("PRAGMA busy_timeout=20");
  assert.throws(() => old.exec("BEGIN IMMEDIATE"), /locked/);
  child.kill("SIGKILL");
  await exited;
  old.exec("BEGIN IMMEDIATE");
  old
    .prepare("INSERT INTO knowledge_reviews VALUES(?,?,?,?,?,?,?)")
    .run(
      f.target.id,
      f.record.id,
      2,
      3,
      "rejected",
      "A newer retained R4 review",
      "2026-11-10T12:00:00.000Z",
    );
  old.exec("COMMIT");
  old.close();
  const bytes = await fs.readFile(f.path);
  await assert.rejects(upgradeCatalog({ root: f.root }), {
    code: "catalog_migration_changed",
  });
  assert.deepEqual(await fs.readFile(f.path), bytes);
  assert.equal(
    retained(f.path).knowledge_reviews.at(-1).note,
    "A newer retained R4 review",
  );
});

test("a real schema2 journal cursor survives schema3 migration until a history mutation", async (t) => {
  const f = await prepareV2(t),
    { openWorkspace } = await import("../packages/universal/vendor/tools/lib/workspace.mjs"),
    { openRunJournal } = await import("../packages/universal/vendor/tools/lib/run-journal.mjs");
  let catalog = await openCatalog({ root: f.root });
  const old = await catalog.getRun({
    targetId: f.target.id,
    runId: f.retained.run.runId,
  });
  const workspace = await openWorkspace({
    schemaVersion: 2,
    workspace: {
      id: f.retained.workspace.workspaceId,
      root: f.root,
      journal: 1,
    },
    store: f.target.store,
    registration: {
      projectId: f.target.projectId,
      sourceRoot: f.target.sourceRoot,
    },
  });
  const writer = await openRunJournal({
      workspace,
      installation: old.events[0].payload.installation,
    }),
    runId = "migration-cursor-run";
  await writer.begin({
    runId,
    command: "save",
    recipe: false,
    startedAt: "2026-11-10T11:00:00.000Z",
    identity: { application: "Independent migration fixture" },
  });
  const report = JSON.parse(
    JSON.stringify(old.report).replaceAll(f.retained.run.runId, runId),
  );
  await writer.finish({ runId, report });
  await writer.close();
  await catalog.indexTarget(f.target.id);
  const first = await catalog.listRuns({ targetId: f.target.id, limit: 1 });
  assert.ok(first.nextCursor);
  const expected = await catalog.listRuns({
    targetId: f.target.id,
    cursor: first.nextCursor,
  });
  await catalog.close();
  await upgradeCatalog({ root: f.root });
  catalog = await openCatalog({ root: f.root });
  assert.deepEqual(
    await catalog.listRuns({ targetId: f.target.id, cursor: first.nextCursor }),
    expected,
  );
  await catalog.indexTarget(f.target.id);
  await assert.rejects(
    catalog.listRuns({ targetId: f.target.id, cursor: first.nextCursor }),
    { code: "catalog_cursor" },
  );
  await catalog.close();
});

test("a corrupt completed predecessor receipt refuses the next upgrade before any database mutation", async (t) => {
  const f = await prepareV2(t),
    path = join(f.root, "workspace-upgrade-v1-v2", "complete.json"),
    receipt = JSON.parse(await fs.readFile(path));
  receipt.intentSha256 = "f".repeat(64);
  await fs.writeFile(path, JSON.stringify(receipt) + "\n");
  const bytes = await fs.readFile(f.path);
  await assert.rejects(upgradeCatalog({ root: f.root }), {
    code: "catalog_migration_unproven",
  });
  assert.equal(
    (await fs.readFile(f.path)).equals(bytes),
    true,
    "a refused predecessor proof must not advance the original catalog schema",
  );
});
