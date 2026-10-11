// Execute the public CLI against an independent real Chromium/HTTP fixture.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
const runtime =
  process.env.CLI_TEST_RUNTIME ||
  new URL("../src/index.mjs", import.meta.url).href;
const cli =
  process.env.CLI_TEST_BINARY ||
  fileURLToPath(new URL("../src/cli.mjs", import.meta.url));
const engine =
  process.env.CLI_TEST_ENGINE ||
  fileURLToPath(new URL("./fake-engine.mjs", import.meta.url));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (const mode of ["default", "custom"])
  test(`public CLI ${mode} project dispatches once and preserves facade/report ownership`, async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "daedlo-cli-factory-"));
    const report = path.join(root, "report.json"),
      marker = path.join(root, "fixture-closed"),
      address = path.join(root, "fixture-url");
    const project = path.join(root, "project.mjs");
    const code = `
    import http from 'node:http';
    import fs from 'node:fs';
    import {createDriverSession} from ${JSON.stringify(runtime)};
    export async function createProject({resources}) {
      let writes = 0, resumes = 0;
      const server = http.createServer((req,res) => {
        if(req.method === 'POST' && req.url === '/save') { writes++; res.writeHead(201); res.end('saved'); }
        else { res.writeHead(200,{'Content-Type':'text/html'}); res.end('<!doctype html><title>CLI fixture</title><textarea id="note">Retained</textarea><button id="save">Save</button><output id="status">Draft</output><script>document.querySelector("#save").onclick=async()=>{const r=await fetch("/save",{method:"POST"});if(r.ok)document.querySelector("#status").textContent="Saved"}</script>'); }
      });
      resources.own(server,{label:'HTTP fixture',close:()=>new Promise(resolve=>{server.close(()=>{fs.writeFileSync(${JSON.stringify(marker)},'closed');resolve()});server.closeAllConnections()})});
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
      const url='http://127.0.0.1:'+server.address().port;
      fs.writeFileSync(${JSON.stringify(address)},url);
      const createAdapter=({page})=>({
        model:{id:'test',version:'1'},
        observe:async()=>({connected:true,session:'alpha',facts:{text:await page.locator('#note').inputValue(),saved:await page.locator('#status').textContent()==='Saved'}}),
        handlers:{edit:async({text},x)=>x.fill(page.locator('#note'),text),save:async(_,x)=>x.click(page.locator('#save'))},
        settle:async()=>page.waitForFunction(()=>document.querySelector('#status').textContent==='Saved'),
        effectStatus:()=>({status:writes===1?'saved':'not_attempted'}),
      });
      if(${JSON.stringify(mode)}==='default') return {url,enginePath:${JSON.stringify(engine)},createAdapter};
      return {url,createSession:async({page,context})=>{
        const inner=await createDriverSession({page,context,enginePath:${JSON.stringify(engine)},adapter:createAdapter({page})});
        return {...inner,resume(){resumes++;return inner.stop()},report(){return {...inner.report(),customFacade:true,customResumeCalls:resumes,fixtureWrites:writes}}};
      }};
    }
  `;
    fs.writeFileSync(project, code);
    let output = "",
      browser,
      child;
    t.after(async () => {
      if (child && child.exitCode === null) {
        child.kill("SIGTERM");
        await boundedExit(exited).catch(() => child.kill("SIGKILL"));
      }
      await browser?.close();
      fs.rmSync(root, { recursive: true, force: true });
    });
    child = spawn(
      process.execPath,
      [cli, "--project", project, "--report", report],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    child.stdout.on("data", (data) => (output += data));
    child.stderr.on("data", (data) => (output += data));
    const exited = once(child, "exit");
    const deadline = Date.now() + 15000;
    while (
      !output.includes("Daedlo monitor:") &&
      child.exitCode === null &&
      Date.now() < deadline
    )
      await delay(30);
    assert.match(output, /Daedlo monitor: http:\/\/127\.0\.0\.1:\d+/, output);
    const url = output.match(/Daedlo monitor: (http:\/\/127\.0\.0\.1:\d+)/)[1];
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url);
    await page.locator('[data-command="save"]').waitFor();
    const status = await (await page.request.get(url + "/status")).json();
    assert.equal(
      status.driver.lastResult,
      null,
      "Startup must not execute app commands",
    );
    const response = await page.request.post(url + "/command", {
      data: { id: "save", revision: status.driver.revision, params: {} },
    });
    assert.equal(response.status(), 200);
    assert.equal((await response.json()).effect.status, "saved");
    if (mode === "custom") {
      await page.request.post(url + "/control", { data: { action: "pause" } });
      await page.request.post(url + "/control", { data: { action: "resume" } });
      assert.equal(
        (await (await page.request.get(url + "/status")).json()).driver
          .execution,
        "stopped",
        "Viewer must use the exact custom resume policy",
      );
    }
    child.kill("SIGTERM");
    const [exitCode] = await boundedExit(exited);
    assert.equal(exitCode, 0, output);
    const result = JSON.parse(fs.readFileSync(report));
    assert.equal(result.lastResult.effect.status, "saved");
    assert.equal(
      result.resources.every((r) => r.status === "closed" || !r.owned),
      true,
    );
    if (mode === "custom") {
      assert.equal(result.customFacade, true);
      assert.equal(result.customResumeCalls, 1);
      assert.equal(result.fixtureWrites, 1);
    }
    assert.equal(fs.readFileSync(marker, "utf8"), "closed");
    for (const origin of [url, fs.readFileSync(address, "utf8")])
      await assert.rejects(
        fetch(origin, { signal: AbortSignal.timeout(1000) }),
      );
  });

