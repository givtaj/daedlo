---
name: browser-driver
description: Install and onboard browser-driver in a web application, coauthor its Rust UX model and guarded browser flows, or maintain an existing integration. Use for browser-driver setup and agreed QA flow work across application languages; onboarding alone does not authorize building application features or replacing an accepted driver.
license: MIT
---

# Browser-driver

Help the user reach one useful, repeatable browser flow with inspectable evidence.
Any web application backend can use the same native Rust model and Node/Playwright
adapter. This skill is agent guidance, not an executable model or installer.

## Start from the requested outcome

Read the target repository's instructions, scenarios and integration. Distinguish
onboarding, operating an accepted flow, adding an agreed flow and upgrading.
Preserve prior approvals and working integrations. Onboarding does not authorize
application feature development, migration, publication or automatic synchronization.

For installation and the first run, read [onboarding](references/onboarding.md).
When defining or changing behavior, also read [model and flows](references/model-and-flows.md).
Adapt the [flow specification template](assets/flow-spec.md) to existing customer
records instead of creating a competing source of truth.

Locate the chosen browser-driver source checkout from the user's context or the
existing receipt. Read its `README.md`, `docs/contracts.md`, `docs/agent-onboarding.md`,
`docs/releases.md` and `docs/verification.md` from that root. Selected-release
package READMEs, public types and Rust trait govern APIs. Never resolve repository
docs relative to this installed skill or assume a remembered release is current.

## Collaborate, then execute

- **Product:** useful story, observable outcome, non-goals and acceptance examples.
- **Development:** minimal nested Rust enums, measured facts, guards, operation
  identity, public adapter and resource ownership.
- **QA:** failure/recovery cases, independent assertions, evidence and cleanup.

These are review perspectives, not a required three-person team. Show the proposed
enum/transition diagram and acceptance map before implementing new behavior. Reuse
explicit agreement; ask only about material unresolved behavior or authority, and
continue independent work. The user remains product owner. Diagrams remain
proposals until matched by code and observations.

Perform authorized installation, configuration, model/adapter work and verification;
do not hand the user commands you can execute. Explain actual permission/dependency
blockers without inventing extra approval steps for ordinary reversible setup.

## Preserve the contract

- Rust owns typed state derivation, command authorization, outcomes and canonical
  recipes. Node measures facts, performs guarded actions and gathers evidence.
  Never duplicate the application transition graph in JavaScript.
- Preserve drafts and sessions. Missing observations, unknown states, absent
  handlers and incompatible models must fail closed. A click or successful HTTP
  status does not establish persistence.
- Separate execution, application outcome and write effects. Retries require the
  application's operation identity and deduplication/reconciliation contract.
  Pause/stop cannot undo a submitted request.
- Record owned versus attached resources. Stop only owned resources; attached
  application services and browser sessions survive. Retain failed cleanup handles.
- Keep credentials, raw cookies, private traces and customer data out of shared
  records. Digests of private identifiers are not anonymization. Inspect screenshots
  before sharing them.

## Leave a working handoff

Record exact package/model/application identities, install/launch paths, flow IDs,
verification, evidence and cleanup. Where onboarding includes agent instructions,
add a short pointer to the customer model and flow map; preserve unrelated guidance.

Report what is verified, failed or not run. An example fixture pass is not customer
acceptance. Keep planned states visibly unsupported. Upgrade only on request:
test the exact replacement combination in isolation, preserve the accepted pins
and launcher, and promote only within the user's authorized scope.
