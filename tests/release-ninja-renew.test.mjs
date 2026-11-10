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
  runNinjaRenewCli,
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
    alpha9 = false,
    promoted9 = alpha9,
    alpha10 = false,
    promoted10 = alpha10,
  } = {},
) {
  alpha9 ||= alpha10;
  alpha7 ||= alpha9;
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
    ...(alpha9 ? ["0.1.4-alpha.9"] : []),
    ...(alpha10 ? ["0.1.4-alpha.10"] : []),
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
        "0.1.4-alpha.9",
        "0.1.4-alpha.10",
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
      (version === "0.1.4-alpha.7" && !promoted7) ||
      (version === "0.1.4-alpha.9" && !promoted9) ||
      (version === "0.1.4-alpha.10" && !promoted10)
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
        "0.1.4-alpha.9",
        "0.1.4-alpha.10",
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
      ...(alpha9 ? { "0.1.4-alpha.9": { ...contracts, manager: 2 } } : {}),
      ...(alpha10 ? { "0.1.4-alpha.10": { ...contracts, manager: 2 } } : {}),
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
async function captureRenewalCli(args, dependencies) {
  const output = [];
  await runNinjaRenewCli(args, {
    ...dependencies,
    writeOutput: (text) => output.push(text),
  });
  assert.equal(output.length, 1);
  assert.ok(output[0].endsWith("\n"));
  return JSON.parse(output[0]);
}

test("renewal CLI prepare routes only preparation options and writes the prepared result", async (t) => {
  const f = await fixture(t);
  const output = [];
  await runNinjaRenewCli(
    [
      "prepare",
      "--private-key",
      f.privateKeyPath,
      "--output",
      f.options.output,
    ],
    { ...f.dependencies, writeOutput: (text) => output.push(text) },
  );
  assert.equal(output.length, 1);
  const result = JSON.parse(output[0]);
  assert.equal(result.status, "PREPARED");
  assert.equal(result.generation, 2);
  const checkpoint = await fs.readFile(
    join(f.options.output, "checkpoint/catalog.json"),
  );
  const verified = verifyNinjaCatalog({
    bytes: checkpoint,
    publisher: "daedlo",
    trustedKeys: [{ id: keyId, publicKey: f.keys.publicKey }],
    now,
  });
  assert.equal(verified.catalog.generation, result.generation);
  assert.ok(f.requests.length > 0);
});

test("renewal CLI prepare forwards the durable signed checkpoint", async (t) => {
  const f = await fixture(t);
  f.signed.generation = 2;
  const retained = f.envelope();
  f.bodies.set(feed, retained);
  const checkpointPath = join(f.root, "retained-catalog.json");
  await fs.writeFile(checkpointPath, retained);
  const args = [
    "prepare",
    "--private-key",
    f.privateKeyPath,
    "--output",
    f.options.output,
  ];
  const rejectedOutput = [];
  await assert.rejects(
    runNinjaRenewCli([...args], {
      ...f.dependencies,
      writeOutput: (text) => rejectedOutput.push(text),
    }),
    /Durable signed checkpoint required/,
  );
  assert.deepEqual(rejectedOutput, []);
  const result = await captureRenewalCli(
    [...args, "--checkpoint", checkpointPath],
    f.dependencies,
  );
  assert.equal(result.status, "PREPARED");
  assert.equal(result.generation, 3);
  assert.equal(result.baselineSha256, sha256(retained));
  const receipt = JSON.parse(
    await fs.readFile(join(f.options.output, "checkpoint/receipt.json")),
  );
  assert.equal(receipt.generation, 3);
  assert.equal(
    receipt.catalogSha256,
    sha256(
      await fs.readFile(join(f.options.output, "checkpoint/catalog.json")),
    ),
  );
  assert.deepEqual(await fs.readFile(checkpointPath), retained);
});

test("renewal CLI verify checks the prepared tree and unchanged live baseline", async (t) => {
  const f = await fixture(t);
  await prep(f);
  const result = await captureRenewalCli(
    ["verify", "--output", f.options.output],
    f.dependencies,
  );
  const receipt = JSON.parse(
    await fs.readFile(join(f.options.output, "renewal-receipt.json")),
  );
  assert.equal(result.status, "PASS");
  assert.equal(result.generation, receipt.generation);
  assert.equal(result.catalogSha256, receipt.catalogSha256);
  assert.equal(result.manifestFiles, receipt.manifest.files.length);
  f.signed.generation = 2;
  f.bodies.set(feed, f.envelope());
  const rejectedOutput = [];
  await assert.rejects(
    runNinjaRenewCli(["verify", "--output", f.options.output], {
      ...f.dependencies,
      writeOutput: (text) => rejectedOutput.push(text),
    }),
    /changed|drift|baseline/i,
  );
  assert.deepEqual(rejectedOutput, []);
});

test("renewal CLI live remains strict unless availability waiting is selected", async (t) => {
  const f = await liveAvailabilityFixture(t);
  const result = await captureRenewalCli(
    ["live", "--output", f.options.output],
    f.live.dependencies,
  );
  assert.equal(result.status, "PASS");
  assert.equal(result.servedAssets, 34);
  assert.equal(result.privateBoundaries, 9);
  assert.equal(Object.hasOwn(result, "availability"), false);
  let misses = 0;
  f.live.intercept = (url) => {
    if (url === origin + "/compose.html") {
      misses++;
      return new Response("", { status: 404 });
    }
  };
  const rejectedOutput = [];
  await assert.rejects(
    runNinjaRenewCli(["live", "--output", f.options.output], {
      ...f.live.dependencies,
      writeOutput: (text) => rejectedOutput.push(text),
    }),
    /status=404 expected=200/,
  );
  assert.equal(misses, 1);
  assert.deepEqual(rejectedOutput, []);
  assert.deepEqual(f.live.sleeps, []);
  assert.deepEqual(await liveAvailabilityEvents(f), []);
});

test("renewal CLI live forwards availability waiting and retains the failed observation", async (t) => {
  const f = await liveAvailabilityFixture(t);
  let reads = 0;
  f.live.intercept = (url) => {
    if (url === origin + "/compose.html" && reads++ === 0)
      return new Response("", { status: 404 });
  };
  const result = await captureRenewalCli(
    ["live", "--output", f.options.output, "--wait-for-assets"],
    f.live.dependencies,
  );
  assert.equal(result.status, "PASS");
  assert.equal(result.servedAssets, 34);
  assert.deepEqual(result.availability, {
    attempts: 2,
    elapsedMs: 5000,
    notFound: [
      { attempt: 1, path: "/compose.html", status: 404, elapsedMs: 0 },
    ],
  });
  assert.deepEqual(f.live.sleeps, [5000]);
  const [receipt] = await liveAvailabilityEvents(f);
  assert.deepEqual(
    receipt.events.map((event) => event.event),
    ["started", "not_ready", "pass"],
  );
});

test("renewal CLI rejects misplaced or duplicated availability flags before resources", async (t) => {
  for (const [label, command, flags] of [
    ["prepare availability flag", "prepare", ["--wait-for-assets"]],
    ["verify availability flag", "verify", ["--wait-for-assets"]],
    [
      "duplicate live availability flag",
      "live",
      ["--wait-for-assets", "--wait-for-assets"],
    ],
  ]) {
    await t.test(label, async (t) => {
      const f = await fixture(t);
      const output = [];
      await assert.rejects(
        runNinjaRenewCli(
          [
            command,
            "--output",
            f.options.output,
            ...(command === "prepare"
              ? ["--private-key", f.privateKeyPath]
              : []),
            ...flags,
          ],
          { ...f.dependencies, writeOutput: (text) => output.push(text) },
        ),
        /Invalid renewal CLI arguments/,
      );
      assert.equal(f.requests.length, 0);
      assert.deepEqual(output, []);
      await assert.rejects(fs.lstat(f.options.output), { code: "ENOENT" });
    });
  }
});

test("renewal refuses an unknown held alpha8 promotion selector before resources", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    prepareNinjaRenewal({ ...f.options, promoteAlpha8: true }, f.dependencies),
    /Unsupported renewal option/,
  );
  assert.equal(f.requests.length, 0);
  await assert.rejects(fs.lstat(f.options.output), { code: "ENOENT" });
});
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
  let discarded = 0;
  f.dependencies.fetchImpl = async (url, options) => {
    requested++;
    assert.equal(url, feed);
    assert.equal(options.redirect, "error");
    assert.deepEqual(options.headers, { "Cache-Control": "no-cache" });
    return new Response(
      new ReadableStream(
        {
          pull() {
            assert.fail("status failure must not consume the response body");
          },
          cancel() {
            discarded++;
          },
        },
        { highWaterMark: 0 },
      ),
      {
        status: 403,
        statusText: "private status text",
        headers: {
          "cf-mitigated": "challenge",
          "set-cookie": "private-cookie=value",
          "x-private": "private-header-value",
        },
      },
    );
  };
  await assert.rejects(prep(f), {
    message:
      "Unexpected renewal HTTP status: /updates/preview.json status=403 expected=200 cf-mitigated=challenge",
  });
  assert.equal(requested, 1);
  assert.equal(discarded, 1);
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
  const curatedAssets = [
    "compose.html",
    "teaching.html",
    "teaching.css",
    "demo-2026-10-11.html",
    "demo-roots-evidence.json",
    "demo-roots-save.png",
  ];
  const curatedIdentities = [];
  for (const name of curatedAssets) {
    const source = await fs.readFile(join(repo, "website/public", name));
    assert.deepEqual(
      served.get(origin + "/" + name),
      source,
      `${name} must be staged as exact public source bytes`,
    );
    curatedIdentities.push({
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
    { status: "PASS", generation: 2, servedAssets: 34, privateBoundaries: 9 },
  );
  assert.deepEqual(
    curatedAssets.map((name) =>
      live.assets.find((asset) => asset.path === name),
    ),
    curatedIdentities,
    "Live verification must report each curated asset's exact source identity",
  );
  for (const name of curatedAssets) {
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
async function liveAvailabilityFixture(t) {
  const f = await fixture(t);
  await prep(f);
  const receipt = JSON.parse(
    await fs.readFile(join(f.options.output, "renewal-receipt.json")),
  );
  const served = new Map();
  for (const file of receipt.manifest.files) {
    if (
      file.path.startsWith("public/") &&
      !["public/_headers", "public/.assetsignore"].includes(file.path)
    ) {
      served.set(
        origin + "/" + file.path.slice(7),
        await fs.readFile(join(f.options.output, "site", file.path)),
      );
    }
  }
  const live = {
    elapsed: 0,
    requests: [],
    sleeps: [],
    served,
    intercept: null,
  };
  live.exact = (url) => {
    const bytes = served.get(
      url === origin + "/" ? origin + "/index.html" : url,
    );
    return new Response(bytes ?? "", {
      status: bytes ? 200 : 404,
      headers: {
        "content-length": String(bytes?.length ?? 0),
        "x-content-type-options": "nosniff",
        "cache-control":
          url === feed
            ? "no-cache, must-revalidate"
            : /\/(downloads|updates\/keys)\//.test(url)
              ? "public, max-age=31536000, immutable"
              : "no-cache",
      },
    });
  };
  live.dependencies = {
    ...f.dependencies,
    monotonicNow: () => live.elapsed,
    sleep: async (milliseconds) => {
      live.sleeps.push(milliseconds);
      live.elapsed += milliseconds;
    },
    fetchImpl: async (url, options) => {
      live.requests.push({ url, options });
      const response = await live.intercept?.(url, options);
      return response ?? live.exact(url);
    },
  };
  return { ...f, live };
}

async function liveAvailabilityEvents(f) {
  const names = (await fs.readdir(f.options.output))
    .filter((name) => name.startsWith("live-verification-"))
    .sort();
  return Promise.all(
    names.map(async (name) => {
      const path = join(f.options.output, name, "events.jsonl");
      const text = await fs.readFile(path, "utf8");
      return {
        path,
        text,
        events: text
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line)),
      };
    }),
  );
}

const verifyAvailable = (f, dependencies = {}) =>
  verifyLiveNinjaRenewal(
    { output: f.options.output, waitForAssets: true },
    { ...f.live.dependencies, ...dependencies },
  );

test("post-activation availability waits for an expected public 404 then verifies exact assets", async (t) => {
  const f = await liveAvailabilityFixture(t);
  let misses = 0;
  let discardedBodies = 0;
  f.live.intercept = (url) => {
    if (url === origin + "/compose.html" && misses++ === 0) {
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(Buffer.from("private untrusted response body"));
          },
          cancel() {
            discardedBodies++;
          },
        }),
        { status: 404, statusText: "private provider detail" },
      );
    }
  };
  const result = await verifyAvailable(f);
  assert.equal(result.status, "PASS");
  assert.equal(result.servedAssets, 34);
  assert.deepEqual(result.availability, {
    attempts: 2,
    elapsedMs: 5000,
    notFound: [
      { attempt: 1, path: "/compose.html", status: 404, elapsedMs: 0 },
    ],
  });
  assert.deepEqual(f.live.sleeps, [5000]);
  assert.equal(
    discardedBodies,
    1,
    "Discarded 404 bodies must release their resources",
  );
  const [receipt] = await liveAvailabilityEvents(f);
  assert.deepEqual(
    receipt.events.map((event) => event.event),
    ["started", "not_ready", "pass"],
  );
  assert.doesNotMatch(receipt.text, /private untrusted|private provider/);
  assert.ok(!receipt.text.includes(f.root));
});

