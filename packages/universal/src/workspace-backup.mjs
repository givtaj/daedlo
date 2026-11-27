import fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { loadTools } from "./tools.mjs";
import { checkedEvidence } from "./evidence.mjs";

const FORMAT = "daedlo-workspace-backup/1";
const MAX_FILES = 100000,
  MAX_BYTES = 4 * 1024 ** 3,
  MAX_FILE = 1024 ** 3;
const MAX_DEPTH = 32,
  MAX_PROJECTS = 1000,
  MAX_MANIFEST = 64 * 1024 ** 2;
const SHA = /^[a-f0-9]{64}$/,
  ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const pending = new Map(),
  active = new Set();
const hash = (value) => createHash("sha256").update(value).digest("hex");
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) =>
  object(value) &&
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const same = (a, b) => a && b && a.dev === b.dev && a.ino === b.ino;
const encoded = (value) => Buffer.from(JSON.stringify(value) + "\n");
function fail(code, extra = {}) {
  throw Object.assign(
    Error(
      {
        backup_invalid: "Backup paths or options are invalid.",
        backup_limit: "The workspace exceeds the supported backup bounds.",
        backup_source_changed:
          "Workspace data changed during backup. The incomplete output was retained.",
        backup_busy:
          "An active or interrupted writer owns this workspace. Inspect and explicitly recover ownership before retrying.",
        backup_output_exists:
          "The output already exists. Preserve it and select a new directory.",
        backup_incomplete: "The backup has no complete verified manifest.",
        backup_corrupt:
          "Backup data or its inventory does not match its manifest.",
        backup_reference:
          "A stored reference cannot be verified. Preserve the workspace and repair it before backup.",
        backup_storage:
          "Backup storage failed. The incomplete output was retained.",
        backup_cleanup_incomplete:
          "Backup cleanup is incomplete. Retry the same operation to close retained owned handles.",
        restore_invalid:
          "Restore requires a verified compatible backup and a new disjoint directory.",
        restore_storage:
          "Restore failed. The incomplete destination was retained.",
      }[code] ?? "Workspace backup or restore was refused.",
    ),
    { code, ...extra },
  );
}
const absolute = (path) =>
  typeof path === "string" && isAbsolute(path) && resolve(path) === path;
const disjoint = (a, b) =>
  a !== b && !a.startsWith(b + sep) && !b.startsWith(a + sep);
const safeRelative = (path) =>
  typeof path === "string" &&
  path.length > 0 &&
  path.length <= 4096 &&
  !path.includes("\\") &&
  !path.includes("\0") &&
  !isAbsolute(path) &&
  path.split("/").every((part) => part && part !== "." && part !== "..");
const optional = (path) =>
  fs.lstat(path, { bigint: true }).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
