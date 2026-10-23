# Daedlo

**Make “it works” something you can show.**

Daedlo is a local browser QA workbench for teams building with coding agents.
Bring one existing application flow: your agent connects its behavior to a typed
Rust model and guarded Node/Playwright actions. Watch the controlled browser,
choose valid commands, pause or stop execution, and inspect evidence of the
application outcome. Authored flows run without an AI agent or model API key.

**0.1.4-alpha.3 is released: assisted macOS arm64 onboarding with Codex.**
[Start with one Codex prompt](https://daedlo.com/install) or read the
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
and [setup guide](https://daedlo.com/updates) are live. Daily GitHub Actions catalog
renewal is active at 04:23 UTC; two successful manual workflow dispatches published
generations 2 and 3 while preserving the release downloads and publisher key.
[Verification](docs/verification.md) records the current feed, regional checks
and limits. Expiry blocks new update checks/downloads while accepted local use
and rollback remain available.
WBF still needs its own project registration and disposable acceptance.

## Next release licensing

The source now prepares **0.1.4-alpha.4**, which is not published. Its public core
uses **Apache-2.0**, with the complete legacy MIT grant and third-party notices
preserved in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and `licenses/`.
Published alpha.3 downloads retain their original `MIT AND Apache-2.0` terms.
Customer application code, models, flows, adapters and data remain separate.
The license transition does not change the model, adapter or updater contracts.

## The first alpha journey

Start with one agreed, existing feature and a relevant negative case. An agent
performs the integration work in a separate QA directory, preserving the
application's dependencies, data and working tools. The application keeps its own
language; its integration supplies a native Rust model, a JavaScript adapter,
fixture instructions and assertions for the outcome that matters.

1. Open the application repository in Codex (the WBF repository for WBF).
2. Copy the single prompt from [Get started](https://daedlo.com/install#agent).
   The agent verifies and installs the kit, reads its complete skill, connects the
   first flow and prepares the project's managed-update registration.
3. Inspect the visible flow, independent outcome/persistence evidence, negative
   case and repeat run. Keep the project-specific launch/update commands and the
   separate PASS/FAIL/BLOCKED/NOT RUN handoff. Compatible published versions and
   a verified previous installation are required for an upgrade/rollback drill.

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
