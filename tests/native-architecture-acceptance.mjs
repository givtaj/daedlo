// Real native first-use acceptance against the pinned Architecture Studio fixture.
// A local signed-feed transport serves immutable public alpha.3 bytes. This is
// not a production-feed or clean-OS acceptance claim.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  assertAcceptedFlow,
  getJson,
  readJson,
  startFixture,
  storage,
  waitFor,
  writeJson,
} from "./fixtures/ninja-architecture/fixture-support.mjs";

const execute = promisify(execFile);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const prior = process.env.NATIVE_PRIOR_ARTIFACTS;
if (!prior || !process.env.NATIVE_APP_CHECKOUT)
  throw Error(
    "Set NATIVE_PRIOR_ARTIFACTS to retained alpha artifacts and NATIVE_APP_CHECKOUT to the approved Architecture Studio checkout.",
  );
// NATIVE_TOOLS_ROOT accepts the directory containing native.mjs, either an
// immutable installed package's lib/ or the reviewed source scripts/release/.
const toolsRoot = resolve(
  process.env.NATIVE_TOOLS_ROOT ?? join(repo, "scripts/release"),
);
const acceptedSource = resolve(
  process.env.NATIVE_ACCEPTED_SOURCE ??
    join(prior, "alpha-20261021/customer/alpha.2/accepted-integration-source"),
);
const publicKit = resolve(
  process.env.NATIVE_ACCEPTED_KIT ??
    join(prior, "ninja-update/candidate-final/public-kit"),
);
const appCheckout = resolve(process.env.NATIVE_APP_CHECKOUT);
const load = (name) => import(pathToFileURL(join(toolsRoot, name + ".mjs")));
const [
  { nativeCommand },
  { readNinjaConfig, createNinjaProvider, NINJA_CONTRACTS },
  { createNinjaManager },
  { createNinjaSupervisor },
  { prepareInstallation, verifyInstallation, snapshotProject },
  { ninjaCatalogSigningBytes },
] = await Promise.all([
  load("native"),
  load("ninja"),
  load("ninja-manager"),
  load("ninja-supervisor"),
  load("ninja-installation"),
  load("ninja-catalog"),
]);
const evidenceRoot = resolve(
  process.env.NATIVE_CUSTOMER_OUTPUT ??
    join(repo, "artifacts/native-setup/customer"),
);
await fs.mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
const output = await fs.mkdtemp(join(evidenceRoot, "run-"));
const work = await fs.realpath(
  await fs.mkdtemp(join(await fs.realpath(tmpdir()), "native-architecture-")),
);
const result = {
  schemaVersion: 1,
  status: "RUNNING",
  startedAt: new Date().toISOString(),
  output,
  work,
  toolsRoot,
  publicKit,
  acceptedSource,
  checks: [],
  cleanup: [],
  limits: [
    "Existing macOS arm64 toolchains, matching Playwright browser and package caches",
    "Exact native tools identified separately from immutable public alpha.3 runtime/crate",
    "Ephemeral local signed-catalog transport for initial setup; no production-feed or publication claim",
    "Pinned Architecture Studio application with synthetic isolated data; no external-customer or everyday application access",
    "Native CLI reconnect/status/stop; initial setup uses the same native API with only fetch transport injected",
  ],
};
await writeJson(join(output, "result.json"), result);
let app, controllerBrowser, viewerPage, owner;
const ownerHandles = [];
let nativeClosed = true;
const configPath = join(work, "native.json");
const store = join(work, "manager");
const record = async (name, details = {}) => {
  result.checks.push({ name, status: "PASS", ...details });
  await writeJson(join(output, "result.json"), result);
  console.log("PASS " + name);
};
async function command(program, args, cwd, log, timeout = 240000) {
  try {
    const value = await execute(program, args, {
      cwd,
      env: process.env,
      shell: false,
      timeout,
      maxBuffer: 20 * 1024 * 1024,
    });
    await fs.writeFile(join(output, log), value.stdout + value.stderr);
    return value.stdout;
  } catch (error) {
    await fs.writeFile(
      join(output, log),
      String(error.stdout ?? "") + String(error.stderr ?? ""),
    );
    throw error;
  }
}
let cliCount = 0;
async function cli(action) {
  const stdout = await command(
    process.execPath,
    [join(toolsRoot, "native.mjs"), action, "--config", configPath],
    work,
    `native-${++cliCount}-${action}.log`,
    30 * 60 * 1000,
  );
  return JSON.parse(stdout);
}
async function files(root, prefix = "") {
  const values = [];
  for (const entry of await fs.readdir(join(root, prefix), {
    withFileTypes: true,
  })) {
    const path = prefix ? prefix + "/" + entry.name : entry.name;
    if (entry.isDirectory()) values.push(...(await files(root, path)));
    else {
      assert.equal(entry.isFile(), true, "Only regular fixture source files");
      values.push(path);
    }
  }
  return values.sort();
}
async function inventory(root) {
  return Object.fromEntries(
    await Promise.all(
      (await files(root)).map(async (name) => [
        name,
        hash(await fs.readFile(join(root, name))),
      ]),
    ),
  );
}
async function selectedReceipt() {
  const state = await readJson(join(store, "state.json"));
  return readJson(
    join(store, "installations", state.current, "installation.json"),
  );
}
async function launch() {
  owner = await nativeCommand("start", configPath);
  assert.equal(typeof owner.close, "function");
  ownerHandles.push(owner);
  nativeClosed = false;
  return owner.result;
}
async function stop() {
  const stopped = await cli("stop");
  assert.equal(stopped.status, "stopped");
  await owner.closed;
  nativeClosed = true;
  await assert.rejects(fs.access(join(store, "native-session.json")), {
    code: "ENOENT",
  });
  assert.equal(
    (await readJson(join(store, "supervisor/child.json"))).status,
    "closed",
  );
  assert.deepEqual(await storage(app), await readJson(app.dataPath));
  return stopped;
}
async function viewer(handoff) {
  assert.equal(handoff.status, "running");
  assert.ok(handoff.viewerUrl);
  const base = new URL(handoff.viewerUrl).origin;
  await viewerPage.goto(handoff.viewerUrl);
  await viewerPage.locator('[data-command="open_editor"]').waitFor();
  await viewerPage.locator("#speed").selectOption("fast");
  const observe = async () => (await getJson(base + "/status")).driver;
  await waitFor(
    "Viewer fast speed",
    async () => (await observe()).speed === "fast",
  );
  const runs = [];
  return {
    runs,
    observe,
    url: handoff.viewerUrl,
    async command(id, params = {}, outcome = "success") {
      if (Object.hasOwn(params, "value")) {
        const field = viewerPage.locator(`#parameter-${id}-value`);
        if (params.value === "") await field.fill("explicit clear");
        await field.fill(params.value);
      }
      const pending = viewerPage.waitForResponse(
        (response) =>
          response.url() === base + "/command" &&
          response.request().postDataJSON()?.id === id,
        { timeout: 45000 },
      );
      await viewerPage.locator(`[data-command="${id}"]`).click();
      const response = await pending,
        value = await response.json();
      assert.equal(response.status(), 200, JSON.stringify(value));
      assert.equal(value.ok, true);
      assert.equal(value.execution, "completed");
      assert.equal(value.outcome?.kind, outcome);
      runs.push(value);
      return value;
    },
  };
}
async function assertReports(runs, installationId) {
  const directory = join(store, "supervisor/run-reports");
  const reports = await Promise.all(
    (await fs.readdir(directory)).map(async (name) => ({
      name,
      value: await readJson(join(directory, name)),
    })),
  );
  for (const run of runs) {
    const matches = reports.filter(
      ({ value }) =>
        value.report.runId === run.runId &&
        value.installation.id === installationId,
    );
    assert.equal(
      matches.length,
      1,
      "Exactly one durable report for each completed native run",
    );
    const { value } = matches[0];
    assert.equal(value.schemaVersion, 1);
    assert.equal(value.kind, "daedlo-managed-run");
    assert.equal(value.report.format, "browser-driver-report/1");
    assert.deepEqual(value.report.lastResult, run);
    assert.equal(value.installation.version, "0.1.4-alpha.3");
  }
  return inventory(directory);
}
async function rollback(handoff) {
  const url = new URL(handoff.updateUrl);
  const headers = {
    Authorization: `Bearer ${new URLSearchParams(url.hash.slice(1)).get("token")}`,
  };
  const statusResponse = await fetch(url.origin + "/status", { headers });
  assert.equal(statusResponse.status, 200);
  const before = await statusResponse.json();
  assert.equal(before.actions.revert, true);
  const response = await fetch(url.origin + "/action", {
    method: "POST",
    headers: {
      ...headers,
      Origin: url.origin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "revert",
      generation: before.generation,
      acknowledgeRestart: true,
    }),
    signal: AbortSignal.timeout(120000),
  });
  const value = await response.json();
  assert.equal(response.status, 200, JSON.stringify(value));
  assert.equal(value.ok, true);
  return cli("status");
}

