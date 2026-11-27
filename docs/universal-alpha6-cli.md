# Run the installed Universal alpha.6 CLI

On Unix, the npm `.bin/daedlo-universal` symlink in alpha.6 can exit successfully without running the command. Use Node to run the CLI file in the installed package. After installing the two verified archives, set these variables from the release directory that contains `consumer/`. [Alpha.6 installation guide](universal-release.md)

```sh
release_dir="$PWD"
universal_cli="$release_dir/consumer/node_modules/@daedlo/universal/src/cli.mjs"
node "$universal_cli" --help
```

Help prints `Daedlo Universal (optional installation)` and the available commands. After the guide's notebook example finishes, inspect its saved run with the same CLI file.

```sh
workspace="$release_dir/notebook-work/data"
node "$universal_cli" history --workspace "$workspace" --target example-notebook
```

The history contains one completed run. Stop workspace writers before making a backup. Choose fresh backup and restore directories. Verify the backup, restore it, and compare the restored history with the original run.

```sh
backup="$release_dir/notebook-backup"
restored="$release_dir/notebook-restored"
node "$universal_cli" backup --workspace "$workspace" --output "$backup"
node "$universal_cli" verify-backup --backup "$backup"
node "$universal_cli" restore --backup "$backup" --workspace "$restored"
node "$universal_cli" history --workspace "$restored" --target example-notebook
```

The backup and verification results show the same SHA-256. The restored history includes the original run ID. Use `node "$universal_cli"` for the other workspace commands in the guide, including `serve` and `rollback`.
