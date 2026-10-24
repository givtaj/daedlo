import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateKeyPairSync, createPublicKey } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createManifest, sha256 } from "../scripts/release/manifest.mjs";
import { verifyNinjaCatalog } from "../scripts/release/ninja-catalog.mjs";
import {
  inspectPublisherKey,
  publishNinjaCatalog,
} from "../scripts/release/ninja-publisher.mjs";
const version = "0.1.4-alpha.2";
const now = Date.parse("2026-10-23T12:00:00.000Z");
const contracts = {
  manager: 1,
  launcher: 1,
  nodeAdapter: 1,
  rustModel: 1,
  protocol: 1,
  capabilities: ["recipeContext:1"],
};
function zip(entries) {
  return execFileSync(
    "python3",
    [
      "-c",
      `import base64,io,json,stat,sys,zipfile
out=io.BytesIO()
with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_STORED) as z:
 for name,data in json.load(sys.stdin):
  i=zipfile.ZipInfo(name);i.create_system=3;i.external_attr=(stat.S_IFREG|0o644)<<16
  z.writestr(i,base64.b64decode(data))
sys.stdout.buffer.write(out.getvalue())`,
    ],
    {
      input: JSON.stringify(
        [...entries].map(([p, b]) => [p, b.toString("base64")]),
      ),
      maxBuffer: 2 * 1024 * 1024,
    },
  );
}
const legacyVersion = version;
function kit(
  change = () => {},
  version = legacyVersion,
  packagePrefix = "browser-driver",
) {
  const source = {
    commit: "a".repeat(40),
    dirty: false,
    treeSha256: "b".repeat(64),
  };
  const runtime = Buffer.from("opaque authenticated runtime archive");
  const engine = Buffer.from("opaque authenticated crate archive");
  const tools = Buffer.from("opaque authenticated tools archive");
  const artifact = (kind, name, extension, bytes) => ({
    name,
    version,
    file: `${packagePrefix}-${kind}-${version}.${extension}`,
    bytes: bytes.length,
    sha256: sha256(bytes),
  });
  const manifest = createManifest({
    version,
    source,
    artifacts: {
      runtime: artifact("runtime", `@${packagePrefix}/runtime`, "tgz", runtime),
      engine: artifact("engine", `${packagePrefix}-engine`, "crate", engine),
    },
  });
  const manifestBytes = Buffer.from(JSON.stringify(manifest) + "\n");
  const toolsFile = `${packagePrefix}-tools-${version}.tgz`;
  const toolsReceipt = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      kind: "browser-driver-release-tools",
      name: `@${packagePrefix}/release-tools`,
      version,
      source,
      archive: { file: toolsFile, bytes: tools.length, sha256: sha256(tools) },
      fileCount: 1,
      files: [],
    }) + "\n",
  );
  const files = new Map([
    ["LICENSE", Buffer.from("MIT License; Apache-2.0 portions retained.")],
    ["THIRD_PARTY_NOTICES.md", Buffer.from("Public notices")],
    ["licenses/Apache-2.0.txt", Buffer.from("Apache License")],
    ["licenses/MIT-legacy.txt", Buffer.from("MIT License")],
    ["START_HERE.md", Buffer.from("Verified fixture guide")],
    ["AGENT_START.md", Buffer.from("Fixture skill guide")],
    ["bundle/manifest.json", manifestBytes],
    [
      "bundle/SHA256SUMS",
      Buffer.from(
        `${sha256(runtime)}  ${manifest.artifacts.runtime.file}\n${sha256(engine)}  ${manifest.artifacts.engine.file}\n${sha256(manifestBytes)}  manifest.json\n`,
      ),
    ],
    [`bundle/${manifest.artifacts.runtime.file}`, runtime],
    [`bundle/${manifest.artifacts.engine.file}`, engine],
    [`tools/${toolsFile}`, tools],
    ["tools/TOOLS_VERIFICATION.json", toolsReceipt],
    [
      "tools/TOOLS_SHA256SUMS",
      Buffer.from(
        `${sha256(tools)}  ${toolsFile}\n${sha256(toolsReceipt)}  TOOLS_VERIFICATION.json\n`,
      ),
    ],
  ]);
  change(files, manifest);
  const entries = new Map(
    [...files].map(([name, bytes]) => [`daedlo-${version}/${name}`, bytes]),
  );
  const archive = zip(entries);
  const metadata = {
    schemaVersion: 1,
    kind: "daedlo-public-kit",
    version,
    archive: {
      file: `daedlo-${version}.zip`,
      bytes: archive.length,
      sha256: sha256(archive),
    },
    source,
    bundle: {
      manifest: "bundle/manifest.json",
      manifestSha256: sha256(files.get("bundle/manifest.json")),
      artifacts: manifest.artifacts,
    },
    tools: {
      file: `tools/${toolsFile}`,
      bytes: tools.length,
      sha256: sha256(tools),
    },
    license: {
      terms: "See included per-component LICENSE and THIRD_PARTY_NOTICES.md",
      files: [
        "LICENSE",
        "THIRD_PARTY_NOTICES.md",
        "licenses/Apache-2.0.txt",
        "licenses/MIT-legacy.txt",
      ].map((file) => ({ file, sha256: sha256(files.get(file)) })),
    },
    files: [...entries].map(([file, bytes]) => ({
      file,
      bytes: bytes.length,
      sha256: sha256(bytes),
    })),
  };
  return {
    zip: archive,
    metadata: Buffer.from(JSON.stringify(metadata)),
    checksums: Buffer.from(`${sha256(archive)}  daedlo-${version}.zip\n`),
  };
}

