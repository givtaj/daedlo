# Verification record

## Alpha.9 Swagger release preparation — 2026-11-09

**IN PROGRESS — source and preliminary exact installed checks passed. A final
source freeze, refreshed exact artifacts, Roots acceptance, hosted CI and public
delivery remain separate gates.**
The isolated `codex/swagger-release-alpha9-20261109` branch starts from current
main `cd049e9` and ports generic Swagger source commit `42da7a6`. The primary
checkout, frozen held alpha.8 kit and published alpha.7 are preserved. A fresh
HTTPS read confirms the public catalog still ends at alpha.7, generation 27.

The candidate packages the standalone Swagger helpers and locked native model
source, requires an explicit installed runtime, and builds against the exact
extracted core crate without changing either package. Version stamping now binds
all twelve release-version files. Portable tools inventory excludes customer
acceptance scripts, local profiles, build outputs and Swagger UI development
assets. Swagger UI remains a dev-only independent fixture dependency with its
optional install analytics disabled.

Release review found and fixed one permit race (two requests could cross an
async observation using one permit), directional readOnly/writeOnly validation,
impossible date-time normalization and absent-body versus JSON-null ambiguity.
Each had a genuine failing assertion before its fix. Packaging assertions first
failed for omitted Swagger files and missing version consistency checks, then
passed. Explicit password parameter checks first failed in Node/Rust and the real
browser (text input), then passed after the contract and viewer implementation.
The viewer masks/clears marked inputs; public descriptor defaults and recipes are
not a secret store. A native startup regression caught the new validation message
being dropped by its safe diagnostic allowlist; the corrected exact allowlist
passes the original real-browser assertion.

| Check | Observed result |
| --- | --- |
| Complete runtime Node suite | PASS: 222 tests, no failures/skips on Node 24.22.2 |
| Generic Swagger catalog/adapter | PASS: 19 focused tests, including single-permit concurrency and schema corrections |
| Swagger model and real browser | PASS: 18 Rust tests, fmt/Clippy; 20 Chromium tests using Swagger UI 5.34.1 and OpenAPI 3.0.3/3.1.0/3.2.1 |
| Password contract | PASS: 4 Node, 3 Rust and 1 Chromium presentation check; masked and cleared screenshots inspected |
| Existing Rust workspace / viewer | PASS: 29 Rust tests (one subprocess-only fixture intentionally ignored); 32 viewer tests |
| Release version/tools packaging | PASS: 14 tests including twelve-file stamping, rollback, complete isolated portable inventory and no private additions |
| CI policy | PASS: 11 tests; both Node lanes require Swagger source and exact installed checks |
| Broad release/alpha suite | PASS: 605 tests after native diagnostic, teardown, bounded cleanup and explicit migration fixes; no failures or skips |
| Existing source application flows | PASS: eight notebook groups, starter/request-accounting flow, eight managed-reference groups and nine evidence groups |
| Public metadata | PASS; no source/runtime paths or credentials added to shared reports |
| Preliminary exact installed alpha.9 | PASS from clean source `91b9f9a`: native runtime/tools/core, 8 notebook groups, complete control/grid checks, 16 starter groups, required evidence/managed references, and 12 Swagger groups including masked submission; all cleanup PASS |
| Preliminary exact upgrade/rollback | PASS: 9 checkpoints from pinned published alpha.7 through exact alpha.9 tools, explicit authored dependency migration, restart, and complete old-slot rollback with preserved data |
| Preliminary exact Roots | PASS on pinned source `46d1e18`: 4 save/stale/readback groups, viewer contract, 11 grid checks, CLI launch/close, rebuilt customer model and 5 real Access masking checks; installed Swagger run pending |
| Final exact kit / CI | Still in progress; preliminary CI metadata/secrets and both Node 22/24 contract stages passed |
| Publication | NOT RUN; alpha.7 remains public |

