# Install, verify and prepare a driver release

The current candidate is `0.1.1-rc.2`, a developer preview of the agent-installed
Rust/Node QA workflow. An agent installs the tools and helps the team author a
customer model, adapter and verified flow. This is not a zero-configuration app
crawler. The [release notes](release-notes/0.1.1-rc.2.md) describe its scope; the
GitHub release page and attached `VERIFICATION.md` hold the final publication,
CI and artifact receipt. Downloads require access to the repository, whose
visibility is unchanged by a release.

A release bundle pairs the Node runtime and shared Rust crate at one exact
version. The portable skill is a separate asset. Neither installs itself into an
application. Roots continues using its existing embedded driver; adopting this
package is a separate integration change. No npm or crates.io publication is
included in this release.

## Install the selected preview with an agent

Use Node 22+, Rust/Cargo 1.96.0+ and the selected runtime's matching Playwright
Chromium. The repository pins Rust 1.96.0 and the runtime pins Playwright 1.62.1.
Docker is needed only by customer fixtures that require it. See the
[onboarding guide](agent-onboarding.md) for environment, browser ownership and
application readiness requirements.

Acquire a source checkout at the selected tag. The release CLI, examples and
onboarding documentation live in this checkout; they are **not in the four-file
runtime/engine bundle**. Record its full commit and compare it with the release
receipt and `manifest.json`'s `source.commit` before using it.

```bash
git clone --branch v0.1.1-rc.2 --single-branch https://github.com/givtaj/browser-driver.git browser-driver-source
cd browser-driver-source
git switch --detach v0.1.1-rc.2
git rev-parse HEAD
mkdir -p artifacts/releases
gh release download v0.1.1-rc.2 --repo givtaj/browser-driver --dir artifacts/releases/0.1.1-rc.2 \
  --pattern browser-driver-runtime-0.1.1-rc.2.tgz \
  --pattern browser-driver-engine-0.1.1-rc.2.crate \
  --pattern manifest.json --pattern SHA256SUMS
node scripts/release/cli.mjs verify --bundle artifacts/releases/0.1.1-rc.2 --sha256 TRUSTED_MANIFEST_SHA256
```

The GitHub CLI is only a download option; the same named files are available on
the [selected release page](https://github.com/givtaj/browser-driver/releases/tag/v0.1.1-rc.2).
Use a fresh download directory. Replace `TRUSTED_MANIFEST_SHA256` with the digest
from the selected trusted release/CI receipt, not a digest merely claimed by the
downloaded bundle. Successful verification checks exact artifact bytes and local
Node/Rust/protocol compatibility; it does not prove a customer's flows work.

The separate `VERIFICATION.md` asset contains the final source and artifact receipt.
It is not part of the four-file bundle or its manifest contract.

The release also supplies `browser-driver-agent-skill-0.1.1-rc.2.tar.gz` and
`AGENT_SKILL_SHA256SUMS`. Download them separately from the canonical bundle:

```bash
mkdir -p artifacts/agent-skill/0.1.1-rc.2
gh release download v0.1.1-rc.2 --repo givtaj/browser-driver --dir artifacts/agent-skill/0.1.1-rc.2 \
  --pattern browser-driver-agent-skill-0.1.1-rc.2.tar.gz --pattern AGENT_SKILL_SHA256SUMS
```

Compare the skill archive's SHA-256 with the trusted release receipt, and check
`AGENT_SKILL_SHA256SUMS` from its download directory using
`shasum -a 256 -c AGENT_SKILL_SHA256SUMS` on macOS or
`sha256sum -c AGENT_SKILL_SHA256SUMS` on Linux. Extract into a fresh owned directory.
Its complete layout is:

```text
browser-driver/
├── SKILL.md
├── LICENSE
├── references/
│   ├── onboarding.md
│   └── model-and-flows.md
└── assets/
    └── flow-spec.md
```

Copy that complete folder into the customer's `.agents/skills/browser-driver/`
for Codex or `.claude/skills/browser-driver/` for Claude Code. Preserve any existing
customizations. The identical skill source is also under `skills/browser-driver/`
in the tagged checkout and GitHub tag source archives. The skill alone does not
include the runtime, shared crate, release CLI or a ready-made customer engine.
The [host setup instructions](agent-onboarding.md#install-the-instructions-for-codex-or-claude-code)
describe complete-folder copying and explicit invocation; end-to-end discovery
in both agent hosts has not yet been established.

Ask the agent to read the installed skill and the selected checkout, agree one
useful flow, then perform the scoped installation and integration. In the
customer's separate ESM integration package, install the verified tarball exactly:

```bash
npm --prefix "$driver_integration" install --save-exact --ignore-scripts --no-audit --no-fund "$runtime_tarball"
node "$driver_integration/node_modules/playwright/cli.js" install chromium
```

The agent resolves these variables to the actual integration directory and
verified runtime archive. Extract the matching verified crate into a stable owned
vendor directory and compile the customer's `ApplicationModel` against it. Retain
both archives, the source commit and customer lockfiles. Follow the skill's
[installation reference](../skills/browser-driver/references/onboarding.md) for
the Cargo dependency, project module, adapter, launch and real-flow verification.
Authored flows can then run without an agent or model API key. The live viewer is
local; this preview does not provide a hosted QA service.

## Prepare a version

Use Node 22+ and the repository's Rust 1.96.0 toolchain, with the locked Node and
Cargo dependencies available. The version command advances all nine package,
workspace, lockfile and isolated-consumer pins together:

```bash
npm run release -- version --next NEXT_VERSION
```

Replace `NEXT_VERSION` with a strictly newer semantic version; do not rerun the
version command for the current `0.1.1-rc.2`. Version reuse, build-metadata aliases,
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
npm run release -- build --out artifacts/releases/rc2
npm run release -- verify --bundle artifacts/releases/rc2
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

The standalone skill archive and its checksum inventory are separate release
assets. They do not change this bundle contract or become inputs to the release
store. GitHub's generated tag source archives include the repository, including
the skill and release CLI; they are a different artifact from the runtime tarball.

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
npm run test:release:e2e -- artifacts/releases/rc2 artifacts/package-check DIGEST
```

The evidence directory must be fresh. The harness owns and cleans its temporary
installation, browser and server. Evidence stays ignored. CI uploads only the
four bundle files for 14 days after successful acceptance; it does not create a
GitHub Release or publish to npm/crates.io. Select the exact workflow run and Node
matrix artifact whose manifest digest you intend to trust.

GitHub pre-release publication is a separate, authorized maintainer step. Publish
only the selected final commit's verified artifacts and record the exact CI run,
manifest digest and skill archive digest in the release receipt. Do not treat
an earlier candidate's browser pass as verification of new release bytes.

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

## Developer-preview limits

Customers author their own Rust model and JavaScript adapter. Agreement on a state
diagram does not automatically generate or prove executable browser coverage.
Windows, complete onboarding of an unfamiliar application, and full Claude Code
skill discovery and onboarding have not been tested. Existing Roots results cover
specific isolated integrations and recorded versions; the release does not migrate
Roots' current embedded driver or establish every legacy recipe as supported.
