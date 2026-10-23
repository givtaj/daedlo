# Operation Ninja-Update

Date: 23 October 2026. Owner: Daedlo product/integration owner.
Status: **implemented locally; source and exact installed-package upgrade/rollback acceptance passed; not released**.
Source baseline reviewed: released main `a0dfa27296014cf455a90938d0a641f1c7f9bdfe`.

## Outcome

A person using Daedlo for WBF can see a compatible release, press **Install update**,
and continue with the same project definitions and data. Installation prepares a
new version separately. Activation uses a verified, complete project installation;
the previous working installation remains available.

WBF is the intended use case, not a verified integration in this record. This
design does not require access to WBF data to implement the shared mechanism.
Its acceptance will need an agreed WBF fixture and existing flows before a WBF
upgrade can be called verified.

The product contract is: **updating Daedlo preserves your authored project and
data; a replacement becomes active only after compatibility and the project's
registered acceptance checks pass.** This is a managed candidate contract, not an alpha.2
feature or a guarantee that every future release is compatible. Incompatible
updates keep the current installation usable and report the migration needed.

## Baseline at the design review

| Boundary | Current implementation | Missing for Ninja-Update |
| --- | --- | --- |
| Customer model | Rust `ApplicationModel` owns facts, states, guards, commands, canonical recipes and outcomes | Explicit supported source API/capability contract and an isolated rebuild of unchanged customer source |
| Browser integration | Public `BrowserAdapter` and guarded execution primitives; exact adapter/model identity and handler checks | Versioned adapter/launcher requirements and candidate compatibility evidence |
| Release verification | Manifest, exact archives, trusted digest input, environment checks | Authenticated public-kit discovery and compatibility metadata for the complete installation |
| Archive selection | Store locking, immutable version directories, current/previous selection, rollback | Actual runtime installation, customer-engine build and project launcher activation |
| Public delivery | Versioned website ZIP, metadata and checksums | Discovery feed and download provider that understand the published kit |
| Viewer | Local session viewer with guarded application commands | Update status/actions backed by a separate trusted installation manager |

The portable `update` and `rollback` commands select **archives**, not a running
customer installation. The existing GitHub downloader expects four top-level
bundle assets. The published alpha.2 release has a ZIP, `release.json` and
`SHA256SUMS`; wrapping the legacy downloader with a button would not install this
kit. Website discovery is also absent. Preserve legacy operations and add a
versioned public-kit provider rather than silently changing their meaning.

Sources: [release commands](../../scripts/release/commands.mjs),
[archive store](../../scripts/release/store.mjs),
[GitHub provider](../../scripts/release/remote.mjs),
[manifest](../../scripts/release/manifest.mjs),
[model trait](../../crates/browser-driver-engine/src/lib.rs),
[public adapter types](../../packages/runtime/src/index.d.ts),
[CLI](../../packages/runtime/src/cli.mjs), and
[current update guide](../update-client.md).

## Separate the installation from the project

| Owner | Contents | Update rule |
| --- | --- | --- |
| Daedlo release | Runtime, viewer, shared Rust crate, standard tooling and versioned agent guidance | Install verified new bytes in a new managed release directory |
| WBF project | Model/state source, recipes, adapter/selectors/evidence hooks, presentations, flow catalogue, configuration and custom instructions | Preserve authored bytes; never regenerate, overwrite or silently migrate them |
| Derived installation | Compiled WBF model executable, resolved adapter dependencies, runtime/browser dependencies and generated build/launch metadata | Rebuild into a separate project installation from the recorded source and dependency inputs |
| Persistent local records | Project registrations, accepted version pins, reports and upgrade history | Store outside release directories; preserve schema readability and previous records |
| WBF application | Business data, services, credentials, sessions and ordinary application dependencies | Outside updater ownership; no migrations, resets, service restarts or dependency edits |

Project source can remain in its existing directory layout. A proposed registration
manifest points to it; it does not move the project into the Daedlo installation.
Shared release bytes may be cached once, while each project pins its own complete
installation. Installing for WBF must not upgrade Roots or another project.

The local managed store contains immutable release directories, separate derived
project installations, current/previous project selections, operation journals
and durable reports. Customer secrets stay in their existing approved locations;
they are neither bundled nor sent to the release service. Locally customized agent
skills are project content; a runtime update must not overwrite them. New standard
guidance stays versioned, with customized-copy updates handled explicitly.

