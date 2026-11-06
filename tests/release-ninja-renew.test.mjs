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
function kit(version, change = () => {}, packagePrefix = "browser-driver") {
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

async function fixture(
  t,
  {
    alpha4 = false,
    promoted = alpha4,
    alpha5 = false,
    promoted5 = alpha5,
    alpha6 = false,
    promoted6 = alpha6,
    alpha7 = false,
    promoted7 = alpha7,
  } = {},
) {
  alpha6 ||= alpha7;
  alpha5 ||= alpha6;
  alpha4 ||= alpha5;
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
  const versions = [
    "0.1.2-rc.1",
    "0.1.4-alpha.2",
    "0.1.4-alpha.3",
    ...(alpha4 ? ["0.1.4-alpha.4"] : []),
    ...(alpha5 ? ["0.1.4-alpha.5"] : []),
    ...(alpha6 ? ["0.1.4-alpha.6"] : []),
    ...(alpha7 ? ["0.1.4-alpha.7"] : []),
  ];
  for (const version of versions) {
    const files = kit(
      version,
      () => {},
      [
        "0.1.4-alpha.4",
        "0.1.4-alpha.5",
        "0.1.4-alpha.6",
        "0.1.4-alpha.7",
      ].includes(version)
        ? "daedlo"
        : "browser-driver",
    );
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
    if (
      version === "0.1.2-rc.1" ||
      (version === "0.1.4-alpha.4" && !promoted) ||
      (version === "0.1.4-alpha.5" && !promoted5) ||
      (version === "0.1.4-alpha.6" && !promoted6) ||
      (version === "0.1.4-alpha.7" && !promoted7)
    )
      continue;
    const asset = (name) => ({
      url: `${origin}/downloads/${version}/${name}`,
      ...assets[version][name],
    });
    releases.push({
      version,
      channel: "preview",
      platforms: [{ os: "darwin", arch: "arm64" }],
      contracts: [
        "0.1.4-alpha.4",
        "0.1.4-alpha.5",
        "0.1.4-alpha.6",
        "0.1.4-alpha.7",
      ].includes(version)
        ? { ...contracts, manager: 2 }
        : contracts,
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
    releaseContracts: {
      ...(alpha4 ? { "0.1.4-alpha.4": { ...contracts, manager: 2 } } : {}),
      ...(alpha5 ? { "0.1.4-alpha.5": { ...contracts, manager: 2 } } : {}),
      ...(alpha6 ? { "0.1.4-alpha.6": { ...contracts, manager: 2 } } : {}),
      ...(alpha7 ? { "0.1.4-alpha.7": { ...contracts, manager: 2 } } : {}),
    },
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
test("network diagnostics identify the renewal stage and safe path without retry or raw transport details", async (t) => {
  const f = await fixture(t);
  const failures = [
    [
      new TypeError("private transport detail", {
        cause: { code: "ENOTFOUND", hostname: "private-host" },
      }),
      "dns",
    ],
    [
      new TypeError("private transport detail", {
        cause: { code: "ECONNRESET" },
      }),
      "connection",
    ],
    [
      new TypeError("private transport detail", {
        cause: { code: "CERT_HAS_EXPIRED" },
      }),
      "tls",
    ],
    [
      new TypeError("private transport detail", {
        cause: { code: "UND_ERR_CONNECT_TIMEOUT" },
      }),
      "timeout",
    ],
    [new DOMException("private transport detail", "TimeoutError"), "timeout"],
    [new DOMException("private transport detail", "AbortError"), "aborted"],
    [
      new Error("private transport detail", {
        cause: { code: "unrecognized-private-code" },
      }),
      "network",
    ],
  ];
  for (const [failure, category] of failures) {
    let requests = 0;
    f.dependencies.fetchImpl = async (url, options) => {
      requests++;
      assert.equal(url, feed);
      assert.equal(options.redirect, "error");
      assert.deepEqual(options.headers, { "Cache-Control": "no-cache" });
      assert.ok(options.signal instanceof AbortSignal);
      throw failure;
    };
    await assert.rejects(prep(f), (error) => {
      assert.equal(
        error.message,
        `Renewal network failure: stage=prepare path=/updates/preview.json phase=headers category=${category}`,
      );
      assert.equal(
        error.cause,
        undefined,
        "Raw causes must not escape in the error object",
      );
      return true;
    });
    assert.equal(requests, 1, "A failed request must not be retried");
    await assert.rejects(fs.lstat(f.options.output), { code: "ENOENT" });
  }
});
test("network diagnostics redact unreviewed paths and query values", async (t) => {
  const f = await fixture(t);
  const pin = f.policy.assets["0.1.2-rc.1"]["daedlo-0.1.2-rc.1.zip"];
  f.policy.assets["0.1.2-rc.1"] = {
    "unreviewed-secret.zip?token=private-query": pin,
  };
  const original = f.dependencies.fetchImpl;
  f.dependencies.fetchImpl = async (url, options) => {
    if (url === feed) return original(url, options);
    throw new Error(`private URL: ${url}`);
  };
  await assert.rejects(prep(f), {
    message:
      "Renewal network failure: stage=prepare path=[unreviewed-path] phase=headers category=network",
  });
});
test("network body failure cancels and releases the reader without exposing its error", async (t) => {
  const f = await fixture(t);
  const original = f.dependencies.fetchImpl;
  const calls = { request: 0, read: 0, cancel: 0, release: 0 };
  f.dependencies.fetchImpl = async (url, options) => {
    calls.request++;
    const response = await original(url, options);
    Object.defineProperty(response, "body", {
      value: {
        getReader: () => ({
          read: async () => {
            calls.read++;
            throw new TypeError("private response body", {
              cause: { code: "UND_ERR_BODY_TIMEOUT" },
            });
          },
          cancel: async () => {
            calls.cancel++;
          },
          releaseLock: () => {
            calls.release++;
          },
        }),
      },
    });
    return response;
  };
  await assert.rejects(prep(f), {
    message:
      "Renewal network failure: stage=prepare path=/updates/preview.json phase=body category=timeout",
  });
  assert.deepEqual(calls, { request: 1, read: 1, cancel: 1, release: 1 });
  await assert.rejects(fs.lstat(f.options.output), { code: "ENOENT" });
});
test("network predeploy failure preserves the prepared checkpoint and fails closed", async (t) => {
  const f = await fixture(t);
  await prep(f);
  const checkpoint = await fs.readFile(
    join(f.options.output, "checkpoint/catalog.json"),
  );
  let requests = 0;
  f.dependencies.fetchImpl = async () => {
    requests++;
    throw new DOMException("private abort reason", "AbortError");
  };
  await assert.rejects(
    verifyNinjaRenewal({ output: f.options.output }, f.dependencies),
    {
      message:
        "Renewal network failure: stage=verify path=/updates/preview.json phase=headers category=aborted",
    },
  );
  assert.equal(requests, 1);
  assert.deepEqual(
    await fs.readFile(join(f.options.output, "checkpoint/catalog.json")),
    checkpoint,
  );
});
test("network live verification identifies canonical assets and private boundary body failures", async (t) => {
  const f = await fixture(t, { alpha4: true, alpha5: true, alpha6: true });
  await prep(f);
  const receipt = JSON.parse(
    await fs.readFile(join(f.options.output, "renewal-receipt.json")),
  );
  const served = new Map();
  for (const file of receipt.manifest.files) {
    if (
      file.path.startsWith("public/") &&
      !["public/_headers", "public/.assetsignore"].includes(file.path)
    )
      served.set(
        origin + "/" + file.path.slice(7),
        await fs.readFile(join(f.options.output, "site", file.path)),
      );
  }
  for (const [target, phase] of [
    ["/", "headers"],
    ["/.env", "body"],
  ]) {
    let failures = 0;
    const fetchImpl = async (url, options) => {
      if (url === origin + "/index.html") {
        assert.equal(options.redirect, "manual");
        return new Response("", { status: 308, headers: { location: "/" } });
      }
      if (url === origin + target) {
        failures++;
        const failure = new TypeError("private socket and peer details", {
          cause: { code: "UND_ERR_SOCKET" },
        });
        if (phase === "headers") throw failure;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.error(failure);
            },
          }),
          { status: 404 },
        );
      }
      const bytes = served.get(
        url === origin + "/" ? origin + "/index.html" : url,
      );
      return new Response(bytes ?? "", {
        status: bytes ? 200 : 404,
        headers: {
          "x-content-type-options": "nosniff",
          "cache-control":
            url === feed
              ? "no-cache, must-revalidate"
              : "public, max-age=31536000, immutable",
        },
      });
    };
    await assert.rejects(
      verifyLiveNinjaRenewal(
        { output: f.options.output },
        { ...f.dependencies, fetchImpl },
      ),
      {
        message: `Renewal network failure: stage=live path=${target} phase=${phase} category=connection`,
      },
    );
    assert.equal(
      failures,
      1,
      "Live failures must not retry or yield a PASS receipt",
    );
  }
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
  assert.match(
    text,
    /promote_alpha4:\n\s+description:[^\n]+\n\s+type: boolean\n\s+default: false/,
  );
  assert.match(
    text,
    /NINJA_PROMOTE_ALPHA4:.*github.event_name == 'workflow_dispatch'.*inputs.promote_alpha4/,
  );
  assert.match(
    text,
    /if test "\$NINJA_PROMOTE_ALPHA4" = "true"; then\n\s+node scripts\/release\/ninja-promotion\.mjs/,
  );
  assert.match(
    text,
    /promote_alpha5:\n\s+description:[^\n]+\n\s+type: boolean\n\s+default: false/,
  );
  assert.match(
    text,
    /NINJA_PROMOTE_ALPHA5:.*github.event_name == 'workflow_dispatch'.*inputs.promote_alpha5/,
  );
  assert.match(
    text,
    /elif test "\$NINJA_PROMOTE_ALPHA5" = "true"; then\n\s+node scripts\/release\/ninja-promotion\.mjs --release 0\.1\.4-alpha\.5/,
  );
  assert.match(
    text,
    /case "\$PROMOTE_ALPHA4:\$PROMOTE_ALPHA5:\$PROMOTE_ALPHA6:\$PROMOTE_ALPHA7" in/,
  );
  assert.ok(
    text.indexOf("Validate one explicit promotion selection") <
      text.indexOf("secrets.DAEDLO_UPDATE_SIGNING_KEY"),
  );
  assert.match(text, /tests\/release-ninja-promotion\.test\.mjs/);
  assert.equal((text.match(/group: production-ninja-renew/g) ?? []).length, 1);

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
  assert.match(text, /wrangler@4\.158\.0/);
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

test("renewal retains pinned manager2 alpha4 alongside exact immutable legacy entries", async (t) => {
  const f = await fixture(t, { alpha4: true });
  const result = await prep(f);
  const envelope = JSON.parse(
    await fs.readFile(join(result.sitePath, "public/updates/preview.json")),
  );
  assert.deepEqual(envelope.signed.releases, f.signed.releases);
  assert.equal(envelope.signed.releases.at(-1).contracts.manager, 2);
  assert.equal(
    (await verifyNinjaRenewal({ output: f.options.output }, f.dependencies))
      .status,
    "PASS",
  );
});

test("only explicit alpha4 promotion extends the pinned legacy catalog and verification preserves each entry", async (t) => {
  const ordinary = await fixture(t, { alpha4: true, promoted: false });
  await assert.rejects(prep(ordinary), /inventory|promotion/i);
  const f = await fixture(t, { alpha4: true, promoted: false });
  const result = await prepareNinjaRenewal(
    { ...f.options, promoteAlpha4: true },
    f.dependencies,
  );
  const envelope = JSON.parse(
    await fs.readFile(join(result.sitePath, "public/updates/preview.json")),
  );
  assert.deepEqual(envelope.signed.releases.slice(0, 2), f.signed.releases);
  assert.equal(envelope.signed.releases.at(-1).version, "0.1.4-alpha.4");
  assert.equal(envelope.signed.releases.at(-1).contracts.manager, 2);
  const receiptPath = join(f.options.output, "renewal-receipt.json");
  const receipt = JSON.parse(await fs.readFile(receiptPath));
  assert.equal(receipt.promoteAlpha4, true);
  assert.equal(
    (await verifyNinjaRenewal({ output: f.options.output }, f.dependencies))
      .status,
    "PASS",
  );
  receipt.promoteAlpha4 = false;
  await fs.writeFile(receiptPath, JSON.stringify(receipt));
  await assert.rejects(
    verifyNinjaRenewal({ output: f.options.output }, f.dependencies),
    /inventory|promotion|immutable/i,
  );
});

test("final inventory renews from an authenticated legacy checkpoint without resetting high-water history", async (t) => {
  const f = await fixture(t, { alpha4: true });
  const finalReleases = f.signed.releases;
  f.signed.releases = finalReleases.slice(0, 2);
  const checkpointPath = join(f.root, "legacy-checkpoint.json");
  await fs.writeFile(checkpointPath, f.envelope());
  f.signed.releases = finalReleases;
  f.signed.generation = 2;
  f.bodies.set(feed, f.envelope());
  const result = await prepareNinjaRenewal(
    { ...f.options, checkpointPath },
    f.dependencies,
  );
  assert.equal(result.generation, 3);
  const envelope = JSON.parse(
    await fs.readFile(join(result.sitePath, "public/updates/preview.json")),
  );
  assert.deepEqual(envelope.signed.releases, finalReleases);
  assert.equal(
    (await verifyNinjaRenewal({ output: f.options.output }, f.dependencies))
      .status,
    "PASS",
  );
});

test("promotion refuses missing alpha4 pins and unsupported pinned manager contracts", async (t) => {
  const legacy = await fixture(t);
  await assert.rejects(
    prepareNinjaRenewal(
      { ...legacy.options, promoteAlpha4: true },
      legacy.dependencies,
    ),
    /explicitly pinned/,
  );
  const future = await fixture(t, { alpha4: true });
  future.policy.releaseContracts["0.1.4-alpha.4"].manager = 3;
  await assert.rejects(prep(future), /pinned release contracts/);
});

test("only explicit alpha5 promotion extends alpha4 and preserves every signed entry", async (t) => {
  const f = await fixture(t, { alpha4: true, alpha5: true, promoted5: false });
  await assert.rejects(prep(f), /inventory|promotion/i);
  await assert.rejects(
    prepareNinjaRenewal({ ...f.options, promoteAlpha4: true }, f.dependencies),
    /inventory|promotion/i,
  );
  const result = await prepareNinjaRenewal(
    { ...f.options, promoteAlpha5: true },
    f.dependencies,
  );
  const envelope = JSON.parse(
    await fs.readFile(join(result.sitePath, "public/updates/preview.json")),
  );
  assert.deepEqual(envelope.signed.releases.slice(0, 3), f.signed.releases);
  assert.equal(envelope.signed.releases.at(-1).version, "0.1.4-alpha.5");
  assert.equal(envelope.signed.releases.at(-1).contracts.manager, 2);
  assert.equal(
    (await verifyNinjaRenewal({ output: f.options.output }, f.dependencies))
      .status,
    "PASS",
  );
  const receiptPath = join(f.options.output, "renewal-receipt.json");
  const receipt = JSON.parse(await fs.readFile(receiptPath));
  assert.equal(receipt.promoteAlpha5, true);
  receipt.promoteAlpha5 = false;
  await fs.writeFile(receiptPath, JSON.stringify(receipt));
  await assert.rejects(
    verifyNinjaRenewal({ output: f.options.output }, f.dependencies),
    /inventory|promotion/i,
  );
});

test("alpha5 renewal preserves complete inventory and authenticates alpha4 checkpoint history", async (t) => {
  const f = await fixture(t, { alpha4: true, alpha5: true });
  const finalReleases = f.signed.releases;
  f.signed.releases = finalReleases.slice(0, 3);
  const checkpointPath = join(f.root, "alpha4-checkpoint.json");
  await fs.writeFile(checkpointPath, f.envelope());
  f.signed.releases = finalReleases;
  f.signed.generation = 2;
  f.bodies.set(feed, f.envelope());
  const result = await prepareNinjaRenewal(
    { ...f.options, checkpointPath },
    f.dependencies,
  );
  assert.equal(result.generation, 3);
  const envelope = JSON.parse(
    await fs.readFile(join(result.sitePath, "public/updates/preview.json")),
  );
  assert.deepEqual(envelope.signed.releases, finalReleases);
  assert.equal(
    (await verifyNinjaRenewal({ output: f.options.output }, f.dependencies))
      .status,
    "PASS",
  );
});

test("alpha5 promotion cannot skip alpha4, combine promotions or renew from an omitted release", async (t) => {
  const skipped = await fixture(t, {
    alpha4: true,
    alpha5: true,
    promoted: false,
    promoted5: false,
  });
  await assert.rejects(
    prepareNinjaRenewal(
      { ...skipped.options, promoteAlpha5: true },
      skipped.dependencies,
    ),
    /inventory|promotion/i,
  );
  const both = await fixture(t, {
    alpha4: true,
    alpha5: true,
    promoted5: false,
  });
  await assert.rejects(
    prepareNinjaRenewal(
      { ...both.options, promoteAlpha4: true, promoteAlpha5: true },
      both.dependencies,
    ),
    /promotion/i,
  );
  const missing = await fixture(t, { alpha4: true, alpha5: true });
  delete missing.policy.assets["0.1.4-alpha.4"];
  await assert.rejects(prep(missing), /inventory/i);
});

test("alpha5 promotion refuses a later live generation that dropped a retained release", async (t) => {
  const f = await fixture(t, { alpha4: true, alpha5: true });
  const checkpointPath = join(f.root, "alpha5-checkpoint.json");
  await fs.writeFile(checkpointPath, f.envelope());
  f.signed.releases.pop();
  f.signed.generation = 2;
  f.bodies.set(feed, f.envelope());
  await assert.rejects(
    prepareNinjaRenewal(
      { ...f.options, checkpointPath, promoteAlpha5: true },
      f.dependencies,
    ),
    /retained release/i,
  );
  await assert.rejects(fs.lstat(f.options.output), { code: "ENOENT" });
});

test("only explicit alpha6 promotion extends alpha5 and preserves every immutable entry", async (t) => {
  const f = await fixture(t, {
    alpha4: true,
    alpha5: true,
    alpha6: true,
    promoted6: false,
  });
  await assert.rejects(prep(f), /inventory|promotion/i);
  for (const selector of ["promoteAlpha4", "promoteAlpha5"])
    await assert.rejects(
      prepareNinjaRenewal({ ...f.options, [selector]: true }, f.dependencies),
      /inventory|promotion/i,
    );
  const result = await prepareNinjaRenewal(
    { ...f.options, promoteAlpha6: true },
    f.dependencies,
  );
  const envelope = JSON.parse(
    await fs.readFile(join(result.sitePath, "public/updates/preview.json")),
  );
  assert.deepEqual(envelope.signed.releases.slice(0, 4), f.signed.releases);
  assert.equal(envelope.signed.releases.at(-1).version, "0.1.4-alpha.6");
  assert.equal(envelope.signed.releases.at(-1).contracts.manager, 2);
  assert.equal(
    (await verifyNinjaRenewal({ output: f.options.output }, f.dependencies))
      .status,
    "PASS",
  );
  const receiptPath = join(f.options.output, "renewal-receipt.json");
  const receipt = JSON.parse(await fs.readFile(receiptPath));
  assert.equal(receipt.promoteAlpha6, true);
  receipt.promoteAlpha6 = false;
  await fs.writeFile(receiptPath, JSON.stringify(receipt));
  await assert.rejects(
    verifyNinjaRenewal({ output: f.options.output }, f.dependencies),
    /inventory|promotion/i,
  );
});

test("alpha6 ordinary renewal retains all releases and authenticates alpha5 high-water history", async (t) => {
  const f = await fixture(t, { alpha4: true, alpha5: true, alpha6: true });
  const finalReleases = f.signed.releases;
  f.signed.releases = finalReleases.slice(0, 4);
  const checkpointPath = join(f.root, "alpha5-checkpoint.json");
  await fs.writeFile(checkpointPath, f.envelope());
  f.signed.releases = finalReleases;
  f.signed.generation = 2;
  f.bodies.set(feed, f.envelope());
  const result = await prepareNinjaRenewal(
    { ...f.options, checkpointPath },
    f.dependencies,
  );
  assert.equal(result.generation, 3);
  const envelope = JSON.parse(
    await fs.readFile(join(result.sitePath, "public/updates/preview.json")),
  );
  assert.deepEqual(envelope.signed.releases, finalReleases);
  assert.equal(
    (await verifyNinjaRenewal({ output: f.options.output }, f.dependencies))
      .status,
    "PASS",
  );
});

test("alpha6 cannot skip alpha5, combine any selectors, or use absent historical pins", async (t) => {
  const skipped = await fixture(t, {
    alpha4: true,
    alpha5: true,
    alpha6: true,
    promoted5: false,
    promoted6: false,
  });
  await assert.rejects(
    prepareNinjaRenewal(
      { ...skipped.options, promoteAlpha6: true },
      skipped.dependencies,
    ),
    /inventory|promotion/i,
  );
  for (const selected of [
    { promoteAlpha4: true, promoteAlpha5: true },
    { promoteAlpha4: true, promoteAlpha6: true },
    { promoteAlpha5: true, promoteAlpha6: true },
    { promoteAlpha4: true, promoteAlpha5: true, promoteAlpha6: true },
  ]) {
    const f = await fixture(t, {
      alpha4: true,
      alpha5: true,
      alpha6: true,
      promoted6: false,
    });
    await assert.rejects(
      prepareNinjaRenewal({ ...f.options, ...selected }, f.dependencies),
      /Only one explicit release promotion/,
    );
    await assert.rejects(fs.lstat(f.options.output), { code: "ENOENT" });
  }
  for (const version of ["0.1.4-alpha.4", "0.1.4-alpha.5"]) {
    const f = await fixture(t, { alpha4: true, alpha5: true, alpha6: true });
    delete f.policy.assets[version];
    await assert.rejects(prep(f), /inventory/i);
  }
});

test("alpha6 refuses a later generation that omits or changes authenticated retained entries", async (t) => {
  for (const change of [
    (f) => f.signed.releases.pop(),
    (f) => {
      f.signed.releases[0].kit.sha256 = "f".repeat(64);
    },
  ]) {
    const f = await fixture(t, { alpha4: true, alpha5: true, alpha6: true });
    const checkpointPath = join(f.root, "alpha6-checkpoint.json");
    await fs.writeFile(checkpointPath, f.envelope());
    change(f);
    f.signed.generation = 2;
    f.bodies.set(feed, f.envelope());
    await assert.rejects(
      prepareNinjaRenewal(
        { ...f.options, checkpointPath, promoteAlpha6: true },
        f.dependencies,
      ),
      /retained release|immutable asset/i,
    );
    await assert.rejects(fs.lstat(f.options.output), { code: "ENOENT" });
  }
});

test("alpha6 workflow selection refuses every combined promotion before credential scope", async () => {
  const text = await fs.readFile(
    join(repo, ".github/workflows/ninja-renew.yml"),
    "utf8",
  );
  assert.match(
    text,
    /promote_alpha6:\n\s+description:[^\n]+\n\s+type: boolean\n\s+default: false/,
  );
  assert.match(
    text,
    /NINJA_PROMOTE_ALPHA6:.*github.event_name == 'workflow_dispatch'.*inputs.promote_alpha6/,
  );
  assert.match(
    text,
    /elif test "\$NINJA_PROMOTE_ALPHA6" = "true"; then\n\s+node scripts\/release\/ninja-promotion\.mjs --release 0\.1\.4-alpha\.6/,
  );
  const section = text
    .split("- name: Validate one explicit promotion selection")[1]
    .split("- name: Set up Node")[0];
  const body = section.split("run: |\n")[1];
  assert.ok(
    body,
    "Promotion guard must be inspectable before secrets are in scope",
  );
  const script = body
    .split("\n")
    .map((line) => line.replace(/^          /, ""))
    .join("\n");
  for (const a of ["false", "true"])
    for (const b of ["false", "true"])
      for (const c of ["false", "true"]) {
        const env = {
          ...process.env,
          PROMOTE_ALPHA4: a,
          PROMOTE_ALPHA5: b,
          PROMOTE_ALPHA6: c,
          PROMOTE_ALPHA7: "false",
        };
        const run = () =>
          execFileSync("bash", ["-c", script], { env, stdio: "pipe" });
        if ([a, b, c].filter((v) => v === "true").length > 1)
          assert.throws(run);
        else assert.doesNotThrow(run);
      }
});

test("only explicit alpha7 promotion extends complete alpha6 history and verification retains every asset", async (t) => {
  const f = await fixture(t, {
    alpha4: true,
    alpha5: true,
    alpha6: true,
    alpha7: true,
    promoted7: false,
  });
  await assert.rejects(prep(f), /inventory|promotion/i);
  const result = await prepareNinjaRenewal(
    { ...f.options, promoteAlpha7: true },
    f.dependencies,
  );
  const envelope = JSON.parse(
    await fs.readFile(join(result.sitePath, "public/updates/preview.json")),
  );
  assert.deepEqual(envelope.signed.releases.slice(0, -1), f.signed.releases);
  assert.equal(envelope.signed.releases.at(-1).version, "0.1.4-alpha.7");
  assert.equal(envelope.signed.releases.at(-1).contracts.manager, 2);
  assert.equal(
    (await verifyNinjaRenewal({ output: f.options.output }, f.dependencies))
      .status,
    "PASS",
  );
  const receiptPath = join(f.options.output, "renewal-receipt.json");
  const receipt = JSON.parse(await fs.readFile(receiptPath));
  assert.equal(receipt.promoteAlpha7, true);
  receipt.promoteAlpha7 = false;
  await fs.writeFile(receiptPath, JSON.stringify(receipt));
  await assert.rejects(
    verifyNinjaRenewal({ output: f.options.output }, f.dependencies),
    /inventory|promotion/i,
  );
});

test("alpha7 ordinary renewal authenticates alpha6 checkpoint history and cannot drop retained releases", async (t) => {
  const f = await fixture(t, {
    alpha4: true,
    alpha5: true,
    alpha6: true,
    alpha7: true,
  });
  const releases = f.signed.releases;
  f.signed.releases = releases.slice(0, -1);
  const checkpointPath = join(f.root, "alpha6-checkpoint.json");
  await fs.writeFile(checkpointPath, f.envelope());
  f.signed.releases = releases;
  f.signed.generation = 2;
  f.bodies.set(feed, f.envelope());
  const result = await prepareNinjaRenewal(
    { ...f.options, checkpointPath },
    f.dependencies,
  );
  assert.equal(result.generation, 3);
  const envelope = JSON.parse(
    await fs.readFile(join(result.sitePath, "public/updates/preview.json")),
  );
  assert.deepEqual(envelope.signed.releases, releases);
  assert.equal(
    (await verifyNinjaRenewal({ output: f.options.output }, f.dependencies))
      .status,
    "PASS",
  );
});

test("alpha7 cannot skip alpha6, combine promotions, or omit historical pins", async (t) => {
  const f = await fixture(t, {
    alpha4: true,
    alpha5: true,
    alpha6: true,
    alpha7: true,
    promoted6: false,
    promoted7: false,
  });
  await assert.rejects(
    prepareNinjaRenewal({ ...f.options, promoteAlpha7: true }, f.dependencies),
    /inventory|promotion/i,
  );
  const complete = await fixture(t, {
    alpha4: true,
    alpha5: true,
    alpha6: true,
    alpha7: true,
    promoted7: false,
  });
  const selectors = [
    "promoteAlpha4",
    "promoteAlpha5",
    "promoteAlpha6",
    "promoteAlpha7",
  ];
  for (let mask = 1; mask < 16; mask++) {
    const selected = Object.fromEntries(
      selectors.filter((_, i) => mask & (1 << i)).map((name) => [name, true]),
    );
    if (Object.keys(selected).length < 2) continue;
    await assert.rejects(
      prepareNinjaRenewal(
        { ...complete.options, ...selected },
        complete.dependencies,
      ),
      /Only one explicit release promotion/,
    );
    await assert.rejects(fs.lstat(complete.options.output), { code: "ENOENT" });
  }
  for (const version of ["0.1.4-alpha.4", "0.1.4-alpha.5", "0.1.4-alpha.6"]) {
    const pins = complete.policy.assets[version];
    delete complete.policy.assets[version];
    await assert.rejects(prep(complete), /inventory/i);
    complete.policy.assets[version] = pins;
  }
});

test("alpha7 asset network diagnostics use only its reviewed public path and static failure category", async (t) => {
  const f = await fixture(t, {
    alpha4: true,
    alpha5: true,
    alpha6: true,
    alpha7: true,
  });
  const transport = f.dependencies.fetchImpl;
  f.dependencies.fetchImpl = async (url, options) => {
    if (url === origin + "/downloads/0.1.4-alpha.7/daedlo-0.1.4-alpha.7.zip")
      throw Object.assign(Error("private peer and response details"), {
        code: "ECONNRESET",
      });
    return transport(url, options);
  };
  await assert.rejects(prep(f), {
    message:
      "Renewal network failure: stage=prepare path=/downloads/0.1.4-alpha.7/daedlo-0.1.4-alpha.7.zip phase=headers category=connection",
  });
});

test("alpha7 workflow selection rejects every combined promotion before credentials", async () => {
  const text = await fs.readFile(
    join(repo, ".github/workflows/ninja-renew.yml"),
    "utf8",
  );
  const section = text
    .split("- name: Validate one explicit promotion selection")[1]
    .split("- name: Set up Node")[0];
  const script = section
    .split("run: |\n")[1]
    .split("\n")
    .map((line) => line.replace(/^          /, ""))
    .join("\n");
  for (let mask = 0; mask < 16; mask++) {
    const env = {
      ...process.env,
      ...Object.fromEntries(
        [4, 5, 6, 7].map((number, index) => [
          "PROMOTE_ALPHA" + number,
          mask & (1 << index) ? "true" : "false",
        ]),
      ),
    };
    const run = () =>
      execFileSync("bash", ["-c", script], { env, stdio: "pipe" });
    if (
      [4, 5, 6, 7].filter((number) => env["PROMOTE_ALPHA" + number] === "true")
        .length > 1
    )
      assert.throws(run);
    else assert.doesNotThrow(run);
  }
  assert.match(
    text,
    /promote_alpha7:\n\s+description:[^\n]+\n\s+type: boolean\n\s+default: false/,
  );
  assert.match(
    text,
    /NINJA_PROMOTE_ALPHA7:.*github.event_name == 'workflow_dispatch'.*inputs.promote_alpha7/,
  );
  assert.match(
    text,
    /elif test "\$NINJA_PROMOTE_ALPHA7" = "true"; then\n\s+node scripts\/release\/ninja-promotion\.mjs --release 0\.1\.4-alpha\.7/,
  );
});
