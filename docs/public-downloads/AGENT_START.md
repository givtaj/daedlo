# Connect Daedlo {{VERSION}} to one application flow

Complete [START_HERE.md](START_HERE.md) first. Open the application project in
Codex or Claude Code, give the agent the actual extracted kit path, and use this
request:

> Read AGENT_START.md in my verified Daedlo kit at the path I supplied. Integrate
> this exact release beside my application's existing code. Inspect our setup and
> reuse accepted models and behavior. Start with one existing flow that matters;
> clarify any material missing behavior before authoring its model. Connect the
> native Rust model and guarded Node adapter, show the local viewer, verify the
> flow and a relevant negative case, and leave reproducible instructions and
> evidence. Preserve our application dependencies, services, data, sessions and
> unrelated work. Perform the integration work within this scope.

## Instructions for the agent

1. Read the application's instructions and inspect its current changes. Resolve
   the supplied kit path to an absolute path; do not infer it from a copied skill
   or use a remembered package version. Read the kit's license and component
   notices. Daedlo is a product brand, not a separate legal entity; these
   instructions add no license terms or customer agreement.
2. Confirm the tools installation and bundle verification described in
   `START_HERE.md`. The expected manifest digest is `{{MANIFEST_SHA256}}` and the
   expected tools archive digest is `{{TOOLS_SHA256}}`. Integrity checks need
   the independently trusted website release identity; do not replace an expected
   digest with one calculated from an unexplained download.
3. Read these files from
   `installed-tools/node_modules/@browser-driver/release-tools` inside the kit:
   `skills/browser-driver/SKILL.md`, its `references/onboarding.md` and
   `references/model-and-flows.md`, `docs/contracts.md` and
   `docs/agent-onboarding.md`. The runtime's public types and the crate's
   `ApplicationModel` trait govern code. A private source checkout is unnecessary.
4. Install the complete skill into a fresh project directory:
   `.agents/skills/browser-driver` for Codex, or `.claude/skills/browser-driver`
   for Claude Code. Inspect existing instructions first. If that directory exists,
   compare the copies and preserve customizations instead of overwriting them.
   Include every supporting file and notice. Verify discovery in the selected
   host; explicitly read the skill if discovery is unavailable. Do not replace
   `AGENTS.md` or `CLAUDE.md`.
5. Reuse one accepted application flow and its state model where available.
   Otherwise agree its states, allowed actions, expected outcomes and a relevant
   failure or rejected-action case. Onboarding does not authorize inventing new
   application features. Review readiness, fixture data and observation/effect
   permissions before browser actions. A notebook demonstration is not customer
   acceptance.

## Install and wire the integration

Use a scoped integration such as `qa/daedlo` with its own private ESM package,
lockfile, Rust engine, adapter and project module. Preserve the application's
production dependencies. Use existing compatible toolchains, or a scoped Rust
toolchain; do not replace another project's compiler. Runtime dependencies,
Chromium and Cargo dependencies need network access or existing caches.

Resolve `driver_integration` to that absolute integration path and
`runtime_tarball` to the kit's exact
`bundle/browser-driver-runtime-{{VERSION}}.tgz`. Create/reuse the integration's
private ESM `package.json` before installing:

```sh
npm --prefix "$driver_integration" install --save-exact --ignore-scripts \
  --no-audit --no-fund "$runtime_tarball"
node "$driver_integration/node_modules/playwright/cli.js" install chromium
```

Verify ordinary `@browser-driver/runtime` imports resolve inside this integration.
Retain the runtime tarball at the lockfile's referenced path for future `npm ci`.
Before extracting `bundle/browser-driver-engine-{{VERSION}}.crate`, inspect its
entries: only regular files/directories under
`browser-driver-engine-{{VERSION}}/`; reject traversal, absolute paths, symbolic
links and hard links. Extract the verified bytes into fresh owned vendor output.
From `engine/Cargo.toml`, with that vendor directory beside `engine`, use:

```toml
browser-driver-engine = { path = "../vendor/browser-driver-engine-{{VERSION}}", version = "={{VERSION}}" }
```

Keep the customer model, adapter, project module, flows and acceptance checks
outside installed dependencies and vendor files. Rust owns typed facts, state
derivation, guards, outcomes and canonical recipes. Node observes the application,
performs guarded actions and collects evidence. Do not duplicate the application
transition graph in JavaScript.

Implement the customer's native engine and a project module exporting
`createProject({ resources })`, returning `url`, `enginePath`,
`createAdapter({ page, context })` and safe public `identity` metadata. Match the
adapter's model ID/version to the Rust descriptor and provide every command
handler. Register owned and attached resources separately. Reuse existing services
without restarting them; fault injection requires an appropriate owned fixture.

Generate the customer Cargo lockfile on initial dependency resolution, then build
and launch from its recorded integration paths:

```sh
cargo +1.96.0 build --locked \
  --manifest-path "$driver_integration/engine/Cargo.toml" \
  --target-dir "$driver_integration/target"
mkdir -p "$driver_integration/reports"
"$driver_integration/node_modules/.bin/browser-driver" \
  --project "$driver_integration/project.mjs" \
  --report "$driver_integration/reports/session.json"
```

Ignore local dependencies, build output and private reports in version control.
Persist the same browser-cache configuration for installation and execution if
using a dedicated cache. The CLI creates a new browser/context and prints the
viewer URL; show that viewer to the user. Explain whether the browser is headless
with a visible stream or launched with `--headed`. Existing login sessions and
drafts are not transferred. Sign in only through an authorized flow.

## Verify and hand off

Observe the real application, execute the agreed flow through guarded actions,
and verify its relevant negative case. Inspect the visible result. Report
execution, application outcome and persistence separately; missing observations
or uncertain effects are not success. Confirm persistence claims with independent
read-back and use the application's own operation identity for safe retries.
Pause/stop cannot undo a request already sent.

Record exact package/model/application identities, launch commands, assertions,
remaining limits and cleanup ownership. Preserve useful completed reports and
customer evidence deliberately: runtime reports are bounded in-memory records,
not a durable archive. Keep credentials, private data and raw traces out of shared
records. Close only owned resources; report failed cleanup or intentionally
retained sessions. A verified installation is complete only when the agreed
customer slice works, or its concrete blocker is clearly reported.

For later versions, follow the website's manual download path in `START_HERE.md`.
Test a candidate separately before promoting the full runtime/crate/model/adapter
combination. Existing GitHub-only `check`/`download` commands do not fetch website
releases; selecting an archive store does not change customer dependencies.
