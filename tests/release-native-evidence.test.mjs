import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { sha256 } from "../scripts/release/manifest.mjs";
import { createNinjaSupervisor } from "../scripts/release/ninja-supervisor.mjs";

const executable = await fs.realpath(process.execPath);
const browser = {
  executablePath: executable,
  version: process.version,
  sha256: sha256(await fs.readFile(executable)),
};

// Synthetic runtime/browser identities isolate the owned-process and archive
// contract. This fixture does not claim browser or customer-flow acceptance.
async function fixture(t) {
  const root = await fs.mkdtemp(
    join(await fs.realpath(os.tmpdir()), "ninja-evidence-"),
  );
  const owner = join(root, "supervisor");
  await fs.writeFile(
    join(root, "runtime.mjs"),
    `
    export { createResourceScope } from ${JSON.stringify(new URL("../packages/runtime/src/resources.mjs", import.meta.url).href)};
    export async function createDriverSession({resources}) {
      let paused=false, counter=0, last=null; const reports=new Map();
      const run=async (id)=>{
        if(id==='refused') return {ok:false,execution:'rejected',error_code:'revision_required'};
        const n=++counter; await Promise.resolve();
        last={ok:id!=='failed',execution:id==='failed'?'failed':'completed',runId:'run-'+n,effect:{status:'saved'}};
        reports.set(last.runId, {format:'browser-driver-report/1',runId:last.runId,lastResult:structuredClone(last),identity:{runtime:'@browser-driver/runtime@1.0.0'},events:[],resources:[]});
        if(reports.size>16) reports.delete(reports.keys().next().value);
        return structuredClone(last);
      };
      return {
        snapshot:async()=>({busy:false,paused,connected:true,descriptor:{id:'fixture',version:'1'},identity:{runtime:'@browser-driver/runtime@1.0.0'}}),
        observe:async()=>({connected:true}),pause:()=>paused=true,resume:()=>paused=false,
        report:({runId}={})=>runId?structuredClone(reports.get(runId)??null):({format:'browser-driver-report/1',completedRunIds:[...reports.keys()],lastResult:last}),
        execute:run,command:request=>run(request.id),runRecipe:run,startPresentation:run,
        close:async()=>resources.close()
      };
    }
  `,
  );
  await fs.writeFile(
    join(root, "launcher.mjs"),
    `
    import fs from 'node:fs/promises'; import { join } from 'node:path';
    export async function createManagedLaunch({runtime, sourceRoot}) {
      await runtime.registerBrowser({browser:{version:()=>process.version},executablePath:${JSON.stringify(executable)}});
      const session=await runtime.createDriverSession({});
      return {session,draftState:async()=>{
        let request; try {request=JSON.parse(await fs.readFile(join(sourceRoot,'request.json'),'utf8'));}
        catch(e){if(e.code==='ENOENT')return false;throw e;}
        await fs.unlink(join(sourceRoot,'request.json'));
        let result;
        try {result=await session[request.method](request.method==='command'?{id:request.command}:request.command);}
        catch(e){result={error_code:e.code};}
        await fs.writeFile(join(sourceRoot,'result.json'),JSON.stringify(result));
        return false;
      }};
    }
  `,
  );
  const receipt = {
    id: "fixture-slot",
    version: "1.0.0",
    sourceSha256: "a".repeat(64),
    runtimePath: join(root, "runtime.mjs"),
    enginePath: join(root, "engine"),
    launcherPath: join(root, "launcher.mjs"),
    sourcePath: root,
    model: { id: "fixture", version: "1" },
    browser,
  };
  const supervisor = await createNinjaSupervisor({
    root: owner,
    timeoutMs: 3000,
  });
  t.after(async () => {
    // Tests repair their deliberately broken archive before owned cleanup.
    await supervisor.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  await supervisor.start(receipt);
  await supervisor.accept();
  return {
    root,
    owner,
    receipt,
    supervisor,
    async run(method = "execute", command = "saved") {
      await fs.writeFile(
        join(root, "request.json"),
        JSON.stringify({ method, command }),
      );
      const state = await supervisor.status();
      return {
        state,
        result: JSON.parse(
          await fs.readFile(join(root, "result.json"), "utf8"),
        ),
      };
    },
  };
}

test("managed runs persist immediately beyond the session's sixteen-report window", async (t) => {
  const { supervisor, owner, receipt, run } = await fixture(t);
  const directory = join(owner, "run-reports");
  await assert.rejects(
    fs.access(directory),
    { code: "ENOENT" },
    "Startup must not manufacture a completed run",
  );
  for (let n = 1; n <= 20; n++) {
    const { result } = await run(
      ["execute", "command", "runRecipe", "startPresentation"][(n - 1) % 4],
    );
    assert.equal(result.runId, `run-${n}`);
    assert.equal(result.execution, "completed");
  }
  const files = (
    await fs.readdir(directory).catch((e) => {
      if (e.code === "ENOENT") return [];
      throw e;
    })
  ).filter((name) => name.endsWith(".json"));
  assert.equal(
    files.length,
    20,
    "Every completed run must outlive in-memory retention before shutdown",
  );
  const reports = await Promise.all(
    files.map((name) =>
      fs.readFile(join(directory, name), "utf8").then(JSON.parse),
    ),
  );
  assert.equal(
    reports.find((r) => r.report.runId === "run-1").report.lastResult.effect
      .status,
    "saved",
  );
  assert.deepEqual(reports[0].installation, {
    id: receipt.id,
    version: receipt.version,
    sourceSha256: receipt.sourceSha256,
    model: receipt.model,
  });
  assert.equal((await fs.stat(directory)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(join(directory, files[0]))).mode & 0o777, 0o600);
  const state = await supervisor.status();
  assert.equal(state.evidence.failed, 0);
  assert.equal(state.evidence.pending, 0);
});

test("failed executions retain their independent saved effect, while immediate refusals create no archive", async (t) => {
  const { owner, run } = await fixture(t);
  const failed = await run("command", "failed");
  assert.deepEqual(failed.result, {
    ok: false,
    execution: "failed",
    runId: "run-1",
    effect: { status: "saved" },
  });
  const refused = await run("execute", "refused");
  assert.equal(refused.result.error_code, "revision_required");
  const files = await fs.readdir(join(owner, "run-reports")).catch((e) => {
    if (e.code === "ENOENT") return [];
    throw e;
  });
  assert.equal(files.length, 1);
  const archived = JSON.parse(
    await fs.readFile(join(owner, "run-reports", files[0]), "utf8"),
  );
  assert.deepEqual(archived.report.lastResult, failed.result);
});

test("archive failure preserves the application result, blocks further runs and safe restart, and retries without replay", async (t) => {
  const { owner, supervisor, run } = await fixture(t);
  const directory = join(owner, "run-reports");
  await fs.writeFile(directory, "deliberately blocked archive directory");
  try {
    const { state, result } = await run();
    assert.deepEqual(result, {
      ok: true,
      execution: "completed",
      runId: "run-1",
      effect: { status: "saved" },
    });
    assert.equal(state.evidence.failed, 1);
    assert.equal(state.cleanupPending, true);
    await assert.rejects(supervisor.quiesce(), /safe|boundary|evidence/i);
    await assert.rejects(supervisor.close({ requireSafe: true }), /evidence/i);
    const blocked = await run();
    assert.equal(blocked.result.error_code, "evidence_incomplete");
    assert.equal((await supervisor.status()).running.id, "fixture-slot");
  } finally {
    await fs.unlink(directory);
    await supervisor.retryEvidence();
  }
  assert.equal((await supervisor.status()).cleanupPending, false);
  assert.equal(
    (await fs.readdir(directory)).length,
    1,
    "Retry saves the retained report once",
  );
  assert.equal(
    (await run()).result.runId,
    "run-2",
    "Evidence retry cannot replay a command",
  );
});

test("failed archive cleanup retains its owned child until evidence is repaired and cleanup retried", async (t) => {
  const { owner, supervisor, run } = await fixture(t);
  const directory = join(owner, "run-reports");
  await fs.writeFile(directory, "deliberately blocked archive directory");
  try {
    await run();
    await assert.rejects(supervisor.close(), /cleanup/i);
    const state = await supervisor.status();
    assert.equal(state.cleanupPending, true);
    assert.equal(state.evidence.failed, 1);
    assert.equal(
      JSON.parse(await fs.readFile(join(owner, "child.json"), "utf8")).status,
      "running",
    );
  } finally {
    await fs.unlink(directory);
    const retried = await supervisor.retryEvidence();
    assert.equal(retried.failed, 0);
    await supervisor.close();
  }
  assert.equal(
    JSON.parse(await fs.readFile(join(owner, "child.json"), "utf8")).status,
    "closed",
  );
  assert.equal((await fs.readdir(directory)).length, 1);
  assert.equal((await supervisor.status()).cleanupPending, false);
});
