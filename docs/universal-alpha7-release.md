# Install Daedlo Universal alpha.7

Universal keeps each target’s recorded runs, evidence and reviewed notes in a local workspace. The alpha.7 workspace fixes the installed `daedlo-universal` command. Live recording pairs it with the alpha.6 recording runtime and the public alpha.9 Rust model SDK. An existing alpha.6 workspace installation can still use its [direct-file CLI instructions](https://github.com/givtaj/daedlo/blob/affe85aedb84b265011e614e6e338bbcad0c83ee/docs/universal-alpha6-cli.md).

## Download and verify

Use Node 22.23.4 or 24.22.2, npm 11.21.2, Git and Rust 1.96.0. The live example needs Chromium and its operating-system dependencies. Run these commands in an empty directory using a Unix shell. Compare the printed SHA-256 of `SHA256SUMS` with the digest in the [alpha.7 release notes](https://github.com/givtaj/daedlo/releases/tag/universal-v0.1.0-alpha.7), then verify the files.

```sh
set -eu
release_dir="$PWD"
version=0.1.0-alpha.7
runtime_version=0.1.0-alpha.6
base="https://github.com/givtaj/daedlo/releases/download/universal-v$version"
for asset in SHA256SUMS release.json INSTALL.md UNIVERSAL_VERIFICATION.json UNIVERSAL_RUNTIME_VERIFICATION.json UNIVERSAL_SHA256SUMS "daedlo-universal-$version.tgz" "daedlo-universal-runtime-$runtime_version.tgz" daedlo-engine-0.1.4-alpha.9.crate; do
  curl --proto '=https' --fail --show-error --location "$base/$asset" --output "$asset"
done
shasum -a 256 SHA256SUMS
```

```sh
shasum -a 256 -c SHA256SUMS
shasum -a 256 -c <<'CHECKSUMS'
7cda746ce1b5e31bb5a558d330dd29b453f81a47d7ee6d185ffb7c60bd2414b4  daedlo-universal-0.1.0-alpha.7.tgz
40c49a9152870bd31a0df87354f0ef55c00830f6a6d41da9c4e1155d09cc261a  daedlo-universal-runtime-0.1.0-alpha.6.tgz
aa870ad72c7e5224e014800c59aa7294c1cf47c712239a8c08813230cb939139  daedlo-engine-0.1.4-alpha.9.crate
CHECKSUMS
```

## Install locally for live recording

```sh
mkdir "$release_dir/consumer"
npm install --prefix "$release_dir/consumer" --workspaces=false --ignore-scripts --no-audit --no-fund \
  "$release_dir/daedlo-universal-$version.tgz" \
  "$release_dir/daedlo-universal-runtime-$runtime_version.tgz"
export PATH="$release_dir/consumer/node_modules/.bin:$PATH"
daedlo-universal --help
playwright install chromium
```

Help starts with `Daedlo Universal (optional installation)`. The companion resolves Playwright 1.65.0. On Linux, run `playwright install --with-deps chromium` when system packages are needed. Keep the consumer lockfile for later installations.

For a standalone workspace CLI, npm can also install the same workspace archive globally. This example uses a fresh user-owned prefix. The subshell keeps the local recording installation selected for the remaining steps.

```sh
(
  npm install --global --prefix "$release_dir/cli-prefix" --ignore-scripts --no-audit --no-fund \
    "$release_dir/daedlo-universal-$version.tgz"
  export PATH="$release_dir/cli-prefix/bin:$PATH"
  daedlo-universal --help
)
```

## Record and read a live run

The notebook example builds an authored model with the released SDK and locked Rust dependencies. It opens a disposable application and browser, saves one note, then checks the application’s stored row through a separate request. Use a fresh output directory outside the source tree and the package installation.

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
workspace="$release_dir/notebook-work/data"
daedlo-universal history --workspace "$workspace" --target example-notebook
```

The receipt reports one attempted write, one server write and one stored row. The text read back is `Example note`. History includes the completed run after the browser closes. For another application, use its accepted model, authenticated context, guarded adapter and independent readback. Register each environment and account as a separate target. Keep login material, local browser profiles and application data private. [Recording example](https://github.com/givtaj/daedlo/tree/universal-v0.1.0-alpha.7/examples/universal-live)

## Back up, restore and roll back

Stop active sessions, workspace writers and the Universal service. Choose new backup and restore directories. Verify that the backup and verification results show the same SHA-256. The final comparison checks the restored run history against the original.

```sh
backup="$release_dir/notebook-backup"
restored="$release_dir/notebook-restored"
daedlo-universal backup --workspace "$workspace" --output "$backup"
daedlo-universal verify-backup --backup "$backup"
daedlo-universal restore --backup "$backup" --workspace "$restored"
daedlo-universal history --workspace "$workspace" --target example-notebook > "$release_dir/history.json"
daedlo-universal history --workspace "$restored" --target example-notebook > "$release_dir/restored-history.json"
cmp "$release_dir/history.json" "$release_dir/restored-history.json"
```

Before explicitly upgrading a workspace to catalog schema 4, keep a verified schema 3 backup of that workspace. With all writers stopped, the following command preserves the newer data and restores the older catalog into another directory. Use a schema-compatible reader on the restored workspace. The preserved backup can later be restored into a fresh directory with these tools. [Workspace commands](https://github.com/givtaj/daedlo/blob/universal-v0.1.0-alpha.7/packages/universal/README.md)

```sh
daedlo-universal rollback --workspace CURRENT_WORKSPACE --backup PRE_UPGRADE_BACKUP \
  --output NEW_SCHEMA_3_WORKSPACE --preserve NEW_LATEST_BACKUP --catalog-version 3
```
