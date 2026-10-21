import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_WEBSITE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const VERSION_PATTERN =
  /^\d+\.\d+\.\d+(?:-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?$/;
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

export async function requireDirectory(path) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error(`Expected a directory without symlinks: ${path}`);
}
export async function readRegularFile(path) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new Error(`Expected a regular file without symlinks: ${path}`);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isFile())
      throw new Error(`Expected a regular file: ${path}`);
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export async function verifyReleaseDirectory({
  releaseDirectory,
  expectedVersion,
} = {}) {
  if (!releaseDirectory) throw new Error("releaseDirectory is required");
  const directory = resolve(releaseDirectory);
  await requireDirectory(directory);
  const metadataBytes = await readRegularFile(join(directory, "release.json"));
  const metadata = JSON.parse(metadataBytes.toString("utf8"));
  if (metadata?.schemaVersion !== 1 || !VERSION_PATTERN.test(metadata.version))
    throw new Error("Invalid release metadata schema or version");
  if (expectedVersion !== undefined && metadata.version !== expectedVersion)
    throw new Error("Release version does not match expected version");
  const expectedFile = `daedlo-${metadata.version}.zip`;
  const archive = metadata.archive;
  if (
    archive?.file !== expectedFile ||
    !Number.isSafeInteger(archive.bytes) ||
    archive.bytes < 1 ||
    !/^[a-f0-9]{64}$/.test(archive.sha256)
  )
    throw new Error(
      "Invalid release archive filename, size or SHA-256 metadata",
    );
  const expectedFiles = [expectedFile, "SHA256SUMS", "release.json"].sort();
  if (
    JSON.stringify((await readdir(directory)).sort()) !==
    JSON.stringify(expectedFiles)
  )
    throw new Error(
      "Release directory must contain exactly the ZIP, SHA256SUMS and release.json; unexpected entries are not public",
    );
  const archiveBytes = await readRegularFile(join(directory, expectedFile));
  if (archiveBytes.length !== archive.bytes)
    throw new Error("Archive size does not match release metadata");
  if (sha256(archiveBytes) !== archive.sha256)
    throw new Error("Archive digest does not match release metadata");
  const checksumBytes = await readRegularFile(join(directory, "SHA256SUMS"));
  if (checksumBytes.toString("utf8") !== `${archive.sha256}  ${expectedFile}\n`)
    throw new Error(
      "SHA256SUMS must contain exactly the verified ZIP digest and filename",
    );
  const contents = new Map([
    [expectedFile, archiveBytes],
    ["SHA256SUMS", checksumBytes],
    ["release.json", metadataBytes],
  ]);
  return {
    metadata,
    files: [...contents].map(([file, content]) => ({
      file,
      bytes: content.length,
      sha256: sha256(content),
      content,
    })),
  };
}

export function requireZipAllowlist(ignoreText, version) {
  const rule = `!/downloads/${version}/daedlo-${version}.zip`;
  const lines = ignoreText.split(/\r?\n/).map((line) => line.trim());
  if (
    !lines.includes("*.zip") ||
    !lines.includes(rule) ||
    lines.indexOf(rule) < lines.indexOf("*.zip")
  )
    throw new Error(
      `Exact ZIP allowlist rule is required after *.zip in .assetsignore: ${rule}`,
    );
}

