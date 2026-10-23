# Daedlo public website

Static product introduction, Roots origin story, assisted alpha installation,
integration guide, privacy/contact page and recorded real-application demo.
The supported alpha path is macOS arm64 with Codex and one existing application
flow. The dated verification in the current release metadata records its exact
source, package checks, customer acceptance and limitations.

Only `public/` is deployable. Scripts, tests, this README and hosting configuration
stay outside the asset root. There is no framework, third-party font, analytics,
account, data submission or live browser connection. The two curated screenshots
and evidence summary preserve the Architecture Studio recording from 11 October
2026 and the public `0.1.2-rc.1` kit. The separate workflow sketches are labelled
as illustrations. Private traces and customer source must never enter this tree.

## Reproduce the release website

Git contains the approved source, including local text, styles, scripts, the mark,
curated historical screenshots, historical public-file hashes and exact asset
allowlists. It excludes downloaded release directories, generated `install.html`,
local metadata files and build outputs. The signed feed, public-key copy and
rendered update page are generated release inputs and are also ignored. Do not commit the downloadable archives.

After the releases have been published, retrieve all three files from each
immutable versioned download directory. These commands write only to the ignored
local artifact cache. For an unpublished preflight, use the release owner's
verified local three-file directories instead of downloading them.

```sh
for daedlo_website_version in 0.1.2-rc.1 0.1.4-alpha.2 0.1.4-alpha.3; do
  mkdir -p "artifacts/website-inputs/$daedlo_website_version"
  for daedlo_website_file in "daedlo-$daedlo_website_version.zip" SHA256SUMS release.json; do
    curl --fail --show-error --location \
      "https://daedlo.com/downloads/$daedlo_website_version/$daedlo_website_file" \
      --output "artifacts/website-inputs/$daedlo_website_version/$daedlo_website_file"
  done
done

node website/scripts/stage-release.mjs --website-root website \
  --release-dir artifacts/website-inputs/0.1.2-rc.1 \
  --expected-version 0.1.2-rc.1
node website/scripts/stage-release.mjs --website-root website \
  --release-dir artifacts/website-inputs/0.1.4-alpha.2 \
  --expected-version 0.1.4-alpha.2
node website/scripts/stage-release.mjs --website-root website \
  --release-dir artifacts/website-inputs/0.1.4-alpha.3 \
  --expected-version 0.1.4-alpha.3

# Before publication, use the release owner's signed catalog instead.
curl --fail --show-error --proto '=https' \
  https://daedlo.com/updates/preview.json \
  --output artifacts/website-inputs/preview.json
node website/scripts/stage-updates.mjs --website-root website \
  --catalog artifacts/website-inputs/preview.json \
  --public-key docs/update-trust/daedlo-release-2026-10.pem \
  --expected-version 0.1.4-alpha.3
```

Stage rc.1 and alpha.2 first, then alpha.3, then the signed preview feed. The final
release step renders the current installation page. Feed staging renders
`updates.html` with the exact public key pin and catalog expiry. Validate and
review only after all four steps. The current ZIP identity comes from the release
owner’s frozen metadata; do not rebuild or modify historical releases.
The stager checks the exact three-file inventory, archive size and digest, version
and ZIP allowlist. It refuses to replace a staged immutable version with changed
bytes. A new release or metadata change needs a fresh staging tree.

Expected archive identities:

| Version | ZIP SHA-256 |
| --- | --- |
| `0.1.2-rc.1` | `da5ce1387eb147a3fb3a7225decd3e51e9fc355a505583ccc20cb2a9bf33963b` |
| `0.1.4-alpha.2` | `b9555b6b237ac437f62b984f6994e3ef12ba4e8f95b730f52c9aa9313a375ee1` |

The alpha `release.json` must include its final sanitized `verification` record.
Packaging-only metadata cannot satisfy the website release assertions. Both the
archive and this metadata are release inputs; rebuilding a new archive from a
source checkout does not reproduce the frozen published bytes.

## Verify and preview

Run these from the repository root after staging every release and the signed feed:

```sh
node --test website/tests/*.test.mjs
node website/tests/acceptance.mjs
node --check website/public/workflow.js
node --check website/scripts/serve.mjs
node website/scripts/manifest.mjs > artifacts/website-manifest.json
node website/scripts/serve.mjs
```

Tests compare the rendered tools-install command to `START_HERE.md` inside the
exact staged ZIP, enforce the explicit npm prefix and workspace boundary, check
the dated release claims against metadata, and preserve every historical demo
and rc.1/alpha.2 byte. Static acceptance checks all local page links and curated archive
identities. Inspect the actual local preview at desktop and narrow widths before
calling presentation ready. The preview prints its owned loopback URL and uses an
ephemeral port unless `DAEDLO_PREVIEW_PORT` is set. Stop only that owned process.

Edit `templates/install.html` and rerun staging to render the page; never edit the
generated page directly. Keep every new public asset explicitly listed in both
`scripts/manifest.mjs` and `public/.assetsignore`. `_headers` and `.assetsignore`
are deployment control files, not downloadable content. The strict manifest also
includes `wrangler.jsonc`; freeze its bytes together with the public assets.

`wrangler.jsonc` is the retained Cloudflare configuration for `daedlo.com`.
Provider preflight, deployment, rollback identity and live download readback are
separate release-owner operations. A successful local preview is not deployment.


## Signed preview feed

The production feed is `https://daedlo.com/updates/preview.json`, publisher
`daedlo`, key ID `daedlo-release-2026-10`. The public PEM's exact SHA-256 is
`df84f7d60ed2af949d394e338070ef66ab4debabf911ffd6c7b35bebe6ba4297`.
The website pin is checked against `docs/update-trust/production.json` and its
public PEM. This staging code accepts only a public SPKI PEM; it never reads a
private signing key, creates signatures or fetches replacement trust.

`stage-updates.mjs` verifies Ed25519 signatures, expiry, catalog generations,
exact production-origin URLs and every catalog entry's three already-staged
release files. Alpha.2 must remain in the catalog, and later catalog staging
must preserve all existing entries. Changed immutable keys/releases, extra
public files, private-key inputs and missing exact asset allowlist rules fail
before replacing the feed or page. The website manifest admits only
`updates/preview.json` and `updates/keys/daedlo-release-2026-10.pem` under that tree.

The feed has validity of at most seven days. Renewal is a manual publisher
operation with a strictly increasing generation; no automation is installed.
Before expiry, obtain a newly signed catalog, rerun staging and all website
checks, freeze the manifest, then have the release owner deploy and read back the
exact bytes. An expired feed blocks new checks/downloads; installed sessions and
local rollback remain available subject to their integrity and safe-boundary
checks. Never bypass expiry or change the publisher pin to recover.

Run the repository's website scripts with `--website-root` to target an isolated
release tree. The scripts reuse the repository's signature verifier in
`scripts/release/ninja-catalog.mjs`; copying only the website folder does not copy
that build-time dependency. To test frozen assets with repository-native imports:

```sh
DAEDLO_WEBSITE_ROOT=/absolute/path/to/frozen/website node --test website/tests/*.test.mjs
node website/tests/acceptance.mjs --website-root /absolute/path/to/frozen/website
```

The override changes asset/template reads only. Test fixtures, trusted baseline
hashes and executable imports remain in the repository. No verifier code is
deployed as a browser asset.

`_headers` forces feed revalidation and marks versioned downloads/public keys
immutable. Global CSP and `nosniff` remain enabled. Local tests check these rules;
actual Cloudflare response headers, signature verification, immutable alpha.2
bytes and the published upgrade/rollback journey require separate live readback.
The local preview is not that production proof.
