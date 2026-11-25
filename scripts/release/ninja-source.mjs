import { constants } from "node:fs";
import fs from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import { sha256 } from "./manifest.mjs";

const maxFile = 64 * 1024 * 1024;
const maxSnapshot = 256 * 1024 * 1024;
const fail = (message) => {
  throw Error(message);
};

const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;

export const registrationFingerprint = (registration) =>
  sha256(JSON.stringify(canonical(registration)));

export function localPath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\\") ||
    /[\x00-\x1f\x7f]/.test(value) ||
    isAbsolute(value) ||
    value.split("/").some((p) => !p || p === "." || p === "..")
  )
    fail("Registration paths must be safe relative file paths");
  return value;
}
export async function stat(path) {
  try {
    return await fs.lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
export async function checkedPath(
  path,
  { missing = false, directory = false } = {},
) {
  if (
    typeof path !== "string" ||
    !isAbsolute(path) ||
    path.includes("\0") ||
    path.split(/[\\/]/).includes("..")
  )
    fail("Explicit absolute paths without traversal are required");
  const full = resolve(path),
    parts = full.split(sep).filter(Boolean);
  let current = sep;
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    const info = await stat(current);
    if (!info) {
      if (missing && i === parts.length - 1) return full;
      fail("A required installation path is missing");
    }
    if (info.isSymbolicLink()) fail("Symlink paths are unsupported");
    if (i < parts.length - 1 || directory) {
      if (!info.isDirectory()) fail("Expected a regular directory");
    } else if (!info.isFile() && !info.isDirectory())
      fail("Expected a regular file or directory");
  }
  return full;
}
export async function bytes(path, limit = maxFile) {
  await checkedPath(path);
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit)
      fail("Expected a bounded regular file");
    const value = await handle.readFile();
    if (value.length > limit) fail("File exceeds size limit");
    return value;
  } finally {
    await handle.close();
  }
}

export function validateRegisteredFiles(files) {
  if (
    !Array.isArray(files) ||
    !files.length ||
    files.length > 4096 ||
    new Set(files).size !== files.length
  )
    fail("Registration requires a closed file inventory");
  for (const file of files) {
    localPath(file);
    if (
      file
        .split("/")
        .some((part) =>
          ["node_modules", "target", ".git", ".cargo"].includes(part),
        )
    )
      fail(
        "Generated dependencies, Cargo configuration and build outputs cannot be registered source",
      );
  }
}

export async function snapshotRegisteredSource(registration) {
  validateRegisteredFiles(registration.files);
  const root = await checkedPath(registration.sourceRoot, { directory: true });
  let total = 0;
  const files = [];
  for (const file of [...registration.files].sort()) {
    const path = join(root, file),
      content = await bytes(path),
      info = await fs.lstat(path);
    total += content.length;
    if (total > maxSnapshot)
      fail("Registered source snapshot exceeds size limit");
    files.push({
      file,
      bytes: content.length,
      sha256: sha256(content),
      mode: info.mode & 0o777,
    });
  }
  const registrationSha256 = registrationFingerprint(registration);
  return {
    sha256: sha256(JSON.stringify({ files, registrationSha256 })),
    registrationSha256,
    files,
  };
}
