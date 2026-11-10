#!/usr/bin/env node
/** Offline catalog authoring only. This module never generates keys, accesses the
 * network, deploys files, or changes installed trust. Public trust metadata is an
 * out-of-band distribution aid, not self-authenticating trust-on-first-use.
 *
 * Sign: node ninja-publisher.mjs sign --config /absolute/config.json
 * Renew: supply the latest published catalog as previousCatalogPath, strictly
 * increase generation, and choose fresh issuedAt/expiresAt (at most seven days).
 * Use a fresh output directory per generation. Existing release entries are
 * immutable and retained; adding a new kit requires a new version. An expired
 * previous catalog may authenticate historical identity for renewal, but the
 * newly produced catalog must pass the consumer's current-clock expiry checks.
 * No renewal schedule is installed. Publisher private keys stay outside Git,
 * public-kit directories and output; this tool reads an explicit existing key.
 */
import fs from "node:fs/promises";
import { constants } from "node:fs";
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  resolve,
  sep,
} from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { sha256 } from "./manifest.mjs";
import { releaseNames } from "./names.mjs";
import {
  ninjaCatalogSigningBytes,
  compareNinjaVersions,
  verifyNinjaCatalog,
  downloadNinjaKit,
} from "./ninja-catalog.mjs";

const LIMITS = {
  catalog: 1024 * 1024,
  metadata: 2 * 1024 * 1024,
  zip: 128 * 1024 * 1024,
  total: 256 * 1024 * 1024,
};
const required = [
  "schemaVersion",
  "publisher",
  "keyId",
  "privateKeyPath",
  "generation",
  "issuedAt",
  "expiresAt",
  "origin",
  "catalogUrl",
  "notesUrl",
  "channel",
  "platforms",
  "contracts",
  "kitDirectories",
  "output",
];
const optional = [
  "previousCatalogPath",
  "previousTrustedKeys",
  "releaseContracts",
];
function fail(message) {
  throw Error(message);
}
function fields(value, keys, extra = []) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    keys.some((k) => !Object.hasOwn(value, k)) ||
    Object.keys(value).some((k) => ![...keys, ...extra].includes(k))
  )
    fail("Invalid publisher configuration fields");
}
function label(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)
  )
    fail("Invalid publisher or key identifier");
}
function webUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("Invalid HTTPS URL");
  }
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /[%\\\x00-\x20]/.test(value) ||
    url.href !== value
  )
    fail("Unsupported HTTPS URL or query");
  return url;
}
async function stat(path) {
  try {
    return await fs.lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function pathValue(value, { fresh = false, directory = false } = {}) {
  if (
    typeof value !== "string" ||
    !isAbsolute(value) ||
    value.includes("\0") ||
    value.split(/[\\/]/).includes("..")
  )
    fail("An explicit absolute filesystem path is required");
  const path = resolve(value),
    base = parse(path).root;
  let at = base;
  for (const part of path.slice(base.length).split(sep).filter(Boolean)) {
    at = join(at, part);
    const info = await stat(at);
    if (info?.isSymbolicLink()) fail("Publisher paths cannot contain symlinks");
    if (at !== path) {
      if (!info?.isDirectory()) fail("Publisher parent directory must exist");
    } else if (fresh) {
      if (info) fail("Publisher output already exists");
    } else if (
      !info ||
      (directory && !info.isDirectory()) ||
      (!directory && !info.isFile())
    )
      fail("Expected regular publisher input file or directory");
  }
  if (fresh && path === base) fail("Publisher output already exists");
  return path;
}
function sameIdentity(a, b) {
  return a && b && a.dev === b.dev && a.ino === b.ino && !b.isSymbolicLink();
}
async function regular(value, maximum, { privateKey = false } = {}) {
  const path = await pathValue(value),
    before = await fs.lstat(path);
  if (before.size < 1 || before.size > maximum)
    fail("Publisher input exceeds its bounded size");
  if (
    privateKey &&
    ((before.mode & 0o077) !== 0 ||
      before.nlink !== 1 ||
      (process.getuid && before.uid !== process.getuid()))
  )
    fail(
      "Signing private key requires owner-only permissions and no hard links",
    );
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const actual = await handle.stat();
    if (
      !actual.isFile() ||
      !sameIdentity(before, actual) ||
      actual.size !== before.size ||
      (privateKey && ((actual.mode & 0o077) !== 0 || actual.nlink !== 1))
    )
      fail("Publisher input ownership changed");
    const bytes = await handle.readFile();
    if (bytes.length !== actual.size || bytes.length > maximum)
      fail("Publisher input changed while reading");
    return { path, bytes, identity: actual };
  } finally {
    await handle.close();
  }
}
function parseJson(bytes, name) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(`Invalid ${name} JSON`);
  }
}
async function signingKey(privateKeyPath, keyId) {
  label(keyId);
  const input = await regular(privateKeyPath, 16 * 1024, { privateKey: true });
  let key;
  try {
    key = createPrivateKey(input.bytes);
  } catch {
    fail(
      "Cannot parse the signing private key; use an unencrypted Ed25519 PKCS8 key",
    );
  } finally {
    input.bytes.fill(0);
  }
  if (key.asymmetricKeyType !== "ed25519")
    fail("Publisher signing key must use Ed25519");
  const publicKey = createPublicKey(key),
    der = publicKey.export({ format: "der", type: "spki" });
  return {
    key,
    publicKey,
    public: {
      id: keyId,
      algorithm: "Ed25519",
      publicKeyPem: publicKey.export({ format: "pem", type: "spki" }),
      spkiSha256: sha256(der),
    },
  };
}
/** Return public material only. Neither the private bytes nor key path is returned. */
export async function inspectPublisherKey({ privateKeyPath, keyId }) {
  return Object.freeze((await signingKey(privateKeyPath, keyId)).public);
}
function iso(value) {
  const time = Date.parse(value);
  if (
    typeof value !== "string" ||
    !Number.isFinite(time) ||
    new Date(time).toISOString() !== value
  )
    fail("Publisher timestamps must be canonical UTC ISO strings");
  return time;
}
async function previous(config, currentKey, now) {
  if (config.generation === 1) {
    if (
      config.previousCatalogPath !== undefined ||
      config.previousTrustedKeys !== undefined
    )
      fail("Initial generation cannot include a previous catalog");
    return null;
  }
  if (!config.previousCatalogPath)
    fail("Renewal requires the previous published catalog explicitly");
  const input = await regular(config.previousCatalogPath, LIMITS.catalog);
  const envelope = parseJson(input.bytes, "previous catalog");
  const issued = iso(envelope.signed?.issuedAt),
    expires = iso(envelope.signed?.expiresAt);
  if (issued > now) fail("Previous catalog issuance is in the future");
  const trustedKeys = [{ id: config.keyId, publicKey: currentKey }];
  if (config.previousTrustedKeys !== undefined) {
    if (
      !Array.isArray(config.previousTrustedKeys) ||
      config.previousTrustedKeys.length > 31
    )
      fail("Invalid previous trusted key inventory");
    for (const old of config.previousTrustedKeys) {
      fields(old, ["id", "publicKeyPath"]);
      label(old.id);
      const bytes = (await regular(old.publicKeyPath, 16 * 1024)).bytes;
      if (!bytes.toString("utf8").startsWith("-----BEGIN PUBLIC KEY-----"))
        fail("Previous trust requires a public PEM key");
      let key;
      try {
        key = createPublicKey(bytes);
      } catch {
        fail("Invalid previous public trust key");
      }
      trustedKeys.push({ id: old.id, publicKey: key });
    }
  }
  // Authenticate historical metadata at a point inside its original validity.
  // This is issuer-only renewal verification, never consumer expiry relaxation.
  const value = verifyNinjaCatalog({
    bytes: input.bytes,
    publisher: config.publisher,
    trustedKeys,
    now: Math.min(now, expires - 1),
  });
  if (config.generation <= value.catalog.generation)
    fail("Renewal generation must be strictly newer than previous catalog");
  if (iso(config.issuedAt) < issued)
    fail("Renewal issuance cannot precede the previous catalog");
  return value;
}
async function removeOwned(path, identity, error) {
  try {
    const current = await stat(path);
    if (!current) return;
    if (!sameIdentity(identity, current) || !current.isDirectory())
      fail("Owned publisher staging was replaced");
    await fs.rm(path, { recursive: true });
  } catch {
    error.cleanupFailed = true;
    error.retainedPaths = [...(error.retainedPaths ?? []), path];
  }
}
/** Prepare a fresh public output directory; do not deploy it. Config is explicit
 * trusted local input. Existing published entries cannot change or disappear on
 * renewal. previousTrustedKeys permits deliberate signing-key rotation while
 * authenticating the previous catalog; clients must receive new trust out of band.
 */
