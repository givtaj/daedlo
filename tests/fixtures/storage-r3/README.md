# Frozen Universal v1 compatibility fixture

These literal files preserve the first accepted R3 catalog/projection schema and
journal format independently of the current implementation. They describe a
synthetic test only, not customer activity or product evidence. All names,
identities, times and digest placeholders are public synthetic values.

- `schema-v1.sql` is the exact version-1 schema text, including its leading and
  trailing newline. `fixture-v1.json` freezes its migration checksum.
- `fixture-v1.json` retains two authoritative registration revisions, a version-1
  historical run under the current version-2 model registration, and its existing
  derived summary/checkpoint. The `@store`, `@source` and `@config` placeholders
  resolve only into a newly owned test directory.
- `retained-run-v1.jsonl` preserves the canonical journal bytes and report.

The test creates SQLite directly from these literals, without calling production
catalog creation/registration/indexing or the journal writer. It binds file
identities and the immutable metadata-page hash to that newly materialized test
instance, then asks the current implementation to read and rebuild it. This is
fixture materialization, not a supported customer copy/restore mechanism.

Do not regenerate or edit v1 when implementing a later schema. Add a separate
fixture and explicit compatibility/migration coverage. This baseline has no
binary database, private path, credential, build output or live application data.
