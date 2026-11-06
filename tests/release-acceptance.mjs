import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInstalledControls } from "./installed-controls-acceptance.mjs";

function inventory(root) {
  const files = [];
  function visit(directory) {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      assert.ok(
        !entry.isSymbolicLink(),
        "Installed runtime must not contain workspace links",
      );
      if (entry.isDirectory()) visit(path);
      else {
        assert.ok(
          entry.isFile(),
          "Installed runtime contains unsupported file type",
        );
        files.push(relative(root, path).replaceAll("\\", "/"));
      }
    }
  }
  visit(root);
  return files;
}
export function verifyInstalledRuntime(expected, installed) {
  assert.ok(
    fs.lstatSync(installed).isDirectory() &&
      !fs.lstatSync(installed).isSymbolicLink(),
    "Installed runtime must be a real directory",
  );
  const files = inventory(expected);
  assert.deepEqual(
    inventory(installed),
    files,
    "Installed runtime file set differs",
  );
  const digest = createHash("sha256");
  for (const file of files) {
    const bytes = fs.readFileSync(join(installed, file));
    assert.deepEqual(
      bytes,
      fs.readFileSync(join(expected, file)),
      "Installed runtime bytes differ",
    );
    digest
      .update(file + "\0")
      .update(bytes)
      .update("\0");
  }
  return { files: files.length, sha256: digest.digest("hex") };
}
const sha256 = (path) =>
  createHash("sha256").update(fs.readFileSync(path)).digest("hex");

export function acquireAcceptanceOutput(output) {
  fs.mkdirSync(dirname(output), { recursive: true });
  fs.mkdirSync(output);
}

export function acquireConsumerDirectory(parent = tmpdir()) {
  return fs.realpathSync(
    fs.mkdtempSync(join(parent, "browser-driver-release-consumer-")),
  );
}

export function validatePackageArchive(archive, prefix) {
  const bytes = Buffer.isBuffer(archive) ? archive : fs.readFileSync(archive);
  const listing = (flag) =>
    execFileSync("tar", [flag, "-"], {
      input: bytes,
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, LC_ALL: "C" },
    })
      .trim()
      .split("\n");
  const entries = listing("-tzf");
  assert.ok(
    entries.every(
      (entry) =>
        entry === prefix ||
        (entry.startsWith(prefix + "/") && !entry.split("/").includes("..")),
    ),
    "Package archive paths must remain within their package directory",
  );
  const details = listing("-tzvf");
  assert.ok(
    details.length === entries.length &&
      details.every((line) => /^[d-][rwxstST-]{9}\s/.test(line)),
    "Package archives may contain only regular files and directories",
  );
  return entries;
}

function nativeTapResult(log, name, expected) {
  assert.equal(typeof log, "string", `${name}: TAP output is required`);
  const totals = {};
  for (const field of [
    "tests",
    "pass",
    "fail",
    "cancelled",
    "skipped",
    "todo",
  ]) {
    const matches = [...log.matchAll(new RegExp(`^# ${field} (\\d+)$`, "gm"))];
    assert.equal(
      matches.length,
      1,
      `${name}: exactly one ${field} total is required`,
    );
    totals[field] = Number(matches[0][1]);
  }
  assert.equal(
    totals.tests,
    expected,
    `${name}: every selected test must execute`,
  );
  assert.equal(totals.pass, expected, `${name}: every selected test must pass`);
  for (const field of ["fail", "cancelled", "skipped", "todo"])
    assert.equal(totals[field], 0, `${name}: no ${field} tests`);
  return totals;
}

