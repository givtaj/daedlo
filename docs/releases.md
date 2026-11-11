# Install the Daedlo 0.1.4-alpha.11 candidate

Alpha.11 is being prepared; alpha.10 is the published baseline. Use the selected
kit and its verification receipt. The live installation page identifies the
currently published version; these source instructions alone do not establish
publication or customer acceptance.

This guide covers the Daedlo 0.1.4-alpha.11 kit. Its `release.json` records exact
artifact identities and scoped verification. Consult the current
[verification record](https://github.com/givtaj/daedlo/blob/main/docs/verification.md)
for publication status; a guide alone does not establish public availability or
acceptance of a customer application.

This alpha pairs the Daedlo runtime, Rust engine source,
portable release tools and complete agent skill under the Daedlo technical names.
Published alpha.3 and earlier kits retain their original `browser-driver` package
names and commands. Wire/report identifiers remain compatible; follow the selected
kit's instructions when working with an older release. The
[naming migration guide](https://github.com/givtaj/daedlo/blob/main/docs/rename.md)
records compatibility limits and the migration sequence: an immutable alpha.3
manager cannot install a renamed kit without a separately verified new-tools bootstrap.
Verify the bootstrap, renamed upgrade and legacy rollback for the selected
integration; package and feed checks do not establish customer acceptance.

Use the selected release receipt to obtain the exact versioned kit and follow
its `START_HERE.md` instructions at the
[public installation page](https://daedlo.com/install). The release receipt records
artifact identity and verification separately from this guide. `START_HERE.md`
supplies the exact archive names, verification values and installation commands for the
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
| `daedlo-runtime-0.1.4-alpha.11.tgz`  | The `@daedlo/runtime` Node package, local viewer and `daedlo` CLI                                       |
| `daedlo-engine-0.1.4-alpha.11.crate` | Rust library source for the customer's application model                                                                |
| `manifest.json` and `SHA256SUMS`          | The paired runtime/engine bundle's identity and integrity inventory                                                     |
| `daedlo-tools-0.1.4-alpha.11.tgz`    | The offline-installable `@daedlo/release-tools` package, contracts, onboarding documentation and complete skill |

The runtime/engine bundle contains exactly its four listed files. The surrounding
kit adds the tools, installation guides and release evidence. Follow its inventory
for any additional assets. The portable tools have no npm dependencies or install
scripts. No driver source checkout or GitHub account is required for this public
website download and local verification path. No npm or crates.io registry release
is implied.

## Bring one application flow

Use Node.js 22 or later, npm, Rust/Cargo 1.96.0 or later, and the runtime's matching
Playwright Chromium. This candidate pins Playwright 1.65.0. Chromium and application
dependencies are installed separately; they are not included in the download.
Docker is needed only when the chosen application fixture requires it.

The agent installs the exact package pair in a separate QA integration, copies
the complete `skills/daedlo` folder to the chosen project skill location,
and helps connect one agreed feature. Codex uses `.agents/skills/daedlo`;
Claude Code uses `.claude/skills/daedlo`. Preserve existing instructions
and customizations.

The application supplies a Rust `ApplicationModel`, JavaScript adapter, trusted
`project.mjs`, fixture and assertions. There is no prebuilt customer model or
automatic discovery of all application behavior. Read `docs/agent-onboarding.md`
and `skills/daedlo/references/onboarding.md` from the installed tools
package root. The runtime's `src/index.d.ts` and engine's `src/lib.rs` define the
actual public interfaces.

After those pieces exist, launch the integration with its installed
`daedlo --project ./project.mjs` command from the integration directory.
The default creates an owned headless Chromium with a visible local viewer; use
`--headed` for a native browser window. Opening the viewer does not sign in or run
authored application commands. Verify the agreed flow and a relevant failure path,
inspect the visible browser, and record package identities, evidence and ownership.

## Drive a Swagger API

The tools ship `integrations/swagger/README.md` with an exact-package setup flow.
It builds the included generic Rust model against the extracted core crate in a
fresh directory, selects the installed runtime explicitly and launches the
standalone CLI. Configure the API's docs/schema URLs, permitted operations and
separate write policy. OpenAPI 3.0/3.1/3.2 JSON and Swagger UI 5 are the supported
starting point; the compatibility table lists unsupported features explicitly.
No Roots source or database is needed for this integration. Customer persistence
checks remain application-specific. Managed Ninja/native Swagger startup is not
part of this candidate.

Credential-bearing command inputs use the explicit `password` descriptor type.
The Daedlo viewer masks and clears those fields after submission. Existing
customer models must opt into this type; ordinary `text` fields retain their
behavior. Descriptor defaults and recipe literals are public metadata and must
never hold credentials. Swagger UI may itself show private request/response data.

## Development restarts and connection status

The sidebar shows separate Viewer, Browser, Application and Live image statuses
with icons, text and color. Application means the last matching model observation;
it does not independently probe your API's health. During a rebuild, the viewer
keeps the completed result and labels any retained image with its capture time.
Transient transport loss shows Reconnecting, then Connection lost if it persists.
An explicitly closed viewer shows Viewer closed.

After restarting your API or site, use Check connection to refresh observations.
Commands stay disabled until the current target and observation are usable.
Reconnecting never replays an API request or resumes a write. If the viewer itself
restarts at a different address, open that new address. Swagger selection can reveal
collapsed or virtualized operations; an active Swagger filter is preserved and a
hidden operation produces an actionable refusal.

## Updates and limits

Alpha.11 keeps alpha.10's Playwright dependency closure and manager contract.
The reviewed abandonment and model-migration commands require the alpha.11
**release tools**. A runtime-only update retains the existing tools. Verify and
install the new tools separately, safely stop the authenticated old owner with its
original configuration, then reopen the same registration, configuration, store,
publisher trust and checkpoint. Retain the old tools, browser cache and accepted
slots. New tools cannot hot-repair an already running older controller.

After that tools bootstrap, use the normal Check, Install, Restart and Revert flow
for the runtime. No third-party dependency migration is required. Read
[native setup](native-setup.md), [reviewed abandonment](managed-abandonment.md)
and [reviewed model changes](model-migration.md) before using these operations.
Older alpha.7 integrations still need the
reviewed manifest/lock migration described in the installed
[update guide](ninja-update.md#alpha9-dependency-migration).

For standalone Swagger, install the matching alpha.11 runtime, core and tools
from the kit and rebuild the included model using its setup guide. Preserve the
accepted integration until the rebuilt model and agreed flows pass; a runtime-only
replacement cannot deliver the model's updated response wording.

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

Authored flows run without a model API key. Initial onboarding targets assisted
macOS arm64 use with Codex and an explicitly read skill. Linux/Windows onboarding,
Claude Code, automatic skill discovery and complete onboarding across unfamiliar
frameworks are unverified. A selected integration's pass is not universal application coverage.

Read the supplied `LICENSE`, `THIRD_PARTY_NOTICES.md`, and preserved MIT and
Apache-2.0 texts. From alpha.4, the public core uses Apache-2.0 while required
legacy MIT and third-party notices remain included. Alpha.3 and earlier releases
retain their original terms and previously granted permissions.
This public preview carries no time-limited evaluation agreement. Customer code,
models, adapters, data and authored flows remain separate from the driver.
