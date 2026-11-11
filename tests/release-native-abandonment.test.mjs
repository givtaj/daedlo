import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { sha256 } from "../scripts/release/manifest.mjs";
import { createNinjaSupervisor } from "../scripts/release/ninja-supervisor.mjs";

const executablePath = await fs.realpath(process.execPath);
const browser = {
  executablePath,
  version: process.version,
  sha256: sha256(await fs.readFile(executablePath)),
};
async function fixture(t) {
  const root = await fs.mkdtemp(
    join(await fs.realpath(os.tmpdir()), "daedlo-abandonment-"),
  );
  const flag = join(root, "state.json");
  await fs.writeFile(flag, JSON.stringify({ fault: false, dirty: false }));
  await fs.writeFile(
    join(root, "runtime.mjs"),
    `
import fs from 'node:fs/promises';
export {createResourceScope} from ${JSON.stringify(new URL("../packages/runtime/src/resources.mjs", import.meta.url).href)};
const state=async()=>JSON.parse(await fs.readFile(${JSON.stringify(flag)},'utf8'));
export async function createDriverSession({resources}) {
 let snapshots=0, paused=false, last={runId:'original-run',execution:'completed',effect:{status:'uncertain'}}, closed=false;
 const report={format:'browser-driver-report/1',runId:'original-run',lastResult:last,events:[],resources:[]};
 return {
  async snapshot(){const s=await state();if(++snapshots===s.holdSnapshotAt){await fs.writeFile(${JSON.stringify(join(root, "snapshot-entered"))},'held');while(true){try{await fs.access(${JSON.stringify(join(root, "snapshot-release"))});break}catch(error){if(error.code!=='ENOENT')throw error}await new Promise(done=>setTimeout(done,5));}}return {busy:s.busy??false,paused:paused||s.userPaused===true,activeRun:s.active?{runId:'active-run'}:null,finalization:s.finalization?{status:'pending'}:null,runId:s.runId??'original-run',connected:!s.fault,error_code:s.fault?'unknown_state':undefined,descriptor:{id:'fixture',version:'1'},identity:{runtime:'@daedlo/runtime@1.0.0'}}},
  observe:async()=>({connected:true}),pause(){paused=true;return {ok:true}},resume(){paused=false},
  report:()=>structuredClone(report),execute:async()=>({ok:true}),
  async close(){const s=await state();if(s.cleanupFails)throw Error('private cleanup error');closed=true;await resources.close();await fs.appendFile(${JSON.stringify(join(root, "closed.log"))},'session\\n')}
 };
}`,
  );
  await fs.writeFile(
    join(root, "launcher.mjs"),
    `
import fs from 'node:fs/promises';
export async function createManagedLaunch({runtime,resources}) {
 const browser={version:()=>process.version};resources.own(browser,{label:'Owned test browser',close:()=>fs.appendFile(${JSON.stringify(join(root, "closed.log"))},'browser\\n')});
 resources.attach({}, {label:'Attached application'});
 await runtime.registerBrowser({browser,executablePath:${JSON.stringify(executablePath)}});
 const session=await runtime.createDriverSession({});
 return {session,async draftState(){const s=JSON.parse(await fs.readFile(${JSON.stringify(flag)},'utf8'));if(s.draftThrows)throw Error('private safety error');return s.dirty},close:()=>fs.appendFile(${JSON.stringify(join(root, "closed.log"))},'handle\\n')};
}`,
  );
  const receipt = {
    id: "accepted-fixture",
    version: "1.0.0",
    runtimePackage: "@daedlo/runtime",
    sourceSha256: "a".repeat(64),
    runtimePath: join(root, "runtime.mjs"),
    enginePath: join(root, "engine"),
    launcherPath: join(root, "launcher.mjs"),
    sourcePath: root,
    model: { id: "fixture", version: "1" },
    browser,
  };
  const supervisor = await createNinjaSupervisor({
    root: join(root, "supervisor"),
    timeoutMs: 3000,
  });
  await supervisor.start(receipt);
  await supervisor.accept();
  t.after(async () => {
    await fs.writeFile(flag, JSON.stringify({ fault: false, dirty: false }));
    await supervisor.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  return {
    root,
    supervisor,
    receipt,
    set: async (value) => fs.writeFile(flag, JSON.stringify(value)),
  };
}

test("reviewed abandonment closes an idle unobservable owner without changing the original uncertain result", async (t) => {
  const f = await fixture(t);
  await f.set({ fault: true, dirty: false });
  await assert.rejects(f.supervisor.quiesce(), { code: "observation_failed" });
  let review, failure;
  try {
    review = await f.supervisor.reviewAbandonment();
  } catch (error) {
    failure = error;
  }
  assert.equal(
    failure?.code,
    undefined,
    "An idle failed model with independently fresh safe draft measurement must support recovery review",
  );
  assert.equal(review.kind, "daedlo-abandonment-review");
  assert.equal(review.originalReport.lastResult.effect.status, "uncertain");
  assert.equal(review.installation.id, f.receipt.id);
  assert.equal(review.observation.status, "failed");
  const result = await f.supervisor.abandon({ reviewId: review.id });
  assert.equal(result.closed, true);
  assert.equal(result.abandoned, true);
  const marker = JSON.parse(
    await fs.readFile(join(f.root, "supervisor/child.json"), "utf8"),
  );
  assert.equal(marker.status, "closed");
  const receipts = await fs.readdir(join(f.root, "supervisor/recovery"));
  assert.ok(
    receipts.length >= 3,
    "review, before-cleanup evidence and completed cleanup are retained separately",
  );
  const original = JSON.parse(
    await fs.readFile(
      join(f.root, "supervisor/recovery", review.id + ".review.json"),
      "utf8",
    ),
  );
  assert.deepEqual(original.originalReport, review.originalReport);
  assert.equal((await f.supervisor.status()).running, null);
});

test("unknown/dirty safety, pending runtime work and a user pause cannot obtain an abandonment review", async (t) => {
  for (const flags of [
    { dirty: null },
    { dirty: true },
    { dirty: false, draftThrows: true },
    { dirty: false, busy: true },
    { dirty: false, active: true },
    { dirty: false, finalization: true },
    { dirty: false, userPaused: true },
  ]) {
    await t.test(JSON.stringify(flags), async (t) => {
      const f = await fixture(t);
      await f.set({ fault: true, ...flags });
      await assert.rejects(f.supervisor.reviewAbandonment());
      assert.equal((await f.supervisor.status()).running.id, f.receipt.id);
      await assert.rejects(fs.readFile(join(f.root, "closed.log")), {
        code: "ENOENT",
      });
    });
  }
});

test("review identities and fresh draft safety are rechecked immediately before cleanup", async (t) => {
  const f = await fixture(t);
  await f.set({ fault: true, dirty: false });
  const review = await f.supervisor.reviewAbandonment();
  await assert.rejects(f.supervisor.abandon({ reviewId: "wrong-review" }), {
    code: "stale_recovery_review",
  });
  await f.set({ fault: true, dirty: true });
  await assert.rejects(f.supervisor.abandon({ reviewId: review.id }), {
    code: "dirty_draft",
  });
  await assert.rejects(fs.readFile(join(f.root, "closed.log")), {
    code: "ENOENT",
  });
  await f.set({ fault: true, dirty: false, runId: "different-run" });
  await assert.rejects(f.supervisor.abandon({ reviewId: review.id }), {
    code: "stale_recovery_review",
  });
});

test("failed cleanup retains the same review and retries only unfinished owned cleanup", async (t) => {
  const f = await fixture(t);
  await f.set({ fault: true, dirty: false });
  const review = await f.supervisor.reviewAbandonment();
  await f.set({ fault: true, dirty: false, cleanupFails: true });
  await assert.rejects(f.supervisor.abandon({ reviewId: review.id }), {
    code: "cleanup_incomplete",
  });
  const first = await fs.readFile(join(f.root, "closed.log"), "utf8");
  assert.equal(first, "browser\n");
  await f.set({ fault: true, dirty: null });
  const result = await f.supervisor.abandon({ reviewId: review.id });
  assert.equal(result.closed, true);
  const final = await fs.readFile(join(f.root, "closed.log"), "utf8");
  assert.equal(
    final.split("browser\n").length - 1,
    1,
    "already closed browser is not cleaned twice",
  );
});

test("completion archive failure retains a resource-free child for explicit same-review retry", async (t) => {
  const f = await fixture(t);
  await f.set({ fault: true, dirty: false });
  const review = await f.supervisor.reviewAbandonment();
  const blocked = join(
    f.root,
    "supervisor/recovery",
    review.id + ".complete.json",
  );
  await fs.mkdir(blocked);
  await assert.rejects(f.supervisor.abandon({ reviewId: review.id }), {
    code: "evidence_incomplete",
  });
  const before = await fs.readFile(join(f.root, "closed.log"), "utf8");
  assert.match(before, /browser/);
  assert.notEqual(
    JSON.parse(await fs.readFile(join(f.root, "supervisor/child.json"), "utf8"))
      .status,
    "closed",
  );
  await fs.rmdir(blocked);
  await f.set({ fault: true, dirty: null });
  assert.equal(
    (await f.supervisor.abandon({ reviewId: review.id })).closed,
    true,
  );
  assert.equal(
    await fs.readFile(join(f.root, "closed.log"), "utf8"),
    before,
    "receipt retry never repeats cleanup",
  );
  assert.equal(
    (await f.supervisor.abandon({ reviewId: review.id })).closed,
    true,
    "the owning supervisor can read back its completed recovery",
  );
});

test("before-close archive failure cannot drain any resource", async (t) => {
  const f = await fixture(t);
  await f.set({ fault: true, dirty: false });
  const review = await f.supervisor.reviewAbandonment();
  const blocked = join(
    f.root,
    "supervisor/recovery",
    review.id + ".before-close.json",
  );
  await fs.mkdir(blocked);
  await assert.rejects(f.supervisor.abandon({ reviewId: review.id }), {
    code: "evidence_incomplete",
  });
  await assert.rejects(fs.readFile(join(f.root, "closed.log")), {
    code: "ENOENT",
  });
  await fs.rmdir(blocked);
  assert.equal(
    (await f.supervisor.abandon({ reviewId: review.id })).closed,
    true,
  );
});

test("an old completed review cannot claim closure of a newly started child", async (t) => {
  const f = await fixture(t);
  await f.set({ fault: true, dirty: false });
  const review = await f.supervisor.reviewAbandonment();
  await f.supervisor.abandon({ reviewId: review.id });
  await f.set({ fault: false, dirty: false });
  await f.supervisor.start(f.receipt);
  await f.supervisor.accept();
  await assert.rejects(f.supervisor.abandon({ reviewId: review.id }), {
    code: "stale_recovery_review",
  });
  assert.equal((await f.supervisor.status()).running.id, f.receipt.id);
});

test("recovery archive retries retained temporary cleanup before any new record can be accepted", async (t) => {
  const { createRecoveryArchive } = await import(
    "../scripts/release/ninja-recovery.mjs"
  );
  const root = await fs.mkdtemp(
    join(await fs.realpath(os.tmpdir()), "recovery-archive-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const archive = createRecoveryArchive(root),
    unlink = fs.unlink;
  let failed = false;
  fs.unlink = async (path) => {
    if (!failed && String(path).endsWith(".tmp")) {
      failed = true;
      throw Object.assign(Error("synthetic temporary cleanup failure"), {
        code: "EACCES",
      });
    }
    return unlink(path);
  };
  try {
    await assert.rejects(
      archive.write("first.review.json", { kind: "original" }),
    );
  } finally {
    fs.unlink = unlink;
  }
  assert.equal(archive.status().pending, 1);
  assert.ok((await fs.readdir(root)).some((name) => name.endsWith(".tmp")));
  await archive.retry();
  assert.equal(archive.status().pending, 0);
  assert.deepEqual(await fs.readdir(root), ["first.review.json"]);
  await assert.rejects(archive.write("first.review.json", { kind: "changed" }));
  assert.deepEqual(
    JSON.parse(await fs.readFile(join(root, "first.review.json"), "utf8")),
    { kind: "original" },
  );
});

test("a draft created during a delayed final lifecycle snapshot still blocks recovery review", async (t) => {
  const f = await fixture(t);
  await f.set({ fault: true, dirty: false, holdSnapshotAt: 5 });
  const reviewing = f.supervisor.reviewAbandonment();
  const rejection = assert.rejects(reviewing, { code: "dirty_draft" });
  const entered = join(f.root, "snapshot-entered");
  let found = false;
  for (let i = 0; i < 200; i++) {
    try {
      await fs.access(entered);
      found = true;
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await new Promise((done) => setTimeout(done, 5));
  }
  assert.equal(
    found,
    true,
    "fixture reached its final delayed lifecycle snapshot",
  );
  await f.set({ fault: true, dirty: true });
  await fs.writeFile(join(f.root, "snapshot-release"), "release");
  await rejection;
  await assert.rejects(fs.readFile(join(f.root, "closed.log")), {
    code: "ENOENT",
  });
});

test("repeated immutable archive writes retain newly failed temporary cleanup", async (t) => {
  const { createRecoveryArchive } = await import(
    "../scripts/release/ninja-recovery.mjs"
  );
  const root = await fs.mkdtemp(
    join(await fs.realpath(os.tmpdir()), "recovery-archive-repeat-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const archive = createRecoveryArchive(root),
    unlink = fs.unlink;
  await archive.write("same.json", { original: true });
  fs.unlink = async () => {
    throw Error("synthetic cleanup failure");
  };
  try {
    await assert.rejects(archive.write("same.json", { original: true }));
  } finally {
    fs.unlink = unlink;
  }
  assert.equal(archive.status().pending, 1);
  await archive.retry();
  assert.equal(archive.status().pending, 0);
  assert.deepEqual(await fs.readdir(root), ["same.json"]);
});
