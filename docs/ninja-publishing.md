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

## Renew before expiry

Catalogs expire no later than seven days after issue. Renewal signs fresh metadata
with a strictly greater generation and keeps existing release entries unchanged.
It does not rebuild or replace a ZIP, metadata file, checksum file or public key.
The initial catalog uses generation 1. Later configurations must supply
`previousCatalogPath` containing the previous authenticated public catalog and a
greater generation. Preserve that previous catalog with the release record.

Read the live catalog and current deployment first. Use the same reviewed signer,
key, exact release directories and website staging checks, then deploy and verify
the new catalog and expiry. Keep the prior website version for operational recovery,
but do not roll the feed back to an older generation: clients correctly reject
replay. If an application release must be withdrawn, handle that as a reviewed
publisher-policy change rather than mutating an immutable download.

An expired catalog blocks new checks/downloads. Accepted local installations and
local whole-installation rollback continue to work. Renewal is an operator action;
no background installation, monitoring or renewal schedule is installed by these
instructions. Production renewal custody and the actual expiry belong in the
release handoff.
