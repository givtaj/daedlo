import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  createNinjaProvider,
  NINJA_CONTRACTS,
  openNinja,
} from "../scripts/release/ninja.mjs";
import { ninjaCatalogSigningBytes } from "../scripts/release/ninja-catalog.mjs";
import { sha256 } from "../scripts/release/manifest.mjs";
import { createNinjaManager } from "../scripts/release/ninja-manager.mjs";

const now = Date.parse("2026-10-23T12:00:00.000Z");
const origin = "https://updates.example.test";
const version = "0.1.4-alpha.2";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const keyId = "integration-test-key";
const config = {
  url: `${origin}/catalog.json`,
  publisher: "daedlo",
  trustedKeys: [{ id: keyId, publicKey }],
  channel: "preview",
};
const asset = (name, bytes = Buffer.from("x")) => ({
  url: `${origin}/downloads/${version}/${name}`,
  bytes: bytes.length,
  sha256: sha256(bytes),
});
function release(files) {
  return {
    version,
    channel: "preview",
    platforms: [{ os: process.platform, arch: process.arch }],
    contracts: structuredClone(NINJA_CONTRACTS),
    notesUrl: `${origin}/notes/${version}`,
    kit: asset(`daedlo-${version}.zip`, files?.zip),
    metadata: asset("release.json", files?.metadata),
    checksums: asset("SHA256SUMS", files?.checksums),
  };
}
function signed(entry = release(), generation = 5) {
  const payload = {
    schemaVersion: 1,
    kind: "daedlo-public-kit-catalog",
    publisher: "daedlo",
    generation,
    issuedAt: "2026-10-23T11:00:00.000Z",
    expiresAt: "2026-10-24T11:00:00.000Z",
    releases: [entry],
  };
  return Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      kind: "daedlo-signed-catalog",
      signed: payload,
      signature: {
        keyId,
        value: sign(
          null,
          ninjaCatalogSigningBytes(payload),
          privateKey,
        ).toString("base64"),
      },
    }),
  );
}
async function owned(t) {
  const path = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "ninja-integration-")),
  );
  t.after(() => fs.rm(path, { recursive: true, force: true }));
  return path;
}
const check = (provider, extra = {}) =>
  provider.check({
    previousState: null,
    currentVersion: "0.1.4-alpha.1",
    ...extra,
  });

test("wrapper discovers the authenticated release with stable version ID and replay checkpoint", async () => {
  const provider = createNinjaProvider(config, {
    now: () => now,
    fetchImpl: async () => new Response(signed()),
  });
  const result = await check(provider);
  assert.equal(result.available.id, version);
  assert.equal(result.available.version, version);
  assert.equal(result.checkpoint.generation, 5);
  assert.match(result.checkpoint.sha256, /^[a-f0-9]{64}$/);
});
test("wrapper returns authenticated checkpoint even when release is incompatible", async () => {
  const entry = release();
  entry.contracts.nodeAdapter++;
  const provider = createNinjaProvider(config, {
    now: () => now,
    fetchImpl: async () => new Response(signed(entry, 8)),
  });
  const result = await check(provider);
  assert.equal(result.checkpoint.generation, 8);
  assert.equal(result.available, null);
});
test("wrapper reports an unconfigured publisher feed without fetching or claiming current", async () => {
  let called = false;
  const provider = createNinjaProvider(
    { ...config, url: undefined },
    {
      now: () => now,
      fetchImpl: async () => {
        called = true;
        throw Error("must not fetch");
      },
    },
  );
  const result = await check(provider);
  assert.equal(result.status, "unconfigured");
  assert.equal(result.available, null);
  assert.equal(called, false);
});
test("failed discovery invalidates the previous in-memory offer before download", async (t) => {
  let bad = false,
    calls = 0;
  const provider = createNinjaProvider(config, {
    now: () => now,
    fetchImpl: async () => {
      calls++;
      return new Response(bad ? "invalid-json" : signed());
    },
  });
  const offered = await check(provider);
  bad = true;
  await assert.rejects(check(provider, { previousState: offered.checkpoint }));
  calls = 0;
  const root = await owned(t);
  await assert.rejects(
    provider.download(offered.available, join(root, "candidate")),
    /check|catalog|offer|discovery/i,
  );
  assert.equal(
    calls,
    0,
    "A failed check must not leave a stale downloadable offer",
  );
  assert.deepEqual(await fs.readdir(root), []);
});
test("bootstrap rejects source/store overlap before mutating authored project", async (t) => {
  const root = await owned(t);
  const sourceRoot = join(root, "source");
  await fs.mkdir(sourceRoot);
  await fs.writeFile(
    join(sourceRoot, "authored.mjs"),
    "export const untouched = true;\n",
  );
  await fs.writeFile(
    join(root, "publisher.pem"),
    publicKey.export({ type: "spki", format: "pem" }),
  );
  const filename = join(root, "config.json");
  await fs.writeFile(
    filename,
    JSON.stringify({
      schemaVersion: 1,
      store: join(sourceRoot, "managed-store"),
      registration: { schemaVersion: 1, projectId: "fixture", sourceRoot },
      catalog: {
        ...config,
        trustedKeys: [{ id: keyId, publicKeyFile: "publisher.pem" }],
      },
    }),
  );
  await assert.rejects(
    openNinja(filename),
    /source|store|registration|separate|nested/i,
  );
  assert.deepEqual(await fs.readdir(sourceRoot), ["authored.mjs"]);
  assert.equal(
    await fs.readFile(join(sourceRoot, "authored.mjs"), "utf8"),
    "export const untouched = true;\n",
  );
});

