# Daedlo v0.1 contract (implementation target)

Daedlo is the product and current-source technical name: `@daedlo/runtime`,
`daedlo`, `daedlo-engine` and `skills/daedlo`. Published alpha.3 and earlier kits
keep their original names. Protocol and report identifiers remain stable, including
`browser-driver-report/1`; the naming change does not redefine those contracts.

The user approved implementation of the proposed local driver and isolated Roots-first workflow. Roots' live checkout and normal entry point must not be modified. Its first consumer acceptance runs in an isolated snapshot, with explicit candidate dependencies and recorded identities. Migration of the everyday Roots entry point is a separate promotion.

## Persistent workspace compatibility foundation

The unreleased R0a source candidate accepts existing bootstrap schema 1 unchanged
and adds explicit schema 2 for customer-owned storage. Schema 1 cannot contain
workspace settings. The workspace root, authored source, manager store and tools
installation must remain separate. Workspace identity and format versions belong
to `workspace.json`, independently of runtime/package versions.

The first format stores existing schema-1 `daedlo-managed-run` reports under
`projects/<projectId>/run-reports`. R1 adds explicitly opted-in journal format 1;
the optional Universal package adds the target catalog and knowledge described below.
Automatic archive import remains a later round.
Unknown or changed workspace
formats/ownership are refused before manager mutation, activation, session startup,
managed effect dispatch and evidence writes. A running owner can still attempt
safe stop; existing draft, pending-evidence and resource-cleanup guards apply.

