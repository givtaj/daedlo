import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyBundle } from "../scripts/release/manifest.mjs";
import {
  validatePackageArchive,
  verifyInstalledRuntime,
} from "./release-acceptance.mjs";
import { verifyToolsSource } from "./alpha4-installed-starter.mjs";
import { runSwaggerBrowserAcceptance } from "./fixtures/swagger-acceptance.mjs";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const requiredFiles = [
  "README.md",
  "runtime.mjs",
  "session.mjs",
  "project.mjs",
  "build-model.mjs",
  "engine/Cargo.toml",
  "engine/Cargo.lock",
  "engine/src/lib.rs",
  "engine/src/main.rs",
];
export function requireInstalledSwagger(toolsRoot) {
  for (const file of requiredFiles)
    assert.ok(
      fs.existsSync(join(toolsRoot, "integrations/swagger", file)),
      "Verified tools must ship complete Swagger integration: " + file,
    );
}
export function cleanupInstalledSwaggerConsumer({
  temporary,
  ownedIdentity,
  result,
  cleanupIncomplete = false,
}) {
  if (cleanupIncomplete) {
    result.cleanup = "FAIL";
    result.status = "FAIL";
    result.retainedTemporary = temporary;
    return;
  }
  try {
    const current = fs.lstatSync(temporary);
    assert.ok(
      current.isDirectory() &&
        !current.isSymbolicLink() &&
        current.dev === ownedIdentity.dev &&
        current.ino === ownedIdentity.ino,
      "Owned temporary directory was replaced",
    );
    fs.rmSync(temporary, { recursive: true });
    result.cleanup = "PASS";
  } catch {
    result.cleanup = "FAIL";
    result.status = "FAIL";
    result.retainedTemporary = temporary;
  }
}

export function recordSwaggerCleanupFailure(error, result) {
  if (error?.code !== "cleanup_incomplete") return false;
  const labels = [
    "CLI child",
    "driver session",
    "observer browser",
    "API fixture",
    "CLI diagnostic log",
  ];
  const handles =
    Array.isArray(error.failedResources) && error.failedResources.length
      ? error.failedResources.slice(0, 5)
      : [{}];
  result.failedResources = handles.map((resource) => ({
    label: labels.includes(resource?.label)
      ? resource.label
      : "Swagger resource",
    ...(Number.isSafeInteger(resource?.pid) && resource.pid > 0
      ? { pid: resource.pid }
      : {}),
  }));
  return true;
}

