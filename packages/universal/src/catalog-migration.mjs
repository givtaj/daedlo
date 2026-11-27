import fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { loadTools } from "./tools.mjs";
import {
  APPLICATION_ID,
  MIGRATION_2_HASH,
  MIGRATION_3_HASH,
  MIGRATION_4_HASH,
  applyMigration2,
  applyMigration3,
  applyMigration4,
  establishRollbackGuard,
  validateDatabase,
} from "./catalog-schema.mjs";

const TRANSITIONS = [
  {
    from: 1,
    to: 2,
    directory: "workspace-upgrade-v1-v2",
    checksum: MIGRATION_2_HASH,
    apply: applyMigration2,
  },
  {
    from: 2,
    to: 3,
    directory: "workspace-upgrade-v2-v3",
    checksum: MIGRATION_3_HASH,
    apply: applyMigration3,
  },
  {
    from: 3,
    to: 4,
    directory: "workspace-upgrade-v3-v4",
    checksum: MIGRATION_4_HASH,
    apply: applyMigration4,
  },
];
const transitionFor = (version) => {
  const spec = TRANSITIONS.find((item) => item.from === version);
  if (!spec) fail("catalog_incompatible");
  return spec;
};
const MAX_DATABASE = 1024 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const active = new Set();
const pendingCleanup = new Map();
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const same = (a, b) => Boolean(a && b && a.dev === b.dev && a.ino === b.ino);
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) =>
  object(value) &&
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const decimal = (value) =>
  typeof value === "string" && /^[0-9]{1,30}$/.test(value);
