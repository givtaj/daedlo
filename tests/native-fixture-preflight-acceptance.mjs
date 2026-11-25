// Opt-in, real native CLI acceptance. Set DAEDLO_PREFLIGHT_KIT to a directory
// containing the verified release ZIP, release.json and SHA256SUMS, plus
// DAEDLO_PREFLIGHT_NPM_CACHE and DAEDLO_PREFLIGHT_BROWSER_CACHE to populated
// local caches. Set DAEDLO_PREFLIGHT_OUTPUT to a fresh evidence directory.
// DAEDLO_PREFLIGHT_NATIVE optionally selects an installed candidate lib/native.mjs.
// Requires Node, npm, Rust/Cargo, tar and OpenSSL. No production feed is contacted.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createStarterFixture } from "../examples/starter/fixture.mjs";
import { prepareManagedStarter } from "../examples/managed-starter/prepare.mjs";
import { ninjaCatalogSigningBytes } from "../scripts/release/ninja-catalog.mjs";
import { sha256 } from "../scripts/release/manifest.mjs";
import { NINJA_CONTRACTS } from "../scripts/release/ninja.mjs";
import { verifyFixtureRollback } from "./native-fixture-preflight-rollback.mjs";

const execute = promisify(execFile);
const phases = ["acceptance", "health", "live"];
const native = resolve(
  process.env.DAEDLO_PREFLIGHT_NATIVE ??
    fileURLToPath(new URL("../scripts/release/native.mjs", import.meta.url)),
);
const fixtureSources = fileURLToPath(
  new URL("./fixtures/native-fixture-preflight", import.meta.url),
);
const privateMarker = "synthetic-private-phase-metadata";
const readJson = async (path) => JSON.parse(await fs.readFile(path));
const writeJson = (path, value) =>
  fs.writeFile(path, JSON.stringify(value) + "\n", { mode: 0o600 });
const required = (name) => {
  assert.ok(process.env[name], "Set " + name);
  return resolve(process.env[name]);
};
const startServer = async (server) => {
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  return server.address().port;
};
const closeServer = (server) =>
  new Promise((done, reject) => {
    server.close((error) => (error ? reject(error) : done()));
    server.closeAllConnections();
  });

async function localCatalog(root, kitDirectory, metadata) {
  const tlsKey = join(root, "loopback.key"),
    certificate = join(root, "loopback.pem");
  await execute("openssl", [
    "req",
    "-x509",
    "-nodes",
    "-newkey",
    "rsa:2048",
    "-days",
    "2",
    "-subj",
    "/CN=127.0.0.1",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
    "-keyout",
    tlsKey,
    "-out",
    certificate,
  ]);
  const signing = generateKeyPairSync("ed25519");
  const trustFile = join(root, "fixture-publisher.pem");
  await fs.writeFile(
    trustFile,
    signing.publicKey.export({ type: "spki", format: "pem" }),
  );
  const assets = new Map();
  for (const name of [metadata.archive.file, "release.json", "SHA256SUMS"])
    assets.set("/files/" + name, await fs.readFile(join(kitDirectory, name)));
  const downloaded = new Set();
  const server = https.createServer(
    {
      key: await fs.readFile(tlsKey),
      cert: await fs.readFile(certificate),
    },
    (request, response) => {
      const bytes = assets.get(request.url);
      if (!bytes) {
        response.writeHead(404).end();
        return;
      }
      downloaded.add(request.url);
      response.writeHead(200, { "content-length": bytes.length });
      response.end(bytes);
    },
  );
  const port = await startServer(server);
  const origin = `https://127.0.0.1:${port}`;
  const asset = (name) => {
    const path = "/files/" + name;
    const contents = assets.get(path);
    return {
      url: origin + path,
      bytes: contents.length,
      sha256: sha256(contents),
    };
  };
  const signed = {
    schemaVersion: 1,
    kind: "daedlo-public-kit-catalog",
    publisher: "fixture-publisher",
    generation: 1,
    issuedAt: new Date(Date.now() - 60000).toISOString(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    releases: [
      {
        version: metadata.version,
        channel: "preview",
        platforms: [{ os: process.platform, arch: process.arch }],
        contracts: NINJA_CONTRACTS,
        notesUrl: origin + "/notes",
        kit: asset(metadata.archive.file),
        metadata: asset("release.json"),
        checksums: asset("SHA256SUMS"),
      },
    ],
  };
  assets.set(
    "/catalog.json",
    Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        kind: "daedlo-signed-catalog",
        signed,
        signature: {
          keyId: "fixture-publisher",
          value: sign(
            null,
            ninjaCatalogSigningBytes(signed),
            signing.privateKey,
          ).toString("base64"),
        },
      }),
    ),
  );
  return {
    certificate,
    trustFile,
    url: origin + "/catalog.json",
    downloaded,
    close: () => closeServer(server),
  };
}