test("public CLI aborts a paused startup command before any write or next startup command", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "daedlo-cli-startup-"));
  const marker = path.join(root, "paused"),
    receipt = path.join(root, "cleanup.json"),
    address = path.join(root, "fixture-url"),
    project = path.join(root, "project.mjs");
  fs.writeFileSync(
    project,
    `
    import http from 'node:http'; import fs from 'node:fs';
    import {createDriverSession} from ${JSON.stringify(runtime)};
    export async function createProject({resources}) {
      let writes=0, next=0, closes=0, result;
      const server=http.createServer((req,res)=>{ if(req.method==='POST'){writes++;res.writeHead(201);res.end('saved')}else{res.end(${JSON.stringify(`<button id="save" onclick="fetch('/save',{method:'POST'})">Save</button>`)})} });
      resources.own(server,{label:'startup HTTP fixture',close:()=>new Promise(resolve=>{server.close(()=>{fs.writeFileSync(${JSON.stringify(receipt)},JSON.stringify({writes,next,closes,result}));resolve()});server.closeAllConnections()})});
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
      const url='http://127.0.0.1:'+server.address().port; fs.writeFileSync(${JSON.stringify(address)},url);
      return {url,createSession:async({page,context,signal,ownSession})=>{
        let inner;
        inner=await createDriverSession({page,context,enginePath:${JSON.stringify(engine)},adapter:{
          model:{id:'test',version:'1'}, observe:async()=>({connected:true,session:'alpha',facts:{saved:false}}),
          handlers:{edit:async()=>{}, save:async(_,x)=>{inner.pause();fs.writeFileSync(${JSON.stringify(marker)},'paused');await x.click(page.locator('#save'))}},
        }});
        const facade=ownSession({...inner,close:async()=>{closes++;await inner.close()}});
        const abort=()=>facade.stop(); signal.addEventListener('abort',abort,{once:true});
        try {signal.throwIfAborted();result=await facade.execute('save',{},(await facade.snapshot()).revision);signal.throwIfAborted();next++;await facade.execute('save',{},(await facade.snapshot()).revision);return facade}
        finally {signal.removeEventListener('abort',abort)}
      }};
    }
  `,
  );
  let output = "";
  const child = spawn(process.execPath, [cli, "--project", project], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (data) => (output += data));
  child.stderr.on("data", (data) => (output += data));
  const exited = once(child, "exit");
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await boundedExit(exited).catch(() => child.kill("SIGKILL"));
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  const deadline = Date.now() + 15000;
  while (
    !fs.existsSync(marker) &&
    child.exitCode === null &&
    Date.now() < deadline
  )
    await delay(30);
  assert.equal(fs.existsSync(marker), true, output);
  assert.equal(output.includes("Daedlo monitor:"), false);
  child.kill("SIGINT");
  const [code] = await boundedExit(exited);
  assert.equal(code, 0, output);
  const final = JSON.parse(fs.readFileSync(receipt));
  assert.equal(final.writes, 0);
  assert.equal(final.next, 0);
  assert.equal(final.closes, 1);
  assert.equal(final.result.error_code, "stopped");
  await assert.rejects(
    fetch(fs.readFileSync(address, "utf8"), {
      signal: AbortSignal.timeout(1000),
    }),
  );
});

async function boundedExit(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error("CLI shutdown timed out")),
          10000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