const fingerprint = (stat) => ({
  dev: String(stat.dev),
  ino: String(stat.ino),
  bytes: Number(stat.size),
  mtimeNs: String(stat.mtimeNs),
  ctimeNs: String(stat.ctimeNs),
  links: Number(stat.nlink),
});
const stable = (a, b) => isDeepStrictEqual(fingerprint(a), fingerprint(b));
async function directory(path) {
  const { journalFilesystem: io } = await loadTools("run-journal");
  return io.directory(path);
}
function resources(key) {
  const handles = [];
  return {
    add(handle) {
      handles.push({ handle, failed: false });
      return handle;
    },
    async open(...args) {
      return this.add(await fs.open(...args));
    },
    async close(handle) {
      const index = handles.findIndex((item) => item.handle === handle);
      try {
        await handle.close();
        if (index >= 0) handles.splice(index, 1);
      } catch (error) {
        if (index >= 0) handles[index].failed = true;
        throw error;
      }
    },
    async cleanup() {
      while (handles.length) {
        if (handles[0].failed) {
          pending.set(key, handles);
          fail("backup_cleanup_incomplete", {
            retainedOutput: key,
            pendingHandles: handles.length,
          });
        }
        try {
          await handles[0].handle.close();
          handles.shift();
        } catch {
          handles[0].failed = true;
          pending.set(key, handles);
          fail("backup_cleanup_incomplete", {
            retainedOutput: key,
            pendingHandles: handles.length,
          });
        }
      }
      pending.delete(key);
    },
  };
}
async function retryCleanup(key) {
  const handles = pending.get(key);
  if (!handles) return;
  while (handles.length) {
    try {
      await handles[0].handle.retry?.();
      await handles[0].handle.close();
      handles.shift();
    } catch {
      fail("backup_cleanup_incomplete", {
        retainedOutput: key,
        pendingHandles: handles.length,
      });
    }
  }
  pending.delete(key);
}
async function sync(path, owned) {
  const handle = await owned.open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  await handle.sync();
  await owned.close(handle);
}
async function writeNew(path, bytes, owned) {
  await directory(dirname(path));
  const handle = await owned.open(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  await handle.writeFile(bytes);
  await handle.sync();
  await owned.close(handle);
  await sync(dirname(path), owned);
}
async function readFile(path, owned, limit = MAX_FILE) {
  await directory(dirname(path));
  const before = await fs.lstat(path, { bigint: true });
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size > BigInt(limit)
  )
    fail("backup_corrupt");
  const handle = await owned.open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  if (!stable(before, await handle.stat({ bigint: true })))
    fail("backup_source_changed");
  const bytes = await handle.readFile();
  if (
    bytes.length !== Number(before.size) ||
    !stable(before, await handle.stat({ bigint: true })) ||
    !stable(before, await fs.lstat(path, { bigint: true }))
  )
    fail("backup_source_changed");
  await owned.close(handle);
  return { bytes, stat: before };
}
async function digest(path, owned, before) {
  const handle = await owned.open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  if (!stable(before, await handle.stat({ bigint: true })))
    fail("backup_source_changed");
  const digest = createHash("sha256"),
    buffer = Buffer.alloc(65536);
  let offset = 0;
  while (offset < Number(before.size)) {
    const { bytesRead } = await handle.read(
      buffer,
      0,
      Math.min(buffer.length, Number(before.size) - offset),
      offset,
    );
    if (!bytesRead) fail("backup_source_changed");
    digest.update(buffer.subarray(0, bytesRead));
    offset += bytesRead;
  }
  if (
    !stable(before, await handle.stat({ bigint: true })) ||
    !stable(before, await fs.lstat(path, { bigint: true }))
  )
    fail("backup_source_changed");
  await owned.close(handle);
  return digest.digest("hex");
}
async function inventory(
  root,
  owned,
  { ignore = new Map(), databaseHash } = {},
) {
  const entries = [],
    groups = new Map();
  let bytes = 0;
  async function walk(path, depth) {
    if (depth > MAX_DEPTH || entries.length >= MAX_FILES) fail("backup_limit");
    const full = path ? join(root, path) : root,
      stat = await fs.lstat(full, { bigint: true });
    if (ignore.has(path)) {
      const expected = ignore.get(path);
      if (
        !stable(stat, expected.stat) ||
        (await digest(full, owned, stat)) !== expected.sha256
      )
        fail("backup_source_changed");
      return;
    }
    if (
      databaseHash !== undefined &&
      /^projects\/[^/]+\/run-journals\/writer\.lock$/.test(path)
    )
      fail("backup_source_changed");
    if (stat.isSymbolicLink() || !(stat.isDirectory() || stat.isFile()))
      fail("backup_invalid");
    const entry = {
      path,
      type: stat.isDirectory() ? "directory" : "file",
      ...fingerprint(stat),
    };
    entries.push(entry);
    if (stat.isDirectory()) {
      const names = (await fs.readdir(full)).sort();
      if (names.length > MAX_FILES) fail("backup_limit");
      for (const name of names) {
        const child = path ? path + "/" + name : name;
        if (!safeRelative(child)) fail("backup_invalid");
        await walk(child, depth + 1);
      }
      if (!stable(stat, await fs.lstat(full, { bigint: true })))
        fail("backup_source_changed");
    } else {
      if (
        stat.size > BigInt(MAX_FILE) ||
        (bytes += Number(stat.size)) > MAX_BYTES
      )
        fail("backup_limit");
      // The controlled SQLite hook owns every raw source-database read descriptor.
      entry.sha256 =
        path === "workspace.sqlite" && databaseHash !== undefined
          ? databaseHash
          : await digest(full, owned, stat);
      const key = `${stat.dev}:${stat.ino}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
  }
  await directory(root);
  await walk("", 0);
  for (const group of groups.values()) {
    if (group.some((entry) => entry.links !== group.length))
      fail("backup_invalid");
    if (group.length > 1)
      for (const entry of group) entry.linkGroup = group[0].path;
  }
  return entries;
}
async function copyFile(source, destination, entry, owned) {
  await directory(dirname(source));
  await directory(dirname(destination));
  const before = await fs.lstat(source, { bigint: true }),
    expected = Object.fromEntries(
      Object.keys(fingerprint(before)).map((key) => [key, entry[key]]),
    );
  if (!before.isFile() || !isDeepStrictEqual(fingerprint(before), expected))
    fail("backup_source_changed");
  const input = await owned.open(
    source,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  if (!stable(before, await input.stat({ bigint: true })))
    fail("backup_source_changed");
  const output = await owned.open(
    destination,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  const digest = createHash("sha256"),
    buffer = Buffer.alloc(65536);
  let offset = 0;
  while (offset < entry.bytes) {
    const { bytesRead } = await input.read(
      buffer,
      0,
      Math.min(buffer.length, entry.bytes - offset),
      offset,
    );
    if (!bytesRead) fail("backup_source_changed");
    digest.update(buffer.subarray(0, bytesRead));
    let written = 0;
    while (written < bytesRead) {
      const result = await output.write(
        buffer,
        written,
        bytesRead - written,
        offset + written,
      );
      if (!result.bytesWritten) fail("backup_storage");
      written += result.bytesWritten;
    }
    offset += bytesRead;
  }
  if (
    digest.digest("hex") !== entry.sha256 ||
    !stable(before, await input.stat({ bigint: true })) ||
    !stable(before, await fs.lstat(source, { bigint: true }))
  )
    fail("backup_source_changed");
  await output.sync();
  await owned.close(output);
  await owned.close(input);
}
async function reserve(path, owned) {
  await directory(dirname(path));
  try {
    await fs.mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (error.code === "EEXIST") fail("backup_output_exists");
    throw error;
  }
  const identity = await directory(path);
  await sync(dirname(path), owned);
  return identity;
}
async function guardOutput(path, identity) {
  if (!same(identity, await directory(path))) fail("backup_source_changed");
}
function checkedMarker(bytes) {
  let marker;
  try {
    marker = JSON.parse(bytes);
  } catch {
    fail("backup_invalid");
  }
  if (
    !exact(marker, ["schemaVersion", "kind", "workspaceId", "formats"]) ||
    marker.schemaVersion !== 1 ||
    marker.kind !== "daedlo-workspace" ||
    !ID.test(marker.workspaceId) ||
    !isDeepStrictEqual(marker.formats, { managedRun: 1, runJournal: 1 })
  )
    fail("backup_invalid");
  return marker;
}
async function projects(root) {
  const base = join(root, "projects");
  if (!(await optional(base))) return [];
  await directory(base);
  const names = (await fs.readdir(base)).sort();
  if (names.length > MAX_PROJECTS) fail("backup_limit");
  for (const name of names) {
    if (!ID.test(name)) fail("backup_invalid");
    await directory(join(base, name));
  }
  return names;
}
function publicResult(manifest, root, sha256) {
  return {
    format: FORMAT,
    backupId: manifest.backupId,
    workspaceId: manifest.workspaceId,
    catalogId: manifest.catalogId,
    catalogVersion: manifest.catalogVersion,
    root,
    files: manifest.entries.filter((e) => e.type === "file").length,
    bytes: manifest.entries
      .filter((e) => e.type === "file")
      .reduce((n, e) => n + e.bytes, 0),
    sha256,
  };
}
function checkedOptions(value, required, optionalKeys = []) {
  if (
    !object(value) ||
    Object.keys(value).some(
      (key) => ![...required, ...optionalKeys].includes(key),
    ) ||
    required.some((key) => !absolute(value[key])) ||
    (value.onProgress !== undefined && typeof value.onProgress !== "function")
  )
    fail("backup_invalid");
}
async function assertAbsent(...paths) {
  for (const path of paths) {
    await directory(dirname(path));
    if (await optional(path)) fail("backup_output_exists");
  }
}
async function validateReferences(snapshot, entries, root, owned) {
  const files = new Map(
      entries.filter((e) => e.type === "file").map((e) => [e.path, e]),
    ),
    targets = new Map(
      (snapshot.rows.targets ?? []).map((row) => [row.id, row]),
    );
  const compressions = new Map();
  let expandedBytes = 0;
  for (const row of snapshot.rows.journal_compressions ?? []) {
    const value = snapshot.readCompression(row.target_id, row.run_id);
    if ((expandedBytes += value.bytes.length) > MAX_BYTES) fail("backup_limit");
    const entry = files.get(
      `projects/${value.record.projectId}/run-journals/${row.run_id}.jsonl`,
    );
    const expected = value.state === "active" ? value.markerBytes : value.bytes;
    if (
      !entry ||
      entry.dev !== value.binding.dev ||
      entry.ino !== value.binding.ino ||
      entry.bytes !== expected.length ||
      entry.sha256 !== hash(expected)
    )
      fail("backup_reference");
    compressions.set(`${row.target_id}\0${row.run_id}`, row);
  }
  for (const row of snapshot.rows.runs ?? []) {
    if (row.source_dev === null || row.source_ino === null)
      fail("backup_reference");
    const target = targets.get(row.target_id),
      entry = files.get(
        `projects/${target?.project_id}/run-journals/${row.run_id}.jsonl`,
      );
    const compressed = compressions.has(`${row.target_id}\0${row.run_id}`)
      ? snapshot.readCompression(row.target_id, row.run_id)
      : null;
    if (
      !entry ||
      entry.dev !== row.source_dev ||
      entry.ino !== row.source_ino ||
      (compressed ? compressed.bytes.length : entry.bytes) <
        row.checkpoint_offset
    )
      fail("backup_reference");
    const journal = await readFile(
      join(root, entry.path),
      owned,
      16 * 1024 * 1024,
    );
    if (
      hash(journal.bytes) !== entry.sha256 ||
      !Number.isSafeInteger(row.checkpoint_offset) ||
      row.checkpoint_offset < 0
    )
      fail("backup_reference");
    const prefix = (compressed?.bytes ?? journal.bytes).subarray(
      0,
      row.checkpoint_offset,
    );
    if (
      hash(prefix) !== row.checkpoint_hash ||
      (prefix.length && prefix.at(-1) !== 10) ||
      prefix.reduce((count, byte) => count + (byte === 10), 0) !==
        row.checkpoint_sequence
    )
      fail("backup_reference");
  }
  for (const row of snapshot.rows.evidence ?? []) {
    let record;
    try {
      record = JSON.parse(row.metadata);
    } catch {
      fail("backup_reference");
    }
    const entry = files.get(`evidence/${row.target_id}/${row.id}.bin`);
    if (
      !entry ||
      entry.sha256 !== record.sha256 ||
      entry.bytes !== record.bytes
    )
      fail("backup_reference");
  }
}

/** Private snapshot: acquiring journal writers never starts a run or dispatches an action. */
export async function backupWorkspace(options = {}) {
  checkedOptions(options, ["root", "output"], ["onProgress"]);
  const { root, output, onProgress = async () => {} } = options;
  if (!disjoint(root, output)) fail("backup_invalid");
  await retryCleanup(output);
  if (active.has(root)) fail("backup_busy");
  active.add(root);
  const owned = resources(output),
    ignore = new Map();
  let outputIdentity, manifest;
  try {
    const rootIdentity = await directory(root);
    await assertAbsent(output);
    if (
      (await fs.readdir(root)).some(
        (name) =>
          name.startsWith("workspace-upgrade-") &&
          ![
            "workspace-upgrade-v1-v2",
            "workspace-upgrade-v2-v3",
            "workspace-upgrade-v3-v4",
          ].includes(name),
      )
    )
      fail("backup_invalid");
    const markerFile = await readFile(
        join(root, "workspace.json"),
        owned,
        8192,
      ),
      marker = checkedMarker(markerFile.bytes);
    const { captureProcessOwner } = await loadTools("process-owner"),
      owner = await captureProcessOwner();
    const backupId = randomUUID(),
      names = await projects(root);
    for (const name of names)
      if (
        await optional(
          join(root, "projects", name, "run-journals", "writer.lock"),
        )
      )
        fail("backup_busy");
    outputIdentity = await reserve(output, owned);
    await writeNew(
      join(output, "intent.json"),
      encoded({
        format: "daedlo-workspace-backup-intent/1",
        backupId,
        workspaceId: marker.workspaceId,
        sourceRoot: root,
        source: {
          dev: String(rootIdentity.dev),
          ino: String(rootIdentity.ino),
          workspaceSha256: hash(markerFile.bytes),
        },
        owner,
        projects: names,
        createdAt: new Date().toISOString(),
      }),
      owned,
    );
    await fs.mkdir(join(output, "locks"), { mode: 0o700 });
    const { openRunJournal } = await loadTools("run-journal");
    const pkg = JSON.parse(
      await fs.readFile(new URL("../package.json", import.meta.url)),
    );
    const installation = {
      id: "daedlo-universal-backup",
      version: pkg.version,
      sourceSha256: hash(encoded(pkg)),
      model: { id: "daedlo-workspace-backup", version: "1" },
    };
    for (const projectId of names) {
      const workspace = {
        root,
        id: marker.workspaceId,
        projectId,
        journal: 1,
        journalRoot: join(root, "projects", projectId, "run-journals"),
        assertCompatible: async () => {
          if (
            !same(rootIdentity, await directory(root)) ||
            !same(
              markerFile.stat,
              await fs.lstat(join(root, "workspace.json"), { bigint: true }),
            ) ||
            !(
              await readFile(join(root, "workspace.json"), owned, 8192)
            ).bytes.equals(markerFile.bytes)
          )
            fail("backup_source_changed");
        },
      };
      let writer;
      try {
        writer = await openRunJournal({ workspace, installation });
      } catch (error) {
        if (error.code === "journal_locked") fail("backup_busy");
        throw error;
      }
      owned.add(writer);
      const path = `projects/${projectId}/run-journals/writer.lock`,
        lock = await readFile(join(root, path), owned, 8192),
        record = JSON.parse(lock.bytes);
      ignore.set(path, { stat: lock.stat, sha256: hash(lock.bytes) });
      await writeNew(
        join(output, "locks", projectId + ".json"),
        encoded({
          format: "daedlo-workspace-backup-lock/1",
          projectId,
          path,
          expected: {
            token: record.token,
            sha256: hash(lock.bytes),
            dev: String(lock.stat.dev),
            ino: String(lock.stat.ino),
          },
          record,
        }),
        owned,
      );
    }
    await onProgress({ phase: "writers_locked" });
    if (!isDeepStrictEqual(await projects(root), names))
      fail("backup_source_changed");
    const { withCatalogSnapshot } = await import("./catalog.mjs");
    await withCatalogSnapshot({ root }, async (snapshot) => {
      try {
        await fs.mkdir(join(output, "files"), { mode: 0o700 });
        const dbBefore = await snapshot.databaseSnapshot();
        const initial = await inventory(root, owned, {
          ignore,
          databaseHash: dbBefore.sha256,
        });
        if (
          !isDeepStrictEqual(
            initial
              .filter(
                (entry) =>
                  entry.type === "directory" &&
                  /^projects\/[^/]+$/.test(entry.path),
              )
              .map((entry) => entry.path.slice(9))
              .sort(),
            names,
          )
        )
          fail("backup_source_changed");
        const dbEntry = initial.find((e) => e.path === "workspace.sqlite");
        const copied = await snapshot.copyDatabase(
          join(output, "files", "workspace.sqlite"),
        );
        if (
          !dbEntry ||
          copied.dev !== dbEntry.dev ||
          copied.ino !== dbEntry.ino ||
          copied.bytes !== dbEntry.bytes ||
          copied.sha256 !== dbEntry.sha256
        )
          fail("backup_source_changed");
        for (const entry of initial) {
          if (!entry.path || entry.path === "workspace.sqlite") continue;
          await guardOutput(output, outputIdentity);
          const destination = join(output, "files", entry.path);
          if (entry.type === "directory")
            await fs.mkdir(destination, { mode: 0o700 });
          else if (entry.linkGroup && entry.linkGroup !== entry.path)
            await fs.link(join(output, "files", entry.linkGroup), destination);
          else
            await copyFile(join(root, entry.path), destination, entry, owned);
        }
        await onProgress({ phase: "copied" });
        const dbAfter = await snapshot.databaseSnapshot();
        const after = await inventory(root, owned, {
          ignore,
          databaseHash: dbAfter.sha256,
        });
        if (
          !isDeepStrictEqual(initial, after) ||
          !isDeepStrictEqual(dbBefore, dbAfter)
        )
          fail("backup_source_changed");
        await validateReferences(snapshot, initial, root, owned);
        await snapshot.assertOwned();
        if (
          !isDeepStrictEqual(
            content(initial),
            content(await inventory(join(output, "files"), owned)),
          )
        )
          fail("backup_corrupt");
        for (const entry of [...initial].reverse())
          if (entry.type === "directory")
            await sync(join(output, "files", entry.path), owned);
        const metadata = [];
        for (const path of [
          "intent.json",
          ...names.map((name) => `locks/${name}.json`),
        ]) {
          const file = await readFile(join(output, path), owned, 256 * 1024);
          metadata.push({
            path,
            bytes: file.bytes.length,
            sha256: hash(file.bytes),
          });
        }
        manifest = {
          format: FORMAT,
          backupId,
          workspaceId: marker.workspaceId,
          catalogId: snapshot.ownerRecord.catalogId,
          catalogVersion: snapshot.ownerRecord.catalogVersion,
          createdAt: new Date().toISOString(),
          entries: initial,
          metadata,
        };
        await onProgress({ phase: "verified" });
      } catch (error) {
        if (
          /^(backup_|catalog_|journal_|workspace_|snapshot_|compression_)/.test(
            error?.code ?? "",
          )
        )
          throw error;
        fail("backup_storage", { retainedOutput: output });
      }
    });
    await owned.cleanup();
    await guardOutput(output, outputIdentity);
    if (
      !isDeepStrictEqual(
        content(manifest.entries),
        content(await inventory(join(output, "files"), owned)),
      )
    )
      fail("backup_corrupt");
    for (const entry of manifest.metadata) {
      const file = await readFile(join(output, entry.path), owned, 256 * 1024);
      if (
        file.bytes.length !== entry.bytes ||
        hash(file.bytes) !== entry.sha256
      )
        fail("backup_corrupt");
    }
    const bytes = encoded(manifest);
    if (bytes.length > MAX_MANIFEST) fail("backup_limit");
    await writeNew(join(output, "manifest.json"), bytes, owned);
    await owned.cleanup();
    return publicResult(manifest, output, hash(bytes));
  } catch (error) {
    if (
      /^(backup_|catalog_|journal_|workspace_|snapshot_|compression_)/.test(
        error?.code ?? "",
      )
    )
      throw error;
    fail("backup_storage", {
      ...(outputIdentity ? { retainedOutput: output } : {}),
    });
  } finally {
    try {
      await owned.cleanup();
    } finally {
      active.delete(root);
    }
  }
}

function checkedManifest(value) {
  if (
    !exact(value, [
      "format",
      "backupId",
      "workspaceId",
      "catalogId",
      "catalogVersion",
      "createdAt",
      "entries",
      "metadata",
    ]) ||
    value.format !== FORMAT ||
    !UUID.test(value.backupId) ||
    !ID.test(value.workspaceId) ||
    !UUID.test(value.catalogId) ||
    ![1, 2, 3, 4].includes(value.catalogVersion) ||
    !Array.isArray(value.entries) ||
    value.entries.length > MAX_FILES ||
    !Array.isArray(value.metadata) ||
    value.metadata.length > MAX_PROJECTS + 1 ||
    typeof value.createdAt !== "string" ||
    new Date(value.createdAt).toISOString() !== value.createdAt
  )
    fail("backup_corrupt");
  const names = new Map();
  let total = 0;
  for (const entry of value.entries) {
    if (
      !object(entry) ||
      (entry.path !== "" && !safeRelative(entry.path)) ||
      names.has(entry.path) ||
      !["file", "directory"].includes(entry.type) ||
      ![entry.dev, entry.ino, entry.mtimeNs, entry.ctimeNs].every(
        (v) => typeof v === "string" && /^\d{1,30}$/.test(v),
      ) ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 0 ||
      !Number.isSafeInteger(entry.links) ||
      entry.links < 1 ||
      entry.path.split("/").length > MAX_DEPTH + 1
    )
      fail("backup_corrupt");
    const keys = [
      "path",
      "type",
      "dev",
      "ino",
      "bytes",
      "mtimeNs",
      "ctimeNs",
      "links",
      ...(entry.type === "file" ? ["sha256"] : []),
      ...(entry.linkGroup !== undefined ? ["linkGroup"] : []),
    ];
    if (
      !exact(entry, keys) ||
      (entry.type === "file" &&
        (!SHA.test(entry.sha256) ||
          entry.bytes > MAX_FILE ||
          (total += entry.bytes) > MAX_BYTES)) ||
      (entry.linkGroup !== undefined && !safeRelative(entry.linkGroup))
    )
      fail("backup_corrupt");
    if (
      entry.path &&
      names.get(
        entry.path.includes("/")
          ? entry.path.slice(0, entry.path.lastIndexOf("/"))
          : "",
      )?.type !== "directory"
    )
      fail("backup_corrupt");
    names.set(entry.path, entry);
  }
  if (
    value.entries[0]?.path !== "" ||
    value.entries[0]?.type !== "directory" ||
    ["workspace.sqlite", "workspace.sqlite.owner.json", "workspace.json"].some(
      (path) => names.get(path)?.type !== "file",
    )
  )
    fail("backup_corrupt");
  const metadataNames = new Set();
  for (const entry of value.metadata) {
    if (
      !exact(entry, ["path", "bytes", "sha256"]) ||
      metadataNames.has(entry.path) ||
      !(
        entry.path === "intent.json" ||
        /^locks\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/.test(entry.path)
      ) ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 0 ||
      entry.bytes > 256 * 1024 ||
      !SHA.test(entry.sha256)
    )
      fail("backup_corrupt");
    metadataNames.add(entry.path);
  }
  if (!metadataNames.has("intent.json")) fail("backup_corrupt");
  return value;
}
const content = (entries) =>
  entries.map(({ path, type, bytes, sha256, linkGroup }) => ({
    path,
    type,
    ...(type === "file"
      ? { bytes, sha256, ...(linkGroup ? { linkGroup } : {}) }
      : {}),
  }));
async function verify(backup, owned) {
  await directory(backup);
  let raw;
  try {
    raw = await readFile(join(backup, "manifest.json"), owned, MAX_MANIFEST);
  } catch (error) {
    if (error.code === "ENOENT") fail("backup_incomplete");
    throw error;
  }
  let manifest;
  try {
    manifest = checkedManifest(JSON.parse(raw.bytes));
  } catch {
    fail("backup_corrupt");
  }
  const names = (await fs.readdir(backup)).sort();
  if (
    !isDeepStrictEqual(names, [
      "files",
      "intent.json",
      "locks",
      "manifest.json",
    ])
  )
    fail("backup_corrupt");
  for (const name of ["intent.json", "manifest.json"]) {
    const stat = await fs.lstat(join(backup, name), { bigint: true });
    if (
      !stat.isFile() ||
      stat.nlink !== 1n ||
      stat.size > BigInt(name === "manifest.json" ? MAX_MANIFEST : 256 * 1024)
    )
      fail("backup_corrupt");
  }
  await directory(join(backup, "locks"));
  const locks = await fs.readdir(join(backup, "locks"));
  if (locks.length > MAX_PROJECTS) fail("backup_corrupt");
  for (const name of locks) {
    if (!name.endsWith(".json") || !ID.test(name.slice(0, -5)))
      fail("backup_corrupt");
    const record = await readFile(join(backup, "locks", name), owned, 16384);
    if (record.stat.nlink !== 1n) fail("backup_corrupt");
  }
  if (
    !isDeepStrictEqual(
      manifest.metadata.map((e) => e.path).sort(),
      ["intent.json", ...locks.map((name) => "locks/" + name)].sort(),
    )
  )
    fail("backup_corrupt");
  for (const entry of manifest.metadata) {
    const file = await readFile(join(backup, entry.path), owned, 256 * 1024);
    if (file.bytes.length !== entry.bytes || hash(file.bytes) !== entry.sha256)
      fail("backup_corrupt");
  }
  const actual = await inventory(join(backup, "files"), owned);
  if (!isDeepStrictEqual(content(actual), content(manifest.entries)))
    fail("backup_corrupt");
  const markerBytes = (
    await readFile(join(backup, "files", "workspace.json"), owned, 8192)
  ).bytes;
  const marker = checkedMarker(markerBytes);
  const markerEntry = manifest.entries.find(
    (entry) => entry.path === "workspace.json",
  );
  if (
    markerBytes.length !== markerEntry.bytes ||
    hash(markerBytes) !== markerEntry.sha256
  )
    fail("backup_corrupt");
  if (marker.workspaceId !== manifest.workspaceId) fail("backup_corrupt");
  const ownerFile = await readFile(
    join(backup, "files", "workspace.sqlite.owner.json"),
    owned,
    8192,
  );
  let owner;
  try {
    owner = JSON.parse(ownerFile.bytes);
  } catch {
    fail("backup_corrupt");
  }
  const database = manifest.entries.find(
      (entry) => entry.path === "workspace.sqlite",
    ),
    ownerEntry = manifest.entries.find(
      (entry) => entry.path === "workspace.sqlite.owner.json",
    );
  if (
    ownerFile.bytes.length !== ownerEntry.bytes ||
    hash(ownerFile.bytes) !== ownerEntry.sha256 ||
    owner?.format !== "daedlo-universal-owner/1" ||
    owner.workspaceId !== manifest.workspaceId ||
    owner.catalogId !== manifest.catalogId ||
    owner.catalogVersion !== manifest.catalogVersion ||
    owner.projectionVersion !== 1 ||
    owner.database?.dev !== database.dev ||
    owner.database?.ino !== database.ino
  )
    fail("backup_corrupt");
  return {
    manifest,
    raw,
    actual,
    markerBytes,
    result: publicResult(manifest, backup, hash(raw.bytes)),
  };
}
export async function verifyWorkspaceBackup(options = {}) {
  checkedOptions(options, ["backup"]);
  await retryCleanup(options.backup);
  const owned = resources(options.backup);
  try {
    return (await verify(options.backup, owned)).result;
  } catch (error) {
    if (/^(backup_)/.test(error?.code ?? "")) throw error;
    fail("backup_corrupt");
  } finally {
    await owned.cleanup();
  }
}

const upgradePath = (path) =>
  /^workspace-upgrade-v(?:1-v2|2-v3|3-v4)(?:\/|$)/.test(path);
const evidenceReceipt = (path) =>
  /^evidence\/[^/]+\/(?:\.)?[^/]+\.json(?:\.tmp)?$/.test(path);

function plannedEntry(expected, path, value) {
  let parent = path;
  while (parent) {
    parent = parent.includes("/")
      ? parent.slice(0, parent.lastIndexOf("/"))
      : "";
    if (!expected.has(parent))
      expected.set(parent, { path: parent, type: "directory" });
  }
  expected.set(path, { path, ...value });
}
function canonicalTree(entries) {
  const groups = new Map();
  for (const entry of entries)
    if (entry.linkGroup) {
      if (!groups.has(entry.linkGroup)) groups.set(entry.linkGroup, []);
      groups.get(entry.linkGroup).push(entry.path);
    }
  const result = content(entries).map((entry) => {
    if (entry.linkGroup) {
      const members = groups.get(entry.linkGroup);
      if (members.length > 1) entry.linkGroup = [...members].sort()[0];
      else delete entry.linkGroup;
    }
    return entry;
  });
  return result.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
}
async function assertRestoredTree(
  root,
  expected,
  owned,
  previous,
  strict = false,
) {
  let actual;
  try {
    actual = await inventory(root, owned);
  } catch (error) {
    if (error.code === "backup_cleanup_incomplete") throw error;
    fail("restore_changed");
  }
  if (
    !isDeepStrictEqual(
      canonicalTree(actual),
      canonicalTree([...expected.values()]),
    )
  )
    fail("restore_changed");
  if (previous) {
    if (strict && !isDeepStrictEqual(actual, previous)) fail("restore_changed");
    const current = new Map(actual.map((entry) => [entry.path, entry]));
    for (const entry of previous) {
      const found = current.get(entry.path);
      if (!found || found.dev !== entry.dev || found.ino !== entry.ino)
        fail("restore_changed");
    }
  }
  return actual;
}
export async function restoreWorkspace(options = {}) {
  checkedOptions(options, ["backup", "root"], ["catalogVersion", "onProgress"]);
  const { backup, root, catalogVersion, onProgress = async () => {} } = options;
  if (
    !disjoint(backup, root) ||
    (catalogVersion !== undefined && ![1, 2, 3, 4].includes(catalogVersion))
  )
    fail("restore_invalid");
  await retryCleanup(root);
  const owned = resources(root);
  let identity;
  try {
    const checked = await verify(backup, owned),
      { manifest } = checked;
    if (
      catalogVersion !== undefined &&
      catalogVersion !== manifest.catalogVersion
    )
      fail("restore_invalid");
    await assertAbsent(root);
    identity = await reserve(root, owned);
    const provenance = `restore-provenance/${manifest.backupId}`;
    if (
      manifest.entries.some(
        (e) => e.path === provenance || e.path.startsWith(provenance + "/"),
      )
    )
      fail("restore_invalid");
    await fs.mkdir(join(root, provenance), { recursive: true, mode: 0o700 });
    await writeNew(
      join(root, provenance, "backup-manifest.json"),
      checked.raw.bytes,
      owned,
    );
    const expected = new Map();
    plannedEntry(expected, `${provenance}/backup-manifest.json`, {
      type: "file",
      bytes: checked.raw.bytes.length,
      sha256: hash(checked.raw.bytes),
    });
    const receipts = new Map();
    for (const entry of manifest.entries.filter(
      (e) => e.type === "file" && evidenceReceipt(e.path) && e.bytes <= 8192,
    )) {
      let value;
      const original = await readFile(
        join(backup, "files", entry.path),
        owned,
        8192,
      );
      try {
        value = JSON.parse(original.bytes);
        checkedEvidence(value.record);
      } catch {
        continue;
      }
      if (
        !exact(value, ["format", "workspaceId", "record", "file"]) ||
        value.format !== "daedlo-evidence-publication/1" ||
        value.workspaceId !== manifest.workspaceId ||
        !exact(value.file, ["dev", "ino"])
      )
        continue;
      const directoryPath = `evidence/${value.record.targetId}`,
        id = value.record.id;
      if (
        ![
          `${directoryPath}/${id}.json`,
          `${directoryPath}/.${id}.json.tmp`,
        ].includes(entry.path)
      )
        continue;
      const receiptPeers = [
        `${directoryPath}/${id}.json`,
        `${directoryPath}/.${id}.json.tmp`,
      ]
        .map((path) => manifest.entries.find((item) => item.path === path))
        .filter(Boolean);
      // Rebinding must not turn a formerly unproven hardlink or unpublished
      // receipt into a retryable publication. Only the writer's exact pair qualifies.
      if (
        !receiptPeers.some(
          (item) => item.path === `${directoryPath}/${id}.json`,
        ) ||
        receiptPeers.length !== entry.links ||
        receiptPeers.some(
          (item) =>
            item.type !== "file" ||
            item.dev !== entry.dev ||
            item.ino !== entry.ino,
        )
      )
        continue;
      const candidates = [
        `${directoryPath}/${id}.bin`,
        `${directoryPath}/.${id}.bin.tmp`,
      ]
        .map((path) => manifest.entries.find((item) => item.path === path))
        .filter(Boolean);
      if (
        !candidates.length ||
        candidates.length !== candidates[0].links ||
        candidates.some(
          (file) =>
            file.type !== "file" ||
            file.dev !== value.file.dev ||
            file.ino !== value.file.ino ||
            file.sha256 !== value.record.sha256 ||
            file.bytes !== value.record.bytes,
        )
      )
        continue;
      receipts.set(entry.path, { value, file: candidates[0].path });
    }
    const mapping = (path) =>
      path === "workspace.sqlite.owner.json" ||
      upgradePath(path) ||
      receipts.has(path)
        ? `${provenance}/${path}`
        : path;
    const entries = new Map(checked.actual.map((e) => [e.path, e]));
    for (const entry of manifest.entries) {
      if (!entry.path || entry.path === "workspace.json") continue;
      plannedEntry(
        expected,
        mapping(entry.path),
        entry.type === "directory"
          ? { type: "directory" }
          : {
              type: "file",
              bytes: entry.bytes,
              sha256: entry.sha256,
              ...(entry.linkGroup
                ? { linkGroup: `source:${entry.linkGroup}` }
                : {}),
            },
      );
      await guardOutput(root, identity);
      const destination = join(root, mapping(entry.path));
      if (entry.type === "directory")
        await fs.mkdir(destination, { recursive: true, mode: 0o700 });
      else {
        await fs.mkdir(dirname(destination), { recursive: true, mode: 0o700 });
        await directory(dirname(destination));
        if (entry.linkGroup && entry.linkGroup !== entry.path)
          await fs.link(join(root, mapping(entry.linkGroup)), destination);
        else
          await copyFile(
            join(backup, "files", entry.path),
            destination,
            entries.get(entry.path),
            owned,
          );
      }
    }
    // Original receipt bytes remain inert; only exact proven evidence identities are rebound.
    const receiptLinks = new Map();
    for (const entry of manifest.entries.filter((e) => receipts.has(e.path))) {
      const { value, file } = receipts.get(entry.path);
      const stat = await fs.lstat(join(root, file), { bigint: true }),
        destination = join(root, entry.path);
      const reboundBytes = encoded({
        ...value,
        file: { dev: String(stat.dev), ino: String(stat.ino) },
      });
      plannedEntry(expected, entry.path, {
        type: "file",
        bytes: reboundBytes.length,
        sha256: hash(reboundBytes),
        ...(entry.linkGroup ? { linkGroup: `receipt:${entry.linkGroup}` } : {}),
      });
      if (entry.linkGroup && receiptLinks.has(entry.linkGroup))
        await fs.link(receiptLinks.get(entry.linkGroup), destination);
      else {
        await writeNew(destination, reboundBytes, owned);
        if (entry.linkGroup) receiptLinks.set(entry.linkGroup, destination);
      }
    }
    const prepared = await assertRestoredTree(root, expected, owned);
    await onProgress({ phase: "copied" });
    await assertRestoredTree(root, expected, owned, prepared, true);
    const verifiedAgain = await verify(backup, owned);
    if (
      !verifiedAgain.raw.bytes.equals(checked.raw.bytes) ||
      !isDeepStrictEqual(verifiedAgain.actual, checked.actual)
    )
      fail("backup_source_changed");
    const sourceOwnerBytes = (
      await readFile(
        join(backup, "files", "workspace.sqlite.owner.json"),
        owned,
        8192,
      )
    ).bytes;
    const { rebindRestoredCatalog } = await import("./catalog-snapshot.mjs");
    const rebound = await rebindRestoredCatalog({
      root,
      inventory: manifest.entries,
      sourceOwnerBytes,
      onProgress,
    });
    if (
      rebound.workspaceId !== manifest.workspaceId ||
      rebound.catalogId !== manifest.catalogId ||
      rebound.catalogVersion !== manifest.catalogVersion
    )
      fail("restore_invalid");
    if (
      !rebound.database ||
      !SHA.test(rebound.database.sha256) ||
      !(rebound.ownerBytes instanceof Uint8Array)
    )
      fail("restore_changed");
    plannedEntry(expected, "workspace.sqlite", {
      type: "file",
      bytes: rebound.database.bytes,
      sha256: rebound.database.sha256,
    });
    plannedEntry(expected, "workspace.sqlite.owner.json", {
      type: "file",
      bytes: rebound.ownerBytes.length,
      sha256: hash(rebound.ownerBytes),
    });
    await guardOutput(root, identity);
    const completeBytes = encoded({
      format: "daedlo-workspace-restore/1",
      backupId: manifest.backupId,
      backupSha256: checked.result.sha256,
      workspaceId: manifest.workspaceId,
      catalogId: manifest.catalogId,
      catalogVersion: manifest.catalogVersion,
      restoredAt: new Date().toISOString(),
    });
    plannedEntry(expected, `${provenance}/complete.json`, {
      type: "file",
      bytes: completeBytes.length,
      sha256: hash(completeBytes),
    });
    await writeNew(
      join(root, provenance, "complete.json"),
      completeBytes,
      owned,
    );
    // Sync every destination directory, including retained upgrade and recovery receipts.
    const restoredInventory = await assertRestoredTree(
      root,
      expected,
      owned,
      prepared,
    );
    for (const entry of [...restoredInventory].reverse())
      if (entry.type === "directory") await sync(join(root, entry.path), owned);
    await owned.cleanup();
    await onProgress({ phase: "before_publish" });
    await guardOutput(root, identity);
    await assertRestoredTree(root, expected, owned, restoredInventory, true);
    await writeNew(join(root, "workspace.json"), checked.markerBytes, owned);
    await owned.cleanup();
    return {
      root,
      workspaceId: manifest.workspaceId,
      catalogId: manifest.catalogId,
      catalogVersion: manifest.catalogVersion,
      restored: true,
      backupId: manifest.backupId,
    };
  } catch (error) {
    if (/^(backup_|restore_|catalog_|compression_)/.test(error?.code ?? ""))
      throw error;
    fail("restore_storage", { ...(identity ? { retainedOutput: root } : {}) });
  } finally {
    await owned.cleanup();
  }
}
export async function rollbackWorkspace(options = {}) {
  checkedOptions(
    options,
    ["root", "backup", "output", "preserve"],
    ["catalogVersion", "onProgress"],
  );
  const { root, backup, output, preserve, catalogVersion, onProgress } =
      options,
    paths = [root, backup, output, preserve];
  if (
    ![1, 2, 3, 4].includes(catalogVersion) ||
    paths.some((path, index) =>
      paths.slice(index + 1).some((other) => !disjoint(path, other)),
    )
  )
    fail("restore_invalid");
  await assertAbsent(output, preserve);
  const old = await verifyWorkspaceBackup({ backup });
  if (old.catalogVersion !== catalogVersion) fail("restore_invalid");
  const owned = resources(preserve);
  let marker;
  try {
    marker = checkedMarker(
      (await readFile(join(root, "workspace.json"), owned, 8192)).bytes,
    );
  } finally {
    await owned.cleanup();
  }
  if (marker.workspaceId !== old.workspaceId) fail("restore_invalid");
  const preserved = await backupWorkspace({
    root,
    output: preserve,
    onProgress,
  });
  if (preserved.workspaceId !== old.workspaceId) fail("restore_invalid");
  const restored = await restoreWorkspace({
    backup,
    root: output,
    catalogVersion,
    onProgress,
  });
  return { preserved, restored };
}
