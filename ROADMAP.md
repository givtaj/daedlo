# Daedlo roadmap

Daedlo focuses on one inspectable application flow at a time: a typed Rust model,
guarded browser actions, visible execution and evidence for the actual outcome.
This roadmap identifies directions for discussion and contribution, not promised
release dates or a claim that planned features already work.

The [verification record](docs/verification.md) is the source of measured results.
The [implementation plan](docs/plan.md) retains the development history and scoped
acceptance decisions. The repository is public and welcomes contributions under
the [contributor workflow](CONTRIBUTING.md).

## Near-term priorities

The current downloadable alpha and its exact scope are listed in
[releases](https://github.com/givtaj/daedlo/releases) and the
[installation guide](https://daedlo.com/install). Development progress does not
change an accepted installation or make a candidate available to customers.

### Active development

- **Persistent target history and recovery — in development.** Keep durable run
  records in a customer-owned workspace and recover interrupted ownership without
  replaying application actions. Journals and crash-recovery work are local
  development; a SQLite target catalog, browsable multi-target history and exact
  release acceptance remain further steps. These capabilities are not included
  in the current public kit.
- **Docker Compose service — in development.** Run Daedlo beside an application's
  existing services, with explicit networking and ownership. Container startup,
  browser access, restart and shutdown acceptance must complete before a supported
  image or customer deployment is claimed. No public container delivery is
  announced here.
- **Clearer development restart status and Swagger selection — release candidate.**
  [PR #36](https://github.com/givtaj/daedlo/pull/36) prepares alpha.10. Publication,
  exact installed checks and public upgrade verification remain distinct gates;
  follow the release record for availability.

### Continuing contribution areas

- Preserve existing release artifacts, wire contracts and customer installations
  as the product evolves.
- Make the manual contributor setup and independent fixture easy to reproduce;
  distinguish contributor-platform checks from customer-onboarding acceptance.
- Improve explanations and accessibility of viewer controls without blurring
  execution, application outcome and persistence evidence.
- Strengthen regression coverage at observed interruption, resource-cleanup,
  packaging and managed-update boundaries.
- Collect feedback on one real application flow before widening integration or
  platform claims. Customer-specific ports remain separately scoped.

## Useful first contributions

These are task ideas, not pre-created or reserved issues. Check the tracker for
existing work and agree scope with a maintainer before a substantial change.

| Task | A useful completion result |
| --- | --- |
| Reproduce the contributor setup on a clean Ubuntu or macOS environment | Record versions and exact commands; fix any reproducible documentation gap |
| Review keyboard use of the independent fixture's viewer | Report a concrete focus/navigation problem with reproduction and observed UI evidence |
| Improve a confusing error or setup instruction | Show the original failure and clearer guidance without treating uncertainty as success |
| Add a missing negative contract case | Demonstrate a meaningful failing assertion, implement a small fix if needed, then verify it |
| Check active documentation links and example commands | Repair broken current guidance while preserving historical paths and release identities |

## Later work

[Teaching mode](docs/teaching-mode.md) is planned. Broader operating-system and
agent-host onboarding need their own acceptance, as do additional application
integrations. A hosted subscription service is not part of the Apache-2.0 local
core. The [historical subscription discussion](docs/subscription-plan.md) is
deferred and does not define a current paid offer.

Start with [CONTRIBUTING.md](CONTRIBUTING.md) and a focused proposal.
