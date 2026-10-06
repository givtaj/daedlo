# Portable release tools

The update client checks for Browser Driver releases, downloads an exact bundle,
verifies its identity and compatibility, and selects archives in an isolated local
store. It does not install a customer runtime, compile a customer model, replace
application dependencies, or restart services. The customer integration keeps its
accepted package pins and launcher until its own replacement checks pass.

Developer preview `0.1.1-rc.5` distributes the tools archive as a separate GitHub
release asset. The selected release page and its `VERIFICATION.md` receipt confirm
publication and exact bytes. Published v0.1.1-rc.2 does not include these tools,
and the package is not published to npm. A full Browser Driver source checkout is not
required to run the packaged consumer commands. Maintainer `build` and `version`
commands remain in the source repository and are unavailable in the portable client.

## Before and after installation

Obtain `browser-driver-tools-VERSION.tgz`, `TOOLS_SHA256SUMS`, and
`TOOLS_VERIFICATION.json` from the selected trusted local candidate or, once
published, release. Confirm the archive digest against its receipt before
installing or executing it. A checksum downloaded from an untrusted source does
not authenticate that source.

Use a separate, empty directory for the tools, outside the application:

```sh
mkdir driver-update-tools
cd driver-update-tools
npm install --offline --ignore-scripts --no-audit --no-fund /absolute/path/browser-driver-tools-VERSION.tgz
node node_modules/@browser-driver/release-tools/lib/consumer-cli.mjs --help
```

The package has no npm dependencies or installation scripts. This creates the
local npm metadata, lockfile, executable link, and package files under that chosen
directory. It does not modify the application's `package.json`, Cargo manifest,
lockfiles, or installed driver. Node 22 or later and npm are prerequisites.

```text
driver-update-tools/
├── package.json
├── package-lock.json
└── node_modules/
    ├── .bin/browser-driver-release
    └── @browser-driver/release-tools/
        ├── README.md, LICENSE, package.json, SOURCE.json
        ├── lib/                 consumer CLI and release operations
        ├── docs/                contracts and authoring references
        └── skills/browser-driver/   complete agent skill
```

`SOURCE.json` identifies the source commit, clean/candidate state, source-tree
digest, and hashes of the shipped files. The external verification receipt also
binds the completed archive's digest and size. An explicit dirty candidate is
development evidence, not a clean release.

## Check, verify, and select

The packaged CLI's `--help` lists its exact command flags. GitHub discovery and
downloads use the installed `gh` CLI and its existing authentication. Private
repositories require access; the client does not request wider repository
permissions or copy credentials into the archive or store.

A safe daily check is read-only: compare the accepted version against the chosen
repository and explicit `stable` or `preview` channel. A newer tag is only a
candidate. Discovery does not prove package compatibility or customer acceptance,
and an unavailable or incomplete response is not evidence that the installation
is current. Scheduling is separate; installing the tools creates no background
job and enables no automatic application updates.

From the tools installation directory, substitute the actual accepted version:

```sh
node node_modules/@browser-driver/release-tools/lib/consumer-cli.mjs check --repo givtaj/browser-driver --current ACCEPTED_VERSION --channel preview
```

After choosing a release and recording its trusted manifest digest:

```sh
node node_modules/@browser-driver/release-tools/lib/consumer-cli.mjs download --repo givtaj/browser-driver --version SELECTED_VERSION --out /absolute/path/new-bundle --sha256 TRUSTED_MANIFEST_DIGEST
node node_modules/@browser-driver/release-tools/lib/consumer-cli.mjs verify --bundle /absolute/path/new-bundle --sha256 TRUSTED_MANIFEST_DIGEST
node node_modules/@browser-driver/release-tools/lib/consumer-cli.mjs update --store /absolute/path/chosen-store --bundle /absolute/path/new-bundle --sha256 TRUSTED_MANIFEST_DIGEST
node node_modules/@browser-driver/release-tools/lib/consumer-cli.mjs status --store /absolute/path/chosen-store
node node_modules/@browser-driver/release-tools/lib/consumer-cli.mjs rollback --store /absolute/path/chosen-store
```

These are separate operations: run rollback only when returning to the previous
archive selection is intended. `verify`, `update`, and `rollback` measure the
available Rust compiler as well as the running Node version; discovery and
download do not require a Rust compiler and do not claim toolchain compatibility.

For a selected candidate:

1. Obtain the expected manifest SHA-256 from the trusted release receipt.
2. Download into a new, explicitly chosen directory. The client verifies the exact
   version, manifest digest, artifact sizes and hashes, and checksum inventory.
3. Run compatibility verification with the Node and Rust environment intended for
   the consumer. Missing prerequisites or incompatible versions must be resolved
   before selecting the release.
4. Update the isolated archive store. Its previous selection remains recorded for
   rollback. Downloading alone never changes that selection.
5. Test the customer's exact runtime/model/adapter combination in an isolated
   integration before promoting application pins or a launcher.

The canonical downloaded bundle remains exactly:

```text
bundle/
├── browser-driver-runtime-VERSION.tgz
├── browser-driver-engine-VERSION.crate
├── manifest.json
└── SHA256SUMS
```

Selecting it creates only the store's owned metadata and archive copy:

```text
chosen-store/
├── .browser-driver-release-store.json
├── current.json
└── releases/VERSION/
    └── the same four bundle files
```

`status` inspects the selection and archive integrity. `rollback` verifies and
selects the previously recorded bundle; it does not reverse application writes,
data migrations, or a separately promoted customer installation. Existing
nonempty directories, symlinks, replaced version bytes, and partial downloads are
not silently adopted. If cleanup is incomplete, retain the reported owned paths
for inspection rather than deleting other directories.

## Agent integration

The bundled `skills/browser-driver/SKILL.md` explains the customer workflow.
Read `docs/contracts.md` and `docs/agent-onboarding.md` from the installed package
root alongside the selected runtime's
public types and the engine crate's public Rust trait. These references do not
include the complete repository examples or maintainer test harness.

Customers still author the Rust state model, guarded Node adapter, fixtures and
application assertions. The Rust crate is source, not a precompiled model.
Playwright and its matching Chromium belong to the runtime installation, not this
update client. A package conformance result does not establish customer feature
coverage. The local viewer remains local; this workflow adds no hosted portal,
identity provider, billing integration, or changes to an existing Roots driver.
