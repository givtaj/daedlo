# Current Roots clone onboarding and driver comparison — 2026-10-05

The released `v0.1.1-rc.2` runtime and crate ran successfully against current Roots
in a self-contained clone after scoped customer-integration work. Six current
canonical recipes matched the original driver: draft retention, creation response
loss/retry, and four Journal edit recipes. This is **partial current Roots coverage**:
the original driver passed all 18 recipes; the new customer bridges expose six.
Deletion and standalone Strains remain unsupported by these new bridges.

## Exact tested identities

| Component | Identity |
| --- | --- |
| Roots application and original driver | `fc099641691000e3c37cba8c690c532764981e3a`, committed source only |
| Released browser-driver source | `691dabc6c56e5562cb2eced9e6ba49158f326099` |
| Release manifest SHA-256 | `d98c81bd79654d99fc5f200ccc1008da1bf39a9bf968acb8b728e9e0cbe0d22f` |
| Runtime archive SHA-256 | `3b8b4efe7d9fe5359da4bbc3e6eac6c9b4f69c7b8e4f94407aa2d9f98d3f3661` |
| Shared crate SHA-256 | `f178883e942ac085c4e5ea1e61bdd6a4ca0a855ed6a97d929262ee02924c75b3` |
| Complete agent-skill archive SHA-256 | `ad34c84886ff83a406a9bacd66bca8eea00c8b1106c6d9fc6a66c4bbcf70a871` |
| Customer models | `roots-basic / fc099641-journal-basic-v1`; `roots-edit / fc099641-journal-edit-v1` |

The release verifier used the independently supplied manifest digest. All 17
installed runtime files matched their archive members. The matching extracted
crate is a clone-local Cargo path dependency with exact version `=0.1.1-rc.2`.
Neither shared package was changed. Binary identities, lockfiles and public-import
installation are recorded privately in `identities.json` and the clone.

All artifact paths below are relative to ignored
`artifacts/current-roots-onboarding-20261005/`. The clone is `roots-clone/`, created
using `git clone --no-local --no-hardlinks` and detached at the chosen commit.
There are no Git alternates or hardlinked object files. The complete skill folder
is installed at `roots-clone/.agents/skills/browser-driver/`; its instructions were
explicitly read and used. Automatic skill discovery and Claude Code execution
were not tested.

## Fresh results and evidence

| Check | Result | Evidence and limits |
| --- | --- | --- |
| New basic bridge | PASS, 4 groups | `basic-run02/results.json`: invalid/valid authentication, canonical draft retention, retained-draft save, canonical lost-response retry |
| New edit bridge | PASS, 6 groups | `released-edit-run02/results.json`: valid auth, direct draft retention, four canonical edit recipes |
| Original current driver | 19 PASS, 1 FAIL | `legacy/results.json`: all 18 recipes and Strains smoke pass; authentication group failed at its second valid sign-in verification |
| Supplemental equivalent re-sign-in | PASS on both | `resignin-comparison.json`: Journal → sign out → Profile → sign in → Journal; all ten commands completed |
| Customer bridge regressions | PASS | Basic: 11 Node + 2 Rust; edit: 13 Node + 5 Rust |
| Current original driver contracts | PASS | 35 Node + 42 Rust tests; `legacy-node-tests-final.log`, `legacy-rust-tests.log` |
| Viewer presentation | INSPECTED live in Codex | All three actual viewers opened; runtime command navigation and sign-out/re-sign-in operated in visible viewer |
| Original checkout preservation | PASS for recorded inventory | Same HEAD/status and 3,274 recorded source/untracked/relevant binary/lock/index identities; zero changed paths |

The first legacy invalid/valid sign-in succeeded, as did sign-out and the protected
Profile observation. Its second valid sign-in returned an expected-destination
verification error although the screenshot showed a signed-in Profile and later
commands authenticated normally. The original failed record is retained. A later
explicit equivalent sequence passed on both drivers. This is an observed transient
legacy verification mismatch, with cause unresolved; it is neither a failed
application login nor a demonstrated fix by the new driver.

