# SeeRuntime isolated onboarding — 2026-10-06

The agreed Node.js **I/O round trip** flow passed against the released
`0.1.1-rc.2` runtime/crate pair and a separate local `0.1.1-rc.3` candidate.
Both used the same customer Rust model and JavaScript adapter. After the candidate
passed, the accepted rc.2 session successfully ran its canonical recipe again;
its package pins, lockfiles, model source and compiled engine remained unchanged.
This is an isolated compatibility result, not an everyday application upgrade.

## Measured results

| Check | Result |
| --- | --- |
| Customer Rust model | 6/6 pass for each package pair |
| Fresh integration behavior | Genuine initial model assertions failed for Idle/Playing derivation, then passed after implementation |
| Archive preparation | 3/3 pass: regular files accepted; links and wrong package prefix rejected |
| Released rc.2 browser | 9 checks pass |
| Local rc.3 browser | The same 9 checks pass |
| Accepted rc.2 after candidate | Public viewer recipe completed successfully and returned to Ready |
| Consumer preservation | Both consumers' recorded package/lock/model/binary bytes unchanged across final runs |
| Application preservation | Live HEAD/status and all 142 inventoried tracked/nonignored files unchanged; 42 dirty entries preserved |
| Served source | All 35 `dist` files matched the pinned Git blobs; tree identity unchanged before/after each run |
| Visible result | Application and viewer screenshots inspected: connected, visible Node topology, 11 I/O events, Ready and Success |

The nine browser checks are lesson selection, Step, Play with measured progress,
Pause with a stationary timeline, another single-event Step, Reset, the complete
six-command canonical recipe, rejected Pause from Idle, and a final successful
Reset. They independently inspect selected model/scenario, event labels/counts,
active event and timeline. The final reset leaves the retained viewer ready for
the next person while the rejected-command evidence remains recorded.

## Exact identities

- SeeRuntime source commit: `068d573051f7e43213ba547f842624f6551706f6`.
- Source archive SHA256: `b66db92bfdd56201f6cc85b7bf58f2e9a3fbc5fe0d2f41d076cb3db606fadef3`.
- Served tree SHA256: `b4eeaa1b477e221720237b99b9f59b3f4204815d0bfbce1343afbea7070403ca`.
- Customer model SHA256: `dccdbfd29468944eadb1efde7ebd487482830449f938cbcc7b6ee43b478a0529`.
- Customer adapter SHA256: `1a62df69ca6519d81b9326cd3d3133dc3cd7274203e96446b7923aa7503fce56`.
- Released rc.2 trusted manifest SHA256: `d98c81bd79654d99fc5f200ccc1008da1bf39a9bf968acb8b728e9e0cbe0d22f`.
- Local rc.3 manifest SHA256: `9fff3c15e3eda90fdd1e6342ef5f7cc1f5f90a273df593619770c5490a2e5799`.

The rc.3 bundle explicitly has a dirty-source development receipt and is not a
published release. Exact archive and compiled-engine digests are retained in the
private trial evidence. Rust model versions identify a customer's observation
contract, independently of the driver's package version.

## Evidence and retained resources

Local ignored evidence is under `artifacts/seeruntime-trial-20261006/`:
`rc2-final/results.json`, `rc3-final/results.json`, screenshots,
`accepted-after-candidate.json`, `source-identity.json`, preservation receipts,
model red/green logs and preparation tests. The earlier initial rc.2 attempt is
kept separately under `rc2/`; it is not substituted for the final runs.

Two final sessions are intentionally retained. Each owns only its isolated static
server, Chromium context/browser and live viewer. Their current locations, PIDs,
cleanup instructions and replaced-run status are in the private `HANDOFF.md` and
per-run `owner.json`. Roots services were not touched by this trial.

## Limits

This verifies one existing Node playback flow on the committed application,
not every SeeRuntime model, mobile layout or live uncommitted feature. Complete
playback and replay states are modeled but were not exercised to the end in this
browser trial. The application is an educational simulation, not a real Node
runtime trace. There are no accounts, API/database writes, clipboard operations
or persistence claims. Google font requests were blocked in the owned context.

File preservation evidence excludes ignored files, external data and running
services; the trial did not issue mutations against those resources. Claude Code
skill discovery, public registry installation and automatic updates are not
established by this result. Candidate acceptance and any everyday promotion
remain deliberate choices for the application's owner.
