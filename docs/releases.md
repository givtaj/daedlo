# Install, verify and prepare a driver release

## Selected preview: 0.1.1-rc.4

This release adds [portable tools](update-client.md) and fixes CLI shutdown report
ordering and retry of failed owned-resource cleanup. The
[release page](https://github.com/givtaj/browser-driver/releases/tag/v0.1.1-rc.4)
and its `VERIFICATION.md` asset record publication, the final source commit,
CI run and the exact artifact hashes. This source document alone does not assert
that publication has completed. Local rc.3 candidates are superseded; their bytes
are not republished under a reused version.

The repository remains private. The installing person or agent needs GitHub read
access to `givtaj/browser-driver` and an authenticated `gh` CLI. Granting that
access is a repository-owner action; possession of these commands does not grant
access. No token belongs in the customer repository, package, report or launcher.
An authorized maintainer can instead deliver the exact release assets and trusted
receipt through an approved private channel. No public registry, login portal or
subscription service is required for this installation.

### Download

Use a new directory outside the application. Download the portable tools and
receipt first; a complete source checkout is unnecessary:

```sh
mkdir browser-driver-download
cd browser-driver-download
gh release download v0.1.1-rc.4 --repo givtaj/browser-driver --dir tools-assets \
  --pattern browser-driver-tools-0.1.1-rc.4.tgz \
  --pattern TOOLS_SHA256SUMS --pattern TOOLS_VERIFICATION.json --pattern VERIFICATION.md
```

Before executing anything from the archive, compare its SHA-256 with the tools
archive digest in the trusted release receipt. `TOOLS_SHA256SUMS` is also an
integrity inventory; it is not independent proof of who supplied the bytes.
Install the verified archive into an owned tools directory:

```sh
mkdir tools
cd tools
npm install --offline --ignore-scripts --no-audit --no-fund ../tools-assets/browser-driver-tools-0.1.1-rc.4.tgz
node node_modules/@browser-driver/release-tools/lib/consumer-cli.mjs --help
node node_modules/@browser-driver/release-tools/lib/consumer-cli.mjs download --repo givtaj/browser-driver --version 0.1.1-rc.4 --out /absolute/path/new-bundle --sha256 TRUSTED_MANIFEST_DIGEST
node node_modules/@browser-driver/release-tools/lib/consumer-cli.mjs verify --bundle /absolute/path/new-bundle --sha256 TRUSTED_MANIFEST_DIGEST
```

The agent resolves the absolute output path and replaces `TRUSTED_MANIFEST_DIGEST`
with the manifest digest from the trusted release receipt. The tools package has
no npm dependencies or install scripts. Node 22+ is required; runtime verification
also checks Rust 1.96.0+. Install the runtime's pinned Playwright Chromium before
launch. Docker is only needed when the application's chosen fixture requires it.

### Mount in a codebase

Here, mounting means adding a separate QA integration beside an application's
existing code. It does not mean changing the application's language or adding the
driver to its production dependencies. An example layout is:

```text
customer-app/                           before: existing app and its lockfiles
customer-app/                           after: same app, plus scoped integration
└── qa/browser-driver/
    ├── package.json, package-lock.json  private ESM package; exact runtime archive
    ├── node_modules/                   ignored local runtime and Playwright
    ├── vendor/                         matching verified engine crate
    ├── engine/                         customer Rust model and Cargo.lock
    ├── adapter.mjs, project.mjs         customer observations and guarded actions
    ├── flows/                          agreed stories and acceptance checks
    └── target/, reports/               ignored build output and private evidence
```

The folder name is a convention, not a required product path. Keep verified
archives in a durable location referenced by the integration lockfile. Copy the
complete bundled `skills/browser-driver` folder to an unused project skill path
for Codex (`.agents/skills/browser-driver`) or Claude Code
(`.claude/skills/browser-driver`), preserving any existing customization. The
portable package includes the contracts, onboarding guide and skill; an additional
standalone skill archive is available for hosts that need only the instructions.

Give the agent this request, with actual paths:

> Read the installed browser-driver skill and packaged contracts. Mount this exact
> verified release in a separate QA integration in this codebase. Preserve the
> existing app and lockfiles. Reuse accepted states and flows; agree the first
> missing flow before authoring its Rust model and guarded adapter. Launch the
> local viewer, verify that flow and a relevant failure path, and record the exact
> package pins, evidence and cleanup ownership.

The skill's [installation reference](../skills/browser-driver/references/onboarding.md)
provides the exact npm/Cargo integration and public project-module contract. Once
the agent has supplied the app-specific model, adapter and project module, launch
from the customer integration with:

```sh
./node_modules/.bin/browser-driver --project ./project.mjs --report ./reports/session.json
```

Create the ignored reports directory first. The default is a new owned headless
Chromium with a visible local viewer; add `--headed` for a native browser window.
No application commands or sign-in execute automatically at startup. Ctrl+C waits
for the active run and its cleanup before exporting the final report. If owned
cleanup fails, the process retains the handles and accepts another Ctrl+C or
SIGTERM to retry cleanup; it does not replay application actions.

Downloading and installing packages does not discover an application's business
states or prove its flows. Rust, Go, PHP, JS/TS and other web applications can keep
their own implementation language; the QA model is a separate Rust binary and the
adapter uses the browser and approved application interfaces. A particular
framework is supported only to the extent its actual integration has been tested.

### Updates without replacing the working integration

Daily development does not require daily customer migration. Give each shipped
change a new immutable version, run the existing checks and exact-package browser
acceptance, then publish the selected bytes and trusted receipt. An agent can run
`check --repo givtaj/browser-driver --current ACCEPTED_VERSION --channel preview`
with the portable CLI. It then explicitly downloads a chosen version into fresh
output. The application keeps its accepted runtime, crate, model, adapter, locks
and launcher while that candidate is tested separately.

Protocol/toolchain checks are necessary but cannot guarantee customer behavior.
Promote the whole tested combination and retain the prior combination for rollback;
archive-store rollback alone does not change an app. The stable channel may have
no release. Failed/incomplete discovery is not evidence that an installation is
current. No background updater or additional CI job is installed.

## Earlier rc.2 installation using a source checkout

The earlier preview is `0.1.1-rc.2`, a developer preview of the agent-installed
Rust/Node QA workflow. An agent installs the tools and helps the team author a
customer model, adapter and verified flow. This is not a zero-configuration app
crawler. The [release notes](https://github.com/givtaj/browser-driver/blob/v0.1.1-rc.2/docs/release-notes/0.1.1-rc.2.md) describe its scope; the
GitHub release page and attached `VERIFICATION.md` hold the final publication,
CI and artifact receipt. Downloads require access to the repository, whose
visibility is unchanged by a release.

A release bundle pairs the Node runtime and shared Rust crate at one exact
version. The portable skill is a separate asset. Neither installs itself into an
application. Roots continues using its existing embedded driver; adopting this
package is a separate integration change. No npm or crates.io publication is
included in this release.

### Earlier checkout-based installation

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
version command for the current `0.1.1-rc.4`. Version reuse, build-metadata aliases,
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
npm run release -- build --out artifacts/releases/selected
npm run release -- verify --bundle artifacts/releases/selected
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
npm run test:release:e2e -- artifacts/releases/selected artifacts/package-check DIGEST
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
[actual verification](https://github.com/givtaj/browser-driver/blob/v0.1.1-rc.4/docs/verification.md) for current coverage and remaining limits.

## Developer-preview limits

Customers author their own Rust model and JavaScript adapter. Agreement on a state
diagram does not automatically generate or prove executable browser coverage.
Windows, complete onboarding of an unfamiliar application, and full Claude Code
skill discovery and onboarding have not been tested. Existing Roots results cover
specific isolated integrations and recorded versions; the release does not migrate
Roots' current embedded driver or establish every legacy recipe as supported.
