# Contributing to Daedlo

Daedlo is a local browser QA workbench with a Rust application model and a
Node/Playwright runtime. Useful contributions include reproducible bugs, clearer
instructions, accessible viewer controls, contract tests and small fixes.
The repository is preparing for community access; changing its visibility is a
separate owner decision. The commands below work for anyone with source access.

You can develop and test the shared product without Codex, another AI agent,
model API keys, Docker or access to the private Roots application. The independent
notebook supplies a disposable local application for this work. Roots remains the
source of the recorded product examples; its integration suites are optional and
require separately available customer source and fixtures.

## Set up a source checkout

Install Git, Node.js **22 or 24** with npm, and Rust through rustup. Rust builds
also need your host's native compiler/linker tools (for example, Xcode Command
Line Tools on macOS or the C build toolchain on Linux). The repository
pins **Rust 1.96.0** in [rust-toolchain.toml](rust-toolchain.toml); keep that pin
rather than changing your other projects' toolchains. npm installs the locked
Playwright version. Its matching Chromium is a separate download.

```sh
git clone https://github.com/givtaj/daedlo.git
cd daedlo
npm ci
rustup show active-toolchain
cargo build --workspace --locked
npx playwright install chromium
```

On Linux, install Chromium's system libraries with
`npx playwright install --with-deps chromium` if they are missing; that command may
need administrator privileges. Use a supported Linux or macOS development host.
The CI matrix runs Ubuntu with Node 22 and 24. That coverage is distinct from the
published assisted macOS arm64 customer-onboarding claim. Windows development
and customer onboarding are not yet verified.

Run the independent fixture to inspect a visible browser flow:

```sh
npm run demo:notebook
```

Open the loopback viewer URL printed by the command. Edit, save or discard a note,
then use Ctrl+C once in the terminal and wait for owned-resource cleanup. The
fixture uses disposable in-memory data. See its [README](examples/notebook/README.md)
for behavior and limits. `npm run demo` instead opens the recorded Roots archive;
it does not start a live Roots application.

## Find the right code

| Path | Responsibility |
| --- | --- |
| `crates/daedlo-engine/` | Shared Rust model contract and JSON Lines protocol |
| `packages/runtime/src/` | Node session, guarded actions, lifecycle, CLI and viewer |
| `packages/runtime/tests/` | Runtime contracts and focused browser checks |
| `examples/notebook/`, `examples/notebook-engine/` | Independent browser fixture and typed customer model |
| `tests/`, `scripts/release/` | Source acceptance, packaging and managed-update checks |
| `skills/daedlo/` | Optional agent onboarding instructions and references |
| `examples/roots/archive/` | Sanitized historical product evidence |
| `integrations/` | Customer-owned integration examples with separate prerequisites |
| `website/` | Website source and release-download presentation |

Read [contracts](docs/contracts.md), [architecture](docs/architecture.md) and
[development workflow](docs/development-workflow.md) before changing behavior.
The [roadmap](ROADMAP.md) lists useful contribution areas; the
[verification record](docs/verification.md) owns actual results and limits.

## Pick the checks for your change

Run commands from the repository root after setup. A compilation or dependency
failure is a setup failure, not a reproduced browser defect. For new behavior or
fixes, add a meaningful regression or acceptance assertion, record its real
failure, then implement the fix and rerun the affected checks. Do not add retries
or relax assertions to turn an unexplained failure green.

**Quick source checks** require no browser:

```sh
npm run check
npm test
npm run test:rust
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
```

For a focused Node regression, run `node --test path/to/the-test.test.mjs`. The current-tree privacy check is
`node scripts/check-public-metadata.mjs`; it rejects private conversation links
and tracked customer material. See [public launch controls](docs/public-launch.md)
for the separate historical review and repository settings.
Documentation-only edits usually need link/command review and formatting checks,
not a new behavior test. Explain what you actually checked in the pull request.

