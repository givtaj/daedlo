# Reviewed abandonment of an unobservable managed session

Use ordinary guarded `stop` first. A failed model observation remains a failure;
zero new requests, a previous clean draft or a dead process are not current safety
proof. Abandonment is an explicit operator decision to end this owned session,
not a successful application result, a force-stop or a retry of a business action.

The native owner supports two separate steps:

```sh
node /absolute/tools/lib/native.mjs abandon-review --config /absolute/project/ninja.json
node /absolute/tools/lib/native.mjs abandon --config /absolute/project/ninja.json --review REVIEW_ID
```

Use the exact review ID returned by the first command. Inspect the installation,
observation failure, captured report, original result and owned/attached resources
before the second command. The review is private and expires after ten minutes
unless cleanup has already begun. Preparing it gates new managed commands and
acquires an owned pause; it does not resume or replay the application.

Both review and execution require the same reachable owning child, no active run
or pending finalization, no pre-existing user pause, complete run archives, and a
fresh `draftState() === false`. The launcher's existing `draftState` contract
covers current draft/session safety **and pending requests, journals, unresolved
effects, active operations and leases**. It must independently establish safety
even when the Rust model cannot recognize the page. It must throw or return an
unknown value when any prerequisite is unavailable. Never return a remembered
`false`, infer safety from a request count, or equate a recorded uncertain result
with a newly proven clean boundary. Ordinary `stop` still requires full available
observation. No model validation or normal shutdown guard is weakened.

If the loaded launcher cannot independently measure that safety, this procedure
refuses cleanup. A changed source file does not hot-replace a running adapter.
Keep the existing owner and private evidence for integration-specific repair;
unreachable children and unknown drafts or unresolved effects are not supported
abandonment cases. Attached applications, databases and browser resources remain
outside owned cleanup.

The second step checks the exact review, original run/result and ownership again.
It archives the abandonment decision before draining, then remeasures safety.
Cleanup uses the normal registered resource scope and session close: it closes
only owned handles, keeps failed handles, and never sends process-kill signals.
The native controller exits only after the child has exited normally with a
matching completed cleanup record.

Private, immutable records are written under `store/supervisor/recovery/`:

- `REVIEW_ID.review.json`: the review-time session snapshot/report and resource
  inventory. Its `originalReport` is that captured session report, **not** a new
  canonical per-run report; normal immutable run archives remain separate.
- `REVIEW_ID.before-close.json`: the explicit abandoned disposition, retained
  report and pending cleanup, persisted before any owned resources are drained.
- `REVIEW_ID.complete.json`: confirmed cleanup and the remaining attached handles.

Completed canonical reports in `store/supervisor/run-reports/` are preserved
byte-for-byte. An original `effect: uncertain` stays uncertain. Independent proof
obtained later belongs in a separate private verification record with the original
`runId`, observation time, method and conclusion, as described in
[evidence reporting](evidence-reporting.md). Link those records in the customer's
private recovery journal; do not overwrite the original report or copy private
operation identifiers into shared metadata.

If evidence cannot be saved **before** cleanup, no resources are drained. Repair
storage and repeat the same abandonment command. If cleanup or the completion
record fails **after** draining starts, retain the owner and review ID. Repair the
reported prerequisite and repeat that same command: it retries only unfinished
owned cleanup and retained evidence. It does not demand fresh observations from
an already closed browser, repeat successful cleanup, or replay an application
command. A changed review cannot take over that pending cleanup. A failed or
missing record never becomes a confirmed clean shutdown.

This workflow applies to a session started by tools containing these operations.
It does not retrofit a currently running older child. Independent synthetic
browser acceptance does not establish recovery of a customer's existing incident
or replace its application-specific pending-effect reconciliation.
