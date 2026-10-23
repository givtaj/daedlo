import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const sourceWebsite = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const website = resolve(process.env.DAEDLO_WEBSITE_ROOT ?? sourceWebsite);
const version = "0.1.2-rc.1";
const zipName = `daedlo-${version}.zip`;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "daedlo-stage-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const site = join(root, "website");
  const kit = join(root, "kit");
  await mkdir(join(site, "public"), { recursive: true });
  await mkdir(join(site, "templates"));
  await mkdir(kit);
  await writeFile(join(site, "wrangler.jsonc"), "{}\n");
  await writeFile(join(site, "public/index.html"), "<h1>Test fixture</h1>\n");
  await writeFile(join(site, "public/404.html"), "Not found\n");
  await writeFile(
    join(site, "public/.assetsignore"),
    `*.zip\n!/downloads/${version}/${zipName}\n`,
  );
  await writeFile(
    join(site, "templates/install.html"),
    '<h1>{{VERSION}}</h1><a href="/downloads/{{VERSION}}/daedlo-{{VERSION}}.zip">Download</a><p>{{ZIP_SHA256}}</p><p>{{ZIP_BYTES}}</p>',
  );
  const bytes = Buffer.from(
    "PK\x03\x04 synthetic integrity-test archive bytes",
  );
  const metadata = {
    schemaVersion: 1,
    version,
    archive: { file: zipName, bytes: bytes.length, sha256: sha256(bytes) },
    tools: { sha256: "b".repeat(64) },
    bundle: { manifestSha256: "c".repeat(64) },
  };
  await writeFile(join(kit, zipName), bytes);
  await writeFile(
    join(kit, "SHA256SUMS"),
    `${metadata.archive.sha256}  ${zipName}\n`,
  );
  await writeFile(join(kit, "release.json"), `${JSON.stringify(metadata)}\n`);
  return { root, site, kit, bytes, metadata };
}

