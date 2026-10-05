# Browser-driver flow specification

Copy into the customer's existing QA/documentation structure and replace the
prompts below. This is an authoring template, not a runtime configuration format.
Only the agreed slice belongs here; preserve links to existing product decisions.

## Story and scope

- Story ID and useful user outcome:
- Existing behavior versus proposed application change:
- Included flow and explicit non-goals:
- Product decision/approval reference already covering this work:
- Application source and accepted driver baseline:

## Model proposal

Insert the minimal nested Rust enums and a matching Mermaid state diagram. Name
observable destinations and label transitions with semantic commands. Identify
unsupported/planned branches; do not imply they are implemented.

- Facts and how each is observed:
- Session identity and stale-state inputs (private values excluded):
- Command parameters and guards, including draft protection:
- Customer outcome rules and required evidence:
- Stop/recovery behavior; retry/deduplication contract if applicable:

## Acceptance map

| Story/scenario | Enum/state transition | Guard | Command or recipe | Independent assertion | Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Replace with one agreed example | | | | | | Planned |

Use statuses such as Planned, Baseline pass, Verified, Failed or Not run. Cover
the meaningful success and failure/recovery examples for this story. A recipe
completion alone is not a persistence assertion.

## Environment and ownership

- Existing environment or owned disposable fixture:
- Readiness proof and synthetic account/role references (no credentials):
- Allowed writes, fault injection and restart capabilities:
- Owned resources and scoped cleanup; attached resources to preserve:
- Private evidence location and sanitized sharing boundary:

## Implementation and handoff

- Customer model, adapter, project module and test paths:
- Exact runtime/crate versions and trusted artifact identities:
- Application/model source and customer engine binary identity:
- Install/build/launch/repeat commands:
- Product, development and QA review conclusions:
- Actual test results and source-specific evidence references:
- Remaining unknowns or unsupported cases:
- Cleanup result or intentionally retained resources:
- Accepted pins/launcher and explicit upgrade/rollback procedure:
