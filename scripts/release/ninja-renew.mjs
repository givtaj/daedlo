#!/usr/bin/env node
/** Production signed feed renewal. This issuer-side tool never deploys, changes
 * consumer verification, installs packages, or copies private keys. The CLI pins
 * one production origin/key and an explicitly pinned immutable release inventory. Reviewed source
 * changes must explicitly extend that inventory before a later product release.
 *
 * prepare --private-key ABS --output FRESH_ABS [--checkpoint SIGNED_CATALOG]
 * verify --output ABS  (immediately before deployment; live baseline must match)
 * live --output ABS    (after deployment; verifies all served bytes/boundaries)
 *
 * The workflow persists output/checkpoint before deployment. A checkpoint ahead
 * of the live feed is an operator-recovery condition, not permission to replay.
 * Injected policy/transport/source/clock are trusted test seams, never CLI options.
 */
import fs from "node:fs/promises";
import { constants } from "node:fs";
import { createPublicKey } from "node:crypto";
import { dirname, isAbsolute, join, parse, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { sha256 } from "./manifest.mjs";
import { verifyNinjaCatalog } from "./ninja-catalog.mjs";
import {
  inspectPublisherKey,
  publishNinjaCatalog,
} from "./ninja-publisher.mjs";
import {
  PUBLIC_FILES,
  CONTROL_FILES,
  createWebsiteManifest,
} from "../../website/scripts/manifest.mjs";
import { stageRelease } from "../../website/scripts/stage-release.mjs";
import { stageUpdates } from "../../website/scripts/stage-updates.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ORIGIN = "https://daedlo.com",
  FEED = ORIGIN + "/updates/preview.json",
  KEY = "daedlo-release-2026-10";
const VERSIONS = ["0.1.2-rc.1", "0.1.4-alpha.2", "0.1.4-alpha.3"];
const ALPHA4 = "0.1.4-alpha.4",
  DAY = 86400000;
const CONTRACTS = {
  manager: 1,
  launcher: 1,
  nodeAdapter: 1,
  rustModel: 1,
  protocol: 1,
  capabilities: ["recipeContext:1"],
};
const item = (bytes, sha256) => ({ bytes, sha256 });
export const PRODUCTION_RENEWAL_POLICY = Object.freeze({
  publicKeyPemSha256:
    "df84f7d60ed2af949d394e338070ef66ab4debabf911ffd6c7b35bebe6ba4297",
  initialCheckpoint: {
    generation: 1,
    sha256: "bde773d01a3cb0bb33330b74b17dd7e5068e33fb650a55d558d446a10f5bbad0",
  },
  promotion: {
    version: "0.1.4-alpha.4",
    sourceCommit: "bd8e393351f3116920c976cfd3221035e2304db3",
  },
  releaseContracts: { "0.1.4-alpha.4": { ...CONTRACTS, manager: 2 } },
  assets: {
    "0.1.4-alpha.4": {
      "daedlo-0.1.4-alpha.4.zip": {
        bytes: 280646,
        sha256:
          "e060da304e9ec612472f580bdfdb06ac2bc048dc4fa409bc6e91d1aff13a1ec7",
      },
      "release.json": {
        bytes: 6978,
        sha256:
          "3a056d68744ad972cfd01a923a654d5fa4d18a967c25422a0216ce57b6d761df",
      },
      SHA256SUMS: {
        bytes: 91,
        sha256:
          "f28519c8579fd6f832e35841395eeb0647bd0b49e48c6d850039a8efacd342e0",
      },
    },
    "0.1.2-rc.1": {
      "daedlo-0.1.2-rc.1.zip": item(
        147172,
        "da5ce1387eb147a3fb3a7225decd3e51e9fc355a505583ccc20cb2a9bf33963b",
      ),
      "release.json": item(
        6558,
        "1ff4b7053ffbd2f1196974fa3691c30531964f121b7a8161871bd6cecbfe9060",
      ),
      SHA256SUMS: item(
        88,
        "b5635817e49c00db75490c79d7112b53b90811be3742f728da71dcb9f6e30e9e",
      ),
    },
    "0.1.4-alpha.2": {
      "daedlo-0.1.4-alpha.2.zip": item(
        160545,
        "b9555b6b237ac437f62b984f6994e3ef12ba4e8f95b730f52c9aa9313a375ee1",
      ),
      "release.json": item(
        7184,
        "666d3389c182d6aba28fa650ce5b9768a20cf4f75cbd7b3ff03af168ec862cc5",
      ),
      SHA256SUMS: item(
        91,
        "8fc8a1e1cd8e1777396f12a99c2ed0eb3414d5f246aaf9019c47400195d62cc9",
      ),
    },
    "0.1.4-alpha.3": {
      "daedlo-0.1.4-alpha.3.zip": item(
        206234,
        "f569bc0c84bf1b7ac5efe59c610916ac8ab0d5bb3322ed520114d8880262b190",
      ),
      "release.json": item(
        7067,
        "e771773a0fcdcfc578208cc6572da87670af4a44c2769b15c8a8a0b5c8aebe45",
      ),
      SHA256SUMS: item(
        91,
        "1a8a91494fe684d0eabebea97ae332dad4ce8f3f907873beb90a654102ae6b6f",
      ),
    },
  },
});
const SOURCE_FILES = [...PUBLIC_FILES]
  .filter((f) => !["install.html", "updates.html"].includes(f))
  .map((f) => "website/public/" + f)
  .concat([
    "website/wrangler.jsonc",
    "website/templates/install.html",
    "website/templates/updates.html",
  ]);
const PRIVATE_PATHS = [
  "/.env",
  "/_headers",
  "/.assetsignore",
  "/wrangler.jsonc",
  "/updates/private.pem",
  "/updates/keys/private.pem",
  "/downloads/0.1.4-alpha.3/SOURCE.json",
  "/scripts/release/ninja-publisher.mjs",
  "/package.json",
];
// Diagnostics may name only reviewed request paths, never response text, arbitrary
// headers, status text, query strings or values supplied through test policy seams.
const HTTP_DIAGNOSTIC_PATHS = new Set([
  "/",
  ...[...PUBLIC_FILES].flatMap((name) =>
    name.endsWith(".html")
      ? ["/" + name, "/" + name.slice(0, -5)]
      : ["/" + name],
  ),
  "/updates/preview.json",
  `/updates/keys/${KEY}.pem`,
  ...[...VERSIONS, ALPHA4].flatMap((version) =>
    [`daedlo-${version}.zip`, "release.json", "SHA256SUMS"].map(
      (name) => `/downloads/${version}/${name}`,
    ),
  ),
  ...PRIVATE_PATHS,
]);
function httpStatusFailure(url, response, expected) {
  const parsed = new URL(url);
  const path =
    parsed.origin === ORIGIN &&
    !parsed.username &&
    !parsed.password &&
    !parsed.search &&
    !parsed.hash &&
    HTTP_DIAGNOSTIC_PATHS.has(parsed.pathname)
      ? parsed.pathname
      : "[unreviewed-path]";
  const status =
    Number.isInteger(response.status) &&
    response.status >= 100 &&
    response.status <= 599
      ? response.status
      : "unknown";
  const mitigation =
    response.headers.get("cf-mitigated") === "challenge"
      ? " cf-mitigated=challenge"
      : "";
  return `Unexpected renewal HTTP status: ${path} status=${status} expected=${expected}${mitigation}`;
}
function fail(message) {
  throw Error(message);
}
function clock(now) {
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !Number.isFinite(new Date(now).getTime())
  )
    fail("Invalid renewal clock");
  return now;
}
async function pathInfo(value, { fresh = false, directory = false } = {}) {
  if (
    typeof value !== "string" ||
    !isAbsolute(value) ||
    value.includes("\0") ||
    value.split(/[\\/]/).includes("..")
  )
    fail("Explicit absolute renewal path required");
  const path = resolve(value);
  let at = parse(path).root;
  for (const part of path.slice(at.length).split(sep).filter(Boolean)) {
    at = join(at, part);
    let s;
    try {
      s = await fs.lstat(at);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    if (s?.isSymbolicLink()) fail("Renewal paths cannot contain symlinks");
    if (at !== path) {
      if (!s?.isDirectory()) fail("Renewal parent directory missing");
    } else if (fresh) {
      if (s) fail("Renewal output must be fresh");
    } else if (!s || (directory ? !s.isDirectory() : !s.isFile()))
      fail("Expected regular renewal input");
  }
  if (fresh && path === parse(path).root) fail("Renewal output must be fresh");
  return path;
}
async function read(path, max = 4 * 1024 * 1024) {
  await pathInfo(path);
  const h = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = await h.stat();
    if (!s.isFile() || s.size > max) fail("Renewal input exceeds bounded size");
    const b = await h.readFile();
    if (b.length !== s.size || b.length > max) fail("Renewal input changed");
    return b;
  } finally {
    await h.close();
  }
}
function settings(deps = {}) {
  const policy = deps.policy ?? PRODUCTION_RENEWAL_POLICY;
  const versions = [
    ...VERSIONS,
    ...(Object.hasOwn(policy.assets, ALPHA4) ? [ALPHA4] : []),
  ];
  if (
    !isDeepStrictEqual(Object.keys(policy.assets).sort(), [...versions].sort())
  )
    fail("Unsupported pinned renewal release inventory");
  const releaseContracts = policy.releaseContracts ?? {};
  if (
    !releaseContracts ||
    typeof releaseContracts !== "object" ||
    Array.isArray(releaseContracts) ||
    Object.keys(releaseContracts).some((v) => !versions.slice(1).includes(v))
  )
    fail("Unsupported pinned release contracts");
  for (const version of versions.slice(1)) {
    const expected = { ...CONTRACTS, manager: version === ALPHA4 ? 2 : 1 };
    if (!isDeepStrictEqual(releaseContracts[version] ?? CONTRACTS, expected))
      fail("Unsupported pinned release contracts");
  }
  return {
    versions,
    releaseContracts,
    fetchImpl: deps.fetchImpl ?? globalThis.fetch,
    now: clock(deps.now ?? Date.now()),
    sourceRoot: resolve(deps.sourceRoot ?? ROOT),
    policy,
  };
}
async function trust(s) {
  const path = join(s.sourceRoot, "docs/update-trust", KEY + ".pem");
  const pem = await read(path, 8192);
  if (
    sha256(pem) !== s.policy.publicKeyPemSha256 ||
    !pem.toString().startsWith("-----BEGIN PUBLIC KEY-----\n")
  )
    fail("Bundled production public key pin differs");
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== "ed25519")
    fail("Production key must be Ed25519");
  return { pem, key, keys: [{ id: KEY, publicKey: key }] };
}
async function fetchBytes(
  url,
  s,
  {
    maximum = 256 * 1024,
    status = 200,
    date = false,
    htmlRedirect = false,
  } = {},
) {
  if (!url.startsWith(ORIGIN + "/") || new URL(url).origin !== ORIGIN)
    fail("Unsupported renewal origin");
  const response = await s.fetchImpl(url, {
    redirect: htmlRedirect ? "manual" : "error",
    headers: { "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(30000),
  });
  if (response.redirected || (response.url && response.url !== url))
    fail("Renewal response changed origin or URL");
  if (htmlRedirect && [301, 302, 307, 308].includes(response.status)) {
    const canonical = url.endsWith("/index.html")
      ? ORIGIN + "/"
      : url.slice(0, -5);
    if (new URL(response.headers.get("location") ?? "", url).href !== canonical)
      fail("Unexpected HTML canonical redirect");
    return fetchBytes(canonical, s, { maximum, status, date });
  }
  if (response.status !== status)
    fail(httpStatusFailure(url, response, status));
  if (date) {
    const observed = Date.parse(response.headers.get("date") ?? "");
    if (!Number.isFinite(observed) || Math.abs(observed - s.now) > 5 * 60000)
      fail("Renewal clock disagrees with HTTPS Date");
  }
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum))
    fail("Renewal response exceeds bounded size");
  if (!response.body) fail("Missing renewal response body");
  const reader = response.body.getReader(),
    chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maximum) fail("Renewal response exceeds bounded size");
      chunks.push(Buffer.from(value));
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  } finally {
    reader.releaseLock();
  }
  return { bytes: Buffer.concat(chunks, total), headers: response.headers };
}
function history(bytes, s, t, previousState = null) {
  let envelope;
  try {
    envelope = JSON.parse(bytes);
  } catch {
    fail("Invalid renewal catalog JSON");
  }
  const issued = Date.parse(envelope.signed?.issuedAt);
  if (!Number.isFinite(issued) || issued > s.now)
    fail("Catalog issuance is ahead of renewal clock");
  // Issuer-only history authentication; downloaded/current consumer checks retain expiry.
  const verified = verifyNinjaCatalog({
    bytes,
    publisher: "daedlo",
    trustedKeys: t.keys,
    now: issued,
    previousState,
  });
  const versions = verified.catalog.releases.map((r) => r.version).sort();
  if (
    ![VERSIONS.slice(1), s.versions.slice(1)].some((allowed) =>
      isDeepStrictEqual(versions, allowed),
    )
  )
    fail("Unsupported renewal release inventory");
  for (const release of verified.catalog.releases) {
    if (
      release.channel !== "preview" ||
      !isDeepStrictEqual(release.platforms, [
        { os: "darwin", arch: "arm64" },
      ]) ||
      !isDeepStrictEqual(
        release.contracts,
        s.releaseContracts[release.version] ?? CONTRACTS,
      ) ||
      release.notesUrl !== ORIGIN + "/updates.html"
    )
      fail("Unsupported immutable release contract");
    for (const [field, name] of [
      ["kit", `daedlo-${release.version}.zip`],
      ["metadata", "release.json"],
      ["checksums", "SHA256SUMS"],
    ]) {
      if (
        !isDeepStrictEqual(release[field], {
          url: `${ORIGIN}/downloads/${release.version}/${name}`,
          ...s.policy.assets[release.version][name],
        })
      )
        fail("Signed immutable asset identity or URL changed");
    }
  }
  return verified;
}
function requireBaselineInventory(verified, s, promoteAlpha4) {
  if (
    typeof promoteAlpha4 !== "boolean" ||
    (promoteAlpha4 && !s.versions.includes(ALPHA4))
  )
    fail("Alpha4 promotion requires its explicitly pinned release inventory");
  if (
    !promoteAlpha4 &&
    !isDeepStrictEqual(
      verified.catalog.releases.map((r) => r.version).sort(),
      s.versions.slice(1),
    )
  )
    fail("Renewal baseline inventory requires explicit alpha4 promotion");
}
async function baseline(s, t, checkpointPath, promoteAlpha4) {
  const response = await fetchBytes(FEED, s, { date: true });
  let previousState;
  if (checkpointPath)
    previousState = history(
      await read(checkpointPath, 256 * 1024),
      s,
      t,
    ).checkpoint;
  const verified = history(response.bytes, s, t, previousState);
  requireBaselineInventory(verified, s, promoteAlpha4);
  if (
    !checkpointPath &&
    !isDeepStrictEqual(verified.checkpoint, s.policy.initialCheckpoint)
  )
    fail(
      "Durable signed checkpoint required after initial released generation",
    );
  if (!Number.isSafeInteger(verified.catalog.generation + 1))
    fail("Catalog generation overflow");
  return { ...verified, bytes: response.bytes };
}
async function inventory(sourceRoot, paths) {
  return Promise.all(
    paths.map(async (path) => {
      const bytes = await read(join(sourceRoot, path));
      return { path, bytes: bytes.length, sha256: sha256(bytes) };
    }),
  );
}
async function jsonWrite(path, value) {
  await fs.writeFile(path, JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
}
async function assertBaseline(bytes, s, t) {
  const latest = await fetchBytes(FEED, s, { date: true });
  history(latest.bytes, s, t);
  if (!latest.bytes.equals(bytes))
    fail("Live catalog baseline changed; concurrent renewal or drift");
}

/** Prepare reviewed source plus authenticated immutable downloads in a fresh tree.
 * No publish authority is used here. The returned checkpoint is public signed data. */
export async function prepareNinjaRenewal(
  { privateKeyPath, output, checkpointPath, promoteAlpha4 = false } = {},
  deps = {},
) {
  const s = settings(deps),
    t = await trust(s);
  output = await pathInfo(output, { fresh: true });
  const inspected = await inspectPublisherKey({ privateKeyPath, keyId: KEY });
  if (!Buffer.from(inspected.publicKeyPem).equals(t.pem))
    fail("Private signing key does not match bundled production pin");
  const prior = await baseline(s, t, checkpointPath, promoteAlpha4);
  const sourceBefore = await inventory(s.sourceRoot, SOURCE_FILES);
  await fs.mkdir(output, { mode: 0o700 });
  const site = join(output, "site"),
    downloads = join(output, "inputs");
  await fs.mkdir(site);
  await fs.mkdir(downloads);
  for (const file of SOURCE_FILES) {
    const target = join(site, file.slice("website/".length));
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.writeFile(target, await read(join(s.sourceRoot, file)), {
      flag: "wx",
      mode: 0o644,
    });
  }
  for (const version of s.versions) {
    const dir = join(downloads, version);
    await fs.mkdir(dir);
    for (const [name, pin] of Object.entries(s.policy.assets[version])) {
      const { bytes } = await fetchBytes(
        `${ORIGIN}/downloads/${version}/${name}`,
        s,
        { maximum: pin.bytes },
      );
      if (bytes.length !== pin.bytes || sha256(bytes) !== pin.sha256)
        fail("Immutable asset bytes or digest changed");
      await fs.writeFile(join(dir, name), bytes, { flag: "wx" });
    }
    await stageRelease({
      websiteRoot: site,
      releaseDirectory: dir,
      expectedVersion: version,
    });
  }
  const baselinePath = join(output, "baseline-catalog.json");
  await fs.writeFile(baselinePath, prior.bytes, { flag: "wx" });
  const pub = await publishNinjaCatalog(
    {
      schemaVersion: 1,
      publisher: "daedlo",
      keyId: KEY,
      privateKeyPath,
      generation: prior.catalog.generation + 1,
      issuedAt: new Date(s.now).toISOString(),
      expiresAt: new Date(s.now + 7 * DAY).toISOString(),
      origin: ORIGIN,
      catalogUrl: FEED,
      notesUrl: ORIGIN + "/updates.html",
      channel: "preview",
      platforms: [{ os: "darwin", arch: "arm64" }],
      contracts: CONTRACTS,
      releaseContracts: s.releaseContracts,
      kitDirectories: s.versions.slice(1).map((v) => join(downloads, v)),
      output: join(output, "signed"),
      previousCatalogPath: baselinePath,
    },
    { now: s.now },
  );
  const catalogPath = join(output, "signed/preview.json"),
    catalog = await read(catalogPath, 256 * 1024);
  const updateTrust = {
    keyId: KEY,
    publisher: "daedlo",
    expectedPublicKeySha256: s.policy.publicKeyPemSha256,
  };
  await stageUpdates({
    websiteRoot: site,
    catalogFile: catalogPath,
    publicKeyFile: join(s.sourceRoot, "docs/update-trust", KEY + ".pem"),
    expectedVersion: s.versions.at(-1),
    ...updateTrust,
  });
  const manifest = await createWebsiteManifest({
    websiteRoot: site,
    updateTrust,
  });
  if (
    !isDeepStrictEqual(
      await inventory(s.sourceRoot, SOURCE_FILES),
      sourceBefore,
    )
  )
    fail("Reviewed website source changed while preparing");
  await assertBaseline(prior.bytes, s, t);
  await fs.mkdir(join(output, "checkpoint"));
  await fs.writeFile(join(output, "checkpoint/catalog.json"), catalog, {
    flag: "wx",
  });
  await jsonWrite(join(output, "checkpoint/receipt.json"), {
    schemaVersion: 1,
    generation: pub.generation,
    catalogSha256: sha256(catalog),
    catalogPayloadSha256: pub.checkpoint.sha256,
  });
  const receipt = {
    schemaVersion: 1,
    kind: "daedlo-feed-renewal",
    promoteAlpha4,
    status: "PREPARED",
    generation: pub.generation,
    baselineGeneration: prior.catalog.generation,
    baselineSha256: sha256(prior.bytes),
    baselinePayloadSha256: prior.catalogSha256,
    catalogSha256: sha256(catalog),
    catalogPayloadSha256: pub.checkpoint.sha256,
    issuedAt: new Date(s.now).toISOString(),
    expiresAt: new Date(s.now + 7 * DAY).toISOString(),
    sourceUnchanged: true,
    sourceFiles: sourceBefore,
    manifest,
  };
  await jsonWrite(join(output, "renewal-receipt.json"), receipt);
  return {
    status: "PREPARED",
    sitePath: site,
    receiptPath: join(output, "renewal-receipt.json"),
    generation: pub.generation,
    baselineSha256: receipt.baselineSha256,
    expiresAt: receipt.expiresAt,
  };
}
async function prepared(output, s, t) {
  output = await pathInfo(output, { directory: true });
  const receipt = JSON.parse(await read(join(output, "renewal-receipt.json")));
  if (
    receipt.schemaVersion !== 1 ||
    receipt.kind !== "daedlo-feed-renewal" ||
    receipt.status !== "PREPARED" ||
    receipt.generation !== receipt.baselineGeneration + 1
  )
    fail("Invalid renewal preparation receipt");
  const catalog = await read(
      join(output, "site/public/updates/preview.json"),
      256 * 1024,
    ),
    prior = await read(join(output, "baseline-catalog.json"), 256 * 1024);
  const verified = verifyNinjaCatalog({
    bytes: catalog,
    publisher: "daedlo",
    trustedKeys: t.keys,
    now: s.now,
  });
  if (
    sha256(catalog) !== receipt.catalogSha256 ||
    sha256(prior) !== receipt.baselineSha256 ||
    verified.catalog.generation !== receipt.generation ||
    verified.catalog.expiresAt !== receipt.expiresAt ||
    Date.parse(verified.catalog.issuedAt) > s.now
  )
    fail("Renewal catalog identity changed");
  const old = history(prior, s, t);
  requireBaselineInventory(old, s, receipt.promoteAlpha4 ?? false);
  const next = history(catalog, s, t, old.checkpoint);
  requireBaselineInventory(next, s, false);
  if (
    old.catalog.generation !== receipt.baselineGeneration ||
    old.catalogSha256 !== receipt.baselinePayloadSha256
  )
    fail("Renewal baseline identity changed");
  for (const release of old.catalog.releases)
    if (
      !isDeepStrictEqual(
        verified.catalog.releases.find((r) => r.version === release.version),
        release,
      )
    )
      fail("Renewal changed immutable release entries");
  const manifest = await createWebsiteManifest({
    websiteRoot: join(output, "site"),
    updateTrust: {
      keyId: KEY,
      publisher: "daedlo",
      expectedPublicKeySha256: s.policy.publicKeyPemSha256,
    },
  });
  if (!isDeepStrictEqual(manifest, receipt.manifest))
    fail("Prepared website manifest changed");
  if (
    !isDeepStrictEqual(
      await inventory(s.sourceRoot, SOURCE_FILES),
      receipt.sourceFiles,
    )
  )
    fail("Reviewed source changed since preparation");
  const checkpoint = await read(
    join(output, "checkpoint/catalog.json"),
    256 * 1024,
  );
  if (!checkpoint.equals(catalog)) fail("Renewal checkpoint changed");
  const checkpointReceipt = JSON.parse(
    await read(join(output, "checkpoint/receipt.json"), 8192),
  );
  if (
    !isDeepStrictEqual(checkpointReceipt, {
      schemaVersion: 1,
      generation: verified.catalog.generation,
      catalogSha256: sha256(catalog),
      catalogPayloadSha256: verified.catalogSha256,
    })
  )
    fail("Renewal checkpoint receipt changed");
  return { output, receipt, prior, catalog, manifest, verified };
}
/** Read-only predeployment gate; has no approval/deployment side effect. */
export async function verifyNinjaRenewal({ output } = {}, deps = {}) {
  const s = settings(deps),
    t = await trust(s),
    p = await prepared(output, s, t);
  await assertBaseline(p.prior, s, t);
  return {
    status: "PASS",
    generation: p.receipt.generation,
    catalogSha256: p.receipt.catalogSha256,
    manifestFiles: p.manifest.files.length,
  };
}
/** Verify the exact newly deployed static tree and signed feed over real HTTPS. */
export async function verifyLiveNinjaRenewal({ output } = {}, deps = {}) {
  const s = settings(deps),
    t = await trust(s),
    p = await prepared(output, s, t);
  const checked = [];
  for (const file of p.manifest.files) {
    if (
      !file.path.startsWith("public/") ||
      CONTROL_FILES.has(file.path.slice(7))
    )
      continue;
    const name = file.path.slice(7);
    const { bytes, headers } = await fetchBytes(ORIGIN + "/" + name, s, {
      maximum: file.bytes,
      htmlRedirect: name.endsWith(".html"),
    });
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256)
      fail("Live public asset differs from prepared manifest");
    if (headers.get("x-content-type-options") !== "nosniff")
      fail("Live nosniff security header missing");
    const cache = headers.get("cache-control") ?? "";
    if (
      (name === "updates/preview.json" && !/no-cache/.test(cache)) ||
      (name === "updates/preview.json" && !/must-revalidate/.test(cache))
    )
      fail("Live feed cache policy differs");
    if (
      /^(downloads\/|updates\/keys\/)/.test(name) &&
      (!/immutable/.test(cache) || !/max-age=31536000/.test(cache))
    )
      fail("Live immutable asset cache policy differs");
    if (name === "updates/preview.json")
      verifyNinjaCatalog({
        bytes,
        publisher: "daedlo",
        trustedKeys: t.keys,
        now: s.now,
        previousState: p.verified.checkpoint,
      });
    checked.push({ path: name, bytes: file.bytes, sha256: file.sha256 });
  }
  for (const path of PRIVATE_PATHS)
    await fetchBytes(ORIGIN + path, s, { status: 404, maximum: 1024 * 1024 });
  return {
    schemaVersion: 1,
    status: "PASS",
    generation: p.receipt.generation,
    catalogSha256: p.receipt.catalogSha256,
    servedAssets: checked.length,
    privateBoundaries: PRIVATE_PATHS.length,
    assets: checked,
  };
}
export async function runNinjaRenewCli(args = process.argv.slice(2)) {
  const command = args.shift();
  if (!["prepare", "verify", "live"].includes(command))
    fail(
      "Usage: ninja-renew.mjs prepare --private-key ABS --output FRESH_ABS [--checkpoint FILE] | verify|live --output ABS",
    );
  const allowed =
    command === "prepare"
      ? ["--private-key", "--output", "--checkpoint"]
      : ["--output"];
  const parsed = {};
  while (args.length) {
    const key = args.shift(),
      value = args.shift();
    if (!allowed.includes(key) || !value || Object.hasOwn(parsed, key))
      fail("Invalid renewal CLI arguments");
    parsed[key] = value;
  }
  if (
    !parsed["--output"] ||
    (command === "prepare" && !parsed["--private-key"])
  )
    fail("Missing required renewal CLI argument");
  const input = {
    output: parsed["--output"],
    privateKeyPath: parsed["--private-key"],
    checkpointPath: parsed["--checkpoint"],
  };
  const result = await (
    command === "prepare"
      ? prepareNinjaRenewal
      : command === "verify"
        ? verifyNinjaRenewal
        : verifyLiveNinjaRenewal
  )(input);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  runNinjaRenewCli().catch((e) => {
    process.stderr.write(e.message + "\n");
    process.exitCode = 1;
  });
