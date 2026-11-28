import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { sha256 } from "./manifest.mjs";
import { readArchive, readRegular } from "./public-kit.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const version = "0.1.0-alpha.7";
const runtimeVersion = "0.1.0-alpha.6";
const engineVersion = "0.1.4-alpha.9";
const universalFile = `daedlo-universal-${version}.tgz`;
const runtimeFile = `daedlo-universal-runtime-${runtimeVersion}.tgz`;
const engineFile = `daedlo-engine-${engineVersion}.crate`;
const basicZip = `daedlo-${engineVersion}.zip`;
const limits = 4 * 1024 * 1024;
const expected = {
  universal: "7cda746ce1b5e31bb5a558d330dd29b453f81a47d7ee6d185ffb7c60bd2414b4",
  workspaceReceipt:
    "cefa21fb7a89a8122ba753d282ff41253b665c127e25a3598c3571be6d24c628",
  runtime: "40c49a9152870bd31a0df87354f0ef55c00830f6a6d41da9c4e1155d09cc261a",
  basicZip: "81b252cc4853278360e893713c778676b492df5d60afe4f19d7880484327f4b2",
  engine: "aa870ad72c7e5224e014800c59aa7294c1cf47c712239a8c08813230cb939139",
};
const json = (value) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const artifact = (file, bytes) => ({
  file,
  bytes: bytes.length,
  sha256: sha256(bytes),
});

function checked(bytes, digest, description) {
  assert.equal(
    sha256(bytes),
    digest,
    `Unexpected frozen ${description} digest`,
  );
  return bytes;
}

async function screenPublicText(components, documents) {
  const staging = await fs.mkdtemp(join(tmpdir(), "daedlo-universal-public-"));
  try {
    for (const [component, files] of components) {
      for (const [name, { bytes }] of files) {
        // These exact distributions contain text sources, metadata and notices.
        new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        const path = join(staging, component, name);
        await fs.mkdir(dirname(path), { recursive: true });
        await fs.writeFile(path, bytes, { flag: "wx" });
      }
    }
    for (const [name, bytes] of documents)
      await fs.writeFile(join(staging, name), bytes, { flag: "wx" });
    for (const args of [
      ["init", "-q"],
      ["add", "-f", "--", "."],
    ])
      execFileSync("git", args, { cwd: staging, stdio: "pipe" });
    execFileSync(
      process.execPath,
      [join(repo, "scripts/check-public-metadata.mjs")],
      { cwd: staging, stdio: "pipe" },
    );
  } finally {
    await fs.rm(staging, { recursive: true });
  }
}

