import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sha256, verifyBundle } from "./manifest.mjs";

const execute = promisify(execFile);
const digestPattern = /^[a-f0-9]{64}$/;
const pageSize = 100;
const pageLimit = 10;
const metadataLimit = 4 * 1024 * 1024;
const packageLimit = 64 * 1024 * 1024;

function repository(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9_.-]{1,100}$/.test(
      value,
    ) ||
    [".", ".."].includes(value.split("/")[1])
  )
    throw Error("Invalid GitHub repository; use owner/name");
  return value;
}
function versionParts(value) {
  const match =
    typeof value === "string" &&
    value.length <= 128 &&
    value.match(
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/,
    );
  if (
    !match ||
    match[4]
      ?.split(".")
      .some(
        (part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"),
      )
  )
    throw Error("Invalid or unsupported release version");
  return {
    core: match.slice(1, 4).map(BigInt),
    preview: match[4]?.split(".") || [],
  };
}
function compareVersions(left, right) {
  const a = versionParts(left),
    b = versionParts(right);
  for (let index = 0; index < 3; index++) {
    if (a.core[index] !== b.core[index])
      return a.core[index] > b.core[index] ? 1 : -1;
  }
  if (!a.preview.length || !b.preview.length)
    return Number(!a.preview.length) - Number(!b.preview.length);
  for (
    let index = 0;
    index < Math.max(a.preview.length, b.preview.length);
    index++
  ) {
    const x = a.preview[index],
      y = b.preview[index];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const numericX = /^\d+$/.test(x),
      numericY = /^\d+$/.test(y);
    if (numericX && numericY) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (numericX !== numericY) return numericX ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const releaseUrl = (repo, version) =>
  `https://github.com/${repo}/releases/tag/v${version}`;

// gh owns authentication. Arguments and endpoints are generated locally; neither
// release-body URLs nor browser_download_url are followed by this module.
function githubTransport() {
  async function request(endpoint, maximum, projection) {
    const args = [
      "api",
      "--hostname",
      "github.com",
      "--method",
      "GET",
      endpoint,
      "--header",
      `Accept: ${projection ? "application/vnd.github+json" : "application/octet-stream"}`,
      "--header",
      "X-GitHub-Api-Version: 2026-03-10",
    ];
    if (projection) args.push("--jq", projection);
    let stdout;
    try {
      ({ stdout } = await execute("gh", args, {
        encoding: "buffer",
        maxBuffer: maximum + 1,
        timeout: 60000,
        windowsHide: true,
        env: { ...process.env, GH_PROMPT_DISABLED: "1" },
      }));
    } catch {
      throw Error(
        "GitHub request failed; check gh authentication, connectivity and release access",
      );
    }
    if (!Buffer.isBuffer(stdout) || stdout.length > maximum)
      throw Error("GitHub response exceeds download size limit");
    if (!projection) return stdout;
    try {
      return JSON.parse(stdout.toString("utf8"));
    } catch {
      throw Error("Invalid GitHub metadata JSON");
    }
  }
  return {
    listReleases: ({ repo, page, perPage }) =>
      request(
        `repos/${repo}/releases?per_page=${perPage}&page=${page}`,
        metadataLimit,
        "[.[] | {id,tag_name,draft,prerelease}]",
      ),
    getRelease: ({ repo, tag }) =>
      request(
        `repos/${repo}/releases/tags/${tag}`,
        metadataLimit,
        "{id,tag_name,draft,prerelease,assets:[.assets[] | {id,name,size,state,digest}]}",
      ),
    downloadAsset: ({ repo, assetId, maxBytes }) =>
      request(`repos/${repo}/releases/assets/${assetId}`, maxBytes),
  };
}
function releaseMetadata(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !positiveInteger(value.id) ||
    typeof value.tag_name !== "string" ||
    typeof value.draft !== "boolean" ||
    typeof value.prerelease !== "boolean"
  )
    throw Error("Invalid GitHub release metadata");
  if (value.draft) return null;
  if (!value.tag_name.startsWith("v"))
    throw Error(
      "Unsupported release tag; expected v followed by a release version",
    );
  const version = value.tag_name.slice(1);
  versionParts(version);
  return version;
}

export async function checkForUpdates({
  repo,
  currentVersion,
  channel = "stable",
  transport = githubTransport(),
}) {
  repository(repo);
  versionParts(currentVersion);
  if (!["stable", "preview"].includes(channel))
    throw Error("Invalid release channel");
  const seenIds = new Set(),
    seenVersions = new Set();
  let latest = null,
    complete = false;
  for (let page = 1; page <= pageLimit; page++) {
    const releases = await transport.listReleases({
      repo,
      page,
      perPage: pageSize,
    });
    if (!Array.isArray(releases) || releases.length > pageSize)
      throw Error("Invalid GitHub release list metadata");
    for (const release of releases) {
      const version = releaseMetadata(release);
      if (seenIds.has(release.id))
        throw Error(
          "Release pagination repeated an identity; discovery is incomplete",
        );
      seenIds.add(release.id);
      if (version === null) continue;
      if (seenVersions.has(version))
        throw Error("Duplicate release version metadata");
      seenVersions.add(version);
      if (
        channel === "stable" &&
        (release.prerelease || versionParts(version).preview.length > 0)
      )
        continue;
      if (
        compareVersions(version, currentVersion) > 0 &&
        (!latest || compareVersions(version, latest) > 0)
      )
        latest = version;
    }
    if (releases.length < pageSize) {
      complete = true;
      break;
    }
  }
  if (!complete)
    throw Error("Release pagination limit reached; discovery is incomplete");
  return {
    status: latest ? "update_available" : "up_to_date",
    repo,
    currentVersion,
    channel,
    version: latest,
    tag: latest ? `v${latest}` : null,
    url: latest ? releaseUrl(repo, latest) : null,
    compatibility: "not_checked",
  };
}

async function lstat(file) {
  try {
    return await fs.lstat(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function checkedOutput(input) {
  if (
    typeof input !== "string" ||
    !input ||
    input.includes("\0") ||
    input.split(/[\\/]/).includes("..")
  )
    throw Error("Output requires an explicit path without traversal");
  const absolute = path.resolve(input),
    root = path.parse(absolute).root;
  let current = root;
  for (const part of absolute
    .slice(root.length)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, part);
    const info = await lstat(current);
    if (info?.isSymbolicLink())
      throw Error("Output path must not contain symlinks");
    if (current !== absolute && !info?.isDirectory())
      throw Error("Output parent path must already exist as a directory");
    if (current === absolute && info)
      throw Error("Output destination already exists");
  }
  if (absolute === root) throw Error("Output destination already exists");
  return absolute;
}
function requiredAssets(release, version) {
  if (!Array.isArray(release.assets) || release.assets.length > 1000)
    throw Error("Invalid release asset metadata");
  const byName = new Map(),
    ids = new Set();
  for (const asset of release.assets) {
    if (
      !asset ||
      !positiveInteger(asset.id) ||
      !positiveInteger(asset.size) ||
      typeof asset.name !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(asset.name) ||
      asset.state !== "uploaded" ||
      !(
        asset.digest === null ||
        (typeof asset.digest === "string" &&
          /^sha256:[a-f0-9]{64}$/.test(asset.digest))
      )
    )
      throw Error("Invalid release asset name, size, state or digest");
    if (byName.has(asset.name) || ids.has(asset.id))
      throw Error("Duplicate release asset identity");
    byName.set(asset.name, asset);
    ids.add(asset.id);
  }
  return [
    ["manifest.json", 64 * 1024],
    ["SHA256SUMS", 4096],
    [`browser-driver-runtime-${version}.tgz`, packageLimit],
    [`browser-driver-engine-${version}.crate`, packageLimit],
  ].map(([name, limit]) => {
    const asset = byName.get(name);
    if (!asset) throw Error("Required release file is missing");
    if (asset.size > limit) throw Error("Release asset size exceeds limit");
    return asset;
  });
}
const sameIdentity = (left, right) =>
  left &&
  right &&
  left.dev === right.dev &&
  left.ino === right.ino &&
  right.isDirectory() &&
  !right.isSymbolicLink();
async function removeOwned(directory, identity, recursive) {
  const current = await lstat(directory);
  if (!current) return;
  if (!sameIdentity(identity, current))
    throw Error(
      "Download directory ownership changed; retained for inspection",
    );
  if (recursive) await fs.rm(directory, { recursive: true });
  else await fs.rmdir(directory);
}

export async function downloadRelease({
  repo,
  version,
  output,
  expectedManifestSha256,
  environment,
  transport = githubTransport(),
}) {
  repository(repo);
  versionParts(version);
  if (
    typeof expectedManifestSha256 !== "string" ||
    !digestPattern.test(expectedManifestSha256)
  )
    throw Error("Download requires an explicit trusted manifest SHA256 digest");
  const destination = await checkedOutput(output),
    parent = path.dirname(destination);
  const parentIdentity = await fs.lstat(parent);
  const release = await transport.getRelease({ repo, tag: `v${version}` });
  if (releaseMetadata(release) !== version)
    throw Error("Exact non-draft release version is required");
  const assets = requiredAssets(release, version);
  await checkedOutput(destination);
  if (!sameIdentity(parentIdentity, await lstat(parent)))
    throw Error("Output parent path changed");
  const stage = await fs.mkdtemp(
    path.join(parent, ".browser-driver-download-"),
  );
  const stageIdentity = await fs.lstat(stage);
  let reservation;
  try {
    for (const asset of assets) {
      const bytes = await transport.downloadAsset({
        repo,
        assetId: asset.id,
        maxBytes: asset.size,
      });
      if (!Buffer.isBuffer(bytes) || bytes.length !== asset.size)
        throw Error("Downloaded asset size mismatch");
      const digest = sha256(bytes);
      if (asset.digest !== null && asset.digest !== `sha256:${digest}`)
        throw Error("Downloaded asset digest mismatch");
      if (asset.name === "manifest.json") {
        if (digest !== expectedManifestSha256)
          throw Error(
            "Downloaded manifest digest does not match the trusted release",
          );
        let manifest;
        try {
          manifest = JSON.parse(bytes.toString("utf8"));
        } catch {
          throw Error("Invalid downloaded manifest JSON");
        }
        if (manifest?.version !== version)
          throw Error("Downloaded manifest version mismatch");
        if (manifest.source?.dirty !== false)
          throw Error(
            "Published release must have a clean source identity, not dirty source",
          );
      }
      if (!sameIdentity(stageIdentity, await lstat(stage)))
        throw Error("Download staging ownership changed");
      await fs.writeFile(path.join(stage, asset.name), bytes, {
        flag: "wx",
        mode: 0o600,
      });
    }
    const verified = await verifyBundle(stage, {
      expectedManifestSha256,
      environment,
    });
    if (
      verified.manifest.version !== version ||
      verified.manifest.source.dirty !== false
    )
      throw Error("Downloaded release identity mismatch");
    await checkedOutput(destination);
    if (!sameIdentity(parentIdentity, await lstat(parent)))
      throw Error("Output parent path changed");
    // Reserve the destination exclusively so an existing directory is not replaced.
    // Only the verified staging directory is renamed into this empty reservation.
    await fs.mkdir(destination, { mode: 0o700 });
    reservation = await fs.lstat(destination);
    if (!sameIdentity(reservation, await lstat(destination)))
      throw Error("Output reservation changed");
    if (!sameIdentity(stageIdentity, await lstat(stage)))
      throw Error("Download staging ownership changed before publication");
    await fs.rename(stage, destination);
    reservation = null;
    return {
      status: "downloaded",
      repo,
      version,
      tag: `v${version}`,
      url: releaseUrl(repo, version),
      bundlePath: destination,
      manifestSha256: verified.manifestSha256,
      compatibility: environment === undefined ? "not_checked" : "checked",
    };
  } catch (error) {
    const retained = [];
    if (reservation) {
      try {
        await removeOwned(destination, reservation, false);
      } catch {
        retained.push(destination);
      }
    }
    try {
      await removeOwned(stage, stageIdentity, true);
    } catch {
      retained.push(stage);
    }
    if (retained.length)
      Object.assign(error, { cleanupFailed: true, retainedPaths: retained });
    throw error;
  }
}
