# Daedlo Universal

An **optional, separate installation** for a customer-owned workspace spanning
several targets. Basic Daedlo keeps its current installation and live viewer.
Universal adds target history, imported report archives, evidence files, manually
reviewed findings, target knowledge, full backup and safe restore in its own
workspace. Closed journals can be compressed through an explicit schema-4 opt-in.
It opens
ordinary Daedlo live sessions only when requested. It is an unreleased source
candidate; no current customer installation is migrated automatically.

Live sessions require an already prepared, journal-compatible Daedlo runtime/engine
installation for each target. The standalone archive provides the workspace and control
tools; it does not install a browser/engine bundle or silently upgrade an existing
basic installation. Existing published runtimes are not assumed journal-compatible.
The optional [container delivery guide](../../docs/universal-container.md) covers Linux runner execution and persistent history; managed native live-viewer launch remains unavailable in container mode.

Use Node 24.22.2 or the supported Node 22.23.4 lane. SQLite is supplied by Node;
Node 22 emits its own experimental SQLite warning. No registry dependency or
separate SQLite binary is installed. The Universal artifact bundles exact Daedlo
tools with their source receipt and licenses; it does not depend on a changing
source checkout or overwrite basic Daedlo's command.

Build and install the separate candidate:

```sh
node scripts/release/universal.mjs --output /absolute/new-output
npm install --prefix /absolute/universal-install --offline --ignore-scripts /absolute/new-output/daedlo-universal-0.1.0-alpha.6.tgz
/absolute/universal-install/node_modules/.bin/daedlo-universal --help
```

Build from a clean reviewed source checkpoint. A maintainer-only `--allow-dirty`
flag can build a local development candidate; its receipt discloses that state.
Exact release identity, platform acceptance and publication remain release gates.

Each target uses its accepted managed configuration with explicit bootstrap schema
2 and `workspace.journal: 1`. All targets in one Universal workspace share the
workspace root/ID, and have distinct registered project IDs, manager stores and
authentication-profile references. Those opaque references contain no passwords,
cookies or authentication state. Application adapters still own authentication;
their launchers must use distinct browser contexts. A shared origin is permitted
and never determines target identity.

```sh
daedlo-universal register --config /absolute/site-a/ninja.json --id target-a --name "Site A" --environment staging --auth-profile profile-a
daedlo-universal index --workspace /absolute/customer-data --target target-a
daedlo-universal serve --workspace /absolute/customer-data
```

Keep the printed local URL private. Target selection and recorded-run inspection
do not launch applications or change stored data. **Refresh history** explicitly
indexes changed journal files. **Open live session** starts or reconnects to the
selected target through Daedlo's existing guards; its existing viewer remains a
separate live surface. Closing Universal closes only native sessions it owns,
subject to their draft/evidence/cleanup guards. Already-running attached owners
survive. Incomplete cleanup retains its handles for an explicit retry.

The catalog pins the configuration and authored-source identity. Changes require
review and an explicit revision; older revisions and histories remain retained:

```sh
daedlo-universal revise --workspace /absolute/customer-data --target target-a --revision 1
daedlo-universal history --workspace /absolute/customer-data --target target-a --limit 25
daedlo-universal history --workspace /absolute/customer-data --target target-a --run RUN_ID
daedlo-universal index --workspace /absolute/customer-data --target target-a --rebuild
```

Revisions cannot move a target to another project/store, environment, origin or
authentication profile. Give a different logical target a new ID and namespace.
Rebuild affects derived history only. Journal bytes, target registrations and
registration revisions remain authoritative and are preserved. Historical journal
format 1 records the project and observed execution; registering it does not invent
missing historical origin or authentication evidence. An incomplete run stays
uncertain. Indexing, reading, rebuilding and restarting never replay actions.

## Import existing managed report archives

Use an explicit file and target mapping. The importer supports schema-1
`daedlo-managed-run` JSON archives containing `browser-driver-report/1` completed
reports. It does not scan directories automatically or accept raw report files,
session snapshots, unknown schemas, or arbitrary JSON.

