import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { initializeWorkspace } from "../packages/universal/vendor/tools/lib/workspace.mjs";
import { openCatalog } from "../packages/universal/src/catalog.mjs";

async function temporary(t) {
  const directory = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "universal-sqlite-runtime-")),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}
async function snapshot(root) {
  const result = {};
  for (const name of (await fs.readdir(root)).sort()) {
    const path = join(root, name),
      stat = await fs.lstat(path, { bigint: true });
    result[name] = stat.isDirectory()
      ? await snapshot(path)
      : {
          dev: stat.dev.toString(),
          ino: stat.ino.toString(),
          mode: stat.mode.toString(),
          mtimeNs: stat.mtimeNs.toString(),
          size: stat.size.toString(),
          sha256: createHash("sha256")
            .update(await fs.readFile(path))
            .digest("hex"),
        };
  }
  return result;
}

test("both supported Node lanes provide strict tables, foreign keys and bounded SQLite contention without an addon", async (t) => {
  const root = await temporary(t),
    path = join(root, "probe.sqlite");
  const options = {
    timeout: 40,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
  };
  const owner = new DatabaseSync(path, options);
  let contender;
  try {
    owner.exec(
      "PRAGMA journal_mode=DELETE; PRAGMA synchronous=EXTRA; PRAGMA trusted_schema=OFF; CREATE TABLE target(id TEXT PRIMARY KEY) STRICT; CREATE TABLE run(target_id TEXT REFERENCES target(id), count INTEGER) STRICT;",
    );
    assert.throws(() => owner.exec("INSERT INTO run VALUES('absent',1)"), {
      code: "ERR_SQLITE_ERROR",
    });
    owner.exec("INSERT INTO target VALUES('registered')");
    assert.throws(
      () => owner.exec("INSERT INTO run VALUES('registered','not-an-integer')"),
      { code: "ERR_SQLITE_ERROR" },
    );
    assert.throws(() => owner.prepare('SELECT "not-a-column"').get(), {
      code: "ERR_SQLITE_ERROR",
    });
    assert.equal(owner.prepare("PRAGMA synchronous").get().synchronous, 3);
    assert.equal(
      owner.prepare("PRAGMA trusted_schema").get().trusted_schema,
      0,
    );
    contender = new DatabaseSync(
      pathToFileURL(path).href + "?mode=rw",
      options,
    );
    owner.exec("BEGIN IMMEDIATE");
    assert.throws(
      () => contender.exec("INSERT INTO target VALUES('competing')"),
      (error) => error.code === "ERR_SQLITE_ERROR" && error.errcode === 5,
    );
    owner.exec("ROLLBACK");
    contender.exec("INSERT INTO target VALUES('after-release')");
    assert.equal(
      owner.prepare("SELECT count(*) AS count FROM target").get().count,
      2,
    );
  } finally {
    contender?.close();
    owner.close();
  }
});

test("SQLite read-only and existing-writer modes cannot create a missing database", async (t) => {
  const root = await temporary(t),
    path = join(root, "missing.sqlite");
  assert.throws(() => new DatabaseSync(path, { readOnly: true }), {
    code: "ERR_SQLITE_ERROR",
  });
  assert.throws(() => new DatabaseSync(pathToFileURL(path).href + "?mode=rw"), {
    code: "ERR_SQLITE_ERROR",
  });
  assert.deepEqual(await fs.readdir(root), []);
});

for (const altered of ["future-version", "wal-mode"])
  test(`Universal refuses ${altered} before SQLite can mutate files during read-only preflight`, async (t) => {
    const base = await temporary(t),
      root = join(base, "workspace");
    await initializeWorkspace({
      schemaVersion: 2,
      store: join(base, "manager"),
      workspace: { id: "runtime-fixture", root, journal: 1 },
      registration: { projectId: "target-a", sourceRoot: join(base, "source") },
    });
    const catalog = await openCatalog({ root, create: true });
    await catalog.close();
    const path = join(root, "workspace.sqlite"),
      changed = new DatabaseSync(path);
    try {
      changed.exec(
        altered === "future-version"
          ? "PRAGMA user_version=999"
          : "PRAGMA journal_mode=WAL",
      );
    } finally {
      changed.close();
    }
    assert.equal(
      (await fs.readdir(root)).some((name) => /-(wal|shm)$/.test(name)),
      false,
    );
    const before = await snapshot(root);
    await assert.rejects(openCatalog({ root }), {
      code: "catalog_incompatible",
    });
    assert.deepEqual(
      await snapshot(root),
      before,
      "Rejected preflight must preserve file bytes, identities, timestamps and directory entries",
    );
  });
