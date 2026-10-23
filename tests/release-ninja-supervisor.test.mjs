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