if (process.env.DAEDLO_NINJA_ALPHA_KIT)
  test("wrapper downloads the real alpha kit from a trusted local catalog without touching authored files", async (t) => {
    const directory = process.env.DAEDLO_NINJA_ALPHA_KIT;
    const files = {
      zip: await fs.readFile(join(directory, `daedlo-${version}.zip`)),
      metadata: await fs.readFile(join(directory, "release.json")),
      checksums: await fs.readFile(join(directory, "SHA256SUMS")),
    };
    const bodies = new Map([
      [config.url, signed(release(files))],
      [asset(`daedlo-${version}.zip`).url, files.zip],
      [asset("release.json").url, files.metadata],
      [asset("SHA256SUMS").url, files.checksums],
    ]);
    const provider = createNinjaProvider(config, {
      now: () => now,
      fetchImpl: async (url) => {
        assert.ok(bodies.has(url));
        return new Response(bodies.get(url));
      },
    });
    const offered = await check(provider);
    const root = await owned(t);
    await fs.writeFile(join(root, "authored.mjs"), "preserve");
    const kit = await provider.download(
      offered.available,
      join(root, "candidate"),
    );
    assert.equal(
      kit.identity.archiveSha256,
      "b9555b6b237ac437f62b984f6994e3ef12ba4e8f95b730f52c9aa9313a375ee1",
    );
    assert.deepEqual(kit.identity.contracts, NINJA_CONTRACTS);
    assert.equal(
      await fs.readFile(join(root, "authored.mjs"), "utf8"),
      "preserve",
    );
  });

async function managerFixture(
  t,
  {
    stale = false,
    historical = false,
    live = false,
    reportFails = false,
    ready = false,
  } = {},
) {
  const root = await owned(t);
  const selected = {
    id: "accepted",
    version: "1.0.0",
    sourceSha256: "a".repeat(64),
  };
  let running = live ? selected : null,
    paused = false,
    starts = 0,
    closes = 0;
  const state = {
    schemaVersion: 1,
    projectId: "fixture",
    generation: 1,
    current: selected.id,
    previous: null,
    historicalSnapshot: historical,
    checkpoint: null,
    available: null,
    operation: ready
      ? { id: "prepared", status: "ready", expectedCurrent: selected.id }
      : null,
    phase: ready ? "ready" : "updated",
    error: null,
  };
  const supervisor = {
    async status() {
      return {
        running,
        busy: false,
        paused,
        dirty: false,
        cleanupPending: false,
      };
    },
    async quiesce() {
      paused = true;
    },
    async unquiesce() {
      paused = false;
    },
    async report() {
      if (reportFails) throw Error("report persistence failed");
      return { preserved: true };
    },
    async close() {
      closes++;
      running = null;
    },
    async start(receipt) {
      starts++;
      running = receipt;
    },
  };
  const installer = {
    async verify(_path, options) {
      if (stale && options.checkSource)
        throw Error("Project source changed; prepare again");
      return selected;
    },
  };
  const provider = {
    async check() {
      return {
        checkpoint: { generation: 2, sha256: "b".repeat(64) },
        available: { id: "2.0.0", version: "2.0.0" },
      };
    },
  };
  const manager = await createNinjaManager({
    root,
    registration: { projectId: "fixture" },
    provider,
    installer,
    supervisor,
  });
  await fs.writeFile(join(root, "state.json"), JSON.stringify(state));
  return { manager, status: () => ({ paused, starts, closes, running }) };
}
test("manager report failure restores the usable unpaused session without closing it", async (t) => {
  const f = await managerFixture(t, { live: true, reportFails: true });
  await assert.rejects(f.manager.close(), /report persistence failed/);
  assert.equal(
    f.status().paused,
    false,
    "Failed shutdown must release its quiesce gate",
  );
  assert.equal(f.status().closes, 0);
  assert.equal((await f.manager.status()).running.version, "1.0.0");
});
test("normal restart refuses authored source drift before launching the saved installation", async (t) => {
  const f = await managerFixture(t, { stale: true });
  await assert.rejects(f.manager.start(), /source changed|prepare/i);
  assert.equal(f.status().starts, 0);
  assert.equal((await f.manager.status()).selected.version, "1.0.0");
});
test("explicit historical rollback snapshot remains launchable and visibly labeled", async (t) => {
  const f = await managerFixture(t, { stale: true, historical: true });
  const result = await f.manager.start();
  assert.equal(result.running.version, "1.0.0");
  assert.equal(result.selected.historicalSnapshot, true);
});
test("checking discovery again keeps a prepared operation ready for restart", async (t) => {
  const f = await managerFixture(t, { ready: true });
  const result = await f.manager.check();
  assert.equal(result.phase, "ready");
  assert.equal(result.operation.status, "ready");
  assert.equal(result.operation.id, "prepared");
});

