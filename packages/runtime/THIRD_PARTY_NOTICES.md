# Daedlo origins and third-party notices

## Public core from 0.1.4-alpha.4

Copyright (c) 2026 Aidin Givtaj.

Daedlo's public core is licensed under the Apache License, Version 2.0, from
0.1.4-alpha.4. This covers the shared Rust engine, Node runtime/viewer, portable
release tools and distributed agent skill. Read the complete text in `LICENSE`
and `licenses/Apache-2.0.txt`.

The Apache-2.0 package declaration is the primary license for this distribution;
it does not remove required notices or previously granted permissions. Preserved
MIT material remains accompanied by its original grant in `licenses/MIT-legacy.txt`.
Third-party dependencies retain their own licenses. Customer application code,
models, flows, adapters and data remain separate and are not relicensed by Daedlo.

Published 0.1.4-alpha.3 and earlier artifacts keep their original bytes and terms.
In alpha.3, new Daedlo additions were MIT and Roots-derived portions Apache-2.0,
with the combined declaration `MIT AND Apache-2.0`. This transition does not
withdraw those permissions or relabel an earlier release.

## Roots-derived work

Browser Driver was developed from the Roots browser-driver code and design.
Recorded source baselines are Roots commits
`d4008e39aeaa137bb54ff48ca2d11748083a971a` and
`96275b53145e00e282d7c6a6f80faf3a5ad6df10`. Both carry the Apache License 2.0 in
their root `LICENSE`; that exact text is retained in `licenses/Apache-2.0.txt`.
The pinned trees contain no separate upstream NOTICE file, and the reviewed
driver source does not identify an additional copyright holder in file headers.
The license's unfilled example appendix is preserved verbatim, not treated as an
ownership statement.

The Roots runtime paths were `tools/live-qa/src/` at the first baseline and
`tools/browser-driver/runtime/src/` at the second. Its Rust model/protocol paths
were `tools/qa-driver/src/` and `tools/browser-driver/engine/src/` respectively.
Browser Driver generalizes the runtime/viewer into `packages/runtime/src/` and the
shared typed engine into `crates/browser-driver-engine/src/`. Changes include
application-independent contracts, guarded execution, explicit ownership and
cleanup, protocol validation, outcome/effect separation, and a generic viewer.
Origin/change notices in the source identify this adaptation conservatively;
they do not assert that every line was copied. The Roots application, its customer
models and its historical evidence are not included in the portable runtime/tools
kit.

Apache-2.0 upstream portions retain their applicable license, patent terms,
attribution requirements and permissions. The retained MIT grant does not
supersede these obligations. Attribution is not endorsement and does not grant
rights to a third party's trademarks.

## Earlier Browser Driver MIT material

The Browser Driver source and release `0.1.1-rc.5` at commit
`71d91d3a05bc972a713b44ebd73399f3990dbf08` declared MIT, with the copyright notice
`Copyright (c) 2026 Aidin Givtaj`. That complete original notice and license are
retained verbatim in `licenses/MIT-legacy.txt`. Preserve those notices and the
applicable permissions for earlier legitimately received MIT material, including
retained material in this distribution and the MIT additions published through
0.1.4-alpha.3. This distribution includes the Roots Apache
license and origin/change notices alongside the preserved MIT notice.

## Dependencies installed separately

The portable archives declare dependencies; they do not vendor Playwright,
Chromium, npm dependencies or Cargo registry crates. Installed dependencies and
any later redistribution of them or compiled code remain subject to their own
licenses and notices. This preview grants no replacement license for those
components.

| Component in the reviewed lockfiles                                                                                                      | Declared license / notice location                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Playwright and playwright-core 1.65.0                                                                                                    | Apache-2.0; each installed package has `LICENSE`, `NOTICE` and `ThirdPartyNotices.txt` |
| block-buffer 0.10.4, cfg-if 1.0.5, cpufeatures 0.2.17, crypto-common 0.1.7, digest 0.10.7, itoa 1.0.18, libc 0.2.189                     | MIT OR Apache-2.0                                                                      |
| proc-macro2 1.0.107, quote 1.0.47, serde / serde_core / serde_derive 1.0.229, serde_json 1.0.151, sha2 0.10.9, syn 3.0.6, typenum 1.20.1 | MIT OR Apache-2.0                                                                      |
| generic-array 0.14.7, zmij 1.0.23                                                                                                        | MIT                                                                                    |
| memchr 2.8.3                                                                                                                             | Unlicense OR MIT                                                                       |
| unicode-ident 1.0.26                                                                                                                     | (MIT OR Apache-2.0) AND Unicode-3.0                                                    |
| version_check 0.9.5                                                                                                                      | `MIT/Apache-2.0` as declared by its package                                            |

These are declared-license facts from the reviewed npm lockfile and offline Cargo
metadata, not a complete legal clearance or a substitute for the actual upstream
notices. Preserve the original dependency directories and notices. Before
redistributing installed dependencies, browser binaries or compiled customer
engines, review their exact resolved packages and include every applicable notice,
including Unicode and bundled Playwright/browser component notices. The portable
source archives alone do not perform that future redistribution.

Development-only tooling (`@types/node`, Prettier, TypeScript and undici-types)
is not shipped in the portable kit; its own upstream terms still apply when used.

## Authoritative license references

- [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0), especially
  sections 2–4 and 6: upstream permissions, changed-file notices, attribution and
  trademark limits.
- [MIT license](https://opensource.org/license/mit): permission and notice text
  accompanying earlier Browser Driver material.

Dependency license inventory recorded on 2026-10-06; release packaging prepared
on 2026-10-09. Apache-2.0 public-core transition prepared for 0.1.4-alpha.4 on
2026-10-23. Checksums establish exact bytes, not endorsement or ownership.
