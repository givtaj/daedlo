// Real child IPC with a deliberately legacy runtime double: it has no frontend
// checks. These tests verify the stable native owner before raw effects, not a
// browser or customer outcome. Real-browser checks remain separate acceptance.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { createNinjaSupervisor } from "../scripts/release/ninja-supervisor.mjs";
import {
  frontendIdentity,
  safeFrontend,
} from "../scripts/release/native-session.mjs";

const executablePath = await fs.realpath(process.execPath);
const browserIdentity = {
  executablePath,
  version: process.version,
  sha256: createHash("sha256")
    .update(await fs.readFile(executablePath))
    .digest("hex"),
};
const methods = [
  "execute",
  "command",
  "runRecipe",
  "startPresentation",
  "advancePresentation",
  "resume",
];

async function fixture(t, mode = "matching") {
  const root = await fs.mkdtemp(
    join(await fs.realpath(tmpdir()), "native-target-guard-"),
  );
  const statePath = join(root, "state.json"),
    effectsPath = join(root, "effects.jsonl");
  const state = { origin: "http://127.0.0.1:43101", connected: true };
  await fs.writeFile(statePath, JSON.stringify(state));
  await fs.writeFile(effectsPath, "");
  await fs.mkdir(join(root, "runtime/src"), { recursive: true });
  await fs.writeFile(
    join(root, "runtime/src/index.mjs"),
    `
import fs from 'node:fs/promises';
import http from 'node:http';
export {createResourceScope} from ${JSON.stringify(new URL("../packages/runtime/src/resources.mjs", import.meta.url).href)};
export async function createDriverSession({resources,statePath,effectsPath}) {
  let paused=false;
  const session={
    snapshot:async()=>({busy:false,paused,connected:JSON.parse(await fs.readFile(statePath,'utf8')).connected,descriptor:{id:'guard-fixture',version:'1'},identity:{runtime:'@browser-driver/runtime@0.1.4-alpha.3'}}),
    observe:async()=>({connected:true}),pause:()=>{paused=true;},stop:()=>{},
    report:()=>({format:'browser-driver-report/1'}),close:async()=>resources.close()
  };
  for(const method of ${JSON.stringify(methods)}) session[method]=async()=>{await fs.appendFile(effectsPath,JSON.stringify({method})+'\\n');return {ok:true};};
  return session;
}
export async function createViewer({session}) {
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const c of req)body+=c;
    try {const {method}=JSON.parse(body);await session[method]('synthetic');res.end(JSON.stringify({ok:true}));}
    catch(error){res.statusCode=409;res.end(JSON.stringify({ok:false,code:error.code,message:error.message}));}
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  return {url:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(done=>server.close(done))};
}`,
  );
  await fs.writeFile(
    join(root, "launcher.mjs"),
    `
import {readFileSync} from 'node:fs';
export async function createManagedLaunch({runtime,resources,settings,installation}) {
  const browser={version:()=>process.version,isConnected:()=>true};
  resources.own(browser,{label:'synthetic owned browser',close:()=>{}});
  await runtime.registerBrowser({browser,executablePath:installation.browser.executablePath});
  const context={browser:()=>browser,newPage:()=>{}};
  resources.own(context,{label:'synthetic owned context',close:()=>{}});
  const page={url:()=>JSON.parse(readFileSync(settings.statePath,'utf8')).origin,context:()=>context,isClosed:()=>false};
  const session=await runtime.createDriverSession({page,context,statePath:settings.statePath,effectsPath:settings.effectsPath});
  const otherContext={browser:()=>browser,newPage:()=>{}};
  const viewerContext=settings.mode==='wrong-context'?otherContext:context;
  const viewerPage=settings.mode==='matching'?page:{url:page.url,context:()=>viewerContext,isClosed:()=>false};
  const viewer=await runtime.createViewer({page:viewerPage,context:viewerContext,session});
  return {session,viewerUrl:viewer.url,draftState:async()=>false};
}`,
  );
  const receipt = {
    id: "legacy-guard-slot",
    version: "0.1.4-alpha.3",
    sourceSha256: "a".repeat(64),
    runtimePath: join(root, "runtime/src/index.mjs"),
    enginePath: join(root, "unused-engine"),
    launcherPath: join(root, "launcher.mjs"),
    sourcePath: root,
    model: { id: "guard-fixture", version: "1" },
    browser: browserIdentity,
  };
  const supervisor = await createNinjaSupervisor({
    root: join(root, "supervisor"),
    settings: { statePath, effectsPath, mode },
    timeoutMs: 3000,
    frontend: {
      name: "Accepted legacy frontend",
      targetOrigin: state.origin,
      model: receipt.model,
      evidenceLocation: join(root, "reports"),
      ownership: {
        browser: "unknown",
        context: "unknown",
        application: "unknown",
      },
    },
  });
  t.after(async () => {
    await supervisor.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, supervisor, receipt, state, statePath, effectsPath };
}

for (const condition of ["target origin changes", "session disconnects"]) {
  test(`accepted legacy runtime rejects all effect entrypoints when ${condition}`, async (t) => {
    const f = await fixture(t);
    await f.supervisor.start(f.receipt);
    await f.supervisor.accept();
    const live = await f.supervisor.status();
    assert.equal(live.ready, true);
    const send = async (method) => {
      const response = await fetch(live.running.viewerUrl, {
        method: "POST",
        body: JSON.stringify({ method }),
      });
      return { status: response.status, body: await response.json() };
    };
    assert.equal(
      (await send("execute")).status,
      200,
      "The synthetic legacy runtime can perform raw effects before invalidation",
    );
    await fs.writeFile(f.effectsPath, "");
    if (condition === "target origin changes")
      f.state.origin = "http://127.0.0.1:43102";
    else f.state.connected = false;
    await fs.writeFile(f.statePath, JSON.stringify(f.state));
    const responses = [];
    for (const method of methods)
      responses.push({ method, ...(await send(method)) });
    const lost = await f.supervisor.status();
    assert.equal(lost.ready, false);
    assert.equal(
      lost.running.id,
      f.receipt.id,
      "Retain accepted resource ownership after loss of readiness",
    );
    assert.deepEqual(
      responses.map((r) => [r.method, r.status]),
      methods.map((method) => [method, 409]),
      "A failed named frontend must reject every effect-enabling entrypoint before raw legacy code",
    );
    assert.equal(
      await fs.readFile(f.effectsPath, "utf8"),
      "",
      "No raw effect may run after readiness is invalidated",
    );
  });
}
for (const mode of ["wrong-page", "wrong-context"]) {
  test(`native readiness rejects ${mode} even at the same target origin`, async (t) => {
    const f = await fixture(t, mode);
    await assert.rejects(
      f.supervisor.start(f.receipt),
      (error) => error.code === "target_mismatch",
      "Viewer must bind to the exact page/context used for the driver session",
    );
    assert.equal((await f.supervisor.status()).running, null);
    assert.equal(await fs.readFile(f.effectsPath, "utf8"), "");
  });
}

test("native frontend metadata retains the registered model's 256-character boundary", () => {
  for (const field of ["id", "version"]) {
    for (const length of [201, 256]) {
      const model = {
        id: "fixture",
        version: "1",
        [field]: "m".repeat(length),
      };
      const identity = frontendIdentity({
        store: "/synthetic/store",
        registration: { projectId: "fixture", model },
      });
      assert.deepEqual(
        safeFrontend(identity).model,
        model,
        "An already accepted model identity must survive the tools bootstrap",
      );
    }
    const model = { id: "fixture", version: "1", [field]: "m".repeat(257) };
    const identity = frontendIdentity({
      store: "/synthetic/store",
      registration: { projectId: "fixture", model },
    });
    assert.throws(() => safeFrontend(identity), /Invalid frontend identity/);
  }
});
