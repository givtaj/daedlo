import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTROL_FILES, createWebsiteManifest } from "../scripts/manifest.mjs";
import {
  DEFAULT_WEBSITE_ROOT,
  parseOptions,
  renderInstallTemplate,
  verifyReleaseDirectory,
} from "../scripts/stage-release.mjs";

import {
  readStagedUpdates,
  renderUpdatesTemplate,
  UPDATE_TRUST,
} from "../scripts/stage-updates.mjs";

export async function checkWebsite({
  websiteRoot = DEFAULT_WEBSITE_ROOT,
  updateTrust = UPDATE_TRUST,
} = {}) {
  const root = join(resolve(websiteRoot), "public");
  const manifest = await createWebsiteManifest({ websiteRoot, updateTrust });
  const publicFiles = manifest.files
    .filter((file) => file.path.startsWith("public/"))
    .map((file) => file.path.slice("public/".length));
  const downloadable = new Set(
    publicFiles.filter((path) => !CONTROL_FILES.has(path)),
  );
  const home = (await readFile(join(root, "index.html"), "utf8")).replace(
    /\s+/g,
    " ",
  );
  assert.match(
    home,
    /<h1[\s>][\s\S]*Make[\s\S]*it works[\s\S]*something you can show[\s\S]*<\/h1>/,
    "The public page must explain the product promise.",
  );
  const privacy = await readFile(join(root, "privacy.html"), "utf8");
  const contactAddresses = [...privacy.matchAll(/href="mailto:([^?"\s]+)/g)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(
    [...new Set(contactAddresses)],
    ["info@daedlo.com", "support@daedlo.com"],
    "Public enquiries and privacy contacts must use the two Daedlo addresses.",
  );
  const pages = publicFiles.filter((name) => name.endsWith(".html"));
  for (const name of pages) {
    const html = await readFile(join(root, name), "utf8");
    for (const match of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
      const target = match[1];
      if (/^(https?:|mailto:)/.test(target)) continue;
      const url = new URL(target, `https://daedlo.test/${name}`);
      assert.equal(
        url.origin,
        "https://daedlo.test",
        `${name} has a valid local asset origin`,
      );
      const path = decodeURIComponent(url.pathname).slice(1) || "index.html";
      assert.ok(
        downloadable.has(path),
        `${name} references an existing, allowlisted public asset: ${target}`,
      );
    }
  }
  assert.match(
    home,
    /illustration[^<]*not a live browser/i,
    "The concept must be labelled as an illustration.",
  );
  assert.match(
    home,
    /application-specific integration/i,
    "Preview limitations must be visible.",
  );
  const archives = publicFiles.filter((path) =>
    /\.(?:zip|tgz|tar|crate|gz|7z|rar)$/i.test(path),
  );
  for (const archive of archives) {
    assert.match(
      archive,
      /^downloads\/[^/]+\/daedlo-[^/]+\.zip$/,
      "Only verified curated download archives may be public.",
    );
  }
  if (publicFiles.includes("install.html")) {
    const install = await readFile(join(root, "install.html"));
    const matches = [
      ...install
        .toString("utf8")
        .matchAll(/href="\/downloads\/([^/"]+)\/daedlo-\1\.zip"/g),
    ];
    assert.equal(
      new Set(matches.map((match) => match[1])).size,
      1,
      "Installation must point to one concrete release.",
    );
    const version = matches[0][1];
    const release = await verifyReleaseDirectory({
      releaseDirectory: join(root, "downloads", version),
      expectedVersion: version,
    });
    const template = await readFile(
      join(resolve(websiteRoot), "templates/install.html"),
      "utf8",
    );
    assert.ok(
      install.equals(renderInstallTemplate(template, release.metadata)),
      "Rendered installation page must match the verified archive version, size and digest.",
    );
    if (publicFiles.includes("updates/preview.json")) {
      const updates = await readStagedUpdates({
        publicRoot: root,
        updateTrust,
      });
      const updateTemplate = await readFile(
        join(resolve(websiteRoot), "templates/updates.html"),
        "utf8",
      );
      const expected = renderUpdatesTemplate(updateTemplate, {
        catalog: updates.catalog,
        version,
        metadata: release.metadata,
        publicKeySha256: updates.files.find((f) => f.file.endsWith(".pem"))
          .sha256,
      });
      assert.ok(
        (await readFile(join(root, "updates.html"))).equals(expected),
        "Update instructions must match the signed catalog expiry, pinned key and current release.",
      );
    }
  }
  return {
    pages: pages.length,
    archives: archives.length,
    assets: publicFiles.length,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = parseOptions(process.argv.slice(2), ["--website-root"]);
    const result = await checkWebsite({ websiteRoot: args["--website-root"] });
    console.log(
      `PASS: public promise, ${result.pages} pages with real allowlisted links, contact addresses, illustration/integration disclosures and ${result.archives} verified curated archives (${result.assets} public entries).`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