This follows the useful Codex separation between installed software and external
project configuration. Official Codex documentation describes user configuration
at `~/.codex/config.toml` and project configuration in `.codex/config.toml`.
That is an analogy for ownership, not evidence of Codex's internal updater,
rollback implementation or guarantees.
[Official configuration documentation](https://learn.chatgpt.com/docs/config-file/config-basic).

## Compatibility interfaces

Keep the existing responsibilities: Rust decides application behavior; the adapter
observes, performs guarded actions and gathers evidence; Daedlo runs the session.
Do not introduce another JavaScript state machine to make updates work.

Add explicit versioned contracts for the update feed, project registration,
managed launcher, public Node adapter API, Rust model API, wire protocol and
required capabilities. These are proposed contracts, not fields already supported
by alpha.2. A new release-manifest schema must coexist with the strictly validated
current schema; adding unknown fields to schema 1 would break current clients.

Use versions and capabilities to reject incompatible candidates early, then prove
the actual combination. A matching version string or protocol alone is insufficient.
The existing `recipe_only` Rust field illustrates the distinction: a Rust struct
literal may need a source change even when the JSON protocol remains version 1.

The shared crate is compiled into the customer's engine. Updating it normally
means building a new executable from the **same WBF model source**, with the
candidate crate and isolated dependency/build output. Record exact source,
toolchain, dependency locks, crate and executable identities. Original manifests,
locks and build outputs are preserved; any generated dependency overlay belongs
to the managed installation. If the registered project cannot be built this way,
or compilation requires changing model source, block activation as **Migration
required**. An agent can prepare a separate reviewable migration; Install update
does not invent one.

The managed launcher must select the complete tuple: runtime, crate/build receipt,
compiled model, resolved adapter/dependencies, browser version and launch contract.
Existing `--project` integrations continue working. Registering one for managed
updates is an explicit one-time onboarding step. Custom `createSession` routes
or adapters importing their own runtime must demonstrate that they use the
selected installation; otherwise they remain on assisted manual upgrades.

Compatibility inventory must not execute the ordinary customer factory. Current
CLI startup imports/calls `createProject` and navigates before session handshake,
so it is not a side-effect-free preflight. Candidate code and acceptance hooks run
only in the registered isolated fixture with its approved inputs. Adapters and
build scripts remain trusted code; an interface label alone is not a sandbox.
Do not provide production credentials or endpoints to disposable validation.

Managed startup also needs an explicit lifecycle contract: prepare resources,
connect and observe, report readiness, then accept user-triggered commands.
Factories that automatically run application commands at startup cannot enroll
unchanged. Validate their managed entrypoint during initial registration; neither
a new manager nor a version flag makes arbitrary existing startup code read-only.

## The Install update journey

1. **Discover.** Check an authenticated release catalog for the user's selected
   channel and platform. Report failure as unavailable, not up to date. Preview
   releases require an explicit preview channel. Show current/new versions,
   release notes and affected project before installation. Start with user-triggered
   checks; do not create background monitors or unattended installation.
2. **Download and verify.** Resolve a trusted catalog entry to the complete kit.
   Verify publisher-authenticated metadata, package digests, sizes and safe archive
   entries before execution. A checksum downloaded beside a package alone does not
   authenticate its publisher. Catalog signatures need a bundled trust root,
   rotation/expiry rules and downgrade/replay handling. No automatic bypass on
   expired or unknown trust; offline users keep their accepted installation.
3. **Prepare.** Install in a new owned directory, with explicit npm destinations
   and no ancestor-workspace modification. Build the unchanged model and resolved
   adapter closure. Save a plan bound to exact project source/configuration and
   dependency identities. Keep the active version untouched.
4. **Validate.** Check the declared interfaces and actual handshake, model ID,
   handler coverage and required capabilities. Run the registered unchanged model,
   adapter and browser acceptance against disposable data. Compare states, commands
   and recipes plus outcomes; preserve independent persistence/no-write assertions.
   A project without suitable acceptance remains **Needs validation** and is not
   reported ready merely because the package downloads or compiles.
5. **Activate safely.** Show **Ready — restart Daedlo**. Existing runs retain their
   original installation; no hot replacement, killing an in-flight save or replay.
   Defer while a run is active or a draft/session cannot be preserved. At a safe
   user-selected boundary, persist reports and close only owned driver resources.
   Failed persistence or incomplete cleanup blocks activation and retains handles.
   Recheck project inputs and the expected previous pin, then atomically select
   the complete new installation under a project lock. Validate isolated boot
   health; normal launch must not auto-run application flows. Show the actual
   selected version and whether the new session started successfully.
6. **Recover.** A failure before activation leaves the old selection unchanged.
   An unsuccessful boot restores the previous complete selection through the
   operation journal; after a crash, recover to one valid selection. Keep failed
   cleanup handles and show any pending manual recovery. **Revert update** restores
   the previous installation, including its adapter closure and compatible source
   snapshot. It never overwrites the current authoring tree or undoes business writes.

When source changes after validation, the plan is stale: prepare and validate again.
Retain a private immutable integration snapshot with the previous installation so
later edits do not invalidate rollback silently. Running a historical snapshot
must be visible to the user. Selection rollback does not restore a database or
claim compatibility with unrelated subsequent WBF application changes.

Installing and restarting must distinguish durable project definitions/reports
from volatile browser drafts and login state. Never claim an arbitrary browser
session survives restart. The first version defers activation until a safe boundary;
any persistent-profile support needs its own verified privacy and lifecycle contract.

The update manager lives outside the runtime being replaced and owns the
transaction. Viewer buttons delegate to it using operation IDs and a locally
authenticated request, with loopback/Host/Origin checks and replay protection.
The browser cannot supply arbitrary shell commands, paths or download URLs.
The manager checks runtime idle state and project generation again when acting;
disabling a button alone is not concurrency control. Updating the manager itself
is a separate versioned bootstrap operation; an unsupported manager version blocks
the candidate instead of replacing its running files.

## Delivery sequence and acceptance

The rows below retain the acceptance requirements. Shared NINJA-01 through
NINJA-04 code is now implemented locally; the [verification record](../verification.md)
owns actual test results. NINJA-05 passed against Architecture Studio with both
source modules and the exact installed alpha.3 tools: upgrade, rejected candidate,
rollback, unchanged project/source/data, reports, relaunch and cleanup. The tested
package is frozen from clean source `4948b81bf5d57de71888aeca0293a24288a0373b`.
NINJA-06 remains an external onboarding/release gate. See the
[managed client guide](../ninja-update.md) for supported interfaces and bootstrap.

| Work item | Deliverable | Completion evidence |
| --- | --- | --- |
| NINJA-00 | Ownership, compatibility and transaction design | This record and review of current source; design only |
| NINJA-01 | Authenticated public-kit catalog/provider and schema compatibility | Real alpha.2 ZIP-format download; corrupt/untrusted/expired/wrong-platform/replay cases reject; legacy bundle client remains explicit |
| NINJA-02 | Managed project registration, immutable install/build slots and launcher | Existing model/adapter source, project locks/instructions/data unchanged; exact candidate runtime and built engine selected; custom runtime bypass rejected |
| NINJA-03 | Prepare, compatibility, acceptance, atomic activation and rollback | Build/handler/protocol/behavior failures retain old runnable version; stale source and concurrent installers refuse; interrupted download/build/commit/recovery remains usable |
| NINJA-04 | Local update screen and actions | Real-browser Available → Install → Validate → Ready → Restart → Updated and Revert flows; busy run/dirty draft deferred; no automatic application effects |
| NINJA-05 | Real application preservation proof | Accepted Architecture Studio flow upgraded from exact alpha.2 to a new candidate, failed-upgrade and rollback runs; unchanged source, exact save/no-write evidence, reports, relaunch and attached-service survival |
| NINJA-06 | WBF onboarding and release | WBF's own agreed fixture/flows pass before claiming WBF upgrade acceptance; exact package/CI/UI checks, documented bootstrap and public installation proof before publication |

For new behavior, first record genuine failing assertions, then implement and
verify without weakening them. Core unit/fault tests use an independent fixture;
they do not stand in for real application acceptance. Add source integrity checks
for existing custom instructions, skill copies, adapter files and locks, including
nested npm workspaces, symlinks, source drift and ownership replacement. Retain
previous releases while referenced by active sessions or rollback selections.

The first managed-updater installation is assisted: alpha.2 has no update button
that can bootstrap itself. After that registration, compatible future releases
can use the requested Install update experience. Work on this plan does not
install anything into WBF, promote Roots, publish a release or enable monitoring.
