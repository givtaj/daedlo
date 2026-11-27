import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { materializeV1 } from "./fixtures/storage-r3/materialize.mjs";
import {
  openCatalog,
  upgradeCatalog,
} from "../packages/universal/src/catalog.mjs";
import { compressJournal } from "../packages/universal/src/journal-compression.mjs";
import { decodeCompression } from "../packages/universal/src/compressed-journal.mjs";
import {
  inspectJournalRecovery,
  recoverJournal,
} from "../packages/universal/src/backup-recovery.mjs";
async function fixture(t) {
  const base = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "universal-compression-fault-")),
  );
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const f = await materializeV1(base);
  await upgradeCatalog({ root: f.root, toVersion: 4 });
  return {
    ...f,
    base,
    runId: f.retained.run.runId,
    targetId: f.current.id,
    original: await fs.readFile(f.journalPath),
  };
}
const args = (f) => ({
  root: f.root,
  targetId: f.targetId,
  runId: f.runId,
  replace: true,
});
async function assertHistory(f) {
  const catalog = await openCatalog({ root: f.root });
  try {
    const saved = await catalog.getCompression({
      targetId: f.targetId,
      runId: f.runId,
    });
    assert.equal(saved.state, "active");
    assert.equal(saved.replacement, null);
    assert.deepEqual(decodeCompression(saved).bytes, f.original);
    assert.deepEqual(
      (await catalog.getRun({ targetId: f.targetId, runId: f.runId })).report,
      f.retained.run.report,
    );
    await catalog.indexTarget(f.targetId, { rebuild: true });
    assert.deepEqual(
      (await catalog.getRun({ targetId: f.targetId, runId: f.runId })).report,
      f.retained.run.report,
    );
  } finally {
    await catalog.close();
  }
}
for (const phase of [
  "writer_locked",
  "retained",
  "marker_staged",
  "replacement_prepared",
  "source_linked",
  "source_unlinked",
  "marker_published",
  "activated",
  "source_retired",
  "cleanup_verified",
]) {
  test(
    `killed compression at ${phase} preserves data and explicitly recovers without replay`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(t);
      const script = `import {compressJournal} from ${JSON.stringify(new URL("../packages/universal/src/journal-compression.mjs", import.meta.url).href)};await compressJournal({...${JSON.stringify(args(f))},onProgress:async({phase})=>{if(phase===${JSON.stringify(phase)}){process.stdout.write('READY\\n');setInterval(()=>{},1000);await new Promise(()=>{});}}});`;
      const child = spawn(
        process.execPath,
        ["--input-type=module", "-e", script],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      const exited = new Promise((resolve) =>
        child.once("exit", (code, signal) => resolve({ code, signal })),
      );
      t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
          await exited;
        }
      });
      let stderr = "";
      child.stderr.on("data", (data) => {
        stderr += data;
      });
      await new Promise((resolve, reject) => {
        let output = "";
        const timer = setTimeout(
          () => reject(Error("Unavailable cut: " + stderr)),
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
          reject(Error("Early exit: " + stderr));
        });
      });
      await assert.rejects(
        inspectJournalRecovery({ root: f.root, targetId: f.targetId }),
      );
      child.kill("SIGKILL");
      assert.equal((await exited).signal, "SIGKILL");
      await assert.rejects(compressJournal(args(f)), {
        code: "compression_busy",
      });
      const catalog = await openCatalog({ root: f.root });
      let saved;
      try {
        saved = await catalog.getCompression({
          targetId: f.targetId,
          runId: f.runId,
        });
        if (saved) assert.deepEqual(decodeCompression(saved).bytes, f.original);
        else assert.deepEqual(await fs.readFile(f.journalPath), f.original);
      } finally {
        await catalog.close();
      }
      const inspection = await inspectJournalRecovery({
        root: f.root,
        targetId: f.targetId,
      });
      assert.equal(inspection.status, "recoverable");
      assert.equal(
        (
          await recoverJournal({
            root: f.root,
            targetId: f.targetId,
            receipt: inspection.receipt,
          })
        ).recovered,
        1,
      );
      assert.equal((await compressJournal(args(f))).state, "active");
      await assertHistory(f);
    },
  );
}
test("source replacement between durable gzip and source retirement preserves the foreign file and original payload", async (t) => {
  const f = await fixture(t),
    foreign = Buffer.from("foreign replacement must survive\n"),
    retained = join(f.base, "original-retained");
  await assert.rejects(
    compressJournal({
      ...args(f),
      onProgress: async ({ phase }) => {
        if (phase === "retained") {
          await fs.rename(f.journalPath, retained);
          await fs.writeFile(f.journalPath, foreign);
        }
      },
    }),
    { code: "compression_changed" },
  );
  assert.deepEqual(await fs.readFile(f.journalPath), foreign);
  assert.deepEqual(await fs.readFile(retained), f.original);
  const catalog = await openCatalog({ root: f.root });
  try {
    assert.deepEqual(
      decodeCompression(
        await catalog.getCompression({ targetId: f.targetId, runId: f.runId }),
      ).bytes,
      f.original,
    );
  } finally {
    await catalog.close();
  }
});
test("a foreign canonical file appearing in the unlink gap is never overwritten", async (t) => {
  const f = await fixture(t),
    foreign = Buffer.from("foreign newly published file\n");
  await assert.rejects(
    compressJournal({
      ...args(f),
      onProgress: async ({ phase }) => {
        if (phase === "source_unlinked")
          await fs.writeFile(f.journalPath, foreign, { flag: "wx" });
      },
    }),
    { code: "compression_changed" },
  );
  assert.deepEqual(await fs.readFile(f.journalPath), foreign);
  const catalog = await openCatalog({ root: f.root });
  try {
    const saved = await catalog.getCompression({
      targetId: f.targetId,
      runId: f.runId,
    });
    assert.equal(saved.state, "retained");
    assert.deepEqual(
      await fs.readFile(join(f.journalPath, "..", saved.replacement.retained)),
      f.original,
    );
    assert.deepEqual(decodeCompression(saved).bytes, f.original);
  } finally {
    await catalog.close();
  }
});
test("ENOSPC while staging the marker preserves plain data and a fresh attempt safely retries", async (t) => {
  const f = await fixture(t),
    open = fs.open;
  let injected = false;
  fs.open = async (...options) => {
    const handle = await open(...options);
    if (!injected && String(options[0]).endsWith(".marker.tmp")) {
      injected = true;
      const write = handle.writeFile.bind(handle);
      handle.writeFile = async (bytes) => {
        await write(bytes.subarray(0, 8));
        throw Object.assign(Error("disk full"), { code: "ENOSPC" });
      };
    }
    return handle;
  };
  try {
    await assert.rejects(compressJournal(args(f)), {
      code: "compression_storage",
    });
  } finally {
    fs.open = open;
  }
  assert.equal(injected, true);
  assert.deepEqual(await fs.readFile(f.journalPath), f.original);
  assert.equal((await compressJournal(args(f))).state, "active");
  await assertHistory(f);
});
test("failed marker close retains the exact handle until explicit retry without an automatic second close", async (t) => {
  const f = await fixture(t),
    open = fs.open;
  let injected = false,
    closes = 0;
  fs.open = async (...options) => {
    const handle = await open(...options);
    if (!injected && String(options[0]).endsWith(".marker.tmp")) {
      injected = true;
      const close = handle.close.bind(handle);
      handle.close = async () => {
        closes++;
        if (closes === 1)
          throw Object.assign(Error("close failed"), { code: "EIO" });
        return close();
      };
    }
    return handle;
  };
  try {
    await assert.rejects(compressJournal(args(f)), {
      code: "compression_cleanup_incomplete",
    });
  } finally {
    fs.open = open;
  }
  assert.equal(injected, true);
  assert.equal(closes, 1);
  assert.deepEqual(await fs.readFile(f.journalPath), f.original);
  assert.equal((await compressJournal(args(f))).state, "active");
  assert.equal(closes, 2);
  await assertHistory(f);
});

