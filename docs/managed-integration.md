# Managed custom-runner reference

The complete [managed starter](../examples/managed-starter/README.md) shows how an
existing custom runner can use native startup, installation checks and built-in
run archives. It reuses the independent [starter](../examples/starter/README.md)
Rust model and adapter. It is a synthetic integration reference, not customer
acceptance or a replacement application model.

## Keep one managed session

`createManagedLaunch({runtime, resources, enginePath, installation, settings,
signal})` uses the selected installation's injected runtime. It creates exactly
one driver session, passes that object to `createViewer`, and returns the same
object. Native startup validates this identity. A `Proxy`, replacement session,
second session, direct runtime import or additional injected engine client does
not satisfy the managed contract.

The launcher reads explicit `settings.origin`, `settings.privateCatalogFile` and
`settings.headless`. It resolves Playwright from `installation.runtimePath`, uses
the accepted browser executable, registers that browser through the injected
facade, and checks cancellation after asynchronous acquisition. It owns its
browser, context, request observers, session and viewer immediately after creating
each. The separately started application is attached and survives native stop.
No environment variable or private catalog is used to load executable code.

Application policy belongs at the adapter/model boundary. This reference wraps
the existing adapter handlers with a command allowlist, then delegates permitted
actions to their original guarded primitives. It preserves the existing
observation, settlement, independent readback and effect-status hooks. Rust still
owns the state/command/recipe/outcome rules; the wrapper defines no second graph.
An application-specific proof can likewise be implemented in the adapter's
`evidence`/`effectStatus` hooks without replacing the session. See
[evidence and reporting](evidence-reporting.md) for their limits.

### Current observation and draft safety

`adapter.observe()` and the launcher's `draftState()` are read-only measurements.
They must retain pending request/journal and effect evidence across observation
failure, navigation and host interruption. `draftState()` returns `false` only
when the integration's current measurements establish that its draft/session is
safe to drain; `true` means a known draft that must be preserved. Missing facts,
unrecognized pages, pending effects or unavailable measurements must throw or
return an unknown value, never reuse an earlier `false`. Native cleanup remains
blocked while that state is unknown.

The explicit [abandonment review](managed-abandonment.md) uses that same hook
independently of model observation. A failed model can therefore remain failed
while fresh draft and pending-effect safety permit owned cleanup. The hook must
not return an old clean value or treat an empty visible form as proof that a
pending operation is resolved. The ordinary Stop path keeps its existing guards.

A typed application unavailable state belongs in the customer's Rust model. Its
commands may all be disabled while the adapter measures current draft, pending
operation and request safety independently. Recognizing an error page does not
by itself establish a clean draft or reconcile a save. If `observe()` throws,
the runtime returns a disconnected snapshot with a sanitized error and no enabled
commands. A later `snapshot()` / `observe()` retries the current measurement;
it does not retain failed observation as permanent application state, reset the
adapter or execute recovery actions. Native status likewise remeasures the same
session and draft hook, preserving accepted ownership while readiness is lost.

