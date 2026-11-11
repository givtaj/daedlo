# Persistence evidence and completed-run reports

Use the runtime result to describe what was known when a run finished. Keep
execution, application outcome, persistence evidence and archive status separate.
A successful browser command does not establish a saved business effect. A
failed or stopped execution can still have a confirmed saved effect.

This guide accompanies the shipped [starter](../examples/starter/README.md) and
[managed integration reference](managed-integration.md). They are independent
synthetic conformance examples, not customer application acceptance. The selected
runtime's [contract](contracts.md) owns the API and retention limits.

## Connect independent verification before the result is frozen

The supported hook is `adapter.effectStatus()`. The runtime awaits it after the
command's settling and model verification, before publishing the result. It can
return a promise. It must only inspect or collect evidence; it must not execute a
save, retry, recovery action or a second application flow.

The [starter adapter](../examples/starter/adapter.mjs) is a complete example:

1. `beginRun()` resets the per-run write-attempt flag, operation identity and
   previous persistence proof. It keeps pending-request tracking intact;
   unresolved requests do not disappear when another run begins.
2. The guarded handler performs the requested action. Request observation records
   the exact intended operation privately before its response is interpreted.
3. `evidence(command, before, after)` independently reads storage for that exact
   operation. It checks the operation identity, the expected fields and exactly
   one matching record. This also supplies the Rust model's application outcome.
4. `effectStatus()` returns `saved` only when that operation's proof is complete.
   Otherwise it keeps `uncertain`, or `not_attempted` if no business write was
   attempted. A previous save never supplies proof for a later command.

For a custom application, verify its own exact-operation contract: expected
tenant/User where applicable, original body/key, persisted revision and history,
and duplication rules. Keep those values private. A generic HTTP 2xx, an empty
request queue, or a successful assertion outside the adapter does not supply
this connection automatically. An abort or lost response does not prove that a
write was rejected. Use `rejected` only when the application's independently
established contract proves the requested write was not accepted; otherwise keep
`uncertain`.

`effectStatus()` returns a bounded public summary, for example:

```js
{
  status: "saved",
  operations: [
    { id: "requested-edit", label: "Requested settings edit", status: "saved" },
  ],
}
```

This is a shape example, not permission to hardcode success. Derive the status
from the measured proof for the current operation. IDs and labels are static
public metadata; do not put request tokens, body/key values, hashes of private
values, customer data or raw evidence into them. A malformed, missing or throwing
hook gives `uncertain` after an attempted effect. A run with no attempted guarded
effect always reports `not_attempted`.

If a runner performs its independent readback only **after** awaiting
`session.execute()` or `runRecipe()`, that evidence arrives after the original
result was frozen. Move the read-only proof collection into `evidence()` or an
awaited `effectStatus()` when it must inform that result. Preserve the exact
command identity and do not introduce a second action while verifying it.

If proof genuinely becomes available later, retain a separate private verification
record containing the original `runId`, observation time, verification method and
conclusion. Keep the original uncertain report unchanged. A later observation is
not a retroactive rewrite of what was known at completion.

If the session is later [explicitly abandoned](managed-abandonment.md), link that
separate verification record to both the original `runId` and the abandonment
review ID. Keep its readback time, method and conclusion separate from cleanup
evidence. Neither a completed cleanup nor a linked later readback rewrites the
original report or changes an earlier `uncertain` effect to `saved`.

## Capture a completed run, not a periodically sampled session

After the action's promise settles, immediately capture:

```js
const result = await session.execute(id, params, revision);
const report = result.runId ? session.report({ runId: result.runId }) : null;
```

Immediate refusals such as busy or missing revision have no active run and no
completed report. For a result with a `runId`, a null report means unavailable,
still active or evicted; do not substitute the current session snapshot and call
it that run's evidence. Await the actual execution promise, not a viewer refresh
or an intermediate `run_completed` event: final cleanup and capture may still be
in progress at those times.

`session.report()` without a run ID is a changing session view. Its last result
can belong to an earlier run while another run is active. Saving it periodically
does not establish complete coverage between snapshots.

