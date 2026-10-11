# Daedlo agent-led application onboarding

An agent installs Daedlo and helps product, development and QA contributors
turn a user story into a Rust state model, guarded browser flows and inspectable
evidence. The agent reads the application and does the integration work; the team
defines the intended behavior and what counts as success. Authored flows can then
run without an AI agent or model API key.

The product name is Daedlo; the existing browser-driver package names, commands
and skill paths below remain the supported technical identifiers.

Keep the current native Rust engine and Node/Playwright runtime. A customer's
backend can use JavaScript/TypeScript, Go, Rust, PHP or another language: the
integration operates through the web UI and customer-specific evidence hooks.
This is an architecture boundary, not a claim that onboarding has been tested on
every framework. No WASM conversion or application rewrite is required.

## Give an agent the onboarding job

The portable [browser-driver skill](../skills/browser-driver/SKILL.md) contains the
workflow and its supporting references. Start with the verified portable tools
package or a reviewed browser-driver source checkout at an explicit revision.
Until the skill is installed, ask the agent to read that file directly. For example:

> Read `skills/browser-driver/SKILL.md` in the chosen browser-driver tools package or checkout. Onboard this
> web app using the existing Rust engine and Node runtime. Inspect our current
> setup, then help us agree the nested Rust enum, transition diagram and acceptance
> for one useful flow. Reuse any agreement already recorded. Install the exact
> candidate, connect the model and adapter, verify the flow in a visible viewer,
> and leave instructions and evidence that another agent and our QA team can reuse.
> Preserve our existing services, data, dependency choices and unrelated work.

Specify an already-agreed story when one exists. If only onboarding is requested,
choose existing behavior with the user; installing a tool does not authorize
inventing or implementing a new product feature. A design-only request stops with
the proposed model and acceptance. Continue approved implementation without asking
the team to approve the same decisions again.

## Install the instructions for Codex or Claude Code

Use the same complete skill folder for both hosts. Installation belongs in the
customer repository, so future contributors inherit the workflow. The agent should
inspect existing instructions first and preserve them.

| Host | Project skill directory | Explicit invocation |
| --- | --- | --- |
| Codex | `.agents/skills/browser-driver/` | Select the skill, or use `$browser-driver` in CLI/IDE |
| Claude Code | `.claude/skills/browser-driver/` | `/browser-driver` |

From the customer repository root, the agent can copy the reviewed folder into a
fresh destination. Set `driver_source` to the installed tools package root (the
directory containing its `SOURCE.json`) or reviewed checkout, and choose one host's
`skill_parent`; these are placeholders, not an unattended installer:

```sh
driver_source=/absolute/path/to/browser-driver
skill_parent=.agents/skills
# For Claude Code instead: skill_parent=.claude/skills
test -f "$driver_source/skills/browser-driver/SKILL.md" &&
  mkdir -p "$skill_parent" &&
  test ! -e "$skill_parent/browser-driver" &&
  cp -R "$driver_source/skills/browser-driver" "$skill_parent/browser-driver"
```

Copy supporting references and assets too. If the destination exists, compare it
and make a scoped update instead of overwriting local customizations. For teams
using both hosts, copy the same revision to both locations and record their source
revision in the application's onboarding record. Update the copies deliberately;
there is no automatic synchronization. Check discovery in the agent's skill list;
if a new skill is not visible, reload the host or explicitly read its `SKILL.md`.

Add a short pointer to the project's existing `AGENTS.md` and/or `CLAUDE.md` when
appropriate. Point to the installed skill, the accepted application model, its flow
catalogue and the existing verification record. Do not replace those instruction
files or create a second source of behavioral rules.