export async function stageUniversalRelease({ packages, engineKit, output }) {
  assert.equal(
    execFileSync("git", ["status", "--porcelain"], {
      cwd: repo,
      encoding: "utf8",
    }).trim(),
    "",
    "Public Universal staging requires clean source",
  );
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
  }).trim();
  assert.match(sourceCommit, /^[0-9a-f]{40}$/);
  const [
    universalBytes,
    runtimeBytes,
    kitBytes,
    guide,
    workspaceReceipt,
    runtimeReceipt,
    packageSums,
  ] = await Promise.all([
    readRegular(join(packages, universalFile), limits),
    readRegular(join(packages, runtimeFile), limits),
    readRegular(engineKit, limits),
    readRegular(join(repo, "docs/universal-alpha7-release.md"), limits),
    readRegular(join(packages, "UNIVERSAL_VERIFICATION.json"), limits),
    readRegular(join(packages, "UNIVERSAL_RUNTIME_VERIFICATION.json"), limits),
    readRegular(join(packages, "UNIVERSAL_SHA256SUMS"), limits),
  ]);
  const universal = readArchive(
    checked(universalBytes, expected.universal, "Universal"),
    "package",
  );
  const runtime = readArchive(
    checked(runtimeBytes, expected.runtime, "recording runtime"),
    "package",
  );
  checked(kitBytes, expected.basicZip, "public engine kit");
  const engineBytes = execFileSync(
    "python3",
    [
      "-c",
      "import io,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); sys.stdout.buffer.write(z.read(sys.argv[1]))",
      `daedlo-${engineVersion}/bundle/${engineFile}`,
    ],
    { input: kitBytes, maxBuffer: limits, stdio: ["pipe", "pipe", "pipe"] },
  );
  const engine = readArchive(
    checked(engineBytes, expected.engine, "public model SDK"),
    `daedlo-engine-${engineVersion}`,
  );
  const inventory = JSON.parse(universal.get("SOURCE.json").bytes);
  assert.equal(
    inventory.source.commit,
    "3587be1cb084720656e1682ef46d8bc02cb2f93a",
  );
  assert.equal(inventory.source.dirty, false);
  assert.equal(inventory.name, "@daedlo/universal");
  assert.equal(inventory.version, version);
  assert.equal(universal.size, 111);
  assert.equal(inventory.files.length, universal.size - 1);
  assert.deepEqual(
    inventory.files.map((item) => item.file).sort(),
    [...universal.keys()].filter((name) => name !== "SOURCE.json").sort(),
  );
  for (const entry of inventory.files)
    assert.deepEqual(
      artifact(entry.file, universal.get(entry.file).bytes),
      entry,
    );
  const manifest = JSON.parse(runtime.get("package.json").bytes);
  assert.equal(manifest.name, "@daedlo/universal-runtime");
  assert.equal(manifest.version, runtimeVersion);
  assert.equal(
    JSON.parse(runtime.get("src/capabilities.json").bytes).runJournal,
    1,
  );
  checked(
    workspaceReceipt,
    expected.workspaceReceipt,
    "workspace verification receipt",
  );
  assert.deepEqual(JSON.parse(workspaceReceipt), {
    ...inventory,
    archive: artifact(universalFile, universalBytes),
    fileCount: universal.size,
  });
  const recording = JSON.parse(runtimeReceipt);
  assert.deepEqual(recording, {
    kind: "daedlo-universal-runtime",
    name: manifest.name,
    version: manifest.version,
    archive: artifact(runtimeFile, runtimeBytes),
    referenceRuntime: {
      archiveSha256:
        "5847471b106d4e849d0fe88f4f1c9119f8d1e6ea251d82e582a5e398124cdec1",
      unchangedSourceFiles: 26,
    },
    files: [...runtime.keys()]
      .sort()
      .map((name) => artifact(name, runtime.get(name).bytes)),
  });
  assert.deepEqual(
    packageSums,
    Buffer.from(
      [
        [universalFile, universalBytes],
        [runtimeFile, runtimeBytes],
        ["UNIVERSAL_VERIFICATION.json", workspaceReceipt],
        ["UNIVERSAL_RUNTIME_VERIFICATION.json", runtimeReceipt],
      ]
        .map(([file, bytes]) => `${sha256(bytes)}  ${file}\n`)
        .join(""),
    ),
  );
  const components = new Map([
    ["workspace", universal],
    ["runtime", runtime],
    ["engine", engine],
  ]);
  const assets = new Map([
    [universalFile, universalBytes],
    [runtimeFile, runtimeBytes],
    [engineFile, engineBytes],
    ["INSTALL.md", guide],
    ["UNIVERSAL_VERIFICATION.json", workspaceReceipt],
    ["UNIVERSAL_RUNTIME_VERIFICATION.json", runtimeReceipt],
    ["UNIVERSAL_SHA256SUMS", packageSums],
  ]);
  assets.set(
    "release.json",
    json({
      format: "daedlo-universal-release/1",
      version,
      tag: `universal-v${version}`,
      sourceCommit,
      components: {
        workspace: artifact(universalFile, universalBytes),
        recordingRuntime: artifact(runtimeFile, runtimeBytes),
        modelSdk: artifact(engineFile, engineBytes),
      },
      engineKit: {
        version: engineVersion,
        source: `https://daedlo.com/downloads/${engineVersion}/${basicZip}`,
        sha256: expected.basicZip,
      },
      files: [...assets].map(([name, bytes]) => artifact(name, bytes)),
    }),
  );
  assets.set(
    "SHA256SUMS",
    Buffer.from(
      [...assets]
        .map(([name, bytes]) => `${sha256(bytes)}  ${name}\n`)
        .join(""),
    ),
  );
  await screenPublicText(
    components,
    [...assets].filter(
      ([name]) => !name.endsWith(".tgz") && !name.endsWith(".crate"),
    ),
  );
  await fs.mkdir(output);
  for (const [name, bytes] of assets)
    await fs.writeFile(join(output, name), bytes, { flag: "wx" });
  return {
    tag: `universal-v${version}`,
    sourceCommit,
    files: [...assets].map(([name, bytes]) => artifact(name, bytes)),
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { values } = parseArgs({
      options: {
        packages: { type: "string" },
        "engine-kit": { type: "string" },
        output: { type: "string" },
      },
    });
    if (!values.packages || !values["engine-kit"] || !values.output)
      throw Error(
        "Usage: universal-public.mjs --packages DIR --engine-kit FILE --output NEW_DIR",
      );
    const receipt = await stageUniversalRelease({
      packages: resolve(values.packages),
      engineKit: resolve(values["engine-kit"]),
      output: resolve(values.output),
    });
    console.log(JSON.stringify(receipt, null, 2));
  } catch {
    // A rejected sidecar or filesystem error may contain private values.
    // The public job emits only the gate result. Detailed diagnostics are
    // available to a maintainer calling stageUniversalRelease locally.
    console.error(
      "Universal distribution staging failed. Check the clean release source, frozen archives, package inventories and fresh output directory.",
    );
    process.exitCode = 1;
  }
}
