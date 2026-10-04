# Acceptance checklist

Agreed implementation scope: independent product, preserve Roots, isolated candidate workflow. These executable cases implement the reviewed scenarios. Record actual source/build identities and red/green evidence in `docs/verification.md`.

- [x] Rust protocol/model contracts reject incompatible versions, malformed facts/parameters, unknown commands/states and missing evidence.
- [x] Real browser attachment preserves session and draft.
- [x] Intervening edits/session changes reject stale commands without a click or application write.
- [x] One active execution; pause/resume/stop respect action boundaries and honestly report an in-flight saved/uncertain result.
- [x] Successful, invalid and recoverable saves remain distinct.
- [x] A server-side successful write with a lost response retries the same operation and read-back proves one record (application idempotency).
- [x] Monitor reconnect does not replay. The live image is visibly the controlled browser.
- [x] Customer-defined hierarchy, command and parameter types render without editing the shared viewer/runtime.
- [x] Failed setup and cleanup preserve attached resources, unwind owned resources and retain failed handles for retry. Replacement handles use the same resource scope; application-specific restart flows are not migrated.
- [x] Package install and version mismatch tests use the public API and exact artifacts.
- [x] Roots consumes the candidate in an isolated source snapshot using real browser/API/disposable data. No everyday Roots code, process, database, browser or dependency files are modified.
- [x] Independent tiny app demonstrates that core tests and viewer do not require Roots.

Future promotion: Roots' integration owner updates normal dependency pins/entrypoint only after the candidate passes. A genuine customer defect is reproduced in its owning repo, fixed, packaged, rerun in Roots, then promoted. No invented defect or indefinite feedback period is required.

The completed checks combine source tests and real-browser acceptance as recorded
in [verification](verification.md); not every negative case is an end-to-end test.
Roots browser acceptance used rc2. Final rc3 changes only a checked declaration;
runtime files match rc2 byte-for-byte. The isolated Roots consumer is limited to
15 commands and one recipe. Active everyday-stack failure testing and normal
Roots migration remain future promotion gates in [the plan](plan.md).
