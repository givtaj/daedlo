# Isolated Ninja-Update customer acceptance

`tests/ninja-architecture-acceptance.mjs` exercises the real manager, installer,
supervisor, control page, and runtime viewer against a disposable copy of the
pinned Architecture Studio application. It requires the retained accepted alpha
integration source and the public alpha.2 and local candidate kits. No application
source, adapter, model, flow, lockfile, or original project instructions are edited.
The three modules in this directory are a one-time managed entrypoint and isolated
acceptance hooks added to that exact source closure.

Run from the repository with existing macOS arm64 Node, Rust, and Playwright
Chromium toolchains. The default evidence directory is ignored by Git. Set:

- `NINJA_APP_CHECKOUT` to the approved Architecture Studio source checkout;
  the harness reads its pinned commit into a separate disposable fixture.
- `NINJA_TOOLS_ROOT` to the exact installed tools package's `lib`
  directory for packaged acceptance; omission uses current source modules.
- `NINJA_CANDIDATE_DIR` to a directory containing the candidate ZIP, `release.json`,
  and `SHA256SUMS`.
- `NINJA_ACCEPTED_KIT` and `NINJA_ACCEPTED_SOURCE` to retained public alpha.2 kit
  and accepted integration directories if their default artifact locations differ.
- `NINJA_CUSTOMER_OUTPUT` for a different durable output directory.
- `NINJA_WAIT_FOR_INSPECTION=1` to retain the updated viewer and control page until
  an independent inspector writes `{"status":"PASS"}` to the printed receipt path;
  the reverted viewer is retained for a second inspection receipt afterward.

The harness uses a freshly generated local catalog signing key and an in-memory
fetch seam serving the exact supplied archives. This checks signature and archive
verification without claiming a production feed. A separate registered acceptance
gate intentionally rejects one candidate after its real browser checks, proving
that preparation failure preserves the running installation and application data.

Success requires the same real empty-name rejection and exact save/reload flow on
alpha.2, the candidate, and the reverted installation; unchanged customer source;
matching model descriptors; exact API/disk data across activation and rollback;
one PUT per save and zero writes for invalid input; reports; driver relaunch; and
attached application survival. Runtime/crate packages are installed and the
customer Rust binary is rebuilt in separate owned installation directories.
Browser identity is bound to the existing executable, not bundled or downloaded
by this harness. Existing caches are disclosed; this is not a clean-OS claim.

Receipts preserve failed runs as well as successful runs. Only owned processes are
closed. Isolated installation directories are retained for inspection; customer
data and normal application services are never used.
