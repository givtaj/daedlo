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
local metadata files and build outputs. Do not commit the downloadable archives.

After the releases have been published, retrieve all three files from each
immutable versioned download directory. These commands write only to the ignored
local artifact cache. For an unpublished preflight, use the release owner's
verified local three-file directories instead of downloading them.

```sh
for daedlo_website_version in 0.1.2-rc.1 0.1.4-alpha.2; do
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
```

Stage the historical release first and the current alpha second. The second step
renders the current installation page. Validate and review only after both steps.
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

Run these from the repository root after staging both releases:

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
and rc.1 byte. Static acceptance checks all local page links and curated archive
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