Host paths and invocation were checked against the official
[Codex skill documentation](https://learn.chatgpt.com/docs/build-skills) and
[Claude Code skill documentation](https://code.claude.com/docs/en/skills) on
2026-10-05. This folder is an instruction distribution, not a published plugin,
MCP server or registry installer. It is not included in the current runtime tarball.

## Dependency preflight

Read the selected candidate's manifests before installing. The following describes
public preview 0.1.2-rc.1. Follow its manifests rather than silently upgrading
a working consumer. Start with the verified kit from https://daedlo.com/install.html.

| Component | Current requirement | Purpose |
| --- | --- | --- |
| Node.js | Runtime declares `>=22`; CI exercises 22 and 24 | Session runtime, CLI, viewer and browser adapter; Node 24 also satisfies the Roots fixture requirement |
| npm | No separate minimum declared | Install the exact runtime artifact and retain the consumer lockfile; repository development uses `npm ci` |
| Rust and Cargo | Rust minimum 1.96; repository pins 1.96.0 | Build the customer's typed `ApplicationModel` against the shared crate |
| Playwright | Runtime pins `1.62.1` | Browser control; install its matching Chromium separately |
| Chromium system libraries | Platform-dependent | Linux may need Playwright's system dependency installation; use the host's normal permission flow |
| Docker | Conditional on the customer's fixture | Roots uses an isolated PostgreSQL container; shared runtime and notebook acceptance do not require Docker |
| Application build/data tools | Customer-specific | Read the application's manifests and setup guide; its requirements may exceed the driver's |

The shared Rust crate directly depends on `serde`, `serde_json` and `sha2`. The
workspace's TypeScript, Node type definitions, Prettier, rustfmt and Clippy support
development checks; they are not an AI service or customer backend requirement.
The core has no OpenAI/Anthropic SDK dependency. Agent access comes from the chosen
agent host. Node/browser downloads and application dependencies still need their
normal network access.

Prefer a repository-scoped Rust toolchain so an application with another Rust
version keeps its existing compiler. Use a separate integration package/workspace
where that avoids changing the application's normal dependencies. Check Docker
availability only if the selected fixture needs it; an unavailable backend is a
setup blocker, not permission to restart services used by other projects.

## Install the runtime and create the customer integration

The agent follows the skill's [installation reference](../skills/browser-driver/references/onboarding.md)
and the selected tools package or checkout's [release guide](releases.md). The current supported
distribution path is an explicit candidate bundle or reviewed source checkout.
Registry publication is not established by these instructions: do not assume that
`npm install @browser-driver/runtime` or `cargo add browser-driver-engine` selects
our verified candidate.

Verify an acquired bundle against its independently supplied manifest digest,
install its exact runtime tarball, and compile the customer's engine against the
matching extracted crate. Keep the chosen artifacts available for reproducible
builds and rollback. A release store's `update` command selects artifact paths;
the agent must still perform the consumer installation and build.

The customer integration owns:

- A nested Rust enum and typed facts, commands, guards, recipes and outcomes through
  `ApplicationModel`; reuse an appropriate existing model rather than adding a
  parallel one. This is the QA observation/decision model and does not replace the
  application's authorization or production state machine.
- A JavaScript adapter that observes facts, collects evidence and performs effects
  through the runtime's guarded primitives. Keep behavioral decisions in Rust.
- A project module for `browser-driver --project PATH`, plus explicit startup,
  authentication, readiness, fixture and cleanup instructions.
- A flow catalogue connecting story, state/transition, guard, recipe, assertion and
  evidence. Keep planned, implemented and actually verified coverage distinct.

The existing CLI creates an owned browser/context. The public session API can
accept an existing controlled page/context; simply opening the same URL does not
attach to a user's authenticated session. Explain headed versus streamed-headless
mode and show the viewer that belongs to the controlled browser.

For a requested demonstration of an accepted flow, use the shared
[presentation mode](presentation.md): customer-owned titles/explanations and holds
decorate the existing command or Rust recipe. Configure it on that session or in
the CLI project module. Choose human-readable holds separately from execution
speed; do not reconstruct the transition graph or silently reset an application
to make a presentation continue.

## Complete the first onboarding

Product contributors review the outcome, language and useful branches. Developers
review feasibility, observability and integration boundaries. QA contributors review
prerequisites, failure/recovery cases and assertions. One person may cover all three
perspectives; an agent review does not invent human agreement.

Agree one useful flow before attempting a whole application map. For new behavior,
follow the customer's test-first requirements. For already-working behavior,
establish truthful passing coverage instead of manufacturing a failure. Verify the
actual UI and any persistence/retry claims with appropriate independent read-back.

Onboarding is complete when another contributor or agent can find the pinned
dependencies, build and launch the integration, understand the accepted model, run
the first flow and inspect its evidence and limitations. Record environment,
application/model/runtime identities, precise assertions and cleanup or retained
session ownership. Persist sanitized evidence deliberately: the runtime's latest
16 completed reports are in memory, not a durable team archive.

The Roots experience is the source of this workflow. Read the public kit manifest
and tools receipt for artifact provenance. Repository examples and docs/verification.md
are not included in portable tools. Customer acceptance still requires running
the chosen package, model and adapter combination.
