import fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { loadTools } from "./tools.mjs";

// These versions are independent of package versions and of journal format 1.
import {
  APPLICATION_ID,
  CATALOG_VERSION,
  PROJECTION_VERSION,
  SCHEMA,
  SCHEMA_V1_HASH,
  MIGRATION_2_HASH,
  MIGRATION_3_HASH,
  validateDatabase,
  establishRollbackGuard,
} from "./catalog-schema.mjs";
import { createKnowledge } from "./knowledge.mjs";
import { checkedEvidence } from "./evidence.mjs";
import {
  createArchiveImports,
  archiveSummary,
  validateArchiveJournal,
} from "./archive-imports.mjs";
import { inspectMigration, migrateCatalog } from "./catalog-migration.mjs";
import {
  checkedCompressionRecord,
  checkedCompressionReplacement,
  decodeCompression,
  compressionMarker,
  MAX_GZIP_BYTES,
} from "./compressed-journal.mjs";
const MIGRATION_ACCESS = Symbol("private catalog migration access");
const MAX_RUN_BYTES = 16 * 1024 * 1024;
const MAX_INDEX_BYTES = 256 * 1024 * 1024;
const MAX_RUNS = 10000;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA = /^[a-f0-9]{64}$/;
const sameFile = (a, b) =>
  Boolean(a && b && a.dev === b.dev && a.ino === b.ino);
const overlaps = (a, b) =>
  a === b || a.startsWith(b + sep) || b.startsWith(a + sep);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) =>
  object(value) &&
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const safeId = (value) => typeof value === "string" && ID.test(value);
const text = (value, max = 256) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  !/[\u0000-\u001f\u007f]/.test(value);
const absolute = (value) =>
  text(value, 4096) && isAbsolute(value) && resolve(value) === value;
const fail = (code) => {
  throw Object.assign(
    Error(
      {
        compression_pending:
          "Journal replacement is incomplete. Explicitly retry compression before indexing or backup.",
        compression_corrupt:
          "Compressed journal bytes or ownership failed verification. Retain all data for inspection.",
        compression_conflict:
          "This journal already has different compression or replacement ownership.",
        compression_limit:
          "The retained compression exceeds the supported target bounds.",
        catalog_missing:
          "Initialize the explicit Universal catalog before reading it.",
        catalog_incompatible: "The Universal catalog format is unsupported.",
        catalog_corrupt:
          "The Universal catalog is invalid; preserve it for inspection.",
        catalog_ownership_changed:
          "Universal storage ownership changed; preserve it for inspection.",
        catalog_storage: "Universal storage could not complete the operation.",
        catalog_recovery_required:
          "An interrupted SQLite transaction requires explicit indexing before history can be read.",
        catalog_rollback_unproven:
          "Preserve the database and rollback journal for inspection; rollback ownership proof is incomplete.",
        catalog_unowned:
          "The Universal ownership receipt is missing; preserve the database for inspection.",
        catalog_cursor:
          "The history cursor is invalid or stale; refresh the first page.",
        catalog_changed:
          "History changed during indexing; explicitly index again.",
        catalog_limit: "The operation exceeds the supported history bound.",
        catalog_source_changed:
          "The recorded journal identity or committed prefix changed.",
        target_invalid: "The target registration is invalid.",
        target_conflict:
          "The target identity or private execution namespace is already registered.",
        target_not_found: "The requested target is not registered.",
        catalog_upgrade_required:
          "This workspace needs an explicit Universal storage upgrade before changes.",
        catalog_migration_pending:
          "A storage upgrade is pending; explicitly resume it before using this workspace.",
      }[code] || "Universal storage rejected the operation.",
    ),
    { code },
  );
};
const needsRollback = (error) =>
  error?.code === "ERR_SQLITE_ERROR" && error.errcode === 776;
const mapError = (error) => {
  if (needsRollback(error)) fail("catalog_recovery_required");
  if (
    /^(catalog_|target_|workspace_|journal_|evidence_|knowledge_|archive_|compression_)/.test(
      error?.code || "",
    )
  )
    throw error;
  fail("catalog_storage");
};

function checkedTarget(value) {
  if (
    !exact(value, [
      "id",
      "label",
      "environment",
      "origin",
      "authProfileRef",
      "projectId",
      "store",
      "sourceRoot",
      "configPath",
      "configSha256",
      "sourceSha256",
      "model",
    ]) ||
    !safeId(value.id) ||
    !safeId(value.projectId) ||
    !safeId(value.authProfileRef) ||
    !text(value.label) ||
    !text(value.environment) ||
    ![value.store, value.sourceRoot, value.configPath].every(absolute) ||
    !SHA.test(value.configSha256) ||
    !SHA.test(value.sourceSha256) ||
    !exact(value.model, ["id", "version"]) ||
    !text(value.model.id) ||
    !text(value.model.version)
  )
    fail("target_invalid");
  let origin;
  try {
    origin = new URL(value.origin);
  } catch {
    fail("target_invalid");
  }
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.origin !== value.origin ||
    origin.username ||
    origin.password
  )
    fail("target_invalid");
  // Reconstruct in a fixed order; property insertion order is not registration identity.
  return {
    id: value.id,
    label: value.label,
    environment: value.environment,
    origin: value.origin,
    authProfileRef: value.authProfileRef,
    projectId: value.projectId,
    store: value.store,
    sourceRoot: value.sourceRoot,
    configPath: value.configPath,
    configSha256: value.configSha256,
    sourceSha256: value.sourceSha256,
    model: { id: value.model.id, version: value.model.version },
  };
}
function targetRecord(row) {
  if (!row) fail("target_not_found");
  let value;
  try {
    value = JSON.parse(row.registration);
    checkedTarget(value);
  } catch {
    fail("catalog_corrupt");
  }
  if (
    row.id !== value.id ||
    row.project_id !== value.projectId ||
    row.store !== value.store ||
    row.auth_profile_ref !== value.authProfileRef ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 1
  )
    fail("catalog_corrupt");
  return { ...value, revision: row.revision };
}
const validTime = (value) =>
  typeof value === "string" &&
  value.length === 24 &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const count = (value) => Number.isSafeInteger(value) && value >= 0;
function checkedState(row, allowUnindexedGeneration = false) {
  if (
    !row ||
    !count(row.generation) ||
    !(row.indexed_at === null
      ? allowUnindexedGeneration || row.generation === 0
      : validTime(row.indexed_at) && row.generation > 0)
  )
    fail("catalog_corrupt");
  return row;
}
function checkedRunRow(row, targetId) {
  if (
    !row ||
    row.target_id !== targetId ||
    !safeId(row.run_id) ||
    typeof row.summary !== "string" ||
    row.summary.length > 32768 ||
    !count(row.checkpoint_offset) ||
    row.checkpoint_offset > MAX_RUN_BYTES ||
    !count(row.checkpoint_sequence) ||
    row.checkpoint_sequence > MAX_RUN_BYTES ||
    !SHA.test(row.checkpoint_hash) ||
    (row.checkpoint_offset === 0) !== (row.checkpoint_sequence === 0) ||
    (row.checkpoint_offset === 0 &&
      row.checkpoint_hash !== hash(Buffer.alloc(0))) ||
    !(row.source_dev === null
      ? row.source_ino === null &&
        row.source_hash === null &&
        row.source_size === null
      : typeof row.source_dev === "string" &&
        /^[0-9]{1,30}$/.test(row.source_dev) &&
        typeof row.source_ino === "string" &&
        /^[0-9]{1,30}$/.test(row.source_ino) &&
        SHA.test(row.source_hash) &&
        count(row.source_size) &&
        row.source_size <= MAX_RUN_BYTES)
  )
    fail("catalog_corrupt");
  let summary;
  try {
    summary = JSON.parse(row.summary);
  } catch {
    fail("catalog_corrupt");
  }
  if (
    !exact(summary, [
      "runId",
      "command",
      "commandTruncated",
      "recipe",
      "startedAt",
      "finishedAt",
      "status",
      "execution",
      "effect",
      "eventCount",
      "historyComplete",
      "reportTruncated",
      "indexedAt",
    ]) ||
    summary.runId !== row.run_id ||
    !(
      summary.command === null ||
      (typeof summary.command === "string" &&
        summary.command.length > 0 &&
        summary.command.length <= 4096)
    ) ||
    typeof summary.commandTruncated !== "boolean" ||
    (summary.command === null && summary.commandTruncated) ||
    typeof summary.recipe !== "boolean" ||
    !(summary.startedAt === null || validTime(summary.startedAt)) ||
    !(summary.finishedAt === null || validTime(summary.finishedAt)) ||
    !["finished", "incomplete", "corrupt", "unsupported", "missing"].includes(
      summary.status,
    ) ||
    !count(summary.eventCount) ||
    summary.eventCount > MAX_RUN_BYTES ||
    typeof summary.historyComplete !== "boolean" ||
    typeof summary.reportTruncated !== "boolean" ||
    !validTime(summary.indexedAt) ||
    !exact(summary.effect, ["status"]) ||
    typeof summary.effect.status !== "string" ||
    summary.effect.status.length > 256 ||
    !summary.effect.status ||
    row.sort_at !== (summary.startedAt ?? "")
  )
    fail("catalog_corrupt");
  if (summary.status === "finished") {
    if (
      !summary.historyComplete ||
      !summary.startedAt ||
      !summary.finishedAt ||
      summary.eventCount < 2 ||
      !["completed", "failed", "rejected", "stopped"].includes(
        summary.execution,
      ) ||
      row.checkpoint_offset !== row.source_size ||
      summary.eventCount !== row.checkpoint_sequence
    )
      fail("catalog_corrupt");
  } else {
    if (
      summary.historyComplete ||
      summary.finishedAt !== null ||
      summary.execution !== "unknown" ||
      summary.effect.status !== "uncertain" ||
      summary.reportTruncated
    )
      fail("catalog_corrupt");
    if (
      summary.status === "incomplete"
        ? row.source_size === null ||
          row.checkpoint_offset > row.source_size ||
          summary.eventCount !== row.checkpoint_sequence
        : summary.eventCount !== 0
    )
      fail("catalog_corrupt");
  }
  return row;
}
function connect(path, readonly) {
  const filename = pathToFileURL(path);
  filename.searchParams.set("mode", readonly ? "ro" : "rw");
  const db = new DatabaseSync(filename.href, {
    readOnly: readonly,
    enableForeignKeyConstraints: true,
  });
  db.exec("PRAGMA trusted_schema=OFF");
  db.exec("PRAGMA busy_timeout=1000");
  if (readonly) db.exec("PRAGMA query_only=ON");
  else db.exec("PRAGMA synchronous=EXTRA");
  return db;
}
function transaction(db, work) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw error;
  }
}