test("post-activation availability retries approved canonical HTML 404s", async (t) => {
  const f = await liveAvailabilityFixture(t);
  let canonicalReads = 0;
  f.live.intercept = (url) => {
    if (url === origin + "/compose.html") {
      return new Response("", {
        status: 307,
        headers: { location: "/compose" },
      });
    }
    if (url === origin + "/compose") {
      if (canonicalReads++ === 0) return new Response("", { status: 404 });
      return f.live.exact(origin + "/compose.html");
    }
  };
  const result = await verifyAvailable(f);
  assert.equal(result.status, "PASS");
  assert.equal(canonicalReads, 2);
  assert.deepEqual(result.availability.notFound, [
    { attempt: 1, path: "/compose", status: 404, elapsedMs: 0 },
  ]);
});

test("post-activation availability has one bounded window across different missing assets", async (t) => {
  const f = await liveAvailabilityFixture(t);
  let misses = 0;
  f.live.intercept = (url) => {
    if (
      (url === origin + "/compose.html" && f.live.elapsed < 110000) ||
      (url === origin + "/guide.html" && f.live.elapsed >= 110000)
    ) {
      misses++;
      return new Response("still missing", { status: 404 });
    }
  };
  await assert.rejects(
    verifyAvailable(f),
    /deadline|budget|window|timed out|timeout|exhaust/i,
  );
  assert.ok(misses > 1 && misses <= 25);
  assert.ok(
    f.live.elapsed <= 120000,
    "A second missing asset cannot reset the deadline",
  );
  assert.ok(
    f.live.sleeps.every(
      (milliseconds) => milliseconds > 0 && milliseconds <= 5000,
    ),
  );
  const [receipt] = await liveAvailabilityEvents(f);
  assert.equal(receipt.events.at(-1).event, "fail");
  assert.equal(
    receipt.events.filter((event) => event.event === "not_ready").length,
    misses,
  );
  assert.ok(!receipt.events.some((event) => event.event === "pass"));
});

