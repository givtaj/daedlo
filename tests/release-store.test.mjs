import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  updateRelease,
  rollbackRelease,
  releaseStatus,
} from "../scripts/release/store.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const environment = {
  protocol: 1,
  nodeVersion: "24.21.0",
  rustVersion: "1.96.0",
};
async function setup(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "browser-driver-store-test-")),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = path.join(root, "store");
  async function bundle(version, changes = {}) {
    const directory = path.join(
      root,
      `bundle-${version}-${Math.random().toString(16).slice(2)}`,
    );
    await fs.mkdir(directory);
    const runtime = Buffer.from(`runtime ${version}`),
      engine = Buffer.from(`engine ${version}`);
    const manifest = {
      schemaVersion: 1,
      kind: "browser-driver-release",
      version,
      source: {
        commit: "a".repeat(40),
        dirty: false,
        treeSha256: "b".repeat(64),
      },
      compatibility: { protocol: 1, nodeMajor: 22, rustVersion: "1.96.0" },
      artifacts: {
        runtime: {
          file: `browser-driver-runtime-${version}.tgz`,
          name: "@browser-driver/runtime",
          version,
          sha256: digest(runtime),
          bytes: runtime.length,
        },
        engine: {
          file: `browser-driver-engine-${version}.crate`,
          name: "browser-driver-engine",
          version,
          sha256: digest(engine),
          bytes: engine.length,
        },
      },
      ...changes,
    };
    await fs.writeFile(
      path.join(directory, manifest.artifacts.runtime.file),
      runtime,
    );
    await fs.writeFile(
      path.join(directory, manifest.artifacts.engine.file),
      engine,
    );
    const bytes = JSON.stringify(manifest, null, 2) + "\n";
    await fs.writeFile(path.join(directory, "manifest.json"), bytes);
    await fs.writeFile(
      path.join(directory, "SHA256SUMS"),
      `${manifest.artifacts.runtime.sha256}  ${manifest.artifacts.runtime.file}\n${manifest.artifacts.engine.sha256}  ${manifest.artifacts.engine.file}\n${digest(bytes)}  manifest.json\n`,
    );
    return { directory, manifest, expectedManifestSha256: digest(bytes) };
  }
  const update = (b, more = {}) =>
    updateRelease({
      store,
      bundle: b.directory,
      expectedManifestSha256: b.expectedManifestSha256,
      environment,
      ...more,
    });
  return { root, store, bundle, update };
}

test("activation copies an immutable bundle and rollback restores an exact prior pin", async (t) => {
  const { store, bundle, update } = await setup(t),
    a = await bundle("0.1.0"),
    b = await bundle("0.1.1");
  const first = await update(a);
  assert.equal(first.current?.version, "0.1.0");
  assert.equal(first.current.manifestSha256, a.expectedManifestSha256);
  assert.equal(first.previous, null);
  const second = await update(b);
  assert.equal(second.current.version, "0.1.1");
  assert.equal(second.previous.manifestSha256, a.expectedManifestSha256);
  assert.equal(
    await fs.readFile(
      path.join(first.current.bundlePath, a.manifest.artifacts.runtime.file),
      "utf8",
    ),
    "runtime 0.1.0",
  );
  const rolled = await rollbackRelease({ store, environment });
  assert.equal(rolled.current.manifestSha256, a.expectedManifestSha256);
  assert.equal(rolled.previous.manifestSha256, b.expectedManifestSha256);
  assert.deepEqual(
    rolled.history.map((item) => item.action),
    ["update", "update", "rollback"],
  );
  assert.equal((await releaseStatus({ store })).current.version, "0.1.0");
});

test("untrusted digest and tampered bytes are refused without creating a store", async (t) => {
  const { store, bundle, update } = await setup(t),
    a = await bundle("0.1.0");
  await assert.rejects(
    updateRelease({ store, bundle: a.directory, environment }),
    /trusted|digest|sha256/i,
  );
  await assert.rejects(
    update(a, { expectedManifestSha256: "0".repeat(64) }),
    /digest|sha256|manifest/i,
  );
  await fs.appendFile(
    path.join(a.directory, a.manifest.artifacts.runtime.file),
    "tampered",
  );
  await assert.rejects(update(a), /artifact|digest|sha256|bytes|size/i);
  await assert.rejects(fs.stat(store), { code: "ENOENT" });
});