```sh
daedlo-universal targets --workspace /absolute/customer-data
# Stop older Universal processes before upgrading the catalog.
daedlo-universal upgrade --workspace /absolute/customer-data
# Use the target's current revision from the targets command.
daedlo-universal import --workspace /absolute/customer-data --target target-a --revision 1 --file /absolute/old-archives/report.json
daedlo-universal history --workspace /absolute/customer-data --target target-a
daedlo-universal history --workspace /absolute/customer-data --target target-a --run ORIGINAL_RUN_ID --source archive
```

The original file is only read; its bytes are copied unchanged into one catalog
transaction with its hash, source format, original installation identity, archive
time, and explicit target assignment. Paths and current target metadata never
replace the original report's provenance. These legacy archives contain no reliable
historical target origin or authentication identity: the target assignment is your
explicit mapping, not a claim that Daedlo verified those missing facts.

Repeating an import, including an identical copy under another filename, returns
the existing import. Conflicting content for the same run or a different target
assignment is refused. A verified matching journal can represent the run once in
the history list while the imported source remains retained and directly readable.
A history rebuild preserves all imports.

In History, **Imported report** identifies the source. Original runtime events,
execution, effect evidence and truncation remain available, with missing metadata
disclosed. A completed report does not prove a complete journal; import never adds
start records or action intents. Imports do not launch an application or replay
actions. R5a imports can be browsed but are not accepted as the journal references
used by R4 evidence and knowledge; that contract remains unchanged.

One file is imported per command, with a 16 MiB bound, 256 MiB of imported bytes
per target, and 10,000 combined journal/import records per target. Keep originals
and the complete workspace for recovery. After interruption, explicitly retry the
same import; the transaction either retained the original bytes and identity
together or made no import visible. If it reports catalog recovery is required,
first run `daedlo-universal index --workspace ROOT --target ID`, then retry the
import. Recovery rolls back only a proven-owned SQLite transaction and does not
repeat application actions.

## Evidence and reviewed knowledge

Select a target and a recorded run, then open **Evidence & knowledge**. Upload a
file and give it a descriptive label. Evidence stays private to that target and
records the source run, optional event, runtime/model identity, byte length and
SHA-256. PNG/JPEG images and bounded plain text have local previews; JSON and PDF
are downloads. The service accepts at most 16 MiB per file and refuses HTML/SVG.
Artifact bytes live under `evidence/<target-id>/` and are never appended to run
journals or public report exports.

Create a **finding** for an observation, inspect its references, then explicitly
accept or reject it. A finding does not automatically become reusable knowledge:
use **Use as knowledge** to write and review that statement separately.
Revisions preserve old content, review decisions and provenance. Only accepted
knowledge with available evidence and matching integration identity appears in
the target summary. Changing a target's source, configuration or model makes
earlier knowledge need revalidation; make a new revision with current observed
references and review it again. Historical statements never authorize application
actions or replace live guards.

The default tab remains History. Looking at evidence, reviewing records, restarting
Universal, and reading a summary do not launch the application or replay actions.

```sh
daedlo-universal summary --workspace /absolute/customer-data --target target-a
```

Missing or corrupt evidence is shown as unavailable, and its linked knowledge is
excluded from the summary while the record remains retained. If a crash happens
after publishing a file but before its catalog transaction, inspect the **Not committed** evidence entry and use **Retry evidence registration**. Retry uses the same evidence
identity; it does not execute the run again. Unknown or incomplete ownership proof
is preserved for inspection. Do not delete retained files to force a retry.

Bounds are 10,000 evidence records and 1,000 manual records per target, 100 revisions
per record, 100 review events per revision, eight references per revision, and
25 accepted items per summary. Validation also has byte budgets; large operations
fail explicitly or disclose excluded summary items. There is no automatic finding
extraction, remote upload, AI provider, or embedding dependency.

## Upgrading an R3 or R4 Universal workspace

Installing new tools does not upgrade customer data. R5c reads schema-1 target
history and retains R4 operations on schema 2. Archive import requires schema 3. Stop older Universal processes
using this workspace before upgrading. Keep the whole workspace and its retained
sidecars together. The command takes an exclusive transaction and retains a
consistent catalog snapshot and its owner receipt before each additive transition:

```sh
daedlo-universal targets --workspace /absolute/customer-data
daedlo-universal upgrade --workspace /absolute/customer-data
daedlo-universal history --workspace /absolute/customer-data --target target-a
daedlo-universal serve --workspace /absolute/customer-data
```

The upgrade prints its catalog version and retained backup paths inside
`workspace-upgrade-v1-v2/` and/or `workspace-upgrade-v2-v3/`. Existing target bindings, target revisions, indexed
history and journal bytes remain in place. If interrupted, run the same **upgrade**
command to resume a proven-owned migration; ordinary startup and reads will not
resume it automatically. A live or unproven migration owner is refused. If an old
writer changed source data after an interrupted upgrade, resume refuses the changed
snapshot boundary and retains both states for inspection instead of overwriting
newer client work. Incomplete ownership proof, including an interruption before the first claim was
published, is retained and refused for inspection.

R3 writers cannot write schema 2, and R4 writers cannot write schema 3. Downgrading the package does not downgrade data.
The retained catalog snapshot is migration recovery evidence, not a complete
workspace backup. Use the full backup and fresh-directory restore below. Never
copy a catalog-only snapshot over a live workspace.

Existing basic/schema-1 reports and R0a report-only workspaces remain untouched.
Universal indexes existing R1/R2 journals in their original project directories.
R5a imports supported managed reports only through the explicit command above.
Keep the basic tools and configuration for their existing history/usage paths.

`workspace.sqlite` contains private authoritative catalog/revisions and separately
versioned derived history. Its `workspace.sqlite.owner.json` records
workspace ownership and database identity; only an explicit proven migration
rebinds that receipt. Keep both in place. It uses SQLite rollback journaling, bounded transactions
and `synchronous=EXTRA`. History reads do not initialize, migrate, index, or recover
a database. An interrupted transaction may require explicit `index` before reads
can resume; SQLite rolls back its proven-owned journal and never replays application
work. Incomplete ownership/rollback proof stays preserved and refused for inspection;
indexing cannot repair unknown evidence.
Unknown versions and changed source identities refuse mutation.
Hardware power loss, container delivery and customer adoption require their own
acceptance; a process-crash test is not a power-loss guarantee. Do not delete
the database as a way to rebuild history: that would remove the target catalog.
Ordinary filesystem copies and manual VACUUM are refused. The explicit restore
procedure below verifies and rebinds ownership without discarding history. Keep the complete workspace
(including any retained SQLite sidecars) if initialization or recovery reports a
failure; do not remove files to force startup.


## Back up and restore a complete workspace

Stop every live Daedlo session and Universal process using the workspace first.
Choose absolute paths whose parent directories already exist. Backup and restore
outputs must be new, separate directories outside the source and each other:

```sh
daedlo-universal backup --workspace /absolute/customer-data --output /absolute/backups/before-upgrade
daedlo-universal verify-backup --backup /absolute/backups/before-upgrade
daedlo-universal restore --backup /absolute/backups/before-upgrade --workspace /absolute/customer-data-restored
daedlo-universal targets --workspace /absolute/customer-data-restored
daedlo-universal history --workspace /absolute/customer-data-restored --target target-a
daedlo-universal summary --workspace /absolute/customer-data-restored --target target-a
daedlo-universal serve --workspace /absolute/customer-data-restored
```

A backup covers the entire workspace: registered targets and revisions, SQLite
history, imported report bytes and provenance, all project journals (including
unindexed runs and unregistered projects), evidence, findings, every knowledge
revision/review, and retained recovery files. It checks references, takes journal
writer ownership and an exclusive SQLite snapshot, and verifies file identities
and hashes before sealing a complete manifest. A live, dead, or unproven existing
writer blocks backup; source changes or storage failures retain an incomplete
output and do not produce a successful backup. Backups are private and unencrypted;
store them with the same access controls as the original workspace.

