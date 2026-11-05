// Independent conformance fixture: this exercises a real browser and native
// child, not the private customer application or operating-system sleep.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createNotebookServer } from "../examples/notebook/server.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const toolsRoot = resolve(
  process.env.DAEDLO_NATIVE_TOOLS_ROOT ?? join(repo, "scripts/release"),
);
const runtimePath = join(repo, "packages/runtime/src/index.mjs");
const enginePath = join(repo, "target/debug/notebook-engine");
const output = resolve(
  process.env.DAEDLO_OBSERVATION_OUTPUT ??
    join(repo, "artifacts/wbf-observation"),
);
const runtimePackage = JSON.parse(
  await fs.readFile(join(dirname(runtimePath), "../package.json"), "utf8"),
);
const { chromium } = createRequire(runtimePath)("playwright");
const load = (name) => import(pathToFileURL(join(toolsRoot, name + ".mjs")));
const [
  { nativeCommand },
  { createNinjaManager, ninjaWrite },
  { createNinjaSupervisor },
  { frontendIdentity },
] = await Promise.all([
  load("native"),
  load("ninja-manager"),
  load("ninja-supervisor"),
  load("native-session"),
]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const closeServer = (server) =>
  new Promise((done, reject) => {
    server.close((error) => (error ? reject(error) : done()));
    server.closeAllConnections();
  });

async function createErrorPageFixture(app) {
  const server = http.createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/unavailable") {
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end(
          '<!doctype html><html><body><h1>Request unavailable</h1><p>Synthetic observation fault.</p><a href="/">Overview</a></body></html>',
        );
        return;
      }
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const upstream = await fetch(app.url + request.url, {
        method: request.method,
        ...(request.method === "POST"
          ? {
              body: Buffer.concat(chunks),
              headers: { "Content-Type": "application/json" },
            }
          : {}),
      });
      response.writeHead(upstream.status, {
        "Content-Type": upstream.headers.get("content-type"),
        "Cache-Control": "no-store",
      });
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      response.destroy();
    }
  });
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => closeServer(server),
  };
}

