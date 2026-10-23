# Working on Daedlo

Read README.md, CONTRIBUTING.md, docs/plan.md, docs/contracts.md and
docs/development-workflow.md. Shared-core contributions use the independent
notebook fixture and do not require private Roots source or an AI agent.
Keep product status in docs/verification.md accurate; update it from actual tests,
not intentions. This repository is being built from an approved Roots-derived
design. Existing user agreement covers the documented acceptance scenarios.

For customer onboarding or authoring feature flows, read
`skills/daedlo/SKILL.md` and `docs/agent-onboarding.md`. Reuse accepted
models and recorded product decisions; the agent performs the integration work.
The instructions are distributed from this repository for Codex and Claude Code.

- Preserve the user's live Roots checkout and unrelated dirty work. Read a pinned
  commit for source comparisons. Never install candidates into Roots' normal
  dependencies, overwrite its binaries, or stop its services as a side effect of
  work here. Candidate Roots acceptance uses an isolated source snapshot, explicit
  artifacts, separate build output, browser session, ports and disposable data.
- Core code must not import Roots or require its source/database. Application
  states, selectors, business outcomes and fixture semantics belong to customers.
- Product examples and the work archive must come from actual Roots usage and
  recorded evidence. Inspect the real UI and logs before describing a workflow.
  Keep original Roots behavior, extracted candidate coverage, historical evidence
  and new observations distinct. The notebook is an independent conformance
  fixture, not the default product demonstration. Never invent archive entries.
- Use the shared execution facade and guarded primitives; do not duplicate the
  application transition graph in JavaScript. The adapter remains trusted code.
- Missing observation, incompatible contracts, absent handlers and uncertain
  effects must never become success by default. Keep execution status separate
  from application outcome and persistence evidence.
- For new behavior or fixes, write meaningful regression/acceptance checks first,
  record the genuine failing assertion, then implement and verify. Setup or import
  failures are not evidence of a failing browser scenario.
- Run affected Node/Rust checks and real-browser checks for affected user flows.
  Inspect the visible UI before claiming its presentation is ready. Do not weaken
  assertions or add blind retries to hide failures.
- Keep one integration owner for dependency/lockfile/entrypoint changes. Respect
  other workers' file ownership and preserve concurrent edits.
- Track owned resources and replacements explicitly. Clean only owned resources;
  retain failed cleanup handles and report incomplete cleanup. Attached resources
  survive closing the driver.
- Review/port later Roots improvements only when the user asks. Follow the
  upstream-review process; do not create automatic synchronization or monitoring.
- Keep secrets, synthetic account credentials, raw session cookies, private
  traces, dependency installs and build artifacts out of Git. Hashes are not
  anonymization. Only public metadata belongs in shared reports.
- Do not publish or change everyday Roots dependency pins without scope covering
  that promotion. Normal local implementation and isolated verification can
  proceed under the current authorization.