async function fixture(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "ninja-publisher-")),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ format: "pem", type: "pkcs8" });
  const privateKeyPath = join(root, "private.pem");
  await fs.writeFile(privateKeyPath, privatePem, { mode: 0o600 });
  const kitPath = join(root, "kit");
  await fs.mkdir(kitPath);
  const files = kit();
  for (const [name, data] of [
    [`daedlo-${version}.zip`, files.zip],
    ["release.json", files.metadata],
    ["SHA256SUMS", files.checksums],
  ])
    await fs.writeFile(join(kitPath, name), data);
  const config = {
    schemaVersion: 1,
    publisher: "daedlo",
    keyId: "test-key",
    privateKeyPath,
    generation: 1,
    issuedAt: "2026-10-23T11:00:00.000Z",
    expiresAt: "2026-10-24T11:00:00.000Z",
    origin: "https://daedlo.example.test",
    catalogUrl: "https://daedlo.example.test/updates/preview.json",
    notesUrl: "https://daedlo.example.test/updates.html",
    channel: "preview",
    platforms: [{ os: "darwin", arch: "arm64" }],
    contracts,
    kitDirectories: [kitPath],
    output: join(root, "output"),
  };
  return { root, privatePem, publicKey, config, kitPath };
}
const publish = (config) => publishNinjaCatalog(config, { now });

test("signs exact kit bytes into provider-compatible catalog and public-only trust outputs", async (t) => {
  const f = await fixture(t),
    result = await publish(f.config);
  const names = (await fs.readdir(f.config.output)).sort();
  assert.deepEqual(names, [
    "preview.json",
    "publisher-public.pem",
    "publisher-trust.json",
  ]);
  const bytes = await fs.readFile(join(f.config.output, "preview.json"));
  const verified = verifyNinjaCatalog({
    bytes,
    publisher: "daedlo",
    trustedKeys: [{ id: "test-key", publicKey: f.publicKey }],
    now,
  });
  assert.equal(
    verified.catalog.releases[0].kit.url,
    `https://daedlo.example.test/downloads/${version}/daedlo-${version}.zip`,
  );
  assert.equal(result.checkpoint.sha256, verified.checkpoint.sha256);
  const trust = JSON.parse(
    await fs.readFile(join(f.config.output, "publisher-trust.json")),
  );
  assert.equal(
    trust.keys[0].spkiSha256,
    sha256(f.publicKey.export({ type: "spki", format: "der" })),
  );
  assert.equal(trust.catalogUrl, f.config.catalogUrl);
  for (const name of names) {
    const text = await fs.readFile(join(f.config.output, name), "utf8");
    assert.equal(text.includes("PRIVATE KEY"), false);
    assert.equal(text.includes(f.config.privateKeyPath), false);
    assert.equal(text.includes(f.root), false);
  }
  assert.equal(JSON.stringify(result).includes(f.privatePem), false);
  assert.equal(
    await fs.readFile(f.config.privateKeyPath, "utf8"),
    f.privatePem,
  );
});
test("public key inspection exports only Ed25519 public identity and SPKI fingerprint", async (t) => {
  const f = await fixture(t),
    inspected = await inspectPublisherKey({
      privateKeyPath: f.config.privateKeyPath,
      keyId: "test-key",
    });
  assert.equal(inspected.id, "test-key");
  assert.equal(inspected.algorithm, "Ed25519");
  assert.equal(
    createPublicKey(inspected.publicKeyPem).asymmetricKeyType,
    "ed25519",
  );
  assert.equal(
    inspected.spkiSha256,
    sha256(f.publicKey.export({ type: "spki", format: "der" })),
  );
  assert.equal(JSON.stringify(inspected).includes("PRIVATE KEY"), false);
});
for (const [name, mutate, pattern] of [
  [
    "overlong validity",
    (c) => (c.expiresAt = "2026-11-24T11:00:00.000Z"),
    /validity|expiry|seven|7.day/i,
  ],
  [
    "expired publication",
    (c) => (c.expiresAt = "2026-10-23T11:30:00.000Z"),
    /expir/i,
  ],
  [
    "future issuance",
    (c) => (c.issuedAt = "2026-10-23T13:00:00.000Z"),
    /future|issu/i,
  ],
  ["unknown config field", (c) => (c.secret = "not-public"), /field|config/i],
  [
    "renewal without previous catalog",
    (c) => (c.generation = 2),
    /previous|renew/i,
  ],
  [
    "cross-origin catalog URL",
    (c) => (c.catalogUrl = "https://other.example/updates/preview.json"),
    /origin/i,
  ],
  [
    "cross-origin notes URL",
    (c) => (c.notesUrl = "https://other.example/install"),
    /origin/i,
  ],
  [
    "HTTP asset origin",
    (c) => (c.origin = "http://daedlo.example.test"),
    /HTTPS|origin/i,
  ],
  [
    "query-bearing catalog URL",
    (c) => (c.catalogUrl += "?token=secret"),
    /URL|query|origin/i,
  ],
  [
    "empty release inventory",
    (c) => (c.kitDirectories = []),
    /inventory|kit|release/i,
  ],
])
  test(`rejects ${name} before creating public outputs`, async (t) => {
    const f = await fixture(t);
    mutate(f.config);
    await assert.rejects(publish(f.config), pattern);
    await assert.rejects(fs.lstat(f.config.output), { code: "ENOENT" });
  });