async function createCase(phase, variant = "case") {
  const fixture = await createStarterFixture();
  const caseId = `fixture-${phase}-${variant}`;
  const revision = `fixture-${phase}-revision`;
  let posts = 0,
    lookups = 0;
  const server = http.createServer(async (request, response) => {
    try {
      if (request.url === "/fixture-case" && request.method === "GET") {
        lookups++;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            caseId,
            phase,
            revision,
            ready: true,
            historyEntries: fixture.writes,
          }),
        );
        return;
      }
      const writing = request.method === "POST" && request.url === "/api/notes";
      if (writing) posts++;
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const upstream = await fetch(fixture.url + request.url, {
        method: request.method,
        ...(writing
          ? {
              body: Buffer.concat(chunks),
              headers: { "content-type": "application/json" },
            }
          : {}),
      });
      response.writeHead(upstream.status, {
        "content-type": upstream.headers.get("content-type"),
        "cache-control": "no-store",
      });
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      response.destroy();
    }
  });
  let port;
  try {
    port = await startServer(server);
  } catch (error) {
    await fixture.close();
    throw error;
  }
  return {
    caseId,
    revision,
    origin: `http://127.0.0.1:${port}`,
    count: () => ({ posts, commits: fixture.writes, lookups }),
    close: async () => {
      try {
        await closeServer(server);
      } finally {
        await fixture.close();
      }
    },
  };
}