/** Optional Universal catalog. Merely opening or browsing never creates or updates data. */
export async function openCatalog({
  root,
  create = false,
  [MIGRATION_ACCESS]: migrationAccess = false,
} = {}) {
  if (!absolute(root) || typeof create !== "boolean") fail("target_invalid");
  const { journalFilesystem: io, readRunJournal } =
    await loadTools("run-journal");
  const { openWorkspace } = await loadTools("workspace");
  const readDirectory = (path) =>
    io.directory(path).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
  const rootIdentity = await readDirectory(root);
  if (!migrationAccess) await inspectMigration(root);
  if (!rootIdentity) fail("catalog_missing");
  const manifest = await io.smallFile(join(root, "workspace.json"), 8192);
  let marker;
  try {
    marker = JSON.parse(manifest.bytes);
  } catch {
    fail("catalog_corrupt");
  }
  if (
    !exact(marker, ["schemaVersion", "kind", "workspaceId", "formats"]) ||
    marker.schemaVersion !== 1 ||
    marker.kind !== "daedlo-workspace" ||
    !safeId(marker.workspaceId) ||
    !isDeepStrictEqual(marker.formats, { managedRun: 1, runJournal: 1 })
  )
    fail("catalog_incompatible");
  const path = join(root, "workspace.sqlite");
  async function assertWorkspace() {
    if (
      !sameFile(rootIdentity, await readDirectory(root)) ||
      !(await io.smallFile(join(root, "workspace.json"), 8192)).bytes.equals(
        manifest.bytes,
      )
    )
      fail("catalog_ownership_changed");
  }
  const statDB = async () => {
    const stat = await fs.lstat(path, { bigint: true }).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n))
      fail("catalog_ownership_changed");
    return stat;
  };
  const ownerPath = path + ".owner.json";
  async function readOwner() {
    let file;
    try {
      file = await io.smallFile(ownerPath, 8192);
    } catch (error) {
      if (error.code === "ENOENT") fail("catalog_unowned");
      throw error;
    }
    let record;
    try {
      record = JSON.parse(file.bytes);
    } catch {
      fail("catalog_corrupt");
    }
    if (
      !exact(record, [
        "format",
        "workspaceId",
        "catalogId",
        "catalogVersion",
        "projectionVersion",
        "database",
        "metadataPage",
      ]) ||
      record.format !== "daedlo-universal-owner/1" ||
      ![1, 2, 3, 4].includes(record.catalogVersion) ||
      record.projectionVersion !== PROJECTION_VERSION
    )
      fail("catalog_incompatible");
    if (
      record.workspaceId !== marker.workspaceId ||
      typeof record.catalogId !== "string" ||
      !/^[a-f0-9-]{36}$/.test(record.catalogId) ||
      file.stat.nlink !== 1n ||
      !exact(record.database, ["dev", "ino"]) ||
      ![record.database.dev, record.database.ino].every(
        (value) => typeof value === "string" && /^[0-9]{1,30}$/.test(value),
      ) ||
      !exact(record.metadataPage, ["offset", "size", "sha256"]) ||
      ![512, 1024, 2048, 4096, 8192, 16384, 32768, 65536].includes(
        record.metadataPage.size,
      ) ||
      record.metadataPage.offset !== record.metadataPage.size ||
      !SHA.test(record.metadataPage.sha256)
    )
      fail("catalog_ownership_changed");
    return { ...file, record };
  }
  async function publishOwner(record) {
    const temporary = join(root, `.universal-owner-${randomUUID()}.json`);
    let handle, owned;
    try {
      handle = await fs.open(temporary, "wx", 0o600);
      owned = await handle.stat({ bigint: true });
      await handle.writeFile(JSON.stringify(record) + "\n");
      await handle.sync();
      await handle.close();
      handle = null;
      await assertWorkspace();
      await fs.link(temporary, ownerPath);
      await io.syncDirectory(root);
    } finally {
      await handle?.close();
      if (owned)
        try {
          await io.unlinkOwned(temporary, owned, rootIdentity);
        } catch (cause) {
          throw Object.assign(
            Error("Universal ownership publication cleanup is incomplete."),
            {
              code: "catalog_cleanup_incomplete",
              retainedPath: temporary,
              cause,
            },
          );
        }
    }
  }
  let identity = await statDB();
  if (!identity) {
    for (const suffix of ["-journal", "-wal", "-shm"]) {
      const retained = await fs.lstat(path + suffix).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (retained) fail("catalog_unowned");
    }
    const existingOwner = await fs.lstat(ownerPath).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (existingOwner) fail("catalog_ownership_changed");
    if (!create) fail("catalog_missing");
    const temporary = join(root, `.universal-${randomUUID()}.sqlite`);
    const newCatalogId = randomUUID();
    let owned, db;
    try {
      const handle = await fs.open(temporary, "wx", 0o600);
      owned = await handle.stat({ bigint: true });
      await handle.close();
      db = connect(temporary, false);
      db.exec("PRAGMA journal_mode=DELETE");
      transaction(db, () => {
        db.exec(
          `PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=${CATALOG_VERSION};`,
        );
        db.exec(SCHEMA);
        db.prepare("INSERT INTO catalog_meta VALUES(1,?,?,?,?,?)").run(
          `daedlo-universal/${CATALOG_VERSION}`,
          CATALOG_VERSION,
          PROJECTION_VERSION,
          marker.workspaceId,
          newCatalogId,
        );
        db.prepare("INSERT INTO catalog_migrations VALUES(1,?)").run(
          SCHEMA_V1_HASH,
        );
        db.prepare("INSERT INTO catalog_migrations VALUES(2,?)").run(
          MIGRATION_2_HASH,
        );
        db.prepare("INSERT INTO catalog_migrations VALUES(3,?)").run(
          MIGRATION_3_HASH,
        );
      });
      const pageSize = db.prepare("PRAGMA page_size").get().page_size;
      const pageNumber = db
        .prepare("SELECT rootpage FROM sqlite_schema WHERE name='catalog_meta'")
        .get().rootpage;
      if (pageNumber !== 2) fail("catalog_incompatible");
      db.close();
      db = null;
      const handleSync = await fs.open(
        temporary,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      const page = Buffer.alloc(pageSize);
      try {
        if (!sameFile(owned, await handleSync.stat({ bigint: true })))
          fail("catalog_ownership_changed");
        if (
          (await handleSync.read(page, 0, pageSize, pageSize)).bytesRead !==
          pageSize
        )
          fail("catalog_corrupt");
        await handleSync.sync();
      } finally {
        await handleSync.close();
      }
      await assertWorkspace();
      let published = false;
      try {
        await fs.link(temporary, path);
        published = true;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      await io.syncDirectory(root);
      const databaseIdentity = owned;
      await io.unlinkOwned(temporary, owned, rootIdentity);
      owned = null;
      if (published)
        await publishOwner({
          format: "daedlo-universal-owner/1",
          workspaceId: marker.workspaceId,
          catalogId: newCatalogId,
          catalogVersion: CATALOG_VERSION,
          projectionVersion: PROJECTION_VERSION,
          database: {
            dev: String(databaseIdentity.dev),
            ino: String(databaseIdentity.ino),
          },
          metadataPage: {
            offset: pageSize,
            size: pageSize,
            sha256: hash(page),
          },
        });
    } catch (error) {
      mapError(error);
    } finally {
      db?.close();
      if (owned)
        try {
          await io.unlinkOwned(temporary, owned, rootIdentity);
        } catch (cause) {
          throw Object.assign(
            Error(
              "Universal initialization cleanup is incomplete; retain its temporary database.",
            ),
            {
              code: "catalog_cleanup_incomplete",
              retainedPath: temporary,
              cause,
            },
          );
        }
    }
    identity = await statDB();
  }
  const owner = await readOwner();
  if (
    !identity ||
    owner.record.database.dev !== String(identity.dev) ||
    owner.record.database.ino !== String(identity.ino)
  )
    fail("catalog_ownership_changed");
  const version = owner.record.catalogVersion;
  const assertV2 = () => {
    if (version < 2) fail("catalog_upgrade_required");
  };
  const assertV3 = () => {
    if (version < 3) fail("catalog_upgrade_required");
  };
  const assertV4 = () => {
    if (version < 4) fail("catalog_upgrade_required");
  };
  let closed = false,
    catalogId = owner.record.catalogId;
  // Ownership gate only. SQLite remains responsible for rollback validation.
  // https://www.sqlite.org/fileformat2.html#the_rollback_journal
  async function rollbackOwner() {
    const journalPath = path + "-journal";
    const before = await fs
      .lstat(journalPath, { bigint: true })
      .catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
    if (!before) return null;
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n)
      fail("catalog_ownership_changed");
    const handle = await fs.open(
      journalPath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      if (!sameFile(before, await handle.stat({ bigint: true })))
        fail("catalog_changed");
      const header = Buffer.alloc(28);
      if ((await handle.read(header, 0, 28, 0)).bytesRead !== 28)
        fail("catalog_rollback_unproven");
      const magic = header.subarray(0, 8).toString("hex"),
        hot = magic === "d9d505f920a163d7";
      const sector = header.readUInt32BE(20),
        pageSize = header.readUInt32BE(24),
        pages = header.readUInt32BE(8);
      if (!hot && magic !== "0000000000000000")
        fail("catalog_ownership_changed");
      if (
        ![512, 1024, 2048, 4096, 8192, 16384, 32768, 65536].includes(sector) ||
        pageSize !== owner.record.metadataPage.size ||
        header.readUInt32BE(16) < 2 ||
        (hot && pages === 0)
      )
        fail("catalog_rollback_unproven");
      const first = Buffer.alloc(pageSize + 8);
      if (
        (await handle.read(first, 0, first.length, sector)).bytesRead !==
        first.length
      )
        fail("catalog_rollback_unproven");
      const page = first.subarray(4, pageSize + 4);
      let checksum = header.readUInt32BE(12);
      for (let offset = pageSize - 200; offset >= 0; offset -= 200)
        checksum = (checksum + page[offset]) >>> 0;
      if (
        first.readUInt32BE(0) !== 2 ||
        checksum !== first.readUInt32BE(pageSize + 4) ||
        hash(page) !== owner.record.metadataPage.sha256
      )
        fail("catalog_ownership_changed");
      const after = await handle.stat({ bigint: true });
      if (
        !sameFile(before, await fs.lstat(journalPath, { bigint: true })) ||
        after.size !== before.size ||
        after.mtimeNs !== before.mtimeNs
      )
        fail("catalog_changed");
      return { hot, originalPage: page };
    } finally {
      await handle.close();
    }
  }
  async function assertHeader() {
    const rollback = await rollbackOwner();
    const handle = await fs.open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      if (!sameFile(identity, await handle.stat({ bigint: true })))
        fail("catalog_ownership_changed");
      const bytes = Buffer.alloc(100);
      const read = await handle.read(bytes, 0, 100, 0);
      if (
        read.bytesRead !== 100 ||
        bytes.subarray(0, 16).toString("ascii") !== "SQLite format 3\0" ||
        bytes[18] !== 1 ||
        bytes[19] !== 1 ||
        bytes.readUInt32BE(60) !== version ||
        bytes.readUInt32BE(68) !== APPLICATION_ID
      )
        fail("catalog_incompatible");
      const pageSize =
        bytes.readUInt16BE(16) === 1 ? 65536 : bytes.readUInt16BE(16);
      if (pageSize !== owner.record.metadataPage.size)
        fail("catalog_ownership_changed");
      const page = Buffer.alloc(pageSize);
      if (
        (await handle.read(page, 0, pageSize, owner.record.metadataPage.offset))
          .bytesRead !== pageSize
      )
        fail("catalog_ownership_changed");
      let ownTransient = false;
      if (rollback?.hot) {
        const beforeImage = Buffer.from(rollback.originalPage);
        const token = Buffer.from(catalogId);
        const location = beforeImage.indexOf(token);
        if (location >= 0 && beforeImage.indexOf(token, location + 1) === -1) {
          beforeImage[location] = catalogId[0] === "0" ? 49 : 48;
          ownTransient = page.equals(beforeImage);
        }
      }
      if (
        (hash(page) !== owner.record.metadataPage.sha256 && !ownTransient) ||
        !sameFile(identity, await handle.stat({ bigint: true }))
      )
        fail("catalog_ownership_changed");
    } finally {
      await handle.close();
    }
  }
  async function assertOwned() {
    if (closed) fail("catalog_closed");
    await assertWorkspace();
    if (!migrationAccess) await inspectMigration(root);
    const currentOwner = await readOwner();
    if (
      !sameFile(currentOwner.stat, owner.stat) ||
      !currentOwner.bytes.equals(owner.bytes)
    )
      fail("catalog_ownership_changed");
    if (!identity || !sameFile(identity, await statDB()))
      fail("catalog_ownership_changed");
    for (const suffix of ["-journal", "-wal", "-shm"]) {
      const sidecar = await fs
        .lstat(path + suffix, { bigint: true })
        .catch((error) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
      if (
        sidecar &&
        (!sidecar.isFile() || sidecar.isSymbolicLink() || sidecar.nlink !== 1n)
      )
        fail("catalog_ownership_changed");
      if (sidecar && suffix !== "-journal") fail("catalog_incompatible");
    }
  }
  async function use(readonly, operation) {
    if (!readonly && !migrationAccess) assertV2();
    let db;
    try {
      await assertOwned();
      await assertHeader();
      // Refuse unknown definitions, triggers and versions before obtaining any
      // writable SQLite connection. Recheck under the write transaction lock.
      if (!readonly) {
        try {
          db = connect(path, true);
          db.exec("BEGIN");
          validateDatabase(db, marker.workspaceId, catalogId, version);
          db.exec("COMMIT");
          db.close();
          db = null;
        } catch (error) {
          db?.close();
          db = null;
          if (!needsRollback(error)) throw error;
          // Only an explicit mutation may let SQLite roll back its own hot
          // rollback journal. Header compatibility is checked without SQL;
          // restored definitions and identity are checked before any DML.
          await assertHeader();
        }
      }
      db = connect(path, readonly);
      db.exec(readonly ? "BEGIN" : "BEGIN IMMEDIATE");
      const found = validateDatabase(
        db,
        marker.workspaceId,
        catalogId,
        version,
      );
      catalogId ||= found;
      if (!readonly) {
        // A real equal-length change, restored synchronously, guarantees the
        // original immutable metadata page is the journal's first before-image.
        // A no-op UPDATE is optimized away and cannot establish this proof.
        establishRollbackGuard(db, catalogId);
      }
      const result = operation(db);
      db.exec("COMMIT");
      db.close();
      db = null;
      await assertOwned();
      return result;
    } catch (error) {
      if (db) {
        try {
          db.exec("ROLLBACK");
        } catch {}
      }
      mapError(error);
    } finally {
      db?.close();
    }
  }
  try {
    await use(true, () => null);
  } catch (error) {
    if (error.code !== "catalog_recovery_required") throw error;
    await assertOwned();
    await assertHeader();
  }
  function targetIn(db, id) {
    if (!safeId(id)) fail("target_invalid");
    return targetRecord(db.prepare("SELECT * FROM targets WHERE id=?").get(id));
  }
  async function workspaceFor(target) {
    return openWorkspace({
      schemaVersion: 2,
      workspace: { id: marker.workspaceId, root, journal: 1 },
      store: target.store,
      registration: {
        projectId: target.projectId,
        sourceRoot: target.sourceRoot,
      },
    });
  }
  const readState = (db, id) =>
    checkedState(
      db
        .prepare(
          "SELECT generation,indexed_at FROM history_state WHERE target_id=?",
        )
        .get(id),
      version >= 3,
    );
  const getTarget = (id) => use(true, (db) => targetIn(db, id));
  async function registerTarget(input) {
    const target = checkedTarget(input);
    await workspaceFor(target);
    await readDirectory(target.store);
    await readDirectory(target.sourceRoot);
    return use(false, (db) => {
      const existing = db
        .prepare("SELECT * FROM targets WHERE id=?")
        .get(target.id);
      if (existing) {
        const current = targetRecord(existing);
        if (
          !isDeepStrictEqual(current, { ...target, revision: current.revision })
        )
          fail("target_conflict");
        return current;
      }
      if (
        db.prepare("SELECT count(*) AS count FROM targets").get().count >= 1000
      )
        fail("catalog_limit");
      const registered = db
        .prepare("SELECT * FROM targets")
        .all()
        .map(targetRecord);
      if (
        registered.some(
          (other) =>
            overlaps(target.store, other.store) ||
            overlaps(target.store, other.sourceRoot) ||
            overlaps(target.sourceRoot, other.store),
        )
      )
        fail("target_conflict");
      const collision = db
        .prepare(
          "SELECT id FROM targets WHERE project_id=? OR store=? OR auth_profile_ref=?",
        )
        .get(target.projectId, target.store, target.authProfileRef);
      if (collision) fail("target_conflict");
      db.prepare("INSERT INTO targets VALUES(?,?,?,?,1,?)").run(
        target.id,
        target.projectId,
        target.store,
        target.authProfileRef,
        JSON.stringify(target),
      );
      db.prepare("INSERT INTO target_revisions VALUES(?,1,?)").run(
        target.id,
        JSON.stringify(target),
      );
      db.prepare("INSERT INTO history_state VALUES(?,0,NULL)").run(target.id);
      return { ...target, revision: 1 };
    });
  }
  async function reviseTarget(input, { expectedRevision } = {}) {
    const target = checkedTarget(input);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
      fail("target_invalid");
    await workspaceFor(target);
    await readDirectory(target.store);
    await readDirectory(target.sourceRoot);
    return use(false, (db) => {
      const current = targetIn(db, target.id);
      if (current.revision !== expectedRevision) fail("target_conflict");
      for (const field of [
        "id",
        "projectId",
        "store",
        "sourceRoot",
        "configPath",
        "origin",
        "environment",
        "authProfileRef",
      ])
        if (current[field] !== target[field]) fail("target_conflict");
      if (isDeepStrictEqual(current, { ...target, revision: current.revision }))
        return current;
      const revision = current.revision + 1;
      db.prepare("INSERT INTO target_revisions VALUES(?,?,?)").run(
        target.id,
        revision,
        JSON.stringify(target),
      );
      db.prepare(
        "UPDATE targets SET revision=?,registration=? WHERE id=? AND revision=?",
      ).run(revision, JSON.stringify(target), target.id, expectedRevision);
      return { ...target, revision };
    });
  }
  function summaryFor(runId, history, indexedAt) {
    const first = history.events[0],
      last = history.events.at(-1),
      report = history.report;
    const command = first?.payload.command ?? null;
    return {
      runId,
      command: command?.slice(0, 4096) ?? null,
      commandTruncated: (command?.length || 0) > 4096,
      recipe: first?.payload.recipe ?? false,
      startedAt: first?.payload.startedAt ?? null,
      finishedAt: history.status === "finished" ? last.timestamp : null,
      status: history.status,
      execution: report?.lastResult?.execution ?? "unknown",
      effect: {
        status:
          typeof report?.lastResult?.effect?.status === "string" &&
          report.lastResult.effect.status.length > 0
            ? report.lastResult.effect.status.slice(0, 256)
            : "uncertain",
      },
      eventCount: history.events.length,
      historyComplete: history.historyComplete,
      reportTruncated: report?.eventRange?.truncated === true,
      indexedAt,
    };
  }
  function invalidSummary(runId, status, indexedAt, prior) {
    const old = prior ? JSON.parse(prior.summary) : {};
    return {
      runId,
      command: old.command ?? null,
      commandTruncated: old.commandTruncated ?? false,
      recipe: old.recipe ?? false,
      startedAt: old.startedAt ?? null,
      finishedAt: null,
      status,
      execution: "unknown",
      effect: { status: "uncertain" },
      eventCount: 0,
      historyComplete: false,
      reportTruncated: false,
      indexedAt,
    };
  }
  const bindingValid = (value) =>
    exact(value, ["dev", "ino"]) &&
    [value.dev, value.ino].every(
      (item) => typeof item === "string" && /^[0-9]{1,30}$/.test(item),
    );
  const bindingMatches = (binding, stat) =>
    binding.dev === String(stat.dev) && binding.ino === String(stat.ino);
  function compressionIn(db, targetId, runId) {
    const target = targetIn(db, targetId);
    if (!safeId(runId)) fail("target_invalid");
    if (version < 4) return null;
    const size = db
      .prepare(
        "SELECT length(gzip_bytes) AS bytes,length(metadata) AS metadata_bytes,length(replacement) AS replacement_bytes FROM journal_compressions WHERE target_id=? AND run_id=?",
      )
      .get(targetId, runId);
    if (!size) return null;
    if (
      size.bytes < 1 ||
      size.bytes > MAX_GZIP_BYTES ||
      size.metadata_bytes > 8192 ||
      size.replacement_bytes > 32768
    )
      fail("compression_corrupt");
    const row = db
      .prepare(
        "SELECT * FROM journal_compressions WHERE target_id=? AND run_id=?",
      )
      .get(targetId, runId);
    let record, replacement;
    try {
      record = checkedCompressionRecord(JSON.parse(row.metadata));
      replacement =
        row.replacement === null
          ? null
          : checkedCompressionReplacement(JSON.parse(row.replacement), record);
    } catch {
      fail("compression_corrupt");
    }
    const binding = { dev: row.binding_dev, ino: row.binding_ino };
    if (
      record.id !== row.id ||
      record.targetId !== targetId ||
      record.runId !== runId ||
      record.projectId !== target.projectId ||
      record.workspaceId !== marker.workspaceId ||
      !["retained", "active"].includes(row.state) ||
      !bindingValid(binding)
    )
      fail("compression_corrupt");
    if (
      replacement &&
      !isDeepStrictEqual(
        row.state === "active" ? replacement.marker : replacement.source,
        binding,
      )
    )
      fail("compression_corrupt");
    const value = {
      record,
      gzipBytes: Buffer.from(row.gzip_bytes),
      state: row.state,
      binding,
      replacement,
    };
    decodeCompression(value);
    return value;
  }
  async function getCompression({ targetId, runId } = {}) {
    return use(true, (db) => compressionIn(db, targetId, runId));
  }
  async function retainCompression({
    record: input,
    gzipBytes: inputBytes,
    expectedRevision,
  } = {}) {
    assertV4();
    const record = structuredClone(checkedCompressionRecord(input)),
      gzipBytes = Buffer.from(inputBytes ?? []);
    const decoded = decodeCompression({ record, gzipBytes });
    if (
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 1 ||
      record.workspaceId !== marker.workspaceId
    )
      fail("target_invalid");
    const target = await getTarget(record.targetId);
    if (
      target.revision !== expectedRevision ||
      target.projectId !== record.projectId
    )
      fail("catalog_changed");
    const existing = await getCompression({
      targetId: record.targetId,
      runId: record.runId,
    });
    if (existing) {
      if (
        !isDeepStrictEqual(existing.record, record) ||
        !existing.gzipBytes.equals(gzipBytes)
      )
        fail("compression_conflict");
      return existing;
    }
    const workspace = await workspaceFor(target),
      snapshot = await sourceSnapshot(workspace, record.runId);
    const history = await readRunJournal({ workspace, runId: record.runId });
    const after = await sourceSnapshot(workspace, record.runId);
    if (
      !sameFile(snapshot.stat, after.stat) ||
      !snapshot.bytes.equals(after.bytes) ||
      !bindingMatches(record.source, snapshot.stat) ||
      !snapshot.bytes.equals(decoded.bytes) ||
      snapshot.stat.nlink !== 1n ||
      history.status !== "finished" ||
      !isDeepStrictEqual(history, decoded.history)
    )
      fail("compression_corrupt");
    return use(false, (db) => {
      const current = targetIn(db, target.id);
      if (
        current.revision !== expectedRevision ||
        current.projectId !== record.projectId
      )
        fail("catalog_changed");
      const found = compressionIn(db, target.id, record.runId);
      if (found) {
        if (
          !isDeepStrictEqual(found.record, record) ||
          !found.gzipBytes.equals(gzipBytes)
        )
          fail("compression_conflict");
        return found;
      }
      const previous = db
        .prepare("SELECT * FROM runs WHERE target_id=? AND run_id=?")
        .get(target.id, record.runId);
      if (previous) {
        checkedRunRow(previous, target.id);
        if (!matchesPrefix(previous, snapshot)) fail("catalog_source_changed");
      }
      const totals = db
        .prepare(
          "SELECT count(*) AS count,coalesce(sum(length(gzip_bytes)),0) AS bytes FROM journal_compressions WHERE target_id=?",
        )
        .get(target.id);
      if (
        totals.count >= MAX_RUNS ||
        totals.bytes + gzipBytes.length > MAX_INDEX_BYTES
      )
        fail("compression_limit");
      if (
        db
          .prepare("SELECT 1 FROM journal_compressions WHERE id=?")
          .get(record.id)
      )
        fail("compression_conflict");
      db.prepare(
        "INSERT INTO journal_compressions VALUES(?,?,?,?,?,'retained',?,?,NULL)",
      ).run(
        target.id,
        record.runId,
        record.id,
        JSON.stringify(record),
        gzipBytes,
        String(snapshot.stat.dev),
        String(snapshot.stat.ino),
      );
      return compressionIn(db, target.id, record.runId);
    });
  }
  async function prepareCompressionReplacement({
    targetId,
    runId,
    id,
    sourceBinding,
    replacement: input,
  } = {}) {
    assertV4();
    if (!bindingValid(sourceBinding)) fail("compression_corrupt");
    sourceBinding = { ...sourceBinding };
    const existing = await getCompression({ targetId, runId });
    if (
      !existing ||
      existing.record.id !== id ||
      existing.state !== "retained" ||
      !isDeepStrictEqual(existing.binding, sourceBinding)
    )
      fail("compression_conflict");
    const replacement = structuredClone(
      checkedCompressionReplacement(input, existing.record),
    );
    if (!isDeepStrictEqual(replacement.source, sourceBinding))
      fail("compression_conflict");
    const workspace = await workspaceFor(await getTarget(targetId));
    const source = await sourceSnapshot(workspace, runId);
    const temporary = await io.smallFile(
      join(workspace.journalRoot, replacement.temporary),
      8192,
    );
    const lock = await io.smallFile(
      join(workspace.journalRoot, "writer.lock"),
      8192,
    );
    if (
      source.stat.nlink !== 1n ||
      temporary.stat.nlink !== 1n ||
      lock.stat.nlink !== 1n ||
      !bindingMatches(sourceBinding, source.stat) ||
      !bindingMatches(replacement.marker, temporary.stat) ||
      !temporary.bytes.equals(compressionMarker(existing.record)) ||
      !bindingMatches(replacement.writer, lock.stat) ||
      hash(lock.bytes) !== replacement.writer.sha256 ||
      !isDeepStrictEqual(JSON.parse(lock.bytes), replacement.writerRecord)
    )
      fail("compression_corrupt");
    return use(false, (db) => {
      const current = compressionIn(db, targetId, runId);
      if (
        !current ||
        current.record.id !== id ||
        current.state !== "retained" ||
        !isDeepStrictEqual(current.binding, sourceBinding)
      )
        fail("compression_conflict");
      if (current.replacement) {
        if (!isDeepStrictEqual(current.replacement, replacement))
          fail("compression_conflict");
        return current;
      }
      db.prepare(
        "UPDATE journal_compressions SET replacement=? WHERE target_id=? AND run_id=?",
      ).run(JSON.stringify(replacement), targetId, runId);
      db.prepare(
        "UPDATE history_state SET generation=generation+1 WHERE target_id=?",
      ).run(targetId);
      return compressionIn(db, targetId, runId);
    });
  }
  async function activateCompression({
    targetId,
    runId,
    id,
    sourceBinding,
    binding,
  } = {}) {
    assertV4();
    if (!bindingValid(sourceBinding) || !bindingValid(binding))
      fail("compression_corrupt");
    sourceBinding = { ...sourceBinding };
    binding = { ...binding };
    const existing = await getCompression({ targetId, runId });
    if (
      !existing ||
      existing.record.id !== id ||
      !existing.replacement ||
      !isDeepStrictEqual(existing.replacement.marker, binding)
    )
      fail("compression_conflict");
    const workspace = await workspaceFor(await getTarget(targetId)),
      file = await io.smallFile(
        join(workspace.journalRoot, runId + ".jsonl"),
        8192,
      );
    if (
      !bindingMatches(binding, file.stat) ||
      !file.bytes.equals(compressionMarker(existing.record))
    )
      fail("compression_corrupt");
    await compressionLinks(
      workspace,
      { ...existing, state: "active" },
      file.stat,
    );
    return use(false, (db) => {
      const current = compressionIn(db, targetId, runId);
      if (
        !current ||
        current.record.id !== id ||
        !isDeepStrictEqual(current.replacement, existing.replacement)
      )
        fail("compression_conflict");
      if (current.state === "active") {
        if (!isDeepStrictEqual(current.binding, binding))
          fail("compression_conflict");
        return current;
      }
      if (!isDeepStrictEqual(current.binding, sourceBinding))
        fail("compression_conflict");
      const previous = db
          .prepare("SELECT * FROM runs WHERE target_id=? AND run_id=?")
          .get(targetId, runId),
        decoded = decodeCompression(current);
      if (previous) {
        checkedRunRow(previous, targetId);
        if (
          !matchesPrefix(previous, {
            stat: {
              dev: BigInt(sourceBinding.dev),
              ino: BigInt(sourceBinding.ino),
            },
            bytes: decoded.bytes,
          })
        )
          fail("catalog_source_changed");
        db.prepare(
          "UPDATE runs SET source_dev=?,source_ino=? WHERE target_id=? AND run_id=?",
        ).run(binding.dev, binding.ino, targetId, runId);
      }
      db.prepare(
        "UPDATE journal_compressions SET state='active',binding_dev=?,binding_ino=? WHERE target_id=? AND run_id=?",
      ).run(binding.dev, binding.ino, targetId, runId);
      db.prepare(
        "UPDATE history_state SET generation=generation+1 WHERE target_id=?",
      ).run(targetId);
      return compressionIn(db, targetId, runId);
    });
  }
  async function clearCompressionReplacement({
    targetId,
    runId,
    id,
    binding,
  } = {}) {
    assertV4();
    if (!bindingValid(binding)) fail("compression_corrupt");
    binding = { ...binding };
    const existing = await getCompression({ targetId, runId });
    if (
      !existing ||
      existing.record.id !== id ||
      existing.state !== "active" ||
      !isDeepStrictEqual(existing.binding, binding)
    )
      fail("compression_conflict");
    const workspace = await workspaceFor(await getTarget(targetId));
    const currentFile = await sourceSnapshot(workspace, runId);
    if (currentFile.stat.nlink !== 1n) fail("compression_corrupt");
    if (existing.replacement)
      for (const name of [
        existing.replacement.temporary,
        existing.replacement.retained,
      ]) {
        const found = await fs
          .lstat(join(workspace.journalRoot, name))
          .catch((error) => {
            if (error.code === "ENOENT") return null;
            throw error;
          });
        if (found) fail("compression_pending");
      }
    return use(false, (db) => {
      const current = compressionIn(db, targetId, runId);
      if (
        !current ||
        current.record.id !== id ||
        current.state !== "active" ||
        !isDeepStrictEqual(current.binding, binding) ||
        !isDeepStrictEqual(current.replacement, existing.replacement)
      )
        fail("compression_conflict");
      db.prepare(
        "UPDATE journal_compressions SET replacement=NULL WHERE target_id=? AND run_id=?",
      ).run(targetId, runId);
      return compressionIn(db, targetId, runId);
    });
  }
  function matchesPrefix(previous, snapshot) {
    return (
      !previous ||
      (previous.source_dev === String(snapshot.stat.dev) &&
        previous.source_ino === String(snapshot.stat.ino) &&
        snapshot.bytes.length >= previous.checkpoint_offset &&
        hash(snapshot.bytes.subarray(0, previous.checkpoint_offset)) ===
          previous.checkpoint_hash)
    );
  }
  async function compressionLinks(workspace, compression, stat) {
    if (stat.nlink === 1n) return;
    if (stat.nlink !== 2n || !compression.replacement)
      fail("compression_corrupt");
    const name =
      compression.state === "active"
        ? compression.replacement.temporary
        : compression.replacement.retained;
    const other = await fs
      .lstat(join(workspace.journalRoot, name), { bigint: true })
      .catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
    if (
      !other ||
      !other.isFile() ||
      other.isSymbolicLink() ||
      other.nlink !== 2n ||
      !sameFile(stat, other)
    )
      fail("compression_corrupt");
  }
  async function sourceSnapshot(workspace, runId) {
    await workspace.assertCompatible();
    const directory = await readDirectory(workspace.journalRoot);
    if (!directory)
      throw Object.assign(Error("Missing journal"), { code: "ENOENT" });
    const compression =
      version >= 4
        ? await use(true, (db) => {
            const target = db
              .prepare("SELECT id FROM targets WHERE project_id=?")
              .get(workspace.projectId);
            if (!target) fail("target_not_found");
            return compressionIn(db, target.id, runId);
          })
        : null;
    let file;
    try {
      file = await io.smallFile(
        join(workspace.journalRoot, runId + ".jsonl"),
        MAX_RUN_BYTES,
      );
    } catch (error) {
      if (error.code === "ENOENT" && compression?.replacement)
        fail("compression_pending");
      throw error;
    }
    if (!sameFile(directory, await readDirectory(workspace.journalRoot)))
      fail("catalog_source_changed");
    if (!compression) return file;
    const { bytes, history } = decodeCompression(compression);
    const markerBytes = compressionMarker(compression.record);
    if (compression.state === "retained") {
      if (file.bytes.equals(markerBytes)) fail("compression_pending");
      await compressionLinks(workspace, compression, file.stat);
      if (
        !bindingMatches(compression.binding, file.stat) ||
        !file.bytes.equals(bytes)
      )
        fail("compression_corrupt");
      return { ...file, history };
    }
    await compressionLinks(workspace, compression, file.stat);
    if (
      !bindingMatches(compression.binding, file.stat) ||
      !file.bytes.equals(markerBytes)
    )
      fail("compression_corrupt");
    return { ...file, bytes, history };
  }
  async function indexTarget(
    targetId,
    { rebuild = false, expectedRevision } = {},
  ) {
    if (
      typeof rebuild !== "boolean" ||
      (expectedRevision !== undefined &&
        (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1))
    )
      fail("target_invalid");
    assertV2();
    try {
      await use(true, () => null);
    } catch (error) {
      if (error.code !== "catalog_recovery_required") throw error;
      await use(false, () => null);
    }
    const initial = await use(true, (db) => {
      if (
        db
          .prepare("SELECT count(*) AS count FROM runs WHERE target_id=?")
          .get(targetId).count +
          (version >= 3
            ? db
                .prepare(
                  "SELECT count(*) AS count FROM archive_imports WHERE target_id=?",
                )
                .get(targetId).count
            : 0) >
        MAX_RUNS
      )
        fail("catalog_limit");
      return {
        target: targetIn(db, targetId),
        state: readState(db, targetId),
        imports:
          version >= 3
            ? db
                .prepare(
                  "SELECT run_id,journal_checkpoint_hash FROM archive_imports WHERE target_id=?",
                )
                .all(targetId)
            : [],
        rows: db
          .prepare("SELECT * FROM runs WHERE target_id=?")
          .all(targetId)
          .map((row) => checkedRunRow(row, targetId)),
      };
    });
    if (
      expectedRevision !== undefined &&
      initial.target.revision !== expectedRevision
    )
      fail("catalog_changed");
    if (
      version >= 4 &&
      (await use(true, (db) =>
        Boolean(
          db
            .prepare(
              "SELECT 1 FROM journal_compressions WHERE target_id=? AND state='retained' AND replacement IS NOT NULL LIMIT 1",
            )
            .get(targetId),
        ),
      ))
    )
      fail("compression_pending");
    const workspace = await workspaceFor(initial.target);
    const prior = new Map(initial.rows.map((row) => [row.run_id, row]));
    const imports = new Map(initial.imports.map((row) => [row.run_id, row])),
      matches = new Map();
    if (initial.rows.length + imports.size > MAX_RUNS) fail("catalog_limit");
    const names = [];
    let discovered = 0;
    const parent = await readDirectory(workspace.journalRoot);
    if (parent) {
      const handle = await fs.opendir(workspace.journalRoot);
      for await (const entry of handle) {
        if (++discovered > MAX_RUNS + 1024) fail("catalog_limit");
        if (!entry.name.endsWith(".jsonl")) continue;
        const runId = entry.name.slice(0, -6);
        if (!safeId(runId)) fail("catalog_source_changed");
        names.push(runId);
        if (names.length > MAX_RUNS) fail("catalog_limit");
      }
      if (!sameFile(parent, await readDirectory(workspace.journalRoot)))
        fail("catalog_source_changed");
    }
    names.sort();
    const indexedAt = new Date().toISOString();
    const rows = [],
      unchangedIds = new Set();
    let bytesRead = 0,
      indexedRuns = 0,
      unchangedRuns = 0,
      incompleteRuns = 0,
      invalidRuns = 0;
    for (const runId of names) {
      const previous = prior.get(runId);
      prior.delete(runId);
      let snapshot, history, status;
      try {
        snapshot = await sourceSnapshot(workspace, runId);
        bytesRead += snapshot.bytes.length;
        if (bytesRead > MAX_INDEX_BYTES) fail("catalog_limit");
        if (!matchesPrefix(previous, snapshot)) status = "corrupt";
        else if (
          !rebuild &&
          previous?.source_hash === hash(snapshot.bytes) &&
          previous.source_size === snapshot.bytes.length &&
          (!imports.has(runId) ||
            imports.get(runId).journal_checkpoint_hash ===
              previous.checkpoint_hash)
        ) {
          const summary = JSON.parse(previous.summary);
          if (summary.status !== "missing") {
            rows.push(previous);
            unchangedIds.add(runId);
            unchangedRuns++;
            if (summary.status === "incomplete") incompleteRuns++;
            if (["corrupt", "unsupported"].includes(summary.status))
              invalidRuns++;
            continue;
          }
        }
        if (!status) {
          bytesRead += snapshot.bytes.length;
          if (bytesRead > MAX_INDEX_BYTES) fail("catalog_limit");
          history =
            snapshot.history ?? (await readRunJournal({ workspace, runId }));
          const after = await sourceSnapshot(workspace, runId);
          bytesRead += after.bytes.length;
          if (bytesRead > MAX_INDEX_BYTES) fail("catalog_limit");
          if (
            !sameFile(snapshot.stat, after.stat) ||
            !snapshot.bytes.equals(after.bytes)
          )
            fail("catalog_changed");
        }
      } catch (error) {
        if (error.code === "ENOENT") status = "missing";
        else if (error.code === "journal_incompatible") status = "unsupported";
        else if (
          [
            "journal_corrupt",
            "journal_limit",
            "journal_ownership_changed",
            "catalog_source_changed",
          ].includes(error.code)
        )
          status = "corrupt";
        else throw error;
      }
      if (imports.has(runId)) {
        let checkpoint = null;
        if (
          history?.status === "finished" &&
          history.historyComplete &&
          history.report
        ) {
          const imported = await use(true, (db) =>
            db
              .prepare(
                "SELECT * FROM archive_imports WHERE target_id=? AND run_id=?",
              )
              .get(targetId, runId),
          );
          if (!imported) fail("catalog_changed");
          bytesRead += imported.source_bytes.byteLength;
          if (bytesRead > MAX_INDEX_BYTES) fail("catalog_limit");
          validateArchiveJournal(
            imported,
            { targetId, ...history },
            { catalogId },
          );
          checkpoint = hash(
            snapshot.bytes.subarray(0, snapshot.bytes.lastIndexOf(10) + 1),
          );
        }
        matches.set(runId, checkpoint);
      }
      const summary = status
        ? invalidSummary(runId, status, indexedAt, previous)
        : summaryFor(runId, history, indexedAt);
      if (summary.status === "incomplete") incompleteRuns++;
      if (["corrupt", "unsupported", "missing"].includes(summary.status))
        invalidRuns++;
      // Never advance a checkpoint through invalid or uncommitted records.
      const offset = history
        ? snapshot.bytes.lastIndexOf(10) + 1
        : (previous?.checkpoint_offset ?? 0);
      rows.push({
        target_id: targetId,
        run_id: runId,
        sort_at: summary.startedAt ?? "",
        summary: JSON.stringify(summary),
        source_dev:
          previous?.source_dev ?? (snapshot ? String(snapshot.stat.dev) : null),
        source_ino:
          previous?.source_ino ?? (snapshot ? String(snapshot.stat.ino) : null),
        source_size: snapshot?.bytes.length ?? previous?.source_size ?? null,
        source_hash: snapshot
          ? hash(snapshot.bytes)
          : (previous?.source_hash ?? null),
        checkpoint_offset: offset,
        checkpoint_hash: history
          ? hash(snapshot.bytes.subarray(0, offset))
          : (previous?.checkpoint_hash ?? hash(Buffer.alloc(0))),
        checkpoint_sequence:
          history?.events.length ?? previous?.checkpoint_sequence ?? 0,
      });
      indexedRuns++;
    }
    for (const [runId, previous] of prior) {
      if (imports.has(runId)) matches.set(runId, null);
      rows.push({
        ...previous,
        summary: JSON.stringify(
          invalidSummary(runId, "missing", indexedAt, previous),
        ),
      });
      invalidRuns++;
      indexedRuns++;
    }
    if (rows.length + imports.size > MAX_RUNS) fail("catalog_limit");
    await workspace.assertCompatible();
    const generation = initial.state.generation + 1;
    await use(false, (db) => {
      if (
        readState(db, targetId).generation !== initial.state.generation ||
        targetIn(db, targetId).revision !== initial.target.revision
      )
        fail("catalog_changed");
      if (rebuild)
        db.prepare("DELETE FROM runs WHERE target_id=?").run(targetId);
      const statement = db.prepare(
        "INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(target_id,run_id) DO UPDATE SET sort_at=excluded.sort_at,summary=excluded.summary,source_dev=excluded.source_dev,source_ino=excluded.source_ino,source_size=excluded.source_size,source_hash=excluded.source_hash,checkpoint_offset=excluded.checkpoint_offset,checkpoint_hash=excluded.checkpoint_hash,checkpoint_sequence=excluded.checkpoint_sequence",
      );
      for (const row of rows)
        if (rebuild || !unchangedIds.has(row.run_id))
          statement.run(
            row.target_id,
            row.run_id,
            row.sort_at,
            row.summary,
            row.source_dev,
            row.source_ino,
            row.source_size,
            row.source_hash,
            row.checkpoint_offset,
            row.checkpoint_hash,
            row.checkpoint_sequence,
          );
      if (version >= 3) {
        const match = db.prepare(
          "UPDATE archive_imports SET journal_checkpoint_hash=? WHERE target_id=? AND run_id=?",
        );
        for (const [runId, checkpoint] of matches)
          match.run(checkpoint, targetId, runId);
      }
      db.prepare(
        "UPDATE history_state SET generation=?,indexed_at=? WHERE target_id=?",
      ).run(generation, indexedAt, targetId);
    });
    return {
      targetId,
      generation,
      indexedRuns,
      unchangedRuns,
      incompleteRuns,
      invalidRuns,
      bytesRead,
      indexedAt,
    };
  }
  const anchorHash = (row) =>
    hash(
      JSON.stringify([
        row.source_dev,
        row.source_ino,
        row.source_size,
        row.source_hash,
        row.checkpoint_offset,
        row.checkpoint_hash,
        row.checkpoint_sequence,
      ]),
    );
  const archiveColumns =
    "target_id,run_id,import_id,identity_hash,source_hash,metadata,summary,sort_at,journal_checkpoint_hash";
  const archiveAnchor = (row) =>
    hash(
      JSON.stringify([
        row.import_id,
        row.identity_hash,
        row.source_hash,
        row.metadata,
        row.summary,
        row.sort_at,
      ]),
    );
  const archiveVisible = (db, row) =>
    !row.journal_checkpoint_hash ||
    !db
      .prepare(
        "SELECT 1 FROM runs WHERE target_id=? AND run_id=? AND checkpoint_hash=? AND checkpoint_offset=source_size AND source_hash=checkpoint_hash AND json_extract(summary,'$.status')='finished'",
      )
      .get(row.target_id, row.run_id, row.journal_checkpoint_hash);
  async function listRuns({ targetId, limit = 25, cursor = null } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      fail("catalog_limit");
    return use(true, (db) => {
      const target = targetIn(db, targetId),
        state = readState(db, targetId);
      let anchor, anchorKind;
      if (cursor !== null) {
        try {
          if (
            typeof cursor !== "string" ||
            cursor.length > 2048 ||
            !/^[A-Za-z0-9_-]+$/.test(cursor)
          )
            throw Error();
          anchor = JSON.parse(Buffer.from(cursor, "base64url"));
        } catch {
          fail("catalog_cursor");
        }
        const keys = [
          "version",
          "catalogId",
          "targetId",
          "revision",
          "generation",
          "sortAt",
          "runId",
          "source",
        ];
        if (
          (!exact(anchor, keys) && !exact(anchor, [...keys, "sourceKind"])) ||
          anchor.version !== PROJECTION_VERSION ||
          anchor.catalogId !== catalogId ||
          anchor.targetId !== targetId ||
          anchor.revision !== target.revision ||
          anchor.generation !== state.generation ||
          typeof anchor.sortAt !== "string" ||
          anchor.sortAt.length > 40 ||
          !safeId(anchor.runId) ||
          !SHA.test(anchor.source)
        )
          fail("catalog_cursor");
        anchorKind = anchor.sourceKind ?? "journal";
        if (
          !["journal", "archive"].includes(anchorKind) ||
          (anchorKind === "archive" && version < 3)
        )
          fail("catalog_cursor");
        const stored =
          anchorKind === "journal"
            ? db
                .prepare("SELECT * FROM runs WHERE target_id=? AND run_id=?")
                .get(targetId, anchor.runId)
            : db
                .prepare(
                  `SELECT ${archiveColumns} FROM archive_imports WHERE target_id=? AND run_id=?`,
                )
                .get(targetId, anchor.runId);
        if (stored) {
          if (anchorKind === "journal") checkedRunRow(stored, targetId);
          else archiveSummary(stored, { catalogId });
        }
        if (
          !stored ||
          stored.sort_at !== anchor.sortAt ||
          (anchorKind === "journal"
            ? anchorHash(stored)
            : archiveAnchor(stored)) !== anchor.source ||
          (anchorKind === "archive" && !archiveVisible(db, stored))
        )
          fail("catalog_cursor");
      }
      let rows;
      if (version < 3) {
        rows = anchor
          ? db
              .prepare(
                "SELECT * FROM runs WHERE target_id=? AND (sort_at,run_id)<(?,?) ORDER BY sort_at DESC,run_id DESC LIMIT ?",
              )
              .all(targetId, anchor.sortAt, anchor.runId, limit + 1)
          : db
              .prepare(
                "SELECT * FROM runs WHERE target_id=? ORDER BY sort_at DESC,run_id DESC LIMIT ?",
              )
              .all(targetId, limit + 1);
      } else {
        // Select only metadata for imported entries: bounded history pages must
        // not fetch or hash their potentially 16 MiB authoritative BLOBs.
        const relation = `WITH history AS (
          SELECT target_id,run_id,sort_at,summary,'journal' AS source_kind,source_dev,source_ino,source_size,source_hash,checkpoint_offset,checkpoint_hash,checkpoint_sequence,NULL AS import_id,NULL AS identity_hash,NULL AS metadata,NULL AS journal_checkpoint_hash FROM runs WHERE target_id=?
          UNION ALL
          SELECT target_id,run_id,sort_at,summary,'archive' AS source_kind,NULL,NULL,NULL,source_hash,NULL,NULL,NULL,import_id,identity_hash,metadata,journal_checkpoint_hash FROM archive_imports a WHERE target_id=? AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.target_id=a.target_id AND r.run_id=a.run_id AND r.checkpoint_hash=a.journal_checkpoint_hash AND r.checkpoint_offset=r.source_size AND r.source_hash=r.checkpoint_hash AND json_extract(r.summary,'$.status')='finished')
        ) SELECT * FROM history`;
        rows = anchor
          ? db
              .prepare(
                relation +
                  " WHERE (sort_at,run_id,source_kind)<(?,?,?) ORDER BY sort_at DESC,run_id DESC,source_kind DESC LIMIT ?",
              )
              .all(
                targetId,
                targetId,
                anchor.sortAt,
                anchor.runId,
                anchorKind,
                limit + 1,
              )
          : db
              .prepare(
                relation +
                  " ORDER BY sort_at DESC,run_id DESC,source_kind DESC LIMIT ?",
              )
              .all(targetId, targetId, limit + 1);
      }
      for (const row of rows) {
        if (row.source_kind === "archive") archiveSummary(row, { catalogId });
        else checkedRunRow(row, targetId);
      }
      const hasMore = rows.length > limit;
      if (hasMore) rows.pop();
      const last = rows.at(-1);
      return {
        targetId,
        items: rows.map((row) =>
          row.source_kind === "archive"
            ? archiveSummary(row, { catalogId })
            : JSON.parse(row.summary),
        ),
        nextCursor: hasMore
          ? Buffer.from(
              JSON.stringify({
                version: PROJECTION_VERSION,
                catalogId,
                targetId,
                revision: target.revision,
                generation: state.generation,
                sortAt: last.sort_at,
                runId: last.run_id,
                source:
                  last.source_kind === "archive"
                    ? archiveAnchor(last)
                    : anchorHash(last),
                ...(last.source_kind === "archive"
                  ? { sourceKind: "archive" }
                  : {}),
              }),
            ).toString("base64url")
          : null,
        generation: state.generation,
        indexedAt: state.indexed_at,
      };
    });
  }
  async function getRun({ targetId, runId } = {}) {
    if (!safeId(runId)) fail("target_invalid");
    const { target, previous } = await use(true, (db) => ({
      target: targetIn(db, targetId),
      previous: db
        .prepare("SELECT * FROM runs WHERE target_id=? AND run_id=?")
        .get(targetId, runId),
    }));
    if (previous) checkedRunRow(previous, targetId);
    const workspace = await workspaceFor(target);
    const snapshot = await sourceSnapshot(workspace, runId);
    if (!matchesPrefix(previous, snapshot)) fail("catalog_source_changed");
    const result =
      snapshot.history ?? (await readRunJournal({ workspace, runId }));
    const after = await sourceSnapshot(workspace, runId);
    if (
      !sameFile(snapshot.stat, after.stat) ||
      !snapshot.bytes.equals(after.bytes)
    )
      fail("catalog_changed");
    return { targetId, ...result };
  }
  function createEvidenceMethods() {
    const rowRecord = (row) => {
      if (!row) fail("evidence_not_found");
      try {
        const value = checkedEvidence(JSON.parse(row.metadata));
        if (
          value.targetId !== row.target_id ||
          value.id !== row.id ||
          value.runId !== row.run_id
        )
          fail("catalog_corrupt");
        return value;
      } catch {
        fail("catalog_corrupt");
      }
    };
    async function addEvidence(input, { expectedTargetRevision } = {}) {
      assertV2();
      const value = checkedEvidence(input);
      if (
        !Number.isSafeInteger(expectedTargetRevision) ||
        expectedTargetRevision < 1
      )
        fail("target_invalid");
      const target = await getTarget(value.targetId);
      if (target.revision !== expectedTargetRevision) fail("target_changed");
      let history;
      try {
        history = await getRun({
          targetId: value.targetId,
          runId: value.runId,
        });
      } catch (error) {
        if (["journal_missing", "ENOENT"].includes(error.code))
          fail("evidence_reference");
        throw error;
      }
      const first = history.events?.[0],
        installation = first?.payload?.installation;
      const event =
        value.eventSequence === null
          ? null
          : history.events?.find(
              (item) => item.sequence === value.eventSequence,
            );
      if (
        history.targetId !== target.id ||
        history.projectId !== target.projectId ||
        history.workspaceId !== marker.workspaceId ||
        history.runId !== value.runId ||
        first?.type !== "run_started" ||
        first.sequence !== 1 ||
        !installation ||
        (value.eventSequence !== null && !event) ||
        value.eventId !== (event?.eventId ?? null) ||
        !isDeepStrictEqual(value.provenance, {
          installationId: installation.id,
          runtimeVersion: installation.version,
          sourceSha256: installation.sourceSha256,
          model: installation.model,
        })
      )
        fail("evidence_reference");
      return use(false, (db) => {
        if (targetIn(db, value.targetId).revision !== expectedTargetRevision)
          fail("target_changed");
        const existing = db
          .prepare("SELECT * FROM evidence WHERE target_id=? AND id=?")
          .get(value.targetId, value.id);
        if (existing) {
          const record = rowRecord(existing);
          if (!isDeepStrictEqual(record, value)) fail("evidence_conflict");
          return record;
        }
        if (
          db
            .prepare("SELECT count(*) AS count FROM evidence WHERE target_id=?")
            .get(value.targetId).count >= 10000
        )
          fail("catalog_limit");
        db.prepare("INSERT INTO evidence VALUES(?,?,?,?)").run(
          value.targetId,
          value.id,
          value.runId,
          JSON.stringify(value),
        );
        return value;
      });
    }
    async function getEvidence({ targetId, evidenceId } = {}) {
      assertV2();
      if (!safeId(evidenceId)) fail("evidence_invalid");
      return use(true, (db) => {
        targetIn(db, targetId);
        return rowRecord(
          db
            .prepare("SELECT * FROM evidence WHERE target_id=? AND id=?")
            .get(targetId, evidenceId),
        );
      });
    }
    async function listEvidence({
      targetId,
      runId = null,
      limit = 25,
      cursor = null,
    } = {}) {
      assertV2();
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        (runId !== null && !safeId(runId))
      )
        fail("evidence_invalid");
      return use(true, (db) => {
        const target = targetIn(db, targetId),
          generation = db
            .prepare("SELECT count(*) AS count FROM evidence WHERE target_id=?")
            .get(targetId).count;
        let after = "";
        if (cursor !== null) {
          if (
            typeof cursor !== "string" ||
            cursor.length > 2048 ||
            !/^[A-Za-z0-9_-]+$/.test(cursor)
          )
            fail("catalog_cursor");
          let value;
          try {
            value = JSON.parse(
              Buffer.from(cursor, "base64url").toString("utf8"),
            );
          } catch {
            fail("catalog_cursor");
          }
          if (
            !exact(value, [
              "version",
              "catalogId",
              "targetId",
              "revision",
              "runId",
              "generation",
              "after",
            ]) ||
            value.version !== 2 ||
            value.catalogId !== catalogId ||
            value.targetId !== targetId ||
            value.revision !== target.revision ||
            value.runId !== runId ||
            value.generation !== generation ||
            !safeId(value.after)
          )
            fail("catalog_cursor");
          after = value.after;
        }
        const records = db
          .prepare(
            "SELECT * FROM evidence WHERE target_id=? AND (? IS NULL OR run_id=?) AND id>? ORDER BY id LIMIT ?",
          )
          .all(targetId, runId, runId, after, limit + 1)
          .map(rowRecord);
        const items = records.slice(0, limit),
          last = items.at(-1);
        return {
          targetId,
          items,
          nextCursor:
            records.length > limit
              ? Buffer.from(
                  JSON.stringify({
                    version: 2,
                    catalogId,
                    targetId,
                    revision: target.revision,
                    runId,
                    generation,
                    after: last.id,
                  }),
                ).toString("base64url")
              : null,
        };
      });
    }
    return { addEvidence, getEvidence, listEvidence };
  }
  const evidenceMethods = createEvidenceMethods();
  const knowledgeMethods = createKnowledge({
    root,
    catalogId,
    use,
    targetIn,
    getTarget,
    getRun,
    getEvidence: evidenceMethods.getEvidence,
    assertV2,
  });
  const archiveMethods = createArchiveImports({
    root,
    use,
    targetIn,
    getTarget,
    getRun,
    catalogId,
    assertV3,
    readState,
  });
  return Object.freeze({
    catalogVersion: version,
    getCompression,
    retainCompression,
    prepareCompressionReplacement,
    activateCompression,
    clearCompressionReplacement,
    ...archiveMethods,
    ...evidenceMethods,
    ...knowledgeMethods,
    ...(migrationAccess
      ? {
          _migration: {
            owner,
            identity,
            rootIdentity,
            marker,
            path,
            assertOwned,
            assertHeader,
            use,
            async exclusive() {
              await assertOwned();
              await assertHeader();
              const db = connect(path, false);
              try {
                db.exec("BEGIN EXCLUSIVE");
                validateDatabase(db, marker.workspaceId, catalogId, version);
                return db;
              } catch (error) {
                db.close();
                throw error;
              }
            },
          },
        }
      : {}),
    registerTarget,
    reviseTarget,
    getTarget,
    listTargets: () =>
      use(true, (db) =>
        db.prepare("SELECT * FROM targets ORDER BY id").all().map(targetRecord),
      ),
    indexTarget,
    listRuns,
    getRun,
    async close() {
      await knowledgeMethods.closeKnowledge?.();
      await archiveMethods.closeArchiveImports?.();
      closed = true;
    },
  });
}

export async function upgradeCatalog(options) {
  return migrateCatalog({
    ...options,
    openForMigration: (input) =>
      openCatalog({ ...input, [MIGRATION_ACCESS]: true }),
  });
}

/** Internal workspace-backup boundary; ordinary catalog users do not own SQL handles. */
export async function withCatalogSnapshot(options, callback) {
  const { snapshotCatalog } = await import("./catalog-snapshot.mjs");
  return snapshotCatalog(
    {
      ...options,
      openForSnapshot: (input) =>
        openCatalog({ ...input, [MIGRATION_ACCESS]: true }),
      mapTarget: targetRecord,
    },
    callback,
  );
}
