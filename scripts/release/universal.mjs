import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// These two frozen distributions are independent of the basic kit and its feed.
const packages = fileURLToPath(new URL("../../packages/", import.meta.url));
const version = "0.1.0-alpha.6";
const workspaceSha =
  "3f32ad5cbad60c649b96b0c989bbb47eb168d325f46b9d1a717ce4b5bbf8a6f9";
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

async function pack(name, temporary, expectedSha) {
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
  const temporary = await fs.mkdtemp(join(tmpdir(), "universal-alpha6-pack-"));
  try {
    await fs.writeFile(join(temporary, "npmrc"), "");
    await fs.writeFile(join(temporary, "global-npmrc"), "");
    const universal = await pack("universal", temporary, workspaceSha);
    const reference = JSON.parse(
      await fs.readFile(join(packages, "universal/SOURCE.json"), "utf8"),
    );
    // The workspace is the byte-identical original. Preserve its original source
    // receipt; the public release checkout adds the separately named companion.
    assert.equal(
      reference.source.commit,
      "1d1a87646003b7e03b01a16693317a1e166ee21b",
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
      archive: universal.archive,
      fileCount: universal.files.length,
    };

    const runtime = await pack("universal-runtime", temporary, runtimeSha);
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
      version,
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
