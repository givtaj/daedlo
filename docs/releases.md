# Prepare, verify and select a driver release

The current candidate is `0.1.1-rc.1`. A release bundle pairs the Node runtime and
shared Rust crate at one exact version. A dedicated store can select a verified
bundle for a future, explicitly configured consumer. It does not install packages
into an application or change application launchers. Roots continues using its
existing embedded driver; adopting this package is a separate integration change.

## Prepare a version

Use Node 22+ and the repository's Rust 1.96.0 toolchain, with the locked Node and
Cargo dependencies available. The version command advances all nine package,
workspace, lockfile and isolated-consumer pins together:

```bash
npm run release -- version --next 0.1.1-rc.2
```

Choose a strictly newer semantic version. Version reuse, build-metadata aliases,
misaligned existing pins and symlinks are refused. The command does not install
dependencies, run hooks, commit, tag or publish. Review and commit the source before
making a distributable bundle. Once shared, never assign different bytes to that
version. A local store enforces identities it has seen; it is not a global registry
and cannot detect conflicting versions shared outside it.

Version writes are atomic per file, with restoration on a caught failure. They
are not a crash-proof transaction across all files. Review Git changes if the
process is killed; the next invocation refuses inconsistent pins.

## Build and verify

```bash
npm ci
cargo build --workspace --locked
mkdir -p artifacts/releases
npm run release -- build --out artifacts/releases/rc1
npm run release -- verify --bundle artifacts/releases/rc1
```

The output directory must be fresh and its parent must exist. In-repository output
must be ignored by Git. The builder snapshots tracked and non-ignored untracked
source, refuses source symlinks, runs `npm pack --ignore-scripts --offline` and
`cargo package --locked --offline` with Cargo package verification enabled, then
checks that the source has not changed. It uses separate temporary build output.
Dependencies must already be cached; the builder does not fetch them.

A bundle contains exactly these distributable files:

- `browser-driver-runtime-VERSION.tgz`
- `browser-driver-engine-VERSION.crate`
- `manifest.json`, with source commit, source-tree digest, dirty flag, package
  versions, compatibility requirements, artifact sizes and SHA-256 digests
- `SHA256SUMS`, including the manifest digest

Building the same source with the same packaging toolchain is tested for byte
reproducibility. Cross-platform or different npm/Cargo versions are not promised
to produce identical archives. The manifest records source identity, not a signed
build attestation. A checksum detects changed bytes only when the expected digest
comes from a trusted source. Verification without `--sha256` checks internal
integrity and reports `trustedDigestProvided: false`.

`--allow-dirty` is available for explicit local experiments. Its receipt remains
marked dirty and store operations refuse it unless separately opted in. Never
present a dirty experiment as a published release.

## CI and installed-package acceptance

CI runs on pushes, pull requests and manual dispatches, on Ubuntu with Node 22 and
24. It checks source/types/format, Rust contracts and lints, runtime and release
regressions, the Roots archive workbench, and the eight independent notebook browser
scenario groups. It then builds from a clean checkout, installs the exact runtime
tarball into a temporary consumer, compiles that consumer against the extracted
crate, verifies every installed runtime file, and runs all eight browser groups
again through ordinary public imports. This fixture does not need Roots or Docker.

To reproduce the packaged run locally, install Chromium first and use the manifest
digest printed by `build` as `DIGEST` below:

```bash
npx playwright install chromium
npm run test:release:e2e -- artifacts/releases/rc1 artifacts/package-check DIGEST
```

The evidence directory must be fresh. The harness owns and cleans its temporary
installation, browser and server. Evidence stays ignored. CI uploads only the
four bundle files for 14 days after successful acceptance; it does not create a
GitHub Release or publish to npm/crates.io. Select the exact workflow run and Node
matrix artifact whose manifest digest you intend to trust.

## Explicit update and rollback

Choose a new, dedicated store outside any application dependency directory. Its
parent must exist, and the path and ancestors must not be symlinks. On macOS use
the physical path, such as `/private/tmp/driver-store`, rather than `/tmp`.
Use a durable directory if selections must survive temporary-file cleanup.

```bash
npm run release -- update --store /absolute/driver-store --bundle /absolute/bundle --sha256 DIGEST
npm run release -- status --store /absolute/driver-store
npm run release -- rollback --store /absolute/driver-store
```

`update` verifies the trusted manifest digest, artifact bytes, protocol 1, Node
22+ and Rust 1.96.0+ before copying and atomically selecting the bundle. It refuses
nonempty unowned stores, symlinks, concurrent mutations and different bytes under
an existing version. A failed operation leaves the current selection in place;
version history remains even when an artifact directory goes missing.

`rollback` verifies the previous target and switches the selection atomically.
It can recover from a damaged current bundle when the previous bundle is intact.
Status reports integrity separately for both pins. Keep the ownership marker,
state, history and retained artifacts together. Do not manually edit them. A stale
mutation lock after a killed process requires investigation before removal; the
tool does not break locks or delete stored releases automatically.

Selection changes only the store's receipt. A consumer must deliberately read
the selected `bundlePath`, install the exact tarball, build its own application
model against the exact crate, and verify its own acceptance scenarios. Protocol
and toolchain compatibility alone do not prove adapter or business-flow compatibility.

## Roots adoption remains a later gate

Before any everyday Roots update, preserve the working dependency combination,
prepare an isolated pinned application snapshot, run the agreed complete customer
suite against the exact bundle and adapter, prove candidate failure leaves an
actively running normal Roots stack usable, and review launcher/pin changes with
rollback. The release commands do not perform that migration or database changes.
See [the integration workflow](development-workflow.md) and
[actual verification](verification.md) for current coverage and remaining limits.
