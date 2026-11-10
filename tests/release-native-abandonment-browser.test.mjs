// Independent synthetic acceptance, usable against source or explicit installed tools/runtime.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
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
const runtimePath = resolve(
  process.env.DAEDLO_NATIVE_RUNTIME_PATH ??
    join(repo, "packages/runtime/src/index.mjs"),
);
const enginePath = resolve(
  process.env.DAEDLO_NATIVE_ENGINE_PATH ??
    join(repo, "target/debug/notebook-engine"),
);
const output = resolve(
  process.env.DAEDLO_ABANDONMENT_OUTPUT ??
    join(repo, "artifacts/native-abandonment"),
);
const runtimePackage = JSON.parse(
  await fs.readFile(join(dirname(runtimePath), "../package.json"), "utf8"),
);
const { chromium } = createRequire(runtimePath)("playwright");
const { createNinjaSupervisor } = await import(
  pathToFileURL(join(toolsRoot, "ninja-supervisor.mjs"))
);
const hash = (value) => createHash("sha256").update(value).digest("hex");

test(
  "real browser abandonment retains an uncertain save, closes owned resources and preserves the attached application",
  { timeout: 90000 },
  async (t) => {
    const root = await fs.realpath(
      await fs.mkdtemp(join(tmpdir(), "daedlo-abandonment-browser-")),
    );
    await fs.mkdir(output, { recursive: true });
    const app = await createNotebookServer();
    let supervisor, controller;
    const result = {
      status: "RUNNING",
      scope:
        "Independent synthetic notebook; selected tools/runtime/engine; seeded installation receipt, no customer acceptance",
      cleanup: "PENDING",
    };
    t.after(async () => {
      const errors = [];
      for (const resource of [supervisor, controller, app])
        try {
          await resource?.close();
        } catch (error) {
          errors.push(error);
        }
      result.cleanup = errors.length ? "FAIL" : "PASS";
      if (result.status === "RUNNING" || errors.length) result.status = "FAIL";
      await fs.writeFile(
        join(output, "result.json"),
        JSON.stringify(result, null, 2),
      );
      if (errors.length)
        throw new AggregateError(
          errors,
          "Retained owned abandonment fixture: " + root,
        );
      await fs.rm(root, { recursive: true, force: true });
    });
    controller = await chromium.launch({
      headless: true,
      handleSIGINT: false,
      handleSIGTERM: false,
    });
    const executablePath = await fs.realpath(chromium.executablePath());
    const browser = {
      version: controller.version(),
      executablePath,
      sha256: hash(await fs.readFile(executablePath)),
    };
    const controlPath = join(root, "control.json");
    await fs.writeFile(
      controlPath,
      JSON.stringify({ fault: false, unknown: false }),
    );
    const launcherPath = join(root, "launcher.mjs");
    await fs.writeFile(
      launcherPath,
      `
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createNotebookAdapter} from ${JSON.stringify(new URL("../examples/notebook/adapter.mjs", import.meta.url).href)};
const {chromium}=createRequire(${JSON.stringify(pathToFileURL(runtimePath).href)})('playwright');
export async function createManagedLaunch({runtime,resources,installation,settings}) {
 resources.attach({origin:settings.origin},{label:'Attached notebook application'});
 const browser=await chromium.launch({headless:true,executablePath:installation.browser.executablePath,handleSIGINT:false,handleSIGTERM:false});
 resources.own(browser,{label:'Owned recovery browser',close:()=>browser.close()});await runtime.registerBrowser({browser,executablePath:installation.browser.executablePath});
 const context=await browser.newContext();resources.own(context,{label:'Owned recovery context',close:()=>context.close()});
 const page=await context.newPage();await page.goto(settings.origin);await page.locator('#note').waitFor();
 const adapter=createNotebookAdapter(page),observe=adapter.observe;
 adapter.observe=async()=>{const flags=JSON.parse(await fs.readFile(settings.controlPath,'utf8'));if(flags.fault)throw Error('synthetic model observation unavailable');return observe()};
 // A deliberately unavailable persistence hook keeps the canonical save uncertain.
 adapter.effectStatus=()=>({status:'uncertain'});
 const session=await runtime.createDriverSession({page,context,adapter});
 const viewer=await runtime.createViewer({page,context,session});
 return {session,viewerUrl:viewer.url,async draftState(){
   const flags=JSON.parse(await fs.readFile(settings.controlPath,'utf8'));if(flags.unknown)return null;
   // Fresh direct page measurement is independent of the deliberately failed model.
   // This fixture has no pending business requests after its awaited save promise.
   return page.evaluate(()=>!['clean','saved'].includes(document.body.dataset.phase));
 }};
}
`,
    );
    const receipt = {
      id: "abandonment-browser",
      version: runtimePackage.version,
      runtimePackage: runtimePackage.name,
      sourceSha256: "a".repeat(64),
      runtimePath,
      enginePath,
      launcherPath,
      sourcePath: root,
      model: { id: "notebook", version: "1" },
      browser,
    };
    supervisor = await createNinjaSupervisor({
      root: join(root, "supervisor"),
      settings: { origin: app.url, controlPath },
      timeoutMs: 10000,
    });
    await supervisor.start(receipt);
    await supervisor.accept();
    const live = await supervisor.status();
    const origin = new URL(live.running.viewerUrl).origin;
    const command = async (id, params = {}) => {
      const before = await fetch(origin + "/status").then((r) => r.json());
      const response = await fetch(origin + "/command", {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ id, params, revision: before.driver.revision }),
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    await command("edit", { text: "Synthetic retained evidence" });
    const saved = await command("save");
    assert.equal(saved.execution, "completed");
    assert.equal(saved.effect.status, "uncertain");
    assert.equal(app.writes, 1);
    const readback = await fetch(app.url + "/api/notes").then((r) => r.json());
    assert.equal(readback.items.length, 1);
    assert.equal(readback.items[0].text, "Synthetic retained evidence");
    const archiveRoot = join(root, "supervisor/run-reports");
    const archives = new Map();
    for (const name of await fs.readdir(archiveRoot))
      archives.set(name, await fs.readFile(join(archiveRoot, name), "utf8"));
    assert.equal(archives.size, 2);
    const viewer = await controller.newPage();
    await viewer.goto(live.running.viewerUrl);
    await viewer.screenshot({
      path: join(output, "before-abandonment.png"),
      fullPage: true,
    });
    await fs.writeFile(
      controlPath,
      JSON.stringify({ fault: true, unknown: true }),
    );
    assert.equal((await supervisor.status()).observation.status, "failed");
    await assert.rejects(supervisor.quiesce(), { code: "observation_failed" });
    await assert.rejects(supervisor.reviewAbandonment(), {
      code: "draft_unknown",
    });
    await fs.writeFile(
      controlPath,
      JSON.stringify({ fault: true, unknown: false }),
    );
    const review = await supervisor.reviewAbandonment();
    assert.equal(review.originalReport.lastResult.runId, saved.runId);
    assert.equal(review.originalReport.lastResult.effect.status, "uncertain");
    const closed = await supervisor.abandon({ reviewId: review.id });
    assert.equal(closed.closed, true);
    assert.equal(closed.abandoned, true);
    assert.equal(
      closed.recovery.originalReport.lastResult.effect.status,
      "uncertain",
    );
    assert.ok(
      closed.recovery.resources
        .filter((r) => r.owned)
        .every((r) => r.status === "closed"),
    );
    assert.ok(
      closed.recovery.resources.some(
        (r) => !r.owned && r.status === "attached",
      ),
    );
    await assert.rejects(fetch(origin + "/status"));
    assert.equal((await fetch(app.url)).ok, true);
    assert.equal(
      app.writes,
      1,
      "Recovery never replays the saved business request",
    );
    for (const [name, bytes] of archives)
      assert.equal(await fs.readFile(join(archiveRoot, name), "utf8"), bytes);
    assert.equal((await supervisor.status()).running, null);
    Object.assign(result, {
      status: "PASS",
      runtime: { name: runtimePackage.name, version: runtimePackage.version },
      toolsRoot,
      runtimePath,
      enginePath,
      engineSha256: hash(await fs.readFile(enginePath)),
      browser: { version: browser.version, sha256: browser.sha256 },
      checks: [
        "real save remains uncertain despite separate readback",
        "unknown safety blocks recovery",
        "failed model plus fresh independent safety supports review",
        "reviewed cleanup preserves canonical archives",
        "owned browser/engine/viewer exit without signals",
        "attached application survives with exactly one write",
      ],
    });
  },
);
