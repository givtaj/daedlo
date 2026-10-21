# Present an existing integration

Presentation mode runs an existing command or canonical Rust recipe through the
same driver session, guarded adapter and live viewer. It adds customer-authored
stage captions and deliberate holds after successful verification. It does not
create a second application model, navigate on attachment, reset the application,
or replay a failed action.

Presentation mode is included in Daedlo 0.1.2-rc.1. Earlier rc.5 packages do not
contain it. The website release record identifies the package checks performed;
customer-specific acceptance remains separate.

## Configure the customer session

Add `presentations` when creating the session that already controls the supported
page. The CLI also accepts `presentations` from `createProject()`; the CLI still
owns a new browser, while the session API attaches to supplied pages.

```js
const session = await createDriverSession({
  page, context, enginePath, adapter,
  presentations: [{
    id: "feature-tour",
    title: "Inspect and save",
    explanation: "Watch the existing accepted flow.",
    recipe: "existing_recipe", // Must exist in the Rust descriptor.
    stages: [
      { title: "Inspect the draft", explanation: "Review the observed draft.", holdMs: 15000 },
      { title: "Inspect the result", explanation: "Read the outcome and effect evidence.", holdMs: 12000, manual: true },
    ], // Exactly one stage per declared recipe step, in its existing order.
  }],
});
const viewer = await createViewer({ page, context, session });
// Opening the viewer does not execute anything. Start from its presentation card,
// or explicitly use a fresh observed revision:
const state = await session.snapshot();
const result = await session.startPresentation("feature-tour", state.revision);
```

A one-command presentation uses `command` and optional `params` instead of
`recipe`, with exactly one stage. Parameters pass the ordinary descriptor
validation. A presentation cannot supply new commands, change recipe parameters,
skip steps or branch based on application facts. Stage order decorates the
canonical plan returned by the Rust engine.

Each `holdMs` is an integer from 0 to 3,600,000; the default is 10,000 ms. A
`manual: true` stage waits for Advance even after its countdown expires. The
presenter can advance any current hold early. Execution speed controls pointer
motion and ordinary action pacing; it does not scale or bypass stage holds. The
customer chooses meaningful holds for its own flow.

IDs are unique, 1–64 ASCII letters/digits or `._:-`, beginning with a letter or
digit. At most 32 presentations may be configured. Titles are nonempty and at
most 120 UTF-16 code units; explanations are at most 600. Both reject control
characters and must be safe public metadata, never credentials, private payloads
or copied customer input. Unknown config/stage fields fail setup. Reports retain
captions, but not presentation command parameters.

## Controls and evidence

- **Start:** `startPresentation(id, revision)` starts one ordinary guarded run.
  Commands, recipes and other presentations are refused while it is active.
- **Pause / Resume:** existing `pause()` and `resume()` pause execution at guarded
  boundaries and freeze a presentation countdown. They do not change an
  application's own paused state or cancel a submitted request.
- **Advance:** `advancePresentation(snapshot.presentation.stageId)` consumes only
  the current unpaused hold. The run-and-stage token prevents a delayed or
  duplicate click from advancing a later stage. A refused advance has an
  actionable error and causes no effect.
- **Stop:** `stop()` wakes a hold promptly and stops at the next execution
  boundary. It never forwards, detaches, resets or undoes an application request.

`snapshot.presentations` contains safe presentation labels and the underlying
model command/recipe availability. `snapshot.presentation` separates the current
stage, countdown and phase (`executing`, `holding`, `finished`) from presentation
status (`running`, `completed`, `halted`, `stopped`). The viewer labels an executing
caption as an intended stage. A holding caption follows successful model
verification, but a caption alone is never application or persistence evidence.

The result and completed run report include presentation progress and halt reason,
with stage/hold/advance events. Execution, application outcome and effect remain
separate. For example, a command may finish with a `recoverable_error` application
outcome: its presentation halts without continuing, while execution remains
`completed`. Cleanup failure also halts the presentation and retains the original
outcome/effect evidence plus the existing `cleanupFailed` report.

Viewer mutations use the existing loopback/same-origin boundary. POST
`/presentation` accepts `{id, revision}`; POST `/control` accepts
`{action:"advance", value:stageId}`. Existing pause/resume/stop/speed and
command/recipe endpoints retain their behavior. A lost HTTP response or viewer
reconnect must be resolved by observing status; it never triggers automatic replay.

## Freshness, ownership and limits

Every effect still requires fresh model authorization. During a hold, the runtime
checks the exact verified revision and session about every 100 ms, including while
presenter-paused, and checks again when leaving the hold. A changed draft/session,
disconnection, unavailable observation or unexpected state halts the run. The
runtime never adopts a new revision merely to continue after a human edit. Hold
observations time out after five seconds and can be interrupted by Stop; late
results are discarded. The ordinary adapter's action/settle work and cleanup remain
cooperative and can delay stop completion. External browser/server
changes are not locked against the interval between an observation and an effect.

Closing the viewer closes only its stream/server. Closing the driver stops the
active presentation, awaits run cleanup, then closes its engine and explicitly
owned resources. Supplied pages/contexts and attached resources survive. Adapter
cleanup remains trusted customer code and must preserve those resources. Owned
cleanup failures keep their existing retry handles; no global process killing is
introduced. Stop is not application recovery: inspect a halt and explicitly choose
an appropriate existing command if needed.

The first version configures presentations at session creation, uses holds after
whole commands, and has no arbitrary mid-handler narration, automatic recovery,
remote viewer authentication or durable report storage. Existing ordinary commands
and recipes do not inherit presentation holds.