// Trusted local runner/receipt seams let the dispatch contract be checked without
// substituting source product code for the installed tools, runtime or engine.
export function runInstalledNativeAcceptance(
  {
    repoRoot,
    installedTools,
    runtimePath,
    enginePath,
    engineCrate,
    targetDir,
    output,
    runtimeName,
    runtimeVersion,
    engineSha256,
  },
  { run, readReceipt = (path) => JSON.parse(fs.readFileSync(path)) },
) {
  const nativeOutput = join(output, "native");
  const startupLog = run(
    "installed-native-startup",
    process.execPath,
    [
      "--test",
      "--test-reporter=tap",
      join(repoRoot, "tests/release-native-startup-browser.test.mjs"),
    ],
    {
      env: {
        DAEDLO_NATIVE_TOOLS_ROOT: join(installedTools, "lib"),
        DAEDLO_NATIVE_RUNTIME_PATH: runtimePath,
        DAEDLO_NATIVE_ENGINE_PATH: enginePath,
        DAEDLO_NATIVE_ENGINE_CRATE: engineCrate,
        DAEDLO_NATIVE_TARGET_DIR: targetDir,
        DAEDLO_NATIVE_OUTPUT: nativeOutput,
      },
      timeout: 180000,
    },
  );
  const startupTap = nativeTapResult(startupLog, "installed-native-startup", 1);
  const native = readReceipt(join(nativeOutput, "browser-result.json"));
  assert.equal(native.status, "PASS");
  assert.equal(native.toolsRoot, join(installedTools, "lib"));
  assert.equal(native.runtimePath, runtimePath);
  assert.equal(native.enginePath, enginePath);
  assert.equal(native.engineCrate, engineCrate);
  assert.equal(native.runtime.name, runtimeName);
  assert.equal(native.runtime.version, runtimeVersion);
  assert.ok(
    Array.isArray(native.checks) && native.checks.length >= 13,
    "All native frontend startup/lifecycle checks must run",
  );
  const observationOutput = join(output, "native-observation");
  const observationLog = run(
    "installed-native-observation",
    process.execPath,
    [
      "--test",
      "--test-reporter=tap",
      join(repoRoot, "tests/release-native-observation-browser.test.mjs"),
    ],
    {
      env: {
        DAEDLO_NATIVE_TOOLS_ROOT: join(installedTools, "lib"),
        DAEDLO_NATIVE_RUNTIME_PATH: runtimePath,
        DAEDLO_NATIVE_ENGINE_PATH: enginePath,
        DAEDLO_OBSERVATION_OUTPUT: observationOutput,
      },
      timeout: 180000,
    },
  );
  const observationTap = nativeTapResult(
    observationLog,
    "installed-native-observation",
    2,
  );
  const observation = readReceipt(
    join(observationOutput, "browser-result.json"),
  );
  assert.equal(observation.status, "PASS");
  assert.equal(observation.cleanup, "PASS");
  assert.equal(observation.toolsRoot, join(installedTools, "lib"));
  assert.equal(observation.runtimePath, runtimePath);
  assert.equal(observation.enginePath, enginePath);
  assert.equal(observation.runtime.name, runtimeName);
  assert.equal(observation.runtime.version, runtimeVersion);
  assert.match(
    engineSha256 ?? "",
    /^[a-f0-9]{64}$/,
    "Compiled engine digest must be recorded",
  );
  assert.equal(observation.engineSha256, engineSha256);
  assert.ok(
    Array.isArray(observation.checks) && observation.checks.length >= 5,
    "All native observation recovery checks must run",
  );
  return {
    nativeStartup: {
      status: "PASS",
      checks: native.checks,
      browser: native.browser,
      tap: startupTap,
    },
    nativeObservation: {
      status: "PASS",
      checks: observation.checks,
      browser: observation.browser,
      engineSha256: observation.engineSha256,
      tap: observationTap,
    },
  };
}

