import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openRunJournal } from "../packages/universal/vendor/tools/lib/run-journal.mjs";
import { materializeV1 } from "./fixtures/storage-r3/materialize.mjs";
import {
  backupWorkspace,
  verifyWorkspaceBackup,
} from "../packages/universal/src/workspace-backup.mjs";

async function fixture(t) {
  const base = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "universal-backup-")),
  );
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  return { base, ...(await materializeV1(base)) };
}
test("unverified indexed journal checkpoints cannot produce a restorable success", async (t) => {
  const f = await fixture(t),
    output = join(f.base, "unproven");
  const db = new DatabaseSync(f.path);
  db.prepare("UPDATE runs SET checkpoint_hash=?").run("b".repeat(64));
  db.close();
  await assert.rejects(backupWorkspace({ root: f.root, output }), {
    code: "backup_reference",
  });
  await assert.rejects(fs.stat(join(output, "manifest.json")), {
    code: "ENOENT",
  });
});
test("verification binds advertised catalog format to the retained original owner", async (t) => {
  const f = await fixture(t),
    output = join(f.base, "backup");
  await backupWorkspace({ root: f.root, output });
  const manifest = JSON.parse(await fs.readFile(join(output, "manifest.json")));
  manifest.catalogVersion = 2;
  await fs.writeFile(join(output, "manifest.json"), JSON.stringify(manifest));
  await assert.rejects(verifyWorkspaceBackup({ backup: output }), {
    code: "backup_corrupt",
  });
});
test("a concurrent new project writer is refused and its ownership is preserved", async (t) => {
  const f = await fixture(t),
    output = join(f.base, "backup");
  let writer;
  const projectId = "new-concurrent-project",
    journalRoot = join(f.root, "projects", projectId, "run-journals");
  try {
    await assert.rejects(
      backupWorkspace({
        root: f.root,
        output,
        onProgress: async ({ phase }) => {
          if (phase === "writers_locked")
            writer = await openRunJournal({
              workspace: {
                root: f.root,
                id: f.retained.workspace.workspaceId,
                projectId,
                journal: 1,
                journalRoot,
                assertCompatible: async () => {},
              },
              installation: {
                id: "concurrent-writer",
                version: "1",
                sourceSha256: "a".repeat(64),
                model: { id: "fixture", version: "1" },
              },
            });
        },
      }),
      { code: "backup_source_changed" },
    );
    assert.equal(writer.status().locked, true);
    assert.ok((await fs.stat(join(journalRoot, "writer.lock"))).isFile());
    await assert.rejects(fs.stat(join(output, "manifest.json")), {
      code: "ENOENT",
    });
  } finally {
    await writer?.close();
  }
});
test("backup includes unindexed project journals, legacy reports and unknown retained files", async (t) => {
  const f = await fixture(t),
    output = join(f.base, "backup");
  const extras = {
    "projects/unregistered/run-journals/unindexed.jsonl":
      "unindexed original bytes\n",
    "projects/unregistered/run-reports/legacy.json": '{"original":true}\n',
    "retained/private.dat": "orphan retained bytes",
  };
  for (const [path, bytes] of Object.entries(extras)) {
    await fs.mkdir(join(f.root, path, ".."), { recursive: true });
    await fs.writeFile(join(f.root, path), bytes);
  }
  const result = await backupWorkspace({ root: f.root, output });
  assert.equal(result.format, "daedlo-workspace-backup/1");
  const verified = await verifyWorkspaceBackup({ backup: output });
  assert.equal(verified.sha256, result.sha256);
  for (const [path, bytes] of Object.entries(extras))
    assert.equal(await fs.readFile(join(output, "files", path), "utf8"), bytes);
  assert.deepEqual(
    await fs.readFile(f.journalPath),
    await fs.readFile(
      join(
        output,
        "files",
        "projects",
        f.current.projectId,
        "run-journals",
        f.retained.run.runId + ".jsonl",
      ),
    ),
  );
  await assert.rejects(fs.stat(join(f.journalPath, "..", "writer.lock")), {
    code: "ENOENT",
  });
});
test("backup refuses a changed source and retains incomplete output without a complete manifest", async (t) => {
  const f = await fixture(t),
    output = join(f.base, "backup");
  await assert.rejects(
    backupWorkspace({
      root: f.root,
      output,
      onProgress: async ({ phase }) => {
        if (phase === "copied")
          await fs.writeFile(
            join(f.root, "late-orphan.bin"),
            "must not be omitted",
          );
      },
    }),
    { code: "backup_source_changed" },
  );
  assert.equal(
    await fs.readFile(join(f.root, "late-orphan.bin"), "utf8"),
    "must not be omitted",
  );
  await assert.rejects(fs.stat(join(output, "manifest.json")), {
    code: "ENOENT",
  });
  await assert.rejects(verifyWorkspaceBackup({ backup: output }), {
    code: "backup_incomplete",
  });
});
test("failed file close is retained without an automatic second close and explicit retry keeps output", async (t) => {
  const f = await fixture(t),
    output = join(f.base, "partial"),
    open = fs.open;
  let ownedHandle,
    closes = 0,
    broken = true;
  const patch = mock.method(fs, "open", async (...args) => {
    const handle = await open(...args);
    if (String(args[0]) === join(output, "intent.json")) {
      ownedHandle = handle;
      const close = handle.close.bind(handle);
      handle.close = async () => {
        closes++;
        if (broken)
          throw Object.assign(Error("injected close"), { code: "EIO" });
        return close();
      };
    }
    return handle;
  });
  t.after(() => patch.mock.restore());
  await assert.rejects(backupWorkspace({ root: f.root, output }), {
    code: "backup_cleanup_incomplete",
  });
  assert.equal(closes, 1, "failed close must wait for an explicit retry");
  assert.ok((await ownedHandle.stat()).isFile());
  broken = false;
  await assert.rejects(backupWorkspace({ root: f.root, output }), {
    code: "backup_output_exists",
  });
  await assert.rejects(ownedHandle.stat(), { code: "EBADF" });
  assert.equal(closes, 2);
  await assert.rejects(fs.stat(join(output, "manifest.json")), {
    code: "ENOENT",
  });
});
test("metadata tampering and altered copied files never verify as a complete backup", async (t) => {
  const f = await fixture(t),
    output = join(f.base, "backup");
  await backupWorkspace({ root: f.root, output });
  const intent = await fs.readFile(join(output, "intent.json"));
  await fs.writeFile(
    join(output, "intent.json"),
    Buffer.from(intent).fill(32, 0, 1),
  );
  await assert.rejects(verifyWorkspaceBackup({ backup: output }), {
    code: "backup_corrupt",
  });
  await fs.writeFile(join(output, "intent.json"), intent);
  const lock = join(output, "locks", f.current.projectId + ".json"),
    bytes = await fs.readFile(lock);
  await fs.writeFile(lock, Buffer.from(bytes).fill(32, 0, 1));
  await assert.rejects(verifyWorkspaceBackup({ backup: output }), {
    code: "backup_corrupt",
  });
  const other = join(f.base, "copy-fault");
  await assert.rejects(
    backupWorkspace({
      root: f.root,
      output: other,
      onProgress: async ({ phase }) => {
        if (phase === "copied")
          await fs.writeFile(
            join(other, "files", "workspace.json"),
            "damaged destination",
          );
      },
    }),
    { code: "backup_corrupt" },
  );
  await assert.rejects(fs.stat(join(other, "manifest.json")), {
    code: "ENOENT",
  });
});
test("late changes after the verified checkpoint never publish a successful backup", async (t) => {
  const f = await fixture(t),
    output = join(f.base, "backup");
  await assert.rejects(
    backupWorkspace({
      root: f.root,
      output,
      onProgress: async ({ phase }) => {
        if (phase === "verified")
          await fs.writeFile(
            join(
              output,
              "files",
              "projects",
              f.current.projectId,
              "run-journals",
              f.retained.run.runId + ".jsonl",
            ),
            "corrupt copied journal\n",
          );
      },
    }),
    { code: "backup_corrupt" },
  );
  await assert.rejects(fs.stat(join(output, "manifest.json")), {
    code: "ENOENT",
  });
});
test("preexisting writers, unsafe links and unsupported upgrade directories are refused", async (t) => {
  const f = await fixture(t),
    writer = join(f.journalPath, "..", "writer.lock");
  await fs.writeFile(writer, "unproven owner");
  await assert.rejects(
    backupWorkspace({ root: f.root, output: join(f.base, "busy") }),
    { code: "backup_busy" },
  );
  assert.equal(await fs.readFile(writer, "utf8"), "unproven owner");
  await fs.unlink(writer);
  await fs.mkdir(join(f.root, "workspace-upgrade-v4-v5"));
  await assert.rejects(
    backupWorkspace({ root: f.root, output: join(f.base, "future") }),
    { code: "backup_invalid" },
  );
  await fs.rmdir(join(f.root, "workspace-upgrade-v4-v5"));
  await fs.writeFile(join(f.base, "outside"), "outside bytes");
  await fs.link(join(f.base, "outside"), join(f.root, "external-link"));
  await assert.rejects(
    backupWorkspace({ root: f.root, output: join(f.base, "links") }),
    { code: "backup_invalid" },
  );
  assert.equal(
    await fs.readFile(join(f.base, "outside"), "utf8"),
    "outside bytes",
  );
});
test("output write failure and same-byte source replacement preserve original data without completing", async (t) => {
  const f = await fixture(t),
    output = join(f.base, "write-fault"),
    original = await fs.readFile(f.journalPath),
    open = fs.open;
  const patch = mock.method(fs, "open", async (...args) => {
    const h = await open(...args);
    if (
      String(args[0]).startsWith(join(output, "files", "projects")) &&
      String(args[0]).endsWith(".jsonl")
    )
      h.write = async () => {
        throw Object.assign(Error("full"), { code: "ENOSPC" });
      };
    return h;
  });
  await assert.rejects(backupWorkspace({ root: f.root, output }), {
    code: "backup_storage",
  });
  patch.mock.restore();
  assert.deepEqual(await fs.readFile(f.journalPath), original);
  await assert.rejects(fs.stat(join(output, "manifest.json")), {
    code: "ENOENT",
  });
  const replacement = join(f.base, "replacement");
  await assert.rejects(
    backupWorkspace({
      root: f.root,
      output: replacement,
      onProgress: async ({ phase }) => {
        if (phase === "copied") {
          await fs.writeFile(f.journalPath + ".replacement", original);
          await fs.rename(f.journalPath + ".replacement", f.journalPath);
        }
      },
    }),
    { code: "backup_source_changed" },
  );
  assert.deepEqual(await fs.readFile(f.journalPath), original);
  await assert.rejects(fs.stat(join(replacement, "manifest.json")), {
    code: "ENOENT",
  });
});
test("oversized sparse files and symlink destinations refuse without touching outside files", async (t) => {
  const f = await fixture(t),
    large = await fs.open(join(f.root, "oversized"), "wx");
  await large.truncate(1024 ** 3 + 1);
  await large.close();
  await assert.rejects(
    backupWorkspace({ root: f.root, output: join(f.base, "too-large") }),
    { code: "backup_limit" },
  );
  const target = join(f.base, "outside");
  await fs.mkdir(target);
  await fs.writeFile(join(target, "keep"), "original");
  await fs.symlink(target, join(f.base, "alias"));
  await assert.rejects(
    backupWorkspace({ root: f.root, output: join(f.base, "alias", "backup") }),
  );
  assert.equal(await fs.readFile(join(target, "keep"), "utf8"), "original");
  await assert.rejects(fs.stat(join(target, "backup")), { code: "ENOENT" });
});