test("an unrelated nonempty directory and symlink stores are never adopted", async (t) => {
  const { root, store, bundle, update } = await setup(t),
    a = await bundle("0.1.0");
  await fs.mkdir(store);
  await fs.writeFile(path.join(store, "unrelated.txt"), "keep");
  await assert.rejects(update(a), /owned|ownership|nonempty/i);
  assert.equal(
    await fs.readFile(path.join(store, "unrelated.txt"), "utf8"),
    "keep",
  );
  const link = path.join(root, "linked-store");
  await fs.symlink(store, link);
  await assert.rejects(update(a, { store: link }), /symlink/i);
});

test("incompatible protocol, Node, and Rust updates retain the exact current pin", async (t) => {
  const { store, bundle, update } = await setup(t),
    a = await bundle("0.1.0"),
    b = await bundle("0.1.1");
  await update(a);
  const before = await fs.readFile(path.join(store, "current.json"));
  for (const [field, value] of [
    ["protocol", 2],
    ["nodeVersion", "20.0.0"],
    ["rustVersion", "1.95.9"],
  ]) {
    await assert.rejects(
      update(b, { environment: { ...environment, [field]: value } }),
      /incompatible/i,
    );
    assert.deepEqual(
      await fs.readFile(path.join(store, "current.json")),
      before,
    );
  }
});

test("a failed copy never switches current and removes only its own temporary copy", async (t) => {
  const { store, bundle, update } = await setup(t),
    a = await bundle("0.1.0"),
    b = await bundle("0.1.1");
  await update(a);
  const before = await fs.readFile(path.join(store, "current.json"));
  const original = fs.copyFile;
  const mocked = t.mock.method(fs, "copyFile", async (source, ...args) => {
    if (source.endsWith(".crate"))
      throw Error("Simulated artifact copy failure");
    return original(source, ...args);
  });
  await assert.rejects(update(b), /copy failure/);
  mocked.mock.restore();
  assert.deepEqual(await fs.readFile(path.join(store, "current.json")), before);
  assert.deepEqual(await fs.readdir(path.join(store, "releases")), ["0.1.0"]);
  assert.equal((await releaseStatus({ store })).current.version, "0.1.0");
});

test("a failed atomic state switch leaves the prior activation and history intact", async (t) => {
  const { store, bundle, update } = await setup(t),
    a = await bundle("0.1.0"),
    b = await bundle("0.1.1");
  await update(a);
  const before = await fs.readFile(path.join(store, "current.json")),
    original = fs.rename;
  const mocked = t.mock.method(fs, "rename", async (source, destination) => {
    if (destination === path.join(store, "current.json"))
      throw Error("Simulated atomic switch failure");
    return original(source, destination);
  });
  await assert.rejects(update(b), /switch failure/);
  mocked.mock.restore();
  assert.deepEqual(await fs.readFile(path.join(store, "current.json")), before);
  assert.equal((await releaseStatus({ store })).current.version, "0.1.0");
  assert.equal(
    (await fs.readdir(store)).some((name) => name.startsWith(".current-")),
    false,
  );
});

test("rollback rejects a corrupted previous artifact without changing activation", async (t) => {
  const { store, bundle, update } = await setup(t),
    a = await bundle("0.1.0"),
    b = await bundle("0.1.1");
  const first = await update(a);
  await update(b);
  const before = await fs.readFile(path.join(store, "current.json"));
  await fs.appendFile(
    path.join(first.current.bundlePath, a.manifest.artifacts.engine.file),
    "tampered",
  );
  await assert.rejects(
    rollbackRelease({ store, environment }),
    /artifact|checksum|size/i,
  );
  assert.deepEqual(await fs.readFile(path.join(store, "current.json")), before);
});

test("rollback rechecks compatibility and keeps current on failure", async (t) => {
  const { store, bundle, update } = await setup(t),
    a = await bundle("0.1.0"),
    b = await bundle("0.1.1");
  await update(a);
  await update(b);
  const before = await fs.readFile(path.join(store, "current.json"));
  for (const [field, value] of [
    ["protocol", 2],
    ["nodeVersion", "21.9.0"],
    ["rustVersion", "1.95.0"],
  ]) {
    await assert.rejects(
      rollbackRelease({
        store,
        environment: { ...environment, [field]: value },
      }),
      /incompatible/i,
    );
    assert.deepEqual(
      await fs.readFile(path.join(store, "current.json")),
      before,
    );
  }
});