test("post-activation availability has an independent attempt cap", async (t) => {
  const f = await liveAvailabilityFixture(t);
  let misses = 0;
  f.live.intercept = (url) => {
    if (url === origin + "/compose.html") {
      misses++;
      return new Response("", { status: 404 });
    }
  };
  await assert.rejects(
    verifyAvailable(f, {
      sleep: async (milliseconds) => f.live.sleeps.push(milliseconds),
    }),
    /attempt_limit_exceeded/,
  );
  assert.equal(misses, 25);
  assert.equal(f.live.sleeps.length, 24);
  const [receipt] = await liveAvailabilityEvents(f);
  assert.equal(receipt.events.at(-1).failure.code, "attempt_limit_exceeded");
  assert.equal(
    receipt.events.filter((event) => event.event === "not_ready").length,
    25,
  );
});

test("post-activation availability refuses a pass completing after its deadline", async (t) => {
  const f = await liveAvailabilityFixture(t);
  f.live.intercept = (url) => {
    if (url === origin + "/package.json") f.live.elapsed = 120001;
  };
  await assert.rejects(
    verifyAvailable(f),
    /deadline|budget|window|timed out|timeout|exhaust/i,
  );
  assert.deepEqual(f.live.sleeps, []);
  const [receipt] = await liveAvailabilityEvents(f);
  assert.equal(receipt.events.at(-1).event, "fail");
  assert.equal(receipt.events.at(-1).failure.code, "deadline_exceeded");
});

