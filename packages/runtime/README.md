# Daedlo runtime — `@daedlo/runtime`

The package import is `@daedlo/runtime`; `daedlo` is the primary command.
The `browser-driver` command remains a compatibility alias.

**Daedlo 0.1.4-alpha.5 candidate for assisted macOS arm64 onboarding.**
Read LICENSE and THIRD_PARTY_NOTICES.md: Apache-2.0 for the public core, with
required legacy MIT and third-party notices retained. Earlier releases keep
their original terms; customer models, adapters, flows and data remain separate.


Local visible browser control through a versioned native Rust application model.
One ESM package includes the session runtime, generic viewer, resource scope and CLI.

The unreleased viewer groups recipes with identical authored starting steps into
expandable shared paths and offers an ordered step preview for every recipe.
Existing model descriptors work unchanged. Previewing does not execute anything;
each run still performs the full canonical recipe with fresh guards. Shared paths
compare command IDs and parameters, never labels or inferred page prerequisites,
and show command labels without printing recipe parameters.
Node 22+ and Playwright Chromium are required. The application supplies its own
compiled engine executable and trusted browser adapter.

```js
import {createDriverSession, createViewer} from '@daedlo/runtime';

const session = await createDriverSession({page, context, enginePath, adapter});
const viewer = await createViewer({page, context, session});
console.log(viewer.url);
const state = await session.observe();
const result = await session.execute('save', {}, state.revision);
// Inspect result.execution, result.outcome and result.effect separately.
await viewer.close();
await session.close(); // Preserves the supplied browser/page.
```

Optional `presentations` config adds narrated, paced playback of an existing
command or canonical recipe. Supply `{id,title,recipe,stages}` with one
`{title,explanation?,holdMs?,manual?}` stage per recipe step; a single command uses
`command` and optional `params` instead of `recipe`. Holds follow successful model
verification, default to 10 seconds, and do not depend on execution speed.
`startPresentation(id, revision)` uses the same guarded session; `pause`, `resume`
and `stop` remain available. `advancePresentation(snapshot.presentation.stageId)`
advances only the current unpaused hold. Fresh state/session checks continue during
holds, including while paused; unexpected changes halt without replay. Snapshot
and result presentation status/captions are separate from outcome/effect evidence.
Configuration is validated at attachment; no presentation starts automatically.
The complete public shapes and bounds are in `src/index.d.ts`.

The adapter supplies `{model:{id,version}, observe, handlers}` with optional
`beginRun`, `endRun`, `settle`, `evidence`, `effectStatus` and `close` hooks. `beginRun` resets
per-run request tracking only; it must not change the application. `effectStatus`
must describe the current run, not a previous successful request. Each handler
uses guarded `click`, `fill`, `select`, `press` or `effect` helpers. Adapters remain
trusted code, not sandboxed plugins. A model mismatch or missing handler prevents
session creation; invalid/stale commands refuse before application effects.

`effectStatus()` may return `{status, operations:[{id,label,status}]}` to distinguish
setup writes from the operation a recipe is checking. There are at most 16
operations; IDs are unique, 1–64 ASCII characters (letters/digits followed by
letters/digits or `._:-`), and labels are nonempty, at most 120 characters, without
control characters. Use adapter-authored public local IDs and static labels, never
request tokens, payload hashes or user content. Extra fields are stripped;
malformed metadata becomes `uncertain`. A run with no attempted guarded effect
always reports `not_attempted` without operation metadata.

Results include the descriptor command/recipe ID (`command`), a `recipe` flag and
ISO `startedAt`/`finishedAt` timestamps. Unknown requested identifiers are recorded
as `command:null`. `session.report()` returns the current bounded session view and
`completedRunIds`. `session.report({runId})` returns a detached completed report
from the latest 16 runs, or `null` when unavailable. Its captured result, identity,
resources and run-only events do not change with later commands or caller edits.
At most 200 events are retained; `eventRange` gives the first/last sequence and
`retainedFirst`/`truncated` so partial history is explicit. These in-memory reports
contain public summaries, not raw facts, command parameters or persistence proof.

`endRun({runId,command,recipe})` is awaited after every active run, including
rejection, stop and failure, before its report is captured. It cleans only owned
transient resources such as injected routes; it must not replay application
actions. Retain failed cleanup handles for a later retry. If cleanup throws, the
runtime preserves execution/outcome/effect evidence, sets `ok:false` and
`cleanupFailed:true`, and adds a safe `cleanupError` with code
`cleanup_incomplete`. The adapter's raw error is never included in public reports.

`daedlo --project ./project.mjs` launches a new owned browser. The trusted
project module exports `createProject({resources})`, returning either
`{url,enginePath,createAdapter({page,context}),identity?,presentations?}` or
`{url,createSession({page,context,resources,signal,ownSession})}`. These routes are
mutually exclusive. The default adapter route is unchanged. The custom route
returns a complete `DriverSession` facade; its `report().identity.model` must
identify the model. The viewer, shutdown and final `--report` all use that exact
facade, preserving application control policy without copying launcher lifecycle.
The CLI itself does not run sign-in or authored commands during startup.

Register owned fixture resources with `resources.own(handle,{label,close})`; use
`attach` for existing resources that must survive. A factory must register partial
resources before awaiting further work. For a session created before optional
application startup actions, call `ownSession(facade)` immediately: returning that
same object does not register or close it twice. This helper acquires cleanup
ownership only; it does not activate the session or expose it to the viewer.
Closable invalid returns are also acquired before validation so they can be cleaned.
A factory that throws before returning has no active session: its registered partial
resources are cleaned, but `--report` is not written for that unreturned session.

Ctrl+C immediately aborts the factory's `signal`, then waits for startup and active
runs to settle before closing owned resources. A factory that performs startup
actions must stop its facade on abort and check the signal before each next action:

```js
async function createSession({page, context, signal, ownSession}) {
  const facade = ownSession(await createApplicationSession({page, context}));
  const abort = () => facade.stop();
  signal.addEventListener("abort", abort, {once: true});
  try {
    signal.throwIfAborted();
    // Only if explicitly requested by the application launcher:
    await requestedStartupAction(facade);
    signal.throwIfAborted();
    return facade;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
```

The trusted factory is responsible for honoring cancellation and for any resources
it neither registers nor returns. Cleanup failures retain owned handles for the
next signal to retry; cleanup never reruns startup or application commands. Existing
attached services and independently owned sessions remain untouched.

The initial supported contract is protocol 1 with exact adapter/model version
matching. Viewer reconnect does not replay actions. Pause/stop is cooperative and
cannot undo submitted requests. Safe retries require application idempotency.
The server binds loopback and is not an authenticated multiuser service.
