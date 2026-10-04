# Isolated Roots consumer acceptance

Pinned baseline: `d4008e39aeaa137bb54ff48ca2d11748083a971a`.
The live Roots checkout, dependencies, services and data are never mutated.

First, the consumer contract must fail because the external-package integration is absent. This is structural red evidence, not browser acceptance. Then stage a consumer in a private git-archive snapshot, use a packed Node artifact and the Rust public library, and build into a separate target directory.

Browser/API/disposable-DB scenarios:

- Attach without navigation: keep current session and populated Journal draft.
- Customer signin and Profile/Journal commands exercise the public runtime and the customer engine.
- Stale draft edits and session changes reject before an effect; retain edited input.
- Profile validation remains validation; save success requires API read-back.
- Pause/resume/stop at guarded action boundaries; an already completed save is reported truthfully.
- Lost successful Journal response retains retry identity; retry has exactly one persisted record.
- Viewer reconnect/reload performs no command replay.
- Fixture cleanup stops only owned services; live Roots source fingerprint remains unchanged.

Record package/engine/app source hashes and actual pass/fail/not-run results under ignored `artifacts/roots`. Baseline known defects remain explicit; never weaken an assertion to hide them. This consumer stage does not migrate the everyday Roots entrypoint.