test("same exact update is idempotent and preserves the rollback pin", async (t) => {
  const { store, bundle, update } = await setup(t),
    a = await bundle("0.1.0"),
    b = await bundle("0.1.1");
  await update(a);
  await update(b);
  const before = await fs.readFile(path.join(store, "current.json"));
  const result = await update(b);
  assert.equal(result.previous.manifestSha256, a.expectedManifestSha256);
  assert.equal(result.history.length, 2);
  assert.deepEqual(await fs.readFile(path.join(store, "current.json")), before);
});

test("different content cannot reuse an existing release version or a historical version", async (t) => {
  const { store, bundle, update } = await setup(t),
    a = await bundle("0.1.0"),
    b = await bundle("0.1.1");
  const altered = await bundle("0.1.0", {
    source: {
      commit: "c".repeat(40),
      dirty: false,
      treeSha256: "d".repeat(64),
    },
  });
  await update(a);
  await update(b);
  const before = await fs.readFile(path.join(store, "current.json"));
  await assert.rejects(update(altered), /version.*content|version.*exists/i);
  await fs.rm(path.join(store, "releases", "0.1.0"), { recursive: true });
  await assert.rejects(update(altered), /version.*content|version.*history/i);
  assert.deepEqual(await fs.readFile(path.join(store, "current.json")), before);
});

test("explicit dirty approval is required separately for update and rollback", async (t) => {
  const { store, bundle, update } = await setup(t),
    a = await bundle("0.1.0-rc.1", {
      source: {
        commit: "a".repeat(40),
        dirty: true,
        treeSha256: "b".repeat(64),
      },
    });
  await assert.rejects(update(a), /dirty/i);
  await assert.rejects(update(a, { allowDirty: "true" }), /dirty/i);
  await update(a, { allowDirty: true });
  await update(await bundle("0.1.0"));
  const before = await fs.readFile(path.join(store, "current.json"));
  await assert.rejects(rollbackRelease({ store, environment }), /dirty/i);
  assert.deepEqual(await fs.readFile(path.join(store, "current.json")), before);
  assert.equal(
    (await rollbackRelease({ store, environment, allowDirty: true })).current
      .version,
    "0.1.0-rc.1",
  );
});

