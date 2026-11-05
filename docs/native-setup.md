# Native setup with Codex

The alpha.5 tools retain the native launcher introduced in alpha.4. Use the selected kit
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

## Existing custom runners

Use the [managed integration reference](managed-integration.md) for separate model
preflight, guarded actions and explicit private application metadata while keeping
the exact injected session. The complete `examples/managed-starter/` reference
ships with the tools alongside its independent starter model.

## Evidence and recovery

See [effect evidence and immutable reporting](evidence-reporting.md) for public
custom runners, exact-operation proof and the limits of bounded reports.

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

### Recover observation in the existing owned session

The explicit observation reporting below describes the current source change;
publication and exact installed-kit verification remain separate. Published
alpha.6 tools can report generic busy/draft blockers or `stopped` when child
observation fails. Treat those fields conservatively and preserve the original
owner; installing different tools does not change an already loaded adapter.

Native status separates observation from ownership. `observation.status` is
`available`, `failed`, `unreachable`, `starting` or `not_running`; failures include
a bounded, static `{code,message}` reason. The native handoff reports
`status:"observation_failed"` or `status:"unreachable"` with `ok:false` for these
failures, rather than confirming a stopped owner. A retained running installation
identifies the owned child. It does not establish a currently connected page,
clean draft or safe shutdown. Unknown draft state remains unknown; it must not be
presented as a confirmed dirty form. A successful status request alone does not
establish any application outcome or persistence.

Both the viewer's `/status` and public `session.observe()` / `session.snapshot()`
perform fresh observation. Native `status --config FILE` also obtains fresh
session and draft measurements from the same managed child. These reads do not
execute a command, replay a save or reload the adapter. No separate reobserve
command is required when the existing adapter can measure the current page again.

1. Retain the original owner, configuration, selected installation, private
   receipts and completed-run archives. Obtain status using that configuration;
   reconnect only to the authenticated owner's returned URLs. Record the safe
   failure category and distinguish failed observation from lost communication.
2. Inspect the controlled application through its existing approved access path.
   If the application provides an ordinary read-only route out of an error page,
   use it only when the integration's draft and pending-operation contract permits
   that navigation. Preserve pending request, journal and effect evidence. Do not
   reload or navigate merely to discard an unresolved save.
3. Request status again. Recovery requires fresh model/connection and draft
   measurements, plus the existing run, pending-operation and archive checks.
   Historical clean state is not a substitute. A successful observation restores
   current readiness; earlier completed results and uncertain effects remain
   unchanged. Review any remaining blockers before continuing.
4. If closure is required, request normal `stop --config FILE` through the same
   owner. A refusal retains its resources and evidence. Repair only the reported
   prerequisite and request a new observation; do not bypass the safe boundary.

If observation fails after the supervisor has acquired its own quiesce pause,
that gate stays retained. A later explicit guarded stop may drain that same
owned pause after fresh available observation, idle execution, clean draft and
complete evidence establish the safe boundary. It does not resume application
effects. A pause requested by the user remains a blocker; the supervisor cannot
claim or release it as its own. Status reads alone never resume a paused run.

| Fault | Supported action | Evidence that must remain intact |
| --- | --- | --- |
| Adapter cannot measure an error page, but child communication works | Restore a page recognized by the loaded adapter using an application-approved read-only path, then request status. An authored unavailable state may disable commands while the adapter independently measures safety. | Current draft, pending requests/journal, operation identity, run results and archive state; the unavailable state alone proves none of them clean. |
| Document or frame detaches during requests | Retain the original request handles and await actual `requestfinished` / `requestfailed` terminal evidence using the integration's tested accounting. Missing terminal evidence remains unresolved. | Request identity and any submitted operation; navigation, a new document or removing a listener is not terminal evidence. |
| Child status request times out while the owner remains alive | Keep the original supervisor and recovery records. Restore communication where possible, then request fresh status. A retained marker or PID is not a live observation or proof of cleanup. | Ownership handles, completed archives and any still-private in-memory pending evidence. Do not start a replacement owner or delete records to make startup pass. |
| Owner exits or child IPC disconnects | The child attempts to drain its owned resources on IPC disconnection; a hard process/host failure may prevent this. Retain durable reports and recovery records, then establish actual cleanup before replacement. This is distinct from reconnecting to a surviving owner. | No guarantee covers unsaved drafts or in-memory pending evidence after process/host loss. A dead PID does not prove browser cleanup, application persistence or preservation of a draft. Attached application resources are not generic cleanup targets. |
| Host interruption or laptop sleep | If the original owner survives, reconnect to it and inspect fresh status, application state and pending evidence. Classify the actual failed prerequisite rather than assigning a cause from elapsed time. If the owner is lost, use the owner-loss case above. | Original command/effect history and durable archives; reconnecting must not replay an action. Sleep alone does not establish whether drafts or in-memory pending evidence survived. |
| Completed-run archive cannot be saved | Repair local storage and use `retry-evidence --config FILE`, then check status before guarded stop. | The retained canonical report and its original execution/outcome/effect; evidence retry performs no application command. |

If the loaded adapter can no longer measure the page and no safe read-only route
restores that measurement, there is no generic safe-stop shortcut. Keep the owner
and evidence for integration-specific repair. `refresh` prepares a separate source
snapshot; it does not hot-reload code into the existing session, and `restart`
still requires the normal safe boundary. A corrected adapter or new tools release
therefore does not by itself recover an already running old adapter. Lost
communication or unreconciled effects may require the integration owner to
establish cleanup explicitly before any record repair or replacement. Attached
application services and resources remain outside generic cleanup authority.

Use the [minimal synthetic reproduction contract](managed-integration.md#observation-and-interruption-reproduction)
when upstream assistance is needed. The verification record distinguishes tested
fixture faults from customer incidents and from actual operating-system sleep.

Validation of these tools is separate from onboarding your application. Preserve
PASS/FAIL/BLOCKED/NOT RUN, exact tools/runtime/browser identities, first success,
negative case, repeated flow, independent persistence evidence and cleanup in the
project handoff. See the source repository's verification record for tested scope.