Persistence checks used the UI, fresh application API reads and the respective
owned PostgreSQL database. Draft retention preserved exact fields and wrote no
experience; its canonical recipe intentionally saved one private strain. Saving
the retained draft wrote one experience and one creation receipt. Lost-response
creation submitted the same operation twice and added exactly one experience and
one receipt. Edit response loss similarly advanced the created entry to version 1
once. Cancellation left version 0. Other entries remained identical. Edit reload
and restart checks restarted only that fixture's API.

Original deletion recipes checked exact target removal, neighbors, calendar
counts, retry and restart assertions. Final database evidence had nine active
entries, three tombstones, and no retained deleted fields in either tombstones or
historical receipt payloads. These are fresh **original-driver** results; they do
not certify deletion through the released-driver bridges. The comprehensive
20-case deletion, 17-case edit and 11-case Strains suites were not rerun here.

## Coverage and parity matrix

“Matched” means the selected parameters and accepted assertions ran on both drivers
at this same application revision. It does not certify every guard, error branch
or input value. “Unsupported” describes these clone-local customer bridges, not an
inherent limitation of the shared runtime. “Not run” remains distinct from failure.
The new basic bridge is newly authored from the reviewed customer architecture;
it is not the historical 15-command `d4008e3` consumer. The edit bridge is adapted
from the narrower reviewed overlay, using the current committed model.

| Current canonical recipe | Original current driver | New customer bridge | Parity |
| --- | --- | --- | --- |
| `shared-selected` | PASS | Not exposed | Unsupported |
| `more-choices` | PASS | Not exposed | Unsupported |
| `cancelled` | PASS | Not exposed | Unsupported |
| `unspecified-strain` | PASS | Not exposed | Unsupported |
| `draft-retained` | PASS | PASS | Matched |
| `keyboard-saved` | PASS | Not exposed | Unsupported |
| `failed-save-retry` | PASS | Not exposed | Unsupported |
| `lost-response-retry` | PASS | PASS | Matched |
| `history-load-retry` | PASS | Not exposed | Unsupported |
| `strain-load-retry` | PASS | Not exposed | Unsupported |
| `edit-save` | PASS | PASS | Matched |
| `edit-cancel-retained` | PASS | PASS | Matched |
| `edit-lost-response-retry` | PASS | PASS | Matched |
| `edit-persisted` | PASS | PASS | Matched |
| `delete-cancel` | PASS | Not exposed | Unsupported |
| `delete-confirmed` | PASS | Not exposed | Unsupported |
| `delete-lost-response-retry` | PASS | Not exposed | Unsupported |
| `delete-persisted` | PASS | Not exposed | Unsupported |

Current Roots declares 54 direct commands plus seven internal recipe actions. The
two new bridges expose 19 of those direct commands and five internal actions.

