# Native setup with Codex

The alpha.4 tools include this additive native launcher. Use the selected kit
receipt for exact identity and verification, and the current
[verification record](https://github.com/givtaj/daedlo/blob/main/docs/verification.md)
for publication status. Alpha.3 has Ninja-Update; it does not have `daedlo-native`.
Keep the installed tools version and runtime version in the project handoff. Existing
`createProject`, the runtime CLI, archive update commands and `ninja serve` remain
supported. Use one launcher to own a managed project at a time.

## One assisted setup

The agent uses the accepted project integration and the [Ninja registration](ninja-update.md).
It records the model, adapter, flows, exact source allowlist, standalone dependency
locks, custom instructions/skills, isolated acceptance hooks and reviewed managed
launcher. Registration is project-owned source; a runtime update never regenerates
it. There is no generic inference of application states or successful saves.

Use a small integration directory and a separate ignored local store, for example:

```text
application/
  qa/daedlo/                 # authored integration and its standalone locks
  .daedlo-local/             # ignored, private, outside qa/daedlo
    ninja.json              # absolute source/store paths, explicit publisher trust
    tools/<version>/        # verified installed tools; retained across updates
    cache/npm/              # explicit setup cache when chosen
    cache/cargo/            # explicit setup cache when chosen
    store/                  # Ninja-owned slots, reports and session receipt
```

Add the local directory to the application's ignore rules. Keep application data,
credentials and services outside the store. Do not move or repin the application's
normal dependencies. `sourceRoot` and `store` must be disjoint: a store nested in
the allowlisted source is refused. Install the verified tools with explicit npm
destination and `--workspaces=false --ignore-scripts`, following the kit instructions.
Use full paths below; shell aliases in this example are not a required installation.

```sh
node /absolute/tools/node_modules/@daedlo/release-tools/lib/native.mjs doctor --config /absolute/project/.daedlo-local/ninja.json
node /absolute/tools/node_modules/@daedlo/release-tools/lib/native.mjs setup --config /absolute/project/.daedlo-local/ninja.json --version REVIEWED_VERSION
node /absolute/tools/node_modules/@daedlo/release-tools/lib/native.mjs start --config /absolute/project/.daedlo-local/ninja.json
```

`doctor` reads configuration, parses the registered integration without importing
customer modules, checks pinned public keys and bounded tool versions, and inspects
local ownership/installation/cache records. It creates no state and downloads
nothing. A pass does **not** verify browser launch, local listening permissions,
application readiness, authentication, network access, cache completeness or QA.
It separates configuration, dependency, permission, application and recovery
blockers with remedies. The running owner's status is authoritative for live use;
doctor conservatively flags retained child/operation records.

Initial `setup` requires the explicitly reviewed version to match the authenticated
catalog candidate. It installs into a new slot and runs the registered disposable
checks. Repeating setup reuses an existing selection or ready candidate. It never
upgrades a selected project. An interrupted build remains recorded; a later explicit
setup prepares a fresh slot. Failed artifacts are retained for inspection.

Use existing Node, npm, Rust/Cargo, Python and matching Playwright Chromium where
available. If dependencies are missing, the agent prepares them once in the selected
local environment/cache using scoped permission. `installation.offline` defaults to
true; explicit `false` allows acquisition during setup. npm lifecycle scripts stay
disabled. Rust builds and customer hooks are trusted code. Matching browser
installation remains an explicit prerequisite; keep that cache for rollback.
Docker is only an application-fixture choice, not a Daedlo requirement.

## Normal use and Codex Browser

Run `start` in a persistent Codex terminal or the project's local environment action.
It stays in the foreground and immediately prints JSON with the private `startupUrl`
before waiting for model or application readiness. Open that URL in Codex Browser.
The startup screen shows bootstrap, model validation, target attachment, ready,
failed and cleanup phases. It retains bounded, actionable model diagnostics after a
failed launch. When ready it links to the actual `viewerUrl`; the startup screen
and live stream remain separate, so viewer framing protections stay intact.
Status also includes the private `updateUrl`, selected/running installation and
evidence status. The agent opens the returned `viewerUrl` and checks the visible
stream. Never guess
a port, attach to arbitrary existing browsers, or launch another runner to reopen a
tab. `start` again authenticates the existing owner and returns `reused: true`.
`status` obtains the same live handoff. Opening/reconnecting a viewer runs no flow.

Configure a distinct frontend in each project's Ninja JSON:

```json
{"frontend":{"name":"Settings portal","targetOrigin":"http://127.0.0.1:4101"}}
```

`targetOrigin` is an exact HTTP(S) origin, without credentials, path, query or
fragment. The name, intended/measured origin, model identity, evidence location
and proven browser/context/application ownership appear in status. Legacy
configurations remain readable and explicitly show an unspecified target;
configure it to enable the origin check. Give independent frontends separate
configuration files and stores. A busy address or store is refused, never evicted.
The actual viewer and controlled session must refer to the same page and context.
A changed target/model or lost connection removes readiness and blocks commands
and controls that could resume effects. Pause and Stop remain available.

Stop during startup requests cooperative cancellation through the reviewed
launcher's AbortSignal. A launcher must unwind its owned resources and settle;
one that ignores cancellation remains pending with retained recovery handles.
Closing a tab does not cancel startup. No stopped/clean status is inferred from
sending a cancellation request.

The Codex tab shows Daedlo's live stream and authored command controls. It is not
the application DOM and is not a way to type into the controlled application.
If a flow requires manual sign-in, consent, CAPTCHA or manual interaction, the
project's reviewed launcher must start a **headed controlled browser from the
outset**, with an explicit setting and project-owned profile policy if needed.
Complete that step there, then continue through the viewer. This launcher does
not silently switch an existing session between headed and headless browsers.

`stop` asks the owner to preserve reports and close its resources. Busy runs,
unknown/dirty drafts and incomplete cleanup defer shutdown. Attached application
services survive. A closed viewer tab does not stop the runner. No automatic flow
replay, process-name kill, port eviction or global browser cleanup is performed.

Sandbox policies belong to the host. Run dependency setup/build and the persistent
runner in the project's approved local context. A denied command/listener/browser
launch needs the normal narrowly scoped host permission or environment action;
the tools do not edit Codex permission settings or disable sandboxing. Permission
may be needed again when the command, path or host context changes.

## Continuing development and future Daedlo updates

The same Ninja store owns initial setup, source refresh, updates and rollback.
Keep the registration and project-specific instructions in source control; keep
immutable tools releases, retained bundles, browser cache and private receipts local.
Do not overwrite a running tools directory. Tools/config identity changes refuse
reuse until the old authenticated owner is safely stopped. The new tools can still
request that safe stop when the configuration continues to identify the same store.

After editing allowlisted source, use `refresh --config FILE`. It builds a new slot
using the exact accepted release's retained verified bundle, with no feed check or
version upgrade, and runs the existing acceptance/health checks. It also compares
the model descriptor; changed states/commands/recipes require a reviewed migration.
Then `restart --config FILE` explicitly activates the ready candidate, from either
a running or stopped project. Ordinary `start` keeps the selected installation and
refuses stale authored source. A refresh doesn't overwrite the prior slot or edits.

For a newer Daedlo runtime, open `updateUrl`: **Check for updates → Install update →
Restart Daedlo**. **Revert update** selects the complete previous installation,
including its snapshot and adapter, without overwriting current authoring files or
undoing application writes. `status` after replacement supplies the current viewer
URL; reconnect that URL. Expired catalogs block discovery/downloads, not an already
accepted local launch, source refresh from retained bytes or rollback.

Keep customized skills and guidance in the registration allowlist. Read the new
versioned standard guidance and merge necessary changes explicitly; never replace
a customized copy during a runtime upgrade. Upgrading the native tools/manager
itself is a separate verified bootstrap: stop, install a new tools directory,
check its contracts, run doctor, then start against the same configuration/store.
Keep the previous tools directory for recovery. There is no background updater.

## Evidence and recovery

Managed completed runs are saved immediately in `store/supervisor/run-reports/` as
private JSON envelopes with installation identity and the runtime's canonical
report. Execution/outcome/effect remain unchanged if saving evidence fails; status
shows the incomplete archive and further runs/safe replacement are blocked. Repair
local storage, then use `retry-evidence --config FILE`; no flow is replayed.
Ninja also persists its final shutdown/replacement report in `store/reports/`.
Reports may contain private application data. Do not commit or publish them.

The private `native-session.json` contains the owning instance and local capability
URL. Reconnection verifies that endpoint and the tools/config identity. If an owner
cannot be authenticated, the command reports recovery required, retains its record,
and does not start a second browser. Inspect that receipt, Ninja's transaction and
`supervisor/child.json`; establish cleanup of owned resources before manually
repairing records. A dead parent PID alone is insufficient evidence of cleanup.
No automatic retention deletion is installed. Unknown or failed cleanup remains
visible and recoverable rather than being silently labeled stopped.

Validation of these tools is separate from onboarding your application. Preserve
PASS/FAIL/BLOCKED/NOT RUN, exact tools/runtime/browser identities, first success,
negative case, repeated flow, independent persistence evidence and cleanup in the
project handoff. See the source repository's verification record for tested scope.