Restore verifies the complete manifest and file contents before publishing a new
workspace. It retains workspace/target/catalog identities and source bytes, rebinding
only proven database, journal and evidence file ownership to the new files. Original
owner/publication/migration receipts remain byte-for-byte under
`restore-provenance/<backup-id>/`. Indexed history can be rebuilt without deleting
imports, target revisions or manual knowledge. Reading, restoring, rebuilding and
recovering storage never launch an application or replay its actions.

The source workspace and backup remain untouched. External application source,
configuration, manager stores, browser profiles and credentials are not copied or
rewritten. Their recorded paths remain provenance. Restored history, evidence and
knowledge are available, but live sessions stay guarded until their external target
bindings have been deliberately reviewed and prepared for the restored location;
restore does not silently redirect an existing customer installation.

`restore --catalog-version 2` additionally requires an exact schema-2 backup.
Schemas 1, 2, 3 and 4 are supported without conversion. Unknown versions, incomplete
manifests, mismatched hashes, unsupported filesystem links and changed ownership
refuse. The source bound is 100,000 filesystem entries, depth 32, 1,000 project
directories, 1 GiB per file/database and 4 GiB total file bytes (including retained
files and each hard-link path). Complete internal hard-link groups are preserved;
symlinks, external hard links and nonregular files are refused. A backup manifest
is bounded to 64 MiB; compressed journal validation is bounded to 4 GiB of total
expanded journal bytes per operation. Exceeding a bound never silently omits data.

## Roll back while keeping newer work

Keep a full backup **before** upgrading. A compatible rollback restores that old
boundary to another new directory and first makes a mandatory full backup of the
current workspace. For example, return to schema 2 for the retained R4 tools:

```sh
daedlo-universal rollback --workspace /absolute/customer-data --backup /absolute/backups/before-upgrade --output /absolute/customer-data-r4 --preserve /absolute/backups/latest-before-rollback --catalog-version 2
daedlo-universal verify-backup --backup /absolute/backups/latest-before-rollback
# Use your separately retained compatible R4 tools with /absolute/customer-data-r4.
# Recover the newer boundary with current tools into another new directory:
daedlo-universal restore --backup /absolute/backups/latest-before-rollback --workspace /absolute/customer-data-latest --catalog-version 3
```

The old backup must belong to the same workspace and already have the requested
catalog version. This operation does not down-convert a newer database, overwrite
the original workspace, install older tools, or switch running services. If the
latest-state backup fails, rollback does not publish the older workspace. Work
created after the old backup remains in the original and mandatory latest backup;
it is not merged into the older restored boundary.

## Interrupted backup or restore

Retain any failed output. An incomplete restore has no usable workspace marker;
retry into another new destination after resolving the reported failure. Never
remove retained files or copy a database over them to force startup.

A killed backup may leave its journal writer locks. Inspect its retained output
and explicitly recover only the exact proven-dead owners:

```sh
daedlo-universal backup-recovery --backup /absolute/backups/interrupted
# Copy the receipt returned by inspection:
daedlo-universal recover-backup --backup /absolute/backups/interrupted --receipt RECEIPT
daedlo-universal backup --workspace /absolute/customer-data --output /absolute/backups/retry-new
```

Recovery refuses live/unproven owners, changed receipts and replacement writers.
It uses the existing journal recovery protocol and retains all journal and catalog
bytes. A crash before publishing ownership proof requires inspection; recovery
never guesses which lock to remove. If in-process cleanup fails, retry the same
explicit operation to close its retained handles, then choose a new output. The
original interrupted directory remains evidence; it is not resumed or overwritten.


## Compress closed journals

Compression belongs only to Universal. New catalogs start at schema 3, and existing
workspace formats change only through an explicit upgrade. Installing these tools,
reading history or running the ordinary upgrade command never opts a workspace into compression. Make a full
backup first, stop every writer, then explicitly select catalog version 4:

```sh
daedlo-universal backup --workspace /absolute/customer-data --output /absolute/backups/before-compression
daedlo-universal verify-backup --backup /absolute/backups/before-compression
daedlo-universal upgrade --workspace /absolute/customer-data --catalog-version 4
daedlo-universal history --workspace /absolute/customer-data --target target-a --limit 25
# Select a completed journal run from that target's history.
daedlo-universal compress --workspace /absolute/customer-data --target target-a --run RUN_ID
# Inspect the same original events/report before explicitly replacing the plain file:
daedlo-universal history --workspace /absolute/customer-data --target target-a --run RUN_ID
daedlo-universal compress --workspace /absolute/customer-data --target target-a --run RUN_ID --replace
daedlo-universal index --workspace /absolute/customer-data --target target-a --rebuild
```

The first compression stores verified gzip bytes in a single catalog transaction
and retains the original plain file. It checks exact decompressed JSONL bytes and
hash, target/project/run identity, a complete terminal journal and the existing
history checkpoint. Failed/rejected/stopped terminal reports retain their original
outcomes. Incomplete journals and partial tails are refused and remain plain with
their interrupted/uncertain disclosures. Imported report archives are not journals
and are not compressed by this command. Each command names exactly one target/run;
there is no background scan, automatic expiration or history deletion.

`--replace` is the separate space-reclaiming step. After the compressed original
is durable and verified, it publishes a small marker at the same `.jsonl` path and
removes only the exact proven original file. The marker reserves the run ID and
points to the retained compressed record. A temporary original link survives until
publication and verification finish. Unknown replacements, links or partial files
are preserved and refused. Retrying an already completed compression returns the
same identity. `rawBytes` and `compressedBytes` describe the payload; `plainBytesRemoved`
counts original file bytes removed by that invocation, and is zero for a completed
retry. These fields do not claim net filesystem space reclaimed: SQLite allocation,
metadata, retained migration snapshots and backups also consume storage.

History, imports matched to journals, evidence references, findings and reviewed
knowledge use the original decompressed events. Restart and rebuild preserve them;
none of these operations launch an application or replay actions. A full backup
includes the compressed bytes and original provenance. Restore verifies and rebinds
only the new physical file identities, including compressed runs not yet indexed.
A restored retained copy can later be explicitly replaced without rewriting its
original provenance.

Older Universal tools refuse schema 4 before writing. Basic Daedlo's source,
installation and default storage stay unchanged; its live writer can continue
creating new plain runs in this workspace. Reading a replaced historical run with
old basic tools gives an unsupported-format error. Use Universal for compressed
history, or restore the compatible pre-compression full backup with the rollback
procedure above. Rollback must preserve newer schema-4 work first; it does not
expand or down-convert it into the older workspace. An ordinary upgrade on an
already-schema-4 workspace is a no-op; an explicitly requested downgrade refuses.

Per run, raw JSONL is bounded to 16 MiB and gzip to 16 MiB + 64 KiB. Each target
permits 10,000 compression records and 256 MiB of gzip payload. Decompression is
bounded before parsing and verifies both compressed and original hashes; corrupt
or oversized payloads never become successful history.

### Recover interrupted compression

If storage reports unfinished replacement, preserve every file and retry the same
explicit `compress ... --replace` operation after resolving writer ownership. A
live or unproven writer is never retired automatically. For a killed unmanaged
journal writer, inspect the selected target and use its returned receipt:

```sh
daedlo-universal journal-recovery --workspace /absolute/customer-data --target target-a
daedlo-universal recover-journal --workspace /absolute/customer-data --target target-a --receipt RECEIPT
daedlo-universal compress --workspace /absolute/customer-data --target target-a --run RUN_ID --replace
```

This recovery checks the exact current writer, target revision and process identity.
It can handle a writer killed before a compression record was committed; it never
assumes that a writer belongs to compression. Managed/native owners require their
own existing coordinator's recovery procedure. A changed receipt or replacement
writer refuses. A killed recovery claimant resumes through the existing R2 journal
recovery protocol. No application actions are involved.

If an interrupted SQLite transaction reports catalog recovery is required, run the
explicit `index --workspace ROOT --target ID` storage recovery before retrying the
operation. In-process failed cleanup retains exact handles for explicit retry.
Full backup refuses a pending replacement until its cleanup is complete. Unknown
or unproven partial files stay retained; no retry removes them to force success.
