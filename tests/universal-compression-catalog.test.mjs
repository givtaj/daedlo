import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { materializeV1 } from "./fixtures/storage-r3/materialize.mjs";
import {
  openCatalog,
  upgradeCatalog,
} from "../packages/universal/src/catalog.mjs";
const hash = (b) => createHash("sha256").update(b).digest("hex");
async function fixture(t, version = 4) {
  const base = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "compression-catalog-")),
  );
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const f = await materializeV1(base);
  await upgradeCatalog({ root: f.root, toVersion: version });
  const catalog = await openCatalog({ root: f.root });
  t.after(() => catalog.close());
  const bytes = await fs.readFile(f.journalPath),
    stat = await fs.lstat(f.journalPath, { bigint: true }),
    gzipBytes = gzipSync(bytes);
  const record = {
    format: "daedlo-journal-compression/1",
    id: randomUUID(),
    workspaceId: f.retained.workspace.workspaceId,
    projectId: f.current.projectId,
    targetId: f.current.id,
    runId: f.retained.run.runId,
    source: {
      dev: String(stat.dev),
      ino: String(stat.ino),
      bytes: bytes.length,
      sha256: hash(bytes),
    },
    gzip: { bytes: gzipBytes.length, sha256: hash(gzipBytes) },
    createdAt: "2026-11-12T10:00:00.000Z",
  };
  return {
    ...f,
    base,
    catalog,
    target: await catalog.getTarget(f.current.id),
    bytes,
    gzipBytes,
    record,
  };
}
test("retaining compressed original bytes is explicit, idempotent and preserves journal/history", async (t) => {
  const f = await fixture(t);
  assert.equal(
    typeof f.catalog.retainCompression,
    "function",
    "Universal must expose verified catalog retention before any source replacement",
  );
  const before = await f.catalog.getRun({
    targetId: f.current.id,
    runId: f.record.runId,
  });
  const result = await f.catalog.retainCompression({
    record: f.record,
    gzipBytes: f.gzipBytes,
    expectedRevision: f.target.revision,
  });
  assert.equal(result.state, "retained");
  assert.equal(result.replacement, null);
  assert.deepEqual(Buffer.from(result.gzipBytes), f.gzipBytes);
  assert.deepEqual(await fs.readFile(f.journalPath), f.bytes);
  assert.deepEqual(
    await f.catalog.getRun({ targetId: f.current.id, runId: f.record.runId }),
    before,
  );
  assert.deepEqual(
    await f.catalog.retainCompression({
      record: f.record,
      gzipBytes: f.gzipBytes,
      expectedRevision: f.target.revision,
    }),
    result,
  );
  await f.catalog.indexTarget(f.current.id, { rebuild: true });
  assert.deepEqual(
    await f.catalog.getRun({ targetId: f.current.id, runId: f.record.runId }),
    before,
  );
});
test("schema3 remains readable but cannot retain a new compression", async (t) => {
  const f = await fixture(t, 3),
    before = await fs.readFile(f.path);
  assert.equal(typeof f.catalog.retainCompression, "function");
  await assert.rejects(
    f.catalog.retainCompression({
      record: f.record,
      gzipBytes: f.gzipBytes,
      expectedRevision: f.target.revision,
    }),
    { code: "catalog_upgrade_required" },
  );
  assert.deepEqual(await fs.readFile(f.path), before);
});
test("wrong target scope or changed compressed bytes refuse before catalog retention", async (t) => {
  const f = await fixture(t),
    before = await fs.readFile(f.path);
  assert.equal(typeof f.catalog.retainCompression, "function");
  await assert.rejects(
    f.catalog.retainCompression({
      record: { ...f.record, projectId: "foreign-project" },
      gzipBytes: f.gzipBytes,
      expectedRevision: f.target.revision,
    }),
  );
  const changed = Buffer.from(f.gzipBytes);
  changed[changed.length - 1] ^= 1;
  await assert.rejects(
    f.catalog.retainCompression({
      record: f.record,
      gzipBytes: changed,
      expectedRevision: f.target.revision,
    }),
  );
  assert.equal(
    await f.catalog.getCompression({
      targetId: f.current.id,
      runId: f.record.runId,
    }),
    null,
  );
  assert.deepEqual(await fs.readFile(f.path), before);
});

test("retained compressed bytes cannot be corrupted or reassigned while history succeeds", async (t) => {
  const f = await fixture(t);
  await f.catalog.retainCompression({
    record: f.record,
    gzipBytes: f.gzipBytes,
    expectedRevision: f.target.revision,
  });
  const database = new DatabaseSync(f.path);
  const changed = Buffer.from(f.gzipBytes);
  changed[changed.length - 1] ^= 1;
  database
    .prepare("UPDATE journal_compressions SET gzip_bytes=? WHERE target_id=?")
    .run(changed, f.current.id);
  database.close();
  await assert.rejects(
    f.catalog.getRun({ targetId: f.current.id, runId: f.record.runId }),
    { code: "compression_corrupt" },
  );
  await assert.rejects(f.catalog.indexTarget(f.current.id, { rebuild: true }), {
    code: "compression_corrupt",
  });
  assert.deepEqual(await fs.readFile(f.journalPath), f.bytes);
});