test("a mutation lock prevents concurrent activation and is not removed by the loser", async (t) => {
  const { store, bundle, update } = await setup(t),
    a = await bundle("0.1.0"),
    b = await bundle("0.1.1"),
    c = await bundle("0.1.2");
  await update(a);
  let reached, release;
  const entered = new Promise((resolve) => {
    reached = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const original = fs.copyFile;
  const mocked = t.mock.method(fs, "copyFile", async (...args) => {
    reached();
    await gate;
    return original(...args);
  });
  const first = update(b);
  await entered;
  try {
    const lock = await fs.readFile(path.join(store, ".mutation.lock"));
    await assert.rejects(update(c), /locked/);
    assert.deepEqual(
      await fs.readFile(path.join(store, ".mutation.lock")),
      lock,
    );
  } finally {
    release();
    mocked.mock.restore();
  }
  assert.equal((await first).current.version, "0.1.1");
  await assert.rejects(fs.stat(path.join(store, ".mutation.lock")), {
    code: "ENOENT",
  });
});

test("nested bundles, traversal, symlink artifacts, and replaced release directories are refused", async (t) => {
  const { root, store, bundle, update } = await setup(t),
    a = await bundle("0.1.0"),
    b = await bundle("0.1.1");
  await assert.rejects(
    update(a, { store: path.join(a.directory, "nested") }),
    /separate|nested/,
  );
  await assert.rejects(
    update(a, { store: root + "/unused/../store" }),
    /traversal/,
  );
  await update(a);
  await assert.rejects(
    update(a, { bundle: path.join(store, "releases", "0.1.0") }),
    /separate|nested/,
  );
  const artifact = path.join(b.directory, b.manifest.artifacts.runtime.file);
  await fs.rename(artifact, artifact + ".real");
  await fs.symlink(artifact + ".real", artifact);
  await assert.rejects(update(b), /symlink/);
  const releases = path.join(store, "releases");
  await fs.rename(releases, path.join(root, "other-releases"));
  await fs.symlink(path.join(root, "other-releases"), releases);
  assert.equal((await releaseStatus({ store })).integrity.current.ok, false);
  await assert.rejects(update(a), /symlink/);
});

test("status and unavailable rollback do not create a store", async (t) => {
  const { store } = await setup(t);
  assert.deepEqual((await releaseStatus({ store })).history, []);
  await assert.rejects(
    rollbackRelease({ store, environment }),
    /no owned|previous/i,
  );
  await assert.rejects(fs.stat(store), { code: "ENOENT" });
});

test("mutation callers must supply an explicit compatible environment", async (t) => {
  const { store, bundle, update } = await setup(t),
    a = await bundle("0.1.0"),
    b = await bundle("0.1.1");
  await assert.rejects(
    update(a, { environment: undefined }),
    /environment|capabilities/i,
  );
  await assert.rejects(fs.stat(store), { code: "ENOENT" });
  await update(a);
  await update(b);
  const before = await fs.readFile(path.join(store, "current.json"));
  await assert.rejects(rollbackRelease({ store }), /environment|capabilities/i);
  assert.deepEqual(await fs.readFile(path.join(store, "current.json")), before);
});

test("copied bytes are independently reverified before activation", async (t) => {
  const { store, bundle, update } = await setup(t),
    a = await bundle("0.1.0"),
    b = await bundle("0.1.1");
  await update(a);
  const before = await fs.readFile(path.join(store, "current.json")),
    original = fs.copyFile;
  const mocked = t.mock.method(
    fs,
    "copyFile",
    async (source, destination, ...args) => {
      await original(source, destination, ...args);
      if (source.endsWith(".crate"))
        await fs.appendFile(destination, "changed during copy");
    },
  );
  await assert.rejects(update(b), /artifact|checksum|size/i);
  mocked.mock.restore();
  assert.deepEqual(await fs.readFile(path.join(store, "current.json")), before);
  assert.deepEqual(await fs.readdir(path.join(store, "releases")), ["0.1.0"]);
});

test("rollback recovers from corrupted current bytes while retaining the broken pin and history", async (t) => {
  const { store, bundle, update } = await setup(t),
    a = await bundle("0.1.0"),
    b = await bundle("0.1.1");
  await update(a);
  const active = await update(b);
  await fs.appendFile(
    path.join(active.current.bundlePath, b.manifest.artifacts.runtime.file),
    "corrupted current",
  );
  let status;
  await assert.doesNotReject(async () => {
    status = await releaseStatus({ store });
  }, "Status must report per-pin integrity without hiding the current pin");
  assert.equal(status.current.version, "0.1.1");
  assert.equal(status.integrity.current.ok, false);
  assert.equal(status.integrity.previous.ok, true);
  let restored;
  await assert.doesNotReject(async () => {
    restored = await rollbackRelease({ store, environment });
  }, "The verified previous release must remain recoverable");
  assert.equal(restored.current.manifestSha256, a.expectedManifestSha256);
  assert.equal(restored.previous.manifestSha256, b.expectedManifestSha256);
  assert.equal(restored.history.length, 3);
  status = await releaseStatus({ store });
  assert.equal(status.integrity.current.ok, true);
  assert.equal(status.integrity.previous.ok, false);
  const before = await fs.readFile(path.join(store, "current.json"));
  await assert.rejects(
    rollbackRelease({ store, environment }),
    /artifact|checksum|size/i,
  );
  assert.deepEqual(await fs.readFile(path.join(store, "current.json")), before);
});

test("a trusted new release recovers when current bytes are missing without erasing history", async (t) => {
  const { store, bundle, update } = await setup(t),
    a = await bundle("0.1.0"),
    b = await bundle("0.1.1");
  const active = await update(a);
  await fs.unlink(
    path.join(active.current.bundlePath, a.manifest.artifacts.engine.file),
  );
  let installed;
  await assert.doesNotReject(async () => {
    installed = await update(b);
  }, "Missing active bytes must not prevent a verified replacement");
  assert.equal(installed.current.version, "0.1.1");
  assert.equal(installed.previous.manifestSha256, a.expectedManifestSha256);
  assert.equal(installed.history.length, 2);
  const status = await releaseStatus({ store });
  assert.equal(status.integrity.current.ok, true);
  assert.equal(status.integrity.previous.ok, false);
});

test("valid repeated-hyphen prerelease versions can be selected and rolled back", async (t) => {
  const { store, bundle, update } = await setup(t);
  const a = await bundle("0.1.1-rc--1"),
    b = await bundle("0.1.1");
  let first;
  await assert.doesNotReject(async () => {
    first = await update(a);
  }, "Valid SemVer prerelease identifiers may contain repeated hyphens");
  assert.equal(first.current.version, "0.1.1-rc--1");
  await update(b);
  assert.equal(
    (await rollbackRelease({ store, environment })).current.version,
    "0.1.1-rc--1",
  );
});