test("corrupt staged marker refuses before unlinking the original journal", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    compressJournal({
      ...args(f),
      onProgress: async ({ phase }) => {
        if (phase === "marker_staged") {
          const dir = join(f.journalPath, ".."),
            name = (await fs.readdir(dir)).find((v) =>
              v.endsWith(".marker.tmp"),
            );
          await fs.writeFile(join(dir, name), "corrupt marker\n");
        }
      },
    }),
  );
  assert.deepEqual(await fs.readFile(f.journalPath), f.original);
  const catalog = await openCatalog({ root: f.root });
  try {
    const saved = await catalog.getCompression({
      targetId: f.targetId,
      runId: f.runId,
    });
    assert.equal(saved.state, "retained");
    assert.equal(saved.replacement, null);
    assert.deepEqual(decodeCompression(saved).bytes, f.original);
  } finally {
    await catalog.close();
  }
});
test("an unrelated hard link cannot be adopted as owned original retention", async (t) => {
  const f = await fixture(t),
    foreign = join(f.base, "unrelated-hard-link");
  await fs.link(f.journalPath, foreign);
  await assert.rejects(compressJournal(args(f)));
  assert.deepEqual(await fs.readFile(f.journalPath), f.original);
  assert.deepEqual(await fs.readFile(foreign), f.original);
  const catalog = await openCatalog({ root: f.root });
  try {
    assert.equal(
      await catalog.getCompression({ targetId: f.targetId, runId: f.runId }),
      null,
    );
  } finally {
    await catalog.close();
  }
});
