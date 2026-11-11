# Publish and renew the Ninja-Update feed

The production publisher is `daedlo`, channel `preview`, at
`https://daedlo.com/updates/preview.json`. Only assisted macOS arm64 is offered.
Release downloads stay immutable under `/downloads/<version>/`. The public key
is pinned by `docs/update-trust/production.json` and shipped in the verified tools.
The signing key is never included in a package, public asset tree or repository.

## Key custody

The release owner keeps the Ed25519 PKCS#8 private key in
`~/.config/daedlo/release-signing/daedlo-release-2026-10.pem`, with mode `0600`
inside an owner-only directory. The public SPKI PEM is
`docs/update-trust/daedlo-release-2026-10.pem`. Keep an independently secured backup
of the private key; this repository does not create or verify an off-device backup.
Changing or losing the key requires an explicit trust rollout, not replacing a
key behind an existing ID. No private key is provisioned into the website.

The owner authorized GitHub Actions renewal on 23 October 2026. The same key
is stored in the repository secret `DAEDLO_UPDATE_SIGNING_KEY`; only the trusted
default-branch renewal job receives it. That encrypted secret is not an exportable
backup. The job writes an owner-only temporary key, removes it after signing and
never includes it in artifacts or deployment assets. `CLOUDFLARE_API_TOKEN` is a
separate deployment credential scoped to **Individual Workers → daedlo → Editor**,
with `CLOUDFLARE_ACCOUNT_ID` supplied as a repository variable. No account-wide
Worker or domain permission is required. See verification for provisioning status.

## Publish a release

1. Complete source, exact-package and isolated application gates. Freeze one clean
   source revision and build the runtime/crate bundle, tools and public kit once.
   Add only sanitized verification metadata before freezing `release.json`.
2. Integrate reviewed source with exact-head CI and publish the exact three-file
   kit as a GitHub prerelease at its frozen source commit. The repository is now
   public; normal release publication needs no repository-visibility change.
   Verify the tag and downloaded asset bytes against the frozen verification record.
3. Prepare and review the matching publisher pins, website allowlist and customer
   guidance in a separate publisher change. Preflight the complete staged website,
   including historical downloads, current kit and signed catalog. Inspect its
   installation/update pages at desktop and narrow widths.
4. Merge the reviewed publisher change in the coordinated release window and
   dispatch the existing renewal workflow with exactly one promotion input.
   It restores the authenticated checkpoint, verifies every frozen asset, signs
   and stages the feed, persists its new checkpoint, then uploads and activates
   the exact checked version of the existing Daedlo Worker. The release-specific
   section below defines the selected input and retained history.
5. Verify the active deployment and every served asset on the canonical apex origin.
   Record the provider hostname's response separately under the approved access policy.
   Verify the downloaded catalog with the independently pinned public key. Run the
   published-mode application acceptance using the downloaded tools, real HTTPS
   discovery/downloads, and disposable data. Record upgrade, rejected candidate,
   rollback, byte integrity, reports and cleanup separately from source checks.

## Explicit release promotion

Alpha.4, alpha.5, alpha.6 and alpha.7 use separate reviewed promotion selections in the
existing renewal workflow. After exact-package acceptance, pin the candidate's clean
source commit and its complete three-file public inventory in
`scripts/release/ninja-renew.mjs`. Retain all previous identities. Publish the
matching GitHub prerelease, merge reviewed publisher policy, then dispatch
`promote_alpha5=true` on the default branch for alpha.5,
`promote_alpha6=true` for alpha.6, or `promote_alpha7=true` for alpha.7. Select at most one promotion input; ordinary
renewal cannot introduce an unpinned release.

The alpha.5 path requires the retained alpha.4 entry; alpha.6 requires the complete
retained alpha.5 inventory; alpha.7 requires the complete retained alpha.6 inventory.
Each requires the same authenticated high-water
checkpoint and signing identity, and manager contract 2. They preserve all earlier
releases exactly. After successful promotion, ordinary renewal must retain the
complete inventory including alpha.7; a higher generation cannot remove it.
These workflow capabilities do not establish publication until the live gates
pass and verification records the actual result.

Alpha.7's native observation/supervisor fix is delivered in release-tools. A
runtime update through an existing alpha.6 manager keeps that manager's tools and
cannot apply the supervisor fix. Verify the separately versioned tools archive,
safely stop the authenticated old owner, then bootstrap the new tools against the
same configuration, registration, store, publisher trust and high-water checkpoint.
Retain accepted tools/installations for recovery. No tools bootstrap hot-reloads
an already running adapter or bypasses unknown draft/pending-operation guards.

## Alpha.9 coordinated promotion

