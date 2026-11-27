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
    await fs.mkdtemp(join(tmpdir(), "daedlo-r4-migration-")),
  );
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  return { base, ...(await materializeV1(base)) };
}
function rows(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return Object.fromEntries(
      ["targets", "target_revisions", "runs", "history_state"].map((table) => [
        table,
        db.prepare(`SELECT * FROM ${table}`).all(),
      ]),
    );
  } finally {
    db.close();
  }
}
test("explicit v1 upgrade preserves existing targets, revisions, history and original backup", async (t) => {
  const f = await fixture(t),
    before = rows(f.path),
    bytes = await fs.readFile(f.path),
    owner = await fs.readFile(f.path + ".owner.json"),
    journal = await fs.readFile(f.journalPath);
  const old = await openCatalog({ root: f.root });
  assert.equal((await old.getTarget(f.current.id)).revision, 2);
  await old.close();
  const result = await upgradeCatalog({ root: f.root, toVersion: 2 });
  assert.equal(
    result.catalogVersion,
    2,
    "R4 requires an explicit preserved-data schema upgrade",
  );
  assert.equal(result.upgraded, true);
  assert.deepEqual(rows(f.path), before);
  assert.deepEqual(await fs.readFile(result.backup.database), bytes);
  assert.deepEqual(await fs.readFile(result.backup.owner), owner);
  assert.deepEqual(await fs.readFile(f.journalPath), journal);
  const current = await openCatalog({ root: f.root });
  assert.deepEqual(
    (
      await current.getRun({
        targetId: f.current.id,
        runId: f.retained.run.runId,
      })
    ).report,
    f.retained.run.report,
  );
  await current.close();
  assert.equal(
    (await upgradeCatalog({ root: f.root, toVersion: 2 })).upgraded,
    false,
  );
});