test("post-activation availability rechecks earlier assets rather than combining partial passes", async (t) => {
  const f = await liveAvailabilityFixture(t);
  let missing = true;
  f.live.intercept = (url) => {
    if (url === origin + "/compose.html" && missing) {
      missing = false;
      const earlier = Buffer.from(f.live.served.get(origin + "/404.html"));
      earlier[0] ^= 1;
      f.live.served.set(origin + "/404.html", earlier);
      return new Response("", { status: 404 });
    }
  };
  await assert.rejects(verifyAvailable(f), /differs from prepared manifest/);
  assert.deepEqual(f.live.sleeps, [5000]);
  assert.equal(
    f.live.requests.filter(({ url }) => url === origin + "/404.html").length,
    2,
  );
  const [receipt] = await liveAvailabilityEvents(f);
  assert.deepEqual(
    receipt.events.map((event) => event.event),
    ["started", "not_ready", "fail"],
  );
});

test("post-activation availability refreshes signature expiry after waiting", async (t) => {
  const f = await liveAvailabilityFixture(t);
  const catalog = JSON.parse(f.live.served.get(feed));
  let misses = 0;
  f.live.intercept = (url) => {
    if (url === origin + "/compose.html" && misses++ === 0)
      return new Response("", { status: 404 });
  };
  await assert.rejects(
    verifyAvailable(f, { now: Date.parse(catalog.signed.expiresAt) - 1000 }),
    /expired/i,
  );
  assert.deepEqual(f.live.sleeps, [5000]);
  const [receipt] = await liveAvailabilityEvents(f);
  assert.equal(receipt.events.at(-1).event, "fail");
});

test("post-activation availability rechecks signature expiry at the end of a complete pass", async (t) => {
  const f = await liveAvailabilityFixture(t);
  const catalog = JSON.parse(f.live.served.get(feed));
  f.live.intercept = (url) => {
    if (url === origin + "/package.json") f.live.elapsed = 1001;
  };
  await assert.rejects(
    verifyAvailable(f, { now: Date.parse(catalog.signed.expiresAt) - 1000 }),
    /expired/i,
  );
  assert.deepEqual(f.live.sleeps, []);
  const [receipt] = await liveAvailabilityEvents(f);
  assert.equal(receipt.events.at(-1).event, "fail");
  assert.equal(receipt.events.at(-1).attempts, 1);
});

test("post-activation availability never retries transport, integrity or security failures", async (t) => {
  for (const mode of [
    "status",
    "challenge",
    "network",
    "hash",
    "nosniff",
    "cache",
    "private",
    "redirect",
    "size",
  ]) {
    await t.test(mode, async (t) => {
      const f = await liveAvailabilityFixture(t);
      let failures = 0;
      const target =
        mode === "cache"
          ? feed
          : mode === "private"
            ? origin + "/.env"
            : origin + "/compose.html";
      f.live.intercept = (url) => {
        if (url !== target) return;
        failures++;
        if (mode === "status")
          return new Response("private-token", { status: 503 });
        if (mode === "challenge")
          return new Response("private-token", {
            status: 404,
            headers: { "cf-mitigated": "challenge" },
          });
        if (mode === "network")
          throw new TypeError("private-token", {
            cause: { code: "ENOTFOUND", hostname: "private-host" },
          });
        if (mode === "private")
          return new Response("private-token", { status: 200 });
        if (mode === "redirect")
          return new Response("", {
            status: 307,
            headers: {
              location: "https://private-host/path?secret=private-token",
            },
          });
        const response = f.live.exact(url);
        if (mode === "hash") {
          const altered = Buffer.from(f.live.served.get(url));
          altered[0] ^= 1;
          return new Response(altered, {
            status: 200,
            headers: response.headers,
          });
        }
        if (mode === "nosniff")
          response.headers.delete("x-content-type-options");
        if (mode === "cache")
          response.headers.set("cache-control", "public, max-age=3600");
        if (mode === "size")
          response.headers.set("content-length", "999999999");
        return response;
      };
      await assert.rejects(verifyAvailable(f));
      assert.equal(failures, 1);
      assert.deepEqual(f.live.sleeps, []);
      const [receipt] = await liveAvailabilityEvents(f);
      assert.deepEqual(
        receipt.events.map((event) => event.event),
        ["started", "fail"],
      );
      assert.doesNotMatch(
        receipt.text,
        /private-token|private-host|TypeError|cause/,
      );
      assert.ok(!receipt.text.includes(f.root));
    });
  }
});

test("post-activation availability bounds in-flight headers and body reads by remaining time", async (t) => {
  for (const phase of ["headers", "body"]) {
    await t.test(phase, async (t) => {
      const f = await liveAvailabilityFixture(t);
      let interrupted = false;
      let guard;
      f.live.intercept = async (url, options) => {
        if (url === origin + "/404.html") f.live.elapsed = 119995;
        if (url !== origin + "/compose.html") return;
        const failure = new Promise((_, reject) => {
          guard = setTimeout(
            () => reject(new Error("test watchdog: request was not bounded")),
            500,
          );
          options.signal.addEventListener(
            "abort",
            () => {
              interrupted = true;
              reject(options.signal.reason);
            },
            { once: true },
          );
        });
        if (phase === "headers") return failure;
        return new Response(
          new ReadableStream({
            start(controller) {
              failure.catch((error) => controller.error(error));
            },
          }),
          { status: 200, headers: f.live.exact(url).headers },
        );
      };
      try {
        await assert.rejects(verifyAvailable(f));
      } finally {
        clearTimeout(guard);
      }
      assert.equal(
        interrupted,
        true,
        "The remaining five milliseconds must bound the in-flight request",
      );
      assert.deepEqual(f.live.sleeps, []);
    });
  }
});

