# Connect Daedlo {{VERSION}} to one application flow

Complete [START_HERE.md](START_HERE.md) first. Open the application project in
Codex on macOS arm64, give the agent the actual extracted kit path, and use this
request:

> Read AGENT_START.md in my verified Daedlo kit at the path I supplied. Integrate
> this exact package pair beside my application's existing code. Inspect our setup and
> reuse accepted models and behavior. Start with one existing flow that matters;
> clarify any material missing behavior before authoring its model. Connect the
> native Rust model and guarded Node adapter, show the local viewer, verify the
> flow and a relevant negative case, preserve the assertions and final report,
> then close owned resources and repeat the authored flow after relaunch. Leave
> reproducible instructions and evidence. Preserve our application dependencies, services, data, sessions and
> unrelated work. Perform the integration work within this scope.

This is an assisted alpha path for one existing flow. Linux, Windows, Claude Code,
fresh OS/toolchain installation and independent self-service onboarding remain
outside its acceptance claim. Read the exact version's verification receipt;
neither this guide nor a previous candidate's results establish this kit's release
or acceptance status.

## Instructions for the agent

1. Read the application's instructions and inspect its current changes. Resolve
   the supplied kit path to an absolute path; do not infer it from a copied skill
   or use a remembered package version. Read the kit's license and component
   notices. Daedlo is a product brand, not a separate legal entity; these
   instructions add no license terms or customer agreement.
2. Confirm the tools installation and bundle verification described in
   `START_HERE.md`. The expected manifest digest is `{{MANIFEST_SHA256}}` and the
   expected tools archive digest is `{{TOOLS_SHA256}}`. Integrity checks need
   the independently supplied candidate or website release receipt; do not replace an expected
   digest with one calculated from an unexplained download.
3. Read these files from
   `installed-tools/node_modules/{{TOOLS_NAME}}` inside the kit:
   `skills/{{SKILL_NAME}}/SKILL.md`, its `references/onboarding.md` and
   `references/model-and-flows.md`, `docs/contracts.md` and
   `docs/agent-onboarding.md`. The runtime's public types and the crate's
   `ApplicationModel` trait govern code. A private source checkout is unnecessary.
4. Install the complete skill into `.agents/skills/{{SKILL_NAME}}` in the project
   for Codex. Inspect existing instructions first. If that directory exists,
   compare the copies and preserve customizations instead of overwriting them.
   Include every supporting file and notice. Record whether Codex discovers the
   skill; if it does not, explicitly read `SKILL.md` and its linked references and
   continue assisted onboarding. Do not claim discovery based on copying or
   reading files. Preserve `AGENTS.md` and other existing agent instructions.
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
`bundle/{{PACKAGE_PREFIX}}-runtime-{{VERSION}}.tgz`. Create/reuse the integration's
private ESM `package.json` before installing:

```sh
npm --prefix "$driver_integration" install --save-exact --ignore-scripts \
  --no-audit --no-fund "$runtime_tarball"
node "$driver_integration/node_modules/playwright/cli.js" install chromium
```

Verify ordinary `{{RUNTIME_NAME}}` imports resolve inside this integration.
Retain the runtime tarball at the lockfile's referenced path for future `npm ci`.
Before extracting `bundle/{{ENGINE_NAME}}-{{VERSION}}.crate`, inspect its
entries: only regular files/directories under
`{{ENGINE_NAME}}-{{VERSION}}/`; reject traversal, absolute paths, symbolic
links and hard links. Extract the verified bytes into fresh owned vendor output.
From `engine/Cargo.toml`, with that vendor directory beside `engine`, use:

```toml
{{ENGINE_NAME}} = { path = "../vendor/{{ENGINE_NAME}}-{{VERSION}}", version = "={{VERSION}}" }
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
and launch from its recorded integration paths. Choose a new report filename for
each session so a repeat run preserves the previous evidence:

```sh
cargo +1.96.0 build --locked \
  --manifest-path "$driver_integration/engine/Cargo.toml" \
  --target-dir "$driver_integration/target"
mkdir -p "$driver_integration/reports"
"$driver_integration/node_modules/.bin/{{SKILL_NAME}}" \
  --project "$driver_integration/project.mjs" \
  --report "$driver_integration/reports/first-session.json"
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

Preserve the customer assertions and useful completed reports deliberately. An
integration using the session API can capture `session.report({runId})`; only the
latest 16 completed reports remain in memory. Raw observations and persistence
evidence need separate customer records. Keep credentials, private data and raw
traces out of shared records.

Send Ctrl+C once in the CLI terminal and wait for finalization. Inspect the
`--report` file, final application outcome and resource cleanup. This is a final
session view, not an export of every run or private persistence evidence. Preserve
attached services and sessions. If owned cleanup fails, retain its handles,
investigate, and retry through the CLI's documented Ctrl+C or SIGTERM path without
replaying application actions. A deliberately retained viewer needs an owner and
close procedure; record shutdown acceptance as pending.

Relaunch with the same recorded runtime/crate/model/adapter combination and a
different report filename. Re-establish only the documented prerequisites and
repeat the authored flow. Record this result and final cleanup. Leave exact
package/model/application identities, kit and integration paths, build/launch
commands, assertions, evidence locations and remaining limits. Complete onboarding
requires the agreed flow, negative case, repeat run and cleanup to be verified;
report a concrete blocker without labelling incomplete onboarding successful.

For later versions, read the installed `docs/ninja-update.md`. Alpha.3 includes
production preview-feed metadata and a pinned public key in `docs/update-trust`.
Prepare the reviewed managed registration and disposable acceptance/health hooks
without changing accepted model/adapter source. Verify a complete candidate before
Restart; retain and test the previous installation with Revert. Preserve current
authoring files and application data. Ordinary `createProject` integrations need
an explicit managed launcher; they are not silently converted. The manual kit
path in `START_HERE.md` remains available. Legacy archive selection does not
install or activate a customer project.