test("refuses broadly readable, linked, wrong-algorithm and malformed private key files", async (t) => {
  const f = await fixture(t);
  await fs.chmod(f.config.privateKeyPath, 0o644);
  await assert.rejects(publish(f.config), /permission|private|owner/i);
  await fs.chmod(f.config.privateKeyPath, 0o600);
  const link = join(f.root, "link.pem");
  await fs.symlink(f.config.privateKeyPath, link);
  await assert.rejects(
    publish({ ...f.config, privateKeyPath: link }),
    /symlink|link/i,
  );
  const hard = join(f.root, "hard.pem");
  await fs.link(f.config.privateKeyPath, hard);
  await assert.rejects(publish(f.config), /link|private/i);
  await fs.unlink(hard);
  const rsa = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  }).privateKey.export({ type: "pkcs8", format: "pem" });
  await fs.writeFile(f.config.privateKeyPath, rsa);
  await assert.rejects(publish(f.config), /Ed25519/i);
  await fs.writeFile(f.config.privateKeyPath, "secret sentinel invalid key");
  await assert.rejects(publish(f.config), (e) => {
    assert.match(e.message, /key/i);
    assert.equal(e.message.includes("sentinel"), false);
    return true;
  });
});
test("corrupt ZIP and inconsistent public kit metadata reject before any signed output is exposed", async (t) => {
  const f = await fixture(t),
    archive = join(f.kitPath, `daedlo-${version}.zip`);
  const original = await fs.readFile(archive),
    changed = Buffer.from(original);
  changed[100] ^= 1;
  await fs.writeFile(archive, changed);
  await assert.rejects(publish(f.config), /archive|digest|checksum|CRC/i);
  await assert.rejects(fs.lstat(f.config.output), { code: "ENOENT" });
  await fs.writeFile(archive, original);
  const metadataPath = join(f.kitPath, "release.json"),
    m = JSON.parse(await fs.readFile(metadataPath));
  m.source.dirty = true;
  await fs.writeFile(metadataPath, JSON.stringify(m));
  await assert.rejects(publish(f.config), /clean|source/i);
});
test("renewal requires newer generation and preserves previously signed release identities, including after expiry", async (t) => {
  const f = await fixture(t);
  await publish(f.config);
  const previousCatalogPath = join(f.config.output, "preview.json");
  const next = {
    ...f.config,
    generation: 2,
    previousCatalogPath,
    output: join(f.root, "renewed"),
    issuedAt: "2026-10-26T11:00:00.000Z",
    expiresAt: "2026-10-27T11:00:00.000Z",
  };
  const renewed = await publishNinjaCatalog(next, {
    now: Date.parse("2026-10-26T12:00:00.000Z"),
  });
  assert.equal(renewed.checkpoint.generation, 2);
  const original = JSON.parse(await fs.readFile(previousCatalogPath)),
    later = JSON.parse(await fs.readFile(join(next.output, "preview.json")));
  assert.deepEqual(later.signed.releases, original.signed.releases);
  await assert.rejects(
    publish({
      ...f.config,
      generation: 1,
      previousCatalogPath,
      output: join(f.root, "conflict"),
    }),
    /generation|previous|initial/i,
  );
  await assert.rejects(
    publish({
      ...f.config,
      generation: 2,
      previousCatalogPath: join(next.output, "preview.json"),
      output: join(f.root, "replay"),
    }),
    /generation|newer|issu/i,
  );
  const m = JSON.parse(await fs.readFile(join(f.kitPath, "release.json")));
  m.verification = { status: "changed" };
  await fs.writeFile(join(f.kitPath, "release.json"), JSON.stringify(m));
  await assert.rejects(
    publish({
      ...f.config,
      generation: 2,
      previousCatalogPath,
      output: join(f.root, "mutated"),
    }),
    /immutable|changed|identity/i,
  );
});
test("existing and symlinked output paths are preserved", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(f.config.output);
  await fs.writeFile(join(f.config.output, "sentinel"), "kept");
  await assert.rejects(publish(f.config), /exist/i);
  const linked = join(f.root, "linked-output");
  await fs.symlink(f.config.output, linked);
  await assert.rejects(
    publish({ ...f.config, output: join(linked, "child") }),
    /symlink|link/i,
  );
  assert.equal(
    await fs.readFile(join(f.config.output, "sentinel"), "utf8"),
    "kept",
  );
});
test("explicit prior public trust permits signing-key rotation but untrusted or tampered history rejects", async (t) => {
  const f = await fixture(t);
  await publish(f.config);
  const previousCatalogPath = join(f.config.output, "preview.json");
  const replacement = generateKeyPairSync("ed25519");
  const replacementPath = join(f.root, "replacement.pem");
  await fs.writeFile(
    replacementPath,
    replacement.privateKey.export({ format: "pem", type: "pkcs8" }),
    { mode: 0o600 },
  );
  const next = {
    ...f.config,
    keyId: "replacement-key",
    privateKeyPath: replacementPath,
    generation: 2,
    previousCatalogPath,
    output: join(f.root, "rotated"),
  };
  await assert.rejects(publish(next), /trust|signature|key/i);
  await assert.rejects(fs.lstat(next.output), { code: "ENOENT" });
  next.previousTrustedKeys = [
    {
      id: "test-key",
      publicKeyPath: join(f.config.output, "publisher-public.pem"),
    },
  ];
  await publish(next);
  const verified = verifyNinjaCatalog({
    bytes: await fs.readFile(join(next.output, "preview.json")),
    publisher: "daedlo",
    trustedKeys: [{ id: "replacement-key", publicKey: replacement.publicKey }],
    now,
  });
  assert.equal(verified.catalog.generation, 2);
  const changed = JSON.parse(await fs.readFile(previousCatalogPath));
  changed.signed.generation = 100;
  await fs.writeFile(previousCatalogPath, JSON.stringify(changed));
  await assert.rejects(
    publish({
      ...next,
      generation: 101,
      output: join(f.root, "tampered-history"),
    }),
    /signature/i,
  );
});
test("production-shaped origin and final verification metadata are signed with exact notes URL and bytes", async (t) => {
  const f = await fixture(t);
  const metadataPath = join(f.kitPath, "release.json");
  const metadata = JSON.parse(await fs.readFile(metadataPath));
  metadata.verification = {
    scope: "synthetic publisher fixture only",
    status: "pass",
  };
  const finalMetadata = Buffer.from(JSON.stringify(metadata) + "\n");
  await fs.writeFile(metadataPath, finalMetadata);
  const result = await publish({
    ...f.config,
    origin: "https://daedlo.com",
    catalogUrl: "https://daedlo.com/updates/preview.json",
    notesUrl: "https://daedlo.com/updates.html",
    keyId: "daedlo-release-2026-10",
  });
  assert.equal(result.releases[0].metadataSha256, sha256(finalMetadata));
  const catalog = JSON.parse(
    await fs.readFile(join(f.config.output, "preview.json")),
  );
  assert.equal(
    catalog.signed.releases[0].notesUrl,
    "https://daedlo.com/updates.html",
  );
  assert.equal(
    catalog.signed.releases[0].metadata.url,
    `https://daedlo.com/downloads/${version}/release.json`,
  );
  assert.equal(catalog.signed.releases[0].metadata.bytes, finalMetadata.length);
});
test("standalone CLI signs an explicit config and prints public receipt only; key parse failure stays sanitized", async (t) => {
  const f = await fixture(t);
  const configPath = join(f.root, "config.json");
  f.config.issuedAt = new Date(Date.now() - 1000).toISOString();
  f.config.expiresAt = new Date(Date.now() + 3600000).toISOString();
  await fs.writeFile(configPath, JSON.stringify(f.config));
  const cli = fileURLToPath(
    new URL("../scripts/release/ninja-publisher.mjs", import.meta.url),
  );
  const signed = spawnSync(
    process.execPath,
    [cli, "sign", "--config", configPath],
    { encoding: "utf8", timeout: 15000 },
  );
  assert.equal(signed.status, 0, signed.stderr);
  assert.equal(signed.stderr, "");
  assert.equal(JSON.parse(signed.stdout).generation, 1);
  assert.equal(signed.stdout.includes("PRIVATE KEY"), false);
  assert.equal(signed.stdout.includes(f.config.privateKeyPath), false);
  f.config.output = join(f.root, "failed-cli");
  await fs.writeFile(configPath, JSON.stringify(f.config));
  await fs.writeFile(f.config.privateKeyPath, "secret-sentinel-invalid-key");
  const failed = spawnSync(
    process.execPath,
    [cli, "sign", "--config", configPath],
    { encoding: "utf8", timeout: 15000 },
  );
  assert.equal(failed.status, 1);
  assert.equal(failed.stdout, "");
  assert.match(failed.stderr, /Cannot parse the signing private key/);
  assert.equal(failed.stderr.includes("secret-sentinel"), false);
  assert.equal(failed.stderr.includes(f.config.privateKeyPath), false);
  await assert.rejects(fs.lstat(f.config.output), { code: "ENOENT" });
});
if (process.env.DAEDLO_NINJA_ALPHA_KIT)
  test("exact frozen public alpha kit passes offline publisher and consumer verification", async (t) => {
    const f = await fixture(t);
    const result = await publish({
      ...f.config,
      kitDirectories: [process.env.DAEDLO_NINJA_ALPHA_KIT],
    });
    assert.equal(result.releases[0].version, "0.1.4-alpha.2");
    assert.equal(
      result.releases[0].archiveSha256,
      "b9555b6b237ac437f62b984f6994e3ef12ba4e8f95b730f52c9aa9313a375ee1",
    );
  });

