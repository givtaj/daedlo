# Installation and first session

Use the application repository's conventions. A small integration directory can
hold its own Node manifest/lockfile, Rust customer binary, adapter, project module
and acceptance checks; do not rewrite the application's dependency graph merely
to introduce QA tooling. Existing integrations may already provide these pieces.

## Inventory and choose the environment

Inspect source and current Git changes before editing. Find the app's existing
startup, health checks, authentication, test data and cleanup mechanisms. An
available port proves neither migrations nor usable fixture data. Identify one
useful story and the permitted account/data/effects; infer mechanical setup from
the repository, and clarify only unresolved choices that change behavior or risk.

Choose explicitly between an existing environment and an owned test fixture:

- Existing environment: attach without restarting its services, replacing its
  dependencies, resetting its data or logging out its user. Preserve current input.
- Owned fixture: verify application readiness, required migrations and synthetic
  accounts/catalogues through the application's actual APIs. Register every owned
  process, port, browser, temporary route and data resource for scoped cleanup.

Application and browser ownership are independent. An existing app service can be
paired with a new owned QA browser while the user's original browser stays intact.
Reusing that exact browser session instead requires its authorized control handles;
preserving it does not require attaching to it.

Docker is needed only if that application's fixture requires it. A static site,
existing dev server or in-process fixture needs no container solely for this tool.
Fault injection, service restart and destructive cases require an owned disposable
fixture and explicit tested capabilities. Leave those recipes unavailable when
the capability or readiness proof is absent.

## Install the selected package pair

For the current protocol-1 implementation, the runtime requires Node 22 or later
and pins Playwright 1.62.1. The repository pins Rust 1.96.0. Use the chosen release's
manifest and package metadata if these change. The customer's compiled Rust model
is required even when its application uses a different language.

Perform setup using an existing compatible local toolchain where possible. Install
missing project dependencies within the scoped integration. Playwright installs
matching Chromium in its normal user cache unless configured otherwise. If using
`PLAYWRIGHT_BROWSERS_PATH` for a dedicated cache, persist the same value for install,
launch and verification. Preserve unrelated cached browsers. Host-level toolchain
changes or downloads remain subject to the environment's normal permissions; do
not silently replace the system toolchain.

Use an explicit trusted bundle or an explicitly selected source revision. Do not
assume `@browser-driver/runtime` or the crate has been published to a registry.
A bundle contains the runtime `.tgz`, engine library `.crate`, `manifest.json`
and `SHA256SUMS`; it does not contain a prebuilt customer engine or the release CLI.

With the selected source checkout located, inspect its release instructions and
run its actual verifier with the bundle path and independently trusted manifest
digest, for example from that checkout:

```sh
node scripts/release/cli.mjs verify --bundle /absolute/bundle --sha256 TRUSTED_DIGEST
```

The digest must come from the selected trusted release/CI receipt or the user's
explicitly trusted local build, not merely the untrusted bundle's own checksums.
If building from source is the chosen path, use that checkout's documented build
procedure and preserve its source identity. Do not mark a dirty local experiment
as a published release.

Create/reuse a private ESM `package.json` in the scoped integration. Set the following
variables to the actual chosen paths; then execute the install rather than leaving
these placeholders for the user. For a standalone npm integration:

```sh
npm --prefix "$driver_integration" install --save-exact --ignore-scripts --no-audit --no-fund "$runtime_tarball"
node "$driver_integration/node_modules/playwright/cli.js" install chromium
```

Verify the installed package version and public import resolve inside that
integration. Preserve the artifact path and generated lockfile for later `npm ci`.
For other package managers, use their equivalent exact-artifact installation.
Use the selected checkout's `tests/release-acceptance.mjs` as the existing example
of validating archive paths/link entries and extracting verified crate bytes into
owned output. Keep extracted crates under a stable integration vendor location;
do not overwrite an existing accepted copy. The customer Cargo dependency is:

