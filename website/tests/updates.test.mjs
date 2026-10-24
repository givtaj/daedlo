import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ninjaCatalogSigningBytes } from "../../scripts/release/ninja-catalog.mjs";
import { createWebsiteManifest } from "../scripts/manifest.mjs";
import { readPreviewResponse } from "../scripts/serve.mjs";
const sourceWebsite = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const website = resolve(process.env.DAEDLO_WEBSITE_ROOT ?? sourceWebsite);
const keyId = "daedlo-release-2026-10",
  publisher = "daedlo";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "daedlo-updates-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const site = join(root, "website");
  await mkdir(join(site, "public/updates/keys"), { recursive: true });
  await mkdir(join(site, "templates"));
  await writeFile(join(site, "wrangler.jsonc"), "{}\n");
  await writeFile(join(site, "public/404.html"), "Not found");
  await writeFile(join(site, "public/index.html"), "Fixture");
  await writeFile(
    join(site, "templates/updates.html"),
    "{{FEED_URL}} {{KEY_ID}} {{KEY_URL}} {{KEY_SHA256}} {{EXPIRES_AT}} {{VERSION}}",
  );
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pem = Buffer.from(publicKey.export({ type: "spki", format: "pem" }));
  const releases = [],
    preserved = {};
  let ignore =
    "*\n*.zip\n!/updates/\n!/updates/preview.json\n!/updates/keys/\n!/updates/keys/" +
    keyId +
    ".pem\n!/updates.html\n";
  for (const version of ["0.1.4-alpha.2", "0.1.4-alpha.3"]) {
    const directory = join(site, "public/downloads", version);
    await mkdir(directory, { recursive: true });
    const zipName = `daedlo-${version}.zip`,
      zip = Buffer.from("PK synthetic signed fixture " + version);
    const metadata = {
      schemaVersion: 1,
      version,
      archive: { file: zipName, bytes: zip.length, sha256: digest(zip) },
    };
    const contents = {
      [zipName]: zip,
      "release.json": Buffer.from(JSON.stringify(metadata) + "\n"),
      SHA256SUMS: Buffer.from(digest(zip) + "  " + zipName + "\n"),
    };
    for (const [file, bytes] of Object.entries(contents)) {
      await writeFile(join(directory, file), bytes);
      preserved[version + "/" + file] = digest(bytes);
    }
    ignore += `!/downloads/${version}/${zipName}\n`;
    const asset = (file) => ({
      url: `https://daedlo.com/downloads/${version}/${file}`,
      bytes: contents[file].length,
      sha256: digest(contents[file]),
    });
    releases.push({
      version,
      channel: "preview",
      platforms: [{ os: "darwin", arch: "arm64" }],
      contracts: {
        manager: 1,
        launcher: 1,
        nodeAdapter: 1,
        rustModel: 1,
        protocol: 1,
        capabilities: ["recipeContext:1"],
      },
      notesUrl: "https://daedlo.com/updates.html",
      kit: asset(zipName),
      metadata: asset("release.json"),
      checksums: asset("SHA256SUMS"),
    });
  }
  await writeFile(join(site, "public/.assetsignore"), ignore);
  const now = Date.now(),
    signed = {
      schemaVersion: 1,
      kind: "daedlo-public-kit-catalog",
      publisher,
      generation: 1,
      issuedAt: new Date(now - 1000).toISOString(),
      expiresAt: new Date(now + 86400000).toISOString(),
      releases,
    };
  const envelope = () => ({
    schemaVersion: 1,
    kind: "daedlo-signed-catalog",
    signed,
    signature: {
      keyId,
      value: sign(null, ninjaCatalogSigningBytes(signed), privateKey).toString(
        "base64",
      ),
    },
  });
  const catalog = Buffer.from(JSON.stringify(envelope()) + "\n");
  await writeFile(join(site, "public/updates/preview.json"), catalog);
  await writeFile(join(site, "public/updates/keys", keyId + ".pem"), pem);
  const catalogFile = join(root, "catalog.json"),
    publicKeyFile = join(root, "public.pem");
  await writeFile(catalogFile, catalog);
  await writeFile(publicKeyFile, pem);
  return {
    root,
    site,
    keyId,
    publisher,
    pem,
    privateKey,
    signed,
    envelope,
    catalog,
    catalogFile,
    publicKeyFile,
    preserved,
    options: {
      websiteRoot: site,
      catalogFile,
      publicKeyFile,
      keyId,
      publisher,
      expectedPublicKeySha256: digest(pem),
      expectedVersion: "0.1.4-alpha.3",
    },
  };
}

