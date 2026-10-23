import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { generateKeyPairSync, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createManifest, sha256 } from "../scripts/release/manifest.mjs";
import {
  ninjaCatalogSigningBytes,
  verifyNinjaCatalog,
} from "../scripts/release/ninja-catalog.mjs";
import {
  prepareNinjaRenewal,
  verifyNinjaRenewal,
  verifyLiveNinjaRenewal,
} from "../scripts/release/ninja-renew.mjs";
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const now = Date.now();
const origin = "https://daedlo.com";
const feed = origin + "/updates/preview.json";
const keyId = "daedlo-release-2026-10";
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
function kit(version, change = () => {}) {
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

async function fixture(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "ninja-renew-test-")),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourceRoot = join(root, "source");
  await fs.mkdir(sourceRoot);
  await fs.cp(join(repo, "website"), join(sourceRoot, "website"), {
    recursive: true,
    filter: (p) =>
      !/(?:\/public\/(?:downloads|updates)(?:\/|$)|\/public\/(?:install|updates)\.html$|\.DS_Store$)/.test(
        p,
      ),
  });
  await fs.mkdir(join(sourceRoot, "docs/update-trust"), { recursive: true });
  const keys = generateKeyPairSync("ed25519");
  const pem = Buffer.from(
    keys.publicKey.export({ type: "spki", format: "pem" }),
  );
  const privateKeyPath = join(root, "private.pem");
  await fs.writeFile(
    privateKeyPath,
    keys.privateKey.export({ type: "pkcs8", format: "pem" }),
    { mode: 0o600 },
  );
  await fs.writeFile(
    join(sourceRoot, "docs/update-trust", keyId + ".pem"),
    pem,
  );
  const bodies = new Map(),
    assets = {};
  const releases = [];
  for (const version of ["0.1.2-rc.1", "0.1.4-alpha.2", "0.1.4-alpha.3"]) {
    const files = kit(version);
    const entries = {
      [`daedlo-${version}.zip`]: files.zip,
      "release.json": files.metadata,
      SHA256SUMS: files.checksums,
    };
    assets[version] = {};
    for (const [name, b] of Object.entries(entries)) {
      const url = `${origin}/downloads/${version}/${name}`;
      bodies.set(url, b);
      assets[version][name] = { bytes: b.length, sha256: sha256(b) };
    }
    if (version === "0.1.2-rc.1") continue;
    const asset = (name) => ({
      url: `${origin}/downloads/${version}/${name}`,
      ...assets[version][name],
    });
    releases.push({
      version,
      channel: "preview",
      platforms: [{ os: "darwin", arch: "arm64" }],
      contracts,
      notesUrl: origin + "/updates.html",
      kit: asset(`daedlo-${version}.zip`),
      metadata: asset("release.json"),
      checksums: asset("SHA256SUMS"),
    });
  }
  const signed = {
    schemaVersion: 1,
    kind: "daedlo-public-kit-catalog",
    publisher: "daedlo",
    generation: 1,
    issuedAt: new Date(now - 9 * 86400000).toISOString(),
    expiresAt: new Date(now - 2 * 86400000).toISOString(),
    releases,
  };
  const envelope = () =>
    Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        kind: "daedlo-signed-catalog",
        signed,
        signature: {
          keyId,
          value: sign(
            null,
            ninjaCatalogSigningBytes(signed),
            keys.privateKey,
          ).toString("base64"),
        },
      }) + "\n",
    );
  const baseline = envelope();
  bodies.set(feed, baseline);
  const policy = {
    publicKeyPemSha256: sha256(pem),
    assets,
    initialCheckpoint: {
      generation: 1,
      sha256: sha256(ninjaCatalogSigningBytes(signed)),
    },
  };
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    const b = bodies.get(url);
    return new Response(b ?? "missing", {
      status: b ? 200 : 404,
      headers: {
        date: new Date(now).toUTCString(),
        "content-length": String((b ?? Buffer.from("missing")).length),
      },
    });
  };
  return {
    root,
    sourceRoot,
    keys,
    pem,
    privateKeyPath,
    bodies,
    signed,
    envelope,
    baseline,
    policy,
    requests,
    options: { privateKeyPath, output: join(root, "prepared") },
    dependencies: { fetchImpl, now, sourceRoot, policy },
  };
}
const prep = (f) => prepareNinjaRenewal(f.options, f.dependencies);
test("expired authenticated feed renews exactly one generation and retains every immutable byte without private material", async (t) => {
  const f = await fixture(t);
  const result = await prep(f);
  assert.equal(result.generation, 2);
  assert.equal(result.baselineSha256, sha256(f.baseline));
  const receipt = JSON.parse(
    await fs.readFile(join(f.options.output, "renewal-receipt.json")),
  );
  assert.equal(receipt.status, "PREPARED");
  assert.equal(receipt.sourceUnchanged, true);
  const bytes = await fs.readFile(
    join(result.sitePath, "public/updates/preview.json"),
  );
  const v = verifyNinjaCatalog({
    bytes,
    publisher: "daedlo",
    trustedKeys: [{ id: keyId, publicKey: f.keys.publicKey }],
    now,
  });
  assert.equal(v.catalog.generation, 2);
  assert.equal(Date.parse(v.catalog.expiresAt) - now, 7 * 86400000);
  assert.deepEqual(v.catalog.releases, f.signed.releases);
  for (const [url, b] of f.bodies) {
    if (url === feed) continue;
    assert.deepEqual(
      await fs.readFile(join(result.sitePath, "public", new URL(url).pathname)),
      b,
    );
  }
  const publicFiles = async (root) => {
    for (const e of await fs.readdir(root, { withFileTypes: true })) {
      const p = join(root, e.name);
      assert.equal(e.isSymbolicLink(), false);
      if (e.isDirectory()) await publicFiles(p);
      else
        assert.equal(
          (await fs.readFile(p)).includes(
            Buffer.from("-----BEGIN PRIVATE KEY-----"),
          ),
          false,
        );
    }
  };
  await publicFiles(f.options.output);
  assert.equal(
    f.requests.every((x) => x.options.redirect === "error"),
    true,
  );
  assert.equal(
    (await verifyNinjaRenewal({ output: f.options.output }, f.dependencies))
      .status,
    "PASS",
  );
});
for (const [name, change, pattern] of [
  [
    "wrong private key",
    async (f) => {
      const k = generateKeyPairSync("ed25519").privateKey;
      await fs.writeFile(
        f.privateKeyPath,
        k.export({ type: "pkcs8", format: "pem" }),
      );
    },
    /key|pin/i,
  ],
  [
    "signature tampering",
    async (f) => {
      const e = JSON.parse(f.baseline);
      e.signed.generation++;
      f.bodies.set(feed, Buffer.from(JSON.stringify(e)));
    },
    /signature/i,
  ],
  [
    "modified immutable ZIP",
    async (f) => {
      f.bodies.set(
        origin + "/downloads/0.1.4-alpha.3/daedlo-0.1.4-alpha.3.zip",
        Buffer.from("corrupt"),
      );
    },
    /digest|size|immutable|bytes/i,
  ],
  [
    "modified legacy metadata",
    async (f) => {
      f.bodies.set(
        origin + "/downloads/0.1.2-rc.1/release.json",
        Buffer.from("{}"),
      );
    },
    /digest|size|immutable|bytes/i,
  ],
  [
    "future baseline clock",
    async (f) => {
      f.dependencies.now = now - 10 * 86400000;
    },
    /clock|future|issu/i,
  ],
  [
    "nonfinite clock",
    async (f) => {
      f.dependencies.now = NaN;
    },
    /clock/i,
  ],
  [
    "unsigned origin change",
    async (f) => {
      f.signed.releases[0].kit.url = "https://untrusted.test/download.zip";
      f.bodies.set(feed, f.envelope());
    },
    /origin|URL|immutable/i,
  ],
  [
    "later generation without durable checkpoint",
    async (f) => {
      f.signed.generation = 2;
      f.bodies.set(feed, f.envelope());
    },
    /checkpoint|replay/i,
  ],
  [
    "unsupported release inventory",
    async (f) => {
      f.signed.releases.pop();
      f.bodies.set(feed, f.envelope());
    },
    /inventory|release|checkpoint/i,
  ],
])
  test(`renewal rejects ${name}`, async (t) => {
    const f = await fixture(t);
    await change(f);
    await assert.rejects(prep(f), pattern);
  });