| Current direct command | New bridge comparison |
| --- | --- |
| `home` | Matched in selected direct/recipe execution |
| `profile` | Matched in selected direct/recipe execution |
| `journal` | Matched in selected direct/recipe execution |
| `strains` | Unsupported; new bridge not run |
| `strains_search` | Unsupported; new bridge not run |
| `strains_add` | Unsupported; new bridge not run |
| `strains_fill` | Unsupported; new bridge not run |
| `strains_save` | Unsupported; new bridge not run |
| `strains_existing` | Unsupported; new bridge not run |
| `strains_cancel` | Unsupported; new bridge not run |
| `strains_more` | Unsupported; new bridge not run |
| `strains_retry_load` | Unsupported; new bridge not run |
| `strains_retry_more` | Unsupported; new bridge not run |
| `refresh_connections` | Unsupported; new bridge not run |
| `signin` | Different in initial legacy run; supplemental sequence matched (see finding) |
| `signin_invalid` | Matched in selected direct/recipe execution |
| `signout` | Matched in selected direct/recipe execution |
| `profile_edit` | Unsupported; new bridge not run |
| `profile_save` | Unsupported; new bridge not run |
| `delete_open` | Unsupported; new bridge not run |
| `delete_confirm` | Unsupported; new bridge not run |
| `delete_cancel` | Unsupported; new bridge not run |
| `delete_retry_load` | Unsupported; new bridge not run |
| `delete_retry` | Unsupported; new bridge not run |
| `delete_retry_refresh` | Unsupported; new bridge not run |
| `delete_review` | Unsupported; new bridge not run |
| `edit_open` | Matched in selected direct/recipe execution |
| `edit_fill` | Matched in selected direct/recipe execution |
| `edit_save` | Matched in selected direct/recipe execution |
| `edit_cancel` | Matched in selected direct/recipe execution |
| `edit_retry_load` | Unsupported; new bridge not run |
| `edit_retry_choices` | Unsupported; new bridge not run |
| `edit_more_choices` | Unsupported; new bridge not run |
| `edit_retry_save` | Matched in selected direct/recipe execution |
| `edit_retry_refresh` | Unsupported; new bridge not run |
| `edit_review` | Unsupported; new bridge not run |
| `edit_use_latest` | Unsupported; new bridge not run |
| `log_experience` | Matched in selected direct/recipe execution |
| `journal_fill` | Matched in selected direct/recipe execution |
| `journal_save` | Matched in selected direct/recipe execution |
| `journal_cancel` | Matched in selected direct/recipe execution |
| `add_strain` | Matched in selected direct/recipe execution |
| `strain_fill` | Matched in selected direct/recipe execution |
| `strain_save` | Matched in selected direct/recipe execution |
| `strain_existing` | Unsupported; new bridge not run |
| `strain_cancel` | Unsupported; new bridge not run |
| `strain_select` | Unsupported; new bridge not run |
| `strain_more` | Unsupported; new bridge not run |
| `retry_journal` | Unsupported; new bridge not run |
| `retry_strains` | Unsupported; new bridge not run |
| `retry_calendar` | Unsupported; new bridge not run |
| `mobile` | Unsupported; new bridge not run |
| `desktop` | Unsupported; new bridge not run |
| `reload` | Matched in selected direct/recipe execution |

| Internal action | New bridge comparison |
| --- | --- |
| `checkpoint` | Matched for the selected before/edit checkpoints |
| `assert` | Matched for the selected canonical assertions |
| `restart_api` | Matched for the edit persistence recipe |
| `fault_on` / `fault_off` | Matched for create/edit accepted-response loss |
| `shared_compare` | Unsupported; original shared-account recipe passed |
| `keyboard_save` | Unsupported; original mobile keyboard recipe passed |

Other direct-command branches remain NOT RUN unless exercised by a listed recipe
or the Strains smoke. In particular, full conflict review, account switching,
session expiry, interruption controls and every negative delete/Strains case are
not established by this comparison. The old extracted `journal-draft` recipe is a
different two-step opener and was not presented as canonical draft-retention parity.

## Onboarding work and measured friction

The agent reused the existing accepted Rust UX model and canonical recipe plans,
then supplied two ordinary public-runtime adapters and customer Rust bridges in
`roots-clone/QA/released-driver/{basic,edit}/`. JavaScript measures facts, performs
guarded actions and collects evidence; it does not own a duplicate transition graph.
No application behavior was changed.

1. Verified release/skill bytes, installed complete project-local skill, and used
   a private ESM integration package with its own lockfile and exact tarball pin.
   Web and legacy dependencies were independently installed in the clone. Cached
   npm installs took about 0.5 s (release), 0.9 s (web) and 0.2 s (legacy); the
   separate application build completed in 25.6 s. These are warm-cache timings.
2. Reproduced the old edit bridge rejecting current-shaped Journal observations
   containing inactive `delete` facts. The genuine failing model-contract assertion
   preceded forwarding those facts to the current Rust model. Unsupported active
   deletion states still fail closed. This red used synthetic current-shaped
   observations, not a failing browser scenario.
3. Added the two agreed creation recipes in a separate basic bridge. A failing
   recipe-catalog assertion preceded implementation. Canonical Rust steps are
   projected to the released command/params schema because a legacy `assertion`
   annotation is not a shared RecipeStep field; the actual deduplication assertion
   remains in the plan. A subsequent malformed synthetic test observation was
   corrected as test setup, not counted as product red/green evidence.
4. Visible inspection found copied source labels still naming the historical edit
   overlay. Failing display assertions preceded correcting both labels to the
   current commit. A fresh edit fixture reran all six groups successfully.
