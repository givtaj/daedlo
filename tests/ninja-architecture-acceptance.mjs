// Real application acceptance using immutable public alpha.2 and alpha.3.
// Default: local signed-catalog seam. Published mode uses pinned trust and real HTTPS.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
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

const exec = promisify(execFile),
  hash = (value) => createHash("sha256").update(value).digest("hex");

function publishedConfiguration(env, keyBytes) {
  const names = [
    "NINJA_PUBLISHED_CATALOG_URL",
    "NINJA_PUBLISHED_KEY_ID",
    "NINJA_PUBLISHED_PUBLIC_KEY_FILE",
    "NINJA_PUBLISHED_KEY_SHA256",
  ];
  if (!names.some((name) => env[name] !== undefined)) return null;
  let url;
  try {
    url = new URL(env.NINJA_PUBLISHED_CATALOG_URL);
  } catch {}
  assert.ok(
    url &&
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !url.search &&
      !/%|\\/.test(url.pathname),
    "Published catalog requires a plain HTTPS URL",
  );
  assert.match(
    env.NINJA_PUBLISHED_KEY_ID ?? "",
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/,
    "Published key ID is required",
  );
  assert.ok(
    env.NINJA_PUBLISHED_PUBLIC_KEY_FILE,
    "Published public key file is required",
  );
  assert.match(
    env.NINJA_PUBLISHED_KEY_SHA256 ?? "",
    /^[a-f0-9]{64}$/,
    "Published PEM file SHA256 pin is required",
  );
  const result = {
    url: url.href,
    publisher: "daedlo",
    channel: "preview",
    publicKeyFile: resolve(env.NINJA_PUBLISHED_PUBLIC_KEY_FILE),
    pemSha256: env.NINJA_PUBLISHED_KEY_SHA256,
  };
  if (keyBytes !== undefined) {
    assert.equal(
      hash(keyBytes),
      result.pemSha256,
      "Published PEM file SHA256 pin mismatch",
    );
    assert.match(
      keyBytes.toString("utf8"),
      /^-----BEGIN PUBLIC KEY-----\r?\n/,
      "Expected a public PEM key",
    );
    const key = createPublicKey(keyBytes);
    assert.equal(
      key.asymmetricKeyType,
      "ed25519",
      "Published key must use Ed25519",
    );
    result.spkiSha256 = hash(key.export({ type: "spki", format: "der" }));
    result.trustedKeys = [
      { id: env.NINJA_PUBLISHED_KEY_ID, publicKey: keyBytes.toString("utf8") },
    ];
  }
  return result;
}