export async function publishNinjaCatalog(config, { now = Date.now() } = {}) {
  fields(config, required, optional);
  if (config.schemaVersion !== 1)
    fail("Unsupported publisher configuration schema");
  label(config.publisher);
  label(config.keyId);
  if (!Number.isSafeInteger(config.generation) || config.generation < 1)
    fail("Invalid catalog generation");
  if (!Number.isFinite(now)) fail("Invalid publication clock");
  const issued = iso(config.issuedAt),
    expires = iso(config.expiresAt);
  if (issued > now) fail("Catalog issuance cannot be in the future");
  if (expires <= now) fail("New catalog is expired");
  if (expires <= issued || expires - issued > 7 * 86400000)
    fail("Catalog validity must be positive and at most seven days");
  const origin = webUrl(config.origin + "/").origin;
  if (origin !== config.origin)
    fail("Publisher origin must be one fixed HTTPS origin");
  const catalogUrl = webUrl(config.catalogUrl),
    notesUrl = webUrl(config.notesUrl);
  if (catalogUrl.origin !== origin || notesUrl.origin !== origin)
    fail("Catalog and notes URLs must use the configured origin");
  const catalogFile = basename(catalogUrl.pathname);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(catalogFile) ||
    catalogFile === "publisher-trust.json"
  )
    fail("Invalid catalog URL filename");
  if (
    !Array.isArray(config.kitDirectories) ||
    !config.kitDirectories.length ||
    config.kitDirectories.length > 128
  )
    fail("A nonempty bounded public kit inventory is required");
  const overrides = config.releaseContracts ?? {};
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides))
    fail("Invalid per-release contract overrides");
  const unusedOverrides = new Set(Object.keys(overrides));
  const output = await pathValue(config.output, { fresh: true }),
    parent = dirname(output),
    parentIdentity = await fs.lstat(parent);
  const keys = await signingKey(config.privateKeyPath, config.keyId);
  const previousVerified = await previous(config, keys.publicKey, now);
  const inputs = [],
    bodies = new Map(),
    releases = [];
  let total = 0;
  for (const directory of config.kitDirectories) {
    const kitPath = await pathValue(directory, { directory: true });
    const metadata = await regular(
        join(kitPath, "release.json"),
        LIMITS.metadata,
      ),
      m = parseJson(metadata.bytes, "public kit metadata");
    if (
      typeof m.version !== "string" ||
      m.version.length > 128 ||
      !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
        m.version,
      )
    )
      fail("Invalid public kit release version");
    const contracts = Object.hasOwn(overrides, m.version)
      ? overrides[m.version]
      : config.contracts;
    unusedOverrides.delete(m.version);
    const names = releaseNames(m.bundle?.artifacts);
    const manager = names.prefix === "daedlo" ? 2 : 1;
    if (contracts?.manager !== manager)
      fail(`Release ${m.version} package family requires manager ${manager}`);
    const filename = `daedlo-${m.version}.zip`;
    if (
      !isDeepStrictEqual(
        (await fs.readdir(kitPath)).sort(),
        [filename, "release.json", "SHA256SUMS"].sort(),
      )
    )
      fail(
        "Public kit directory must contain exactly its three published files",
      );
    const archive = await regular(join(kitPath, filename), LIMITS.zip),
      checksums = await regular(join(kitPath, "SHA256SUMS"), 4096);
    const asset = (name, input) => {
      total += input.bytes.length;
      if (total > LIMITS.total) fail("Combined kit input exceeds bounded size");
      inputs.push(input);
      const url = `${origin}/downloads/${m.version}/${name}`;
      if (bodies.has(url)) fail("Duplicate public release version");
      bodies.set(url, input.bytes);
      return { url, bytes: input.bytes.length, sha256: sha256(input.bytes) };
    };
    releases.push({
      version: m.version,
      channel: config.channel,
      platforms: config.platforms,
      contracts,
      notesUrl: config.notesUrl,
      kit: asset(filename, archive),
      metadata: asset("release.json", metadata),
      checksums: asset("SHA256SUMS", checksums),
    });
  }
  if (unusedOverrides.size) fail("Unused per-release contract override");
  releases.sort((a, b) => compareNinjaVersions(a.version, b.version));
  if (previousVerified) {
    for (const entry of previousVerified.catalog.releases) {
      const next = releases.find((r) => r.version === entry.version);
      if (!next || !isDeepStrictEqual(next, entry))
        fail(
          "Previously published release identity is immutable; entries cannot change or disappear on renewal",
        );
    }
  }
  const signed = {
    schemaVersion: 1,
    kind: "daedlo-public-kit-catalog",
    publisher: config.publisher,
    generation: config.generation,
    issuedAt: config.issuedAt,
    expiresAt: config.expiresAt,
    releases,
  };
  const envelope = {
    schemaVersion: 1,
    kind: "daedlo-signed-catalog",
    signed,
    signature: {
      keyId: config.keyId,
      value: sign(null, ninjaCatalogSigningBytes(signed), keys.key).toString(
        "base64",
      ),
    },
  };
  const catalogBytes = Buffer.from(JSON.stringify(envelope, null, 2) + "\n");
  const verified = verifyNinjaCatalog({
    bytes: catalogBytes,
    publisher: config.publisher,
    trustedKeys: [{ id: config.keyId, publicKey: keys.publicKey }],
    now,
    previousState: previousVerified?.checkpoint ?? null,
  });
  const temporary = await fs.mkdtemp(
      join(await fs.realpath(tmpdir()), "ninja-publisher-verification-"),
    ),
    temporaryIdentity = await fs.lstat(temporary);
  let verificationFailure;
  try {
    for (const entry of verified.catalog.releases) {
      await downloadNinjaKit({
        verified,
        version: entry.version,
        output: join(temporary, entry.version),
        allowedOrigin: origin,
        now,
        fetchImpl: async (url) => {
          const bytes = bodies.get(url);
          if (!bytes)
            fail("Unexpected URL during offline public kit verification");
          return new Response(bytes, {
            status: 200,
            headers: { "Content-Length": String(bytes.length) },
          });
        },
      });
    }
    for (const input of inputs) {
      const again = await regular(input.path, input.bytes.length);
      if (
        !sameIdentity(input.identity, again.identity) ||
        !again.bytes.equals(input.bytes)
      )
        fail("Public kit source changed during verification");
    }
  } catch (error) {
    verificationFailure = error;
  }
  const cleanup =
    verificationFailure ?? Error("Publisher verification cleanup failed");
  await removeOwned(temporary, temporaryIdentity, cleanup);
  if (verificationFailure || cleanup.cleanupFailed) throw cleanup;
  await pathValue(output, { fresh: true });
  if (!sameIdentity(parentIdentity, await stat(parent)))
    fail("Publisher output parent ownership changed");
  const stage = await fs.mkdtemp(join(parent, ".ninja-publisher-")),
    stageIdentity = await fs.lstat(stage);
  let reservation;
  try {
    const trust = {
      schemaVersion: 1,
      kind: "daedlo-publisher-trust",
      publisher: config.publisher,
      origin,
      catalogUrl: config.catalogUrl,
      keys: [
        {
          id: config.keyId,
          algorithm: "Ed25519",
          publicKeyFile: "publisher-public.pem",
          spkiSha256: keys.public.spkiSha256,
        },
      ],
    };
    for (const [file, bytes] of [
      [catalogFile, catalogBytes],
      ["publisher-public.pem", keys.public.publicKeyPem],
      ["publisher-trust.json", JSON.stringify(trust, null, 2) + "\n"],
    ]) {
      const handle = await fs.open(join(stage, file), "wx", 0o644);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    await pathValue(output, { fresh: true });
    if (
      !sameIdentity(parentIdentity, await stat(parent)) ||
      !sameIdentity(stageIdentity, await stat(stage))
    )
      fail("Publisher output ownership changed");
    await fs.mkdir(output, { mode: 0o700 });
    reservation = await fs.lstat(output);
    await fs.rename(stage, output);
    reservation = null;
    return Object.freeze({
      schemaVersion: 1,
      kind: "daedlo-catalog-publication-preparation",
      publisher: config.publisher,
      generation: config.generation,
      catalogFile,
      catalogSha256: sha256(catalogBytes),
      checkpoint: verified.checkpoint,
      keyId: config.keyId,
      spkiSha256: keys.public.spkiSha256,
      releases: releases.map((r) => ({
        version: r.version,
        archiveSha256: r.kit.sha256,
        metadataSha256: r.metadata.sha256,
      })),
      output,
    });
  } catch (error) {
    if (reservation) await removeOwned(output, reservation, error);
    await removeOwned(stage, stageIdentity, error);
    throw error;
  }
}
export async function runNinjaPublisherCli(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(
      "Offline Ninja catalog publisher\n  node ninja-publisher.mjs sign --config /absolute/config.json\n\nConfig: schemaVersion:1, publisher, keyId, privateKeyPath, generation, issuedAt, expiresAt,\norigin, catalogUrl, notesUrl, channel, platforms, contracts, kitDirectories, output.\nGeneration 1 is initial publication preparation. Renewal requires previousCatalogPath\n(latest published catalog), greater generation, fresh validity <=7 days and unchanged\nexisting release entries. Use a fresh output directory. For deliberate key rotation,\npreviousTrustedKeys is an array of {id,publicKeyPath}; distribute new public trust\nout of band before use. No deployment, key generation or schedule is performed.\n",
    );
    return;
  }
  if (args.length !== 3 || args[0] !== "sign" || args[1] !== "--config")
    fail("Usage: ninja-publisher.mjs sign --config /absolute/config.json");
  const config = parseJson(
    (await regular(args[2], LIMITS.catalog)).bytes,
    "publisher configuration",
  );
  const result = await publishNinjaCatalog(config);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  runNinjaPublisherCli().catch((error) => {
    process.stderr.write(error.message + "\n");
    process.exitCode = 1;
  });
