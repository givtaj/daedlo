# Daedlo

Daedlo is the browser-driver workbench: a typed Rust application model, guarded
Node/Playwright execution, a local live viewer and portable installation tools.
Applications own their states, semantic actions, fixtures and acceptance checks.

This branch integrates the preserved Roots replacement work and prepares local
candidate **0.1.3-roots.7**. It is not published or promoted into normal Roots.
The public download remains [0.1.2-rc.1](https://daedlo.com/install.html).
The working Roots driver and the separate evaluation/rebrand checkout are preserved.

Read [contracts](docs/contracts.md), [development and promotion](docs/development-workflow.md),
[agent onboarding](docs/agent-onboarding.md), and the [verification record](docs/verification.md).
The [implementation plan](docs/plan.md) distinguishes the shared product from
application-specific integration and final dependency promotion.

With the pinned Node/Rust toolchains and matching Playwright Chromium installed,
run `npm ci`, `npm run check`, `npm test`, `npm run test:rust`,
`npm run test:release`, `npm run test:e2e`, `npm run test:motion`,
`npm run test:controls`, `npm run test:cli`, and `npm run test:viewer`.
Installed-package acceptance is a separate release gate; source checks do not
establish complete Roots replacement or remote CI success.
