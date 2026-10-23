# Daedlo

**Make “it works” something you can show.**

Daedlo is a local browser QA workbench for teams building with coding agents.
Bring one existing application flow: your agent connects its behavior to a typed
Rust model and guarded Node/Playwright actions. Watch the controlled browser,
choose valid commands, pause or stop execution, and inspect evidence of the
application outcome. Authored flows run without an AI agent or model API key.

**0.1.4-alpha.3 is released: assisted macOS arm64 onboarding with Codex.**
[Download the verified kit](https://daedlo.com/install) or read the
[versioned prerelease](https://github.com/givtaj/browser-driver/releases/tag/v0.1.4-alpha.3).
The exact installed kit, isolated application, source CI and public delivery
passed their scoped checks on 23 October 2026. The [verification record](docs/verification.md)
owns measured results and limits; [alpha delivery](docs/alpha-release.md) owns the
product scope and next acceptance milestone. Everyday Roots dependencies remain
unchanged.

This release adds [Operation Ninja-Update](docs/ninja-update.md):
prepare a separate installation, validate the existing project, restart at a safe
boundary and revert the complete installation if needed. It requires one-time
managed registration and a pinned publisher key. The [signed preview feed](https://daedlo.com/updates/preview.json)
and [setup guide](https://daedlo.com/updates) are live. The owner has authorized
daily GitHub Actions catalog renewal; [verification](docs/verification.md) records
its activation status. The initial generation 1 expires on 30 October 2026 at
10:16:16 UTC. Expiry blocks new update checks/downloads while accepted local use
and rollback remain available.
WBF still needs its own project registration and disposable acceptance.

## The first alpha journey

Start with one agreed, existing feature and a relevant negative case. An agent
performs the integration work in a separate QA directory, preserving the
application's dependencies, data and working tools. The application keeps its own
language; its integration supplies a native Rust model, a JavaScript adapter,
fixture instructions and assertions for the outcome that matters.

1. Acquire the selected kit and verify its recorded archive and package digests.
2. Open the application in Codex and explicitly read the kit's `AGENT_START.md`
   and complete browser-driver skill. Automatic skill discovery is optional.
3. Install the exact runtime and matching crate, build the customer engine, and
   launch its project module with a fresh report path.
4. Run the agreed flow and negative case in the visible viewer. For a save,
   independently read back the intended data; a click alone is not proof.
5. Preserve the assertions and report, shut down owned resources, then relaunch
   and repeat the authored flow from its documented prerequisites.

The [onboarding guide](docs/agent-onboarding.md) describes this handoff. The kit's
`START_HERE.md` and `AGENT_START.md` contain version-specific installation steps.
Use existing Node 22+, npm, Rust/Cargo 1.96.0 and the runtime's matching Playwright
Chromium. Docker is needed only when the chosen application fixture requires it.

This alpha targets assisted use on macOS arm64 with Codex. Linux, Windows, Claude
Code onboarding, fresh OS/toolchain installation and independent self-service
onboarding remain outside its acceptance claim. Supporting another application's
language is an integration boundary, not verified coverage of every framework.
Billing, a hosted QA service and everyday Roots dependency promotion are separate
work. Read the included `LICENSE` and `THIRD_PARTY_NOTICES.md` for component terms.

## Product evidence and development

Roots supplied the real journeys that shaped Daedlo: draft retention, save/retry
behavior and session protection. Its [work archive](examples/roots/README.md)
distinguishes original-driver evidence from extracted candidate acceptance.
Historical receipts retain their original application and package identities.
The independent notebook is an engineering conformance fixture.

Read [contracts](docs/contracts.md),
[development and promotion](docs/development-workflow.md), and the
[implementation plan](docs/plan.md) before changing the shared product or an
application integration. Applications own their states, semantic actions,
fixtures and acceptance checks. The browser-driver package, CLI and skill names
remain the technical identifiers.

With the pinned Node/Rust toolchains and matching Playwright Chromium installed,
run `npm ci`, `npm run check`, `npm test`, `npm run test:rust`,
`npm run test:release`, `npm run test:e2e`, `npm run test:motion`,
`npm run test:controls`, `npm run test:cli`, and `npm run test:viewer`.
Installed-package acceptance is a separate release gate; source checks do not
establish customer acceptance, complete Roots replacement or remote CI success.