The release source incorporates the scoped reviewed dependency changes from
[PR #27](https://github.com/givtaj/daedlo/pull/27): Playwright 1.65.0, Node 24.22.2
and the CI 22.23.4 lane, npm 11.21.2, Wrangler 4.158.0 and the request-accounting
acceptance adjustment for Chromium terminal events. This is local integration;
it does not merge that PR or activate a publisher policy. Initial localhost
EPERM fixture failures were sandbox/setup failures, retained separately from the
unrestricted successful runs. Current source/installed checks do not imply a
clean-machine, other-platform, customer-business or production acceptance claim.


The preliminary frozen kit is retained under source identity `91b9f9a0be7081bd6ff4c161419a607a78cf50ef`.
Its ZIP SHA-256 is `67ed141bf9b563d4c511733313f359710b40b8881e0de60ccaa69c277a12a49e`.
It is not the final promotion artifact: later acceptance cleanup and assisted
migration guidance require a fresh clean source and new identities. Native,
starter, Swagger and upgrade receipts stay under the ignored alpha.9 artifact
directories; private local diagnostics are excluded from public metadata.

The first exact upgrade correctly refused a changed Playwright dependency lock.
The reviewed assisted path first proves that refusal preserves the old slot,
then changes only the independent QA integration's `package.json` and lockfile
against the exact candidate runtime. It preserves all other authored bytes and
uses the unchanged manager guard/acceptance path. Historical rollback restores
the complete alpha.7 slot. The new `--alpha9-dependency-migration` drill flag is
explicit and valid only with `--alpha9-upgrade`; no general lock guard was relaxed.
The original failed receipt is retained separately. Test cleanup now closes all
manager instances before checking their shared ownership store, and waits for an
owned orphan process to exit before removing its directory. Swagger acceptance
attempts every owned close and preserves failed handles and consumer files.

## Reusable Swagger source candidate — 2026-11-09

**PASS within the stated source-candidate scope.** Built in the isolated
`codex/swagger-api-driver-20261109` worktree from Daedlo base `06331d7`.
The preserved primary checkout and Roots everyday dependencies were not edited.
The requested design is reusable across projects: OpenAPI catalog, Swagger UI
adapter and Rust model are generic; customer URLs, policy, authentication and
persistence proof remain in a project integration.

| Check | Observed result |
| --- | --- |
| Generic catalog/project Node tests | 21 passed: 14 catalog and 7 profile/document-loading groups |
| Complete runtime Node suite | 207 passed, no failures/skips |
| Swagger Rust model | 18 passed; Clippy with warnings denied, fmt and build passed |
| Existing Rust workspace | 26 passed; one intentional subprocess-only test ignored by its parent harness; fmt passed |
| Independent real Swagger UI 5.34.1 | 19 passed, no failures/skips, including OpenAPI 3.0.3, 3.1.0 and 3.2.1 parameterized requests |
| Actual Roots UI/API/PostgreSQL | 12 passed against the supplied disposable fixture |
| Existing browser regressions | E2E 8 groups; motion 4, controls 9, CLI 10, viewer 31, Ninja UI 2 tests passed |
| Source checks | JavaScript syntax, TypeScript declarations, Prettier and diff whitespace passed |
| Visible viewer | Inspected generic model/catalog and completed GET greeting recipe; three steps finished, HTTP 200, explicit persistence-not-established outcome |

New tests produced genuine failures before implementation: empty operation
catalog, missing visible operation selection, permissive model authorization,
stale/multiple response acceptance, earlier-write proof reuse, premature
finalization during another in-flight request, authentication changes (including
path-scoped cookies), header casing and service-worker preflight. Setup failures
were kept separate: the initial independent fixture needed correct UTF-8 HTTP
headers before its behavioral red could run. Service-worker regressions verify
mocked browser preflight observations, not actual interception coverage.

Roots acceptance discovers 22 operations and exercises public greeting/health,
documented unauthenticated 401, missing required query input with no request,
write policy and stale-revision no-write checks, Swagger JSON/CSRF login,
cookie-authenticated reads, query parameters and reset. Two explicitly permitted
synthetic writes distinguish persistence evidence: HTTP 201 plus an empty HTTP
200 readback remains **uncertain**; exact profile/response-ID/requested-name
readback matching once produces **saved**. Verifiers run only during finalization.

The supplied Roots binary was built from its existing working tree, including
pre-existing changes, with base commit
`d1a74009c06f385bc1f9bfc6bed9343682dac43c`; it is **not pinned-commit acceptance**.
Its API SHA256 is
`d7ab4f292b70209d826614ee4e6d15bae308e963ec75bea96aaa271c89a46f59`;
served JSON schema SHA256 is
`4f52045ec2f280fd5ca4ccce12c0f3fe988cf81c77312cc2c050758f436dee4e`.
The Swagger engine used by the post-audit Roots run has SHA256
`e1506940aa60d2f9372c7c1c782d2216c6ee209db170c65016c8a3619faf00cf`.
Schemas and binary hashes identify public contract/build bytes, not private account
identifiers. Synthetic credentials and request/response evidence stay private.

Local ignored evidence: `artifacts/swagger-roots-acceptance-03/summary.json`,
`results.json`, and the inspected public greeting screenshot; baseline browser
logs `artifacts/swagger-baseline-*.log`; full Node log
`artifacts/swagger-node-tests.log`. Owned test sessions/browsers and the inspection
viewer closed cleanly. The attached Roots API/database remain with their original
owner. The tests confirmed attached page/authentication survival across session
closure.

**Limits / NOT RUN:** no release/publication, installed-kit acceptance or hosted
CI is claimed; no everyday Roots promotion. The reusable source helper currently
uses a POSIX launcher. No Windows/Linux platform acceptance is claimed. Latest
OpenAPI 3.2 QUERY/custom operations are discoverable but execution is unavailable;
YAML, external references, multiple/templated/cross-origin servers, complex
serialization, multipart, OAuth orchestration, streaming and full JSON Schema
coverage remain unsupported. See the [precise compatibility matrix](../integrations/swagger/README.md).


## CI efficiency with retained installed coverage — 2026-11-06

Prepared from main `06331d7` in an isolated checkout. Both required Node 22/24
statuses, all source/browser/exact-installed consumer suites, main/manual full
verification, PR trigger coverage and superseded-run cancellation remain.
Node-independent Rust formatting, Clippy and contract tests run once in Node 24;
both lanes still build their fixture. Official SHA-pinned Cargo caches cover
registry downloads and the workspace target only. Fresh temporary installed
consumers, package archives, acceptance receipts and production renewal are not
cached or bypassed.

The only lightweight PR case is ordinary edits to the two non-shipped records
`docs/plan.md` and `docs/verification.md`. The checked-out merge's two parents
must match the event; its complete diff from the merge base must contain only
those regular-file modifications. Main/manual runs, product/shipped-doc changes,
additions, deletions, renames, mode changes and uncertain inputs require full
verification. The light statuses explicitly say source/browser/package checks
were NOT RUN. Failed metadata/selection cannot produce passing Node statuses.
These records still change source provenance; no unchanged-artifact claim is made.

Regression-first evidence: two workflow assertions failed against the original
configuration (duplicate Rust checks and absent fail-closed selection gate),
then passed after implementation. Local real-Git fixtures cover record-only
merges, base-side runtime changes, source-to-record renames, malformed/missing
events and revisions, missing Git history, and required-status shell failures.
Focused policy/metadata/guardrail tests, source syntax/types/formatting, tracked
metadata checks and actionlint 1.7.12 pass. Local evidence is retained under
`artifacts/ci-efficiency/` in the isolated checkout. Hosted full-matrix results
are tracked on the CI-efficiency PR; no warm-cache savings or new package/customer
acceptance is claimed from these local checks.

## Alpha.8 grid integration and acceptance-gate preparation — 2026-11-06

The owner authorized merging the grid and preparing alpha.8 while keeping the
verified alpha.7 installation intact. Grid commits `714e856` and `7ab5717` are
integrated with PR #22's finalization/ownership changes and PR #23's retained
history documentation/audit changes. Both earlier verification histories remain.
No public release, signed-feed promotion or default installation change follows
from this source preparation.

- A real combined-browser regression exposed active flow reporting Running while
  effect evidence was pending. The flow now uses the same validated run/phase
  finalization guard as the result panel. RED: one of four browser cases failed;
  GREEN: four finalization, 17 affected runtime and 31 complete viewer cases pass.
  Pending/stalled evidence, cleanup, cooperative Stop and prior-result attribution
  remain explicit. Desktop and narrow screenshots were inspected.
- All 186 shared runtime tests and 26 Rust checks pass; locked Rust build,
  formatting and Clippy with warnings denied pass. The existing ignored
  subprocess helper is exercised by its parent test.
- Two new alpha.8 reference-dispatch assertions failed before extending the
  installed gate; all 14 reference/licensing checks then pass. A separate
  four-failure harness regression proves grid/active-run tests cannot be omitted
  or skipped. Seven harness tests pass; exact installed acceptance now requires
  16 groups and 136 checks, including grid 18 and active-run five.
- Explicit alpha.8 recovery mode requires the pinned published alpha.7 baseline
  and exact alpha.8 candidate. Eleven mode regressions failed before correction;
  all 43 mode tests pass. The full recovery drill is a separate artifact gate.

Additional local preflight passes all 554 release/alpha contract tests, 41
metadata/repository safeguards and the public metadata scan. Syntax, types and
formatting pass. Independent browser groups pass: notebook eight, motion four,
controls nine, CLI ten, authorization/cleanup 18 and Ninja UI two.

These are source/harness results. Exact installed alpha.8, rebuilt Roots pairing,
update/rollback, hosted PR/main CI and artifact hashes are not inferred here;
the release preparation receipt records those results as they are executed.
Evidence is retained locally in `artifacts/grid-alpha8-release-2026-11-06/`.

## Large-model tablet grid correction — 2026-11-06

**PASS — source correction and read-only actual-Roots CSS preview.** The earlier
candidate `714e856` passes the scoped checks below but has a newly reproduced
layout defect at 641–920px when a large state map determines the page height.
The sidebar stretches the body grid row, then the main flex container and its
stacked panels absorb that height. The browser image can be thousands of pixels
below the visible header. The original installed candidate and its earlier
receipts remain unchanged; this record does not broaden their acceptance.

- **RED before correction:** a large synthetic hierarchy reproduces the bug at
  732, 747 and 920px; existing 390 and 1440px cases pass. At 747×888, the sidebar
  is 18,243px tall and actual contained image pixels begin at y=2,897px.
  Assertions measure the painted image area, not only the image element's box.
- **Source fix:** tablet sidebar content scrolls within the viewport; stacked
  panels use their content heights instead of inheriting the state-map height.
  All states remain reachable. Desktop rules and mobile header behavior are
  preserved. The tablet remains a vertically scrolling layout, with active flow
  following results; simultaneous above-fold visibility of every panel is not
  claimed at that width.
- **GREEN:** all 18 grid cases and all 27 viewer Chromium tests pass, including
  large hierarchies at 732/747/920/390/1440px, independent state/catalog scrolling,
  image placement, no horizontal overflow, existing finalization/disconnection
  cases, presentation, frontend isolation and result attribution. Syntax, public
  types, formatting and `git diff --check` pass. No runtime or Rust behavior changed.
- **Actual Roots preview, read-only:** a separate test browser loads the existing
  installed candidate with 151 states and substitutes only the corrected CSS
  response for that browser. At 747×888 the original browser panel is 3,501px tall
  and image pixels start at y=1,663px. With source CSS the panel is 482px tall,
  pixels start at y=154px, and the sidebar is bounded to 888px. Checks also pass
  at 732/920/1280px. The 747px result was visually inspected; no preview request
  used a method other than GET. This is rendering evidence, not a new installed
  package or application business-flow acceptance.
- **Review:** an independent source and screenshot review found no additional
  layout defect. Both the original candidate dashboard and official alpha.7
  session, package bytes, shared application API and frontend remain untouched.
  Only the preview browser was started and closed.

Evidence is under ignored `artifacts/viewer-grid-tablet-20261106/`:
`baseline.tap`, `grid-green.log`, `viewer-final.log`, `source-checks.log`, and
`roots-preview-CFyPOx/receipt.json` with before/after screenshots. The fixture
baseline is `run-lKfDc0`. A new packaged candidate, installed acceptance,
integration with later main changes and publication remain separate.

## Live workspace grid candidate — 2026-11-06

**PASS — isolated source implementation and synthetic browser conformance.**
Implemented on `codex/viewer-flow-grid`, based on current main
`04de789c2c83aba1717a21d950ef7570495107a0`, preserving the older dirty primary
checkout and the separately managed official alpha.7 installation.

The viewer collapses session details, enlarges the controlled application,
keeps the active authored flow beside it and places controls/results in a bounded
desktop footer. The action catalog scrolls independently. Target/model warnings
remain visible when details are collapsed. Runtime snapshots expose only a
detached descriptor-owned `activeRun` identity, allowing a viewer to join a flow
started elsewhere without guessing its identity. Completed, current and upcoming
steps follow observed progress; missing progress stays unknown. Pending cleanup
is shown as finalization, and previous results retain their run attribution.

Disconnected observations remove current-state highlighting and label the image
as the last captured frame. Image failure is separate from driver connectivity;
status recovery re-establishes the read-only image stream before restoring a live
claim. No reconnect path replays application commands.

| Check | Actual result |
| --- | --- |
| Regression-first evidence | Five runtime assertions failed before `activeRun` existed. Seven browser assertions reproduced expanded metadata, below-fold controls, absent flow details and false live-image labels. Five additional assertions reproduced premature finalization/live-recovery claims and invented progress. |
| Source checks | PASS: JavaScript syntax, public TypeScript declarations and formatting; `git diff --check` |
| Node runtime | PASS: 168 tests, including the five new metadata/lifecycle cases |
| Rust | PASS: 26 tests, one existing ignored test; workspace build, formatting and Clippy with warnings denied |
| Viewer browser suite | PASS: 22 Chromium tests, including 13 grid/disconnection/finalization/mobile cases and existing presentation, frontend isolation, recipe paths and result-attribution checks |
| Independent application | PASS: eight real notebook browser/API groups, including save/readback, lost-response retry and no replay on reconnect |
| Other required browser groups | PASS: four motion, nine control-boundary, ten CLI and two manager-UI tests |
| Visual inspection | INSPECTED: 1440×900 and 1280×800 active-flow layouts, disconnected retained frame, and 390×844 stacked layout; app, controls and both result cards visible together on desktop; no sampled horizontal overflow |
| Independent source review | PASS: canonical-plan projection, finalization, stale image/state treatment, result attribution and responsive scrolling; no remaining blocking findings |

Logs, baseline failures, measured geometry and screenshots are under ignored
`artifacts/viewer-grid-20261106/`. The final viewer screenshot set is
`run-hMygQo`; final logs include `viewer-suite-final.log`,
`browser-acceptance-final.log`, `runtime-tests.log` and `source-checks.log`.
Initial Chromium/loopback sandbox failures were setup failures, and a superseded
image-injection timeout was replaced by a genuine post-load stream-failure
assertion; neither is counted as a failing product scenario. Only test-owned
fixtures, browsers and viewers were started and closed.

**NOT RUN / outside this candidate:** WBF or Roots business-flow acceptance,
installed-package acceptance, release publication, ordinary dependency promotion
and remote CI. This changes source only; official alpha.7 assets and the user's
live application sessions are unchanged. Separate pending finalization work must
retain its same-run, pending/stalled and stop-requested distinctions on integration.

## PR #23 private preparation integration — 2026-11-06

**PASS — local preparation checks; repository remains private.**
[PR #23](https://github.com/givtaj/daedlo/pull/23)'s original head
`292efdd20a58f39dea501dde43036bb0617f7d68` was reconciled in an isolated checkout
with merged main `b3d4e575dcb5f7b0c0b6261d16131e941ad9d1c6`. Textual conflicts
were limited to the plan and verification histories; both histories are retained.
The delta from main remains seven files: documentation, the repository audit and
its regressions. Alpha.7 and PR #22's implementation, dependencies, lockfiles,
entrypoints and workflow remain unchanged by #23. The original regression-first
record below remains the behavioral evidence; reconciliation added no behavior.

PR #22 is merged and all three required main jobs passed in
[run 42190090935](https://github.com/givtaj/daedlo/actions/runs/42190090935).
This supersedes the October 30 account-blocker observation; #23 still requires
its own exact-head PR and post-merge main checks. Their final identities and
results are tracked on #23 rather than predicted in this source checkpoint.

Measured with Node 22.20.0 and a fresh offline installation of the locked dependencies:

| Check | Actual result |
| --- | --- |
| Source syntax, public types and configured formatting | PASS, `npm run check` |
| Repository audit, public metadata and source-license regressions | PASS, 54/54; includes #22's CI-trigger policy check and #23's public-read/private-write checks |
| Current-tree public metadata, focused script/test formatting and diff whitespace | PASS |
| Local documentation links | PASS, 138 local references including 24 anchors across ten entry/launch documents; one existing pilot-checklist anchor corrected after a recorded failing check |
| Actual source-license validation | PASS, 379 tracked files; Apache-2.0 declarations and legacy/third-party notices |
| Independent audit-code review | PASS, no blocking finding |
| Live repository identity and visibility | PASS, exact ID/name/default branch; **private** |
| Live available Actions, workflow-token, private-fork and dependency-alert controls | PASS; default read-only audit, zero mutations |
| Live main protection | BLOCKED_BY_PLAN, HTTP 403 for protection and rulesets; no enforcement claim |
| Public contributor approval | UNAVAILABLE while private, HTTP 422; deferred to a separately authorized visibility switch |
| Primary checkout preservation before integration push | PASS, unchanged HEAD/index/status and all 306 tracked/untracked file contents and modes |

Initial PR [CI run 42193799744](https://github.com/givtaj/daedlo/actions/runs/42193799744)
failed the same real installed-archive assertion in both Node jobs: the shipped
`docs/rename.md` linked locally to source-only `public-launch.md`. The exact
failure was reproduced locally before changing that link to its explicit
upstream source URL. The existing archive inventory and assertions are unchanged;
all eight `tests/release-tools.test.mjs` checks then PASS, including offline
installation and real commands outside Git without Rust. Source-checkout links
and installed-archive links are distinct checks. The failed CI and local red
receipts are retained; the corrected head requires a fresh full hosted run.

The read-only audit exits 1 with aggregate `BLOCKED` because main protection is
unavailable under the current private plan. This is a declared settings limit,
not a test failure or permission to change settings. Public native security
features and anonymous access remain unverified. The repository stays private.

The October 30 full-history, 12-image and external exposure checks (32 release
assets, 120 newer Actions artifacts and 88 newer logs) were **not refreshed** by
this reconciliation. They retain their dates, selected-source scope and known
historical metadata limitation. Refresh them before any future public launch.
Hosted CI's pinned history secret scan is a separate, narrower check.

No new browser/Rust application behavior is introduced or reaccepted locally by
#23; the full hosted matrix remains required. Independent dependency upgrades,
viewer-grid candidate checks, running dashboards, Roots data and ordinary
installations remain owned by their other tasks. Customer acceptance in
[#25](https://github.com/givtaj/daedlo/issues/25) remains open. Raw audit responses,
private preservation receipts and build outputs are excluded from the commit.

## PR #22 reconciliation and exact-installed verification — 2026-11-06

**PASS — local integration and exact-installed conformance on macOS arm64.**
[PR #22](https://github.com/givtaj/daedlo/pull/22)'s authoritative head
`d4defb6e1e1f68853a06f4b62e8f01c7bc225886` was merged with main
`04de789c2c83aba1717a21d950ef7570495107a0`, producing clean package source
`0386f517c34c8fbdfa98f3df7e9d9332b1cc8019`. The two textual conflicts were in
plan/verification histories; both sides were preserved, newest delivery first.
The original regression-first records below remain the evidence for #22's
behavioral changes. Reconciliation required no additional runtime behavior fix.

The package contains #22's pending/stalled effect-evidence and run-cleanup
states, cooperative Stop, bounded close and retained dependency ownership,
while retaining alpha.7's truthful native observation and guarded recovery.
CI runs on unfiltered pull requests, main pushes and manual dispatch; topic
push duplication is removed without changing either Node job or its gates.

| Check | Actual result |
| --- | --- |
| Source quality | PASS: syntax/source, TypeScript declarations, formatting and public metadata |
| Shared runtime | PASS: 181 tests, zero failed/cancelled/skipped/todo |
| Release and alpha contracts | PASS: 538 tests, including native/Ninja recovery and installed-harness provenance contracts; zero failed/cancelled/skipped/todo |
| Repository safeguards | PASS: 36 metadata/guardrail checks, including CI trigger coverage |
| Rust | PASS: locked/offline workspace build, fmt, clippy with warnings denied and 26 tests; one subprocess helper intentionally ignored directly and exercised by its parent |
| Source browser | PASS: eight notebook groups; motion, controls, CLI, viewer, authorization/cleanup/finalization and Ninja UI; archive and published-configuration checks also pass |
| Clean engineering package | PASS: immutable runtime/crate bundle, complete tools archive and local kit built with dirty-source rejection |
| Exact installed safety | PASS: 112 assertions in 14 groups, public ESM consumer resolution, original/copied check digests, expected counts and zero skips; installed files remain unchanged |
| Exact installed native | PASS: startup TAP 1/1 with 13 assertions; observation TAP 2/2 with five recovery assertions; selected tools/runtime/engine paths and compiled-engine digest match |
| Exact installed references | PASS: starter 16 browser groups, evidence reference nine checks and managed reference eight checks, including real dependency installation/hooks |
| Presentation and ownership | PASS: inspected installed stalled/close-pending desktop/narrow screenshots and native failed/recovered observation screens; both installed consumers report cleanup PASS, attached application preservation checked |

Measured toolchains were Node 22.20.0, Rust 1.96.0 and Chromium 151.0.7922.34.
Independent runtime/ownership and installed-harness reviews found no blocking
regression in the reconciled source. Hosted current-head results and merge
identity belong to the PR's checks and merge record; local passes do not substitute
for those gates or customer acceptance.

Exact local artifact identities:

- Source tree SHA-256: `ecd0233ff9296511eb6b2cca1ce34babbe9f0d65d3d958f05a5551340d10119e`.
- Bundle manifest SHA-256: `713976233b4b920d842b378bfeb3b6616e5ff0638c8e49060ba20f62398251a0`.
- Runtime archive SHA-256: `9cb34711a6ad49d5d395f734ef1c1aaaabb3b5ce17cb59e9f54e3bb3cbec72c9`.
- Engine crate SHA-256: `3aac47987cedfffba49e98c4c5bf7a73d9e3c18f4ed4a93da5edff021c2ee312`.
- Tools archive SHA-256: `c0cf6fa9bf9850617f861250c6034e043db852d9de810a4124a48d28ebf281b7`.
- Local kit SHA-256: `fa4ea5ec6f109f4819c984fa07cdf1a4db34c63cf94c38d7b31a9d40fc559539`.

These unpublished engineering artifacts retain source version `0.1.4-alpha.7`;
they differ from the public alpha.7 bytes and do not replace that release.
The later record-only commit changes no executable or acceptance-harness bytes.
Private local receipts retain package inventories, browser images, process cleanup
and a launcher syntax failure that occurred before any package build or browser
execution; the corrected launcher produced the separate passing receipts above.

The preserved primary checkout, old recovery material and other tasks' worktrees,
installed versions and live sessions were not used as candidates. Source and
receipt preservation remains local; no off-host backup claim is made. Customer
acceptance remains open in [#25](https://github.com/givtaj/daedlo/issues/25), with
release publication, public visibility and everyday Roots promotion separate.
The primary preservation comparison retained unchanged HEAD, index, Git status
and 305 of 306 tracked/untracked file contents and modes. Its installation owner
concurrently added the separate durable-alpha.7 verification record to the remaining
file, `docs/verification.md`; that owner's update was left intact.

## Alpha.7 production delivery — 2026-11-05

**PASS — merged source, immutable publication and actual public HTTPS acceptance.**
[PR #24](https://github.com/givtaj/daedlo/pull/24) merged as
`e6e448ef7c7738efe1e3bd1a25d3945f1fc1c6de`; its tree exactly matches reviewed
publisher head `07e55169aed462655b3cb563c57bf84fb2cfc0b9`.
[Publisher CI](https://github.com/givtaj/daedlo/actions/runs/42040100747) passed
Node 22/24 source and packaged-consumer jobs plus metadata/secrets. The separately
frozen package source remains `9cbff73ad1b8d5e64b11c7358050eebc3cd1d392`, with the
three immutable byte identities recorded in the prepublication checkpoint below.
Published artifacts were built only from that frozen source; merge and
documentation commits do not replace them.

The [GitHub prerelease](https://github.com/givtaj/daedlo/releases/tag/v0.1.4-alpha.7)
is published, contains exactly those three files and points to the frozen package
source. Independent GitHub asset-body and canonical HTTPS download readbacks
match the frozen bytes. The repository remains private; customer installation
uses [daedlo.com/install](https://daedlo.com/install),
[managed-update guidance](https://daedlo.com/updates) and the public downloads.

[Production promotion](https://github.com/givtaj/daedlo/actions/runs/42042552705)
completed successfully from merged main. Independently verified signed generation
**26** expires `2026-11-12T14:11:51.462Z`; all prior signed entries remain unchanged.
The existing `daedlo-release-2026-10` publisher key remains pinned, PEM SHA-256
`df84f7d60ed2af949d394e338070ef66ab4debabf911ffd6c7b35bebe6ba4297`.

The subsequent [ordinary renewal](https://github.com/givtaj/daedlo/actions/runs/42044070917)
also passed from the same merged source without promotion flags. Independent
readback verified signed generation **27**, expiring `2026-11-12T14:21:17.077Z`,
with every alpha.2–alpha.7 release entry identical to generation 26 and the same
publisher key. The served installer and update pages matched their rendered
source and current signed catalog. Renewal changes catalog freshness, not the
immutable release bytes or the customer acceptance status.

Measured on the existing macOS arm64/Node 22.20.0/Rust 1.96.0 host with matching
Playwright Chromium, independently of customer applications:

| Production gate | Actual result |
| --- | --- |
| Signed HTTPS delivery | PASS: production trust/signature, unexpired increasing generation, all retained entries and exact current ZIP/metadata/checksums |
| Actual website | PASS: 36 canonical HTTPS checks, all 18 historical asset bodies unchanged, nine private/build paths return 404, cache/security headers and bounded same-origin HTML canonical redirects |
| Visible public onboarding | PASS: actual desktop 1280px/narrow 390px install/update/tools guidance and native clipboard; inspected screenshots, no browser script errors or external requests |
| Fresh production installer | PASS: actual DOM block matches downloaded ZIP `START_HERE`; offline installation with fresh npm cache in a nested workspace, ancestor manifest/lock unchanged, all 69 tools files exact |
| Alpha.6 → alpha.7 → alpha.6 | PASS: seven actual HTTPS checkpoints, separately verified tools bootstrap, accepted-slot discovery, real negative/save flow, fresh-manager restart, retained-slot rollback and relaunch |
| Preservation and cleanup | PASS: application states/flows/adapter source, both tools packages, configuration/store/trust/checkpoint and notebook data preserved; six lifecycle reports, owned resources closed and attached application preserved until owned fixture cleanup |

The upgrade drill used actual public downloads and the production provider with
the bundled trust pin. Only the initial alpha.6 fixture selection was explicit
and authenticated; subsequent discovery used normal provider selection. No
private signing key, injected fetch transport, customer fixture or application
dependency promotion was used. Notebook records remained in a separate in-memory
application process: this proves preservation across the tested driver/manager
changes, not database recovery or application-process restart durability.

The live website verifier retained two failed attempts caused by harness-only
assumptions before browser acceptance: the extensionless checksum response omits
Content-Type identically to alpha.6, and the publisher already permits bounded
same-origin `/install.html` and `/updates.html` canonical redirects. Final checks
follow that existing contract; download/key/feed redirects remain forbidden and
byte integrity, CSP, nosniff and cache checks remain enforced. These were not
native/browser regressions. The provider hostname was not tested by this canonical
website run.

Production-upgrade, live-website, publication and ordinary-renewal receipts remain
in ignored local evidence storage. Raw private fixture paths, browser records and
support conversation identifiers remain out of shared records.

Customer incident cause and recovery, frontend stop isolation, customer-managed
upgrade/rollback, detached-document faults and effect-status/report integration
remain **UNCONFIRMED** in [acceptance #25](https://github.com/givtaj/daedlo/issues/25).
A named-session picker is triage only. Publication and synthetic conformance do
not complete customer acceptance, hot-reload an existing owner or establish
host-sleep/hard-owner-loss durability.

## Alpha.7 frozen package and publication preflight — 2026-11-05

**PASS — historical prepublication checkpoint: exact package, compatibility, source
CI and staged website; delivery was pending.**
Frozen clean package source is `9cbff73ad1b8d5e64b11c7358050eebc3cd1d392`.
[Exact-source CI](https://github.com/givtaj/daedlo/actions/runs/42037389097)
passed both Node 22/24 jobs and public metadata/secrets. [PR #24](https://github.com/givtaj/daedlo/pull/24)
owns source integration and the separately reviewed production inventory.

The release was built once from this frozen source. The earlier `126fa9e`
engineering candidate remains unpublished; its runtime/crate bytes match, but
its source/tool receipt is not this delivery. No published historical file changed.

| Frozen file | Bytes | SHA-256 |
| --- | --- | --- |
| `daedlo-0.1.4-alpha.7.zip` | 311661 | `cb56901e85572c73dbbeb2c2566c97db31608fa15dd861704b674ef84ba1fd5e` |
| `release.json` | 8752 | `ec13bf2656751996b335805f3950ac29a97bbf6785d21a3a88fd283ee064ded0` |
| `SHA256SUMS` | 91 | `b3666e5be14f8542ceba3084086b0f6a57a0e4a266d58099bce158ff249b6c9f` |

The tools archive is SHA-256
`2acbd2cc1fa16e7cd30c3d63e085fab2cc00e3caeb3ae3cdf84130dd4f6e673a`;
bundle manifest is `0c4e98fe62235f29f09990e005c0a494a3d5ab36093548096922e1a07a954ba9`.

Measured on macOS arm64 with Node 22.20.0, Rust 1.96.0 and Playwright 1.62.1:

| Gate | Actual result |
| --- | --- |
| Exact installed runtime/tools/crate | PASS: 23 runtime files and 69 tools files verified before/after; eight notebook browser groups, CLI 10, finalization 25, controls nine, frontend and recipe-path viewers |
| Required installed native suites | PASS: startup TAP 1/1 with 13 lifecycle assertions; observation TAP 2/2 with five recovery checks; exact paths and engine digest bound, zero skipped tests |
| Merged runtime safety replay | PASS: 45 original assertions in six groups, authorization 23 / attribution two / cleanup 20; consumer public ESM resolution and import-only copies verified, no source product fallback |
| Shipped references | PASS: starter 16 browser groups, evidence nine, managed eight including real installation and disposable hooks |
| Immutable alpha.6 → alpha.7 → alpha.6 | PASS: seven ephemeral-signed-feed checkpoints, verified new-tools bootstrap, fresh-manager restart, rollback/relaunch, source/data/configuration/trust/checkpoint preservation and owned cleanup |
| Final-metadata website | PASS: 69 units, eight pages, seven archives, 44 public entries, 14 onboarding checks and two native-tools layouts; all 18 historical files verified and nine private/build boundaries returned 404 |
| Actual DOM-copied installer | PASS: offline tools install with a fresh npm cache in a nested workspace, ancestor manifests/lock preserved and all 69 installed tools files exact |
| Publisher safeguards | PASS: 221 precredential/catalog/checkpoint/promotion/renewal/staging checks; independent review confirms exact three new pins and unchanged prior policy |

Native failure/recovered screens and desktop/390px bootstrap guidance were visually
inspected. Browsers, servers and disposable consumers closed; attached-resource
assertions passed. The website uses an explicit ephemeral test pin and is never
the production deployment. Production trust rejects that test pin. Final staged
metadata is bound to the exact `ec13bf…ded0` file; unchanged ZIP and historical
assets were reverified after stamping the measured verification record.

A GitHub draft contains exactly the three frozen files. Their API digests match;
independent asset-body readback is a separate retained receipt. Production pins
add only alpha.7; removing those additions reproduces the prior policy exactly,
including publisher key, initial checkpoint, six historical inventories, contracts
and source pins. Publisher source CI, merge, public release/feed activation and
actual HTTPS install/update/rollback remain pending at this checkpoint. The
customer's live-session recovery and business acceptance remain unconfirmed.

Ignored evidence roots: `artifacts/alpha7-*` in the frozen checkout and
`artifacts/wbf-delivery/` in the integration checkout. Raw receipts and private
browser/consumer paths are not included in shared records.

## Alpha.7 release preparation — 2026-11-05

**PASS — preparation checkpoint; production delivery is recorded above.** Alpha.7 prepares
the reviewed native observation/recovery change plus coherent version fields and
selected-release instructions. Existing public alpha.6 bytes, publisher trust,
historical receipts and everyday customer dependencies are preserved.

The native installed-package dispatcher previously omitted the observation suite
and accepted a successful recovery receipt even if the separate startup-diagnostic
test was skipped. Regression-first checks now require the selected installed
tools/runtime/engine paths and binary digest, startup TAP 1/1 and observation TAP
2/2, with zero failed/cancelled/skipped/todo cases. Alpha.7 explicitly exercises
the shipped evidence and managed references; its upgrade drill requires the pinned
alpha.6 baseline and a separately verified new-tools bootstrap.

Measured preparation checks: 43 harness/reference contracts, 32 upgrade-mode
contracts and eight licensing/version contracts passed. A nondefault-path browser
probe passed both observation tests with selected runtime/engine path and digest
binding; it is a conformance copy, not an exact-installed artifact claim. Earlier
source-fix checks below retain their own revision and version. Exact package,
upgrade/rollback, current candidate CI, website and live publication results remain
pending at this checkpoint; the later production record above supplies actual
execution results without changing the frozen package.

Independent preparation review caught the starter model's exact engine pin outside
the nine-path version command. Its meaningful regression failed `9 !== 10` before
the command was extended to update all ten release-owned manifests/locks,
including the shipped starter. The starter pin and active guide now match alpha.7;
customer application pins remain outside the command.

## Native observation status and guarded recovery — 2026-11-05

**PASS — local source regressions, independent review and Chromium conformance.**
Work is isolated on `codex/wbf-observation-recovery`, based on shared main
`16d050c8b4965ecd7e2acd52bf8d052b911866c4`. The preserved primary checkout and
customer applications, installations, dependencies and live sessions were not
used as fixtures or edited. At this historical source-only checkpoint,
runtime/crate versions remained `0.1.4-alpha.6`; the release tools had local source
changes and were not a published replacement. The alpha.7 delivery above is a
separate frozen package and production-verification record.

Native status now separates failed observation and unreachable child communication
from stopped ownership. Unknown draft safety is reported as `draft_unknown`,
not as a confirmed dirty form. Reasons use static allowlisted categories, while
accepted ownership and completed reports remain retained. Transient page faults
no longer latch startup as failed. Fresh status reads restore readiness using
the same loaded adapter, without replaying commands or changing earlier effects.

Guarded cleanup still requires current known execution and draft facts. If
observation fails after the supervisor acquires its own pause, that gate remains
owned; a later explicit stop can drain it after fresh clean, idle proof. An
independent user pause remains blocking. Failed resume preserves gate ownership,
and actual cleanup exceptions remain `cleanup_incomplete`, never safe refusals.
See [the supported recovery procedure](native-setup.md#recover-observation-in-the-existing-owned-session)
and [the public synthetic reproduction contract](managed-integration.md#observation-and-interruption-reproduction).

Regression evidence was captured before the corresponding fixes:

- Both supervisor observation regressions failed with missing failed-observation
  status. The real-browser test, run with archived baseline tools from `16d050c`,
  reached an actual unrecognized page and failed: expected `observation_failed`,
  received `stopped`. Baseline fixture cleanup passed.
- An observation lost after pause incorrectly fulfilled quiesce; a failed
  unquiesce lost its owned gate (`false` instead of `true`). Both now pass.
- Review regressions exposed cleanup exceptions retaining `engine_timeout`
  instead of `cleanup_incomplete`, cleanup failure being misclassified as a safe
  refusal, and missing execution facts being reported `available`. Each now passes.
  Setup/import/permission failures were not counted as behavioral regressions.
- A browser assertion also caught a secondary unavailable-observation diagnostic
  hiding the original failed-startup reason. Failed startup now retains its
  primary sanitized reason; ordinary post-ready observation failures keep their
  observation diagnostic. Both browser assertions pass.

Measured on macOS arm64, Node 22.20.0, Rust 1.96.0, locked Playwright 1.62.1 and
Chromium 151.0.7922.34:

| Check | Result |
| --- | --- |
| Source syntax, strict declarations, formatting and diff whitespace | PASS |
| Runtime Node regressions | PASS, 163/163 |
| Native and Ninja regressions, serial | PASS, 318/318, including both real-browser native suites |
| Rust workspace tests, locked/offline | PASS, 26; one subprocess helper intentionally ignored directly and exercised by its parent |
| Release build, portable tools, public kit and evidence-guidance regressions | PASS, 56/56 |
| Independent review after corrections | PASS, no remaining actionable findings |
| Visible native failed/recovered screens | PASS, screenshots inspected |
| Owned fixture cleanup and attached application preservation | PASS |

The native/Ninja command was
`node --test --test-concurrency=1 tests/release-native-*.test.mjs tests/release-ninja-*.test.mjs`.
A prior concurrent run had one three-second fixture IPC timeout while packaging
checks also ran; no failing assertion was suppressed and no deadline or retry
was added. The complete final serial run passed all 318 tests. Other commands
were `npm run check`, `npm test`, `cargo test --locked --offline --workspace`,
and `node --test tests/release-tools.test.mjs tests/release-build.test.mjs tests/release-public-kit.test.mjs tests/release-evidence-guidance.test.mjs`.

The new browser fixture uses the unchanged notebook adapter, a same-origin
synthetic error page and its actual read-only Overview link. It proves retained
owner identity, disabled commands during failed page observation, refusal before
cleanup, fresh recovery in the same session, byte-identical prior archives and
zero application writes. Separate known-dirty, unknown-draft and synthetic
pending-journal controls each block shutdown until their own current measurement
is resolved. These are synthetic safety controls, not reproduction of a private
application journal, a real uncertain save or operating-system sleep. Child-status
timeout and retained orphan records are covered independently by supervisor tests.

Local evidence is ignored under `artifacts/wbf-observation/`,
`artifacts/alpha4-native/` and `artifacts/wbf-native-ninja-serial.tap`.
Actual customer incident cause, customer recovery/acceptance, hard-host-loss
durability, complete exact-installed candidate acceptance, Node 24/remote CI,
merge, publication and deployment were **NOT RUN** at this source checkpoint.
The published alpha.6 installation is unchanged, and replacing tools does not hot-reload an
already running customer adapter.
## PR #22 review and installed safety replay — 2026-10-30

**PASS — independent source review and local exact-installed engineering checks.**
Reviewed [PR #22](https://github.com/givtaj/daedlo/pull/22) at
`19f9caeca5aa6d50e45e6bd4cc9c9ebcdab65b50` against `16d050c8`. No blocking
runtime, ownership, public-type or CI-trigger finding remained. This is a local
review, not a submitted GitHub approval. Current PR metadata still shows it open
at that head; no review threads or submitted reviews were present. Hosted run
`40933635218` remains the old account-blocked result; no CI rerun was attempted.

The isolated checkout now uses local branch `codex/installed-package-safety`,
based directly on #22, with the earlier November planning sections preserved.
No merge, push, publication, version/dependency change or Roots promotion occurred.
The harness/test implementation and retained planning were frozen at clean source
`d8bc681b183e02943940099264f71a2a9bd94e71`. This later verification update changes
only planning/evidence; the tested executable source and harness remain identical.

### Regression and repair

Before repair, three meaningful harness assertions failed: required safety suites
were omitted, skipping a new suite could still leave acceptance passing, and public
package exports could resolve another runtime entry without detection. The new
`tests/release-installed-controls.test.mjs` records those requirements. Review
then exposed an ESM/require resolver mismatch in the initial patch; an explicit
conditional-exports assertion failed before switching to Node ESM resolution from
the actual consumer. A further omitted-resource-suite assertion failed before
adding failed-setup propagation coverage. These were harness assertion failures,
not reproduced browser defects. Original failing logs are retained privately at
`artifacts/installed-safety/{harness-before,esm-resolution-before,setup-coverage-before}.tap`.

The existing `runInstalledControls` now replays A1 authorization, both A2 result
attribution suites, A3 unit/Chromium cleanup, and #22 stalled hooks, CLI/nested
ownership, failed setup and finalization UI against the installed public package.
Behavioral assertions remain unchanged; only explicit import, fake-engine and
installed-CLI locations are substituted. Each source/copied file and substitution
is receipted. ESM resolution, installed entry/version/file digests and unchanged
installed bytes are checked. Every expected case must execute and pass, with zero
failed, skipped, cancelled or todo cases. Existing CI already invokes this harness
and includes the new release-contract test; no CI job body was removed or weakened.
Independent rereview confirmed both review findings were resolved.

### Measured checks and artifact boundary

Environment: macOS arm64, Node 22.20.0, Rust 1.96.0, Playwright 1.62.1;
installed native acceptance measured Chromium `151.0.7922.34`. This is a warm
machine with disposable integration directories, not a fresh-machine claim.

| Check | Actual result / private receipt under `artifacts/installed-safety/` |
| --- | --- |
| Source syntax, strict declarations and formatting | PASS, `source-check.log` |
| Focused source safety suites | PASS, 68 cases across authorization, attribution, cleanup, stalled/CLI/scoped finalization and resource setup; source TAP logs and `release-contracts.tap` |
| Acceptance/provenance contracts, including four new harness tests | PASS, 16; `release-contracts.tap` also contains the five source resource cases, 21 total |
| Locked/offline Rust build and tests | PASS, 26 tests; one subprocess helper intentionally ignored directly and exercised by its parent; `rust-tests.log` |
| Clean bundle, portable tools and local public-kit construction | PASS, `build.json`, `bundle/`, `tools/`, `kit/`; `allowDirty:false` |
| Exact installed safety replay | PASS, 112 cases in 14 groups: existing CLI/publication 44, A1 23, A2 2, A3 20, #22 finalization/ownership 23; `acceptance/installed-controls/results.json` |
| Exact installed independent fixture and viewer | PASS, eight notebook groups, frontend and recipe-path browser checks; `acceptance/results.json` |
| Exact installed native startup/ownership | PASS, 13 checks; measured 69 tools and 23 runtime files; owned cleanup PASS; `acceptance/results.json` |
| Exact shipped starter, managed reference and evidence | PASS, 16 starter browser groups, eight managed checks, nine evidence checks; owned cleanup PASS; `starter/` and `exact-installed.log` |
| Visible installed viewer inspection | PASS for reviewed desktop stalled effect-evidence and narrow pending-cleanup screenshots; `acceptance/installed-controls/finalization-viewer/` |
| Dirty primary preservation | PASS, same HEAD/index/status and all 306 tracked/untracked contents and modes; private preservation receipt |

The local artifacts retain source version `0.1.4-alpha.6` solely for engineering
tests. They are different bytes from public alpha.6, are not a replacement release
and must not be distributed under its public identity. Final pilot version selection,
current-head hosted CI and any release decision remain open. Recorded digests:

- Source inventory: `b36577030cdfb456dae12ea4d5fe580034cb813d4dca45231440604cc2c7fd00`.
- Manifest: `63720cb689b5815e93d8914c36a3717870f77709f4686f22f5ce647def6a8d35`.
- Runtime archive: `533765e8865c3b4aba8865a71de5a6edbebd5556e08c077b5baf2936cc5e05d7`.
- Shared crate: `e4376f2e8de86b88c3112e902f74457cb0a7d19b397258af9c8873b5d5b865fb`.
- Tools archive: `5cb4df47045ef9de3e65defc13c0aefd864bf27697bc05d739010c11f832244a`.
- Measured runtime build: `ceefb3994ce6773c18f45cf26d3bc12744af072822cb819504f2c680824cf0d6`.

Full local receipts retain compiled model/engine, package and actual browser
identities and per-group logs. They contain only disposable conformance fixtures,
not WBF source or business data. WBF site/flow permission, selected positive/negative
rehearsal and both participant sessions remain BLOCKED/NOT RUN. No customer acceptance,
new managed upgrade/rollback drill or complete package-release gate is established.

## November pilot current-state reconciliation — 2026-10-30

**PASS — read-only reconciliation and planning preparation, not product or user
acceptance.** The [first-week checklist](plan.md#november-17-pilot-checklist--prepared-2026-10-30)
owns the work queue. This section records the evidence boundary without replacing
the historical records below or any existing WBF acceptance ledger.

The monthly focus was checked against the owner's October 30 agreed review and
project/account/CI handoff records. Private page/chat references stay out of shared
artifacts; the repository PRs, runs and source paths below identify technical evidence.
Aidin nominated a QA teammate from WBF to review QA of WBF websites. No external
session, outreach, private application access or application fault scenario was
performed or inferred. Exact website/flow, environment, data permission and dates
remain unconfirmed. Existing WBF integration/model/records must be inspected and
reused where available; prior feedback does not prove installation or acceptance.

| Evidence boundary | Status | Actual October 30 observation / limitation |
| --- | --- | --- |
| Canonical source | PASS | GitHub `main` is `16d050c8b4965ecd7e2acd52bf8d052b911866c4`; tree `ea9b59c73d0106b27e3964e5329cfd9e5e9a70de`. #19/#20/#21 are merged, with merge commits `284d6d8`, `fa51fdf` and `16d050c8`. No new merge performed. |
| Historical combined CI | PASS, historical | [PR run 40882393846](https://github.com/givtaj/daedlo/actions/runs/40882393846) and [push run 40882385093](https://github.com/givtaj/daedlo/actions/runs/40882385093) still show success at `6a8f979829d1082474ef94d96c9494e9e028bc67`. Local Git confirms its tree equals current main. This is not a successful run on the main commit itself. |
| Current main CI | BLOCKED | [Run 40884518820](https://github.com/givtaj/daedlo/actions/runs/40884518820), attempt 1, is marked failure. All three current check annotations say the job was not started because of account payments/spending limits. These are unavailable test results, not exercised assertion failures. |
| #22 source/review | PASS for implementation identity; NOT RUN for formal review | [PR #22](https://github.com/givtaj/daedlo/pull/22) remains open, mergeable, at `19f9caeca5aa6d50e45e6bd4cc9c9ebcdab65b50`, based on current main; no submitted PR reviews. A bounded read-only source/harness review found no additional demonstrated runtime defect; this does not replace independent current-head review. |
| #22 hosted CI | BLOCKED | [Run 40933635218](https://github.com/givtaj/daedlo/actions/runs/40933635218) still shows all three jobs marked failure with no test steps. Current annotations confirm the same account gate prevented start. No rerun or billing change made. |
| Actions renewal | NOT RUN for renewed availability | The Oct 29 account review reported included compute renewal Nov 1 at 01:00 Europe/Madrid. This date is historical account evidence, not proof future jobs will start; recheck after that time. |
| #22 local checks | PASS, historical source only | PR body and its branch's dated verification record report 181 runtime tests, 55 browser TAP tests, 26 Rust tests, eight notebook groups and 63 owner/guard contracts, plus source/lint/metadata checks. No product checks rerun in this planning task; no installed-kit or WBF acceptance inferred. |
| Public installer | PASS for visible offered version only | Browser read of [Get started](https://daedlo.com/install) still offers `0.1.4-alpha.6` for macOS arm64/Codex and lists ZIP digest `536476e8a3f160d58b269873ffb6da55820e804357a95aa0f4358c9d5a515123`. No ZIP downloaded or bytes reverified here. [Alpha.6 record](alpha-release.md) identifies source `9f1210053c09ead91e0e71c3b3423c560a818ca1`, predating #19–#22. |
| Installed safety-suite replay (F2) | BLOCKED — confirmed static gap; replay NOT RUN | At reviewed #22, `tests/installed-controls-acceptance.mjs` copies older CLI/finalization/control suites; `tests/release-acceptance.mjs` adds frontend/recipe-paths browser checks. A1-specific, A2, A3 and new stalled-hook suites are not all replayed against installed bytes. `viewer-finalization-browser.mjs` directly imports source. No new runtime failure or failing executable assertion is claimed; the plan requires a regression before the proposed harness fix. |
| Source safety-suite registration | PASS — static inspection | CI explicitly runs A1/A3, and `viewer-presentation-browser.mjs` imports the finalization browser suite, reached by `test:viewer`. #22 retains all job bodies while restricting duplicate triggers. Static inspection does not establish hosted execution. |
| Candidate packaging/lifecycle (P) | NOT RUN | No candidate version chosen, bundle built, package installed, browser flow exercised or new UI presentation verified. Exact runtime/tools/crate/model/browser receipts and lifecycle rehearsals remain required. |
| WBF participant gate (U) | BLOCKED | Participant context nominated; availability, macOS arm64/Codex, website/flow/negative case, authorized disposable environment and first/repeat dates outstanding. Every unobserved participant result remains NOT RUN. |

The required pilot kit includes #19 control authorization, #20 run attribution,
#21 retryable viewer cleanup and #22 stalled finalization/ownership. A successful
future source run or immutable build alone does not complete the package gate.
Linux CI does not establish macOS package acceptance or a fresh-machine claim.

### Participant observations to retain in WBF's designated private record

This is a record schema, not a second WBF results ledger. Owner is the WBF QA
participant with Codex observing; every row depends on the confirmed scope and
technically verified package. Evidence/source is the actual session observation,
canonical reports and WBF's independent assertions. Fill the corresponding private
record after observation; share only a sanitized gate summary here.

| Observation | Status | Verification / finish condition |
| --- | --- | --- |
| First session and time to useful result | NOT RUN | Actual start/end and milestone times, time to independently verified flow after reload, exact installed environment/package combination. |
| Dependencies, permissions and assistance | NOT RUN | Every setup problem, agent/human intervention, changed instruction and confusion recorded with elapsed time and resolution/blocker. |
| Positive business result | NOT RUN | Correct execution/outcome and operation-specific independent persistence/readback after reload; unavailable proof remains uncertain. |
| Safe negative case | NOT RUN | Agreed rejection plus independent no-write assertion; no unagreed application fault injection. |
| Evidence and cleanup | NOT RUN | Participant finds/understands useful current-run report, distinguishes previous/pending evidence, reads durable archive and truncation; owned cleanup verified and attached resources preserved or incomplete handles retained. |
| Later-day repeat and handoff | NOT RUN | Actual later date, reconnect without replay, intended repeat, duplicate rules, retained prior evidence and another chat resuming from the handoff verified. |
| Usefulness/reuse and decision | NOT RUN | Participant's own trust/usefulness assessment and intended reuse; Aidin's week-one decision linked to observed results or exact unmet gates. |

Preparation used an isolated owned clone on `codex/november-week-one`, based on
the verified main commit, at
`/Users/aidin/.codex/worktrees/november-week-one/daedlo`. It does not share the
primary checkout's index. The primary remains at `7e3e48dd`, 82 commits behind
verified main, with its dirty work preserved. Existing worktrees and all Roots
installations/services/sessions were left alone. Current onboarding source uses
`skills/daedlo/SKILL.md`; the primary's `skills/browser-driver/SKILL.md` is older.
Both instruction versions were read; no old kit or customized skill was rewritten.

Planning validation: **PASS** for final public-metadata scan, whitespace, new local
link targets and preservation of every prior plan/verification section. An initial
metadata check rejected private chat links; those references were removed before
the passing scan. Independent plan review corrected unsupported WBF installation
assumptions and the rehearsal dependency. Primary preservation: **PASS**, same
HEAD, index, Git status and all 306 tracked/untracked file contents and modes.
No runtime, Rust, browser, installed-kit or participant tests were rerun.

## Open-source preparation — 2026-10-30

**Source preparation complete locally; public launch remains blocked.** Work is
based on shared main `16d050c8b4965ecd7e2acd52bf8d052b911866c4` in an isolated
checkout. The ordinary checkout remains on its preserved older source; its
evaluation-license draft is not the current release or public-core policy.

The public-launch guide now records the owner's **no-history-rewrite** decision,
current Apache-2.0 licensing and already published alpha.6. It removes the stale
requirement to finish a rewrite or release alpha.4 before opening source. The
naming guide records the completed primary-folder rename. Earlier dated launch
sections retain their original observations with an explicit supersession note.

The repository audit now supports read-only inspection of the same repository
after a public switch. Exact host, repository ID/name and default-branch checks
remain mandatory. Public audits verify effective main rules and
`all_external_contributors` approval, treat private-fork settings as inapplicable
and reject visibility drift. Explicit Actions writes remain private-only, checked
again before each exact allowlisted write. No new mutation endpoint was added.
Three genuine public-read regression assertions failed with `PRIVATE_REQUIRED`
before implementation; the original failure log is retained privately.
Independent review found no blocking defect.

Measured with Node 22.20.0 and the matching existing locked dependency
installation; no new dependency or lockfile changes:

| Check | Actual result |
| --- | --- |
| Source syntax, public types and configured formatting | PASS, `npm run check` |
| Repository audit, metadata and public-licensing regressions | PASS, 53/53 |
| Actual source-license validation | PASS, 373 tracked files; Apache-2.0 with complete legacy and third-party notices |
| Full refreshed Git-history secret scan | PASS, pinned Gitleaks 8.30.1, 95 commits; exact CI flags and two existing reviewed checksum exceptions unchanged |
| Focused historical privacy review | Same two historical private-chat references across ten old blob versions; no newly identified credential or transcript. Retained under the recorded no-rewrite decision |
| Tracked images | All 12 inspected: nine historical Roots fixture screenshots, two synthetic Architecture Studio screenshots and one architecture figure; no visible credentials or private conversation content found |
| External exposure review | PASS within the declared refresh: all 32 release assets match GitHub digests; 120 newer Actions artifacts and 88 newer workflow-log archives downloaded and screened without findings |
| Local documentation links, focused formatting and diff whitespace | PASS, 80 local targets across ten selected entry/launch documents; focused script/test formatting and diff whitespace clean |
| Ordinary checkout preservation | PASS, unchanged HEAD/status and all 306 tracked/untracked file contents and modes |

The external inventory was fully paginated: seven releases, 186 artifacts, 139
workflow runs, 18 PRs and 22 issue records (including PRs). No issue comments,
review comments or reviews were returned. All current issue/PR and release bodies
were screened. The refreshed Actions scope begins after the prior review cutoff,
23 October 2026 at 18:03 UTC; the 66 older artifacts and 51 older runs were not
rescanned and retain their earlier dated review scope. No selected download was
unavailable or expired. Safe recursive inspection covered 859 containers and
16,430 archive entries, with no unsafe paths, links, special files, encrypted
entries or oversized-member skips. The 1,210 unique decoded files and discussion
prose passed focused privacy/path screening and Gitleaks 8.30.1. No additional
media leaf required visual review. These are exposure checks, not execution or
customer acceptance of those historical artifacts.

The history scan covers the refreshed remote branches and tags available in this
checkout, not every GitHub-retained PR ref/cache. Source metadata, secret scanning,
image review and external-surface screening have different scopes; none is a
universal privacy guarantee. Raw matches, screenshots, API responses and audit
receipts stay outside tracked source.

Live read-only settings inspection verified repository `givtaj/daedlo`, stable
ID `1391092739`, default branch `main`, visibility **private**:

- **PASS:** GitHub-owned Actions only, full-SHA pinning, read-only workflow tokens,
  workflow PR approvals disabled, private-fork workflows/write tokens/secret
  sharing disabled, and dependency vulnerability alerts enabled.
- **BLOCKED_BY_PLAN:** main branch protection and rulesets both return the
  existing private-plan restriction. The prepared ruleset is not applied.
  Public-contributor workflow approval is unavailable while private (HTTP 422).
- **BLOCKED / no CI steps ran:** main [run 40884518820](https://github.com/givtaj/daedlo/actions/runs/40884518820)
  has three failed jobs. The GitHub check annotation explicitly says jobs were
  not started because account payments failed or the spending limit must be
  increased. This is not a failing test assertion. Passing local checks and prior
  alpha.6 release CI do not establish passing hosted CI on this source.
- **NOT ESTABLISHED:** public-repository native secret scanning, push protection
  and private vulnerability reporting. The API did not expose a current security
  feature configuration; the audit tool explicitly does not establish these.
  Inspect and read back supported controls during the separately approved switch.

The [launch checklist](public-launch.md#final-owner-decision-and-public-switch-sequence)
owns the final sequence. Hosted CI and public-only enforcement remain open;
**no launch-ready or public-access claim is made**. No visibility, ruleset,
billing, credentials, history, release, website or customer dependency was changed.
No new browser/Rust application behavior was introduced or reaccepted by this
repository-audit change. Existing release and customer evidence retains its scope.

Private evidence is retained in the isolated preparation directory, including
the pre-fix assertions, sanitized private-settings audit and separate exposure
receipts. No raw audit content or local preservation bundle belongs in Git.

## CI efficiency and stalled finalization — 2026-10-29

**PASS — isolated source, lifecycle and browser verification.** Work started from
merged main `16d050c8b4965ecd7e2acd52bf8d052b911866c4` in the separate
`codex/ci-stalled-hooks` worktree. The dirty primary checkout and everyday Roots
resources were not used as fixtures or edited. The released alpha.6 kit is unchanged.

Full CI now runs on pull requests, main pushes and manual dispatch. Permissions,
concurrency, Node 22/24 jobs and all check bodies remain unchanged. A genuine
trigger-policy assertion failed before the workflow edit; the existing repository
guardrails suite passed 16/16 afterward. Hosted event execution was not run.

The runtime and viewer distinguish pending effect evidence from pending run
cleanup. The default five-second threshold marks a hook stalled without finishing
its run. Stop/close supplies cooperative cancellation context, and a bounded
close wait rejects with `cleanup_incomplete` plus `cleanupPending:true` while
retaining the original work for retry. CLI and nested resource owners preserve
earlier browser/fixture dependencies. See the
[implemented contract](contracts.md#pending-finalization-and-bounded-close).

Regression-first evidence, retained under ignored `artifacts/ci-stalled-hooks/`:

- Runtime baseline: **7 failing assertions / 2 passes**. Missing phase/signal
  reporting and unbounded close were actual assertions, not setup failures.
- Viewer baseline: the real Chromium UI displayed Completed while current-run
  cleanup was pending; the expected Finalizing assertion failed.
- CLI baseline: **2 failing assertions** showed owned browser teardown while
  evidence or run cleanup remained pending. Additional adapter-close coverage
  verifies dependency retention when finalization itself is null.
- Outer-scope baseline: **3 failing assertions / 2 existing passes** exposed
  teardown through direct/nested ownership and a missing pending-error barrier.
  Review then found setup error wrapping dropped that barrier; a separate
  pending-setup assertion failed before its repair while settled cleanup passed.

Final measured checks on macOS arm64, Node 22.20.0, Rust 1.96.0 and locked
Playwright 1.62.1:

| Check | Result | Local receipt |
| --- | --- | --- |
| Source syntax, strict declarations and formatting | PASS | `runtime/source-final.log` |
| Runtime regressions, including CLI and nested ownership | PASS, 181/181 | `runtime/runtime-final.tap` |
| Full affected Chromium groups | PASS, 55 TAP tests including wrappers | `runtime/browser-final.tap` |
| Independent notebook acceptance | PASS, 8/8 groups; all four owned resources closed | `runtime/notebook.log`, `artifacts/notebook/results.json` |
| Rust workspace contracts | PASS, 26; one subprocess helper intentionally ignored directly and exercised by its parent | `runtime/rust-test.log` |
| Rust build, formatting and Clippy with warnings denied | PASS | `runtime/rust-build.log`, `runtime/rust-format.log`, `runtime/rust-clippy.log` |
| Native/managed owner contracts, repository guards and public-metadata regressions | PASS, 63/63 | `runtime/owner-contracts.tap` |
| Current-tree public metadata and diff whitespace | PASS | `runtime/public-metadata.log` |
| Dirty primary checkout preservation | PASS, same HEAD/status and all 306 tracked/untracked contents and modes | `preservation.json` |

Real-browser tests cover both finalization phases, stalled/Stop disclosure,
continued viewer polling after close expiry, absence of a completed report while
pending, rejection of overlapping commands, and late settlement followed by an
explicit successful close retry. Each case retains one real save and one hook
invocation. Attached browser/page resources survive session close and are closed
only by the owning test. Desktop and 390px screenshots were inspected; evidence
and cleanup receipts are under `viewer/` in the same ignored artifact directory.
CLI signal tests use the actual launcher/session/protocol/resource-scope code with
controlled browser/viewer boundaries; those tests are distinct from Chromium
acceptance. Independent reviews found and closed both ownership propagation gaps.

This does not establish customer application acceptance, installed-kit acceptance,
hosted CI or a new release. No package versions, dependency pins or lockfiles
changed. Ordinary observation/handler waits retain their previous semantics. A
hook that never settles keeps its run and owned dependencies pending; elapsed
waiting is never reported as cancellation, persistence proof or successful cleanup.

## Combined A1, A2 and A3 acceptance — 2026-10-29

**PASS — independently reviewed combined source and local conformance.**
[Control authorization #19](https://github.com/givtaj/daedlo/pull/19),
[result attribution #20](https://github.com/givtaj/daedlo/pull/20) and
[viewer cleanup #21](https://github.com/givtaj/daedlo/pull/21) were combined in
an isolated managed worktree from main `d32c5f0`. Tested source is `4662180`;
this verification-only follow-up changes no executable source. The three original
fixes remain `69061e7`, `a2a7eba` and `7353206`.

Three independent reviews found no blocking defect. A separate integration review
confirmed all 13 non-verification files from the fixes match their reviewed bytes,
and all three verification sections and the complete shared history are retained.
The only added implementation-support change registers the dedicated control and
cleanup browser suites in both Node 22/24 CI jobs. No dependency, lockfile or
customer entrypoint changes were made.

Measured on macOS arm64, Node 22.20.0, Rust 1.96.0 and locked Playwright 1.62.1:

| Check | Result |
| --- | --- |
| Source syntax, strict declarations and formatting | PASS |
| Runtime Node regressions, serial | PASS, 163/163 |
| Rust workspace tests, locked/offline | PASS, 26; one subprocess helper intentionally ignored directly and exercised by its parent |
| Rust build, formatting and Clippy with warnings denied | PASS |
| All existing browser groups plus new attribution, control and cleanup suites | PASS, 52 TAP tests (including the control suite's parent wrapper) |
| Independent notebook browser acceptance | PASS, all eight groups; owned cleanup PASS |
| Public metadata and diff whitespace | PASS |
| Primary checkout preservation | PASS, unchanged HEAD/status and all 306 tracked/untracked file contents and modes |

The browser command uses `node --test --test-concurrency=1` with motion,
control-boundary, cli-factory, viewer-presentation, viewer-frontend,
viewer-recipe-paths and viewer-cleanup browser files, plus
`tests/ninja-ui-browser.mjs` and `tests/control-authorization-acceptance.mjs`.
Attribution suites are imported by viewer-presentation. Desktop and 390px
screenshots were inspected for pending/current/previous-run attribution, full run
identities and separate cleanup/persistence disclosures. The new suites assert
owned-resource cleanup and attached-resource preservation.

Logs and screenshots are retained locally under `artifacts/combined-fixes/`.
The existing primary checkout, original fix worktrees and everyday Roots files,
services, sessions and dependencies were not used as test fixtures or edited.
These are source conformance results. Hosted final-commit CI and exact installed
checks are merge gates reported on the linked PRs; no new release, deployment or
customer acceptance is established by this local record. The released alpha.6 kit
remains unchanged. Unsettled-hook deadlines remain separate work.

## A3 viewer capture cleanup failure and retry — 2026-10-28

**PASS — local source regression and Chromium lifecycle conformance.** This fix
uses isolated branch `codex/viewer-cleanup-a3`, based on
`d32c5f0091827c96a7a82e09799c0d5b89dc759b`. The preserved dirty primary checkout
and everyday Roots resources were not modified. No release, merge, deployment or
customer dependency promotion is claimed.

Viewer close now tears down HTTP even when capture cleanup fails, rejects with
safe `cleanup_incomplete` errors while ownership remains unresolved, and retries
only unfinished cleanup on a later close. Confirmed page/CDP closure or successful
detach resolves capture ownership. Acknowledgement failure alone does not.
Playwright 1.62.1's actual CDP `close` event is handled alongside the existing
`Disconnected` seam. Background failures are disclosed in `/status.cleanupError`.
Failed startup with incomplete cleanup exposes a sanitized error with a `close()`
retry handle; see [the additive contract](contracts.md#viewer-capture-cleanup-and-startup-retry--a3).
Attached browser, context, page, application and session remain preserved.

Regression evidence was recorded before each correction:

- The original source produced **7 genuine failing assertions / 1 pass** in the
  synthetic suite, including fulfilled close where rejection was required and
  missing retry authority after startup failure.
- Corrected real-Chromium baseline probes produced **5 genuine failures / 2
  passes**. A separate actual CDP-detach probe failed because the original viewer
  still reported connected. The baseline server/assets came directly from the
  selected Git commit, avoiding concurrent implementation changes.
- The first implementation failed an explicit no-rejection assertion for the
  real CDP close event. Independent review then found a cleanup-settlement race;
  a deterministic microtask test failed because a confirmed-disposed session
  retained its failure diagnostic. Both failures were recorded before repair.
- The initial Chromium test instrumentation incorrectly expected `Disconnected`
  from Playwright; its log is retained but is not counted as product evidence.
  The corrected event assertion uses the pinned dependency's public `close` event.

Final measurements on macOS arm64, Node 22.20.0, Rust 1.96.0 and existing pinned
Playwright 1.62.1 / Chromium revision 1234:

| Check | Actual result | Local ignored receipt |
| --- | --- | --- |
| Dedicated cleanup synthetic and real-Chromium regressions | PASS, 12 + 8 | `cleanup-final.log` |
| Entire runtime unit/contract suite, serial | PASS, 150/150 | `runtime-final.log` |
| Rust workspace, locked/offline compact build | PASS, 26; one subprocess helper intentionally ignored by the direct runner and exercised by its parent | `rust.log` |
| Independent notebook Chromium acceptance | PASS, 8/8; all four owned resources closed | `notebook.log`, `notebook/results.json` |
| Existing motion, controls, CLI, viewer presentation/frontend/recipe and Ninja UI browser groups | PASS, 32/32 | `browser-groups.log` |
| Source syntax, declarations, formatting and public metadata | PASS | `check-final.log`, `public-metadata.log` |

All receipts are under `artifacts/viewer-cleanup-a3/`. Dedicated probes verify
HTTP refusal and stream closure after failed cleanup, actual CDP disposal after
recovery, successful-step preservation, concurrent closes, page/browser/CDP loss,
late closure during cleanup, startup screenshot/start/bind failures, recursive
error sanitization and retained resource-scope ownership. Every probe releases
its owned resources, including baseline failures. The notebook monitor screenshot
was inspected: controlled-page stream and command controls render legibly. This
change does not redesign the viewer or fix the separate result-attribution issue.

Run the dedicated regressions explicitly (the existing `test:viewer` script's
file list is unchanged):

```sh
node --test packages/runtime/tests/viewer-cleanup.test.mjs packages/runtime/tests/viewer-cleanup-browser.mjs
```

The task-owned compact build and dependency symlink were removed after checks;
logs, source baselines and screenshots remain. Dependencies/lockfiles, entrypoints,
shared session code and viewer UI files were unchanged. Independent lifecycle
review found no remaining blocking issue after the settlement correction.
These are source and disposable conformance checks, not Roots acceptance or an
installed release check. No browser leak in production was established. A CDP
operation that never settles has no new deadline; stalled-hook policy remains
separate work. Remote CI and Linux/Windows checks were not run.

## A2 viewer result attribution — 2026-10-28

**PASS — isolated source fix and Chromium conformance.** Starting source:
`d32c5f0091827c96a7a82e09799c0d5b89dc759b`, in a dedicated managed worktree.
The preserved primary checkout was not used as implementation source or edited
by this task. Environment: macOS arm64, Node `v22.20.0`, Playwright `1.62.1`,
Cargo `1.96.0`; locked Node dependencies installed locally with `npm ci --offline`.

Two genuine pre-fix browser assertions failed: the report-presentation fixture
found no pending outcome for active run B (`0 !== 1`), and the real-session
fixture found its pending row invisible (`false !== true`) after a guarded save A.
The original failures are retained in `artifacts/result-attribution/before.log`
and `session-before.log`. These are application/viewer assertions, not setup
failures. Their initial filenames ended in `.test.mjs`; the final dedicated
`viewer-result-*-browser.mjs` tests are registered by the existing presentation
browser suite so the ordinary runtime tests still need no Chromium.

The viewer now separates the active run's pending outcome from the retained
result, labeling each with its own full run identity. Retained results show their
completion timestamp; missing identity/time is explicit. A matching result still
undergoing `endRun` remains pending until finalization. Result rendering uses one
canonical snapshot instead of painting asynchronous command responses over it.
No session/report history, effect interpretation or runtime contract changed.

| Check | Measured result | Local evidence under `artifacts/result-attribution/` |
| --- | --- | --- |
| Source syntax, public TypeScript declarations, formatting | PASS | `check-final.log` |
| Runtime Node suite, serial | PASS, 138/138 | `runtime-final.log` |
| Rust workspace tests, locked/offline compact build | PASS, 26 tests; one subprocess fixture intentionally ignored by the direct runner and exercised by its parent | `rust-tests.log`, `rust-build.log` |
| Existing viewer suite plus two new attribution regressions | PASS, 9/9 | `viewer-final.log`, `browser/`, `session/` |
| Independent notebook Chromium acceptance | PASS, 8/8 groups | `notebook.log`, `notebook/results.json` |
| Chromium motion / control boundaries / CLI / Ninja UI | PASS, 4/4, 9/9, 10/10, 2/2 | `motion.log`, `controls.log`, `cli.log`, `ninja-ui.log` |
| Public metadata and diff whitespace | PASS | `public-metadata.log`; `git diff --check` |

The dedicated browser fixtures cover success A → running B → success, rejected,
failed and stopped B; ordinary polling/reload; active, paused and stopped
presentation display; missing identity/time; unknown/validation outcomes;
missing persistence evidence; mixed saved/uncertain/not-attempted operations;
and cleanup-incomplete disclosure. The real-session fixture additionally proves
guarded Chromium writes, the matching-result finalization interval, retained
failed-cleanup ownership, no replay on refresh, and unchanged detached A reports
after B finishes. A paused but finished direct action retains its completed result.

Desktop (1440×1000) and narrow (390×844) screenshots were inspected, including
presentation and cleanup states. Full actual session UUIDs fit at narrow width;
DOM text and glyph bounds and zero horizontal overflow are asserted. No page
errors occurred in the attribution fixtures. All owned fixture viewers, sessions,
browsers and servers closed; attached controlled pages survived viewer close.
The deliberately failed transient cleanup was retained until explicit session
close, which cleared it. The notebook receipt records all four owned resources
closed. Logs and screenshots remain ignored; only this task's compact 70 MB Cargo
target was removed after validation.

Reproduce the compact build with `CARGO_BUILD_JOBS=1 CARGO_INCREMENTAL=0
CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
CARGO_TARGET_DIR=artifacts/result-attribution/target` and
`cargo test --workspace --locked --offline`, then `cargo build --workspace
--locked --offline` with the same environment. Notebook acceptance selects
`BROWSER_DRIVER_ACCEPTANCE_ENGINE=artifacts/result-attribution/target/debug/notebook-engine`
and `BROWSER_DRIVER_ACCEPTANCE_OUTPUT=artifacts/result-attribution/notebook`.
The viewer checks run through `npm run test:viewer`.

**Limits:** synthetic viewer and independent notebook conformance, not Roots or
other customer acceptance. No release package, remote CI, deployment, product
publication, ordinary Roots promotion or cross-platform UI acceptance was run.
The public alpha.6 release remains a separate immutable artifact.

## A1 final authorization control dispatch — 2026-10-28

**PASS — isolated source fix and conformance.** Selected base:
`d32c5f0091827c96a7a82e09799c0d5b89dc759b`, branch
`codex/control-authorization`. The preserved primary checkout was not edited.
The defect was reproduced on this selected source before changing the runtime;
no conclusion about exact published package bytes is inferred.

The final guarded-effect dispatch now checks Stop synchronously after awaited
observation/engine authorization. Pause invalidates that authorization even if
Resume arrives before its response: the runtime waits as needed and obtains a
fresh authorization against the expected revision/session. There is no await
between the final control decision and effect invocation. This does not replay
an effect or cancel a write already dispatched; independent saved/stopped evidence
remains intact. No protocol, dependency, lockfile or public API change was needed.

- **Before repair:** 12 Node assertions and eight Chromium scenarios genuinely
  failed with one effect/write where zero was required. The already-dispatched
  saved/stopped control passed in both suites. Setup failures were not counted.
- **After repair:** all **13/13** dedicated Node regressions and **9/9** dedicated
  Chromium scenarios pass (the browser TAP count is 10 including its parent).
  Coverage includes Stop/Close during final observation and engine response,
  paused dispatch, changed draft/session on Resume, Pause/Resume before a pending
  response returns, and preservation of one already-dispatched saved write.
- **Broader checks:** runtime **151/151** (including the 13 new regressions);
  existing motion, control, CLI, viewer and Ninja UI Chromium tests **32/32**;
  notebook Chromium **8/8**; Rust workspace **26 passed**, plus one intentionally
  ignored child-process fixture invoked by its parent. `npm run check`, Rust
  formatting and Clippy with warnings denied pass. Independent code review found
  no blocking issue.

Reproduction commands: `node --test packages/runtime/tests/control-authorization.test.mjs`
and `node --test tests/control-authorization-acceptance.mjs`. Full runtime used
`node --test --test-concurrency=1 packages/runtime/tests/*.test.mjs`. Browser
acceptance used the freshly built notebook engine through
`BROWSER_DRIVER_ACCEPTANCE_ENGINE`; compact Rust builds used one job, incremental
compilation disabled, dev/test debug info disabled and
`CARGO_TARGET_DIR=artifacts/a1-control-authorization/compact-target`.
Environment: macOS arm64, Node 22.20.0, Rust 1.96.0, locked Playwright 1.62.1;
dependencies were installed offline from the unchanged lockfile.

Logs and the local handoff are in ignored `artifacts/a1-control-authorization/`,
including `node-before.log`, `node-after.log`, `browser/pristine.log`,
`browser/fixed.log`, `runtime-tests.log`, `existing-browser-tests.log`,
`rust-tests.log` and `notebook/results.json`. Owned engine processes, browsers,
contexts and HTTP fixtures closed; attached pages survived driver close. Notebook
cleanup confirms all four owned resources closed. Only this task's compact build
output was removed after verification; evidence and the reviewable worktree remain.

These are shared-core conformance checks, not Roots/customer acceptance or a new
presentation assessment. Stalled-hook/finalization redesign (A4), exact installed
package acceptance, remote CI, release, deployment and everyday Roots promotion
were not performed. Existing Roots services, data, sessions, pins and binaries
were not used or changed.

## Renewal diagnostics merged and production-verified — 2026-10-28

**PASS — merge, signed renewal and live verification.**
[PR #18](https://github.com/givtaj/daedlo/pull/18) merged as
`bc99a27133e4f9cc5e6e366007048ee3386020b7`. Its Git tree matches reviewed
`f46bf4f1c848d4c1217ec68999a59cf747192dda`. Both
[branch CI](https://github.com/givtaj/daedlo/actions/runs/40712467992) and
[PR CI](https://github.com/givtaj/daedlo/actions/runs/40712580550) pass Node 22/24
source, Rust, browser, packaging, exact-installed/native/starter and public
metadata/secrets checks.

The ordinary [production renewal](https://github.com/givtaj/daedlo/actions/runs/40714913288)
ran from the merge commit with all release-promotion options false. Every gate
passed: restored authenticated generation 18, prepared and persisted generation 19,
validated the staged website, activated the exact existing-worker version, checked
39 live public assets and nine private-path boundaries, and removed the temporary
signing key.
Worker version `ca5bd1a0-8ca9-43ad-96ac-faf55fbf9a31` was verified active at 100%
in deployment `9217b0fc-9c51-41a8-aaa5-b1781fa1aceb`.

Independent HTTPS checks before and after renewal authenticated both catalogs with
the unchanged pinned public key. Generation advanced exactly **18 → 19**, and all
five alpha.2–alpha.6 release entries remained identical. Generation 19 expires
`2026-11-04T15:21:09.458Z`; its signed-payload SHA-256 is
`ab326aaa0398cdd09e770ebc7df71b13391aa1aa9631c4ff9f837b448b108a70`.
The retained signed checkpoint is workflow artifact `12826119975`.
Private local readback receipts are
`artifacts/release-network-diagnostics/production-{before,after}.json`.

This closes deployment verification for the diagnostics change below. It does not
identify the historical network failure's cause or inject a production fault.
No release kit was rebuilt or republished. The customer-run checklist is merged
in source for future tools distributions; the published alpha.6 kit is unchanged.
External customer execution and support correspondence remain separate; no WBF
application access, installation or new support message was performed.

## Renewal diagnostics and external customer acceptance guidance — 2026-10-28

**PASS — local regression, release safeguards and source quality.** The renewal
transport now replaces connection/header and response-body exceptions with a
bounded diagnostic: prepare/verify/live stage, reviewed request path, headers/body
phase and a closed failure category (DNS, connection, TLS, timeout, abort or
unclassified network). Raw messages, causes, peer addresses and query values are
not included. Existing HTTP-status checks, deadlines, reader cleanup, immutable
asset checks and checkpoint rules remain unchanged; no automatic retry was added.

- Five genuine failing regression tests were recorded before implementation;
  the final renewal suite passes **40/40**. It exercises the three public renewal
  entrypoints, canonical redirects, private-boundary checks, body failures,
  category/redaction behavior, one request per failure, cleanup and preserved
  prepared checkpoints.
- Renewal/checkpoint/publisher/promotion safeguards pass **148/148**. Additional
  catalog and portable-tools packaging checks pass. Source syntax, strict types,
  formatting, public-metadata and diff-whitespace checks pass. Independent review
  found no actionable defect.
- Website unit checks pass **68/68** against the retained verified alpha.6 staged
  website. The initial broader run had three missing-generated-input errors in
  the fresh checkout (historical downloads and rendered installation page); those
  were setup failures, not behavioral regressions. Selecting the documented staged
  website resolved them without changing assertions or website assets.
- The [customer-run checklist](managed-integration.md#customer-run-acceptance) and
  sanitized result template have valid local links and describe the existing
  managed/session/evidence contracts. This is documentation verification, not
  execution against an external customer's application.

Private local regression receipts are under
`artifacts/release-network-diagnostics/{red-confirmed.tap,green.tap,related-green.tap}`.
The earlier exploratory `red.tap` also contains a corrected fixture setup failure;
only `red-confirmed.tap` is the five-test behavioral baseline.

**NOT RUN:** deployment of this diagnostics change, a new kit release, and customer
application acceptance. No runtime, Rust, browser UI or application behavior changed,
so no new browser/Rust acceptance is claimed. WBF owns its private application and
runs its registration, business, frontend-isolation, navigation-fault and managed
update/rollback checks; upstream conformance and support guidance do not close those
gates. No customer source access, installation or support message was performed.
The original production failure below remains unexplained; this change improves
future diagnostics and does not retroactively identify its cause.

## Alpha.6 released and production-verified — 2026-10-28

**PASS — immutable package, signed publication and production acceptance.** Shared recipe paths merged in
[PR #16](https://github.com/givtaj/daedlo/pull/16) as
`a6c81e2a4509a13fdd8a4dcc93656deb4a016a7a`. The reviewed source head
`6fc9e7f963bf514ae7b24f0998128f51d310f9b1` passed Node 22/24 and metadata/secrets
in [CI 40346816956](https://github.com/givtaj/daedlo/actions/runs/40346816956).
The final package source is `9f1210053c09ead91e0e71c3b3423c560a818ca1`;
[exact-source CI 40681953847](https://github.com/givtaj/daedlo/actions/runs/40681953847)
passes Node 22/24 and metadata/secrets. Earlier local-only packages below are
historical; their identities are not this release.

| Exact artifact | SHA-256 |
| --- | --- |
| Clean source tree | `237b0ed3b190f7a5d04ca7c3980b3c8f7761969128f300ae2fddf58f287870dc` |
| Bundle manifest | `0358c37c9e70e0c09e6bb720ef339d7dee51e3d6e6a2a669fd218a5cbb9aa59c` |
| Tools archive | `a3cb7707abd90cc14206382ea37e987d2b68324b53d6c12986e02985623aae55` |
| ZIP (301268 bytes) | `536476e8a3f160d58b269873ffb6da55820e804357a95aa0f4358c9d5a515123` |
| External verification metadata (8082 bytes) | `e5ba120148d22474aa457582b48754ec635f532dffea52e23bc1f65c52c991c2` |
| SHA256SUMS (91 bytes) | `f022fed5fe80291893dc0dadf9908bbe37bdd74a24a45fcb6bf856d3816b2838` |

- PASS: exact 23 runtime files and 69 tools files; eight notebook browser groups,
  ten CLI cases, 25 finalization cases, nine control cases, frontend viewer,
  four shared-path browser cases and 13 native startup checks.
- PASS: exact shipped starter 16, evidence reference nine and managed reference
  eight; independent installation and hooks. All owned cleanup passed.
- PASS: seven actual local alpha.5 → alpha.6 → alpha.5 checkpoints, using unchanged
  published alpha.5 tools throughout. Fresh-manager restart, rollback/relaunch,
  source/configuration/trust/checkpoint/data preservation and cleanup passed.
- PASS: website 68, onboarding browser 14 and layout four; browser-copied offline
  installer preserved nine surrounding entries. Desktop/narrow and lifecycle
  screenshots inspected. Final metadata restaging preserved all ZIP/static bytes.
- PASS: 207 publisher safeguards after eight genuine new failing regressions;
  two independent reviews found no blocking logic or pin defects. All 15 historical
  files, trust and checkpoint identities remain unchanged.

[PR #17](https://github.com/givtaj/daedlo/pull/17) merged the release and immutable
publisher extension as `ec25d484a7052e3acf9225313f2d8cc3c0658673`. Its tree matches
reviewed head `4cbf5ba9d3ea11a90668b34a2139a98b1930f1d8`, with Node 22/24 and
metadata/secrets PASS in
[publisher CI 40683528474](https://github.com/givtaj/daedlo/actions/runs/40683528474).

| Production gate | Observed result |
| --- | --- |
| Immutable GitHub release | PASS: published prerelease/tag targets exact source `9f121005`; all three downloaded assets match the final pins |
| Signed promotion | PASS: generation 15 → 16, checkpoint persisted before deployment; active Worker identity, all public files and security policies verified |
| Existing tools update | PASS: seven actual HTTPS alpha.5 → alpha.6 → alpha.5 checkpoints using unchanged published alpha.5 tools; fresh-manager restart, rollback/relaunch and preservation passed |
| Website and copied installer | PASS: eight actual HTTPS/browser/installer checks; eight desktop/narrow screenshots inspected; nine surrounding workspace entries preserved |
| Ordinary renewal | PASS after documented recovery: generation 17 → 18, retained checkpoint restored from the failed attempt, unchanged release entries, 39 public assets and nine private boundaries verified |
| Owned resource cleanup | PASS: three managers, acceptance browser and notebook app closed; website browser closed and disposable installer fixture removed |
| Authorized support follow-up | PASS: existing-thread reply sent after publication and final renewal verification; SENT label, reply threading, body and actual sender headers read back; correspondence remains private |
| Customer integration | NOT RUN: WBF registration, business flows, customer upgrade/rollback and complete fault coverage remain application-owned |

[Promotion 40685647198](https://github.com/givtaj/daedlo/actions/runs/40685647198)
restored generation 15 and persisted generation 16 before any deployment mutation.
Catalog SHA-256 is `db0e70a17477d7742b95afebb6ef959cb1422374bb151011b85cddefac6d87c2`;
signed payload SHA-256 is `b71f8e00411eab0f82d6eccdb9e45ba6529a2a596bfc86faa6cd7d9974f9c191`.
Worker `daedlo` version `8e7fa53a-2e59-4671-9b81-6dd7684b349a` was verified active
at 100% in deployment `0493d688-c86a-4717-b5e7-aa2fc14c7c3b`. Temporary signing-key
cleanup passed. Alpha.2–alpha.6 downloads and the existing publisher trust remain.

The production lifecycle recorded four real catalog requests and all three asset
URLs for both alpha.5 and alpha.6. Its 69 alpha.5 tools files remained unchanged;
six lifecycle reports and 25 completed-run reports were retained. Source snapshots
were identical; config/trust/checkpoint and synthetic data assertions passed.
Candidate, fresh-manager restart and rollback screenshots were inspected.

[Ordinary renewal 40686278587](https://github.com/givtaj/daedlo/actions/runs/40686278587)
issued and deployed generation 17 but **FAILED** its final live check with
`fetch failed`. The logs do not identify the request or underlying network cause.
Its checkpoint was preserved. Separate read-only recovery verified that the live
catalog exactly matched that checkpoint, the reconstructed 42-file site manifest
matched the workflow's original manifest, and the unchanged live verifier passed
all 39 public assets and nine private boundaries. A fresh website/installer check
also passed; its eight screenshots matched the inspected generation 16 images.
No retry, policy weakening, signing-key change or checkpoint reset was added.

The documented fresh-dispatch recovery,
[renewal 40687124952](https://github.com/givtaj/daedlo/actions/runs/40687124952),
**PASSED** every gate. It restored the failed attempt's authenticated generation
17 checkpoint and advanced to 18 with identical release entries. Current catalog
SHA-256 is `d169be29d532ce2648169a9d3912efefbc7fa6f505deb235e83cf7b8068fc393`;
payload SHA-256 is `f7e1fd208064284a9362ac2c75308f638205cc09af508c85d8d17b9ff3ae08eb`.
Worker version `caff0d2c-cac1-49f9-a81c-900181c4e260` was verified at 100% in
deployment `ce82bd36-7257-480a-b332-e8f6a1b060a8`; all live assets, security checks
and temporary-key cleanup passed. This does not relabel the earlier failed run.
The authorized WBF reply was sent afterward with update/rollback instructions
and the remaining application acceptance scope; actual SENT headers and body were
verified in the original conversation. No WBF installation was accessed or promoted.

Release-harness regressions were reproduced before implementation: alpha.6
production mode was rejected (seven new failures), and both installed reference
runners were skipped (seven failing assertions, including missing failure
propagation). The bounded alpha.5-to-alpha.6 mode now passes all 23 mode tests;
the reference dispatch and existing inventory checks pass 14 tests. The runtime
suite passes 138 tests. The first source candidate `da198c6` failed CI because its
licensing test still expected alpha.5. The strict expectation was corrected,
the kit was rebuilt from clean `9f121005`, and every installed/lifecycle/website
check above was rerun against the replacement bytes. The failed attempt and its
local receipts remain private under `artifacts/alpha6-final`; it was not published.

Current ignored evidence is under `artifacts/alpha6-accepted`, including source CI,
installed runtime/starter receipts, `local-upgrade/run-oogP9b/result.json`, final
public identities, publisher checks, `production-promotion-receipt.json` and
`production-upgrade/run-5ZRQAz/result.json`. Recovery evidence includes both renewal
workflow logs/checkpoints and `recovery-iOPKNN/recovery-result.json`. Website receipts are
`artifacts/alpha6-website/accepted-fsNUoO/receipt.json` and
`artifacts/alpha6-website/metadata-XobHrM/receipt.json`; actual production evidence
is `artifacts/alpha6-website/live-qvKLFk/receipt.json`, with generation 17 recovery
under `artifacts/alpha6-website/live-DcZZaV/`. Local signed-feed checks
use an ephemeral key and independent in-memory notebook; they do not prove live
delivery. Actual HTTPS acceptance above separately establishes delivery; neither
fixture establishes customer business flows or application-process restart durability.

## Shared recipe paths — local candidate, 2026-10-26

**PASS — local source, installed-candidate and Ninja lifecycle checks. Not published.** The viewer
now groups recipes by identical authored starting command IDs and JSON parameters,
shows their shared prefix and offers complete ordered step previews. Groups start
expanded; individual recipe buttons, reasons, revisions and dispatch payloads are
preserved. Expansion is read-only. Each run executes its full canonical recipe;
the display never infers satisfied prerequisites or skips shared steps.

No Rust model/schema, protocol, public API, session executor, dependency or lockfile
changed. Legacy descriptors require no new fields. Viewer DOM ancestry and visual
grouping change; undocumented direct-child or ordering selectors are not a public
compatibility contract. Published alpha.5 artifacts and ordinary customer pins
remain unchanged.

| Gate | Actual result |
| --- | --- |
| Regression before implementation | PASS: helper no-group baseline failed `2 !== 1`; browser showed zero shared groups where one was required; new asset returned HTTP 404 instead of 200. Setup failures were excluded from these behavioral failures. |
| Runtime suite | PASS: 138 tests, including seven prefix-comparison cases and ten viewer HTTP cases |
| Source browser | PASS: four shared-path cases plus three existing presentation/frontend cases; independent availability, exact once-only dispatch, pending double-click, reconnect, singleton/empty models and private-parameter omission |
| Layout inspection | PASS: actual desktop/narrow panel captures inspected; full sequences remain visible; disclosure survives status polling |
| Installed candidate | PASS: exact 23-file npm installation and customer engine compiled against the candidate crate; eight notebook browser groups, ten CLI cases, 25 finalization cases, nine control-boundary cases, frontend identity and four new shared-path browser cases |
| Existing browser flows | PASS: notebook eight, motion four, controls nine, CLI ten and Ninja UI two |
| Ninja compatibility | PASS: 240 contract/mode tests, including 11 local-mode identity checks; seven actual upgrade, fresh-manager restart, rollback and relaunch checkpoints using unchanged published alpha.5 tools |
| Rust | PASS: format, Clippy and 26 tests; one existing subprocess-only fixture remains intentionally ignored |
| Owned cleanup | PASS: installed disposable consumer removed; viewer/browser/fixture cleanup recorded; attached application survives viewer close |
| Repository checks | PASS: syntax, TypeScript, Prettier, public metadata, 12 installed-acceptance contract tests and diff whitespace |
| Remote CI / publication | [PR #16 checks](https://github.com/givtaj/daedlo/pull/16/checks) track the current head; no release or customer promotion performed |

Ignored evidence: `artifacts/shared-flow-panel/{runtime-tests.tap,check-final.log,
release-contract-tests.tap,existing-viewer-tests.tap,installed/results.json}`,
source browser receipts under `browser/run-4NUFI0` and `browser/run-3ljykN`, and
installed shared-path receipts under `installed/recipe-paths-viewer/run-jgI9cF`.
The original browser regression is retained under
`artifacts/shared-path/browser/run-Yfoknm/grouping.json`.

The unpublished test bundle retains the development version `0.1.4-alpha.5` and
explicit `source.dirty:true` at base `7194996ec79172c87c814e5d942b7e3c5d8ce40c`;
it is not the published alpha.5 identity. Manifest SHA-256 is
`270a41b046c27550ab89b4b381a3671178cb3e866541462c0d7985461e12f56c`, runtime
archive SHA-256 is
`04568afefce6cd008860b6db5f38f71017e021d630900f59c7f7b892f297c089`.
Post-check comparison of all 23 package files found only the explanatory
`README.md` addition differed; runtime source, viewer assets, package metadata
and licenses match the installed-tested bytes. This is independent fixture
conformance, not acceptance for an inaccessible customer application.

The separate Ninja drill used the clean reviewed implementation commit
`c9dcf2f5c87a7887ae327c4106e3e3809b420f40`. Its isolated packaging snapshot
`ee2fda3dab64d8e0cfa4c8fdbfad3848fc8d77fd` uses `0.1.4-alpha.6` **only as a local
test identity**; repository versions, customer pins and published feeds are
unchanged. All 17 runtime source files match the reviewed commit byte for byte;
of all 23 runtime package files, only package version metadata differs. Local ZIP
SHA-256 is `80cfa2c49d8917d748a4a47a37071899c7440295dcb5ead85daf159227d355de`.
The drill reuses the exact published alpha.5 tools archive, SHA-256
`58ae7d6f0ec1ef512023837a7d8f43003757d70887d2360cc1b31744923bc812`, throughout
installation, update, fresh-manager restart, rollback and relaunch.

The existing model, authored source, tools, configuration, publisher trust,
checkpoint and five synthetic saved records were preserved. All 25 run reports
and six lifecycle reports were retained; three managed drivers, the browser and
owned notebook app closed with no pending cleanup. Candidate, restart and rollback
screenshots were inspected. The mode regressions first produced seven genuine
failures and then passed all 11 checks; independent review found no concrete
regression in the product or upgrade-harness changes.

Ignored evidence is under `artifacts/shared-flow-panel/pr-review` and
`artifacts/shared-flow-panel/ninja-compat-s3Px7L/{review-receipt.json,
snapshot-receipt.json,drill/run-uVewz7/result.json}`. This drill uses an ephemeral
local signed catalog and injected transport with the independent notebook. It
does not establish production transport, a clean operating system, application
process restart, native launcher startup or WBF acceptance. Multi-branch viewer
behavior is covered by the separate browser suite; the lifecycle drill retains
the existing singleton model.

## Alpha.5 released and production-verified — 2026-10-26

**PASS — released and support follow-up sent.** [PR #15](https://github.com/givtaj/daedlo/pull/15)
merged as `4f030c86178e3d7b67af0157af015c34d725c28e`. Its tree
`57b078b214f886c079760edb2f8b279dbdd7a85b` exactly matches the reviewed publisher
head `0fe7720ff3e724af173829b51010b16ccb8a8298` and tested PR merge
`e622f4746c058bf5c9e479f639a01aaa134c942a`. Package source remains
`6577d8fd578c1df8f3cc74eb6436dc537061ba21`; the published tag resolves to that
commit. [The prerelease](https://github.com/givtaj/daedlo/releases/tag/v0.1.4-alpha.5)
and public download path contain exactly the three pinned files below. Repository
visibility remains **PRIVATE**. Earlier candidate entries are historical.

| Gate | Actual evidence |
| --- | --- |
| Exact-source CI | PASS: [40311754111](https://github.com/givtaj/daedlo/actions/runs/40311754111), Node 22/24 and metadata/secrets |
| Publisher PR CI | PASS: [40313924806](https://github.com/givtaj/daedlo/actions/runs/40313924806), all three jobs; tested tree equals merged tree |
| Publication safeguards | PASS: 115 tests and independent review of all 15 pinned files, retained historical pins, signing identity and workflow ordering |
| Signed promotion | PASS: [40315317417](https://github.com/givtaj/daedlo/actions/runs/40315317417), restored generation 11, saved generation 12 before deployment, active identity/live assets/security and key cleanup |
| Production website/installer | PASS: eight actual HTTPS/browser checks, pinned key/feed/all three downloads, desktop/narrow inspection and exact copied offline installer; nine surrounding workspace entries preserved |
| Production upgrade | PASS: seven actual HTTPS alpha.4 → alpha.5 → alpha.4 checkpoints, tools bootstrap, activation, fresh manager restart, rollback/relaunch and preservation |
| Ordinary renewal | PASS: [40315723435](https://github.com/givtaj/daedlo/actions/runs/40315723435), retained generation 12 and published generation 13; every release entry unchanged |
| Authorized support follow-up | PASS: reply sent after publication and production verification, with exact update instructions and remaining customer acceptance; correspondence stays private |

The production drill observed four real catalog requests and all three asset URLs
for each of alpha.4 and alpha.5. Initial setup selected the independently pinned
alpha.4 baseline from the authenticated feed; normal candidate discovery used the
actual installed provider. All three manager instances, the browser and owned
notebook app closed. It retained 25 per-run and six lifecycle reports and preserved
source, tools, configuration, publisher trust, checkpoint and five saved synthetic
records. The live installer/browser fixture also closed and removed its owned
files. Final restart, rollback and desktop/narrow website screenshots were inspected.

Promotion activated Worker version `677bd91c-024e-468f-9d91-4871254936fa` at 100%,
deployment `eeceb680-89da-400d-8648-17ff77861855`. Ordinary renewal activated
`ced9e68e-77f3-4520-92dc-578d4e401ff6` at 100%, deployment
`e75f05d2-4761-48f9-867a-fd37ec7464f4`. The generation-13 catalog expires
`2026-11-02T11:32:10.179Z`, raw SHA-256
`77d3023d6dd1ca593f65f129ffe8c638eb1ef8da1e1eb451eebd2ec5a244013e`,
payload SHA-256 `67014432af4da6da422a2b6ac5d53d313a9f2ca35c6c9632df4930fb50aeffcd`.
Retained checkpoint artifact is `12647305509`, archive SHA-256
`f84d3cff0c5f0bb19a3e333bd865223bb0081fba202f26782f8ad923c9b12c62`.
Live bytes equal the saved signed checkpoint. The key and 04:23 UTC renewal
schedule remain unchanged; regional/provider-host restrictions remain as recorded
for the existing service.

Private ignored evidence: `artifacts/alpha5-final/{installed-release,installed-starter}`,
`artifacts/alpha5-final/production-upgrade/run-GBNwD8`,
`artifacts/alpha5-website/live-3KU5oO/receipt.json`, publication/renewal receipts and
saved public checkpoints. No private correspondence, credentials, catalogs or
session traces were added to Git or release assets. Customer native registration,
customer upgrade/rollback, concurrent customer frontends, full detached-document
fault coverage and ordinary dependency promotion remain outside this delivery's
acceptance. The report's 200-event bound remains explicit. [Epic #11](https://github.com/givtaj/daedlo/issues/11)
closes product delivery, not customer adoption.

## Historical alpha.5 immutable publication checkpoint — 2026-10-26

**PASS — pre-publication gates. Publication pending.** The final package source is
`6577d8fd578c1df8f3cc74eb6436dc537061ba21`. [Exact-source CI 40311754111](https://github.com/givtaj/daedlo/actions/runs/40311754111)
and [PR CI 40311761721](https://github.com/givtaj/daedlo/actions/runs/40311761721)
pass all Node 22/24 and metadata/secrets jobs. Earlier candidate identities and
the diagnosed inline-launch test failure below remain historical.

| Exact artifact | SHA-256 |
| --- | --- |
| Source tree | `2a6a1f69255c5572107161cfc336e6eea063662701c9bfd88eb986f2f407cbbe` |
| Bundle manifest | `4409059f142b62af4f9baf6dd8becf4cb3e203a372e1f60b06e6c9e0baad525f` |
| Tools | `58ae7d6f0ec1ef512023837a7d8f43003757d70887d2360cc1b31744923bc812` |
| ZIP (298366 bytes) | `2d9cbae796edd4cd5967b76458020e3366fa9d33cc1eed65a3e1d523eb65122f` |
| External verification metadata (7869 bytes) | `865cd55317899052a4e71fff1257e835a2abe418a818a66dd1a893bc2adea704` |
| SHA256SUMS | `3698a6f2ebe9025af0ddebb13558494ff7c0673710d590255233e966e808bd3a` |

- PASS: exact installed runtime/crate/tools; 8 browser groups, 10 CLI, 25
  finalization, 9 control, frontend viewer and 13 native startup checks. All 69
  tools and 22 runtime file bytes verified, including all new references.
- PASS: exact shipped starter 16, evidence 9 and managed reference 8. Actual managed
  installation validates both source snapshots and real acceptance/health hooks;
  locked dependency acquisition may use the registry. Saved/uncertain effects,
  private-policy denial, simultaneous frontend isolation and restart are covered.
- PASS: synthetic alpha.4 → alpha.5 → alpha.4 upgrade/restart/rollback, seven
  checkpoints, 25 run reports and six lifecycle reports. Accepted source, tools,
  config, trust, checkpoint and application data preserved. Owned cleanup passed.
- PASS: website 68, onboarding browser 14 and layout 4; exact DOM-copied offline
  installer preserves nine surrounding workspace entries. Desktop/narrow and
  native final-state screenshots inspected. Independent package review confirms
  14 new documentation links resolve and no customer/generated material shipped.

The report contract remains bounded: 16 cached completed reports and at most 200
events per report; archiving cannot restore truncated history. Product fixtures
do not establish customer native registration, application fault coverage or
ordinary dependency promotion. The final kit includes only sanitized aggregate
verification; private receipts stay ignored under `artifacts/alpha5-final` and
`artifacts/alpha5-website`. Final metadata staging also passes with an explicitly
ephemeral signature; only
verification metadata/feed presentation changed from the tested website.
Publisher-source CI, signed publication, production HTTPS upgrade/installer acceptance and the support reply remain required.

## Historical alpha.5 managed integration checkpoint — 2026-10-26

**IN PROGRESS — not published.** [Epic #11](https://github.com/givtaj/daedlo/issues/11)
tracks the managed custom-runner reference, persistence/reporting guidance and
alpha.5 publication. Runtime/report/model contracts remain unchanged. The
managed reference reuses the shipped starter model and private application
metadata; it does not duplicate a customer state graph or prove a private
customer catalog schema.

PASS: 131 runtime tests, Rust workspace tests, format and Clippy; affected
source browser, control, CLI, viewer, Ninja UI and archive checks. The archive
helper had a genuine failing assertion before implementation (0 durable reports
versus 20 expected); its nine unit tests and nine real-browser evidence groups
now pass. The managed wrapper similarly failed its denied-save assertion before
guard wiring. Packaging failed its missing-reference inventory assertion before
adding the explicit files; the complete eight-test packaging suite now passes.
The full release/mode run passed 433 of 434 checks while a new README was still
being written; that sole setup failure passes in the completed packaging rerun.
The managed source reference passes eight native/browser checks, including two
simultaneous frontends, one confirmed save, a real write with an uncertain report,
policy denial, restart and attached-application survival. Source mode seeds its
installation receipt and is not installed-package acceptance. Independent review
found and repaired cleanup ownership gaps; ten helper/adapter checks pass.
Metadata safeguards pass 35/35 and starter inventory/accounting passes 7/7.

The first frozen candidate passes exact installed runtime/browser/CLI/control
checks and 13 native startup checks; its installed starter16 and evidence9 pass.
The nested managed test initially failed before child bootstrap because the
acceptance harness inherited Node's eval-only `--input-type` flag. A bounded
reproduction established the cause and a direct-file control passed. CI now
invokes the existing installed-starter file entrypoint. The failed child PID is
absent; its incomplete-cleanup marker is retained as failure evidence. This does
not establish a launcher defect in the documented file-based workflow.

The same candidate also passes seven synthetic alpha.4-to-alpha.5-to-alpha.4
upgrade checkpoints, with 25 per-run and six lifecycle reports, source/data/trust
preservation and owned cleanup. Website acceptance passes 68 tests, 14 browser
checks and four layout checks; the exact DOM-copied offline installer preserves
nine surrounding workspace entries. Final source/package identities still need
to be rebuilt after the CI invocation correction.

NOT RUN at this checkpoint: final exact installed managed/evidence references,
full frozen-source CI, signed publication, production upgrade/rollback and the
customer notification. Local receipts stay in ignored artifacts. Customer
registration, application business-flow acceptance and ordinary dependency
promotion remain separate.

## Alpha.4 released and production-verified — 2026-10-24

**PASS — released.** [PR #10](https://github.com/givtaj/daedlo/pull/10) merged as
`d71646dda1b70d662b275aa1784a093395ea842f`; its tree exactly matches the tested
publisher head `b939691e36a01bfbc2f7e169dea49fcda1712ab9`. Package source remains
`7bb3491aa49a7e9c8321e20db8904a75e7e63e03`. The exact tag resolves to that commit;
[the prerelease](https://github.com/givtaj/daedlo/releases/tag/v0.1.4-alpha.4) has
exactly three files matching the final immutable identities below. Repository
visibility remains **PRIVATE**. Earlier candidate entries are historical.

| Gate | Actual evidence |
| --- | --- |
| Package CI | PASS: [40073590521](https://github.com/givtaj/daedlo/actions/runs/40073590521), Node 22/24 and metadata/secrets |
| Publisher CI | PASS: [40074238487](https://github.com/givtaj/daedlo/actions/runs/40074238487), all three jobs |
| Signed promotion | PASS: [40074721690](https://github.com/givtaj/daedlo/actions/runs/40074721690), restored generation 6, signed/retained generation 7 before deployment; staging, active deployment, all served assets/security and key cleanup passed |
| Production website/installer | PASS: 8 assertions using actual HTTPS key, feed and all three downloads; live desktop/narrow inspection; DOM-copied installer executed offline; nine unrelated npm-workspace entries preserved; browser/fixture cleanup passed |
| Production managed upgrade | PASS: 7 checkpoints with native global fetch; old alpha.3 refusal before candidate download, new-tools recovery with the same configuration/trust/store/checkpoint, alpha.4 activation, fresh manager restart, rollback/relaunch and preservation |
| Ordinary renewal | PASS: [40075013109](https://github.com/givtaj/daedlo/actions/runs/40075013109), restored retained generation 7 with bootstrap:false and published generation 8; every release entry remained identical |
| Native-task isolation | PASS: original checkout remains clean at `42c4956a95f264282602db2e23ed3db8c88269a5`; original chat idle; no ordinary customer/Roots dependency changes |

The production upgrade observed three catalog requests and each of the three
real download URLs for both alpha.3 and alpha.4. All three manager instances,
the acceptance viewer browser and owned notebook app closed. Exact restart UI
and live website installer/bootstrap screenshots were inspected. The synthetic
notebook is an independent conformance fixture; customer business-flow acceptance,
database recovery and application-process restart durability remain **NOT RUN**.
Missing terminal request evidence remains unresolved, not a fabricated success.

Promotion activated Worker version `340bfc21-2a5e-4221-8428-eb3c7a8f48ca` at 100%.
Ordinary renewal activated `b8416a29-257f-45a2-b8bf-2c179a9df9d7` at 100%, deployment
`614bb5f1-5d4d-4bee-a709-77ea55cbe2f0`. The generation-8 catalog expires
`2026-10-31T07:40:19.539Z`, raw SHA-256
`4e95e20b45c216dc7227a6e69da39acef50510f97b5d9388e8c54a462e99bb8d`,
payload SHA-256 `ce8cd2d26f15e78f54a3ee6da52627ada406f55f60086f24b4d5d9e340ce7f13`.
The latest retained artifact is `12551874583`, archive SHA-256
`51182d75b8c366e18b37f3ac1c2cdc6527c9d89005cce7c6f94423f0009b702b`.
Independent verification covered all eight workflow runs, the pinned signature,
archive digest, unchanged generation-7 release entries and exact live/checkpoint
bytes. Daily renewal remains 04:23 UTC; signing identity and expiry rules did not change.

Private ignored receipts: `artifacts/alpha4-publish/production-upgrade/run-X8OFc4`,
`artifacts/alpha4-website/live-JZwZIm/receipt.json`, the promotion/ordinary-renewal
workflow receipts and `artifacts/alpha4-release-audit/production-generation-8`.
No private traces or customer payloads were added to public artifacts.

## Alpha.4 publication artifact — 2026-10-24

The final installation-guide audit replaced stale publication-status wording in
all seven affected shipped guides; command/configuration blocks are unchanged.
The final clean package source is `7bb3491aa49a7e9c8321e20db8904a75e7e63e03`.
[Exact-source CI 40073590521](https://github.com/givtaj/daedlo/actions/runs/40073590521)
passes Node 22/24 source/browser/package/native/starter checks and metadata/secrets.
All exact-package local acceptance was rerun on these bytes: installed runtime
8 browser groups, 10 CLI, 25 finalization, 9 control and 13 native checks; starter
16; managed upgrade/restart/rollback 7; website 66 tests and 14 Chromium checks;
DOM-copied offline installer with all nine surrounding workspace entries preserved.
Owned cleanup passed. The package and metadata are the only current publication
candidate; preceding artifact identities are historical.

| Artifact | SHA-256 |
| --- | --- |
| Source tree | `cbe572dc02d8f998c0fec81efb8a77681526c22e654c8be4b95627c4abb2be39` |
| Bundle manifest | `85137d29cda75d45da829efb488fc277b46af637ce85dac248b499a52718879c` |
| Tools | `ea1a07a7b771a046fa6d32891e3a62463b57f7753e81fc3dba10d6463f6fd2bd` |
| ZIP (280815 bytes) | `3676d52869a30fba57798afd64d64722b7c8ee1e622e56f52013adc4107a6e75` |
| External verification metadata | `7ff86a221af63c212bf4a271263367e72c674ff9497281da9253d3f1ffc2f70b` |
| SHA256SUMS | `f3415dda3246bca2277c2d175b22aa97bb19c301843a0e2fa9f2401dbe162b07` |

Publisher policy pins this exact three-file inventory. Signed publication and
production HTTPS acceptance remain pending at this checkpoint; the native setup
checkout and normal customer dependencies remain untouched. Evidence stays in
ignored `artifacts/alpha4-publish` and
`artifacts/alpha4-website/final-wn6Dnh/receipt.json`.

## Alpha.4 frozen release and publication gate — 2026-10-24

Clean package source is `bd8e393351f3116920c976cfd3221035e2304db3`.
[Exact-source CI 40072524866](https://github.com/givtaj/daedlo/actions/runs/40072524866)
is **PASS**: Node 22/24 source, browser, package/native/starter acceptance, public
metadata and full-history secrets scan. The earlier scan failure was a verified
public PEM digest false positive; one exact historical fingerprint was excepted,
the current label was clarified, and a synthetic detection control still passed.
No history was rewritten and no general secret rule was disabled.

| Immutable final artifact | SHA-256 |
| --- | --- |
| Source tree | `78358a15128a34d2b172fdfa8ed3e86716e166a514348b417842f83d9177a679` |
| Bundle manifest | `4bd0193a20b00c01c986ef73fbc9b28108dc4494569d026dd34ad84472d3770f` |
| Portable tools | `3cef22b472d21d2a188051008399cdfc8f605ee72399a27d003e8563e0e27fdc` |
| Complete kit ZIP | `e060da304e9ec612472f580bdfdb06ac2bc048dc4fa409bc6e91d1aff13a1ec7` |

- PASS: exact installed runtime/crate/tools; 8 browser groups, 10 CLI, 25
  finalization, 9 browser-control cases, frontend isolation and 13 native startup
  checkpoints. All 59 tools/22 runtime file bytes verified; owned cleanup passed.
- PASS: exact shipped starter 16 checks with real Rust hello, independent save
  readback, rejected/stale drafts and honest unresolved request evidence.
- PASS: managed upgrade 7 checkpoints: real old-client pre-download refusal,
  unchanged configuration/trust/store, new-tools legacy recovery, candidate
  activation, fresh manager restart, rollback and relaunch. All owned resources
  closed. The independent synthetic notebook uses an ephemeral signed feed.
- PASS: website 66 tests, 8 pages/4 archives/35 assets and 14 real Chromium checks.
  Desktop/narrow layouts inspected. DOM-copied installer exactly matched the ZIP
  guide, ran offline and preserved all nine surrounding npm-workspace entries.
- PASS: the original native setup checkout remains clean at
  `42c4956a95f264282602db2e23ed3db8c88269a5`; its chat is idle.

The public `release.json` contains only sanitized aggregate verification and exact
artifact identities. ZIP bytes remain immutable. Production policy pins those
three final files separately from the package source; publisher-source CI,
signed-feed publication and production HTTPS upgrade/rollback remain required
at this checkpoint. The GitHub prerelease is a draft. Production activation must
retain the existing signing identity and authenticated high-water checkpoint.
Customer business-flow acceptance and ordinary dependency promotion remain
separate. Earlier candidate receipts below are historical.

Evidence stays ignored: `artifacts/alpha4-release-final/installed-release`,
`installed-starter`, `upgrade-acceptance/run-MQLzsi`,
`artifacts/alpha4-website/final-Y9RcCE/receipt.json` and the source-CI receipt.

## Alpha.4 feed and installer integration — 2026-10-24

The isolated branch adds manager-2 compatibility for renamed kits, preserving
immutable manager-1 releases and legacy recovery. Old tools now see
`migration_required` before candidate download. Website installation paths derive
from verified package metadata, and the publication workflow has one explicit
alpha.4 promotion input under its existing high-water checkpoint lock.

- PASS: 411 release regression tests, including manager compatibility, immutable
  feed inventory, bounded GitHub asset retrieval and workflow credential/order
  checks. Genuine failing assertions were recorded before behavior changes.
- PASS: website tests 65/65 against retained legacy assets, exact prior-candidate
  installer comparisons 5/5 and 14 real Chromium checks at desktop/narrow widths.
- PASS: [remote CI 40071244966](https://github.com/givtaj/daedlo/actions/runs/40071244966)
  for earlier committed candidate `eda45238dca8e184fb73d0ba2ab9975117df8438`,
  including Node 22/24 source, exact installed native/starter acceptance and
  secrets/public-metadata gates. This does not cover later feed/site changes.
- NOT RUN at this checkpoint: final rebuilt artifact acceptance, CI for these new
  changes, signed production promotion and production HTTPS upgrade/rollback.

The original native setup checkout remains clean at
`42c4956a95f264282602db2e23ed3db8c88269a5`. No production publication has occurred
at this checkpoint. Final immutable artifact pins must land before merging the
website claims; ordinary renewal then refuses a legacy-only baseline until the
explicit promotion succeeds. Previous candidate results below are historical.

## Final alpha.4 local acceptance — 2026-10-24

The four improvements and integrated native setup are implemented and locally
verified. **Unpublished; not yet cleared for production rollout.** Final runtime,
engine, tools and kit came from clean source
`5c66209166922db5ae732e0ba5841b350f1e090f` on `codex/alpha4-wbf`.
The source regression results in the preceding development checkpoint below cover
the implementation. The final source change replaces fixture-specific labels with
generic names and waits for the exact completed save before taking upgrade viewer
screenshots. All exact-package checks below were rerun on the final artifacts.
This verification entry is a later documentation-only change.

| Final artifact identity | SHA-256 |
| --- | --- |
| Source tree | `cc75051b022d3e157eea67f2dbe1a58eada18dbf1d9ed31a3f702fd17e400013` |
| Bundle manifest | `f65516c377b8002e897c3341318cac2ca1ca1f67ff8724ae277725e9686dffca` |
| Portable tools | `ed5fae3ae1ea141f75d7b7bab84cf22a531c37e663c263bba9cbb45e599e2e03` |
| Complete kit ZIP | `e1cf534fa853f189b4b44242f2ef7730dfe2db536aa2c0a097f3425b803e53a4` |

| Exact installed acceptance | Observed result |
| --- | --- |
| Runtime/crate installation | PASS: independent offline consumer, exact crate compilation, both CLI aliases, all 22 runtime file bytes verified before/after. |
| Browser and existing behavior | PASS: 8 browser/API groups, 10 CLI, 25 finalization and 9 browser-control checks; named frontend viewer isolation passes. |
| Native startup and lifecycle | PASS: 13 browser checkpoints using exact installed tools/runtime/crate. Includes delayed bootstrap, invalid real Rust hello with safe diagnostic, concurrent frontends, target failure, cooperative and unacknowledged cancellation, preserved ownership and attached-app survival. |
| Shipped starter | PASS: 16 checks executed from the installed tools' copied starter against the exact installed runtime and extracted crate. Successful independent readback, no-write rejection, stale drafts, uncertain effects, redirects/aborts and unresolved request evidence remain distinct. All 59 tools files verified before/after. |
| Legacy tools bootstrap and rollback | PASS: 6 checkpoints with immutable alpha.3 ZIP `f569bc0c84bf1b7ac5efe59c610916ac8ab0d5bb3322ed520114d8880262b190`. Old tools refuse the renamed kit without disturbing the accepted slot/data; new tools recover legacy, activate alpha.4, restore the complete alpha.3 slot and relaunch. Config, trust/checkpoint, authored states/flows/adapter, both tools installs and app records are preserved. Five lifecycle reports and durable completed-run reports retained. |
| Presentation and cleanup | PASS: startup/failure/ready screens, named viewer, starter saved result and exact candidate/rollback save screenshots inspected. Owned resources and temporary consumers closed; attached app remained alive until its independent test owner closed it. No retained cleanup failures. |
| Package/private boundaries | PASS: closed inventories, required unchanged notices and source identities verified. Customer/generated directories excluded and new fixture labels generic. |

Final evidence is private and ignored: `artifacts/alpha4-final/identity.json`,
`installed-release/results.json`, `installed-release/native/browser-result.json`,
`installed-starter/result.json`, and
`artifacts/alpha4-upgrade/run-8pHy8U/result.json`. Earlier frozen candidates and
failed/setup receipts remain historical. An interrupted final kit assembly was
classified as an interrupted build, then completed into a fresh output from the
verified source-bound bundle/tools; it was not counted as a browser failure.

The upgrade fixture is an independent notebook with an ephemeral local signed
catalog. Its app-process records were preserved across driver/manager changes;
this does not prove database backup/restore, app-process restart durability,
actual customer acceptance or production-feed delivery. Missing previous-document
terminal events remain an explicit unresolved condition, not a claimed core fix.

The original native setup worktree remains clean at
`42c4956a95f264282602db2e23ed3db8c88269a5`; normal customer checkouts and dependencies
were not changed. No push, merge, release, feed/signing/checkpoint mutation,
website deployment or repository visibility change occurred. Remote CI for this
branch has **NOT RUN**. Before publication, verify legacy-manager capability/feed
rollout and package-family website command rendering, complete the relevant
release checks/approval, and keep customer promotion separately authorized.

## Alpha.4 continuation after rename — local candidate, 2026-10-23

Work resumed from renamed `main` at
`ebe5c5e667f4b943b3c5550a0e58a1fe89ba6f12` in an isolated alpha.4 branch.
The preserved native setup implementation at
`42c4956a95f264282602db2e23ed3db8c88269a5` was integrated into this candidate;
its original worktree remained clean at that commit. The primary checkout and
private customer records remain separate. The Codex project listing now resolves
`daedlo` to its canonical renamed directory. No publication is implied.

The four additions are safe field-level invalid-model diagnostics, a visible
startup screen before session readiness, named frontend identity/lifecycle, and
a portable synthetic Rust/adapter starter with executable acceptance. Strict model
rules and protocol 1 remain unchanged. Diagnostic positions are zero-based; named
parameter positions use sorted map order without exposing labels or values.

Test-first evidence includes a real Rust hello rejection lacking an actionable
field; unavailable startup UI and erased failed-start state; absent frontend
identity; resume/advance forwarding despite origin mismatch; legacy effect
forwarding after identity loss; mismatched viewer/session pages; missing startup
cancellation; and missing starter files in the tools archive. Setup/import errors
and a corrected browser test locator were retained separately and are not claimed
as product regressions.

Completed local source checks at this checkpoint (macOS arm64, Node 22.20.0,
Rust 1.96.0, Playwright 1.62.1):

- Runtime **131/131**, Rust workspace **26 passed** plus one ignored subprocess
  helper that is invoked by the parent real-hello tests; Rust format and Clippy
  with warnings denied passed.
- Existing source browser acceptance: **8 browser/API groups**, **4 motion**,
  **9 controls**, **10 CLI**, **3 viewer**; **11 Roots archive** checks passed.
- Starter real Rust/browser acceptance: **16 checks**, isolated model **3/3**,
  request-accounting **2/2** and installed-inventory regressions **3/3** passed.
  Viewer screenshots were inspected. The example is independent conformance,
  not customer acceptance or a replacement product demonstration.
- Combined release contracts **397/397** and final native/lifecycle/browser
  checks **64/64** passed. Syntax, public declarations, formatting, repository
  guardrails **35/35**, manager UI **2/2** and published-config compatibility
  passed. Later review fixes also retain failing assertions for wrong-page
  binding, legacy dispatch, owner-disconnect cancellation and cleanup metadata.
- Portable tools closed inventory checks **8/8** passed, including the synthetic
  starter, native session assets and migration guide with resolvable local links.

A held previous-document keepalive request can lack a Playwright terminal event
in the tested Chromium. The starter retains it as unresolved and refuses false
settlement. Explicit cancellation before navigation is tested when supported;
listener movement alone is not represented as a universal fix. This synthetic
observation does not establish a defect in any customer's adapter or Daedlo core.

Exact frozen-package installation, startup, starter and legacy
tools-bootstrap/upgrade/rollback are **PENDING** at
this source checkpoint. Their results must be appended from actual runs. Private
logs/screenshots and failing assertions are retained under ignored
`artifacts/alpha4-runtime/`, `alpha4-validation/`, `alpha4-native/`,
`alpha4-starter/` and `alpha4-upgrade/`.

Publication remains separate: manager capability/feed rollout, package-family
website command rendering and explicit release authorization are still required.
No production feed, signing/checkpoint state, website, repository visibility or
customer dependency pin was changed. Existing release/history entries below retain
their original scope and exact identities.

## Private launch controls and primary-folder rename — 2026-10-23

This is the original dated checkpoint. The [30 October preparation](#open-source-preparation--2026-10-30)
supersedes its pending CI and rewrite-preparation status as current launch
guidance. The old local app-registration observation is not a public-source gate.
Historical receipts and identities below are retained.

The same GitHub repository is now `givtaj/daedlo`, stable ID `1391092739`, and
remains **PRIVATE**. [PR #8](https://github.com/givtaj/daedlo/pull/8) merged as
`63ac0466b8535545e6e3e5e249217543bb2025f7`; its Node 22/24 merge CI
[run 40007554660](https://github.com/givtaj/daedlo/actions/runs/40007554660) passed.
The Git remote points at the renamed repository. This is the same repository,
with its existing release assets and history.

GitHub Actions now allows GitHub-owned actions only, requires full commit-SHA
pins and excludes third-party/wildcard exceptions. Both settings writes and their
readback passed. Read-only workflow tokens, no PR approval by workflows, disabled
private-fork execution/token/secret sharing and dependency alerts were verified.
Main branch protection and rulesets remain **BLOCKED_BY_PLAN** (HTTP 403). The
owner chose a [pending main ruleset](../.github/main-ruleset.json) for the later
approved public switch and explicitly declined a paid-plan change. The ruleset
has not been applied. Public-fork contributor approval is unavailable while
private (HTTP 422); no enablement is claimed.

The new metadata guard rejects tracked private conversation links and customer
folders without echoing matched text or reading customer contents. A separate
read-only repository audit verifies the fixed repository identity and reports
unsupported protections as blocked. Its explicit safe-apply mode permits only
the two reviewed Actions settings. Regression failures were recorded before both
implementations. Review found a nested-customer-path gap; two additional
regressions failed before the fix and then passed. The final metadata suite
passed **20/20** and repository-control suite **15/15** checks. `npm run check`
passed. The new GitHub CI job has not yet run at this local checkpoint. Gitleaks 8.30.1 scanned the local
checkout's 47 reachable commits with its one exact reviewed checksum exception
and reported no remaining findings. This scan is distinct from the full remote
mirror and from the metadata-history rewrite below.

The isolated historical cleanup candidate at the `63ac0466` snapshot passes full
object, topology and tip-tree verification: two private chat identifiers removed
from ten old blob versions, 53 commits and eight merges preserved, all 21 ref tip
trees identical, and no exact identifier remaining in reachable candidate objects.
All 53 commit IDs and four release-tag targets change; nine commit signatures are
removed. A complete local Git bundle was restored and verified. This is a
**local-only dry run**, not an applied rewrite or off-host backup. Pinned Gitleaks 8.30.1 also passed both complete 53-commit mirrors, including
merge history, with 100% redaction and one exact checksum exception each; the
candidate used a separately remapped ignore file. New commits require a refreshed
candidate. GitHub's read-only PR refs/caches and Support
eligibility remain unresolved; no Support request or remote force-push occurred.
See [public launch controls](public-launch.md) for the concrete remaining gates.

The primary directory moved in place from `browser-driver` to `daedlo`, with
an old-path compatibility symlink. All five
worktree HEADs, branches and status entries, the primary diff/index, directory
inodes and customer-file metadata were identical afterward. Linked worktrees now
resolve the new common Git directory. No task was stopped; native setup remains
at `42c4956a95f264282602db2e23ed3db8c88269a5`. The native-setup chat was informed
under the owner's existing coordination permission. No private customer content
was opened. Existing Codex chats may retain the former working directory; the
old symlink is rejected by this chat's existing sandbox root, so it needs the
supported project/chat path refresh before ordinary sandboxed commands resume.
The owner reported updating the Codex project UI; the project-list API still
returned the old name/path at the last check, so that app metadata is unverified.

No public visibility, package, feed, website or customer dependency promotion
occurred. Private evidence stays under ignored `artifacts/public-launch-guardrails/`
and primary `artifacts/public-launch-history/2026-10-23-dryrun/`. Public access
still requires the owner's explicit confirmation after remaining gates are resolved.

## Daedlo naming and community preparation — private source, 2026-10-23

The rename and contributor cleanup were implemented in an isolated branch from
`7d7ebb933bf28952b46991ae9f1ff41393ed1620`. Clean implementation commit
`85c1bcac841545e1ad4f1c6783b4e1bb3d8cbce5` was used for the local immutable build;
this verification entry is a later documentation change. These local checks preceded the same-repository rename and integration reported
in the entry above. Repository visibility remains **PRIVATE**.

The source uses the Daedlo runtime, Rust crate, tools, CLI and skill names. Legacy
CLI aliases and stored protocol/report/manifest/receipt identities remain intact.
Contributor, security, conduct, support, roadmap and licensing guidance, issue/PR
templates and code ownership were added. Apache-2.0 applies to the current source;
legacy MIT and third-party notices were preserved byte for byte. See
[licensing scope](licensing.md) and [migration limits](rename.md).

### Observed local checks

On macOS arm64, Node 22.20.0 and Rust 1.96.0:

- Syntax, strict declarations, Prettier, Rust formatting and Clippy with warnings
  denied passed; the locked Rust build and **23 Rust tests** passed.
- **129/129 runtime**, **340/340 release**, **11/11 Roots archive** tests and the
  published customer-config check passed. Release tests include legacy/new
  package-family validation, installation receipts, rollback, signing and
  repository-ID-bound checkpoint continuity. Naming and repository-authentication
  regressions were observed failing before their implementation.
- Source Chromium acceptance passed **8 browser/API groups**, **4 motion**,
  **9 control**, **10 CLI**, **2 viewer** and **2 manager UI** checks.
- Exact installed candidate acceptance passed the same **8 browser/API groups**,
  **10 CLI**, **25 finalization** and **9 browser-control** checks, with owned
  cleanup passing. All **22 runtime files** matched the archive bytes. Both the
  `daedlo` and `browser-driver` executables passed installed help checks. The
  consumer's engine compiled against the exact renamed crate.
- Runtime, crate, portable tools and complete kit were built from the same clean
  source. Source tree digest:
  `35aa7e3e00da08b05adc728b4fe71fcb569ef822ea58f732785176cbaa2d4f84`.
  Bundle manifest: `cf899d5ee0233b2b6c29eef506a2b4e13b132773a7456fb12a70c9f47db10d3f`.
  Tools: `145780cdcca1302f081590b99559ea720b73496a74e06a6f0d69137e94a6dc17`.
  Kit: `75178e7391f9912775cd39c79290755ebebd1078d6c0c56a5a7d0f666d1063b2`.
  These are **local unpublished alpha.4 candidate bytes**, not public downloads.
- Real published alpha.2/alpha.3 kits were authenticated against the signed
  generation-6 feed and frozen digests. Current tools passed archive-store
  alpha.2 → alpha.3 → alpha.2 rollback. Exact alpha.3 runtime imports, legacy CLI,
  all 22 installed file bytes, offline portable tools and a real legacy crate
  compile/protocol handshake passed. Original names and `MIT AND Apache-2.0`
  declarations were unchanged. This was not a customer application migration.
- The staged current website passed **61/61 tests**, static acceptance for
  **8 pages / 3 archives / 32 public entries**, using all nine unchanged published
  release files and the authenticated generation-6 feed. An initial unstaged run
  had three missing-generated-input failures; staging the required release inputs
  resolved them. The local archive's Daedlo labels were visually inspected.
- Real GitHub checkpoint readback for completed run 6 (`40003075368`) restored
  predecessor generation 5 from run `40000221353`, with `bootstrap:false` and the
  same repository ID. No workflow was dispatched and no feed was written.

### Public-access audit and remaining gates

The redacted history audit used Gitleaks 8.30.1 over origin branches and tags:
43 commits scanned. One generic-key finding was manually verified as the public
Roots API executable SHA-256 in a historical binary receipt. The exact fingerprint
is documented in `.gitleaksignore`; the reviewed history and staged-change scans
passed with no remaining findings. The locked npm audit reported zero advisories.
Pattern screening covered the then-available 54 Actions logs, 70 workflow
artifacts, 23 release assets and six PR bodies; no credential pattern matched.
All nine committed Roots screenshots were inspected and showed synthetic fixture
content. These checks establish their stated scope, not absence of every possible
secret. Historical private-chat identifiers remain in old Git blobs; they are not
access credentials, and history was not rewritten.

Dependency vulnerability alerts were enabled and read back. Private-repository
branch protection/rulesets are unavailable under the current GitHub plan; configure
appropriate protections when the account/repository supports them. No plan or
visibility change was made to bypass this limitation. Public visibility requires
an explicit owner decision after reviewing the retained history and repository
settings; refresh exposure checks if repository content changes first.

The published alpha.3 manager cannot consume a renamed kit. The independently
verified new-tools bootstrap, customer upgrade/rollback, capability signalling and
website command rendering remain **NOT RUN / REQUIRED before alpha.4 publication**
as detailed in the migration guide. No new package, feed, website, customer
installation or everyday Roots dependency was promoted by this work. The native
setup task's separate commit/worktree, the dirty primary checkout and checkout
folder paths were preserved.

Local evidence is retained under `artifacts/community-readiness/`,
`artifacts/daedlo-rename-final/`, `artifacts/rename-legacy-alpha3-validation/` and
`artifacts/rename-website-validation/`; private logs and downloaded artifacts are
ignored and excluded from Git.

## Teaching-mode plan and website — published, 2026-10-23

**PUBLISHED / VERIFIED:** [teaching-mode plan](teaching-mode.md)
and a static [website introduction](https://daedlo.com/teaching). No teaching runtime was implemented; Roots
learner acceptance, reduced-lesson replay and novice pilot are **NOT RUN**.
Original September Roots UI, logs and pinned recipes were inspected as historical
workflow evidence, distinct from new teaching acceptance. Live Roots was untouched.

- Three substantive website content assertions failed before implementation.
  The candidate then passed **61/61 website tests**, static acceptance for
  **8 pages and 3 curated archives**, and **22/22 renewal tests**.
- The candidate uses pinned release source `01641786fa756c85540d4e3b3fcf470f7a5a85b9`.
  Both scoped website/renewal patches also pass application checks against
  `ca2412a5bf24b29d7e402aeba109b8f59a299ee9`; only verification prose changed
  between those sources. No runtime, dependency, publisher or trust code changed.
- Desktop and 390px browser review covered the homepage teaching link/section,
  teaching page, lesson anchor via keyboard and current-release installation link.
  No horizontal overflow or console warnings/errors were observed. Responsive
  overrides were reset. This is browser/UI review, not screen-reader acceptance.
- The public inventory grows from **28 to 30 served assets** by adding
  `teaching.html` and `teaching.css`. All nine immutable release files, installer,
  onboarding script, update page, trust key and staged feed remain byte-identical
  to the captured candidate baseline; existing demo assets remain unchanged.
- Candidate feed bytes were an older local staging input, **not publication input**.
  The release owner preserved and advanced the live generation-5 checkpoint
  (`c7ea7b0d2a1697a987dc947cdfc96c90c8dbbfb6b2542ca591d341c7b4494b2f`)
  through the current renewal pipeline. The isolated release worktree integrated
  the scoped changes; the dirty/stale main checkout was not deployed wholesale.

The authoring checkout retains its candidate evidence under
`artifacts/teaching-mode-20261023/`. The release worktree independently repeated
the three failing assertions against the current production baseline, then passed
**61/61 website tests**, acceptance for **8 pages / 3 archives / 30 served assets**,
and **22/22 renewal tests**. The renewal checks also compare exact teaching HTML
and CSS bytes and reject same-length tampering of either live asset.

Release-owner Chromium review at 1280px and 390px passed homepage navigation,
the planned disclosure, keyboard lesson anchor, current-release/licence link and
overflow checks, with no console errors or warnings. Desktop/mobile screenshots
were inspected; the owned browser and preview server were closed. The staged site
uses the verified generation-5 baseline: all 29 files outside the six reviewed
static additions/edits remain byte-identical. Independent evidence is under
`artifacts/teaching-publication/`; renewal coverage is retained under
`artifacts/teaching-mode-20261023/renewal-teaching-byte-checks.log`. No private Roots
traces were copied into the site.

[PR #7](https://github.com/givtaj/browser-driver/pull/7), source
`7196891a2d0dc8997408a1da7e2cace14ac96437`, passed full Node 22/24 CI
([run 40002238174](https://github.com/givtaj/browser-driver/actions/runs/40002238174))
and merged as `76408d5f3b4936fca67385107e0d730a8f7e000f`.
[Production run 40003075368](https://github.com/givtaj/browser-driver/actions/runs/40003075368)
published that exact merged source. Staged validation, authenticated checkpoint
restore, deployment identity, live checks and temporary signing-key cleanup all
passed. The existing Worker is active at 100% on version
`a2d660fd-e08c-4eae-9b8d-c1207fb59a97`, deployment
`50d5d28e-4eef-4a9e-8b02-c9bbfcf7edcf`, verified at
`2026-10-23T18:25:38.792Z`.

Renewal restored generation 5 with `bootstrap:false` and published **generation 6**,
expiring `2026-10-30T18:25:23.979Z`. Raw catalog SHA-256:
`8fbfbb0ed4d6009e90cccd522cc2ee99dcabeaf98c2e9a88d6e602a2efdd67a7`.
An independent canonical-site readback at `2026-10-23T18:26:36.739Z` passed
**30/30 exact public files** and **9/9 private-path 404 boundaries**, four security
headers, cache/MIME policies, signature/expiry, unchanged release entries, trust
key and nine historical files, and final feed stability. No challenge, retry or
bypass occurred. This is one observation location, not country-wide reach proof.
Receipts and reconstructed expected bytes are in
`artifacts/teaching-publication/live-PuyLQq/`; provider/source evidence is in
`artifacts/teaching-publication/production-receipt.json`.

The prior Worker version is `cc75fed4-c42a-4e2b-8cd3-941d5ce1ec11`; recovery must
preserve the highest signed catalog generation instead of replaying its older
feed. Current alpha.3 downloads, onboarding and the Apache next-release notice
remain intact. This publication adds the plan/page only, with no teaching runtime,
alpha.4 release, customer installation or data migration.
## Native setup and Ninja continuation — 2026-10-23

Implemented locally on `codex/native-setup`, based on
`ca2412a5bf24b29d7e402aeba109b8f59a299ee9`. **Unpublished.** The native tools are an
additive wrapper around the existing Ninja manager: staged read-only doctor,
resumable first preparation, foreground runner ownership, authenticated reuse,
exact Codex viewer handoff, safe stop and explicit same-version source refresh.
Managed runs gain immediate private report archives. Existing CLI, archive updater
and Ninja UI interfaces remain supported. No application dependency promotion,
public website change, registry/release publication or background updater occurred.

| Check | Actual result |
| --- | --- |
| Test-first regressions | PASS after genuine failing assertions: native route 404 instead of 200; setup/reconnect absent; missing per-run reports; missing refresh; wrong doctor compiler context and permission classification; inaccessible failed-start cleanup; false success after failed evidence retry; inconsistent viewer/installation handoffs and ambiguous post-action status. Initial sandbox `listen EPERM` was a setup blocker, not a behavioral failure; scoped loopback permission reached the actual failing assertion. |
| Native focused checks | PASS, 46/46: preflight, single owner, stale/unresponsive receipts, dirty/active safe boundaries, actual partial-start cleanup retry, evidence persistence/repair, retained-bundle refresh, ownership and authenticated HTTP boundaries. |
| Full release regression suite | PASS, 367/367, including existing packaging, installer, signed-catalog, transaction, crash/recovery, supervisor and updater checks. |
| Existing runtime and Rust | PASS, 129 runtime tests and 23 locked/offline Rust tests. |
| Existing real-browser integrations | PASS, 10 ordinary CLI cases and 2 Ninja update-screen cases. |
| Source checks | PASS: JavaScript syntax, public TypeScript types, formatting and `git diff --check`. |
| Exact portable tools | PASS: built explicit dirty-source candidate `0.1.4-alpha.4`, installed offline with `--prefix --workspaces=false --ignore-scripts`; all 40 installed inventory files match the archive. No npm dependencies or lifecycle scripts were introduced. |
| Installed native real-app acceptance | PASS, 7 checkpoints against pinned Architecture Studio `d8cb9396609b722418015cdd3367b3ef659aeb69` with synthetic isolated data and immutable public alpha.3 runtime/crate. Setup performed one preparation and four transport reads; repeated setup did neither again. Repeated start/status reused one child and viewer without flow replay. |
| Flow and preservation evidence | PASS: four actual success/negative flow passes (initial, relaunch, refreshed source, rollback), 28 immediate completed-run archives and 4 final session reports. Independent save/read-back and no-write assertions passed. Source refresh changed only an isolated launcher comment, rebuilt at the same runtime version, and preserved data and the complete previous slot. Rollback ran that previous snapshot without overwriting authoring changes. |
| Codex Browser | PASS: the returned viewer rendered Connected with the live controlled application, observed state, enabled/disabled authored controls and separate execution/effect outcome. Reload retained the same completed run and persisted revision. No application action was issued during inspection. Screenshot and actual observation receipt retained privately. |
| Cleanup | PASS: both native owner handles, controller browser, controlled browsers and synthetic application closed. Stop preserved the separately owned application until the test owner explicitly closed it. No evidence-copy errors or failed cleanup handles remained. The task-owned Codex tab was closed. |

Private evidence is under ignored `artifacts/native-setup/`, especially
`customer/run-6ZE6gJ/result.json`, `visible-inspection.json`, `codex-browser.png`,
completed-run/final-report copies and the retained red/green logs. Do not publish
those raw records. The tools archive SHA-256 is
`165e63e7fd5c3ba585f5e2b26daa8584b622ebf878a9602744f62d032ea822b5`;
its recorded source tree is
`0c25129ba994dac9166130da0602a5dbdc074c72be8225bfd58a7bee35166fb2`
with `dirty:true` on the baseline above. These identities describe the tested
candidate, not a published release or a clean-commit package.

Limits: existing macOS arm64 Node/Rust/browser toolchains were used. Initial setup
used the real native API with an ephemeral signed-catalog transport serving frozen
public bytes; reconnection/status/stop/refresh/restart used the installed CLI.
Production-feed discovery was not re-run. Fresh-OS dependency installation,
Windows/Linux, manual-auth onboarding, WBF and everyday Roots promotion remain
NOT RUN. The native layer does not remove host sandbox policy or guarantee that a
permission is granted permanently. Follow [native setup](native-setup.md) for the
project handoff, retained tools/browser caches, source refresh and future updates.

## Apache-2.0 next-release preparation — 2026-10-23

Source prepares **0.1.4-alpha.4**, not a published release. The public engine,
runtime, portable tools and skill declare Apache-2.0; the full legacy MIT grant,
upstream Apache text and third-party provenance remain included. Existing
alpha.3 and earlier downloads, customer projects and signed feed entries are
unchanged. No customer model, flow, adapter or data migration is involved.

| Check | Actual result |
| --- | --- |
| Licensing regressions | Genuine FAIL first: 5 failures including the old mixed declaration and rejection of a complete Apache package; then 15/15 PASS. Missing, divergent and truncated notices and mixed declarations are rejected. |
| Public-kit regressions | Genuine FAIL first: 19 failures; then 29/29 PASS. Both historical mixed and new Apache declarations preserve all four canonical notice files; runtime, engine and tools must agree. |
| Rust workspace | PASS, 23 tests with locked alpha.4 manifests. Public model/adapter interfaces and runtime behavior are unchanged. |
| Website | Genuine FAIL first: 0/3 new licence tests; then all 58 website tests PASS. Desktop 1280px and narrow 390px headless Chromium licence-section checks and visual review PASS. |
| Historical preservation | PASS: nine immutable download files, exact Codex prompt and installer unchanged. Apache and legacy MIT text files retain their original bytes. |
| Shared-worktree source check | Syntax and types PASS; full formatting check FAIL on the pre-existing, unrelated untracked `tests/release-ninja-acceptance-cleanup.test.mjs`. It remains untouched and excluded from this change. |
| Clean source and release suite | PASS at `01641786fa756c85540d4e3b3fcf470f7a5a85b9`: source syntax, types and formatting; 321/321 release tests. A disposable clean clone excludes the unrelated untracked test. |
| Clean package build and notices | PASS: alpha.4 runtime, crate, tools and combined ZIP build from clean source. Exact four-file notice comparisons pass at five boundaries, including the embedded skill. All package declarations are Apache-2.0. |
| Installed package acceptance | PASS on macOS arm64 with Node 22.20.0 and Rust 1.96.0: eight real Chromium groups, 10 CLI cases, 25 finalization cases and nine control cases; owned cleanup PASS. This is independent-fixture acceptance, not WBF onboarding or published-release acceptance. |
| CI | PASS, Node 22 and 24, [run 39999144306](https://github.com/givtaj/browser-driver/actions/runs/39999144306): source, browser and exact packaged-consumer gates. [PR #6](https://github.com/givtaj/browser-driver/pull/6) merged as `bf7d86acec0cca207f58d8d118af98ccf3d1599b`. |
| Site publication | PASS, [run 40000221353](https://github.com/givtaj/browser-driver/actions/runs/40000221353) published the licence notice from the merged source through the existing renewal workflow; all workflow steps, active-deployment verification and temporary-key cleanup passed. |

Evidence remains under ignored `artifacts/apache-license/`. The isolated website
browser and preview server were closed. This is a licence/package migration;
alpha.4 representative-customer acceptance and release publication remain separate
gates. Clean evidence is retained in `artifacts/apache-license/clean-validation/`.
The local alpha.4 manifest SHA-256 is
`462bf822bc9bb52b08e939ca1ba0ff0a1fc7c895d1ea3297922b93081b527e48`;
portable tools SHA-256 is
`8677bcd73263af905229b75f9dc5a24e685292ee92543d9b65138723021c1ccf`.

Production restored the authenticated generation-4 checkpoint (`bootstrap:false`)
and published **generation 5**, expiring `2026-10-30T18:04:25.230Z`. Raw catalog
SHA-256: `c7ea7b0d2a1697a987dc947cdfc96c90c8dbbfb6b2542ca591d341c7b4494b2f`.
Active Worker version `cc75fed4-c42a-4e2b-8cd3-941d5ce1ec11`, deployment
`5a38b635-ef40-45f9-b68a-5c21e8b9821c`, was verified at 100% traffic at
`2026-10-23T18:04:41.345Z`. The prior Worker version was
`e633db1f-60e1-42b8-a8a2-93a08ace014d`; a recovery must preserve the highest signed
catalog generation rather than replaying the older feed.

Independent canonical-site readback passed for **28 exact public files**, four
security headers, immutable/revalidation cache rules, all nine historical release
files and **nine private-path 404 boundaries**. The generation-5 feed signature,
expiry, unchanged release entries, pinned public key and stability through the
check passed. Receipts and reconstructed expected bytes are retained in
`artifacts/apache-license/live-zUuHXX/`. The site distinguishes the upcoming
Apache-2.0 public core from the still-published alpha.3 mixed-licence kit. No alpha.4
GitHub Release, registry publication, feed entry or customer installation occurred.

## Unified website onboarding — published and verified, 2026-10-23

The canonical `/install` journey now puts one complete Codex prompt before manual
references. It covers verified installation, the opened project (including WBF),
one accepted flow plus negative/persistence/relaunch evidence, and Ninja-Update
registration. Home, guide and updates lead to that same entrypoint; updates no
longer contains a competing setup prompt. The frozen alpha.3 kit and historical
public evidence remain unchanged. This entry records website acceptance; actual
WBF installation, project acceptance and its upgrade/rollback drills are **NOT RUN**.

| Check | Actual result |
| --- | --- |
| Regression before implementation | Genuine FAIL: missing single accessible prompt, copy control and canonical updates link; 1/6 passed. Retained `regression-red.log`. |
| Staged website | PASS, 55/55 tests, including six new onboarding-contract checks. All seven pages have allowlisted links; three immutable archives verified; 30 public entries including control files. |
| Clipboard and browser acceptance | PASS, 9 checks in headless Chromium on the staged local site: desktop 1280px, narrow 390px, exact complete 4,791-character payload, real Clipboard API readback in an isolated permission-granted context, denied-copy selection/feedback, JavaScript-disabled manual prompt, canonical updates link. No horizontal overflow; browser/server cleanup passed. |
| Visual review | PASS: root inspected the desktop preview in the app browser; desktop, narrow, denied-copy and no-JavaScript screenshots were inspected. No customer application was involved. |
| Renewal pipeline | Genuine FAIL first: exact served asset count expected 27 after adding the copy script. Corrected to 28 with an explicit byte comparison for staged `onboarding.js`; 22/22 affected renewal tests passed. |
| Source quality | PASS: `npm run check`, affected website formatting and copy-script syntax. No Rust/runtime implementation changed. |

Evidence is retained under ignored `artifacts/unified-onboarding/`: the red/green
logs, manifest, staged site, and `browser-Qs27lC/results.json` with six screenshots.
The earlier `browser-p9YECO/` retains its eight-check run and the full-page screenshot
capture artifact; the final run adds native clipboard readback and resets scroll
before screenshots. Publication is separately verified by the existing production
renewal workflow, which carries the new allowlisted asset through its frozen source
manifest, live-byte checks and increasing signed catalog checkpoint.

[PR #5](https://github.com/givtaj/browser-driver/pull/5) merged as
`50633f39644e4d4dfea6f54542e2f563c5cd1036` after branch and PR CI passed on Node
22 and 24, including source/browser and packaged-consumer acceptance. Production
[run 39959873260](https://github.com/givtaj/browser-driver/actions/runs/39959873260)
restored generation 3 with `bootstrap:false`, then signed, checkpointed and
published **generation 4**, expiring `2026-10-30T13:17:14.785Z`.
It verified active Worker version `e633db1f-60e1-42b8-a8a2-93a08ace014d`, deployment
`c03d8a03-518d-4dd0-b69b-ded69503f141`, serving 100% at
`2026-10-23T13:17:29.708Z`. Every workflow step passed, including temporary key
cleanup. The key and all three immutable release downloads remain unchanged.

Independent canonical-site readback passed for **28 exact served files and nine
private-path 404 boundaries**. The live `/install` page and copy success feedback
were inspected in the app browser. `publication.log`, `checkpoint-generation-4/`,
`live-expected/` and `live-apex.json` under the same evidence directory retain this
publication proof. Site publication does not change repository visibility or
licensing: the development repository is private; the public kit includes source
under the existing MIT AND Apache-2.0 component terms.

## Automatic catalog renewal — activated and verified, 2026-10-23

Daily **04:23 UTC** renewal is active on `main`. Two manually dispatched runs
passed the complete workflow; **the first unattended scheduled run has not yet
been observed**. The same production key is stored in `DAEDLO_UPDATE_SIGNING_KEY`.
After explicit approval, the token scoped to **Individual Workers → daedlo → Editor**
was stored in `CLOUDFLARE_API_TOKEN`; the account ID is a repository variable.
The key, immutable release archives and customer installation interfaces are unchanged.

Recovery [PR #3](https://github.com/givtaj/browser-driver/pull/3) merged as
`a99878c8c00bdd084e3db41d95c248acbfd89317`. Main-branch CI
[39947163715](https://github.com/givtaj/browser-driver/actions/runs/39947163715)
passed on Node 22 and 24; source quality and the 165-case focused suite passed.

| Renewal | Actual result |
| --- | --- |
| [Run 2, 39948319111](https://github.com/givtaj/browser-driver/actions/runs/39948319111) | PASS at `2026-10-23T11:46:19Z`: exact reviewed initial-failure recovery, generation 2 signed and checkpointed before publication, complete staged-site checks, activation and live verification. |
| [Run 3, 39948603151](https://github.com/givtaj/browser-driver/actions/runs/39948603151) | PASS: restored run 2's authenticated generation-2 checkpoint with `bootstrap:false`, then signed, checkpointed, published and verified generation 3. All workflow steps passed. |

Generation **3** was issued at `2026-10-23T11:48:13.935Z` and expires at
`2026-10-30T11:48:13.935Z`. Raw catalog SHA-256:
`24995adfb74804a8c45308de9961176c1c95b3b0df29d9c04845badb75ea0a94`;
signed-payload checkpoint:
`d9268507939c0b90fa114f6f7b07ec68b125201ca9e97d67cecd6b4af7c0da74`.
The workflow verified Worker version `4fc429c3-8128-4bfd-a9c4-70fed5378299`,
deployment `c1d8b720-a19a-458e-b979-da3c05a538b3`, serving **100%** at
`2026-10-23T11:48:26.988Z`. It verified the exact apex assets, signed feed,
cache/security headers and private-path boundaries. Both durable public
checkpoints and masked logs are retained under `artifacts/ninja-renewal/`,
including `checkpoint-run-2/`, `checkpoint-run-3/` and `renewal-run-3.log`.
Independent root readback at `2026-10-23T11:51:34.986Z` confirmed the same active
version, deployment and exact generation-3 bytes (`active-generation-3.json`).
The live update page displayed the matching expiry and renewal guidance. The
owned temporary local deployment-token file and directory were then removed;
the protected production signing key and authorized GitHub secrets remain.

The unchanged published alpha.3 provider independently consumed generations 2
and 3 over actual HTTPS. Each check downloaded and verified all six immutable
alpha.2/alpha.3 assets and both complete kits. The generation-3 check preserved
the authenticated generation-2 floor; all assets matched across renewals, all
37 installed tools files and the PEM/SPKI pins remained unchanged, and owned
download cleanup passed. Receipts are `consumer-generation-2.json`,
`consumer-generation-3.json` and `consumer-generation-3-checkpoint.json` under
the same evidence directory. This checks published consumer compatibility;
the unchanged application upgrade/rollback acceptance remains recorded below.

Initial dispatch [39946067474](https://github.com/givtaj/browser-driver/actions/runs/39946067474)
passed all 113 pre-secret checks and initial checkpoint restoration, then failed
preparation on an unexpected public HTTP status. It created no checkpoint artifact;
validation, upload, activation and live verification were skipped, and temporary
key cleanup passed. Its masked failure log is retained. The recovery adds safe
path/status diagnostics, a separate read-only runner probe and a single reviewed
exception bound to the exact failed run and original generation-1 floor. No
renewal retry is authorized by an unknown response or missing history.

The initial read-only runner probe
[39947177085](https://github.com/givtaj/browser-driver/actions/runs/39947177085)
completed all **44 GETs**: every response was **403** with `cf-mitigated: challenge`,
on both apex and provider origins and with both tested user-agent variants.
There were **zero successful HTTP responses**; a completed diagnostic job is not
a delivery pass. Its bounded metadata log is retained as
`artifacts/ninja-renewal/feed-probe-live.log`.

The release owner's Cloudflare dashboard inspection of the owned
`/updates/preview.json` probe identified **Interactive Challenge** from
**Access rules: Country**, matching the existing US rule applied to all websites
in the account. Rules also challenge CA, NL, VN, TR, CN and RU. Automated clients
cannot complete that interactive challenge. Prior published-package acceptance
below remains evidence for its exact bytes and tested environment, not proof of
current worldwide delivery.

After action-time user approval, a **US Allow rule scoped only to daedlo.com**
was created. [Probe 39948105153](https://github.com/givtaj/browser-driver/actions/runs/39948105153)
then returned **22/22 HTTP 200 on the apex**, while **22/22 provider-host requests
still returned 403**. The account-wide US challenge and other rules are unchanged.
Country Allow bypasses custom and rate-limiting rules for matching Daedlo traffic,
including future rules; the exception is broader than the feed path alone.

The user's priority is **Spain and the US**. Baseline public regional probes
verified generation 1 in **6/6** requests from DE, FR and ES (two each); **2/2 NL**
requests received challenges. The user explicitly declined an NL exception; its
form was cancelled and no NL rule changed. CA, VN, TR, CN and RU remain
configuration-based reach risks, not executed regional checks. Final generation-3
checks from two Spain and two US locations passed **4/4 feed GETs**, each matching
the exact catalog hash and Ed25519 signature, plus **4/4 ZIP HEADs** returning
HTTP 200, `application/zip`, immutable caching and no challenge. The retained
assessment is `eu-probes/priority-generation-3-assessment.json` under the evidence
directory. The original diagnostic failure for an extra, absent `Content-Length`
header is preserved; HEAD proves reach and response metadata, while the separate
consumer checks above verify complete ZIP bodies. These are sampled regional
results, not countrywide or worldwide guarantees; the provider hostname is not
the canonical download endpoint.

Manual run 2 consumed the one-off recovery exception successfully before the
daily schedule could consume its run number. Run 3 used the normal durable
checkpoint path. Later failures must follow authenticated checkpoint recovery;
the initial exception cannot be reused or broadened by deleting history.

Before the initial dispatch, the workflow, signer orchestration and signed-checkpoint
restoration passed independent review. Its pre-secret command passed **113 tests**
with no skips, including 19 renewal and 15 checkpoint cases. Genuine failing
assertions preceded the initial implementation and review fixes for canonical
HTML redirects, checkpoint receipt changes, missing newer artifacts, deleted run
history and stale reruns.

A local preflight used the real production feed and protected key to prepare an
isolated generation 2 candidate without deploying it: **49 website tests**,
seven-page/three-archive acceptance, exact 30-file manifest revalidation and
Wrangler 4.147.0 deployment dry run passed. The rendered renewal copy and expiry
were inspected. That unpublished candidate is not an issued production checkpoint.
Evidence is retained in ignored `artifacts/ninja-renewal/`.

Quality checks passed. The full 246-case release run passed 245 and exposed one
packaged-guide reference failure introduced by the new maintainer documentation.
Those references were corrected without changing assertions; all eight portable
tools tests then passed, including exact offline consumer installation. The
initial failed result is retained. Full source/browser/exact-package push CI on
`74cf5398ce017d19d18f05e35916cc87db2ec8cb` passed on Node 22 and 24, run
[39942884250](https://github.com/givtaj/browser-driver/actions/runs/39942884250).
The same-tree PR run passed Node 24 but Node 22 timed out waiting ten seconds for
an installed CLI fixture to exit after its functional assertions passed. Its
cleanup cause was not established from the original logs. Test-only bounded,
sanitized resource-phase diagnostics were added without changing the timeout or
assertions; the focused ten-case CLI suite passed. Runtime code and published
assets were unchanged. Failed evidence remains in `artifacts/ninja-renewal/ci-review/`.

These changes preserve immutable alpha.3 assets and its frozen source tag;
the original published upgrade/rollback acceptance below remains valid for those
exact bytes. The [publisher runbook](ninja-publishing.md) describes daily 04:23 UTC
operation, secret custody, durable public checkpoints and recovery that refuses
a lower generation. Workflow publication and checkpoint continuation are verified;
the first unattended cron execution remains a separate unobserved event.
The final seven-document activation record passed independent evidence review,
syntax and diff checks, and all eight portable-tools checks, including the exact
offline consumer installation; the log is `artifacts/ninja-renewal/final-docs-portable-tools.log`.

## Published Ninja-Update alpha.3 — 2026-10-23

**Published** at [Daedlo](https://daedlo.com/install), with the
[signed production feed](https://daedlo.com/updates/preview.json) and
[versioned prerelease](https://github.com/givtaj/browser-driver/releases/tag/v0.1.4-alpha.3).
The earlier local alpha.3 candidate below is historical evidence with different
bytes. This release was built from clean source
`558366b6b4de9a158a9ad49bb7b45d3080d5497e`, tree SHA-256
`5974624f8a85af01ff2404779f53d9117d8bab5183ce152cd45dd1fc3c8f15f1`.
Its ZIP is **206,234 bytes**, SHA-256
`f569bc0c84bf1b7ac5efe59c610916ac8ab0d5bb3322ed520114d8880262b190`;
bundle manifest `f2d977da2756997671c63f052dc7c387496aba7fb578d046042fd9204f31de6a`;
tools `56b6c5f1663dc633870a58ba1c3e6322f03b2182ab64947b61fe2a58ab70adf3`.
Later delivery documentation does not change the signed or packaged bytes.

| Executed gate | Actual result |
| --- | --- |
| Source and release checks | PASS: syntax/types/format, 212 release checks with no skips; Node 22/24 source, browser and exact-package CI on frozen source, run [39936785918](https://github.com/givtaj/browser-driver/actions/runs/39936785918). |
| Exact installed package | PASS: eight browser/API groups, 10 CLI, 25 finalization and nine browser-control cases; owned processes/directories cleaned. |
| Exact downloaded installer | PASS: fresh HTTPS downloads of all three files match the frozen kit; the downloaded START_HERE block installed offline with a fresh npm cache in an isolated nested workspace. All 37 installed tools files and bundled production trust match their inventory; ancestor/repository manifests unchanged. |
| GitHub asset read-back | PASS: exactly three published assets, correct frozen source target, each byte-identical to both the frozen kit and fresh Daedlo download. |
| Final kit before publication | PASS: eight Architecture Studio upgrade/rollback/integrity checkpoints using the final installed tools and a local signed catalog; 21 main browser runs, three intended saves, four closed reports and cleanup. Independent visual inspection was not repeated in this prepublication run. |
| Published feed application acceptance | PASS: all eight checkpoints with actual HTTPS discovery/downloads, independently pinned production key and newly downloaded installed tools. Independent live Updated/Reverted inspection passed; final integrity, durable reports, relaunch and owned cleanup passed. |
| Website | PASS: 49 tests, seven pages and three archives; frozen manifest preserved; actual installation/update pages inspected. Both live origins serve all 27 files byte-identical, with nine private paths returning 404 each, security headers and correct mutable/immutable cache policies. |

Published run `customer-published/run-ESmQK9/` authenticated the production catalog
and downloaded both releases without an injected fetch transport. The unchanged
accepted integration passed on public alpha.2. A deliberately rejecting hook,
after its real isolated checks, left alpha.2 and the data intact. The accepted
alpha.3 then installed and activated; rollback selected the complete retained
alpha.2 installation. Exact data and the model descriptor were unchanged at both
switch boundaries, before repeating the accepted flow. Invalid input produced no
write; each intended save agreed across response, independent API and disk reads,
then restored the fields on reload. The state model, flows, adapter, configuration,
locks and instructions stayed unchanged, as did 119 pinned application source
files, 18 accepted integration files, all 23 registered inputs and 37 installed
tools files. Existing model checks passed (13 Rust and seven Node). Four final
session reports recorded owned closure; driver relaunch passed while the attached
application survived. Independent background IAB inspection confirmed selected and
running versions and the actual controlled application after both switches. The
test finished at `2026-10-23T10:26:35.780Z`; private evidence and retained isolated
installations remain available for audit.

The production signer verifies exact public kits before signing, rejects unsafe key
files and preserves prior authenticated entries during renewal. Meaningful failing
assertions were recorded before implementation; 20 focused publisher cases passed,
including the exact retained alpha.2 kit (19 are in the standard release suite).
Public-trust packaging tests first failed on missing files, then passed. Website
regressions covered raw-file versus signed-payload digests and independent trust
wording; published-mode configuration checks reject partial or altered trust.

At initial publication the feed was generation **1**, issued `2026-10-23T10:16:16.000Z`, expires
**2026-10-30T10:16:16.000Z**, and authenticates alpha.2 and alpha.3. Raw envelope
SHA-256: `09fcadcbbf1a7bcdb6300d8489faf4949477997550e0a4993ab553c40e22e80e`;
signed-payload checkpoint: `bde773d01a3cb0bb33330b74b17dd7e5068e33fb650a55d558d446a10f5bbad0`.
Ed25519 key `daedlo-release-2026-10` is independently pinned in
`docs/update-trust/production.json`. The private key remains local, owner-only,
outside Git/packages/site; an off-device backup is **NOT VERIFIED**.
At initial publication renewal was manual and no cloud signing secret was
configured. The later automatic-renewal section above owns current setup status. Expiry blocks new update checks/downloads, not accepted
local use or verified local rollback. See [publisher operations](ninja-publishing.md).

Operational evidence retains the initial canonical-timestamp configuration refusal,
the local-preview checker failing its production-only CSP expectation, and live
read-back initially refusing Cloudflare's 307 HTML canonical redirects. The final
checker follows only the observed exact same-origin HTML canonical paths; catalog,
key and release requests still reject redirects. Wrangler retried two transient
asset-upload failures before successful deployment. No product browser assertion
was weakened and no private data entered the public tree.

Evidence remains in ignored `artifacts/ninja-production/`: final package receipts,
`exact-installed/`, `published-installer/`, `customer-prepublication/`,
`customer-published/`, website checks and both live read-backs. Supported acceptance
is macOS arm64 with existing toolchains/caches and a pinned Architecture Studio
synthetic fixture. WBF, clean OS setup, Linux/Windows customer onboarding and Claude
Code onboarding are **NOT RUN**. Runtime rollback does not undo application writes.
Browser identity checks do not seal linked frameworks. No everyday Roots checkout,
dependency pins or services were changed.

## Operation Ninja-Update local implementation — 2026-10-23

**Local alpha.3 candidate, not published.** The external manager now implements
signed public-kit discovery, project registration, isolated runtime/dependency
installation and unchanged-model builds, acceptance/health gates, a local
Install/Restart/Revert screen, atomic activation, failed-boot recovery and
historical whole-installation rollback. See [the client contract](ninja-update.md).
The public alpha.2 release and ordinary Roots dependencies are unchanged.

Source validation: 129 runtime, 23 Rust and **193 release checks PASS**, including
the managed updater's integrity, lifecycle, concurrency, HTTP security and real
OS-process crash cases. Syntax/types/format checks PASS. Two independent Chromium
update-screen tests PASS; their controller fixture is distinct from the following
real application proof.

Architecture Studio source-manager acceptance: **seven checkpoint groups PASS**.
Pinned application `d8cb9396609b722418015cdd3367b3ef659aeb69` (119 source files),
18 existing integration files and all 23 registered inputs remain unchanged.
The exact published alpha.2 kit was installed, a deliberately rejected alpha.3
acceptance hook left alpha.2 running/data intact, then the compatible local alpha.3
activated and reverted to the complete alpha.2 slot. Both switches preserved exact
application data and the state/command/recipe descriptor. The same invalid-input,
save/read-back/reload flow passed on each version: zero writes for invalid input,
one PUT for each intended save, with independent API/disk agreement. Existing
model tests (13 Rust, seven Node) passed in the isolated builds. Four final session
reports show owned-resource closure; an explicit driver relaunch preserved the
attached application. Root inspection confirmed the actual updated control and
application viewer; rollback screenshots and all cleanup receipts were retained.

Exact installed-package acceptance: **eight checkpoint groups PASS**, repeating
the complete alpha.2 → rejected candidate → alpha.3 → alpha.2 sequence through
the installed tools' real control page, provider, isolated build and supervisor.
Both Updated and Reverted control/application views passed independent live
inspection. The same source, descriptor, exact data, save/no-write, four final
reports, driver relaunch and attached-service assertions passed. All 35 installed
tools files match their frozen inventory before/after. Owned processes and ports
were closed; evidence and isolated installation directories were retained.
Receipt: `artifacts/ninja-update/customer-packaged/run-aIWtrN/result.json`.

The tested unpublished alpha.3 kit was built from clean source
`4948b81bf5d57de71888aeca0293a24288a0373b`, source-tree SHA-256
`7a06b78300e3159cfb1fcb82482d648d870e66be38ce26d809ec0e4af1a2a8d1`.
ZIP SHA-256 `628a49cebeac853e66f3755e78e134d4a3e76987e9c9ec382c34003e8be1882b`;
bundle manifest `090c88b081df2788afb7f739952cfa1bb30651cb91500a9e7af3c33b492964e1`;
tools archive `f6e6f4031f4faea0ab5c9923f0b5ea889236c21ba26a99832505191c013f7397`.
The tools were installed outside Git with a fresh offline npm cache. Subsequent
documentation records this evidence and clarifies that only npm lifecycle scripts
are disabled: Rust builds/tests and registered hooks execute trusted code, whose
isolation contract is not an OS sandbox. That documentation follow-up does not
change the frozen, tested executable bytes or constitute publication.

Genuine regression failures retained separately include missing implementation
assertions, accepting overridden fetched catalog bytes, failure to reject a final
dirty draft, missing closed-resource status in the durable shutdown report,
modified browser dependency/receipt/source paths, and absent acceptance evidence.
Setup/import/fixture-lifecycle errors are not counted as browser scenario failures.
The first fixture lifecycle failure and two stale-view refusals remain recorded
as failed runs; neither is rewritten as success. The passing source run is
`artifacts/ninja-update/customer/run-qYHzFV/`. Private logs and frozen unpublished
candidate receipts remain in ignored
`artifacts/ninja-update/` and `artifacts/ninja-update-20261023/`.

At this earlier local checkpoint, the catalog tests used an ephemeral explicitly
trusted signing key, including the exact published alpha.2 ZIP, and the production
update feed/signing key was unconfigured. See the subsequent publication above.
Browser receipts bind executable SHA-256 and observed version; they do not seal
the external browser distribution/frameworks. WBF was not accessed or accepted.
Publication, customer onboarding and cross-platform acceptance remain separate.

## Operation Ninja-Update design review — 2026-10-23

Recorded the [upgrade design and delivery plan](operations/ninja-update.md) after
reviewing released source `a0dfa27296014cf455a90938d0a641f1c7f9bdfe`.
This is a source/documentation review, not an implementation or acceptance run.
Current archive-store update/rollback does not install dependencies, rebuild a
customer engine or activate a launcher. The legacy GitHub bundle downloader also
expects a different asset inventory from the public alpha.2 kit.

The proposed managed updater preserves customer model/adapter source and data,
rebuilds derived artifacts separately, validates the selected combination, and
retains the previous complete installation. Compatibility preflight cannot reuse
ordinary CLI startup against production: the customer factory and navigation
precede model validation. NINJA-01 through NINJA-06 remain planned. No WBF system
was accessed, no upgrade UI was added, and no new release or promotion occurred.

## Public assisted alpha 0.1.4-alpha.2 — 2026-10-21

**Released** at [daedlo.com/install](https://daedlo.com/install) and the
[versioned GitHub prerelease](https://github.com/givtaj/browser-driver/releases/tag/v0.1.4-alpha.2).
The exact kit was built from clean source `044e76df10e90c68e9e3c7ff35e7c63a62354c60`,
source-tree SHA-256 `6dd4febaa1f41ad6380f4e8cdac17704dd6d824162e08631e26777ed60257e45`.
ZIP SHA-256 `b9555b6b237ac437f62b984f6994e3ef12ba4e8f95b730f52c9aa9313a375ee1`
(160,545 bytes); bundle manifest SHA-256
`0338ed7d161c98e7ebced668ddc77ca5520ba14480b0c67369bb81d71e5be8c7`.
Later website/evidence documentation commits do not change the packaged source.

| Executed gate | Actual result |
| --- | --- |
| Installer regression | Genuine nested-workspace failure before the fix; standalone and nested cases now PASS. The exact shipped block also passed with real tools and a fresh offline npm cache; ancestor files unchanged. |
| Source checks | 129 runtime, 23 Rust and 11 archive tests PASS; source quality, locked build, format/Clippy PASS. After installer correction, 105 release tests PASS. Source browser groups and controls described below passed; alpha.2 runtime/model code is unchanged from alpha.1. |
| Exact installed alpha.2 | Eight browser/API groups, ten CLI, 25 finalization and nine browser-control cases PASS; no skips/failures/cancellations; installed bytes unchanged; owned cleanup PASS. |
| Real application | Pinned Architecture Studio, synthetic data: seven acceptance checkpoints PASS; 13 Rust and seven Node checks PASS. Invalid empty name causes zero writes; exact save matches response/API/disk; reload restores fields; shutdown exports reports; attached fixture survives; CLI/browser relaunch repeats the flow. Live viewer inspected. |
| Final integrity | 22 runtime, 26 tools and 11 crate files match the frozen archives before/after; 119 pinned application files and accepted model/adapter unchanged. All owned processes closed; fixture/viewer ports released. |
| Remote CI | Clean source `044e76d`: [push run 39634235043](https://github.com/givtaj/browser-driver/actions/runs/39634235043) and PR run 39634245064 PASS, each on Node 22/24 Ubuntu, including complete public-kit assembly. |
| Public contents | ZIP plus nested archives checked across 72 file boundaries: inventories/digests and canonical MIT/Apache notices PASS; no detected private paths, credentials or evaluation drafts. Only sanitized verification metadata is published. |
| Website | 31 tests PASS; six-page/two-archive acceptance PASS. Desktop and 390px mobile review: no overflow or browser errors. Exact rendered installer matches the tested kit guide. |
| Public delivery | Wrangler 4.147.0 dry-run and deployment PASS. Active version `8eebf633-35e6-498a-ae19-67f867c1b878` at 100%; all 21 served assets match frozen bytes on both apex and provider origins, seven private/missing paths return 404, CSP and nosniff present. Public installation page inspected. |
| Downloaded installation | Fresh HTTPS ZIP, checksum and metadata exactly match the frozen release. The downloaded START_HERE block exits successfully with an initially empty npm cache; all 26 tools files and 13 extracted kit files match. Parent manifests unchanged; temporary workspace removed. |

Scope: assisted macOS arm64 with Codex and existing toolchains/caches. Linux CI
is technical coverage, not Linux customer onboarding. Windows, Claude Code,
clean-OS setup, independent self-service onboarding, email delivery and customer
adoption remain unverified. Customer relaunch covers the CLI and controlled
browser, not an application-server restart; that flow does not establish broad
concurrent-writer or save-fault coverage. Everyday Roots promotion remains
separate and incomplete.

Private receipts are retained in the isolated alpha worktree under
`artifacts/alpha-20261021/alpha.2/`, `customer/alpha.2/`,
`site-alpha2-review/` and `site-final/`. The public `release.json` contains only
selected package identities and scoped results. Alpha.1, its installer failure,
and the historical rc.1 demonstration remain separately identified below.

## Alpha installer isolation correction — 2026-10-21

**0.1.4-alpha.1 was withheld, not published.** Its exact installed package passed
eight browser/API groups, ten CLI cases, 25 finalization cases and nine browser
control cases with cleanup PASS. Clean source `216d188` also passed the complete
Node 22/24 Linux CI [run 39632283284](https://github.com/givtaj/browser-driver/actions/runs/39632283284).
The separate pinned Architecture Studio fixture passed invalid-name zero-write,
exact save/read-back/reload, final report export, owned shutdown, attached fixture
preservation and CLI/browser relaunch with a repeat save. Its seven acceptance
groups and post-run integrity seal passed; the live viewer was inspected.

The shipped tools-install block failed when extracted beneath an npm workspace:
npm added a tools dependency to the ancestor manifest/lock instead of the intended
`installed-tools` directory, then the local verifier could not be found. The guide
recommended outside-workspace extraction, but the command still needed to preserve
the parent project in this common placement. Two setup receipts and the accidental
diffs are preserved. Only those owned changes were removed, with byte equality to
the committed manifests checked before restoration. No normal customer checkout
or everyday Roots dependency was changed.

A new regression executes the exact rendered shell block with real npm and an
offline tools fixture. Before the fix, standalone installation passed and nested
installation failed at the genuine parent-manifest preservation assertion.
The corrected block supplies an explicit installation prefix and disables npm
workspace targeting. Both cases now pass, including unchanged parent manifests,
lockfile and sentinel, expected local package path, and execution of the local
verifier against the expected bundle/digest. **105 release checks pass** after the
fix. Runtime/model behavior is unchanged.

The corrected target is **0.1.4-alpha.2**. Its clean build, exact-package acceptance,
customer rerun, selected-commit CI and public delivery remain pending at this
checkpoint. The alpha.1 ZIP and its passing/failed receipts remain separate.
Private evidence: `artifacts/alpha-20261021/`, including
`installer-regression-red.log`, `installer-regression-green.log`,
`release-tests-alpha2.log`, `installed-acceptance/`, `remote-ci.json`, `customer/`
and `site/installer-check.json`.

## Alpha source preparation — 2026-10-21

Prepared isolated branch `codex/daedlo-alpha-release` from clean checkpoint
`a563871`, targeting **0.1.4-alpha.1** with the existing public MIT/Apache notices.
The mixed everyday checkout and normal Roots resources are preserved. This
checkpoint establishes source verification, not publication or customer adoption.
The [alpha delivery record](alpha-release.md) defines the supported scope/gates.

Fresh macOS arm64 checks used Node 22.20.0 and Rust 1.96.0 with existing toolchains
and caches. No clean OS installation or other-platform result is claimed.

| Fresh check | Result |
| --- | --- |
| Runtime | 129/129 PASS |
| Rust | 23 tests PASS; locked build, formatting and Clippy with warnings denied PASS |
| Source quality | JavaScript syntax, public declarations and configured formatting PASS |
| Release and public-kit contracts | 103/103 PASS, including the 21 restored public/license checks |
| Historical workbench | 11/11 PASS; serving/archive checks, not fresh Roots application acceptance |
| Source Chromium | Eight notebook browser/API groups, nine controls cases, ten CLI cases, four motion cases and two viewer cases PASS |
| Independent review | Release scope, portable onboarding, CI kit assembly and installed-control helper reviewed; no blocking finding |
| Exact alpha package, fresh real application, remote CI, publication | PENDING at this source checkpoint |

The source unchanged from roots.8 includes its previously reproduced runtime
fixes. This turn adds release verification and documentation: the missing public
kit/license test suites are maintained on the release branch; installed acceptance
now also requires exactly 10 CLI, 25 finalization and 9 browser-control passes
with no skipped/cancelled cases before checking unchanged package bytes. CI builds
the complete tools/ZIP distribution as well as the four-file bundle. Fresh default
motion/viewer evidence directories preserve previous runs.

Private logs are retained under ignored `artifacts/alpha-20261021/`; motion/viewer
logs and screenshots are under `artifacts/alpha-test-integration-20261021/`.
The new installed package and customer results must be recorded separately when
they actually run. Historical Roots evidence availability and recovery limits
below remain unchanged.

## Durable recovery checkpoint — 2026-10-21

The isolated Roots recovery source is committed locally as `a52a5ee7ba1abfe91f73b71d6ba6fce62a79695e`
in the owner’s isolated Roots recovery checkout (local path omitted).
Independent review verified 49 reconstructed source files, 27 reviewed A05/A08
inputs and 161 application files. Later authentication pilot changes are excluded.
48 final source hashes match historical tool output; one provenance test has
complete literal source-write lineage without a printed historical hash.
This is a new source checkpoint, not restoration of the lost Git commit or receipts.

Fresh tests pass: 53 focused Node, 75 original-model and 88 candidate-model Rust,
55 promotion-contract/inventory checks and two installation corruption refusals.
The exact installed roots.8 runtime (22 files) and crate (11 files) match the
immutable package. Full source/database and browser acceptance are pending on
this recovered source. Normal Roots defaults remain unchanged.

Shared-driver source at documentation checkpoint `af83862` and 276 available
private evidence files have a fresh bundle/archive restoration under the durable
recovery directory. Independent verification confirms all 202 tracked source
files and all evidence bytes, clean restored HEAD, bundle verification and Git
integrity. This is local source/evidence preservation; it does not restore missing
Roots receipts, dependencies, databases or an active normal session. New review
receipts are retained separately for a later closure archive.

## Evidence availability check — 2026-10-21

The shared driver implementation and immutable roots.8 package remain available.
A read-only integrity review rechecked 22 recorded file hashes, including the
installed-package receipts and logs, both ZIP copies, the preserved full-history
source bundle, release metadata and runtime source. All match. The source bundle
passes `git bundle verify`, the managed repository passes `git fsck`, and its
implementation is unchanged from `42ef2a3`; the later `b74e830` checkpoint changes
only documentation. The source and exact installed-package test evidence below
remains inspectable; these tests were not rerun for this availability review.

The temporary Roots consumer `/private/tmp/roots-daedlo-resume-20261019` is absent
at this check. Its ignored Roots acceptance receipts and native evidence are not
available at their recorded locations. The cause of the directory's disappearance
has not been established. The final integration archive and strict closure were
not completed, and no replacement is claimed. Recovery is in progress; recovered
source must be verified, and unavailable acceptance evidence must be recovered or
replaced by fresh isolated runs before it can support promotion.

The October 19 Roots results below remain historical observations, including the
passing paired runs and genuine earlier failures. Missing raw evidence does not
turn those observed passes into failed tests, but prevents their current independent
reinspection. The earlier driver source restoration is also historical: its
receipt and valid bundle survive, while the named temporary restore directory is
absent. That restoration never covered the final Roots integration. Migration
promotion remains incomplete and the current Roots driver stays in place.

The metadata-only integrity receipt is in ignored
`artifacts/resume-20261021/driver-integrity-review.json`. Shared source/package
receipts remain in this worktree's ignored `artifacts/resume-20261019/`.

## Roots migration: historical roots.8 local acceptance — 2026-10-19

The preserved fixes are integrated on `codex/daedlo-roots-fixes`. The current
unpublished candidate is **0.1.3-roots.8**, built once from clean implementation
commit `42ef2a380d20a4ea59a45f864467f60eade4da35`. Its immutable ZIP SHA-256 is
`fe807d75ed2569e29228e7be8bbf5e576a0de2c97149f7589ce85c55ceff5d76`.
Later documentation commits do not change the packaged source identity.
The normal Roots driver remains the default. Migration promotion is incomplete.

| Executed October 19 check | Recorded result and scope; see October 21 availability above |
| --- | --- |
| Shared source | Runtime 129/129 and release tooling 82/82 on both Node 22 and 24; Rust 23 tests, locked build, Clippy, formatting, JavaScript syntax and public types PASS. |
| Exact installed roots.8 | Independent consumer: eight Chromium/API groups, ten CLI browser cases, 25 publication lifecycle cases and nine publication browser cases PASS. Runtime and crate files match the immutable archives before and after; recorded owned cleanup PASS. |
| Paired Roots application | Both original and candidate PASS 189 actual cases: 105 primary plus 84 companion. The 110 main/wrapper rows include five wrappers, not five extra cases. Both full02 runs use frozen Roots `df301b1`, finish with exact source/binary provenance and zero drift. |
| Commands, recipes and controls | Candidate 74 successful public commands, 74 stale guards, all 18 recipes, ten viewer/control groups, three receipt groups and four completion groups PASS. Direct commands exclude recipe internals. |
| Additional application observations | Paired real-request Journal pending checks (three each) and Profile/sign-in residual checks (five each) PASS. Literal observed states and named temporal/business outcomes are recorded separately. |
| Independence and recovery | Six direct browser groups PASS under explicit source-read denials. Missing observations and incompatible contracts fail closed. Four isolated update/rollback checks PASS, preserving session, draft, data and exact-one writes across the recorded attachments and restart. |
| Roots source/database and packaging | Complete serial source/database checks PASS at recorded `612864a`: all six database modules and 148 frontend tests, build and lint. Source-input equivalence to final integration is recorded; later QA-only verifier/readiness changes have separate checks. The development web Docker build PASS; no production serving claim. |
| Preservation and final strict decision | Final integration bundle/evidence restore and final strict receipt are pending at this documentation checkpoint. Earlier package/source restoration passed; it does not stand in for this final checkpoint. |

The first roots.8 full candidate run remains **188 PASS / 1 FAIL**. Its creation
case used direct DOM clicks without waiting for the disabled Save button to become
ready. A real Roots regression held the readiness responses: the old native
action produced no POST and failed the intended assertion; the corrected action
waits for enabled state before the same rapid-click burst and produces exactly
one POST and one row. Both complete full02 reruns pass the corrected case. This
confirms a mechanism consistent with the original failure; the button state at
that original instant was not captured. No application assertion was weakened.

The ordinary launcher is still incomplete. With Node 24, L01 and L02 pass, but
the separate ordinary bind-mounted PostgreSQL fixture fails its ownership check
before L03–L08 could run. Exact owned diagnostics and cleanup were retained at
that checkpoint; their recorded temporary location is now absent. The
roots.7 launcher passes are historical and cannot pass roots.8. No open normal
Roots session was found, so existing login/draft preservation remains NOT RUN.
Applicable CI and coordinated default adoption also remain open. VoiceOver is
**DEFERRED / NOT RUN** by the user's October 19 decision, not a current blocker.

The accepted application is the frozen reviewed A05/A08 snapshot. Concurrent
private-pilot authentication work in normal Roots is excluded. Read-only checks
found the normal browser-driver checkout unchanged and the compared normal Roots
dependency/entrypoint pins unchanged; other Roots source is changing in its owning
chat. No whole-checkout unchanged claim is made for Roots.

At this checkpoint, private raw evidence was stored in the isolated Roots
consumer's ignored `.migration/resume-20261019/` and `QA/evidence/`, and this
worktree's ignored `artifacts/resume-20261019/`. The October 21 check above records
which evidence remains available. No publication, remote CI, deployment or everyday
dependency/default promotion is claimed. The older sections below retain their
dated scope, including superseded candidates and genuine failed receipts.

## Resumed shared fixes and final-evidence controls — 2026-10-19

Recovered the preserved `c8135fe` source bundle after verifying its SHA-256 and
kept the immutable roots.6 ZIP. This isolated branch integrates the public-preview
ancestry and the preserved migration corrections: visible guarded typing/cursor,
canonical recipe context, explicit empty viewer text, verification controls,
owned project CLI sessions, explicit browser overrides and paused finalization.
The ordinary browser-driver and Roots checkouts are not integration targets.

A new regression reproduced controls being ignored while an asynchronous
`effectStatus` hook collected final evidence. Execution now remains active until
that hook completes; recipe Pause holds publication, Stop/close wins, and the
collected evidence is reused exactly once. Failure cleanup does not wait for
Resume. This prepares a separate **unpublished `0.1.3-roots.7`** candidate.

| Fresh check | Actual result |
| --- | --- |
| Preserved regression RED | Canonical context: 4 genuine failures on public-snapshot runtime; paused-finalization: 10 genuine failures on roots.5. |
| New final-evidence RED | 7 lifecycle failures on roots.6; 4 real Chromium/HTTP failures after a verified saved request (3 existing cases passed). |
| Runtime | Node 22 and 24: 127/127 each; focused finalization 23/23. |
| Release tooling | Node 22 and 24: 82/82 each. |
| Rust | Formatting, Clippy with warnings denied, locked build and 23 tests PASS. |
| Source quality | JavaScript syntax, public types and formatting PASS. |
| Source Chromium | Motion 4/4; controls 7/7; CLI 10/10; viewer 2/2; notebook browser/API 8/8. |
| Visible presentation | Fresh cursor and viewer hold screenshots inspected; owned browser/server cleanup assertions passed. |
| Exact roots.7 package / Roots application acceptance | NOT RUN at this source checkpoint; subsequent immutable artifact and integration receipts must establish these separately. |

Evidence is retained under ignored `artifacts/resume-20261019/`; browser screenshot
suites use their documented artifact paths. The viewer suite now also runs in CI,
but no remote CI result, publication or normal Roots promotion is claimed.

## Exact roots.7 artifact and isolated Roots acceptance — 2026-10-19

Built the unpublished `0.1.3-roots.7` distribution from clean source commit
`c8b481a870a841257da88fa079708dcd5d5797a2`. The immutable ZIP SHA-256 is
`6c91036e4d54b101f3bee510caccf9d429c0d628efe123cfd16c478be25f30e2`;
its manifest SHA-256 is
`73ff58def5e7fe0f37024941d0ce5ef3403ca8d7f0e369119102c280d1d1a67e`.
Later documentation commits do not change this artifact's source identity.

The exact installed archives passed eight independent Chromium/API groups and
all ten generic CLI browser cases. Runtime and crate trees remained byte-identical;
all recorded owned processes, origins and fixtures closed. The clean source bundle
was restored independently, checked with `git fsck`, and matched the source commit.
This is verified local preservation, not an off-host backup.

The isolated Roots consumer reconciles the reviewed A05/A08 snapshot with model
`d1a7400-df20261011-daedlo.4` (131 declared leaves, 74 public commands, 18 recipes).
The original driver remains present. Fresh candidate results now include:

- Full application acceptance: 189 actual cases (105 primary plus 84 companion),
  represented by 110 primary/wrapper rows and the five companion receipts.
- All 18 recipes; six direct groups, eleven supplemental groups, three remaining
  direct groups, and all 74 successful public commands plus all 74 stale guards.
- All ten viewer/control groups, three receipt groups and four completion groups.
- Current draft/validation acceptance: 39 checks. Actual zoom is separate;
  VoiceOver spoken-output acceptance is DEFERRED / NOT RUN by user decision.

These results use an explicit isolated application snapshot and disposable data.
A simultaneous original-driver reference preserved its draft and navigation;
that preservation result does not stand in for baseline control parity. No normal
Roots service or browser tab was found during inspection, so the existing normal
session gate remains NOT RUN. Baseline, launcher, rollback, final source/database
and strict promotion outcomes are recorded separately when complete. The old
roots.6 strict refusals remain unchanged. No remote CI, publication, deployment,
or everyday Roots dependency/default promotion is claimed.

Private Roots raw evidence was stored in the isolated consumer's
`.migration/resume-20261019/` and ignored native `QA/evidence/` directories; those
locations are unavailable at the October 21 check above. Shared runtime and exact
package receipts remain in `artifacts/resume-20261019/`.

## Final result publication race — 2026-10-19

Independent review found a further race in the exact installed roots.7 runtime:
Pause or Stop accepted after the final asynchronous boundary checked controls,
but before result publication, was followed by a completed result and cleanup.
Two installed-package unit assertions, two source assertions and two real Chromium
assertions reproduced the defect; the seven existing browser cases still passed.
The original red evidence and roots.7 artifact remain immutable. Its final strict
receipt refuses promotion, including this independent-review failure.

The final boundary now rechecks Pause after each asynchronous return and checks
Stop synchronously immediately before publishing. It reuses the collected effect
evidence and never replays the saved request. The focused source tests pass
**25/25 lifecycle cases and 9/9 real Chromium cases**, including retained saved
HTTP evidence and no cleanup before Resume. This prepares a separate unpublished
**0.1.3-roots.8** candidate. Broader source and exact roots.8 package/customer
acceptance are pending at this source checkpoint; roots.7 passes do not establish
roots.8 acceptance. Normal Roots defaults remain unchanged.

## Paused recipe finalization correction — 2026-10-11

A real Roots launcher run against installed unpublished `0.1.3-roots.5` failed
its uncertain-recipe Resume case: verification returned `unknown` while paused,
then the recipe published `completed` and ran cleanup before Resume could decide
to stop it. The old result and exact package remain preserved; passing independent
recipes do not clear that launcher failure.

The generic regression dispatches one guarded effect, pauses, and observes real
protocol verification before checking that the recipe remains busy with no new
completed report or `endRun` call. It also covers Resume, Stop, close, final-step
success and non-success, immutable previous reports, and unchanged direct-command
completion while paused. The unchanged roots5 runtime produced **10 genuine
recipe failures and 4 direct-command passes**. The minimal recipe-only boundary
now waits after verification and before halting or publishing a final result.

Source verification: **14/14 new lifecycle cases**, **55/55 focused lifecycle,
report, cleanup and presentation cases**, **118/118 runtime tests**, and JavaScript
syntax, public types and formatting **PASS**. Private receipts and unchanged red
logs are under `artifacts/recipe-finalization-20261011/`. These are protocol and
runtime tests, not browser acceptance. The corrected installed-package and real
Roots launcher/browser reruns are **NOT RUN**. The reviewed source is prepared
as unpublished local `0.1.3-roots.6`; its later immutable artifact receipt records
packaging and installed checks separately. No publication or customer dependency
promotion is claimed.

## Explicit empty viewer parameter correction — 2026-10-11

The installed `0.1.3-roots.1` Roots control group reproduced a viewer failure:
clearing the notes parameter submitted no notes, so the application inserted its
default text instead of the required empty value. Candidate cleanup passed and a
simultaneous preserved-original fixture retained its draft and usable navigation.
That evidence is an explicit tmpfs-fixture comparison, not the normal-stack gate.

An independent upstream Chromium regression failed at the same boundary: the
viewer posted `{}` instead of `{notes:""}` after editing and clearing Notes. The
minimal generic correction tracks input intent per field, preserving explicit
empty text while leaving untouched optional fields and empty numeric fields
omitted. Reload does not replay parameter intent. This source prepares a separate
unpublished `0.1.3-roots.2`; the prior candidate remains immutable. New receipts
are under `artifacts/roots-migration-0.1.3-roots.2/`. The focused viewer suite
passes both browser groups, all 77 runtime tests and source checks pass, and all
13 atomic-version/CLI checks pass. Exact installed-package proof is recorded with
the candidate artifacts; full Roots controls remain a separate integration gate.

## Unpublished Roots migration candidate preparation — 2026-10-11

The isolated source prepares `0.1.3-roots.1` for local acceptance only. This is not
a published release and has no asserted public download URL. It includes the
visible-motion and canonical-recipe corrections below. The public rc.1 artifacts
and the normal browser-driver checkout remain unchanged.

The inherited release suite was repaired without changing production validation:
MIT test fixtures now declare their license and the bundle fixture includes its
notice; the portable-tools fixture includes the presentation document required by
the frozen builder. The two old isolated integration dependency/lockfile pairs
were first aligned to public rc.1, preserving their customer model pins, so the
atomic version tool could prepare all nine version files coherently.

The initial retained result was 67/82. Adding the license declarations exposed
seven additional fixture failures for the missing presentation document; that
intermediate result was 75/82. The corrected full release suite passes **82/82**.
The version operation records previous `0.1.2-rc.1` and next `0.1.3-roots.1`.
These results supersede the open release-tooling failures recorded below.

All candidate preparation, package-build and installed-verification receipts are
kept under ignored `artifacts/roots-migration-0.1.3-roots.1/`. Consult those receipts
for the eventual exact source commit and artifact hashes. Packaging and source
checks do not establish full Roots customer parity or publication.

## Canonical recipe context correction — 2026-10-11

The exact public engine rejected a canonical `recipeContext` request as an
unexpected field, and the runtime sent no context to recipe actions. A model with
recipe-only application guards therefore could not retain those guards while
running its declared recipes. This correction adds generic negotiated scope,
internal-command metadata and defaulted Rust hooks; it contains no Roots rules.

| Check | Actual result and scope |
| --- | --- |
| Rust regression first | RED: two compiled protocol tests returned `invalid_request` for canonical context and context mismatch requests. |
| Runtime regression first | RED: a full recipe lacked context, direct internal execution reached protocol dispatch, and an unsupported engine accepted an internal-command descriptor. All three assertions failed before implementation. A follow-up read-only handler-scope test then failed because the context was absent before that API was added. |
| Rust workspace | PASS: 23 tests, including scope/direct/mismatched recipe, step, parameters and session cases; default normalization, typed hooks, unchanged fingerprints and verification after a session transition. |
| Runtime | PASS: 77 Node tests, including full recipe context at every guard/verification, direct-context injection refusal and immutable handler scope for app verification. Existing engines without the optional capability retain prior request shape. |
| Source | PASS: syntax, public TypeScript and formatting; locked offline Rust build and Clippy with warnings denied. |
| Real Chromium | PASS: eight notebook browser/API groups with the rebuilt engine, four motion groups, and one viewer group including internal-card omission. These are independent shared-runtime fixtures. |
| Installed candidate / full Roots parity | NOT RUN here: parent integration owner must assign a new version, build exact artifacts, and verify the installed consumer. No public release or remote CI claim. |

Receipts remain under `artifacts/motion-parity-20261011/recipe-*`, including
unmodified red logs and final Rust, runtime, source and browser logs. The new wire
fields are negotiated within protocol 1. The Rust descriptor's new public bool
field requires updates for users constructing struct literals; serde consumers
and default authorization/verification hooks preserve prior behavior. The shared
engine validates canonical scope but remains stateless; the trusted runtime owns
run sequencing. See [the exact contract and compatibility limits](contracts.md#canonical-recipe-context-extension).

The earlier release-tooling failures remain open and unchanged; they were not
rerun for this protocol change. Public rc.1 bytes are preserved, and no artifact
has been versioned or published from these corrections.

## Roots visible-motion parity correction — 2026-10-11

An isolated Roots migration consumer reproduced a failure in exact public Daedlo
`0.1.2-rc.1` bytes: the accepted Slow QA / Fast QA typing check emitted four input
events, below its minimum of fourteen. Both commands completed with the correct
values, pointer movement and speed difference. The preserved Roots motion code
emitted seventeen input events on the same independent form and showed its cursor.
These are real Chromium primitive checks, not Roots application/API/database E2E.

The correction was developed in an isolated checkout at `7e3e48d`, overlaid only
with the public source receipt's 93 verified prepared files (local preservation
commit `b8f7452`). The normal browser-driver workspace and Roots driver remain
untouched. Shared text fill now types at the chosen pace, with guarded boundaries
before each character. Native date/time fills retain browser form semantics. A
session-owned pointer and click overlay survives reload and is removed on close.

| Check | Actual result and scope |
| --- | --- |
| Regression first | RED: visible typing yielded 2 events on the upstream text-only fixture, cursor count was 0, and no first-character interruption point appeared. Native date/session checks already passed. |
| Focused Chromium | PASS: four groups covering visible input/key events, speed, cursor reload/cleanup, preserved human input after pause, and native date/session behavior. Cursor screenshot inspected. |
| Existing shared runtime | PASS: 73 Node tests. |
| Source | PASS: JavaScript syntax, public TypeScript and format checks; locked offline Rust build. |
| Existing browser checks | PASS: eight notebook browser/API groups and one presentation-viewer group. |
| Release tooling | FAIL: 67/82 tests passed. Unchanged older release fixtures omit the license declarations required by the frozen public builder; a version test sees an old integration pin. These failures remain open and are not relabeled as a motion pass. |
| New package / Roots migration / remote CI | NOT RUN: no new version, packaged candidate, full Roots parity or remote CI result is claimed. |

Ignored upstream evidence is `artifacts/motion-parity-20261011/`, including the
public source receipt, baseline identity, browser red/green logs, runtime/source
checks, notebook and presentation logs, and the retained release failures. The
consumer's package and preserved-reference receipts remain in its isolated
`.migration/contract-probe/` directory. All probe browser/viewer resources closed.
The public release bytes remain immutable; consuming the correction requires a
separately versioned candidate and a new exact installed-package acceptance run.

## Shared presentation mode — 2026-10-09

Implemented [presentation mode](presentation.md) for an existing command or
canonical Rust recipe, with customer-owned captions, configurable timed/manual
holds, viewer controls and progress. Presentation and ordinary execution share the
same guards, adapter and resource lifecycle. Runtime speed, presenter pause and
application pause remain distinct. No shared Rust/model/protocol change was needed.

| Check | Result | Evidence / limit |
| --- | --- | --- |
| Regression-first workflow | RED then PASS | `artifacts/presentation-20261009/`: ignored config and invalid plans, missing viewer endpoint/UI, final-read pause/stop races, stalled observations and pause-duration accounting reproduced before fixes |
| Full runtime suite | PASS — 73 Node tests | Includes 15 presentation checks plus CLI passthrough and viewer HTTP boundaries; `node-green-final.txt` |
| Source quality | PASS | Syntax, public TypeScript declarations and repository formatting; `check-final.txt` |
| Shared Rust checks | PASS — 18 tests | `cargo test --workspace --locked --offline`; Rust implementation unchanged by presentation work |
| Generic viewer Chromium checks | PASS — 1 browser group plus 8 HTTP groups | Start, captions, manual/timed holds, pause/resume, advance token, stop, stale reason, disconnected state, reload without replay, initial viewport controls, outcome-pending copy and prior-result preservation |
| Ordinary notebook Chromium acceptance | PASS — 8 groups | Existing attachment, stale/account, validation/persistence, lost-response retry, interruption, viewer, incompatibility and canonical recipe checks |
| Final isolated Stoplight candidate | PASS — 5 scenarios / 15 groups | `artifacts/stoplight-presentation-accept-20261009-final/results.json`: actual viewer start/pause/resume, hold freeze/advance, exact edited receipt, draft protection, stop, automatic disconnect halt and ordinary recipe compatibility |
| Candidate identity and cleanup | PASS | Final `source-verification.json` matches current runtime source and demo inputs; sealed prior trial unchanged. `external-cleanup.json`: all five profiles removed, all ten fixture/viewer ports refused connections; supplied pages survived session/viewer close |
| Visible slow demonstration | PASS / INSPECTED | Fresh `artifacts/stoplight-presentation-demo-20261009-final-02/`: started in the visible Codex viewer, all five stages completed, one edited receipt, final outcome success with effect uncertain; owned viewer retained |

The Stoplight candidate uses an immutable copy of the new **local runtime source**
with the unchanged customer executable built against published rc.5, protocol 1,
and pinned Stoplight `78ff7d465fa01f06eeff2d813d74049fe8852296`. This is not a
new release or new acceptance claim for the published rc.5 runtime. Candidate input
inventories and reports identify the exact bytes. The earlier intermediate
candidate under `artifacts/stoplight-presentation-accept-20261009-01/` also passed;
only the final candidate contains the reviewed timing and viewer-copy corrections.

Source tests initially hit the sandbox's loopback `EPERM`; those are setup failures.
Permitted loopback/browser runs passed. No blind retries, weakened assertions,
application resets or recovery effects were added. Hold observations are bounded
and interruptible; ordinary adapter effects/settle/cleanup remain cooperative.

The customer example streams an extension page with a separate owned target. Native
Chrome sidebar behavior and durable business persistence remain unverified. One
in-memory HTTP receipt is evidence of synthetic forwarding only. New presentations
are configured when attaching the session; holds occur after whole commands.

The first visible slow demo, retained under
`artifacts/stoplight-presentation-demo-20261009-final/`, halted correctly about
7.1 seconds into its first 15-second hold when the app changed from Armed to an
original paused request. Its report records only the Arm effect, no Send effect
or stage advance, and zero receiver receipts. The source of that state change is
unrecorded. The run was not resumed, reset or treated as successful; its pending
request and evidence were preserved. The separate fresh `final-02` fixture added
passive local input/request metadata, with no runtime, adapter, engine or
application changes. Its input inventory matches the final acceptance candidate.

The second slow demo completed with measured holds of 15,028 / 18,089 / 18,077 /
12,059 / 3,097 ms and per-stage receiver counts 0 / 0 / 0 / 1 / 1. The final
application state was Detached with an empty queue and one edited HTTP receipt.
Execution completed and the model outcome was success; the effect remains
uncertain because no durable business persistence is claimed. Passive diagnostics
recorded one synthetic click and one POST/fetch aligned with the guarded Send
stage; they do not identify an actor. `demo-summary.json`, stage captures and the
completed report preserve the evidence. Both the successful viewer and the earlier
halted fixture were retained with explicit owners in ignored
`artifacts/presentation-20261009/presentation-HANDOFF.md`; prior parent demo
resources remain untouched.

Existing evaluation/licensing drafts, older integration evidence, live Roots and
Stoplight checkouts, dependency pins and retained parent demo resources were left
outside the implementation change. No commit, push, publication or deployment
occurred during the implementation checkpoint described above.

The subsequent requested commit isolates the shared presentation runtime, viewer,
tests and documentation. Pre-existing licensing/version drafts and the uncommitted
Stoplight integration, including its dependent presentation launcher, stay local.
The exact selected commit source passed 73 Node tests, syntax/types/format checks
and the independent Chromium viewer test. Earlier Stoplight browser results refer
to the recorded local candidate and its specific input identity above, not a new
test of the selected commit or a released package.

## Corrected portable rc.5 source checks — 2026-10-06

The rc.4 source commit and its existing Node 22/24 CI passed, but an additional
real CLI browser check found a release blocker: Playwright's default SIGINT
handler terminated the process with exit 130 before `endRun` and report export.
That candidate was not published. Its clean packages remain identified as rc.4;
the correction advances to `0.1.1-rc.5` rather than reusing those bytes' identity.

| Check | Result | Evidence and scope |
| --- | --- | --- |
| Actual pre-fix CLI | FAIL — preserved | rc.4 `cli-signal-red/results.json`; real save persisted, then signal caused exit 130 and no final report |
| Signal ownership regressions | RED then PASS | Two competing Playwright-handler checks fail before explicitly disabling its SIGINT/SIGTERM handling |
| Shared runtime | PASS — 55 Node tests | `runtime-tests.log`; 13 CLI lifecycle regressions included |
| Release contracts and source checks | PASS — 82 plus check | `release-tests.log`, `check.log`; no CI changes |
| Corrected CLI in real Chromium | PASS — 2 scenarios | `cli-browser-source/results.json`; stopped active save waits for gated finalization, and fail-once adapter cleanup survives for a second signal |
| Persistence and cleanup | PASS within both corrected CLI cases | Exactly one API-confirmed row/write, one handler and one `endRun`; normal exit 0 and owned fixture/browser/viewer cleanup recorded |

Corrected evidence is under ignored `artifacts/release-rc5-20261006/`; rc.4
failure evidence remains under the corresponding rc.4 directory. The first extra
browser attempt had an incorrect harness initial-state expectation (Draft instead
of Ready); it was corrected against the actual model before reproducing the
signal failure. That setup failure is not claimed as a product regression.

The source CLI checks used the previously built notebook model; exact rc.5
runtime/crate installation and browser checks are a separate post-commit gate.
The [rc.5 release receipt](https://github.com/givtaj/browser-driver/releases/tag/v0.1.1-rc.5)
records final clean identities, package checks and publication. The earlier
source/package checks below retain their original version and scope.

## Portable rc.4 source release checks — 2026-10-06

The earlier clean-release target was `0.1.1-rc.4`; it was not published. It supersedes the local rc.3
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

### Local Roots migration interruption candidate, 2026-10-11

Unpublished `0.1.3-roots.3` preserves read-only completion verification after a
dispatched effect while Pause gates future effects. Stop retains a separate
`interruptionError` if verification fails, alongside the independently reported
effect status; no successful outcome is inferred from an unverified postcondition.

The added independent Chromium/HTTP regression failed all three assertions before
the fix (paused completion, stopped verification, stopped failed verification) and
passed all three afterward. A recipe-step unit regression first observed zero
verified steps while paused and now passes while still rejecting a human edit
before the next effect. All 78 runtime tests, eight existing notebook browser
groups, four motion groups, two viewer groups, syntax, types and format passed.
Logs are retained in `artifacts/roots-migration-0.1.3-roots.3/`. Consumer Roots
acceptance, its database, and publication are separate gates; this record does
not claim them complete.

### Local CLI browser overrides, 2026-10-11 — unpublished candidate

The candidate CLI loads trusted `PLAYWRIGHT_MODULE` before project setup and
passes `CHROMIUM` unchanged at browser launch. It has no module/executable fallback
and retains its existing signal ownership. Thirteen actual CLI subprocess checks replace only the bare default
Playwright import with a recording sentinel; no browser is launched by those tests.
The pre-fix source had three passing default/help checks and ten actual assertion
failures: explicit modules were ignored and executablePath was absent. Tightening
help to require zero browser-module evaluations separately failed against the exact
installed roots.4 CLI, then passed on the changed source. These are observed
nonbrowser failures, not an OS executable-refusal or customer browser result.

All thirteen strengthened environment checks pass. All 104 runtime checks pass,
including paused factory cancellation and active saved-effect shutdown with selected
executable options. Syntax, types and formatting pass. Private logs are retained
in `artifacts/cli-environment-20261011/`.

The exact installed roots.4 CLI also failed the real Chromium override assertion
after successfully saving once and completing its owned cleanup: the selected
module was never evaluated. The changed source passes ten real Chromium/HTTP CLI
cases: the existing three, three override path forms, active saved-action SIGTERM,
selected paused-startup cancellation, and missing/non-executable launch failures.
Public response and final-report run IDs/effects match, with exactly one write for
successful save scenarios and zero for interrupted startup. OS process path,
realpath and SHA256 bind the selected actual browser; launch options stay unchanged.
An earlier attempt retained five passes and five witness setup failures because
Chromium rejected the optional command-line diagnostic. The corrected witness uses
a browser-target process ID and an OS executable read, with no fallback or extra
launch flag. All ten named fixture roots, fifteen child/browser PIDs and ten owned
HTTP origins were absent in the independent cleanup audit.

Unpublished local version `0.1.3-roots.5` will package these reviewed changes.
Exact installed-candidate acceptance is recorded in its external LOCAL-CANDIDATE
receipt after the clean build. Customer acceptance/pin selection, remote CI and
publication remain separate; no existing Roots installation is changed here.