Storage failure preserves the application's observed result and retains the
detached report for storage-only retry. Restart, update and rollback do not migrate
or replay stored work. See the [configuration and compatibility contract](native-setup.md#persistent-workspace-compatibility)
for adoption and release gates.

## Optional Universal storage contract (unreleased R5c)

Basic Daedlo keeps its existing package, commands, live viewer and storage defaults.
Universal is installed separately as `@daedlo/universal`. Its R5c tools read catalog
schema 1 without mutation, retain R4 operations on schema 2, and require schema 3
for archive imports; target-history projection,
workspace manifest and run-journal formats stay at 1. Package installation and
service startup never migrate a catalog. Explicit `daedlo-universal upgrade`
retains a consistent catalog snapshot and owner receipt before each additive
1-to-2 and 2-to-3 transition, preserving target bindings/revisions, indexed history,
evidence, manual records and journal bytes. R3 writers refuse schema 2 and R4
writers refuse schema 3. A proven interrupted migration can resume; unknown
ownership or old-writer divergence remains preserved and refused.

Evidence publication writes bounded immutable target-scoped files before committing
metadata. An interrupted publication is either registered or retained for explicit
storage-only retry with the same ID. Unknown partial files are never silently
adopted or removed. Findings and knowledge retain content revisions and append-only
review decisions. Summaries include only currently accepted knowledge whose
references still verify and whose integration pin matches; unavailable evidence and
changed integration identity exclude it without deleting retained records. Historical
knowledge never substitutes for live application guards. File bytes and manual
notes do not enter existing run journals or public exports.

Explicit single-file import accepts supported schema-1 managed completed reports.
One catalog transaction retains the original bytes, source hash/format, original
installation identity and explicit target assignment. Repeated imports are
idempotent; conflicting content or target reassignment refuses without overwriting
history. Imported reports retain their missing/truncated-history disclosures and
never gain invented journal start or intent events. Index rebuild preserves these
authoritative imports. Original files remain unchanged; history reads and imports
never execute application actions. Archive-only history is browsable separately
from the journal references required by evidence and reviewed knowledge.

Explicit full-workspace backup coordinates journal writer ownership with an
exclusive SQLite snapshot and verifies the complete bounded file inventory before
publishing its manifest. It includes unindexed journals, imported original bytes,
evidence and all manual revisions/reviews. Changed sources, existing writers,
unproven ownership or incomplete cleanup refuse completion and preserve output.
Restore verifies the complete backup into a new disjoint directory, preserves
original ownership receipts, and rebinds only proven copied file identities. The
workspace marker is published last. External target bindings are not rewritten;
historical access never grants live-launch permission or replays actions.

Rollback requires a same-workspace full backup already at the requested supported
schema, creates a mandatory full backup of current data, then restores the older
boundary into another new directory. It never overwrites or down-converts current
data. Explicit receipt-based recovery can retire only exact proven-dead backup
writers. Failed or unknown proof remains retained. These optional commands do not
change basic Daedlo installation or storage behavior.

Catalog schema 4 is an explicit compression opt-in; new catalogs and ordinary
legacy upgrades stay at schema 3. An existing schema-4 default upgrade is a no-op.
Compression retains exact completed journal JSONL as bounded, hash-verified gzip
in SQLite. The default retains plain files. Explicit replacement publishes a small
unsupported-format marker at the original path only after compressed data is durable,
and removes only proven-owned original bytes after verification. The marker reserves
the run ID; new basic writers remain plain and unchanged. Old Universal refuses
schema 4, while old basic historical reads of replaced runs report unsupported format.
Incomplete/partial journals retain their original bytes and uncertainty disclosures.

Compression records preserve immutable source provenance; current physical bindings
are separately verified and rebound on fresh restore. History, evidence and manual
knowledge use the exact original decompressed events, never replay. Pending source
replacement blocks backup until explicit cleanup/recovery completes. Target-scoped
journal recovery requires an inspected receipt and retires only exact proven-dead
unmanaged writers, using the unchanged R2 protocol. Failed or foreign ownership is
preserved. Compatible rollback uses the prior full backup and retains latest data;
there is no automatic decompression, downgrade, expiration or action execution.

Universal usage and bounds are documented in packages/universal/README.md in the
source checkout and in the separate Universal package's README. The source-only
docs/storage-workspace-plan.md and docs/verification.md record measured
compatibility and remaining platform/release gates.

## Optional Universal container boundary (unreleased R6)

Universal's local container is a separate delivery of its existing catalog and
journal formats. It does not change basic Daedlo, migrate data on startup or replay
history. The default image contains runtime/tools only; customer Linux models,
reviewed runners and credentials are separate inputs. Build contexts have a closed
file inventory, content hashes and source/package receipts. Runtime runs as UID
1000 with a writable named workspace volume and without a Docker socket.

Explicit `serve --container-origin http://127.0.0.1:PORT --port INTERNAL_PORT`
permits internal wildcard binding while retaining exact public Host/Origin,
mutation Origin, cross-site and bearer guards. Compose must publish only on host
loopback. Default native binding is unchanged. Container responses advertise
`liveLaunch: false`; managed native launch refuses before calling the launcher.
Reviewed integration runners execute explicitly through the installed runtime and
Linux engine; history, evidence and knowledge remain available in the workspace UI.

A separate non-root ownership service retains the Linux PID namespace during
application-container replacement. Existing R2 recovery may retire only a proven
absent unmanaged writer in that same namespace/boot, with an exact inspected receipt.
Namespace loss, host reboot, changed proofs and reused/live PIDs remain refused.
The ownership service has a separate proof volume and no customer-workspace access
or network. A fresh lifetime UUID plus a live bounded Unix-socket nonce exchange
fences supported container CLI/runner dispatch; inode reuse or stale disk pointers
cannot authorize a new coordinator. Only empty/new volumes can be bound, and the
original workspace binding is immutable. Source/destination operands remain inside
the fenced volume. Replacing the coordinator is not a recovery mechanism. All volumes, partial data, failed attempts and original backups
remain retained; compatible restores use new roots and never redirect live bindings.

See [container delivery](universal-container.md) for explicit preparation, target
addressing, replacement and acceptance. The verification record distinguishes
Linux conformance from managed live-viewer parity, publication and customer adoption.

## Ownership

- One Node package: `@daedlo/runtime`, version `0.1.4-alpha.5`, Node >=22, ESM; protocol 1.
- One Rust library: `daedlo-engine`, version `0.1.4-alpha.5`; compiled customer engine binaries implement `ApplicationModel`.
- Runtime owns one execution, revisions, interruption, transport and the viewer. Customer owns facts, nested state enums, commands, guards, outcome interpretation, browser handlers and fixture semantics.
- App integrations are trusted code. Guarded action helpers are the supported effect path, not an isolation boundary against malicious adapters.
- The first Roots consumer remains tied to commit `d4008e39aeaa137bb54ff48ca2d11748083a971a`. The explicitly requested Journal edit port may stage a reviewed working-tree feature overlay on pinned base `96275b53145e00e282d7c6a6f80faf3a5ad6df10` through the source checkout's `integrations/roots/prepare-feature.mjs` (not included in portable tools). Only selected source files whose bytes match the supplied review receipts are copied into the isolated snapshot. Record its source digest and distinguish this overlay from committed Roots source; unrelated dirty files remain untouched. Later ports still require a requested review of explicit source identities. No automatic sync or services.

## JSON Lines protocol 1

Requests: `{protocol:1,id,op,...}`. Every parsed response echoes `protocol:1,id,ok`. Errors include `{error_code,error}`. Stdout is protocol only. The transport must fail pending work on malformed/uncorrelated replies, exit or timeout, and never silently retry an effect.

- `hello`: returns `descriptor` and optional negotiated `capabilities`.
- `observe`: accepts `observation`; returns `state`, `fingerprint`, `commands`, `recipes`, `display`.
- `command`: accepts `observation`, `fingerprint`, `command` (string), `params` (object). Returns authorized `{action:{id,params}}` or rejection.
- `recipe`: accepts `observation`, `fingerprint`, `recipe` (string). Returns `plan:[{command,params}]` or rejection.
- `verify`: accepts `before`, `observation` (after), `command`, `params`, `evidence` (object). Returns `outcome:{kind,label}` with kind `success|validation|recoverable_error|unknown`, or rejection. `ok:true` never implies successful application persistence.

Observation envelope: `{connected:boolean,session:string,facts:object}`. Missing required facts, unknown state, incompatible model and absent handlers cannot imply success. Fingerprint includes the full typed observation and session. Application state is derived from observations, never assigned because a click ran. Facts and action parameters must be decoded at the Rust boundary. Model versions identify exact schema contracts; the Node adapter declares `model:{id,version}` and must match the descriptor before effects.

Descriptor: `{id,version,label,states:[{id,label,parent:null|string,support:"supported"|"planned"}],commands:[{id,label,params:{field:Parameter},changesSession?:boolean,recipeOnly?:boolean}],recipes:[{id,label,steps:[{command,params}]}]}`. IDs are explicit stable wire names, never Rust Debug output. Parameter: `{type:"text"|"password"|"number"|"boolean"|"select",label,required?:boolean,default?:value,options?:[{value,label}],minimum?:number,maximum?:number,maxLength?:number}`. All undeclared parameters rejected. Observe state is `{id}` referencing a supported descriptor leaf; `commands`/`recipes` contain `{id,enabled,reason?}`; display is `[{label,value}]` with safe public values only.

The public `ApplicationModel` trait exposes associated `Facts`, `State`, `Command` and `Outcome` types. Models implement descriptor, state derivation/ID, typed command decoding, authorization, verification and outcome reporting. Optional display, command-availability and recipe-authorization hooks support the catalog. The selected engine crate's `src/lib.rs` defines the implemented API. A source checkout additionally includes `examples/notebook-engine`; that example is not required or included in portable tools. Verification receives bounded before/after observations and read-only evidence. A declared state tree is descriptive metadata, not a promise of reachability.

## Actionable descriptor validation

Invalid model descriptors still reject protocol-1 `hello` and subsequent operations
with `error_code:invalid_model` before any application handler. The error identifies
a bounded declaration path and static violated rule, for example
`Invalid model at descriptor.commands[0].params[1].maxLength: maxLength (Rust max_length) is only permitted for text parameters.`
Declaration indexes are zero-based. Because parameters are a map, `params[n]`
means the n-th parameter in sorted name order; the error explicitly explains this.
Paths and rules never include arbitrary descriptor IDs, labels, parameter values
or raw observations. The same strict rules still reject inconsistent declarations;
more useful diagnostics do not make an invalid model acceptable.

## Canonical recipe context extension

The published alpha.2 and alpha.3 runtime/engine pair retains protocol 1 and advertises
`hello.capabilities.recipeContext:1`. Its `command` and `verify` operations accept
optional `recipeContext:{recipe:string,step:number,session:string}`; `step` is the
zero-based canonical recipe index and `session` is the original run session. The
engine strictly decodes the context and validates the recipe, index, command,
normalized parameters and session before invoking model authorization. Verify also
requires the after-observation to retain that recipe session, including for a
command declaring `changesSession`. Context is separate from facts and never
changes observation fingerprints.

Descriptors may mark internal commands `recipeOnly:true` (default false). Such
commands are omitted from the public availability catalog and viewer, and cannot
be authorized or verified without canonical context. Other command guards still
apply. The Rust trait adds `authorize_scoped(..., Option<&RecipeContext>)` and
`verify_scoped(..., Option<&RecipeContext>)`, defaulting to the existing methods.
Applications override them only for model-owned rules that depend on a canonical
recipe step. Internal commands bypass public `command_available`; their scoped
authorization must enforce application-state restrictions. Rust code constructing
`CommandDescriptor` literals must supply the new `recipe_only` field; existing
JSON descriptors default it to false.

Only the runtime's recipe path creates context. Public `execute`, `command` and
viewer command input cannot inject it; direct internal commands are rejected
before a handler runs. Each guarded effect and final verification carry the same
step context. Handlers can read the frozen `executionContext.recipeContext` to
perform independent application verification while settling; the getter cannot be
assigned and is undefined for direct commands or legacy engines. It is not added
to observations or reports. Runtime session binding still prevents a later step or an in-flight
action from continuing under another session. The stateless Rust engine validates
a supplied context but does not independently establish run history or prove
prior-step completion. As with browser handlers, the runtime and protocol caller
are trusted integration code, not a security sandbox.

The runtime sends this optional field only when the engine advertises capability
version 1. Existing protocol-1 engines and models without internal commands keep
their prior wire shape. A descriptor with `recipeOnly` requires the capability and
fails initialization if it is missing. Old runtimes cannot execute new internal
recipes, so consumers requiring this extension must pin a matched runtime and
engine release. The immutable public rc.1 artifacts do not implement it.

## Public Node API

Managed installation/activation is a separate contract implemented in the
portable tools manager. Alpha.4 advertises manager version 2: it can recover both
legacy manager-1 installations and renamed manager-2 kits. Immutable alpha.3
tools support manager 1 only and report `migration_required` before downloading
an alpha.4 candidate. Launcher, Node adapter, Rust model and protocol interfaces
remain version 1; unknown manager versions fail closed. See [Operation Ninja-Update](ninja-update.md) for its
registration, launcher, isolated hook, browser identity and recovery boundaries.
It does not change the JSON Lines protocol or move application rules into Node.

`createDriverSession({page,context,enginePath,adapter,identity?,resources?})` attaches without navigation. `adapter` supplies `model`, `handlers` (map of command IDs to functions), `observe()`, optional `evidence(command,before,after)`, optional `settle()`, optional `close()`, and optional `effectStatus()` returning a safe application effect report. Each handler receives `(params,executionContext)`.

Optional `beginRun({runId,command,recipe})` resets private per-run request accounting; it must not execute an application action. Optional `endRun({runId,command,recipe})` is awaited after every active run, including an initial authorization rejection, failure or stop, before its completed report is captured. This hook cleans only owned transient fixture resources, such as injected routes, and must never replay application actions. Immediate refusals before a run starts (busy, paused, closed or missing revision) do not invoke these hooks or create a completed-run record.

If `endRun` throws, the runtime preserves the observed `execution`, `outcome` and `effect`, sets `ok:false` and `cleanupFailed:true`, and adds `cleanupError:{error_code:"cleanup_incomplete",error:"Owned transient cleanup is incomplete."}`. A safe `cleanup_failed` event is recorded; the adapter's raw error is not exposed. The adapter must retain failed cleanup handles and retry them explicitly on the next run or close. A completed application action can therefore have incomplete cleanup; its effect is not rewritten as rejected.

`effectStatus()` returns `{status,operations?}`, where every status is `saved|uncertain|rejected|not_attempted`. Optional `operations` identifies distinct writes or intended writes as `[{id,label,status}]`, so a saved setup entry can appear alongside an unattempted or uncertain requested edit. The adapter owns the meaning of the overall status and the evidence supporting each operation. The shared runtime does not infer persistence from HTTP status or choose which recipe operation is the user's target.

There are at most 16 operations. IDs must be unique and match `[A-Za-z0-9][A-Za-z0-9._:-]{0,63}`; labels must contain non-whitespace text, use at most 120 UTF-16 code units, and contain no C0/C1 control characters. Both are adapter-authored public metadata: use local IDs and static labels, never request tokens, payload hashes or user input. Unknown fields on the report and operations are stripped. Malformed metadata, an unavailable hook or a throwing hook produces `uncertain` after an attempted effect. A run with no attempted guarded effect always reports `{status:"not_attempted"}` without operations, regardless of previous saves or adapter metadata. Validation of this shape does not prove that trusted adapter labels or evidence are truthful.

Execution context supplies `boundary()`, `click(locator)`, `fill(locator,value)`, `select(locator,value)`, `press(locator,key)` and `effect(fn)`; the runtime rechecks the expected revision/session at each guarded action boundary immediately before effect. A handler may use multiple primitives; expected facts refresh only after its own completed primitive. Guard checks do not lock the external browser/server. Pause/stop are cooperative; dispatching a save is not undoable.

Optional session `runJournal:{startRun,beforeEffect}` supplies awaited storage
barriers without moving application logic into storage. `startRun` receives
`{runId,command,recipe,startedAt,identity}` before adapter setup; unknown requested
commands become null. `beforeEffect` receives `{runId,command,effectIndex}`, with
one-based indexing across the run, before each guarded primitive dispatch
(including individual visible-typing effects). Neither callback receives raw
parameters, observations or session tokens. Metadata is detached from the canonical
report. Storage errors become the static `storage_unavailable` failure.

After either awaited barrier, control/state/session checks still govern execution;
an intent is not dispatch evidence. Final report persistence remains in the managed
evidence sink after runtime finalization. Its failure cannot rewrite the application's
observed result. `RUNTIME_CAPABILITIES.runJournal === 1` and the runtime's static
`capabilities.json` advertise this contract. Journal-mode tools preflight the verified
runtime before update activation and check the loaded export before customer launch.
See [journal storage and read-only inspection](native-setup.md#opt-in-persistent-run-journals).

R2 changes writer ownership metadata to `daedlo-run-journal-lock/2`; journal and
workspace formats stay at 1. Ownership carries a process identity scoped to a
kernel boot and, on Linux, PID namespace. Only same-scope `ESRCH` proves absence;
live/reused PIDs and unknown identity stay blocked. Managed locks additionally
bind the child token and installation. Legacy lock 1 remains inspectable but needs
an independent exit witness through the internal recovery API; the CLI never
guesses such a witness.

Explicit recovery binds exact ownership records to an inspected receipt. Immutable
synced claim/phase receipts permit a dead claimant's transaction to resume without
removing a replacement writer. Managed ownership retirement completes inside that
claim; new supervisors require both managed and journal completion evidence. No
run bytes, completed reports or application state are rewritten. Ownership recovery
returns unresolved application effects and unknown resource cleanup; it cannot
authorize replay or turn missing final evidence into success. A fresh session must
use fresh application observations. See the [dead writer procedure](native-setup.md#recover-a-dead-journal-writer).

Text `fill` uses visible key input at the selected speed, checking freshness and
session before clearing the field and before each subsequent character. A paused
or stopped fill leaves its current partial value; it never restarts typing.
Date/time and other native controls retain Playwright's direct fill semantics.
Pointer actions install an `aria-hidden` cursor decoration and click pulse on the
controlled page. The decoration survives that page's reload
while the session is open; close removes its own overlay and reload listener.
These visuals do not authorize actions or establish application outcomes.

Session API: `observe()` / `snapshot()`; `execute(id,params,revision)`; `runRecipe(id,revision)`; compatibility `command({id,params,revision,recipe})`; `pause()`, `resume()`, `stop()`, `setSpeed("slow"|"normal"|"fast")`, `report()`, `report({runId})`, `close()`. Snapshot includes `connected,descriptor,state,revision,commands,recipes,display,execution,busy,paused,speed,runId,activeRun,progress,lastResult,identity`. Result separates `execution` (`completed|rejected|failed|stopped`) from `outcome` and `effect`. It also contains the descriptor command or recipe ID in `command`, a boolean `recipe`, and ISO `startedAt`/`finishedAt` timestamps. Unknown requested IDs are recorded as `command:null`; arbitrary identifiers, parameters and facts are not copied into these result fields. Only an active run receives a `runId`. `ok:true` or `execution:"completed"` alone does not establish a successful application outcome or persistence.

`activeRun` is a detached `{command,recipe}` identity while a run is busy,
including startup and final cleanup, or `null` otherwise. `command` is a declared
command/recipe ID (or `null` for an unknown request); it contains no parameters.
This lets a viewer joining an existing run display the authored flow without
inferring identity from a local click or a previous result. Progress and the final
result remain separate; an active identity does not establish execution success.

Every `snapshot()` / `observe()` attempts a fresh read. Observation failure returns
`connected:false`, no state/revision or enabled commands, and a sanitized error;
it does not replay an action or rewrite completed results/effect evidence. A later
successful read restores current observation using the same adapter/session.
It does not establish that a previously submitted operation was reconciled.

Native managed status separately reports
`observation:{status,error?:{code,message}}`, where status is
`available|failed|unreachable|not_running|starting`. Failure reasons use static,
allowlisted public categories; adapter text, paths and transport error strings
are not exposed. A failed/unreachable native handoff has `ok:false` and top-level
`status:"observation_failed"` / `status:"unreachable"`. `running` retains the
accepted owned installation while its child remains retained after observation
failure; hard child loss may leave only a recovery record. It is not proof of
readiness. Viewer readiness requires fresh
connection/model/target checks. Fresh native status also calls the launcher's
read-only `draftState()` hook: only a current measured `false` establishes clean
draft/session state. `true` is known dirty; absent, throwing or indeterminate
evidence is unknown and still blocks unsafe shutdown/replacement. Readiness
recovery does not remove independent pending-operation, archive or cleanup guards.
An observation failure after the supervisor acquired its own quiesce pause retains
that gate. A later explicit safe stop may drain only that owned pause after fresh
available, idle, clean and complete-evidence checks; user pauses still block and
application effects are not resumed. Child IPC disconnection triggers best-effort
owned cleanup, not a guarantee that unsaved drafts or in-memory pending evidence
survive owner/process/host loss. Durable archives and recovery records must be
retained until cleanup is established.
The [recovery procedure](native-setup.md#recover-observation-in-the-existing-owned-session)
preserves the original owner and attached resources; it adds no force-stop,
automatic command retry or live adapter replacement.

`createViewer({page,context,session,port:0})` returns `{url,close()}`. Viewer HTTP: GET `/`, assets, `/status` returns `{connected,frames,driver:snapshot}`, `/stream` MJPEG. POST `/command` accepts `{id,params,revision,recipe?}`; POST `/control` accepts `{action,value?}`. Bounded JSON, loopback Host and same Origin policy, CSP. It renders descriptor-driven hierarchy, command-specific fields, availability reasons, progress, results and live images. Execution, application outcome, overall effect and individual operation labels/statuses remain separate; incomplete transient cleanup is disclosed. No Roots fields.

The alpha.6 viewer also previews each recipe's ordered command labels and
groups recipes with identical starting steps into expandable shared paths. The
comparison uses existing command IDs and complete JSON parameter values (object
key order is irrelevant); labels alone never establish a shared path. Each group
shows the longest prefix shared by every member and starts expanded so its
existing run buttons remain reachable. Parameters are not printed in previews.
Recipes without a shared prefix keep their individual cards. No new model,
protocol or public API fields are required.

Shared paths are a display of authored sequences, not state-transition edges or
proof that a prerequisite is satisfied. Expanding a group or preview executes
nothing. Starting a recipe sends the unchanged `{id,revision,recipe:true}` request
and executes its complete canonical plan with the existing fresh-state guards;
shared steps are never cached, skipped, or run once for several recipes. Direct
commands, presentations, lifecycle controls and application outcome reporting
retain their existing contracts. The new grouping changes viewer DOM ancestry
and visual grouping, which are not public API contracts.

A viewer may receive `frontend:{name,targetOrigin,model,evidenceLocation,ownership}`.
This is bounded local display metadata: a static name, canonical HTTP(S) origin
(or null for an unspecified legacy target), model ID/version, evidence directory,
and browser/context/application ownership (`owned`, `attached` or `unknown`).
`/status` returns this identity with the currently observed origin (no URL path,
query or credentials) and target/model match results. A mismatch disables viewer
commands and presentations and rejects their HTTP dispatch; it does not authorize
stopping somebody else's resources or redefine application guards. Session/API
callers remain trusted. Closing a viewer still preserves its attached session,
page and context. CLI projects may supply the same optional `frontend` field.

The viewer omits untouched optional fields. An explicitly edited text field
that is then cleared submits an empty string; clearing an optional numeric or
selection field still omits it. Reloading the viewer discards parameter editing
intent and never replays a command.

Resource registry tracks explicit owned/attached handles; cleanup reverses acquisition, preserves attached resources, records failed cleanup and supports retry. Replacement processes must be registered before removing prior ownership records. No global process/container killing.

### Pending finalization and bounded close

`effectStatus` and `endRun` receive `{runId,command,recipe,signal}`. The runtime
always supplies the context and `AbortSignal`; their TypeScript additions remain
optional for legacy direct hook callers. Existing adapters that ignore these
arguments continue to work. Stop and close abort the signal as a cooperative
request. An aborted signal does not prove that evidence collection or cleanup
finished, and does not undo a dispatched write. An `endRun` hook must still clean
its owned resources or retain their handles and reject; it must not treat the
signal alone as successful cleanup.

Snapshots and current session reports add `finalization:null` or
`{runId,phase,status,stopRequested}`. Phases are `effect_evidence` and
`run_cleanup`. Status starts as `pending` and becomes `stalled` after
`createDriverSession({finalizationWaitMs})` (default 5000 ms, integer 1–60000).
This is a display threshold, not an operation deadline. The viewer shows
Finalizing and the pending phase, including a Stop request and a longer wait.
The fields are optional in public types so older custom session facades remain
compatible. Ordinary observation and application-action waits do not acquire new
timeouts or this finalization state.

The original run remains busy until each original hook settles. New commands are
refused, no completed-run report is published, and Stop does not fabricate an
outcome or persistence status. Late settlement continues that same run exactly
once; throwing effect evidence remains uncertain and throwing `endRun` retains
the existing cleanup-failure result. Stop during effect evidence retains collected
evidence with stopped execution. Stop during `endRun` does not rewrite the
already observed application result; cleanup must finish before publication.
Completed reports remain immutable. Bounded public `finalization_pending`,
`finalization_stalled` and `finalization_settled` events identify only the phase.

`session.close({timeoutMs})` bounds a caller's total wait (default 5000 ms,
integer 1–60000). Concurrent callers share one close attempt and its budget.
Expiry rejects with a sanitized `DriverError` having
`code:"cleanup_incomplete"` and `cleanupPending:true`. It seals new commands but
retains the active run or original pending cleanup promise. It does not invoke
adapter close while an active run is unresolved, start the same pending cleanup
twice, or abandon the engine and resource handles. Retain the session and retry
`close()` explicitly after the work can settle. A hook that ignores cancellation
and never settles continues to block complete cleanup; no forced completion is
claimed. Settled cleanup failures can still be retried, and successful cleanup
steps are not repeated.

An owning resource scope propagates `cleanupPending:true` through its aggregate
error and pauses reverse cleanup at that handle, including setup failures. Earlier acquisitions
remain owned because pending work may depend on them; attached resources remain
untouched. Ordinary settled cleanup failures still permit independent cleanup
and retain their failed handles. The CLI keeps its browser, fixture and viewer
alive after a pending close, writes the pending report when requested, and retains
explicit signal retry. The managed runner uses the same scope rule. Callers must
preserve this dependency boundary when nesting their own cleanup owners.

`session.report()` returns a detached current session view with `format:"browser-driver-report/1"`, `identity`, `runId`, `lastResult`, the latest 200 session `events`, `resources`, and `completedRunIds`. During an active run, `lastResult` remains the prior result until the new result is available. The session view changes as work proceeds; it is not a frozen record of one run.

Optional session `presentations` decorates an existing command or canonical recipe
with one public caption/hold per step; it cannot add a second application plan.
`startPresentation(id,revision)` shares the execution facade and run lifecycle.
`advancePresentation(stageId)` consumes only the current unpaused hold; existing
pause/resume/stop controls remain available. Holds default to 10 seconds, are
independent of execution speed, and compare the verified revision/session
throughout the hold and at exit. A stale observation, disconnection or non-success
outcome halts presentation without recovery effects. Snapshots add `presentations`
and `presentation`; presentation results retain that progress in the completed
report. Captions do not establish success or persistence. POST `/presentation`
accepts `{id,revision}`; `/control` also accepts `{action:"advance",value:stageId}`.
See [presentation configuration and ownership](presentation.md) and public types
for bounds, phases, cooperative interruption and resource preservation.

`session.report({runId})` returns a detached completed report for one of the latest 16 finished active runs, or `null` if that run is absent, still active or evicted. Finished includes completed, rejected, failed and stopped executions. Its captured identity, result, resource snapshot and run-only events remain unchanged by later commands, later cleanup or mutations to returned objects. Reports live in memory and are not a durable archive. They use the same format marker and omit `completedRunIds`; their `eventRange:{first,last,retainedFirst,truncated}` identifies the run's original first/last event sequences and the oldest retained event. At most 200 events are retained per report, with truncation disclosed instead of implying complete history.

Reports omit raw observations, command parameters and private operation evidence. Caller-supplied identities, model outcome labels and adapter metadata must themselves be safe public values. Snapshot/report identities include the measured runtime package source digest and engine executable SHA256, alongside caller-supplied application metadata. These identify bytes, not proof that a binary was compiled from a claimed application commit. The consumer acceptance record supplies build/source provenance and actual browser verification separately; the report schema does not establish either.

A pause gates future effects and recipe steps. After a dispatched recipe step finishes read-only settling and verification, the recipe stays active and paused until Resume or Stop, including a non-success outcome or its final step. Its result, completed report and `endRun` cleanup remain pending. Resume retains the verified outcome and halts on non-success without advancing another step; Stop or close finishes the run as stopped without replay. An already dispatched direct action completes its read-only settling and model verification without requiring Resume. Its result may be `execution:"completed"` while the session remains paused. Stop also allows this verification to finish and takes terminal precedence; if completion fails, `interruptionError` retains the original sanitized failure and the independent `effect` report remains available. A stopped result with a verification failure does not gain a successful outcome. No interruption replays an effect. Asynchronous `effectStatus()` collection remains part of the active run: Pause keeps a recipe pending, and Stop or close takes precedence before terminal publication. Collected effect evidence is reused without invoking the hook again; failed verification still finalizes without waiting for Resume.

## CLI browser selection

The CLI loads Playwright before importing the project or acquiring its fixture.
Unset or empty `PLAYWRIGHT_MODULE` uses `import("playwright")`. A truthy value
matching `/^(file:|[a-z]+:)/i` is imported as a URL; every other value is a path
resolved against the process working directory, including bare names and paths
with spaces. The selected module must export a callable `chromium.launch`.
Import or validation failure stops startup without falling back to another module.
`--help` does not load the selected browser module or project.

A truthy `CHROMIUM` value is passed unchanged as `executablePath`; unset or empty
omits that option. Launch failure does not retry with the default executable.
The CLI retains `handleSIGINT:false` and `handleSIGTERM:false` so its existing
shutdown settles active actions, reports results and cleans owned resources.
These overrides select trusted local code/executables, not a sandbox.

## Viewer capture cleanup and startup retry — A3

`viewer.close()` shuts down its HTTP listener and streams even if CDP capture
cleanup rejects. Unresolved live-target capture cleanup rejects with an
`AggregateError` whose `error_code` is `cleanup_incomplete`; messages and nested
errors contain static cleanup labels, never raw CDP messages or causes. Retain
the viewer and call `close()` again to retry unfinished cleanup. Concurrent calls
share an attempt. Successful cleanup steps are not repeated. Successful detach,
confirmed page closure or the CDP session's close event disposes capture ownership;
a failed frame acknowledgement alone does not prove disconnection.

Capture failures triggered by background events stop streaming and disable the
viewer. While HTTP is still open, `/status` includes a safe
`cleanupError:{error_code:"cleanup_incomplete",error:string}` until ownership is
resolved. Explicit `close()` retries the retained handles. Cleanup never closes
the attached application, browser, context, page or driver session, and does not
change application execution, outcome or persistence evidence.

If viewer startup fails and capture cleanup also remains incomplete,
`createViewer()` rejects with a sanitized `AggregateError` carrying the same code
and an additive `close():Promise<void>` retry handle on the error itself. There
is no returned viewer in this case: callers must retain this error for retry or
register its `close` with their resource scope. Once cleanup succeeds, repeated
calls are harmless. If startup cleanup succeeds immediately, the original startup
error is preserved. These semantics cover rejected cleanup operations; they do
not introduce a deadline or abandon a CDP operation that has not settled.


## Sensitive command parameters — alpha.9 candidate

`type:"password"` is a bounded string parameter with the same required and
`maxLength` checks as text. The viewer renders a masked password input with
browser autofill and spellchecking disabled, captures its value unchanged for
the authorized handler, then immediately clears it. Ordinary text fields keep
their existing behavior. Older runtimes reject this unknown parameter type before
rendering, so a new sensitive model cannot silently degrade into a text field.

This is a presentation contract. Descriptor defaults and recipe parameters are
public metadata: never place credentials there. The runtime does not globally
redact arbitrary customer facts, errors, browser pages or reports; adapters must
keep private inputs out of those channels. The generic Swagger preparation field
uses this type because its request JSON may contain credentials.

## Swagger adapter — alpha.9 candidate

`@daedlo/runtime/swagger` exports bounded OpenAPI catalog/request/response helpers
and `createSwaggerAdapter`. The portable integration supplies a separate native
`swagger-engine` implementing `daedlo.swagger@1` and an explicit local project
profile. It uses the shared execution facade and the password parameter contract. The published alpha.7 kit does not include this candidate.

Rust owns observed Catalog/Selected/Prepared/Response states, execution/write
policy, canonical read recipes and outcome classification. The adapter observes
Swagger UI 5, validates supported OpenAPI transport inputs, uses guarded browser
actions and correlates one exact request with its response. Prepared inputs bind
to private browser authentication; changed cookies or Swagger authorization
invalidate preparation without exposing credentials or private digests in facts.
Existing service workers are refused. The adapter is trusted integration code,
not a security sandbox for untrusted application code.

Request/response values remain private. A documented, schema-valid 2xx response
is transport-contract evidence. Application persistence remains uncertain for a
write unless a trusted project verifier supplies independent exact-operation
proof. Per-run private evidence cannot be reused by a later request. Unknown
schema assertions, unobserved responses, redirects and ambiguous matches cannot
become success. Attached APIs, databases and contexts survive session close.

Read the [compatibility table and installation flow](../integrations/swagger/README.md)
and public types at `packages/runtime/src/swagger/index.d.ts`. Reports identify
both the temporary protocol launcher (`engineSha256`) and actual Rust model
executable (`swaggerEngineSha256`); neither hash proves source-to-binary build
provenance by itself. The portable tools contain the locked model source and isolated build helper;
select an explicit installed `runtimeRoot`. Managed Ninja/native Swagger startup
is not included: use the documented standalone CLI. Exact installed-package
verification and real customer acceptance remain separate evidence.
