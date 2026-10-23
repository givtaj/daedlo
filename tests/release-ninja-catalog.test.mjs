import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  createManifest,
  sha256,
  verifyBundle,
} from "../scripts/release/manifest.mjs";
import {
  ninjaCatalogSigningBytes,
  verifyNinjaCatalog,
  selectNinjaRelease,
  fetchNinjaCatalog,
  downloadNinjaKit,
} from "../scripts/release/ninja-catalog.mjs";

const now = Date.parse("2026-10-23T12:00:00.000Z");
const origin = "https://updates.example.test";
const version = "0.1.4-alpha.2";
const contracts = {
  manager: 1,
  launcher: 1,
  nodeAdapter: 1,
  rustModel: 1,
  protocol: 1,
  capabilities: ["recipeContext"],
};
const platform = { os: "darwin", arch: "arm64" };
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const trustedKeys = [{ id: "local-test-key", publicKey }];
const trust = { trustedKeys, publisher: "daedlo", now };
const asset = (file, bytes) => ({
  url: `${origin}/downloads/${version}/${file}`,
  bytes: bytes.length,
  sha256: sha256(bytes),
});
function envelope(signed, key = privateKey, keyId = "local-test-key") {
  return Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      kind: "daedlo-signed-catalog",
      signed,
      signature: {
        keyId,
        value: sign(null, ninjaCatalogSigningBytes(signed), key).toString(
          "base64",
        ),
      },
    }),
  );
}
function catalog(release, changes = {}) {
  return {
    schemaVersion: 1,
    kind: "daedlo-public-kit-catalog",
    publisher: "daedlo",
    generation: 5,
    issuedAt: "2026-10-23T11:00:00.000Z",
    expiresAt: "2026-10-24T11:00:00.000Z",
    releases: [release],
    ...changes,
  };
}
function entry(files) {
  return {
    version,
    channel: "preview",
    platforms: [platform],
    contracts,
    notesUrl: `${origin}/notes/${version}`,
    kit: asset(`daedlo-${version}.zip`, files.zip),
    metadata: asset("release.json", files.metadata),
    checksums: asset("SHA256SUMS", files.checksums),
  };
}
const dummy = entry({
  zip: Buffer.from("zip"),
  metadata: Buffer.from("{}"),
  checksums: Buffer.from("checksums"),
});
const verified = (signed = catalog(dummy), options = {}) =>
  verifyNinjaCatalog({ bytes: envelope(signed), ...trust, ...options });
const choose = (value, options = {}) =>
  selectNinjaRelease(value, {
    channel: "preview",
    platform,
    currentVersion: "0.1.4-alpha.1",
    contracts,
    ...options,
  });
async function owned(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "ninja-provider-")),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
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
function kit(change = () => {}) {
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
    file: `browser-driver-${kind}-${version}.${extension}`,
    bytes: bytes.length,
    sha256: sha256(bytes),
  });
  const manifest = createManifest({
    version,
    source,
    artifacts: {
      runtime: artifact("runtime", "@browser-driver/runtime", "tgz", runtime),
      engine: artifact("engine", "browser-driver-engine", "crate", engine),
    },
  });
  const manifestBytes = Buffer.from(JSON.stringify(manifest) + "\n");
  const toolsFile = `browser-driver-tools-${version}.tgz`;
  const toolsReceipt = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      kind: "browser-driver-release-tools",
      name: "@browser-driver/release-tools",
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
function transport(files, log = []) {
  const bodies = new Map([
    [`daedlo-${version}.zip`, files.zip],
    ["release.json", files.metadata],
    ["SHA256SUMS", files.checksums],
  ]);
  return async (url, options) => {
    log.push({ url, method: options.method, redirect: options.redirect });
    const bytes = bodies.get(new URL(url).pathname.split("/").at(-1));
    return new Response(bytes, {
      status: 200,
      headers: { "content-length": String(bytes.length) },
    });
  };
}
async function download(t, files, extra = {}) {
  const root = await owned(t);
  const value = verified(catalog(entry(files)));
  return downloadNinjaKit({
    verified: value,
    version,
    output: join(root, "candidate"),
    allowedOrigin: origin,
    now,
    fetchImpl: transport(files),
    ...extra,
  });
}

