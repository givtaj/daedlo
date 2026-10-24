// Exact installed alpha.3 -> renamed alpha.4 -> alpha.3 drill using only the
// independent notebook fixture. Default transport uses a local synthetic feed;
// --production-https reads the fixed live feed with pinned public trust and real
// HTTPS. Neither mode mutates production or establishes customer acceptance.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import fs from "node:fs/promises";
import { channel } from "node:diagnostics_channel";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { assertFlow, notes } from "./fixtures/alpha4-upgrade/flow.mjs";

const execute = promisify(execFile);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = async (path) => JSON.parse(await fs.readFile(path, "utf8"));
const writeJson = (path, value) =>
  fs.writeFile(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
const args = process.argv.slice(2);
for (const arg of args)
  assert.ok(
    ["--legacy-only", "--production-https"].includes(arg),
    "Unsupported upgrade acceptance argument",
  );
assert.equal(
  new Set(args).size,
  args.length,
  "Duplicate upgrade acceptance argument",
);
const legacyOnly = args.includes("--legacy-only");
const productionHttps = args.includes("--production-https");
assert.ok(
  !(productionHttps && legacyOnly),
  "Production HTTPS acceptance requires the complete upgrade drill",
);
const PRODUCTION = Object.freeze({
  origin: "https://daedlo.com",
  url: "https://daedlo.com/updates/preview.json",
  keyId: "daedlo-release-2026-10",
  publicPemSha256:
    "df84f7d60ed2af949d394e338070ef66ab4debabf911ffd6c7b35bebe6ba4297",
});
const networkFetch = globalThis.fetch;
const LEGACY_SHA =
  "f569bc0c84bf1b7ac5efe59c610916ac8ab0d5bb3322ed520114d8880262b190";
assert.ok(
  process.env.ALPHA4_LEGACY_KIT,
  "Set ALPHA4_LEGACY_KIT to the immutable alpha.3 public kit directory",
);
if (!legacyOnly) {
  assert.ok(
    process.env.ALPHA4_CANDIDATE_KIT,
    "Set ALPHA4_CANDIDATE_KIT to the exact alpha.4 public kit directory",
  );
  assert.match(
    process.env.ALPHA4_CANDIDATE_SHA256 ?? "",
    /^[a-f0-9]{64}$/,
    "Pin the candidate ZIP with ALPHA4_CANDIDATE_SHA256",
  );
}
const productionTrust = productionHttps
  ? await fs.readFile(
      join(repo, "docs/update-trust", PRODUCTION.keyId + ".pem"),
    )
  : null;
if (productionHttps) {
  assert.equal(
    hash(productionTrust),
    PRODUCTION.publicPemSha256,
    "Bundled production public trust must match the independent fixed pin",
  );
  assert.equal(
    process.platform + "/" + process.arch,
    "darwin/arm64",
    "Production alpha4 acceptance is scoped to macOS arm64",
  );
}
const outputParent = resolve(
  process.env.ALPHA4_UPGRADE_OUTPUT ?? join(repo, "artifacts/alpha4-upgrade"),
);
await fs.mkdir(outputParent, { recursive: true, mode: 0o700 });
const output = await fs.realpath(await fs.mkdtemp(join(outputParent, "run-")));
const work = join(output, "work");
await fs.mkdir(work, { mode: 0o700 });
const result = {
  schemaVersion: 1,
  status: "RUNNING",
  startedAt: new Date().toISOString(),
  output,
  scope: legacyOnly
    ? "legacy fixture preparation only"
    : "exact installed tools bootstrap, upgrade and rollback",
  transport: productionHttps ? "production-https" : "ephemeral-signed-feed",
  ...(productionHttps
    ? {
        feed: {
          url: PRODUCTION.url,
          publicKeySha256: PRODUCTION.publicPemSha256,
        },
      }
    : {}),
  checks: [],
  cleanup: [],
  limits: [
    "Independent synthetic notebook; no WBF, Roots or other customer checkout accessed",
    "Existing host toolchains and matching Playwright Chromium; clean OS is not tested",
    productionHttps
      ? "Fixed production HTTPS feed and immutable downloads with bundled pinned public trust; no private publisher key or production mutation"
      : "Ephemeral local signed catalog with injected fetch transport; no production feed, private publisher key or network publication",
    "Notebook records live in the separately owned app process; exact data preservation is checked across driver and manager changes, not an application-process restart",
    productionHttps
      ? "Website command rendering, customer acceptance, and release authorization remain separate gates"
      : "Production rollout, website command rendering, and release authorization remain separate gates",
  ],
};
await writeJson(join(output, "result.json"), result);
console.log("Evidence: " + output);
async function record(name, details = {}) {
  result.checks.push({ name, status: "PASS", ...details });
  await writeJson(join(output, "result.json"), result);
  console.log("PASS " + name);
}
let sequence = 0;
async function run(program, args, cwd = work, timeout = 240000) {
  const log = join(
    output,
    `tool-${++sequence}-${program.split("/").at(-1)}.log`,
  );
  try {
    const value = await execute(program, args, {
      cwd,
      env: process.env,
      timeout,
      maxBuffer: 30 * 1024 * 1024,
      shell: false,
    });
    await fs.writeFile(log, value.stdout + value.stderr);
    return value.stdout;
  } catch (error) {
    await fs.writeFile(
      log,
      String(error.stdout ?? "") + String(error.stderr ?? ""),
    );
    throw new Error(`${program} failed; see ${log}`, { cause: error });
  }
}
async function files(root, prefix = "") {
  const paths = [];
  for (const item of await fs.readdir(join(root, prefix), {
    withFileTypes: true,
  })) {
    const path = prefix ? prefix + "/" + item.name : item.name;
    if (item.isDirectory()) paths.push(...(await files(root, path)));
    else {
      assert.ok(
        item.isFile(),
        "Fixture/package inventory contains only regular files",
      );
      paths.push(path);
    }
  }
  return paths.sort();
}
async function inventory(root) {
  return Object.fromEntries(
    await Promise.all(
      (await files(root)).map(async (file) => [
        file,
        hash(await fs.readFile(join(root, file))),
      ]),
    ),
  );
}
async function kit(directory, version, expectedSha, destination) {
  directory = await fs.realpath(resolve(directory));
  const metadata = await readJson(join(directory, "release.json"));
  assert.equal(metadata.version, version);
  assert.equal(metadata.archive.file, `daedlo-${version}.zip`);
  assert.equal(
    metadata.source.dirty,
    false,
    "Only a clean frozen source candidate is installable",
  );
  const archive = await fs.readFile(join(directory, metadata.archive.file));
  assert.equal(hash(archive), expectedSha, "Exact public-kit ZIP pin");
  assert.equal(metadata.archive.sha256, expectedSha);
  assert.equal(metadata.archive.bytes, archive.length);
  await fs.mkdir(destination);
  const script = `import hashlib,json,pathlib,sys,zipfile\np=json.loads(sys.argv[1]); root=pathlib.Path(p['destination']); meta=json.load(open(p['metadata'])); expected={f['file']:f for f in meta['files']}\nwith zipfile.ZipFile(p['archive']) as z:\n names=[i.filename for i in z.infolist() if not i.is_dir()]\n assert len(names)==len(set(names)) and set(names)==set(expected), 'Exact closed kit inventory'\n for name in names:\n  parts=pathlib.PurePosixPath(name).parts\n  assert parts and parts[0]==p['prefix'] and not name.startswith('/') and not any(x in ('..','.') for x in parts) and '\\\\' not in name\n  data=z.read(name); entry=expected[name]\n  assert len(data)==entry['bytes'] and hashlib.sha256(data).hexdigest()==entry['sha256'], 'Kit entry digest'\n  target=root.joinpath(*parts); target.parent.mkdir(parents=True,exist_ok=True); target.write_bytes(data)\nprint('Verified and extracted '+str(len(names))+' exact kit entries')`;
  await run("python3", [
    "-c",
    script,
    JSON.stringify({
      archive: join(directory, metadata.archive.file),
      metadata: join(directory, "release.json"),
      destination,
      prefix: `daedlo-${version}`,
    }),
  ]);
  const root = join(destination, `daedlo-${version}`);
  const manifestBytes = await fs.readFile(join(root, metadata.bundle.manifest));
  assert.equal(hash(manifestBytes), metadata.bundle.manifestSha256);
  const manifest = JSON.parse(manifestBytes);
  assert.deepEqual(manifest.source, metadata.source);
  assert.equal(manifest.version, version);
  const toolsReceipt = await readJson(
    join(root, "tools/TOOLS_VERIFICATION.json"),
  );
  assert.equal(toolsReceipt.version, version);
  assert.deepEqual(toolsReceipt.source, metadata.source);
  assert.equal(
    hash(await fs.readFile(join(root, metadata.tools.file))),
    metadata.tools.sha256,
  );
  return { directory, metadata, root, manifest, toolsReceipt, expectedSha };
}
async function installTools(value, directory) {
  await fs.mkdir(directory);
  await writeJson(join(directory, "package.json"), {
    private: true,
    name: "isolated-upgrade-tools",
    version: "1.0.0",
  });
  await run("npm", [
    "install",
    "--prefix",
    directory,
    "--workspaces=false",
    "--offline",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--cache",
    join(work, "tools-cache"),
    join(value.root, value.metadata.tools.file),
  ]);
  const root = join(directory, "node_modules", value.toolsReceipt.name);
  const actual = await inventory(root);
  const expected = Object.fromEntries(
    value.toolsReceipt.files.map((file) => [file.file, file.sha256]),
  );
  const sourceBytes = await fs.readFile(join(root, "SOURCE.json"));
  const {
    archive: _archive,
    fileCount: _fileCount,
    ...sourceReceipt
  } = value.toolsReceipt;
  assert.deepEqual(
    JSON.parse(sourceBytes),
    sourceReceipt,
    "Tools self-description matches its verified receipt",
  );
  expected["SOURCE.json"] = hash(sourceBytes);
  assert.deepEqual(
    actual,
    expected,
    "Installed tools exactly match the verified closed package inventory",
  );
  return { root, inventory: actual, lib: join(root, "lib") };
}
async function toolApi(tools) {
  const load = (name) => import(pathToFileURL(join(tools.lib, name + ".mjs")));
  const [ninja, manager, supervisor, installation, catalog] = await Promise.all(
    [
      load("ninja"),
      load("ninja-manager"),
      load("ninja-supervisor"),
      load("ninja-installation"),
      load("ninja-catalog"),
    ],
  );
  return { ...ninja, ...manager, ...supervisor, ...installation, ...catalog };
}
async function prepareProject(legacy) {
  const sourceRoot = join(work, "registered-project");
  await fs.mkdir(join(sourceRoot, "engine/src"), { recursive: true });
  for (const name of ["server.mjs", "adapter.mjs", "index.html"])
    await fs.copyFile(
      join(repo, "examples/notebook", name),
      join(sourceRoot, name),
    );
  for (const name of await files(join(repo, "tests/fixtures/alpha4-upgrade")))
    await fs.copyFile(
      join(repo, "tests/fixtures/alpha4-upgrade", name),
      join(sourceRoot, name),
    );
  for (const name of ["main.rs", "lib.rs"])
    await fs.writeFile(
      join(sourceRoot, "engine/src", name),
      (
        await fs.readFile(
          join(repo, "examples/notebook-engine/src", name),
          "utf8",
        )
      ).replaceAll("daedlo_engine", "browser_driver_engine"),
    );
  const crate = join(work, "legacy-crate");
  await fs.mkdir(crate);
  await run("tar", [
    "-xzf",
    join(legacy.root, "bundle", legacy.manifest.artifacts.engine.file),
    "-C",
    crate,
  ]);
  const enginePath = join(crate, "browser-driver-engine-0.1.4-alpha.3");
  const cargo = `[package]\nname = "notebook-engine"\nversion = "1.0.0"\nedition = "2021"\nrust-version = "1.96"\npublish = false\n\n[workspace]\n\n[dependencies]\nbrowser-driver-engine = { path = ${JSON.stringify(enginePath)}, version = "=0.1.4-alpha.3" }\nserde = { version = "1", features = ["derive"] }\nserde_json = "1"\n`;
  await fs.writeFile(join(sourceRoot, "engine/Cargo.toml"), cargo);
  await writeJson(join(sourceRoot, "package.json"), {
    private: true,
    name: "alpha4-independent-notebook",
    version: "1.0.0",
    type: "module",
    dependencies: {
      "@browser-driver/runtime": `file:${join(legacy.root, "bundle", legacy.manifest.artifacts.runtime.file)}`,
    },
  });
  await run(
    "npm",
    [
      "install",
      "--package-lock-only",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--cache",
      join(work, "npm-cache"),
    ],
    sourceRoot,
  );
  await run(
    "cargo",
    [
      "generate-lockfile",
      "--offline",
      "--manifest-path",
      join(sourceRoot, "engine/Cargo.toml"),
    ],
    sourceRoot,
  );
  return sourceRoot;
}
let active, application, controller;
const managers = [];
const fetches = [];
const requestChannel = channel("undici:request:create");
const observeRequest = ({ request }) => {
  const url = new URL(request.path, request.origin);
  if (url.origin === PRODUCTION.origin) fetches.push(url.href);
};
if (productionHttps) requestChannel.subscribe(observeRequest);
const statePath = join(work, "manager/state.json");
const configPath = join(work, "managed.json");
const currentReceipt = async () => {
  const state = await readJson(statePath);
  return readJson(
    join(work, "manager/installations", state.current, "installation.json"),
  );
};
async function closeManager() {
  if (!active || active.closed) return;
  const before = await notes(application.url);
  await active.manager.close();
  active.closed = true;
  const status = await active.supervisor.status();
  assert.equal(status.running, null);
  assert.equal(status.cleanupPending, false);
  assert.deepEqual(
    await notes(application.url),
    before,
    "Attached application survives manager shutdown",
  );
}
async function waitFor(check, label) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw Error(label + " timed out");
}
async function managedFlow(label, { durable = true } = {}) {
  const live = await active.supervisor.status();
  assert.ok(live.running?.viewerUrl);
  const base = new URL(live.running.viewerUrl).origin;
  const observe = async () => {
    const response = await fetch(base + "/status");
    assert.equal(response.status, 200);
    return (await response.json()).driver;
  };
  const receipt = await currentReceipt();
  if (!controller) {
    const load = createRequire(receipt.runtimePath);
    controller = await load("playwright").chromium.launch({
      executablePath: receipt.browser.executablePath,
      headless: true,
      handleSIGINT: false,
      handleSIGTERM: false,
    });
  }
  const view = await controller.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  await view.goto(live.running.viewerUrl);
  await view.locator('[data-command="edit"]').waitFor();
  const command = async (id, params) => {
    const revision = (await observe()).revision;
    const response = await fetch(base + "/command", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ id, params, revision }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  try {
    const flow = await assertFlow({
      command,
      observe,
      origin: application.url,
      label,
    });
    // A direct HTTP run finishes before the viewer's next status poll. Wait
    // for this exact completed save, so the retained image is UI evidence of
    // the asserted outcome rather than a frame from an earlier command.
    await view.waitForFunction(
      ({ runId, outcome }) =>
        document.querySelector("#run-id")?.textContent === `Run ${runId}` &&
        document.querySelector("#execution-state")?.textContent ===
          "Completed" &&
        document.querySelector(
          '[data-state="notebook.saved"][aria-current="true"]',
        ) !== null &&
        document.querySelector("#outcome-label")?.textContent === outcome &&
        document
          .querySelector("#effect-label")
          ?.textContent.includes("Application effect: Saved"),
      { runId: flow.saved.runId, outcome: flow.saved.outcome.label },
      { timeout: 15000 },
    );
    await view.screenshot({
      path: join(output, label + "-viewer.png"),
      fullPage: true,
    });
    await writeJson(join(output, label + "-flow.json"), flow);
    if (durable) {
      const directory = join(work, "manager/supervisor/run-reports");
      await waitFor(async () => {
        const names = await fs.readdir(directory).catch((error) => {
          if (error.code === "ENOENT") return [];
          throw error;
        });
        const reports = await Promise.all(
          names.map((name) => readJson(join(directory, name))),
        );
        return flow.runs.every((run) =>
          reports.some(
            (value) =>
              value.installation.id === receipt.id &&
              value.report.runId === run.runId,
          ),
        );
      }, "Durable completed-run reports");
      const reports = await Promise.all(
        (await fs.readdir(directory)).map((name) =>
          readJson(join(directory, name)),
        ),
      );
      for (const run of flow.runs) {
        const matches = reports.filter(
          (value) =>
            value.installation.id === receipt.id &&
            value.report.runId === run.runId,
        );
        assert.equal(matches.length, 1);
        assert.deepEqual(matches[0].report.lastResult, run);
      }
    }
    return flow;
  } finally {
    await view.close();
  }
}
try {
  const legacy = await kit(
    process.env.ALPHA4_LEGACY_KIT,
    "0.1.4-alpha.3",
    LEGACY_SHA,
    join(work, "legacy-kit"),
  );
  result.legacy = {
    kitSha256: legacy.expectedSha,
    source: legacy.metadata.source,
    manifestSha256: legacy.metadata.bundle.manifestSha256,
  };
  const oldTools = await installTools(legacy, join(work, "legacy-tools"));
  const old = await toolApi(oldTools);
  const sourceRoot = await prepareProject(legacy);
  const registration = {
    schemaVersion: 1,
    projectId: "alpha4-independent-notebook",
    label: "Independent notebook upgrade",
    sourceRoot,
    files: await files(sourceRoot),
    model: { id: "notebook", version: "1" },
    interfaces: {
      launcher: 1,
      nodeAdapter: 1,
      rustModel: 1,
      protocol: 1,
      capabilities: [...old.NINJA_CONTRACTS.capabilities],
    },
    node: { packageJson: "package.json", packageLock: "package-lock.json" },
    rust: {
      manifest: "engine/Cargo.toml",
      lock: "engine/Cargo.lock",
      binary: "notebook-engine",
    },
    hooks: {
      acceptance: "installation-hook.mjs",
      health: "installation-hook.mjs",
    },
    launcher: "managed-launch.mjs",
  };
  const original = await old.snapshotProject(registration);
  await writeJson(join(output, "project-before.json"), original);
  const { createNotebookServer } = await import(
    pathToFileURL(join(sourceRoot, "server.mjs"))
  );
  application = await createNotebookServer();
  const { privateKey, publicKey } = productionHttps
    ? {}
    : generateKeyPairSync("ed25519");
  const keyId = productionHttps
    ? PRODUCTION.keyId
    : "ephemeral-alpha4-acceptance";
  await fs.writeFile(
    join(work, "publisher-public.pem"),
    productionHttps
      ? productionTrust
      : publicKey.export({ type: "spki", format: "pem" }),
  );
  const origin = productionHttps
    ? PRODUCTION.origin
    : "https://alpha4-acceptance.example.test";
  const config = {
    schemaVersion: 1,
    store: join(work, "manager"),
    registration,
    settings: { origin: application.url },
    catalog: {
      url: productionHttps ? PRODUCTION.url : origin + "/catalog.json",
      publisher: "daedlo",
      channel: "preview",
      trustedKeys: [{ id: keyId, publicKeyFile: "publisher-public.pem" }],
    },
    installation: { offline: false, npmCache: join(work, "npm-cache") },
  };
  await writeJson(configPath, config);
  const configBytes = await fs.readFile(configPath);
  const trustBytes = await fs.readFile(join(work, "publisher-public.pem"));
  const assets = new Map();
  const entries = [];
  async function addEntry(value) {
    const asset = async (name) => {
      const bytes = await fs.readFile(join(value.directory, name));
      const url = `${origin}/downloads/${value.metadata.version}/${name}`;
      assets.set(url, bytes);
      return { url, bytes: bytes.length, sha256: hash(bytes) };
    };
    const entry = {
      version: value.metadata.version,
      channel: "preview",
      platforms: [{ os: process.platform, arch: process.arch }],
      contracts: {
        ...structuredClone(old.NINJA_CONTRACTS),
        manager:
          value.manifest.artifacts.runtime.name === "@daedlo/runtime" ? 2 : 1,
      },
      notesUrl: origin + "/notes/" + value.metadata.version,
      kit: await asset(value.metadata.archive.file),
      metadata: await asset("release.json"),
      checksums: await asset("SHA256SUMS"),
    };
    entries.push(entry);
  }
  let feed;
  function publish(generation) {
    const now = Date.now();
    const signed = {
      schemaVersion: 1,
      kind: "daedlo-public-kit-catalog",
      publisher: "daedlo",
      generation,
      issuedAt: new Date(now - 10000).toISOString(),
      expiresAt: new Date(now + 86400000).toISOString(),
      releases: entries,
    };
    feed = Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        kind: "daedlo-signed-catalog",
        signed,
        signature: {
          keyId,
          value: sign(
            null,
            old.ninjaCatalogSigningBytes(signed),
            privateKey,
          ).toString("base64"),
        },
      }),
    );
  }
  if (!productionHttps) {
    await addEntry(legacy);
    publish(1);
  }
  async function assertAvailableKit(value) {
    const available = (await readJson(statePath)).available;
    assert.equal(available?.version, value.metadata.version);
    for (const [field, name] of [
      ["kit", value.metadata.archive.file],
      ["metadata", "release.json"],
      ["checksums", "SHA256SUMS"],
    ]) {
      const bytes = await fs.readFile(join(value.directory, name));
      assert.deepEqual(
        available[field],
        {
          url: `${origin}/downloads/${value.metadata.version}/${name}`,
          bytes: bytes.length,
          sha256: hash(bytes),
        },
        "Authenticated offered assets must match the explicitly pinned local kit",
      );
    }
  }
  async function preparePinned(value) {
    await assertAvailableKit(value);
    const before = fetches.length;
    const prepared = await active.manager.prepare(value.metadata.version);
    assert.deepEqual(
      fetches.slice(before),
      ["release.json", "SHA256SUMS", value.metadata.archive.file].map(
        (name) => `${origin}/downloads/${value.metadata.version}/${name}`,
      ),
      "Manager downloads all three signed assets using the selected transport",
    );
    return prepared;
  }
  async function open(api) {
    // Both real immutable tools use their public bootstrap API. Production mode
    // keeps the actual global fetch untouched; diagnostics observe requests only.
    // Ephemeral mode supplies its bounded synthetic transport during bootstrap.
    assert.deepEqual(await readJson(configPath), config);
    const originalFetch = globalThis.fetch;
    let handles;
    if (productionHttps) assert.equal(globalThis.fetch, networkFetch);
    else
      globalThis.fetch = async (url) => {
        const address = String(url);
        fetches.push(address);
        const bytes =
          address === config.catalog.url ? feed : assets.get(address);
        assert.ok(bytes, "Only explicit local catalog assets may be fetched");
        return new Response(bytes, {
          status: 200,
          headers: { "Content-Length": String(bytes.length) },
        });
      };
    try {
      handles = await api.openNinja(configPath);
    } finally {
      if (!productionHttps) globalThis.fetch = originalFetch;
    }
    active = { ...handles, api, closed: false };
    managers.push(active);
  }

  await open(old);
  await active.manager.check();
  let prepared = await preparePinned(legacy);
  assert.equal(prepared.operation.status, "ready");
  await active.manager.activate(prepared.operation.id, {
    acknowledgeRestart: true,
  });
  const baselineReceipt = await currentReceipt();
  assert.equal(baselineReceipt.version, "0.1.4-alpha.3");
  assert.equal(baselineReceipt.release.archiveSha256, LEGACY_SHA);
  await managedFlow("legacy-old-tools", { durable: false });
  await record(
    "Immutable alpha.3 installed by its exact old tools; real negative/save flow passed",
    {
      installationId: baselineReceipt.id,
      toolsFiles: Object.keys(oldTools.inventory).length,
    },
  );
  if (legacyOnly) {
    await closeManager();
    assert.deepEqual(await old.snapshotProject(registration), original);
    assert.deepEqual(await inventory(oldTools.root), oldTools.inventory);
    await record(
      "Legacy fixture source/tools preserved and owned driver cleaned; attached data survives",
    );
  } else {
    const candidate = await kit(
      process.env.ALPHA4_CANDIDATE_KIT,
      "0.1.4-alpha.4",
      process.env.ALPHA4_CANDIDATE_SHA256,
      join(work, "candidate-kit"),
    );
    assert.equal(candidate.manifest.artifacts.runtime.name, "@daedlo/runtime");
    assert.equal(candidate.manifest.artifacts.engine.name, "daedlo-engine");
    assert.equal(candidate.toolsReceipt.name, "@daedlo/release-tools");
    result.candidate = {
      kitSha256: candidate.expectedSha,
      source: candidate.metadata.source,
      manifestSha256: candidate.metadata.bundle.manifestSha256,
    };
    if (!productionHttps) {
      await addEntry(candidate);
      publish(2);
    }
    const beforeRefusal = await notes(application.url);
    const fetchCount = fetches.length;
    const refused = await active.manager.check();
    assert.equal(
      refused.available,
      null,
      "Old tools must not offer renamed alpha4",
    );
    assert.equal(refused.error?.code, "migration_required");
    const refusal = refused.error;
    await assert.rejects(active.manager.prepare("0.1.4-alpha.4"), {
      code: "stale_operation",
    });
    assert.deepEqual(
      fetches.slice(fetchCount),
      [config.catalog.url],
      "Old client must reject at discovery before any candidate download",
    );
    assert.equal((await currentReceipt()).id, baselineReceipt.id);
    assert.equal(
      (await active.supervisor.status()).running.id,
      baselineReceipt.id,
    );
    assert.deepEqual(await notes(application.url), beforeRefusal);
    assert.deepEqual(await old.snapshotProject(registration), original);
    await writeJson(join(output, "legacy-refusal.json"), refusal);
    await record(
      "Immutable alpha.3 tools report migration_required before download and preserve accepted slot/data",
      refusal,
    );
    await closeManager();
    const checkpoint = (await readJson(statePath)).checkpoint;
    if (!productionHttps) assert.equal(checkpoint.generation, 2);
    else assert.ok(checkpoint.generation >= 2);
    result.legacyCheckpoint = checkpoint;
    const ownerBytes = await fs.readFile(
      join(config.store, ".ninja-project.json"),
    );
    const newTools = await installTools(candidate, join(work, "new-tools"));
    const newer = await toolApi(newTools);
    await open(newer);
    assert.deepEqual((await readJson(statePath)).checkpoint, checkpoint);
    assert.deepEqual(
      await fs.readFile(join(config.store, ".ninja-project.json")),
      ownerBytes,
    );
    assert.deepEqual(await fs.readFile(configPath), configBytes);
    assert.deepEqual(
      await fs.readFile(join(work, "publisher-public.pem")),
      trustBytes,
    );
    await active.manager.start();
    assert.equal((await currentReceipt()).id, baselineReceipt.id);
    assert.equal(
      (await active.supervisor.status()).running.version,
      "0.1.4-alpha.3",
    );
    await managedFlow("legacy-new-tools");
    await record(
      "Verified new tools bootstrap preserves config/trust/store/checkpoint and runs accepted legacy slot",
      { toolsFiles: Object.keys(newTools.inventory).length },
    );
    const beforeUpgrade = await notes(application.url);
    const offered = await active.manager.check();
    assert.equal(offered.available?.version, "0.1.4-alpha.4");
    assert.equal(offered.error, null);
    const acceptedCheckpoint = (await readJson(statePath)).checkpoint;
    assert.ok(acceptedCheckpoint.generation >= checkpoint.generation);
    if (acceptedCheckpoint.generation === checkpoint.generation)
      assert.deepEqual(acceptedCheckpoint, checkpoint);
    prepared = await preparePinned(candidate);
    assert.equal(prepared.operation.status, "ready");
    assert.deepEqual(await notes(application.url), beforeUpgrade);
    await active.manager.activate(prepared.operation.id, {
      acknowledgeRestart: true,
    });
    const candidateReceipt = await currentReceipt();
    assert.equal(candidateReceipt.version, "0.1.4-alpha.4");
    assert.equal(candidateReceipt.release.archiveSha256, candidate.expectedSha);
    assert.equal(
      candidateReceipt.release.manifestSha256,
      candidate.metadata.bundle.manifestSha256,
    );
    await newer.verifyInstallation(candidateReceipt.path, { registration });
    assert.deepEqual(
      candidateReceipt.handshake.descriptor,
      baselineReceipt.handshake.descriptor,
    );
    assert.deepEqual(await notes(application.url), beforeUpgrade);
    await managedFlow("candidate-alpha4");
    await record(
      "Exact renamed alpha.4 installation preserves data/model and passes real negative/save flow",
      { installationId: candidateReceipt.id },
    );
    const beforeRestart = await notes(application.url);
    await closeManager();
    await open(newer);
    assert.deepEqual(
      (await readJson(statePath)).checkpoint,
      acceptedCheckpoint,
    );
    await active.manager.start();
    assert.equal((await currentReceipt()).id, candidateReceipt.id);
    assert.equal(
      (await active.supervisor.status()).running.id,
      candidateReceipt.id,
    );
    assert.deepEqual(await notes(application.url), beforeRestart);
    await managedFlow("candidate-restarted-alpha4");
    await record(
      "Fresh manager recovers retained alpha4 installation and restarts it with preserved notebook data",
    );
    const beforeRollback = await notes(application.url);
    await active.manager.rollback({ acknowledgeRestart: true });
    assert.equal((await currentReceipt()).id, baselineReceipt.id);
    assert.deepEqual(await notes(application.url), beforeRollback);
    await managedFlow("rollback-alpha3");
    await record(
      "Complete retained alpha.3 slot restored without data changes; real negative/save flow passes",
    );
    await closeManager();
    active.closed = false;
    await active.manager.start();
    assert.equal(
      (await active.supervisor.status()).running.id,
      baselineReceipt.id,
    );
    await closeManager();
    assert.deepEqual(await newer.snapshotProject(registration), original);
    assert.deepEqual(await inventory(oldTools.root), oldTools.inventory);
    assert.deepEqual(await inventory(newTools.root), newTools.inventory);
    assert.deepEqual(await fs.readFile(configPath), configBytes);
    assert.deepEqual(
      await fs.readFile(join(work, "publisher-public.pem")),
      trustBytes,
    );
    assert.deepEqual(
      (await readJson(statePath)).checkpoint,
      acceptedCheckpoint,
    );
    result.finalCheckpoint = acceptedCheckpoint;
    const reports = await fs.readdir(join(config.store, "reports"));
    assert.ok(
      reports.length >= 4,
      "Durable lifecycle reports retained across tools replacement, upgrade, rollback and relaunch",
    );
    await writeJson(
      join(output, "project-after.json"),
      await newer.snapshotProject(registration),
    );
    await writeJson(
      join(output, "data-after.json"),
      await notes(application.url),
    );
    await record(
      "States/flows/adapter source, both tools packages, config/trust/checkpoint preserved; durable reports and relaunch pass",
      { lifecycleReports: reports.length },
    );
  }
  result.status = "PASS";
} catch (error) {
  result.status = "FAIL";
  result.error = {
    message: error.message,
    stack: error.stack,
    cause: error.cause?.message,
  };
  process.exitCode = 1;
} finally {
  let driverClosed = true;
  for (const [index, value] of managers.entries()) {
    try {
      if (!value.closed) await value.manager.close();
      const status = await value.supervisor.status();
      assert.equal(status.running, null);
      assert.equal(status.cleanupPending, false);
      value.closed = true;
      result.cleanup.push({
        resource: "managed driver",
        instance: index + 1,
        status: "closed",
      });
    } catch (error) {
      driverClosed = false;
      result.cleanup.push({
        resource: "managed driver",
        instance: index + 1,
        status: "incomplete",
        error: error.message,
      });
    }
  }
  if (controller) {
    try {
      await controller.close();
      result.cleanup.push({
        resource: "acceptance viewer browser",
        status: "closed",
      });
    } catch (error) {
      result.cleanup.push({
        resource: "acceptance viewer browser",
        status: "incomplete",
        error: error.message,
      });
    }
  }
  if (application && driverClosed) {
    try {
      await application.close();
      result.cleanup.push({
        resource: "owned notebook application",
        status: "closed",
      });
    } catch (error) {
      result.cleanup.push({
        resource: "owned notebook application",
        status: "incomplete",
        error: error.message,
      });
    }
  } else if (application)
    result.cleanup.push({
      resource: "owned notebook application",
      status: "retained",
      reason: "Driver cleanup is incomplete",
    });
  if (result.cleanup.some((value) => value.status !== "closed")) {
    result.status = "FAIL";
    process.exitCode = 1;
  }
  if (productionHttps) requestChannel.unsubscribe(observeRequest);
  result.transportRequests = fetches;
  result.finishedAt = new Date().toISOString();
  await writeJson(join(output, "result.json"), result);
  console.log(
    JSON.stringify({
      status: result.status,
      output,
      error: result.error?.message,
    }),
  );
}
