import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createManifest,
  sha256,
  verifyBundle,
} from "../scripts/release/manifest.mjs";

const version = "0.1.1-rc.1";
const environment = {
  nodeVersion: "22.20.0",
  rustVersion: "1.96.0",
  protocol: 1,
};
async function fixture(t, change = () => {}) {
  const directory = await fs.mkdtemp(
    join(tmpdir(), "driver-release-manifest-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const artifacts = {};
  for (const [id, name, extension] of [
    ["runtime", "@browser-driver/runtime", "tgz"],
    ["engine", "browser-driver-engine", "crate"],
  ]) {
    const data = Buffer.from(`${id} immutable package bytes`);
    const file = `browser-driver-${id}-${version}.${extension}`;
    artifacts[id] = {
      file,
      name,
      version,
      sha256: sha256(data),
      bytes: data.length,
    };
    await fs.writeFile(join(directory, file), data);
  }
  const manifest = createManifest({
    version,
    source: {
      commit: "a".repeat(40),
      dirty: false,
      treeSha256: "b".repeat(64),
    },
    artifacts,
  });
  change(manifest);
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
  const digest = sha256(bytes);
  await fs.writeFile(join(directory, "manifest.json"), bytes);
  await fs.writeFile(
    join(directory, "SHA256SUMS"),
    `${artifacts.runtime.sha256}  ${artifacts.runtime.file}\n${artifacts.engine.sha256}  ${artifacts.engine.file}\n${digest}  manifest.json\n`,
  );
  return { directory, manifest, digest };
}

test("verifies the complete selected pair and returns its exact manifest digest", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(
    await verifyBundle(f.directory, {
      expectedManifestSha256: f.digest,
      environment,
    }),
    { manifest: f.manifest, manifestSha256: f.digest },
  );
});
test("rejects wrong trust digest and tampered package bytes before accepting a pair", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    verifyBundle(f.directory, { expectedManifestSha256: "f".repeat(64) }),
    /digest|hash|checksum/i,
  );
  await fs.appendFile(
    join(f.directory, f.manifest.artifacts.runtime.file),
    "changed",
  );
  await assert.rejects(verifyBundle(f.directory), /size|digest|hash|checksum/i);
});
test("rejects mixed artifact versions and path traversal in public metadata", async (t) => {
  const mixed = await fixture(t, (m) => {
    m.artifacts.engine.version = "0.0.1";
  });
  await assert.rejects(verifyBundle(mixed.directory), /version/i);
  const outside = await fixture(t, (m) => {
    m.artifacts.runtime.file = "../runtime.tgz";
  });
  await assert.rejects(verifyBundle(outside.directory), /file|path/i);
});
test("rejects incompatible protocol, Node and Rust without running package code", async (t) => {
  const f = await fixture(t);
  for (const bad of [
    { ...environment, protocol: 2 },
    { ...environment, nodeVersion: "20.0.0" },
    { ...environment, rustVersion: "1.95.0" },
    { ...environment, rustVersion: "unknown" },
  ])
    await assert.rejects(
      verifyBundle(f.directory, { environment: bad }),
      /protocol|Node|Rust|version/i,
    );
});
test("rejects symlink artifacts and altered checksum inventories", async (t) => {
  const f = await fixture(t);
  const file = join(f.directory, f.manifest.artifacts.engine.file);
  await fs.rename(file, file + ".actual");
  await fs.symlink(file + ".actual", file);
  await assert.rejects(verifyBundle(f.directory), /symlink|regular/i);
  const other = await fixture(t);
  await fs.appendFile(
    join(other.directory, "SHA256SUMS"),
    "unreviewed extra entry\n",
  );
  await assert.rejects(verifyBundle(other.directory), /checksum|inventory/i);
});
test("fails closed on unknown schema, extra fields, malformed versions and unbound source", async (t) => {
  for (const mutate of [
    (m) => (m.schemaVersion = 2),
    (m) => (m.unknown = true),
    (m) => (m.version = "../../oops"),
    (m) => (m.source.commit = "main"),
    (m) => (m.source.treeSha256 = ""),
    (m) => (m.artifacts.engine.bytes = -1),
  ]) {
    const f = await fixture(t, mutate);
    await assert.rejects(
      verifyBundle(f.directory),
      /schema|field|version|source|bytes/i,
    );
  }
});
test("source identities and artifact digests must be strings, not coercible arrays", async (t) => {
  const { manifest } = await fixture(t);
  for (const mutate of [
    (m) => (m.source.commit = [m.source.commit]),
    (m) => (m.source.treeSha256 = [m.source.treeSha256]),
    (m) => (m.artifacts.runtime.sha256 = [m.artifacts.runtime.sha256]),
  ]) {
    const changed = structuredClone(manifest);
    mutate(changed);
    assert.throws(() => createManifest(changed), /source|digest/);
  }
});
