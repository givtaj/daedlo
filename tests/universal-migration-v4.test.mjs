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
    await fs.mkdtemp(join(tmpdir(), "daedlo-compression-migration-")),
  );
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const f = await materializeV1(base);
  await upgradeCatalog({ root: f.root });
  const catalog = await openCatalog({ root: f.root });
  const history = await catalog.getRun({
    targetId: f.current.id,
    runId: f.retained.run.runId,
  });
  const archive = join(base, "original-report.json");
  await fs.writeFile(
    archive,
    JSON.stringify({
      schemaVersion: 1,
      kind: "daedlo-managed-run",
      recordedAt: "2026-11-12T09:00:00.000Z",
      installation: history.events[0].payload.installation,
      report: history.report,
    }) + "\n",
  );
  await catalog.importManagedArchive({
    targetId: f.current.id,
    expectedTargetRevision: (await catalog.getTarget(f.current.id)).revision,
    sourceFile: archive,
  });
  await catalog.close();
  return { base, ...f, archive };
}
function rows(path) {
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
        "archive_imports",
      ].map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]),
    );
  } finally {
    db.close();
  }
}
test("compression schema opt-in preserves all existing tables, original journal and exact catalog backup", async (t) => {
  const f = await fixture(t),
    original = await fs.readFile(f.path),
    journal = await fs.readFile(f.journalPath),
    retained = rows(f.path);
  const before = await openCatalog({ root: f.root });
  assert.equal(before.catalogVersion, 3);
  await before.close();
  const result = await upgradeCatalog({ root: f.root, toVersion: 4 });
  assert.equal(result.catalogVersion, 4);
  assert.equal(result.upgraded, true);
  assert.deepEqual(await fs.readFile(result.backup.database), original);
  assert.deepEqual(await fs.readFile(f.journalPath), journal);
  assert.deepEqual(rows(f.path), retained);
  const catalog = await openCatalog({ root: f.root });
  assert.equal(catalog.catalogVersion, 4);
  assert.deepEqual(
    (
      await catalog.getRun({
        targetId: f.current.id,
        runId: f.retained.run.runId,
      })
    ).report,
    f.retained.run.report,
  );
  await catalog.close();
  assert.equal(
    (await upgradeCatalog({ root: f.root, toVersion: 4 })).upgraded,
    false,
  );
});
test("ordinary upgrade stays at schema3 and unknown compression versions refuse before mutation", async (t) => {
  const f = await fixture(t),
    before = await fs.readFile(f.path);
  assert.equal((await upgradeCatalog({ root: f.root })).catalogVersion, 3);
  await assert.rejects(upgradeCatalog({ root: f.root, toVersion: 5 }), {
    code: "catalog_incompatible",
  });
  assert.deepEqual(await fs.readFile(f.path), before);
});

async function pauseV4(t, root, phase) {
  const { spawn } = await import("node:child_process");
  const source = `import fs from "node:fs/promises";import {upgradeCatalog} from ${JSON.stringify(new URL("../packages/universal/src/catalog.mjs", import.meta.url).href)};
 const phase=${JSON.stringify(phase)},pause=async()=>{setInterval(()=>{},1000);process.stdout.write("READY\\n");await new Promise(()=>{});};
 if(phase.startsWith("linked:")){const original=fs.link;fs.link=async(...args)=>{const value=await original(...args);if(args[1].endsWith("/"+phase.slice(7)))await pause();return value;};}
 await upgradeCatalog({root:${JSON.stringify(root)},toVersion:4,onProgress:async value=>{if(value.phase===phase)await pause();}});`;
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

for (const phase of [
  "claimed",
  "snapshot_saved",
  "candidate_saved",
  "prepared",
  "migrating",
  "committed",
  "owner_rebound",
  "linked:claim-0001.json",
  "linked:owner-v3.json",
  "linked:intent.json",
  "linked:complete.json",
])
  test(`schema4 resumes after ${phase} without losing original imported bytes or history`, async (t) => {
    const f = await fixture(t),
      retained = rows(f.path),
      journal = await fs.readFile(f.journalPath),
      archive = await fs.readFile(f.archive);
    const { child, exited } = await pauseV4(t, f.root, phase);
    if (phase !== "linked:complete.json") {
      await assert.rejects(openCatalog({ root: f.root }), {
        code: "catalog_migration_pending",
      });
      await assert.rejects(upgradeCatalog({ root: f.root, toVersion: 4 }), {
        code: "catalog_migration_busy",
      });
    }
    child.kill("SIGKILL");
    assert.equal((await exited).signal, "SIGKILL");
    assert.equal(
      (await upgradeCatalog({ root: f.root, toVersion: 4 })).catalogVersion,
      4,
    );
    assert.deepEqual(rows(f.path), retained);
    assert.deepEqual(await fs.readFile(f.journalPath), journal);
    assert.deepEqual(await fs.readFile(f.archive), archive);
    const catalog = await openCatalog({ root: f.root });
    assert.deepEqual(
      (
        await catalog.getRun({
          targetId: f.current.id,
          runId: f.retained.run.runId,
        })
      ).report,
      f.retained.run.report,
    );
    await catalog.close();
  });
test("schema4 recovery refuses changed older schema3 imports after a dead upgrader", async (t) => {
  const f = await fixture(t),
    { child, exited } = await pauseV4(t, f.root, "prepared");
  const old = new DatabaseSync(f.path);
  old.exec("PRAGMA busy_timeout=20");
  assert.throws(() => old.exec("BEGIN IMMEDIATE"), /locked/);
  child.kill("SIGKILL");
  await exited;
  old.exec("BEGIN IMMEDIATE");
  old
    .prepare("UPDATE archive_imports SET source_bytes=? WHERE target_id=?")
    .run(Buffer.from("newer retained bytes"), f.current.id);
  old.exec("COMMIT");
  old.close();
  const changed = await fs.readFile(f.path);
  await assert.rejects(upgradeCatalog({ root: f.root, toVersion: 4 }), {
    code: "catalog_migration_changed",
  });
  assert.deepEqual(await fs.readFile(f.path), changed);
});

test("default upgrade leaves an already opted-in schema4 workspace unchanged", async (t) => {
  const f = await fixture(t);
  await upgradeCatalog({ root: f.root, toVersion: 4 });
  const original = await fs.readFile(f.path),
    owner = await fs.readFile(f.path + ".owner.json");
  const result = await upgradeCatalog({ root: f.root });
  assert.equal(result.catalogVersion, 4);
  assert.equal(result.upgraded, false);
  await assert.rejects(upgradeCatalog({ root: f.root, toVersion: 3 }), {
    code: "catalog_incompatible",
  });
  assert.deepEqual(await fs.readFile(f.path), original);
  assert.deepEqual(await fs.readFile(f.path + ".owner.json"), owner);
});
