// Run the public notebook model against the two installed Universal release packages.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";
import { createNotebookAdapter } from "../notebook/adapter.mjs";
import { createNotebookServer } from "../notebook/server.mjs";

const execute = promisify(execFile);
const targetId = "example-notebook";
const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
const launcher = "examples/universal-live/record.mjs";
const model = { id: "notebook", version: "1" };
const files = [
  launcher, "package.json", "package-lock.json", "Cargo.toml", "Cargo.lock",
  "examples/notebook/adapter.mjs", "examples/notebook/server.mjs", "examples/notebook/index.html",
  "examples/notebook-engine/Cargo.toml", "examples/notebook-engine/src/lib.rs",
  "examples/notebook-engine/src/main.rs", "crates/daedlo-engine/Cargo.toml",
  "crates/daedlo-engine/src/lib.rs", "crates/daedlo-engine/src/protocol.rs",
];

async function record({ install, output, engine }) {
  const prefix = await realpath(install);
  const enginePath = await realpath(engine);
  const universal = join(prefix, "node_modules/@daedlo/universal");
  const companion = join(prefix, "node_modules/@daedlo/universal-runtime");
  const load = (file) => import(pathToFileURL(file).href);
  const { createDriverSession, createResourceScope, RUNTIME_CAPABILITIES } = await load(join(companion, "src/index.mjs"));
  assert.equal(RUNTIME_CAPABILITIES.runJournal, 1);
  const { chromium } = createRequire(join(companion, "package.json"))("playwright");
  const { loadTools } = await load(join(universal, "src/tools.mjs"));
  const { openWorkspace } = await loadTools("workspace");
  const { openRunJournal } = await loadTools("run-journal");
  const { captureTargetRegistration } = await load(join(universal, "src/registration.mjs"));
  const pkg = JSON.parse(await readFile(join(companion, "package.json"), "utf8"));
  const cli = async (...args) => JSON.parse((await execute(process.execPath, [join(universal, "src/cli.mjs"), ...args])).stdout);

  // Preserve the workspace for later history inspection. Refuse an existing output.
  await mkdir(output, { mode: 0o700 });
  const work = await realpath(output);
  const store = join(work, "store");
  const root = join(work, "data");
  await mkdir(store, { mode: 0o700 });
  const scope = createResourceScope();
  const own = (resource, label) => scope.own(resource, { label, close: (value) => value.close() });
  try {
    const app = own(await createNotebookServer(), "notebook");
    const config = {
      schemaVersion: 2,
      workspace: { id: "notebook-workspace", root, journal: 1 },
      store,
      frontend: { name: "Notebook", targetOrigin: app.url },
      registration: {
        schemaVersion: 1, projectId: targetId, sourceRoot: await realpath(sourceRoot), files, model,
        interfaces: { launcher: 1, nodeAdapter: 1, rustModel: 1, protocol: 1, capabilities: [] },
        node: { packageJson: "package.json", packageLock: "package-lock.json" },
        rust: { manifest: "Cargo.toml", lock: "Cargo.lock", binary: "notebook-engine" },
        launcher, hooks: { acceptance: launcher, health: launcher },
      },
    };
    const configPath = join(work, "notebook.json");
    await writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600, flag: "wx" });
    const registration = { configPath, id: targetId, label: "Notebook", environment: "Example", authProfileRef: "notebook-example" };
    await cli("register", "--config", configPath, "--id", targetId, "--name", registration.label,
      "--environment", registration.environment, "--auth-profile", registration.authProfileRef);
    const { target } = await captureTargetRegistration(registration);
    const workspace = await openWorkspace(config);
    const browser = own(await chromium.launch(), "Chromium");
    const context = own(await browser.newContext(), "notebook browser context");
    const page = await context.newPage();
    let attempts = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url() === app.url + "/api/notes") attempts++;
    });
    await page.goto(app.url);
    await page.locator('body[data-phase="ready"]').waitFor();
    const journal = own(await openRunJournal({ workspace,
      installation: { id: "notebook-companion", version: pkg.version, sourceSha256: target.sourceSha256, model },
    }), "run journal");
    const driver = own(await createDriverSession({ page, context, enginePath, adapter: createNotebookAdapter(page),
      runJournal: { startRun: (run) => journal.begin(run), beforeEffect: (intent) => journal.beforeEffect(intent) },
    }), "model session");
    driver.setSpeed("fast");
    const before = await driver.observe();
    assert.equal(before.identity.runtime, pkg.name + "@" + pkg.version);
    assert.equal(before.descriptor.id, model.id);
    const result = await driver.runRecipe("save_example", before.revision);
    const report = driver.report({ runId: result.runId });
    await journal.finish({ runId: result.runId, report });
    assert.equal(result.execution, "completed");
    assert.equal(result.outcome.kind, "success");
    assert.equal(result.effect.status, "saved");

    const response = await context.request.get(app.url + "/api/notes");
    assert.equal(response.status(), 200);
    const { items } = await response.json();
    assert.equal(items.length, 1);
    assert.equal(items[0].text, "Example note");
    await driver.close();
    await journal.close();
    await cli("index", "--workspace", root, "--target", targetId);
    const history = await cli("history", "--workspace", root, "--target", targetId, "--run", result.runId);
    assert.equal(history.historyComplete, true);
    assert.deepEqual(history.report, report);
    assert.equal(attempts, 1);
    assert.equal(app.writes, 1);
    return { workspace: root, target: targetId, runId: result.runId, savedRows: items.length,
      attemptedWrites: attempts, historyComplete: history.historyComplete };
  } finally {
    await scope.close();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { install: { type: "string" }, output: { type: "string" }, engine: { type: "string" } } });
  if (!values.install || !values.output || !values.engine) {
    throw Error("Use --install INSTALL_PREFIX --output NEW_DIRECTORY --engine NOTEBOOK_ENGINE");
  }
  console.log(JSON.stringify(await record(values), null, 2));
}
