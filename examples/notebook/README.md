# Independent conformance fixture

Run `cargo build --locked --workspace` and `npm run demo:notebook` from the repository root
after installing dependencies and Playwright Chromium. Open the printed viewer.

The primary product example is [actual Roots work](../roots/README.md). This tiny independent app is an engineering fixture that demonstrates customer-owned states and four commands:
edit, save, discard and change options. Options include boolean, select and number
fields. The state map and controls come from its Rust descriptor; the shared viewer
contains no notebook-specific labels, selectors or field assumptions.

- `server.mjs` starts an owned local HTTP server with disposable in-memory notes.
- `index.html` implements the actual browser form and operation identities.
- `adapter.mjs` reads facts, performs guarded actions and gathers API evidence.
- `project.mjs` composes the CLI fixture and adapter through public APIs.
- `../notebook-engine` implements the typed Rust model and authored recipe.

Saving retains the same operation identity when a response is lost. The server
deduplicates that operation, and the browser acceptance verifies one matching
record after retry. This is an explicit example backend contract, not a generic
exactly-once guarantee from browser-driver. Data disappears when the example server
stops; persistence-after-process-restart is not claimed.

An existing unsaved draft blocks the authored recipe. Explicitly discard it before
running a new example. Empty input demonstrates validation; controlled network
failure and lost response are exercised by `npm run test:e2e`.