async function pausedUpgrade(t, root, phase) {
  const { spawn } = await import("node:child_process");
  const source = `import fs from "node:fs/promises"; import {upgradeCatalog} from ${JSON.stringify(new URL("../packages/universal/src/catalog.mjs", import.meta.url).href)};
  const pause=async()=>{setInterval(()=>{},1000);process.stdout.write('READY\\n');await new Promise(()=>{});};
  const checkpoint=${JSON.stringify(phase)};
  if(checkpoint.startsWith("linked:")){const original=fs.link;fs.link=async(...args)=>{const result=await original(...args);if(args[1].endsWith("/"+checkpoint.slice(7)))await pause();return result;};}
  await upgradeCatalog({root:${JSON.stringify(root)},toVersion:2,onProgress:async ({phase})=>{if(phase===checkpoint)await pause();}});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "";
  child.stderr.on("data", (part) => {
    stderr += part;
  });
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
      () => reject(Error(`No migration checkpoint: ${stderr}`)),
      10000,
    );
    child.stdout.on("data", (part) => {
      stdout += part;
      if (stdout.includes("READY\n")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(Error(`Migration exited before checkpoint: ${stderr}`));
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
  "linked:owner-v1.json",
  "linked:intent.json",
  "linked:complete.json",
])
  test(`killed upgrade resumes after ${phase} without losing original data`, async (t) => {
    const f = await fixture(t),
      before = rows(f.path),
      journal = await fs.readFile(f.journalPath);
    const { child, exited } = await pausedUpgrade(t, f.root, phase);
    if (phase !== "linked:complete.json") {
      await assert.rejects(openCatalog({ root: f.root }), {
        code: "catalog_migration_pending",
      });
      await assert.rejects(upgradeCatalog({ root: f.root, toVersion: 2 }), {
        code: "catalog_migration_busy",
      });
    }
    child.kill("SIGKILL");
    assert.equal((await exited).signal, "SIGKILL");
    const result = await upgradeCatalog({ root: f.root, toVersion: 2 });
    assert.equal(result.catalogVersion, 2);
    assert.deepEqual(rows(f.path), before);
    assert.deepEqual(await fs.readFile(f.journalPath), journal);
    const reopened = await openCatalog({ root: f.root });
    assert.equal((await reopened.listTargets()).length, 1);
    await reopened.close();
  });

test("v1 reads remain available and every new mutation requires explicit upgrade", async (t) => {
  const f = await fixture(t),
    before = await fs.readFile(f.path),
    catalog = await openCatalog({ root: f.root });
  assert.equal((await catalog.listTargets())[0].revision, 2);
  assert.equal(
    (await catalog.listRuns({ targetId: f.current.id })).items.length,
    1,
  );
  await assert.rejects(catalog.indexTarget(f.current.id), {
    code: "catalog_upgrade_required",
  });
  await assert.rejects(
    catalog.createRecord({
      targetId: f.current.id,
      kind: "knowledge",
      title: "Before upgrade",
      body: "Should not save",
      refs: [],
      expectedTargetRevision: 2,
    }),
    { code: "catalog_upgrade_required" },
  );
  await assert.rejects(catalog.registerTarget(f.current), {
    code: "catalog_upgrade_required",
  });
  await catalog.close();
  assert.deepEqual(await fs.readFile(f.path), before);
});

test("old writer is excluded during upgrade and newer pre-commit v1 data is never overwritten on resume", async (t) => {
  const f = await fixture(t),
    journal = await fs.readFile(f.journalPath);
  const { child, exited } = await pausedUpgrade(t, f.root, "prepared");
  const old = new DatabaseSync(f.path);
  old.exec("PRAGMA busy_timeout=20");
  assert.throws(() => old.exec("BEGIN IMMEDIATE"), /locked/);
  child.kill("SIGKILL");
  await exited;
  // An already-installed R3 writer does not know R4's intent directory. Its
  // valid v1 transaction after the upgrader dies must never be replaced.
  old.exec("BEGIN IMMEDIATE");
  const next = { ...f.current, label: "Committed by retained v1 writer" };
  old
    .prepare("UPDATE targets SET revision=3,registration=? WHERE id=?")
    .run(JSON.stringify(next), next.id);
  old
    .prepare("INSERT INTO target_revisions VALUES(?,?,?)")
    .run(next.id, 3, JSON.stringify(next));
  old.exec("COMMIT");
  old.close();
  const before = await fs.readFile(f.path);
  await assert.rejects(upgradeCatalog({ root: f.root, toVersion: 2 }), {
    code: "catalog_migration_changed",
  });
  assert.deepEqual(await fs.readFile(f.path), before);
  assert.deepEqual(await fs.readFile(f.journalPath), journal);
  assert.equal(rows(f.path).targets[0].revision, 3);
});

test("tampered retained backup refuses migration without changing the original database", async (t) => {
  const f = await fixture(t),
    { child, exited } = await pausedUpgrade(t, f.root, "prepared");
  child.kill("SIGKILL");
  await exited;
  const dir = join(f.root, "workspace-upgrade-v1-v2"),
    intent = JSON.parse(await fs.readFile(join(dir, "intent.json")));
  await fs.appendFile(join(dir, intent.backup.file), "unproven");
  const original = await fs.readFile(f.path),
    journal = await fs.readFile(f.journalPath);
  await assert.rejects(upgradeCatalog({ root: f.root, toVersion: 2 }), {
    code: "catalog_migration_changed",
  });
  assert.deepEqual(await fs.readFile(f.path), original);
  assert.deepEqual(await fs.readFile(f.journalPath), journal);
});

test("partial snapshot ENOSPC preserves v1 and resumes without deleting the failed snapshot", async (t) => {
  const f = await fixture(t),
    before = await fs.readFile(f.path),
    original = fs.open;
  let injected = false;
  fs.open = async (...args) => {
    const handle = await original(...args);
    if (
      String(args[0]).includes("/snapshot-") &&
      args[1] === "wx" &&
      !injected
    ) {
      injected = true;
      const write = handle.write.bind(handle);
      let first = true;
      handle.write = async (buffer, offset, length, position) => {
        if (first) {
          first = false;
          return write(buffer, offset, Math.min(512, length), position);
        }
        throw Object.assign(Error("Synthetic disk full"), { code: "ENOSPC" });
      };
    }
    return handle;
  };
  try {
    await assert.rejects(upgradeCatalog({ root: f.root, toVersion: 2 }), {
      code: "catalog_migration_storage",
    });
  } finally {
    fs.open = original;
  }
  assert.equal(injected, true);
  assert.deepEqual(await fs.readFile(f.path), before);
  const dir = join(f.root, "workspace-upgrade-v1-v2"),
    failed = (await fs.readdir(dir)).find((name) =>
      name.startsWith("snapshot-"),
    );
  assert.equal((await fs.stat(join(dir, failed))).size, 512);
  const result = await upgradeCatalog({ root: f.root, toVersion: 2 });
  assert.equal(result.catalogVersion, 2);
  assert.equal((await fs.stat(join(dir, failed))).size, 512);
  assert.deepEqual(await fs.readFile(result.backup.database), before);
});

test("failed migration cleanup retains its exact handle and permits explicit retry", async (t) => {
  const f = await fixture(t),
    original = fs.open;
  let selected,
    attempts = 0;
  fs.open = async (...args) => {
    const fromSnapshot = new Error().stack.includes("at snapshot (");
    const handle = await original(...args);
    if (String(args[0]) === f.path && fromSnapshot && !selected) {
      selected = handle;
      const close = handle.close.bind(handle);
      handle.close = async () => {
        attempts++;
        if (attempts === 1)
          throw Object.assign(Error("Synthetic close failure"), {
            code: "EIO",
          });
        return close();
      };
    }
    return handle;
  };
  try {
    await assert.rejects(
      upgradeCatalog({ root: f.root, toVersion: 2 }),
      (error) =>
        error.code === "catalog_cleanup_incomplete" &&
        error.pendingHandles >= 1,
    );
  } finally {
    fs.open = original;
  }
  assert.ok(selected);
  assert.equal(attempts, 1);
  const result = await upgradeCatalog({ root: f.root, toVersion: 2 });
  assert.equal(result.catalogVersion, 2);
  assert.equal(attempts, 2);
  assert.equal(selected.fd, -1);
});
