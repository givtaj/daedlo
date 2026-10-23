# Install Daedlo {{VERSION}}

This public developer preview pairs the Daedlo runtime, Rust engine source,
portable release tools and complete agent skill. Package names, commands and
skill paths match this selected kit. Older kits retain their original names;
protocol identifiers remain compatible.

Start at the [public installation page](https://daedlo.com/install.html). Download
the versioned kit and follow its `START_HERE.md` instructions. That guide supplies
the exact archive names, verification values and installation commands for the
selected release. Use `AGENT_START.md` in the same kit to give a coding agent the
installation and first-flow job. These kit guides sit outside the installed tools
package; use the public installation page if you have only the tools package.

## Verify the download before running it

Compare the downloaded kit and tools archive with the digests in the trusted
release receipt before executing included code. Verify the runtime/engine bundle
with the portable tools and the manifest digest from that receipt. Checksums prove
byte identity only when the expected values come from a trusted source; a
bundle's own checksum inventory does not independently authenticate it.

Keep the selected archives, receipt and customer lockfiles in durable locations.
Do not overwrite another version's files or replace an accepted integration while
testing a candidate. Package verification establishes the recorded identity and
compatibility, not that a customer's application behaves correctly.

## What you receive

| Component                                 | Purpose                                                                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `{{PACKAGE_PREFIX}}-runtime-{{VERSION}}.tgz`  | The `{{RUNTIME_NAME}}` Node package, local viewer and `{{SKILL_NAME}}` CLI                                       |
| `{{ENGINE_NAME}}-{{VERSION}}.crate` | Rust library source for the customer's application model                                                                |
| `manifest.json` and `SHA256SUMS`          | The paired runtime/engine bundle's identity and integrity inventory                                                     |
| `{{PACKAGE_PREFIX}}-tools-{{VERSION}}.tgz`    | The offline-installable `{{TOOLS_NAME}}` package, contracts, onboarding documentation and complete skill |

The runtime/engine bundle contains exactly its four listed files. The surrounding
kit adds the tools, installation guides and release evidence. Follow its inventory
for any additional assets. The portable tools have no npm dependencies or install
scripts. No driver source checkout or GitHub account is required for this public
website download and local verification path. No npm or crates.io registry release
is implied.

## Bring one application flow

Use Node.js 22 or later, npm, Rust/Cargo 1.96.0 or later, and the runtime's matching
Playwright Chromium. This version pins Playwright 1.62.1. Chromium and application
dependencies are installed separately; they are not included in the download.
Docker is needed only when the chosen application fixture requires it.

The agent installs the exact package pair in a separate QA integration, copies
the complete `skills/{{SKILL_NAME}}` folder to the chosen project skill location,
and helps connect one agreed feature. Codex uses `.agents/skills/{{SKILL_NAME}}`;
Claude Code uses `.claude/skills/{{SKILL_NAME}}`. Preserve existing instructions
and customizations.

The application supplies a Rust `ApplicationModel`, JavaScript adapter, trusted
`project.mjs`, fixture and assertions. There is no prebuilt customer model or
automatic discovery of all application behavior. Read `docs/agent-onboarding.md`
and `skills/{{SKILL_NAME}}/references/onboarding.md` from the installed tools
package root. The runtime's `src/index.d.ts` and engine's `src/lib.rs` define the
actual public interfaces.

After those pieces exist, launch the integration with its installed
`{{SKILL_NAME}} --project ./project.mjs` command from the integration directory.
The default creates an owned headless Chromium with a visible local viewer; use
`--headed` for a native browser window. Opening the viewer does not sign in or run
authored application commands. Verify the agreed flow and a relevant failure path,
inspect the visible browser, and record package identities, evidence and ownership.

## Updates and limits

Alpha.3 adds Operation Ninja-Update. After assisted project registration, its
separate local update screen checks the signed production catalog, installs and
validates a complete replacement, then offers Restart and Revert. Read the
installed `docs/ninja-update.md` and pinned `docs/update-trust/production.json`.
Original project files and application data remain outside updater ownership.


For public downloads, revisit the [installation page](https://daedlo.com/install.html)
and follow the selected kit's receipt. The portable client's `check` and `download`
operations support GitHub releases only; they do not discover or download website
kits. Local `verify`, `update`, `status` and `rollback` remain available without
GitHub. Read `docs/update-client.md` in the installed tools package for their scope.

An archive-store selection does not install application dependencies or change a
launcher. Test each replacement runtime/crate/model/adapter combination separately
before promoting customer pins. Keep the accepted combination available for
rollback. No background installation, hosted browser service or account is enabled.

Authored flows run without a model API key. Windows, complete onboarding across
unfamiliar frameworks and end-to-end discovery in both agent hosts have not been
verified. A selected integration's pass is not universal application coverage.

Read the supplied `LICENSE`, `THIRD_PARTY_NOTICES.md`, and preserved MIT and
Apache-2.0 texts. From alpha.4, the public core uses Apache-2.0 while required
legacy MIT and third-party notices remain included. Alpha.3 and earlier releases
retain their original terms and previously granted permissions.
This public preview carries no time-limited evaluation agreement. Customer code,
models, adapters, data and authored flows remain separate from the driver.