5. Docker was stopped; the user started Desktop. No restart/global cleanup occurred.
   Default Node 22 produced dependency engine warnings, so execution used the
   already-installed Node 24.21.0. Sandbox npm/cache, loopback and browser failures
   were setup failures; approved scoped reruns are retained. A legacy launch waited
   on approval and was interrupted before any process existed; the root agent then
   launched it successfully. These waits are not product runtime performance.
6. Legacy tests require their module-relative `target/debug/roots-qa-driver` despite
   a separate target build. Copying the trial-built binary into that clone-only
   location fixed setup; final 35/35 passed. No original binary was read as build input
   or overwritten.

This was substantial customer integration, not an automatic zero-code install.
It is a fresh-context onboarding of an already-known application with reusable
contracts, not proof of onboarding an unfamiliar second customer.

## Actual viewer experience

All three controlled browsers are **headless Chromium streamed into visible Codex
viewer tabs**. They are not native headed browser windows. The original viewer
keeps available commands and learned flows in a compact sidebar, collapses
unavailable commands, and gives most width to the application. Its Rust state names
are detailed but long. The released viewer supplies a generic nested state tree,
per-command inputs, build identity, execution status and separate application
effect labels. The edit result clearly distinguishes “Setup entry: Saved” from
“Requested edit: Saved” or “Not attempted”.

The generic layout leaves less room for the application at the inspected panel
width and requires more scrolling through command cards/state leaves. Internal
checkpoint/assert/fault controls are visibly offered as commands; their adapters
reject direct use outside an active recipe, but this is confusing authoring/UI
friction. The generic state tree is descriptive, broader than the tested surface,
and must not be read as complete feature coverage. These observations did not
trigger changes to the immutable release UI.

## Reproduce and retained ownership

Use the retained clone. The launchers require Docker running and Node 24+, and
create only new disposable fixtures. The published packages, extracted crate,
lockfiles, customer sources and build outputs remain inside this ignored trial.
From `roots-clone/`:

```sh
node QA/released-driver/run-edit-trial.mjs released-edit-run03
node QA/released-driver/basic/run-trial.mjs basic-run03
```

Use a new output directory name; existing run evidence is not overwritten. Both
commands assume the separately built `../app-target/debug` binaries and built
customer engines. Their local READMEs provide exact locked Cargo build/test
commands. `legacy/run.mjs`, from the enclosing trial, launches the original driver
with an explicit binary path; preserve its existing evidence in a new copy/directory
before repeating. It runs all 18 recipes and the auth/Strains checks.

At handoff, three useful independent demos are retained. Their exact loopback URLs,
owner PIDs, current API replacement PIDs, browser profile/process descendants,
Compose project labels/storage/ports and cleanup commands are in private
`*/owned-resources.json` and `*/live.json`. Do not rely on an initial live receipt's
API PID after a restart; use the current on-disk fixture manifest.

From the browser-driver root, inspect ownership or stop one selected owner:

```sh
node artifacts/current-roots-onboarding-20261005/owned-resources.mjs
node artifacts/current-roots-onboarding-20261005/owned-resources.mjs released-edit-run02 --stop
node artifacts/current-roots-onboarding-20261005/owned-resources.mjs basic-run02 --stop
node artifacts/current-roots-onboarding-20261005/owned-resources.mjs legacy --stop
```

The helper rechecks the owner command before SIGTERM. The owner closes its own
viewer/browser/driver and disposable fixture; inspect `cleanup.json` and rerun the
ownership inventory to verify completion. The first edit fixture was fully cleaned
and its receipt is retained. Basic run01 failed before resource startup. Failed
cleanup must retain its handles: the reused fixture helper latches cleanup, so a
partial failure needs explicit inspection of current process paths and exact
Compose labels/mounts before manual recovery, not global killing or pruning.

The original Roots checkout was read-only. Its unrelated dirty and untracked
work remained present and byte-identical in the recorded inventory. This is a
scoped inventory, not a forensic proof of every ignored file or live database.
No tests attached to normal Roots sessions/services/data. No everyday dependency
promotion, release publication, CI change, history rewrite or automatic sync was
performed. Only this sanitized report and browser-driver verification records are
tracked; credentials, raw data, identities and traces remain ignored.