test("post-activation availability retains separate invocation receipts without overwriting failures", async (t) => {
  const f = await liveAvailabilityFixture(t);
  f.live.intercept = (url) => {
    if (url === origin + "/compose.html")
      return new Response("", { status: 503 });
  };
  await assert.rejects(verifyAvailable(f));
  const [first] = await liveAvailabilityEvents(f);
  f.live.intercept = null;
  const result = await verifyAvailable(f);
  assert.deepEqual(result.availability, {
    attempts: 1,
    elapsedMs: 0,
    notFound: [],
  });
  const receipts = await liveAvailabilityEvents(f);
  assert.equal(receipts.length, 2);
  assert.equal(await fs.readFile(first.path, "utf8"), first.text);
  assert.ok(receipts.some(({ events }) => events.at(-1).event === "pass"));
  assert.ok(receipts.some(({ events }) => events.at(-1).event === "fail"));
});

test("ordinary live verification keeps strict one-pass missing-asset behavior", async (t) => {
  const f = await liveAvailabilityFixture(t);
  let misses = 0;
  f.live.intercept = (url) => {
    if (url === origin + "/compose.html") {
      misses++;
      return new Response("", { status: 404 });
    }
  };
  await assert.rejects(
    verifyLiveNinjaRenewal({ output: f.options.output }, f.live.dependencies),
    /status=404 expected=200/,
  );
  assert.equal(misses, 1);
  assert.deepEqual(f.live.sleeps, []);
  assert.deepEqual(await liveAvailabilityEvents(f), []);
});

