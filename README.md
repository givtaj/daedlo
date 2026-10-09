# browser-driver

An agent-installed QA workflow with a Rust application-state engine, a
Node/Playwright runtime and a local live viewer. An agent helps a team turn one
agreed feature into a state model, guarded browser flows and inspectable evidence.
People and agents can then choose a valid command, watch it execute and verify the
outcome. Authored commands and recipes run without an AI agent or model API key.

**Start with an agent:** follow the [release installation guide](docs/releases.md)
to download and mount the exact `0.1.1-rc.5` assets without a source checkout, then use the
[Codex and Claude Code guide](docs/agent-onboarding.md) and portable
[browser-driver skill](skills/browser-driver/SKILL.md). The skill helps product,
development and QA contributors agree a feature's Rust enum and diagram, connect
its flows and verify the evidence. The application keeps its own language and
architecture; its integration still needs a customer-authored Rust model and
JavaScript adapter.

The selected preview adds [portable update tools](docs/update-client.md): check
for newer releases, download verified archives, then test them alongside the
accepted integration. The published rc.2 assets remain unchanged. The separate
[Cloudflare/WorkOS/Stripe portal](docs/subscription-plan.md) is a later phase.

**The primary example is actual Roots work:** Journal draft retention, save and
retry behavior, session protection, and the Strains catalogue. The local workbench
shows a sourced archive of that work and connects to the real Roots driver.

![Control and image-stream architecture](docs/assets/architecture.png)

**Status:** `0.1.1-rc.5` developer preview; final release checks and publication are
tracked in the [release notes](docs/release-notes/0.1.1-rc.5.md). The Rust engine,
Node runtime, generic viewer and independent example are implemented. Earlier
isolated Roots candidates passed real browser/API/PostgreSQL acceptance; Roots'
everyday embedded driver remains unchanged. Exact tested identities and limits
are in [verification](docs/verification.md).

A second [SeeRuntime integration](integrations/seeruntime/README.md) now verifies
one existing playback flow with both published rc.2 and the local rc.3 candidate.
The accepted rc.2 installation still works after the candidate test. This is an
isolated source snapshot, with no changes to the real application checkout.

This preview requires application-specific integration. Windows, complete
onboarding across unfamiliar frameworks, and full Claude Code skill discovery and
onboarding have not been verified. The viewer runs locally. Distribution uses
GitHub assets and tagged source; no npm or crates.io publication is included.

## Open the Roots workbench

With Node 22+:

```bash
npm ci
npm run demo
```

Open the printed URL to inspect real Roots results, screenshots, failures and
corrections. Archive entries identify their original source and test level. They
remain available when no live session is running; historical screenshots are never
presented as a live browser.

To open the current committed Roots application and its original full driver in
an isolated fixture, follow [the Roots example guide](examples/roots/README.md).
That live reference includes the workflows the dedicated product must support.
The original extracted consumer covers 15 commands and one recipe on `d4008e3`.
An additional [Journal edit consumer](integrations/roots/edit/README.md) ports four
selected recipes from a separately captured, reviewed feature snapshot. The
workbench archive remains historical; current candidate results are recorded in
[verification](docs/verification.md).

The independent notebook remains an engineering conformance fixture under
`npm run demo:notebook`, after `cargo build --locked --workspace` and
`npx playwright install chromium`. It is not the product's primary example.

```bash
npm run check
npm test
npm run test:rust
npm run test:e2e
npm run test:roots-example
```

Node checks include local loopback server tests. Browser acceptance launches an
owned Chromium and example server. [Roots consumer acceptance](integrations/roots/README.md)
additionally requires Node 24+, Docker and a pinned Roots source checkout.

## Project documents

- [Agent onboarding](docs/agent-onboarding.md): portable instructions, current
  dependencies and a shared story-to-state-to-evidence workflow.
- [Product and architecture](docs/architecture.md): what the product does, the two
  streams, Rust/Node responsibilities and extension interfaces.
- [Actual Roots experience](examples/roots/README.md): live operation, the evidence
  archive and the distinction between Roots and the extracted candidate.
- [Implementation plan](docs/plan.md): ordered milestones, completion gates and
  current checklist.
- [Development and Roots integration](docs/development-workflow.md): parallel
  development, ownership, candidate promotion/rollback and requested upstream ports.
- [Release installation and preparation](docs/releases.md): exact GitHub assets,
  the agent skill, installed-package CI, trusted verification and explicit store
  update/rollback without changing Roots.
- [Protocol and public API contract](docs/contracts.md): implemented v0.1
  interfaces; still pre-release, with the tested consumers recorded below.
- [Presentation mode](docs/presentation.md): paced playback of existing commands
  and recipes, presenter controls, fresh-state guards and ownership.
- [Acceptance scenarios](docs/acceptance.md): the behavior the executable tests
  must prove.
- [Verification record](docs/verification.md): actual pass/fail/not-run evidence.
- [Roots customer results](integrations/roots/RESULTS.md): package consumption,
  real scenarios, cleanup and the first customer-driven model fix.

The first delivery is a local CLI and browser monitor, one Node package and one
shared Rust library. Each application owns its nested states, facts, commands,
guards, expected outcomes, selectors and fixture setup. The core owns execution
coordination, freshness checks, protocol validation, browser viewing and resource
ownership. See the architecture document for the trust boundary and limitations.

Registry publication, deployment and promotion into everyday Roots usage remain
separate lifecycle steps.