// Run fail-closed transport/trust regressions without installing or starting an app.
if (process.argv.includes("--test-published-config")) {
  const { publicKey } = generateKeyPairSync("ed25519");
  const pem = Buffer.from(publicKey.export({ type: "spki", format: "pem" }));
  const env = {
    NINJA_PUBLISHED_CATALOG_URL: "https://daedlo.com/updates/preview.json",
    NINJA_PUBLISHED_KEY_ID: "daedlo-release-2026-10",
    NINJA_PUBLISHED_PUBLIC_KEY_FILE: "/owned/production-public-key.pem",
    NINJA_PUBLISHED_KEY_SHA256: hash(pem),
  };
  assert.throws(
    () =>
      publishedConfiguration(
        {
          ...env,
          NINJA_PUBLISHED_CATALOG_URL: "http://daedlo.com/updates/preview.json",
        },
        pem,
      ),
    /HTTPS/,
  );
  assert.throws(
    () => publishedConfiguration({ ...env, NINJA_PUBLISHED_KEY_ID: "" }, pem),
    /key ID/,
  );
  assert.throws(
    () =>
      publishedConfiguration(
        { ...env, NINJA_PUBLISHED_KEY_SHA256: "0".repeat(64) },
        pem,
      ),
    /SHA256/,
  );
  assert.throws(
    () =>
      publishedConfiguration(
        {
          ...env,
          NINJA_PUBLISHED_CATALOG_URL:
            "https://user:password@daedlo.com/updates/preview.json",
        },
        pem,
      ),
    /HTTPS/,
  );
  assert.equal(publishedConfiguration({}, undefined), null);
  assert.equal(
    publishedConfiguration(env, pem).trustedKeys[0].id,
    env.NINJA_PUBLISHED_KEY_ID,
  );
  assert.throws(
    () =>
      publishedConfiguration(
        { NINJA_PUBLISHED_KEY_ID: env.NINJA_PUBLISHED_KEY_ID },
        pem,
      ),
    /HTTPS/,
  );
  const ec = Buffer.from(
    generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({
      type: "spki",
      format: "pem",
    }),
  );
  assert.throws(
    () =>
      publishedConfiguration(
        { ...env, NINJA_PUBLISHED_KEY_SHA256: hash(ec) },
        ec,
      ),
    /Ed25519/,
  );
  console.log("PASS 8 published transport/trust configuration assertions");
  process.exit(0);
}
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const toolsRoot = resolve(
  process.env.NINJA_TOOLS_ROOT ?? join(repo, "scripts/release"),
);
const loadTool = (file) => import(pathToFileURL(join(toolsRoot, file)));
const [
  { createNinjaManager },
  { createNinjaSupervisor },
  { createNinjaServer },
  { prepareInstallation, verifyInstallation, snapshotProject },
  { createNinjaProvider, NINJA_CONTRACTS },
  { ninjaCatalogSigningBytes, fetchNinjaCatalog },
] = await Promise.all([
  loadTool("ninja-manager.mjs"),
  loadTool("ninja-supervisor.mjs"),
  loadTool("ninja-server.mjs"),
  loadTool("ninja-installation.mjs"),
  loadTool("ninja.mjs"),
  loadTool("ninja-catalog.mjs"),
]);
const publicKit = resolve(
  process.env.NINJA_ACCEPTED_KIT ??
    join(repo, "artifacts/alpha-20261021/alpha.2/public-release"),
);
const publishedInput = publishedConfiguration(process.env);
const published = publishedInput
  ? publishedConfiguration(
      process.env,
      await readFile(publishedInput.publicKeyFile),
    )
  : null;
