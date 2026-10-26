import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import http from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const writeJson = (path, value) =>
  fs.writeFile(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });

// Test-only transport fault: forward a real write, then lose its response.
// Application semantics still come entirely from the existing starter fixture.
async function transportFixture(fixture) {
  let loseResponse = false;
  const server = http.createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const upstream = await fetch(fixture.url + request.url, {
        method: request.method,
        ...(request.method === "POST"
          ? {
              body: Buffer.concat(chunks),
              headers: { "content-type": "application/json" },
            }
          : {}),
      });
      const body = Buffer.from(await upstream.arrayBuffer());
      if (loseResponse && request.method === "POST") {
        response.destroy();
        return;
      }
      response.writeHead(upstream.status, {
        "content-type": upstream.headers.get("content-type"),
        "cache-control": "no-store",
      });
      response.end(body);
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
    get writes() {
      return fixture.writes;
    },
    loseNextResponses(value) {
      loseResponse = value;
    },
    close: () =>
      new Promise((done, reject) => {
        server.close((error) => (error ? reject(error) : done()));
        server.closeAllConnections();
      }),
  };
}
async function executeHook(path, context, output) {
  const result = await new Promise((done, reject) => {
    const child = spawn(process.execPath, [path], {
      cwd: context.installation.sourcePath,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Managed hook timed out"));
    }, 60000);
    child.stdout.on("data", (v) => (stdout += v));
    child.stderr.on("data", (v) => (stderr += v));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr });
    });
    child.stdin.end(JSON.stringify(context));
  });
  await writeJson(output, result);
  assert.equal(
    result.code,
    0,
    "Managed hook failed; inspect private hook output",
  );
  return JSON.parse(result.stdout);
}