const fail = (code, extra = {}) => {
  throw Object.assign(
    Error(
      {
        catalog_migration_pending:
          "A storage upgrade is pending. Explicitly resume it before using this workspace.",
        catalog_migration_busy:
          "A live or unproven migration owner retains this upgrade.",
        catalog_migration_changed:
          "Migration ownership or saved data changed. Preserve the workspace and upgrade records for inspection.",
        catalog_migration_unproven:
          "Migration ownership proof is incomplete. Preserve all retained upgrade files for inspection.",
        catalog_migration_limit:
          "The migration exceeds the supported snapshot or claim bound.",
        catalog_migration_storage:
          "Storage upgrade could not complete. Its recoverable files were retained.",
        catalog_cleanup_incomplete:
          "Migration cleanup is incomplete. Retry the explicit upgrade to close retained owned handles.",
      }[code] ?? "Storage upgrade was refused.",
    ),
    { code, ...extra },
  );
};
const mapError = (error) => {
  if (/^(catalog_|target_|workspace_|journal_)/.test(error?.code ?? ""))
    throw error;
  fail("catalog_migration_storage", {
    retainedUpgrade: error?.retainedUpgrade,
  });
};
async function closeOwned(root, resources) {
  const retained = resources.filter(Boolean);
  if (!retained.length) return;
  for (let index = 0; index < retained.length; index++) {
    try {
      await retained[index].close();
    } catch (cause) {
      // Ordering matters: never close the raw source FD before SQLite releases
      // its transaction lock. Preserve this exact failed handle and successors.
      pendingCleanup.set(root, retained.slice(index));
      fail("catalog_cleanup_incomplete", {
        pendingHandles: retained.length - index,
        retainedUpgrade: root,
        cause,
      });
    }
  }
  pendingCleanup.delete(root);
}
async function optional(path) {
  try {
    return await fs.lstat(path, { bigint: true });
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function file(io, path, limit = 65536) {
  const value = await io.smallFile(path, limit);
  if (value.stat.nlink === 2n) {
    // Immutable publication can die between linking the final name and removing
    // its temporary name. Accept only that exact, bounded owned link pair.
    const directory = dirname(path),
      names = await fs.readdir(directory);
    if (names.length > 1024) fail("catalog_migration_limit");
    const prefix = `.${basename(path)}-`;
    const matches = [];
    for (const name of names)
      if (
        name.startsWith(prefix) &&
        name.endsWith(".tmp") &&
        UUID.test(name.slice(prefix.length, -4))
      ) {
        const stat = await fs.lstat(join(directory, name), { bigint: true });
        if (stat.isFile() && !stat.isSymbolicLink() && same(stat, value.stat))
          matches.push(stat);
      }
    if (matches.length !== 1) fail("catalog_migration_changed");
  } else if (value.stat.nlink !== 1n) fail("catalog_migration_changed");
  return value;
}
async function json(io, path, limit) {
  const value = await file(io, path, limit);
  try {
    return { ...value, value: JSON.parse(value.bytes) };
  } catch {
    fail("catalog_migration_unproven");
  }
}
async function claims(io, dir, processOwners) {
  const names = (await fs.readdir(dir)).filter((name) =>
    name.startsWith("claim-"),
  );
  if (names.length > 128) fail("catalog_migration_limit");
  names.sort();
  let previous = null,
    migrationId;
  const records = [];
  for (let i = 0; i < names.length; i++) {
    if (names[i] !== `claim-${String(i + 1).padStart(4, "0")}.json`)
      fail("catalog_migration_unproven");
    const record = await json(io, join(dir, names[i]), 8192),
      value = record.value;
    if (
      !exact(value, ["format", "migrationId", "previous", "owner"]) ||
      value.format !== "daedlo-catalog-migration-claim/1" ||
      !UUID.test(value.migrationId) ||
      value.previous !== previous ||
      !processOwners.isProcessOwnerRecord(value.owner) ||
      (migrationId && migrationId !== value.migrationId)
    )
      fail("catalog_migration_unproven");
    migrationId = value.migrationId;
    previous = hash(record.bytes);
    records.push({ ...record, name: names[i], sha256: previous });
  }
  return records;
}
function checkedIntent(value) {
  const spec = transitionFor(value?.sourceOwner?.catalogVersion);
  if (
    !exact(value, [
      "format",
      "migrationId",
      "preparationId",
      "workspaceId",
      "workspaceSha256",
      "catalogId",
      "database",
      "sourceOwner",
      "sourceOwnerFile",
      "sourceOwnerSha256",
      "targetOwner",
      "targetOwnerSha256",
      "backup",
      "candidate",
      "migrationSha256",
    ]) ||
    value.format !== "daedlo-catalog-migration/1" ||
    !UUID.test(value.migrationId) ||
    !UUID.test(value.preparationId) ||
    !UUID.test(value.catalogId) ||
    !SHA.test(value.workspaceSha256) ||
    !SHA.test(value.sourceOwnerSha256) ||
    !SHA.test(value.targetOwnerSha256) ||
    value.migrationSha256 !== spec.checksum ||
    !exact(value.database, ["dev", "ino"]) ||
    ![value.database.dev, value.database.ino].every(decimal) ||
    !exact(value.sourceOwnerFile, ["dev", "ino"]) ||
    ![value.sourceOwnerFile.dev, value.sourceOwnerFile.ino].every(decimal)
  )
    fail("catalog_migration_unproven");
  for (const [entry, prefix] of [
    [value.backup, "snapshot"],
    [value.candidate, "candidate"],
  ])
    if (
      !exact(entry, ["file", "sha256", "bytes"]) ||
      entry.file !==
        `${prefix}-${value.migrationId}-${value.preparationId}.sqlite` ||
      !SHA.test(entry.sha256) ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 8192 ||
      entry.bytes > MAX_DATABASE
    )
      fail("catalog_migration_unproven");
  for (const [owner, version] of [
    [value.sourceOwner, spec.from],
    [value.targetOwner, spec.to],
  ])
    if (
      !exact(owner, [
        "format",
        "workspaceId",
        "catalogId",
        "catalogVersion",
        "projectionVersion",
        "database",
        "metadataPage",
      ]) ||
      owner.format !== "daedlo-universal-owner/1" ||
      owner.workspaceId !== value.workspaceId ||
      owner.catalogId !== value.catalogId ||
      owner.catalogVersion !== version ||
      owner.projectionVersion !== 1 ||
      !isDeepStrictEqual(owner.database, value.database) ||
      !exact(owner.metadataPage, ["offset", "size", "sha256"]) ||
      ![512, 1024, 2048, 4096, 8192, 16384, 32768, 65536].includes(
        owner.metadataPage.size,
      ) ||
      owner.metadataPage.offset !== owner.metadataPage.size ||
      !SHA.test(owner.metadataPage.sha256)
    )
      fail("catalog_migration_unproven");
  if (
    value.sourceOwner.metadataPage.size !==
      value.targetOwner.metadataPage.size ||
    hash(Buffer.from(JSON.stringify(value.targetOwner) + "\n")) !==
      value.targetOwnerSha256
  )
    fail("catalog_migration_unproven");
  return value;
}
async function intentAt(io, dir) {
  const receipt = await json(io, join(dir, "intent.json"));
  checkedIntent(receipt.value);
  return { ...receipt, sha256: hash(receipt.bytes) };
}
async function completeAt(io, dir, intent, allClaims) {
  if (!(await optional(join(dir, "complete.json")))) return null;
  const result = await json(io, join(dir, "complete.json"), 8192),
    value = result.value;
  if (
    !exact(value, [
      "format",
      "migrationId",
      "intentSha256",
      "claimSha256",
      "targetOwnerSha256",
    ]) ||
    value.format !== "daedlo-catalog-migration-complete/1" ||
    value.migrationId !== intent.value.migrationId ||
    value.intentSha256 !== intent.sha256 ||
    value.claimSha256 !== allClaims.at(-1)?.sha256 ||
    value.targetOwnerSha256 !== intent.value.targetOwnerSha256
  )
    fail("catalog_migration_unproven");
  return result;
}
/** Merely checking migration state reads bounded receipt files, never SQLite. */
export async function inspectMigration(root) {
  const { journalFilesystem: io } = await loadTools("run-journal"),
    owners = await loadTools("process-owner");
  let previous = null,
    latest = null;
  for (const spec of TRANSITIONS) {
    const dir = join(root, spec.directory);
    if (!(await optional(dir))) continue;
    await io.directory(dir);
    if (
      !(await optional(join(dir, "intent.json"))) ||
      !(await optional(join(dir, "complete.json")))
    )
      fail("catalog_migration_pending");
    const intent = await intentAt(io, dir),
      allClaims = await claims(io, dir, owners);
    if (intent.value.sourceOwner.catalogVersion !== spec.from)
      fail("catalog_migration_changed");
    await completeAt(io, dir, intent, allClaims);
    if (
      previous &&
      (previous.targetOwnerSha256 !== intent.value.sourceOwnerSha256 ||
        previous.catalogId !== intent.value.catalogId ||
        previous.workspaceId !== intent.value.workspaceId)
    )
      fail("catalog_migration_changed");
    previous = intent.value;
    latest = { intent: intent.value, dir };
  }
  if (latest) {
    const owner = await file(
      io,
      join(root, "workspace.sqlite.owner.json"),
      8192,
    );
    if (hash(owner.bytes) !== latest.intent.targetOwnerSha256)
      fail("catalog_migration_changed");
  }
  return latest;
}
async function validatePredecessors(root, spec, io, owners) {
  let previous;
  for (const earlier of TRANSITIONS) {
    if (earlier.to > spec.from) break;
    const dir = join(root, earlier.directory);
    if (!(await optional(dir))) continue;
    await io.directory(dir);
    if (
      !(await optional(join(dir, "intent.json"))) ||
      !(await optional(join(dir, "complete.json")))
    )
      fail("catalog_migration_pending");
    const intent = await intentAt(io, dir),
      allClaims = await claims(io, dir, owners);
    if (intent.value.sourceOwner.catalogVersion !== earlier.from)
      fail("catalog_migration_changed");
    await completeAt(io, dir, intent, allClaims);
    if (
      previous &&
      previous.targetOwnerSha256 !== intent.value.sourceOwnerSha256
    )
      fail("catalog_migration_changed");
    previous = intent.value;
  }
  if (previous) {
    const pending = join(root, spec.directory, "intent.json");
    const sourceHash = (await optional(pending))
      ? (await intentAt(io, join(root, spec.directory))).value.sourceOwnerSha256
      : hash(
          (await file(io, join(root, "workspace.sqlite.owner.json"), 8192))
            .bytes,
        );
    if (previous.targetOwnerSha256 !== sourceHash)
      fail("catalog_migration_changed");
  }
}
async function writeNew(io, dir, name, bytes, identity) {
  const temporary = join(dir, `.${name}-${randomUUID()}.tmp`);
  let handle, owned;
  try {
    if (!same(identity, await io.directory(dir)))
      fail("catalog_migration_changed");
    handle = await fs.open(temporary, "wx", 0o600);
    owned = await handle.stat({ bigint: true });
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    if (!same(identity, await io.directory(dir)))
      fail("catalog_migration_changed");
    try {
      await fs.link(temporary, join(dir, name));
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const existing = await file(io, join(dir, name), bytes.length + 1);
      if (!existing.bytes.equals(bytes)) fail("catalog_migration_changed");
    }
    await io.syncDirectory(dir);
    await io.unlinkOwned(temporary, owned, identity);
    owned = null;
    await io.syncDirectory(dir);
  } catch (error) {
    if (owned) error.retainedPath = temporary;
    throw error;
  } finally {
    await handle?.close();
  }
}
const writeJSON = (io, dir, name, value, identity) =>
  writeNew(io, dir, name, Buffer.from(JSON.stringify(value) + "\n"), identity);
async function acquireClaim(io, dir, dirIdentity, owners, created) {
  let all = await claims(io, dir, owners),
    latest = all.at(-1),
    current = await owners.captureProcessOwner();
  if (!latest && !created) fail("catalog_migration_unproven");
  if (latest && isDeepStrictEqual(latest.value.owner, current)) return latest;
  if (
    latest &&
    (await owners.inspectProcessOwner(latest.value.owner)).state !== "dead"
  )
    fail("catalog_migration_busy");
  const value = {
    format: "daedlo-catalog-migration-claim/1",
    migrationId: latest?.value.migrationId ?? randomUUID(),
    previous: latest?.sha256 ?? null,
    owner: current,
  };
  const name = `claim-${String(all.length + 1).padStart(4, "0")}.json`;
  try {
    await writeJSON(io, dir, name, value, dirIdentity);
  } catch (error) {
    if (error.code === "catalog_migration_changed")
      fail("catalog_migration_busy");
    throw error;
  }
  all = await claims(io, dir, owners);
  latest = all.at(-1);
  if (!isDeepStrictEqual(latest?.value, value)) fail("catalog_migration_busy");
  return latest;
}
async function snapshot(source, destination, expected, retainInput) {
  let input, output;
  const digest = createHash("sha256");
  try {
    input = await fs.open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await input.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.nlink !== 1n ||
      before.size > BigInt(MAX_DATABASE) ||
      (expected && !same(before, expected))
    )
      fail("catalog_migration_changed");
    output = await fs.open(destination, "wx", 0o600);
    const buffer = Buffer.alloc(65536);
    let offset = 0;
    while (offset < Number(before.size)) {
      const size = Math.min(buffer.length, Number(before.size) - offset),
        read = await input.read(buffer, 0, size, offset);
      if (!read.bytesRead) fail("catalog_migration_changed");
      const part = buffer.subarray(0, read.bytesRead);
      digest.update(part);
      let written = 0;
      while (written < part.length) {
        const value = await output.write(
          part,
          written,
          part.length - written,
          offset + written,
        );
        if (!value.bytesWritten) fail("catalog_migration_storage");
        written += value.bytesWritten;
      }
      offset += read.bytesRead;
    }
    const after = await input.stat({ bigint: true }),
      current = await fs.lstat(source, { bigint: true });
    if (
      !same(before, current) ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs
    )
      fail("catalog_migration_changed");
    await output.sync();
    return { sha256: digest.digest("hex"), bytes: offset };
  } finally {
    if (input && retainInput) retainInput.push(input);
    else await input?.close();
    await output?.close();
  }
}
async function digestFile(path) {
  let handle;
  const digest = createHash("sha256");
  try {
    handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.nlink !== 1n ||
      before.size > BigInt(MAX_DATABASE)
    )
      fail("catalog_migration_changed");
    const buffer = Buffer.alloc(65536);
    let offset = 0;
    while (offset < Number(before.size)) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, Number(before.size) - offset),
        offset,
      );
      if (!bytesRead) fail("catalog_migration_changed");
      digest.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (
      !same(before, await fs.lstat(path, { bigint: true })) ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs
    )
      fail("catalog_migration_changed");
    return { sha256: digest.digest("hex"), bytes: offset };
  } finally {
    await handle?.close();
  }
}
function connect(path, readOnly = false) {
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
async function metadataPage(path, size) {
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const page = Buffer.alloc(size);
    if ((await handle.read(page, 0, size, size)).bytesRead !== size)
      fail("catalog_migration_changed");
    return page;
  } finally {
    await handle.close();
  }
}
const preservedTables = [
  "targets",
  "target_revisions",
  "history_state",
  "runs",
];
function preserved(db, version) {
  const tables =
    version >= 2
      ? [
          ...preservedTables,
          "evidence",
          "knowledge_records",
          "knowledge_revisions",
          "knowledge_reviews",
        ]
      : preservedTables;
  const order = {
    targets: "id",
    target_revisions: "target_id,revision",
    runs: "target_id,run_id",
    history_state: "target_id",
    evidence: "target_id,id",
    knowledge_records: "target_id,id",
    knowledge_revisions: "target_id,record_id,revision",
    knowledge_reviews: "target_id,record_id,revision,sequence",
  };
  const result = Object.fromEntries(
    tables.map((table) => [
      table,
      db.prepare(`SELECT * FROM ${table} ORDER BY ${order[table]}`).all(),
    ]),
  );
  if (version >= 3) {
    // Retain exact archive-byte hashes without materializing every BLOB together.
    result.archive_imports = [];
    for (const row of db
      .prepare("SELECT * FROM archive_imports ORDER BY target_id,run_id")
      .iterate()) {
      const { source_bytes, ...metadata } = row;
      result.archive_imports.push({
        ...metadata,
        source_bytes_length: source_bytes.length,
        source_bytes_sha256: hash(source_bytes),
      });
    }
  }
  return result;
}
async function verifyBackup(io, dir, intent) {
  const value = intent.value,
    backup = join(dir, value.backup.file),
    actual = await digestFile(backup);
  if (
    !isDeepStrictEqual(actual, {
      sha256: value.backup.sha256,
      bytes: value.backup.bytes,
    })
  )
    fail("catalog_migration_changed");
  for (const suffix of ["-journal", "-wal", "-shm"])
    if (await optional(backup + suffix)) fail("catalog_migration_changed");
  const owner = await file(
    io,
    join(dir, `owner-v${value.sourceOwner.catalogVersion}.json`),
    8192,
  );
  if (
    hash(owner.bytes) !== value.sourceOwnerSha256 ||
    !isDeepStrictEqual(JSON.parse(owner.bytes), value.sourceOwner)
  )
    fail("catalog_migration_changed");
  const db = connect(backup, true);
  try {
    validateDatabase(
      db,
      value.workspaceId,
      value.catalogId,
      value.sourceOwner.catalogVersion,
    );
    return preserved(db, value.sourceOwner.catalogVersion);
  } finally {
    db.close();
  }
}
async function preflightResume(io, root, intent) {
  const value = intent.value,
    path = join(root, "workspace.sqlite"),
    identity = await fs.lstat(path, { bigint: true });
  if (
    !identity.isFile() ||
    identity.isSymbolicLink() ||
    identity.nlink !== 1n ||
    String(identity.dev) !== value.database.dev ||
    String(identity.ino) !== value.database.ino
  )
    fail("catalog_migration_changed");
  const manifest = await file(io, join(root, "workspace.json"), 8192);
  if (hash(manifest.bytes) !== value.workspaceSha256)
    fail("catalog_migration_changed");
  const owner = await file(io, path + ".owner.json", 8192),
    ownerHash = hash(owner.bytes);
  if (
    ownerHash !== value.sourceOwnerSha256 &&
    ownerHash !== value.targetOwnerSha256
  )
    fail("catalog_migration_changed");
  if (
    ownerHash === value.sourceOwnerSha256 &&
    (String(owner.stat.dev) !== value.sourceOwnerFile.dev ||
      String(owner.stat.ino) !== value.sourceOwnerFile.ino)
  )
    fail("catalog_migration_changed");
  for (const suffix of ["-wal", "-shm"])
    if (await optional(path + suffix)) fail("catalog_migration_changed");
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let header, page;
  try {
    if (!same(identity, await handle.stat({ bigint: true })))
      fail("catalog_migration_changed");
    header = Buffer.alloc(100);
    if (
      (await handle.read(header, 0, 100, 0)).bytesRead !== 100 ||
      header.subarray(0, 16).toString("ascii") !== "SQLite format 3\0" ||
      header[18] !== 1 ||
      header[19] !== 1 ||
      header.readUInt32BE(68) !== APPLICATION_ID ||
      ![
        value.sourceOwner.catalogVersion,
        value.targetOwner.catalogVersion,
      ].includes(header.readUInt32BE(60))
    )
      fail("catalog_migration_changed");
    const size =
      header.readUInt16BE(16) === 1 ? 65536 : header.readUInt16BE(16);
    if (size !== value.sourceOwner.metadataPage.size)
      fail("catalog_migration_changed");
    page = Buffer.alloc(size);
    if ((await handle.read(page, 0, size, size)).bytesRead !== size)
      fail("catalog_migration_changed");
  } finally {
    await handle.close();
  }
  const journal = await optional(path + "-journal");
  let transient = false;
  if (journal) {
    if (!journal.isFile() || journal.isSymbolicLink() || journal.nlink !== 1n)
      fail("catalog_migration_changed");
    const input = await fs.open(
      path + "-journal",
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      if (!same(journal, await input.stat({ bigint: true })))
        fail("catalog_migration_changed");
      const first = Buffer.alloc(28);
      if ((await input.read(first, 0, 28, 0)).bytesRead !== 28)
        fail("catalog_migration_unproven");
      const magic = first.subarray(0, 8).toString("hex"),
        sector = first.readUInt32BE(20),
        size = first.readUInt32BE(24);
      if (
        !["d9d505f920a163d7", "0000000000000000"].includes(magic) ||
        ![512, 1024, 2048, 4096, 8192, 16384, 32768, 65536].includes(sector) ||
        size !== page.length
      )
        fail("catalog_migration_unproven");
      const record = Buffer.alloc(size + 8);
      if (
        (await input.read(record, 0, record.length, sector)).bytesRead !==
        record.length
      )
        fail("catalog_migration_unproven");
      const before = record.subarray(4, size + 4);
      let checksum = first.readUInt32BE(12);
      for (let offset = size - 200; offset >= 0; offset -= 200)
        checksum = (checksum + before[offset]) >>> 0;
      if (
        record.readUInt32BE(0) !== 2 ||
        checksum !== record.readUInt32BE(size + 4) ||
        hash(before) !== value.sourceOwner.metadataPage.sha256
      )
        fail("catalog_migration_changed");
      const altered = Buffer.from(before),
        at = altered.indexOf(Buffer.from(value.catalogId));
      if (
        at >= 0 &&
        altered.indexOf(Buffer.from(value.catalogId), at + 1) === -1
      ) {
        altered[at] = value.catalogId[0] === "0" ? 49 : 48;
        transient = page.equals(altered);
      }
      const after = await input.stat({ bigint: true });
      if (
        !same(journal, await fs.lstat(path + "-journal", { bigint: true })) ||
        journal.size !== after.size ||
        journal.mtimeNs !== after.mtimeNs
      )
        fail("catalog_migration_changed");
    } finally {
      await input.close();
    }
  }
  if (
    ![
      value.sourceOwner.metadataPage.sha256,
      value.targetOwner.metadataPage.sha256,
    ].includes(hash(page)) &&
    !transient
  )
    fail("catalog_migration_changed");
  if (!same(identity, await fs.lstat(path, { bigint: true })))
    fail("catalog_migration_changed");
  return { path, owner, identity };
}