if (process.argv.includes("--published-preflight")) {
  assert.ok(published, "Published mode configuration is required");
  console.log(
    JSON.stringify(
      {
        status: "PASS",
        mode: "published",
        catalogUrl: published.url,
        keyId: published.trustedKeys[0].id,
        pemSha256: published.pemSha256,
        spkiSha256: published.spkiSha256,
        network: "NOT RUN",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
const candidateKit = resolve(
  process.env.NINJA_CANDIDATE_DIR ??
    process.env.NINJA_CANDIDATE_KIT ??
    join(repo, "artifacts/ninja-update/candidate-initial/public-kit"),
);
const acceptedSource = resolve(
  process.env.NINJA_ACCEPTED_SOURCE ??
    join(
      repo,
      "artifacts/alpha-20261021/customer/alpha.2/accepted-integration-source",
    ),
);
if (!process.env.NINJA_APP_CHECKOUT)
  throw Error(
    "Set NINJA_APP_CHECKOUT to the approved Architecture Studio source checkout.",
  );
const appCheckout = resolve(process.env.NINJA_APP_CHECKOUT);
const evidenceRoot = resolve(
  process.env.NINJA_CUSTOMER_OUTPUT ??
    join(repo, "artifacts/ninja-update/customer"),
);
await mkdir(evidenceRoot, { recursive: true });
const output = await mkdtemp(join(evidenceRoot, "run-"));
const work = await realpath(
  await mkdtemp(join(await realpath(tmpdir()), "ninja-architecture-")),
);
const results = {
  status: "RUNNING",
  startedAt: new Date().toISOString(),
  work,
  output,
  toolsRoot,
  ...(published
    ? {
        catalogUrl: published.url,
        publisherKey: {
          id: published.trustedKeys[0].id,
          pemSha256: published.pemSha256,
          spkiSha256: published.spkiSha256,
        },
      }
    : { candidateKit }),
  mode: published ? "published" : "local-catalog",
  checks: [],
  limits: [
    "Existing macOS arm64 Node/Rust/browser toolchains and Cargo cache",
    published
      ? "Actual production HTTPS catalog and assets; local pinned Ed25519 public key, no injected fetch transport"
      : "Local ephemeral signed catalog with exact frozen ZIP bytes; no production feed/signing claim",
    "Pinned Architecture Studio synthetic fixture; no WBF or everyday application access",
    published
      ? "Published release acceptance uses synthetic data; no WBF or clean-OS acceptance claim"
      : "Candidate is unpublished; manager implementation is identified by toolsRoot and its file inventory",
  ],
};
await writeJson(join(output, "result.json"), results);
let app, manager, supervisor, server, browser, page, viewerPage;
async function record(name, details = {}) {
  results.checks.push({ name, status: "PASS", ...details });
  await writeJson(join(output, "result.json"), results);
  console.log("PASS " + name);
}
async function commandRun(program, args, cwd, log) {
  const result = await exec(program, args, {
    cwd,
    maxBuffer: 20 * 1024 * 1024,
    env: process.env,
  }).catch(async (error) => {
    await writeFile(
      join(output, log),
      String(error.stdout ?? "") + String(error.stderr ?? ""),
    );
    throw error;
  });
  await writeFile(join(output, log), result.stdout + result.stderr);
  return result.stdout;
}
async function fileList(root, prefix = "") {
  const found = [];
  for (const entry of await readdir(join(root, prefix), {
    withFileTypes: true,
  })) {
    const path = prefix ? prefix + "/" + entry.name : entry.name;
    if (entry.isDirectory()) found.push(...(await fileList(root, path)));
    else {
      assert.equal(entry.isFile(), true);
      found.push(path);
    }
  }
  return found.sort();
}
async function originalFiles(root) {
  return Object.fromEntries(
    await Promise.all(
      (await fileList(root)).map(async (name) => [
        name,
        hash(await readFile(join(root, name))),
      ]),
    ),
  );
}
async function uiAction(action, { fail = false } = {}) {
  // A model run may have changed the manager's blockers since the last poll.
  // Observe the next eligible status before clicking; never replay an action.
  const fresh = await page.waitForResponse(
    async (response) =>
      response.url().endsWith("/status") &&
      response.request().method() === "GET" &&
      response.status() === 200 &&
      (await response
        .json()
        .then(
          (value) =>
            value.actions?.[action] === true &&
            value.status.blockers.length === 0,
        )),
  );
  await fresh.finished();
  const observedControl = await fresh.json();
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)));
  if (["restart", "revert"].includes(action))
    await page.locator("#acknowledge").check();
  await page.locator(`#${action}:not(:disabled)`).waitFor({ timeout: 10000 });
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/action") &&
      response.request().method() === "POST",
    { timeout: 240000 },
  );
  await page.locator("#" + action).click();
  const response = await responsePromise,
    value = await response.json();
  (results.controlActions ??= []).push({
    action,
    observed: observedControl,
    response: value,
    httpStatus: response.status(),
  });
  await writeJson(join(output, "result.json"), results);
  assert.equal(value.ok, !fail, JSON.stringify(value));
  assert.equal(response.status(), fail ? 409 : 200);
  return value;
}
async function selectedReceipt() {
  const state = await readJson(join(work, "manager/state.json"));
  return readJson(
    join(work, "manager/installations", state.current, "installation.json"),
  );
}
async function openViewer(version) {
  const live = await supervisor.status();
  assert.equal(live.running.version, version);
  assert.ok(live.running.viewerUrl);
  await viewerPage.goto(live.running.viewerUrl);
  await viewerPage.locator('[data-command="open_editor"]').waitFor();
  await viewerPage.locator("#speed").selectOption("fast");
  const base = new URL(live.running.viewerUrl).origin;
  await waitFor(
    "Viewer speed",
    async () => (await getJson(base + "/status")).driver.speed === "fast",
  );
  const observe = async () => (await getJson(base + "/status")).driver;
  const command = async (id, params = {}, outcome = "success") => {
    if (Object.hasOwn(params, "value")) {
      const field = viewerPage.locator(`#parameter-${id}-value`);
      if (params.value === "") await field.fill("explicit clear");
      await field.fill(params.value);
    }
    const pending = viewerPage.waitForResponse(
      (r) =>
        r.url() === base + "/command" && r.request().postDataJSON()?.id === id,
      { timeout: 45000 },
    );
    await viewerPage.locator(`[data-command="${id}"]`).click();
    const response = await pending,
      value = await response.json();
    assert.equal(response.status(), 200, JSON.stringify(value));
    assert.equal(value.ok, true);
    assert.equal(value.execution, "completed");
    assert.equal(value.outcome?.kind, outcome);
    return value;
  };
  return { observe, command, url: live.running.viewerUrl };
}

