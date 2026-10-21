# Daedlo alpha delivery — 21 October 2026

Release: **0.1.4-alpha.2**. Status: **published assisted alpha**.
[Install](https://daedlo.com/install) · [Versioned release](https://github.com/givtaj/browser-driver/releases/tag/v0.1.4-alpha.2).
This is the current product/release decision record. Actual test outcomes belong
in [verification](verification.md); historical records keep their original scope.

## Product decision

Bring one existing feature. Your coding agent connects it to a repeatable browser
flow; you watch the browser and inspect evidence of what happened.

The first alpha is assisted onboarding on **macOS arm64 with Codex**, Node 22 or
24, Rust 1.96.0 and matching Playwright Chromium. The agent explicitly reads the
complete packaged skill; automatic discovery is not required or claimed. Each
application supplies its Rust model, JavaScript adapter and appropriate evidence.
One agreed useful flow and its relevant negative case are the onboarding unit.

The public MIT/Apache licensing path continues. The separate restrictive
evaluation draft is excluded. Authored flows run locally without a model API key.
Paid subscriptions, hosted browser execution, Linux/Windows onboarding, Claude
Code onboarding, universal framework support and everyday Roots adoption are
separate expansion work. Linux CI remains required technical verification.

## Where the product stands

| Track | Observed state | Alpha consequence |
| --- | --- | --- |
| Public `0.1.2-rc.1` | Existing versioned public preview; 11 October exact-package and Architecture Studio evidence recorded | Keep its immutable bytes and historical claims; do not relabel it as this alpha |
| Everyday working checkout | Extensive pre-existing work, including `0.1.2-eval.1` review-only terms and website/integration files | Preserve it; do not commit or publish its mixed working tree |
| Shared runtime fixes | Clean isolated branch `codex/daedlo-roots-fixes`, checkpoint `a563871`; packaged implementation `42ef2a3` | Base alpha on these fixes for explicit empty fields, canonical recipe context, visible actions, CLI ownership and final Pause/Stop handling |
| Roots adoption | Independent migration/recovery work remains incomplete; some earlier raw application receipts are unavailable | No normal dependency switch or current Roots acceptance claim |
| Remote CI at audit | Main `7e3e48d` failed on missing portable `presentation.md`; alpha base includes its packaging repair | Run CI against the selected alpha commit; historical green runs do not satisfy this gate |

The dedicated branch is `codex/daedlo-alpha-release`. Version 0.1.4 avoids sorting
below the existing roots.8 candidate. Alpha.1 passed technical and real-application
checks but was withheld after its installer modified an ancestor npm workspace.
Alpha.2 uses an explicit install prefix and disables workspace targeting; a real
nested-workspace regression and the shipped installer prove the ancestor manifests
remain unchanged.
The integration owner controls version fields, lockfiles, entrypoints and release
assembly. Existing application pins and live services remain untouched.

## Release gates

| Gate | Required evidence | Current decision |
| --- | --- | --- |
| Reviewed source | Clean committed source; complete portable guides/notices; one recorded package identity | PASS: clean package source `044e76d`; exact public notices/digests reviewed |
| Source checks | Runtime, Rust, release, archive and source Chromium suites | PASS: local source checks and Node 22/24 CI |
| Exact installed bytes | Eight browser/API groups plus CLI ownership and finalization/control regressions against the installed runtime | PASS: frozen alpha.2 kit and exact installed checks |
| Complete distribution | Clean runtime/crate bundle, portable tools, full skill, public ZIP and trustworthy digests; actual START_HERE block succeeds | PASS: frozen alpha.2 kit and exact installed checks |
| Real application handoff | Pinned Architecture Studio synthetic fixture: invalid input causes zero writes; save/read-back/reload; export evidence; owned shutdown and relaunch/repeat | PASS: seven fresh Architecture Studio acceptance checkpoints; final integrity and cleanup |
| Remote CI | Selected alpha commit on the existing Node 22/24 Linux matrix, including complete public-kit assembly | PASS: source `044e76d`, runs 39634235043 and 39634245064 |
| Public delivery | Reviewed versioned release/download, visible install journey, live digest read-back and rollback identity | PASS: live alpha site; all 21 served assets match on both origins; seven boundary paths return 404 |

Publication requires all required gates to pass. A setup failure, absent receipt
or historical result is not a passing gate. Keep failed runs and later corrections
as separate evidence. Do not invite customers or send messages as part of these
technical checks.

## Alpha onboarding acceptance

1. Obtain the versioned kit and independently verify its digest. Run the actual
   supplied installation instructions in a fresh directory.
2. Agree one existing application flow; reuse its recorded model and decisions.
   Keep the integration, browser session, ports and synthetic data separate.
3. Demonstrate invalid input with no write, a successful write with independent
   persistence read-back, and reload with exact persisted fields visible.
4. Exercise relevant controls and distinguish execution, outcome and effect.
5. Save durable evidence and launch instructions. Close only owned resources,
   verify attached services survive, relaunch, and repeat the accepted flow.
6. Record actual setup assistance, unsupported cases and a direct support contact
   in the existing customer conversation. Email delivery is not yet verified.

Measure time to the first verified flow, interventions needed, repeat-run success
and whether another agent can use the handoff. No customer adoption, revenue or
self-service onboarding result is claimed before those observations exist.

## Release identity and next product milestone

The tested ZIP is `daedlo-0.1.4-alpha.2.zip` (160,545 bytes), SHA-256
`b9555b6b237ac437f62b984f6994e3ef12ba4e8f95b730f52c9aa9313a375ee1`.
It was built once from clean `044e76df10e90c68e9e3c7ff35e7c63a62354c60`;
later documentation/website commits do not change this package identity.
Cloudflare version `8eebf633-35e6-498a-ae19-67f867c1b878` serves 100% of the
existing Daedlo Worker traffic. The prior static version remains the compatible
rollback; see [hosting](website-hosting.md). No application database is hosted by
this site. The historical rc.1 download and recorded demo remain unchanged.

The next product milestone is an assisted onboarding with an external builder:
agree one useful existing flow and negative case, measure elapsed setup time and
agent interventions, verify the repeat run, and collect the builder's evidence
assessment. This release has technical and representative application acceptance;
external customer adoption has not yet been demonstrated. Contacting or inviting
people is separate work and has not been performed. Use the findings to choose
the next platform or onboarding improvement before expanding the support claim.