This is the historical alpha.9 procedure, completed while the repository was
private. The current alpha.10 procedure below uses the now-public repository.

The prepared alpha.9 policy pins source
`30d2a985964011c08d80db2e83a3716a2c151345` and the three immutable files in the
verification record. Alpha.8 remains held and is not a required predecessor.
Alpha.9 requires the complete retained alpha.7 history and the same authenticated
high-water checkpoint and signing identity.

Keep this publisher change in a separate inactive draft until publication is
selected. Adding alpha.9 to the active inventory causes ordinary renewal to
reject an alpha.7-only feed; it must be integrated in a coordinated promotion
window. Review the final source and publisher checks, then:

1. Integrate the reviewed source PR without rebuilding the frozen kit.
2. Publish the exact three-file kit as private-repository prerelease
   `v0.1.4-alpha.9` targeting the pinned source commit. Verify tag, bytes and hashes.
3. Integrate the reviewed publisher policy and dispatch the existing renewal
   workflow with only `promote_alpha9=true`. The historical four selectors remain
   false. The CLI equivalent is `ninja-promotion.mjs --promote-alpha9` with the
   existing explicit key, output and authenticated checkpoint paths.
4. Preserve all prior downloads and six signed entries. The workflow persists a
   new authenticated checkpoint before upload and verifies the live baseline
   again before activation. Never substitute the local preview's ephemeral key
   or bypass a stale/missing checkpoint.
5. Verify the actual public apex files, signature, active Worker version, fresh
   installer and the explicit alpha.7 to alpha.9 dependency-migration recovery
   drill over production HTTPS. Preserve all owned cleanup and rollback evidence.

Alpha.9 changes Playwright's dependency closure. Existing managed applications
need the reviewed QA-only manifest/lock migration in `docs/ninja-update.md`.
Swagger itself uses the shipped standalone integration; this promotion does not
claim native managed Swagger onboarding. Password masking requires the explicit
password parameter type and does not redact arbitrary application output.

## Alpha.10 coordinated promotion

Use the source commit and exact three-file identities in the frozen verification
record. Alpha.10 keeps alpha.9's dependency closure and manager contract 2. Its
managed acceptance uses the unmodified published alpha.9 tools through update,
restart and rollback. The historical alpha.7 to alpha.9 dependency migration is
not part of this upgrade; standalone Swagger remains outside native managed
onboarding and updates.

Keep this publisher change inactive until its publication window. Adding alpha.10
to the active inventory makes ordinary renewal reject an alpha.9-only feed.
The release owner has authorized review, merge and publication; follow the
existing protected-PR and workflow gates without rebuilding accepted archives.

1. Integrate the reviewed source with passing exact-head checks. Publish
   `v0.1.4-alpha.10` as a prerelease in the public repository at the frozen source
   commit, with only its exact ZIP, `SHA256SUMS` and `release.json`. Read back the
   tag and asset sizes/digests before advancing.
2. Merge the reviewed publisher policy, including the final source/file pins and
   website inputs. Dispatch the default-branch renewal workflow with only
   `promote_alpha10=true`; keep all five historical promotion selectors false.
   The CLI equivalent is `ninja-promotion.mjs --promote-alpha10` with the existing
   explicit private-key, fresh output and authenticated checkpoint paths.
3. Retain all 24 earlier download files and the seven existing signed release
   entries. The promoted catalog has eight entries: alpha.2 through alpha.7,
   alpha.9 and alpha.10. Alpha.8 stays excluded. Preserve the same publisher key,
   authenticated high-water history and existing Worker/domain configuration.
4. Require checkpoint persistence before upload and another verified live baseline
   before activation. Verify the exact active Worker version, complete public
   manifest, signed feed and all three alpha.10 downloads over production HTTPS.
   Do not substitute a local preview key or bypass expiry, history or signature checks.
5. Verify the copied public installer and the production HTTPS alpha.9 to alpha.10
   upgrade, restart and rollback drill using the retained published alpha.9 tools.
   Preserve source, configuration, trust, data, previous installation and cleanup
   receipts. Record customer-specific acceptance separately from these checks.

The exact installed acceptance and public verification results belong in
[verification](verification.md). Preparing this policy or merging source does not
establish that publication or customer acceptance has completed.

## Automatic renewal

The reviewed workflow is `.github/workflows/ninja-renew.yml`: daily at **04:23 UTC**
and manually through **Actions → Renew production Ninja Update catalog → Run
workflow** on the default branch. Activation and actual execution status are
recorded in [verification](verification.md); a committed schedule alone is not a
successful renewal. GitHub can delay scheduled jobs, so each catalog allows at
most seven days. Clients never ignore expiry.

