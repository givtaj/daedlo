# Isolated Roots Journal edit consumer

This opt-in consumer connects the public `@browser-driver/runtime` and
`browser-driver-engine::ApplicationModel` to the frozen Roots Journal edit source
reviewed on 2026-10-04. It does not change everyday Roots dependencies or import
its embedded execution runtime. Source capture, packaged acceptance and cleanup
are recorded by the enclosing integration runner.

The customer Rust model supplies exactly four canonical plans through its public
`respond` function: `edit-save`, `edit-cancel-retained`,
`edit-lost-response-retry`, and `edit-persisted`. The JavaScript adapter owns
selectors and assertions, and uses guarded runtime primitives for browser actions,
route installation and API restart. Other Roots recipes are not exposed.

```js
import { attachRootsEdit } from './consumer.mjs';

const consumer = await attachRootsEdit({
  page, context, snapshotRoot, enginePath, account, identity,
  disposable: true,
  fixtureReady: true,
  restartApi, // restart only the API process owned by this disposable fixture
});
const snapshot = await consumer.session.observe();
const result = await consumer.session.runRecipe('edit-save', snapshot.revision);
```

`fixtureReady` is an explicit assertion by the fixture owner that migrations,
synthetic customer provisioning and application startup were verified. It defaults
to false. Recipes are unavailable before that proof and an explicitly disposable
session. Persistence additionally requires an owned restart callback; lost-response
recovery requires disposable route faults. Each recipe creates its own target
entry, so shared strains or pre-existing Journal history are not prerequisites.

The result distinguishes setup creation from the requested edit. Cancellation
can report a saved setup entry and an unattempted edit. A successful HTTP status
alone never proves a save: matching receipt, owner and fresh read-back are
required. Exact retry identities and payloads stay private to the adapter.

The lost-response scenario verifies that the expected uncertain recovery occurred
before advancing to its retry. That step's outcome explicitly says the save
remains unconfirmed; its effect remains uncertain until the exact replay supplies
matching evidence. Ordinary uncertain commands remain unknown. Reload and API
restart persistence are separate customer assertions.

Per-run cleanup removes only routes installed by this adapter. Failed cleanup
retains its handle, is reported by the runtime, and can be retried on the next run
or close. Attached page and context ownership remains with the caller.

Focused contracts require the captured source and a compiled customer binary:

```sh
cargo test --offline --locked --manifest-path integrations/roots/edit/engine/Cargo.toml
cargo build --offline --locked --manifest-path integrations/roots/edit/engine/Cargo.toml
node --test integrations/roots/edit/tests/*.test.mjs
```

Use `ROOTS_EDIT_SNAPSHOT` and `ROOTS_EDIT_ENGINE` to test a separately staged
snapshot and packaged engine. These are contract tests, not browser acceptance;
see the repository verification record for actual browser results and identities.

## Reproduce the packaged check

Use Node 24+, the pinned Roots base available in a local checkout, its reviewed
application/controller source receipts, installed matching web dependencies,
cached Rust dependencies, Chromium and Docker. Each output directory must be new.
The preparation command rejects an overlay if the live source no longer matches
the reviewed receipts; select and review new receipts instead of bypassing it.

```sh
npm run roots:feature:prepare -- /path/to/roots /path/to/app-source.json /path/to/controller-source.json artifacts/my-edit
npm run roots:feature:stage -- /path/to/runtime.tgz /path/to/engine.crate artifacts/my-edit/capture/snapshot artifacts/my-edit/candidate
npm run test:roots-feature -- artifacts/my-edit/capture/snapshot artifacts/my-edit/app-target/debug artifacts/my-edit/candidate artifacts/my-edit/run01
```

The runner provisions a separate PostgreSQL container, synthetic accounts and
shared catalogue, API/web processes and Chromium. It drives the four recipes via
the generic viewer, checks independent application read-backs, stopped-run cleanup
and report preservation, then closes its owned resources. Raw evidence stays under
ignored `artifacts/`. `DRIVER_VIEWER_HOLD_MS=10000` pauses briefly after printing the
viewer URL so it can be opened while the owned headless browser runs.

The protocol currently uses one availability hook for direct commands and recipe
steps. Internal checkpoint/fault/assertion controls can therefore appear enabled
in the generic command list, but their adapter handlers reject direct execution
before effects. Run the named recipes; separate recipe-only catalog metadata is
a future shared-contract improvement.