test("manifest recursively includes a curated versioned archive", async (t) => {
  const { site, kit } = await fixture(t);
  const destination = join(site, "public/downloads", version);
  await mkdir(destination, { recursive: true });
  for (const name of await readdir(kit))
    await writeFile(join(destination, name), await readFile(join(kit, name)));
  const result = spawnSync(
    process.execPath,
    [join(sourceWebsite, "scripts/manifest.mjs"), "--website-root", site],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(result.stdout);
  assert.ok(
    manifest.files.some(
      (file) => file.path === `public/downloads/${version}/${zipName}`,
    ),
    "A verified versioned ZIP must appear in the public byte inventory.",
  );
});

test("staging writes verified bytes and renders only final release values", async (t) => {
  const { site, kit, bytes, metadata } = await fixture(t);
  const { stageRelease } = await import("../scripts/stage-release.mjs");
  const result = await stageRelease({
    releaseDirectory: kit,
    websiteRoot: site,
    expectedVersion: version,
  });
  assert.equal(result.version, version);
  assert.deepEqual(
    await readFile(join(site, "public/downloads", version, zipName)),
    bytes,
  );
  const page = await readFile(join(site, "public/install.html"), "utf8");
  assert.ok(page.includes(metadata.archive.sha256));
  assert.ok(page.includes(String(bytes.length)));
  assert.ok(page.includes(`/downloads/${version}/${zipName}`));
  assert.doesNotMatch(page, /{{/);
  await stageRelease({ releaseDirectory: kit, websiteRoot: site });
  assert.deepEqual(
    await readFile(join(site, "public/downloads", version, zipName)),
    bytes,
  );
});

for (const corruption of [
  "digest",
  "size",
  "checksum",
  "extra",
  "traversal",
  "schema",
]) {
  test(`staging rejects ${corruption} before adding any public download`, async (t) => {
    const { site, kit, metadata } = await fixture(t);
    if (corruption === "digest") {
      const changed = await readFile(join(kit, zipName));
      changed[0] ^= 0xff;
      await writeFile(join(kit, zipName), changed);
    }
    if (corruption === "size") metadata.archive.bytes += 1;
    if (corruption === "checksum")
      await writeFile(
        join(kit, "SHA256SUMS"),
        `${"a".repeat(64)}  ${zipName}\n`,
      );
    if (corruption === "extra")
      await writeFile(join(kit, "private-notes.txt"), "not public");
    if (corruption === "traversal") metadata.archive.file = "../../private.zip";
    if (corruption === "schema") metadata.schemaVersion = 2;
    if (["size", "traversal", "schema"].includes(corruption))
      await writeFile(join(kit, "release.json"), JSON.stringify(metadata));
    const { stageRelease } = await import("../scripts/stage-release.mjs");
    await assert.rejects(
      stageRelease({ releaseDirectory: kit, websiteRoot: site }),
    );
    assert.deepEqual((await readdir(join(site, "public"))).sort(), [
      ".assetsignore",
      "404.html",
      "index.html",
    ]);
  });
}

test("staging refuses symlinked artifacts and does not replace an existing version", async (t) => {
  const { root, site, kit } = await fixture(t);
  const { stageRelease } = await import("../scripts/stage-release.mjs");
  await stageRelease({ releaseDirectory: kit, websiteRoot: site });
  const installed = join(site, "public/downloads", version, zipName);
  await writeFile(installed, "existing changed release");
  await assert.rejects(
    stageRelease({ releaseDirectory: kit, websiteRoot: site }),
    /digest|size|immutable/i,
  );
  assert.equal(await readFile(installed, "utf8"), "existing changed release");
  await rm(join(kit, zipName));
  await writeFile(join(root, "outside.zip"), "outside source");
  await symlink(join(root, "outside.zip"), join(kit, zipName));
  await assert.rejects(
    stageRelease({ releaseDirectory: kit, websiteRoot: site }),
    /regular file|symlink/i,
  );
});

test("staging rejects unknown template placeholders and missing exact ZIP allowlist", async (t) => {
  const { site, kit } = await fixture(t);
  const { stageRelease } = await import("../scripts/stage-release.mjs");
  const template = join(site, "templates/install.html");
  const original = await readFile(template, "utf8");
  await writeFile(template, `${original}{{PRIVATE_TOKEN}}`);
  await assert.rejects(
    stageRelease({ releaseDirectory: kit, websiteRoot: site }),
    /placeholder/i,
  );
  assert.equal(
    (await readdir(join(site, "public"))).includes("downloads"),
    false,
  );
  await writeFile(template, original);
  await writeFile(join(site, "public/.assetsignore"), "*.zip\n");
  await assert.rejects(
    stageRelease({ releaseDirectory: kit, websiteRoot: site }),
    /allowlist/i,
  );
});

for (const extra of [
  "private.zip",
  ".env",
  "session.log",
  "private/secret.txt",
]) {
  test(`manifest rejects uncurated public entry ${extra}`, async (t) => {
    const { site, kit } = await fixture(t);
    const { stageRelease } = await import("../scripts/stage-release.mjs");
    const { createWebsiteManifest } = await import("../scripts/manifest.mjs");
    await stageRelease({ releaseDirectory: kit, websiteRoot: site });
    const extraPath = join(site, "public", extra);
    await mkdir(dirname(extraPath), { recursive: true });
    await writeFile(extraPath, "unexpected");
    await assert.rejects(
      createWebsiteManifest({ websiteRoot: site }),
      /public entry|allowlist/i,
    );
  });
}

test("manifest rejects download extras, tampering and symlinks", async (t) => {
  const { site, kit } = await fixture(t);
  const { stageRelease } = await import("../scripts/stage-release.mjs");
  const { createWebsiteManifest } = await import("../scripts/manifest.mjs");
  await stageRelease({ releaseDirectory: kit, websiteRoot: site });
  const release = join(site, "public/downloads", version);
  await writeFile(join(release, "other.zip"), "unexpected");
  await assert.rejects(
    createWebsiteManifest({ websiteRoot: site }),
    /exactly|unexpected/i,
  );
  await rm(join(release, "other.zip"));
  await writeFile(join(release, zipName), "tampered");
  await assert.rejects(
    createWebsiteManifest({ websiteRoot: site }),
    /size|digest/i,
  );
  await rm(join(release, zipName));
  await symlink(join(kit, zipName), join(release, zipName));
  await assert.rejects(
    createWebsiteManifest({ websiteRoot: site }),
    /regular file|symlink/i,
  );
});

test("preview returns actual curated ZIP, checksum and metadata MIME types and rejects private paths", async (t) => {
  const { site, kit, bytes } = await fixture(t);
  const { stageRelease } = await import("../scripts/stage-release.mjs");
  const { readPreviewResponse } = await import("../scripts/serve.mjs");
  await stageRelease({ releaseDirectory: kit, websiteRoot: site });
  for (const [file, type] of [
    [zipName, "application/zip"],
    ["SHA256SUMS", "text/plain; charset=utf-8"],
    ["release.json", "application/json; charset=utf-8"],
  ]) {
    const response = await readPreviewResponse(
      `/downloads/${version}/${file}`,
      { publicRoot: join(site, "public") },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers["Content-Type"], type);
    if (file === zipName) assert.deepEqual(response.body, bytes);
  }
  for (const path of [
    "/.env",
    "/_headers",
    `/downloads/${version}/private.zip`,
    "/%2e%2e/secret.txt",
  ]) {
    assert.equal(
      (await readPreviewResponse(path, { publicRoot: join(site, "public") }))
        .status,
      404,
    );
  }
});

test("website acceptance checks real download links and refuses a stale installation digest", async (t) => {
  const { site, kit, metadata } = await fixture(t);
  const { stageRelease } = await import("../scripts/stage-release.mjs");
  const { checkWebsite } = await import("./acceptance.mjs");
  const { PUBLIC_FILES } = await import("../scripts/manifest.mjs");
  for (const name of PUBLIC_FILES) {
    if (["install.html", "updates.html"].includes(name)) continue;
    const content = await readFile(join(website, "public", name)).catch(
      (error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    if (content) await writeFile(join(site, "public", name), content);
  }
  await writeFile(
    join(site, "templates/install.html"),
    await readFile(join(website, "templates/install.html")),
  );
  await writeFile(
    join(site, "public/updates.html"),
    "<h1>Managed updates fixture</h1>",
  );
  await stageRelease({ releaseDirectory: kit, websiteRoot: site });
  const result = await checkWebsite({ websiteRoot: site });
  assert.equal(result.archives, 1);
  assert.equal(result.pages, 7);
  const path = join(site, "public/install.html");
  await writeFile(
    path,
    (await readFile(path, "utf8")).replace(
      metadata.archive.sha256,
      "0".repeat(64),
    ),
  );
  await assert.rejects(
    checkWebsite({ websiteRoot: site }),
    /installation page.*digest/,
  );
});
