# Implementation plan

## Goal and approved constraints

Build the dedicated browser-driver product described in this conversation, with
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

Gate: no duplicated shared runtime or private browser-driver imports; document
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

The user requested real Roots usage and logs as the example/archive, and supplied
the [latest Roots development chat](codex://threads/01a0e3a2-2b67-7700-a4f0-5bd5a30b891b).

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
migrated. The active viewer and fixture remain available for user exploration.

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