function nativeCli(config, environment) {
  function run(command, args) {
    let stdout = "",
      stderr = "";
    const child = spawn(
      process.execPath,
      [native, command, "--config", config, ...args],
      {
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const ready = Promise.withResolvers();
    const closed = Promise.withResolvers();
    let ownerReady;
    child.stdout.on("data", (bytes) => {
      stdout += bytes;
      if (!["start", "restart"].includes(command) || ownerReady) return;
      const final = stdout.replace(/^\{[^\n]+\}\n(?=\{)/, "");
      try {
        const result = JSON.parse(final);
        if (result.event || !result.status) return;
        ownerReady = true;
        ready.resolve(result);
      } catch {}
    });
    child.stderr.on("data", (bytes) => {
      stderr += bytes;
    });
    const timer = setTimeout(() => child.kill("SIGINT"), 180000).unref();
    child.once("error", (error) => closed.reject(error));
    child.once("close", (status, signal) => {
      clearTimeout(timer);
      closed.resolve({ status, signal, stdout, stderr });
    });
    return { child, ready: ready.promise, closed: closed.promise };
  }
  const assertPrivate = (raw) => {
    assert.ok(
      !raw.includes(privateMarker),
      "Native command leaked private phase data",
    );
  };
  return {
    async call(command, ...args) {
      const result = await run(command, args).closed;
      assertPrivate(result.stdout + result.stderr);
      return result;
    },
    async ok(command, expected, ...args) {
      const result = await this.call(command, ...args);
      const reply = JSON.parse(
        result.status === 0 ? result.stdout : result.stderr,
      );
      assert.deepEqual(
        { exit: result.status, receipt: reply.status ?? reply.code },
        { exit: 0, receipt: expected },
        `Native ${command} must complete with the expected result`,
      );
      return reply;
    },
    async refused(command, ...args) {
      const result = await this.call(command, ...args);
      assert.equal(result.status, 1, `Native ${command} must fail closed`);
      return JSON.parse(result.stderr);
    },
    start(command = "start") {
      const owner = run(command, []);
      return {
        ...owner,
        ready: Promise.race([
          owner.ready,
          owner.closed.then(({ stderr }) => {
            const line = stderr.trim().split("\n").at(-1);
            throw Error(
              "Native start exited before ready: " + (line || "no diagnostic"),
            );
          }),
        ]),
      };
    },
  };
}

const output = required("DAEDLO_PREFLIGHT_OUTPUT");
const kit = required("DAEDLO_PREFLIGHT_KIT");
const npmCache = required("DAEDLO_PREFLIGHT_NPM_CACHE");
const browserCache = required("DAEDLO_PREFLIGHT_BROWSER_CACHE");
const metadata = await readJson(join(kit, "release.json"));
process.umask(0o077);
await fs.mkdir(output, { mode: 0o700 });
const root = await fs.realpath(
  await fs.mkdtemp(join(tmpdir(), "native-fixture-preflight-")),
);
const owned = [];
const checks = [];
let owner, cli, inspector;
let failed = true;

try {
  const catalog = await localCatalog(root, kit, metadata);
  owned.push(catalog);
  const cases = {};
  for (const phase of phases) {
    cases[phase] = await createCase(phase);
    owned.push(cases[phase]);
  }
  const caseCounts = (selected = cases) =>
    Object.fromEntries(phases.map((phase) => [phase, selected[phase].count()]));
  const version = metadata.version;
  const crateArchive = join(root, metadata.bundle.artifacts.engine.file);
  const { stdout: crateBytes } = await execute(
    "unzip",
    [
      "-p",
      join(kit, metadata.archive.file),
      `daedlo-${version}/${metadata.bundle.manifest.replace("manifest.json", metadata.bundle.artifacts.engine.file)}`,
    ],
    { encoding: "buffer" },
  );
  assert.equal(sha256(crateBytes), metadata.bundle.artifacts.engine.sha256);
  await fs.writeFile(crateArchive, crateBytes);
  await execute("tar", ["-xf", crateArchive, "-C", root]);
  const crate = join(
    root,
    metadata.bundle.artifacts.engine.name + "-" + version,
  );
  const prepared = await prepareManagedStarter({
    output: join(root, "integration"),
    crate,
    origin: cases.live.origin,
    trustFile: catalog.trustFile,
    catalogUrl: catalog.url,
    publisher: "fixture-publisher",
    keyId: "fixture-publisher",
    projectId: "fixture-preflight-test",
    frontendName: "Fixture preflight test",
  });
  const { configPath, config, sourceRoot, privateCatalogFile } = prepared;
  const oldHook = config.registration.hooks.acceptance;
  await fs.unlink(join(sourceRoot, oldHook));
  config.registration.files = config.registration.files.filter(
    (file) => file !== oldHook,
  );
  const projectFixtures = "fixture-preflight";
  await fs.cp(fixtureSources, join(sourceRoot, projectFixtures), {
    recursive: true,
  });
  for (const name of await fs.readdir(fixtureSources))
    config.registration.files.push(projectFixtures + "/" + name);
  config.registration.files.sort();
  config.registration.launcher = projectFixtures + "/launch.mjs";
  config.registration.hooks = {
    preflight: projectFixtures + "/prepare.mjs",
    acceptance: projectFixtures + "/install.mjs",
    health: projectFixtures + "/install.mjs",
  };
  config.installation = {
    offline: true,
    npmCache,
    playwrightBrowsersPath: browserCache,
  };
  const input = join(root, "fixture-source.json");
  const directory = join(root, "prepared-fixtures");
  const generation = randomUUID();
  config.fixturePreflight = { input, directory, generation };
  const fixtureInputs = Object.fromEntries(
    phases.map((phase) => [
      phase,
      {
        origin: cases[phase].origin,
        caseId: cases[phase].caseId,
        expectedRevision: cases[phase].revision,
        note: `Synthetic ${phase} note`,
        privateTag: privateMarker + "-" + phase,
        privateCatalogFile,
      },
    ]),
  );
  await writeJson(configPath, config);
  await writeJson(input, fixtureInputs);
  cli = nativeCli(configPath, {
    ...process.env,
    NODE_EXTRA_CA_CERTS: catalog.certificate,
  });
  const originalCases = {};
  const originalRequest = structuredClone(fixtureInputs);
  for (const phase of phases) {
    const original = await createCase(phase, "original");
    owned.push(original);
    originalCases[phase] = original;
    Object.assign(originalRequest[phase], {
      origin: original.origin,
      caseId: original.caseId,
      expectedRevision: original.revision,
    });
  }
  const originalDirectory = join(root, "original-preparation");
  config.fixturePreflight = {
    input,
    directory: originalDirectory,
    generation: randomUUID(),
  };
  await writeJson(configPath, config);
  await writeJson(input, originalRequest);
  await cli.ok("preflight", "prepared");
  const originalReceipt = await fs.readFile(
    join(originalDirectory, "receipt.json"),
  );
  const beforeRequestChange = {
    original: caseCounts(originalCases),
    replacement: caseCounts(),
  };
  await writeJson(input, fixtureInputs);
  const changedRequest = await cli.call("setup", "--version", version);
  const afterRequestChange = {
    original: caseCounts(originalCases),
    replacement: caseCounts(),
  };
  checks.push({
    check:
      "An edited request at the same path refuses setup before any case is consumed",
    exit: changedRequest.status,
    before: beforeRequestChange,
    after: afterRequestChange,
  });
  assert.equal(
    changedRequest.status,
    1,
    "Changing the fixture request must block setup",
  );
  assert.equal(JSON.parse(changedRequest.stderr).code, "fixture_preflight");
  assert.deepEqual(afterRequestChange, beforeRequestChange);
  assert.equal(catalog.downloaded.size, 0);
  assert.deepEqual(
    await fs.readFile(join(originalDirectory, "receipt.json")),
    originalReceipt,
  );
  config.fixturePreflight = { input, directory, generation };
  await writeJson(configPath, config);
  const untouched = caseCounts();
  await fs.chmod(input, 0o644);
  const permissions = await cli.refused("preflight");
  await assert.rejects(fs.stat(directory), { code: "ENOENT" });
  const afterPermissionsRefusal = caseCounts();
  assert.deepEqual(afterPermissionsRefusal, untouched);
  await fs.chmod(input, 0o600);
  const ineligible = structuredClone(fixtureInputs);
  ineligible.acceptance.expectedRevision = "older-fixture-revision";
  const failedDirectory = join(root, "ineligible-fixture");
  config.fixturePreflight = {
    input,
    directory: failedDirectory,
    generation: randomUUID(),
  };
  await writeJson(configPath, config);
  await writeJson(input, ineligible);
  const selection = await cli.refused("preflight");
  await assert.rejects(fs.stat(join(failedDirectory, "receipt.json")), {
    code: "ENOENT",
  });
  await assert.rejects(fs.stat(config.store), { code: "ENOENT" });
  const afterSelectionRefusal = caseCounts();
  assert.deepEqual(afterSelectionRefusal, {
    ...untouched,
    acceptance: { posts: 0, commits: 0, lookups: 1 },
  });
  config.fixturePreflight = { input, directory, generation };
  await writeJson(configPath, config);
  await writeJson(input, fixtureInputs);
  await cli.ok("preflight", "prepared");
  const afterPreflight = {
    acceptance: { posts: 0, commits: 0, lookups: 2 },
    health: { posts: 0, commits: 0, lookups: 1 },
    live: { posts: 0, commits: 0, lookups: 1 },
  };
  assert.deepEqual(caseCounts(), afterPreflight);
  await assert.rejects(fs.stat(config.store), { code: "ENOENT" });
  assert.equal(catalog.downloaded.size, 0);
  const receiptPath = join(directory, "receipt.json");
  const receipt = await fs.readFile(receiptPath, "utf8");
  assert.ok(!receipt.includes(privateMarker));
  const fileFor = (phase) => join(directory, phase, "input.json");
  const originalInputs = new Map();
  for (const phase of phases) {
    const path = fileFor(phase);
    const bytes = await fs.readFile(path);
    originalInputs.set(phase, bytes);
    assert.equal((await fs.stat(path)).mode & 0o777, 0o600);
    assert.deepEqual(await fs.readdir(join(directory, phase, "evidence")), []);
    const envelope = JSON.parse(bytes);
    assert.equal(envelope.phase, phase);
    assert.equal(envelope.generation, generation);
    assert.deepEqual(envelope.input, fixtureInputs[phase]);
  }
  const earlierEvidence = join(
    directory,
    "acceptance",
    "evidence",
    "earlier.txt",
  );
  await fs.writeFile(earlierEvidence, "Existing evidence\n", {
    flag: "wx",
    mode: 0o600,
  });
  const conflict = await cli.refused("preflight");
  assert.equal(await fs.readFile(receiptPath, "utf8"), receipt);
  assert.equal(
    await fs.readFile(earlierEvidence, "utf8"),
    "Existing evidence\n",
  );
  for (const [phase, bytes] of originalInputs)
    assert.deepEqual(await fs.readFile(fileFor(phase)), bytes);
  const afterConflictRefusal = caseCounts();
  assert.deepEqual(afterConflictRefusal, afterPreflight);
  for (const result of [permissions, selection, conflict])
    assert.equal(result.code, "fixture_preflight");
  checks.push({
    check:
      "Preflight verifies case eligibility and preserves separate private phase inputs on refusal",
    permissions: permissions.code,
    selection: selection.code,
    conflict: conflict.code,
    refusalCounts: {
      permissions: afterPermissionsRefusal,
      selection: afterSelectionRefusal,
      conflict: afterConflictRefusal,
    },
    counts: afterPreflight,
  });

  await fs.writeFile(fileFor("health"), originalInputs.get("live"));
  const wrongPhase = await cli.refused("setup", "--version", version);
  const afterWrongPhaseRefusal = caseCounts();
  assert.equal(wrongPhase.code, "fixture_preflight");
  assert.deepEqual(afterWrongPhaseRefusal, afterPreflight);
  assert.equal(catalog.downloaded.size, 0);
  await fs.writeFile(fileFor("health"), originalInputs.get("health"));
  const setup = await cli.ok("setup", "ready", "--version", version);
  const installation = await readJson(
    join(
      config.store,
      "installations",
      setup.operation.id,
      "installation.json",
    ),
  );
  assert.equal(installation.version, version);
  assert.equal(
    installation.release.manifestSha256,
    metadata.bundle.manifestSha256,
  );
  assert.equal(installation.acceptance.accepted, true);
  assert.equal(installation.health.ready, true);
  assert.equal(catalog.downloaded.size, 4);
  const afterSetup = {
    acceptance: { posts: 1, commits: 1, lookups: 3 },
    health: { posts: 0, commits: 0, lookups: 2 },
    live: { posts: 0, commits: 0, lookups: 1 },
  };
  assert.deepEqual(caseCounts(), afterSetup);
  const measuredCases = async (phase) => {
    const evidence = join(directory, phase, "evidence");
    const files = (await fs.readdir(evidence)).filter((name) =>
      name.startsWith("checked-case-"),
    );
    return Object.fromEntries(
      await Promise.all(
        files.map(async (name) => [
          name,
          await fs.readFile(join(evidence, name), "utf8"),
        ]),
      ),
    );
  };
  for (const phase of ["acceptance", "health"]) {
    const values = Object.values(await measuredCases(phase)).map(JSON.parse);
    assert.deepEqual(values, [
      {
        phase,
        generation,
        caseId: cases[phase].caseId,
        records: Number(phase === "acceptance"),
        ownedClosed: true,
      },
    ]);
  }
  checks.push({
    check:
      "Verified kit setup consumes phase-specific cases and leaves live state idle",
    wrongPhase: wrongPhase.code,
    wrongPhaseCounts: afterWrongPhaseRefusal,
    counts: afterSetup,
  });

  config.fixturePreflight.generation = randomUUID();
  await writeJson(configPath, config);
  const staleGeneration = await cli.refused("start");
  const afterStaleGenerationRefusal = caseCounts();
  assert.equal(staleGeneration.code, "fixture_preflight");
  assert.deepEqual(afterStaleGenerationRefusal, afterSetup);
  assert.deepEqual(await fs.readdir(join(directory, "live", "evidence")), []);
  config.fixturePreflight.generation = generation;
  await writeJson(configPath, config);
  const stopOwner = async () => {
    assert.equal((await cli.call("stop")).status, 0);
    const exited = await owner.closed;
    owner = undefined;
    assert.equal(exited.status, 0);
    assert.ok(!(exited.stdout + exited.stderr).includes(privateMarker));
    await cli.ok("status", "stopped");
  };
  owner = cli.start();
  assert.equal((await owner.ready).status, "running");
  const afterFirstLiveStart = caseCounts();
  const firstLiveEvidence = await measuredCases("live");
  const liveEvidence = {
    phase: "live",
    generation,
    caseId: cases.live.caseId,
    connected: true,
  };
  assert.deepEqual(Object.values(firstLiveEvidence).map(JSON.parse), [
    liveEvidence,
  ]);
  assert.deepEqual(afterFirstLiveStart, {
    ...afterSetup,
    live: { posts: 0, commits: 0, lookups: 2 },
  });
  assert.deepEqual(caseCounts(), afterFirstLiveStart);
  await stopOwner();
  owner = cli.start();
  const ready = await owner.ready;
  const afterSecondLiveStart = caseCounts();
  assert.equal(ready.status, "running");
  assert.ok(ready.viewerUrl);
  const live = await cli.ok("status", "running");
  assert.equal(live.viewerUrl, ready.viewerUrl);
  assert.equal(live.dirty, false);
  const currentLiveEvidence = await measuredCases("live");
  assert.deepEqual(Object.values(currentLiveEvidence).map(JSON.parse), [
    liveEvidence,
    liveEvidence,
  ]);
  for (const [name, bytes] of Object.entries(firstLiveEvidence))
    assert.equal(currentLiveEvidence[name], bytes);
  assert.deepEqual(afterSecondLiveStart, {
    ...afterSetup,
    live: { posts: 0, commits: 0, lookups: 3 },
  });
  assert.deepEqual(caseCounts(), afterSecondLiveStart);
  const viewerOrigin = new URL(ready.viewerUrl).origin;
  const guard = async (id, params = {}) => {
    const status = await fetch(viewerOrigin + "/status").then((r) => r.json());
    const response = await fetch(viewerOrigin + "/command", {
      method: "POST",
      headers: { Origin: viewerOrigin, "content-type": "application/json" },
      body: JSON.stringify({ id, params, revision: status.driver.revision }),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  assert.equal(
    (await guard("edit", { text: fixtureInputs.live.note, category: "plain" }))
      .ok,
    true,
  );
  const saved = await guard("save");
  assert.equal(saved.outcome.kind, "success");
  assert.equal(saved.effect.status, "saved");
  const records = (
    await fetch(cases.live.origin + "/api/notes").then((r) => r.json())
  ).items;
  assert.equal(records.length, 1);
  assert.equal(records[0].text, fixtureInputs.live.note);
  const summary = await cli.ok("status", "running");
  assert.equal(summary.dirty, false);
  const archives = join(config.store, "supervisor/run-reports");
  const reports = await Promise.all(
    (await fs.readdir(archives)).map((name) =>
      fs.readFile(join(archives, name), "utf8"),
    ),
  );
  assert.equal(reports.length, 2);
  const savedReport = reports
    .map((raw) => JSON.parse(raw).report)
    .find((report) => report.runId === saved.runId);
  assert.equal(savedReport.lastResult.effect.status, "saved");
  assert.ok(
    reports.every(
      (raw) =>
        !raw.includes(privateMarker) && !raw.includes(records[0].operation),
    ),
  );

  const { chromium } = createRequire(installation.runtimePath)("playwright");
  inspector = await chromium.launch({
    executablePath: installation.browser.executablePath,
    headless: true,
  });
  const page = await inspector.newPage();
  await page.goto(ready.viewerUrl);
  await page
    .locator("#effect-label")
    .filter({ hasText: "Application effect: Saved" })
    .waitFor();
  assert.ok(!(await page.locator("body").innerText()).includes(privateMarker));
  await page.screenshot({ path: join(root, "viewer-saved.png") });
  await stopOwner();
  assert.equal((await fetch(cases.live.origin + "/fixture-case")).status, 200);
  assert.deepEqual(caseCounts(), {
    ...afterSetup,
    live: { posts: 1, commits: 1, lookups: 4 },
  });
  assert.equal(await fs.readFile(receiptPath, "utf8"), receipt);
  assert.deepEqual(caseCounts(originalCases), beforeRequestChange.original);
  checks.push({
    check:
      "Stale generation refuses startup, same-generation relaunch preserves evidence, and guarded stop retains the independently verified live write",
    staleGeneration: staleGeneration.code,
    staleGenerationCounts: afterStaleGenerationRefusal,
    liveStartCounts: [afterFirstLiveStart.live, afterSecondLiveStart.live],
    independentReadbackCount: records.length,
    counts: caseCounts(),
    liveStartupEvidenceFiles: Object.keys(currentLiveEvidence).length,
    canonicalRunReports: reports.length,
    chromium: installation.browser.version,
  });
  const freshAcceptance = await createCase("acceptance", "compatible");
  owned.push(freshAcceptance);
  await verifyFixtureRollback({
    root,
    config,
    configPath,
    request: originalRequest,
    currentCases: originalCases,
    freshAcceptance,
    cli,
    page,
    checks,
    restart: () => {
      owner = cli.start("restart");
      return owner.ready;
    },
    stop: stopOwner,
  });
  assert.deepEqual(caseCounts(), {
    ...afterSetup,
    live: { posts: 1, commits: 1, lookups: 4 },
  });
  failed = false;
} finally {
  const cleanup = await Promise.allSettled([
    inspector?.close(),
    owner &&
      (async () => {
        const stopped = await cli.call("stop").catch(() => null);
        if (stopped?.status !== 0) owner.child.kill("SIGINT");
        const closed = await Promise.race([
          owner.closed,
          new Promise((done) => setTimeout(() => done(null), 8000).unref()),
        ]);
        if (closed) return;
        owner.child.stdout.destroy();
        owner.child.stderr.destroy();
        owner.child.unref();
        throw Error("Native owner is still retained");
      })(),
  ]);
  cleanup.push(
    ...(await Promise.allSettled(
      owned.reverse().map((resource) => resource.close()),
    )),
  );
  if (!failed) {
    cleanup.push(
      ...(await Promise.allSettled([
        (async () => {
          await fs.copyFile(
            join(root, "viewer-saved.png"),
            join(output, "viewer-saved.png"),
          );
          await fs.rm(root, { recursive: true, force: true });
        })(),
      ])),
    );
  }
  const cleanupFailed = cleanup.some((result) => result.status === "rejected");
  failed ||= cleanupFailed;
  await fs.writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        status: failed ? "FAIL" : "PASS",
        kitVersion: metadata.version,
        kitSha256: metadata.archive.sha256,
        checks,
        cleanup: cleanupFailed ? "FAIL" : "PASS",
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  if (failed)
    process.stderr.write("Private evidence retained in " + root + "\n");
  else
    console.log(
      "PASS native fixture preflight, setup, guarded live run and cleanup",
    );
  if (cleanupFailed) process.exitCode = 1;
}