test("concurrent live feed drift prevents preparation from yielding a deployable receipt", async (t) => {
  const f = await fixture(t);
  const original = f.dependencies.fetchImpl;
  let checks = 0;
  f.dependencies.fetchImpl = async (u, o) => {
    if (u === feed && ++checks > 1) {
      f.signed.generation = 2;
      f.bodies.set(feed, f.envelope());
    }
    return original(u, o);
  };
  await assert.rejects(prep(f), /changed|drift|baseline/i);
});
test("predeploy rejects live drift, staged modification and expiry", async (t) => {
  const f = await fixture(t);
  await prep(f);
  f.signed.generation = 2;
  f.bodies.set(feed, f.envelope());
  await assert.rejects(
    verifyNinjaRenewal({ output: f.options.output }, f.dependencies),
    /changed|drift|baseline/i,
  );
  f.bodies.set(feed, f.baseline);
  const page = join(f.options.output, "site/public/index.html");
  await fs.appendFile(page, "changed");
  await assert.rejects(
    verifyNinjaRenewal({ output: f.options.output }, f.dependencies),
    /manifest|changed|integrity/i,
  );
});
test("durable checkpoint rejects replay and permits the exact authenticated next baseline", async (t) => {
  const f = await fixture(t);
  const checkpointPath = join(f.root, "checkpoint.json");
  f.options.checkpointPath = checkpointPath;
  f.signed.generation = 2;
  await fs.writeFile(checkpointPath, f.envelope());
  await assert.rejects(prep(f), /replay|generation/i);
  f.bodies.set(feed, f.envelope());
  assert.equal((await prep(f)).generation, 3);
});
test("existing output is refused and remains untouched", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(f.options.output);
  await fs.writeFile(join(f.options.output, "sentinel"), "kept");
  await assert.rejects(prep(f), /exist|fresh/i);
  assert.equal(
    await fs.readFile(join(f.options.output, "sentinel"), "utf8"),
    "kept",
  );
});
test("predeploy rejects expired prepared catalog and signed same-generation equivocation", async (t) => {
  const f = await fixture(t);
  await prep(f);
  await assert.rejects(
    verifyNinjaRenewal(
      { output: f.options.output },
      { ...f.dependencies, now: now + 8 * 86400000 },
    ),
    /expired/i,
  );
  const changed = {
    ...f.signed,
    expiresAt: new Date(now - 3 * 86400000).toISOString(),
  };
  f.bodies.set(
    feed,
    Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        kind: "daedlo-signed-catalog",
        signed: changed,
        signature: {
          keyId,
          value: sign(
            null,
            ninjaCatalogSigningBytes(changed),
            f.keys.privateKey,
          ).toString("base64"),
        },
      }),
    ),
  );
  await assert.rejects(
    verifyNinjaRenewal({ output: f.options.output }, f.dependencies),
    /changed|baseline/i,
  );
});
test("HTTP failure identifies the fixed feed path, status and exact Cloudflare challenge marker", async (t) => {
  const f = await fixture(t);
  let requested = 0;
  f.dependencies.fetchImpl = async (url, options) => {
    requested++;
    assert.equal(url, feed);
    assert.equal(options.redirect, "error");
    assert.deepEqual(options.headers, { "Cache-Control": "no-cache" });
    const response = new Response("private body must never enter diagnostics", {
      status: 403,
      statusText: "private status text",
      headers: {
        "cf-mitigated": "challenge",
        "set-cookie": "private-cookie=value",
        "x-private": "private-header-value",
      },
    });
    Object.defineProperty(response, "body", {
      get() {
        assert.fail("status failure must not read the response body");
      },
    });
    return response;
  };
  await assert.rejects(prep(f), {
    message:
      "Unexpected renewal HTTP status: /updates/preview.json status=403 expected=200 cf-mitigated=challenge",
  });
  assert.equal(requested, 1);
  await assert.rejects(fs.lstat(f.options.output), { code: "ENOENT" });
});
test("HTTP asset failure reports only a reviewed fixed path and excludes unknown mitigation values", async (t) => {
  const f = await fixture(t);
  const original = f.dependencies.fetchImpl;
  f.dependencies.fetchImpl = async (url, options) => {
    if (url === feed) return original(url, options);
    assert.equal(url, origin + "/downloads/0.1.2-rc.1/daedlo-0.1.2-rc.1.zip");
    return new Response("private body", {
      status: 503,
      headers: {
        "cf-mitigated": "untrusted-private-value",
        "x-private": "secret",
      },
    });
  };
  await assert.rejects(prep(f), {
    message:
      "Unexpected renewal HTTP status: /downloads/0.1.2-rc.1/daedlo-0.1.2-rc.1.zip status=503 expected=200",
  });
});
test("HTTP diagnostic never emits a queried or unreviewed request path", async (t) => {
  const f = await fixture(t);
  const pin = f.policy.assets["0.1.2-rc.1"]["daedlo-0.1.2-rc.1.zip"];
  f.policy.assets["0.1.2-rc.1"] = {
    "unreviewed-secret.zip?token=private-query": pin,
  };
  const original = f.dependencies.fetchImpl;
  f.dependencies.fetchImpl = async (url, options) => {
    if (url === feed) return original(url, options);
    assert.match(url, /unreviewed-secret\.zip\?token=private-query$/);
    return new Response("private body", { status: 502 });
  };
  await assert.rejects(prep(f), {
    message:
      "Unexpected renewal HTTP status: [unreviewed-path] status=502 expected=200",
  });
});
test("transport rejects redirect, wrong HTTPS Date and oversized catalog before staging", async (t) => {
  for (const kind of ["redirect", "date", "size"]) {
    const f = await fixture(t);
    f.dependencies.fetchImpl = async () =>
      new Response("bad", {
        status: kind === "redirect" ? 302 : 200,
        headers: {
          location: "https://untrusted.test",
          date: new Date(now - 86400000).toUTCString(),
          "content-length": kind === "size" ? "999999999" : "3",
        },
      });
    await assert.rejects(prep(f), /status|clock|size/i);
    await assert.rejects(fs.lstat(f.options.output), { code: "ENOENT" });
  }
});
test("live verifier checks exact deployed assets, canonical HTML redirects, cache policy and private boundaries", async (t) => {
  const f = await fixture(t);
  await prep(f);
  const receipt = JSON.parse(
    await fs.readFile(join(f.options.output, "renewal-receipt.json")),
  );
  const served = new Map();
  for (const file of receipt.manifest.files) {
    if (
      !file.path.startsWith("public/") ||
      ["public/_headers", "public/.assetsignore"].includes(file.path)
    )
      continue;
    served.set(
      origin + "/" + file.path.slice(7),
      await fs.readFile(join(f.options.output, "site", file.path)),
    );
  }
  assert.deepEqual(
    served.get(origin + "/onboarding.js"),
    await fs.readFile(join(repo, "website/public/onboarding.js")),
    "The new copy script must be staged and verified as exact public source bytes",
  );
  const teachingAssets = ["teaching.html", "teaching.css"];
  const teachingIdentities = [];
  for (const name of teachingAssets) {
    const source = await fs.readFile(join(repo, "website/public", name));
    assert.deepEqual(
      served.get(origin + "/" + name),
      source,
      `${name} must be staged as exact public source bytes`,
    );
    teachingIdentities.push({
      path: name,
      bytes: source.length,
      sha256: sha256(source),
    });
  }
  let mode = "good";
  const fetchImpl = async (url, options) => {
    if (url === origin + "/index.html") {
      assert.equal(options.redirect, "manual");
      return new Response("", { status: 308, headers: { location: "/" } });
    }
    const canonical = url === origin + "/" ? origin + "/index.html" : url;
    const body = served.get(canonical);
    const headers = {
      "x-content-type-options": "nosniff",
      "content-length": String(body?.length ?? 0),
    };
    headers["cache-control"] =
      url === feed
        ? "no-cache, max-age=0, must-revalidate"
        : /\/(downloads|updates\/keys)\//.test(url)
          ? "public, max-age=31536000, immutable"
          : "no-cache";
    if (mode === "cache" && url === feed)
      headers["cache-control"] = "public, max-age=3600";
    if (mode === "private" && url === origin + "/.env")
      return new Response("secret", { status: 200 });
    return new Response(body ?? "", { status: body ? 200 : 404, headers });
  };
  const live = await verifyLiveNinjaRenewal(
    { output: f.options.output },
    { ...f.dependencies, fetchImpl },
  );
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(live).filter(([k]) =>
        ["status", "servedAssets", "privateBoundaries", "generation"].includes(
          k,
        ),
      ),
    ),
    { status: "PASS", generation: 2, servedAssets: 30, privateBoundaries: 9 },
  );
  assert.deepEqual(
    teachingAssets.map((name) =>
      live.assets.find((asset) => asset.path === name),
    ),
    teachingIdentities,
    "Live verification must report each teaching asset's exact source identity",
  );
  for (const name of teachingAssets) {
    const url = origin + "/" + name;
    const original = served.get(url);
    assert.ok(original.length > 0);
    const altered = Buffer.from(original);
    altered[0] ^= 1;
    assert.equal(altered.length, original.length);
    assert.notDeepEqual(altered, original);
    served.set(url, altered);
    try {
      await assert.rejects(
        verifyLiveNinjaRenewal(
          { output: f.options.output },
          { ...f.dependencies, fetchImpl },
        ),
        { message: "Live public asset differs from prepared manifest" },
        `${name} must reject same-length live tampering`,
      );
    } finally {
      served.set(url, original);
    }
  }
  mode = "cache";
  await assert.rejects(
    verifyLiveNinjaRenewal(
      { output: f.options.output },
      { ...f.dependencies, fetchImpl },
    ),
    /cache/i,
  );
  mode = "private";
  await assert.rejects(
    verifyLiveNinjaRenewal(
      { output: f.options.output },
      { ...f.dependencies, fetchImpl },
    ),
    /status/i,
  );
});
test("predeploy rejects altered durable checkpoint receipt", async (t) => {
  const f = await fixture(t);
  await prep(f);
  const path = join(f.options.output, "checkpoint/receipt.json");
  const receipt = JSON.parse(await fs.readFile(path));
  receipt.catalogSha256 = "0".repeat(64);
  await fs.writeFile(path, JSON.stringify(receipt));
  await assert.rejects(
    verifyNinjaRenewal({ output: f.options.output }, f.dependencies),
    /checkpoint/i,
  );
});
test("workflow limits events, credentials, concurrency and deployed configuration", async () => {
  let text = "";
  try {
    text = await fs.readFile(
      join(repo, ".github/workflows/ninja-renew.yml"),
      "utf8",
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  assert.match(text, /workflow_dispatch:/);
  assert.match(text, /schedule:/);
  assert.doesNotMatch(text, /pull_request(?:_target)?:|^\s+push:/m);
  assert.match(text, /contents: read/);
  assert.match(text, /cancel-in-progress: false/);
  assert.match(text, /timeout-minutes: (?:1[0-9]|20)/);
  assert.match(text, /github\.event\.repository\.default_branch/);
  const uses = [...text.matchAll(/uses:\s+(\S+)/g)].map((x) => x[1]);
  assert.ok(uses.length >= 2);
  assert.ok(
    uses.every((x) => /@[a-f0-9]{40}$/.test(x)),
    "Actions must use immutable commits",
  );
  assert.ok(
    text.indexOf("tests/release-ninja-renew.test.mjs") <
      text.indexOf("secrets.DAEDLO_UPDATE_SIGNING_KEY"),
    "Tests must precede signing secret scope",
  );
  const preSecretChecks = text
    .split("      - name:")
    .find((step) => step.includes("tests/release-ninja-renew.test.mjs"));
  assert.doesNotMatch(
    preSecretChecks,
    /website\/tests\/(?:install-template|alpha-content)\.test\.mjs|website\/tests\/\*/,
    "Pre-secret checks must not require ignored staged release files",
  );
  assert.match(text, /umask 077/);
  assert.match(text, /trap .*EXIT/);
  assert.match(text, /if: always\(\)/);
  assert.match(text, /wrangler@4\.147\.0/);
  assert.match(text, /versions upload/);
  assert.match(text, /versions deploy/);
  assert.doesNotMatch(text, /wrangler[^\n]*\sdeploy\s--config/);
  assert.match(text, /actions: read/);
  assert.match(text, /actions\/upload-artifact/);
  const uploadStep = text
    .split("      - name:")
    .find((step) => step.includes("uses: actions/upload-artifact"));
  const uploaded = uploadStep
    .match(/path:\s*\|\n((?: {12}.+\n)+)/)?.[1]
    .trim()
    .split("\n")
    .map((line) => line.trim());
  assert.deepEqual(uploaded, [
    "${{ runner.temp }}/daedlo-renewal/checkpoint/catalog.json",
    "${{ runner.temp }}/daedlo-renewal/checkpoint/receipt.json",
  ]);
  const activation = text
    .split("      - name:")
    .find((step) => step.includes("versions deploy"));
  assert.ok(
    activation.indexOf("ninja-renew.mjs verify") <
      activation.indexOf("versions deploy"),
    "Recheck current baseline immediately before activation",
  );
  assert.match(text, /persist-credentials: false/);
  assert.ok(
    text.indexOf("actions/upload-artifact") < text.indexOf("versions upload"),
    "Persist high-water checkpoint before provider mutation",
  );
  assert.doesNotMatch(
    text,
    /path:\s*(?:\$\{\{\s*runner.temp\s*\}\}\s*$|.*private|.*signing)/m,
  );
});