/** Explicit, resumable v1→v2 upgrade; source history files are never moved. */
async function migrateTransition({
  root,
  spec,
  openForMigration,
  onProgress = async () => {},
} = {}) {
  if (
    typeof root !== "string" ||
    !isAbsolute(root) ||
    resolve(root) !== root ||
    typeof onProgress !== "function"
  )
    throw TypeError("Explicit absolute workspace root is required.");
  if (active.has(root)) fail("catalog_migration_busy");
  active.add(root);
  let catalog,
    db,
    dir = join(root, spec.directory),
    dirIdentity,
    claim;
  const heldSnapshots = [];
  try {
    await closeOwned(root, pendingCleanup.get(root) ?? []);
    const { journalFilesystem: io } = await loadTools("run-journal"),
      owners = await loadTools("process-owner");
    const rootIdentity = await io.directory(root);
    // Validate an existing ownership chain before copying or modifying the next
    // schema, including resumption after that next schema has already committed.
    await validatePredecessors(root, spec, io, owners);
    const existing = await optional(dir);
    if (existing) {
      dirIdentity = await io.directory(dir);
      if (await optional(join(dir, "complete.json"))) {
        const done = await inspectMigration(root);
        catalog = await openForMigration({ root });
        if (catalog.catalogVersion !== spec.to)
          fail("catalog_migration_changed");
        return {
          catalogVersion: spec.to,
          upgraded: false,
          backup: {
            database: join(dir, done.intent.backup.file),
            owner: join(dir, `owner-v${spec.from}.json`),
          },
        };
      }
    } else {
      catalog = await openForMigration({ root });
      if (catalog.catalogVersion === spec.to)
        return { catalogVersion: spec.to, upgraded: false, backup: null };
      if (catalog.catalogVersion !== spec.from)
        fail("catalog_migration_changed");
      try {
        await fs.mkdir(dir, { mode: 0o700 });
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        fail("catalog_migration_busy");
      }
      dirIdentity = await io.directory(dir);
      await io.syncDirectory(root);
    }
    claim = await acquireClaim(io, dir, dirIdentity, owners, !existing);
    const assertClaim = async () => {
      if (
        !same(rootIdentity, await io.directory(root)) ||
        !same(dirIdentity, await io.directory(dir))
      )
        fail("catalog_migration_changed");
      const latest = (await claims(io, dir, owners)).at(-1);
      if (latest?.sha256 !== claim.sha256) fail("catalog_migration_busy");
    };
    await assertClaim();
    await onProgress({ phase: "claimed" });
    let intent;
    if (await optional(join(dir, "intent.json")))
      intent = await intentAt(io, dir);
    else {
      catalog ??= await openForMigration({ root });
      if (catalog.catalogVersion !== spec.from)
        fail("catalog_migration_changed");
      // Explicit upgrade may recover a previously interrupted, proven-owned v1
      // transaction before acquiring the consistent migration snapshot.
      try {
        await catalog._migration.use(true, () => null);
      } catch (error) {
        if (error.code !== "catalog_recovery_required") throw error;
        await catalog._migration.use(false, () => null);
      }
      db = await catalog._migration.exclusive();
      const raw = catalog._migration,
        id = claim.value.migrationId,
        preparationId = randomUUID();
      await assertClaim();
      // A pre-intent interruption may retain a partial snapshot. Preserve it and
      // start a new, uniquely named preparation under the current exclusive lock.
      if ((await fs.readdir(dir)).length > 1024)
        fail("catalog_migration_limit");
      const backupName = `snapshot-${id}-${preparationId}.sqlite`,
        candidateName = `candidate-${id}-${preparationId}.sqlite`;
      if (
        (await optional(join(dir, backupName))) ||
        (await optional(join(dir, candidateName)))
      )
        fail("catalog_migration_unproven");
      const backup = await snapshot(
        raw.path,
        join(dir, backupName),
        raw.identity,
        heldSnapshots,
      );
      await writeNew(
        io,
        dir,
        `owner-v${spec.from}.json`,
        raw.owner.bytes,
        dirIdentity,
      );
      await onProgress({ phase: "snapshot_saved" });
      await snapshot(join(dir, backupName), join(dir, candidateName));
      const candidate = connect(join(dir, candidateName));
      try {
        candidate.exec("BEGIN IMMEDIATE");
        establishRollbackGuard(candidate, raw.owner.record.catalogId);
        spec.apply(candidate);
        validateDatabase(
          candidate,
          raw.marker.workspaceId,
          raw.owner.record.catalogId,
          spec.to,
        );
        candidate.exec("COMMIT");
      } finally {
        candidate.close();
      }
      await onProgress({ phase: "candidate_saved" });
      const page = await metadataPage(
        join(dir, candidateName),
        raw.owner.record.metadataPage.size,
      );
      const targetOwner = {
        ...raw.owner.record,
        catalogVersion: spec.to,
        metadataPage: { ...raw.owner.record.metadataPage, sha256: hash(page) },
      };
      const manifest = await file(io, join(root, "workspace.json"), 8192);
      const value = {
        format: "daedlo-catalog-migration/1",
        migrationId: id,
        preparationId,
        workspaceId: raw.marker.workspaceId,
        workspaceSha256: hash(manifest.bytes),
        catalogId: raw.owner.record.catalogId,
        database: raw.owner.record.database,
        sourceOwner: raw.owner.record,
        sourceOwnerFile: {
          dev: String(raw.owner.stat.dev),
          ino: String(raw.owner.stat.ino),
        },
        sourceOwnerSha256: hash(raw.owner.bytes),
        targetOwner,
        targetOwnerSha256: hash(
          Buffer.from(JSON.stringify(targetOwner) + "\n"),
        ),
        backup: { file: backupName, ...backup },
        candidate: {
          file: candidateName,
          ...(await digestFile(join(dir, candidateName))),
        },
        migrationSha256: spec.checksum,
      };
      checkedIntent(value);
      await raw.assertOwned();
      await assertClaim();
      await io.syncDirectory(dir);
      await writeJSON(io, dir, "intent.json", value, dirIdentity);
      intent = await intentAt(io, dir);
    }
    if (intent.value.migrationId !== claim.value.migrationId)
      fail("catalog_migration_changed");
    const originalRows = await verifyBackup(io, dir, intent);
    await assertClaim();
    await onProgress({ phase: "prepared" });
    if (!db) {
      const state = await preflightResume(io, root, intent);
      db = connect(state.path);
      db.exec("BEGIN EXCLUSIVE");
    }
    const currentVersion = db.prepare("PRAGMA user_version").get().user_version;
    validateDatabase(
      db,
      intent.value.workspaceId,
      intent.value.catalogId,
      currentVersion,
    );
    if (
      ![spec.from, spec.to].includes(currentVersion) ||
      !isDeepStrictEqual(preserved(db, spec.from), originalRows)
    )
      fail("catalog_migration_changed");
    await assertClaim();
    if (currentVersion === spec.from) {
      establishRollbackGuard(db, intent.value.catalogId);
      spec.apply(db);
      validateDatabase(
        db,
        intent.value.workspaceId,
        intent.value.catalogId,
        spec.to,
      );
      await onProgress({ phase: "migrating" });
      await assertClaim();
    }
    db.exec("COMMIT");
    db.close();
    db = null;
    await onProgress({ phase: "committed" });
    await assertClaim();
    const state = await preflightResume(io, root, intent);
    const current = connect(state.path, true);
    try {
      validateDatabase(
        current,
        intent.value.workspaceId,
        intent.value.catalogId,
        spec.to,
      );
      if (!isDeepStrictEqual(preserved(current, spec.from), originalRows))
        fail("catalog_migration_changed");
    } finally {
      current.close();
    }
    if (
      hash(
        await metadataPage(
          state.path,
          intent.value.targetOwner.metadataPage.size,
        ),
      ) !== intent.value.targetOwner.metadataPage.sha256
    )
      fail("catalog_migration_changed");
    if (hash(state.owner.bytes) !== intent.value.targetOwnerSha256) {
      const temporary = `.owner-v2-${randomUUID()}.json`;
      await writeJSON(
        io,
        dir,
        temporary,
        intent.value.targetOwner,
        dirIdentity,
      );
      await assertClaim();
      const before = await file(io, state.path + ".owner.json", 8192);
      if (
        !same(before.stat, state.owner.stat) ||
        !before.bytes.equals(state.owner.bytes)
      )
        fail("catalog_migration_changed");
      await fs.rename(join(dir, temporary), state.path + ".owner.json");
      await io.syncDirectory(root);
      await io.syncDirectory(dir);
    } else await io.syncDirectory(root);
    await onProgress({ phase: "owner_rebound" });
    await assertClaim();
    await writeJSON(
      io,
      dir,
      "complete.json",
      {
        format: "daedlo-catalog-migration-complete/1",
        migrationId: intent.value.migrationId,
        intentSha256: intent.sha256,
        claimSha256: claim.sha256,
        targetOwnerSha256: intent.value.targetOwnerSha256,
      },
      dirIdentity,
    );
    await inspectMigration(root);
    await onProgress({ phase: "complete" });
    return {
      catalogVersion: spec.to,
      upgraded: true,
      backup: {
        database: join(dir, intent.value.backup.file),
        owner: join(dir, `owner-v${spec.from}.json`),
      },
    };
  } catch (error) {
    if (db) {
      try {
        db.exec("ROLLBACK");
      } catch {}
    }
    error.retainedUpgrade = dir;
    mapError(error);
  } finally {
    try {
      await closeOwned(root, [db, ...heldSnapshots, catalog]);
    } finally {
      active.delete(root);
    }
  }
}

