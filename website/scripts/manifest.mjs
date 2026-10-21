import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_WEBSITE_ROOT,
  VERSION_PATTERN,
  parseOptions,
  readRegularFile,
  requireDirectory,
  requireZipAllowlist,
  sha256,
  verifyReleaseDirectory,
} from "./stage-release.mjs";

export const PUBLIC_FILES = new Set([
  "index.html",
  "guide.html",
  "privacy.html",
  "install.html",
  "demo.html",
  "demo.css",
  "demo-evidence.json",
  "demo-verified-save.png",
  "demo-restored-fields.png",
  "404.html",
  "styles.css",
  "workflow.js",
  "mark.svg",
  "robots.txt",
  "sitemap.xml",
  "_headers",
  ".assetsignore",
]);
export const CONTROL_FILES = new Set(["_headers", ".assetsignore"]);

export async function createWebsiteManifest({
  websiteRoot = DEFAULT_WEBSITE_ROOT,
} = {}) {
  const root = resolve(websiteRoot);
  const publicRoot = join(root, "public");
  await requireDirectory(root);
  await requireDirectory(publicRoot);
  const configuration = await readRegularFile(join(root, "wrangler.jsonc"));
  const files = [
    {
      path: "wrangler.jsonc",
      bytes: configuration.length,
      sha256: sha256(configuration),
    },
  ];
  const ignore = (
    await readRegularFile(join(publicRoot, ".assetsignore"))
  ).toString("utf8");
  for (const name of (await readdir(publicRoot)).sort()) {
    if (name === "downloads") {
      const downloads = join(publicRoot, name);
      await requireDirectory(downloads);
      for (const version of (await readdir(downloads)).sort()) {
        if (!VERSION_PATTERN.test(version))
          throw new Error(
            `Unexpected public entry outside download allowlist: downloads/${version}`,
          );
        const release = await verifyReleaseDirectory({
          releaseDirectory: join(downloads, version),
          expectedVersion: version,
        });
        requireZipAllowlist(ignore, version);
        for (const file of release.files)
          files.push({
            path: `public/downloads/${version}/${file.file}`,
            bytes: file.bytes,
            sha256: file.sha256,
          });
      }
      continue;
    }
    if (!PUBLIC_FILES.has(name))
      throw new Error(
        `Unexpected public entry outside asset allowlist: ${name}`,
      );
    const bytes = await readRegularFile(join(publicRoot, name));
    if (name.endsWith(".html") && /{{|}}/.test(bytes.toString("utf8")))
      throw new Error(
        `Unresolved template placeholder in public page: ${name}`,
      );
    files.push({
      path: `public/${name}`,
      bytes: bytes.length,
      sha256: sha256(bytes),
    });
  }
  return {
    format: "daedlo-website-manifest/1",
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = parseOptions(process.argv.slice(2), ["--website-root"]);
    console.log(
      JSON.stringify(
        await createWebsiteManifest({ websiteRoot: args["--website-root"] }),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