async function publishedProvider(config) {
  const verified = await fetchNinjaCatalog({
    url: config.url,
    publisher: config.publisher,
    trustedKeys: config.trustedKeys,
    previousState: null,
    now: Date.now(),
  });
  const entries = ["0.1.4-alpha.2", "0.1.4-alpha.3"].map((version) => {
    const entry = verified.catalog.releases.find(
      (release) => release.version === version,
    );
    assert.ok(entry, `Published catalog must contain ${version}`);
    assert.equal(entry.channel, "preview");
    assert.deepEqual(entry.contracts, NINJA_CONTRACTS);
    assert.ok(
      entry.platforms.some(
        (platform) =>
          platform.os === process.platform && platform.arch === process.arch,
      ),
    );
    return entry;
  });
  // The established baseline is downloaded over HTTPS too; its bytes must equal
  // the retained immutable public kit before the real installer can use them.
  const baselineMetadata = await readJson(join(publicKit, "release.json"));
  assert.equal(
    entries[0].kit.sha256,
    hash(await readFile(join(publicKit, baselineMetadata.archive.file))),
  );
  await writeJson(join(output, "published-catalog.json"), {
    url: config.url,
    publisher: config.publisher,
    keyId: config.trustedKeys[0].id,
    pemSha256: config.pemSha256,
    spkiSha256: config.spkiSha256,
    checkpoint: verified.checkpoint,
    catalog: verified.catalog,
    transport: "Default real HTTPS fetch; no response or fetch injection",
    baselinePolicy:
      "Pin authenticated alpha.2 only for initial test setup; normal provider selection follows",
  });
  await cp(config.publicKeyFile, join(output, "publisher-public-key.pem"));
  const actual = createNinjaProvider(config);
  let baselineOnly = true;
  const transport = [];
  const saveTransport = () =>
    writeJson(join(output, "published-transport.json"), transport);
  return {
    offerCandidate() {
      baselineOnly = false;
    },
    provider: {
      async check(context) {
        const result = await actual.check(context);
        assert.deepEqual(
          result.checkpoint,
          verified.checkpoint,
          "Production catalog changed during the acceptance run",
        );
        assert.equal(
          result.available?.version,
          entries[1].version,
          "Normal production discovery must offer the expected alpha.3 release",
        );
        transport.push({
          kind: "catalog",
          at: new Date().toISOString(),
          url: config.url,
          checkpoint: result.checkpoint,
          normallySelected: result.available.version,
          baselinePinApplied: baselineOnly,
        });
        await saveTransport();
        return baselineOnly
          ? { ...result, available: { ...entries[0], id: entries[0].version } }
          : result;
      },
      async download(release, destination) {
        const entry = entries.find(
          (value) => value.version === release.version,
        );
        assert.ok(
          entry,
          "Only the two authenticated acceptance releases may install",
        );
        const downloaded = await actual.download(release, destination);
        const archive = await readFile(
          join(destination, `daedlo-${entry.version}.zip`),
        );
        assert.equal(hash(archive), entry.kit.sha256);
        assert.equal(archive.length, entry.kit.bytes);
        transport.push({
          kind: "download",
          at: new Date().toISOString(),
          version: entry.version,
          kit: entry.kit,
          metadata: entry.metadata,
          checksums: entry.checksums,
          verifiedIdentity: downloaded.identity,
        });
        await saveTransport();
        return downloaded;
      },
    },
  };
}

