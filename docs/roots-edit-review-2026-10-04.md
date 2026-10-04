# Roots Journal edit review and selected port — 2026-10-04

Source: [the requested Roots work chat](codex://threads/01a106ab-a9d8-7110-b6f9-9d3a452a5913).
This record describes the browser-driver changes requested after reviewing that
work. It is not a new Roots application release or a migration of its everyday
driver.

## What the evidence taught us

The original edit wave recorded 17/17 application scenarios and four original
driver recipes. The selected feature was uncommitted on base
`96275b53145e00e282d7c6a6f80faf3a5ad6df10`; its application and controller
receipts identify the reviewed bytes. A later shared-selection exploration failed
because its retained fixture lacked shared catalogue data. That later result does
not invalidate the completed edit checks or prove new standalone coverage.

| Lesson | Implemented response |
| --- | --- |
| HTTP success alone cannot prove a write, and a generic server failure cannot prove no write occurred | Require matching receipt, owner and independent read-back; leave malformed replies, transport loss and generic 5xx uncertain. Recognize only explicit application rejection evidence. |
| A recipe may save setup data while leaving the requested edit cancelled or uncertain | Report safe, separate operation labels and statuses in the runtime and viewer. Keep request identities and exact retry payloads private. |
| Later exploration must not overwrite completed evidence | Retain detached completed-run reports with run identity, timestamps, bounded event ranges and explicit truncation. Save each acceptance checkpoint once. |
| A fault route can outlive a stopped recipe | Await customer-owned transient cleanup at run end, retain failed handles, and report cleanup failure separately from the observed write. |
| A running server is not proof of a usable fixture | Verify migrations, distinct synthetic customers, shared catalogue visibility and explicit restart/fault capabilities before offering recipes. |
| A dirty feature cannot be reproduced by archiving its base commit alone | Capture only reviewed, hash-matched source overlays on the pinned base; record source, application binaries, dependencies and candidate identities. |

The new customer model exposes 20 commands and exactly four Rust-authored recipes:
`edit-save`, `edit-cancel-retained`, `edit-lost-response-retry`, and
`edit-persisted`. The customer adapter reuses the frozen Roots observer, request
tracker and assertions. Execution, guarding and viewing come from the public
standalone runtime; application state transitions are not duplicated in JavaScript.

## Regression and acceptance evidence

Behavioral red assertions were recorded before implementation for effect
classification, operation reporting, completed-run retention, transient cleanup,
feature capture and the customer edit contracts. An import failure, blocked
loopback listener or Docker startup error is setup evidence only.

The source and independent browser checks are listed in
[the verification record](verification.md). The exact packaged candidate passed
all eight Roots groups, including four edit recipes, stopped uncertain-save
cleanup/explicit retry and completed-report retention. Each recipe added one
setup entry, changed no earlier entry, and proved its expected version through
independent read-back. Cleanup and a second provenance preflight passed afterward.
Historical original-driver results remain distinct from these checks.

## Boundaries and remaining work

- The original `d4008e3` consumer and historical archive keep their own scope.
  This selected edit consumer does not migrate all Roots recipes or Strains work.
- The model protocol currently shares command availability between direct use and
  recipe steps. Internal recipe controls may appear enabled in the generic list;
  their customer handlers reject direct invocation before effects. Dedicated
  recipe-only catalog metadata remains a separate contract improvement.
- Dependency receipts measure the copied installed bytes. They do not certify an
  installation from the lockfile or independently prove build provenance.
- Completed runtime reports are bounded and in memory; durable checkpoints are
  the caller's responsibility. Caller-supplied metadata remains trusted input.
- Everyday Roots dependency pins, registry publication and remote CI were not
  changed. No automatic upstream synchronization or monitoring was added.

The Docker backend became unavailable during setup. The user explicitly approved
a Docker Desktop restart to finish verification; its graceful restart timed out,
and the confirmed stuck backend was stopped before starting Docker again. The
previous retained Roots container was then observed stopped. This authorized
interruption is not claimed as successful preservation of an active normal stack.
