import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import { basename, join } from "node:path";
import { createNinjaManager } from "../scripts/release/ninja-manager.mjs";
import {
  createManifest,
  sha256,
  verifyBundle,
} from "../scripts/release/manifest.mjs";

// Manager transaction tests use a deterministic installer/supervisor. The bundle
// bytes and filesystem preservation checks are real; these are not browser tests.
async function fixture(t) {
  const root = await fs.mkdtemp(
    join(await fs.realpath(os.tmpdir()), "daedlo-native-refresh-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourceRoot = join(root, "authored");
  await fs.mkdir(sourceRoot);
  const sourceFile = join(sourceRoot, "adapter.mjs");
  await fs.writeFile(sourceFile, "accepted source\n");
  const dataFile = join(root, "application-data.json");
  await fs.writeFile(dataFile, '{"saved":1}\n');
  const store = join(root, "store");
  let offered = "1.0.0",
    running = null,
    dirty = false,
    busy = false,
    failBuild = false,
    changedDescriptor = false,
    offline = false,
    faultPoint = null;
  const calls = { check: 0, download: 0, build: 0, hooks: 0 };
  const prepared = [];
  const descriptors = {
    accepted: { id: "fixture", version: "1", commands: ["save"] },
    changed: { id: "fixture", version: "1", commands: ["delete"] },
  };
  const registration = { projectId: "fixture", sourceRoot };
  async function makeKit(output, version) {
    const bundlePath = join(output, `daedlo-${version}`, "bundle");
    await fs.mkdir(bundlePath, { recursive: true });
    const artifacts = {};
    for (const [kind, name, extension] of [
      ["runtime", "@browser-driver/runtime", "tgz"],
      ["engine", "browser-driver-engine", "crate"],
    ]) {
      const bytes = Buffer.from(`${kind} ${version} verified archive bytes`);
      const file = `browser-driver-${kind}-${version}.${extension}`;
      await fs.writeFile(join(bundlePath, file), bytes);
      artifacts[kind] = {
        file,
        name,
        version,
        sha256: sha256(bytes),
        bytes: bytes.length,
      };
    }
    const manifest = createManifest({
      version,
      artifacts,
      source: {
        commit: "a".repeat(40),
        dirty: false,
        treeSha256: "b".repeat(64),
      },
    });
    const manifestBytes = JSON.stringify(manifest, null, 2) + "\n";
    const manifestSha256 = sha256(manifestBytes);
    await fs.writeFile(join(bundlePath, "manifest.json"), manifestBytes);
    await fs.writeFile(
      join(bundlePath, "SHA256SUMS"),
      `${artifacts.runtime.sha256}  ${artifacts.runtime.file}\n${artifacts.engine.sha256}  ${artifacts.engine.file}\n${manifestSha256}  manifest.json\n`,
    );
    return {
      bundlePath,
      identity: {
        version,
        manifestSha256,
        contracts: { manager: 1, launcher: 1 },
        catalogGeneration: 1,
        catalogSha256: "c".repeat(64),
      },
    };
  }
  const provider = {
    async check() {
      calls.check++;
      if (offline) throw Error("Catalog unavailable");
      return {
        checkpoint: { generation: 1 },
        available: { id: offered, version: offered },
      };
    },
    async download(release, output) {
      calls.download++;
      if (offline) throw Error("Download unavailable");
      return makeKit(output, release.version);
    },
  };
  const installer = {
    async prepare({ verifiedKit, destination }) {
      calls.build++;
      await verifyBundle(verifiedKit.bundlePath, {
        expectedManifestSha256: verifiedKit.identity.manifestSha256,
      });
      prepared.push(structuredClone(verifiedKit));
      if (failBuild) throw Error("Registered acceptance rejected source");
      calls.hooks += 2;
      await fs.mkdir(destination);
      const receipt = {
        id: basename(destination),
        path: destination,
        version: verifiedKit.identity.version,
        release: verifiedKit.identity,
        sourceSha256: sha256(await fs.readFile(sourceFile)),
        handshake: {
          descriptor: changedDescriptor
            ? descriptors.changed
            : descriptors.accepted,
        },
      };
      await fs.writeFile(
        join(destination, "receipt.json"),
        JSON.stringify(receipt),
      );
      return receipt;
    },
    async verify(path, { checkSource = false } = {}) {
      const receipt = JSON.parse(await fs.readFile(join(path, "receipt.json")));
      if (
        checkSource &&
        receipt.sourceSha256 !== sha256(await fs.readFile(sourceFile))
      )
        throw Error("Project inputs changed; prepare again");
      return receipt;
    },
  };
  const supervisor = {
    async status() {
      return { running, dirty, busy, paused: false, cleanupPending: false };
    },
    async start(receipt) {
      running = receipt;
    },
    async quiesce() {},
    async close() {
      running = null;
      return { report: { resources: [{ owned: true, status: "closed" }] } };
    },
    async report() {
      return { saved: true };
    },
  };
  const options = {
    root: store,
    registration,
    installer,
    provider,
    supervisor,
    async fault(point) {
      if (faultPoint === point) {
        const error = Error("simulated interruption");
        error.simulatedCrash = true;
        throw error;
      }
    },
  };
  const manager = await createNinjaManager(options);
  return {
    root,
    store,
    sourceFile,
    dataFile,
    manager,
    options,
    calls,
    prepared,
    changeSource: (value) => fs.writeFile(sourceFile, value),
    setOffer: (value) => (offered = value),
    setOffline: (value) => (offline = value),
    setFailure: (value) => (failBuild = value),
    setDescriptorChanged: (value) => (changedDescriptor = value),
    setDirty: (value) => (dirty = value),
    setBusy: (value) => (busy = value),
    setFault: (value) => (faultPoint = value),
  };
}

async function accepted(f) {
  await f.manager.check();
  const ready = await f.manager.prepare("1.0.0");
  return f.manager.activate(ready.operation.id, { acknowledgeRestart: true });
}

function requireRefresh(manager) {
  assert.equal(
    typeof manager.refresh,
    "function",
    "An accepted installation must offer explicit same-version source revalidation",
  );
}

test("refresh validates authored edits with the accepted exact bundle, without checking or upgrading releases", async (t) => {
  const f = await fixture(t);
  const first = await accepted(f);
  requireRefresh(f.manager);
  f.setOffer("2.0.0");
  await f.manager.check();
  f.setOffline(true);
  await f.changeSource("reviewed authored edit\n");
  const expectedSource = await fs.readFile(f.sourceFile);
  const expectedData = await fs.readFile(f.dataFile);
  const calls = { ...f.calls };
  const ready = await f.manager.refresh();
  assert.equal(ready.phase, "ready");
  assert.equal(ready.selected.id, first.selected.id);
  assert.equal(ready.running.id, first.running.id);
  assert.notEqual(ready.operation.id, first.selected.id);
  assert.equal(f.calls.check, calls.check);
  assert.equal(f.calls.download, calls.download);
  assert.equal(f.calls.hooks, calls.hooks + 2);
  assert.deepEqual(f.prepared.at(-1).identity, f.prepared[0].identity);
  assert.notEqual(f.prepared.at(-1).bundlePath, f.prepared[0].bundlePath);
  const activated = await f.manager.activate(ready.operation.id, {
    acknowledgeRestart: true,
  });
  assert.equal(activated.selected.version, "1.0.0");
  assert.equal(activated.running.sourceSha256, sha256(expectedSource));
  assert.equal(activated.canRollback, true);
  assert.deepEqual(await fs.readFile(f.sourceFile), expectedSource);
  assert.deepEqual(await fs.readFile(f.dataFile), expectedData);
  const previous = await f.manager.rollback({ acknowledgeRestart: true });
  assert.equal(previous.selected.id, first.selected.id);
  assert.equal(previous.selected.historicalSnapshot, true);
  assert.deepEqual(await fs.readFile(f.sourceFile), expectedSource);
  assert.deepEqual(await fs.readFile(f.dataFile), expectedData);
});

test("a refreshed installation can be refreshed again after the old retained download disappears", async (t) => {
  const f = await fixture(t);
  const first = await accepted(f);
  requireRefresh(f.manager);
  await f.changeSource("first edit");
  const ready = await f.manager.refresh();
  const second = await f.manager.activate(ready.operation.id, {
    acknowledgeRestart: true,
  });
  await fs.rm(join(f.store, "downloads", first.selected.id), {
    recursive: true,
  });
  f.setOffline(true);
  await f.changeSource("second edit");
  const next = await f.manager.refresh();
  const third = await f.manager.activate(next.operation.id, {
    acknowledgeRestart: true,
  });
  assert.equal(third.selected.version, "1.0.0");
  assert.notEqual(third.selected.id, second.selected.id);
  const reverted = await f.manager.rollback({ acknowledgeRestart: true });
  assert.equal(reverted.selected.id, second.selected.id);
});

test("failed acceptance and changed command descriptors preserve the accepted live installation", async (t) => {
  const f = await fixture(t);
  const before = await accepted(f);
  requireRefresh(f.manager);
  await f.changeSource("new source");
  f.setFailure(true);
  await assert.rejects(f.manager.refresh(), /acceptance rejected/);
  f.setFailure(false);
  f.setDescriptorChanged(true);
  await assert.rejects(f.manager.refresh(), /states, commands or flows/);
  const after = await f.manager.status();
  assert.equal(after.selected.id, before.selected.id);
  assert.equal(after.running.id, before.running.id);
  assert.equal(after.phase, "failed");
  assert.equal(await fs.readFile(f.sourceFile, "utf8"), "new source");
});

for (const damage of ["missing", "tampered", "symlink"])
  test(`refresh refuses ${damage} retained bundle before building and keeps the accepted selection`, async (t) => {
    const f = await fixture(t);
    const before = await accepted(f);
    requireRefresh(f.manager);
    const kit = f.prepared[0];
    const file = join(kit.bundlePath, "browser-driver-runtime-1.0.0.tgz");
    if (damage === "missing") await fs.rm(kit.bundlePath, { recursive: true });
    else if (damage === "tampered") await fs.appendFile(file, "corruption");
    else {
      await fs.rename(kit.bundlePath, kit.bundlePath + "-target");
      await fs.symlink(kit.bundlePath + "-target", kit.bundlePath);
    }
    const builds = f.calls.build;
    await assert.rejects(
      f.manager.refresh(),
      /retained|bundle|checksum|symlink|links|directory/i,
    );
    assert.equal(f.calls.build, builds);
    const after = await f.manager.status();
    assert.equal(after.selected.id, before.selected.id);
    assert.equal(after.running.id, before.running.id);
  });

test("refresh activation still requires a safe restart and unchanged validated source", async (t) => {
  const f = await fixture(t);
  const before = await accepted(f);
  requireRefresh(f.manager);
  await f.changeSource("validated source");
  const ready = await f.manager.refresh();
  f.setBusy(true);
  await assert.rejects(
    f.manager.activate(ready.operation.id, { acknowledgeRestart: true }),
    /safe boundary/,
  );
  f.setBusy(false);
  f.setDirty(true);
  await assert.rejects(
    f.manager.activate(ready.operation.id, { acknowledgeRestart: true }),
    /draft/,
  );
  f.setDirty(false);
  await f.changeSource("unvalidated further edit");
  await assert.rejects(
    f.manager.activate(ready.operation.id, { acknowledgeRestart: true }),
    /inputs changed/,
  );
  assert.equal((await f.manager.status()).running.id, before.running.id);
});

test("interrupted refresh activation recovers the previous complete installation", async (t) => {
  const f = await fixture(t);
  const before = await accepted(f);
  requireRefresh(f.manager);
  await f.changeSource("new accepted source");
  const ready = await f.manager.refresh();
  f.setFault("selection_written");
  await assert.rejects(
    f.manager.activate(ready.operation.id, { acknowledgeRestart: true }),
    /simulated interruption/,
  );
  f.setFault(null);
  await f.options.supervisor.close();
  const recovered = await createNinjaManager(f.options);
  assert.equal((await recovered.status()).selected.id, before.selected.id);
  assert.equal((await recovered.status()).phase, "recovered");
});

test("refresh requires an accepted installation", async (t) => {
  const f = await fixture(t);
  requireRefresh(f.manager);
  await assert.rejects(f.manager.refresh(), /accepted|initial|installed/i);
  assert.equal(f.calls.check, 0);
  assert.equal(f.calls.download, 0);
  assert.equal(f.calls.build, 0);
});
