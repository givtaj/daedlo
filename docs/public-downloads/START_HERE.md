# Daedlo assisted alpha {{VERSION}}

Daedlo is a local, visible browser QA workbench. This kit contains the runtime,
shared Rust engine library, portable release tools and agent instructions. An
agent helps connect one existing application flow to a customer model and adapter;
the kit does not discover your application or include a prebuilt customer engine.

The alpha onboarding scope is **macOS arm64 with Codex**, using one agreed
existing application flow and a relevant negative case. Exact-package and
customer-flow acceptance must be recorded for this version before release; these
instructions alone establish neither successful verification nor publication.

Read [LICENSE](LICENSE), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the
included component notices for the applicable permissions. Daedlo is the product
brand operated under its owner's autónomo activity; it is not a separate company.

## Before installing

Use existing Node.js 22+ with npm, Rust/Cargo 1.96.0+, and the runtime's pinned
Playwright 1.62.1 with matching Chromium. Docker is needed only when your
application's chosen fixture requires it. Linux, Windows, Claude Code onboarding,
fresh OS/toolchain installation and independent self-service onboarding are
outside this alpha's acceptance claim. Read the selected version's verification
receipt for measured results and limits.

The portable tools have no npm dependencies or install scripts and install
offline. Runtime dependencies, Chromium, Rust dependencies and missing toolchains
need their normal downloads or populated caches. This kit is independent of the
private source repository, but it is not a completely offline SDK.

Acquire the exact selected ZIP and its independently supplied verification receipt.
For a published kit, use the selected [Daedlo release](https://daedlo.com/); do
not assume the website carries an unpublished candidate. Compare the ZIP's
SHA-256 with the digest in that receipt before extracting into a new directory
outside your application and any npm workspace. The extracted folder is
`daedlo-{{VERSION}}`:

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

Open a terminal inside the extracted `daedlo-{{VERSION}}` folder. The macOS alpha
path uses this block. It checks the tools archive before executing its code, creates
`installed-tools` inside the kit, and verifies the runtime/crate bundle:

```sh
(
  set -eu
  driver_kit="$(pwd -P)"
  node --input-type=module - "$driver_kit/tools/{{PACKAGE_PREFIX}}-tools-{{VERSION}}.tgz" <<'NODE'
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const digest = createHash('sha256').update(readFileSync(process.argv[2])).digest('hex');
if (digest !== '{{TOOLS_SHA256}}') throw new Error('Tools archive digest mismatch.');
console.log('Tools archive digest verified.');
NODE
  mkdir "$driver_kit/installed-tools"
  cd "$driver_kit/installed-tools"
  npm install --prefix "$driver_kit/installed-tools" --workspaces=false \
    --offline --ignore-scripts --no-audit --no-fund \
    "$driver_kit/tools/{{PACKAGE_PREFIX}}-tools-{{VERSION}}.tgz"
  node node_modules/{{TOOLS_NAME}}/lib/consumer-cli.mjs \
    verify --bundle "$driver_kit/bundle" --sha256 '{{MANIFEST_SHA256}}'
)
```

The explicit installation prefix keeps npm inside `installed-tools`, even when
an ancestor directory is an npm workspace. Stop if any step fails. `mkdir`
deliberately refuses an existing tools directory;
inspect a prior installation or choose another fresh kit location before retrying.
Do not bypass a digest or compatibility failure. A successful check establishes
package integrity and measured toolchain compatibility, not your application's
behavior. Keep the verified kit in a durable location for installation and rebuilds.

## Connect your application

Open your application project in Codex and follow
[AGENT_START.md](AGENT_START.md). The agent reads the bundled instructions, reuses
accepted behavior and builds a separate QA integration. Your application keeps its
own implementation language. The integration supplies a native Rust model, a
guarded JavaScript adapter, a project module and evidence for one useful flow.

The tools directory contains the complete skill at
`node_modules/{{TOOLS_NAME}}/skills/{{SKILL_NAME}}`. Copy the whole
folder, including its references, assets and notices, only into an unused project
skill location. Preserve any existing customization. Explicitly read `SKILL.md`
and its linked references if automatic discovery is unavailable; copying or
reading the skill does not verify discovery.

After integration, the `{{SKILL_NAME}}` CLI opens a new controlled browser and
prints a local viewer URL. The default is headless Chromium with a visible viewer;
`--headed` opens a native browser window. Startup does not sign in or run authored
commands automatically. Authored flows execute without a model API key or Daedlo
account; the coding agent uses your chosen agent host. The kit provides no hosted
QA service.

## Finish the first flow

Your agent leaves the exact build and project-specific launch commands. Launch
with `--report` pointing to a fresh file in an existing ignored report directory.
Run the agreed flow and its negative case in the viewer. For a save, independently
read back the intended persisted data. Preserve those assertions alongside the
report; a screenshot or completed execution alone does not establish persistence.

When finished, send Ctrl+C once in the CLI terminal and wait for finalization.
Inspect the written session report and owned-resource cleanup. The report is the
final session view; it does not export every completed run or the application's
private persistence evidence. Preserve required per-run evidence separately.
Attached application services and browser sessions remain their owner's resources.
If cleanup fails, retain the handles and follow the CLI's Ctrl+C or SIGTERM retry
after investigating the owned resource. Do not terminate unrelated services.

Relaunch from the recorded integration with a new report filename and repeat the
authored flow from its documented prerequisites. Inspect and record final cleanup.
If the viewer is intentionally retained for inspection, record its owner and close
procedure; shutdown verification remains pending. A first-flow handoff is complete
when the agreed outcome, relevant rejection, repeat run and cleanup have evidence,
or a specific remaining blocker is reported without claiming completion.

## Future updates

Alpha.3 includes Operation Ninja-Update. Read
`installed-tools/node_modules/{{TOOLS_NAME}}/docs/ninja-update.md`.
The tools include the pinned production public key and preview feed metadata in
`docs/update-trust/production.json`. An agent registers the accepted model, flows,
adapter, dependency locks, isolated validation hooks and managed launcher once.
Then the local update screen offers Check, Install, Validate, Restart and Revert.
The complete previous installation stays available; rollback preserves business
writes and does not overwrite the authored project. A failed validation leaves
the accepted installation selected. Never substitute production data in test hooks.

The signed feed is `https://daedlo.com/updates/preview.json`. Trust the public key
bundled with this verified kit; do not automatically trust a replacement key from
the feed. Catalog expiry blocks new checks/installation, not existing local use
or rollback. The publisher renews signed metadata separately from release bytes.

Manual installation of a verified separate kit remains available. The legacy
portable `check` and `download` commands use GitHub and expect a different release
asset format; they are not the managed updater. The legacy local `update` command
selects archives only. No background installation or customer migration is enabled.
