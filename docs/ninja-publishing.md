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
2. Run `node scripts/release/ninja-publisher.mjs sign --config /absolute/config.json`
   from the reviewed source checkout. This is a maintainer tool; it is deliberately
   excluded from the customer tools archive. The config supplies an explicit
   private key path, exact three-file kit directories, publisher, origin, channel,
   platform and interface contracts, generation, issue/expiry times, and a fresh
   output directory. Use notes URL `https://daedlo.com/updates.html`.
3. Stage the existing historical downloads and new kit into a separate website
   tree with `website/scripts/stage-release.mjs`. Stage the signed catalog and
   public PEM last with `website/scripts/stage-updates.mjs`. That stage independently
   checks the pinned key, signature and each signed asset against the staged bytes.
4. Run website checks and inspect the installation/update pages. Freeze the exact
   public manifest and configuration; dry-run and deploy that tree to the existing
   Daedlo Worker. Publish the same three-file kit as the versioned GitHub prerelease.
5. Verify the active deployment and every served asset on the apex/provider origins.
   Verify the downloaded catalog with the independently pinned public key. Run the
   published-mode application acceptance using the downloaded tools, real HTTPS
   discovery/downloads, and disposable data. Record upgrade, rejected candidate,
   rollback, byte integrity, reports and cleanup separately from source checks.

## Automatic renewal

The reviewed workflow is `.github/workflows/ninja-renew.yml`: daily at **04:23 UTC**
and manually through **Actions → Renew production Ninja Update catalog → Run
workflow** on the default branch. Activation and actual execution status are
recorded in [verification](verification.md); a committed schedule alone is not a
successful renewal. GitHub can delay scheduled jobs, so each catalog allows at
most seven days. Clients never ignore expiry.

The job restores its authenticated high-water checkpoint, downloads and verifies
all nine immutable files for rc.1, alpha.2 and alpha.3, and signs a new catalog
with a strictly greater generation. It retains existing release entries exactly.
It rebuilds only the static website from reviewed source; it does not rebuild a
release archive, change customer files, update the application or change its
interfaces. A future release requires a reviewed extension to the pinned asset
inventory in `scripts/release/ninja-renew.mjs`.

Before deployment, the job checks the complete staged site, seals its manifest,
and persists `catalog.json` plus its exact public digest receipt as the Actions
artifact `ninja-renewal-checkpoint-<attempt>`. Only those two public files are
uploaded to Actions. Artifacts are retained for 90 days. Failed runs and prior
attempts count toward the high-water mark; missing, expired, deleted or ambiguous
history stops publication. Do not delete the latest checkpoint or its run.

Wrangler uploads a version of the existing `daedlo` Worker, rechecks the unchanged
live baseline, then activates that exact version at 100%. It does not update
routes or domains. Verification checks the active version through Cloudflare's
API and compares all served assets, signature, cache rules, security headers and
private-path boundaries on the production apex origin. Check the workflow result and
its verified generation/expiry, not just a green upload step.

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
expired bytes as a working feed. Verify both origins and the active version
before dispatching the next renewal. Never discard the checkpoint, lower the
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
publication. Keep signing and private provider outputs outside Git and the public
asset tree. Application rollback and publisher feed recovery are separate operations.
