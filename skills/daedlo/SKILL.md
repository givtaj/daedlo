---
name: daedlo
description: Install and onboard Daedlo in a web application, coauthor its Rust UX model and guarded browser flows, or maintain an existing integration. Use for Daedlo setup and agreed QA flow work across application languages; onboarding alone does not authorize building application features or replacing an accepted driver.
license: Apache-2.0
---

# Daedlo

Daedlo is the product, package and skill name. Existing browser-driver commands
remain compatibility aliases; preserved historical receipts keep their original names.

This instruction copy accompanies the Daedlo 0.1.4-alpha.11 tools. Use the selected
kit's `release.json` for exact identity and verification and the current
[verification record](https://github.com/givtaj/daedlo/blob/main/docs/verification.md)
for publication status.
Its public core uses Apache-2.0. Read LICENSE and THIRD_PARTY_NOTICES.md, including
the retained legacy MIT and third-party notices. Customer projects remain separate.

Help the user reach one useful, repeatable browser flow with inspectable evidence.
Any web application backend can use the same native Rust model and Node/Playwright
adapter. This skill is agent guidance, not an executable model or installer.

For Swagger UI/API driving, also read [Swagger/OpenAPI guidance](references/swagger.md).
The source integration has an explicit standards/capability matrix; do not infer
that it is included in an older published kit.

## Start from the requested outcome

Read the target repository's instructions, scenarios and integration. Distinguish
onboarding, operating an accepted flow, adding an agreed flow and upgrading.
Preserve prior approvals and working integrations. Onboarding does not authorize
application feature development, migration, publication or automatic synchronization.

For installation and the first run, read [onboarding](references/onboarding.md).
When defining or changing behavior, also read [model and flows](references/model-and-flows.md).
Adapt the [flow specification template](assets/flow-spec.md) to existing customer
records instead of creating a competing source of truth.

Locate the chosen release-tools installation or reviewed source checkout from the
user's context or receipt. Read `README.md`, `docs/contracts.md`,
`docs/agent-onboarding.md` and `docs/releases.md` from that package or checkout root.
The portable tools include these references and this complete skill; they do not
require a source checkout. `docs/verification.md` and the historical Roots archive are optional upstream
evidence, absent from the portable tools. The independent starter and managed
reference ship under `examples/starter/` and `examples/managed-starter/`. Selected-release
runtime README, public types and Rust trait govern APIs. Record both tools and
runtime versions; never infer the package root from a copied skill's location or
assume a remembered release is current.

If the selected tools include `lib/native.mjs`, read `docs/native-setup.md` and
use its doctor/setup/start/status/stop workflow with the same Ninja registration.
Open the exact returned `viewerUrl` in Codex Browser; repeat start/status to
reconnect to the owned runner without replay. The tab is a stream plus command
controls, not the controlled application's DOM. Arrange a headed controlled
browser from the outset when manual authentication is required. Distinguish host
permission, missing dependencies, fixture prerequisites and actual QA failures;
never disable sandboxing globally. Preserve the complete accepted installation,
customized guidance, retained bundles and browser cache for Ninja updates/rollback.
Use explicit `refresh` then `restart` for authored-source changes at the accepted
Daedlo version. These native commands are absent from published alpha.3 tools.
For an existing custom runner, read `docs/managed-integration.md` and
`docs/evidence-reporting.md`. Keep the injected native session intact, move model
preflight into disposable hooks, and connect exact-operation persistence proof
before the result freezes. Archive each completed canonical report immediately;
preserve event truncation and distinguish it from complete application evidence.

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
