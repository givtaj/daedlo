# Daedlo website hosting

The public static website uses the existing Cloudflare Worker `daedlo` at
[daedlo.com](https://daedlo.com). Its diagnostic origin is
[daedlo.givtaj.workers.dev](https://daedlo.givtaj.workers.dev).
`website/wrangler.jsonc` owns the asset root, custom domain and 404 behavior.
There are no Worker bindings, application APIs, accounts or databases in this
deployment. Do not copy customer source, traces or installation directories into
the public asset root.

The [website README](../website/README.md) describes source reconstruction from
the immutable public releases. Downloaded ZIPs and the generated installation
page stay outside Git. The exact allowlist is enforced by the manifest and
`public/.assetsignore`; `_headers` supplies the static security headers.

## Published alpha.3 and production feed — 23 October 2026

- Package source: `558366b6b4de9a158a9ad49bb7b45d3080d5497e`.
- Release: `0.1.4-alpha.3`; ZIP SHA-256
  `f569bc0c84bf1b7ac5efe59c610916ac8ab0d5bb3322ed520114d8880262b190`.
- Frozen website manifest SHA-256:
  `073ddd3adf5f98338a6eae3e6fe54b5c173eb5dc93b14f35933abe890802d99f`.
- Active Worker version: `7a4d7da7-6f12-45c9-9f73-52ad898c3c52`, 100% traffic.
- Deployment: `ad90348b-91d6-4711-b1d2-bb979cf15e4d`, created
  `2026-10-23T10:20:50.900528Z`.
- Previous static version: `8eebf633-35e6-498a-ae19-67f867c1b878`.

Wrangler 4.147.0 dry-run and deployment used the same frozen tree. The uploader
retried two transient asset failures, then completed successfully. Read-back on
both HTTPS origins confirmed **all 27 served files** match the frozen bytes;
nine private/unknown paths returned 404 on each origin. CSP and nosniff passed.
The catalog revalidates on each request; versioned downloads and public keys are
immutable. HTML paths use Cloudflare's observed same-origin 307 canonical redirects.
All 49 website tests and seven-page/three-archive acceptance passed; the actual
installation and update pages were inspected before deployment and the live
update page was inspected after deployment. Historical rc.1 and alpha.2 downloads
and the recorded demo retain their original bytes and claims.

Production feed: `https://daedlo.com/updates/preview.json`, generation **1**, raw
file SHA-256 `09fcadcbbf1a7bcdb6300d8489faf4949477997550e0a4993ab553c40e22e80e`.
It expires **2026-10-30T10:16:16.000Z**. The Ed25519 public key and independent
pins are in `docs/update-trust/`; the private key stays in the release owner's
protected local configuration directory. No off-device backup is verified.
[Manual renewal](ninja-publishing.md) requires a higher generation and unchanged
release entries. No renewal automation or background installation is configured.

The previous website version predates the feed. A static rollback would remove
update discovery; it is not a way to roll a catalog generation backwards. Accepted
local installations and their verified whole-installation rollback remain local.
Any feed recovery must preserve the highest authenticated generation.

Receipts and the exact staged tree remain under ignored
`artifacts/ninja-production/`. The versioned GitHub prerelease contains the same
three public release files. Actual published-feed application acceptance is
recorded separately in [verification](verification.md).

## Historical alpha.2 publication — 21 October 2026

- Package source: `044e76df10e90c68e9e3c7ff35e7c63a62354c60`.
- Release: `0.1.4-alpha.2`; exact ZIP SHA-256
  `b9555b6b237ac437f62b984f6994e3ef12ba4e8f95b730f52c9aa9313a375ee1`.
- Frozen website manifest SHA-256:
  `598790da91aefae48d5344c13581b3ef67c404b9d6b6b2ba5702e320e240aca6`.
- Active Worker version: `8eebf633-35e6-498a-ae19-67f867c1b878`, 100% traffic.
- Deployment: `e662f914-e4e4-4c4f-ae4f-31133da0c0e0`, observed at
  `2026-10-21T16:32:01Z`.
- Previous compatible static version: `2ace37b5-be89-49e6-b973-d5e51befe38a`.

Wrangler 4.147.0 dry-run and deployment passed against the same frozen tree.
Read-back on both HTTPS origins confirmed all 21 served assets match that tree,
including both immutable release downloads. Seven private/unknown paths return
404; CSP and `X-Content-Type-Options: nosniff` are present. The installation page
was visually inspected. Source reconstruction reproduces the frozen manifest
exactly; 31 website tests and six-page/two-archive acceptance passed.

## Subsequent releases

Stage a new immutable release in a fresh tree and retain existing downloads.
Run the website checks, inspect the actual presentation, freeze the manifest and
configuration, then dry-run the pinned deployment tooling. Deploy that exact tree
with an explicit configuration path. Record the uploaded version and separately
read back the active deployment/traffic and live asset bytes. A source push, local
preview or uploaded version alone does not prove production is serving it.

Before rollback, recheck the live configuration and previous version. The recorded
prior version is compatible with this static-only alpha deployment, which made no
database or binding changes; future changes can invalidate that assumption.
Rollback changes live traffic and must be within the requested release/recovery
scope. Read back traffic and public journeys again after recovery.

Private provider exports, logs and verification receipts remain in ignored
artifacts. Record public IDs and outcomes in this document; keep credentials and
provider account details out of Git.
