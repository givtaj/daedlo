import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { buildBundle } from "../scripts/release/build.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const version = "0.1.1-rc.1";

async function fixture(t, releaseVersion = version) {
  const directory = await fs.mkdtemp(join(os.tmpdir(), "driver-release-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const repoRoot = join(directory, "source");
  await fs.mkdir(join(repoRoot, "packages/runtime/src"), { recursive: true });
  await fs.mkdir(join(repoRoot, "crates/browser-driver-engine/src"), {
    recursive: true,
  });
  const files = {
    ".gitignore": "artifacts/\nnode_modules/\ntarget/\n.env\n",
    "README.md": "Public release fixture.\n",
    "packages/runtime/package.json": JSON.stringify({
      name: "@browser-driver/runtime",
      version: releaseVersion,
      type: "module",
      files: ["src"],
      scripts: { prepack: 'node -e "process.exit(72)"' },
    }),
    "packages/runtime/src/index.mjs": "export const fixture = true;\n",
    "Cargo.toml": `[workspace]\nmembers = ["crates/browser-driver-engine"]\nresolver = "2"\n\n[workspace.package]\nversion = "${releaseVersion}"\nedition = "2021"\n`,
    "crates/browser-driver-engine/Cargo.toml":
      '[package]\nname = "browser-driver-engine"\nversion.workspace = true\nedition.workspace = true\nlicense = "MIT"\ndescription = "Release contract fixture"\n',
    "crates/browser-driver-engine/src/lib.rs": "pub const PROTOCOL: u32 = 1;\n",
    "rust-toolchain.toml": '[toolchain]\nchannel = "1.96.0"\n',
  };
  for (const [path, bytes] of Object.entries(files)) {
    await fs.writeFile(join(repoRoot, path), bytes);
  }
  execFileSync("cargo", ["generate-lockfile", "--offline"], {
    cwd: repoRoot,
    stdio: "pipe",
  });
  const git = (args) =>
    execFileSync("git", ["-C", repoRoot, ...args], {
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  git(["init", "-q"]);
  git(["add", "."]);
  git([
    "-c",
    "user.name=Release test",
    "-c",
    "user.email=release@example.test",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-qm",
    "Fixture baseline",
  ]);
  return {
    directory,
    repoRoot,
    output: join(directory, "release"),
    commit: git(["rev-parse", "HEAD"]),
    git,
  };
}

test("actual npm and verified Cargo bundles reproduce all bytes", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(join(f.repoRoot, ".env"), "PRIVATE_TEST_SENTINEL");
  const first = await buildBundle(f);
  assert.ok(first.manifest, "A built release must return its manifest");
  assert.equal(first.manifest.version, version);
  assert.deepEqual(first.manifest.source, {
    commit: f.commit,
    dirty: false,
    treeSha256: first.manifest.source.treeSha256,
  });
  assert.match(first.manifest.source.treeSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual((await fs.readdir(f.output)).sort(), [
    "SHA256SUMS",
    `browser-driver-engine-${version}.crate`,
    `browser-driver-runtime-${version}.tgz`,
    "manifest.json",
  ]);
  const second = await buildBundle({
    ...f,
    output: join(f.directory, "second-release"),
  });
  assert.equal(second.manifestSha256, first.manifestSha256);
  for (const file of await fs.readdir(f.output)) {
    assert.deepEqual(
      await fs.readFile(join(f.output, file)),
      await fs.readFile(join(second.output, file)),
      `${file} must be independent of the build directory and time`,
    );
  }
  const manifestBytes = await fs.readFile(join(f.output, "manifest.json"));
  assert.equal(hash(manifestBytes), first.manifestSha256);
  assert.equal(manifestBytes.includes("PRIVATE_TEST_SENTINEL"), false);
  assert.equal(manifestBytes.includes(f.directory), false);
  for (const artifact of Object.values(first.manifest.artifacts)) {
    const bytes = await fs.readFile(join(f.output, artifact.file));
    assert.equal(hash(bytes), artifact.sha256);
    assert.equal(bytes.byteLength, artifact.bytes);
  }
  assert.equal(f.git(["status", "--porcelain"]), "");
});

test("dirty sources are refused by default before output creation", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(join(f.repoRoot, "README.md"), "Changed source.\n");
  await assert.rejects(buildBundle(f), /dirty|clean/i);
  assert.equal(existsSync(f.output), false);
});

test("valid prerelease identifiers with repeated hyphens build ordinary packages", async (t) => {
  const releaseVersion = "0.1.1-rc--1";
  const f = await fixture(t, releaseVersion);
  const result = await buildBundle(f);
  assert.equal(result.manifest.version, releaseVersion);
  assert.equal(
    result.manifest.artifacts.runtime.file,
    `browser-driver-runtime-${releaseVersion}.tgz`,
  );
  assert.equal(
    result.manifest.artifacts.engine.file,
    `browser-driver-engine-${releaseVersion}.crate`,
  );
});

test("explicit dirty candidates include nonignored additions in source identity", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    join(f.repoRoot, "review.txt"),
    "First reviewed candidate.\n",
  );
  const first = await buildBundle({ ...f, allowDirty: true });
  assert.ok(first.manifest, "Dirty candidates must return source metadata");
  assert.equal(first.manifest.source.dirty, true);
  await fs.writeFile(
    join(f.repoRoot, "review.txt"),
    "Second reviewed candidate.\n",
  );
  const second = await buildBundle({
    ...f,
    allowDirty: true,
    output: join(f.directory, "second-release"),
  });
  assert.notEqual(
    first.manifest.source.treeSha256,
    second.manifest.source.treeSha256,
  );
  assert.equal(first.manifest.source.commit, second.manifest.source.commit);
});

test("runtime and workspace versions must agree before packing", async (t) => {
  const f = await fixture(t);
  const path = join(f.repoRoot, "packages/runtime/package.json");
  const runtime = JSON.parse(await fs.readFile(path, "utf8"));
  runtime.version = "0.2.0";
  await fs.writeFile(path, JSON.stringify(runtime));
  await assert.rejects(
    buildBundle({ ...f, allowDirty: true }),
    /version.*match|versions.*agree/i,
  );
  assert.equal(existsSync(f.output), false);
});

test("existing output is never reused or cleaned", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(f.output);
  await fs.writeFile(
    join(f.output, "keep.txt"),
    "Keep this existing release.\n",
  );
  await assert.rejects(buildBundle(f), /exist|exclusive/i);
  assert.equal(
    await fs.readFile(join(f.output, "keep.txt"), "utf8"),
    "Keep this existing release.\n",
  );
});

