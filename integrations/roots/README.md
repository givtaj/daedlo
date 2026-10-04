# Roots isolated consumer

See [RESULTS.md](RESULTS.md) for the tested rc2 candidate and evidence limits.
The [current verification record](../../docs/verification.md) also records the
2026-10-04 regression of this consumer with updated write evidence and runtime,
alongside the separate [Journal edit consumer](edit/README.md).

This customer integration targets Roots commit
`d4008e39aeaa137bb54ff48ca2d11748083a971a`. It does not modify the everyday Roots
checkout, runtime, services, browser sessions, dependencies or data.

`consumer.mjs` imports the public `@browser-driver/runtime` package. The customer
adapter retains its pinned Roots observations/request classification and provides
15 guarded command handlers. It does not import the legacy execution runtime.
The Rust customer engine implements `ApplicationModel` using typed facts,
commands and the existing nested Roots enums; a narrow bridge invokes the pinned
Roots model's public `respond` function. Stable public IDs are explicitly mapped;
legacy Debug labels remain confined to that migration bridge.

The candidate covers Home, customer sign-in, Profile editing/saving, Journal
composition/saving/cancellation, and viewport commands. Inline strain commands,
all ten legacy recipes, API restart recipes and planned Strains browsing are not
claimed as migrated. The existing baseline's documented profile-observation,
pagination, restart-ownership and calendar-clock defects remain separate Roots
work. This integration adds stronger API evidence before reporting save success.

## Reproduce with candidate artifacts

Prerequisites: Rust pinned by Roots, Node 24+, Docker, installed Roots frontend
and Playwright dependencies whose lockfiles match the pinned revision, Chromium.
Set `ROOTS_SOURCE` if the reference checkout is elsewhere. Commands run from the
browser-driver repository. Use a fresh ignored `ROOTS_CONSUMER_ARTIFACTS` directory
for an independent run; all scripts respect this variable.

1. `node integrations/roots/prepare.mjs` creates a pinned Git archive, copies the
   matching installed dependencies, records live-tree hashes, and builds app
   binaries into a separate target directory. It refuses to overwrite a snapshot.
2. Start `node integrations/roots/fixture-host.mjs` using Node 24+. It starts an
   owned disposable PostgreSQL fixture plus API/frontend processes, writes public
   fixture metadata, and remains alive until SIGINT/SIGTERM. It never reads the
   normal Roots `.env`.
3. `node integrations/roots/build-engine.mjs /absolute/browser-driver-engine-0.1.0.crate`
   extracts the immutable Rust package and builds the customer binary against its
   public library. This binary has a separate target directory.
4. `node integrations/roots/stage.mjs /absolute/browser-driver-runtime-0.1.0.tgz`
   installs the exact packed runtime inside the snapshot, stages customer files,
   and replaces only the snapshot's `QA/live-driver.mjs` and
   `QA/start-live-driver.mjs` with thin public entries.
   Package and migration identities are recorded.
5. `node --test integrations/roots/tests/*.test.mjs` checks customer model
   boundaries. `node integrations/roots/acceptance.mjs` exercises real Chromium,
   the packaged runtime, customer engine, API and disposable PostgreSQL data.
   `node integrations/roots/launcher-acceptance.mjs` exercises the staged ordinary
   launcher command and verifies that closing it preserves attached fixture services.
6. `node integrations/roots/verify-preserved.mjs` compares the live Roots file
   inventory read-only; concurrent external edits are recorded, never overwritten.
   Send SIGTERM to the recorded `hostPid` in the public fixture manifest. The
   owning fixture host stops its processes and removes its generated source/data;
   inspect `fixture-cleanup.json`. Do not kill global Docker or normal Roots
   services.

The application fixture must start before staging the migration, so its clean
archive remains the pinned application source. The compatibility wrapper import
is exercised inside the isolated snapshot; everyday entrypoint promotion remains
separate. Package install uses offline cached dependencies and runs no package
scripts. Failed setup, import or compilation is not claimed as browser red/green.

Evidence is local under the selected artifacts directory: source/package/engine
hashes, structural baseline, model contracts, real browser results, live-viewer
screenshot, fixture manifest and owned cleanup record. Fixture credentials stay in
its private temporary directory and are never included in shared reports.
