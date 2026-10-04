# Verification record

## Release preparation tooling — 2026-10-04

The runtime and shared crate are now versioned `0.1.1-rc.1`. The release CLI
prepares versions, builds and verifies bundles, and selects an exact bundle in a
dedicated store with rollback. This work does not install a driver into Roots.
The [release guide](releases.md) documents the commands and later adoption gates.

| Check | Result | Evidence and scope |
| --- | --- | --- |
| Release contracts and CLI | PASS — 59 tests | `artifacts/release-readiness/release-suite-final.log`; version alignment, real packaging, manifest integrity, compatibility, store history/recovery, archive safety and installed-file proof |
| Runtime, shared Rust, archive and customer contracts | PASS — 42 Node, 18 Rust, 5 archive and 51 customer Node tests | `runtime.log`, `rust-tests.log`, `workbench.log`, `customer-contracts.log` under `artifacts/release-readiness`; customer contracts are not a new Roots browser run |
| Source, types, formatting and Rust lint/build | PASS | `source-check-final.log`, `rust-clippy.log`, `rust-build.log`; locked/offline Rust checks |
| Actual repository bundle reproducibility | PASS | Two independent builds produced identical bytes for all four bundle files; `reproducibility.json`, `build01.json`, `build02.json` |
| Independent browser acceptance from source | PASS — 8 Chromium groups | `source-browser.log`; owned headless Chromium/server; monitor screenshot inspected |
| Installed-package browser acceptance | PASS — 8 Chromium groups | `package-browser02/results.json`; ordinary public import, exact 17 runtime files, separate consumer engine compiled against the extracted crate, bundle reverified after run, cleanup PASS; monitor screenshot inspected |
| Real version/update/rollback walkthrough | PASS | `cli-walkthrough.json`; clean temporary source commits produced rc.1/rc.2 bundles, nine pins advanced, A-to-B update, tamper rejection without switching, recovery from damaged B to intact A, invalid rollback refused |
| Remote CI | PASS — Ubuntu Node 22 and 24 | [Run 37211458634](https://github.com/givtaj/browser-driver/actions/runs/37211458634), source commit `3d029839f3f28c5ea6ae3a6231ddcec60bc21ed4`; both jobs passed source checks, 59 release regressions, eight source and eight installed browser groups, then uploaded only bundles |
| Clean local and downloaded CI bundles | PASS — identical package bytes and manifests | `clean-package-equivalence.json`, `ci-bundle-verification.json`; both CI matrix bundles match the clean local build and browser-tested package bytes |
| Registry publication, Windows validation and everyday Roots migration | NOT PERFORMED | Explicit later lifecycle/coverage work |

All evidence paths in this section are relative to
`artifacts/release-readiness/` unless otherwise stated. Local execution used
macOS arm64, Node 22.20.0 and Rust 1.96.0. The walkthrough clone intentionally
excluded ignored Roots model snapshots, so its two customer Cargo metadata checks
were not run; their changed framework pins/lock entries were checked as source
only. The root workspace metadata and both real package builds passed.

The browser-tested candidate01 is a dirty local preparation receipt based on
`5bb9684c28f16e1d89abb8207b120ae195407f38`, not a published release. Its manifest
SHA-256 is `cf6342c720e529b54caa89e3ce40d173a25f0b1396b8dde773bd8a65d2a3c6f9`.
Runtime archive SHA-256:
`8aef43ec1e37547acb3f76292c8171fad107a3bee189bcf4b37b06ff2eb2820a`.
Shared crate SHA-256:
`b70a342e81c0d2cb36689fc6d35112eeb2e39ada17599a4d24f4ad04dcde257f`.
The clean temporary walkthrough's rc.1 archives match these exact package bytes;
its source/manifest receipt differs because it names the temporary commit.
Later harness/documentation changes do not change either archive. The clean local
build and both CI bundles for `3d02983` have manifest SHA-256
`ddae8798e96e467663367b377bf18edaf9cfb33f94783aff151d2f3dd07b500f`.
All four files are identical between those clean builds; both package archives
also match the earlier browser-tested local candidate. The dirty and clean
source receipts remain distinct. The follow-up commit recording this result
changes documentation only; the linked CI result belongs to `3d02983`.

Meaningful failing regressions preceded the release implementations and review
fixes. Local red logs are retained under `artifacts/release/`,
`artifacts/release-preparation/`, `artifacts/release-readiness/`, and
`/tmp/browser-driver-release-store-*-red.log`. They include strict manifest types,
path traversal, recovery after corruption, retained recovery diagnostics, archive
links, compatibility-before-output and temporary-directory canonicalization.

The first installed run, `package-browser01`, verified the runtime file bytes but
failed before engine compilation/browser scenarios because macOS resolved `/var`
to `/private/var`. Its failure and successful cleanup remain recorded. The harness
now canonicalizes its owned temporary directory; the exact containment assertion
is preserved and the fresh `package-browser02` passed all eight groups.

No live Roots source, normal dependency pin, launcher, service, browser session
or data was changed during release preparation. Docker was neither restarted nor
used. These independent package checks do not replace the still-required full
Roots promotion suite or active-normal-stack preservation check.

## Requested Roots Journal edit port — 2026-10-04

The [review and lessons](roots-edit-review-2026-10-04.md) distinguish the original
Roots edit evidence from this selected standalone consumer. The feature was
captured as 109 reviewed source overlays on committed base `96275b5`; its full
source digest is `56f3c2bc227f77c9f640ffd29aeae9efa8a5bc3df94fbe7c47431cffcfc4d9db`.
It is explicitly a verified working-tree overlay, not a committed feature release.

| Check | Result | Evidence and scope |
| --- | --- | --- |
| Shared runtime reporting, execution, viewer and cleanup | PASS — 42 Node tests | `artifacts/review-wave/runtime-all-green.log`; includes operation labels, frozen reports and run-end cleanup |
| Shared Rust and notebook contracts/stdio | PASS — 18 tests | `artifacts/review-wave/rust.log` |
| Source syntax, declarations, formatting and Rust lint | PASS | `artifacts/review-wave/source-check-final.log`, `rust-format.log`, `clippy.log` |
| Independent notebook browser acceptance | PASS — 8 Chromium groups | `artifacts/review-wave/notebook-browser.log`; actual monitor screenshot inspected |
| Historical Roots workbench | PASS — 5 tests | `artifacts/review-wave/roots-example-final-elevated.log`; initial sandbox loopback denial retained separately |
| Journal edit model and adapter | PASS — 5 Rust and 10 Node contracts | Frozen customer model and final candidate03 engine; `artifacts/review-wave/edit-rust-final.log` and `edit-contracts-final.log`; these checks are not browser acceptance |
| Customer integration, snapshot, effects and fixture checks | PASS — 41 Node tests | `artifacts/review-wave/customer-node-final.log`; includes the 11 preflight checks and real Vite cache-isolation check |
| Candidate provenance preflight | PASS — 11 checks | Stale source, consumer, engine, binary, dependencies and installed runtime fail before fixture creation |
| Packaged Roots edit browser/API/PostgreSQL | PASS — 8 groups | `artifacts/roots-edit-20261004/run03/results.json`; 34.9 seconds, zero diagnostics, no skipped scenarios |
| Original extracted Roots consumer with updated write evidence | PASS — 9 browser groups | `artifacts/roots-legacy-review-20261004/browser-results.json`; same final runtime tarball and current adapter/helper, fresh disposable data |
| Original staged compatibility launcher | PASS | `artifacts/roots-legacy-review-20261004/launcher-results.json`; closing the driver preserved its attached fixture |
| Original-consumer fixture cleanup | PASS — independently checked | `artifacts/roots-legacy-review-20261004/final-verification.json`; owned host/API/web and container absent, source/data removed; prior artifacts unchanged |
| Application and generic viewer presentation | PASS — screenshots inspected | Actual saved/cancelled application state and separate Setup entry / Requested edit labels; streamed images are asynchronous and can lag result status |
| Owned resource cleanup | PASS — independently checked | `run03/fixture/cleanup.json` and `run03/cleanup-independent.json`; private directory, container and all recorded API/web PIDs absent, owned Chromium closed |
| Frozen bytes after browser acceptance | PASS | `run03/post-run-preflight.json`; source, binary, installed runtime and web dependency preflight passed again after cleanup; Vite cache stayed in the owned private directory |

The eight packaged acceptance groups were fixture readiness, missing-prerequisite
rejection, the four recipes below, stopped uncertain-edit cleanup with explicit
retry, and immutable completed reports with viewer-client reload. The latter
caused no new write requests. Each recipe added exactly one setup entry and left
all prior entries unchanged.

| Recipe | Independent application evidence | Operation effects |
| --- | --- | --- |
| `edit-save` | One entry, version 1, `saved_once` and `edit_saved` | Setup saved; requested edit saved |
| `edit-cancel-retained` | Draft retained across navigation, then cancelled; entry remains version 0 | Setup saved; requested edit not attempted |
| `edit-lost-response-retry` | Upstream 200 was hidden from browser; exact retry confirms one edit at version 1 | Requested edit uncertain before retry, then saved |
| `edit-persisted` | Edited entry read back after reload and a distinct owned API PID restart | Setup saved; requested edit saved |

Stopping after the uncertain save preserved separate saved setup/uncertain edit
evidence, removed the owned fault route, and allowed an explicit retry with
identical persisted rows. Frozen reports remained unchanged after later recipes.
All raw checkpoints and screenshots remain in ignored artifacts.

Final candidate03 runtime tarball SHA-256:
`c41a6fbc89dbd2e344688fe512e1a29c97e93ed2c6cfaac4391fd27121c4cc6a`.
Shared crate SHA-256:
`722f89e9f7ac917cefea2ca0b08508c2534327a34f4d699dc27b833ad87a8870`.
Customer engine SHA-256:
`60569164b72f4bb873e74bb669b3babff312cb30f97e9e695d74df8d1872da79`.
These identities supersede neither the historical rc2/rc3 evidence nor its limits.
The measured installed runtime build is
`965f2383abe0cdf5ff410e933baf1ebd35bd694567972eb379b9cfea98435de5`.
Preflight matched 17 installed runtime files to the exact tarball, four staged
consumer files, 109 selected source files, the base archive and two application
binaries. The copied web installation contains 5,738 files with digest
`10059ed95e15b63da1dae0a2257f5c5cf4490abc1c8cbb5b0244364f28249aa1`;
installation from the lockfile was not independently established.
All 17 runtime archive files match the final source tree byte for byte. The final
shared crate passed `cargo package` verification. The earlier candidate02 also
passed all eight groups in run02; candidate03 repackaged a trailing-whitespace
manifest cleanup and was independently rerun through the full selected suite.

The additional original-consumer regression used a fresh archive of `d4008e3`
and reused the previously isolated application/engine binaries, with hashes and
dependency receipts recorded in `artifacts/roots-legacy-review-20261004/source.json`.
Those binaries were not rebuilt for this run. Its engine remains
`be6d68f7479b2009ae741cea52dac3ce9a3b5aa701888fd5b1e04d8c7fbea8c9`,
built against the earlier shared crate `3191df49…`. This separately verifies the
changed Profile/Journal adapter and final runtime against the original consumer;
the new final shared crate is exercised by candidate03 above.

Initial Docker startup failed before fixture or browser assertions. Its log is
retained as `artifacts/roots-edit-20261004/run01.log`; it is not an application
regression. Candidate checks began with zero running pre-existing containers
after the authorized restart, so their preservation check was vacuous. No active
normal-stack preservation or everyday dependency promotion is claimed.

The Docker restart was explicitly approved after its backend became unavailable.
Its graceful restart timed out; only the confirmed stuck Docker processes were
stopped. Docker recovered, and the previously retained Roots container was
observed stopped. This is not evidence that an active everyday Roots stack
survived a candidate failure. No normal Roots source or dependency pin changed.

## Actual Roots example and archive — 2026-09-27

The user requested examples grounded in real Roots work and linked
[Drive Roots QA browser after update](codex://threads/01a0e3a2-2b67-7700-a4f0-5bd5a30b891b).
`npm run demo` now opens the Roots workbench. The notebook is available only as
the independent `demo:notebook` conformance fixture.

| Check | Result | Evidence and scope |
| --- | --- | --- |
| Original Roots application and driver | PASS — new isolated launch | Committed `dd9cee67`, native offline build, matched dependency lockfiles, four binaries frozen before launch; `artifacts/roots-experience/source.json` and `ready-verification.json` |
| Draft retention | PASS — operated through real monitor | Original recipe completed 11/11 steps and `draft_retained`; experience remained unsaved while its explicitly added private strain was saved |
| Lost-response retry | PASS — operated through real monitor | Original recipe completed 10/10 steps, `save_lost_response` and `save_retry_deduplicated`; resulting state was Journal Saved |
| Strains search | PASS — manual visible check | Search for White completed and displayed six matching rows; not an independent completeness audit |
| Archive content | PASS — source review | Eight actual run records, nine reviewed unchanged screenshots, exact source artifact hashes, preserved failed attempts and corrections; [archive](../examples/roots/archive/README.md) |
| Latest source-chat update | PASS — read and matched to files | Completed local consolidation: 10 groups, 10 recipes, 11 Strains scenarios/18 observed leaves, stable sources/binaries, source checks and Docker; its uncommitted/no-remote-CI limits remain explicit |
| Archive UI | PASS — visible browser interaction | Checked historical-findings filter, finding disclosure, original screenshot gallery, standalone-candidate filter and fresh-walkthrough search |
| Serving/status regressions | PASS — 5 groups | `npm run test:roots-example`, exit 0; `artifacts/roots-experience/workbench-tests.log`; includes no fake-live fallback, bounded read-only status probes and path boundaries |
| Source syntax, types and formatting | PASS | `npm run check`, exit 0; `artifacts/roots-experience/workbench-source-check.log` |

The [fresh receipt](../examples/roots/archive/receipts/manual-walkthrough-source.json)
binds the manually operated application, driver source and frozen binaries. Its
results are scoped to two original recipes and one visible search; they are not
a new full regression run. Archived acceptance, observed Rust states and manual
observations remain distinct. The separately archived standalone candidate still
has the rc2/rc3 and migration limits below.

One new fixture startup attempt failed before browser assertions because its
PostgreSQL container exited 1. It cleaned up, and a diagnostic retry succeeded;
the removed container's full diagnostics were unavailable, so no cause is claimed.
Initial monitor pointer activations landed on Home instead of Profile; keyboard
activation of the specific control succeeded and was used afterward. One short
automation wait expired before the recipe completed; its actual final result was
then inspected and captured. None of those attempts is labeled an application
regression. A local check wrapper also used zsh's read-only `status` variable;
corrected plain commands finished successfully, without changing test assertions.

The original monitor's “Saved successfully” wording after the draft-retention
recipe refers to its private-strain write. The Journal experience remained a
draft. The archive retains this concrete ambiguity to guide future outcome labels.

The current Roots folder reorganization was observed read-only and left with its
own chat. This work made no live Roots source, dependency or normal-data changes.
The original driver, disposable fixture and workbench are intentionally retained
for interactive use; the old notebook demo was stopped after confirming it was idle
with no draft. Stop the Roots launcher to clean its owned fixture when finished.

## Local v0.1 candidate — 2026-09-27

The standalone product, example and focused Roots consumer are implemented and
locally verified. The final Node package is rc3. Browser acceptance used rc2;
rc3 changes only a TypeScript declaration, and every executable/runtime asset is
byte-identical. A fresh Roots browser run against rc3 was not performed.

### Results

Evidence paths below are relative to this repository. Raw artifacts are ignored;
this record and the customer report retain the durable findings and identities.

| Check | Status | Evidence / limit |
| --- | --- | --- |
| Product, architecture, contracts and workflow | PASS — review | [Architecture](architecture.md), [contracts](contracts.md), [workflow](development-workflow.md) |
| User-supplied architecture image | PASS — exact copy | `docs/assets/architecture.png`; original bytes preserved; editable Mermaid alongside |
| Node runtime/viewer regressions | PASS — 22 tests | `npm test`; exit 0; `artifacts/node-tests.log` |
| Shared Rust and notebook contracts/stdio | PASS — 18 tests | `cargo test --workspace --locked`; exit 0; `artifacts/rust-tests.log` |
| Source syntax, declarations and formatting | PASS | `npm run check`; exit 0; `artifacts/source-check.log` |
| Rust formatting and lint | PASS | `cargo fmt --all -- --check`; `cargo clippy --workspace --all-targets --locked -- -D warnings`; exit 0 |
| Independent notebook acceptance | PASS — 8 real Chromium scenario groups | `npm run test:e2e`; `artifacts/notebook/results.json`; controlled page and monitor screenshots inspected |
| Packaged Roots consumer | PASS — rc2 | 9 real browser/API/PostgreSQL groups, 8 customer contract/evidence checks, staged ordinary launcher smoke; [customer results](../integrations/roots/RESULTS.md) |
| Candidate resource cleanup | PASS | Both acceptance fixtures closed; `artifacts/roots/cleanup-verified.json`; zero pre-existing normal Docker containers, so active-normal-stack preservation was not exercised |
| Shared Rust package | PASS | Packaged crate consumed by the isolated customer engine through its public API |
| Final Node package | PASS — package/types/equality | rc3 declaration checked; `artifacts/candidates/rc3/runtime-equivalence.json` |
| Fresh Roots acceptance of rc3 tarball | NOT RUN | Declaration-only difference from browser-tested rc2; see identities below |
| Everyday Roots migration, registry publication, remote CI | NOT PERFORMED | Separate lifecycle work; no live dependency or entrypoint changes made |

### Exact artifacts

| Artifact | SHA-256 |
| --- | --- |
| Browser-tested Node rc2: `artifacts/candidates/rc2/browser-driver-runtime-0.1.0.tgz` | `b04f7e98188e0c110de7f4d17959a21800bae2f1123188e61775585adefb32c1` |
| Final Node rc3: `artifacts/candidates/rc3/browser-driver-runtime-0.1.0.tgz` | `d6f57b08931cca88517e1f960ccdce8c7b107c5c72558cc4ac6edab12c403c96` |
| Shared crate: `target/package/browser-driver-engine-0.1.0.crate` | `3191df49c978c723c69bd61993aace6325ca1b854b86658a87be782097eda295` |
| Notebook engine: `target/debug/notebook-engine` | `0b4e89f6b506e737983d632b97cb7a6948a5646b80dde93903edc7967e57836d` |
| Roots customer engine used in acceptance | `be6d68f7479b2009ae741cea52dac3ce9a3b5aa701888fd5b1e04d8c7fbea8c9` |
| Supplied architecture image | `686e1666a9121556f670007ab37002023ab34f901674315b8f1e2cf9120d843d` |

The measured installed runtime build is
`6b552691fdcde81033da5e2996dcda97e8eb1c7a664df987d409d056266fc5f9`.
rc3 corrects `Snapshot.display[].value` from `string` to `unknown`, matching the
actual model values. The only changed archive member is `package/src/index.d.ts`.
JavaScript, HTML, CSS and package metadata match rc2 exactly. A content hash
identifies tested bytes; it does not independently prove compilation provenance.

### Regression evidence

- Initial Node tests failed against explicit unimplemented functions: seven
  failures in `/tmp/browser-driver-node-red.log`. Initial Rust contract tests had
  nine compiled failures in `/tmp/browser-driver-rust-red.log`. These were source
  regressions, not evidence of browser failures.
- Independent review exposed authorization mismatch, recipe freshness and
  lifecycle/reporting gaps. Nine regression checks failed before the repairs and
  passed afterward: `/tmp/browser-driver-review-red.log` and
  `/tmp/browser-driver-review-green.log`.
- A recipe could overwrite a human notebook draft. Its failing contract was
  captured in `/tmp/browser-driver-notebook-draft-red.log`, then fixed and checked
  in `/tmp/browser-driver-notebook-draft-green.log` and the real-browser suite.
- Roots acceptance exposed a real customer-model defect while correcting an
  invalid Profile field back to its saved value. A focused regression failed;
  the customer bridge was fixed and the original browser scenario passed. See
  [the feedback record](../integrations/roots/feedback.md).
- The initial notebook browser harness needed explicit account-switch settling
  and a valid edit-then-clear sequence. Its failed run remains in
  `artifacts/notebook/initial-red.json`; it is not presented as a product defect.
- Formatting exposed brittle source-text substitutions in a Node test fixture.
  The fixture now loads explicit configuration; the runtime assertions remain
  intact and all 22 Node tests pass.

### Scope and Roots preservation

The independent app proves that the core, model contract and viewer work without
Roots. The isolated Roots integration provides 15 commands and one recipe for
sign-in, Profile, Journal and viewport behavior. It does not migrate all ten legacy
recipes, inline strain commands, API-restart flows or later Strains work.

Roots acceptance used a Git archive of
`d4008e39aeaa137bb54ff48ca2d11748083a971a`, separate dependency/build directories,
new browsers, generated ports, synthetic accounts and disposable PostgreSQL data.
The live checkout was read-only throughout this work. It advanced concurrently to
`dd9cee67e3886333a7fe8eb7f8545d428167fb07`; those external changes were recorded,
preserved and not treated as candidate writes. No test targeted normal Roots
services, dependencies, entrypoints or data. The owned fixture was removed.

Later Roots changes are reviewed and selectively ported only when requested,
following [the upstream-review workflow](development-workflow.md). There is no
automatic synchronization or monitoring.