test("an incomplete startup keeps its primary diagnostic visible alongside unavailable observation", async (t) => {
  const { createNinjaServer } = await load("ninja-server");
  const observation = {
    status: "failed",
    error: { code: "observation_failed" },
  };
  const view = {
    instance: "a".repeat(32),
    configSha256: "b".repeat(64),
    toolsSha256: "c".repeat(64),
    runningId: null,
    viewerUrl: null,
    recovery: true,
    observation,
    startup: {
      phase: "failed",
      cleanup: "incomplete",
      error: { code: "invalid_model" },
    },
  };
  const server = await createNinjaServer({
    manager: Object.fromEntries(
      ["status", "check", "prepare", "activate", "rollback"].map((key) => [
        key,
        async () => ({
          project: { id: "startup-fault" },
          phase: "idle",
          running: null,
          blockers: [],
          observation,
        }),
      ]),
    ),
    lifecycle: {
      snapshot: async () => structuredClone(view),
      ...Object.fromEntries(
        ["stop", "refresh", "restart", "retryEvidence"].map((key) => [
          key,
          async () => {},
        ]),
      ),
    },
  });
  t.after(() => server.close());
  const browser = await chromium.launch({
    headless: true,
    handleSIGINT: false,
    handleSIGTERM: false,
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(server.url.replace("/#", "/session#"));
  await page
    .getByText("Startup did not establish readiness", { exact: true })
    .waitFor();
  assert.match(
    await page.locator("#error").textContent(),
    /model descriptor is invalid/i,
  );
  assert.equal(await page.locator("#viewer").isVisible(), false);
  await fs.mkdir(output, { recursive: true });
  await page.screenshot({
    path: join(output, "native-startup-primary-error.png"),
    fullPage: true,
  });
  view.recovery = false;
  view.startup = { phase: "ready", cleanup: "pending" };
  await page
    .getByText(
      "Application observation failed. Current safety state is unconfirmed.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await page.locator("#phase").textContent(),
    "Observation failed",
  );
});

test(
  "native observation failure recovers through the same real page without replay or unsafe cleanup",
  { timeout: 90000 },
  async (t) => {
    await fs.mkdir(output, { recursive: true });
    const root = await fs.realpath(
      await fs.mkdtemp(join(tmpdir(), "daedlo-observation-browser-")),
    );
    const owned = [];
    let owner, controlUrl, app, fixture, controller;
    const result = {
      status: "RUNNING",
      scope:
        "Source native tools with seeded installation receipt; synthetic notebook integration, no customer or host-sleep acceptance",
      cleanup: "PENDING",
    };
    const control = async (action) => {
      const response = await fetch(controlUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      assert.equal(
        response.status,
        200,
        "Synthetic page control must complete",
      );
      return response.json();
    };
    t.after(async () => {
      const failures = [];
      if (owner) {
        try {
          if (controlUrl) await control("restore-clean");
          await owner.close();
          await owner.closed;
        } catch (error) {
          failures.push(error);
        }
      }
      for (const resource of owned.reverse()) {
        try {
          await resource.close();
        } catch (error) {
          failures.push(error);
        }
      }
      result.cleanup = failures.length ? "FAIL" : "PASS";
      if (result.status === "RUNNING" || failures.length)
        result.status = "FAIL";
      await fs.writeFile(
        join(output, "browser-result.json"),
        JSON.stringify(result, null, 2),
      );
      if (failures.length)
        throw new AggregateError(
          failures,
          "Observation fixture cleanup incomplete; retained private directory: " +
            root,
        );
      await fs.rm(root, { recursive: true, force: true });
    });
    app = await createNotebookServer();
    owned.push(app);
    fixture = await createErrorPageFixture(app);
    owned.push(fixture);
    controller = await chromium.launch({
      headless: true,
      handleSIGINT: false,
      handleSIGTERM: false,
    });
    owned.push(controller);
    const executablePath = await fs.realpath(chromium.executablePath());
    const browser = {
      version: controller.version(),
      executablePath,
      sha256: hash(await fs.readFile(executablePath)),
    };
    const launcherPath = join(root, "launcher.mjs");
    await fs.writeFile(
      launcherPath,
      `
import http from "node:http";
import {writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {createNotebookAdapter} from ${JSON.stringify(new URL("../examples/notebook/adapter.mjs", import.meta.url).href)};
const {chromium}=createRequire(${JSON.stringify(pathToFileURL(runtimePath).href)})("playwright");
export async function createManagedLaunch({runtime,resources,settings,installation}) {
  resources.attach({origin:settings.target},{label:"Separately owned observation fixture"});
  const browser=await chromium.launch({headless:true,executablePath:installation.browser.executablePath,handleSIGINT:false,handleSIGTERM:false});
  resources.own(browser,{label:"Observation browser",close:()=>browser.close()});
  await runtime.registerBrowser({browser,executablePath:installation.browser.executablePath});
  const context=await browser.newContext();
  resources.own(context,{label:"Observation context",close:()=>context.close()});
  const page=await context.newPage();
  await page.goto(settings.target);
  await page.locator("#note").waitFor();
  const adapter=createNotebookAdapter(page);
  const session=await runtime.createDriverSession({page,context,adapter,identity:{application:"Independent observation fixture"}});
  resources.own(session,{label:"Observation session",close:()=>session.close()});
  const viewer=await runtime.createViewer({page,context,session});
  resources.own(viewer,{label:"Observation viewer",close:()=>viewer.close()});
  let pending=false,unknown=false;
  // Private test-only controls act on this owned page. They are not an adapter
  // recovery API, application transition graph or production launcher feature.
  const controls=http.createServer(async(req,res)=>{
    try {
      let body="";for await(const chunk of req)body+=chunk;
      const {action}=JSON.parse(body);
      if(action==="fault")await page.goto(settings.target+"/unavailable");
      else if(action==="overview")await page.getByRole("link",{name:"Overview",exact:true}).click();
      else if(action==="dirty")await page.getByLabel("Note",{exact:true}).fill("Retained synthetic draft");
      else if(action==="unknown")unknown=true;
      else if(action==="known")unknown=false;
      else if(action==="pending")pending=true;
      else if(action==="reconcile")pending=false;
      else if(action==="restore-clean") {
        unknown=false;pending=false;
        if(new URL(page.url()).pathname==="/unavailable")await page.getByRole("link",{name:"Overview",exact:true}).click();
        await page.getByRole("button",{name:"Clear draft",exact:true}).click();
      }
      else if(action!=="inspect")throw Error("Unknown synthetic control");
      res.setHeader("Content-Type","application/json");res.end(JSON.stringify({pending,unknown,pagePath:new URL(page.url()).pathname}));
    }catch{res.statusCode=500;res.end("Synthetic control failed");}
  });
  await new Promise(done=>controls.listen(0,"127.0.0.1",done));
  resources.own(controls,{label:"Private observation test control",close:()=>new Promise((done,reject)=>{controls.close(e=>e?reject(e):done());controls.closeAllConnections();})});
  await writeFile(settings.controlPath,"http://127.0.0.1:"+controls.address().port);
  return {session,viewerUrl:viewer.url,async draftState(){
    if(pending||unknown)return null;
    try {const {facts}=await adapter.observe();return ["draft","saving","validation","recovery"].includes(facts.phase);}
    catch {throw Error("synthetic-observation-secret-do-not-publish");}
  }};
}
`,
    );
    const store = join(root, "store");
    const configPath = join(root, "config.json");
    const config = {
      schemaVersion: 1,
      store,
      frontend: {
        name: "Observation recovery fixture",
        targetOrigin: fixture.url,
      },
      registration: {
        projectId: "observation-recovery",
        sourceRoot: join(root, "source"),
        model: { id: "notebook", version: "1" },
      },
      settings: {
        target: fixture.url,
        controlPath: join(root, "test-control.txt"),
      },
    };
    await fs.writeFile(configPath, JSON.stringify(config));
    const receipt = {
      id: "observation-accepted",
      version: runtimePackage.version,
      runtimePackage: runtimePackage.name,
      sourceSha256: "a".repeat(64),
      runtimePath,
      enginePath,
      launcherPath,
      sourcePath: root,
      model: config.registration.model,
      browser,
    };
    const supervisor = await createNinjaSupervisor({
      root: join(store, "supervisor"),
      settings: config.settings,
      frontend: frontendIdentity(config),
      timeoutMs: 10000,
    });
    const manager = await createNinjaManager({
      root: store,
      registration: config.registration,
      supervisor,
      provider: {},
      installer: { verify: async () => receipt },
    });
    await ninjaWrite(join(store, "state.json"), {
      schemaVersion: 1,
      projectId: config.registration.projectId,
      generation: 1,
      current: receipt.id,
      previous: null,
      checkpoint: null,
      available: null,
      operation: null,
      phase: "idle",
      error: null,
    });
    const deps = {
      readConfig: async () => ({ config, keys: [] }),
      open: async () => ({ manager, supervisor }),
      toolsSha256: "c".repeat(64),
    };
    const status = async () =>
      (await nativeCommand("status", configPath, deps)).result;
    owner = await nativeCommand("start", configPath, deps);
    assert.equal(owner.result.status, "running");
    controlUrl = await fs.readFile(config.settings.controlPath, "utf8");
    const startup = await controller.newPage();
    await startup.goto(owner.result.startupUrl);
    await startup
      .getByText("This frontend is ready", { exact: true })
      .waitFor();
    const viewerOrigin = new URL(owner.result.viewerUrl).origin;
    const command = async (id, params = {}) => {
      const before = await fetch(viewerOrigin + "/status").then((r) =>
        r.json(),
      );
      const response = await fetch(viewerOrigin + "/command", {
        method: "POST",
        headers: { Origin: viewerOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ id, params, revision: before.driver.revision }),
      });
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      return result;
    };
    await control("dirty");
    const completed = await command("cancel");
    assert.equal(completed.ok, true);
    const archiveRoot = join(store, "supervisor/run-reports");
    const archiveFiles = await fs.readdir(archiveRoot);
    assert.equal(archiveFiles.length, 1);
    const archivePath = join(archiveRoot, archiveFiles[0]);
    const archivedBytes = await fs.readFile(archivePath, "utf8");
    assert.equal(JSON.parse(archivedBytes).report.runId, completed.runId);
    assert.equal(app.writes, 0);

    await control("fault");
    const failed = await status();
    assert.equal(
      failed.status,
      "observation_failed",
      "An actual unrecognized application page must not become a stopped native owner",
    );
    assert.equal(failed.observation.status, "failed");
    assert.equal(failed.running.id, receipt.id);
    assert.equal(failed.dirty, null);
    assert.equal(failed.viewerUrl, null);
    assert.ok(failed.blockers.some((b) => b.code === "draft_unknown"));
    assert.equal(
      JSON.stringify(failed).includes(
        "synthetic-observation-secret-do-not-publish",
      ),
      false,
    );
    const unavailable = await fetch(viewerOrigin + "/status").then((r) =>
      r.json(),
    );
    assert.equal(unavailable.driver.connected, false);
    assert.deepEqual(unavailable.driver.commands, []);
    await assert.rejects(nativeCommand("stop", configPath, deps));
    assert.equal((await status()).running.id, receipt.id);
    assert.equal(await fs.readFile(archivePath, "utf8"), archivedBytes);
    assert.equal(app.writes, 0);
    await startup.waitForFunction(() =>
      /observation|unavailable|unknown/i.test(
        document.querySelector("#phase").textContent,
      ),
    );
    assert.equal(await startup.locator("#viewer").isVisible(), false);
    assert.equal(
      (await startup.locator("body").innerText()).includes(
        "synthetic-observation-secret-do-not-publish",
      ),
      false,
    );
    await startup.screenshot({
      path: join(output, "native-observation-failed.png"),
      fullPage: true,
    });

    await control("overview");
    const recovered = await status();
    assert.equal(recovered.status, "running");
    assert.equal(recovered.observation.status, "available");
    assert.equal(recovered.startup.phase, "ready");
    assert.equal(recovered.startup.error, undefined);
    assert.equal(recovered.dirty, false);
    assert.equal(recovered.running.id, receipt.id);
    assert.equal(recovered.viewerUrl, owner.result.viewerUrl);
    assert.equal(recovered.reused, true);
    assert.equal(await fs.readFile(archivePath, "utf8"), archivedBytes);
    assert.equal((await fs.readdir(archiveRoot)).length, 1);
    assert.equal(
      app.writes,
      0,
      "Read-only recovery must replay no business request",
    );
    await startup
      .getByText("This frontend is ready", { exact: true })
      .waitFor();
    await startup.screenshot({
      path: join(output, "native-observation-recovered.png"),
      fullPage: true,
    });

    await control("dirty");
    const dirty = await status();
    assert.equal(dirty.dirty, true);
    assert.ok(dirty.blockers.some((b) => b.code === "dirty_draft"));
    await assert.rejects(nativeCommand("stop", configPath, deps));
    await command("cancel");
    for (const [block, resolveBlock] of [
      ["unknown", "known"],
      ["pending", "reconcile"],
    ]) {
      await control(block);
      const blocked = await status();
      assert.equal(blocked.dirty, null);
      assert.ok(blocked.blockers.some((b) => b.code === "draft_unknown"));
      await assert.rejects(nativeCommand("stop", configPath, deps));
      assert.equal((await control("inspect"))[block], true);
      assert.equal(await fs.readFile(archivePath, "utf8"), archivedBytes);
      await control(resolveBlock);
      assert.equal((await status()).dirty, false);
    }
    const finalArchiveCount = (await fs.readdir(archiveRoot)).length;
    assert.equal(finalArchiveCount, 2);
    await nativeCommand("stop", configPath, deps);
    await owner.closed;
    owner = null;
    assert.equal((await fetch(fixture.url)).ok, true);
    assert.equal(app.writes, 0);
    assert.equal((await fs.readdir(archiveRoot)).length, finalArchiveCount);
    assert.equal(await fs.readFile(archivePath, "utf8"), archivedBytes);
    Object.assign(result, {
      status: "PASS",
      runtime: { name: runtimePackage.name, version: runtimePackage.version },
      browser: { version: browser.version, sha256: browser.sha256 },
      checks: [
        "real unknown page produces explicit failed observation while accepted owner survives",
        "guarded stop preserves unknown draft, archives and attached application",
        "read-only Overview navigation restores the same session without startup error latch or replay",
        "known dirty, unknown draft and synthetic pending journal separately block shutdown",
        "normal safe close preserves completed archives and attached application with zero writes",
      ],
    });
  },
);
