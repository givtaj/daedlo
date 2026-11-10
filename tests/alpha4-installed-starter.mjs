import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyBundle } from "../scripts/release/manifest.mjs";
import { runManagedStarterAcceptance } from "./managed-starter-acceptance.mjs";
import { runEvidenceReporting } from "./evidence-reporting-acceptance.mjs";
import {
  validatePackageArchive,
  verifyInstalledRuntime,
} from "./release-acceptance.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hash = (path) => sha(fs.readFileSync(path));
function inventory(root) {
  const result = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      assert.ok(
        !entry.isSymbolicLink(),
        "Installed tools must not contain symlinks",
      );
      if (entry.isDirectory()) visit(path);
      else {
        assert.ok(entry.isFile(), "Only regular tools files are allowed");
        result.push(relative(root, path).replaceAll("\\", "/"));
      }
    }
  };
  visit(root);
  return result.sort();
}
export function verifyToolsSource(installed, manifest) {
  const receipt = JSON.parse(fs.readFileSync(join(installed, "SOURCE.json")));
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.kind, "browser-driver-release-tools");
  assert.equal(receipt.name, "@daedlo/release-tools");
  assert.equal(receipt.version, manifest.version);
  assert.deepEqual(
    receipt.source,
    manifest.source,
    "Tools and runtime/crate must describe the same frozen source",
  );
  assert.ok(Array.isArray(receipt.files) && receipt.files.length > 0);
  const files = receipt.files.map((entry) => entry.file).sort();
  assert.equal(
    new Set(files).size,
    files.length,
    "SOURCE inventory has duplicate entries",
  );
  assert.deepEqual(
    inventory(installed),
    [...files, "SOURCE.json"].sort(),
    "SOURCE must cover every installed tools file",
  );
  for (const entry of receipt.files) {
    assert.ok(
      typeof entry.file === "string" &&
        entry.file &&
        !entry.file.startsWith("/") &&
        !entry.file
          .split("/")
          .some((part) => part === ".." || part === "." || !part),
      "Unsafe SOURCE path",
    );
    assert.ok(
      !/(^|\/)(?:customers|artifacts|target|node_modules|\.git|\.env(?:\..*)?)(\/|$)/.test(
        entry.file,
      ),
      "Private/generated directory is outside the portable tools inventory",
    );
    const path = join(installed, entry.file),
      bytes = fs.readFileSync(path);
    assert.equal(
      bytes.length,
      entry.bytes,
      "Tools file size differs: " + entry.file,
    );
    assert.equal(
      sha(bytes),
      entry.sha256,
      "Tools file digest differs: " + entry.file,
    );
    assert.equal(
      fs.statSync(path).mode & 0o777,
      entry.mode,
      "Tools file mode differs: " + entry.file,
    );
  }
  for (const file of [
    "acceptance.mjs",
    "build-model.mjs",
    "runtime.mjs",
    "request-acceptance.mjs",
    "model/Cargo.toml",
    "model/src/lib.rs",
  ])
    assert.ok(
      files.includes("examples/starter/" + file),
      "Verified tools must ship complete starter: " + file,
    );
  return {
    files: files.length + 1,
    sourceReceiptSha256: hash(join(installed, "SOURCE.json")),
    source: receipt.source,
  };
}

// Keep reference dispatch separately testable without rebuilding an installed bundle.
// Callers supply verified installed paths; the reference runners perform their
// real-browser checks and retain their acceptance receipts.
export async function runInstalledStarterReferences(
  result,
  {
    runtimePath,
    enginePath,
    starterRoot,
    output,
    toolsRoot,
    engineCrate,
    exampleRoot,
    bundle,
    expectedManifestSha256,
  },
  {
    evidenceRunner = runEvidenceReporting,
    managedRunner = runManagedStarterAcceptance,
  } = {},
) {
  if (
    [
      "0.1.4-alpha.5",
      "0.1.4-alpha.6",
      "0.1.4-alpha.7",
      "0.1.4-alpha.8",
      "0.1.4-alpha.9",
      "0.1.4-alpha.10",
    ].includes(result.version)
  ) {
    result.evidenceReference = await evidenceRunner({
      runtimePath,
      enginePath,
      starterRoot,
      output: join(output, "evidence"),
    });
    assert.equal(result.evidenceReference.status, "PASS");
    assert.ok(result.evidenceReference.checks.length >= 9);
    assert.ok(
      result.evidenceReference.checks.every(
        (check) => check?.status === "PASS",
      ),
      "Every installed evidence reference check must pass",
    );
    assert.deepEqual(result.evidenceReference.cleanup.failures, []);
    result.managedReference = await managedRunner({
      output: join(output, "managed"),
      toolsRoot,
      runtimePath,
      engineCrate,
      exampleRoot,
      bundle,
      expectedManifestSha256,
    });
    result.managedDependencyInstall =
      "locked dependencies may use registry access; Daedlo bundle and references are the exact verified package";
    assert.equal(result.managedReference.status, "PASS");
    assert.equal(result.managedReference.cleanup, "PASS");
  }
}

