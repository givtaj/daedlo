// Public website staging only. No private-key input, signing or network access.
import { createPublicKey } from "node:crypto";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { verifyNinjaCatalog } from "../../scripts/release/ninja-catalog.mjs";
import {
  DEFAULT_WEBSITE_ROOT,
  parseOptions,
  readRegularFile,
  requireDirectory,
  sha256,
  verifyReleaseDirectory,
} from "./stage-release.mjs";

export const UPDATE_TRUST = Object.freeze({
  keyId: "daedlo-release-2026-10",
  publisher: "daedlo",
  expectedPublicKeySha256:
    "df84f7d60ed2af949d394e338070ef66ab4debabf911ffd6c7b35bebe6ba4297",
});
export const FEED_URL = "https://daedlo.com/updates/preview.json";
const publicFiles = ["preview.json", `keys/${UPDATE_TRUST.keyId}.pem`];
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function publicKey(bytes, trust) {
  if (
    bytes.length > 8192 ||
    !/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/.test(
      bytes.toString(),
    )
  )
    throw Error(
      "Only a public SPKI PEM is accepted; private keys are forbidden",
    );
  if (
    !/^[a-f0-9]{64}$/.test(trust.expectedPublicKeySha256 ?? "") ||
    sha256(bytes) !== trust.expectedPublicKeySha256
  )
    throw Error("Public key digest does not match pinned trust");
  if (
    trust.keyId !== UPDATE_TRUST.keyId ||
    trust.publisher !== UPDATE_TRUST.publisher
  )
    throw Error("Unsupported website publisher/key identity");
  const key = createPublicKey(bytes);
  if (key.asymmetricKeyType !== "ed25519")
    throw Error("An Ed25519 public key is required");
  return key;
}
async function inspectUpdatesTree(publicRoot) {
  const root = join(publicRoot, "updates");
  await requireDirectory(root);
  await requireDirectory(join(root, "keys"));
  if (
    !equal((await readdir(root)).sort(), ["keys", "preview.json"]) ||
    !equal((await readdir(join(root, "keys"))).sort(), [
      UPDATE_TRUST.keyId + ".pem",
    ])
  )
    throw Error(
      "Unexpected public updates entry; exact feed/key allowlist required",
    );
  return root;
}
async function verifyDownloads(publicRoot, catalog, expectedVersion) {
  const versions = catalog.releases.map((r) => r.version);
  if (
    !versions.includes("0.1.4-alpha.2") ||
    (expectedVersion && !versions.includes(expectedVersion))
  )
    throw Error(
      "Catalog must retain accepted alpha.2 and the requested current release",
    );
  await requireDirectory(join(publicRoot, "downloads"));
  for (const release of catalog.releases) {
    const directory = join(publicRoot, "downloads", release.version);
    const local = await verifyReleaseDirectory({
      releaseDirectory: directory,
      expectedVersion: release.version,
    });
    for (const [field, file] of [
      ["kit", `daedlo-${release.version}.zip`],
      ["metadata", "release.json"],
      ["checksums", "SHA256SUMS"],
    ]) {
      const signed = release[field],
        actual = local.files.find((f) => f.file === file);
      if (
        signed.url !==
          `https://daedlo.com/downloads/${release.version}/${file}` ||
        signed.bytes !== actual.bytes ||
        signed.sha256 !== actual.sha256
      )
        throw Error(
          "Catalog does not match exact retained public release bytes and origin",
        );
    }
    if (release.notesUrl !== "https://daedlo.com/updates.html")
      throw Error(
        "Catalog release notes must point to the public update instructions",
      );
  }
}
async function validate({
  publicRoot,
  catalogBytes,
  keyBytes,
  trust,
  expectedVersion,
  previousState,
  now = Date.now(),
}) {
  if (catalogBytes.length > 256 * 1024)
    throw Error("Catalog exceeds website size limit");
  const key = publicKey(keyBytes, trust);
  const verified = verifyNinjaCatalog({
    bytes: catalogBytes,
    trustedKeys: [{ id: trust.keyId, publicKey: key }],
    publisher: trust.publisher,
    previousState,
    now,
  });
  await verifyDownloads(publicRoot, verified.catalog, expectedVersion);
  const ignore = (
    await readRegularFile(join(publicRoot, ".assetsignore"))
  ).toString();
  for (const path of [
    "/updates/",
    "/updates/preview.json",
    "/updates/keys/",
    `/updates/keys/${trust.keyId}.pem`,
    "/updates.html",
  ])
    if (!ignore.split(/\r?\n/).includes("!" + path))
      throw Error("Exact public update allowlist entry required: " + path);
  return verified;
}
export async function readStagedUpdates({
  publicRoot = join(DEFAULT_WEBSITE_ROOT, "public"),
  updateTrust = UPDATE_TRUST,
  now = Date.now(),
} = {}) {
  const root = await inspectUpdatesTree(publicRoot);
  const contents = await Promise.all(
    publicFiles.map(async (file) => ({
      file,
      content: await readRegularFile(join(root, file)),
    })),
  );
  const verified = await validate({
    publicRoot,
    catalogBytes: contents[0].content,
    keyBytes: contents[1].content,
    trust: updateTrust,
    now,
  });
  return {
    ...verified,
    files: contents.map((f) => ({
      ...f,
      bytes: f.content.length,
      sha256: sha256(f.content),
    })),
  };
}
export function renderUpdatesTemplate(
  template,
  { catalog, version, publicKeySha256 },
) {
  const values = {
    FEED_URL,
    KEY_ID: UPDATE_TRUST.keyId,
    KEY_URL: `/updates/keys/${UPDATE_TRUST.keyId}.pem`,
    KEY_SHA256: publicKeySha256,
    EXPIRES_AT: catalog.expiresAt,
    VERSION: version,
  };
  const found = [...template.matchAll(/{{([^}]+)}}/g)].map((m) => m[1]);
  if (
    Object.keys(values).some((k) => !found.includes(k)) ||
    found.some((k) => !Object.hasOwn(values, k))
  )
    throw Error("Update template has missing or unknown placeholders");
  const escape = (v) =>
    v
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  return Buffer.from(
    template.replace(/{{([^}]+)}}/g, (_, key) => escape(values[key])),
  );
}
export async function stageUpdates({
  websiteRoot = DEFAULT_WEBSITE_ROOT,
  catalogFile,
  publicKeyFile,
  expectedVersion,
  ...trustOptions
} = {}) {
  if (!expectedVersion || !catalogFile || !publicKeyFile)
    throw Error("Catalog, public key and expected version are required");
  const trust = { ...UPDATE_TRUST, ...trustOptions },
    root = resolve(websiteRoot),
    publicRoot = join(root, "public");
  await requireDirectory(root);
  await requireDirectory(publicRoot);
  await requireDirectory(join(root, "templates"));
  const catalogBytes = await readRegularFile(resolve(catalogFile)),
    keyBytes = await readRegularFile(resolve(publicKeyFile));
  publicKey(keyBytes, trust);
  let previousState,
    previousReleases = [];
  try {
    const oldRoot = await inspectUpdatesTree(publicRoot),
      oldBytes = await readRegularFile(join(oldRoot, "preview.json")),
      oldKey = await readRegularFile(join(oldRoot, `keys/${trust.keyId}.pem`));
    if (!oldKey.equals(keyBytes))
      throw Error("Published key identity is immutable");
    const old = JSON.parse(oldBytes),
      prior = verifyNinjaCatalog({
        bytes: oldBytes,
        trustedKeys: [{ id: trust.keyId, publicKey: publicKey(oldKey, trust) }],
        publisher: trust.publisher,
        now: Date.parse(old.signed.issuedAt),
      });
    previousState = prior.checkpoint;
    previousReleases = prior.catalog.releases;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const entries = await readdir(publicRoot);
    if (entries.includes("updates"))
      throw Error("Incomplete existing update tree; retain and inspect it");
  }
  const verified = await validate({
    publicRoot,
    catalogBytes,
    keyBytes,
    trust,
    expectedVersion,
    previousState,
  });
  for (const release of previousReleases) {
    const current = verified.catalog.releases.find(
      (r) => r.version === release.version,
    );
    if (!current || !equal(current, release))
      throw Error(
        "Existing catalog releases must retain their exact signed metadata",
      );
  }
  const page = renderUpdatesTemplate(
    (await readRegularFile(join(root, "templates/updates.html"))).toString(),
    {
      catalog: verified.catalog,
      version: expectedVersion,
      publicKeySha256: sha256(keyBytes),
    },
  );
  const updates = join(publicRoot, "updates");
  await mkdir(updates, { recursive: true });
  await requireDirectory(updates);
  await mkdir(join(updates, "keys"), { recursive: true });
  await requireDirectory(join(updates, "keys"));
  const write = async (path, bytes) => {
    const tmp = path + "." + randomUUID() + ".tmp";
    try {
      await writeFile(tmp, bytes, { flag: "wx" });
      await rename(tmp, path);
    } finally {
      await rm(tmp, { force: true });
    }
  };
  await write(join(updates, `keys/${trust.keyId}.pem`), keyBytes);
  await write(join(updates, "preview.json"), catalogBytes);
  await write(join(publicRoot, "updates.html"), page);
  const actual = await readStagedUpdates({ publicRoot, updateTrust: trust });
  if (!actual.files[0].content.equals(catalogBytes))
    throw Error("Catalog changed during staging");
  return {
    version: expectedVersion,
    publicKeySha256: sha256(keyBytes),
    catalogSha256: sha256(catalogBytes),
    catalogPayloadSha256: actual.catalogSha256,
    generation: actual.catalog.generation,
    expiresAt: actual.catalog.expiresAt,
    files: actual.files.map(({ file, bytes, sha256 }) => ({
      path: "public/updates/" + file,
      bytes,
      sha256,
    })),
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = parseOptions(process.argv.slice(2), [
      "--website-root",
      "--catalog",
      "--public-key",
      "--expected-version",
    ]);
    console.log(
      JSON.stringify(
        await stageUpdates({
          websiteRoot: args["--website-root"],
          catalogFile: args["--catalog"],
          publicKeyFile: args["--public-key"],
          expectedVersion: args["--expected-version"],
        }),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
