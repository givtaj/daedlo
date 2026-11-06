# Public launch controls

Daedlo is preparing to open the existing `givtaj/daedlo` repository, stable ID
`1391092739`, on `github.com`. It remains **private** until the owner approves
the visibility switch. Preparation does not publish another kit, deploy the
website or promote customer dependencies. Current release and licensing records
are [alpha delivery](alpha-release.md) and [licensing scope](licensing.md).

The [6 November integration checkpoint](verification.md#pr-23-private-preparation-integration--2026-11-06)
records current source checks and the retained-private scope. The
[30 October exposure audit](verification.md#open-source-preparation--2026-10-30)
retains its original date, inventory and limitations; those external surfaces
must be refreshed before any future public-access decision. Earlier dated
verification sections are historical observations, not the current checklist.

## Retain history and published identities

The owner decided **against rewriting Git history**. The earlier local rewrite
candidate was a preparation experiment, not an approved prerequisite. Do not
force-push, recreate the repository, retarget tags or remove signatures to open
access. Existing commits, release artifacts, checksums, notices, publisher trust
and verification identities retain their original meaning.

The reviewed history contains two historical private-chat identifiers in old
documentation blobs. The review did not identify a conversation transcript or
credential associated with them. Retain the recorded limitation without copying
the identifiers into a new report. Recheck newly added material before launch;
an unexpected credential or customer-data finding needs its own resolution.
Keep the old rewrite preparation and local preservation bundles private. Local
preservation is not an off-host backup. No history rewrite or GitHub Support
request is part of this launch plan.

## Source and exposure checks before the decision

Use a clean, isolated checkout of the selected current source. Preserve the
ordinary checkout's dirty drafts; its older evaluation-license candidate does
not describe the Apache-2.0 current core. Do not publish that mixed working tree.

Run the focused checks:

```sh
node scripts/check-public-metadata.mjs
node --test tests/public-metadata.test.mjs tests/repository-guardrails.test.mjs tests/release-public-licensing.test.mjs
node scripts/repository-guardrails.mjs
```

The metadata guard inspects tracked working-tree bytes. It rejects direct
private-conversation links and customer path segments without printing matched
content or opening customer material. It does not inspect untracked files,
compressed archives, image text, Git history or external GitHub surfaces.

The `Public metadata and secrets` CI job also runs pinned Gitleaks 8.30.1 over
fetched history, using its verified archive and the exact reviewed checksum
exceptions. The scan invocation is:

```sh
gitleaks git . --log-opts="--all --full-history -m" --redact=100 --no-banner
```

Before opening access, review the current remote heads/tags, retained PR content,
release assets and available Actions logs/artifacts. Include nested archive
contents and retained screenshots where applicable. Keep raw responses, matches
and private evidence outside tracked files. Record scope, dates, counts,
unavailable items and actual findings in verification. A secret scan alone does
not establish privacy clearance. The known historical metadata limitation above
does not authorize publishing newly discovered private material.

Confirm contributor setup, local links, Apache-2.0 terms, legacy grants and
third-party notices. Public-core use has no seat-payment or hosted-account
requirement. Customer applications and their separately authored integrations
remain separate. Broad customer adoption, teaching mode, billing and wider
platform support are not prerequisites for opening this source.

## Read-only audit and current private controls

The repository audit is read-only by default and fixes the GitHub host,
repository ID/name and default branch. It supports the same repository while
private or public, and refuses an identity or visibility change during a run.
Its public mode checks effective main rules and approval of workflows from all
external contributors; private-fork controls are then inapplicable.

The explicit `--apply-safe-actions` mode remains **private-only**. It permits only
the reviewed GitHub-owned Actions allowlist and full-SHA-pinning settings, reads
them back and refuses to broaden a stricter policy. It cannot change visibility,
history, billing, branch rules, releases, credentials or security products.

Retain read-only workflow tokens, disabled workflow PR approvals, no third-party
or wildcard Actions exceptions, and dependency vulnerability alerts. While
private, fork workflows, write tokens and secret sharing remain disabled.

The prepared [main ruleset](../.github/main-ruleset.json) is not enforcement.
Private personal-repository protections are currently blocked by GitHub's plan;
the owner declined a paid-plan change. The ruleset requires:

- Pull requests, resolved review conversations and an up-to-date branch.
- `Source and packaged consumer (Node 22)`, `Source and packaged consumer (Node 24)`
  and `Public metadata and secrets`, bound to the GitHub Actions check producer.
- No branch deletion or force-push, with no bypass actor.

The approval count remains zero for the single-maintainer repository; a maintainer
cannot approve their own PR. Revisit this when another maintainer joins.

Hosted CI must pass on the exact selected source. The 30 October account
payment/spending-limit block is historical: all three required jobs passed on
PR #22's merged main source `b3d4e575` in
[run 42190090935](https://github.com/givtaj/daedlo/actions/runs/42190090935).
Each later source still needs its own passing required checks. Local passes or
earlier release CI cannot substitute for them; retain every required job and
assertion. No billing change is part of this preparation.

## Final owner decision and public-switch sequence

1. Review the exact source/PR and current verification. Resolve unexpected
   exposure findings and required CI failures or unavailable evidence. Retain
   the explicit no-rewrite decision and known historical limitation.
2. Obtain the owner's explicit approval to change **this existing repository**
   from private to public. Until then, keep it private.
3. During that approved operation, apply `.github/main-ruleset.json` as soon as
   visibility supports it. Read back the effective main rules, required contexts,
   producer binding, deletion/force-push protections and absence of bypasses.
4. Require workflow approval for **all external contributors**. Recheck the
   Actions allowlist, SHA pinning, read-only workflow defaults and dependency
   alerts; do not expose secrets or write tokens to fork workflows.
5. Inspect available public-repository secret scanning, push protection and
   private vulnerability reporting. Configure the supported controls during the
   approved switch and record their actual readback. The audit script does not
   enable or establish these controls. Keep [SECURITY.md](../SECURITY.md) as the
   documented private reporting route.
6. Rerun the read-only audit against the public repository and verify anonymous
   source/contributor links. Record the visibility change, effective settings,
   exact-source CI and any unavailable feature. Update the current access text
   in README, CONTRIBUTING, ROADMAP and the naming guide from that observation.

Only claim the public launch complete after the actual switch and readbacks.
Source access, already published alpha releases, website deployment and customer
acceptance are separate milestones; opening source does not require another
alpha.4 migration or rewrite of historical receipts.

Primary references: [GitHub repository visibility](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility),
[repository rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets)
and [Actions permissions](https://docs.github.com/en/rest/actions/permissions).
