# Daedlo 0.1.4-alpha.3 portable release tools

The `@browser-driver/release-tools` package verifies and selects exact driver
archives in a separate local store. It also includes the contracts, onboarding
guides and complete `browser-driver` agent skill. Its legacy archive commands do
not install a customer runtime or activate a project.

The separate [Operation Ninja-Update manager](ninja-update.md) adds project
registration, isolated installation/build/checks, a local Install/Restart/Revert
screen, and whole-installation rollback. Alpha.3 includes the pinned production
public key and preview-feed configuration in `docs/update-trust/production.json`.
Customer registration and explicit publisher trust are one-time bootstrap steps. The existing public alpha.2 cannot bootstrap it automatically. In particular,
the legacy GitHub downloader expects a four-file top-level bundle, whereas the
public alpha.2 release publishes a kit ZIP plus metadata and checksums. Use the
public kit instructions for alpha.2; do not treat release discovery as proof that
the legacy downloader supports that asset format.

Obtain the exact kit named by the selected release receipt at the
[installation page](https://daedlo.com/install).
Follow the surrounding kit's `START_HERE.md` for the selected archive's trusted
digests and exact installation commands, and `AGENT_START.md` for the first-flow
handoff. Those files are kit-level guides, not files inside this installed tools
package. The public website download path requires no driver source checkout or
GitHub account.

## Install and inspect

Verify the tools archive against the trusted release receipt before installing or
running it. Install it in a separate tools directory outside the application,
using the kit's offline npm command. Node.js 22 or later and npm are prerequisites.
The tools package contains no npm dependencies or installation scripts. Installation
creates local npm metadata, a lockfile and the executable link in that directory.

From that tools installation directory, inspect the actual CLI:

```sh
node node_modules/@browser-driver/release-tools/lib/consumer-cli.mjs --help
```

The installed package root is `node_modules/@browser-driver/release-tools`. Its
`SOURCE.json` records the source identity and shipped-file hashes. Read
`docs/contracts.md`, `docs/agent-onboarding.md`, `docs/releases.md` and
`skills/browser-driver/SKILL.md` there. A copied skill's location does not identify
the tools package root. Runtime types and the Rust trait are in their separately
installed packages.

## Available operations

The table lists flags, not commands with fabricated paths or verification digests.
Use the paths and trusted digest supplied by the selected kit. Resolve output and
store directories explicitly; use fresh owned output and preserve accepted files.

| Operation  | Required flags                             | Optional flags                            | Effect                                                                                     |
| ---------- | ------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| `verify`   | `--bundle`                                 | `--sha256`                                | Checks a local four-file runtime/engine bundle and the Node/Rust/protocol environment      |
| `update`   | `--store`, `--bundle`, `--sha256`          | `--allow-dirty`                           | Verifies and selects exact archives in an isolated store                                   |
| `status`   | `--store`                                  | None                                      | Reads the store's current selection and integrity                                          |
| `rollback` | `--store`                                  | `--allow-dirty`                           | Verifies and selects the store's previous bundle                                           |
| `check`    | `--repo`, `--current`                      | `--channel stable` or `--channel preview` | Checks release metadata in an explicitly selected GitHub repository                        |
| `download` | `--repo`, `--version`, `--out`, `--sha256` | None                                      | Downloads the selected GitHub runtime/engine bundle into fresh output without selecting it |

Use `--sha256` for trusted verification: omitting it checks internal integrity but
reports `trustedDigestProvided: false`. The expected manifest digest must come
from the trusted receipt, not merely the downloaded bundle's own checksum file.
`verify`, `update` and `rollback` require a compatible Rust compiler as well as
Node. `status`, `check` and `download` do not measure Rust compatibility.

The alpha release requires `source.dirty: false` and a recorded commit. Check the
selected manifest rather than inferring provenance from a version name. An older
preview such as `0.1.2-rc.1` records `source.dirty: true`; selecting or rolling back
to that historic archive requires the explicit `--allow-dirty` flag. That flag
preserves its source disclosure and does not establish customer acceptance.
Maintainer `build`, `build-tools` and `version` commands are not available in this
portable client.

## Public website updates and optional GitHub operations

To obtain another public version, return to the
[installation page](https://daedlo.com/install.html), download its kit and follow
its receipt before using local verification. The client currently has no website
release discovery or website download operation through these legacy commands.
Ninja-Update uses its configured authenticated public-kit catalog instead.

`check` and `download` use the installed `gh` CLI and its existing authentication
for the repository explicitly supplied through `--repo`. They support GitHub
releases only. Access to the chosen repository must already exist; the tools do
not grant access or copy credentials into packages or stores. These optional
operations are not prerequisites for installing a public website kit. An
unavailable repository or failed discovery is not evidence that a local version
is current.

## Preserve the working integration

The canonical bundle consists of its runtime `.tgz`, engine `.crate`,
`manifest.json` and `SHA256SUMS`. Keep those four files together. The tools archive,
skill-only assets and surrounding kit guides are outside that bundle contract.

`update` selects archives; it does not install them into the application. Test the
candidate with the customer's exact Rust model, adapter, lockfiles and launcher
before promoting that whole combination. `rollback` changes only the archive
store's selection; it does not undo application writes, data migrations or an
independently changed customer installation.

Do not overwrite an existing accepted version. Nonempty unowned stores, symlinks,
changed bytes under an existing version and partial downloads are refused rather
than silently adopted. Retain reported cleanup handles if cleanup is incomplete.
No automatic updates, scheduled checks, application migrations or hosted service
are installed.

The supplied `LICENSE`, `THIRD_PARTY_NOTICES.md` and preserved license texts apply
to the selected public package. It carries no time-limited evaluation agreement.
