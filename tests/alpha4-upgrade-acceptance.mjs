// Exact installed accepted baseline -> selected candidate -> baseline drill using only the
// independent notebook fixture. Default transport uses a local synthetic feed;
// --production-https reads the fixed live feed with pinned public trust and real
// HTTPS. Neither mode mutates production or establishes customer acceptance.
// --alpha6-upgrade keeps published alpha.5 tools for the full alpha.6 lifecycle,
// using the synthetic feed by default or production HTTPS when explicitly selected.
// --alpha7-upgrade instead verifies a new-tools bootstrap from immutable alpha.6;
// the status/supervisor fix cannot be delivered by a runtime-only update.
// --alpha8-upgrade verifies the same separately pinned tools-bootstrap boundary
// from immutable alpha.7, including the new finalization/ownership runtime.
// --alpha9-upgrade verifies the same complete tools-bootstrap and recovery drill
// from immutable published alpha.7 to the exact alpha.9 candidate.
// Add --alpha9-dependency-migration to first prove unchanged source is refused,
// then explicitly author only the fixture's package/lock against the exact new
// runtime. This is an assisted dependency migration, not an automatic update.
// --alpha10-upgrade keeps the immutable alpha.9 manager tools through the full
// compatible alpha.10 runtime lifecycle. No dependency migration is allowed.
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
import {
  closeUpgradeManagers,
  assertAuthoredDependencyMigration,
} from "./alpha4-upgrade-helpers.mjs";

