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
fetch seam by default, serving the exact supplied archives. This checks signature
and archive verification without claiming a production feed. A separate registered acceptance
gate intentionally rejects one candidate after its real browser checks, proving
that preparation failure preserves the running installation and application data.

For acceptance against a published release, also set all four trust variables:

- `NINJA_PUBLISHED_CATALOG_URL`: the production HTTPS signed catalog URL.
- `NINJA_PUBLISHED_KEY_ID`: the expected publisher key ID.
- `NINJA_PUBLISHED_PUBLIC_KEY_FILE`: an independently pinned local public PEM file.
- `NINJA_PUBLISHED_KEY_SHA256`: SHA-256 of the **exact PEM file bytes**, not the DER
  SPKI fingerprint. The receipt records both fingerprints with distinct names.

Published mode uses the real provider's default HTTPS fetch for the catalog and
every archive, release metadata file, and checksum file. It neither injects fetch
responses nor generates a signing key. Both alpha.2 and alpha.3 must appear in the
authenticated catalog. The first test setup explicitly selects the authenticated
alpha.2 baseline and checks its ZIP against the retained immutable public kit;
subsequent discovery uses normal provider selection for alpha.3. The catalog
checkpoint must remain unchanged throughout the run. `NINJA_CANDIDATE_DIR` is
unused in this mode. Use the exact installed release tools through
`NINJA_TOOLS_ROOT`; the same real flows, deliberate hook rejection, rollback,
preservation, reporting, and cleanup assertions still run.

`node tests/ninja-architecture-acceptance.mjs --test-published-config` checks
fail-closed transport and trust configuration without starting an application.
With the four trust variables set, `--published-preflight` verifies the local
public key and prints its fingerprints without network access, installation, or
application startup. The full published run preserves the authenticated catalog,
public key, and distinct real transport/download receipts in its output directory.

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