test("activation requires retained compression and durable replacement proof", async (t) => {
  const f = await fixture(t);
  const before = await fs.readFile(f.path);
  await assert.rejects(
    f.catalog.prepareCompressionReplacement({
      targetId: f.current.id,
      runId: f.record.runId,
      id: f.record.id,
      sourceBinding: { dev: f.record.source.dev, ino: f.record.source.ino },
      replacement: {},
    }),
    { code: "compression_conflict" },
  );
  await assert.rejects(
    f.catalog.activateCompression({
      targetId: f.current.id,
      runId: f.record.runId,
      id: f.record.id,
      sourceBinding: { dev: f.record.source.dev, ino: f.record.source.ino },
      binding: { dev: f.record.source.dev, ino: f.record.source.ino },
    }),
    { code: "compression_conflict" },
  );
  assert.deepEqual(await fs.readFile(f.path), before);
  assert.deepEqual(await fs.readFile(f.journalPath), f.bytes);
});

test("replacement proof cannot adopt a marker linked to an unrelated file", async (t) => {
  const f = await fixture(t);
  await f.catalog.retainCompression({
    record: f.record,
    gzipBytes: f.gzipBytes,
    expectedRevision: f.target.revision,
  });
  const { openRunJournal } = await import("../packages/universal/vendor/tools/lib/run-journal.mjs");
  const { compressionMarker } = await import(
    "../packages/universal/src/compressed-journal.mjs"
  );
  const directory = join(
    f.root,
    "projects",
    f.current.projectId,
    "run-journals",
  );
  const workspace = {
    root: f.root,
    id: f.record.workspaceId,
    projectId: f.record.projectId,
    journal: 1,
    journalRoot: directory,
    assertCompatible: async () => {},
  };
  const writer = await openRunJournal({
    workspace,
    installation: JSON.parse(f.bytes.toString().split("\n")[0]).payload
      .installation,
  });
  try {
    const temporary = `.compressed-${f.record.id}-${randomUUID()}.marker.tmp`,
      temporaryPath = join(directory, temporary);
    await fs.writeFile(temporaryPath, compressionMarker(f.record), {
      flag: "wx",
      mode: 0o600,
    });
    await fs.link(temporaryPath, join(directory, "unrelated-marker-link"));
    const marker = await fs.lstat(temporaryPath, { bigint: true }),
      lockPath = join(directory, "writer.lock"),
      lock = await fs.readFile(lockPath),
      lockStat = await fs.lstat(lockPath, { bigint: true }),
      writerRecord = JSON.parse(lock);
    const sourceBinding = {
      dev: f.record.source.dev,
      ino: f.record.source.ino,
    };
    const replacement = {
      format: "daedlo-journal-replacement/1",
      source: sourceBinding,
      marker: { dev: String(marker.dev), ino: String(marker.ino) },
      writer: {
        token: writerRecord.token,
        sha256: hash(lock),
        dev: String(lockStat.dev),
        ino: String(lockStat.ino),
      },
      writerRecord,
      temporary,
      retained: `.compressed-${f.record.id}.plain.retained`,
    };
    await assert.rejects(
      f.catalog.prepareCompressionReplacement({
        targetId: f.current.id,
        runId: f.record.runId,
        id: f.record.id,
        sourceBinding,
        replacement,
      }),
      { code: "compression_corrupt" },
    );
    assert.equal(
      (
        await f.catalog.getCompression({
          targetId: f.current.id,
          runId: f.record.runId,
        })
      ).replacement,
      null,
    );
    assert.deepEqual(await fs.readFile(f.journalPath), f.bytes);
  } finally {
    await writer.close();
  }
});