export async function runReleaseAcceptance({
  bundle,
  output,
  expectedManifestSha256,
  toolsArchive,
  expectedToolsSha256,
  repoRoot = fileURLToPath(new URL("../", import.meta.url)),
}) {
  assert.match(
    expectedManifestSha256 ?? "",
    /^[a-f0-9]{64}$/,
    "Supply the independently recorded expected manifest SHA256",
  );
  assert.equal(
    toolsArchive === undefined,
    expectedToolsSha256 === undefined,
    "toolsArchive and expectedToolsSha256 must be supplied together",
  );
  let toolsBytes;
  if (toolsArchive !== undefined) {
    assert.ok(
      typeof toolsArchive === "string" && toolsArchive,
      "Tools archive path is required",
    );
    assert.match(
      expectedToolsSha256 ?? "",
      /^[a-f0-9]{64}$/,
      "Supply the independently recorded tools SHA256",
    );
    toolsArchive = resolve(toolsArchive);
    const info = fs.lstatSync(toolsArchive);
    assert.ok(
      info.isFile() && !info.isSymbolicLink(),
      "Tools archive must be a regular file",
    );
    toolsBytes = fs.readFileSync(toolsArchive);
    assert.equal(
      createHash("sha256").update(toolsBytes).digest("hex"),
      expectedToolsSha256,
      "Tools archive digest mismatch",
    );
    validatePackageArchive(toolsBytes, "package");
  }
  repoRoot = resolve(repoRoot);
  bundle = resolve(bundle);
  output = resolve(output);
  assert.ok(!fs.existsSync(output), "Acceptance output must be fresh");
  const { verifyBundle } = await import("../scripts/release/manifest.mjs");
  const rustVersion = execFileSync("rustc", ["--version"], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 10000,
    stdio: ["ignore", "pipe", "pipe"],
  }).match(/^rustc (\S+)/)?.[1];
  assert.ok(rustVersion, "Rust compiler version could not be determined");
  const environment = {
    protocol: 1,
    nodeVersion: process.versions.node,
    rustVersion,
  };
  const verified = await verifyBundle(bundle, {
    expectedManifestSha256,
    environment,
  });
  const { manifest } = verified;
  assert.ok(
    manifest?.artifacts?.runtime && manifest?.artifacts?.engine,
    "Verified bundle must contain the runtime and engine",
  );
  acquireAcceptanceOutput(output);
  const logs = join(output, "logs");
  fs.mkdirSync(logs);
  const temporary = acquireConsumerDirectory();
  const work = join(temporary, "consumer");
  fs.mkdirSync(work);
  const dependencies = join(temporary, "dependency-packages");
  fs.mkdirSync(dependencies);
  const packageArchive = join(temporary, "package-archive");
  fs.mkdirSync(packageArchive);
  const engineArchive = join(temporary, "engine-archive");
  fs.mkdirSync(engineArchive);
  const cache = join(temporary, "npm-cache");
  const runtimeTarball = join(bundle, manifest.artifacts.runtime.file),
    engineTarball = join(bundle, manifest.artifacts.engine.file);
  const result = {
    schemaVersion: 1,
    testLevel:
      "isolated npm installation and customer engine compiled against exact crate; real Chromium",
    version: manifest.version,
    manifestSha256: expectedManifestSha256,
    runtimeArtifactSha256: manifest.artifacts.runtime.sha256,
    engineArtifactSha256: manifest.artifacts.engine.sha256,
    node: process.version,
    rust: rustVersion,
    platform: process.platform,
    architecture: process.arch,
    status: "FAIL",
    cleanup: "PENDING",
  };
  function run(
    name,
    executable,
    args,
    { cwd = work, env = {}, timeout = 180000, input } = {},
  ) {
    try {
      const stdout = execFileSync(executable, args, {
        cwd,
        env: { ...process.env, ...env },
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
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
      throw Error(
        `Release acceptance step ${name} failed; inspect its local log`,
        { cause: error },
      );
    }
  }
  function extract(name, archive, destination, prefix, artifact) {
    // List and extract the same verified bytes so a replaced input path cannot
    // introduce links between the safety check and extraction.
    const bytes = Buffer.isBuffer(archive) ? archive : fs.readFileSync(archive);
    assert.equal(bytes.length, artifact.bytes);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      artifact.sha256,
    );
    const entries = validatePackageArchive(bytes, prefix);
    fs.writeFileSync(
      join(logs, name + "-inventory.log"),
      entries.join("\n") + "\n",
    );
    run(name + "-extract", "tar", ["-xzf", "-", "-C", destination], {
      input: bytes,
    });
    return join(destination, prefix);
  }
  try {
    const packageExpected = extract(
      "runtime",
      runtimeTarball,
      packageArchive,
      "package",
      manifest.artifacts.runtime,
    );
    const crateRoot = extract(
      "crate",
      engineTarball,
      engineArchive,
      `${manifest.artifacts.engine.name}-${manifest.artifacts.engine.version}`,
      manifest.artifacts.engine,
    );
    let installedTools, toolsExpected, toolsSource;
    if (toolsBytes) {
      const extracted = join(temporary, "tools-archive"),
        toolsWork = join(temporary, "tools-consumer");
      fs.mkdirSync(extracted);
      fs.mkdirSync(toolsWork);
      toolsExpected = extract("tools", toolsBytes, extracted, "package", {
        bytes: toolsBytes.length,
        sha256: expectedToolsSha256,
      });
      toolsSource = JSON.parse(
        fs.readFileSync(join(toolsExpected, "SOURCE.json")),
      );
      const toolsPackage = JSON.parse(
        fs.readFileSync(join(toolsExpected, "package.json")),
      );
      assert.equal(toolsSource.schemaVersion, 1);
      assert.equal(toolsSource.kind, "browser-driver-release-tools");
      assert.equal(
        toolsSource.version,
        manifest.version,
        "Tools version must match the selected bundle",
      );
      assert.deepEqual(
        toolsSource.source,
        manifest.source,
        "Tools and bundle must identify the same frozen source",
      );
      assert.equal(toolsPackage.version, manifest.version);
      assert.equal(
        toolsPackage.name,
        manifest.artifacts.runtime.name.replace(/\/runtime$/, "/release-tools"),
      );
      assert.equal(toolsSource.name, toolsPackage.name);
      const verifiedArchive = join(temporary, "verified-tools.tgz");
      fs.writeFileSync(verifiedArchive, toolsBytes);
      fs.writeFileSync(
        join(toolsWork, "package.json"),
        JSON.stringify({
          name: "isolated-native-tools-acceptance",
          version: "1.0.0",
          private: true,
          type: "module",
        }),
      );
      run("native-tools-install", "npm", [
        "install",
        "--prefix",
        toolsWork,
        "--workspaces=false",
        "--offline",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--cache",
        cache,
        verifiedArchive,
      ]);
      installedTools = join(toolsWork, "node_modules", toolsPackage.name);
      result.installedNativeTools = {
        archiveSha256: expectedToolsSha256,
        sourceReceiptSha256: sha256(join(installedTools, "SOURCE.json")),
        inventory: verifyInstalledRuntime(toolsExpected, installedTools),
      };
    }
    const requireFromRepo = createRequire(join(repoRoot, "package.json"));
    const dependencyTarballs = [];
    for (const name of ["playwright", "playwright-core"]) {
      const packageRoot = dirname(
        requireFromRepo.resolve(name + "/package.json"),
      );
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
      dependencyTarballs.push(join(dependencies, packed[0].filename));
    }
    fs.writeFileSync(
      join(work, "package.json"),
      JSON.stringify(
        {
          name: "isolated-browser-driver-release-consumer",
          version: "1.0.0",
          private: true,
          type: "module",
        },
        null,
        2,
      ),
    );
    run("npm-install", "npm", [
      "install",
      "--prefix",
      work,
      "--workspaces=false",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--cache",
      cache,
      runtimeTarball,
      ...dependencyTarballs,
    ]);
    const installed = join(
      work,
      "node_modules",
      manifest.artifacts.runtime.name,
    );
    result.installedRuntime = verifyInstalledRuntime(
      packageExpected,
      installed,
    );
    const pkg = JSON.parse(fs.readFileSync(join(installed, "package.json")));
    assert.equal(pkg.name, manifest.artifacts.runtime.name);
    assert.equal(pkg.version, manifest.artifacts.runtime.version);
    if (pkg.name === "@daedlo/runtime") {
      for (const alias of ["daedlo", "browser-driver"]) {
        assert.equal(pkg.bin[alias], "./src/cli.mjs");
        const help = run(
          `installed-${alias}-help`,
          join(work, "node_modules/.bin", alias),
          ["--help"],
        );
        assert.match(help, /daedlo --project PATH/);
      }
    }
    const entry = run("public-package-resolution", process.execPath, [
      "--input-type=module",
      "-e",
      `console.log(import.meta.resolve(${JSON.stringify(manifest.artifacts.runtime.name)}));`,
    ]).trim();
    assert.ok(
      entry.startsWith(pathToFileURL(installed + "/").href),
      "Ordinary package import must resolve inside the independent installation",
    );
    assert.ok(
      !entry.startsWith(pathToFileURL(join(repoRoot, "packages/runtime")).href),
    );
    const engineProject = join(work, "notebook-engine");
    fs.cpSync(
      join(repoRoot, "examples/notebook-engine/src"),
      join(engineProject, "src"),
      { recursive: true },
    );
    fs.copyFileSync(
      join(repoRoot, "Cargo.lock"),
      join(engineProject, "Cargo.lock"),
    );
    const cargo = `[package]\nname = "notebook-engine"\nversion = ${JSON.stringify(manifest.artifacts.engine.version)}\nedition = "2021"\nrust-version = ${JSON.stringify(manifest.compatibility.rustVersion)}\nlicense = "MIT"\npublish = false\n\n[workspace]\n\n[dependencies]\ndaedlo-engine = { package = ${JSON.stringify(manifest.artifacts.engine.name)}, path = ${JSON.stringify(crateRoot)}, version = ${JSON.stringify("=" + manifest.artifacts.engine.version)} }\nserde = { version = "1", features = ["derive"] }\nserde_json = "1"\n`;
    fs.writeFileSync(join(engineProject, "Cargo.toml"), cargo);
    const target = join(temporary, "engine-target");
    run(
      "customer-engine-build",
      "cargo",
      [
        "build",
        "--locked",
        "--offline",
        "--manifest-path",
        join(engineProject, "Cargo.toml"),
      ],
      {
        env: {
          CARGO_TARGET_DIR: target,
          RUSTUP_TOOLCHAIN: rustVersion,
        },
        timeout: 300000,
      },
    );
    const enginePath = join(
      target,
      "debug",
      "notebook-engine" + (process.platform === "win32" ? ".exe" : ""),
    );
    result.engineExecutableSha256 = sha256(enginePath);
    fs.mkdirSync(join(work, "tests"));
    fs.copyFileSync(
      join(repoRoot, "tests/acceptance.mjs"),
      join(work, "tests/acceptance.mjs"),
    );
    fs.cpSync(
      join(repoRoot, "examples/notebook"),
      join(work, "examples/notebook"),
      { recursive: true },
    );
    const browserOutput = join(output, "browser");
    run(
      "packaged-browser",
      process.execPath,
      [join(work, "tests/acceptance.mjs")],
      {
        env: {
          BROWSER_DRIVER_ACCEPTANCE_RUNTIME: manifest.artifacts.runtime.name,
          BROWSER_DRIVER_ACCEPTANCE_ENGINE: enginePath,
          BROWSER_DRIVER_ACCEPTANCE_OUTPUT: browserOutput,
        },
      },
    );
    const browser = JSON.parse(
      fs.readFileSync(join(browserOutput, "results.json")),
    );
    assert.equal(
      browser.results.length,
      8,
      "All eight independent browser groups must run",
    );
    assert.ok(
      browser.results.every((row) => row.status === "PASS"),
      "Every packaged browser group must pass",
    );
    assert.equal(browser.cleanup, "PASS");
    assert.equal(browser.report.identity.runtime, `${pkg.name}@${pkg.version}`);
    assert.equal(
      browser.report.identity.engineSha256,
      result.engineExecutableSha256,
    );
    result.browserGroups = browser.results.map(({ name, status }) => ({
      name,
      status,
    }));
    result.runtimeBuild = browser.report.identity.runtimeBuild;
    Object.assign(
      result,
      await runInstalledControls({
        repoRoot,
        work,
        installed,
        entry,
        output,
        run,
        source: manifest.source,
        version: pkg.version,
      }),
    );
    run(
      "installed-frontend-viewer",
      process.execPath,
      [
        "--test",
        join(repoRoot, "packages/runtime/tests/viewer-frontend-browser.mjs"),
      ],
      {
        env: {
          CLI_TEST_RUNTIME: fileURLToPath(entry),
          FRONTEND_VIEWER_OUTPUT: join(output, "frontend-viewer"),
        },
      },
    );
    result.frontendViewer = "PASS";
    run(
      "installed-recipe-paths-viewer",
      process.execPath,
      [
        "--test",
        join(
          repoRoot,
          "packages/runtime/tests/viewer-recipe-paths-browser.mjs",
        ),
      ],
      {
        env: {
          CLI_TEST_RUNTIME: fileURLToPath(entry),
          RECIPE_PATHS_OUTPUT: join(output, "recipe-paths-viewer"),
        },
      },
    );
    result.recipePathsViewer = "PASS";
    if (installedTools) {
      Object.assign(
        result,
        runInstalledNativeAcceptance(
          {
            repoRoot,
            installedTools,
            runtimePath: fileURLToPath(entry),
            enginePath,
            engineCrate: crateRoot,
            targetDir: join(temporary, "native-target"),
            output,
            runtimeName: pkg.name,
            runtimeVersion: pkg.version,
            engineSha256: result.engineExecutableSha256,
          },
          { run },
        ),
      );
      result.installedNativeTools.inventory = verifyInstalledRuntime(
        toolsExpected,
        installedTools,
      );
      assert.deepEqual(
        JSON.parse(fs.readFileSync(join(installedTools, "SOURCE.json"))),
        toolsSource,
        "Installed tools source receipt changed during acceptance",
      );
      assert.equal(
        sha256(toolsArchive),
        expectedToolsSha256,
        "Selected tools archive changed during acceptance",
      );
    }

    result.installedRuntime = verifyInstalledRuntime(
      packageExpected,
      installed,
    );
    await verifyBundle(bundle, { expectedManifestSha256, environment });
    result.status = "PASS";
    console.log(
      `PASS isolated release ${manifest.version}: exact package/crate and 8 browser groups`,
    );
    return result;
  } catch (error) {
    result.error = error.message;
    throw error;
  } finally {
    try {
      fs.rmSync(temporary, { recursive: true, force: true });
      result.cleanup = "PASS";
    } catch {
      result.cleanup = "FAIL";
      result.retainedOwnedDirectory = temporary;
      process.exitCode = 1;
    }
    fs.writeFileSync(
      join(output, "results.json"),
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
    output,
    expectedManifestSha256,
    toolsArchive,
    expectedToolsSha256,
  ] = process.argv.slice(2);
  if (
    !bundle ||
    !output ||
    !expectedManifestSha256 ||
    ![5, 7].includes(process.argv.length)
  )
    throw Error(
      "Usage: node tests/release-acceptance.mjs BUNDLE_DIR FRESH_OUTPUT EXPECTED_MANIFEST_SHA256 [TOOLS_ARCHIVE EXPECTED_TOOLS_SHA256]",
    );
  await runReleaseAcceptance({
    bundle,
    output,
    expectedManifestSha256,
    toolsArchive,
    expectedToolsSha256,
  });
}
