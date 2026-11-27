
CREATE TABLE catalog_meta (singleton INTEGER PRIMARY KEY CHECK(singleton=1), format TEXT NOT NULL, catalog_version INTEGER NOT NULL, projection_version INTEGER NOT NULL, workspace_id TEXT NOT NULL, catalog_id TEXT NOT NULL) STRICT;
CREATE TABLE catalog_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL) STRICT;
CREATE TABLE targets (id TEXT PRIMARY KEY, project_id TEXT NOT NULL UNIQUE, store TEXT NOT NULL UNIQUE, auth_profile_ref TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL CHECK(revision>=1), registration TEXT NOT NULL) STRICT;
CREATE TABLE target_revisions (target_id TEXT NOT NULL REFERENCES targets(id), revision INTEGER NOT NULL CHECK(revision>=1), registration TEXT NOT NULL, PRIMARY KEY(target_id,revision)) STRICT;
CREATE TABLE history_state (target_id TEXT PRIMARY KEY REFERENCES targets(id), generation INTEGER NOT NULL, indexed_at TEXT) STRICT;
CREATE TABLE runs (target_id TEXT NOT NULL REFERENCES targets(id), run_id TEXT NOT NULL, sort_at TEXT NOT NULL, summary TEXT NOT NULL, source_dev TEXT, source_ino TEXT, source_size INTEGER, source_hash TEXT, checkpoint_offset INTEGER NOT NULL, checkpoint_hash TEXT NOT NULL, checkpoint_sequence INTEGER NOT NULL, PRIMARY KEY(target_id,run_id)) STRICT;
CREATE INDEX runs_recent ON runs(target_id,sort_at DESC,run_id DESC);
