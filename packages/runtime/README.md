# @browser-driver/runtime

Local visible browser control through a versioned native Rust application model.
One ESM package includes the session runtime, generic viewer, resource scope and CLI.
Node 22+ and Playwright Chromium are required. The application supplies its own
compiled engine executable and trusted browser adapter.

```js
import {createDriverSession, createViewer} from '@browser-driver/runtime';

const session = await createDriverSession({page, context, enginePath, adapter});
const viewer = await createViewer({page, context, session});
console.log(viewer.url);
const state = await session.observe();
const result = await session.execute('save', {}, state.revision);
// Inspect result.execution, result.outcome and result.effect separately.
await viewer.close();
await session.close(); // Preserves the supplied browser/page.
```

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

`browser-driver --project ./project.mjs` launches a new owned browser. The trusted
project module exports `createProject({resources})`, returning
`{url,enginePath,createAdapter({page,context}),identity?}`. Register owned fixture
resources with `resources.own(handle,{label,close})`; use `attach` for existing
resources that must survive. Ctrl+C closes owned resources. No sign-in or authored
command runs automatically.

The initial supported contract is protocol 1 with exact adapter/model version
matching. Viewer reconnect does not replay actions. Pause/stop is cooperative and
cannot undo submitted requests. Safe retries require application idempotency.
The server binds loopback and is not an authenticated multiuser service.
