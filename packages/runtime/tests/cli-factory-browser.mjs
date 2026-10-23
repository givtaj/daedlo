// Execute the public CLI against an independent real Chromium/HTTP fixture.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath, pathToFileURL } from "node:url";
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
const playwrightUrl = import.meta.resolve("playwright");
function browserEnvironment(
  root,
  mode,
  executablePath = chromium.executablePath(),
) {
  const env = { ...process.env };
  delete env.PLAYWRIGHT_MODULE;
  delete env.CHROMIUM;
  if (!mode.startsWith("override-")) return { env, verify() {} };
  const wrapper = path.join(root, "selected playwright.mjs");
  const witness = path.join(root, "browser-selection.jsonl");
  fs.writeFileSync(
    wrapper,
    `
    import fs from 'node:fs'; import {execFileSync} from 'node:child_process'; import {createHash} from 'node:crypto'; import {chromium as actual} from ${JSON.stringify(playwrightUrl)};
    const record=value=>fs.appendFileSync(${JSON.stringify(witness)},JSON.stringify(value)+'\\n');
    record({event:'import'});
    export const chromium={async launch(options){
      record({event:'launch',options});
      const browser=await actual.launch(options);
      try {
        const cdp=await browser.newBrowserCDPSession();
        try {
          const processes=(await cdp.send('SystemInfo.getProcessInfo')).processInfo.filter(p=>p.type==='browser');
          if(processes.length!==1)throw Error('Expected exactly one real browser process');
          const pid=processes[0].id; process.kill(pid,0);
          const actualPath=process.platform==='darwin'?execFileSync('ps',['-p',String(pid),'-o','comm='],{encoding:'utf8'}).trim():process.platform==='linux'?fs.readlinkSync('/proc/'+pid+'/exe'):null;
          if(!actualPath)throw Error('Actual executable witness unsupported on '+process.platform);
          const realpath=fs.realpathSync(actualPath);
          record({event:'browser',version:browser.version(),pid,executable:{path:actualPath,realpath,sha256:createHash('sha256').update(fs.readFileSync(realpath)).digest('hex')}});
        }
        finally {await cdp.detach();}
        return browser;
      } catch(error) {await browser.close();throw error;}

    }};
  `,
  );
  env.PLAYWRIGHT_MODULE =
    mode === "override-relative"
      ? "./selected playwright.mjs"
      : mode === "override-absolute"
        ? wrapper
        : pathToFileURL(wrapper).href;
  env.CHROMIUM = executablePath;
  const sha256 = (p) =>
    createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  const selection = {
    module: {
      configured: env.PLAYWRIGHT_MODULE,
      path: wrapper,
      sha256: sha256(wrapper),
    },
    executable: {
      configured: executablePath,
      exists: fs.existsSync(executablePath),
    },
    actualLaunchVerified: false,
  };
  if (selection.executable.exists)
    Object.assign(selection.executable, {
      realpath: fs.realpathSync(executablePath),
      sha256: sha256(executablePath),
      mode: fs.statSync(executablePath).mode & 0o777,
    });
  const identityPath = path.join(root, "browser-selection-identity.json");
  fs.writeFileSync(identityPath, JSON.stringify(selection, null, 2) + "\n", {
    mode: 0o600,
  });
  return {
    env,
    verify({ failedLaunch = false } = {}) {
      assert.equal(
        fs.existsSync(witness),
        true,
        "The selected module must actually be evaluated",
      );
      const rows = fs
        .readFileSync(witness, "utf8")
        .trim()
        .split("\n")
        .map(JSON.parse);
      assert.deepEqual(
        rows.map((r) => r.event),
        failedLaunch ? ["import", "launch"] : ["import", "launch", "browser"],
        "Exactly one selected import/launch; no fallback or retry",
      );
      assert.deepEqual(rows[1].options, {
        headless: true,
        executablePath,
        handleSIGINT: false,
        handleSIGTERM: false,
      });
      if (!failedLaunch) {
        assert.ok(rows[2].version);
        assert.equal(
          rows[2].executable.realpath,
          selection.executable.realpath,
          "OS browser process uses the selected executable",
        );
      }
      if (!failedLaunch)
        assert.equal(
          rows[2].executable.sha256,
          selection.executable.sha256,
          "Actual browser bytes match selected executable",
        );
      selection.actualLaunchVerified = !failedLaunch;
      selection.failedLaunch = failedLaunch;
      selection.observedExecutable = rows[2]?.executable;
      selection.observedBrowserPid = rows[2]?.pid;
      selection.observedVersion = rows[2]?.version;
      fs.writeFileSync(
        identityPath,
        JSON.stringify(selection, null, 2) + "\n",
        { mode: 0o600 },
      );
      return rows;
    },
  };
}
function preserveEvidence(root, name, output, child) {
  if (!process.env.CLI_TEST_EVIDENCE) return;
  const destination = path.join(process.env.CLI_TEST_EVIDENCE, name);
  assert.equal(
    fs.existsSync(destination),
    false,
    "Do not overwrite previous CLI evidence",
  );
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  fs.cpSync(root, path.join(destination, "fixture"), { recursive: true });
  fs.writeFileSync(path.join(destination, "cli.log"), output, { mode: 0o600 });
  const sha256 = (p) =>
    createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  fs.writeFileSync(
    path.join(destination, "identity.json"),
    JSON.stringify(
      {
        node: process.version,
        cli,
        runtime,
        engine,
        cliSha256: sha256(cli),
        engineSha256: sha256(engine),
        testSha256: sha256(fileURLToPath(import.meta.url)),
        childPid: child?.pid,
        exitCode: child?.exitCode,
        signal: child?.signalCode,
        temporaryRoot: root,
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
}
// Only fixed labels and lifecycle states enter public test failure messages.
// The fixture journal itself remains in private acceptance evidence.
const cleanupLabels = new Set([
  "HTTP fixture",
  "controlled browser",
  "driver session",
  "live viewer",
]);
function cleanupDiagnostics(root, child) {
  const known = (value, allowed) =>
    allowed.has(value) ? value : "unrecognized";
  const read = (name) => {
    try {
      const file = path.join(root, name);
      if (fs.statSync(file).size > 65536) return null;
      return fs.readFileSync(file, "utf8");
    } catch {
      return null;
    }
  };
  let phases = [],
    resources = [];
  try {
    phases = (read("cleanup-phase.jsonl") ?? "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(-8)
      .map((line) => {
        const value = JSON.parse(line);
        return {
          label: known(value.label, cleanupLabels),
          state: known(value.state, new Set(["closing", "closed", "failed"])),
        };
      });
  } catch {
    phases = [];
  }
  try {
    const report = JSON.parse(read("report.json"));
    if (Array.isArray(report?.resources))
      resources = report.resources.slice(-8).map((value) => ({
        label: known(value.label, cleanupLabels),
        state: known(
          value.status,
          new Set(["owned", "attached", "closed", "cleanup_failed"]),
        ),
      }));
  } catch {
    resources = [];
  }
  return {
    exitCode: Number.isInteger(child.exitCode) ? child.exitCode : null,
    signal:
      child.signalCode === null
        ? null
        : known(child.signalCode, new Set(["SIGINT", "SIGTERM", "SIGKILL"])),
    reportPresent: fs.existsSync(path.join(root, "report.json")),
    fixtureClosed: fs.existsSync(path.join(root, "fixture-closed")),
    phases,
    resources,
  };
}
function cleanupJournal(root) {
  return `
      const journal = (label,state) => {try {fs.appendFileSync(${JSON.stringify(path.join(root, "cleanup-phase.jsonl"))},JSON.stringify({label,state})+'\\n')} catch {}};
      const own = resources.own;
      resources.own = (resource, options) => own(resource, {...options, close: async value => {
        journal(options.label,'closing');
        try {const result=await options.close(value);journal(options.label,'closed');return result}
        catch(error){journal(options.label,'failed');throw error}
      }});
  `;
}

async function waitForMarker(marker, child, output) {
  const deadline = Date.now() + 15000;
  while (
    !fs.existsSync(marker) &&
    child.exitCode === null &&
    Date.now() < deadline
  )
    await delay(30);
  assert.equal(fs.existsSync(marker), true, output());
}

for (const mode of [
  "default",
  "custom",
  "override-absolute",
  "override-relative",
  "override-file-url",
  "override-active",
])
  test(`public CLI ${mode} project dispatches once and preserves facade/report ownership`, async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "daedlo cli factory "));
    const report = path.join(root, "report.json"),
      marker = path.join(root, "fixture-closed"),
      address = path.join(root, "fixture-url");
    const project = path.join(root, "project.mjs");
    const active = path.join(root, "active");
    const selected = browserEnvironment(root, mode);
    const code = `
    import http from 'node:http';
    import fs from 'node:fs';
    import {createDriverSession} from ${JSON.stringify(runtime)};
    export async function createProject({resources}) {
      ${cleanupJournal(root)}
      let writes = 0, resumes = 0, release;
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
        handlers:{edit:async({text},x)=>x.fill(page.locator('#note'),text),save:async(_,x)=>{await x.click(page.locator('#save'));if(${JSON.stringify(mode)}==='override-active'){await page.waitForFunction(()=>document.querySelector('#status').textContent==='Saved');fs.writeFileSync(${JSON.stringify(active)},'active');await new Promise(resolve=>{release=resolve})}}},
        settle:async()=>page.waitForFunction(()=>document.querySelector('#status').textContent==='Saved'),
        effectStatus:()=>({status:writes===1?'saved':'not_attempted'}),
      });
      if(${JSON.stringify(mode)}==='default') return {url,enginePath:${JSON.stringify(engine)},createAdapter};
      return {url,createSession:async({page,context})=>{
        const inner=await createDriverSession({page,context,enginePath:${JSON.stringify(engine)},adapter:createAdapter({page})});
        return {...inner,stop(){inner.stop();release?.()},resume(){resumes++;return inner.stop()},report(){return {...inner.report(),customFacade:true,customResumeCalls:resumes,fixtureWrites:writes}}};
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
      preserveEvidence(root, mode, output, child);
      fs.rmSync(root, { recursive: true, force: true });
    });
    child = spawn(
      process.execPath,
      [cli, "--project", project, "--report", report],
      { stdio: ["ignore", "pipe", "pipe"], cwd: root, env: selected.env },
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
    const responding = page.request.post(url + "/command", {
      data: { id: "save", revision: status.driver.revision, params: {} },
    });
    if (mode === "override-active") {
      await waitForMarker(active, child, () => output);
      child.kill("SIGTERM");
    }
    const response = await responding;
    assert.equal(response.status(), 200);
    const responseBody = await response.json();
    assert.equal(responseBody.effect.status, "saved");
    if (mode !== "default" && mode !== "override-active") {
      await page.request.post(url + "/control", { data: { action: "pause" } });
      await page.request.post(url + "/control", { data: { action: "resume" } });
      assert.equal(
        (await (await page.request.get(url + "/status")).json()).driver
          .execution,
        "stopped",
        "Viewer must use the exact custom resume policy",
      );
    }
    if (mode !== "override-active") child.kill("SIGTERM");
    const [exitCode] = await boundedExit(exited, () =>
      cleanupDiagnostics(root, child),
    );
    assert.equal(exitCode, 0, output);
    const result = JSON.parse(fs.readFileSync(report));
    assert.equal(result.lastResult.effect.status, "saved");
    assert.equal(
      result.lastResult.runId,
      responseBody.runId,
      "Final report must identify the same public command receipt",
    );
    assert.deepEqual(result.lastResult.effect, responseBody.effect);
    assert.equal(
      result.resources.every((r) => r.status === "closed" || !r.owned),
      true,
    );
    if (mode !== "default") {
      assert.equal(result.customFacade, true);
      assert.equal(
        result.customResumeCalls,
        mode === "override-active" ? 0 : 1,
      );
      assert.equal(result.fixtureWrites, 1);
    }
    if (mode === "override-active")
      assert.equal(result.lastResult.execution, "stopped");
    selected.verify();
    assert.equal(fs.readFileSync(marker, "utf8"), "closed");
    for (const origin of [url, fs.readFileSync(address, "utf8")])
      await assert.rejects(
        fetch(origin, { signal: AbortSignal.timeout(1000) }),
      );
  });

for (const mode of ["default", "override-startup"])
  test(`public CLI ${mode} aborts a paused startup command before any write or next startup command`, async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "daedlo-cli-startup-"));
    const selected = browserEnvironment(root, mode);
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
      cwd: root,
      env: selected.env,
    });
    child.stdout.on("data", (data) => (output += data));
    child.stderr.on("data", (data) => (output += data));
    const exited = once(child, "exit");
    t.after(async () => {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await boundedExit(exited).catch(() => child.kill("SIGKILL"));
      }
      preserveEvidence(root, mode + "-startup", output, child);
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
    selected.verify();
    await assert.rejects(
      fetch(fs.readFileSync(address, "utf8"), {
        signal: AbortSignal.timeout(1000),
      }),
    );
  });

for (const failure of ["missing", "non-executable"])
  test(`public CLI selected ${failure} executable fails once and preserves attached service`, async (t) => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "daedlo bad executable "),
    );
    const executable = path.join(root, "selected browser");
    if (failure === "non-executable")
      fs.writeFileSync(executable, "not executable\n", { mode: 0o600 });
    const selected = browserEnvironment(root, "override-file-url", executable);
    const marker = path.join(root, "owned-closed"),
      address = path.join(root, "owned-url"),
      attachedClosed = path.join(root, "attached-closed");
    const attached = http.createServer((req, res) =>
      res.end("attached remains"),
    );
    await new Promise((resolve) => attached.listen(0, "127.0.0.1", resolve));
    const attachedUrl = `http://127.0.0.1:${attached.address().port}`;
    const project = path.join(root, "project.mjs");
    fs.writeFileSync(
      project,
      `
    import http from 'node:http'; import fs from 'node:fs';
    export async function createProject({resources}) {
      const server=http.createServer((req,res)=>res.end('owned fixture'));
      resources.own(server,{label:'owned HTTP fixture',close:()=>new Promise(resolve=>{server.close(()=>{fs.writeFileSync(${JSON.stringify(marker)},'closed');resolve()});server.closeAllConnections()})});
      resources.attach({url:${JSON.stringify(attachedUrl)}},{label:'attached HTTP fixture',close:()=>fs.writeFileSync(${JSON.stringify(attachedClosed)},'incorrectly closed')});
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
      const url='http://127.0.0.1:'+server.address().port;fs.writeFileSync(${JSON.stringify(address)},url);
      return {url,createSession:async()=>{throw Error('session must not start')}};
    }
  `,
    );
    let output = "";
    const child = spawn(process.execPath, [cli, "--project", project], {
      cwd: root,
      env: selected.env,
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
      await new Promise((resolve) => {
        attached.close(resolve);
        attached.closeAllConnections();
      });
      preserveEvidence(root, failure + "-executable", output, child);
      fs.rmSync(root, { recursive: true, force: true });
    });
    const [code, signal] = await boundedExit(exited);
    assert.equal(signal, null, output);
    assert.equal(code, 1, output);
    assert.doesNotMatch(output, /Daedlo monitor:/);
    selected.verify({ failedLaunch: true });
    assert.equal(fs.readFileSync(marker, "utf8"), "closed");
    assert.equal(fs.existsSync(attachedClosed), false);
    assert.equal(await (await fetch(attachedUrl)).text(), "attached remains");
    await assert.rejects(
      fetch(fs.readFileSync(address, "utf8"), {
        signal: AbortSignal.timeout(1000),
      }),
    );
  });

async function boundedExit(promise, diagnostics) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              Error(
                "CLI shutdown timed out" +
                  (diagnostics ? `: ${JSON.stringify(diagnostics())}` : ""),
              ),
            ),
          10000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
