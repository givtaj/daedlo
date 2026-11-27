import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { materializeV1 } from "./fixtures/storage-r3/materialize.mjs";
import {
  inspectBackupRecovery,
  recoverBackup,
} from "../packages/universal/src/backup-recovery.mjs";
import { backupWorkspace } from "../packages/universal/src/workspace-backup.mjs";

async function paused(t) {
  const base = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "universal-backup-recovery-")),
  );
  const f = await materializeV1(base),
    backup = join(base, "partial-backup");
  await fs.mkdir(join(f.root, "projects", "unregistered", "run-journals"), {
    recursive: true,
  });
  const script = `import {writeSync} from 'node:fs';import {backupWorkspace} from ${JSON.stringify(new URL("../packages/universal/src/workspace-backup.mjs", import.meta.url).href)};await backupWorkspace({root:${JSON.stringify(f.root)},output:${JSON.stringify(backup)},onProgress:async({phase})=>{if(phase==='writers_locked'){writeSync(1,'READY\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}}});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise((resolve) =>
    child.once("exit", (code, signal) => resolve({ code, signal })),
  );
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
    await fs.rm(base, { recursive: true, force: true });
  });
  let stderr = "";
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(
      () => reject(Error("Backup lock boundary unavailable: " + stderr)),
      10000,
    );
    child.stdout.on("data", (data) => {
      output += data;
      if (output.includes("READY\n")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(Error("Backup exited before lock boundary: " + stderr));
    });
  });
  return {
    ...f,
    base,
    backup,
    child,
    async kill() {
      child.kill("SIGKILL");
      assert.equal((await exited).signal, "SIGKILL");
    },
  };
}
test(
  "backup recovery refuses a live owner, then retires only its two proven-dead locks without changing recorded data",
  { timeout: 30000 },
  async (t) => {
    const f = await paused(t),
      journal = await fs.readFile(f.journalPath),
      database = await fs.readFile(f.path);
    await assert.rejects(inspectBackupRecovery({ backup: f.backup }), {
      code: "backup_recovery_busy",
    });
    await f.kill();
    const inspection = await inspectBackupRecovery({ backup: f.backup });
    assert.equal(inspection.status, "recoverable");
    assert.equal(inspection.projects, 2);
    await assert.rejects(
      recoverBackup({ backup: f.backup, receipt: "a".repeat(64) }),
      { code: "backup_recovery_changed" },
    );
    const recovered = await recoverBackup({
      backup: f.backup,
      receipt: inspection.receipt,
    });
    assert.equal(recovered.recovered, 2);
    assert.deepEqual(await fs.readFile(f.journalPath), journal);
    assert.deepEqual(await fs.readFile(f.path), database);
    const done = await inspectBackupRecovery({ backup: f.backup });
    assert.equal(done.status, "complete");
    assert.equal(
      (await recoverBackup({ backup: f.backup, receipt: done.receipt }))
        .recovered,
      0,
    );
    await assert.rejects(fs.stat(join(f.backup, "manifest.json")), {
      code: "ENOENT",
    });
    assert.equal(
      (
        await backupWorkspace({
          root: f.root,
          output: join(f.base, "new-backup"),
        })
      ).catalogVersion,
      1,
    );
  },
);
test(
  "a lock changed after backup inspection is preserved and prevents all recovery writes",
  { timeout: 30000 },
  async (t) => {
    const f = await paused(t);
    await f.kill();
    const inspection = await inspectBackupRecovery({ backup: f.backup });
    const lock = join(
      f.root,
      "projects",
      "unregistered",
      "run-journals",
      "writer.lock",
    );
    const original = JSON.parse(await fs.readFile(lock));
    original.token = "replacement-writer";
    await fs.writeFile(lock, JSON.stringify(original) + "\n");
    const replacement = await fs.readFile(lock),
      first = join(
        f.root,
        "projects",
        f.current.projectId,
        "run-journals",
        "writer.lock",
      ),
      firstBefore = await fs.readFile(first);
    await assert.rejects(
      recoverBackup({ backup: f.backup, receipt: inspection.receipt }),
      { code: "backup_recovery_changed" },
    );
    assert.deepEqual(await fs.readFile(lock), replacement);
    assert.deepEqual(await fs.readFile(first), firstBefore);
  },
);
test(
  "a pre-receipt backup lock gap remains unproven and retained",
  { timeout: 30000 },
  async (t) => {
    const f = await paused(t);
    await f.kill();
    await fs.unlink(join(f.backup, "locks", "unregistered.json"));
    const lock = join(
        f.root,
        "projects",
        "unregistered",
        "run-journals",
        "writer.lock",
      ),
      before = await fs.readFile(lock);
    await assert.rejects(inspectBackupRecovery({ backup: f.backup }), {
      code: "backup_recovery_unproven",
    });
    assert.deepEqual(await fs.readFile(lock), before);
  },
);

test(
  "recovery accepts the full bounded planned-project inventory without dropping its writer proofs",
  { timeout: 30000 },
  async (t) => {
    const f = await paused(t);
    await f.kill();
    const path = join(f.backup, "intent.json"),
      intent = JSON.parse(await fs.readFile(path));
    while (intent.projects.length < 1000)
      intent.projects.push(
        "planned-" +
          String(intent.projects.length).padStart(4, "0") +
          "x".repeat(110),
      );
    await fs.writeFile(path, JSON.stringify(intent) + "\n");
    assert.ok((await fs.stat(path)).size > 65536);
    const inspection = await inspectBackupRecovery({ backup: f.backup });
    assert.equal(inspection.projects, 2);
    assert.equal(
      (await recoverBackup({ backup: f.backup, receipt: inspection.receipt }))
        .recovered,
      2,
    );
  },
);

test(
  "concurrent recovery inspections never close another operation's active read handle",
  { timeout: 30000 },
  async (t) => {
    const f = await paused(t);
    await f.kill();
    const open = fs.open;
    let ready,
      release,
      pausedRead = false;
    const entered = new Promise((resolve) => {
      ready = resolve;
    });
    const resume = new Promise((resolve) => {
      release = resolve;
    });
    fs.open = async (...args) => {
      const handle = await open(...args);
      if (args[0] === join(f.backup, "intent.json") && !pausedRead) {
        pausedRead = true;
        const read = handle.readFile.bind(handle);
        handle.readFile = async (...readArgs) => {
          ready();
          await resume;
          return read(...readArgs);
        };
      }
      return handle;
    };
    const first = inspectBackupRecovery({ backup: f.backup }).then(
      (result) => ({ result }),
      (error) => ({ error }),
    );
    let second;
    try {
      await entered;
      second = await inspectBackupRecovery({ backup: f.backup }).then(
        (result) => ({ result }),
        (error) => ({ error }),
      );
    } finally {
      fs.open = open;
      release();
    }
    const completed = await first;
    assert.equal(second.error?.code, "backup_recovery_busy");
    assert.equal(completed.error, undefined);
    assert.equal(completed.result.status, "recoverable");
  },
);
