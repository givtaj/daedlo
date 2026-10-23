# Migrate browser-driver naming to Daedlo

This guide describes the naming migration prepared for **0.1.4-alpha.4**. It does
not establish that a release, repository rename, customer upgrade or rollback has
completed. Actual results belong in [verification.md](verification.md). The
repository stays private until the owner separately approves public access.

## Names and compatibility

| Area | Previous name | Current-source target |
| --- | --- | --- |
| Same GitHub repository | `givtaj/browser-driver` | `givtaj/daedlo` |
| npm workspace | `browser-driver-workspace` | `daedlo-workspace` |
| Node runtime package | `@browser-driver/runtime` | `@daedlo/runtime` |
| Runtime CLI | `browser-driver` | `daedlo` |
| Rust package | `browser-driver-engine` | `daedlo-engine` |
| Default Rust import | `browser_driver_engine` | `daedlo_engine` |
| Portable tools package | `@browser-driver/release-tools` | `@daedlo/release-tools` |
| Release CLI | `browser-driver-release` | `daedlo-release` |
| Agent skill | `skills/browser-driver`, `$browser-driver` | `skills/daedlo`, `$daedlo` |
| New archive prefixes | `browser-driver-runtime`, `browser-driver-engine`, `browser-driver-tools` | `daedlo-runtime`, `daedlo-engine`, `daedlo-tools` |

The repository operation is a rename of the existing repository, preserving its
Git history, branches, tags, issues and pull requests. It does not create a new
repository or initialize a new Git history. Local checkout folder names are
independent: active checkouts and worktrees remain in place during this work.
Moving them requires coordination with their owners after active tasks finish.
Update repository URLs and remotes as part of the coordinated rename; a folder
called `browser-driver` can still use the renamed remote.

New runtime/tools packages retain the executable aliases `browser-driver` and
`browser-driver-release`. The `ninja-update` executable remains named as before.
These are **CLI aliases only**. The new runtime package does not install an
`@browser-driver/runtime` JavaScript import alias. Ordinary integrations moving to
the renamed package must update their dependency and source imports together and
verify the resulting combination. An existing old installation can keep running
its installed package. No npm or crates.io publication is implied by these names.

Rust can preserve a source import through an explicit Cargo package alias. For
example, after verifying and extracting a renamed crate into the indicated
integration-owned vendor directory:

```toml
[dependencies]
browser-driver-engine = { package = "daedlo-engine", path = "../vendor/daedlo-engine-0.1.4-alpha.4", version = "=0.1.4-alpha.4" }
```

This dependency key lets existing Rust code continue to use
`browser_driver_engine`; `package` identifies the actual renamed crate. The new
managed installer uses this Cargo mechanism in its generated slot overlay when
the selected package family differs from the registered dependency name. It does
not rewrite the customer's original Cargo manifest or source tree. This explicit
Rust alias does not provide a JavaScript package alias.

## Preserve released bytes and stored identities

Published alpha.3 and earlier kits, archives, digests, signatures, notices and
version-specific instructions remain immutable. Their original package names
are part of the verified identity. Do not rename an existing archive or installed
package folder to make it resemble a newer release.

The new tools accept either complete package family and reject a mixed runtime
and engine family. Old receipts remain valid for the bytes and scope they record;
they do not establish acceptance of renamed code.

Wire protocol 1, schema versions and stable report/store identifiers remain
unchanged. In particular, `browser-driver-report/1`, the
`browser-driver-release` manifest kind, `browser-driver-release-tools` receipt
kind, and `.browser-driver-release-store.json` ownership marker retain their
original meaning. Do not edit stored manifests, signed metadata, ownership
markers or historical receipts merely to remove the old name. Managed project
configuration, registration, trust pins and accepted installation identities are
preserved through the manager transition.

## Existing alpha.3 managers need a tools bootstrap

The immutable alpha.3 manager understands the original `browser-driver` archive
and package names. It **cannot install a future renamed Daedlo kit**. New tools
understand both families, including validating a retained legacy installation and
returning to a legacy slot, but an installed old manager does not gain that
capability from a new feed entry or CLI alias.

The first renamed update therefore needs a one-time, independently verified
installation of the new tools alongside the accepted old tools. The following is
the required migration sequence for a future qualified release, not a claim that
the live customer transition has passed:

1. Obtain the new tools from that release's trusted receipt and verify the exact
   archive and source identity. Install them in a fresh, separate tools directory
   outside the application. Retain the old tools, accepted slot, reports and
   browser cache for recovery. Follow that kit's offline installation commands.
2. Stop the old manager through its normal owned shutdown at a safe boundary.
   Resolve active runs, unsaved drafts or uncertain cleanup first; wait for final
   reporting and owned-resource cleanup. Keep attached application services and
   data intact. Do not run two managers against the same store.
3. Start the verified new tools using the **same existing configuration file**,
   registration, store and publisher key pin. Keep the configuration at its
   existing path so relative key paths keep their meaning. Do not reinitialize the
   store, reset its catalog checkpoint or replace trust keys to bypass a refusal.
4. Before requesting a renamed candidate, verify that the new manager recognizes
   the accepted legacy installation, verifies its source/slot/browser identity,
   launches it and completes its registered health check. Confirm normal owned
   shutdown. An inability to recover the accepted installation blocks the update.
5. In an isolated customer fixture, install the renamed candidate, verify its
   model/adapter and application assertions, activate it at a safe boundary, then
   revert to the retained legacy slot and verify that combination again. Preserve
   source, data and tools throughout; record exact versions, reports and cleanup.

For the new tools installation, the manager entrypoint is
`node_modules/@daedlo/release-tools/lib/ninja.mjs`; the old tools retain
`node_modules/@browser-driver/release-tools/lib/ninja.mjs`. The shared
[managed-update contract](ninja-update.md) still governs ownership and acceptance.
A package/store compatibility test alone is not this customer migration drill.

## Required before publishing alpha.4

Publishing renamed artifacts or adding them to the production update feed remains
blocked on the following release work:

- Verify the exact new tools bootstrap against an accepted alpha.3 installation,
  followed by the renamed package upgrade and legacy rollback in a disposable
  customer fixture. Record source, data, accepted-tool and resource preservation.
- Define and verify manager capability signalling and the feed rollout so legacy
  clients are not offered an unsupported renamed update. A version label or
  unchanged manager contract number alone does not establish that support.
- Verify the exact built runtime, engine, tools and kit together, including
  installation instructions, imports, both CLI names, browser acceptance,
  signing/checkpoint continuity and recovery. Source tests are only part of this
  gate.
- Update and test website command rendering for the selected package family.
  Current website templates intentionally target the immutable alpha.3 package
  names; changing only a version number would produce incorrect renamed-kit
  installation commands.
- Obtain the separately required release/publication authorization. Repository
  visibility, package publication, website deployment and customer dependency
  promotion are distinct actions.

The currently published alpha.3 feed and downloads retain their existing names
until an explicitly authorized, verified rollout. See the
[release guide](releases.md) and [verification record](verification.md) for the
release boundary and actual status.
