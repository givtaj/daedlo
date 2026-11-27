import { releaseNames } from "./names.mjs";
/** Authenticated public-kit provider, independent of archive selection and activation.
 * No package code, customer factory, install script or application command is run.
 * The caller configures publisher/trust roots, persists checkpoint after verified
 * discovery (including no-update results), and owns compatibility/activation policy.
 * Component tarballs remain opaque authenticated bytes for the isolated installer.
 */
import fs from "node:fs/promises";
import { createPublicKey, verify as verifySignature } from "node:crypto";
import { basename, dirname, join, parse, resolve, sep } from "node:path";
import { inflateRawSync } from "node:zlib";
import { isDeepStrictEqual } from "node:util";
import { sha256, verifyBundle } from "./manifest.mjs";

const MAX_CATALOG = 1024 * 1024;
const MAX_METADATA = 2 * 1024 * 1024;
const MAX_ARCHIVE = 128 * 1024 * 1024;
const MAX_VALIDITY = 7 * 24 * 60 * 60 * 1000;
const verifiedCatalogs = new WeakSet();
const digestPattern = /^[a-f0-9]{64}$/;
const contractNames = [
  "manager",
  "launcher",
  "nodeAdapter",
  "rustModel",
  "protocol",
];
const notices = [
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "licenses/Apache-2.0.txt",
  "licenses/MIT-legacy.txt",
];
function fail(message) {
  throw new Error(message);
}
function fields(value, required, optional = []) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    required.some((k) => !Object.hasOwn(value, k)) ||
    Object.keys(value).some((k) => ![...required, ...optional].includes(k))
  )
    fail("Invalid schema fields");
}
function integer(value, maximum = Number.MAX_SAFE_INTEGER, minimum = 1) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    fail("Invalid bounded integer");
}
function text(value, maximum = 128) {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > maximum ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    fail("Invalid bounded text");
}
function digest(value) {
  if (typeof value !== "string" || !digestPattern.test(value))
    fail("Invalid SHA256 digest");
}
function json(bytes, label, limit) {
  if (!Buffer.isBuffer(bytes) || bytes.length > limit)
    fail(`${label} exceeds size limit`);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(`Invalid ${label} JSON`);
  }
}
function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value))
    return String(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (
    value &&
    typeof value === "object" &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  fail("Catalog signing input must contain only JSON values and safe integers");
}
/** Domain-separated canonical bytes for an offline publisher or local test signer. */
export function ninjaCatalogSigningBytes(signed) {
  return Buffer.from(`daedlo-public-kit-catalog/v1\n${canonical(signed)}`);
}
function frozen(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}
function versionParts(value) {
  text(value);
  const match = value.match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/,
  );
  if (
    !match ||
    match[4]
      ?.split(".")
      .some((v) => /^\d+$/.test(v) && v.length > 1 && v.startsWith("0"))
  )
    fail("Invalid release version");
  return {
    core: match.slice(1, 4).map(BigInt),
    preview: match[4]?.split(".") || [],
  };
}
function compare(left, right) {
  const a = versionParts(left),
    b = versionParts(right);
  for (let i = 0; i < 3; i++)
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1;
  if (!a.preview.length || !b.preview.length)
    return Number(!a.preview.length) - Number(!b.preview.length);
  for (let i = 0; i < Math.max(a.preview.length, b.preview.length); i++) {
    const x = a.preview[i],
      y = b.preview[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const nx = /^\d+$/.test(x),
      ny = /^\d+$/.test(y);
    if (nx && ny) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (nx !== ny) return nx ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}
function httpsUrl(value) {
  text(value, 2048);
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("Invalid HTTPS URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    /%|\\/.test(url.pathname)
  )
    fail("Unsupported or unsafe HTTPS URL");
  return url;
}
function platformValue(value) {
  fields(value, ["os", "arch"]);
  if (
    !["darwin", "linux", "win32"].includes(value.os) ||
    !["arm64", "x64"].includes(value.arch)
  )
    fail("Invalid platform");
}
function contractValue(value) {
  fields(value, [...contractNames, "capabilities"]);
  for (const key of contractNames) integer(value[key], 100000);
  if (
    !Array.isArray(value.capabilities) ||
    value.capabilities.length > 64 ||
    new Set(value.capabilities).size !== value.capabilities.length
  )
    fail("Invalid contract capabilities");
  for (const c of value.capabilities) {
    text(c, 64);
    if (!/^[A-Za-z][A-Za-z0-9._:-]*$/.test(c)) fail("Invalid capability");
  }
}
function assetValue(asset, maximum, file) {
  fields(asset, ["url", "bytes", "sha256"]);
  const u = httpsUrl(asset.url);
  integer(asset.bytes, maximum);
  digest(asset.sha256);
  if (basename(u.pathname) !== file) fail("Release URL filename mismatch");
  return u;
}
function validateRelease(release) {
  fields(release, [
    "version",
    "channel",
    "platforms",
    "contracts",
    "notesUrl",
    "kit",
    "metadata",
    "checksums",
  ]);
  const v = versionParts(release.version);
  if (
    !["stable", "preview"].includes(release.channel) ||
    (release.channel === "stable" && v.preview.length)
  )
    fail("Invalid channel or prerelease assignment");
  if (
    !Array.isArray(release.platforms) ||
    !release.platforms.length ||
    release.platforms.length > 6
  )
    fail("Invalid platform inventory");
  const platforms = new Set();
  for (const p of release.platforms) {
    platformValue(p);
    const id = `${p.os}/${p.arch}`;
    if (platforms.has(id)) fail("Duplicate platform");
    platforms.add(id);
  }
  contractValue(release.contracts);
  httpsUrl(release.notesUrl);
  const urls = [
    assetValue(release.kit, MAX_ARCHIVE, `daedlo-${release.version}.zip`),
    assetValue(release.metadata, MAX_METADATA, "release.json"),
    assetValue(release.checksums, 4096, "SHA256SUMS"),
  ];
  if (
    urls.some(
      (u) =>
        u.origin !== urls[0].origin ||
        dirname(u.pathname) !== dirname(urls[0].pathname),
    )
  )
    fail("Release files must share one origin and directory");
}
function timestamp(value) {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    fail("Invalid catalog timestamp");
  return Date.parse(value);
}
/** Verify an envelope against configured Ed25519 keys. Checkpoint is caller-owned.
 * Same-generation identical content is idempotent; older/conflicting content fails.
 * maxValidityMs may tighten, never relax, the seven-day validity ceiling.
 */
export function verifyNinjaCatalog({
  bytes,
  trustedKeys,
  publisher,
  now = Date.now(),
  previousState = null,
  maxValidityMs = MAX_VALIDITY,
}) {
  const envelope = json(bytes, "catalog", MAX_CATALOG);
  fields(envelope, ["schemaVersion", "kind", "signed", "signature"]);
  if (envelope.schemaVersion !== 1 || envelope.kind !== "daedlo-signed-catalog")
    fail("Unsupported catalog envelope schema");
  fields(envelope.signature, ["keyId", "value"]);
  text(envelope.signature.keyId, 64);
  if (
    !Array.isArray(trustedKeys) ||
    !trustedKeys.length ||
    trustedKeys.length > 32
  )
    fail("No configured trusted catalog keys");
  const ids = new Set();
  let selected;
  for (const k of trustedKeys) {
    fields(k, ["id", "publicKey"]);
    text(k.id, 64);
    if (ids.has(k.id)) fail("Duplicate trusted key");
    ids.add(k.id);
    if (k.id === envelope.signature.keyId) selected = k;
  }
  if (!selected) fail("Catalog signing key is not trusted");
  let key;
  try {
    key =
      selected.publicKey?.type === "public"
        ? selected.publicKey
        : createPublicKey(selected.publicKey);
  } catch {
    fail("Invalid trusted public key");
  }
  if (key.asymmetricKeyType !== "ed25519")
    fail("Trusted catalog keys must use Ed25519");
  const sig = envelope.signature.value;
  if (typeof sig !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(sig))
    fail("Invalid Ed25519 signature encoding");
  const signature = Buffer.from(sig, "base64");
  if (signature.length !== 64 || signature.toString("base64") !== sig)
    fail("Invalid Ed25519 signature");
  const signingBytes = ninjaCatalogSigningBytes(envelope.signed);
  if (!verifySignature(null, signingBytes, key, signature))
    fail("Catalog signature verification failed");
  const catalog = envelope.signed;
  fields(catalog, [
    "schemaVersion",
    "kind",
    "publisher",
    "generation",
    "issuedAt",
    "expiresAt",
    "releases",
  ]);
  if (
    catalog.schemaVersion !== 1 ||
    catalog.kind !== "daedlo-public-kit-catalog"
  )
    fail("Unsupported catalog schema");
  text(publisher);
  if (catalog.publisher !== publisher)
    fail("Catalog publisher does not match configured trust");
  integer(catalog.generation);
  if (!Number.isFinite(now)) fail("Invalid verification clock");
  integer(maxValidityMs, MAX_VALIDITY);
  const issued = timestamp(catalog.issuedAt),
    expires = timestamp(catalog.expiresAt);
  if (issued > now + 5 * 60 * 1000) fail("Catalog issuance is in the future");
  if (expires <= issued || expires - issued > maxValidityMs)
    fail("Catalog validity exceeds allowed expiry policy");
  if (expires <= now) fail("Catalog expired");
  if (!Array.isArray(catalog.releases) || catalog.releases.length > 128)
    fail("Invalid release inventory");
  const versions = new Set();
  for (const r of catalog.releases) {
    validateRelease(r);
    if (versions.has(r.version)) fail("Duplicate release version");
    versions.add(r.version);
  }
  const catalogSha256 = sha256(signingBytes);
  if (previousState !== null) {
    fields(previousState, ["generation", "sha256"]);
    integer(previousState.generation);
    digest(previousState.sha256);
    if (catalog.generation < previousState.generation)
      fail("Catalog replay: older generation");
    if (
      catalog.generation === previousState.generation &&
      catalogSha256 !== previousState.sha256
    )
      fail("Catalog generation equivocation");
  }
  const result = frozen({
    catalog,
    catalogSha256,
    checkpoint: { generation: catalog.generation, sha256: catalogSha256 },
  });
  verifiedCatalogs.add(result);
  return result;
}
function requireVerified(value) {
  if (!verifiedCatalogs.has(value))
    fail("A verified catalog result is required");
}
function compatibility(release, platform, contracts) {
  const reasons = [];
  if (
    !release.platforms.some(
      (p) => p.os === platform.os && p.arch === platform.arch,
    )
  )
    reasons.push("platform");
  for (const name of contractNames) {
    // Manager 2 can recover immutable legacy slots as well as renamed kits.
    // Other managed interfaces remain exact; future manager versions fail closed.
    const supported =
      name === "manager" && contracts.manager === 2
        ? [1, 2].includes(release.contracts.manager)
        : release.contracts[name] === contracts[name];
    if (!supported) reasons.push(`contracts.${name}`);
  }
  for (const c of contracts.capabilities)
    if (!release.contracts.capabilities.includes(c))
      reasons.push(`capability.${c}`);
  return reasons;
}
/** Discovery compatibility is declaration-only, never customer application acceptance. */
export function selectNinjaRelease(
  verified,
  { channel, platform, currentVersion, contracts },
) {
  requireVerified(verified);
  if (!["stable", "preview"].includes(channel))
    fail("Explicit stable or preview channel required");
  platformValue(platform);
  contractValue(contracts);
  versionParts(currentVersion);
  const candidates = verified.catalog.releases
    .filter(
      (r) =>
        (channel === "preview" || r.channel === "stable") &&
        compare(r.version, currentVersion) > 0,
    )
    .sort((a, b) => compare(b.version, a.version));
  for (const release of candidates)
    if (!compatibility(release, platform, contracts).length)
      return frozen({
        status: "update_available",
        release,
        compatibility: "declared_only",
        applicationAcceptance: "not_checked",
      });
  return candidates.length
    ? frozen({
        status: "incompatible",
        release: candidates[0],
        reasons: compatibility(candidates[0], platform, contracts),
        applicationAcceptance: "not_checked",
      })
    : frozen({ status: "up_to_date", applicationAcceptance: "not_checked" });
}
async function boundedGet(url, maximum, fetchImpl) {
  httpsUrl(url);
  const response = await fetchImpl(url, {
    method: "GET",
    redirect: "error",
    credentials: "omit",
    signal: AbortSignal.timeout(15000),
    headers: { Accept: "application/octet-stream" },
  });
  if (
    !response ||
    response.status !== 200 ||
    response.redirected ||
    (response.url && response.url !== url)
  )
    fail("Unexpected HTTP response or redirect");
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > maximum)
  )
    fail("Response size exceeds limit");
  if (!response.body?.getReader) fail("Response has no bounded readable body");
  const reader = response.body.getReader();
  let total = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) fail("Response exceeds size limit");
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (declared !== null && Number(declared) !== total)
    fail("Response length mismatch");
  return Buffer.concat(chunks, total);
}
/** An absent feed is a configuration state, never evidence of being up to date. */
export async function fetchNinjaCatalog({
  url,
  fetchImpl = fetch,
  ...verification
}) {
  if (url === undefined || url === null || url === "")
    return frozen({
      status: "unconfigured",
      reason: "publisher_feed_unconfigured",
    });
  return verifyNinjaCatalog({
    ...verification,
    bytes: await boundedGet(url, MAX_CATALOG, fetchImpl),
  });
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function safeName(name) {
  if (
    !/^[A-Za-z0-9._/-]+$/.test(name) ||
    name.startsWith("/") ||
    name.split("/").some((p) => !p || p === "." || p === "..")
  )
    fail("Unsafe ZIP entry path");
}
// ZIP32 only, no data descriptors, comments, encryption, extra fields or links.
// Current curated public kits use this bounded regular-file representation.
function readZip(bytes) {
  if (bytes.length < 22) fail("Invalid ZIP archive");
  const end = bytes.length - 22;
  if (
    bytes.readUInt32LE(end) !== 0x06054b50 ||
    bytes.readUInt16LE(end + 20) !== 0 ||
    bytes.readUInt16LE(end + 4) !== 0 ||
    bytes.readUInt16LE(end + 6) !== 0
  )
    fail("Unsupported ZIP archive structure");
  const count = bytes.readUInt16LE(end + 10),
    size = bytes.readUInt32LE(end + 12),
    start = bytes.readUInt32LE(end + 16);
  if (
    !count ||
    count > 256 ||
    bytes.readUInt16LE(end + 8) !== count ||
    start + size !== end
  )
    fail("Invalid ZIP central inventory");
  const result = new Map();
  let offset = start,
    localEnd = 0,
    total = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50)
      fail("Invalid ZIP entry");
    const flags = bytes.readUInt16LE(offset + 8),
      method = bytes.readUInt16LE(offset + 10),
      crc = bytes.readUInt32LE(offset + 16),
      packed = bytes.readUInt32LE(offset + 20),
      expanded = bytes.readUInt32LE(offset + 24),
      nameLength = bytes.readUInt16LE(offset + 28),
      extra = bytes.readUInt16LE(offset + 30),
      comment = bytes.readUInt16LE(offset + 32),
      disk = bytes.readUInt16LE(offset + 34),
      attributes = bytes.readUInt32LE(offset + 38),
      local = bytes.readUInt32LE(offset + 42);
    if (
      (flags !== 0 && flags !== 0x800) ||
      ![0, 8].includes(method) ||
      extra ||
      comment ||
      disk ||
      offset + 46 + nameLength > end ||
      expanded > 64 * 1024 * 1024 ||
      packed > MAX_ARCHIVE
    )
      fail("Unsupported ZIP entry encoding or size");
    const mode = attributes >>> 16;
    if ((mode & 0o170000) !== 0o100000 || mode & 0o7000 || attributes & 0x10)
      fail("ZIP entry must be a regular file without links");
    const name = bytes
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf8");
    safeName(name);
    if (result.has(name)) fail("Duplicate ZIP entry");
    if (
      local !== localEnd ||
      local + 30 > start ||
      bytes.readUInt32LE(local) !== 0x04034b50 ||
      bytes.readUInt16LE(local + 6) !== flags ||
      bytes.readUInt16LE(local + 8) !== method ||
      bytes.readUInt32LE(local + 14) !== crc ||
      bytes.readUInt32LE(local + 18) !== packed ||
      bytes.readUInt32LE(local + 22) !== expanded ||
      bytes.readUInt16LE(local + 26) !== nameLength ||
      bytes.readUInt16LE(local + 28) !== 0
    )
      fail("ZIP local header mismatch");
    const dataStart = local + 30 + nameLength;
    if (
      dataStart + packed > start ||
      !bytes
        .subarray(local + 30, dataStart)
        .equals(bytes.subarray(offset + 46, offset + 46 + nameLength))
    )
      fail("ZIP entry name or bounds mismatch");
    total += expanded;
    if (total > MAX_ARCHIVE) fail("ZIP expanded size limit exceeded");
    let data;
    try {
      data =
        method === 0
          ? bytes.subarray(dataStart, dataStart + packed)
          : inflateRawSync(bytes.subarray(dataStart, dataStart + packed), {
              maxOutputLength: Math.max(1, expanded),
            });
    } catch {
      fail("Invalid compressed ZIP entry");
    }
    if (data.length !== expanded || crc32(data) !== crc)
      fail("ZIP entry size or CRC mismatch");
    result.set(name, data);
    localEnd = dataStart + packed;
    offset += 46 + nameLength;
  }
  if (offset !== end || localEnd !== start) fail("Unexpected ZIP archive data");
  return result;
}
function same(a, b, message) {
  if (!isDeepStrictEqual(a, b)) fail(message);
}
function validateKit(entry, files) {
  const m = json(files.metadata, "public kit metadata", MAX_METADATA);
  fields(
    m,
    [
      "schemaVersion",
      "kind",
      "version",
      "archive",
      "source",
      "bundle",
      "tools",
      "license",
      "files",
    ],
    ["verification"],
  );
  if (
    m.schemaVersion !== 1 ||
    m.kind !== "daedlo-public-kit" ||
    m.version !== entry.version
  )
    fail("Public kit schema or version mismatch");
  fields(m.archive, ["file", "bytes", "sha256"]);
  same(
    m.archive,
    {
      file: `daedlo-${entry.version}.zip`,
      bytes: files.zip.length,
      sha256: sha256(files.zip),
    },
    "Public kit archive identity mismatch",
  );
  fields(m.source, ["commit", "dirty", "treeSha256"]);
  if (!/^[a-f0-9]{40}$/.test(m.source.commit) || m.source.dirty !== false)
    fail("Public update requires a clean source identity");
  digest(m.source.treeSha256);
  fields(m.bundle, ["manifest", "manifestSha256", "artifacts"]);
  if (m.bundle.manifest !== "bundle/manifest.json")
    fail("Invalid inner manifest path");
  digest(m.bundle.manifestSha256);
  fields(m.tools, ["file", "bytes", "sha256"]);
  integer(m.tools.bytes, 64 * 1024 * 1024);
  digest(m.tools.sha256);
  const names = releaseNames(m.bundle.artifacts);
  const toolsFile = `${names.prefix}-tools-${entry.version}.tgz`;
  if (m.tools.file !== `tools/${toolsFile}`)
    fail("Invalid tools archive identity");
  if (
    files.checksums.toString("utf8") !==
    `${entry.kit.sha256}  daedlo-${entry.version}.zip\n`
  )
    fail("Public ZIP checksum inventory mismatch");
  const content = readZip(files.zip),
    prefix = `daedlo-${entry.version}/`;
  const expected = [
    ...notices,
    "START_HERE.md",
    "AGENT_START.md",
    "bundle/manifest.json",
    "bundle/SHA256SUMS",
    `bundle/${names.prefix}-runtime-${entry.version}.tgz`,
    `bundle/${names.engine}-${entry.version}.crate`,
    `tools/${toolsFile}`,
    "tools/TOOLS_VERIFICATION.json",
    "tools/TOOLS_SHA256SUMS",
  ]
    .map((p) => prefix + p)
    .sort();
  same(
    [...content.keys()].sort(),
    expected,
    "Public ZIP inventory must contain exactly the curated kit files",
  );
  if (!Array.isArray(m.files) || m.files.length !== expected.length)
    fail("Invalid public metadata file inventory");
  const seen = new Set();
  for (const f of m.files) {
    fields(f, ["file", "bytes", "sha256"]);
    if (seen.has(f.file) || !content.has(f.file))
      fail("Invalid or duplicate metadata file inventory");
    seen.add(f.file);
    integer(f.bytes, MAX_ARCHIVE, 0);
    digest(f.sha256);
    const actual = content.get(f.file);
    if (actual.length !== f.bytes || sha256(actual) !== f.sha256)
      fail("Public ZIP file inventory checksum mismatch");
  }
  const read = (name) => content.get(prefix + name);
  if (sha256(read("bundle/manifest.json")) !== m.bundle.manifestSha256)
    fail("Inner manifest digest mismatch");
  if (
    sha256(read(m.tools.file)) !== m.tools.sha256 ||
    read(m.tools.file).length !== m.tools.bytes
  )
    fail("Tools archive digest mismatch");
  const inner = json(read("bundle/manifest.json"), "inner manifest", 64 * 1024);
  same(inner.source, m.source, "Inner bundle source mismatch");
  same(inner.artifacts, m.bundle.artifacts, "Inner bundle artifacts mismatch");
  if (inner.version !== m.version) fail("Inner bundle version mismatch");
  const toolsReceipt = json(
    read("tools/TOOLS_VERIFICATION.json"),
    "tools receipt",
    MAX_METADATA,
  );
  if (
    toolsReceipt.schemaVersion !== 1 ||
    toolsReceipt.kind !== "browser-driver-release-tools" ||
    toolsReceipt.name !== names.tools ||
    toolsReceipt.version !== m.version
  )
    fail("Tools receipt identity mismatch");
  same(toolsReceipt.source, m.source, "Tools source identity mismatch");
  same(
    toolsReceipt.archive,
    { file: toolsFile, bytes: m.tools.bytes, sha256: m.tools.sha256 },
    "Tools receipt archive mismatch",
  );
  if (
    read("tools/TOOLS_SHA256SUMS").toString("utf8") !==
    `${m.tools.sha256}  ${toolsFile}\n${sha256(read("tools/TOOLS_VERIFICATION.json"))}  TOOLS_VERIFICATION.json\n`
  )
    fail("Tools checksum inventory mismatch");
  fields(m.license, ["terms", "files"]);
  text(m.license.terms, 512);
  if (
    !Array.isArray(m.license.files) ||
    m.license.files.length !== notices.length
  )
    fail("Invalid license inventory");
  const licenseNames = [];
  for (const f of m.license.files) {
    fields(f, ["file", "sha256"]);
    if (!notices.includes(f.file) || sha256(read(f.file)) !== f.sha256)
      fail("License file digest mismatch");
    licenseNames.push(f.file);
  }
  same(
    licenseNames.sort(),
    [...notices].sort(),
    "Invalid license file inventory",
  );
  return { metadata: m, content, prefix };
}
async function lstat(path) {
  try {
    return await fs.lstat(path);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
async function outputPath(input) {
  if (
    typeof input !== "string" ||
    !input ||
    input.includes("\0") ||
    input.split(/[\\/]/).includes("..")
  )
    fail("Explicit fresh output path required");
  const path = resolve(input),
    root = parse(path).root;
  let at = root;
  if (path === root) fail("Output already exists");
  for (const part of path.slice(root.length).split(sep).filter(Boolean)) {
    at = join(at, part);
    const s = await lstat(at);
    if (s?.isSymbolicLink()) fail("Output paths cannot contain symlinks");
    if (at === path) {
      if (s) fail("Output destination already exists");
    } else if (!s?.isDirectory()) fail("Output parent must exist");
  }
  return path;
}
function owns(before, after) {
  return (
    before &&
    after &&
    before.dev === after.dev &&
    before.ino === after.ino &&
    after.isDirectory() &&
    !after.isSymbolicLink()
  );
}
/** Download authenticated ZIP + metadata + checksum; extract to fresh owned output.
 * Returns kitPath (extracted root), bundlePath and toolsPath (directories), metadata,
 * and exact identity. Does not install nested tarballs, run code or change a pin.
 * allowedOrigin is an explicit configured HTTPS origin, not a value from the feed.
 */
export async function downloadNinjaKit({
  verified,
  version,
  output,
  allowedOrigin,
  fetchImpl = fetch,
  now = Date.now(),
}) {
  requireVerified(verified);
  versionParts(version);
  if (!Number.isFinite(now) || timestamp(verified.catalog.expiresAt) <= now)
    fail("Verified catalog expired before download");
  const entry = verified.catalog.releases.find((r) => r.version === version);
  if (!entry) fail("Selected release is absent from verified catalog");
  if (httpsUrl(allowedOrigin).origin !== allowedOrigin)
    fail("Configured allowed origin must be an HTTPS origin");
  for (const a of [entry.kit, entry.metadata, entry.checksums])
    if (new URL(a.url).origin !== allowedOrigin)
      fail("Release URL is outside the configured origin");
  const destination = await outputPath(output),
    parent = dirname(destination),
    parentIdentity = await fs.lstat(parent);
  const files = {};
  for (const [name, a] of [
    ["metadata", entry.metadata],
    ["checksums", entry.checksums],
    ["zip", entry.kit],
  ]) {
    const bytes = await boundedGet(a.url, a.bytes, fetchImpl);
    if (bytes.length !== a.bytes || sha256(bytes) !== a.sha256)
      fail("Downloaded public kit digest or size mismatch");
    files[name] = bytes;
  }
  const { metadata, content, prefix } = validateKit(entry, files);
  await outputPath(destination);
  if (!owns(parentIdentity, await lstat(parent)))
    fail("Output parent ownership changed");
  const stage = await fs.mkdtemp(join(parent, ".ninja-download-")),
    stageIdentity = await fs.lstat(stage);
  let reservation;
  try {
    for (const [name, bytes] of [
      [metadata.archive.file, files.zip],
      ["release.json", files.metadata],
      ["SHA256SUMS", files.checksums],
      ...content,
    ]) {
      if (!owns(stageIdentity, await lstat(stage)))
        fail("Download staging ownership changed");
      const path = join(stage, name);
      await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await fs.writeFile(path, bytes, { flag: "wx", mode: 0o600 });
    }
    const kit = join(stage, prefix.slice(0, -1));
    const inner = await verifyBundle(join(kit, "bundle"), {
      expectedManifestSha256: metadata.bundle.manifestSha256,
    });
    if (
      inner.manifest.version !== version ||
      inner.manifest.source.dirty !== false
    )
      fail("Verified inner bundle identity mismatch");
    await outputPath(destination);
    if (
      !owns(parentIdentity, await lstat(parent)) ||
      !owns(stageIdentity, await lstat(stage))
    )
      fail("Download ownership changed before publication");
    await fs.mkdir(destination, { mode: 0o700 });
    reservation = await fs.lstat(destination);
    if (!owns(reservation, await lstat(destination)))
      fail("Output reservation ownership changed");
    await fs.rename(stage, destination);
    reservation = null;
    const kitPath = join(destination, prefix.slice(0, -1));
    return frozen({
      kitPath,
      bundlePath: join(kitPath, "bundle"),
      toolsPath: join(kitPath, "tools"),
      metadata,
      identity: {
        version,
        source: metadata.source,
        manifestSha256: metadata.bundle.manifestSha256,
        archiveSha256: entry.kit.sha256,
        metadataSha256: entry.metadata.sha256,
        contracts: entry.contracts,
        catalogGeneration: verified.catalog.generation,
        catalogSha256: verified.catalogSha256,
      },
    });
  } catch (error) {
    const retained = [];
    for (const [path, identity, recursive] of [
      [destination, reservation, false],
      [stage, stageIdentity, true],
    ]) {
      if (!identity) continue;
      try {
        const current = await lstat(path);
        if (!current) continue;
        if (!owns(identity, current))
          fail("Download ownership changed; retained");
        if (recursive) await fs.rm(path, { recursive: true });
        else await fs.rmdir(path);
      } catch {
        retained.push(path);
      }
    }
    if (retained.length)
      Object.assign(error, { cleanupFailed: true, retainedPaths: retained });
    throw error;
  }
}
