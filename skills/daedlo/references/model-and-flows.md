# Coauthor the customer model and flows

Use the customer's existing story/QA records where present. Keep this traceable:

**Story → nested enum/state transition → guard → command/recipe → assertion → evidence.**

## Agree the smallest useful slice

Bring product, development and QA perspectives to the same short proposal. Product
defines the useful outcome and exclusions; development proposes observed facts,
enums and ownership; QA challenges failure/recovery and proof. These may be three
review lenses of one agent, not a mandatory team or external communication.

Before adding behavior, present a minimal Rust enum sketch, Mermaid state diagram
and acceptance examples. Include only meaningful supported states; mark planned
branches explicitly. Reuse prior approvals and scenarios instead of requesting
the same agreement again. Resolve new business ambiguities with the user rather
than treating an inferred state chart as their approval.

Onboarding models existing application behavior. If acceptance reveals a product
bug, report it and keep the onboarding result honest. Implementing or redesigning
the application requires scope covering that work. A missing fixture capability
is a setup limitation, not a failed product scenario.

## Keep Rust authoritative

The current implementation uses a customer executable calling
`daedlo_engine::serve(model)`. Implement `ApplicationModel` with associated
`Facts`, `State`, `Command`, `Outcome`; provide `descriptor`, `state`, `state_id`,
`decode_command`, `authorize`, `verify` and `outcome_report`. Use `display`,
`command_available` and `authorize_recipe` where needed. The descriptor supplies
stable wire IDs, state hierarchy, typed parameter metadata and canonical recipe
steps. The descriptor alone is not an executable state machine.

Prefer minimal nested Rust enums expressing the agreed application branches.
Reuse canonical application enums where practical without importing application
semantics into shared daedlo core. Keep wire IDs explicit instead of
formatting Rust debug output. Decode observations/parameters strictly; use
`#[serde(deny_unknown_fields)]`, required facts and constrained enum values.

Derive state from measured facts; never assign it because an action ran. Authorize
actual command parameters from the current observation. `command_available` is a
preliminary UI check, not a substitute for `authorize`. Recipes have explicit
initial guards, then every step receives fresh authorization. Reject ambiguous,
unsupported or missing facts rather than defaulting to a ready/success state.

Keep temporal proof separate from current UI facts. Rust `verify` receives before
and after observations plus adapter evidence; it must distinguish success,
validation, recoverable failure and unknown. Enum exhaustiveness helps maintain
code, but does not prove that business cases or reachable transitions are complete.

## Keep Node factual and guarded

The adapter observes DOM/API/session facts, maps command IDs to browser actions,
and collects independent evidence. Do not reimplement Rust transition/permission
logic in JavaScript. Route effects through the supplied execution context's
`click`, `fill`, `select`, `press` and `effect`; do not bypass its boundaries with
raw action calls. UI selectors and readiness waits remain customer-specific.

Validate the evidence required for each operation: for a write this may mean a
matching accepted receipt, same owner/target/version and fresh read-back. Do not
substitute a generic HTTP-200 check. Distinguish a saved setup operation from a
later uncertain requested operation. `effectStatus` is per-run evidence, not the
last successful request; `beginRun` resets accounting without changing the app.

Keep retry identity/payloads private. Test exact retry only if the application
supports deduplication or reconciliation; a new request is not proof of replay.
Use public static labels/IDs for operation summaries. No private fact, cookie,
credential, user text or hashed private identity belongs in shared outcome labels.

## Make the mapping executable

Write meaningful acceptance/regressions before new integration behavior or fixes.
Record the genuine failing assertion, then implement and rerun. Setup, import,
missing dependency and compiler failures are not behavioral red evidence. Existing
application behavior can pass its initial baseline; do not manufacture a failure.

For the selected slice, include the actual success condition and relevant
validation/recovery, stale observation/session, draft protection and interruption
cases. Add persistence, lost-response retry or restart only when the story requires
them and the fixture supports them. No blanket claim of coverage for every state.

Use deterministic Rust checks for decoding/guards/outcomes and Node checks for
adapter/lifecycle boundaries; confirm affected flows through the real browser and
application evidence. Never weaken assertions or add blind retries to obtain green.
Keep execution completion, observed application outcome and persistence evidence
separate in the result. A screenshot supports visible state, not durable storage.

Maintain the diagram and mapping alongside the customer model after changes.
Record verified source/package identities and evidence per scenario. Planned or
unsupported branches remain visibly unverified. Future work follows the same
agreement → test → implementation → observed verification loop.
