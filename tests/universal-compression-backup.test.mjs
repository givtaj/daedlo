import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createEvidenceStore } from "../packages/universal/src/evidence.mjs";
import { readKnowledgeRoute } from "../packages/universal/src/knowledge-http.mjs";
import { compressJournal } from "../packages/universal/src/journal-compression.mjs";
import { join } from "node:path";
import { materializeV1 } from "./fixtures/storage-r3/materialize.mjs";
import {
  openCatalog,
  upgradeCatalog,
} from "../packages/universal/src/catalog.mjs";
import {
  backupWorkspace,
  verifyWorkspaceBackup,
  restoreWorkspace,
} from "../packages/universal/src/workspace-backup.mjs";

async function fixture(t) {
  const base = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "universal-compression-backup-")),
  );
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const f = await materializeV1(base);
  await fs.mkdir(join(base, "store"));
  await fs.mkdir(join(base, "source"));
  await upgradeCatalog({ root: f.root, toVersion: 4 });
  return { base, ...f };
}
test("schema4 full workspace backup and fresh restore preserve the prior journal and target catalog", async (t) => {
  const f = await fixture(t),
    original = await fs.readFile(f.journalPath),
    backup = join(f.base, "backup"),
    root = join(f.base, "restored");
  const saved = await backupWorkspace({ root: f.root, output: backup });
  assert.equal(saved.catalogVersion, 4);
  assert.equal((await verifyWorkspaceBackup({ backup })).catalogVersion, 4);
  assert.equal(
    (await restoreWorkspace({ backup, root, catalogVersion: 4 })).restored,
    true,
  );
  const catalog = await openCatalog({ root });
  try {
    assert.deepEqual(
      (
        await catalog.getRun({
          targetId: f.current.id,
          runId: f.retained.run.runId,
        })
      ).report,
      f.retained.run.report,
    );
    assert.deepEqual((await catalog.getTarget(f.current.id)).id, f.current.id);
  } finally {
    await catalog.close();
  }
  assert.deepEqual(await fs.readFile(f.journalPath), original);
});

for (const replace of [false, true])
  test(`backup and restore preserve ${replace ? "replaced" : "retained"} compressed journals including unindexed history`, async (t) => {
    const f = await fixture(t),
      runId = f.retained.run.runId,
      original = await fs.readFile(f.journalPath);
    const extra = "unindexed-closed";
    const extraPath = join(
      f.root,
      "projects",
      f.current.projectId,
      "run-journals",
      extra + ".jsonl",
    );
    await fs.writeFile(extraPath, original.toString().replaceAll(runId, extra));
    for (const id of [runId, extra])
      assert.equal(
        (
          await compressJournal({
            root: f.root,
            targetId: f.current.id,
            runId: id,
            replace,
          })
        ).state,
        replace ? "active" : "retained",
      );
    const catalog = await openCatalog({ root: f.root });
    let retained, expected;
    try {
      retained = await catalog.getCompression({
        targetId: f.current.id,
        runId,
      });
      expected = await catalog.getRun({ targetId: f.current.id, runId });
    } finally {
      await catalog.close();
    }
    const before = await fs.readFile(f.path),
      source = await fs.readFile(f.journalPath),
      backup = join(f.base, "backup"),
      root = join(f.base, "restored");
    await backupWorkspace({ root: f.root, output: backup });
    await restoreWorkspace({ backup, root, catalogVersion: 4 });
    const copied = await openCatalog({ root });
    try {
      const record = await copied.getCompression({
        targetId: f.current.id,
        runId,
      });
      assert.deepEqual(record.record, retained.record);
      assert.deepEqual(record.gzipBytes, retained.gzipBytes);
      assert.equal(record.replacement, null);
      assert.equal(record.state, retained.state);
      const stat = await fs.stat(
        join(
          root,
          "projects",
          f.current.projectId,
          "run-journals",
          runId + ".jsonl",
        ),
        { bigint: true },
      );
      assert.deepEqual(record.binding, {
        dev: String(stat.dev),
        ino: String(stat.ino),
      });
      assert.deepEqual(
        await copied.getRun({ targetId: f.current.id, runId }),
        expected,
      );
      await copied.indexTarget(f.current.id, { rebuild: true });
      assert.equal(
        (await copied.listRuns({ targetId: f.current.id })).items.length,
        2,
      );
      assert.equal(
        (await copied.getRun({ targetId: f.current.id, runId: extra })).status,
        "finished",
      );
    } finally {
      await copied.close();
    }
    if (!replace)
      assert.equal(
        (
          await compressJournal({
            root,
            targetId: f.current.id,
            runId,
            replace: true,
          })
        ).state,
        "active",
        "restored current binding authorizes replacement while original provenance remains unchanged",
      );
    const twice = join(f.base, "backup-restored"),
      again = join(f.base, "restored-again");
    await backupWorkspace({ root, output: twice });
    await restoreWorkspace({ backup: twice, root: again, catalogVersion: 4 });
    const reopened = await openCatalog({ root: again });
    try {
      assert.deepEqual(
        await reopened.getRun({ targetId: f.current.id, runId }),
        expected,
      );
    } finally {
      await reopened.close();
    }
    assert.deepEqual(await fs.readFile(f.path), before);
    assert.deepEqual(await fs.readFile(f.journalPath), source);
  });

test("backup refuses pending replacement and corrupt compressed bytes without sealing a manifest", async (t) => {
  const f = await fixture(t),
    runId = f.retained.run.runId;
  await assert.rejects(
    compressJournal({
      root: f.root,
      targetId: f.current.id,
      runId,
      replace: true,
      onProgress: async ({ phase }) => {
        if (phase === "replacement_prepared")
          throw Error("injected interruption");
      },
    }),
  );
  const partial = join(f.base, "pending-backup");
  await assert.rejects(backupWorkspace({ root: f.root, output: partial }), {
    code: "compression_pending",
  });
  await assert.rejects(fs.stat(join(partial, "manifest.json")), {
    code: "ENOENT",
  });
  await compressJournal({
    root: f.root,
    targetId: f.current.id,
    runId,
    replace: true,
  });
  const db = new DatabaseSync(f.path);
  try {
    db.prepare("UPDATE journal_compressions SET gzip_bytes=?").run(
      Buffer.from("corrupt"),
    );
  } finally {
    db.close();
  }
  const corrupt = join(f.base, "corrupt-backup");
  await assert.rejects(backupWorkspace({ root: f.root, output: corrupt }), {
    code: "compression_corrupt",
  });
  await assert.rejects(fs.stat(join(corrupt, "manifest.json")), {
    code: "ENOENT",
  });
});

test("schema4 retains evidence authoring and authenticated knowledge route support", async (t) => {
  const f = await fixture(t),
    catalog = await openCatalog({ root: f.root }),
    evidence = await createEvidenceStore({ root: f.root, catalog });
  try {
    const stored = await evidence.put({
      targetId: f.current.id,
      runId: f.retained.run.runId,
      expectedTargetRevision: 2,
      label: "Schema4 proof",
      mediaType: "text/plain",
      bytes: Buffer.from("retained proof"),
    });
    assert.equal(stored.integrity, "available");
    assert.equal(
      (
        await evidence.retry({
          targetId: f.current.id,
          evidenceId: stored.id,
          expectedTargetRevision: 2,
        })
      ).id,
      stored.id,
    );
    const summary = await readKnowledgeRoute(
      { targetId: f.current.id, resource: "summary" },
      { catalog, evidence },
    );
    assert.equal(summary.json.targetId, f.current.id);
  } finally {
    await evidence.close();
    await catalog.close();
  }
});
