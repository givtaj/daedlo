import fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, resolve, join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { loadTools } from "./tools.mjs";
import {
  COMPRESSION_COLUMNS,
  readSnapshotCompression,
} from "./compression-snapshot.mjs";
import { inspectMigration } from "./catalog-migration.mjs";
import { validateDatabase, establishRollbackGuard } from "./catalog-schema.mjs";

const MAX_DATABASE = 1024 * 1024 * 1024,
  MAX_ROWS = 1000000,
  MAX_JOURNAL = 16 * 1024 * 1024;
const SHA = /^[a-f0-9]{64}$/;
const decimal = (value) =>
  typeof value === "string" && /^[0-9]{1,30}$/.test(value);
const same = (a, b) => Boolean(a && b && a.dev === b.dev && a.ino === b.ino);
const stable = (a, b) =>
  same(a, b) &&
  a.size === b.size &&
  a.mtimeNs === b.mtimeNs &&
  a.ctimeNs === b.ctimeNs &&
  b.nlink === 1n;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pending = new Map(),
  active = new Set();
const fail = (code, extra = {}) => {
  throw Object.assign(
    Error(
      {
        snapshot_busy: "Another writer or snapshot owns this catalog.",
        snapshot_changed:
          "Snapshot source ownership or contents changed; retained data was preserved.",
        snapshot_limit: "The snapshot exceeds the supported storage bound.",
        snapshot_recovery_required:
          "Resolve pending storage recovery before making a backup.",
        snapshot_cleanup_incomplete:
          "Snapshot cleanup is incomplete; exact owned handles were retained for explicit retry.",
        snapshot_storage:
          "The snapshot could not complete; its partial output was retained.",
        restore_invalid:
          "Restore requires a verified copy in a new unpublished workspace.",
        restore_changed:
          "Restore inputs failed integrity or ownership verification.",
        restore_storage:
          "Restore could not complete; its unpublished files were retained.",
      }[code] ?? "Storage snapshot was refused.",
    ),
    { code, ...extra },
  );
};
async function optional(path) {
  try {
    return await fs.lstat(path, { bigint: true });
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function rootPath(root) {
  if (typeof root !== "string" || !isAbsolute(root) || resolve(root) !== root)
    fail("restore_invalid");
}
function owned(resources, handle) {
  const item = { handle, closed: false, failed: false };
  resources.push(item);
  return item;
}
async function close(item) {
  if (item.closed) return;
  try {
    await item.handle.close();
    item.closed = true;
  } catch (error) {
    item.failed = true;
    throw error;
  }
}
async function cleanup(key, resources, retry = false) {
  if (!resources.length) return;
  for (let index = 0; index < resources.length; index++) {
    const item = resources[index];
    if (item.closed) continue;
    if (item.failed && !retry) {
      pending.set(
        key,
        resources.filter((value) => !value.closed),
      );
      fail("snapshot_cleanup_incomplete", {
        pendingHandles: pending.get(key).length,
      });
    }
    try {
      await close(item);
    } catch (cause) {
      pending.set(
        key,
        resources.filter((value) => !value.closed),
      );
      fail("snapshot_cleanup_incomplete", {
        pendingHandles: pending.get(key).length,
        cause,
      });
    }
  }
  pending.delete(key);
}
function sqlite(path, readOnly = false) {
  const url = pathToFileURL(path);
  url.searchParams.set("mode", readOnly ? "ro" : "rw");
  const db = new DatabaseSync(url.href, {
    readOnly,
    enableForeignKeyConstraints: true,
  });
  db.exec("PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=1000");
  db.exec(readOnly ? "PRAGMA query_only=ON" : "PRAGMA synchronous=EXTRA");
  return db;
}
function sqlResource(db) {
  let closed = false;
  return {
    close() {
      if (closed) return;
      try {
        db.exec("ROLLBACK");
      } catch {}
      db.close();
      closed = true;
    },
  };
}
function tables(version) {
  return [
    "catalog_meta",
    "catalog_migrations",
    "targets",
    "target_revisions",
    "history_state",
    "runs",
    ...(version >= 2
      ? [
          "evidence",
          "knowledge_records",
          "knowledge_revisions",
          "knowledge_reviews",
        ]
      : []),
    ...(version >= 3 ? ["archive_imports"] : []),
    ...(version >= 4 ? ["journal_compressions"] : []),
  ];
}
function tableRows(db, version) {
  let count = 0;
  const result = {};
  for (const table of tables(version)) {
    count += db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count;
    if (count > MAX_ROWS) fail("snapshot_limit"); // Imported BLOBs are preserved by the verified database image. The file
    // coordinator needs their metadata/length, never a second 1 GiB heap copy.
    result[table] = db
      .prepare(
        table === "archive_imports"
          ? "SELECT target_id,run_id,import_id,identity_hash,source_hash,metadata,summary,sort_at,journal_checkpoint_hash,length(source_bytes) AS source_bytes_length FROM archive_imports"
          : table === "journal_compressions"
            ? `SELECT ${COMPRESSION_COLUMNS} FROM journal_compressions`
            : `SELECT * FROM ${table}`,
      )
      .all();
  }
  return result;
}
async function noSidecars(path) {
  for (const suffix of ["-journal", "-wal", "-shm"])
    if (await optional(path + suffix)) fail("snapshot_recovery_required");
}
async function stream(handle, before, path, write) {
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
    if (!bytesRead) fail("snapshot_changed");
    const part = buffer.subarray(0, bytesRead);
    digest.update(part);
    if (write) await write(part, offset);
    offset += bytesRead;
  }
  if (
    !stable(before, await handle.stat({ bigint: true })) ||
    !stable(before, await fs.lstat(path, { bigint: true }))
  )
    fail("snapshot_changed");
  return {
    dev: String(before.dev),
    ino: String(before.ino),
    bytes: offset,
    sha256: digest.digest("hex"),
    mtimeNs: String(before.mtimeNs),
    ctimeNs: String(before.ctimeNs),
    mode: Number(before.mode),
  };
}
/** Trusted callback owns no SQLite or raw source descriptors. */
export async function snapshotCatalog(
  { root, openForSnapshot, mapTarget, onProgress = async () => {} } = {},
  callback,
) {
  rootPath(root);
  if (typeof callback !== "function" || typeof onProgress !== "function")
    fail("restore_invalid");
  const key = `snapshot:${root}`;
  if (active.has(key)) fail("snapshot_busy");
  active.add(key);
  let resources = [],
    catalog,
    db;
  try {
    await cleanup(key, pending.get(key) ?? [], true);
    await inspectMigration(root);
    await noSidecars(join(root, "workspace.sqlite"));
    catalog = await openForSnapshot({ root });
    const raw = catalog._migration;
    await noSidecars(raw.path);
    await raw.use(true, () => null);
    const before = await fs.lstat(raw.path, { bigint: true });
    if (before.size > BigInt(MAX_DATABASE)) fail("snapshot_limit");
    db = await raw.exclusive();
    resources.push({ handle: sqlResource(db), closed: false, failed: false });
    await noSidecars(raw.path);
    // Keep this raw descriptor alive until AFTER SQLite closes. POSIX closes of
    // any descriptor for the same inode would otherwise release process locks.
    const input = owned(
      resources,
      await fs.open(raw.path, constants.O_RDONLY | constants.O_NOFOLLOW),
    );
    const source = await input.handle.stat({ bigint: true });
    if (
      !stable(before, source) ||
      !same(source, raw.identity) ||
      source.nlink !== 1n
    )
      fail("snapshot_changed");
    const rows = tableRows(db, catalog.catalogVersion),
      targets = rows.targets.map(mapTarget),
      compressionByRun = new Map(
        (rows.journal_compressions ?? []).map((row) => [
          `${row.target_id}\0${row.run_id}`,
          row,
        ]),
      ),
      projectByTarget = new Map(
        rows.targets.map((row) => [row.id, row.project_id]),
      );
    const assertOwned = async () => {
      await raw.assertOwned();
      if (
        !stable(source, await input.handle.stat({ bigint: true })) ||
        !stable(source, await fs.lstat(raw.path, { bigint: true }))
      )
        fail("snapshot_changed");
      await noSidecars(raw.path);
    };
    const databaseSnapshot = async () => {
      await assertOwned();
      return stream(input.handle, source, raw.path);
    };
    const copyDatabase = async (destination) => {
      if (
        typeof destination !== "string" ||
        !isAbsolute(destination) ||
        resolve(destination) !== destination
      )
        fail("restore_invalid");
      const { journalFilesystem: io } = await loadTools("run-journal"),
        parent = await io.directory(dirname(destination));
      if (!parent) fail("restore_invalid");
      let output;
      try {
        output = owned(resources, await fs.open(destination, "wx", 0o600));
        const identity = await output.handle.stat({ bigint: true });
        const result = await stream(
          input.handle,
          source,
          raw.path,
          async (part, offset) => {
            let written = 0;
            while (written < part.length) {
              const value = await output.handle.write(
                part,
                written,
                part.length - written,
                offset + written,
              );
              if (!value.bytesWritten) fail("snapshot_storage");
              written += value.bytesWritten;
            }
          },
        );
        await output.handle.sync();
        await close(output);
        if (
          !same(identity, await fs.lstat(destination, { bigint: true })) ||
          !same(parent, await io.directory(dirname(destination)))
        )
          fail("snapshot_changed");
        await io.syncDirectory(dirname(destination));
        await assertOwned();
        return result;
      } catch (error) {
        error.retainedPath = destination;
        throw error;
      }
    };
    await onProgress({ phase: "locked" });
    const result = await callback(
      Object.freeze({
        catalogVersion: catalog.catalogVersion,
        workspaceId: raw.marker.workspaceId,
        catalogId: raw.owner.record.catalogId,
        targets,
        rows,
        ownerBytes: Buffer.from(raw.owner.bytes),
        ownerRecord: structuredClone(raw.owner.record),
        databasePath: raw.path,
        copyDatabase,
        databaseSnapshot,
        assertOwned,
        readCompression: (targetId, runId) => {
          const row = compressionByRun.get(`${targetId}\0${runId}`);
          const project = projectByTarget.get(targetId);
          return readSnapshotCompression(
            db,
            row,
            raw.marker.workspaceId,
            project,
          );
        },
      }),
    );
    await assertOwned();
    return result;
  } catch (error) {
    if (
      /^(catalog_|workspace_|journal_|snapshot_|restore_|backup_|compression_)/.test(
        error.code ?? "",
      )
    )
      throw error;
    if (/locked/.test(error.message ?? "")) fail("snapshot_busy");
    fail("snapshot_storage", { retainedPath: error.retainedPath });
  } finally {
    try {
      if (catalog)
        resources.push({ handle: catalog, closed: false, failed: false });
      await cleanup(key, resources);
    } finally {
      active.delete(key);
    }
  }
}
function inventoryMap(inventory) {
  if (!Array.isArray(inventory) || inventory.length > 1000000)
    fail("restore_invalid");
  const map = new Map();
  for (const entry of inventory) {
    if (entry?.type === "directory") continue;
    if (
      !entry ||
      typeof entry.path !== "string" ||
      !entry.path ||
      isAbsolute(entry.path) ||
      entry.path.includes("\\") ||
      /[\u0000-\u001f\u007f]/.test(entry.path) ||
      entry.path
        .split("/")
        .some((part) => !part || part === "." || part === "..") ||
      !decimal(entry.dev) ||
      !decimal(entry.ino) ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 0 ||
      !SHA.test(entry.sha256) ||
      map.has(entry.path)
    )
      fail("restore_invalid");
    map.set(entry.path, entry);
  }
  return map;
}
function sourceOwner(bytes, entry) {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength > 8192 ||
    !entry ||
    bytes.byteLength !== entry.bytes ||
    hash(bytes) !== entry.sha256
  )
    fail("restore_changed");
  let owner;
  try {
    owner = JSON.parse(bytes);
  } catch {
    fail("restore_changed");
  }
  if (
    !owner ||
    Object.keys(owner).sort().join(",") !==
      [
        "format",
        "workspaceId",
        "catalogId",
        "catalogVersion",
        "projectionVersion",
        "database",
        "metadataPage",
      ]
        .sort()
        .join(",") ||
    typeof owner.workspaceId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(owner.workspaceId) ||
    typeof owner.catalogId !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      owner.catalogId,
    ) ||
    owner.format !== "daedlo-universal-owner/1" ||
    ![1, 2, 3, 4].includes(owner.catalogVersion) ||
    owner.projectionVersion !== 1 ||
    !owner.database ||
    Object.keys(owner.database).sort().join(",") !== "dev,ino" ||
    !decimal(owner.database.dev) ||
    !decimal(owner.database.ino) ||
    !owner.metadataPage ||
    Object.keys(owner.metadataPage).sort().join(",") !== "offset,sha256,size" ||
    owner.metadataPage.offset !== owner.metadataPage.size ||
    ![512, 1024, 2048, 4096, 8192, 16384, 32768, 65536].includes(
      owner.metadataPage.size,
    ) ||
    !SHA.test(owner.metadataPage.sha256)
  )
    fail("restore_changed");
  return owner;
}
async function verifiedFile(root, entry, resources, limit = MAX_DATABASE) {
  if (!entry || entry.bytes > limit) fail("restore_changed");
  const path = join(root, entry.path);
  const { journalFilesystem: io } = await loadTools("run-journal");
  if (!(await io.directory(dirname(path)))) fail("restore_changed");
  const stat = await fs.lstat(path, { bigint: true });
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1n ||
    stat.size !== BigInt(entry.bytes)
  )
    fail("restore_changed");
  const resource = owned(
    resources,
    await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW),
  );
  if (!same(stat, await resource.handle.stat({ bigint: true })))
    fail("restore_changed");
  const result = await stream(resource.handle, stat, path);
  if (result.sha256 !== entry.sha256) fail("restore_changed");
  return { resource, stat, path };
}
/** Rebind a verified unpublished copy; never overwrite a live workspace. */
export async function rebindRestoredCatalog({
  root,
  inventory,
  sourceOwnerBytes,
  onProgress = async () => {},
} = {}) {
  rootPath(root);
  if (typeof onProgress !== "function") fail("restore_invalid");
  const key = `restore:${root}`;
  if (active.has(key)) fail("snapshot_busy");
  active.add(key);
  let resources = [],
    db;
  try {
    await cleanup(key, pending.get(key) ?? [], true);
    const { journalFilesystem: io } = await loadTools("run-journal"),
      rootIdentity = await io.directory(root);
    if (!rootIdentity) fail("restore_invalid");
    for (const name of [
      "workspace.json",
      "workspace.sqlite.owner.json",
      "workspace-upgrade-v1-v2",
      "workspace-upgrade-v2-v3",
      "workspace-upgrade-v3-v4",
    ])
      if (await optional(join(root, name))) fail("restore_invalid");
    const entries = inventoryMap(inventory),
      original = sourceOwner(
        sourceOwnerBytes,
        entries.get("workspace.sqlite.owner.json"),
      ),
      database = entries.get("workspace.sqlite"),
      path = join(root, "workspace.sqlite");
    if (
      !database ||
      database.dev !== original.database.dev ||
      database.ino !== original.database.ino
    )
      fail("restore_changed");
    await noSidecars(path);
    const copied = await verifiedFile(root, database, resources);
    if (
      String(copied.stat.dev) === database.dev &&
      String(copied.stat.ino) === database.ino
    )
      fail("restore_invalid");
    const page = Buffer.alloc(original.metadataPage.size);
    if (
      (
        await copied.resource.handle.read(
          page,
          0,
          page.length,
          original.metadataPage.offset,
        )
      ).bytesRead !== page.length ||
      hash(page) !== original.metadataPage.sha256
    )
      fail("restore_changed");
    await close(copied.resource);
    db = sqlite(path);
    const sql = owned(resources, sqlResource(db));
    db.exec("BEGIN EXCLUSIVE");
    if (!same(copied.stat, await fs.lstat(path, { bigint: true })))
      fail("restore_changed");
    validateDatabase(
      db,
      original.workspaceId,
      original.catalogId,
      original.catalogVersion,
    );
    const targets = new Map(
      db
        .prepare("SELECT id,project_id FROM targets")
        .all()
        .map((row) => [row.id, row.project_id]),
    );
    const runs = db.prepare("SELECT * FROM runs").all();
    if (runs.length > MAX_ROWS) fail("snapshot_limit");
    const rebindings = [],
      unavailable = [],
      compressionBindings = [],
      compressionRows = new Map();
    let expandedBytes = 0;
    if (original.catalogVersion >= 4) {
      const storedRows = db
        .prepare(`SELECT ${COMPRESSION_COLUMNS} FROM journal_compressions`)
        .all();
      if (storedRows.length > MAX_ROWS) fail("snapshot_limit");
      for (const row of storedRows) {
        const value = readSnapshotCompression(
          db,
          row,
          original.workspaceId,
          targets.get(row.target_id),
        );
        if ((expandedBytes += value.bytes.length) > 4 * 1024 ** 3)
          fail("snapshot_limit");
        const relative = `projects/${value.record.projectId}/run-journals/${row.run_id}.jsonl`,
          entry = entries.get(relative);
        const expected =
          value.state === "active" ? value.markerBytes : value.bytes;
        if (
          !entry ||
          entry.dev !== value.binding.dev ||
          entry.ino !== value.binding.ino ||
          entry.bytes !== expected.length ||
          entry.sha256 !== hash(expected)
        )
          fail("restore_changed");
        const file = await verifiedFile(root, entry, resources, MAX_JOURNAL);
        compressionBindings.push({
          targetId: row.target_id,
          runId: row.run_id,
          dev: String(file.stat.dev),
          ino: String(file.stat.ino),
          path: file.path,
          stat: file.stat,
        });
        compressionRows.set(`${row.target_id}\0${row.run_id}`, row);
        await close(file.resource);
      }
    }
    for (const row of runs) {
      if (row.source_dev === null) {
        unavailable.push({ targetId: row.target_id, runId: row.run_id });
        continue;
      }
      const project = targets.get(row.target_id);
      if (
        typeof project !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(project) ||
        typeof row.run_id !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(row.run_id)
      )
        fail("restore_changed");
      const relative = `projects/${project}/run-journals/${row.run_id}.jsonl`,
        entry = entries.get(relative);
      if (!entry) {
        unavailable.push({ targetId: row.target_id, runId: row.run_id });
        continue;
      }
      const compressionRow = compressionRows.get(
        `${row.target_id}\0${row.run_id}`,
      );
      const compressed = compressionRow
        ? readSnapshotCompression(
            db,
            compressionRow,
            original.workspaceId,
            project,
          )
        : null;
      const logicalBytes = compressed ? compressed.bytes.length : entry.bytes;
      if (
        entry.dev !== row.source_dev ||
        entry.ino !== row.source_ino ||
        !Number.isSafeInteger(row.checkpoint_offset) ||
        row.checkpoint_offset < 0 ||
        row.checkpoint_offset > logicalBytes ||
        !SHA.test(row.checkpoint_hash)
      )
        fail("restore_changed");
      const file = await verifiedFile(root, entry, resources, MAX_JOURNAL),
        prefix = Buffer.alloc(row.checkpoint_offset);
      let offset = 0;
      if (compressed) {
        compressed.bytes.copy(prefix, 0, 0, prefix.length);
        offset = prefix.length;
      }
      while (offset < prefix.length) {
        const { bytesRead } = await file.resource.handle.read(
          prefix,
          offset,
          prefix.length - offset,
          offset,
        );
        if (!bytesRead) fail("restore_changed");
        offset += bytesRead;
      }
      if (
        hash(prefix) !== row.checkpoint_hash ||
        (prefix.length && prefix.at(-1) !== 10) ||
        prefix.reduce((count, byte) => count + (byte === 10), 0) !==
          row.checkpoint_sequence
      )
        fail("restore_changed");
      rebindings.push({
        targetId: row.target_id,
        runId: row.run_id,
        dev: String(file.stat.dev),
        ino: String(file.stat.ino),
        path: file.path,
        stat: file.stat,
      });
      await close(file.resource);
    }
    await onProgress({ phase: "verified", reboundRuns: rebindings.length });
    if (
      !same(copied.stat, await fs.lstat(path, { bigint: true })) ||
      !same(rootIdentity, await io.directory(root))
    )
      fail("restore_changed");
    for (const item of [...rebindings, ...compressionBindings])
      if (!stable(item.stat, await fs.lstat(item.path, { bigint: true })))
        fail("restore_changed");
    establishRollbackGuard(db, original.catalogId);
    const update = db.prepare(
      "UPDATE runs SET source_dev=?,source_ino=? WHERE target_id=? AND run_id=?",
    );
    for (const item of rebindings)
      update.run(item.dev, item.ino, item.targetId, item.runId);
    if (original.catalogVersion >= 4) {
      const bind = db.prepare(
        "UPDATE journal_compressions SET binding_dev=?,binding_ino=? WHERE target_id=? AND run_id=?",
      );
      for (const item of compressionBindings)
        bind.run(item.dev, item.ino, item.targetId, item.runId);
    }
    validateDatabase(
      db,
      original.workspaceId,
      original.catalogId,
      original.catalogVersion,
    );
    await onProgress({ phase: "rebinding" });
    db.exec("COMMIT");
    await close(sql);
    db = null;
    for (const item of [...rebindings, ...compressionBindings])
      if (!stable(item.stat, await fs.lstat(item.path, { bigint: true })))
        fail("restore_changed");
    const current = await fs.lstat(path, { bigint: true });
    if (
      !same(current, copied.stat) ||
      !same(rootIdentity, await io.directory(root))
    )
      fail("restore_changed");
    const input = owned(
        resources,
        await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW),
      ),
      metadata = Buffer.alloc(original.metadataPage.size);
    if (
      !stable(current, await input.handle.stat({ bigint: true })) ||
      (
        await input.handle.read(
          metadata,
          0,
          metadata.length,
          original.metadataPage.offset,
        )
      ).bytesRead !== metadata.length
    )
      fail("restore_changed");
    // Seal the intentional inode rebind before any callback can change the
    // unpublished copy. Keep this descriptor for all later integrity checks.
    const sealedDatabase = await stream(input.handle, current, path);
    const assertDatabase = async () => {
      if (
        !same(rootIdentity, await io.directory(root)) ||
        !stable(current, await fs.lstat(path, { bigint: true })) ||
        !stable(current, await input.handle.stat({ bigint: true }))
      )
        fail("restore_changed");
      for (const item of [...rebindings, ...compressionBindings])
        if (!stable(item.stat, await fs.lstat(item.path, { bigint: true })))
          fail("restore_changed");
      await noSidecars(path);
      if (
        (await stream(input.handle, current, path)).sha256 !==
        sealedDatabase.sha256
      )
        fail("restore_changed");
    };
    const owner = {
        ...original,
        database: { dev: String(current.dev), ino: String(current.ino) },
        metadataPage: { ...original.metadataPage, sha256: hash(metadata) },
      },
      ownerBytes = Buffer.from(JSON.stringify(owner) + "\n"),
      temporary = join(root, `.restore-owner-${randomUUID()}.tmp`);
    await onProgress({ phase: "committed" });
    await assertDatabase();
    const output = owned(resources, await fs.open(temporary, "wx", 0o600)),
      identity = await output.handle.stat({ bigint: true });
    await output.handle.writeFile(ownerBytes);
    await output.handle.sync();
    await close(output);
    if (!same(rootIdentity, await io.directory(root))) fail("restore_changed");
    await fs.link(temporary, join(root, "workspace.sqlite.owner.json"));
    await io.syncDirectory(root);
    await io.unlinkOwned(temporary, identity, rootIdentity);
    await io.syncDirectory(root);
    const ownerPath = join(root, "workspace.sqlite.owner.json"),
      ownerStat = await fs.lstat(ownerPath, { bigint: true });
    if (!same(identity, ownerStat) || ownerStat.nlink !== 1n)
      fail("restore_changed");
    await onProgress({ phase: "owner_rebound" });
    await assertDatabase();
    if (!stable(ownerStat, await fs.lstat(ownerPath, { bigint: true })))
      fail("restore_changed");
    const sealedOwner = await verifiedFile(
      root,
      {
        path: "workspace.sqlite.owner.json",
        bytes: ownerBytes.length,
        sha256: hash(ownerBytes),
      },
      resources,
    );
    if (!stable(ownerStat, sealedOwner.stat)) fail("restore_changed");
    await close(sealedOwner.resource);
    return {
      rebound: true,
      catalogVersion: original.catalogVersion,
      workspaceId: original.workspaceId,
      catalogId: original.catalogId,
      reboundRuns: rebindings.length,
      unavailableRuns: unavailable,
      ownerRecord: owner,
      ownerBytes,
      database: sealedDatabase,
    };
  } catch (error) {
    if (db) {
      try {
        db.exec("ROLLBACK");
      } catch {}
    }
    if (
      /^(catalog_|workspace_|journal_|snapshot_|restore_|backup_|compression_)/.test(
        error.code ?? "",
      )
    )
      throw error;
    fail("restore_storage");
  } finally {
    try {
      // SQL handles close before any retained raw descriptor for that database.
      await cleanup(key, resources);
    } finally {
      active.delete(key);
    }
  }
}
