import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  acquireAcceptanceOutput,
  acquireConsumerDirectory,
  runReleaseAcceptance,
  validatePackageArchive,
  verifyInstalledRuntime,
} from "./release-acceptance.mjs";
import { createManifest, sha256 } from "../scripts/release/manifest.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), "driver-install-contract-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const expected = join(root, "archive/package"),
    installed = join(root, "consumer/node_modules/@browser-driver/runtime");
  fs.mkdirSync(join(expected, "src"), { recursive: true });
  fs.mkdirSync(join(installed, "src"), { recursive: true });
  for (const dir of [expected, installed]) {
    fs.writeFileSync(
      join(dir, "package.json"),
      '{"name":"@browser-driver/runtime","version":"0.1.1-rc.1"}',
    );
    fs.writeFileSync(
      join(dir, "src/index.mjs"),
      'export const value = "immutable candidate";',
    );
  }
  return { root, expected, installed };
}
test("installed runtime must match exact artifact bytes, not only the same package version", (t) => {
  const { expected, installed } = fixture(t);
  fs.writeFileSync(
    join(installed, "src/index.mjs"),
    'export const value = "different implementation";',
  );
  assert.throws(
    () => verifyInstalledRuntime(expected, installed),
    /Installed runtime bytes differ/,
  );
});
test("workspace links cannot substitute for an installed release artifact", (t) => {
  const { root, expected, installed } = fixture(t);
  const linked = join(root, "linked-runtime");
  fs.symlinkSync(installed, linked, "dir");
  assert.throws(
    () => verifyInstalledRuntime(expected, linked),
    /Installed runtime must be a real directory/,
  );
});
test("missing and injected package files fail exact-install verification", (t) => {
  const { expected, installed } = fixture(t);
  fs.writeFileSync(join(installed, "src/unexpected.mjs"), "export {};");
  assert.throws(
    () => verifyInstalledRuntime(expected, installed),
    /Installed runtime file set differs/,
  );
  fs.unlinkSync(join(installed, "src/unexpected.mjs"));
  fs.unlinkSync(join(installed, "src/index.mjs"));
  assert.throws(
    () => verifyInstalledRuntime(expected, installed),
    /Installed runtime file set differs/,
  );
});
test("an independent exact installed package passes with its measured identity", (t) => {
  const { expected, installed } = fixture(t);
  const result = verifyInstalledRuntime(expected, installed);
  assert.equal(result.files, 2);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
});
test("an output directory created during bundle verification cannot be adopted", (t) => {
  const { root } = fixture(t);
  const output = join(root, "acceptance");
  fs.mkdirSync(output);
  fs.writeFileSync(
    join(output, "existing-result.json"),
    "Preserve another run",
  );
  assert.throws(() => acquireAcceptanceOutput(output), { code: "EEXIST" });
  assert.deepEqual(fs.readdirSync(output), ["existing-result.json"]);
  assert.equal(
    fs.readFileSync(join(output, "existing-result.json"), "utf8"),
    "Preserve another run",
  );
});

test("consumer root is canonical when the system temporary directory has a symlinked parent", (t) => {
  const { root } = fixture(t);
  const real = join(root, "real-temp"),
    alias = join(root, "temp-alias");
  fs.mkdirSync(real);
  fs.symlinkSync(real, alias, "dir");
  const acquired = acquireConsumerDirectory(alias);
  assert.equal(
    acquired,
    fs.realpathSync(acquired),
    "Compare ordinary Node import resolution with the canonical owned directory",
  );
});

function archiveFixture(t, kind) {
  const { root, expected } = fixture(t);
  if (kind === "symlink")
    fs.symlinkSync("../../outside", join(expected, "escape"));
  if (kind === "hardlink")
    fs.linkSync(join(expected, "package.json"), join(expected, "linked.json"));
  const archive = join(root, "candidate.tgz");
  execFileSync(
    "tar",
    ["-czf", archive, "-C", join(root, "archive"), "package"],
    { stdio: "pipe" },
  );
  return archive;
}
test("package extraction refuses symlink entries even when every entry name is in the package", (t) => {
  const archive = archiveFixture(t, "symlink");
  assert.throws(
    () => validatePackageArchive(archive, "package"),
    /only regular files and directories/,
  );
});
test("package extraction refuses hardlink entries before tar can follow their targets", (t) => {
  const archive = archiveFixture(t, "hardlink");
  assert.throws(
    () => validatePackageArchive(archive, "package"),
    /only regular files and directories/,
  );
});
test("regular package archives remain admissible", (t) => {
  const archive = archiveFixture(t, "regular");
  assert.ok(
    validatePackageArchive(archive, "package").includes("package/package.json"),
  );
});

for (const requirement of ["protocol", "Node", "Rust"]) {
  test(`incompatible ${requirement} manifest is rejected before output acquisition or artifact extraction`, async (t) => {
    const { root } = fixture(t);
    const bundle = join(root, "bundle"),
      output = join(root, "acceptance");
    fs.mkdirSync(bundle);
    const version = "0.1.1-rc.1",
      artifacts = {};
    for (const [id, name, extension] of [
      ["runtime", "@browser-driver/runtime", "tgz"],
      ["engine", "browser-driver-engine", "crate"],
    ]) {
      const data = Buffer.from(
        "These bytes must never reach extraction for an incompatible manifest.",
      );
      const file = `browser-driver-${id}-${version}.${extension}`;
      artifacts[id] = {
        name,
        file,
        version,
        bytes: data.length,
        sha256: sha256(data),
      };
      fs.writeFileSync(join(bundle, file), data);
    }
    const manifest = createManifest({
      version,
      artifacts,
      source: {
        commit: "a".repeat(40),
        treeSha256: "b".repeat(64),
        dirty: false,
      },
    });
    if (requirement === "protocol") manifest.compatibility.protocol = 2;
    if (requirement === "Node")
      manifest.compatibility.nodeMajor =
        Number(process.versions.node.split(".")[0]) + 1;
    if (requirement === "Rust") manifest.compatibility.rustVersion = "999.0.0";
    const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n"),
      digest = sha256(bytes);
    fs.writeFileSync(join(bundle, "manifest.json"), bytes);
    fs.writeFileSync(
      join(bundle, "SHA256SUMS"),
      `${artifacts.runtime.sha256}  ${artifacts.runtime.file}\n${artifacts.engine.sha256}  ${artifacts.engine.file}\n${digest}  manifest.json\n`,
    );
    const error = await runReleaseAcceptance({
      bundle,
      output,
      expectedManifestSha256: digest,
    }).catch((error) => error);
    assert.equal(
      fs.existsSync(output),
      false,
      "Compatibility must reject before any acceptance output is acquired",
    );
    assert.match(
      error.message,
      new RegExp(`Incompatible.*${requirement}`, "i"),
    );
  });
}
