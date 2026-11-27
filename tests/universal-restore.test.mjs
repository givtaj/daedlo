import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { materializeV1 } from "./fixtures/storage-r3/materialize.mjs";
import {
  openCatalog,
  upgradeCatalog,
} from "../packages/universal/src/catalog.mjs";
import { createEvidenceStore } from "../packages/universal/src/evidence.mjs";
import {
  backupWorkspace,
  verifyWorkspaceBackup,
  restoreWorkspace,
  rollbackWorkspace,
} from "../packages/universal/src/workspace-backup.mjs";
async function fixture(t) {
  const base = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "universal-restore-")),
  );
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const f = await materializeV1(base);
  await fs.mkdir(join(base, "store"));
  await fs.mkdir(join(base, "source"));
  return { base, ...f };
}
for (const phase of ["copied", "before_publish"])
  test(`destination evidence and retained files changed at ${phase} never publish a restored workspace`, async (t) => {
    const f = await fixture(t);
    await upgradeCatalog({ root: f.root });
    const catalog = await openCatalog({ root: f.root }),
      store = await createEvidenceStore({ root: f.root, catalog });
    let evidence;
    try {
      evidence = await store.put({
        targetId: f.current.id,
        runId: f.retained.run.runId,
        label: "Original",
        mediaType: "text/plain",
        bytes: Buffer.from("original evidence\n"),
        expectedTargetRevision: 2,
      });
    } finally {
      await store.close();
      await catalog.close();
    }
    await fs.writeFile(join(f.root, "retained-orphan"), "original orphan\n");
    const backup = join(f.base, "backup"),
      root = join(f.base, "restored");
    await backupWorkspace({ root: f.root, output: backup });
    await assert.rejects(
      restoreWorkspace({
        backup,
        root,
        onProgress: async (value) => {
          if (value.phase === phase) {
            await fs.writeFile(
              join(root, "evidence", f.current.id, evidence.id + ".bin"),
              "changed destination evidence\n",
            );
            await fs.writeFile(
              join(root, "retained-orphan"),
              "changed orphan\n",
            );
          }
        },
      }),
      { code: "restore_changed" },
    );
    await assert.rejects(fs.stat(join(root, "workspace.json")), {
      code: "ENOENT",
    });
    assert.equal(
      await fs.readFile(join(f.root, "retained-orphan"), "utf8"),
      "original orphan\n",
    );
    await verifyWorkspaceBackup({ backup });
  });
