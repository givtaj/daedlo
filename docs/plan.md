# Implementation plan

## Alpha.7 delivery — 2026-11-05

The owner explicitly authorized merging and publishing alpha.7 after the native
status/recovery source fix. Preserve every previous release, source record and
publisher trust/checkpoint. Customer incident recovery remains separate.

- [x] Prepare coherent alpha.7 versions and tools-bootstrap guidance.
- [x] Require exact installed observation coverage and retain shipped reference gates.
- [x] Extend the isolated alpha.6 → alpha.7 → alpha.6 drill with new tools.
- [x] Freeze clean source; pass exact installed, upgrade/rollback and current-source CI.
- [x] Pin reviewed immutable assets in the existing publisher workflow.
- [x] Merge, publish and verify actual public download/install/tools bootstrap/update/rollback.

Actual results belong in [verification](verification.md#alpha7-production-delivery--2026-11-05).
Customer acceptance remains open in [#25](https://github.com/givtaj/daedlo/issues/25):
native observation/recovery, frontend stop isolation, managed upgrade/rollback,
detached-document faults and effect-status/report integration. A named-session
picker remains triage only. No customer acceptance is inferred from publication.

## Native observation recovery — 2026-11-05

- [x] Reproduce misleading stopped/dirty status with regression-first assertions
  and an independent real-browser fixture.
- [x] Separate observation failure/unreachable child state from ownership, preserve
  sanitized reasons and restore readiness through fresh reads without replay.
- [x] Preserve unknown-safety guards, cleanup failures and supervisor-owned pause
  recovery; pass affected Node/Rust, packaging and browser checks and independent review.
- [x] Document current-session recovery, hard-owner-loss limits and the public
  synthetic reproduction contract.

The local source checkpoint below is historical. Alpha.7 now delivers the reviewed
fix; [actual source results](verification.md#native-observation-status-and-guarded-recovery--2026-11-05)
and [production verification](verification.md#alpha7-production-delivery--2026-11-05)
remain distinct. Publication does not repair an already loaded customer adapter,
establish the cause of an application error or complete customer acceptance.

## Diagnostics rollout closure — 2026-10-28

[PR #18](https://github.com/givtaj/daedlo/pull/18) is merged after complete Node
22/24 branch and PR CI. The ordinary signed renewal from the tested merge commit
passed all production gates, advancing generation 18 to 19 with unchanged release
entries. Independent HTTPS signature/inventory readback passed. See the
[deployment record](verification.md#renewal-diagnostics-merged-and-production-verified--2026-10-28).

The customer acceptance checklist is merged in source for future tools releases.
Alpha.6 remains unchanged; customer-run acceptance and any support message remain
separate. This supersedes the local-only rollout status in the next section.

## Release diagnostics and customer acceptance guidance — 2026-10-28

- [x] Reproduce the renewal network-diagnostic gap, then report a reviewed request
  path, prepare/verify/live stage, headers/body phase and bounded failure category.
  Keep strict checks, the existing timeout, checkpoint preservation and no retries.
- [x] Pass the affected renewal/publication safeguards and source quality checks;
  retain the original production failure's unknown cause and successful recovery.
- [x] Add a customer-run acceptance checklist and sanitized support-result template
  to the shipped [managed integration guide](managed-integration.md#customer-run-acceptance).

External customers run application acceptance in their own disposable environments.
Their private source, catalogs and data stay with them. Upstream provides tested
references and reviews sanitized reproductions; these local checks do not complete
customer registration, business-flow, frontend-isolation or upgrade acceptance.
This change does not publish a kit or deploy the renewal workflow. Actual checks
are recorded in [verification](verification.md).

## Alpha.6 publication — 2026-10-28

The owner authorized merging PR #16, publishing the shared-path viewer, verifying
production Ninja updates and replying in the existing WBF conversation afterward.

- [x] Merge the reviewed feature after checking its current head and required CI.
- [x] Freeze the versioned source and pass exact installed runtime/tools/references.
- [x] Verify published alpha.5 tools update, restart and roll back the candidate.
- [x] Review immutable publisher pins, complete CI and publish through the existing workflow.
- [x] Verify actual production HTTPS discovery, installation, restart and rollback.
- [x] Verify ordinary signed renewal retains alpha.6 and every historical release.
- [x] Send the scoped post-publication WBF reply and record the verified sent message privately.

## Shared recipe paths — 2026-10-26

Approved UI direction: show a common authored entry path once, branch into its
recipes and allow complete step inspection. Preserve existing clients.

- [x] Compare canonical command IDs and parameters without adding descriptor fields.
- [x] Show shared prefixes, expandable groups and full per-recipe step previews.
- [x] Preserve direct commands, recipe IDs, availability, guards and full execution.
- [x] Reproduce regressions first; pass source, real-browser and installed checks.
- [x] Inspect desktop/narrow layouts and record owned cleanup.
- [x] Verify unchanged published alpha.5 Ninja tools can update, restart and roll back
  an isolated candidate while preserving the existing model, configuration and data.

Implemented, reviewed and merged in [PR #16](https://github.com/givtaj/daedlo/pull/16).
Alpha.6 is published and production-verified. Exact measured results and historical
candidate identities are in `docs/verification.md`.

## Managed custom-runner and evidence delivery — 2026-10-26

[Epic #11](https://github.com/givtaj/daedlo/issues/11) targets alpha.5. Reuse the
accepted synthetic starter model; preserve injected native runtime/session
identity, model-owned flows, strict guards and conservative effect evidence.

- [x] [Managed reference #12](https://github.com/givtaj/daedlo/issues/12): separate
  preflight hooks, supported configuration/private metadata boundaries, real
  browser flow, independent frontend lifecycle and cleanup.
- [x] [Evidence guidance #13](https://github.com/givtaj/daedlo/issues/13): persistence
  proof before effect finalization, immutable per-run capture and explicit bounds,
  immediate native archives and recovery without replay.
- [x] [Delivery #14](https://github.com/givtaj/daedlo/issues/14): exact package and
  upgrade/restart/rollback acceptance, CI, immutable release, signed publication,
  live verification, then the authorized support reply.

Product conformance does not establish customer managed adoption or complete
application fault coverage. Preserve customer records and accepted installations.
Product delivery and the authorized post-publication support reply are complete.
Actual results and remaining customer acceptance belong in docs/verification.md.


Current release: [Daedlo alpha delivery — 5 November 2026](alpha-release.md),
published assisted **0.1.4-alpha.7**. Native observation/recovery joins the managed
runner and reporting guidance. Exact installed runtime/tools/references, source
and publisher CI, the actual public installer and HTTPS tools bootstrap/upgrade/
restart/rollback passed. Published alpha.6 tools and installations remain intact;
the supervisor fix uses separately verified alpha.7 tools. The signed feed
preserves every previous release and the existing publisher trust.

The [verification record](verification.md) owns exact identities and scoped
results. Customer native registration, business-flow and full fault coverage,
customer upgrade/rollback and ordinary dependency promotion remain separate.
The original native setup worktree and everyday Roots dependencies are unchanged.
Daily renewal remains scheduled at 04:23 UTC; execution can be delayed. Earlier
milestones below retain their historical scope and do not establish additional
current customer acceptance.

## Goal and approved constraints

Build the dedicated Daedlo product described in this conversation, with
configurable customer states/branches and Roots as its first customer. Keep Roots
development operational throughout. The user approved implementation and asked for
this plan, documentation and the supplied architecture diagram.

The first candidate uses the committed Roots baseline
`d4008e39aeaa137bb54ff48ca2d11748083a971a`. Concurrent uncommitted changes remain
untouched. Later Roots changes are reviewed and selectively ported when requested.

## Ordered milestones

### 1. Contracts and baseline

- [x] Inspect Roots guide, implementation and known verification gaps.
- [x] Define ownership and the stable/candidate development paths.
- [x] Write product, architecture, protocol and acceptance documents.
- [x] Include the user's architecture image and editable Mermaid source.
- [x] Record source/package/build identities in reproducible acceptance output.

Gate: no app semantics in shared core; current Roots files and resources preserved.

### 2. Rust model and protocol

- [x] Public typed ApplicationModel contract and explicit stable descriptors.
- [x] Protocol v1 handshake, request IDs, strict decoding and bounded messages.
- [x] Observe/authorize/recipe/verify with session and freshness checks.
- [x] Negative contracts for incompatible versions, unknown states/commands,
      invalid parameters and missing evidence.

Gate: meaningful failing regression first, then Rust tests pass; no click or missing
fact is treated as successful persistence.

### 3. Node session and lifecycle

- [x] Public DriverSession API with one active run and canonical recipes.
- [x] Rechecks at guarded effects, including after pause and pointer movement.
- [x] Honest completion, rejection, stop and uncertain-effect reporting.
- [x] Process transport failure handling; no automatic command replay.
- [x] Resource ownership, partial-startup unwind and retryable cleanup.

Gate: concurrency, freshness and interruption checks pass with effect assertions.

### 4. Generic live viewer

- [x] CDP/MJPEG stream and separate command/status HTTP API.
- [x] Descriptor-driven states, commands and parameter controls.
- [x] Clear execution/outcome/progress, speed and pause/resume/stop.
- [x] Loopback request boundaries, reconnect without replay and owned cleanup.
- [x] Real Chromium visual inspection.

Gate: new customer commands render without shared UI edits; the displayed image
matches the controlled session.

### 5. Independent conformance fixture

- [x] Tiny notebook app with a different state model and parameter types.
- [x] Real-browser success/validation/recovery and stale/session cases.
- [x] Lost-response retry with a real server write and read-back count of one.
- [x] Packaged install/public API and version incompatibility checks.

This fixture unblocks core development; it does not replace Roots acceptance.

### 6. Roots customer candidate

- [x] Create an isolated pinned Roots consumer snapshot.
- [x] Consume explicit external Node/Rust candidate artifacts through public APIs.
- [x] Run agreed real-browser/API/disposable-data cases and record exact identities.
- [x] Verify rejected candidates cause no application effects and never target
      normal Roots resources; record the active-normal-stack testing limit.
- [x] Clean only candidate-owned resources; report remaining cleanup failures.

Gate: no duplicated shared runtime or private Daedlo imports; document
known baseline defects and any unsupported cases honestly.

### 7. Review and handoff

- [x] Review integration boundaries and negative cases independently.
- [x] Run required source/package checks and affected acceptance.
- [x] Update verification with PASS/FAIL/NOT RUN and evidence paths.
- [x] Document how to launch the demo, consume a candidate and request an upstream review.

Everyday Roots promotion is a later explicit integration change: update the tested
dependency combination and compatibility files together, verify the normal entry
command, and preserve rollback. No publication or database migration is implied.

### Later promotion gates — outside this delivery

- [ ] Exercise candidate failure alongside an actively running everyday Roots stack.
- [ ] Run the agreed promotion suite against the exact final dependency combination.
- [ ] Migrate normal Roots dependency pins and compatibility entrypoints together.

The initial Roots consumer covers 15 commands and one recipe. Its browser checks
used rc2; its final rc3 has one type-declaration correction and identical executable
files. The later Journal edit port below is a separate selected consumer. Migrating
all legacy recipes and later Strains work remains separate.

## Completion standard

The build is ready only when the claimed flows pass against the recorded artifacts
and the visible result has been inspected. A source test is not browser acceptance;
an example-app pass is not a Roots pass; historical Roots evidence is not evidence
for the new product. See [verification](verification.md) for actual progress.

## Follow-up: use the actual Roots experience

The user requested real Roots usage and logs as the example/archive. The captured
source identities and evidence are recorded in the [Roots archive](../examples/roots/archive/README.md).

- [x] Read current Roots model, commands, canonical report, failure logs and source chat.
- [x] Build the committed Strains-era Roots application and original driver in an
      isolated snapshot; freeze its binaries and preserve ongoing Roots work.
- [x] Open and operate the real monitor: sign in, draft retention, lost-response
      retry, and Strains search. Preserve actual results and automation/setup limits.
- [x] Make Roots the default demo; retain notebook only as a conformance fixture.
- [x] Archive actual original-driver runs, completed consolidation results, the
      standalone candidate acceptance and the fresh manual walkthrough with provenance.
- [x] Check archive filters, disclosures and screenshots in the visible browser;
      run focused serving/status tests and required source checks.

This follow-up changes examples and records. The live reference uses the original
Roots driver; the narrower extracted adapter is not silently relabeled as fully
migrated. The viewer and fixture were retained at that checkpoint; this historical
record does not assert that either remains running.

## Requested Journal edit review and port — 2026-10-04

Goal: carry the useful lessons from the reviewed Roots edit wave into the shared
driver and prove the selected consumer against immutable candidate packages.

- [x] Review the linked chat, actual source receipts and later retained-session
      failure separately from the completed edit checks.
- [x] Add conservative response classification and per-operation effect evidence.
- [x] Preserve completed run reports and clean owned transient faults after a run.
- [x] Capture the reviewed feature overlay on its pinned committed base and build
      separate application binaries.
- [x] Port the four customer Rust edit plans through the public runtime and shared
      model contract; reject missing fixture prerequisites before effects.
- [x] Run focused Node/Rust regressions and independent Chromium acceptance.
- [x] Verify the exact staged candidate against real Roots browser/API/PostgreSQL.
- [x] Inspect the generic viewer's operation labels and record final cleanup.

Everyday Roots dependency promotion, all-recipe migration and registry publication
remain outside this change. Actual outcomes and identities belong in
[verification](verification.md).

## Release preparation — 2026-10-04

Goal: prepare repeatable driver updates while Roots keeps its accepted tooling.

- [x] Version the runtime, shared crate and isolated-consumer pins together.
- [x] Build source-identified immutable bundles with checked sizes and checksums.
- [x] Verify an installed package pair through the independent browser suite.
- [x] Add CI gates for source, contracts, packaging and installed browser acceptance.
- [x] Exercise explicit trusted update, corruption rejection and rollback.
- [x] Record measured results and document the release/install walkthrough.

Registry publication and everyday Roots migration remain separate actions. The
release store selects archives for an opt-in consumer; it never changes Roots'
normal dependencies, launchers, services or data.

## Agent-led onboarding — 2026-10-05

Goal: let an agent install and integrate the existing Rust/Node driver, then help
product, development and QA contributors author one agreed feature's enum,
transition diagram, flows and evidence. Keep the application in its current
language and retain existing customer tooling.

- [x] Review the original Roots UX-tree request and later feature-wave workflow.
- [x] Add a portable skill, installation/model references and a flow-spec template.
- [x] Document Codex and Claude Code project installation using the same folder.
- [x] Check actual manifests/toolchains and distinguish core from Docker fixtures.
- [x] Validate the skill, local links and complete-folder copying for both hosts.
- [x] Review a realistic onboarding request independently; correct cache and
      browser/application ownership guidance.
- [x] Onboard one existing flow in a second real application: isolated SeeRuntime,
      exact rc.2 and rc.3 package pairs, the same Rust model/adapter and visible viewers.
- [ ] Verify skill discovery and end-to-end installation in both agent hosts.

This milestone adds agent instructions, not a new runtime backend, generic model
format, container image or registry release. See [agent onboarding](agent-onboarding.md)
and [verification](verification.md) for the implemented path and actual checks.

## First GitHub developer preview — 2026-10-05

Release target: `v0.1.1-rc.2`, using the repository's existing visibility. Ship the
exact runtime/crate bundle plus a separate complete agent-skill archive and final
verification receipt. The existing CI matrix and checks remain unchanged.

Release checks: scoped local regressions, clean committed-source packaging,
installed-package browser acceptance, existing CI on that commit, skill content
verification, then explicit tag/release publication and downloaded-asset checks.
The [release page](https://github.com/givtaj/daedlo/releases/tag/v0.1.1-rc.2)
and its `VERIFICATION.md` asset own the final publication receipt; the source tree
is frozen before those identities can be generated.

Registry publishing, repository visibility changes, new framework onboarding,
Windows validation and everyday Roots adoption remain outside this preview.

## First paid pilot — 2026-10-05

Commercial decision: one plan at **USD 20 per seat per month**, with WorkOS and
Google sign-in for individuals and businesses. A prospective five-seat team would
pay **USD 100 per month**; this is not yet contracted revenue.

The [subscription plan](subscription-plan.md) records the separate later portal
phase: Cloudflare hosting, WorkOS/Google login and Stripe payments. On 2026-10-06
the owner deferred this phase to focus on the local release, safe updates and a
SeeRuntime customer trial. The incomplete companion prototype is preserved in
ignored artifacts and removed from active workspace dependencies.

## Safe customer updates and SeeRuntime trial — 2026-10-06

Goal: publish immutable versioned packages frequently while each application keeps
its accepted package/model/adapter combination until a candidate passes its checks.

- [x] Document the separate portal phase and preserve its prototype outside release paths.
- [x] Add explicit release discovery and verified downloads without modifying customers.
- [x] Package portable customer update tools and show the before/after installation layout.
- [x] Verify candidate rejection, archive-store pin preservation and rollback.
- [x] Install the exact package in an isolated pinned SeeRuntime copy and verify one
      existing application flow through its customer Rust model and public adapter.
- [x] Record real browser results, visible viewer inspection, source preservation and
      owned resources. Keep the existing CI workflow unchanged.

An available update is not an approved update. No background sync, automatic
dependency rewrite, application migration or production deployment is included.

## Portable release hardening — 2026-10-06

Target: `v0.1.1-rc.4`, a clean immutable private preview that can be downloaded and
mounted in a customer's separate QA integration without a driver source checkout.
The owner clarified that preparing this installation path is the scope; onboarding
an actual WBF application is deferred until its team chooses that integration.

Source work covers shutdown finalization, retryable owned cleanup, complete
portable instructions and regression checks. Freeze and commit the reviewed tree,
then build both packages from that identity, verify installed bytes and the actual
CLI in Chromium, run the unchanged CI and publish the verified assets. The final
release receipt records those post-commit identities and outcomes. Do not reuse
the earlier local rc.3 identity, alter real customer pins or add billing/portal work.

Post-build verification withheld rc.4: Playwright's automatic signal handler
exited before CLI finalization. The corrected target is `v0.1.1-rc.5`, with CLI
signal ownership, two additional regressions and two passing real-browser CLI
checks. Re-run the existing CI and exact final-package gates on its clean commit;
keep the previous candidate and failure receipts intact.

## Requested shared presentation mode — 2026-10-09

- [x] Decorate existing Rust commands/recipes with customer-authored stage metadata.
- [x] Add configurable holds and explicit start/pause/resume/advance/stop controls.
- [x] Recheck fresh observations through holds; halt on stale state, disconnection,
      application non-success or cleanup failure without recovery effects.
- [x] Reproduce and fix final-hold interruption and paused-clock races.
- [x] Preserve attached resources and ordinary command/recipe behavior.
- [x] Verify source tests, generic Chromium UI, ordinary browser acceptance and a
      fresh isolated Stoplight runtime candidate.
- [x] Document public configuration, ownership and limits in
      [presentation mode](presentation.md); record actual results in
      [verification](verification.md).

This feature is local source work; publication and customer dependency promotion
are separate actions. The Stoplight captions and fixture remain customer-owned.

## Resume installed Roots migration — 2026-10-19

The user requested resuming the migration and bringing the preserved shared fixes
into Daedlo while keeping the current Roots driver operational until all
acceptance checks pass. Work occurs in isolated checkouts; the ordinary dirty
Daedlo and Roots checkouts retain their existing source and entrypoints.

- [x] Verify and recover the preserved `c8135fe` source bundle and roots.6 archive.
- [x] Integrate its public-preview ancestry and shared corrections on the local
      `codex/daedlo-roots-fixes` branch without changing the ordinary checkout.
- [x] Reproduce the canonical-recipe and paused-finalization regressions on their
      pre-fix source identities.
- [x] Verify the roots.7 source and exact installed packages, including controls
      during asynchronous final effect evidence; retain its later review failure.
- [x] Reproduce and fix the final boundary publication race in source tests.
- [x] Build the immutable roots.8 package and verify its exact installed consumer;
      the surviving package and installed-check evidence match on October 21.
- [x] Record the October 19 paired 189-case application suites, 74 commands/guards
      and 18 recipes as historical observed passes.
- [ ] Recover and verify the temporary Roots integration source and its missing
      acceptance evidence, or produce fresh isolated acceptance for recovered source.
- [ ] Finish the final local source/evidence preservation and strict decision.
- [ ] Resolve ordinary launcher fixture ownership and finish L03–L08 on roots.8.
- [x] Reconcile the reviewed Roots feature snapshot and its model in the October 19
      isolated consumer, retaining its inventory and original driver reference then.
      Their current recovery and verification remain pending above.
- [ ] Close normal-session and applicable CI gates before coordinated default
      promotion; keep the original driver as the ordinary entrypoint until then.

On October 21 the temporary Roots consumer and its private raw receipts are absent
at their recorded locations; their disappearance has no established cause. Recovery
is in progress. The shared driver source/package evidence remains intact, but no
final integration archive, restored Roots snapshot or strict closure is claimed.
Missing evidence does not relabel the historical passing tests as failures.

Actual measured outcomes and current evidence availability belong in
[verification](verification.md). Roots owns its canonical checklist. Historical
local passes do not clear pending preservation, publication, CI or normal-session
gates. The user explicitly deferred
VoiceOver spoken-output acceptance on October 19; it remains DEFERRED / NOT RUN
and is not a current migration blocker.

## Requested teaching-mode plan — 2026-10-23

The [teaching-mode plan](teaching-mode.md) defines Show me, Guide me and Let me try,
starting with a reduced teaching variant of the actual Roots Journal
`draft-retained` workflow. Original September 2026 evidence confirms draft
retention, not learner training or a saved experience.

- [x] Inspect original recorded Roots UI, pinned recipe, assertions and receipts.
- [x] Specify lesson objective, source evidence, learner steps, architecture,
      milestones and acceptance criteria.
- [ ] Implement capability-negotiated lesson observations and the learner panel.
- [ ] Verify the reduced Roots lesson against isolated, pinned artifacts.
- [ ] Run an exploratory novice pilot and record its actual results.

The website introduction labels teaching mode as planned and separate from the
preview download. Website check/deployment results belong in
[verification](verification.md); they do not complete the runtime milestones.
