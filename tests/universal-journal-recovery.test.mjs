import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openCatalog,
  upgradeCatalog,
} from "../packages/universal/src/catalog.mjs";
import { materializeV1 } from "./fixtures/storage-r3/materialize.mjs";
import {
  inspectJournalRecovery,
  recoverJournal,
} from "../packages/universal/src/backup-recovery.mjs";

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
  "target journal recovery refuses a live owner and recovers only the exact dead unmanaged writer",
  { timeout: 30000 },
  async (t) => {
    const f = await paused(t),
      original = await fs.readFile(f.journalPath),
      database = await fs.readFile(f.path);
    await assert.rejects(
      inspectJournalRecovery({ root: f.root, targetId: f.current.id }),
      { code: "journal_recovery_busy" },
    );
    await f.kill();
    const inspected = await inspectJournalRecovery({
      root: f.root,
      targetId: f.current.id,
    });
    assert.equal(inspected.status, "recoverable");
    await assert.rejects(
      recoverJournal({
        root: f.root,
        targetId: f.current.id,
        receipt: "a".repeat(64),
      }),
      { code: "journal_recovery_changed" },
    );
    assert.equal(
      (
        await recoverJournal({
          root: f.root,
          targetId: f.current.id,
          receipt: inspected.receipt,
        })
      ).recovered,
      1,
    );
    assert.deepEqual(await fs.readFile(f.journalPath), original);
    assert.deepEqual(await fs.readFile(f.path), database);
    assert.equal(
      (await inspectJournalRecovery({ root: f.root, targetId: f.current.id }))
        .status,
      "complete",
    );
    const other = join(
      f.root,
      "projects",
      "unregistered",
      "run-journals",
      "writer.lock",
    );
    assert.ok(
      await fs.stat(other),
      "another project writer must remain untouched",
    );
  },
);

test(
  "recovery receipt binds the current target revision and preserves replaced ownership",
  { timeout: 30000 },
  async (t) => {
    const f = await paused(t);
    await f.kill();
    const scope = { root: f.root, targetId: f.current.id };
    await upgradeCatalog({ root: f.root, toVersion: 2 });
    const first = await inspectJournalRecovery(scope),
      catalog = await openCatalog({ root: f.root });
    try {
      await catalog.reviseTarget(
        { ...f.current, label: "Reviewed revision" },
        { expectedRevision: 2 },
      );
    } finally {
      await catalog.close();
    }
    await assert.rejects(recoverJournal({ ...scope, receipt: first.receipt }), {
      code: "journal_recovery_changed",
    });
    const fresh = await inspectJournalRecovery(scope),
      path = join(
        f.root,
        "projects",
        f.current.projectId,
        "run-journals",
        "writer.lock",
      );
    const value = JSON.parse(await fs.readFile(path));
    value.token = "replacement-writer";
    const replacement = Buffer.from(JSON.stringify(value) + "\n");
    await fs.writeFile(path, replacement);
    await assert.rejects(recoverJournal({ ...scope, receipt: fresh.receipt }));
    assert.deepEqual(await fs.readFile(path), replacement);
  },
);
test(
  "managed or unknown writer proof is refused without retiring its lock",
  { timeout: 30000 },
  async (t) => {
    const f = await paused(t);
    await f.kill();
    const path = join(
      f.root,
      "projects",
      f.current.projectId,
      "run-journals",
      "writer.lock",
    );
    const value = JSON.parse(await fs.readFile(path));
    value.managed = { native: "unproven" };
    const retained = Buffer.from(JSON.stringify(value) + "\n");
    await fs.writeFile(path, retained);
    await assert.rejects(
      inspectJournalRecovery({ root: f.root, targetId: f.current.id }),
      { code: "journal_recovery_unproven" },
    );
    assert.deepEqual(await fs.readFile(path), retained);
  },
);
