import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { KNOWLEDGE_SCHEMA } from "./knowledge.mjs";
import { ARCHIVE_SCHEMA } from "./archive-imports.mjs";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const APPLICATION_ID = 0x44445531;
export const CATALOG_VERSION = 3;
export const PROJECTION_VERSION = 1;
export const SCHEMA_V1 = `
CREATE TABLE catalog_meta (singleton INTEGER PRIMARY KEY CHECK(singleton=1), format TEXT NOT NULL, catalog_version INTEGER NOT NULL, projection_version INTEGER NOT NULL, workspace_id TEXT NOT NULL, catalog_id TEXT NOT NULL) STRICT;
CREATE TABLE catalog_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL) STRICT;
CREATE TABLE targets (id TEXT PRIMARY KEY, project_id TEXT NOT NULL UNIQUE, store TEXT NOT NULL UNIQUE, auth_profile_ref TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL CHECK(revision>=1), registration TEXT NOT NULL) STRICT;
CREATE TABLE target_revisions (target_id TEXT NOT NULL REFERENCES targets(id), revision INTEGER NOT NULL CHECK(revision>=1), registration TEXT NOT NULL, PRIMARY KEY(target_id,revision)) STRICT;
CREATE TABLE history_state (target_id TEXT PRIMARY KEY REFERENCES targets(id), generation INTEGER NOT NULL, indexed_at TEXT) STRICT;
CREATE TABLE runs (target_id TEXT NOT NULL REFERENCES targets(id), run_id TEXT NOT NULL, sort_at TEXT NOT NULL, summary TEXT NOT NULL, source_dev TEXT, source_ino TEXT, source_size INTEGER, source_hash TEXT, checkpoint_offset INTEGER NOT NULL, checkpoint_hash TEXT NOT NULL, checkpoint_sequence INTEGER NOT NULL, PRIMARY KEY(target_id,run_id)) STRICT;
CREATE INDEX runs_recent ON runs(target_id,sort_at DESC,run_id DESC);
`;
export const SCHEMA_V1_HASH = hash(SCHEMA_V1);

export const EVIDENCE_SCHEMA = `
CREATE TABLE evidence (target_id TEXT NOT NULL REFERENCES targets(id), id TEXT NOT NULL, run_id TEXT NOT NULL, metadata TEXT NOT NULL, PRIMARY KEY(target_id,id)) STRICT;
CREATE INDEX evidence_run ON evidence(target_id,run_id,id);
`;
export const MIGRATION_2 = EVIDENCE_SCHEMA + KNOWLEDGE_SCHEMA;
export const MIGRATION_2_HASH = hash(MIGRATION_2);
export const SCHEMA_V2 = SCHEMA_V1 + MIGRATION_2;
export const MIGRATION_3 = ARCHIVE_SCHEMA;
export const MIGRATION_3_HASH = hash(MIGRATION_3);
// New workspaces remain schema3 until the customer explicitly opts into compression.
export const SCHEMA = SCHEMA_V2 + MIGRATION_3;
export const MIGRATION_4 = `
CREATE TABLE journal_compressions (target_id TEXT NOT NULL REFERENCES targets(id), run_id TEXT NOT NULL, id TEXT NOT NULL UNIQUE, metadata TEXT NOT NULL, gzip_bytes BLOB NOT NULL, state TEXT NOT NULL CHECK(state IN ('retained','active')), binding_dev TEXT NOT NULL, binding_ino TEXT NOT NULL, replacement TEXT, PRIMARY KEY(target_id,run_id)) STRICT;
`;
export const MIGRATION_4_HASH = hash(MIGRATION_4);
export const SCHEMA_V4 = SCHEMA + MIGRATION_4;
const expected = new Map();
const schemaRows = (db) =>
  JSON.stringify(
    db
      .prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name")
      .all(),
  );