test("signed preview feed and public key enter the exact website inventory while older downloads remain", async (t) => {
  const f = await fixture(t);
  const manifest = await createWebsiteManifest({
    websiteRoot: f.site,
    updateTrust: f.options,
  });
  for (const file of [
    "updates/preview.json",
    `updates/keys/${keyId}.pem`,
    "downloads/0.1.4-alpha.2/daedlo-0.1.4-alpha.2.zip",
  ])
    assert.ok(
      manifest.files.some((x) => x.path === "public/" + file),
      file,
    );
});
test("preview serves signed metadata and public key with separate cache rules, never private paths", async (t) => {
  const f = await fixture(t);
  for (const [path, type, cache, body] of [
    [
      "/updates/preview.json",
      "application/json; charset=utf-8",
      "no-cache, max-age=0, must-revalidate",
      f.catalog,
    ],
    [
      `/updates/keys/${keyId}.pem`,
      "text/plain; charset=utf-8",
      "public, max-age=31536000, immutable",
      f.pem,
    ],
  ]) {
    const r = await readPreviewResponse(path, {
      publicRoot: join(f.site, "public"),
      updateTrust: f.options,
    });
    assert.equal(r.status, 200);
    assert.equal(r.headers["Content-Type"], type);
    assert.equal(r.headers["Cache-Control"], cache);
    assert.equal(r.headers["X-Content-Type-Options"], "nosniff");
    assert.deepEqual(r.body, body);
  }
  for (const path of [
    "/updates/private.pem",
    "/updates/keys/private.pem",
    "/updates/.env",
  ])
    assert.equal(
      (
        await readPreviewResponse(path, {
          publicRoot: join(f.site, "public"),
          updateTrust: f.options,
        })
      ).status,
      404,
    );
});
test("production header rules keep the mutable feed fresh and immutable releases cached", async () => {
  const text = await readFile(join(website, "public/_headers"), "utf8");
  assert.match(
    text,
    /\/updates\/preview\.json\n\s+Cache-Control: no-cache, max-age=0, must-revalidate/,
  );
  assert.match(
    text,
    /\/updates\/keys\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/,
  );
  assert.match(
    text,
    /\/downloads\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/,
  );
  assert.match(text, /X-Content-Type-Options: nosniff/);
});

test("staging verifies pinned signatures and all staged release bytes before writing public instructions", async (t) => {
  const f = await fixture(t);
  await rm(join(f.site, "public/updates"), { recursive: true });
  const { stageUpdates } = await import("../scripts/stage-updates.mjs");
  const result = await stageUpdates(f.options);
  assert.equal(result.version, "0.1.4-alpha.3");
  assert.equal(result.publicKeySha256, digest(f.pem));
  assert.equal(result.catalogSha256, digest(f.catalog));
  assert.equal(
    result.catalogPayloadSha256,
    digest(ninjaCatalogSigningBytes(f.signed)),
  );
  assert.notEqual(result.catalogSha256, result.catalogPayloadSha256);
  assert.deepEqual(
    await readFile(join(f.site, "public/updates/preview.json")),
    f.catalog,
  );
  assert.match(
    await readFile(join(f.site, "public/updates.html"), "utf8"),
    new RegExp(digest(f.pem)),
  );
  for (const [file, sha] of Object.entries(f.preserved))
    assert.equal(
      digest(await readFile(join(f.site, "public/downloads", file))),
      sha,
    );
});

for (const problem of [
  "private-key",
  "wrong-key",
  "signature",
  "expired",
  "changed-download",
  "missing-previous",
  "other-origin",
  "unexpected-file",
]) {
  test(`signed update staging rejects ${problem} without replacing existing feed or page`, async (t) => {
    const f = await fixture(t),
      { stageUpdates } = await import("../scripts/stage-updates.mjs");
    await writeFile(
      join(f.site, "public/updates.html"),
      "existing instructions",
    );
    if (problem === "private-key")
      await writeFile(
        f.publicKeyFile,
        f.privateKey.export({ type: "pkcs8", format: "pem" }),
      );
    if (problem === "wrong-key")
      f.options.expectedPublicKeySha256 = "0".repeat(64);
    if (problem === "signature") {
      const e = JSON.parse(f.catalog);
      e.signed.generation++;
      await writeFile(f.catalogFile, JSON.stringify(e));
    }
    if (problem === "expired") {
      f.signed.issuedAt = new Date(Date.now() - 2 * 86400000).toISOString();
      f.signed.expiresAt = new Date(Date.now() - 86400000).toISOString();
      await writeFile(f.catalogFile, JSON.stringify(f.envelope()));
    }
    if (problem === "changed-download")
      await writeFile(
        join(f.site, "public/downloads/0.1.4-alpha.2/release.json"),
        "changed",
      );
    if (problem === "missing-previous") {
      f.signed.releases.shift();
      await writeFile(f.catalogFile, JSON.stringify(f.envelope()));
    }
    if (problem === "other-origin") {
      for (const a of ["kit", "metadata", "checksums"])
        f.signed.releases[0][a].url = f.signed.releases[0][a].url.replace(
          "daedlo.com",
          "untrusted.test",
        );
      await writeFile(f.catalogFile, JSON.stringify(f.envelope()));
    }
    if (problem === "unexpected-file")
      await writeFile(
        join(f.site, "public/updates/keys/secret.pem"),
        "private",
      );
    await assert.rejects(stageUpdates(f.options));
    assert.deepEqual(
      await readFile(join(f.site, "public/updates/preview.json")),
      f.catalog,
    );
    assert.equal(
      await readFile(join(f.site, "public/updates.html"), "utf8"),
      "existing instructions",
    );
  });
}

