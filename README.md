# Daedlo

**Make “it works” something you can show.**

Daedlo is a local browser QA workbench for teams building with coding agents.
Bring one existing application flow: your agent connects its behavior to a typed
Rust model and guarded Node/Playwright actions. Watch the controlled browser,
choose valid commands, pause or stop execution, and inspect evidence of the
application outcome. Authored flows run without an AI agent or model API key.

[Contribute](CONTRIBUTING.md) · [Roadmap](ROADMAP.md) · [Get help](SUPPORT.md) ·
[Security](SECURITY.md) · [Code of conduct](CODE_OF_CONDUCT.md)

**Assisted macOS arm64 onboarding with Codex.**
[Start with one Codex prompt](https://daedlo.com/install).
The [verification record](docs/verification.md) owns current publication status,
measured acceptance and limits; [alpha delivery](docs/alpha-release.md) owns the
product scope. Use the exact verified release kit and its installation instructions.

The alpha.11 candidate adds reviewed abandonment when model observation fails and
explicit review of model descriptor migrations. Recovery preserves original run
reports and requires fresh independent draft and pending-effect safety. Model
migration retains the accepted runtime, store, reports and rollback history.
These commands require new release tools; a runtime-only update cannot deliver
them or change an already running older controller. Follow
[native setup](docs/native-setup.md), [reviewed abandonment](docs/managed-abandonment.md)
and [model migration](docs/model-migration.md). Publication and the exact upgrade
results belong in the verification record linked above.

The alpha.10 kit combines the live application/flow/results grid, bounded large
state maps and explicit pending/stalled finalization with reusable Swagger API
driving and masked password parameters. Existing integrations require the
reviewed QA dependency migration and retain their accepted installation for
recovery. Customer incident recovery and independent application acceptance
remain separate from the release's technical checks.

Alpha.7 separates native observation failures from stopped ownership, reports
unknown draft safety explicitly and documents guarded recovery. The supervisor
fix requires a separately verified tools bootstrap; a runtime-only update retains
the old tools. Use the same registration, configuration, store and publisher trust
after a safe stop; retain the accepted tools and installation for recovery.
Customer incident recovery and application acceptance remain unconfirmed.

Alpha.6 introduced groups for recipes with identical authored starting steps and complete
ordered previews. Viewing a path is read-only; every recipe keeps its own
availability and executes its full guarded sequence. Existing model, protocol,
public API and managed configuration contracts remain unchanged. Published
alpha.5 tools passed the live update, restart and rollback drill unchanged.

Alpha.5 adds a complete [managed custom-runner reference](docs/managed-integration.md)
and [persistence/reporting guide](docs/evidence-reporting.md). Keep the injected
native session intact, connect independent proof before finalization, and archive
each completed canonical report. Reports retain their explicit 200-event bound;
archiving cannot restore truncated history.

[Operation Ninja-Update](docs/ninja-update.md) prepares a separate installation,
validates the existing project, restarts at a safe boundary and supports complete
rollback. One-time managed registration and a pinned publisher key are required.
The [signed preview feed](https://daedlo.com/updates/preview.json) and
[setup guide](https://daedlo.com/updates) are live. Daily catalog renewal remains
scheduled at 04:23 UTC; execution can be delayed. Expiry blocks new checks/downloads
while accepted local use and rollback remain available. Customer registration and business-flow acceptance
remain separate; everyday Roots dependencies are unchanged.

## Licensing and package names

From **0.1.4-alpha.4**, Daedlo-owned code,
documentation, examples and website source use **Apache-2.0**, subject to the
[licensing scope](docs/licensing.md) and preserved notices. The complete legacy
MIT grant and third-party notices remain in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and `licenses/`. Published alpha.3
downloads retain their original `MIT AND Apache-2.0` terms. Customer applications
and their independently authored integrations remain separate.

Current source uses `@daedlo/runtime`, the `daedlo` CLI, `daedlo-engine`
(`daedlo_engine` in Rust), `@daedlo/release-tools` and `skills/daedlo`. Older
published kits keep their original `browser-driver` names and instructions.
Wire/report identifiers remain compatible. Read the [naming migration guide](docs/rename.md)
for CLI aliases, package imports and the required new-tools bootstrap before an
alpha.3 installation can use the renamed tools. Source naming does not imply a new
registry publication or customer dependency promotion. The repository is public
and welcomes community contributions. The [public-launch record](docs/public-launch.md)
records the retained-history decision, exposure review and repository protections.

Alpha.5 retains [safe validation diagnostics](docs/contracts.md), a
[small tested starter](examples/starter/README.md), and named frontend startup
with isolated lifecycle.

It also includes the [native setup workflow](docs/native-setup.md):
one managed setup, read-only doctor, reusable foreground runner and exact Codex
Browser viewer handoff. It extends Ninja-Update with source refresh at the accepted
version and immediate durable run reports. The published alpha.3 instructions and
existing integrations remain supported. Exact installed and production HTTPS
checks belong in verification. Immutable alpha.3 tools report `migration_required`
before downloading alpha.4 or later; independently verified new tools support both families.

## The first alpha journey

Start with one agreed, existing feature and a relevant negative case. An agent
performs the integration work in a separate QA directory, preserving the
application's dependencies, data and working tools. The application keeps its own
language; its integration supplies a native Rust model, a JavaScript adapter,
fixture instructions and assertions for the outcome that matters.

1. Open your application repository in Codex.
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
fixtures and acceptance checks.

## Contribute from source

To add Daedlo to an existing development stack, follow the
[local Docker Compose setup](docs/compose.md). Build the runtime and matching
model SDK locally from the repository's Dockerfile, package your application's
model and adapter, then add the generic `app-daedlo` service beside `app-portal`.
The guide includes the build, start, viewer and stop commands. No prebuilt Daedlo
registry image is required, and these commands do not push images. Native Linux
ARM64 and AMD64 conformance checks are recorded separately from application
acceptance and the published macOS kit.

Use Node 24.22.2 (`.nvmrc`), npm 11.21.2 and the Rust 1.96.0 toolchain pinned
in this repository. CI also selects Node 22.23.4; keep both supported lines on
current security patches.
From a source checkout:

```sh
npm ci
cargo build --workspace --locked
npx playwright install chromium
npm run check
npm test
npm run test:rust
npm run demo:notebook
```

The independent notebook lets contributors inspect and test the shared product
without Codex, API keys, Docker or private Roots source. Open its printed local
viewer URL and close it with Ctrl+C when finished. On Linux, missing browser
libraries may require `npx playwright install --with-deps chromium`.

[CONTRIBUTING.md](CONTRIBUTING.md) contains the fresh-clone setup, repository map,
focused checks, full browser/release gates and review workflow. Installed-package
acceptance is a separate release gate; source checks do not establish customer
acceptance, complete Roots replacement or remote CI success.

## Swagger API driving — alpha.10

A reusable [Swagger integration](integrations/swagger/README.md) reads OpenAPI
3.0/3.1/3.2 catalogs and drives the supported request/response subset through
Swagger UI 5 using the same guarded execution facade. Projects supply URLs,
operation permissions, authentication and independent business evidence.
The portable tools include the generic model source, isolated builder and
standalone launcher. Independent Swagger UI fixtures, exact installed checks and
actual Roots acceptance are recorded in [verification](docs/verification.md).
The integration is included in the alpha.10 portable kit. Its compatibility table
lists unsupported features explicitly; the verification record distinguishes
accepted artifacts from production publication.

## Teaching mode — planned

The [teaching-mode plan](docs/teaching-mode.md) proposes explained demonstrations,
guided practice and independent attempts, beginning with Roots Journal draft
retention. Teaching mode is not included in the current release. The plan links
the historical workflow evidence, new learner-observation requirements and
isolated acceptance gates.
