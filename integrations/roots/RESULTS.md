# Roots candidate acceptance — 2026-09-27

The isolated Roots consumer passed **9 real-browser/API/PostgreSQL scenario
groups, 8 customer contract/evidence checks, and the staged ordinary launcher
smoke**. Its final browser screenshot was visually inspected. All acceptance-owned
browser/viewer/engine processes and fixture services are closed.

## Tested identities

| Component | Tested identity |
| --- | --- |
| Roots application and legacy customer model | `d4008e39aeaa137bb54ff48ca2d11748083a971a` |
| External Node artifact | rc2 `@browser-driver/runtime@0.1.0` |
| Node tarball SHA-256 | `b04f7e98188e0c110de7f4d17959a21800bae2f1123188e61775585adefb32c1` |
| Measured installed runtime build | `6b552691fdcde81033da5e2996dcda97e8eb1c7a664df987d409d056266fc5f9` |
| Shared Rust crate SHA-256 | `3191df49c978c723c69bd61993aace6325ca1b854b86658a87be782097eda295` |
| Customer engine SHA-256 | `be6d68f7479b2009ae741cea52dac3ce9a3b5aa701888fd5b1e04d8c7fbea8c9` |
| Customer model contract | `roots / d4008e3-v1`, protocol 1 |

The runtime was installed from the exact tarball in the isolated snapshot. The
customer binary was compiled against the extracted shared Rust crate through its
public `ApplicationModel` interface. It retains the pinned Roots model through
its public `respond` bridge. The staged `QA/start-live-driver.mjs` command
launched the external facade, exposed the exact candidate identity, and stopped
without stopping its attached fixture. Everyday Roots entrypoints were untouched.

## Observed acceptance

| Scenario | Result |
| --- | --- |
| Sign in; Profile save with API read-back | PASS |
| Invalid Profile input; correction; persistence unchanged on validation | PASS |
| Customer recipe; reattach preserves account and unsent Journal draft | PASS |
| Human edit invalidates old revision; no request; input retained | PASS |
| Pause before a real guarded field action; resume continues | PASS |
| Failed save; real upstream success with lost reply; retry same token; one row | PASS |
| Stop after backend save; eventual response yields truthful saved effect | PASS |
| Generic viewer hierarchy/controls/live image; reconnect causes no replay | PASS |
| Session change invalidates old command; no write or draft clearing | PASS |
| Staged ordinary launcher; exact package identity; attached fixture preserved | PASS |
| Typed model, missing evidence, handler coverage, record identity regressions | PASS — 8 checks |

Journal persistence evidence now joins the actual POST response record identity
to an API read-back with the full intended payload. A coincidentally matching old
note cannot prove a save. Save-request accounting starts once per run and is not
reset by later recipe commands.

## Customer feedback and boundaries

The initial browser run exposed a real customer-model defect when correcting an
invalid Profile field back to its previously saved value. A focused regression
failed, the customer bridge was corrected, and the original browser scenario
passed. See [feedback.md](feedback.md). No shared policy or live Roots source was
changed to conceal that failure.

This focused integration exposes 15 commands and one customer recipe. It does not
claim migration of every legacy Roots recipe, inline strain command, restart flow,
or planned Strains page. Existing documented baseline defects remain explicit.
Fresh Roots execution against a later declaration-only rc3 artifact is **NOT
RUN**; the coordinator may separately establish executable file equality with
rc2 and type-check that change. This record remains tied to rc2.

## Preservation and cleanup

The acceptance ran against a pinned Git archive, a separate Cargo target,
separate installed packages, new browser contexts, generated ports, synthetic
accounts and disposable PostgreSQL storage. The owned fixture container, generated
source and database directory were removed after testing. Private fixture
diagnostics and ignored build/evidence artifacts remain for inspection.

Live Roots advanced concurrently from `d4008e3` to
`dd9cee67e3886333a7fe8eb7f8545d428167fb07`. Four previously inventoried tracked
files changed during external work: `README.md`, `docs/user-manual.md`,
`docs/verification/auth-release-2026-09-26/REPORT.md`, and
`tools/live-qa/src/browser/motion.mjs`. These changes were observed read-only and
were not restored or attributed to the consumer. No consumer operation wrote to
the live checkout. The Docker comparison had **zero pre-existing normal
containers**, so it does not establish preservation of an actively running normal
Docker stack.

## Local evidence

All evidence is ignored under `artifacts/roots/`: `browser-results.json`,
`browser-final.log`, `contracts-final.tap`, `launcher-results.json`,
`roots-viewer.png`, `viewer.json`, `package.json`, `engine-package.json`,
`source.json`, `live-before.json`, `live-after.json`, `fixture-cleanup.json`,
`cleanup-verified.json`, and the initial red/correction logs. The package manifest
records hashes of each staged consumer/entrypoint file. No fixture password or
session cookie is included in this report.