test("verifies Ed25519 publisher identity and returns an immutable replay checkpoint", () => {
  const result = verified();
  assert.equal(result.catalog.releases[0].version, version);
  assert.equal(result.checkpoint.generation, 5);
  assert.match(result.checkpoint.sha256, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(result.catalog.releases[0]));
  assert.throws(() => {
    result.catalog.generation = 9;
  }, TypeError);
  assert.deepEqual(
    verified(catalog(dummy), { previousState: result.checkpoint }).checkpoint,
    result.checkpoint,
  );
});
for (const [label, change, options, pattern] of [
  ["unknown signing key", null, { trustedKeys: [] }, /trust|key/i],
  [
    "wrong publisher",
    (s) => {
      s.publisher = "other";
    },
    {},
    /publisher/i,
  ],
  [
    "expired catalog",
    (s) => {
      s.expiresAt = "2026-10-23T11:30:00.000Z";
    },
    {},
    /expir/i,
  ],
  [
    "future issuance",
    (s) => {
      s.issuedAt = "2026-10-24T11:00:00.000Z";
      s.expiresAt = "2026-10-25T11:00:00.000Z";
    },
    {},
    /future|issu/i,
  ],
  [
    "excessive validity",
    (s) => {
      s.expiresAt = "2027-01-01T00:00:00.000Z";
    },
    {},
    /validity|expir/i,
  ],
  [
    "replayed older generation",
    null,
    { previousState: { generation: 6, sha256: "a".repeat(64) } },
    /replay|generation/i,
  ],
  [
    "same generation changed content",
    null,
    { previousState: { generation: 5, sha256: "a".repeat(64) } },
    /equivocation|generation/i,
  ],
  [
    "unknown catalog fields",
    (s) => {
      s.execute = "arbitrary";
    },
    {},
    /field|schema/i,
  ],
  [
    "duplicate release versions",
    (s) => {
      s.releases.push(structuredClone(s.releases[0]));
    },
    {},
    /duplicate/i,
  ],
  [
    "stable channel containing prerelease",
    (s) => {
      s.releases[0].channel = "stable";
    },
    {},
    /channel|prerelease/i,
  ],
  [
    "credentials in signed URL",
    (s) => {
      s.releases[0].kit.url =
        "https://secret:password@updates.example.test/a.zip";
    },
    {},
    /URL|url/i,
  ],
])
  test(`rejects ${label}`, () => {
    const s = catalog(structuredClone(dummy));
    change?.(s);
    assert.throws(() => verified(s, options), pattern);
  });