try {
  assert.equal(process.platform, "darwin");
  assert.equal(process.arch, "arm64");
  const toolsBefore = await inventory(toolsRoot);
  const acceptedBefore = await inventory(acceptedSource);
  const appStatusBefore = await execute(
    "git",
    ["status", "--porcelain=v1", "-z"],
    { cwd: appCheckout },
  ).then((value) => value.stdout);
  await writeJson(join(output, "tools-before.json"), toolsBefore);
  const fixture = join(work, "fixture");
  await fs.mkdir(fixture);
  await command(
    "python3",
    [join(acceptedSource, "prepare-fixture.py"), appCheckout, fixture],
    repo,
    "prepare-app.log",
  );
  const appRoot = join(fixture, "app"),
    npmCache = join(work, "npm-cache");
  await command(
    "npm",
    [
      "ci",
      "--prefix",
      appRoot,
      "--workspaces=false",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--cache",
      npmCache,
    ],
    appRoot,
    "application-install.log",
  );
  await command(
    "npm",
    ["run", "build", "--prefix", appRoot, "--workspaces=false"],
    appRoot,
    "application-build.log",
  );
  const seed = await readJson(join(fixture, "data/workspace.json"));
  const sourceRoot = join(work, "registered-source");
  await fs.cp(acceptedSource, sourceRoot, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  const additions = join(repo, "tests/fixtures/ninja-architecture");
  for (const name of (await files(additions)).filter((name) =>
    name.endsWith(".mjs"),
  ))
    await fs.cp(join(additions, name), join(sourceRoot, name), {
      errorOnExist: true,
      force: false,
    });
  const acceptanceGateFile = join(work, "acceptance-gate.json");
  await writeJson(acceptanceGateFile, { rejectVersion: null });
  await writeJson(join(sourceRoot, "fixture.json"), {
    appRoot,
    acceptanceGateFile,
  });
  await writeJson(join(sourceRoot, "synthetic-seed.json"), seed);
  const registration = {
    schemaVersion: 1,
    projectId: "native-architecture",
    label: "Architecture Studio native setup",
    sourceRoot,
    files: await files(sourceRoot),
    model: { id: "architecture-studio-first-flow", version: "1.0.0" },
    interfaces: {
      launcher: 1,
      nodeAdapter: 1,
      rustModel: 1,
      protocol: 1,
      capabilities: [...NINJA_CONTRACTS.capabilities],
    },
    node: { packageJson: "package.json", packageLock: "package-lock.json" },
    rust: {
      manifest: "engine/Cargo.toml",
      lock: "engine/Cargo.lock",
      binary: "architecture-studio-first-flow",
    },
    hooks: {
      acceptance: "installation-hook.mjs",
      health: "installation-hook.mjs",
    },
    launcher: "managed-launch.mjs",
  };
  const baseline = await snapshotProject(registration);
  await writeJson(join(output, "source-before.json"), baseline);
  await writeJson(join(output, "registration.json"), registration);
  app = await startFixture({
    appRoot,
    seed,
    output: join(work, "active-application"),
  });
  const metadata = await readJson(join(publicKit, "release.json"));
  assert.equal(metadata.version, "0.1.4-alpha.3");
  const origin = "https://native-acceptance.test",
    keyId = "native-fixture-key";
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyFile = join(work, "publisher.pem");
  await fs.writeFile(
    publicKeyFile,
    publicKey.export({ type: "spki", format: "pem" }),
  );
  const assets = new Map();
  async function asset(name) {
    const bytes = await fs.readFile(join(publicKit, name)),
      url = origin + "/downloads/" + name;
    assets.set(url, bytes);
    return { url, bytes: bytes.length, sha256: hash(bytes) };
  }
  const entry = {
    version: metadata.version,
    channel: "preview",
    platforms: [{ os: process.platform, arch: process.arch }],
    contracts: structuredClone(NINJA_CONTRACTS),
    notesUrl: origin + "/notes",
    kit: await asset(metadata.archive.file),
    metadata: await asset("release.json"),
    checksums: await asset("SHA256SUMS"),
  };
  assert.equal(entry.kit.sha256, metadata.archive.sha256);
  const signed = {
    schemaVersion: 1,
    kind: "daedlo-public-kit-catalog",
    publisher: "daedlo",
    generation: 1,
    issuedAt: new Date(Date.now() - 10000).toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    releases: [entry],
  };
  const feed = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      kind: "daedlo-signed-catalog",
      signed,
      signature: {
        keyId,
        value: sign(
          null,
          ninjaCatalogSigningBytes(signed),
          privateKey,
        ).toString("base64"),
      },
    }),
  );
  let fetches = 0,
    prepares = 0;
  const fetchImpl = async (url) => {
    const bytes = url === origin + "/catalog.json" ? feed : assets.get(url);
    assert.ok(bytes, "Only frozen acceptance transport assets may be read");
    fetches++;
    return new Response(bytes, {
      status: 200,
      headers: { "Content-Length": String(bytes.length) },
    });
  };
  const config = {
    schemaVersion: 1,
    store,
    catalog: {
      url: origin + "/catalog.json",
      publisher: "daedlo",
      channel: "preview",
      trustedKeys: [{ id: keyId, publicKeyFile }],
    },
    registration,
    installation: { offline: false, npmCache },
    settings: {
      origin: app.origin,
      appRoot: app.appRoot,
      dataPath: app.dataPath,
      evidencePath: app.evidencePath,
    },
  };
  await writeJson(configPath, config);
  // Only catalog transport differs from openNinja. All native preflight, install,
  // trusted project hooks, immutable slots, runner ownership and UI stay real.
  const open = async (path, options = {}) => {
    const { config: c, keys, installation } = await readNinjaConfig(path);
    const supervisor = await createNinjaSupervisor({
      root: join(c.store, "supervisor"),
      settings: c.settings,
    });
    const manager = await createNinjaManager({
      root: c.store,
      registration: c.registration,
      recover: options.recover ?? true,
      provider: createNinjaProvider(
        { ...c.catalog, trustedKeys: keys },
        { fetchImpl },
      ),
      installer: {
        prepare: (args) => {
          prepares++;
          return prepareInstallation({ ...args, ...installation });
        },
        verify: verifyInstallation,
      },
      supervisor,
    });
    return { manager, supervisor };
  };
  const doctor = (await nativeCommand("doctor", configPath)).result;
  await writeJson(join(output, "doctor.json"), doctor);
  assert.equal(doctor.ok, true, JSON.stringify(doctor));
  const first = await nativeCommand("setup", configPath, {
    version: metadata.version,
    open,
  });
  assert.equal(first.result.status, "ready");
  assert.equal(prepares, 1);
  const firstState = await readJson(join(store, "state.json"));
  const firstSlot = firstState.operation.id;
  const firstReceipt = await readJson(
    join(store, "installations", firstSlot, "installation.json"),
  );
  const firstFiles = await inventory(join(store, "installations", firstSlot));
  const fetchedAfterFirst = fetches;
  const second = await nativeCommand("setup", configPath, {
    version: metadata.version,
    open,
  });
  assert.deepEqual(second.result, first.result);
  assert.equal(prepares, 1);
  assert.equal(fetches, fetchedAfterFirst);
  assert.deepEqual(
    await inventory(join(store, "installations", firstSlot)),
    firstFiles,
  );
  assert.deepEqual(await storage(app), seed);
  await record(
    "Native doctor and initial setup pass; repeated setup reuses the validated installation",
    {
      installationId: firstSlot,
      runtimeVersion: metadata.version,
      prepares,
      transportReads: fetches,
    },
  );

  const { chromium } = createRequire(import.meta.url)("playwright");
  controllerBrowser = await chromium.launch({ headless: true });
  viewerPage = await controllerBrowser.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  const started = await launch();
  assert.equal(started.reused, false);
  const ownerBefore = await readJson(join(store, "supervisor/child.json"));
  const startedAgain = await cli("start"),
    status = await cli("status");
  assert.equal(startedAgain.reused, true);
  assert.equal(startedAgain.viewerUrl, started.viewerUrl);
  assert.equal(status.viewerUrl, started.viewerUrl);
  assert.equal(status.selected.id, firstSlot);
  assert.equal(
    (await readJson(join(store, "supervisor/child.json"))).pid,
    ownerBefore.pid,
  );
  assert.deepEqual(await storage(app), seed);
  const initialViewer = await viewer(status);
  assert.equal((await initialViewer.observe()).runId, null);
  const firstFlow = await assertAcceptedFlow({
    ...initialViewer,
    settings: app,
    label: "native initial",
  });
  await writeJson(join(output, "initial-flow.json"), firstFlow);
  const reportsBefore = await assertReports(initialViewer.runs, firstSlot);
  await record(
    "Start reconnects to one runner and current viewer without replay; real success and negative cases have durable reports",
    { viewerUrl: started.viewerUrl, runReports: initialViewer.runs.length },
  );
  await stop();
  assert.deepEqual(await storage(app), firstFlow.persisted);
  await record(
    "Native stop closes owned driver resources while the attached application remains alive",
  );

  const relaunched = await launch();
  const repeatedViewer = await viewer(relaunched);
  assert.equal((await repeatedViewer.observe()).runId, null);
  assert.deepEqual(await storage(app), firstFlow.persisted);
  const repeatFlow = await assertAcceptedFlow({
    ...repeatedViewer,
    settings: app,
    label: "native repeat",
  });
  await writeJson(join(output, "repeat-flow.json"), repeatFlow);
  await assertReports(repeatedViewer.runs, firstSlot);
  for (const [name, digest] of Object.entries(reportsBefore))
    assert.equal(
      hash(await fs.readFile(join(store, "supervisor/run-reports", name))),
      digest,
    );
  await record(
    "Relaunch repeats the accepted flow and preserves earlier completed reports",
  );

  const changedFile = join(sourceRoot, "managed-launch.mjs");
  await fs.appendFile(
    changedFile,
    "\n// Native refresh acceptance: authored comment only; behavior unchanged.\n",
  );
  const refreshedSource = await snapshotProject(registration);
  assert.notEqual(refreshedSource.sha256, baseline.sha256);
  const beforeRefresh = await storage(app);
  const refreshed = await cli("refresh");
  assert.equal(refreshed.operation.status, "ready");
  assert.equal(refreshed.selected.id, firstSlot);
  assert.equal(refreshed.viewerUrl, relaunched.viewerUrl);
  assert.deepEqual(await storage(app), beforeRefresh);
  const readyState = await readJson(join(store, "state.json"));
  const refreshSlot = readyState.operation.id;
  assert.notEqual(refreshSlot, firstSlot);
  const refreshedReceipt = await readJson(
    join(store, "installations", refreshSlot, "installation.json"),
  );
  assert.equal(refreshedReceipt.version, firstReceipt.version);
  assert.deepEqual(
    refreshedReceipt.handshake.descriptor,
    firstReceipt.handshake.descriptor,
  );
  assert.equal(refreshedReceipt.sourceSha256, refreshedSource.sha256);
  const activated = await cli("restart");
  assert.equal(activated.selected.id, refreshSlot);
  assert.equal(activated.running.id, refreshSlot);
  const refreshedViewer = await viewer(activated);
  assert.equal((await refreshedViewer.observe()).runId, null);
  assert.deepEqual(await storage(app), beforeRefresh);
  const refreshedFlow = await assertAcceptedFlow({
    ...refreshedViewer,
    settings: app,
    label: "native source refresh",
  });
  await writeJson(join(output, "refreshed-flow.json"), refreshedFlow);
  await assertReports(refreshedViewer.runs, refreshSlot);
  await record(
    "Explicit source refresh validates the same runtime in a separate slot; restart preserves data and never replays a flow",
    { initialSlot: firstSlot, refreshSlot, version: refreshedReceipt.version },
  );
  await viewerPage.screenshot({
    path: join(output, "native-viewer.png"),
    fullPage: true,
  });
  if (process.env.NATIVE_WAIT_FOR_INSPECTION === "1") {
    const receipt = join(output, "visible-inspection.json");
    result.status = "AWAITING_VISIBLE_INSPECTION";
    result.viewerUrl = activated.viewerUrl;
    await writeJson(join(output, "result.json"), result);
    console.log(
      "NATIVE_VISIBLE " +
        JSON.stringify({
          viewerUrl: activated.viewerUrl,
          updateUrl: activated.updateUrl,
          receipt,
        }),
    );
    await waitFor(
      "Codex visible inspection",
      async () => {
        try {
          return (await readJson(receipt)).status === "PASS";
        } catch (error) {
          if (error.code === "ENOENT") return false;
          throw error;
        }
      },
      30 * 60 * 1000,
    );
    result.status = "RUNNING";
  }
  const beforeRollback = await storage(app);
  const rolledBack = await rollback(activated);
  assert.equal(rolledBack.selected.id, firstSlot);
  assert.equal(rolledBack.selected.historicalSnapshot, true);
  const rollbackViewer = await viewer(rolledBack);
  assert.equal((await rollbackViewer.observe()).runId, null);
  assert.deepEqual(await storage(app), beforeRollback);
  const rollbackFlow = await assertAcceptedFlow({
    ...rollbackViewer,
    settings: app,
    label: "native rollback",
  });
  await writeJson(join(output, "rollback-flow.json"), rollbackFlow);
  await assertReports(rollbackViewer.runs, firstSlot);
  await record(
    "Ninja rollback restores the complete previous installation and repeats the accepted flow",
  );
  await stop();
  assert.deepEqual(await storage(app), rollbackFlow.persisted);
  await verifyInstallation(firstReceipt.path, {
    registration,
    checkSource: false,
  });
  await verifyInstallation(refreshedReceipt.path, { registration });
  assert.deepEqual(await snapshotProject(registration), refreshedSource);
  assert.deepEqual(await inventory(acceptedSource), acceptedBefore);
  assert.equal(
    await execute("git", ["status", "--porcelain=v1", "-z"], {
      cwd: appCheckout,
    }).then((value) => value.stdout),
    appStatusBefore,
  );
  const applicationInventory = await readJson(
    join(fixture, "evidence/application-source.json"),
  );
  for (const entry of applicationInventory.files)
    assert.equal(
      hash(await fs.readFile(join(appRoot, entry.file))),
      entry.sha256,
    );
  assert.deepEqual(await inventory(toolsRoot), toolsBefore);
  await writeJson(join(output, "source-after.json"), refreshedSource);
  await record(
    "Accepted source, pinned app checkout and exact tools remain unchanged; only the explicit isolated comment edit exists",
  );
  const finalReports = await fs.readdir(join(store, "reports"));
  assert.ok(
    finalReports.length >= 4,
    "Stop, refresh, rollback and final stop retain completed session reports",
  );
  for (const name of finalReports) {
    const report = await readJson(join(store, "reports", name));
    if (report === null) continue;
    assert.equal(report.format, "browser-driver-report/1");
    assert.ok(report.resources.some((resource) => resource.owned));
    assert.ok(
      report.resources
        .filter((resource) => resource.owned)
        .every((resource) => resource.status === "closed"),
    );
    assert.ok(
      report.resources.some(
        (resource) => !resource.owned && resource.status === "attached",
      ),
    );
  }
  result.status = "PASS";
} catch (error) {
  result.status = "FAIL";
  result.error = { message: error.message, stack: error.stack };
  console.error(error);
  process.exitCode = 1;
} finally {
  // Retain failed ownership, and keep its attached app alive if the driver could
  // not close. Never force-kill or conceal a cleanup failure.
  for (const handle of ownerHandles) {
    try {
      await handle.close();
      result.cleanup.push({ resource: "native owner", status: "closed" });
    } catch (error) {
      nativeClosed = false;
      result.cleanup.push({
        resource: "native owner",
        status: "retained",
        message: error.message,
      });
    }
  }
  if (
    ownerHandles.length &&
    result.cleanup.every((item) => item.status === "closed")
  )
    nativeClosed = true;
  if (controllerBrowser) {
    try {
      await controllerBrowser.close();
      result.cleanup.push({
        resource: "acceptance controller browser",
        status: "closed",
      });
    } catch (error) {
      result.cleanup.push({
        resource: "acceptance controller browser",
        status: "retained",
        message: error.message,
      });
    }
  }
  if (app && nativeClosed) {
    try {
      await app.close();
      result.cleanup.push({
        resource: "owned synthetic application",
        status: "closed",
      });
    } catch (error) {
      result.cleanup.push({
        resource: "owned synthetic application",
        status: "retained",
        message: error.message,
      });
    }
  } else if (app)
    result.cleanup.push({
      resource: "owned synthetic application",
      status: "retained",
      message: "Its attached native driver still has unresolved cleanup.",
    });
  for (const name of [
    "registered-source",
    "active-application",
    "native.json",
  ]) {
    try {
      await fs.cp(join(work, name), join(output, name), { recursive: true });
    } catch (error) {
      if (error.code !== "ENOENT")
        (result.evidenceErrors ??= []).push({
          path: name,
          message: error.message,
        });
    }
  }
  for (const name of [
    "reports",
    "history",
    "state.json",
    "transaction.json",
    "native-session.json",
    "supervisor",
  ]) {
    try {
      await fs.cp(join(store, name), join(output, "manager", name), {
        recursive: true,
      });
    } catch (error) {
      if (error.code !== "ENOENT")
        (result.evidenceErrors ??= []).push({
          path: name,
          message: error.message,
        });
    }
  }
  const slots = await fs
    .readdir(join(store, "installations"))
    .catch((error) => {
      if (error.code !== "ENOENT")
        (result.evidenceErrors ??= []).push({
          path: "installations",
          message: error.message,
        });
      return [];
    });
  for (const slot of slots) {
    for (const name of [
      "logs",
      "checks",
      "installation.json",
      "registration.json",
      ".ninja-installation.json",
    ]) {
      try {
        await fs.cp(
          join(store, "installations", slot, name),
          join(output, "installations", slot, name),
          { recursive: true },
        );
      } catch (error) {
        if (error.code !== "ENOENT")
          (result.evidenceErrors ??= []).push({
            path: slot + "/" + name,
            message: error.message,
          });
      }
    }
  }
  if (
    result.cleanup.some((item) => item.status === "retained") ||
    result.evidenceErrors?.length
  ) {
    result.status = "FAIL";
    process.exitCode = 1;
  }
  result.completedAt = new Date().toISOString();
  await writeJson(join(output, "result.json"), result);
  console.log("NATIVE_CUSTOMER_RECEIPT " + join(output, "result.json"));
}
