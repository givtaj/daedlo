# Verification record

## Portable rc.4 source release checks — 2026-10-06

The selected clean-release target is `0.1.1-rc.4`. It supersedes the local rc.3
candidates without reusing their artifact identities. User scope is a private
release that an agent can download and mount in a separate customer QA directory;
no actual WBF application onboarding or portal implementation is included.

| Check | Result | Evidence and scope |
| --- | --- | --- |
| CLI lifecycle regressions | PASS — 11 | Genuine stale-report and missing-retry-handler failures precede fixes; additional failures cover cleanup status, interrupted startup and failed session construction |
| Shared runtime | PASS — 53 Node tests | `runtime-tests-final.log`; includes actual CLI control flow with injected module boundaries, real sessions and resource scopes |
| Release contracts | PASS — 82 | `release-tests-final.log`; remote discovery/download, store/version identity and 19-file portable installation checks |
| Portable documentation links | PASS — 8 tools checks | Missing packaged local references first failed; final archive links resolve without a source checkout |
| Rust contracts | PASS — 18 | `rust-tests.log`; locked/offline shared crate and independent fixture contracts |
| Source browser conformance | PASS — 8 Chromium groups | `source-browser.log`; real isolated notebook browser/API fixture, public viewer, stale/uncertain effects and recovery |
| Roots archive helpers | PASS — 11 | `archive-tests.log`; no live Roots fixture, service or data mutation |
| Source/types/format and Rust lint/build | PASS | `check-final.log`, `rust-fmt.log`, `rust-clippy.log`, `rust-build.log` |
| CI configuration | UNCHANGED | Existing Ubuntu Node 22/24 matrix and existing test globs cover these regressions |

Evidence is under ignored `artifacts/release-rc4-20261006/`; the initial packaged
link failure is in `artifacts/release-readiness-20261006/portable-links-red.log`.
CLI reports are captured after active execution, `endRun` and owned cleanup;
failed cleanup remains retryable by a later signal without replaying effects.
A session initialization failure also retains the adapter's cleanup responsibility.
Attached resources remain outside owned cleanup. Tests using injected boundaries
are not mislabeled as browser acceptance.