/** Upgrade only through the known append-only storage transitions. */
export async function migrateCatalog(options = {}) {
  const { root, openForMigration } = options;
  let toVersion = options.toVersion === undefined ? 3 : options.toVersion;
  if (![2, 3, 4].includes(toVersion)) fail("catalog_incompatible");
  if (typeof root !== "string" || !isAbsolute(root) || resolve(root) !== root)
    throw TypeError("Explicit absolute workspace root is required.");
  await closeOwned(root, pendingCleanup.get(root) ?? []);
  const completed = [];
  // Resume the recorded transition before trying a current-format SQLite open.
  for (const spec of TRANSITIONS) {
    const dir = join(root, spec.directory);
    if (
      (await optional(dir)) &&
      !(await optional(join(dir, "complete.json")))
    ) {
      if (spec.to > toVersion) fail("catalog_incompatible");
      completed.push(await migrateTransition({ ...options, spec }));
    }
  }
  let catalog = await openForMigration({ root }),
    version;
  try {
    version = catalog.catalogVersion;
  } finally {
    await catalog.close();
  }
  // Existing opt-in remains current; omitting a version never opts legacy data into schema 4.
  if (options.toVersion === undefined && version === 4) toVersion = 4;
  if (version > toVersion) fail("catalog_incompatible");
  while (version < toVersion) {
    const spec = transitionFor(version);
    completed.push(await migrateTransition({ ...options, spec }));
    version = spec.to;
  }
  const latest = await inspectMigration(root),
    last = completed.at(-1);
  return {
    catalogVersion: version,
    upgraded: completed.some((item) => item.upgraded),
    backup:
      last?.backup ??
      (latest
        ? {
            database: join(latest.dir, latest.intent.backup.file),
            owner: join(
              latest.dir,
              `owner-v${latest.intent.sourceOwner.catalogVersion}.json`,
            ),
          }
        : null),
    backups: completed.map((item) => item.backup).filter(Boolean),
  };
}