test("changes during packaging refuse the bundle and clean only owned output", async (t) => {
  const f = await fixture(t);
  const bin = join(f.directory, "bin");
  await fs.mkdir(bin);
  const npmCli = realpathSync(join(dirname(process.execPath), "npm"));
  const target = join(f.repoRoot, "README.md");
  await fs.writeFile(
    join(bin, "npm"),
    `#!${process.execPath}\nimport fs from 'node:fs';\nimport {spawnSync} from 'node:child_process';\nconst r=spawnSync(${JSON.stringify(process.execPath)},[${JSON.stringify(npmCli)},...process.argv.slice(2)],{stdio:'inherit'});\nfs.writeFileSync(${JSON.stringify(target)},'Changed while packing.\\n');\nprocess.exit(r.status ?? 1);\n`,
    { mode: 0o755 },
  );
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${process.platform === "win32" ? ";" : ":"}${previousPath}`;
  try {
    await assert.rejects(buildBundle(f), /source.*changed|changed.*source/i);
  } finally {
    process.env.PATH = previousPath;
  }
  assert.equal(existsSync(f.output), false);
  assert.equal(await fs.readFile(target, "utf8"), "Changed while packing.\n");
});

test("Cargo package verification rejects invalid Rust and leaves no partial bundle", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    join(f.repoRoot, "crates/browser-driver-engine/src/lib.rs"),
    "this cannot compile\n",
  );
  await assert.rejects(
    buildBundle({ ...f, allowDirty: true }),
    /cargo.*fail|cargo.*exit/i,
  );
  assert.equal(existsSync(f.output), false);
});

test("source symlinks cannot cause outside bytes to be packaged", async (t) => {
  const f = await fixture(t);
  const privateFile = join(f.directory, "private.txt");
  await fs.writeFile(privateFile, "PRIVATE_OUTSIDE_SENTINEL");
  await fs.symlink(
    privateFile,
    join(f.repoRoot, "packages/runtime/src/outside.txt"),
  );
  await assert.rejects(
    buildBundle({ ...f, allowDirty: true }),
    /symbolic|symlink|regular file/i,
  );
  assert.equal(existsSync(f.output), false);
});
