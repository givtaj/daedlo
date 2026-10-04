import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
const digestPattern = /^[a-f0-9]{64}$/;
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function keys(value, expected, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== [...expected].sort().join(",")
  )
    throw Error(`Invalid ${label} fields`);
}
function version(value) {
  const match = typeof value === "string" && value.match(semverPattern);
  if (
    !match ||
    match[4]
      ?.split(".")
      .some(
        (part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"),
      )
  )
    throw Error("Invalid release version");
  return match.slice(1, 4).map(Number);
}
function validateManifest(manifest) {
  keys(
    manifest,
    [
      "schemaVersion",
      "kind",
      "version",
      "source",
      "compatibility",
      "artifacts",
    ],
    "manifest",
  );
  if (
    manifest.schemaVersion !== 1 ||
    manifest.kind !== "browser-driver-release"
  )
    throw Error("Unsupported release schema");
  version(manifest.version);
  keys(manifest.source, ["commit", "dirty", "treeSha256"], "source");
  if (
    typeof manifest.source.commit !== "string" ||
    typeof manifest.source.treeSha256 !== "string" ||
    !/^[a-f0-9]{40}$/.test(manifest.source.commit) ||
    typeof manifest.source.dirty !== "boolean" ||
    !digestPattern.test(manifest.source.treeSha256)
  )
    throw Error("Invalid source identity");
  keys(
    manifest.compatibility,
    ["protocol", "nodeMajor", "rustVersion"],
    "compatibility",
  );
  if (
    !Number.isSafeInteger(manifest.compatibility.protocol) ||
    manifest.compatibility.protocol < 1 ||
    !Number.isSafeInteger(manifest.compatibility.nodeMajor) ||
    manifest.compatibility.nodeMajor < 1
  )
    throw Error("Invalid protocol or Node version");
  version(manifest.compatibility.rustVersion);
  if (manifest.compatibility.rustVersion.includes("-"))
    throw Error("Rust minimum version must be stable");
  keys(manifest.artifacts, ["runtime", "engine"], "artifact");
  for (const [id, name, extension] of [
    ["runtime", "@browser-driver/runtime", "tgz"],
    ["engine", "browser-driver-engine", "crate"],
  ]) {
    const artifact = manifest.artifacts[id];
    keys(artifact, ["file", "name", "version", "sha256", "bytes"], "artifact");
    if (artifact.name !== name || artifact.version !== manifest.version)
      throw Error("Artifact name/version mismatch");
    if (
      artifact.file !== `browser-driver-${id}-${manifest.version}.${extension}`
    )
      throw Error("Invalid artifact file path");
    if (
      typeof artifact.sha256 !== "string" ||
      !digestPattern.test(artifact.sha256)
    )
      throw Error("Invalid artifact digest");
    if (
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes < 1 ||
      artifact.bytes > 64 * 1024 * 1024
    )
      throw Error("Invalid artifact bytes");
  }
  return manifest;
}

export function createManifest({ version, source, artifacts }) {
  return structuredClone(
    validateManifest({
      schemaVersion: 1,
      kind: "browser-driver-release",
      version,
      source,
      compatibility: { protocol: 1, nodeMajor: 22, rustVersion: "1.96.0" },
      artifacts,
    }),
  );
}

async function readRegular(file, maximum) {
  const info = await fs.lstat(file);
  if (!info.isFile() || info.isSymbolicLink())
    throw Error("Release entry must be a regular file, not a symlink");
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maximum)
      throw Error("Invalid release file size");
    const bytes = await handle.readFile();
    if (bytes.length > maximum) throw Error("Invalid release file size");
    return bytes;
  } finally {
    await handle.close();
  }
}

function checkEnvironment(compatibility, environment) {
  if (environment.protocol !== compatibility.protocol)
    throw Error("Incompatible driver protocol");
  let node, rust;
  try {
    node = version(environment.nodeVersion);
  } catch {
    throw Error("Invalid Node version");
  }
  try {
    rust = version(environment.rustVersion);
  } catch {
    throw Error("Invalid Rust version");
  }
  if (
    environment.nodeVersion.includes("-") ||
    node[0] < compatibility.nodeMajor
  )
    throw Error("Incompatible Node version");
  const required = version(compatibility.rustVersion);
  const difference = rust.findIndex((part, index) => part !== required[index]);
  if (
    environment.rustVersion.includes("-") ||
    (difference !== -1 && rust[difference] < required[difference])
  )
    throw Error("Incompatible Rust version");
}

export async function verifyBundle(directory, options = {}) {
  directory = resolve(directory);
  const root = await fs.lstat(directory);
  if (!root.isDirectory() || root.isSymbolicLink())
    throw Error("Release bundle must be a directory, not a symlink");
  const bytes = await readRegular(join(directory, "manifest.json"), 64 * 1024);
  const manifestSha256 = sha256(bytes);
  if (
    options.expectedManifestSha256 !== undefined &&
    (!digestPattern.test(options.expectedManifestSha256) ||
      manifestSha256 !== options.expectedManifestSha256)
  )
    throw Error("Release manifest digest does not match the selected release");
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw Error("Invalid release manifest JSON");
  }
  validateManifest(manifest);
  if (options.environment !== undefined)
    checkEnvironment(manifest.compatibility, options.environment);
  for (const artifact of Object.values(manifest.artifacts)) {
    const bytes = await readRegular(
      join(directory, artifact.file),
      artifact.bytes,
    );
    if (bytes.length !== artifact.bytes || sha256(bytes) !== artifact.sha256)
      throw Error("Release artifact size or checksum mismatch");
  }
  const { runtime, engine } = manifest.artifacts;
  const expected = `${runtime.sha256}  ${runtime.file}\n${engine.sha256}  ${engine.file}\n${manifestSha256}  manifest.json\n`;
  const checksums = await readRegular(join(directory, "SHA256SUMS"), 4096);
  if (checksums.toString("utf8") !== expected)
    throw Error("Release checksum inventory mismatch");
  return { manifest, manifestSha256 };
}