CI keeps the full Node 22/24 source, browser and exact-installed package suites
for product changes, shipped documentation, every main push and manual run.
Rust formatting, Clippy and contract tests run once in the Node 24 lane; both
lanes build their independent Rust fixture. Cargo dependency/workspace caches
accelerate builds without skipping checks or reusing installed-consumer outputs.
Only PRs consisting of ordinary edits to `docs/plan.md` and/or
`docs/verification.md` use the lighter record-only path. Metadata, secrets and
CI-policy checks still run, and both required Node statuses explicitly report
that source/browser/package checks were **NOT RUN**. The selector checks the
actual merge and includes base-branch changes; uncertain, empty, renamed,
deleted or newly added paths retain full verification. All other Markdown,
including installation instructions and skill references, stays on the full path.
These records still affect the source digest; a light PR pass is not evidence
for a newly built package. Main and manual runs verify that exact source fully.

**Browser checks** need the built Rust workspace and matching Chromium:

```sh
cargo build --workspace --locked
npm run test:e2e
npm run test:motion
npm run test:controls
npm run test:cli
npm run test:viewer
npm run test:ninja:ui
```

Run affected groups during development and all groups for a runtime, protocol or
viewer change before review. Inspect the visible viewer for presentation changes;
a headless assertion alone does not establish that its layout is usable.

**Release and archive checks** are separate from customer acceptance. Install
**Python 3** as `python3` on `PATH` and have `tar` available before running this
group or reproducing the full CI packaging workflow. These are build/test tools,
not customer runtime dependencies:

```sh
npm run test:release
npm run test:roots-example
node tests/ninja-architecture-acceptance.mjs --test-published-config
```

Release-contract tests exercise disposable local stores and fixtures; they do not
publish a release or deploy the site. The published-config check inspects the
checked-in acceptance configuration and does not require the customer application.
Exact installed-package acceptance takes a freshly built bundle, a fresh output
folder and its independently recorded manifest digest:

```sh
node tests/release-acceptance.mjs /absolute/path/to/bundle /absolute/path/to/fresh-output EXPECTED_MANIFEST_SHA256
```

Replace those placeholders with the actual bundle and digest; do not run the
example literally. [CI](.github/workflows/ci.yml) shows the complete clean-checkout
bundle build, installed-browser acceptance and public-kit assembly. Release
maintainers follow the [release guide](docs/releases.md). Building a kit locally
does not authorize publishing it. Customer suites such as `test:roots-feature`
and `test:ninja:customer` need their documented isolated source and fixtures and
are not prerequisites for an ordinary core contribution.

## Propose and review a change

1. For a bug, include a small reproduction, expected and observed behavior,
   OS/toolchain/package versions, and safe evidence. Use the bug template.
2. Discuss broad API, dependency, release or architecture changes in an issue
   before implementing a large patch. Small corrections can go directly to a PR.
3. Create a branch or fork, keep the patch focused, and preserve unrelated work.
   Application states, selectors, fixtures and business outcomes belong in the
   integration; do not add Roots-specific behavior to the shared product.
4. Describe what changed, why, the checks run and any remaining limitation. Include
   the failed assertion for a behavioral fix and the passing result afterward.
   Record product verification only when it was actually performed; distinguish
   PASS, FAIL, BLOCKED and NOT RUN.
5. A maintainer reviews the patch and required CI. Keep dependency, lockfile and
   entrypoint changes together under one integration owner. Recheck affected
   behavior after a material review change.

Keep credentials, cookies, customer data, private traces, dependency installations
and build output out of commits and issues. Synthetic account credentials are
still private. Share a minimal fixture or sanitized evidence; hashing a private
value does not anonymize it. Never run a candidate against somebody else's live
application or change their accepted dependencies as a side effect.

AI assistance is welcome under the same review and verification expectations.
Contributors remain responsible for understanding the change and for its source,
license and test claims. Follow [AGENTS.md](AGENTS.md) when using an agent here.

## License and community

Contributions intentionally submitted for inclusion are under **Apache-2.0**, as
specified in [LICENSE](LICENSE), unless explicitly stated otherwise. Submit only
material you have the right to contribute. Preserve existing copyright notices,
legacy grants and third-party licenses; identify new third-party material and its
license in your PR. See [licensing scope](docs/licensing.md).

Follow the [code of conduct](CODE_OF_CONDUCT.md). Use
[SUPPORT.md](SUPPORT.md) for questions and [SECURITY.md](SECURITY.md) for private
vulnerability reports. Do not post an unpatched security issue or private conduct
report in a public issue.