const execute = promisify(execFile);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = async (path) => JSON.parse(await fs.readFile(path, "utf8"));
const writeJson = (path, value) =>
  fs.writeFile(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
const args = process.argv.slice(2);
for (const arg of args)
  assert.ok(
    [
      "--legacy-only",
      "--production-https",
      "--local-candidate",
      "--alpha6-upgrade",
      "--alpha7-upgrade",
      "--alpha8-upgrade",
      "--alpha9-upgrade",
      "--alpha10-upgrade",
      "--alpha9-dependency-migration",
    ].includes(arg),
    "Unsupported upgrade acceptance argument",
  );
assert.equal(
  new Set(args).size,
  args.length,
  "Duplicate upgrade acceptance argument",
);
const legacyOnly = args.includes("--legacy-only");
const productionHttps = args.includes("--production-https");
const localCandidate = args.includes("--local-candidate");
const alpha6Upgrade = args.includes("--alpha6-upgrade");
const alpha7Upgrade = args.includes("--alpha7-upgrade");
const alpha8Upgrade = args.includes("--alpha8-upgrade");
const alpha9Upgrade = args.includes("--alpha9-upgrade");
const alpha10Upgrade = args.includes("--alpha10-upgrade");
const dependencyMigration = args.includes("--alpha9-dependency-migration");
assert.ok(
  !(
    alpha10Upgrade &&
    (localCandidate ||
      alpha6Upgrade ||
      alpha7Upgrade ||
      alpha8Upgrade ||
      alpha9Upgrade ||
      dependencyMigration ||
      legacyOnly)
  ),
  "Alpha.10 upgrade mode cannot combine with another upgrade mode, dependency migration or legacy-only",
);
assert.ok(
  !dependencyMigration || alpha9Upgrade,
  "Dependency migration requires explicit alpha.9 upgrade mode",
);
assert.ok(
  !(
    alpha9Upgrade &&
    (localCandidate ||
      alpha6Upgrade ||
      alpha7Upgrade ||
      alpha8Upgrade ||
      legacyOnly)
  ),
  "Alpha.9 upgrade mode cannot use local-candidate, alpha6-upgrade, alpha7-upgrade, alpha8-upgrade or legacy-only",
);
assert.ok(
  !(
    alpha8Upgrade &&
    (localCandidate || alpha6Upgrade || alpha7Upgrade || legacyOnly)
  ),
  "Alpha.8 upgrade mode cannot use local-candidate, alpha6-upgrade, alpha7-upgrade or legacy-only",
);
assert.ok(
  !(alpha7Upgrade && (localCandidate || alpha6Upgrade || legacyOnly)),
  "Alpha.7 upgrade mode cannot use local-candidate, alpha6-upgrade or legacy-only",
);
assert.ok(
  !(alpha6Upgrade && (localCandidate || legacyOnly)),
  "Alpha.6 upgrade mode cannot use local-candidate or legacy-only",
);
assert.ok(
  !(localCandidate && (productionHttps || legacyOnly)),
  "Local candidate mode cannot use production HTTPS or legacy-only",
);
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
const baselineVersion = process.env.DAEDLO_UPGRADE_BASELINE ?? "0.1.4-alpha.3";
const baselinePins = {
  "0.1.4-alpha.3":
    "f569bc0c84bf1b7ac5efe59c610916ac8ab0d5bb3322ed520114d8880262b190",
  "0.1.4-alpha.4":
    "3676d52869a30fba57798afd64d64722b7c8ee1e622e56f52013adc4107a6e75",
  "0.1.4-alpha.5":
    "2d9cbae796edd4cd5967b76458020e3366fa9d33cc1eed65a3e1d523eb65122f",
  "0.1.4-alpha.6":
    "536476e8a3f160d58b269873ffb6da55820e804357a95aa0f4358c9d5a515123",
  "0.1.4-alpha.7":
    "cb56901e85572c73dbbeb2c2566c97db31608fa15dd861704b674ef84ba1fd5e",
  "0.1.4-alpha.9":
    "81b252cc4853278360e893713c778676b492df5d60afe4f19d7880484327f4b2",
};
assert.ok(
  Object.hasOwn(baselinePins, baselineVersion),
  "Only independently pinned baselines may be selected",
);
const LEGACY_SHA = baselinePins[baselineVersion];
const legacyNames = baselineVersion === "0.1.4-alpha.3";
if (alpha10Upgrade)
  assert.equal(
    baselineVersion,
    "0.1.4-alpha.9",
    "Alpha.10 upgrade mode requires the published alpha.9 baseline",
  );
if (alpha9Upgrade)
  assert.equal(
    baselineVersion,
    "0.1.4-alpha.7",
    "Alpha.9 upgrade mode requires the published alpha.7 baseline",
  );
if (alpha8Upgrade)
  assert.equal(
    baselineVersion,
    "0.1.4-alpha.7",
    "Alpha.8 upgrade mode requires the published alpha.7 baseline",
  );
assert.ok(
  baselineVersion !== "0.1.4-alpha.6" || alpha7Upgrade,
  "Published alpha.6 baseline requires explicit alpha.7 upgrade mode",
);
assert.ok(
  baselineVersion !== "0.1.4-alpha.7" || alpha8Upgrade || alpha9Upgrade,
  "Published alpha.7 baseline requires explicit alpha.8 upgrade mode or alpha.9 upgrade mode",
);
assert.ok(
  baselineVersion !== "0.1.4-alpha.9" || alpha10Upgrade,
  "Published alpha.9 baseline requires explicit alpha.10 upgrade mode",
);
const candidateVersion =
  process.env.DAEDLO_UPGRADE_CANDIDATE_VERSION ??
  JSON.parse(
    await fs.readFile(join(repo, "packages/runtime/package.json"), "utf8"),
  ).version;
if (alpha10Upgrade) {
  assert.equal(
    candidateVersion,
    "0.1.4-alpha.10",
    "Alpha.10 upgrade mode requires exactly 0.1.4-alpha.10",
  );
} else if (alpha9Upgrade) {
  assert.equal(
    candidateVersion,
    "0.1.4-alpha.9",
    "Alpha.9 upgrade mode requires exactly 0.1.4-alpha.9",
  );
} else if (alpha8Upgrade) {
  assert.equal(
    candidateVersion,
    "0.1.4-alpha.8",
    "Alpha.8 upgrade mode requires exactly 0.1.4-alpha.8",
  );
} else if (alpha7Upgrade) {
  assert.equal(
    baselineVersion,
    "0.1.4-alpha.6",
    "Alpha.7 upgrade mode requires the published alpha.6 baseline",
  );
  assert.equal(
    candidateVersion,
    "0.1.4-alpha.7",
    "Alpha.7 upgrade mode requires exactly 0.1.4-alpha.7",
  );
} else if (localCandidate || alpha6Upgrade) {
  const mode = localCandidate ? "Local candidate" : "Alpha.6 upgrade";
  assert.equal(
    baselineVersion,
    "0.1.4-alpha.5",
    `${mode} mode requires the published alpha.5 baseline`,
  );
  assert.equal(
    candidateVersion,
    "0.1.4-alpha.6",
    `${mode} mode requires exactly 0.1.4-alpha.6`,
  );
} else {
  assert.match(
    candidateVersion,
    /^0\.1\.4-alpha\.[45]$/,
    "Only the reviewed renamed candidate release may be selected",
  );
}
const reusePublishedTools = localCandidate || alpha6Upgrade || alpha10Upgrade;
assert.ok(
  process.env.ALPHA4_LEGACY_KIT,
  "Set ALPHA4_LEGACY_KIT to the selected immutable baseline public kit directory",
);
if (!legacyOnly) {
  assert.ok(
    process.env.ALPHA4_CANDIDATE_KIT,
    "Set ALPHA4_CANDIDATE_KIT to the exact selected candidate public kit directory",
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
    : reusePublishedTools
      ? "unchanged published tools, compatible runtime upgrade and rollback"
      : dependencyMigration
        ? "exact installed tools bootstrap, refused automatic update, authored dependency migration, upgrade and rollback"
        : "exact installed tools bootstrap, upgrade and rollback",
  transport: productionHttps ? "production-https" : "ephemeral-signed-feed",
  localCandidate,
  alpha6Upgrade,
  alpha7Upgrade,
  alpha8Upgrade,
  alpha9Upgrade,
  alpha10Upgrade,
  dependencyMigration,
  reusePublishedTools,
  toolsPolicy: reusePublishedTools
    ? `Keep exact published ${baselineVersion.replace("0.1.4-", "")} tools for baseline, upgrade, restart and rollback`
    : "Verify candidate tools bootstrap before upgrading the accepted installation",
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
    "Independent synthetic notebook; no Roots or external-customer checkout accessed",
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
      ).replaceAll(
        "daedlo_engine",
        legacyNames ? "browser_driver_engine" : "daedlo_engine",
      ),
    );
  const crate = join(work, "legacy-crate");
  await fs.mkdir(crate);
  await run("tar", [
    "-xzf",
    join(legacy.root, "bundle", legacy.manifest.artifacts.engine.file),
    "-C",
    crate,
  ]);
  const engineName = legacy.manifest.artifacts.engine.name;
  const enginePath = join(crate, `${engineName}-${baselineVersion}`);
  const cargo = `[package]\nname = "notebook-engine"\nversion = "1.0.0"\nedition = "2021"\nrust-version = "1.96"\npublish = false\n\n[workspace]\n\n[dependencies]\n${engineName} = { path = ${JSON.stringify(enginePath)}, version = "=${baselineVersion}" }\nserde = { version = "1", features = ["derive"] }\nserde_json = "1"\n`;
  await fs.writeFile(join(sourceRoot, "engine/Cargo.toml"), cargo);
  await writeJson(join(sourceRoot, "package.json"), {
    private: true,
    name: "alpha4-independent-notebook",
    version: "1.0.0",
    type: "module",
    dependencies: {
      [legacy.manifest.artifacts.runtime.name]:
        `file:${join(legacy.root, "bundle", legacy.manifest.artifacts.runtime.file)}`,
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
  if (reusePublishedTools) {
    const recipe = view.locator('button[data-recipe="save_example"]');
    assert.equal(await recipe.isVisible(), true);
    assert.equal(await view.locator(".recipe-path-group").count(), 0);
    const previews = view.locator("#recipes .recipe-step-preview");
    assert.equal(
      await previews.count(),
      alpha10Upgrade || receipt.version === candidateVersion ? 1 : 0,
      "The unchanged legacy model uses the selected runtime viewer",
    );
    if (alpha10Upgrade || receipt.version === candidateVersion) {
      await previews.locator("summary").click();
      assert.equal(await previews.locator("li").count(), 2);
    }
  }
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
    baselineVersion,
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
  if (alpha10Upgrade) {
    assert.equal(
      old.NINJA_CONTRACTS.manager,
      2,
      "The retained alpha.9 manager uses the unchanged manager-2 contract",
    );
    result.managerContract = old.NINJA_CONTRACTS.manager;
  }
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
  let expectedAuthored = original;
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
  let baselineSetup = true;
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
      if (productionHttps && !legacyNames && managers.length === 0) {
        // Only the initial fixture selection is pinned. Both discovery and all
        // downloads still use the installed provider's real HTTPS verification.
        const loaded = await api.readNinjaConfig(configPath);
        const publisher = {
          ...loaded.config.catalog,
          trustedKeys: loaded.keys,
        };
        const actual = api.createNinjaProvider(publisher);
        // Manager-1 baseline tools predate this module; only the manager-2
        // initial-selection seam needs to mirror openNinja's frontend identity.
        const { frontendIdentity } = await import(
          pathToFileURL(join(oldTools.lib, "native-session.mjs"))
        );
        const supervisor = await api.createNinjaSupervisor({
          root: join(config.store, "supervisor"),
          settings: config.settings,
          frontend: frontendIdentity(config),
        });
        assert.deepEqual(
          (await supervisor.status()).frontend,
          frontendIdentity(config),
          "Baseline setup preserves normal public-bootstrap frontend identity",
        );
        const manager = await api.createNinjaManager({
          root: config.store,
          registration,
          supervisor,
          provider: {
            async check(context) {
              const offered = await actual.check(context);
              if (!baselineSetup) return offered;
              const verified = await api.fetchNinjaCatalog({
                ...publisher,
                previousState: context.previousState,
                now: Date.now(),
              });
              assert.deepEqual(
                offered.checkpoint,
                verified.checkpoint,
                "Authenticated feed changed during baseline selection",
              );
              assert.equal(
                offered.available?.version,
                candidateVersion,
                "Normal discovery must offer the candidate",
              );
              const baseline = verified.catalog.releases.find(
                (entry) => entry.version === baselineVersion,
              );
              assert.ok(baseline, "Authenticated baseline release is required");
              assert.equal(baseline.kit.sha256, LEGACY_SHA);
              assert.deepEqual(baseline.contracts, api.NINJA_CONTRACTS);
              assert.ok(
                baseline.platforms.some(
                  (p) => p.os === process.platform && p.arch === process.arch,
                ),
              );
              result.baselineSelection = {
                policy:
                  "Explicit authenticated immutable baseline for initial fixture setup only; subsequent discovery uses normal provider selection",
                version: baselineVersion,
                normallySelected: offered.available.version,
                checkpoint: verified.checkpoint,
              };
              return {
                ...offered,
                available: { ...baseline, id: baseline.version },
              };
            },
            download: (release, destination) =>
              actual.download(release, destination),
          },
          installer: {
            prepare: (args) =>
              api.prepareInstallation({ ...args, ...loaded.installation }),
            verify: api.verifyInstallation,
          },
        });
        handles = { manager, supervisor };
      } else handles = await api.openNinja(configPath);
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
  baselineSetup = false;
  const baselineReceipt = await currentReceipt();
  assert.equal(baselineReceipt.version, baselineVersion);
  assert.equal(baselineReceipt.release.archiveSha256, LEGACY_SHA);
  await managedFlow("baseline-old-tools", { durable: !legacyNames });
  await record(
    `Immutable ${baselineVersion} installed by its exact tools; real negative/save flow passed`,
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
      candidateVersion,
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
    const refusal = refused.error;
    if (legacyNames) {
      assert.equal(
        refused.available,
        null,
        "Old tools must not offer a renamed candidate",
      );
      assert.equal(refused.error?.code, "migration_required");
      await assert.rejects(active.manager.prepare(candidateVersion), {
        code: "stale_operation",
      });
    } else {
      assert.equal(
        refused.available?.version,
        candidateVersion,
        "Accepted manager-2 tools discover the compatible candidate",
      );
      assert.equal(refused.error, null);
    }
    assert.deepEqual(
      fetches.slice(fetchCount),
      [config.catalog.url],
      "Discovery must not download or replace the accepted slot",
    );
    assert.equal((await currentReceipt()).id, baselineReceipt.id);
    assert.equal(
      (await active.supervisor.status()).running.id,
      baselineReceipt.id,
    );
    assert.deepEqual(await notes(application.url), beforeRefusal);
    assert.deepEqual(await old.snapshotProject(registration), original);
    await writeJson(join(output, "baseline-discovery.json"), {
      available: refused.available,
      error: refusal,
    });
    await record(
      legacyNames
        ? "Immutable alpha.3 tools refuse renamed candidate before download and preserve accepted slot/data"
        : "Accepted manager-2 tools discover candidate without download or accepted-slot/data changes",
      { error: refusal },
    );
    await closeManager();
    const checkpoint = (await readJson(statePath)).checkpoint;
    if (!productionHttps) assert.equal(checkpoint.generation, 2);
    else assert.ok(checkpoint.generation >= 2);
    result.legacyCheckpoint = checkpoint;
    const ownerBytes = await fs.readFile(
      join(config.store, ".ninja-project.json"),
    );
    // Compatible upgrade modes prove the already published client can manage
    // the new runtime bytes; no candidate tools are installed or used.
    const newTools = reusePublishedTools
      ? oldTools
      : await installTools(candidate, join(work, "new-tools"));
    const newer = reusePublishedTools ? old : await toolApi(newTools);
    result.managerTools = {
      version: reusePublishedTools ? baselineVersion : candidateVersion,
      source: (reusePublishedTools ? legacy : candidate).toolsReceipt.source,
      archive: (reusePublishedTools ? legacy : candidate).toolsReceipt.archive,
      reusedPublishedTools: reusePublishedTools,
    };
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
      baselineVersion,
    );
    await managedFlow(
      reusePublishedTools ? "baseline-reopened" : "legacy-new-tools",
    );
    await record(
      reusePublishedTools
        ? `Unchanged published ${baselineVersion.replace("0.1.4-", "")} tools reopen the accepted slot with config/trust/store/checkpoint preserved`
        : "Verified new tools bootstrap preserves config/trust/store/checkpoint and runs accepted legacy slot",
      { toolsFiles: Object.keys(newTools.inventory).length },
    );
    const beforeUpgrade = await notes(application.url);
    const offered = await active.manager.check();
    assert.equal(offered.available?.version, candidateVersion);
    assert.equal(offered.error, null);
    const acceptedCheckpoint = (await readJson(statePath)).checkpoint;
    assert.ok(acceptedCheckpoint.generation >= checkpoint.generation);
    if (acceptedCheckpoint.generation === checkpoint.generation)
      assert.deepEqual(acceptedCheckpoint, checkpoint);
    if (dependencyMigration) {
      await assert.rejects(
        preparePinned(candidate),
        /Existing adapter dependency lock changed; migration required/,
      );
      assert.equal((await currentReceipt()).id, baselineReceipt.id);
      assert.equal(
        (await active.supervisor.status()).running.id,
        baselineReceipt.id,
      );
      assert.deepEqual(await notes(application.url), beforeUpgrade);
      assert.deepEqual(await newer.snapshotProject(registration), original);
      await newer.verifyInstallation(baselineReceipt.path, { registration });
      await record(
        "Unchanged alpha.7 dependency lock refuses alpha.9 before activation; accepted slot, source and data remain intact",
      );

      const artifact = candidate.manifest.artifacts.runtime;
      const archive = join(candidate.root, "bundle", artifact.file);
      const runtimeBytes = await fs.readFile(archive);
      assert.equal(hash(runtimeBytes), artifact.sha256);
      const packagePath = join(sourceRoot, "package.json");
      const originalPackage = await readJson(packagePath);
      const migratedPackage = structuredClone(originalPackage);
      migratedPackage.dependencies[artifact.name] = `file:${archive}`;
      await writeJson(packagePath, migratedPackage);
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
      assert.deepEqual(await readJson(packagePath), migratedPackage);
      const lock = await readJson(join(sourceRoot, "package-lock.json"));
      const selectedRuntime = lock.packages[`node_modules/${artifact.name}`];
      assert.equal(selectedRuntime.version, candidateVersion);
      assert.equal(
        selectedRuntime.integrity,
        "sha512-" + createHash("sha512").update(runtimeBytes).digest("base64"),
      );
      assert.equal(
        lock.packages[""].dependencies[artifact.name],
        `file:${archive}`,
      );
      expectedAuthored = await newer.snapshotProject(registration);
      const changedFiles = assertAuthoredDependencyMigration(
        original,
        expectedAuthored,
      );
      result.authoredMigration = {
        runtimeArchiveSha256: artifact.sha256,
        beforeSourceSha256: original.sha256,
        afterSourceSha256: expectedAuthored.sha256,
        changedFiles,
        playwrightBefore: (
          await readJson(
            join(baselineReceipt.snapshotPath, "package-lock.json"),
          )
        ).packages["node_modules/playwright"].version,
        playwrightAfter: lock.packages["node_modules/playwright"].version,
      };
      await writeJson(
        join(output, "project-after-authored-migration.json"),
        expectedAuthored,
      );
      await newer.verifyInstallation(baselineReceipt.path, {
        registration,
        checkSource: false,
      });
      await record(
        "Explicit authored package/lock migration binds exact alpha.9 runtime; all other source files and retained alpha.7 slot remain unchanged",
        { changedFiles: changedFiles.map(({ file }) => file) },
      );
    }
    prepared = await preparePinned(candidate);
    assert.equal(prepared.operation.status, "ready");
    assert.deepEqual(await notes(application.url), beforeUpgrade);
    await active.manager.activate(prepared.operation.id, {
      acknowledgeRestart: true,
    });
    const candidateReceipt = await currentReceipt();
    assert.equal(candidateReceipt.version, candidateVersion);
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
    await managedFlow("candidate-" + candidateVersion);
    await record(
      `Exact ${candidateVersion} installation preserves data/model and passes real negative/save flow`,
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
    await managedFlow("candidate-restarted-" + candidateVersion);
    await record(
      "Fresh manager recovers retained candidate and restarts it with preserved notebook data",
    );
    const beforeRollback = await notes(application.url);
    await active.manager.rollback({ acknowledgeRestart: true });
    assert.equal((await currentReceipt()).id, baselineReceipt.id);
    assert.deepEqual(await notes(application.url), beforeRollback);
    await managedFlow("rollback-" + baselineVersion);
    await record(
      `Complete retained ${baselineVersion} slot restored without data changes; real negative/save flow passes`,
    );
    await closeManager();
    active.closed = false;
    await active.manager.start();
    assert.equal(
      (await active.supervisor.status()).running.id,
      baselineReceipt.id,
    );
    await closeManager();
    assert.deepEqual(
      await newer.snapshotProject(registration),
      expectedAuthored,
    );
    if (dependencyMigration) {
      assertAuthoredDependencyMigration(original, expectedAuthored);
      await newer.verifyInstallation(baselineReceipt.path, {
        registration,
        checkSource: false,
      });
      assert.equal((await readJson(statePath)).historicalSnapshot, true);
    }
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
    if (reusePublishedTools)
      await assert.rejects(fs.stat(join(work, "new-tools")), {
        code: "ENOENT",
      });
    result.finalCheckpoint = acceptedCheckpoint;
    const reports = await fs.readdir(join(config.store, "reports"));
    assert.ok(
      reports.length >= 4,
      "Durable lifecycle reports retained across manager reopen, upgrade, rollback and relaunch",
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
      reusePublishedTools
        ? "States/flows/adapter source, exact published tools, config/trust/checkpoint preserved; durable reports and relaunch pass"
        : dependencyMigration
          ? "Reviewed package/lock migration retained; all other source, both tools packages, config/trust/checkpoint and historical rollback preserved; reports and relaunch pass"
          : "States/flows/adapter source, both tools packages, config/trust/checkpoint preserved; durable reports and relaunch pass",
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
  const { driverClosed, cleanup } = await closeUpgradeManagers(managers);
  result.cleanup.push(...cleanup);
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