test("publisher requires manager2 for renamed kits and retains immutable manager1 entries through explicit per-version contracts", async (t) => {
  const f = await fixture(t);
  await publish(f.config);
  const previousCatalogPath = join(f.config.output, "preview.json");
  const old = JSON.parse(await fs.readFile(previousCatalogPath));
  const newVersion = "0.1.4-alpha.4";
  const candidate = kit(() => {}, newVersion, "daedlo");
  const dir = join(f.root, "renamed-kit");
  await fs.mkdir(dir);
  await fs.writeFile(join(dir, `daedlo-${newVersion}.zip`), candidate.zip);
  await fs.writeFile(join(dir, "release.json"), candidate.metadata);
  await fs.writeFile(join(dir, "SHA256SUMS"), candidate.checksums);
  const next = {
    ...f.config,
    generation: 2,
    previousCatalogPath,
    kitDirectories: [f.kitPath, dir],
    output: join(f.root, "missing-manager"),
  };
  await assert.rejects(publish(next), /manager.*2|renamed.*manager/i);
  const explicit = {
    ...next,
    output: join(f.root, "mixed"),
    releaseContracts: { [newVersion]: { ...contracts, manager: 2 } },
  };
  await publish(explicit);
  const mixed = JSON.parse(
    await fs.readFile(join(explicit.output, "preview.json")),
  );
  assert.deepEqual(
    mixed.signed.releases.find((r) => r.version === version),
    old.signed.releases[0],
  );
  assert.equal(
    mixed.signed.releases.find((r) => r.version === newVersion).contracts
      .manager,
    2,
  );
  await assert.rejects(
    publish({
      ...explicit,
      output: join(f.root, "unknown-override"),
      releaseContracts: { "0.1.4-alpha.99": { ...contracts, manager: 2 } },
    }),
    /release contract|override|manager/i,
  );
});
