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

## Published alpha — 21 October 2026

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