test("renewal rejects replay and same-generation changes while accepting only a newer signed catalog", async (t) => {
  const f = await fixture(t),
    { stageUpdates } = await import("../scripts/stage-updates.mjs");
  await stageUpdates(f.options);
  f.signed.expiresAt = new Date(Date.now() + 2 * 86400000).toISOString();
  await writeFile(f.catalogFile, JSON.stringify(f.envelope()));
  await assert.rejects(stageUpdates(f.options), /equivocation|generation/i);
  f.signed.generation = 2;
  await writeFile(f.catalogFile, JSON.stringify(f.envelope()));
  assert.equal((await stageUpdates(f.options)).generation, 2);
  await writeFile(f.catalogFile, f.catalog);
  await assert.rejects(stageUpdates(f.options), /replay|generation/i);
});

test("website public key pin matches the reviewed production trust metadata", async () => {
  const { UPDATE_TRUST } = await import("../scripts/stage-updates.mjs");
  const root = resolve(sourceWebsite, "../docs/update-trust");
  const metadata = JSON.parse(
    await readFile(join(root, "production.json"), "utf8"),
  );
  assert.equal(
    UPDATE_TRUST.expectedPublicKeySha256,
    digest(await readFile(join(root, metadata.publicKeyFile))),
  );
  assert.equal(UPDATE_TRUST.keyId, metadata.keyId);
  assert.equal(UPDATE_TRUST.publisher, metadata.publisher);
});

for (const extra of [
  "updates/private.pem",
  "updates/keys/private.pem",
  "updates/secret.json",
]) {
  test(`manifest refuses unexpected public update material ${extra}`, async (t) => {
    const f = await fixture(t);
    await writeFile(join(f.site, "public", extra), "private fixture material");
    await assert.rejects(
      createWebsiteManifest({ websiteRoot: f.site, updateTrust: f.options }),
      /allowlist|Unexpected/i,
    );
  });
}

test("update instructions explain pinned trust, one-time registration, expiry and preservation boundaries", async () => {
  const template = await readFile(
      join(website, "templates/updates.html"),
      "utf8",
    ),
    install = await readFile(join(website, "templates/install.html"), "utf8");
  assert.match(install, /href="\/updates\.html"/);
  for (const pattern of [
    /one-time setup/i,
    /Ed25519/,
    /PUBLIC KEY PEM SHA-256/,
    /independently verified installed tools/,
    /docs\/update-trust\/production\.json/,
    /disposable data/,
    /states, flows, adapter/,
    /dependency locks/,
    /custom skills/,
    /at most seven days/,
    /GitHub Actions renews this catalog daily/,
    /increasing generation/,
    /leaves the installed version running/,
    /existing local rollback available/,
    /unsaved or unknown browser drafts/,
    /WBF needs its own/,
    /Linked browser frameworks are not sealed/,
  ])
    assert.match(template.replace(/\s+/g, " "), pattern);
  assert.doesNotMatch(template, /curl[^<]*\|\s*(sh|bash)\b/);
});

test("website acceptance requires explicit test trust and retains the production default", async (t) => {
  const f = await fixture(t);
  const { checkWebsite } = await import("./acceptance.mjs");
  await writeFile(
    join(f.site, "public/index.html"),
    "<h1>Make “it works” something you can show</h1><p>Illustration, not a live browser; application-specific integration.</p>",
  );
  await writeFile(
    join(f.site, "public/privacy.html"),
    '<a href="mailto:info@daedlo.com">Info</a><a href="mailto:support@daedlo.com">Support</a>',
  );
  await assert.rejects(checkWebsite({ websiteRoot: f.site }), /pinned trust/);
  const result = await checkWebsite({
    websiteRoot: f.site,
    updateTrust: f.options,
  });
  assert.equal(result.archives, 2);
});
