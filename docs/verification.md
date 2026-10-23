# Verification record

## Daedlo naming and community preparation — private source, 2026-10-23

The rename and contributor cleanup were implemented in an isolated branch from
`7d7ebb933bf28952b46991ae9f1ff41393ed1620`. Clean implementation commit
`85c1bcac841545e1ad4f1c6783b4e1bb3d8cbce5` was used for the local immutable build;
this verification entry is a later documentation change. The same repository is
to be renamed, preserving its history and stable GitHub repository ID
`1391092739`. Repository visibility remains **PRIVATE**. Remote integration and
rename results are not established by these local checks.

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