test("post-activation availability rejects a changed prepared signature before any live request", async (t) => {
  const f = await liveAvailabilityFixture(t);
  const path = join(f.options.output, "site/public/updates/preview.json");
  const envelope = JSON.parse(await fs.readFile(path, "utf8"));
  const signature = Buffer.from(envelope.signature.value, "base64");
  signature[0] ^= 1;
  envelope.signature.value = signature.toString("base64");
  await fs.writeFile(path, JSON.stringify(envelope) + "\n");
  await assert.rejects(verifyAvailable(f), /signature/i);
  assert.equal(f.live.requests.length, 0);
  assert.deepEqual(f.live.sleeps, []);
  const [receipt] = await liveAvailabilityEvents(f);
  assert.deepEqual(
    receipt.events.map((event) => event.event),
    ["started", "fail"],
  );
  assert.equal(receipt.events.at(-1).failure.code, "verification_failed");
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
    /case "\$PROMOTE_ALPHA4:\$PROMOTE_ALPHA5:\$PROMOTE_ALPHA6:\$PROMOTE_ALPHA7:\$PROMOTE_ALPHA9:\$PROMOTE_ALPHA10" in/,
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
  const live = text
    .split("      - name:")
    .find((step) => step.includes("ninja-renew.mjs live"));
  assert.match(live, /id: live/);
  assert.match(live, /ninja-renew\.mjs live[^\n]+--wait-for-assets/);
  assert.ok(
    text.indexOf("Verify the active deployment identity") < text.indexOf(live),
    "Only the post-activation live check may wait for missing assets",
  );
  assert.doesNotMatch(activation, /--wait-for-assets/);
  const observations = text
    .split("      - name:")
    .find((step) => step.includes("name: ninja-live-verification-"));
  assert.match(
    observations,
    /if: always\(\) && \(steps\.live\.outcome == 'success' \|\| steps\.live\.outcome == 'failure'\)/,
  );
  assert.match(observations, /uses: actions\/upload-artifact@[a-f0-9]{40}/);
  assert.equal(
    observations.match(/\n\s+path: ([^\n]+)/)?.[1],
    "${{ runner.temp }}/daedlo-renewal/live-verification-*/events.jsonl",
    "Only sanitized live observation journals may be uploaded",
  );
  assert.doesNotMatch(
    observations,
    /CLOUDFLARE_API_TOKEN|DAEDLO_UPDATE_SIGNING_KEY/,
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
          PROMOTE_ALPHA9: "false",
          PROMOTE_ALPHA10: "false",
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
      PROMOTE_ALPHA9: "false",
      PROMOTE_ALPHA10: "false",
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

test("only explicit alpha9 promotion extends complete alpha7 history and verification retains every asset", async (t) => {
  const f = await fixture(t, {
    alpha4: true,
    alpha5: true,
    alpha6: true,
    alpha7: true,
    alpha9: true,
    promoted9: false,
  });
  await assert.rejects(prep(f), /inventory|promotion/i);
  const result = await prepareNinjaRenewal(
    { ...f.options, promoteAlpha9: true },
    f.dependencies,
  );
  const envelope = JSON.parse(
    await fs.readFile(join(result.sitePath, "public/updates/preview.json")),
  );
  assert.deepEqual(envelope.signed.releases.slice(0, -1), f.signed.releases);
  assert.equal(envelope.signed.releases.at(-1).version, "0.1.4-alpha.9");
  assert.equal(envelope.signed.releases.at(-1).contracts.manager, 2);
  assert.equal(
    (await verifyNinjaRenewal({ output: f.options.output }, f.dependencies))
      .status,
    "PASS",
  );
  const served = new Map();
  const preparedReceipt = JSON.parse(
    await fs.readFile(join(f.options.output, "renewal-receipt.json")),
  );
  for (const file of preparedReceipt.manifest.files) {
    if (
      !file.path.startsWith("public/") ||
      ["public/_headers", "public/.assetsignore"].includes(file.path)
    )
      continue;
    served.set(
      origin + "/" + file.path.slice(7),
      await fs.readFile(join(result.sitePath, file.path)),
    );
  }
  const live = await verifyLiveNinjaRenewal(
    { output: f.options.output },
    {
      ...f.dependencies,
      fetchImpl: async (url) => {
        const canonical = url === origin + "/" ? origin + "/index.html" : url;
        const body = served.get(canonical);
        return new Response(body ?? "", {
          status: body ? 200 : 404,
          headers: {
            "x-content-type-options": "nosniff",
            "content-length": String(body?.length ?? 0),
            "cache-control":
              url === feed
                ? "no-cache, max-age=0, must-revalidate"
                : /\/(downloads|updates\/keys)\//.test(url)
                  ? "public, max-age=31536000, immutable"
                  : "no-cache",
          },
        });
      },
    },
  );
  assert.equal(live.status, "PASS");
  assert.equal(live.generation, result.generation);
  assert.deepEqual(
    served.get(origin + "/downloads/0.1.4-alpha.9/daedlo-0.1.4-alpha.9.zip"),
    f.bodies.get(origin + "/downloads/0.1.4-alpha.9/daedlo-0.1.4-alpha.9.zip"),
  );
  const receiptPath = join(f.options.output, "renewal-receipt.json");
  const receipt = JSON.parse(await fs.readFile(receiptPath));
  assert.equal(receipt.promoteAlpha9, true);
  receipt.promoteAlpha9 = false;
  await fs.writeFile(receiptPath, JSON.stringify(receipt));
  await assert.rejects(
    verifyNinjaRenewal({ output: f.options.output }, f.dependencies),
    /inventory|promotion/i,
  );
});

test("alpha9 ordinary renewal authenticates alpha7 checkpoint history and cannot drop retained releases", async (t) => {
  const f = await fixture(t, {
    alpha4: true,
    alpha5: true,
    alpha6: true,
    alpha7: true,
    alpha9: true,
  });
  const releases = f.signed.releases;
  f.signed.releases = releases.slice(0, -1);
  const checkpointPath = join(f.root, "alpha7-checkpoint.json");
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

test("alpha9 cannot skip alpha7, combine promotions, or omit historical pins", async (t) => {
  const f = await fixture(t, {
    alpha4: true,
    alpha5: true,
    alpha6: true,
    alpha7: true,
    alpha9: true,
    promoted7: false,
    promoted9: false,
  });
  await assert.rejects(
    prepareNinjaRenewal({ ...f.options, promoteAlpha9: true }, f.dependencies),
    /inventory|promotion/i,
  );
  const complete = await fixture(t, {
    alpha4: true,
    alpha5: true,
    alpha6: true,
    alpha7: true,
    alpha9: true,
    promoted9: false,
  });
  const selectors = [
    "promoteAlpha4",
    "promoteAlpha5",
    "promoteAlpha6",
    "promoteAlpha7",
    "promoteAlpha9",
  ];
  for (let mask = 1; mask < 32; mask++) {
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
  for (const version of [
    "0.1.4-alpha.4",
    "0.1.4-alpha.5",
    "0.1.4-alpha.6",
    "0.1.4-alpha.7",
  ]) {
    const pins = complete.policy.assets[version];
    delete complete.policy.assets[version];
    await assert.rejects(prep(complete), /inventory/i);
    complete.policy.assets[version] = pins;
  }
});

test("alpha9 asset network diagnostics use only its reviewed public path and static failure category", async (t) => {
  const f = await fixture(t, {
    alpha4: true,
    alpha5: true,
    alpha6: true,
    alpha7: true,
    alpha9: true,
  });
  const transport = f.dependencies.fetchImpl;
  f.dependencies.fetchImpl = async (url, options) => {
    if (url === origin + "/downloads/0.1.4-alpha.9/daedlo-0.1.4-alpha.9.zip")
      throw Object.assign(Error("private peer and response details"), {
        code: "ECONNRESET",
      });
    return transport(url, options);
  };
  await assert.rejects(prep(f), {
    message:
      "Renewal network failure: stage=prepare path=/downloads/0.1.4-alpha.9/daedlo-0.1.4-alpha.9.zip phase=headers category=connection",
  });
});

test("alpha9 workflow selection rejects every combined promotion before credentials", async () => {
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
  for (let mask = 0; mask < 32; mask++) {
    const env = {
      ...process.env,
      ...Object.fromEntries(
        [4, 5, 6, 7, 9, 10].map((number, index) => [
          "PROMOTE_ALPHA" + number,
          mask & (1 << index) ? "true" : "false",
        ]),
      ),
    };
    const run = () =>
      execFileSync("bash", ["-c", script], { env, stdio: "pipe" });
    if (
      [4, 5, 6, 7, 9].filter(
        (number) => env["PROMOTE_ALPHA" + number] === "true",
      ).length > 1
    )
      assert.throws(run);
    else assert.doesNotThrow(run);
  }
  assert.match(
    text,
    /promote_alpha9:\n\s+description:[^\n]+\n\s+type: boolean\n\s+default: false/,
  );
  assert.match(
    text,
    /NINJA_PROMOTE_ALPHA9:.*github.event_name == 'workflow_dispatch'.*inputs.promote_alpha9/,
  );
  assert.match(
    text,
    /elif test "\$NINJA_PROMOTE_ALPHA9" = "true"; then\n\s+node scripts\/release\/ninja-promotion\.mjs --promote-alpha9/,
  );
  assert.doesNotMatch(text, /promote_alpha8|PROMOTE_ALPHA8/);
  for (const value of ["", "1", "TRUE", "false:true"])
    assert.throws(() =>
      execFileSync("bash", ["-c", script], {
        env: {
          ...process.env,
          PROMOTE_ALPHA4: "false",
          PROMOTE_ALPHA5: "false",
          PROMOTE_ALPHA6: "false",
          PROMOTE_ALPHA7: "false",
          PROMOTE_ALPHA9: value,
          PROMOTE_ALPHA10: "false",
        },
        stdio: "pipe",
      }),
    );
});

test("publisher source allows exactly historical assets plus three reviewed alpha10 files", async () => {
  const text = await fs.readFile(
    join(repo, "website/public/.assetsignore"),
    "utf8",
  );
  const versions = [
    "0.1.2-rc.1",
    "0.1.4-alpha.2",
    "0.1.4-alpha.3",
    "0.1.4-alpha.4",
    "0.1.4-alpha.5",
    "0.1.4-alpha.6",
    "0.1.4-alpha.7",
    "0.1.4-alpha.9",
    "0.1.4-alpha.10",
  ];
  const allowed = text
    .split("\n")
    .filter((line) => line.startsWith("!/downloads/"));
  assert.deepEqual(allowed, [
    "!/downloads/",
    ...versions.flatMap((version) => [
      `!/downloads/${version}/`,
      `!/downloads/${version}/daedlo-${version}.zip`,
      `!/downloads/${version}/SHA256SUMS`,
      `!/downloads/${version}/release.json`,
    ]),
  ]);
});

test("alpha9 refuses changed retained history, missing durable checkpoint and an ahead checkpoint", async (t) => {
  for (const change of [
    (f) => f.signed.releases.pop(),
    (f) => {
      f.signed.releases[0].kit.sha256 = "f".repeat(64);
    },
  ]) {
    const f = await fixture(t, {
      alpha4: true,
      alpha5: true,
      alpha6: true,
      alpha7: true,
      alpha9: true,
    });
    const checkpointPath = join(f.root, "alpha9-checkpoint.json");
    await fs.writeFile(checkpointPath, f.envelope());
    change(f);
    f.signed.generation = 2;
    f.bodies.set(feed, f.envelope());
    await assert.rejects(
      prepareNinjaRenewal(
        { ...f.options, checkpointPath, promoteAlpha9: true },
        f.dependencies,
      ),
      /retained release|immutable asset/i,
    );
    await assert.rejects(fs.lstat(f.options.output), { code: "ENOENT" });
  }
  const f = await fixture(t, {
    alpha4: true,
    alpha5: true,
    alpha6: true,
    alpha7: true,
    alpha9: true,
  });
  f.signed.generation = 2;
  f.bodies.set(feed, f.envelope());
  await assert.rejects(prep(f), /Durable signed checkpoint required/);
  f.signed.generation = 3;
  const checkpointPath = join(f.root, "ahead-checkpoint.json");
  await fs.writeFile(checkpointPath, f.envelope());
  await assert.rejects(
    prepareNinjaRenewal({ ...f.options, checkpointPath }, f.dependencies),
    /rollback|generation|checkpoint/i,
  );
  await assert.rejects(fs.lstat(f.options.output), { code: "ENOENT" });
});

test("alpha9 renewal rejects nonboolean or stale predecessor selectors and a changed trust pin", async (t) => {
  const f = await fixture(t, {
    alpha4: true,
    alpha5: true,
    alpha6: true,
    alpha7: true,
    alpha9: true,
    promoted9: false,
  });
  for (const options of [
    { promoteAlpha9: "true" },
    { promoteAlpha4: true },
    { promoteAlpha5: true },
    { promoteAlpha6: true },
    { promoteAlpha7: true },
  ]) {
    await assert.rejects(
      prepareNinjaRenewal({ ...f.options, ...options }, f.dependencies),
      /promotion|inventory/i,
    );
    await assert.rejects(fs.lstat(f.options.output), { code: "ENOENT" });
  }
  f.policy.publicKeyPemSha256 = "f".repeat(64);
  await assert.rejects(
    prepareNinjaRenewal({ ...f.options, promoteAlpha9: true }, f.dependencies),
    /public key pin differs/,
  );
  await assert.rejects(fs.lstat(f.options.output), { code: "ENOENT" });
});

test("alpha10 explicit promotion retains alpha9 and numeric prerelease order", async (t) => {
  const f = await fixture(t, {
    alpha4: true,
    alpha5: true,
    alpha6: true,
    alpha7: true,
    alpha9: true,
    alpha10: true,
    promoted10: false,
  });
  await assert.rejects(prep(f), /inventory|promotion/i);
  const result = await prepareNinjaRenewal(
    { ...f.options, promoteAlpha10: true },
    f.dependencies,
  );
  const envelope = JSON.parse(
    await fs.readFile(join(result.sitePath, "public/updates/preview.json")),
  );
  assert.deepEqual(envelope.signed.releases.slice(0, -1), f.signed.releases);
  assert.equal(envelope.signed.releases.at(-1).version, "0.1.4-alpha.10");
  assert.equal(envelope.signed.releases.at(-1).contracts.manager, 2);
  for (const [version, files] of Object.entries(f.policy.assets)) {
    for (const name of Object.keys(files)) {
      assert.deepEqual(
        await fs.readFile(
          join(result.sitePath, "public/downloads", version, name),
        ),
        f.bodies.get(`${origin}/downloads/${version}/${name}`),
      );
    }
  }
  assert.equal(
    (await verifyNinjaRenewal({ output: f.options.output }, f.dependencies))
      .status,
    "PASS",
  );
  const receiptPath = join(f.options.output, "renewal-receipt.json");
  const receipt = JSON.parse(await fs.readFile(receiptPath));
  assert.equal(receipt.promoteAlpha10, true);
  receipt.promoteAlpha10 = false;
  await fs.writeFile(receiptPath, JSON.stringify(receipt));
  await assert.rejects(
    verifyNinjaRenewal({ output: f.options.output }, f.dependencies),
    /inventory|promotion/i,
  );
});

test("alpha10 ordinary renewal authenticates retained alpha9 checkpoint", async (t) => {
  const f = await fixture(t, {
    alpha4: true,
    alpha5: true,
    alpha6: true,
    alpha7: true,
    alpha9: true,
    alpha10: true,
  });
  const releases = f.signed.releases;
  f.signed.releases = releases.slice(0, -1);
  const checkpointPath = join(f.root, "alpha9-checkpoint.json");
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

test("alpha10 workflow checks all 64 selections before credentials", async () => {
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
  const selectors = [4, 5, 6, 7, 9, 10];
  for (let mask = 0; mask < 64; mask++) {
    const selected = selectors.filter((_, index) => mask & (1 << index));
    const env = {
      ...process.env,
      ...Object.fromEntries(
        selectors.map((number, index) => [
          "PROMOTE_ALPHA" + number,
          mask & (1 << index) ? "true" : "false",
        ]),
      ),
    };
    const run = () =>
      execFileSync("bash", ["-c", script], { env, stdio: "pipe" });
    if (selected.length > 1) assert.throws(run, `mixed selection ${selected}`);
    else assert.doesNotThrow(run, `single selection ${selected}`);
  }
  for (const value of ["", "1", "TRUE", "false:true"]) {
    assert.throws(() =>
      execFileSync("bash", ["-c", script], {
        env: {
          ...process.env,
          ...Object.fromEntries(
            selectors.map((number) => ["PROMOTE_ALPHA" + number, "false"]),
          ),
          PROMOTE_ALPHA10: value,
        },
        stdio: "pipe",
      }),
    );
  }
  assert.match(
    text,
    /promote_alpha10:\n\s+description:[^\n]+\n\s+type: boolean\n\s+default: false/,
  );
  assert.match(
    text,
    /NINJA_PROMOTE_ALPHA10:.*github.event_name == 'workflow_dispatch'.*inputs.promote_alpha10/,
  );
  assert.match(
    text,
    /elif test "\$NINJA_PROMOTE_ALPHA10" = "true"; then\n\s+node scripts\/release\/ninja-promotion\.mjs --promote-alpha10/,
  );
});

test("alpha10 rejects skipped alpha9, all mixed selectors and missing historical pins", async (t) => {
  const f = await fixture(t, {
    alpha4: true,
    alpha5: true,
    alpha6: true,
    alpha7: true,
    alpha9: true,
    alpha10: true,
    promoted10: false,
  });
  const selectors = [4, 5, 6, 7, 9, 10].map(
    (number) => "promoteAlpha" + number,
  );
  for (let mask = 1; mask < 64; mask++) {
    const selected = Object.fromEntries(
      selectors
        .filter((_, index) => mask & (1 << index))
        .map((name) => [name, true]),
    );
    if (Object.keys(selected).length < 2) continue;
    await assert.rejects(
      prepareNinjaRenewal({ ...f.options, ...selected }, f.dependencies),
      /Only one explicit release promotion/,
    );
    await assert.rejects(fs.lstat(f.options.output), { code: "ENOENT" });
  }
  for (const options of [
    { promoteAlpha10: "true" },
    ...[4, 5, 6, 7, 9].map((number) => ({ ["promoteAlpha" + number]: true })),
  ]) {
    await assert.rejects(
      prepareNinjaRenewal({ ...f.options, ...options }, f.dependencies),
      /promotion|inventory/i,
    );
    await assert.rejects(fs.lstat(f.options.output), { code: "ENOENT" });
  }
  for (const version of Object.keys(f.policy.assets).filter(
    (version) => version !== "0.1.4-alpha.10",
  )) {
    const pins = f.policy.assets[version];
    delete f.policy.assets[version];
    await assert.rejects(
      prepareNinjaRenewal(
        { ...f.options, promoteAlpha10: true },
        f.dependencies,
      ),
      /inventory/i,
    );
    f.policy.assets[version] = pins;
  }
  f.signed.releases.pop();
  f.bodies.set(feed, f.envelope());
  await assert.rejects(
    prepareNinjaRenewal({ ...f.options, promoteAlpha10: true }, f.dependencies),
    /inventory|promotion/i,
  );
  await assert.rejects(fs.lstat(f.options.output), { code: "ENOENT" });
});

test("alpha10 preserves durable history, trust and static download diagnostics", async (t) => {
  const f = await fixture(t, {
    alpha4: true,
    alpha5: true,
    alpha6: true,
    alpha7: true,
    alpha9: true,
    alpha10: true,
  });
  const checkpointPath = join(f.root, "alpha10-checkpoint.json");
  await fs.writeFile(checkpointPath, f.envelope());
  const releases = structuredClone(f.signed.releases);
  for (const changed of [
    releases.slice(0, -1),
    releases.map((release) =>
      release.version === "0.1.4-alpha.9"
        ? { ...release, kit: { ...release.kit, sha256: "f".repeat(64) } }
        : release,
    ),
  ]) {
    f.signed.releases = changed;
    f.signed.generation = 2;
    f.bodies.set(feed, f.envelope());
    await assert.rejects(
      prepareNinjaRenewal(
        { ...f.options, checkpointPath, promoteAlpha10: true },
        f.dependencies,
      ),
      /retained release|immutable asset/,
    );
  }
  f.signed.releases = releases;
  f.bodies.set(feed, f.envelope());
  await assert.rejects(prep(f), /Durable signed checkpoint required/);
  f.signed.generation = 3;
  const ahead = join(f.root, "ahead.json");
  await fs.writeFile(ahead, f.envelope());
  await assert.rejects(
    prepareNinjaRenewal(
      { ...f.options, checkpointPath: ahead },
      f.dependencies,
    ),
    /rollback|generation|checkpoint/i,
  );
  f.signed.generation = 1;
  f.bodies.set(feed, f.envelope());
  const trust = f.policy.publicKeyPemSha256;
  f.policy.publicKeyPemSha256 = "f".repeat(64);
  await assert.rejects(prep(f), /public key pin differs/);
  f.policy.publicKeyPemSha256 = trust;
  const transport = f.dependencies.fetchImpl;
  f.dependencies.fetchImpl = async (url, options) => {
    if (url === origin + "/downloads/0.1.4-alpha.10/daedlo-0.1.4-alpha.10.zip")
      throw Object.assign(Error("private peer and response details"), {
        code: "ECONNRESET",
      });
    return transport(url, options);
  };
  await assert.rejects(prep(f), {
    message:
      "Renewal network failure: stage=prepare path=/downloads/0.1.4-alpha.10/daedlo-0.1.4-alpha.10.zip phase=headers category=connection",
  });
});
