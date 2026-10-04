import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { verifyBundle } from "./manifest.mjs";

const MARKER = ".browser-driver-release-store.json";
const LOCK = ".mutation.lock";
const STATE = "current.json";
const digestPattern = /^[a-f0-9]{64}$/;
const versionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const emptyState = () => ({
  schemaVersion: 1,
  current: null,
  previous: null,
  history: [],
});

async function lstat(file) {
  try {
    return await fs.lstat(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function checkedPath(input) {
  if (
    typeof input !== "string" ||
    !input ||
    input.split(/[\\/]/).includes("..")
  )
    throw Error("An explicit path without traversal is required");
  const absolute = path.resolve(input);
  const parts = absolute
    .slice(path.parse(absolute).root.length)
    .split(path.sep)
    .filter(Boolean);
  let current = path.parse(absolute).root;
  for (const part of parts) {
    current = path.join(current, part);
    const stat = await lstat(current);
    if (stat?.isSymbolicLink())
      throw Error("Release paths must not contain symlinks");
  }
  return absolute;
}
const contains = (parent, child) => {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
};
async function readJson(file) {
  const stat = await lstat(file);
  if (!stat?.isFile() || stat.isSymbolicLink())
    throw Error("Expected a regular release-store metadata file");
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    throw Error("Invalid release-store metadata");
  }
}
async function ownedStore(store, create) {
  const stat = await lstat(store);
  if (!stat) {
    if (!create) return false;
    await fs.mkdir(store); // The caller chooses an existing parent; no outside directories are created.
  } else if (!stat.isDirectory() || stat.isSymbolicLink())
    throw Error("Release store must be an owned directory");
  const marker = path.join(store, MARKER);
  if (!(await lstat(marker))) {
    if (!create || (await fs.readdir(store)).length)
      throw Error("Refusing an unowned nonempty release store");
    try {
      await fs.writeFile(
        marker,
        JSON.stringify({
          schemaVersion: 1,
          kind: "browser-driver-release-store",
          ownerId: randomUUID(),
        }) + "\n",
        { flag: "wx", mode: 0o600 },
      );
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  const owner = await readJson(marker);
  if (
    owner.schemaVersion !== 1 ||
    owner.kind !== "browser-driver-release-store" ||
    typeof owner.ownerId !== "string" ||
    !/^[0-9a-f-]{36}$/.test(owner.ownerId) ||
    Object.keys(owner).sort().join(",") !== "kind,ownerId,schemaVersion"
  )
    throw Error("Invalid release-store ownership marker");
  return true;
}
function validPin(pin) {
  return (
    pin === null ||
    (pin &&
      typeof pin === "object" &&
      !Array.isArray(pin) &&
      Object.keys(pin).sort().join(",") === "manifestSha256,version" &&
      typeof pin.version === "string" &&
      versionPattern.test(pin.version) &&
      typeof pin.manifestSha256 === "string" &&
      digestPattern.test(pin.manifestSha256))
  );
}
const samePin = (left, right) =>
  left === null || right === null
    ? left === right
    : left.version === right.version &&
      left.manifestSha256 === right.manifestSha256;
async function readState(store) {
  const file = path.join(store, STATE);
  if (!(await lstat(file))) return emptyState();
  const state = await readJson(file);
  if (
    state.schemaVersion !== 1 ||
    Object.keys(state).sort().join(",") !==
      "current,history,previous,schemaVersion" ||
    !validPin(state.current) ||
    !validPin(state.previous) ||
    !Array.isArray(state.history)
  )
    throw Error("Invalid release-store state");
  const versions = new Map();
  const remember = (pin) => {
    if (!pin) return;
    if (
      versions.has(pin.version) &&
      versions.get(pin.version) !== pin.manifestSha256
    )
      throw Error("Release version content changed in history");
    versions.set(pin.version, pin.manifestSha256);
  };
  for (const entry of state.history) {
    if (
      !entry ||
      Object.keys(entry).sort().join(",") !== "action,at,current,previous" ||
      !["update", "rollback"].includes(entry.action) ||
      typeof entry.at !== "string" ||
      !Number.isFinite(Date.parse(entry.at)) ||
      !entry.current ||
      !validPin(entry.current) ||
      !validPin(entry.previous)
    )
      throw Error("Invalid release-store history");
    remember(entry.current);
    remember(entry.previous);
  }
  remember(state.current);
  remember(state.previous);
  const last = state.history.at(-1);
  if (
    last
      ? !samePin(last.current, state.current) ||
        !samePin(last.previous, state.previous)
      : state.current !== null || state.previous !== null
  )
    throw Error("Release-store state does not match its history");
  return state;
}
async function releasePath(store, version) {
  if (!versionPattern.test(version))
    throw Error("Invalid release version path");
  return checkedPath(path.join(store, "releases", version));
}
async function verifyPin(store, pin, environment) {
  if (!pin) return null;
  const bundle = await releasePath(store, pin.version);
  const verified = await verifyBundle(bundle, {
    expectedManifestSha256: pin.manifestSha256,
    environment,
  });
  if (verified.manifest.version !== pin.version)
    throw Error("Stored release version does not match its pin");
  return verified;
}
function publicStatus(store, state) {
  const expose = (pin) =>
    pin && { ...pin, bundlePath: path.join(store, "releases", pin.version) };
  return {
    store,
    current: expose(state.current),
    previous: expose(state.previous),
    history: structuredClone(state.history),
  };
}
async function withLock(store, action) {
  const file = path.join(store, LOCK);
  let handle;
  try {
    handle = await fs.open(file, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST")
      throw Error("Release store is locked by another mutation");
    throw error;
  }
  const identity = await handle.stat();
  try {
    await handle.writeFile(
      JSON.stringify({
        pid: process.pid,
        nonce: randomUUID(),
        createdAt: new Date().toISOString(),
      }) + "\n",
    );
    return await action();
  } finally {
    await handle.close();
    const current = await lstat(file);
    if (
      current?.isFile() &&
      current.dev === identity.dev &&
      current.ino === identity.ino
    )
      await fs.unlink(file);
    else throw Error("Release mutation lock changed; retained for inspection");
  }
}
async function writeState(store, state) {
  const destination = path.join(store, STATE),
    existing = await lstat(destination);
  if (existing && (!existing.isFile() || existing.isSymbolicLink()))
    throw Error("Invalid current release state path");
  const temporary = path.join(store, `.current-${randomUUID()}.json`);
  let handle;
  try {
    handle = await fs.open(temporary, "wx", 0o600);
    await handle.writeFile(JSON.stringify(state, null, 2) + "\n");
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, destination);
  } finally {
    await handle?.close();
    if (await lstat(temporary)) await fs.unlink(temporary);
  }
}
function nextState(state, action, current, previous) {
  return {
    schemaVersion: 1,
    current,
    previous,
    history: [
      ...state.history,
      { action, at: new Date().toISOString(), current, previous },
    ],
  };
}
function requireCleanSource(manifest, allowDirty) {
  if (manifest.source.dirty && allowDirty !== true)
    throw Error("Dirty source requires explicit allowDirty approval");
}
function requireEnvironment(environment) {
  if (
    !environment ||
    !Number.isSafeInteger(environment.protocol) ||
    typeof environment.nodeVersion !== "string" ||
    typeof environment.rustVersion !== "string"
  )
    throw Error(
      "Mutation requires explicit protocol, Node and Rust environment capabilities",
    );
}

export async function updateRelease({
  store,
  bundle,
  expectedManifestSha256,
  environment,
  allowDirty = false,
}) {
  requireEnvironment(environment);
  if (
    typeof expectedManifestSha256 !== "string" ||
    !digestPattern.test(expectedManifestSha256)
  )
    throw Error("Update requires an explicit trusted manifest SHA256 digest");
  const root = await checkedPath(store),
    source = await checkedPath(bundle);
  if (contains(root, source) || contains(source, root))
    throw Error(
      "Source bundle and release store must be separate, non-nested directories",
    );
  const verified = await verifyBundle(source, {
    expectedManifestSha256,
    environment,
  });
  requireCleanSource(verified.manifest, allowDirty);
  const version = verified.manifest.version;
  if (!versionPattern.test(version))
    throw Error("Invalid release version path");
  await ownedStore(root, true);
  return withLock(root, async () => {
    const state = await readState(root);
    for (const entry of state.history) {
      for (const historical of [entry.current, entry.previous]) {
        if (
          historical?.version === version &&
          historical.manifestSha256 !== verified.manifestSha256
        )
          throw Error(
            "Release version has different content in activation history",
          );
      }
    }
    const releases = await checkedPath(path.join(root, "releases"));
    if (!(await lstat(releases))) await fs.mkdir(releases);
    const destination = await releasePath(root, version);
    const pin = { version, manifestSha256: verified.manifestSha256 };
    if (await lstat(destination)) {
      try {
        await verifyPin(root, pin, environment);
      } catch {
        throw Error(
          "Release version already exists with different or tampered content",
        );
      }
    } else {
      const temporary = path.join(releases, `.incoming-${randomUUID()}`);
      await fs.mkdir(temporary);
      try {
        const files = [
          "manifest.json",
          "SHA256SUMS",
          verified.manifest.artifacts.runtime.file,
          verified.manifest.artifacts.engine.file,
        ];
        for (const file of files) {
          if (file !== path.basename(file) || file === "." || file === "..")
            throw Error("Invalid release artifact path");
          await fs.copyFile(
            path.join(source, file),
            path.join(temporary, file),
            constants.COPYFILE_EXCL,
          );
        }
        await verifyBundle(temporary, { expectedManifestSha256, environment });
        await fs.rename(temporary, destination);
      } finally {
        // This exact temporary directory was created by this invocation only.
        if (await lstat(temporary)) await fs.rm(temporary, { recursive: true });
      }
    }
    if (samePin(state.current, pin)) return publicStatus(root, state);
    const next = nextState(state, "update", pin, state.current);
    await writeState(root, next);
    return publicStatus(root, next);
  });
}

export async function rollbackRelease({
  store,
  environment,
  allowDirty = false,
}) {
  requireEnvironment(environment);
  const root = await checkedPath(store);
  if (!(await ownedStore(root, false)))
    throw Error("No owned release store to roll back");
  return withLock(root, async () => {
    const state = await readState(root);
    if (!state.previous)
      throw Error("No previous release is available for rollback");
    const prior = await verifyPin(root, state.previous, environment);
    requireCleanSource(prior.manifest, allowDirty);
    const next = nextState(state, "rollback", state.previous, state.current);
    await writeState(root, next);
    return publicStatus(root, next);
  });
}

export async function releaseStatus({ store }) {
  const root = await checkedPath(store);
  const state = (await ownedStore(root, false))
    ? await readState(root)
    : emptyState();
  const integrity = async (pin) => {
    if (!pin) return null;
    try {
      await verifyPin(root, pin);
      return { ok: true };
    } catch {
      return {
        ok: false,
        code: "release_integrity",
        error: "Stored release failed integrity verification",
      };
    }
  };
  return {
    ...publicStatus(root, state),
    integrity: {
      current: await integrity(state.current),
      previous: await integrity(state.previous),
    },
  };
}