export async function runInstalledSwagger({
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
  assert.ok(
    fs.lstatSync(toolsArchive).isFile() &&
      !fs.lstatSync(toolsArchive).isSymbolicLink(),
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
  const { manifest } = await verifyBundle(bundle, {
    expectedManifestSha256,
    environment: {
      protocol: 1,
      nodeVersion: process.versions.node,
      rustVersion,
    },
  });
  assert.equal(manifest.artifacts.runtime.name, "@daedlo/runtime");
  assert.equal(manifest.artifacts.engine.name, "daedlo-engine");
  fs.mkdirSync(dirname(output), { recursive: true });
  fs.mkdirSync(output);
  const logs = join(output, "logs");
  fs.mkdirSync(logs);
  const temporary = fs.realpathSync(
    fs.mkdtempSync(join(tmpdir(), "daedlo-installed-swagger-")),
  );
  const ownedIdentity = fs.lstatSync(temporary);
  const result = {
    schemaVersion: 1,
    status: "FAIL",
    cleanup: "PENDING",
    version: manifest.version,
    source: manifest.source,
    manifestSha256: expectedManifestSha256,
    toolsArchiveSha256: expectedToolsSha256,
    runtimeArchiveSha256: manifest.artifacts.runtime.sha256,
    crateArchiveSha256: manifest.artifacts.engine.sha256,
    testLevel:
      "exact installed tools/runtime, shipped Swagger model rebuilt against exact crate, installed CLI and real Swagger UI",
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    rust: rustVersion,
  };
  const work = join(temporary, "consumer"),
    cache = join(temporary, "npm-cache"),
    npmConfig = join(temporary, "npm.conf"),
    globalConfig = join(temporary, "npm-global.conf");
  fs.mkdirSync(work);
  fs.writeFileSync(npmConfig, "");
  fs.writeFileSync(globalConfig, "");
  fs.writeFileSync(
    join(work, "package.json"),
    JSON.stringify({
      name: "isolated-installed-swagger",
      private: true,
      version: "1.0.0",
      type: "module",
    }),
  );
  function run(
    name,
    program,
    args,
    { input, timeout = 180000, env = {} } = {},
  ) {
    try {
      const stdout = execFileSync(program, args, {
        cwd: work,
        input,
        encoding: "utf8",
        timeout,
        maxBuffer: 32 * 1024 * 1024,
        env: {
          ...process.env,
          NODE_PATH: "",
          NPM_CONFIG_USERCONFIG: npmConfig,
          NPM_CONFIG_GLOBALCONFIG: globalConfig,
          ...env,
        },
        stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      });
      fs.writeFileSync(join(logs, name + ".log"), stdout);
      return stdout;
    } catch (error) {
      fs.writeFileSync(
        join(logs, name + ".log"),
        String(error.stdout ?? "") + String(error.stderr ?? ""),
      );
      throw Error("Installed Swagger step failed: " + name);
    }
  }
  function extract(name, bytes, prefix) {
    validatePackageArchive(bytes, prefix);
    const destination = join(temporary, name + "-extracted");
    fs.mkdirSync(destination);
    run(name + "-extract", "tar", ["-xzf", "-", "-C", destination], {
      input: bytes,
    });
    return join(destination, prefix);
  }
  let cleanupIncomplete = false;
  try {
    assert.notEqual(
      spawnSync("git", ["rev-parse", "--show-toplevel"], {
        cwd: temporary,
        stdio: "ignore",
      }).status,
      0,
      "The installed consumer must be outside a Git checkout",
    );
    const toolsExpected = extract("tools", toolsBytes, "package");
    requireInstalledSwagger(toolsExpected);
    const selected = {};
    for (const kind of ["runtime", "engine"]) {
      const artifact = manifest.artifacts[kind],
        bytes = fs.readFileSync(join(bundle, artifact.file));
      assert.equal(sha(bytes), artifact.sha256);
      assert.equal(bytes.length, artifact.bytes);
      const archive = join(temporary, artifact.file);
      fs.writeFileSync(archive, bytes);
      selected[kind] = {
        archive,
        root: extract(
          kind,
          bytes,
          kind === "runtime"
            ? "package"
            : `${artifact.name}-${artifact.version}`,
        ),
      };
    }
    const crateBefore = verifyInstalledRuntime(
      selected.engine.root,
      selected.engine.root,
    );
    const toolsCopy = join(temporary, "verified-tools.tgz");
    fs.writeFileSync(toolsCopy, toolsBytes);
    const dependencyDir = join(temporary, "dependency-archives");
    fs.mkdirSync(dependencyDir);
    const repoRequire = createRequire(join(repoRoot, "package.json")),
      dependencies = [];
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
          dependencyDir,
          "--cache",
          cache,
        ]),
      );
      assert.equal(packed.length, 1);
      assert.equal(packed[0].name, name);
      dependencies.push(join(dependencyDir, packed[0].filename));
    }
    run("install", "npm", [
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
      toolsCopy,
      selected.runtime.archive,
      ...dependencies,
    ]);
    const toolsRoot = join(work, "node_modules/@daedlo/release-tools"),
      runtimeRoot = join(work, "node_modules/@daedlo/runtime");
    result.runtimeInventory = verifyInstalledRuntime(
      selected.runtime.root,
      runtimeRoot,
    );
    verifyInstalledRuntime(toolsExpected, toolsRoot);
    result.toolsInventory = verifyToolsSource(toolsRoot, manifest);
    requireInstalledSwagger(toolsRoot);
    const publicUrls = JSON.parse(
      run("runtime-resolution", process.execPath, [
        "--input-type=module",
        "-e",
        'console.log(JSON.stringify([import.meta.resolve("@daedlo/runtime"),import.meta.resolve("@daedlo/runtime/swagger")]));',
      ]),
    );
    for (const url of publicUrls)
      assert.ok(
        url.startsWith(pathToFileURL(runtimeRoot + "/").href),
        "Product imports must resolve within the exact installed runtime",
      );
    const build = JSON.parse(
      run(
        "model-build",
        process.execPath,
        [
          join(toolsRoot, "integrations/swagger/build-model.mjs"),
          "--crate",
          selected.engine.root,
          "--output",
          join(temporary, "model-build"),
          "--offline",
        ],
        { env: { RUSTUP_TOOLCHAIN: rustVersion }, timeout: 300000 },
      ),
    );
    assert.equal(build.cratePath, selected.engine.root);
    assert.equal(build.version, manifest.version);
    const modelManifest = fs.readFileSync(
      join(build.model, "Cargo.toml"),
      "utf8",
    );
    assert.ok(modelManifest.includes(`version = "=${manifest.version}"`));
    assert.ok(modelManifest.includes(JSON.stringify(selected.engine.root)));
    assert.deepEqual(
      fs.readFileSync(join(build.model, "Cargo.lock")),
      fs.readFileSync(
        join(toolsRoot, "integrations/swagger/engine/Cargo.lock"),
      ),
      "Locked model build must preserve the shipped lockfile",
    );
    const browserResult = await runSwaggerBrowserAcceptance({
      toolsRoot,
      runtimeRoot,
      enginePath: build.enginePath,
      output,
    });
    assert.equal(
      browserResult.checks.length,
      13,
      "All installed Swagger acceptance groups must run",
    );
    assert.equal(new Set(browserResult.checks).size, 13);
    Object.assign(result, browserResult);
    result.runtimeInventory = verifyInstalledRuntime(
      selected.runtime.root,
      runtimeRoot,
    );
    verifyInstalledRuntime(toolsExpected, toolsRoot);
    result.toolsInventory = verifyToolsSource(toolsRoot, manifest);
    assert.deepEqual(
      verifyInstalledRuntime(selected.engine.root, selected.engine.root),
      crateBefore,
      "Building must not modify the selected core crate",
    );
    assert.equal(sha(fs.readFileSync(toolsArchive)), expectedToolsSha256);
    result.status = "PASS";
  } catch (error) {
    cleanupIncomplete = recordSwaggerCleanupFailure(error, result);
    throw error;
  } finally {
    cleanupInstalledSwaggerConsumer({
      temporary,
      ownedIdentity,
      result,
      cleanupIncomplete,
    });
    fs.writeFileSync(
      join(output, "summary.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
  }
  assert.equal(
    result.cleanup,
    "PASS",
    "Installed Swagger cleanup must complete",
  );
  return result;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [
    bundle,
    toolsArchive,
    expectedToolsSha256,
    expectedManifestSha256,
    output,
  ] = process.argv.slice(2);
  if (!bundle || !toolsArchive || !output)
    throw Error(
      "Usage: swagger-installed-acceptance.mjs BUNDLE TOOLS_TGZ TOOLS_SHA256 MANIFEST_SHA256 FRESH_OUTPUT",
    );
  console.log(
    JSON.stringify(
      await runInstalledSwagger({
        bundle,
        toolsArchive,
        expectedToolsSha256,
        expectedManifestSha256,
        output,
      }),
      null,
      2,
    ),
  );
}