test("restore rebases v1 journal ownership in a fresh directory and keeps original receipts", async (t) => {
  const f = await fixture(t),
    backup = join(f.base, "backup"),
    root = join(f.base, "restored");
  const original = await fs.readFile(f.path),
    owner = await fs.readFile(f.path + ".owner.json");
  const saved = await backupWorkspace({ root: f.root, output: backup });
  const restored = await restoreWorkspace({ backup, root, catalogVersion: 1 });
  assert.equal(restored.restored, true);
  assert.equal(restored.catalogVersion, 1);
  assert.deepEqual(
    await fs.readFile(
      join(
        root,
        "restore-provenance",
        saved.backupId,
        "workspace.sqlite.owner.json",
      ),
    ),
    owner,
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
  } finally {
    await catalog.close();
  }
  assert.deepEqual(await fs.readFile(f.path), original);
  await assert.rejects(restoreWorkspace({ backup, root }), {
    code: "backup_output_exists",
  });
  await assert.rejects(
    restoreWorkspace({
      backup,
      root: join(f.base, "wrong-version"),
      catalogVersion: 2,
    }),
    { code: "restore_invalid" },
  );
  await assert.rejects(fs.stat(join(f.base, "wrong-version")), {
    code: "ENOENT",
  });
});
test("partial restore remains unpublished and a fresh destination retries safely", async (t) => {
  const f = await fixture(t),
    backup = join(f.base, "backup"),
    root = join(f.base, "partial");
  await backupWorkspace({ root: f.root, output: backup });
  await assert.rejects(
    restoreWorkspace({
      backup,
      root,
      onProgress: async ({ phase }) => {
        if (phase === "before_publish") throw Error("fault");
      },
    }),
    { code: "restore_storage" },
  );
  await assert.rejects(fs.stat(join(root, "workspace.json")), {
    code: "ENOENT",
  });
  assert.ok((await fs.stat(join(root, "workspace.sqlite"))).size > 0);
  await assert.rejects(restoreWorkspace({ backup, root }), {
    code: "backup_output_exists",
  });
  assert.equal(
    (await restoreWorkspace({ backup, root: join(f.base, "retry") })).restored,
    true,
  );
});
test("late backup marker replacement cannot publish different workspace identity", async (t) => {
  const f = await fixture(t),
    backup = join(f.base, "backup"),
    root = join(f.base, "restored");
  await backupWorkspace({ root: f.root, output: backup });
  const original = await fs.readFile(join(f.root, "workspace.json"));
  await restoreWorkspace({
    backup,
    root,
    onProgress: async ({ phase }) => {
      if (phase === "before_publish")
        await fs.writeFile(
          join(backup, "files", "workspace.json"),
          JSON.stringify({
            ...JSON.parse(original),
            workspaceId: "foreign-workspace",
          }),
        );
    },
  });
  assert.deepEqual(
    await fs.readFile(join(root, "workspace.json")),
    original,
    "publish the already verified marker, never a late unverified reread",
  );
});
test("rollback preserves current data first and restores only the exact requested older schema", async (t) => {
  const f = await fixture(t),
    backup = join(f.base, "v1"),
    output = join(f.base, "rollback"),
    preserve = join(f.base, "current");
  await backupWorkspace({ root: f.root, output: backup });
  await upgradeCatalog({ root: f.root });
  await fs.writeFile(
    join(f.root, "new-retained-note"),
    "must survive rollback",
  );
  const current = await fs.readFile(f.path);
  await assert.rejects(
    rollbackWorkspace({
      root: f.root,
      backup,
      output,
      preserve,
      catalogVersion: 2,
    }),
    { code: "restore_invalid" },
  );
  await assert.rejects(fs.stat(preserve), { code: "ENOENT" });
  const result = await rollbackWorkspace({
    root: f.root,
    backup,
    output,
    preserve,
    catalogVersion: 1,
  });
  assert.equal(result.preserved.catalogVersion, 3);
  assert.equal(result.restored.catalogVersion, 1);
  assert.equal(
    await fs.readFile(join(preserve, "files", "new-retained-note"), "utf8"),
    "must survive rollback",
  );
  assert.deepEqual(await fs.readFile(f.path), current);
  await verifyWorkspaceBackup({ backup: preserve });
});
test("restored evidence retry keeps original publication bytes and internal link pairs", async (t) => {
  const f = await fixture(t);
  await upgradeCatalog({ root: f.root });
  const catalog = await openCatalog({ root: f.root }),
    evidence = await createEvidenceStore({ root: f.root, catalog });
  let record;
  try {
    record = await evidence.put({
      targetId: f.current.id,
      runId: f.retained.run.runId,
      label: "Original",
      mediaType: "text/plain",
      bytes: Buffer.from("retained evidence"),
      expectedTargetRevision: 2,
    });
  } finally {
    await evidence.close();
    await catalog.close();
  }
  const receiptPath = join("evidence", f.current.id, record.id + ".json"),
    original = await fs.readFile(join(f.root, receiptPath));
  await fs.link(
    join(f.root, receiptPath),
    join(f.root, "evidence", f.current.id, "." + record.id + ".json.tmp"),
  );
  await fs.link(
    join(f.root, "evidence", f.current.id, record.id + ".bin"),
    join(f.root, "evidence", f.current.id, "." + record.id + ".bin.tmp"),
  );
  await fs.writeFile(
    join(f.root, "evidence", f.current.id, "private-note.json"),
    "unrecognized original bytes",
  );
  const backup = join(f.base, "backup"),
    root = join(f.base, "restored"),
    saved = await backupWorkspace({ root: f.root, output: backup });
  await restoreWorkspace({ backup, root });
  assert.deepEqual(
    await fs.readFile(
      join(root, "restore-provenance", saved.backupId, receiptPath),
    ),
    original,
  );
  assert.equal(
    await fs.readFile(
      join(root, "evidence", f.current.id, "private-note.json"),
      "utf8",
    ),
    "unrecognized original bytes",
  );
  const restoredCatalog = await openCatalog({ root }),
    restoredEvidence = await createEvidenceStore({
      root,
      catalog: restoredCatalog,
    });
  try {
    assert.equal(
      (
        await restoredEvidence.retry({
          targetId: f.current.id,
          evidenceId: record.id,
          expectedTargetRevision: 2,
        })
      ).integrity,
      "available",
    );
    assert.equal(
      (
        await restoredEvidence.read({
          targetId: f.current.id,
          evidenceId: record.id,
        })
      ).bytes.toString(),
      "retained evidence",
    );
  } finally {
    await restoredEvidence.close();
    await restoredCatalog.close();
  }
});
test("restore preserves an unproven evidence receipt link without making it retryable", async (t) => {
  const f = await fixture(t);
  await upgradeCatalog({ root: f.root });
  const catalog = await openCatalog({ root: f.root }),
    store = await createEvidenceStore({ root: f.root, catalog });
  let evidence;
  try {
    evidence = await store.put({
      targetId: f.current.id,
      runId: f.retained.run.runId,
      label: "Original",
      mediaType: "text/plain",
      bytes: Buffer.from("retained evidence"),
      expectedTargetRevision: 2,
    });
  } finally {
    await store.close();
    await catalog.close();
  }
  const relative = join("evidence", f.current.id, evidence.id + ".json"),
    original = await fs.readFile(join(f.root, relative));
  await fs.link(join(f.root, relative), join(f.root, "unrelated-receipt-link"));
  const backup = join(f.base, "backup"),
    root = join(f.base, "restored");
  await backupWorkspace({ root: f.root, output: backup });
  await restoreWorkspace({ backup, root });
  assert.deepEqual(
    await fs.readFile(join(root, relative)),
    original,
    "unknown link ownership must remain unadopted",
  );
  const restoredCatalog = await openCatalog({ root }),
    restoredStore = await createEvidenceStore({
      root,
      catalog: restoredCatalog,
    });
  try {
    await assert.rejects(
      restoredStore.retry({
        targetId: f.current.id,
        evidenceId: evidence.id,
        expectedTargetRevision: 2,
      }),
      { code: "evidence_unproven" },
    );
  } finally {
    await restoredStore.close();
    await restoredCatalog.close();
  }
});
test("unsafe inventories and altered backup bytes refuse before creating a restore", async (t) => {
  const f = await fixture(t),
    backup = join(f.base, "backup"),
    root = join(f.base, "restored");
  await backupWorkspace({ root: f.root, output: backup });
  const manifest = await fs.readFile(join(backup, "manifest.json"));
  const malformed = JSON.parse(manifest);
  malformed.entries[1].path = "../escape";
  await fs.writeFile(join(backup, "manifest.json"), JSON.stringify(malformed));
  await assert.rejects(restoreWorkspace({ backup, root }), {
    code: "backup_corrupt",
  });
  await assert.rejects(fs.stat(root), { code: "ENOENT" });
  await fs.writeFile(join(backup, "manifest.json"), manifest);
  await fs.writeFile(join(backup, "files", "undeclared"), "not in inventory");
  await assert.rejects(restoreWorkspace({ backup, root }), {
    code: "backup_corrupt",
  });
  await assert.rejects(fs.stat(root), { code: "ENOENT" });
  await fs.unlink(join(backup, "files", "undeclared"));
  await fs.symlink(f.journalPath, join(backup, "files", "linked"));
  await assert.rejects(restoreWorkspace({ backup, root }));
  await assert.rejects(fs.stat(root), { code: "ENOENT" });
});
test("rollback refuses occupied or overlapping outputs before preserving current data", async (t) => {
  const f = await fixture(t),
    backup = join(f.base, "backup"),
    output = join(f.base, "occupied"),
    preserve = join(f.base, "preserved");
  await backupWorkspace({ root: f.root, output: backup });
  await fs.mkdir(output);
  await assert.rejects(
    rollbackWorkspace({
      root: f.root,
      backup,
      output,
      preserve,
      catalogVersion: 1,
    }),
    { code: "backup_output_exists" },
  );
  await assert.rejects(fs.stat(preserve), { code: "ENOENT" });
  await assert.rejects(
    rollbackWorkspace({
      root: f.root,
      backup,
      output: join(f.base, "out"),
      preserve: join(f.root, "nested"),
      catalogVersion: 1,
    }),
    { code: "restore_invalid" },
  );
  await assert.rejects(fs.stat(join(f.root, "nested")), { code: "ENOENT" });
});
test(
  "SIGKILL before restore publication preserves inputs and only a fresh output can complete",
  { timeout: 20000 },
  async (t) => {
    const f = await fixture(t),
      backup = join(f.base, "backup"),
      root = join(f.base, "killed");
    await backupWorkspace({ root: f.root, output: backup });
    const original = await fs.readFile(f.path);
    const script = `import {restoreWorkspace} from ${JSON.stringify(new URL("../packages/universal/src/workspace-backup.mjs", import.meta.url).href)}; await restoreWorkspace({backup:${JSON.stringify(backup)},root:${JSON.stringify(root)},onProgress:async({phase})=>{if(phase==='before_publish'){process.stdout.write('READY\\n');setInterval(()=>{},1000);await new Promise(()=>{});}}});`;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", script],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const exited = new Promise((resolve) =>
      child.once("exit", (code, signal) => resolve({ code, signal })),
    );
    let stderr = "";
    child.stderr.on("data", (part) => (stderr += part));
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await exited;
      }
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("restore checkpoint unavailable: " + stderr)),
        10000,
      );
      child.stdout.on("data", (part) => {
        if (String(part).includes("READY")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(Error("restore exited early: " + stderr));
      });
    });
    child.kill("SIGKILL");
    assert.equal((await exited).signal, "SIGKILL");
    await assert.rejects(fs.stat(join(root, "workspace.json")), {
      code: "ENOENT",
    });
    await assert.rejects(restoreWorkspace({ backup, root }), {
      code: "backup_output_exists",
    });
    assert.equal(
      (await restoreWorkspace({ backup, root: join(f.base, "fresh") }))
        .restored,
      true,
    );
    assert.deepEqual(await fs.readFile(f.path), original);
    await verifyWorkspaceBackup({ backup });
  },
);