export async function runInstalledStarter({
  bundle,
  toolsArchive,
  expectedToolsSha256,
  expectedManifestSha256,
  output,
  repoRoot = fileURLToPath(new URL("../", import.meta.url)),
}) {
  assert.match(
    expectedToolsSha256 ?? "",
    /^[a-f0-9]{64}$/,
    "Supply independently expected tools SHA256",
  );
  assert.match(
    expectedManifestSha256 ?? "",
    /^[a-f0-9]{64}$/,
    "Supply independently expected manifest SHA256",
  );
  bundle = resolve(bundle);
  toolsArchive = resolve(toolsArchive);
  output = resolve(output);
  repoRoot = resolve(repoRoot);
  assert.ok(!fs.existsSync(output), "Acceptance output must be fresh");
  const toolsStat = fs.lstatSync(toolsArchive);
  assert.ok(
    toolsStat.isFile() && !toolsStat.isSymbolicLink(),
    "Tools archive must be a regular file",
  );
  const toolsBytes = fs.readFileSync(toolsArchive);
  assert.equal(
    sha(toolsBytes),
    expectedToolsSha256,
    "Tools archive digest mismatch",
  );
  validatePackageArchive(toolsBytes, "package");
  const rustVersion = execFileSync("rustc", ["--version"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).match(/^rustc (\S+)/)?.[1];
  assert.ok(rustVersion);
  const environment = {
    protocol: 1,
    nodeVersion: process.versions.node,
    rustVersion,
  };
  const { manifest } = await verifyBundle(bundle, {
    expectedManifestSha256,
    environment,
  });
  assert.equal(manifest.artifacts.runtime.name, "@daedlo/runtime");
  assert.equal(manifest.artifacts.engine.name, "daedlo-engine");
  fs.mkdirSync(dirname(output), { recursive: true });
  fs.mkdirSync(output);
  const logs = join(output, "logs");
  fs.mkdirSync(logs);
  const temporary = fs.realpathSync(
    fs.mkdtempSync(join(tmpdir(), "daedlo-alpha4-starter-")),
  );
  const ownedIdentity = fs.lstatSync(temporary);
  const result = {
    schemaVersion: 1,
    status: "FAIL",
    cleanup: "PENDING",
    testLevel:
      "exact offline installed tools/runtime, shipped starter, exact extracted Rust crate, real Chromium",
    version: manifest.version,
    source: manifest.source,
    manifestSha256: expectedManifestSha256,
    toolsArchiveSha256: expectedToolsSha256,
    runtimeArchiveSha256: manifest.artifacts.runtime.sha256,
    crateArchiveSha256: manifest.artifacts.engine.sha256,
    node: process.version,
    rust: rustVersion,
    platform: process.platform,
    architecture: process.arch,
  };
  const toolsWork = join(temporary, "tools-consumer"),
    work = join(temporary, "runtime-consumer"),
    cache = join(temporary, "npm-cache");
  const npmConfig = join(temporary, "npm-user.conf");
  const npmGlobalConfig = join(temporary, "npm-global.conf");
  fs.writeFileSync(npmConfig, "");
  fs.writeFileSync(npmGlobalConfig, "");
  function run(
    name,
    executable,
    args,
    { cwd = work, env = {}, input, timeout = 180000 } = {},
  ) {
    try {
      const stdout = execFileSync(executable, args, {
        cwd,
        env: {
          ...process.env,
          NODE_PATH: "",
          NPM_CONFIG_USERCONFIG: npmConfig,
          NPM_CONFIG_GLOBALCONFIG: npmGlobalConfig,
          ...env,
        },
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        timeout,
        input,
        stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      });
      fs.writeFileSync(join(logs, name + ".log"), stdout);
      return stdout;
    } catch (error) {
      fs.writeFileSync(
        join(logs, name + ".log"),
        String(error.stdout ?? "") + String(error.stderr ?? ""),
      );
      throw new Error(
        "Installed starter step " + name + " failed; inspect its retained log",
        { cause: error },
      );
    }
  }
  function extract(name, bytes, prefix) {
    const paths = validatePackageArchive(bytes, prefix);
    assert.equal(
      new Set(paths).size,
      paths.length,
      "Archive contains duplicate paths",
    );
    const destination = join(temporary, name + "-extracted");
    fs.mkdirSync(destination);
    fs.writeFileSync(
      join(logs, name + "-inventory.log"),
      paths.join("\n") + "\n",
    );
    run(name + "-extract", "tar", ["-xzf", "-", "-C", destination], {
      input: bytes,
    });
    return join(destination, prefix);
  }
  const install = (name, prefix, archives) =>
    run(name, "npm", [
      "install",
      "--prefix",
      prefix,
      "--workspaces=false",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--cache",
      cache,
      ...archives,
    ]);
  try {
    for (const [path, name] of [
      [work, "isolated-starter-runtime"],
      [toolsWork, "isolated-starter-tools"],
    ]) {
      fs.mkdirSync(path);
      fs.writeFileSync(
        join(path, "package.json"),
        JSON.stringify({
          name,
          version: "1.0.0",
          private: true,
          type: "module",
        }),
      );
    }
    const toolsExpected = extract("tools", toolsBytes, "package");
    const verifiedToolsArchive = join(temporary, "verified-tools.tgz");
    fs.writeFileSync(verifiedToolsArchive, toolsBytes);
    install("tools-install", toolsWork, [verifiedToolsArchive]);
    const installedTools = join(
      toolsWork,
      "node_modules/@daedlo/release-tools",
    );
    verifyInstalledRuntime(toolsExpected, installedTools);
    result.toolsInventory = verifyToolsSource(installedTools, manifest);
    const toolsPackage = JSON.parse(
      fs.readFileSync(join(installedTools, "package.json")),
    );
    assert.equal(toolsPackage.name, "@daedlo/release-tools");
    assert.equal(toolsPackage.version, manifest.version);
    assert.equal(
      toolsPackage.dependencies,
      undefined,
      "Portable tools should not import a source runtime dependency",
    );
    const selected = {};
    for (const kind of ["runtime", "engine"]) {
      const artifact = manifest.artifacts[kind],
        bytes = fs.readFileSync(join(bundle, artifact.file));
      assert.equal(bytes.length, artifact.bytes);
      assert.equal(sha(bytes), artifact.sha256);
      const copied = join(temporary, artifact.file);
      fs.writeFileSync(copied, bytes);
      selected[kind] = {
        archive: copied,
        root: extract(
          kind,
          bytes,
          kind === "runtime"
            ? "package"
            : `${artifact.name}-${artifact.version}`,
        ),
      };
    }
    const dependencies = join(temporary, "dependency-archives");
    fs.mkdirSync(dependencies);
    const repoRequire = createRequire(join(repoRoot, "package.json"));
    const dependencyTarballs = [];
    for (const name of ["playwright", "playwright-core"]) {
      const packageRoot = dirname(repoRequire.resolve(name + "/package.json"));
      const packed = JSON.parse(
        run("pack-" + name, "npm", [
          "pack",
          packageRoot,
          "--json",
          "--ignore-scripts",
          "--offline",
          "--pack-destination",
          dependencies,
          "--cache",
          cache,
        ]),
      );
      assert.equal(packed.length, 1);
      assert.equal(packed[0].name, name);
      dependencyTarballs.push(join(dependencies, packed[0].filename));
    }
    install("runtime-install", work, [
      selected.runtime.archive,
      ...dependencyTarballs,
    ]);
    const installedRuntime = join(work, "node_modules/@daedlo/runtime");
    result.runtimeInventory = verifyInstalledRuntime(
      selected.runtime.root,
      installedRuntime,
    );
    const publicRuntimeUrl = run(
      "public-runtime-resolution",
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'console.log(import.meta.resolve("@daedlo/runtime"));',
      ],
    ).trim();
    assert.equal(
      publicRuntimeUrl,
      pathToFileURL(join(installedRuntime, "src/index.mjs")).href,
    );
    const starter = join(installedTools, "examples/starter");
    result.starterSource = {
      origin: "installed tools SOURCE inventory",
      acceptanceSha256: hash(join(starter, "acceptance.mjs")),
      modelSha256: hash(join(starter, "model/src/lib.rs")),
    };
    const modelBuild = JSON.parse(
      run(
        "starter-build",
        process.execPath,
        [
          join(starter, "build-model.mjs"),
          "--crate",
          selected.engine.root,
          "--output",
          join(temporary, "starter-build"),
          "--offline",
        ],
        { env: { RUSTUP_TOOLCHAIN: rustVersion }, timeout: 300000 },
      ),
    );
    assert.equal(modelBuild.cratePath, selected.engine.root);
    const modelManifest = fs.readFileSync(
      join(modelBuild.model, "Cargo.toml"),
      "utf8",
    );
    assert.ok(
      modelManifest.includes(JSON.stringify(selected.engine.root)),
      "Model must use the exact extracted crate",
    );
    fs.copyFileSync(
      join(modelBuild.model, "Cargo.toml"),
      join(output, "model-Cargo.toml"),
    );
    fs.copyFileSync(
      join(modelBuild.model, "Cargo.lock"),
      join(output, "model-Cargo.lock"),
    );
    fs.copyFileSync(
      join(temporary, "starter-build/cargo-build.log"),
      join(logs, "cargo-build.log"),
    );
    result.engineExecutableSha256 = hash(modelBuild.enginePath);
    result.invalidEngineExecutableSha256 = hash(modelBuild.invalidEnginePath);
    const browserOutput = join(output, "browser");
    run(
      "installed-starter-browser",
      process.execPath,
      [join(starter, "acceptance.mjs")],
      {
        env: {
          STARTER_BASELINE: "0",
          DAEDLO_STARTER_RUNTIME: fileURLToPath(publicRuntimeUrl),
          DAEDLO_STARTER_ENGINE: modelBuild.enginePath,
          DAEDLO_STARTER_INVALID_ENGINE: modelBuild.invalidEnginePath,
          DAEDLO_STARTER_OUTPUT: browserOutput,
        },
        timeout: 180000,
      },
    );
    const browser = JSON.parse(
      fs.readFileSync(join(browserOutput, "result.json")),
    );
    assert.ok(
      browser.checks.length >= 16 &&
        browser.checks.every((check) => check.status === "PASS"),
      "Every installed starter browser group must pass",
    );
    assert.equal(browser.identity.runtimeEntry, publicRuntimeUrl);
    assert.equal(browser.identity.engineSha256, result.engineExecutableSha256);
    assert.equal(
      browser.identity.invalidEngineSha256,
      result.invalidEngineExecutableSha256,
    );
    assert.deepEqual(browser.cleanup.failures, []);
    assert.equal(browser.cleanup.ownedBrowserClosed, true);
    assert.equal(browser.cleanup.adapter.closed, true);
    assert.equal(browser.cleanup.adapter.pendingCount, 0);
    result.browserChecks = browser.checks;
    result.browserVersion = browser.identity.browserVersion;
    await runInstalledStarterReferences(result, {
      runtimePath: fileURLToPath(publicRuntimeUrl),
      enginePath: modelBuild.enginePath,
      starterRoot: starter,
      output,
      toolsRoot: join(installedTools, "lib"),
      engineCrate: selected.engine.root,
      exampleRoot: join(installedTools, "examples/managed-starter"),
      bundle,
      expectedManifestSha256,
    });
    result.toolsInventory = verifyToolsSource(installedTools, manifest);
    verifyInstalledRuntime(toolsExpected, installedTools);
    result.runtimeInventory = verifyInstalledRuntime(
      selected.runtime.root,
      installedRuntime,
    );
    await verifyBundle(bundle, { expectedManifestSha256, environment });
    assert.equal(
      hash(toolsArchive),
      expectedToolsSha256,
      "Selected tools archive changed during acceptance",
    );
    result.status = "PASS";
    console.log(
      `PASS exact installed starter ${manifest.version}: ${browser.checks.length} browser groups; complete tools/runtime inventories verified`,
    );
    return result;
  } catch (error) {
    result.error = error.message;
    throw error;
  } finally {
    try {
      const current = fs.lstatSync(temporary);
      assert.ok(
        current.isDirectory() &&
          !current.isSymbolicLink() &&
          current.dev === ownedIdentity.dev &&
          current.ino === ownedIdentity.ino,
        "Owned consumer directory was replaced; refusing cleanup",
      );
      fs.rmSync(temporary, { recursive: true });
      result.cleanup = "PASS";
    } catch (error) {
      result.cleanup = "FAIL";
      result.retainedOwnedDirectory = temporary;
      result.cleanupError = error.message;
      process.exitCode = 1;
    }
    fs.writeFileSync(
      join(output, "result.json"),
      JSON.stringify(result, null, 2) + "\n",
      { flag: "wx" },
    );
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const [
    bundle,
    toolsArchive,
    expectedToolsSha256,
    expectedManifestSha256,
    output,
    ...extra
  ] = process.argv.slice(2);
  if (!bundle || !toolsArchive || !output || extra.length)
    throw new Error(
      "Usage: node tests/alpha4-installed-starter.mjs BUNDLE_DIR TOOLS_ARCHIVE EXPECTED_TOOLS_SHA256 EXPECTED_MANIFEST_SHA256 FRESH_OUTPUT",
    );
  await runInstalledStarter({
    bundle,
    toolsArchive,
    expectedToolsSha256,
    expectedManifestSha256,
    output,
  });
}