The final clean source identity, exact installed-runtime CLI browser checks,
portable installation outside the workspace, final remote CI and published-asset
verification are recorded after source freeze in the
[release receipt](https://github.com/givtaj/browser-driver/releases/tag/v0.1.1-rc.4).
This source record does not assert those later outcomes, WBF readiness for a
specific flow, or promotion of any everyday customer dependency. Existing rc.2
and rc.3 customer evidence below remains tied to its original bytes.

## SeeRuntime isolated update comparison — 2026-10-06

The second application trial uses committed SeeRuntime source
`068d573051f7e43213ba547f842624f6551706f6` in an isolated archive. Its JavaScript
application was not rewritten: a customer-owned Rust playback model and guarded
Node adapter exercise the existing Node.js I/O lesson. The [integration guide](../integrations/seeruntime/README.md)
records the enum, recipe, setup, coverage and evidence boundaries.

| Check | Result | Evidence and scope |
| --- | --- | --- |
| Customer Rust model | PASS — 6 per package pair | Genuine 3-assertion model red, then green against the exact rc.2 and rc.3 crates; missing/inconsistent observations deny effects |
| Customer archive preparation | PASS — 3 checks | `prepare-tests.log`; unsafe archive entries refused; listing and extraction consume the same verified bytes |
| Released rc.2 browser flow | PASS — 9 checks | `rc2-final/results.json`; six commands, full recipe, unavailable pause rejection, final successful reset |
| Local rc.3 browser flow | PASS — same 9 checks | `rc3-final/results.json`; identical customer model/adapter, separately installed runtime/crate and build output |
| Accepted version after candidate | PASS | `accepted-after-candidate.json`; the full rc.2 recipe still completes successfully via its public viewer after rc.3 acceptance |
| Customer pins and engine preservation | PASS | Both consumers' Node/Cargo manifests and locks, Rust model sources and engine binaries match the recorded pre-run hashes |
| Application source provenance | PASS — 35 served files | `source-identity.json`; exact archive hash and served tree identity; independent comparison with pinned Git blobs; runner verifies before/after |
| Real checkout preservation | PASS — 142 recorded files | `preservation-comparison.json`; HEAD, Git status and recorded file identities unchanged; all 42 existing dirty entries preserved |
| Visible viewer | INSPECTED — both versions | `rc2-final/viewer.png`, `rc3-final/viewer.png`; controlled headless Chromium with visible MJPEG stream, Ready state and final Success |
| Ownership | RETAINED deliberately | Two owned static servers, Chromium sessions and viewers; current PIDs/URLs and scoped cleanup instructions in private handoff; prior trial owner exited |

Evidence paths are under ignored `artifacts/seeruntime-trial-20261006/`. The exact
rc.3 pair is the candidate recorded below. Model source SHA-256 in both consumers
is `dccdbfd29468944eadb1efde7ebd487482830449f938cbcc7b6ee43b478a0529`.
No live SeeRuntime or Roots dependencies, services or data were installation
targets. The checkout inventory excludes ignored files, running services and
external data; it does not prove their contents or state. External font requests
were blocked in the trial's owned browser context. No Docker fixture was needed.

This verifies one existing lesson flow, not all SeeRuntime models or branches.
Playback completion/replay, account, sharing/clipboard, persistence, production
deployment, Windows and Claude Code host discovery are not covered. Earlier
successful runs remain separate from the final receipts; setup permission waits
are not browser failures. CI configuration and the published rc.2 assets remain
unchanged.

## Portable updates — local rc.3 candidate, 2026-10-06

The published rc.2 release remains unchanged. This work produces a local
`0.1.1-rc.3` runtime/crate candidate and a separate portable tools archive. Both
receipts explicitly disclose dirty source; they are not a clean final release or
remote CI/publication claim. The tools documentation was finalized after the
runtime snapshot, so their recorded source-tree identities differ.

| Check | Result | Evidence and scope |
| --- | --- | --- |
| Release regressions | PASS — 82 | `release-tests.log`; 7 CLI, 14 remote, 8 portable-tools plus existing packaging/store/version checks |
| Portable documentation inventory repair | PASS — 8 tools checks | `tools-doc-path-red.log` then `tools-doc-path-green.log`; missing packaged update guide first failed the inventory assertion |
| Runtime and Rust regressions | PASS — 42 Node / 18 Rust | `runtime-tests.log`, `rust-tests.log`; loopback permission failure resolved through normal escalation |
| Syntax/types/format | PASS | `check.log`; no CI configuration changes |
| Exact runtime/crate installation | PASS — 8 real Chromium groups | `package-acceptance-allowed/results.json`; all 17 installed runtime files verified; owned temporary consumer/browser/server cleanup passed |
| Exact tools installation | PASS — 19 files | `build-tools-rc3-complete.json`; actual offline installation adds one dependency-free package; all installed bytes compared with archive |
| Real GitHub discovery/download | PASS — installed client | `installed-live-check.json`, `installed-live-download.json`; rc.1 detects published rc.2; exact rc.2 download matches its trusted manifest digest; discovery does not claim compatibility |
| Current release check | PASS | `live-check-rc2.json`; rc.2 reports current on the explicit preview channel |
| Opt-in update and rollback | PASS — 5 steps | `store-walkthrough.json`; select rc.2, reject dirty candidate without opt-in, reject corrupted archive, explicitly select intact rc.3, rollback to rc.2; both refusals preserve store state byte-for-byte |
| Portal | DEFERRED | Prototype preserved in ignored artifacts, removed from active workspace dependencies; Cloudflare/WorkOS/Google/Stripe phase documented only |

Evidence paths above are under ignored `artifacts/release-update-20261006/`.
The explicit candidate runtime/engine manifest SHA-256 is
`9fff3c15e3eda90fdd1e6342ef5f7cc1f5f90a273df593619770c5490a2e5799`;
the complete tools archive SHA-256 is
`ef3fa5edc584225bcc7a7b0d65acd432576b74a46be086794dec2fb81b018068`.
The actual before/after layout is retained in `PACKAGE-WALKTHROUGH.md` beside
those receipts; the reusable instructions are in [portable tools](update-client.md).

The download/store commands never edit application pins or launchers. Store
rollback selects archives only. Customer compatibility still requires testing the
exact model/adapter/package combination; version or protocol checks alone cannot
guarantee it. No background update task was installed. Windows and both agent
hosts' automatic skill discovery remain unverified. This work did not access or
change the live Roots project or its retained fixtures.

## Current Roots clone onboarding and comparison — 2026-10-05

The published `v0.1.1-rc.2` runtime/crate were verified against the supplied trusted
digests and installed into a separate self-contained Roots clone pinned to
`fc099641691000e3c37cba8c690c532764981e3a`. Shared release bytes and current Roots
product code were unchanged. Two clone-local customer bridges reuse current Rust
plans and facts; they cover six of the original driver's 18 canonical recipes.
The [full comparison report](reviews/2026-10-05-current-roots-onboarding.md) contains
the command/recipe matrix, package identities, onboarding repairs, viewer findings
and reproduction/cleanup instructions.

| Check | Result | Fresh evidence and scope |
| --- | --- | --- |
| Released runtime integrity | PASS | Trusted manifest/skill verification; all 17 installed runtime files match archive bytes |
| Current creation/draft/retry bridge | PASS — 4 browser/API/PostgreSQL groups | `basic-run02/results.json`; invalid/valid sign-in, exact draft retention, retained-draft save, same-operation lost-response retry |
| Current Journal edit bridge | PASS — 6 browser/API/PostgreSQL groups | `released-edit-run02/results.json`; valid auth, direct draft retention, four current edit recipes including retry and owned API restart |
| Original current driver | 19 PASS, 1 FAIL | `legacy/results.json`; all 18 recipes plus Strains smoke pass; second sign-in had a transient destination-verification failure despite a signed-in UI |
| Equivalent supplemental re-sign-in | PASS — both drivers | `resignin-comparison.json`; later Journal/signout/Profile/signin/Journal sequence passed; initial legacy failure retained, cause unresolved |
| Customer integration contracts | PASS | Basic 11 Node + 2 Rust; edit 13 Node + 5 Rust; genuine model/catalog/display regressions precede repairs |
| Original driver contracts | PASS | 35 Node + 42 Rust; clone-only default binary path setup required |
| Live viewer experience | INSPECTED in visible Codex tabs | Original, new basic and new edit viewers; owned headless Chromium streams, not native headed windows |
| Original checkout preservation | PASS — scoped inventory | Same HEAD/status and 3,274 recorded file identities; zero changed paths |
| New-driver deletion / standalone Strains | UNSUPPORTED by these bridges | Original deletion recipes and Strains smoke pass; not new-driver acceptance |
| Full feature suites / unfamiliar-app onboarding / Claude discovery | NOT RUN | Selected recipes do not establish full feature or host coverage |

Evidence is under ignored `artifacts/current-roots-onboarding-20261005/`. Docker
was initially stopped and was started by the user. Sandbox/toolchain/launcher
setup failures remain separately recorded. Three isolated demos are retained with
current owned handles and guarded cleanup commands; the first edit fixture cleaned
successfully. No original Roots dependency, binary, service, session, database or
record was changed. CI and publication were untouched.

## Developer preview source checks — 2026-10-05

Release version `0.1.1-rc.2` includes the agent onboarding instructions, updated
release documentation and portable Roots helper source defaults. Shared runtime
and Rust engine implementation are unchanged; package versions and the isolated
consumer pins advance together. Private chat references were removed from the
distributed archive without changing scenario text or evidence identities.

| Check | Result | Evidence and scope |
| --- | --- | --- |
| Shared runtime | PASS — 42 Node tests | `checks/node-runtime-permitted.log` |
| Release contracts | PASS — 59 tests | `checks/node-release.log` |
| Archive and helper source selection | PASS — 11 tests | `checks/node-roots-archive-final.log`; includes six subprocess checks for sibling defaults and explicit overrides, with Git intercepted before customer access/build |
| Rust contracts | PASS — 18 tests | `checks/rust-tests.log`; locked/offline |
| Syntax, declarations, formatting, Rust lint/build | PASS | `checks/node-check-final.log`, `rust-fmt.log`, `rust-clippy.log`, `rust-build.log` |
| Agent skill | PASS — structure and portable-copy checks | Instruction checks are recorded in the section below; final distributable content is checked separately in the release receipt |
| CI configuration | UNCHANGED | Existing Ubuntu Node 22/24 jobs; no new workflows, matrix entries, dependencies or publication jobs |

Paths in this section are under `artifacts/first-preview-20261005/`; Rust logs are
under its `checks/` directory. Three genuine source-path assertions failed before
the helper fix while all three explicit overrides passed (`source-location-red.log`).
All six passed after the fix (`source-location-green.log`). The test fixture uses
physical temporary paths to account for macOS path aliases without weakening the
source-selection assertion. Initial runtime/archive server checks were blocked by
sandbox loopback permissions; their logs remain beside the permitted passing runs.

Clean-source bundle identities, exact installed-package browser checks, final
remote CI and downloadable-asset verification are generated after this source
commit. The [release receipt](https://github.com/givtaj/browser-driver/releases/tag/v0.1.1-rc.2)
and its `VERIFICATION.md` asset record those results against the final tag.
These source checks do not assert new Roots browser acceptance or customer
promotion. No normal Roots dependencies, services or data were changed.

## Agent onboarding instructions — 2026-10-05

Added a portable `skills/browser-driver/` instruction folder, a flow-spec template,
Codex/Claude Code installation guidance and a repository Claude entry point. The
runtime, crate, lockfiles, protocol and release artifacts were not changed. The
[onboarding guide](agent-onboarding.md) keeps native Rust models and Node adapters;
Docker remains a customer-fixture dependency rather than a core requirement.

| Check | Result | Evidence and scope |
| --- | --- | --- |
| Skill structure | PASS | Skill-creator validation of required frontmatter, naming and unfinished scaffold checks |
| Portable folder and documented installation | PASS | `artifacts/agent-onboarding-20261005/validation-02.json`; five files including MIT license copied byte-for-byte into temporary `.agents/skills` and `.claude/skills` layouts; local references resolve inside each copy and an existing destination is refused |
| Dependency inventory | CHECKED — source and local metadata | Runtime Node >=22, Playwright 1.62.1; Rust MSRV 1.96 with repository toolchain 1.96.0; no npm minimum declared; core has no model-provider SDK or Docker requirement |
| Independent instruction evaluation | REVIEWED — dry run only | A separate agent applied the skill to an agreed PHP catalogue-search scenario with missing repository/URL inputs; it preserved prior agreement, distinguished browser ownership and avoided invented APIs. Review found inaccurate Chromium cache wording, which was corrected; no customer onboarding occurred |
| Repository source, types and configured formatting | PASS | `npm run check`; existing JavaScript syntax, public declarations and configured formatting checks; this is not browser acceptance |
| Markdown links, license and diff | PASS | Local links checked; copied skill license matches repository MIT license; `git diff --check` |
| Host discovery, real Codex/Claude onboarding and new customer acceptance | NOT RUN | Folder layout checks and an instruction dry run do not prove host discovery or a successful application integration |

Read-only local inventory used macOS arm64, Node 22.20.0, npm 10.9.3 and
Rust/Cargo 1.96.0. Matching Playwright Chromium was present; no browser was launched.
Roots fixtures document Node 24+ and disposable PostgreSQL through Docker; this
instruction work did not run them or check Docker daemon/database readiness.
No global skills, customer dependencies, Roots files or services were changed.
Private chat history used to recover the workflow is not distributed in the skill.

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

The documentation commit also passed [run 37211683760](https://github.com/givtaj/browser-driver/actions/runs/37211683760).
Those runs reported deprecated Node 20 runtimes inside the three GitHub actions.
The workflow pins were subsequently advanced to official checkout `v7.0.1`,
setup-node `v7.0.0` and upload-artifact `v7.0.1` commits, whose `action.yml` files
declare Node 24. This affects the CI helpers; the product test matrix remains
Node 22/24. Per-commit results are available in the
[CI run history](https://github.com/givtaj/browser-driver/actions/workflows/ci.yml).

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

The user requested examples grounded in real Roots work. The
[archive](../examples/roots/archive/README.md) records the captured source evidence.
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
The original driver, disposable fixture and workbench were retained at that
checkpoint for interactive use; the old notebook demo was stopped after confirming
it was idle with no draft. This historical record does not assert those services
remain running. Closing a retained Roots launcher cleans only its owned fixture.

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
