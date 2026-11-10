# Operation Ninja-Update

The alpha.4 tools add [native setup](native-setup.md) commands around this same
manager. The native launcher provides setup/reconnect/Codex viewer handoff and
`refresh` to revalidate source against the accepted retained bundle without
discovering a newer release. Existing `ninja serve` and ordinary integrations
retain their interfaces; do not run two launchers against one managed store.

Ninja-Update prepares, validates, activates and reverts a complete managed Daedlo
project installation. It is included from alpha.3. The older alpha.2 archive client
cannot bootstrap it by itself. A configured publisher catalog and one-time project
registration are prerequisites; the manager never enables publisher trust silently.

The update screen offers **Check for updates → Install update → Ready → Restart
Daedlo** and **Revert update**. The manager does not write to the authored project or
application database. Registered build and validation hooks are trusted code and
must respect that ownership boundary; they are not OS-sandboxed. A candidate becomes ready only after an isolated build,
model handshake and registered acceptance/health checks pass. Changed source,
incompatible interfaces, changed states/commands/recipes, active runs and unsaved
or unknown browser drafts block replacement.

## Bootstrap once

The verified alpha.3 and alpha.4 tools include `docs/update-trust/production.json` and
`docs/update-trust/daedlo-release-2026-10.pem`. These pin publisher `daedlo`, key ID
`daedlo-release-2026-10`, and the preview catalog at
`https://daedlo.com/updates/preview.json`. Use that bundled PEM in the configuration
below, with a path relative to the local configuration file or an absolute path.
Its PEM SHA-256 is
`df84f7d60ed2af949d394e338070ef66ab4debabf911ffd6c7b35bebe6ba4297`;
the Ed25519 SPKI DER fingerprint is
`8055c415145b311263b6771c9a3204401836be00bfa1b5274a8e70cb36ff4761`.
The [production update page](https://daedlo.com/updates) describes the bootstrap.
Confirm the selected kit's trusted receipt first. Downloading a different key from
the feed is not authorization to replace the pinned key.

An agent prepares the registration from the accepted integration and records the
existing model, flows, adapter, dependency locks, configuration, instructions and
custom skills in its exact file allowlist. Ordinary `createProject` integrations
continue to work through the existing CLI. Managed use needs a separate reviewed
`createManagedLaunch` entrypoint and disposable acceptance hooks; the updater does
not rewrite an ordinary factory or infer what a customer save means.

Install the verified tools archive into an explicit tools directory outside the
customer project, following the kit's `START_HERE.md`. The tools package has no
npm dependencies or install scripts. For renamed tools (alpha.4 and later), run
from that tools directory:

```sh
node node_modules/@daedlo/release-tools/lib/ninja.mjs --help
node node_modules/@daedlo/release-tools/lib/ninja.mjs serve --config /absolute/path/ninja-local.json
```

For a published alpha.3 installation, the package directory remains
`node_modules/@browser-driver/release-tools`; use that kit's original commands.
Do not rename an installed package directory by hand. The immutable alpha.3
manager cannot read a renamed Daedlo kit. The first renamed update needs
verified new tools installed separately, a safe stop of the old manager, and the
same existing configuration, store and publisher pin. Verify that the new manager
can launch the accepted legacy installation before attempting an update.

The [naming migration guide](https://github.com/givtaj/daedlo/blob/main/docs/rename.md)
defines this sequence and the required customer upgrade/legacy-rollback drill.
The selected kit's `release.json` records exact artifact verification; the current
[verification record](https://github.com/givtaj/daedlo/blob/main/docs/verification.md)
records publication and feed rollout. Complete and record the customer drill
separately; package compatibility does not establish application acceptance.

The command prints a loopback update-screen URL containing a private local token.
Keep that URL local. The manager stays outside the runtime it replaces. Its
shutdown waits for a safe boundary, persists the session report and closes owned
driver resources. Attached application services remain running. A failed or
uncertain cleanup retains its handle and blocks replacement.

The trusted local configuration has this structure; paths and model identity must
be supplied from the actual accepted integration:

```json
{
  "schemaVersion": 1,
  "store": "/absolute/separate/ninja-project-store",
  "catalog": {
    "url": "https://daedlo.com/updates/preview.json",
    "publisher": "daedlo",
    "channel": "preview",
    "trustedKeys": [{"id": "daedlo-release-2026-10", "publicKeyFile": "daedlo-release-2026-10.pem"}]
  },
  "registration": {
    "schemaVersion": 1,
    "projectId": "accepted-project",
    "label": "Accepted project",
    "sourceRoot": "/absolute/authored-integration",
    "files": ["package.json", "package-lock.json", "engine/Cargo.toml", "engine/Cargo.lock", "engine/src/main.rs", "adapter.mjs", "managed-launch.mjs", "acceptance.mjs", "health.mjs", "FLOW.md", "AGENTS.md"],
    "model": {"id": "actual-model-id", "version": "actual-model-version"},
    "interfaces": {"launcher": 1, "nodeAdapter": 1, "rustModel": 1, "protocol": 1, "capabilities": ["recipeContext:1"]},
    "node": {"packageJson": "package.json", "packageLock": "package-lock.json"},
    "rust": {"manifest": "engine/Cargo.toml", "lock": "engine/Cargo.lock", "binary": "actual-engine-binary"},
    "hooks": {"acceptance": "acceptance.mjs", "health": "health.mjs"},
    "launcher": "managed-launch.mjs"
  },
  "installation": {"offline": true, "npmCache": "/absolute/approved/npm-cache"},
  "settings": {}
}
```

The publisher fields are production values; project paths, hooks and model remain
a schema illustration, not a ready registration or a customer fixture. Copy the bundled
public PEM beside this configuration, or use its explicit installed path. Add all
transitively imported source and relevant project-owned files. The store must be
disjoint from the source, initially empty or already owned by this project.
`settings` is explicit trusted launcher configuration; never place live credentials
or production endpoints in disposable validation hooks. Missing keys/feed/checks
fail closed. `offline` defaults to true; a populated approved npm cache and Cargo
cache are needed. Explicit `offline:false` permits dependency acquisition while
npm lifecycle scripts remain disabled. Rust builds/tests and registered hooks
execute trusted code. Node 22, the manifest's Rust toolchain, Python 3 for safe
archive extraction, and the accepted Playwright browser are prerequisites.

## Managed integration contract, version 1

The launcher exports `createManagedLaunch({runtime, resources, enginePath,
sourceRoot, installation, settings})`. It acquires browser/context resources using
`resources.own(...)` immediately, or uses `resources.attach(...)` for separately
owned resources. It launches the accepted browser at
`installation.browser.executablePath`, calls
`await runtime.registerBrowser({browser, executablePath})`, then creates exactly
one session with the injected `runtime.createDriverSession` and selected engine.
It returns `{session, draftState: async () => boolean, viewerUrl?}`; `true` means
dirty, and absent/unknown draft evidence blocks restart. An optional `close()`
must clean only additional owned resources and support retry. The injected viewer
must use that same session. Application commands are blocked during startup and
until the selection is committed. Startup may connect and observe; it must not
run application flows. The existing runtime execution facade remains authoritative.

Acceptance and health hooks run as child Node processes from the staged project.
Stdin contains `{schemaVersion:1, phase, installation, fixturePath}`. `fixturePath`
is a new owned directory for disposable data. A hook must perform its actual
checks, close every owned process/browser, and print one JSON receipt containing
`schemaVersion:1`, `accepted:true`, `isolated:true`, positive `tests`, `failed:0`,
the exact `runtimePath`, `enginePath`, `model`, and
`browser:{version, executablePath, sha256}`. Health also requires `ready:true`.
These are evidence assertions by trusted integration code, not a sandbox or proof
merely because the fields are present. The installer independently checks the
engine handshake, source/install inventories and browser executable hash.

The v1 build contract supports a standalone Node package and one standalone Cargo
model package with a direct engine dependency. Generated package/Cargo overlays
and build outputs live in the managed slot. Original manifests/locks remain in
the immutable snapshot and in the unchanged authoring tree. Unsupported workspace
inheritance, outside source paths, symlinks, direct runtime imports and dynamic
code loading in the managed launcher/adapter require an explicit integration
migration; they are not silently rewritten. Hook modules are trusted code and
may dynamically import the selected runtime for their checks.

## Alpha.9 dependency migration

The alpha.9 candidate changes Playwright from 1.62.1 to 1.65.0. An existing
alpha.7 authoring lockfile can therefore fail preparation with `Existing adapter
dependency lock changed; migration required`. This refusal preserves the accepted
installation. Replacing the tools alone does not migrate the authored lockfile.

The integrating agent must review and update the **separate QA integration's**
Node manifest/lock against the exact verified alpha.9 runtime archive. Preserve
the original manifest/lock, record their before/after identities and review the
resolved Playwright closure. Preserve all other customer source, model, flows,
configuration, trust, store and application data. Install matching Chromium in a
separate versioned cache and keep the older browser for rollback. Application
workspaces or shared dependency locks need their own integration review; do not
silently edit the application's everyday dependencies.

Then use the normal candidate prepare/acceptance/activate sequence with the
existing registration and retained store. Preparation still checks the reviewed
lock, model handshake, real application acceptance and ownership. Do not use
Refresh to migrate a retained alpha.7 installation to a different runtime lock.
Rollback selects the complete previous installation with its original sealed
source, model, runtime and dependency closure; keep its tools and browser files.
This is an explicit assisted migration, not an automatic lock rewrite.

## Preservation and recovery

Each installation seals original source, generated project dependencies, runtime,
crate, compiled model, handshake, acceptance receipts and launch paths. A project
selection references the complete slot. Activation rechecks source and slot
integrity, drains the driver, writes a durable report, closes owned resources,
then journals and atomically selects the candidate. Failed candidate boot restores
and relaunches the accepted previous selection. A crash before transaction commit
recovers the previous selection after child cleanup is established. Interrupted
downloads/builds never change the active selection. Project locks reject concurrent
operations; catalog checkpoints reject older/equivocating signed metadata.

Revert selects the prior slot including its old adapter and source snapshot;
current authored files are not overwritten. The UI marks the historical snapshot.
Business writes already made remain in the application. No flow is replayed, no
database is restored, and arbitrary login state or unsaved drafts are not promised
to survive restart. Ordinary startup refuses changed registered source; prepare
and validate it again. In tools that provide `daedlo-native`, use `refresh --config FILE`
then `restart --config FILE`: this prepares a new slot from the selected release's
exact retained verified bundle, runs the same hooks and descriptor compatibility
checks, and keeps the previous slot. Missing/tampered retained bundles block this
operation; it never downloads a different release. Explicit rollback can use the
historical snapshot.

The browser executable hash and observed version are verified again at startup.
Its external cache is an explicit dependency: this implementation does not copy or
seal the whole browser distribution or its linked frameworks. A missing/changed
executable blocks startup/rollback. Keep the accepted browser cache available.
No automatic retention cleanup is installed; current, previous and failed slots,
reports, journals and failed cleanup records remain local for inspection. Never
delete a retained resource merely because its parent process is gone: a dead PID
alone does not prove its descendants were cleaned.

## Publisher catalog

Discovery uses a versioned Ed25519-signed `daedlo-public-kit-catalog` envelope,
with publisher, monotonic generation, issue/expiry times, platform/channel,
manager/launcher/Node/Rust/protocol contracts, capabilities and SHA-256/size for
the public ZIP, metadata and checksums. Sign the domain-separated canonical bytes
from `ninjaCatalogSigningBytes`; keep private signing keys outside packages and
repositories. Configure public keys out of band. Rotation adds the approved key
before use; removing a key revokes it locally. Unknown keys, expired catalogs,
replayed generations, changed same-generation contents and HTTPS redirects fail
closed. Catalog validity is bounded to seven days. There is no automatic trust
rotation or unsigned fallback.

The provider understands the published three-file public-kit format and validates
its complete ZIP and nested strict schema-1 bundle. Old `consumer-cli` `update`
and `rollback` still select archives only. They do not activate managed projects.
The browser UI sends only named actions and a server-issued generation; the
server resolves release/operation IDs. It cannot provide shell commands, file
paths or download URLs. Loopback binding, exact Host/Origin, per-server token,
bounded JSON, CSP and mutation/replay guards protect the control endpoint.

The publisher renews catalogs with a greater generation before their seven-day
expiry. Expired metadata blocks discovery and new downloads; an accepted local
installation and local rollback remain available. Feed renewal does not rebuild
or replace immutable release artifacts. No client-side background installation
or trust-key replacement is enabled.

Publication and live-feed evidence belong to the selected release receipt.
Windows/Linux customer acceptance and each customer's agreed fixture remain separate
onboarding gates.
