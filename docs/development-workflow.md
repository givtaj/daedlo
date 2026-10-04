# Parallel development and Roots feedback

## Stable usage and candidate development

Roots keeps using its last accepted driver. Before the first external candidate is
accepted, that is its existing embedded implementation. Browser-driver develops in
this repository and produces immutable candidate packages and Rust source/build
identities. Normal Roots work does not depend on a changing checkout here.

A candidate consumer uses an explicit override in an isolated Roots snapshot. It
has separate dependency installation, Cargo target output, browser context/profile,
ports, processes, disposable data and evidence directory. Never overwrite normal
Roots binaries or lockfiles to run a candidate. Record the precise application,
adapter/model, runtime and engine combination used by the test.

Temporary local links can help a bounded experiment. Acceptance and everyday
consumption use exact package artifacts and revisions. Node/Rust/model/protocol
compatibility is tested as a combination; no promise of supporting every historical
version. Reject incompatibility before application effects.

## Ownership

| Owner | Files and decisions |
| --- | --- |
| browser-driver | Shared Rust framework, runtime, protocol, viewer, core regressions |
| Roots feature development | App behavior, nested enums/model, selectors/actions, assertions and feature scenarios |
| One integration owner | Roots dependency pins/lockfiles, compatibility entry point migration and acceptance record |

The intended dependency direction is **Roots -> browser-driver**. Roots owns its
application integration; browser-driver's independent tests do not require Roots
source. Candidate consumer preparation here stages integration files into an
isolated snapshot, not the user's everyday checkout.

If a feature needs a new core capability, only its new scenario waits. Existing QA
and application development continue against the stable path. A contract fixture
can unblock authoring but must not be reported as real customer acceptance.

## Candidate handoff and promotion

1. Explain the user outcome, minimal reproduction, expected behavior and contract versions.
2. Build immutable artifacts and record their hashes plus source identity.
3. Run focused isolated Roots scenarios; classify failures by actual owner.
4. Before promotion, run the agreed complete suite and required source/packaging checks.
5. Promote the exact tested combination in one scoped dependency/integration change.
6. Revert that combination if necessary; do not mix a new adapter with old incompatible pins.

Before everyday promotion, candidate-failure acceptance must also show that an
actively running normal Roots stack, browser session and driver remain usable.
The initial candidate verified isolation and attached-fixture preservation; it did
not exercise an active normal Docker stack. Tool upgrades do not include app
database moves or migrations. Existing compatibility entry commands are preserved
deliberately.

## Customer feedback loop

**Roots reproduction -> owner classification -> minimal regression -> fix ->
candidate -> isolated Roots rerun -> accepted pin update.**

Application bugs stay in Roots. Adapter/model bugs stay with the customer
integration. Shared protocol/runtime/viewer bugs get regressions in browser-driver.
Use a real reproducible defect to exercise the loop when one is available; never
invent failure or require an indefinite feedback period.

Reports distinguish expected and observed outcomes and record version identities,
test level, safe reproduction and redacted evidence references. No automatic
telemetry, monitoring or schedules. Roots retains its existing canonical
`docs/verification/auth-release-2026-09-26/REPORT.md` and `CHANGELOG.md`; do not create
a competing Roots release-status record. This repository's verification record
describes this product's candidate checks.

## Requested upstream reviews and selective ports

When the user asks to check Roots for driver improvements or bug fixes:

1. Inspect its current HEAD/status read-only. Separate committed changes from
   concurrent work; ask for a specific dirty change only if its intended source
   cannot be established. Never alter or revert unrelated files.
2. Compare the last recorded baseline with the chosen source revision, focusing on
   driver, model, viewer, lifecycle and related acceptance evidence.
3. Classify each useful change as shared-core improvement, Roots-only integration,
   application fix, already covered, incompatible, or deferred. Explain why it fits.
4. For a requested port, reproduce the relevant behavior in the owning repo and
   adapt the smallest change to the public contracts. Copying a folder is not
   proof of portability; Roots business assumptions stay outside core.
5. Run focused regressions and affected consumer acceptance. Record source commit,
   paths, rationale, destination changes and actual verification in a dated review.
6. Build/promote through the same candidate workflow. Do not silently update normal
   Roots dependencies or publish a package as part of a review.

For explicitly requested work verified against an uncommitted feature, retain the
committed base and overlay only source files named by the reviewed application and
controller receipts. `integrations/roots/prepare-feature.mjs` refuses changed hashes,
private paths, symlinks and output inside the source checkout. It builds a separate
snapshot and records the base, selected file hashes and resulting binary hashes.
This is a reviewed working-tree overlay, not a claim that the feature is committed.
Copied installed web dependencies receive their own byte receipt; a matching
lockfile does not prove that the installation was produced from it.

Stage the exact runtime tarball and shared crate with `stage-feature.mjs`, then run
`feature-acceptance.mjs` in a fresh evidence directory. A completed run report is an
immutable checkpoint. Later exploration, setup failures and retries get new
records; they cannot replace a prior PASS or erase its scope. Keep synthetic
credentials, raw request identities and private fixture diagnostics in ignored
artifacts, and publish only the sanitized result and artifact identities.

No automatic synchronization is installed. The user chooses when to request the
next comparison or port. The initial reference is Roots commit
`d4008e39aeaa137bb54ff48ca2d11748083a971a`.