| Retention                                        | Contract                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| Completed reports in memory                      | Latest **16** finished active runs; earlier reports can be evicted             |
| Events in a session view or one completed report | At most **200** events                                                         |
| Frozen per-run values                            | Identity, result, run events and resource snapshot do not change after capture |
| Missing early events                             | `eventRange.truncated` is true and `retainedFirst` exceeds `first`             |
| Durable storage                                  | The public runtime alone keeps reports in memory; the owner must archive them  |

Immediate per-run archiving prevents eviction gaps **between runs**. It does not
remove the 200-event cap **within a long run**, restore already discarded events,
or prove that every application request was observed. Preserve `eventRange`
exactly. For a complete application audit trail, collect the application's own
private evidence journal from before the activity starts and record its coverage
and operation correlation independently; do not present concatenated snapshots
as a complete event stream. The public report API has no unbounded event-history
export.

## Custom public-runtime runner

The copied starter includes [report-archive.mjs](../examples/starter/report-archive.mjs),
a small optional capture helper. It does not replace the session, change its
result, alter its bounds, or add a second application plan.

```js
import { createReportArchive } from "./report-archive.mjs";

const archive = createReportArchive({
  directory: absolutePrivateReportDirectory,
});
const result = await archive.run(session, () =>
  session.execute(id, params, revision),
);
const evidence = archive.status();
// Show result.execution / outcome / effect separately from evidence.pending.
// If evidence.pending is true, repair storage and keep this process alive.
// Explicitly retry only retained evidence, never the application action:
const afterRepair = await archive.retry();
```

Use the action callback only to return the runtime's execution promise. Put proof
collection in the adapter before completion; do not append a throwing proof step
after the action inside this callback. Run all custom-runner action entrypoints
through this owner. Calls made directly by another runner or a viewer bypass this
helper; it is not a global session event subscription. Prefer the managed path
below when the viewer dispatches commands.

Choose an absolute private directory with no symlink components, on a filesystem
supporting hard links. The helper writes owner-only temporary files, synchronizes
their bytes and links each complete report to its immutable run filename. It
refuses conflicting existing evidence rather than overwriting it. It rejects
concurrent calls before dispatch and blocks another helper-owned action while
evidence is incomplete. The original application result remains unchanged if
archiving fails.

Storage retry retains the same captured bytes and failed temporary-cleanup handle;
it does not re-read a newer session snapshot or replay a command. Keep the owner
process alive until `pending` becomes false. A missing canonical report cannot be
reconstructed by storage retry: preserve the failure and investigate the runner.
In-memory pending evidence does not survive process termination; this helper does
not promise crash-proof journaling, off-device backup or unlimited storage. It
does not delete historical evidence automatically. Protect and manage these local
files as private application evidence, not as shareable public metadata.

## Native managed integration

Native mode already archives completed runs immediately in
`store/supervisor/run-reports/`, including installation identity and the canonical
runtime report. Use that mechanism instead of replacing the injected session
with a custom proxy or layering this helper around native dispatch. Return the
exact injected session and give the same object to its viewer, as described in
the [managed integration guide](managed-integration.md).

If archiving fails, native status exposes incomplete evidence; further runs and
safe replacement are blocked while the original execution/outcome/effect remain
unchanged. Repair the local storage and run:

```sh
node /absolute/tools/lib/native.mjs retry-evidence --config /absolute/project/ninja.json
```

Use the actual installed tools path. `retry-evidence` saves the retained report
without replaying the flow. Inspect status again and confirm incomplete evidence
has cleared. The native final shutdown/replacement report under `store/reports/`
is separate from these per-run records. Native archiving preserves the same
200-event bound and truncation disclosure; it does not create missing history.

## Verify an adapted integration

Demonstrate a confirmed save, unavailable proof after a real write, a proven
no-write refusal and exact-command retry where the application supports it.
Show that later proof cannot mutate the earlier report. Complete more than 16
runs and verify the first archived file remains intact, then exercise a run long
enough to disclose truncation. Inject a storage failure, retain the original
application result, repair storage and retry evidence with no extra business
write. Verify owned cleanup and attached-application survival separately.

The source repository's `tests/evidence-reporting-acceptance.mjs` exercises the
real starter engine/browser and supports explicit installed runtime, engine and
starter paths. Unit archive and native archive-failure tests cover storage and
retry behavior; they are not customer-flow acceptance. Record the exact source,
package, model and browser identities and actual observed results in the owning
verification record.
