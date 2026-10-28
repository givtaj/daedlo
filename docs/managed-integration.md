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