export async function runManagedStarterAcceptance({
  output,
  toolsRoot = join(repo, "scripts/release"),
  runtimePath = join(repo, "packages/runtime/src/index.mjs"),
  engineCrate = join(repo, "crates/daedlo-engine"),
  exampleRoot = join(repo, "examples/managed-starter"),
  bundle,
  expectedManifestSha256,
} = {}) {
  assert.ok(output, "Use a fresh evidence output directory");
  output = resolve(output);
  await fs.mkdir(output, { mode: 0o700 });
  const result = {
    status: "RUNNING",
    scope: bundle
      ? "exact installed managed reference"
      : "source managed reference; installer verification remains a separate gate",
    checks: [],
    cleanup: "PENDING",
  };
  await writeJson(join(output, "result.json"), result);
  const record = async (name) => {
    result.checks.push(name);
    await writeJson(join(output, "result.json"), result);
  };
  const load = (name) => import(pathToFileURL(join(toolsRoot, name + ".mjs")));
  const [
    { nativeCommand },
    { createNinjaManager, ninjaWrite },
    { createNinjaSupervisor },
    { frontendIdentity },
    installationApi,
    { NINJA_CONTRACTS },
  ] = await Promise.all([
    load("native"),
    load("ninja-manager"),
    load("ninja-supervisor"),
    load("native-session"),
    load("ninja-installation"),
    load("ninja"),
  ]);
  const { prepareManagedStarter } = await import(
    pathToFileURL(join(exampleRoot, "prepare.mjs"))
  );
  const { createStarterFixture } = await import(
    pathToFileURL(join(exampleRoot, "../starter/fixture.mjs"))
  );
  const { buildStarterModel } = await import(
    pathToFileURL(join(exampleRoot, "../starter/build-model.mjs"))
  );
  const runtimePackage = JSON.parse(
    await fs.readFile(join(dirname(runtimePath), "../package.json")),
  );
  const { chromium } = createRequire(runtimePath)("playwright");
  const apps = [],
    owners = [],
    supervisors = [];
  let failure, controller;
  try {
    controller = await chromium.launch({
      headless: true,
      handleSIGINT: false,
      handleSIGTERM: false,
    });
    const executablePath = await fs.realpath(chromium.executablePath());
    const browserIdentity = {
      executablePath,
      version: controller.version(),
      sha256: sha(await fs.readFile(executablePath)),
    };
    const model = bundle
      ? null
      : await buildStarterModel({
          output: join(output, "model-build"),
          crate: engineCrate,
          offline: true,
        });
    const underlying = await createStarterFixture();
    apps.push(underlying);
    const app1 = await transportFixture(underlying);
    apps.push(app1);
    const app2 = await createStarterFixture();
    apps.push(app2);
    const trustFile = join(
      exampleRoot,
      "../../docs/update-trust/daedlo-release-2026-10.pem",
    );
    async function prepare(id, app) {
      const prepared = await prepareManagedStarter({
        output: join(output, id),
        crate: engineCrate,
        origin: app.url,
        trustFile,
        projectId: "managed-starter-" + id,
        frontendName: "Managed " + id,
      });
      await installationApi.validateRegistration(prepared.config.registration);
      const source = await installationApi.snapshotProject(
        prepared.config.registration,
      );
      let receipt;
      await createNinjaManager({
        root: prepared.config.store,
        registration: prepared.config.registration,
        provider: {},
        installer: {},
        supervisor: {},
        recover: false,
      });
      if (bundle) {
        assert.match(expectedManifestSha256 ?? "", /^[a-f0-9]{64}$/);
        const manifest = JSON.parse(
          await fs.readFile(join(bundle, "manifest.json")),
        );
        receipt = await installationApi.prepareInstallation({
          registration: prepared.config.registration,
          verifiedKit: {
            bundlePath: resolve(bundle),
            identity: {
              version: manifest.version,
              manifestSha256: expectedManifestSha256,
              contracts: NINJA_CONTRACTS,
            },
          },
          destination: join(prepared.config.store, "installations", "accepted"),
          offline: false,
        });
        assert.equal(receipt.version, manifest.version);
        assert.equal(receipt.version, runtimePackage.version);
        assert.equal(receipt.runtimePackage, runtimePackage.name);
        assert.equal(receipt.release.manifestSha256, expectedManifestSha256);
        assert.equal(receipt.sourceSha256, source.sha256);
        assert.deepEqual(receipt.model, prepared.config.registration.model);
        assert.equal(
          receipt.launcherPath,
          join(receipt.sourcePath, prepared.config.registration.launcher),
        );
        for (const phase of ["acceptance", "health"]) {
          const hook = receipt[phase];
          assert.equal(hook.accepted, true);
          assert.equal(hook.failed, 0);
          assert.equal(hook.runtimePath, receipt.runtimePath);
          assert.equal(hook.enginePath, receipt.enginePath);
          assert.deepEqual(hook.model, receipt.model);
          assert.equal(hook.browser.sha256, browserIdentity.sha256);
        }
        const installedPackage = JSON.parse(
          await fs.readFile(
            join(dirname(receipt.runtimePath), "../package.json"),
          ),
        );
        assert.equal(installedPackage.version, manifest.version);
        assert.equal(installedPackage.name, runtimePackage.name);
      } else {
        receipt = {
          id: "source-" + id,
          version: runtimePackage.version,
          runtimePackage: runtimePackage.name,
          sourceSha256: source.sha256,
          runtimePath,
          enginePath: model.enginePath,
          sourcePath: prepared.sourceRoot,
          launcherPath: join(
            prepared.sourceRoot,
            prepared.config.registration.launcher,
          ),
          model: prepared.config.registration.model,
          browser: browserIdentity,
        };
        for (const phase of ["acceptance", "health"]) {
          const fixturePath = join(output, id, "hook-" + phase);
          await fs.mkdir(fixturePath);
          const hook = await executeHook(
            join(
              prepared.sourceRoot,
              prepared.config.registration.hooks[phase],
            ),
            { schemaVersion: 1, phase, installation: receipt, fixturePath },
            join(output, id, phase + "-log.json"),
          );
          assert.equal(hook.accepted, true);
          assert.equal(hook.failed, 0);
          assert.ok(hook.tests >= 3);
        }
      }
      assert.deepEqual(
        await installationApi.snapshotProject(prepared.config.registration),
        source,
        "Preparation preserves authored source",
      );
      await record(
        id +
          ": registered closure, separate real-model preflight, disposable acceptance and health",
      );
      await ninjaWrite(join(prepared.config.store, "state.json"), {
        schemaVersion: 1,
        projectId: prepared.config.registration.projectId,
        generation: 1,
        current: receipt.id,
        previous: null,
        checkpoint: null,
        available: null,
        operation: null,
        phase: "idle",
        error: null,
      });
      const open = async () => {
        const supervisor = await createNinjaSupervisor({
          root: join(prepared.config.store, "supervisor"),
          settings: prepared.config.settings,
          frontend: frontendIdentity(prepared.config),
          timeoutMs: 15000,
        });
        supervisors.push(supervisor);
        const manager = await createNinjaManager({
          root: prepared.config.store,
          registration: prepared.config.registration,
          supervisor,
          provider: {},
          installer: {
            verify: async () =>
              bundle
                ? installationApi.verifyInstallation(receipt.path, {
                    registration: prepared.config.registration,
                  })
                : receipt,
          },
        });
        return { manager, supervisor };
      };
      return {
        ...prepared,
        receipt,
        deps: {
          readConfig: async () => ({ config: prepared.config, keys: [] }),
          open,
          toolsSha256: sha(await fs.readFile(join(toolsRoot, "native.mjs"))),
        },
      };
    }
    const first = await prepare("first", app1),
      second = await prepare("second", app2);
    const start = async (fixture) => {
      const owner = await nativeCommand(
        "start",
        fixture.configPath,
        fixture.deps,
      );
      owners.push(owner);
      assert.equal(
        owner.result.status,
        "running",
        JSON.stringify(owner.result),
      );
      return owner;
    };
    const one = await start(first),
      two = await start(second);
    assert.notEqual(one.result.viewerUrl, two.result.viewerUrl);
    assert.notEqual(
      one.result.frontend.evidenceLocation,
      two.result.frontend.evidenceLocation,
    );
    assert.equal(app1.writes, 0);
    assert.equal(app2.writes, 0);
    await record(
      "native launches preserve injected sessions and independent frontend identities without writes",
    );
    const firstView = await controller.newPage();
    await firstView.goto(one.result.startupUrl);
    await firstView
      .getByText("This frontend is ready", { exact: true })
      .waitFor();
    await firstView.screenshot({
      path: join(output, "native-ready.png"),
      fullPage: true,
    });
    await firstView.goto(one.result.viewerUrl);
    await firstView.locator('[data-command="edit"]').waitFor();
    function commands(viewerUrl) {
      const origin = new URL(viewerUrl).origin;
      return async (id, params = {}, expectedStatus = 200) => {
        const status = await fetch(origin + "/status").then((r) => r.json());
        const response = await fetch(origin + "/command", {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: origin },
          body: JSON.stringify({
            id,
            params,
            revision: status.driver.revision,
          }),
        });
        assert.equal(response.status, expectedStatus);
        return response.json();
      };
    }
    const command = commands(one.result.viewerUrl);
    await command("edit", { text: "Managed native proof", category: "plain" });
    const saved = await command("save");
    assert.equal(saved.ok, true);
    assert.equal(saved.effect.status, "saved");
    const stored = await fetch(app1.url + "/api/notes").then((r) => r.json());
    assert.equal(stored.items.length, 1);
    assert.equal(stored.items[0].text, "Managed native proof");
    assert.equal(app1.writes, 1);
    assert.equal(app2.writes, 0);
    await firstView
      .locator("#effect-label")
      .filter({ hasText: "Application effect: Saved" })
      .waitFor();
    await firstView.locator('[data-state="editor.saved"].active').waitFor();
    assert.ok(
      !(await firstView.locator("body").innerText()).includes(
        "Local application metadata",
      ),
    );
    await firstView.screenshot({
      path: join(output, "native-saved.png"),
      fullPage: true,
    });
    const archiveRoot = join(first.config.store, "supervisor/run-reports");
    const archived = await Promise.all(
      (await fs.readdir(archiveRoot)).map(async (name) =>
        JSON.parse(await fs.readFile(join(archiveRoot, name))),
      ),
    );
    assert.equal(archived.length, 2);
    const savedArchive = archived.find((v) => v.report.runId === saved.runId);
    assert.ok(savedArchive);
    assert.equal(savedArchive.report.lastResult.effect.status, "saved");
    assert.equal(savedArchive.report.eventRange.truncated, false);
    assert.ok(!JSON.stringify(archived).includes("Local application metadata"));
    assert.ok(!JSON.stringify(archived).includes(stored.items[0].operation));
    await record(
      "native save has independent readback, saved effect and immediate immutable archive with private metadata omitted",
    );
    await command("edit", {
      text: "Response lost after write",
      category: "work",
    });
    app1.loseNextResponses(true);
    const uncertain = await command("save");
    app1.loseNextResponses(false);
    assert.equal(uncertain.outcome.kind, "recoverable_error");
    assert.equal(uncertain.effect.status, "uncertain");
    const afterLoss = await fetch(app1.url + "/api/notes").then((r) =>
      r.json(),
    );
    assert.equal(afterLoss.items.length, 2);
    assert.equal(app1.writes, 2);
    const lostArchive = (
      await Promise.all(
        (await fs.readdir(archiveRoot)).map(async (name) =>
          JSON.parse(await fs.readFile(join(archiveRoot, name))),
        ),
      )
    ).find((value) => value.report.runId === uncertain.runId);
    assert.ok(lostArchive);
    assert.equal(lostArchive.report.lastResult.effect.status, "uncertain");
    await command("discard");
    await record(
      "lost response remains uncertain in the native archive despite independent proof of the real write",
    );
    await nativeCommand("stop", first.configPath, first.deps);
    await one.closed;
    assert.equal(
      (await nativeCommand("status", second.configPath, second.deps)).result
        .status,
      "running",
    );
    assert.equal((await fetch(app1.url)).ok, true);
    assert.equal((await fetch(app2.url)).ok, true);
    assert.equal(app1.writes, 2);
    assert.equal(app2.writes, 0);
    await record(
      "stopping one frontend preserves the other and both attached applications",
    );
    const restarted = await start(first);
    assert.equal(app1.writes, 2, "Restart replays no business action");
    assert.equal((await fs.readdir(archiveRoot)).length, 5);
    await nativeCommand("stop", first.configPath, first.deps);
    await restarted.closed;
    await nativeCommand("stop", second.configPath, second.deps);
    await two.closed;
    await record(
      "fresh native owner restarts the accepted reference with prior data and reports retained",
    );
    await fs.writeFile(
      first.privateCatalogFile,
      JSON.stringify({
        schemaVersion: 1,
        allowedCommands: ["edit", "discard"],
        privateNote: "private-denial-must-not-leak",
      }),
      { mode: 0o600 },
    );
    const deniedOwner = await start(first);
    await firstView.goto(deniedOwner.result.viewerUrl);
    await firstView.locator('[data-command="edit"]').waitFor();
    const deniedCommand = commands(deniedOwner.result.viewerUrl);
    await deniedCommand("edit", {
      text: "Denied private policy",
      category: "plain",
    });
    const denied = await deniedCommand("save", {}, 409);
    assert.equal(denied.ok, false);
    assert.equal(denied.effect.status, "not_attempted");
    assert.equal(app1.writes, 2);
    assert.ok(!JSON.stringify(denied).includes("private-denial-must-not-leak"));
    assert.ok(
      !(await firstView.locator("body").innerText()).includes(
        "private-denial-must-not-leak",
      ),
    );
    await deniedCommand("discard");
    await nativeCommand("stop", first.configPath, first.deps);
    await deniedOwner.closed;
    await record(
      "private guard refuses a real native save before effects without exposing its private reason",
    );
    result.status = "PASS";
  } catch (error) {
    failure = error;
    result.status = "FAIL";
    result.error = error.message;
  } finally {
    const cleanup = [];
    for (const owner of owners.reverse()) {
      try {
        await owner.close();
      } catch (error) {
        cleanup.push(error.message);
      }
    }
    for (const supervisor of supervisors.reverse()) {
      try {
        await supervisor.close();
      } catch (error) {
        cleanup.push(error.message);
      }
    }
    try {
      await controller?.close();
    } catch (error) {
      cleanup.push(error.message);
    }
    for (const app of apps.reverse()) {
      try {
        await app.close();
      } catch (error) {
        cleanup.push(error.message);
      }
    }
    result.cleanup = cleanup.length ? "INCOMPLETE" : "PASS";
    result.cleanupErrors = cleanup;
    if (cleanup.length) {
      result.status = "FAIL";
      failure ??= new Error("Managed reference cleanup incomplete");
    }
    await writeJson(join(output, "result.json"), result);
  }
  if (failure) throw failure;
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (!process.env.DAEDLO_MANAGED_OUTPUT)
    await fs.mkdir(join(repo, "artifacts"), { recursive: true });
  const result = await runManagedStarterAcceptance({
    output:
      process.env.DAEDLO_MANAGED_OUTPUT ??
      join(repo, "artifacts/managed-starter-" + Date.now()),
    ...(process.env.DAEDLO_MANAGED_TOOLS_ROOT
      ? { toolsRoot: resolve(process.env.DAEDLO_MANAGED_TOOLS_ROOT) }
      : {}),
    ...(process.env.DAEDLO_MANAGED_RUNTIME_PATH
      ? { runtimePath: resolve(process.env.DAEDLO_MANAGED_RUNTIME_PATH) }
      : {}),
    ...(process.env.DAEDLO_MANAGED_ENGINE_CRATE
      ? { engineCrate: resolve(process.env.DAEDLO_MANAGED_ENGINE_CRATE) }
      : {}),
    ...(process.env.DAEDLO_MANAGED_EXAMPLE_ROOT
      ? { exampleRoot: resolve(process.env.DAEDLO_MANAGED_EXAMPLE_ROOT) }
      : {}),
  });
  console.log(JSON.stringify(result, null, 2));
}