export function renderInstallTemplate(template, metadata) {
  const values = {
    VERSION: metadata.version,
    ZIP_SHA256: metadata.archive.sha256,
    ZIP_BYTES: String(metadata.archive.bytes),
  };
  const found = [...template.matchAll(/{{([^}]+)}}/g)].map((match) => match[1]);
  for (const [key, digest] of Object.entries({
    TOOLS_SHA256: metadata.tools?.sha256,
    MANIFEST_SHA256: metadata.bundle?.manifestSha256,
  })) {
    if (!found.includes(key)) continue;
    if (!/^[a-f0-9]{64}$/.test(digest || ""))
      throw new Error(`Missing or invalid release digest: ${key}`);
    values[key] = digest;
  }
  if (
    Object.keys(values).some((key) => !found.includes(key)) ||
    found.some((key) => !Object.hasOwn(values, key))
  )
    throw new Error("Install template has missing or unknown placeholders");
  const html = template.replace(/{{([^}]+)}}/g, (_, key) => values[key]);
  if (html.includes("{{") || html.includes("}}"))
    throw new Error("Install template contains unresolved placeholders");
  return Buffer.from(html);
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function ensureDirectory(path) {
  try {
    await mkdir(path);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  await requireDirectory(path);
}

export async function stageRelease({
  releaseDirectory,
  websiteRoot = DEFAULT_WEBSITE_ROOT,
  expectedVersion,
} = {}) {
  const release = await verifyReleaseDirectory({
    releaseDirectory,
    expectedVersion,
  });
  const root = resolve(websiteRoot);
  const publicRoot = join(root, "public");
  const templates = join(root, "templates");
  await requireDirectory(root);
  await requireDirectory(publicRoot);
  await requireDirectory(templates);
  const template = await readRegularFile(join(templates, "install.html"));
  const rendered = renderInstallTemplate(
    template.toString("utf8"),
    release.metadata,
  );
  requireZipAllowlist(
    (await readRegularFile(join(publicRoot, ".assetsignore"))).toString("utf8"),
    release.metadata.version,
  );
  const installPath = join(publicRoot, "install.html");
  if (await pathExists(installPath)) await readRegularFile(installPath);
  const downloadRoot = join(publicRoot, "downloads");
  if (await pathExists(downloadRoot)) await requireDirectory(downloadRoot);
  const destination = join(downloadRoot, release.metadata.version);
  let existing = false;
  if (await pathExists(destination)) {
    const current = await verifyReleaseDirectory({
      releaseDirectory: destination,
      expectedVersion: release.metadata.version,
    });
    if (
      current.files.some(
        (file) =>
          !file.content.equals(
            release.files.find((candidate) => candidate.file === file.file)
              .content,
          ),
      )
    )
      throw new Error(
        "Existing release version is immutable; choose a new version for changed bytes",
      );
    existing = true;
  }
  let staging;
  let installTemporary;
  let createdDestination = false;
  try {
    await ensureDirectory(downloadRoot);
    if (!existing) {
      staging = await mkdtemp(join(downloadRoot, ".stage-"));
      for (const file of release.files)
        await writeFile(join(staging, file.file), file.content, { flag: "wx" });
      if (await pathExists(destination))
        throw new Error(
          "Release destination appeared during staging; refusing replacement",
        );
      await rename(staging, destination);
      staging = undefined;
      createdDestination = true;
    }
    installTemporary = join(publicRoot, `.install-${randomUUID()}.tmp`);
    await writeFile(installTemporary, rendered, { flag: "wx" });
    await rename(installTemporary, installPath);
    installTemporary = undefined;
  } catch (error) {
    const failedCleanup = [];
    for (const ownedPath of [
      staging,
      installTemporary,
      createdDestination ? destination : undefined,
    ].filter(Boolean)) {
      try {
        await rm(ownedPath, { recursive: true, force: true });
      } catch (cleanupError) {
        failedCleanup.push(
          new Error(`Cleanup failed for owned path ${ownedPath}`, {
            cause: cleanupError,
          }),
        );
      }
    }
    if (failedCleanup.length)
      throw new AggregateError(
        [error, ...failedCleanup],
        "Release staging failed and owned cleanup remains incomplete",
      );
    throw error;
  }
  const actual = await verifyReleaseDirectory({
    releaseDirectory: destination,
    expectedVersion: release.metadata.version,
  });
  const actualInstall = await readRegularFile(installPath);
  if (!actualInstall.equals(rendered))
    throw new Error("Rendered install page changed before read-back");
  return {
    version: release.metadata.version,
    downloadDirectory: destination,
    installPath,
    files: [
      ...actual.files.map(({ file, bytes, sha256: digest }) => ({
        path: `public/downloads/${release.metadata.version}/${file}`,
        bytes,
        sha256: digest,
      })),
      {
        path: "public/install.html",
        bytes: actualInstall.length,
        sha256: sha256(actualInstall),
      },
    ],
  };
}

export function parseOptions(argv, allowed) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    if (
      !allowed.includes(option) ||
      !argv[index + 1] ||
      argv[index + 1].startsWith("--") ||
      Object.hasOwn(result, option)
    )
      throw new Error(`Invalid or missing argument: ${option}`);
    result[option] = argv[index + 1];
  }
  return result;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = parseOptions(process.argv.slice(2), [
      "--release-dir",
      "--website-root",
      "--expected-version",
    ]);
    const result = await stageRelease({
      releaseDirectory: args["--release-dir"],
      websiteRoot: args["--website-root"],
      expectedVersion: args["--expected-version"],
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
