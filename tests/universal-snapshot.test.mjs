import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync, spawn } from "node:child_process";
import { materializeV1 } from "./fixtures/storage-r3/materialize.mjs";
import {
  openCatalog,
  upgradeCatalog,
  withCatalogSnapshot,
} from "../packages/universal/src/catalog.mjs";
import { rebindRestoredCatalog } from "../packages/universal/src/catalog-snapshot.mjs";
const hash = (value) => createHash("sha256").update(value).digest("hex");
async function fixture(t, version = 1) {
  const base = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "daedlo-r5b-snapshot-")),
  );
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const f = { base, ...(await materializeV1(base)) };
  if (version > 1) await upgradeCatalog({ root: f.root, toVersion: version });
  return f;
}
function writerProbe(path) {
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(${JSON.stringify(path)});db.exec('PRAGMA busy_timeout=20');try{db.exec('BEGIN IMMEDIATE');db.exec('ROLLBACK');process.stdout.write('UNLOCKED');}catch(error){if(!/locked/.test(error.message))throw error;process.stdout.write('LOCKED');}finally{db.close();}`,
    ],
    { encoding: "utf8" },
  );
}
async function entry(root, path) {
  const value = await fs.readFile(join(root, path)),
    stat = await fs.lstat(join(root, path), { bigint: true });
  return {
    path,
    type: "file",
    dev: String(stat.dev),
    ino: String(stat.ino),
    bytes: value.length,
    sha256: hash(value),
  };
}

test("catalog snapshot excludes real old writers through copy and final hash validation", async (t) => {
  const f = await fixture(t, 3),
    destination = join(f.base, "database-snapshot.sqlite"),
    original = await fs.readFile(f.path);
  await withCatalogSnapshot({ root: f.root }, async (snapshot) => {
    const first = writerProbe(f.path);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(
      first.stdout,
      "LOCKED",
      "snapshot must fence real old SQLite writers",
    );
    assert.equal(snapshot.catalogVersion, 3);
    assert.equal(snapshot.targets.length, 1);
    const copy = await snapshot.copyDatabase(destination);
    assert.equal(copy.sha256, hash(original));
    assert.equal(
      writerProbe(f.path).stdout,
      "LOCKED",
      "copy must not release SQLite's POSIX lock",
    );
    assert.equal((await snapshot.databaseSnapshot()).sha256, copy.sha256);
    await snapshot.assertOwned();
    assert.equal(
      writerProbe(f.path).stdout,
      "LOCKED",
      "final hash validation must retain the lock",
    );
  });
  assert.equal(writerProbe(f.path).stdout, "UNLOCKED");
  assert.deepEqual(await fs.readFile(destination), original);
  assert.deepEqual(await fs.readFile(f.path), original);
});

for (const version of [1, 2, 3])
  test(`restored schema${version} rebinds copied identities and retains canonical history`, async (t) => {
    const f = await fixture(t, version),
      root = join(f.base, "restored"),
      marker = await fs.readFile(join(f.root, "workspace.json")),
      sourceOwnerBytes = await fs.readFile(f.path + ".owner.json");
    const journal = `projects/${f.current.projectId}/run-journals/${f.retained.run.runId}.jsonl`,
      inventory = await Promise.all([
        entry(f.root, "workspace.sqlite"),
        entry(f.root, "workspace.sqlite.owner.json"),
        entry(f.root, journal),
      ]);
    await fs.mkdir(
      join(root, "projects", f.current.projectId, "run-journals"),
      { recursive: true },
    );
    await fs.copyFile(f.path, join(root, "workspace.sqlite"));
    await fs.copyFile(f.journalPath, join(root, journal));
    const original = await fs.readFile(f.path);
    const rebound = await rebindRestoredCatalog({
      root,
      inventory,
      sourceOwnerBytes,
    });
    assert.equal(
      rebound.rebound,
      true,
      "explicit restore must rebind copied storage identities",
    );
    assert.equal(rebound.catalogVersion, version);
    const restoredDatabase = await entry(root, "workspace.sqlite");
    assert.equal(rebound.database.sha256, restoredDatabase.sha256);
    assert.equal(rebound.database.bytes, restoredDatabase.bytes);
    assert.equal(rebound.database.dev, restoredDatabase.dev);
    assert.equal(rebound.database.ino, restoredDatabase.ino);
    assert.deepEqual(
      rebound.ownerBytes,
      await fs.readFile(join(root, "workspace.sqlite.owner.json")),
    );
    await fs.writeFile(join(root, "workspace.json"), marker);
    const catalog = await openCatalog({ root });
    assert.deepEqual(
      (
        await catalog.getRun({
          targetId: f.current.id,
          runId: f.retained.run.runId,
        })
      ).report,
      f.retained.run.report,
    );
    assert.equal((await catalog.getTarget(f.current.id)).revision, 2);
    await catalog.close();
    assert.deepEqual(await fs.readFile(f.path), original);
  });

for (const [phase, changed] of [
  ["committed", "database"],
  ["owner_rebound", "database"],
  ["owner_rebound", "owner"],
])
  test(`restore refuses ${changed} mutation after ${phase} without adopting changed contents`, async (t) => {
    const f = await fixture(t, 2),
      root = join(f.base, "mutated-restore"),
      sourceOwnerBytes = await fs.readFile(f.path + ".owner.json"),
      journal = `projects/${f.current.projectId}/run-journals/${f.retained.run.runId}.jsonl`,
      inventory = await Promise.all([
        entry(f.root, "workspace.sqlite"),
        entry(f.root, "workspace.sqlite.owner.json"),
        entry(f.root, journal),
      ]),
      original = await fs.readFile(f.path);
    await fs.mkdir(dirname(join(root, journal)), { recursive: true });
    await fs.copyFile(f.path, join(root, "workspace.sqlite"));
    await fs.copyFile(f.journalPath, join(root, journal));
    let mutated = false;
    await assert.rejects(
      rebindRestoredCatalog({
        root,
        inventory,
        sourceOwnerBytes,
        onProgress: async (value) => {
          if (value.phase !== phase) return;
          if (changed === "database") {
            const { DatabaseSync } = await import("node:sqlite"),
              db = new DatabaseSync(join(root, "workspace.sqlite")),
              registration = JSON.parse(
                db
                  .prepare("SELECT registration FROM targets WHERE id=?")
                  .get(f.current.id).registration,
              );
            registration.label = "Unexpected changed target";
            db.prepare("UPDATE targets SET registration=? WHERE id=?").run(
              JSON.stringify(registration),
              f.current.id,
            );
            db.close();
          } else {
            const ownerPath = join(root, "workspace.sqlite.owner.json"),
              owner = JSON.parse(await fs.readFile(ownerPath, "utf8"));
            owner.catalogId = "unowned-catalog";
            await fs.writeFile(ownerPath, JSON.stringify(owner) + "\n");
          }
          mutated = true;
        },
      }),
      { code: "restore_changed" },
    );
    assert.equal(mutated, true);
    await assert.rejects(fs.stat(join(root, "workspace.json")), {
      code: "ENOENT",
    });
    assert.deepEqual(await fs.readFile(f.path), original);
  });

test("snapshot retains failed raw handle cleanup across repeated explicit retry failures", async (t) => {
  const f = await fixture(t, 3),
    original = fs.open;
  let selected,
    attempts = 0;
  fs.open = async (...args) => {
    const direct = new Error().stack
      .split("\n")[2]
      ?.includes("snapshotCatalog");
    const handle = await original(...args);
    if (String(args[0]) === f.path && direct && !selected) {
      selected = handle;
      const close = handle.close.bind(handle);
      handle.close = async () => {
        attempts++;
        if (attempts <= 2)
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
      withCatalogSnapshot({ root: f.root }, async () => null),
      { code: "snapshot_cleanup_incomplete" },
    );
    assert.equal(attempts, 1);
    await assert.rejects(
      withCatalogSnapshot({ root: f.root }, async () =>
        assert.fail("must finish cleanup before callback"),
      ),
      { code: "snapshot_cleanup_incomplete" },
    );
    assert.equal(attempts, 2);
    await withCatalogSnapshot({ root: f.root }, async (snapshot) =>
      assert.equal(snapshot.catalogVersion, 3),
    );
    assert.equal(attempts, 3);
    assert.equal(selected.fd, -1);
  } finally {
    fs.open = original;
    if (selected?.fd !== -1) await selected?.close();
  }
});

test("snapshot refuses pending recovery and newer unknown storage before copying", async (t) => {
  const f = await fixture(t, 3),
    bytes = await fs.readFile(f.path);
  await fs.writeFile(f.path + "-journal", "unproven retained rollback");
  let called = false;
  await assert.rejects(
    withCatalogSnapshot({ root: f.root }, async () => {
      called = true;
    }),
    { code: "snapshot_recovery_required" },
  );
  assert.equal(called, false);
  assert.deepEqual(await fs.readFile(f.path), bytes);
  assert.equal(
    await fs.readFile(f.path + "-journal", "utf8"),
    "unproven retained rollback",
  );
  await fs.unlink(f.path + "-journal");
  const { DatabaseSync } = await import("node:sqlite"),
    db = new DatabaseSync(f.path);
  db.exec("PRAGMA user_version=99");
  db.close();
  const unknown = await fs.readFile(f.path);
  await assert.rejects(
    withCatalogSnapshot({ root: f.root }, async () => {
      called = true;
    }),
    { code: "catalog_incompatible" },
  );
  assert.equal(called, false);
  assert.deepEqual(await fs.readFile(f.path), unknown);
});

test("restore refuses a substituted journal and never blesses the changed copy", async (t) => {
  const f = await fixture(t, 2),
    root = join(f.base, "replaced-restore"),
    sourceOwnerBytes = await fs.readFile(f.path + ".owner.json"),
    journal = `projects/${f.current.projectId}/run-journals/${f.retained.run.runId}.jsonl`,
    inventory = await Promise.all([
      entry(f.root, "workspace.sqlite"),
      entry(f.root, "workspace.sqlite.owner.json"),
      entry(f.root, journal),
    ]);
  await fs.mkdir(dirname(join(root, journal)), { recursive: true });
  await fs.copyFile(f.path, join(root, "workspace.sqlite"));
  await fs.copyFile(f.journalPath, join(root, journal));
  const copy = await fs.readFile(join(root, "workspace.sqlite"));
  await assert.rejects(
    rebindRestoredCatalog({
      root,
      inventory,
      sourceOwnerBytes,
      onProgress: async (value) => {
        if (value.phase === "verified") {
          await fs.rename(
            join(root, journal),
            join(root, journal + ".preserved"),
          );
          await fs.writeFile(
            join(root, journal),
            await fs.readFile(f.journalPath),
          );
        }
      },
    }),
    { code: "restore_changed" },
  );
  assert.deepEqual(await fs.readFile(join(root, "workspace.sqlite")), copy);
  await assert.rejects(fs.stat(join(root, "workspace.sqlite.owner.json")), {
    code: "ENOENT",
  });
  await assert.rejects(fs.stat(join(root, "workspace.json")), {
    code: "ENOENT",
  });
});

async function pausedChild(t, source) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "",
    err = "";
  child.stderr.on("data", (part) => (err += part));
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
      () => reject(Error(err || "No storage checkpoint")),
      10000,
    );
    child.stdout.on("data", (part) => {
      out += part;
      if (out.includes("READY\n")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(Error(err || "Storage child exited"));
    });
  });
  return { child, exited };
}
test("killing a snapshot releases its writer barrier without modifying the source database", async (t) => {
  const f = await fixture(t, 3),
    destination = join(f.base, "killed-copy.sqlite"),
    before = await fs.readFile(f.path);
  const source = `import {withCatalogSnapshot} from ${JSON.stringify(new URL("../packages/universal/src/catalog.mjs", import.meta.url).href)};await withCatalogSnapshot({root:${JSON.stringify(f.root)}},async snapshot=>{await snapshot.copyDatabase(${JSON.stringify(destination)});await snapshot.databaseSnapshot();setInterval(()=>{},1000);process.stdout.write("READY\\n");await new Promise(()=>{});});`;
  const { child, exited } = await pausedChild(t, source);
  assert.equal(writerProbe(f.path).stdout, "LOCKED");
  child.kill("SIGKILL");
  assert.equal((await exited).signal, "SIGKILL");
  assert.equal(writerProbe(f.path).stdout, "UNLOCKED");
  assert.deepEqual(await fs.readFile(f.path), before);
  assert.deepEqual(await fs.readFile(destination), before);
});
for (const phase of ["verified", "rebinding", "committed", "owner_rebound"])
  test(`killed restore at ${phase} remains unpublished and supports a fresh-destination retry`, async (t) => {
    const f = await fixture(t, 2),
      root = join(f.base, "killed-restore"),
      sourceOwnerBytes = await fs.readFile(f.path + ".owner.json"),
      marker = await fs.readFile(join(f.root, "workspace.json")),
      journal = `projects/${f.current.projectId}/run-journals/${f.retained.run.runId}.jsonl`,
      inventory = await Promise.all([
        entry(f.root, "workspace.sqlite"),
        entry(f.root, "workspace.sqlite.owner.json"),
        entry(f.root, journal),
      ]),
      before = await fs.readFile(f.path);
    const stage = async (path) => {
      await fs.mkdir(dirname(join(path, journal)), { recursive: true });
      await fs.copyFile(f.path, join(path, "workspace.sqlite"));
      await fs.copyFile(f.journalPath, join(path, journal));
    };
    await stage(root);
    const source = `import {rebindRestoredCatalog} from ${JSON.stringify(new URL("../packages/universal/src/catalog-snapshot.mjs", import.meta.url).href)};await rebindRestoredCatalog({root:${JSON.stringify(root)},inventory:${JSON.stringify(inventory)},sourceOwnerBytes:Buffer.from(${JSON.stringify(sourceOwnerBytes.toString("base64"))},"base64"),onProgress:async value=>{if(value.phase===${JSON.stringify(phase)}){setInterval(()=>{},1000);process.stdout.write("READY\\n");await new Promise(()=>{});}}});`;
    const { child, exited } = await pausedChild(t, source);
    child.kill("SIGKILL");
    assert.equal((await exited).signal, "SIGKILL");
    await assert.rejects(fs.stat(join(root, "workspace.json")), {
      code: "ENOENT",
    });
    assert.deepEqual(await fs.readFile(f.path), before);
    const retry = join(f.base, "retry-restore");
    await stage(retry);
    await rebindRestoredCatalog({ root: retry, inventory, sourceOwnerBytes });
    await fs.writeFile(join(retry, "workspace.json"), marker);
    const catalog = await openCatalog({ root: retry });
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
    assert.deepEqual(await fs.readFile(f.path), before);
  });
