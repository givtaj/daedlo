import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { sha256 } from "../scripts/release/manifest.mjs";
import { createNinjaSupervisor } from "../scripts/release/ninja-supervisor.mjs";
// Synthetic identity only: this executable stands in for a browser in lifecycle tests.
// Actual browser preservation is covered by the separate customer acceptance.
const browserExecutable = await fs.realpath(process.execPath);
const syntheticBrowser = {
  version: process.version,
  executablePath: browserExecutable,
  sha256: sha256(await fs.readFile(browserExecutable)),
};
async function fixture(t, launcher, runtimeSource) {
  const root = await fs.mkdtemp(
    join(await fs.realpath(os.tmpdir()), "ninja-supervisor-"),
  );
  await fs.mkdir(join(root, "runtime", "src"), { recursive: true });
  await fs.writeFile(
    join(root, "runtime", "src", "index.mjs"),
    runtimeSource ??
      `export {createResourceScope} from ${JSON.stringify(new URL("../packages/runtime/src/resources.mjs", import.meta.url).href)};
 export async function createDriverSession({resources}){let paused=false;return {snapshot:async()=>({busy:false,paused,connected:true,descriptor:{id:'test',version:'1'},identity:{runtime:'@browser-driver/runtime@1.0.0'}}),observe:async()=>({connected:true}),pause:()=>paused=true,resume:()=>paused=false,report:()=>({format:'browser-driver-report/1'}),close:async()=>resources.close(),execute:async()=>({ok:true})}};`,
  );
  await fs.writeFile(join(root, "project-launcher.mjs"), launcher);
  await fs.writeFile(
    join(root, "launcher.mjs"),
    `import {createManagedLaunch as launch} from './project-launcher.mjs';
    export async function createManagedLaunch(args){await args.runtime.registerBrowser({browser:{version:()=>process.version},executablePath:${JSON.stringify(browserExecutable)}});return launch(args)}`,
  );
  const receipt = {
    id: "test-slot",
    version: "1.0.0",
    runtimePath: join(root, "runtime", "src", "index.mjs"),
    enginePath: join(root, "engine"),
    launcherPath: join(root, "launcher.mjs"),
    sourcePath: root,
    model: { id: "test", version: "1" },
    browser: structuredClone(syntheticBrowser),
  };
  const supervisor = await createNinjaSupervisor({
    root: join(root, "supervisor"),
    settings: {},
    timeoutMs: 3000,
  });
  t.after(async () => {
    await supervisor.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  return { supervisor, receipt, root };
}
test("supervisor starts exact selected runtime, gates shutdown, and closes owned child", async (t) => {
  const { supervisor, receipt } = await fixture(
    t,
    `export async function createManagedLaunch({runtime}){return {session:await runtime.createDriverSession({}),draftState:async()=>false}}`,
  );
  await supervisor.start(receipt);
  await supervisor.accept();
  assert.equal((await supervisor.status()).running?.id, "test-slot");
  await supervisor.quiesce();
  assert.equal((await supervisor.status()).paused, true);
  assert.equal((await supervisor.report()).format, "browser-driver-report/1");
  await supervisor.close();
  assert.equal((await supervisor.status()).running, null);
});
test("launcher cannot execute an application command during startup", async (t) => {
  const { supervisor, receipt } = await fixture(
    t,
    `export async function createManagedLaunch({runtime}){const session=await runtime.createDriverSession({});await session.execute('save');return {session,draftState:async()=>false}}`,
  );
  await assert.rejects(supervisor.start(receipt), /startup|before readiness/i);
  await supervisor.close();
});
test("unknown draft state refuses quiesce, retaining the running child", async (t) => {
  const { supervisor, receipt } = await fixture(
    t,
    `export async function createManagedLaunch({runtime}){return {session:await runtime.createDriverSession({}),draftState:async()=>undefined}}`,
  );
  await supervisor.start(receipt);
  await supervisor.accept();
  await assert.rejects(supervisor.quiesce(), /draft/i);
  assert.equal((await supervisor.status()).running?.id, "test-slot");
});

test("a command racing draft inspection unwinds only the rejected quiesce pause", async (t) => {
  const runtimeSource = `export {createResourceScope} from ${JSON.stringify(new URL("../packages/runtime/src/resources.mjs", import.meta.url).href)};
 export async function createDriverSession({resources}){let paused=false,busy=false;return {snapshot:async()=>({busy,paused,connected:true,descriptor:{id:'test',version:'1'},identity:{runtime:'@browser-driver/runtime@1.0.0'}}),observe:async()=>({connected:true}),pause:()=>paused=true,resume:()=>paused=false,report:()=>({format:'browser-driver-report/1'}),close:async()=>resources.close(),execute:async()=>{busy=true;return {ok:true}}}};`;
  const { supervisor, receipt } = await fixture(
    t,
    `export async function createManagedLaunch({runtime}){const session=await runtime.createDriverSession({});let inspections=0;return {session,draftState:async()=>{if(++inspections===2)await session.execute('arriving-command');return false}}}`,
    runtimeSource,
  );
  await supervisor.start(receipt);
  await supervisor.accept();
  await assert.rejects(supervisor.quiesce(), /run started|busy|boundary/i);
  const state = await supervisor.status();
  assert.equal(state.busy, true);
  assert.equal(
    state.paused,
    false,
    "Rejected quiesce must not strand the in-flight command paused",
  );
  assert.equal(
    state.quiesced,
    false,
    "Rejected quiesce must release its own effect gate",
  );
  assert.equal(state.running.id, receipt.id);
});

test("a draft changed after report persistence blocks cleanup and leaves the running session usable", async (t) => {
  const { supervisor, receipt, root } = await fixture(
    t,
    `import fs from 'node:fs/promises'; import {join} from 'node:path';
    export async function createManagedLaunch({runtime,sourceRoot}){return {session:await runtime.createDriverSession({}),draftState:async()=>{try{await fs.access(join(sourceRoot,'dirty-draft'));return true}catch(error){if(error.code==='ENOENT')return false;throw error}}}}`,
  );
  await supervisor.start(receipt);
  await supervisor.accept();
  await supervisor.quiesce();
  await supervisor.report();
  const flag = join(root, "dirty-draft");
  await fs.writeFile(flag, "draft changed during report persistence");
  try {
    await assert.rejects(
      supervisor.close({ requireSafe: true }),
      /draft|safe|boundary/i,
    );
    const current = await supervisor.status();
    assert.equal(current.running?.id, receipt.id);
    assert.equal(current.dirty, true);
    assert.equal(current.paused, false);
    assert.equal(current.quiesced, false);
  } finally {
    await fs.unlink(flag);
  }
});

test("commands remain gated after readiness until the manager accepts the committed installation", async (t) => {
  const { supervisor, receipt, root } = await fixture(
    t,
    `import fs from 'node:fs/promises'; import {join} from 'node:path';
    export async function createManagedLaunch({runtime,sourceRoot}){const session=await runtime.createDriverSession({});let inspections=0;return {session,draftState:async()=>{if(++inspections>1){let outcome;try{await session.execute('delayed-command');outcome='executed'}catch(error){outcome=error.code}await fs.writeFile(join(sourceRoot,'effect-gate.json'),JSON.stringify({outcome}));}return false}}}`,
  );
  await supervisor.start(receipt);
  await supervisor.status();
  assert.equal(
    JSON.parse(await fs.readFile(join(root, "effect-gate.json"), "utf8"))
      .outcome,
    "startup_effect",
  );
  await supervisor.accept();
  await supervisor.status();
  assert.equal(
    JSON.parse(await fs.readFile(join(root, "effect-gate.json"), "utf8"))
      .outcome,
    "executed",
  );
});

test("changed browser identity blocks managed session creation", async (t) => {
  const { supervisor, receipt } = await fixture(
    t,
    `export async function createManagedLaunch({runtime}){return {session:await runtime.createDriverSession({}),draftState:async()=>false}}`,
  );
  receipt.browser.sha256 = "0".repeat(64);
  await assert.rejects(supervisor.start(receipt), /browser|changed/i);
  assert.equal((await supervisor.status()).running, null);
});

test("failed draft observation retains accepted ownership and a sanitized reason, then recovers without replay", async (t) => {
  const { supervisor, receipt, root } = await fixture(
    t,
    `import fs from 'node:fs/promises'; import {join} from 'node:path';
    export async function createManagedLaunch({runtime,sourceRoot}){return {session:await runtime.createDriverSession({}),draftState:async()=>{try{await fs.access(join(sourceRoot,'observation-fault'))}catch(error){if(error.code==='ENOENT')return false;throw error}throw Object.assign(Error('private-page-content-and-path'),{code:'private-failure-code'})}}}`,
  );
  await supervisor.start(receipt);
  await supervisor.accept();
  const fault = join(root, "observation-fault");
  await fs.writeFile(fault, "synthetic fault");
  const failed = await supervisor.status();
  assert.equal(failed.observation?.status, "failed");
  assert.equal(failed.observation.error.code, "draft_observation_failed");
  assert.equal(failed.running?.id, receipt.id);
  assert.equal(failed.dirty, null);
  assert.equal(failed.ready, false);
  assert.equal(JSON.stringify(failed).includes("private-"), false);
  await assert.rejects(supervisor.quiesce(), { code: "observation_failed" });
  assert.notEqual(
    JSON.parse(await fs.readFile(join(root, "supervisor/child.json"))).status,
    "closed",
  );
  await fs.unlink(fault);
  const recovered = await supervisor.status();
  assert.equal(recovered.observation.status, "available");
  assert.equal(recovered.dirty, false);
  assert.equal(recovered.ready, true);
  assert.equal(recovered.startup.phase, "ready");
  await supervisor.quiesce();
  await supervisor.close({ requireSafe: true });
});

test("a disconnected snapshot cannot use a clean draft hook as shutdown proof or latch startup failure", async (t) => {
  const runtimeSource = `import fs from 'node:fs/promises';
    export {createResourceScope} from ${JSON.stringify(new URL("../packages/runtime/src/resources.mjs", import.meta.url).href)};
    export async function createDriverSession({resources}){let paused=false;return {snapshot:async()=>{let connected=true;try{await fs.access(new URL('../../observation-fault',import.meta.url));connected=false}catch(error){if(error.code!=='ENOENT')throw error}return {busy:false,paused,connected,error_code:connected?undefined:'disconnected',error:'private-observation-detail',descriptor:{id:'test',version:'1'},identity:{runtime:'@browser-driver/runtime@1.0.0'}}},observe:async()=>({connected:true}),pause:()=>paused=true,resume:()=>paused=false,report:()=>({format:'browser-driver-report/1'}),close:async()=>resources.close()}};`;
  const { supervisor, receipt, root } = await fixture(
    t,
    `export async function createManagedLaunch({runtime}){return {session:await runtime.createDriverSession({}),draftState:async()=>false}}`,
    runtimeSource,
  );
  await supervisor.start(receipt);
  await supervisor.accept();
  const fault = join(root, "observation-fault");
  await fs.writeFile(fault, "synthetic fault");
  try {
    const failed = await supervisor.status();
    assert.equal(failed.observation?.status, "failed");
    assert.equal(failed.observation.error.code, "disconnected");
    assert.equal(failed.dirty, null);
    await assert.rejects(supervisor.quiesce(), { code: "observation_failed" });
    await assert.rejects(supervisor.close({ requireSafe: true }), {
      code: "observation_failed",
    });
    assert.equal((await supervisor.status()).running?.id, receipt.id);
  } finally {
    await fs.unlink(fault);
  }
  const recovered = await supervisor.status();
  assert.equal(recovered.observation.status, "available");
  assert.equal(recovered.startup.phase, "ready");
  assert.equal(recovered.startup.error, undefined);
  await supervisor.quiesce();
  await supervisor.close({ requireSafe: true });
});

test("timed out child observation is unreachable with retained ownership until a fresh explicit read", async (t) => {
  const { supervisor, receipt, root } = await fixture(
    t,
    `import fs from 'node:fs/promises'; import {join} from 'node:path';
    export async function createManagedLaunch({runtime,sourceRoot}){return {session:await runtime.createDriverSession({}),draftState:async()=>{for(;;){try{await fs.access(join(sourceRoot,'hold-observation'))}catch(error){if(error.code==='ENOENT')return false;throw error}await new Promise(done=>setTimeout(done,20))}}}}`,
  );
  await supervisor.start(receipt);
  await supervisor.accept();
  const flag = join(root, "hold-observation");
  await fs.writeFile(flag, "test-owned observation gate");
  try {
    const state = await supervisor.status();
    assert.equal(state.observation.status, "unreachable");
    assert.equal(state.observation.error.code, "child_timeout");
    assert.equal(state.running.id, receipt.id);
    assert.equal(state.running.viewerUrl, null);
    assert.equal(state.busy, null);
    assert.equal(state.paused, null);
    assert.equal(state.dirty, null);
    assert.equal(state.cleanupPending, true);
  } finally {
    await fs.unlink(flag);
  }
  const fresh = await supervisor.status();
  assert.equal(fresh.observation.status, "available");
  assert.equal(fresh.running.id, receipt.id);
});

test("a retained child record alone is unreachable rather than stopped or clean", async (t) => {
  const root = await fs.mkdtemp(
    join(await fs.realpath(os.tmpdir()), "retained-child-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const marker = join(root, "child.json");
  const record = {
    status: "running",
    installationId: "synthetic-retained-owner",
  };
  await fs.writeFile(marker, JSON.stringify(record));
  const supervisor = await createNinjaSupervisor({ root });
  const state = await supervisor.status();
  assert.equal(state.observation.status, "unreachable");
  assert.equal(state.observation.error.code, "child_unreachable");
  assert.equal(state.dirty, null);
  assert.equal(state.cleanupPending, true);
  await assert.rejects(supervisor.close(), /not owned/);
  assert.deepEqual(JSON.parse(await fs.readFile(marker)), record);
});

test("observation lost after pausing retains the owned gate and permits a fresh safe stop", async (t) => {
  const runtimeSource = `import fs from 'node:fs/promises';
    export {createResourceScope} from ${JSON.stringify(new URL("../packages/runtime/src/resources.mjs", import.meta.url).href)};
    export async function createDriverSession({resources}){let paused=false;return {snapshot:async()=>{let connected=true;if(paused){try{await fs.access(new URL('../../observation-fault',import.meta.url));connected=false}catch(error){if(error.code!=='ENOENT')throw error}}return {busy:false,paused,connected,descriptor:{id:'test',version:'1'},identity:{runtime:'@browser-driver/runtime@1.0.0'}}},observe:async()=>({connected:true}),pause:()=>paused=true,resume:()=>{throw Error('must-not-resume-effects')},report:()=>({format:'browser-driver-report/1'}),close:async()=>resources.close()}};`;
  const { supervisor, receipt, root } = await fixture(
    t,
    `export async function createManagedLaunch({runtime}){return {session:await runtime.createDriverSession({}),draftState:async()=>false}}`,
    runtimeSource,
  );
  await supervisor.start(receipt);
  await supervisor.accept();
  const fault = join(root, "observation-fault");
  await fs.writeFile(fault, "fault at paused observation boundary");
  try {
    await assert.rejects(supervisor.quiesce(), { code: "observation_failed" });
    const retained = await supervisor.status();
    assert.equal(retained.quiesced, true);
    assert.equal(retained.paused, true);
    assert.equal(retained.running.id, receipt.id);
  } finally {
    await fs.unlink(fault);
  }
  await supervisor.quiesce();
  await supervisor.close({ requireSafe: true });
});

test("failed unquiesce preserves ownership of its pause for later guarded cleanup", async (t) => {
  const runtimeSource = `import fs from 'node:fs/promises';
    export {createResourceScope} from ${JSON.stringify(new URL("../packages/runtime/src/resources.mjs", import.meta.url).href)};
    export async function createDriverSession({resources}){let paused=false;return {snapshot:async()=>{let connected=true;try{await fs.access(new URL('../../observation-fault',import.meta.url));connected=false}catch(error){if(error.code!=='ENOENT')throw error}return {busy:false,paused,connected,descriptor:{id:'test',version:'1'},identity:{runtime:'@browser-driver/runtime@1.0.0'}}},observe:async()=>({connected:true}),pause:()=>paused=true,resume:()=>paused=false,report:()=>({format:'browser-driver-report/1'}),close:async()=>resources.close()}};`;
  const { supervisor, receipt, root } = await fixture(
    t,
    `export async function createManagedLaunch({runtime}){return {session:await runtime.createDriverSession({}),draftState:async()=>false}}`,
    runtimeSource,
  );
  await supervisor.start(receipt);
  await supervisor.accept();
  await supervisor.quiesce();
  const fault = join(root, "observation-fault");
  await fs.writeFile(
    fault,
    "observation lost while undoing a failed archive boundary",
  );
  try {
    await assert.rejects(supervisor.unquiesce());
    const retained = await supervisor.status();
    assert.equal(retained.quiesced, true);
    assert.equal(retained.paused, true);
  } finally {
    await fs.unlink(fault);
  }
  await supervisor.quiesce();
  await supervisor.close({ requireSafe: true });
});

test("cleanup exceptions cannot masquerade as observation-boundary refusals", async (t) => {
  const { supervisor, receipt, root } = await fixture(
    t,
    `import fs from 'node:fs/promises'; import {join} from 'node:path';
    export async function createManagedLaunch({runtime,sourceRoot}){return {session:await runtime.createDriverSession({}),draftState:async()=>false,close:async()=>{try{await fs.access(join(sourceRoot,'cleanup-repaired'))}catch(error){if(error.code!=='ENOENT')throw error;throw Object.assign(Error('private-cleanup-detail'),{code:'engine_timeout'})}}}}`,
  );
  await supervisor.start(receipt);
  await supervisor.accept();
  try {
    await assert.rejects(supervisor.close({ requireSafe: true }), {
      code: "cleanup_incomplete",
    });
    assert.equal((await supervisor.status()).startup.cleanup, "incomplete");
    assert.notEqual(
      JSON.parse(await fs.readFile(join(root, "supervisor/child.json"))).status,
      "closed",
    );
  } finally {
    await fs.writeFile(join(root, "cleanup-repaired"), "explicit repair");
  }
});

test("missing execution safety facts remain unknown and block guarded cleanup", async (t) => {
  const runtimeSource = `import fs from 'node:fs/promises';
    export {createResourceScope} from ${JSON.stringify(new URL("../packages/runtime/src/resources.mjs", import.meta.url).href)};
    export async function createDriverSession({resources}){let paused=false;return {snapshot:async()=>{let malformed=false;try{await fs.access(new URL('../../malformed-snapshot',import.meta.url));malformed=true}catch(error){if(error.code!=='ENOENT')throw error}return {busy:malformed?undefined:false,paused,connected:true,descriptor:{id:'test',version:'1'},identity:{runtime:'@browser-driver/runtime@1.0.0'}}},observe:async()=>({connected:true}),pause:()=>paused=true,resume:()=>paused=false,report:()=>({format:'browser-driver-report/1'}),close:async()=>resources.close()}};`;
  const { supervisor, receipt, root } = await fixture(
    t,
    `export async function createManagedLaunch({runtime}){return {session:await runtime.createDriverSession({}),draftState:async()=>false}}`,
    runtimeSource,
  );
  await supervisor.start(receipt);
  await supervisor.accept();
  const fault = join(root, "malformed-snapshot");
  await fs.writeFile(fault, "missing busy evidence");
  try {
    const current = await supervisor.status();
    assert.equal(current.observation.status, "failed");
    assert.equal(current.observation.error.code, "invalid_observation");
    assert.equal(current.busy, null);
    await assert.rejects(supervisor.close({ requireSafe: true }), {
      code: "observation_failed",
    });
  } finally {
    await fs.unlink(fault);
  }
});