```toml
browser-driver-engine = { path = "../vendor/browser-driver-engine-VERSION", version = "=VERSION" }
```

Replace `VERSION` with the verified version and resolve the relative path from the
customer Cargo manifest. Implement its model/binary, create its lockfile on initial
resolution, then build the explicit customer target separately:

```sh
cargo +1.96.0 build --locked --manifest-path "$driver_integration/engine/Cargo.toml" --target-dir "$driver_integration/target"
```

Follow the chosen release if its toolchain changes. Do not use private runtime
imports or an unrecorded mutable link as release proof. Record archive digests and
the compiled customer binary digest.

Release-store `update` selects verified archives; it does not install dependencies
into the application or rewrite a launcher. Preserve an existing accepted driver
while testing a candidate. Promotion and rollback cover runtime, crate, model,
adapter, lockfiles and launcher together.

## Wire the public integration

Consult the selected package's `README.md` and `src/index.d.ts`, and the crate's
`ApplicationModel` trait, before generating code. The current interfaces are:

```js
// A trusted project module for the installed browser-driver CLI.
export async function createProject({ resources }) {
  // Resolve existing configuration or start/register an owned fixture here.
  return { url, enginePath, createAdapter: ({ page, context }) => adapter, identity };
}
```

This is an interface sketch: resolve every returned value from the customer
integration. `identity` contains safe public metadata only. Adapter shape:
`{model:{id,version}, observe, handlers}`; optional hooks are `beginRun`, `endRun`,
`settle`, `evidence`, `effectStatus` and `close`. Model ID/version must exactly
match the Rust descriptor, and every declared command needs a handler.

Launch the integration's local binary explicitly, for example
`"$driver_integration/node_modules/.bin/browser-driver" --project "$driver_integration/project.mjs" --headed`.
This creates a **new owned browser/context**. The CLI navigates to `url` but performs no
automatic sign-in or authored commands. Authenticate deliberately using approved
synthetic accounts or the user's interactive login. Do not print credentials or
invent a generic `--signin`/session-restoration flag.

To preserve an existing controlled Playwright page/context, use the public API:

```js
import { createDriverSession, createViewer } from '@browser-driver/runtime';
const session = await createDriverSession({ page, context, enginePath, adapter });
const viewer = await createViewer({ page, context, session });
```

This requires actual authorized handles; the API does not discover arbitrary user
browser tabs. Creating a fresh context does not restore an existing draft or login.
State whether the controlled browser is headed or headless with a visible viewer.

Register acquisitions with `resources.own(handle, {label, close})` and existing
resources with `resources.attach(handle, {label})`. Register replacement resources
before discarding the previous handle. Closing session/viewer preserves supplied
page/context; the caller separately closes only browsers it owns. Runtime
`endRun` is for owned transient cleanup, not replaying application actions.

## Establish the first useful run

1. Observe before acting; compare facts and available commands with the visible UI.
2. Execute the agreed smallest useful command through guarded primitives and a
   fresh observed revision. A navigation/search flow can be a useful first slice.
3. Inspect application outcome and independent evidence. Add writes only with the
   agreed target, recovery semantics and stronger assertions needed by that story.
4. Repeat as an authored recipe with its initial-state and fixture preconditions.
   Do not reset a live draft just to make the recipe available.
5. Run affected Rust/Node contracts and actual customer browser checks. Inspect the
   visible result before claiming its presentation is ready.

Persist the relevant completed `session.report({runId})` and customer assertions
before later exploration. Completed reports are bounded in-memory records (latest
16 runs), not a durable evidence store; raw observations and persistence evidence
are intentionally omitted. Keep private diagnostic material ignored and publish
only sanitized evidence and accurate source/artifact identities.

Finish with the reproducible launch command, story-to-flow map, measured results,
remaining limits, and owned cleanup or explicitly retained resources. Preserve
private recovery handles when cleanup fails. Install/onboarding completion means
the agreed slice actually works, or a concrete blocker is reported without a false
pass; it does not mean unrelated application features have been implemented.