try {
  assert.equal(process.platform, "darwin");
  assert.equal(process.arch, "arm64");
  const production = published ? await publishedProvider(published) : null;
  const toolsBefore = await originalFiles(toolsRoot);
  await writeJson(join(output, "tools-before.json"), toolsBefore);
  const sourceBefore = await originalFiles(acceptedSource);
  const appStatusBefore = await exec(
    "git",
    ["status", "--porcelain=v1", "-z"],
    { cwd: appCheckout },
  ).then((r) => r.stdout);
  const fixture = join(work, "fixture");
  await mkdir(fixture);
  await commandRun(
    "python3",
    [join(acceptedSource, "prepare-fixture.py"), appCheckout, fixture],
    repo,
    "prepare-app.log",
  );
  const appRoot = join(fixture, "app"),
    npmCache = join(work, "npm-cache");
  await commandRun(
    "npm",
    ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--cache", npmCache],
    appRoot,
    "application-install.log",
  );
  await commandRun("npm", ["run", "build"], appRoot, "application-build.log");
  const seed = await readJson(join(fixture, "data/workspace.json"));
  const sourceRoot = join(work, "registered-source");
  await cp(acceptedSource, sourceRoot, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  const additions = join(repo, "tests/fixtures/ninja-architecture");
  for (const file of (await fileList(additions)).filter((name) =>
    name.endsWith(".mjs"),
  ))
    await cp(join(additions, file), join(sourceRoot, file), {
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
    projectId: "ninja-architecture",
    label: "Architecture Studio · isolated upgrade",
    sourceRoot,
    files: await fileList(sourceRoot),
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
  await writeJson(join(output, "registration.json"), registration);
  await writeJson(join(output, "source-before.json"), baseline);
  await record(
    "Fresh pinned application and unchanged accepted integration prepared",
    {
      applicationFiles: (
        await readJson(join(fixture, "evidence/application-source.json"))
      ).files.length,
      preservedIntegrationFiles: Object.keys(sourceBefore).length,
      registeredFiles: registration.files.length,
    },
  );

  let provider = production?.provider,
    offerCandidate = production?.offerCandidate;
  if (!published) {
    const origin = "https://ninja-customer.test",
      { privateKey, publicKey } = generateKeyPairSync("ed25519"),
      keyId = "local-acceptance-key",
      assets = new Map(),
      entries = [];
    for (const directory of [publicKit, candidateKit]) {
      const metadata = await readJson(join(directory, "release.json")),
        version = metadata.version;
      const asset = async (file) => {
        const bytes = await readFile(join(directory, file)),
          url = `${origin}/downloads/${version}/${file}`;
        assets.set(url, bytes);
        return { url, bytes: bytes.length, sha256: hash(bytes) };
      };
      entries.push({
        version,
        channel: "preview",
        platforms: [{ os: process.platform, arch: process.arch }],
        contracts: structuredClone(NINJA_CONTRACTS),
        notesUrl: origin + "/notes/" + version,
        kit: await asset(metadata.archive.file),
        metadata: await asset("release.json"),
        checksums: await asset("SHA256SUMS"),
      });
    }
    assert.equal(entries[0].version, "0.1.4-alpha.2");
    assert.equal(entries[1].version, "0.1.4-alpha.3");
    let generation = 1,
      offered = [entries[0]],
      feed;
    function publishTestFeed() {
      const now = Date.now();
      const signed = {
        schemaVersion: 1,
        kind: "daedlo-public-kit-catalog",
        publisher: "daedlo",
        generation,
        issuedAt: new Date(now - 10000).toISOString(),
        expiresAt: new Date(now + 86400000).toISOString(),
        releases: offered,
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
              ninjaCatalogSigningBytes(signed),
              privateKey,
            ).toString("base64"),
          },
        }),
      );
    }
    publishTestFeed();
    provider = createNinjaProvider(
      {
        url: origin + "/catalog.json",
        publisher: "daedlo",
        trustedKeys: [{ id: keyId, publicKey }],
        channel: "preview",
      },
      {
        fetchImpl: async (url) => {
          const bytes =
            url === origin + "/catalog.json" ? feed : assets.get(url);
          assert.ok(bytes, url);
          return new Response(bytes, {
            status: 200,
            headers: { "Content-Length": String(bytes.length) },
          });
        },
      },
    );
    offerCandidate = () => {
      generation++;
      offered = entries;
      publishTestFeed();
    };
  }
  app = await startFixture({
    appRoot,
    seed,
    output: join(work, "active-application"),
  });
  const settings = {
    origin: app.origin,
    appRoot: app.appRoot,
    dataPath: app.dataPath,
    evidencePath: app.evidencePath,
  };
  supervisor = await createNinjaSupervisor({
    root: join(work, "supervisor"),
    settings,
  });
  manager = await createNinjaManager({
    root: join(work, "manager"),
    registration,
    provider,
    installer: {
      prepare: (args) =>
        prepareInstallation({ ...args, npmCache, offline: false }),
      verify: verifyInstallation,
    },
    supervisor,
  });
  server = await createNinjaServer({ manager });
  const load = createRequire(import.meta.url),
    { chromium } = load("playwright");
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  viewerPage = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  await page.goto(server.url);
  await page.locator("#check:not(:disabled)").waitFor();
  await uiAction("check");
  await uiAction("install");
  assert.deepEqual(await storage(app), seed);
  await uiAction("restart");
  const initial = await selectedReceipt();
  const initialViewer = await openViewer(initial.version);
  const firstFlow = await assertAcceptedFlow({
    ...initialViewer,
    settings: app,
    label: "accepted alpha.2",
  });
  await writeJson(join(output, "accepted-flow.json"), firstFlow);
  await record(
    "Exact public alpha.2 installation selected and accepted flow passes",
    {
      installationId: initial.id,
      version: initial.version,
      enginePath: initial.enginePath,
      descriptorSha256: initial.handshake.descriptorSha256,
    },
  );

  offerCandidate();
  await uiAction("check");
  await writeJson(acceptanceGateFile, { rejectVersion: "0.1.4-alpha.3" });
  const beforeFailure = await storage(app),
    failResult = await uiAction("install", { fail: true });
  assert.equal(failResult.status.selected.id, initial.id);
  assert.equal((await supervisor.status()).running.id, initial.id);
  assert.deepEqual(await storage(app), beforeFailure);
  assert.deepEqual(await snapshotProject(registration), baseline);
  const rejectedChecks = join(
    work,
    "manager/installations",
    failResult.status.operation.id,
    "checks",
  );
  const rejectedAcceptance = (await readdir(rejectedChecks)).find((name) =>
    name.startsWith("acceptance-"),
  );
  assert.ok(rejectedAcceptance);
  assert.match(
    await readFile(
      join(rejectedChecks, rejectedAcceptance, "hook.log"),
      "utf8",
    ),
    /Controlled registered acceptance rejection after real browser checks/,
  );
  const rejectedFlow = await readJson(
    join(rejectedChecks, rejectedAcceptance, "flow.json"),
  );
  assert.equal(rejectedFlow.write.workspacePutRequests, 1);
  assert.equal(rejectedFlow.saved.effect.status, "saved");
  await writeJson(join(output, "rejected-acceptance.json"), failResult);
  await record(
    "Controlled registered acceptance rejection retains accepted runtime and application data",
    {
      fault:
        "Hook rejects candidate version after its real isolated browser checks; no product failure claim",
    },
  );
  await writeJson(acceptanceGateFile, { rejectVersion: null });
  await uiAction("check");
  await uiAction("install");
  const ready = await manager.status(),
    candidate = await readJson(
      join(
        work,
        "manager/installations",
        ready.operation.id,
        "installation.json",
      ),
    );
  assert.deepEqual(
    candidate.handshake.descriptor,
    initial.handshake.descriptor,
  );
  assert.deepEqual(await storage(app), beforeFailure);
  await uiAction("restart");
  assert.deepEqual(await storage(app), beforeFailure);
  const candidateViewer = await openViewer(candidate.version),
    nextFlow = await assertAcceptedFlow({
      ...candidateViewer,
      settings: app,
      label: "candidate alpha.3",
    });
  await writeJson(join(output, "candidate-flow.json"), nextFlow);
  await record(
    "Upgrade preserves exact data and descriptor, then repeats the real accepted flow",
    { version: candidate.version, installationId: candidate.id },
  );
  await waitFor(
    "Rendered drained control state",
    async () => (await page.locator("#blockers li").count()) === 0,
  );
  await page.screenshot({
    path: join(output, "update-control.png"),
    fullPage: true,
  });
  await viewerPage.screenshot({
    path: join(output, "candidate-viewer.png"),
    fullPage: true,
  });
  if (process.env.NINJA_WAIT_FOR_INSPECTION === "1") {
    results.status = "AWAITING_VISIBLE_INSPECTION";
    results.controlUrl = new URL(server.url).origin;
    results.viewerUrl = candidateViewer.url;
    await writeJson(join(output, "result.json"), results);
    console.log(
      `NINJA_VISIBLE ${JSON.stringify({ controlUrl: server.url, viewerUrl: candidateViewer.url, receipt: join(output, "visible-inspection.json") })}`,
    );
    await waitFor(
      "Visible root inspection",
      async () => {
        try {
          return (
            (await readJson(join(output, "visible-inspection.json"))).status ===
            "PASS"
          );
        } catch (error) {
          if (error.code === "ENOENT") return false;
          throw error;
        }
      },
      1800000,
    );
  }
  const beforeRollback = await storage(app);
  await uiAction("revert");
  assert.deepEqual(await storage(app), beforeRollback);
  const rolled = await manager.status();
  assert.equal(rolled.selected.id, initial.id);
  assert.equal(rolled.selected.historicalSnapshot, true);
  const rollbackViewer = await openViewer(initial.version),
    rollbackFlow = await assertAcceptedFlow({
      ...rollbackViewer,
      settings: app,
      label: "rollback alpha.2",
    });
  await writeJson(join(output, "rollback-flow.json"), rollbackFlow);
  await record(
    "Rollback preserves data, selects the complete previous installation and repeats the flow",
  );
  await waitFor(
    "Reverted control state",
    async () =>
      (await page.locator("#phase-title").textContent()) ===
      "Previous installation selected",
  );
  await waitFor(
    "Rendered drained reverted state",
    async () => (await page.locator("#blockers li").count()) === 0,
  );
  await page.screenshot({
    path: join(output, "reverted-control.png"),
    fullPage: true,
  });
  await viewerPage.screenshot({
    path: join(output, "reverted-viewer.png"),
    fullPage: true,
  });
  if (process.env.NINJA_WAIT_FOR_INSPECTION === "1") {
    results.status = "AWAITING_REVERTED_INSPECTION";
    results.viewerUrl = rollbackViewer.url;
    await writeJson(join(output, "result.json"), results);
    console.log(
      `NINJA_REVERTED ${JSON.stringify({
        controlUrl: server.url,
        viewerUrl: rollbackViewer.url,
        receipt: join(output, "reverted-inspection.json"),
      })}`,
    );
    await waitFor(
      "Visible reverted inspection",
      async () => {
        try {
          return (
            (await readJson(join(output, "reverted-inspection.json")))
              .status === "PASS"
          );
        } catch (error) {
          if (error.code === "ENOENT") return false;
          throw error;
        }
      },
      1800000,
    );
  }
  await manager.close();
  assert.equal((await supervisor.status()).running, null);
  await storage(app);
  await manager.start();
  assert.deepEqual(await storage(app), rollbackFlow.persisted);
  await manager.close();
  assert.equal((await supervisor.status()).running, null);
  await storage(app);
  const reports = await readdir(join(work, "manager/reports"));
  assert.equal(reports.length, 4);
  for (const file of reports) {
    const report = await readJson(join(work, "manager/reports", file));
    assert.equal(report.format, "browser-driver-report/1");
    assert.equal(report.identity.model.id, registration.model.id);
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
  await record(
    "Reports persist, owned driver closes and relaunches, attached application survives",
    { reports: reports.length },
  );
  assert.deepEqual(await snapshotProject(registration), baseline);
  assert.deepEqual(await originalFiles(acceptedSource), sourceBefore);
  assert.equal(
    await exec("git", ["status", "--porcelain=v1", "-z"], {
      cwd: appCheckout,
    }).then((r) => r.stdout),
    appStatusBefore,
  );
  await verifyInstallation(initial.path, { registration });
  await verifyInstallation(candidate.path, { registration });
  const inventory = await readJson(
    join(fixture, "evidence/application-source.json"),
  );
  for (const entry of inventory.files)
    assert.equal(hash(await readFile(join(appRoot, entry.file))), entry.sha256);
  await writeJson(
    join(output, "source-after.json"),
    await snapshotProject(registration),
  );
  await record(
    "Registered files, accepted source, pinned app and installed bytes remain unchanged",
  );
  const toolsAfter = await originalFiles(toolsRoot);
  await writeJson(join(output, "tools-after.json"), toolsAfter);
  if (process.env.NINJA_TOOLS_ROOT) {
    assert.deepEqual(toolsAfter, toolsBefore);
    await record(
      "Exact installed stable tools remain unchanged throughout acceptance",
    );
  }
  await server.close();
  server = null;
  await browser.close();
  browser = null;
  await app.close();
  app = null;
  await cp(sourceRoot, join(output, "registered-source"), { recursive: true });
  await cp(join(work, "manager/reports"), join(output, "reports"), {
    recursive: true,
  });
  await cp(join(work, "manager/history"), join(output, "history"), {
    recursive: true,
  });
  await cp(
    join(work, "active-application"),
    join(output, "application-evidence"),
    { recursive: true },
  );
  await cp(join(fixture, "evidence"), join(output, "application-source"), {
    recursive: true,
  });
  results.status = "PASS";
  results.completedAt = new Date().toISOString();
  results.cleanup =
    "Owned manager children, browsers, viewer/control server and application closed; isolated installations retained for evidence";
} catch (error) {
  results.status = "FAIL";
  results.error = { message: error.message, stack: error.stack };
  console.error(error);
  try {
    await manager?.close();
  } catch (cleanup) {
    results.cleanupError = cleanup.message;
  }
  await server?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await app?.close().catch(() => {});
  process.exitCode = 1;
} finally {
  // Preserve every meaningful success/failure receipt before temporary directories can disappear.
  for (const name of ["registered-source", "active-application", "supervisor"])
    await cp(join(work, name), join(output, name), { recursive: true }).catch(
      (error) => {
        if (error.code !== "ENOENT") results.evidenceCopyError = error.message;
      },
    );
  for (const name of ["reports", "history", "state.json", "transaction.json"])
    await cp(join(work, "manager", name), join(output, "manager", name), {
      recursive: true,
    }).catch((error) => {
      if (error.code !== "ENOENT") results.evidenceCopyError = error.message;
    });
  for (const slot of await readdir(join(work, "manager/installations")).catch(
    () => [],
  )) {
    for (const name of [
      "logs",
      "checks",
      "installation.json",
      "registration.json",
      ".ninja-installation.json",
    ])
      await cp(
        join(work, "manager/installations", slot, name),
        join(output, "installations", slot, name),
        { recursive: true },
      ).catch((error) => {
        if (error.code !== "ENOENT") results.evidenceCopyError = error.message;
      });
  }
  await writeJson(join(output, "result.json"), results);
  console.log("CUSTOMER_RECEIPT " + join(output, "result.json"));
}