test("rejects changed signed payload and wrong signature algorithm", () => {
  const bytes = JSON.parse(envelope(catalog(dummy)));
  bytes.signed.generation = 6;
  assert.throws(
    () =>
      verifyNinjaCatalog({
        bytes: Buffer.from(JSON.stringify(bytes)),
        ...trust,
      }),
    /signature/i,
  );
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  assert.throws(
    () =>
      verified(catalog(dummy), {
        trustedKeys: [{ id: "local-test-key", publicKey: rsa.publicKey }],
      }),
    /Ed25519|key/i,
  );
});
test("selects only explicit supported channel/platform/contracts, without claiming application acceptance", () => {
  const v = verified();
  assert.equal(choose(v).status, "update_available");
  assert.equal(choose(v, { channel: "stable" }).status, "up_to_date");
  assert.equal(
    choose(v, { platform: { os: "linux", arch: "x64" } }).status,
    "incompatible",
  );
  assert.equal(
    choose(v, { contracts: { ...contracts, nodeAdapter: 2 } }).status,
    "incompatible",
  );
  assert.equal(
    choose(v, { contracts: { ...contracts, capabilities: ["missing"] } })
      .status,
    "incompatible",
  );
  assert.equal(choose(v, { currentVersion: version }).status, "up_to_date");
  assert.throws(() => choose({ catalog: v.catalog }), /verified|catalog/i);
});
test("reports unconfigured publisher feed separately and bounds/rejects failed or redirected discovery", async () => {
  assert.equal((await fetchNinjaCatalog({ ...trust })).status, "unconfigured");
  const url = `${origin}/catalog.json`;
  const good = await fetchNinjaCatalog({
    url,
    ...trust,
    fetchImpl: async () => new Response(envelope(catalog(dummy))),
  });
  assert.equal(good.catalog.generation, 5);
  await assert.rejects(
    fetchNinjaCatalog({
      url,
      ...trust,
      fetchImpl: async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.test/feed" },
        }),
    }),
    /redirect|HTTP|response/i,
  );
  await assert.rejects(
    fetchNinjaCatalog({
      url,
      ...trust,
      fetchImpl: async () => new Response("x".repeat(1048577)),
    }),
    /size|limit|large/i,
  );
});
test("downloads all three authenticated files and extracts exact safe kit without changing inner schema1", async (t) => {
  const files = kit();
  const root = await owned(t);
  const sentinel = join(root, "existing.txt");
  await fs.writeFile(sentinel, "preserve");
  const log = [];
  const result = await downloadNinjaKit({
    verified: verified(catalog(entry(files))),
    version,
    output: join(root, "candidate"),
    allowedOrigin: origin,
    now,
    fetchImpl: transport(files, log),
  });
  assert.equal(
    (await verifyBundle(result.bundlePath)).manifest.schemaVersion,
    1,
  );
  assert.equal(result.metadata.version, version);
  assert.equal(result.identity.archiveSha256, sha256(files.zip));
  assert.equal(result.toolsPath, join(result.kitPath, "tools"));
  assert.equal(await fs.readFile(sentinel, "utf8"), "preserve");
  assert.equal(log.length, 3);
  assert.ok(log.every((r) => r.method === "GET" && r.redirect === "error"));
});
test("corrupt or changed downloads never publish an output directory", async (t) => {
  const files = kit();
  const root = await owned(t);
  const output = join(root, "candidate");
  const bad = { ...files, zip: Buffer.from(files.zip) };
  bad.zip[100] ^= 1;
  await assert.rejects(
    downloadNinjaKit({
      verified: verified(catalog(entry(files))),
      version,
      output,
      allowedOrigin: origin,
      now,
      fetchImpl: transport(bad),
    }),
    /digest|checksum/i,
  );
  await assert.rejects(fs.lstat(output), { code: "ENOENT" });
  assert.deepEqual(await fs.readdir(root), []);
});
test("rejects extra inner bundle fields even when outer bytes are signed", async (t) => {
  const files = kit((map, manifest) => {
    manifest.compatibility.nodeAdapter = 1;
    const b = Buffer.from(JSON.stringify(manifest) + "\n");
    map.set("bundle/manifest.json", b);
    const a = manifest.artifacts;
    map.set(
      "bundle/SHA256SUMS",
      Buffer.from(
        `${a.runtime.sha256}  ${a.runtime.file}\n${a.engine.sha256}  ${a.engine.file}\n${sha256(b)}  manifest.json\n`,
      ),
    );
  });
  await assert.rejects(download(t, files), /compatibility|field/i);
});
test("rejects unsafe/duplicate ZIP entries, invalid ZIP structure and wrong metadata inventory", async (t) => {
  for (const kind of ["traversal", "duplicate", "not-zip", "inventory"]) {
    const files = kit();
    const m = JSON.parse(files.metadata);
    if (kind === "traversal")
      files.zip = zip([["../outside", Buffer.from("bad")]]);
    if (kind === "duplicate")
      files.zip = zip([
        ["safe", Buffer.from("bad")],
        ["safe", Buffer.from("again")],
      ]);
    if (kind === "not-zip") files.zip = Buffer.from("not a zip");
    m.archive = {
      ...m.archive,
      bytes: files.zip.length,
      sha256: sha256(files.zip),
    };
    if (kind === "inventory") m.files.pop();
    files.metadata = Buffer.from(JSON.stringify(m));
    files.checksums = Buffer.from(
      `${sha256(files.zip)}  daedlo-${version}.zip\n`,
    );
    await assert.rejects(
      download(t, files),
      /ZIP|zip|inventory|entry|archive/i,
    );
  }
});
test("refuses untrusted origin, existing destination and symlink ancestry without replacing them", async (t) => {
  const files = kit();
  const root = await owned(t);
  const output = join(root, "existing");
  await fs.mkdir(output);
  await fs.writeFile(join(output, "sentinel"), "kept");
  await assert.rejects(
    downloadNinjaKit({
      verified: verified(catalog(entry(files))),
      version,
      output,
      allowedOrigin: origin,
      now,
      fetchImpl: transport(files),
    }),
    /exist/i,
  );
  await assert.rejects(
    download(t, files, { allowedOrigin: "https://other.test" }),
    /origin/i,
  );
  await fs.symlink(output, join(root, "link"));
  await assert.rejects(
    download(t, files, { output: join(root, "link/new") }),
    /symlink/i,
  );
  assert.equal(await fs.readFile(join(output, "sentinel"), "utf8"), "kept");
});
// Optional exact published-kit acceptance. CI can supply the frozen three-file directory;
// default unit tests remain self-contained and never fetch network fixtures.
if (process.env.DAEDLO_NINJA_ALPHA_KIT)
  test("real frozen alpha.2 public ZIP passes trusted local catalog acceptance", async (t) => {
    const directory = process.env.DAEDLO_NINJA_ALPHA_KIT;
    const files = {
      zip: await fs.readFile(join(directory, `daedlo-${version}.zip`)),
      metadata: await fs.readFile(join(directory, "release.json")),
      checksums: await fs.readFile(join(directory, "SHA256SUMS")),
    };
    assert.equal(
      sha256(files.zip),
      "b9555b6b237ac437f62b984f6994e3ef12ba4e8f95b730f52c9aa9313a375ee1",
    );
    const result = await download(t, files);
    assert.equal(
      result.metadata.source.commit,
      "044e76df10e90c68e9e3c7ff35e7c63a62354c60",
    );
    assert.equal(
      (await verifyBundle(result.bundlePath)).manifest.schemaVersion,
      1,
    );
    assert.deepEqual(result.identity.contracts, contracts);
  });

