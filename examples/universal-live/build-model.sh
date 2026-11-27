#!/bin/sh
# Build a copy of the tagged notebook with the SDK distributed in this release.
set -eu
if [ "$#" -ne 2 ]; then
  echo "Usage: sh build-model.sh SDK_CRATE NEW_MODEL_DIRECTORY" >&2
  exit 2
fi
sdk=$1
model=$2
source_dir=$(CDPATH= cd "$(dirname "$0")/../.." && pwd)
expected=aa870ad72c7e5224e014800c59aa7294c1cf47c712239a8c08813230cb939139
actual=$(shasum -a 256 < "$sdk" | cut -d ' ' -f 1)
if [ "$actual" != "$expected" ]; then
  echo "SDK checksum mismatch" >&2
  exit 1
fi
umask 077
mkdir "$model"
model=$(CDPATH= cd "$model" && pwd)
mkdir -p "$model/examples" "$model/crates/daedlo-engine"
cp "$source_dir/Cargo.toml" "$source_dir/package.json" "$source_dir/package-lock.json" "$model/"
cp -R "$source_dir/examples/notebook" "$source_dir/examples/notebook-engine" "$source_dir/examples/universal-live" "$model/examples/"
tar -xzf "$sdk" -C "$model/crates/daedlo-engine" --strip-components=1
# Keep the tagged model and all third-party dependency pins. Only the SDK changes.
sed 's/=0\.1\.4-alpha\.12/=0.1.4-alpha.9/' "$source_dir/examples/notebook-engine/Cargo.toml" > "$model/examples/notebook-engine/Cargo.toml"
sed '/^name = "daedlo-engine"$/ {
  n
  s/"0\.1\.4-alpha\.12"/"0.1.4-alpha.9"/
}' "$source_dir/Cargo.lock" > "$model/Cargo.lock"
cargo build --locked --manifest-path "$model/Cargo.toml" --target-dir "$model/target" -p notebook-engine
