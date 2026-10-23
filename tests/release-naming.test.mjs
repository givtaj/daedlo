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
import {
  updateRelease,
  rollbackRelease,
  releaseStatus,
} from "../scripts/release/store.mjs";

const environment = {
  protocol: 1,
  nodeVersion: "24.21.0",
  rustVersion: "1.96.0",
};
function manifest(prefix, version = "0.1.4-alpha.4") {
  return {
    version,
    source: {
      commit: "a".repeat(40),
      dirty: false,
      treeSha256: "b".repeat(64),
    },
    artifacts: Object.fromEntries(
      ["runtime", "engine"].map((id) => {
        const data = Buffer.from(`${prefix} ${id} ${version}`);
        return [
          id,
          {
            name: id === "runtime" ? `@${prefix}/runtime` : `${prefix}-engine`,
            version,
            file: `${prefix}-${id}-${version}.${id === "runtime" ? "tgz" : "crate"}`,
            sha256: sha256(data),
            bytes: data.length,
          },
        ];
      }),
    ),
  };
}
async function bundle(root, prefix, version) {
  const value = createManifest(manifest(prefix, version)),
    directory = join(root, prefix);
  await fs.mkdir(directory);
  for (const [id, artifact] of Object.entries(value.artifacts))
    await fs.writeFile(
      join(directory, artifact.file),
      `${prefix} ${id} ${version}`,
    );
  const bytes = Buffer.from(JSON.stringify(value) + "\n"),
    digest = sha256(bytes);
  await fs.writeFile(join(directory, "manifest.json"), bytes);
  await fs.writeFile(
    join(directory, "SHA256SUMS"),
    Object.values(value.artifacts)
      .map((a) => `${a.sha256}  ${a.file}\n`)
      .join("") + `${digest}  manifest.json\n`,
  );
  return { directory, digest, value };
}
test("Daedlo and historical browser-driver names are coherent release families", () => {
  for (const prefix of ["daedlo", "browser-driver"])
    assert.equal(
      createManifest(manifest(prefix)).artifacts.runtime.name,
      `@${prefix}/runtime`,
    );
});
test("mixed names and filenames never form an accepted release family", () => {
  for (const prefix of ["daedlo", "browser-driver"]) {
    const other = prefix === "daedlo" ? "browser-driver" : "daedlo";
    const mixed = manifest(prefix);
    mixed.artifacts.engine = manifest(other).artifacts.engine;
    assert.throws(() => createManifest(mixed), /name|family|identity/i);
    const renamed = manifest(prefix);
    renamed.artifacts.runtime.file = manifest(other).artifacts.runtime.file;
    assert.throws(() => createManifest(renamed), /file|path|name|identity/i);
  }
});
test("an existing release store upgrades to Daedlo and rolls back to exact legacy bytes", async (t) => {
  const root = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "daedlo-rename-")),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = join(root, "store"),
    old = await bundle(root, "browser-driver", "0.1.4-alpha.3"),
    next = await bundle(root, "daedlo", "0.1.4-alpha.4");
  for (const selected of [old, next]) {
    await verifyBundle(selected.directory, {
      expectedManifestSha256: selected.digest,
      environment,
    });
    await updateRelease({
      store,
      bundle: selected.directory,
      expectedManifestSha256: selected.digest,
      environment,
    });
  }
  assert.equal(
    (await releaseStatus({ store })).current.manifestSha256,
    next.digest,
  );
  const result = await rollbackRelease({ store, environment });
  assert.equal(result.current.manifestSha256, old.digest);
  assert.deepEqual(await verifyBundle(result.current.bundlePath), {
    manifest: old.value,
    manifestSha256: old.digest,
  });
});
