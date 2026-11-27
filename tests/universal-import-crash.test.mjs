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

for (const phase of ["before_commit", "after_commit"])
  test(
    `killed archive import ${phase} retains exact sources and resumes without duplicate history`,
    { timeout: 20000 },
    async (t) => {
      const base = await fs.realpath(
        await fs.mkdtemp(join(tmpdir(), "universal-import-crash-")),
      );
      let child, exited, catalog;
      t.after(async () => {
        if (child && child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
          await exited;
        }
        await catalog?.close();
        await fs.rm(base, { recursive: true, force: true });
      });
      const f = await materializeV1(base);
      await upgradeCatalog({ root: f.root });
      const runId = "legacy-import-crash",
        report = { ...structuredClone(f.retained.run.report), runId };
      report.lastResult.runId = runId;
      // Large inert public fixture text forces SQLite spill before the kill point.
      report.identity = { syntheticFixture: "x".repeat(2 * 1024 * 1024) };
      const archive = {
        schemaVersion: 1,
        kind: "daedlo-managed-run",
        installation: {
          id: "synthetic-prior-installation",
          version: "fixture.1",
          sourceSha256: "a".repeat(64),
          model: { id: "fixture", version: "1" },
        },
        recordedAt: "2026-11-01T00:00:00.000Z",
        report,
      };
      const source = join(base, "original-managed.json");
      await fs.writeFile(source, JSON.stringify(archive) + "\n");
      const sourceBefore = await fs.readFile(source),
        journalBefore = await fs.readFile(f.journalPath);
      const script = `import {DatabaseSync} from 'node:sqlite'; import {writeSync} from 'node:fs'; import {openCatalog} from ${JSON.stringify(new URL("../packages/universal/src/catalog.mjs", import.meta.url).href)};
    const catalog=await openCatalog({root:${JSON.stringify(f.root)}}); let armed=false,importId;
    const stop=()=>{writeSync(1,JSON.stringify({importId})+'\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};
    const prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;
    DatabaseSync.prototype.prepare=function(sql){const statement=prepare.call(this,sql);if(sql.startsWith('INSERT INTO archive_imports(')){const db=this,run=statement.run;statement.run=function(...args){db.exec('PRAGMA cache_size=1');const result=run.apply(this,args);armed=true;importId=args[2];if(${JSON.stringify(phase)}==='before_commit')stop();return result;};}return statement;};
    DatabaseSync.prototype.exec=function(sql){const result=exec.call(this,sql);if(armed&&sql==='COMMIT'&&${JSON.stringify(phase)}==='after_commit')stop();return result;};
    await catalog.importManagedArchive({targetId:${JSON.stringify(f.current.id)},expectedTargetRevision:2,sourceFile:${JSON.stringify(source)}});`;
      child = spawn(process.execPath, ["--input-type=module", "-e", script], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      exited = new Promise((resolve) =>
        child.once("exit", (code, signal) => resolve({ code, signal })),
      );
      let stderr = "";
      child.stderr.on("data", (part) => {
        stderr += part;
      });
      const checkpoint = await new Promise((resolve, reject) => {
        let output = "";
        const timer = setTimeout(
          () => reject(Error("Import kill point unavailable: " + stderr)),
          10000,
        );
        child.stdout.on("data", (part) => {
          output += part;
          if (output.includes("\n")) {
            clearTimeout(timer);
            resolve(JSON.parse(output.split("\n")[0]));
          }
        });
        child.once("exit", () => {
          clearTimeout(timer);
          reject(Error("Import child exited before kill point: " + stderr));
        });
      });
      if (phase === "before_commit")
        assert.ok((await fs.stat(f.path + "-journal")).size > 28);
      child.kill("SIGKILL");
      assert.equal((await exited).signal, "SIGKILL");
      catalog = await openCatalog({ root: f.root });
      if (phase === "before_commit") {
        await assert.rejects(
          catalog.getImportedRun({ targetId: f.current.id, runId }),
          (error) =>
            ["archive_not_found", "catalog_recovery_required"].includes(
              error.code,
            ),
        );
        await catalog.indexTarget(f.current.id);
        await assert.rejects(
          catalog.getImportedRun({ targetId: f.current.id, runId }),
          { code: "archive_not_found" },
        );
      }
      const retried = await catalog.importManagedArchive({
        targetId: f.current.id,
        expectedTargetRevision: 2,
        sourceFile: source,
      });
      assert.equal(retried.imported, phase === "before_commit");
      if (phase === "after_commit")
        assert.equal(retried.importId, checkpoint.importId);
      assert.equal(
        (
          await catalog.importManagedArchive({
            targetId: f.current.id,
            expectedTargetRevision: 2,
            sourceFile: source,
          })
        ).imported,
        false,
      );
      assert.deepEqual(
        (await catalog.getImportedRun({ targetId: f.current.id, runId }))
          .report,
        report,
      );
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
      const history = await catalog.listRuns({ targetId: f.current.id });
      assert.equal(
        history.items.filter((item) => item.sourceKind === "archive").length,
        1,
      );
      assert.deepEqual(await fs.readFile(source), sourceBefore);
      assert.deepEqual(await fs.readFile(f.journalPath), journalBefore);
    },
  );
