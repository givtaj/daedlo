# Daedlo developer preview {{VERSION}}

Daedlo is a local, visible browser QA workbench. This kit contains the runtime,
shared Rust engine library, portable release tools and agent instructions. An
agent helps connect one existing application flow to a customer model and adapter;
the kit does not discover your application or include a prebuilt customer engine.

Read [LICENSE](LICENSE), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the
included component notices for the applicable permissions. Daedlo is the product
brand operated under its owner's autónomo activity; it is not a separate company.

## Before installing

Use Node.js 22+ with npm, Rust/Cargo 1.96.0+, and the runtime's pinned Playwright
1.62.1 with matching Chromium. Docker is needed only when your application's
chosen fixture requires it. Windows and a fresh-machine setup are not established
by the kit's package verification; check the website's release record for tested
environments and limits.

The portable tools have no npm dependencies or install scripts and install
offline. Runtime dependencies, Chromium, Rust dependencies and missing toolchains
need their normal downloads or populated caches. This kit is independent of the
private source repository, but it is not a completely offline SDK.

Download the ZIP from the selected [Daedlo release](https://daedlo.com/). Compare
its SHA-256 with the digest shown in that release record before extracting into
a new directory outside your application and any npm workspace. The extracted
folder is `daedlo-{{VERSION}}`:

```text
daedlo-{{VERSION}}/
├── START_HERE.md, AGENT_START.md
├── LICENSE, THIRD_PARTY_NOTICES.md, licenses/
├── bundle/    exact runtime .tgz, engine .crate, manifest.json, SHA256SUMS
└── tools/     tools .tgz, TOOLS_SHA256SUMS, TOOLS_VERIFICATION.json
```

The [manifest](bundle/manifest.json) identifies the runtime and crate; the
[tools receipt](tools/TOOLS_VERIFICATION.json) identifies the portable tools.
Checksums detect changed bytes when checked against a trusted expected digest;
the kit's own inventories do not independently authenticate its source.

## Verify and install the tools

Open a terminal inside the extracted `daedlo-{{VERSION}}` folder. Run this block
on macOS or Linux. It checks the tools archive before executing its code, creates
`installed-tools` inside the kit, and verifies the runtime/crate bundle:

```sh
(
  set -eu
  driver_kit="$(pwd -P)"
  node --input-type=module - "$driver_kit/tools/browser-driver-tools-{{VERSION}}.tgz" <<'NODE'
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const digest = createHash('sha256').update(readFileSync(process.argv[2])).digest('hex');
if (digest !== '{{TOOLS_SHA256}}') throw new Error('Tools archive digest mismatch.');
console.log('Tools archive digest verified.');
NODE
  mkdir "$driver_kit/installed-tools"
  cd "$driver_kit/installed-tools"
  npm install --offline --ignore-scripts --no-audit --no-fund \
    "$driver_kit/tools/browser-driver-tools-{{VERSION}}.tgz"
  node node_modules/@browser-driver/release-tools/lib/consumer-cli.mjs \
    verify --bundle "$driver_kit/bundle" --sha256 '{{MANIFEST_SHA256}}'
)
```

Stop if any step fails. `mkdir` deliberately refuses an existing tools directory;
inspect a prior installation or choose another fresh kit location before retrying.
Do not bypass a digest or compatibility failure. A successful check establishes
package integrity and measured toolchain compatibility, not your application's
behavior. Keep the verified kit in a durable location for installation and rebuilds.

## Connect your application

Open your application project in Codex or Claude Code and follow
[AGENT_START.md](AGENT_START.md). The agent reads the bundled instructions, reuses
accepted behavior and builds a separate QA integration. Your application keeps its
own implementation language. The integration supplies a native Rust model, a
guarded JavaScript adapter, a project module and evidence for one useful flow.

The tools directory contains the complete skill at
`node_modules/@browser-driver/release-tools/skills/browser-driver`. Copy the whole
folder, including its references, assets and notices, only into an unused project
skill location. Preserve any existing customization; the agent guide covers both
host paths. Copying the skill alone does not verify that the host discovered it.

After integration, the `browser-driver` CLI opens a new controlled browser and
prints a local viewer URL. The default is headless Chromium with a visible viewer;
`--headed` opens a native browser window. Startup does not sign in or run authored
commands automatically. Authored flows execute without a model API key or Daedlo
account; the coding agent uses your chosen agent host. The kit provides no hosted
QA service.

## Future updates

Choose a new version from the Daedlo website, download its separate kit and verify
it in a fresh directory. Test the candidate with your model and adapter before
changing accepted dependencies or launchers. Preserve the previous complete
combination for rollback.

The portable CLI's current `check` and `download` commands use GitHub and require
access to the selected repository; they do not discover or download website
releases. Website updates are manual. The local `update` command only selects
archives in a store; it does not install them into your application. No background
updater is installed.
