import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { verifyToolsSource } from "./alpha4-installed-starter.mjs";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "starter-source-inventory-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manifest = {
    version: "0.1.4-alpha.4",
    source: {
      commit: "1".repeat(40),
      dirty: false,
      treeSha256: "2".repeat(64),
    },
  };
  const files = [
    "acceptance.mjs",
    "build-model.mjs",
    "runtime.mjs",
    "request-acceptance.mjs",
    "model/Cargo.toml",
    "model/src/lib.rs",
  ].map((file) => "examples/starter/" + file);
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), "synthetic inventory fixture\n", {
      mode: 0o644,
    });
  }
  writeFileSync(
    join(root, "SOURCE.json"),
    JSON.stringify({
      schemaVersion: 1,
      kind: "browser-driver-release-tools",
      name: "@daedlo/release-tools",
      version: manifest.version,
      source: manifest.source,
      files: files.map((file) => {
        const bytes = readFileSync(join(root, file));
        return { file, bytes: bytes.length, sha256: sha(bytes), mode: 0o644 };
      }),
    }),
  );
  return { root, manifest };
}
test("complete tools inventory rejects altered bytes and unexpected private material", (t) => {
  const { root, manifest } = fixture(t);
  assert.equal(verifyToolsSource(root, manifest).files, 7);
  writeFileSync(join(root, "examples/starter/runtime.mjs"), "changed");
  assert.throws(() => verifyToolsSource(root, manifest), /file size differs/);
});
test("tools receipt cannot omit added customer files or substitute symlinks", (t) => {
  const { root, manifest } = fixture(t);
  mkdirSync(join(root, "customers"));
  writeFileSync(
    join(root, "customers/private.txt"),
    "synthetic private sentinel",
  );
  assert.throws(
    () => verifyToolsSource(root, manifest),
    /cover every installed tools file/,
  );
  rmSync(join(root, "customers"), { recursive: true });
  symlinkSync("SOURCE.json", join(root, "link"));
  assert.throws(
    () => verifyToolsSource(root, manifest),
    /must not contain symlinks/,
  );
});
test("runtime and tools from different frozen sources cannot pass together", (t) => {
  const { root, manifest } = fixture(t);
  assert.throws(
    () =>
      verifyToolsSource(root, {
        ...manifest,
        source: { ...manifest.source, commit: "3".repeat(40) },
      }),
    /same frozen source/,
  );
});

test("optional release native acceptance requires the archive and expected digest together", async () => {
  const { runReleaseAcceptance } = await import("./release-acceptance.mjs");
  const common = { expectedManifestSha256: "a".repeat(64) };
  await assert.rejects(
    runReleaseAcceptance({ ...common, toolsArchive: "/not-read/kit.tgz" }),
    /must be supplied together/,
  );
  await assert.rejects(
    runReleaseAcceptance({ ...common, expectedToolsSha256: "b".repeat(64) }),
    /must be supplied together/,
  );
});
test("native tools digest mismatch is refused before bundle verification or output acquisition", async (t) => {
  const { runReleaseAcceptance } = await import("./release-acceptance.mjs");
  const { root } = fixture(t);
  const archive = join(root, "candidate.tgz");
  writeFileSync(archive, "Wrong tools bytes");
  await assert.rejects(
    runReleaseAcceptance({
      expectedManifestSha256: "a".repeat(64),
      toolsArchive: archive,
      expectedToolsSha256: "b".repeat(64),
    }),
    /Tools archive digest mismatch/,
  );
});
