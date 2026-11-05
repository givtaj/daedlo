import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
const engineCrate = resolve(
  process.env.DAEDLO_NATIVE_ENGINE_CRATE ?? join(repo, "crates/daedlo-engine"),
);
const targetDir = resolve(
  process.env.DAEDLO_NATIVE_TARGET_DIR ?? join(repo, "target"),
);
const runtimePackage = JSON.parse(
  await fs.readFile(join(dirname(runtimePath), "../package.json"), "utf8"),
);
const playwrightPath = createRequire(runtimePath).resolve("playwright");
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
const output = resolve(
  process.env.DAEDLO_NATIVE_OUTPUT ?? join(repo, "artifacts/alpha4-native"),
);
const until = async (fn) => {
  const deadline = Date.now() + 15000;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline)
      throw Error("Timed out waiting for measured native state");
    await new Promise((done) => setTimeout(done, 30));
  }
};

test(
  "real native startup shows delayed bootstrap, two independent named frontend viewers, failure and owned cleanup",
  { timeout: 90000 },
  async (t) => {
    await fs.mkdir(output, { recursive: true });
    const root = await fs.realpath(
      await fs.mkdtemp(join(tmpdir(), "daedlo-native-browser-")),
    );
    const handles = [];
    const supervisorHandles = [];
    const pendingHandles = [];
    const app1 = await createNotebookServer(),
      app2 = await createNotebookServer();
    let releaseGate, signalGate;
    const held = new Promise((done) => (releaseGate = done)),
      entered = new Promise((done) => (signalGate = done));
    let releaseCancel, signalCancel;
    const heldCancel = new Promise((done) => (releaseCancel = done)),
      enteredCancel = new Promise((done) => (signalCancel = done));
    const extraGates = new Map();
    function extraGate(path) {
      let release, entered;
      const held = new Promise((done) => (release = done)),
        seen = new Promise((done) => (entered = done));
      extraGates.set(path, { held, entered, release });
      return { release, seen };
    }
    const gate = http.createServer(async (req, res) => {
      if (extraGates.has(req.url)) {
        const g = extraGates.get(req.url);
        g.entered();
        await g.held;
      } else if (req.url === "/cancel") {
        signalCancel();
        await heldCancel;
      } else {
        signalGate();
        await held;
      }
      res.end("released");
    });
    await new Promise((done) => gate.listen(0, "127.0.0.1", done));
    const gateUrl = `http://127.0.0.1:${gate.address().port}/`;
    const controller = await chromium.launch({ headless: true });
    t.after(async () => {
      releaseGate();
      releaseCancel();
      for (const g of extraGates.values()) g.release();
      await Promise.allSettled(pendingHandles);
      for (const h of handles.reverse()) await h.close();
      for (const s of supervisorHandles) await s.close();
      await controller.close();
      await app1.close();
      await app2.close();
      await new Promise((done) => gate.close(done));
      await fs.rm(root, { recursive: true, force: true });
    });
    const executablePath = await fs.realpath(chromium.executablePath());
    const browser = {
      version: controller.version(),
      executablePath,
      sha256: hash(await fs.readFile(executablePath)),
    };
    const launcher = join(root, "launcher.mjs");
    await fs.writeFile(
      launcher,
      `
import {createRequire} from "node:module";
const {chromium}=createRequire(${JSON.stringify(pathToFileURL(runtimePath).href)})("playwright");
import { createNotebookAdapter } from ${JSON.stringify(new URL("../examples/notebook/adapter.mjs", import.meta.url).href)};
export async function createManagedLaunch({runtime,resources,settings,installation,signal}) {
  const browser=await chromium.launch({headless:true,executablePath:installation.browser.executablePath});
  resources.own(browser,{label:'frontend browser',close:()=>browser.close()});
  await runtime.registerBrowser({browser,executablePath:installation.browser.executablePath});
  const context=await browser.newContext();resources.own(context,{label:'frontend context',close:()=>context.close()});
  const page=await context.newPage();await page.goto(settings.target);
  if(settings.gate)await fetch(settings.gate,settings.ignoreSignal?{}:{signal});
  if(settings.fail)throw Error('synthetic-private-launcher-secret');
  const session=await runtime.createDriverSession({page,adapter:createNotebookAdapter(page),identity:{application:'independent-native-notebook'}});
  const viewer=await runtime.createViewer({page,context,session});
  if(settings.disconnectGate)void fetch(settings.disconnectGate).then(()=>page.close());
  return {session,viewerUrl:viewer.url,draftState:async()=>false};
}`,
    );
    async function fixture(id, name, url, settings = {}) {
      const store = join(root, id, "store"),
        configPath = join(root, id, "config.json");
      await fs.mkdir(join(root, id), { recursive: true });
      const config = {
        schemaVersion: 1,
        store,
        frontend: { name, targetOrigin: new URL(url).origin },
        registration: {
          projectId: id,
          sourceRoot: join(root, "source"),
          model: { id: "notebook", version: "1" },
        },
        settings: { target: url, ...settings },
      };
      await fs.writeFile(configPath, JSON.stringify(config));
      const receipt = {
        id: id + "-accepted",
        version: runtimePackage.version,
        runtimePackage: runtimePackage.name,
        sourceSha256: "a".repeat(64),
        runtimePath,
        enginePath: settings.invalidEngine ?? enginePath,
        launcherPath: launcher,
        sourcePath: root,
        model: config.registration.model,
        browser,
      };
      const supervisor = await createNinjaSupervisor({
        root: join(store, "supervisor"),
        settings: config.settings,
        frontend: frontendIdentity(config),
        timeoutMs: 15000,
      });
      supervisorHandles.push(supervisor);
      const manager = await createNinjaManager({
        root: store,
        registration: config.registration,
        supervisor,
        provider: {},
        installer: { verify: async () => receipt },
      });
      await ninjaWrite(join(store, "state.json"), {
        schemaVersion: 1,
        projectId: id,
        generation: 1,
        current: receipt.id,
        previous: null,
        checkpoint: null,
        available: null,
        operation: null,
        phase: "idle",
        error: null,
      });
      const managerStart = manager.start.bind(manager);
      manager.start = async () => {
        try {
          return await managerStart();
        } catch (e) {
          await fs.writeFile(join(output, "startup-debug.txt"), e.stack);
          throw e;
        }
      };
      const deps = {
        readConfig: async () => ({ config, keys: [] }),
        open: async () => ({ manager, supervisor }),
        toolsSha256: "c".repeat(64),
      };
      return { config, configPath, deps, supervisor };
    }
    const first = await fixture("control", "Control Panel", app1.url, {
      gate: gateUrl,
    });
    let announced;
    const progress = new Promise((done) => (announced = done));
    const launching = nativeCommand("start", first.configPath, {
      ...first.deps,
      onProgress: announced,
    }).then((h) => {
      handles.push(h);
      return h;
    });
    pendingHandles.push(launching);
    const early = await progress;
    await entered;
    const page1 = await controller.newPage();
    await page1.goto(early.startupUrl);
    await page1
      .getByRole("heading", { name: "Control Panel", exact: true })
      .waitFor();
    assert.equal(await page1.locator("#phase").textContent(), "Bootstrap");
    assert.equal(await page1.locator("#viewer").isVisible(), false);
    await page1.screenshot({
      path: join(output, "startup-bootstrap.png"),
      fullPage: true,
    });
    const current = (
      await nativeCommand("status", first.configPath, first.deps)
    ).result;
    assert.equal(current.status, "starting");
    assert.equal(current.viewerUrl, null);
    releaseGate();
    const firstHandle = await launching;
    assert.equal(
      firstHandle.result.status,
      "running",
      JSON.stringify(firstHandle.result),
    );
    await page1.getByText("This frontend is ready", { exact: true }).waitFor();
    assert.equal(
      await page1.locator("#viewer").getAttribute("href"),
      firstHandle.result.viewerUrl,
    );
    assert.match(
      await page1.locator("#ownership").textContent(),
      /browser: owned · context: owned/,
    );
    assert.deepEqual(firstHandle.result.startup.history.slice(0, 4), [
      "bootstrap",
      "model_validation",
      "target_attachment",
      "ready",
    ]);
    const second = await fixture("staff", "Settings portal", app2.url);
    const secondHandle = await nativeCommand(
      "start",
      second.configPath,
      second.deps,
    );
    handles.push(secondHandle);
    const page2 = await controller.newPage();
    await page2.goto(secondHandle.result.startupUrl);
    await page2.getByText("This frontend is ready", { exact: true }).waitFor();
    assert.notEqual(
      firstHandle.result.viewerUrl,
      secondHandle.result.viewerUrl,
    );
    assert.notEqual(
      firstHandle.result.frontend.evidenceLocation,
      secondHandle.result.frontend.evidenceLocation,
    );
    const viewer2 = await controller.newPage();
    await viewer2.goto(secondHandle.result.viewerUrl);
    const status2 = await (
      await fetch(new URL("/status", secondHandle.result.viewerUrl))
    ).json();
    assert.equal(status2.frontend.name, "Settings portal");
    assert.equal(status2.frontend.matchesTarget, true);
    assert.equal(status2.frontend.matchesModel, true);
    await page2.screenshot({
      path: join(output, "startup-ready.png"),
      fullPage: true,
    });
    await viewer2.screenshot({
      path: join(output, "named-runtime-viewer.png"),
      fullPage: true,
    });
    const collision = join(root, "other-config.json");
    await fs.writeFile(collision, JSON.stringify(first.config));
    await assert.rejects(nativeCommand("start", collision, first.deps), {
      code: "ownership_changed",
    });
    await nativeCommand("stop", first.configPath, first.deps);
    await firstHandle.closed;
    assert.equal(
      (await nativeCommand("status", second.configPath, second.deps)).result
        .status,
      "running",
    );
    assert.equal(
      (await fetch(app1.url)).ok,
      true,
      "attached app survives frontend stop",
    );
    assert.equal(
      (await fetch(secondHandle.result.viewerUrl)).ok,
      true,
      "second viewer survives first frontend cleanup",
    );
    const invalidRoot = join(root, "invalid-engine");
    await fs.mkdir(join(invalidRoot, "src"), { recursive: true });
    await fs.copyFile(
      join(repo, "tests/fixtures/native-invalid-model.rs"),
      join(invalidRoot, "src/main.rs"),
    );
    await fs.writeFile(
      join(invalidRoot, "Cargo.toml"),
      `[package]\nname="native-invalid-model"\nversion="0.1.0"\nedition="2021"\n[workspace]\n[dependencies]\ndaedlo-engine={path=${JSON.stringify(engineCrate)}}\nserde_json="1"\n`,
    );
    const build = await promisify(execFile)(
      "cargo",
      [
        "build",
        "--offline",
        "--manifest-path",
        join(invalidRoot, "Cargo.toml"),
        "--target-dir",
        targetDir,
      ],
      { cwd: repo, timeout: 120000, maxBuffer: 1000000 },
    );
    await fs.writeFile(
      join(output, "invalid-engine-build.log"),
      build.stdout + build.stderr,
    );
    const invalid = await fixture(
      "invalid-model",
      "Invalid settings model",
      app1.url,
      { invalidEngine: join(targetDir, "debug/native-invalid-model") },
    );
    const invalidHandle = await nativeCommand(
      "start",
      invalid.configPath,
      invalid.deps,
    );
    handles.push(invalidHandle);
    assert.equal(invalidHandle.result.status, "failed");
    assert.equal(invalidHandle.result.error.code, "invalid_model");
    assert.equal(invalidHandle.result.startup.cleanup, "complete");
    assert.deepEqual(
      invalidHandle.result.frontend.ownership,
      { browser: "owned", context: "owned", application: "unknown" },
      "Failed startup retains measured ownership after cleanup",
    );
    assert.match(
      invalidHandle.result.error.message,
      /descriptor\.commands\[0\]\.params\[1\]\.maxLength/,
    );
    assert.match(
      invalidHandle.result.error.message,
      /only permitted for text parameters/,
    );
    const invalidPage = await controller.newPage();
    await invalidPage.goto(invalidHandle.result.startupUrl);
    await invalidPage
      .getByText("Startup did not establish readiness", { exact: true })
      .waitFor();
    assert.equal(await invalidPage.locator("#viewer").isVisible(), false);
    assert.equal(
      (await invalidPage.locator("body").innerText()).includes(
        "private-label-value-must-not-appear",
      ),
      false,
    );
    await invalidPage.screenshot({
      path: join(output, "startup-invalid-model.png"),
      fullPage: true,
    });
    const failed = await fixture("failure", "Failed frontend", app1.url, {
      fail: true,
    });
    const failedHandle = await nativeCommand(
      "start",
      failed.configPath,
      failed.deps,
    );
    handles.push(failedHandle);
    assert.equal(failedHandle.result.status, "failed");
    assert.equal(failedHandle.result.startup.cleanup, "complete");
    assert.equal(failedHandle.result.viewerUrl, null);
    const failPage = await controller.newPage();
    await failPage.goto(failedHandle.result.startupUrl);
    await failPage
      .getByText("Startup did not establish readiness", { exact: true })
      .waitFor();
    assert.equal(
      (await failPage.locator("body").innerText()).includes(
        "synthetic-private-launcher-secret",
      ),
      false,
    );
    assert.equal(await failPage.locator("#viewer").isVisible(), false);
    await failPage.screenshot({
      path: join(output, "startup-failed.png"),
      fullPage: true,
    });
    assert.equal(
      (await nativeCommand("status", second.configPath, second.deps)).result
        .status,
      "running",
    );
    const mismatch = await fixture("mismatch", "Wrong target", app1.url, {
      target: app2.url,
    });
    const mismatchHandle = await nativeCommand(
      "start",
      mismatch.configPath,
      mismatch.deps,
    );
    handles.push(mismatchHandle);
    assert.equal(mismatchHandle.result.status, "failed");
    assert.equal(mismatchHandle.result.error.code, "target_mismatch");
    const cancelled = await fixture(
      "cancelled",
      "Cancelled frontend",
      app1.url,
      { gate: gateUrl + "cancel" },
    );
    let announceCancel;
    const announcedCancel = new Promise((done) => (announceCancel = done));
    const cancelling = nativeCommand("start", cancelled.configPath, {
      ...cancelled.deps,
      onProgress: announceCancel,
    }).then((h) => {
      handles.push(h);
      return h;
    });
    pendingHandles.push(cancelling);
    const cancelEarly = await announcedCancel;
    await enteredCancel;
    const cancelPage = await controller.newPage();
    await cancelPage.goto(cancelEarly.startupUrl);
    await cancelPage
      .getByRole("heading", { name: "Cancelled frontend", exact: true })
      .waitFor();
    await cancelPage
      .getByRole("button", { name: "Stop this frontend", exact: true })
      .click();
    await cancelPage
      .getByText("Owned cleanup completed", { exact: true })
      .waitFor();
    const cancelHandle = await cancelling;
    await cancelHandle.closed;
    assert.equal(
      (await nativeCommand("status", cancelled.configPath, cancelled.deps))
        .result.status,
      "stopped",
    );
    assert.equal(
      (await nativeCommand("status", second.configPath, second.deps)).result
        .status,
      "running",
    );
    await cancelPage.screenshot({
      path: join(output, "startup-cancelled.png"),
      fullPage: true,
    });
    const ignoredGate = extraGate("/ignored");
    const ignored = await fixture("ignored", "Retained startup", app1.url, {
      gate: gateUrl + "ignored",
      ignoreSignal: true,
    });
    let announceIgnored;
    const announcedIgnored = new Promise((done) => (announceIgnored = done));
    const ignoring = nativeCommand("start", ignored.configPath, {
      ...ignored.deps,
      onProgress: announceIgnored,
      startupStopTimeoutMs: 100,
    }).then((h) => {
      handles.push(h);
      return h;
    });
    pendingHandles.push(ignoring);
    await announcedIgnored;
    await ignoredGate.seen;
    await assert.rejects(
      nativeCommand("stop", ignored.configPath, ignored.deps),
      { code: "cleanup_incomplete" },
    );
    assert.equal(
      (await nativeCommand("status", ignored.configPath, ignored.deps)).result
        .status,
      "starting",
      "unacknowledged cancellation never becomes stopped",
    );
    assert.equal((await ignored.supervisor.status()).cleanupPending, true);
    ignoredGate.release();
    await ignoring;
    assert.equal(
      (await nativeCommand("status", ignored.configPath, ignored.deps)).result
        .status,
      "failed",
    );
    await nativeCommand("stop", ignored.configPath, ignored.deps);
    const disconnectGate = extraGate("/disconnect");
    const disconnected = await fixture(
      "disconnect",
      "Disconnected frontend",
      app1.url,
      { disconnectGate: gateUrl + "disconnect" },
    );
    const disconnectHandle = await nativeCommand(
      "start",
      disconnected.configPath,
      disconnected.deps,
    );
    handles.push(disconnectHandle);
    assert.equal(disconnectHandle.result.status, "running");
    await disconnectGate.seen;
    disconnectGate.release();
    const disconnectedState = await until(async () => {
      const s = (
        await nativeCommand(
          "status",
          disconnected.configPath,
          disconnected.deps,
        )
      ).result;
      return s.status === "observation_failed" ? s : null;
    });
    assert.equal(
      disconnectedState.viewerUrl,
      null,
      "lost target cannot advertise a ready viewer",
    );
    assert.ok(
      disconnectedState.running,
      "accepted failed frontend remains owned and reportable",
    );
    assert.equal(disconnectedState.observation.status, "failed");
    const disconnectedPage = await controller.newPage();
    await disconnectedPage.goto(disconnectHandle.result.startupUrl);
    await disconnectedPage
      .getByText("Current application safety is unconfirmed", { exact: true })
      .waitFor();
    assert.equal(
      await disconnectedPage.locator("#phase").textContent(),
      "Observation failed",
    );
    assert.equal(await disconnectedPage.locator("#viewer").isVisible(), false);
    await disconnectedPage.screenshot({
      path: join(output, "startup-observation-failed.png"),
      fullPage: true,
    });
    await assert.rejects(
      nativeCommand("stop", disconnected.configPath, disconnected.deps),
      /page|connection|observation|target|unavailable/i,
      "Lost observation must preserve the owner instead of passing safe cleanup",
    );
    // Fixture teardown owns these disposable resources. This direct cleanup is
    // not a supported customer recovery command or evidence of a safe boundary.
    await disconnected.supervisor.close();
    await nativeCommand("stop", disconnected.configPath, disconnected.deps);
    await nativeCommand("stop", second.configPath, second.deps);
    await secondHandle.closed;
    assert.equal((await fetch(app2.url)).ok, true);
    await fs.writeFile(
      join(output, "browser-result.json"),
      JSON.stringify(
        {
          status: "PASS",
          toolsRoot,
          runtimePath,
          enginePath,
          engineCrate,
          runtime: {
            name: runtimePackage.name,
            version: runtimePackage.version,
          },
          browser: { version: browser.version, sha256: browser.sha256 },
          checks: [
            "visible delayed bootstrap",
            "real engine hello",
            "real invalid Rust hello diagnostic visible with cleanup",
            "measured phase sequence",
            "two named isolated contexts/viewers",
            "owner collision rejected",
            "first stop preserves second and attached app",
            "failed startup retains visible diagnostic after cleanup",
            "wrong target rejected",
            "startup stop aborts cooperative launcher and cleans owned browser",
            "ignored cancellation retains owned resources until acknowledged",
            "lost target reports observation failure and blocks guarded stop while retaining ownership",
            "second stop preserves attached app",
          ],
        },
        null,
        2,
      ),
    );
  },
);