test("manager persists an incompatible catalog checkpoint and rejects a later signed rollback", async (t) => {
  const root = await owned(t);
  const candidate = release();
  candidate.contracts.nodeAdapter++;
  let generation = 8;
  const provider = createNinjaProvider(config, {
    now: () => now,
    fetchImpl: async () => new Response(signed(candidate, generation)),
  });
  const manager = await createNinjaManager({
    root,
    registration: { projectId: "fixture" },
    provider,
    installer: {
      async verify() {
        throw Error("No installation should be read");
      },
    },
    supervisor: {
      async status() {
        return {
          running: null,
          busy: false,
          paused: false,
          dirty: false,
          cleanupPending: false,
        };
      },
    },
  });
  const result = await manager.check();
  assert.equal(result.available, null);
  assert.equal(result.error.code, "migration_required");
  let stored = JSON.parse(await fs.readFile(join(root, "state.json"), "utf8"));
  assert.equal(stored.checkpoint.generation, 8);
  generation = 7;
  await assert.rejects(manager.check(), /replay|older generation/i);
  stored = JSON.parse(await fs.readFile(join(root, "state.json"), "utf8"));
  assert.equal(stored.checkpoint.generation, 8);
  assert.equal(stored.available, null);
});

test("manager refuses to adopt a nonempty unowned directory before creating any managed files", async (t) => {
  const root = await owned(t);
  await fs.writeFile(join(root, "customer.txt"), "customer-owned");
  await assert.rejects(
    createNinjaManager({
      root,
      registration: { projectId: "fixture" },
      provider: {},
      installer: {},
      supervisor: {},
    }),
    /unowned|ownership|nonempty|empty|adopt/i,
  );
  assert.deepEqual(await fs.readdir(root), ["customer.txt"]);
  assert.equal(
    await fs.readFile(join(root, "customer.txt"), "utf8"),
    "customer-owned",
  );
});

test("an existing manager refuses a replacement store and preserves its unrelated files", async (t) => {
  const parent = await owned(t);
  const root = join(parent, "store");
  const manager = await createNinjaManager({
    root,
    registration: { projectId: "fixture" },
    provider: {
      async check() {
        return {
          checkpoint: { generation: 1, sha256: "c".repeat(64) },
          available: null,
        };
      },
    },
    installer: {},
    supervisor: {
      async status() {
        return {
          running: null,
          busy: false,
          paused: false,
          dirty: false,
          cleanupPending: false,
        };
      },
    },
  });
  await fs.rename(root, join(parent, "original-store"));
  await fs.mkdir(root);
  await fs.writeFile(
    join(root, "unrelated.txt"),
    "replacement belongs elsewhere",
  );
  const originalOpen = fs.open;
  const attemptedWrites = [];
  fs.open = async (path, flags, ...args) => {
    if (String(path).startsWith(root + "/") && flags === "wx")
      attemptedWrites.push(String(path));
    return originalOpen(path, flags, ...args);
  };
  try {
    await assert.rejects(manager.check(), /ownership|store|changed|replaced/i);
  } finally {
    fs.open = originalOpen;
  }
  assert.deepEqual(
    attemptedWrites,
    [],
    "Ownership must be checked before creating a lock in the replacement",
  );
  assert.deepEqual(await fs.readdir(root), ["unrelated.txt"]);
  assert.equal(
    await fs.readFile(join(root, "unrelated.txt"), "utf8"),
    "replacement belongs elsewhere",
  );
});