for (const replace of [false, true])
  test(
    `killed compression ${replace ? "activation" : "INSERT"} rolls back its hot journal before explicit retry without losing original history`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(t),
        original = await fs.readFile(f.journalPath),
        beforeHistory = await f.catalog.getRun({
          targetId: f.current.id,
          runId: f.record.runId,
        });
      const { spawn } = await import("node:child_process");
      const program = `import { DatabaseSync } from 'node:sqlite'; import { writeSync } from 'node:fs'; import { compressJournal } from ${JSON.stringify(new URL("../packages/universal/src/journal-compression.mjs", import.meta.url).href)};
    const exec = DatabaseSync.prototype.exec;
    DatabaseSync.prototype.exec = function(sql) {
      if(sql === 'BEGIN IMMEDIATE') exec.call(this, 'PRAGMA cache_size=1; PRAGMA cache_spill=ON');
      if(sql === 'COMMIT') { let cut=false; try { cut=this.prepare('PRAGMA user_version').get().user_version===4 && this.prepare('PRAGMA query_only').get().query_only===0 && this.prepare("SELECT count(*) AS count FROM journal_compressions WHERE state='${replace ? "active" : "retained"}'").get().count===1; } catch {} if(cut) { writeSync(1, 'READY\\n'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); } }
      return exec.call(this,sql);
    };
    await compressJournal({root:${JSON.stringify(f.root)},targetId:${JSON.stringify(f.current.id)},runId:${JSON.stringify(f.record.runId)},replace:${replace}});`;
      const child = spawn(
        process.execPath,
        ["--input-type=module", "-e", program],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      const exited = new Promise((resolve) =>
        child.once("exit", (code, signal) => resolve({ code, signal })),
      );
      let errors = "";
      child.stderr.on("data", (part) => {
        errors += part;
      });
      try {
        await new Promise((resolve, reject) => {
          let output = "";
          const timer = setTimeout(
            () =>
              reject(
                Error(
                  "Compression transaction checkpoint unavailable: " + errors,
                ),
              ),
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
            reject(
              Error(
                "Compression exited before transaction checkpoint: " + errors,
              ),
            );
          });
        });
        const journal = await fs.readFile(f.path + "-journal");
        assert.equal(
          journal.subarray(0, 8).toString("hex"),
          "d9d505f920a163d7",
          "Actual hot rollback journal header must be durable before process loss",
        );
        child.kill("SIGKILL");
        assert.equal((await exited).signal, "SIGKILL");
        await assert.rejects(
          f.catalog.getRun({ targetId: f.current.id, runId: f.record.runId }),
          { code: "catalog_recovery_required" },
        );
        if (replace) {
          await assert.rejects(f.catalog.indexTarget(f.current.id), {
            code: "compression_pending",
          });
          const rolledBack = await f.catalog.getCompression({
            targetId: f.current.id,
            runId: f.record.runId,
          });
          assert.equal(rolledBack.state, "retained");
          assert.ok(rolledBack.replacement);
          const retainedPath = join(
            f.root,
            "projects",
            f.record.projectId,
            "run-journals",
            rolledBack.replacement.retained,
          );
          assert.deepEqual(await fs.readFile(retainedPath), original);
          assert.deepEqual(gunzipSync(rolledBack.gzipBytes), original);
          await assert.rejects(
            f.catalog.getRun({ targetId: f.current.id, runId: f.record.runId }),
            { code: "compression_pending" },
          );
        } else {
          assert.deepEqual(await fs.readFile(f.journalPath), original);
          await f.catalog.indexTarget(f.current.id);
          assert.equal(
            await f.catalog.getCompression({
              targetId: f.current.id,
              runId: f.record.runId,
            }),
            null,
          );
          assert.deepEqual(
            await f.catalog.getRun({
              targetId: f.current.id,
              runId: f.record.runId,
            }),
            beforeHistory,
          );
        }
        const { inspectRunJournalRecovery, recoverRunJournal } = await import(
          "../packages/universal/vendor/tools/lib/journal-recovery.mjs"
        );
        const workspace = {
          root: f.root,
          id: f.record.workspaceId,
          projectId: f.record.projectId,
          journal: 1,
          journalRoot: join(
            f.root,
            "projects",
            f.record.projectId,
            "run-journals",
          ),
          assertCompatible: async () => {},
        };
        const inspection = await inspectRunJournalRecovery({ workspace });
        assert.equal(inspection.status, "dead");
        await recoverRunJournal({ workspace, expected: inspection.expected });
        const { compressJournal } = await import(
          "../packages/universal/src/journal-compression.mjs"
        );
        const first = await compressJournal({
          root: f.root,
          targetId: f.current.id,
          runId: f.record.runId,
          replace,
        });
        const second = await compressJournal({
          root: f.root,
          targetId: f.current.id,
          runId: f.record.runId,
          replace,
        });
        assert.match(first.compressionId, /^[a-f0-9-]{36}$/);
        assert.equal(first.compressionId, second.compressionId);
        const completed = await f.catalog.getCompression({
          targetId: f.current.id,
          runId: f.record.runId,
        });
        assert.equal(completed.state, replace ? "active" : "retained");
        assert.equal(completed.replacement, null);
        assert.deepEqual(gunzipSync(completed.gzipBytes), original);
        if (!replace)
          assert.deepEqual(await fs.readFile(f.journalPath), original);
        assert.equal(
          (await fs.readdir(workspace.journalRoot)).some((name) =>
            name.startsWith(".compressed-"),
          ),
          false,
        );
        assert.deepEqual(
          await f.catalog.getRun({
            targetId: f.current.id,
            runId: f.record.runId,
          }),
          beforeHistory,
        );
        const db = new DatabaseSync(f.path, { readOnly: true });
        try {
          assert.equal(
            db
              .prepare("SELECT count(*) AS count FROM journal_compressions")
              .get().count,
            1,
          );
        } finally {
          db.close();
        }
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
          await exited;
        }
      }
    },
  );