test("discovery verifies fetched bytes even when caller passes an unrelated bytes option", async () => {
  const altered = JSON.parse(envelope(catalog(dummy)));
  altered.signed.generation = 9;
  await assert.rejects(
    fetchNinjaCatalog({
      url: `${origin}/catalog.json`,
      ...trust,
      bytes: envelope(catalog(dummy)),
      fetchImpl: async () => new Response(JSON.stringify(altered)),
    }),
    /signature/i,
  );
});
test("expired verified discovery cannot download and does not touch output", async (t) => {
  const files = kit();
  let fetched = false;
  await assert.rejects(
    download(t, files, {
      now: Date.parse("2026-10-25T00:00:00.000Z"),
      fetchImpl: async () => {
        fetched = true;
        throw Error("must not fetch");
      },
    }),
    /expired/i,
  );
  assert.equal(fetched, false);
});
test("symlink ZIP modes, corrupted CRCs and oversized expansions reject before extraction", async (t) => {
  for (const kind of ["symlink", "crc", "expansion"]) {
    const files = kit();
    const central = files.zip.readUInt32LE(files.zip.length - 6);
    if (kind === "symlink")
      files.zip.writeUInt32LE((0o120777 << 16) >>> 0, central + 38);
    if (kind === "crc") {
      const crc = (files.zip.readUInt32LE(central + 16) ^ 1) >>> 0;
      files.zip.writeUInt32LE(crc, central + 16);
      files.zip.writeUInt32LE(crc, 14);
    }
    if (kind === "expansion")
      files.zip.writeUInt32LE(64 * 1024 * 1024 + 1, central + 24);
    const m = JSON.parse(files.metadata);
    m.archive.sha256 = sha256(files.zip);
    files.metadata = Buffer.from(JSON.stringify(m));
    files.checksums = Buffer.from(
      `${sha256(files.zip)}  daedlo-${version}.zip\n`,
    );
    const root = await owned(t);
    await assert.rejects(
      download(t, files, { output: join(root, "candidate") }),
      /regular|CRC|size/i,
    );
    assert.deepEqual(await fs.readdir(root), []);
  }
});
test("destination appearing during download is preserved and no staging is left", async (t) => {
  const files = kit();
  const root = await owned(t);
  const output = join(root, "candidate");
  const fetchFiles = transport(files);
  let first = true;
  await assert.rejects(
    download(t, files, {
      output,
      fetchImpl: async (...args) => {
        if (first) {
          first = false;
          await fs.mkdir(output);
          await fs.writeFile(
            join(output, "sentinel"),
            "belongs to someone else",
          );
        }
        return fetchFiles(...args);
      },
    }),
    /exist/i,
  );
  assert.deepEqual(await fs.readdir(root), ["candidate"]);
  assert.equal(
    await fs.readFile(join(output, "sentinel"), "utf8"),
    "belongs to someone else",
  );
});
test("publication failure cleans owned staging and reports a replaced reservation without deleting it", async (t) => {
  const files = kit();
  const root = await owned(t);
  const output = join(root, "candidate");
  const originalRename = fs.rename;
  fs.rename = async (from, to) => {
    assert.equal(to, output);
    await originalRename(to, join(root, "original-reservation"));
    await fs.mkdir(to);
    await fs.writeFile(join(to, "sentinel"), "replacement");
    throw Error("injected publication failure");
  };
  try {
    await assert.rejects(download(t, files, { output }), (error) => {
      assert.match(error.message, /injected publication/);
      assert.equal(error.cleanupFailed, true);
      assert.deepEqual(error.retainedPaths, [output]);
      return true;
    });
  } finally {
    fs.rename = originalRename;
  }
  assert.equal(
    await fs.readFile(join(output, "sentinel"), "utf8"),
    "replacement",
  );
  assert.deepEqual((await fs.readdir(root)).sort(), [
    "candidate",
    "original-reservation",
  ]);
});