const fail = (code) => {
  throw Object.assign(
    Error("The catalog format or ownership is unsupported."),
    { code },
  );
};
export function validateDatabase(db, workspaceId, catalogId, expectedVersion) {
  const version = db.prepare("PRAGMA user_version").get().user_version;
  if (
    ![1, 2, 3, 4].includes(version) ||
    (expectedVersion !== undefined && version !== expectedVersion) ||
    db.prepare("PRAGMA application_id").get().application_id !== APPLICATION_ID
  )
    fail("catalog_incompatible");
  if (!expected.has(version)) {
    const reference = new DatabaseSync(":memory:");
    try {
      reference.exec(
        version === 1
          ? SCHEMA_V1
          : version === 2
            ? SCHEMA_V2
            : version === 3
              ? SCHEMA
              : SCHEMA_V4,
      );
      expected.set(version, schemaRows(reference));
    } finally {
      reference.close();
    }
  }
  if (
    schemaRows(db) !== expected.get(version) ||
    db.prepare("PRAGMA journal_mode").get().journal_mode !== "delete"
  )
    fail("catalog_incompatible");
  const meta = db.prepare("SELECT * FROM catalog_meta WHERE singleton=1").get();
  if (
    !meta ||
    meta.format !== `daedlo-universal/${version}` ||
    meta.catalog_version !== version ||
    meta.projection_version !== PROJECTION_VERSION
  )
    fail("catalog_incompatible");
  if (
    meta.workspace_id !== workspaceId ||
    typeof meta.catalog_id !== "string" ||
    !/^[a-f0-9-]{36}$/.test(meta.catalog_id) ||
    (catalogId && meta.catalog_id !== catalogId)
  )
    fail("catalog_ownership_changed");
  const migrations = db
    .prepare("SELECT version,checksum FROM catalog_migrations ORDER BY version")
    .all();
  if (
    migrations.length !== version ||
    migrations[0].version !== 1 ||
    migrations[0].checksum !== SCHEMA_V1_HASH ||
    (version >= 2 &&
      (migrations[1].version !== 2 ||
        migrations[1].checksum !== MIGRATION_2_HASH)) ||
    (version >= 3 &&
      (migrations[2].version !== 3 ||
        migrations[2].checksum !== MIGRATION_3_HASH)) ||
    (version >= 4 &&
      (migrations[3].version !== 4 ||
        migrations[3].checksum !== MIGRATION_4_HASH))
  )
    fail("catalog_incompatible");
  return meta.catalog_id;
}
export function applyMigration2(db) {
  db.exec(MIGRATION_2);
  db.prepare("INSERT INTO catalog_migrations VALUES(2,?)").run(
    MIGRATION_2_HASH,
  );
  db.exec(
    "UPDATE catalog_meta SET format='daedlo-universal/2',catalog_version=2 WHERE singleton=1; PRAGMA user_version=2",
  );
}
export function applyMigration3(db) {
  db.exec(MIGRATION_3);
  db.prepare("INSERT INTO catalog_migrations VALUES(3,?)").run(
    MIGRATION_3_HASH,
  );
  db.exec(
    "UPDATE catalog_meta SET format='daedlo-universal/3',catalog_version=3 WHERE singleton=1; PRAGMA user_version=3",
  );
}
export function applyMigration4(db) {
  db.exec(MIGRATION_4);
  db.prepare("INSERT INTO catalog_migrations VALUES(4,?)").run(
    MIGRATION_4_HASH,
  );
  db.exec(
    "UPDATE catalog_meta SET format='daedlo-universal/4',catalog_version=4 WHERE singleton=1; PRAGMA user_version=4",
  );
}
export function establishRollbackGuard(db, catalogId) {
  const guard = db.prepare(
    "UPDATE catalog_meta SET catalog_id=? WHERE singleton=1",
  );
  guard.run((catalogId[0] === "0" ? "1" : "0") + catalogId.slice(1));
  guard.run(catalogId);
}
