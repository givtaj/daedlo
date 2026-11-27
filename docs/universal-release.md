# Install Daedlo Universal alpha.6 with live recording

Daedlo Universal gives a local workspace its own target histories, run reports, evidence and reviewed notes. The separate recording runtime supplies journal checkpoints for an authored application's live session. Install both versioned archives in a new directory and keep each application's existing installation and data in place.

## Download and verify

Use Node 24.22.2 or 22.23.4, npm 11.21.2, Git and Rust 1.96.0. The live example also needs Playwright Chromium and its operating-system dependencies. The release downloads include the public Rust model SDK, the two npm archives and verification records. The model SDK is the exact public Daedlo engine crate from the basic alpha.9 release.

Run from an empty directory. The fixed hashes below identify the packages before npm or Cargo uses them. Compare the complete checksum-list digest with the one in the [Universal prerelease notes](https://github.com/givtaj/daedlo/releases/tag/universal-v0.1.0-alpha.6).

```sh
set -eu
release_dir="$PWD"
version=0.1.0-alpha.6
base="https://github.com/givtaj/daedlo/releases/download/universal-v$version"
for asset in SHA256SUMS release.json INSTALL.md UNIVERSAL_VERIFICATION.json UNIVERSAL_RUNTIME_VERIFICATION.json UNIVERSAL_SHA256SUMS "daedlo-universal-$version.tgz" "daedlo-universal-runtime-$version.tgz" daedlo-engine-0.1.4-alpha.9.crate; do
  curl --proto '=https' --fail --show-error --location "$base/$asset" --output "$asset"
done
shasum -a 256 SHA256SUMS
shasum -a 256 -c SHA256SUMS
shasum -a 256 -c <<'CHECKSUMS'
3f32ad5cbad60c649b96b0c989bbb47eb168d325f46b9d1a717ce4b5bbf8a6f9  daedlo-universal-0.1.0-alpha.6.tgz
40c49a9152870bd31a0df87354f0ef55c00830f6a6d41da9c4e1155d09cc261a  daedlo-universal-runtime-0.1.0-alpha.6.tgz
aa870ad72c7e5224e014800c59aa7294c1cf47c712239a8c08813230cb939139  daedlo-engine-0.1.4-alpha.9.crate
CHECKSUMS
```

## Install the workspace and recording runtime

```sh
mkdir "$release_dir/consumer"
npm install --prefix "$release_dir/consumer" --workspaces=false --ignore-scripts --no-audit --no-fund \
  "$release_dir/daedlo-universal-$version.tgz" \
  "$release_dir/daedlo-universal-runtime-$version.tgz"
"$release_dir/consumer/node_modules/.bin/daedlo-universal" --help
"$release_dir/consumer/node_modules/.bin/playwright" install chromium
```

The companion package is `@daedlo/universal-runtime@0.1.0-alpha.6`. It resolves Playwright 1.65.0. On Linux, use `playwright install --with-deps chromium` when system packages are needed. Keep the generated consumer lockfile for subsequent installs.

## Record and read a local live run

The public notebook example starts a disposable application, runs an authored browser save with the packaged recording runtime, and reads back the saved note. The model build uses the downloaded alpha.9 SDK and locked dependencies in a fresh directory. Run the example from that model directory so its journal records the model sources used by the binary. The workspace retains the run after the application and browser close. Use a fresh absolute output directory outside the checkout and the installation directory.

```sh
git clone --depth 1 --branch "universal-v$version" https://github.com/givtaj/daedlo.git "$release_dir/source"
cd "$release_dir/source"
test "$(git rev-parse HEAD)" = "$(node -p 'require(process.argv[1]).sourceCommit' "$release_dir/release.json")"
sh examples/universal-live/build-model.sh \
  "$release_dir/daedlo-engine-0.1.4-alpha.9.crate" "$release_dir/notebook-model"
node "$release_dir/notebook-model/examples/universal-live/record.mjs" \
  --install "$release_dir/consumer" \
  --output "$release_dir/notebook-work" \
  --engine "$release_dir/notebook-model/target/debug/notebook-engine"
"$release_dir/consumer/node_modules/.bin/daedlo-universal" history \
  --workspace "$release_dir/notebook-work/data" --target example-notebook
```

For a customer integration, use its separately accepted model, authenticated browser context, guarded adapter and independent application readback. Register each environment and account as a distinct target. The reviewed integration runner connects each installed live session to its target journal, as demonstrated by `record.mjs`. Installations using the basic managed launcher require their own runtime compatibility check. Keep application data, login material, browser profiles and source bindings private. [Recording example](https://github.com/givtaj/daedlo/tree/universal-v0.1.0-alpha.6/examples/universal-live)

## Back up, restore and roll back

Stop active sessions, writers and the Universal service. Use the installed `daedlo-universal backup --workspace WORKSPACE --output NEW_BACKUP` and `daedlo-universal verify-backup --backup NEW_BACKUP`. Restore into a fresh directory with `daedlo-universal restore --backup NEW_BACKUP --workspace NEW_WORKSPACE`. Inspect the restored target history before preparing live application bindings.

Before an explicit schema-4 upgrade, keep a verified backup of the same workspace at schema 3. With alpha.6 tools, `rollback --workspace WORKSPACE --backup PRE_UPGRADE_BACKUP --output NEW_OLD_WORKSPACE --preserve NEW_LATEST_BACKUP --catalog-version 3` preserves newer work before restoring the older boundary. Use a reader compatible with the rollback schema. Recover newer changes by restoring the preserved backup with alpha.6 into another new directory.

This release distributes the workspace, recording runtime and public model SDK as downloads. The November 17 Linux ARM64 checks covered a local container build. The November 27 isolated customer checks covered macOS ARM64, storage-only retries and independent application readback. [Workspace usage](https://github.com/givtaj/daedlo/blob/universal-v0.1.0-alpha.6/packages/universal/README.md)
