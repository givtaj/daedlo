# Public launch controls

Daedlo remains **private**. The owner chose to prepare branch protections for a
later approved public switch, with no paid-plan change. Neither these files nor a
passing CI run authorize changing repository visibility, publishing a package or
deploying the website.

## Current source safeguards

The `Public metadata and secrets` CI job tests the repository-management tool,
checks the current tracked files for private conversation links and customer
material, and runs pinned Gitleaks 8.30.1 across fetched Git history. The scanner
archive is verified against its pinned SHA-256 before execution. The workflow has
a read-only token and does not upload scan logs or findings.

Run the metadata guard and its regression checks locally:

```sh
node scripts/check-public-metadata.mjs
node --test tests/public-metadata.test.mjs tests/repository-guardrails.test.mjs
```

The metadata guard reports paths and rule names without echoing matched private
text. It does not inspect untracked customer data or follow tracked symlinks.
`customers/` is ignored, and the guard rejects that directory if force-added.
The URL patterns are a focused guard, not a general personal-data detector.
Current-tree checks do not establish that old Git objects are clean. Review
screenshots, release assets, Actions artifacts/logs, PR content and source history
before a visibility change. Do not replace a privacy review with a secret scan.

## Private repository settings

The management tool is read-only by default, fixes the GitHub host and repository
identity (`givtaj/daedlo`, ID `1391092739`), and refuses mutations unless the repo
is private with the expected default branch. It never changes visibility, billing,
Git refs, security subscriptions or branch protections:

```sh
node scripts/repository-guardrails.mjs
```

Its explicit `--apply-safe-actions` mode permits only the two documented Actions
settings writes: select GitHub-owned actions with full commit-SHA pinning, without
allowing verified third-party actions or wildcard exceptions. It reads back the
result and refuses to widen an already more restrictive policy. Workflow tokens
must remain read-only and must not approve PRs; private-fork workflows, write
tokens and secret sharing remain disabled. Dependency vulnerability alerts remain
enabled. Read the tool's result as observed state: unavailable controls are
reported as blocked, not passed.

GitHub currently returns a plan restriction for private personal-repository branch
protection and rulesets. The owner explicitly declined a paid-plan change. The
pending [main ruleset](../.github/main-ruleset.json) is **not applied**. It requires:

- Pull requests, resolved review conversations and an up-to-date branch.
- Both Node 22/24 source-and-package CI jobs and `Public metadata and secrets`,
  bound to GitHub Actions as the check producer.
- No branch deletion or force-push, with no bypass actor.

Approval count is zero because the repository currently has one maintainer; a
maintainer cannot approve their own PR. Revisit reviewer requirements when a
second maintainer joins. A JSON policy file does not enforce these controls.

## Historical privacy cleanup

A separate, ignored local preparation contains the complete Git bundle, verified
restore, exact replacement rules, ref/commit maps and a candidate history. Keep
those artifacts private: the original bundle contains the identifiers being
removed. A local bundle is not an off-host backup.

At the preparation cutoff, the candidate removes two historical chat identifiers
from ten blob versions. All 53 commits are rewritten, including nine commit
signatures; eight merge topologies and all 21 advertised ref tips retain their
original content. Release-tag targets change even though the tip trees do not.
No remote history was replaced by that preparation.

Before any approved rewrite, refresh the snapshot against every current remote
ref, coordinate all local checkouts and paused work, and verify unpublished local
commits have a migration path. Preserve dirty and ignored work. Use explicit
expected-old ref leases and an audited ref list; never a blind mirror push.
GitHub pull-request refs cannot be force-updated by a client. GitHub Support may
need to remove retained PR references/cached views, and may decline removal of
non-sensitive identifiers. A force-push alone cannot establish complete removal.
Any Support message requires the owner's authorization.

After a rewrite, re-scan all reachable objects, update only the exact reviewed
Gitleaks fingerprint using the verified commit map, and repeat the secret scan.
Do not mechanically replace old SHA values in manifests, legal attribution,
verification receipts or `scripts/release/ninja-checkpoint.mjs`: those identify
immutable original bytes or GitHub workflow executions. Preserve their original
identity and explain the verified old/new commit mapping. Existing signed release
assets and published website/feed bytes are not republished by a Git cleanup.

## Owner approval before public access

Finish and verify the historical cleanup, review any retained GitHub objects, and
refresh source and external-artifact exposure checks. Record unresolved limits in
[verification](verification.md), then ask the owner for explicit public-access
approval. **Keep the repository private while that approval is pending.**

After that approval, apply `.github/main-ruleset.json` through GitHub's ruleset API
as soon as the repository's plan/visibility supports it. Read back the effective
`main` rules and all required check contexts; a successful request alone is not
verification. Also configure approval of workflows from all external contributors
and inspect available public-repository secret scanning, push protection and
private vulnerability reporting. Record the actual settings and any unsupported
features. The current audit tool deliberately refuses to manage a public repo;
review and extend its identity/visibility contract before that later step.

Only claim the launch ready after these checks and the owner decision. Source
community access is separate from the unreleased alpha.4 package migration and
its customer acceptance gates in [the rename guide](rename.md).

Primary references: [GitHub history removal](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository),
[repository rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets)
and [Actions permissions](https://docs.github.com/en/rest/actions/permissions).
