# Actual Roots work

This is the primary browser-driver example. It uses the real Roots application,
its original QA driver and evidence recorded while developing the project. The
archive contains actual results and screenshots, including failed attempts and
their corrections. It has no invented activity, sample metrics or fake live feed.

## Open the workbench

From the browser-driver repository, with Node 22+:

```bash
npm run demo
```

The printed loopback URL opens the Roots work archive. Choose a recorded run to
read its assertions, source identity, screenshots and limits. Results describe the
captured source at the recorded time; they do not certify today's working tree.
The archive works without Docker or a running Roots session.

The live card checks the separately launched Roots viewer. **Open live Roots**
opens the actual original driver and the browser it controls. A stopped viewer
remains unavailable; archive screenshots do not stand in for it. Closing the
workbench server does not stop the separately owned live fixture.

## Start the real Roots driver safely

Use Node 24+, the Roots Rust toolchain, Docker, installed Roots frontend and QA
runtime dependencies, and the installed Playwright Chromium. The preparation
checks dependency lockfiles before copying their installed dependencies. It never
installs into Roots or uses its live application binaries.

```bash
npm run roots:prepare
npm run roots:live
```

Preparation captures committed Roots
`dd9cee67e3886333a7fe8eb7f8545d428167fb07`, including the Strains implementation.
It builds the original API, CLI, database helper and QA engine offline from that
snapshot, in separate output. The launcher uses the snapshot's maintained
`QA/start-live-driver.mjs`, creates disposable PostgreSQL data and synthetic
accounts, and starts signed out on Home. The viewer URL is printed and recorded
for the workbench. Sign in using the viewer's offered command to use the fixture
account through the actual UI.

At the 2026-09-27 capture, the Roots folder consolidation was an uncommitted
candidate and was not copied into this committed example. Preparation preserves
the original checkout, dirty work, dependency files and normal services. Launching
creates a new browser session; it does not recover a previous browser's cookies or draft.

The archived 2026-09-27 consolidation receipt records locally verified work that
moved the engine/runtime into `tools/browser-driver/` while keeping the Roots
model, acceptance and evidence in `QA/`. It describes that captured checkpoint,
not later development. Read the canonical report and inspect an explicit source
revision on the next requested upstream review.

Useful overrides:

| Variable | Purpose |
| --- | --- |
| `ROOTS_SOURCE` | Read-only Roots source checkout; defaults to the local sibling project |
| `ROOTS_EXPERIENCE_COMMIT` | Explicit full committed revision; the default above is the reviewed source |
| `ROOTS_EXPERIENCE_ARTIFACTS` | Fresh output directory for an independent snapshot/run |
| `ROOTS_EXPERIENCE_TARGET` | Optional inactive compilation cache, never the normal Roots target |

Preparation refuses to overwrite an existing snapshot. Reuse its recorded build
with `roots:live`, or select a fresh artifacts directory for new preparation.
Different source layouts or dependency lockfiles need a deliberate update to the
preparation mapping, not a silent fallback. The source and binary hashes are
recorded under `artifacts/roots-experience/`.

Ctrl+C in `roots:live` asks the maintained launcher to close its owned browser,
viewer, API, frontend and disposable database. Pause/Stop in the viewer controls
driving; it does not roll back a completed save or delete a draft. Keep the live
process running when continuing an interactive exploration.

## Workflows learned from actual use

- **Journal composition:** save with no strain/rating, retain a complete draft
  across Home/Profile navigation, cancel an experience while retaining an
  explicitly saved private strain, and save through the keyboard on mobile.
- **Recovery:** fail a request before it reaches the server or lose a successful
  response, preserve the draft and operation identity, retry explicitly and use
  API evidence to prove exactly one record. Recover history, strain choices and
  calendar counts without claiming a failed read is an empty result.
- **Driver controls:** observe without changing the page, reject stale commands,
  pause/resume/stop at action boundaries, and reconnect the monitor without replay.
- **Strains:** search the whole accessible catalogue, paginate, add private names,
  reveal duplicates, correct validation, recover failures and clear private state
  on account change. Eighteen observed states and eleven passing scenarios are
  distinct forms of evidence.
- **UX feedback:** the earlier Profile exploration found draft loss, stale save
  feedback, focus loss and reload navigation loss. These remain historical
  findings at their recorded source, not automatic claims about the current UI.

See [the archive provenance](archive/README.md) and
[the original Roots command record](../../../roots/QA/driver-commands.md).
No original Roots release checklist is duplicated or updated by this example.

## Original Roots and the extracted candidate

The live reference runs Roots' original driver, with its existing customer
commands and recipes. It shows what the dedicated product is being built to
support. It does **not** claim that all those capabilities have already migrated
to `@browser-driver/runtime`.

The separately tested [standalone consumer](../../integrations/roots/README.md)
uses the public package on the earlier `d4008e3` baseline, with 15 commands and one
recipe. Its original acceptance and package identities remain valid for that
scope. The [notebook](../notebook/README.md) is only an independent conformance
fixture, available through `npm run demo:notebook`.

The user requests future Roots reviews and selective ports. There is no automatic
upstream synchronization, publication or migration of everyday Roots usage.
