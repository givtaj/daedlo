import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// These two frozen distributions are independent of the basic kit and its feed.
const packages = fileURLToPath(new URL("../../packages/", import.meta.url));
const workspaceVersion = "0.1.0-alpha.7";
const runtimeVersion = "0.1.0-alpha.6";
const workspaceSha =
  "7cda746ce1b5e31bb5a558d330dd29b453f81a47d7ee6d185ffb7c60bd2414b4";
const runtimeSha =
  "40c49a9152870bd31a0df87354f0ef55c00830f6a6d41da9c4e1155d09cc261a";
const referenceRuntimeSha =
  "5847471b106d4e849d0fe88f4f1c9119f8d1e6ea251d82e582a5e398124cdec1";
const referenceSourceSha =
  "0be312026ce2b82f0fe9fcecf90ac868c28eaf0fc664df3258e0ecbfb9453f8b";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const formatted = (value) => JSON.stringify(value, null, 2) + "\n";

const executableMembers = new Set([
  "src/cli.mjs",
  "vendor/tools/lib/consumer-cli.mjs",
  "vendor/tools/lib/native.mjs",
  "vendor/tools/lib/ninja.mjs",
]);

// Git preserves the executable bit but checkout permissions depend on umask.
// npm includes regular-file permissions in the tar headers. Set the original
// release modes on our private staging copy without chmod'ing the source tree.
async function stagePackage(name, temporary) {
  const source = join(packages, name);
  const destination = join(temporary, name);
  const manifest = JSON.parse(
    await fs.readFile(join(source, "package.json"), "utf8"),
  );
  const regularMode = name === "universal-runtime" ? 0o600 : 0o644;
  await fs.mkdir(destination);
  async function copy(member) {
    const path = join(source, member);
    const output = join(destination, member);
    const stat = await fs.lstat(path);
    if (stat.isDirectory()) {
      await fs.mkdir(output, { recursive: true });
      for (const entry of await fs.readdir(path))
        await copy(member + "/" + entry);
      return;
    }
    assert.ok(stat.isFile(), "Expected a regular package member: " + member);
    await fs.copyFile(path, output);
    await fs.chmod(output, executableMembers.has(member) ? 0o755 : regularMode);
  }
  for (const member of ["package.json", ...manifest.files]) {
    await copy(member);
  }
  return destination;
}

async function pack(name, version, temporary, expectedSha) {
  const directory = await stagePackage(name, temporary);
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key)),
  );
  const flags = [
    "pack",
    "--json",
    "--offline",
    "--ignore-scripts",
    "--workspaces=false",
    "--pack-destination",
    temporary,
    "--cache",
    join(temporary, "npm-cache"),
    "--userconfig",
    join(temporary, "npmrc"),
    "--globalconfig",
    join(temporary, "global-npmrc"),
  ];
  const result = JSON.parse(
    execFileSync("npm", flags, {
      cwd: directory,
      env: environment,
      encoding: "utf8",
    }),
  );
  assert.equal(result.length, 1);
  const [item] = result;
  assert.equal(item.name, "@daedlo/" + name);
  assert.equal(item.version, version);
  const file = "daedlo-" + name + "-" + version + ".tgz";
  assert.equal(item.filename, file);
  const bytes = await fs.readFile(join(temporary, file));
  assert.equal(
    digest(bytes),
    expectedSha,
    "Packed bytes differ from the verified release candidate for " + name,
  );
  const files = [];
  for (const { path } of item.files) {
    const source = await fs.readFile(join(directory, path));
    files.push({ file: path, bytes: source.length, sha256: digest(source) });
  }
  return {
    bytes,
    archive: { file, bytes: bytes.length, sha256: expectedSha },
    files,
  };
}

async function build(output) {
  const temporary = await fs.mkdtemp(join(tmpdir(), "daedlo-universal-pack-"));
  try {
    await fs.writeFile(join(temporary, "npmrc"), "");
    await fs.writeFile(join(temporary, "global-npmrc"), "");
    const universal = await pack(
      "universal",
      workspaceVersion,
      temporary,
      workspaceSha,
    );
    const reference = JSON.parse(
      await fs.readFile(join(packages, "universal/SOURCE.json"), "utf8"),
    );
    // Reconstruct the accepted workspace receipt, including its archive key order.
    assert.equal(
      reference.source.commit,
      "3587be1cb084720656e1682ef46d8bc02cb2f93a",
    );
    const files = universal.files.filter(
      (entry) => entry.file !== "SOURCE.json",
    );
    assert.deepEqual(
      files.sort((a, b) => a.file.localeCompare(b.file)),
      reference.files,
    );
    const workspaceReceipt = {
      ...reference,
      archive: {
        file: universal.archive.file,
        sha256: universal.archive.sha256,
        bytes: universal.archive.bytes,
      },
      fileCount: universal.files.length,
    };

    const runtime = await pack(
      "universal-runtime",
      runtimeVersion,
      temporary,
      runtimeSha,
    );
    const unchanged = runtime.files.filter(
      ({ file }) => file !== "package.json" && file !== "README.md",
    );
    const inventory = unchanged
      .map(({ file, sha256 }) => file + "\0" + sha256 + "\n")
      .sort()
      .join("");
    assert.equal(unchanged.length, 26);
    assert.equal(digest(inventory), referenceSourceSha);
    const runtimeReceipt = {
      kind: "daedlo-universal-runtime",
      name: "@daedlo/universal-runtime",
      version: runtimeVersion,
      archive: runtime.archive,
      referenceRuntime: {
        archiveSha256: referenceRuntimeSha,
        unchangedSourceFiles: unchanged.length,
      },
      files: runtime.files,
    };
    const assets = new Map([
      [universal.archive.file, universal.bytes],
      [runtime.archive.file, runtime.bytes],
      ["UNIVERSAL_VERIFICATION.json", formatted(workspaceReceipt)],
      ["UNIVERSAL_RUNTIME_VERIFICATION.json", formatted(runtimeReceipt)],
    ]);
    const sums =
      [...assets]
        .map(([name, contents]) => digest(contents) + "  " + name)
        .join("\n") + "\n";
    await fs.mkdir(output, { mode: 0o700 });
    for (const [name, contents] of assets) {
      await fs.writeFile(join(output, name), contents, { flag: "wx" });
    }
    await fs.writeFile(join(output, "UNIVERSAL_SHA256SUMS"), sums, {
      flag: "wx",
    });
    console.log(sums.trimEnd());
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--output" || !args[1]) {
  throw Error(
    "Usage: node scripts/release/universal.mjs --output NEW_DIRECTORY",
  );
}
await build(resolve(args[1]));