Use the [native fault recovery steps](native-setup.md#recover-observation-in-the-existing-owned-session)
for operational handling. Keep read-only application navigation separate from
Daedlo status reads, and gate that navigation according to the integration's
draft/pending-operation contract. The currently loaded adapter is unchanged by
editing source or preparing a refreshed installation. A safe restart remains
necessary to load a replacement; an unknown existing session cannot be repaired
by silently substituting a new driver or session.

An observation failure at a supervisor-owned quiesce pause retains that gate.
After fresh available, idle, clean measurements and evidence checks, a later
explicit guarded stop may finish draining its own gate without resuming effects.
An existing user pause remains a blocker. If the owner or IPC is lost instead,
the child's best-effort owned cleanup does not guarantee that an unsaved draft or
in-memory pending evidence survives; retain durable archives and recovery records
and establish actual cleanup before replacement.

## Separate preflight from startup

`installation-hook.mjs` receives the supported hook context on stdin and imports
the selected `installation.runtimePath`. This is the dynamic-runtime boundary for
isolated acceptance and health checks. It starts a separate engine client, sends
a real `hello`, checks the registered model and save command, and closes that
client before launching its disposable browser fixture. It never adds an extra
client to the native launcher's injected facade.

Acceptance runs the actual model/adapter save, checks operation-scoped independent
readback, and checks that private policy text and the raw operation identifier
are absent from the canonical report. Health checks launch the same integration,
observe a connected clean state and prove zero startup writes. Both close owned
driver resources, verify the attached fixture survived, then close their own
fixture. They emit a bounded hook receipt with runtime, engine, model and browser
identity. A hook failure or incomplete cleanup fails installation.

The hook's local report copies are disposable acceptance evidence. Normal native
runs use the built-in immediate archive under `store/supervisor/run-reports/`.
Do not add another session wrapper to archive them. Native status and
`retry-evidence` handle archive failures without replaying an application action.

## Private application metadata boundary

Two different files have different purposes:

| Input                         | Purpose                                          | Trust and exposure                                                                           |
| ----------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `config.catalog`              | Signed Daedlo release discovery and verification | Reviewed HTTPS URL, publisher and pinned public key; managed by Ninja-Update                 |
| `settings.privateCatalogFile` | Local application command policy in this example | Explicit absolute regular-file path outside registered source and store; parsed as data only |

The example's private application schema is deliberately small:

```json
{
  "schemaVersion": 1,
  "allowedCommands": ["edit", "save", "discard"],
  "privateNote": "Local metadata that must never become public output"
}
```

The reader rejects unknown fields, invalid/duplicate command identifiers,
non-regular files, symlinks and oversized input. It retains only the validated
allowlist. It discards `privateNote` before constructing the adapter, never copies
it into facts, identity, labels, result reasons, screenshots or reports, and gives
a fixed public reason when a command is denied. Invalid policy fails startup;
denied save reaches no guarded effect. A reviewed policy change is loaded at the
next start; it is not hot-reloaded during a run.

This schema makes no compatibility claim about another application's catalog.
For an existing private catalog, author and test its own explicit parser and
public projection. Keep private source, selectors, records and credentials local.
Canonical reports still contain public application facts, such as the synthetic
note text here; removing policy metadata does not make arbitrary customer reports
safe to publish. Never publish raw reports merely because this fixture passes.

## Register and verify

The preparer creates a fresh integration directory with an exact file allowlist,
standalone npm/Cargo locks, registered Rust model, launcher and both hooks. It
copies the existing starter model and changes only its shared-crate path in the
copy. The installation manager overlays the selected runtime and engine archive
in a separate slot. Original application dependencies and services are untouched.
Follow the [runnable instructions](../examples/managed-starter/README.md), then
the [native lifecycle](native-setup.md) for doctor/setup/start/status/stop,
source refresh, version update and rollback.

The repository acceptance runner is `tests/managed-starter-acceptance.mjs`.
It checks real native startup, two simultaneous frontends, saved and uncertain
effects with independent readback, per-run archives, safe stop/restart, policy
denial and attached-application survival. It records `result.json` and screenshots
in a fresh ignored directory. Source mode explicitly uses a seeded installation
receipt; it does not prove installation. Exact-installed mode accepts the selected
tools/runtime/examples plus a verified bundle and performs real installation and
verification. Publication, customer registration, customer update/rollback and
customer acceptance remain separate gates in the verification record.

## Customer-run acceptance

Run this checklist in your own disposable application environment, using your
existing model, adapter and agreed flows. Keep private code, catalogs, data,
credentials and raw evidence with your team. Daedlo's reference results do not
establish acceptance for your application.

Record each applicable gate as **PASS**, **FAIL**, **BLOCKED** or **NOT RUN**.
An unavailable fixture, authentication prerequisite or dependency is **BLOCKED**;
use **FAIL** for an exercised check whose observed result violates its assertion.
Keep earlier results bound to their tested versions and record skipped cases
explicitly. Preserve your accepted installation while testing the candidate.

| Gate | Required evidence in your environment |
| --- | --- |
| Prerequisites | Record exact tools/runtime/crate, model, Node, Rust and browser versions; identify the isolated application source, disposable data, readiness checks and owned/attached resources in your private record. Both frontend fixtures must be ready before an isolation check. |
| Model and native startup | Run the real engine `hello` and disposable installation hooks. Verify the launcher creates its session through the injected runtime, passes that exact session to the viewer and returns it unchanged. Inspect startup progress, frontend/target/model identity and zero unexpected startup writes. |
| Independent frontends | Start two distinct configurations and stores simultaneously. Safely stop one; prove the other remains usable and both attached applications survive. Reconnect and restart without replaying a flow. Record owned cleanup and any retained failure handles. |
| Existing business outcomes | Run the agreed positive and negative cases with independent, operation-specific readback. Collect proof before result finalization through the adapter hooks; keep unavailable proof `uncertain`. Where retry is supported, verify the original operation is retained and produces no duplicate write. |
| Navigation and request faults | Exercise the application's redirects, aborts and detached-document cases. Verify terminal-event accounting; missing terminal evidence must remain unresolved and must not become success merely because navigation completed. |
| Observation and interruption recovery | Exercise an unrecognized/error page after a completed run, then a permitted read-only route back to a measurable page. Verify failed or unreachable observation is explicit, accepted ownership and completed evidence survive, unknown safety blocks shutdown, and fresh measurements allow normal guarded stop without replay. Test pending journal/effect and lost child communication separately; identify simulated interruption versus actual host sleep. |
| Managed update and rollback | Use two reviewed compatible versions and a retained predecessor. Verify update, fresh-manager restart, rollback and relaunch preserve authored source, configuration, publisher trust/checkpoint continuity, application data and reports. Confirm the expected selected/running version and owned cleanup at each boundary. Missing predecessor or fixture evidence leaves this gate BLOCKED or NOT RUN. |
| Canonical run archives | Verify each completed run is archived immediately with execution, outcome and effect unchanged. Preserve the 16-report in-memory and 200-event bounds and truncation disclosure. Exercise storage failure and evidence-only retry with no extra application write; verify earlier archives survive later runs and lifecycle changes. |

Use the [native lifecycle](native-setup.md) and
[evidence acceptance guidance](evidence-reporting.md#verify-an-adapted-integration)
for the existing commands and detailed assertions. A busy run, dirty/unknown draft
or incomplete cleanup must still prevent unsafe replacement; do not bypass those
guards to finish the checklist.

### Sanitized result and support handoff

Keep the complete acceptance record private. For support, provide only the
following summary and a minimal sanitized reproduction using synthetic data:

```text
Environment: OS/architecture; tools/runtime/crate/model versions; Node/Rust/browser versions
Gate and step: checklist gate plus the action that was attempted
Result: PASS / FAIL / BLOCKED / NOT RUN
Expected: observable outcome and relevant assertion
Observed: actual outcome or prerequisite blocker; distinguish execution/outcome/effect
Reproduction: minimal synthetic steps or example; state what it does and does not reproduce
Cleanup: owned resources closed, attached resources preserved, or incomplete cleanup
```

Do not include private source, catalogs, credentials, cookies, operation keys,
customer data or raw session reports. A sanitized reproduction or reported pass
does not imply that upstream has independently verified your full integration.

### Observation and interruption reproduction

Prefer a small synthetic adaptation of `examples/managed-starter/` using the
public version-1 `createManagedLaunch` contract and the injected runtime/session.
Use the existing starter Rust model where it represents the scenario; supply a
minimal application-owned model only when a new unavailable state is essential.
Keep the application as a separately owned loopback fixture and use a fresh
configuration, store, browser and disposable data. Never send the private
application integration or attach upstream tests to a customer's live session.

The reproduction should expose deterministic test-only controls for these steps:

1. Start and accept the managed child. Complete and archive one harmless command;
   record the real business-write count and a current clean observation.
2. Make the fixture show an unrecognized page or make its adapter's next
   observation fail. Request native and viewer status. Assert observation is
   failed, commands cannot execute, and the accepted owner and archived result
   remain identifiable. Include a throw containing synthetic private text and
   assert it is absent from public status and UI.
3. Request guarded stop while current draft/pending state is unknown. Assert
   refusal occurs before cleanup and that the application, owned session and
   pending evidence remain intact.
4. Permit an ordinary read-only application route back to the measurable page.
   Request fresh status and verify readiness recovers without a new session or
   replay. Only fresh clean measurements may release shutdown. Verify normal
   guarded stop closes owned resources and preserves the attached application,
   prior archives and business-write count.
5. Exercise variants with a known dirty draft, an unresolved request/journal or
   uncertain effect, an observation failure after the supervisor acquired its
   quiesce pause, and a lost child-status reply. Keep each blocker until its own
   evidence is resolved; restoring the visible page alone is insufficient. Verify
   a later explicit safe stop may drain the supervisor's own retained pause while
   a user pause remains blocked and no application effect is resumed.
   Label IPC fault injection and controlled document detachment accurately; they
   do not establish reproduction of operating-system sleep or the customer's
   application error.

Provide exact tools/runtime/crate/model, Node/Rust/browser and OS/architecture
versions; the synthetic source, command to run it, failing assertion and observed
cleanup; and a brief sanitized sequence. Preserve original operation identity and
effect evidence inside the private fixture where needed. Include only static
public diagnostic categories and synthetic data in shared output. Keep each
failure variant and any unsupported recovery explicit rather than weakening
guards to obtain a successful stop.