On 23 October 2026, manually dispatched runs
[39948319111](https://github.com/givtaj/daedlo/actions/runs/39948319111)
and [39948603151](https://github.com/givtaj/daedlo/actions/runs/39948603151)
completed all renewal gates. The latter restored the former's authenticated
generation-2 checkpoint with `bootstrap:false` and published generation 3, expiring
`2026-10-30T11:48:13.935Z`. The original alpha.3 consumer verified both renewals
and unchanged downloads. Daily scheduling is enabled; its first unattended run
has not yet been observed. Exact identities and regional limits are in verification.

The job restores its authenticated high-water checkpoint, downloads and verifies
every pinned immutable file for retained releases, and signs a new catalog
with a strictly greater generation. It retains existing release entries exactly.
It rebuilds only the static website from reviewed source; it does not rebuild a
release archive, change customer files, update the application or change its
interfaces. A future release requires a reviewed extension to the pinned asset
inventory in `scripts/release/ninja-renew.mjs`.

Before deployment, the job checks the complete staged site, seals its manifest,
and persists `catalog.json` plus its exact public digest receipt as the Actions
artifact `ninja-renewal-checkpoint-<attempt>`. Only those two public files are
included in the checkpoint artifact. Artifacts are retained for 90 days. Failed
runs and prior
attempts count toward the high-water mark; missing, expired, deleted or ambiguous
history stops publication. Do not delete the latest checkpoint or its run.

Wrangler uploads a version of the existing `daedlo` Worker, rechecks the unchanged
live baseline, then activates that exact version at 100%. It does not update
routes or domains. Verification checks the active version through Cloudflare's
API and compares all served assets, signature, cache rules, security headers and
private-path boundaries on the production apex origin. Check the workflow result and
its verified generation/expiry, not just a green upload step.

After activation is confirmed, the workflow enables `live --wait-for-assets`.
An expected public asset returning HTTP 404 can wait up to **120 seconds total**,
with a five-second interval and at most 25 attempts. Each attempt starts the full
strict verification again; success requires every expected asset and private-path
boundary to pass in one complete attempt before the shared deadline. Approved
HTML canonical redirects remain supported. A permanent 404 fails the run.
Other HTTP errors, challenges, network failures, changed bytes, invalid or expired
signatures, incorrect cache/security headers and exposed private paths fail
immediately. The wait does not deploy again or issue another catalog generation.

The workflow retains `ninja-live-verification-<attempt>` for 90 days on success or
failure. Its append-only JSONL observations include reviewed request paths, attempt
counts, elapsed time and the final outcome; they exclude response bodies, raw
errors, request queries and credentials. These observations supplement the signed
checkpoint and original workflow log. A later passing run never changes an earlier
failure into success. The 120-second limit is publisher policy, not a provider
availability guarantee.

## Failure recovery and credential rotation

An expired catalog blocks new checks/downloads. Accepted local installations and
local whole-installation rollback continue under their normal integrity checks.
A failed renewal must be resolved before expiry; a schedule is not a delivery
SLA. GitHub's workflow notifications use the repository owner's existing settings.

If failure occurs before checkpoint persistence and an earlier authenticated
checkpoint remains available, correct the cause and start a fresh default-branch
dispatch. The initial bootstrap is deliberately stricter: only the first run
and first attempt may use the independently pinned generation 1 without a saved
checkpoint. If that initial run fails before persistence, investigate and prepare
a reviewed recovery; rerunning it or starting another run cannot silently reset
bootstrap. Never delete history or reset counters to regain that exception.

The recorded initial failure on 23 October 2026 is run `39946067474`, attempt 1,
from `e5e47d97c8226ff0f3a3f390e8c95926e7c44039`. It failed during public HTTP
preparation, with no artifact and every publication step skipped. A reviewed,
hardcoded recovery permits only fresh manual run 2, attempt 1, after independently
matching that exact run, attempt, job and all step outcomes, a complete two-run
history and zero artifacts. It still requires the original signed generation-1
payload. This exception is not a general retry switch and cannot be used by a
later run or attempt. The separate manual `ninja-feed-probe.yml` workflow reads
only fixed public URLs, without secrets, and records bounded response metadata
without bodies; it does not publish or create renewal checkpoints.

The daily **04:23 UTC** trigger could have consumed run 2 before manual recovery;
even a skipped job consumes its run number. Manual run 2 used that exception
successfully; run 3 restored its durable checkpoint normally. The exception is
now historical and cannot be reused. Never delete history, reset counters or
broaden it silently to recover a later failure.

As of 23 October 2026, [probe 39947177085](https://github.com/givtaj/daedlo/actions/runs/39947177085)
received **44/44 HTTP 403 challenges**, covering both public origins and both
user-agent variants, with no successful HTTP response. Dashboard inspection of
the owned feed request identified the existing account-wide US country access
rule. See [verification](verification.md) for the evidence and scope. A subsequent
authorized US Allow rule was restricted to daedlo.com. Follow-up
[probe 39948105153](https://github.com/givtaj/daedlo/actions/runs/39948105153)
returned 22/22 HTTP 200 on the apex and 22/22 HTTP 403 on the provider hostname;
the account-wide rule is unchanged. Country Allow also bypasses custom and
rate-limiting rules for matching Daedlo traffic, including future rules.
Delivery checks cover Spain and the US. Baseline DE/FR/ES probes passed 6/6;
NL received 2/2 challenges; its challenge policy remained unchanged.
Final generation-3 probes passed four exact, signature-verified feed GETs and
four ZIP HEAD availability checks across two Spain and two US locations. Full
archive-body integrity was verified separately by the original consumer. The
extra-header diagnostic failure is retained and explained in verification;
regional samples do not establish countrywide availability.
The provider hostname and remaining country restrictions are explicit reach limits,
not reasons to bypass signatures, follow redirects or replace the publisher pin.

If persistence completed, first inspect the signed checkpoint, live feed and
active Cloudflare version. When the live feed already
matches that checkpoint, a fresh dispatch can advance normally. When the checkpoint
is ahead of live, automatic renewal deliberately stops: recover the exact signed
catalog from the retained artifact and, while it remains unexpired, reconstruct
and validate the complete website against the pinned immutable files, then
complete that publication with the release owner's normal deployment procedure.
An expired checkpoint establishes authenticated history only: recovery must sign
a strictly newer catalog with fresh bounded validity, retain its public checkpoint
and publish it through the reviewed staging and deployment gates. Never deploy
expired bytes as a working feed. Verify the canonical apex and active version,
record the provider-host result separately, then dispatch the next renewal.
Never discard the checkpoint, lower the
recorded generation or replay an older website to make the job pass.

Missing/expired artifacts or deleted run history require operator investigation
and a reviewed recovery of the highest authenticated generation; they do not allow
bootstrap from whatever the live server currently returns. Rerunning an older run
after a newer run is also refused: use a fresh dispatch after resolving the cause.
Preserve failed logs and receipts. If evidence cannot establish the highest
issued generation, stop publication until that uncertainty is resolved.

Rotate the deployment token with equivalent Worker scope, update the GitHub
secret, verify a fresh dispatch and revoke the superseded token. Rotate the
signing key only through an explicit consumer trust rollout; never replace the
key behind its existing ID. Restrict write access to the default branch and
workflow because reviewed publisher code can use these credentials.

For a local preflight without deployment:

```sh
node scripts/release/ninja-renew.mjs prepare --private-key /absolute/protected/key.pem --output /absolute/fresh-renewal --checkpoint /absolute/retained/catalog.json
node scripts/release/ninja-renew.mjs verify --output /absolute/fresh-renewal
```

The checkpoint is mandatory after the initial, independently pinned generation 1.
`live --output /absolute/fresh-renewal` verifies the exact staged deployment after
publication in one strict attempt. Add `--wait-for-assets` only for the bounded
post-activation check described above; each invocation creates its own
`live-verification-*/events.jsonl` under that output directory. Keep signing and
private provider outputs outside Git and the public asset tree. Application
rollback and publisher feed recovery are separate operations.

## Alpha.4 promotion through the existing publication lock

The manual `promote_alpha4` input defaults to false and uses the same
`production-ninja-renew` concurrency group, authenticated run history and
`Persist signed renewal checkpoint` step as ordinary renewal. Promotion requires
reviewed source pins for the exact alpha.4 package commit and all three immutable
release files. The helper accepts only explicit local paths; repository identity,
tag, asset names, download origins and public destination are fixed in source.
It downloads the pinned draft or published prerelease through the GitHub API,
validates every byte and clean source identity, then delegates to normal signed
staging. An unavailable draft is a refusal, not a reason to broaden token scope.
The workflow retains read-only GitHub permissions.

The signed catalog retains the exact alpha.2/alpha.3 entries with manager contract
1 and adds alpha.4 with manager contract 2. Verified new tools support both
families; immutable alpha.3 tools report `migration_required` before downloading
the renamed candidate. This is a tools bootstrap with the same registration,
configuration, trust pin, store and checkpoint. No trust reset is part of it.

Promotion may extend the approved legacy inventory once. Ordinary renewal
requires the complete pinned inventory and cannot silently omit alpha.4. A
failed promotion remains subject to the same retained high-water checkpoint and
operator-recovery rules above. Publication must follow exact artifact acceptance
and remote CI; customer application acceptance remains separate.
