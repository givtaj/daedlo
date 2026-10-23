# The Roots evidence archive

These are real Roots QA receipts that shaped Daedlo: visible UX findings,
learned Journal flows, guarded live controls, timed regression, and the Strains
feature. The archive contains no invented runs. It does not establish that every
Roots capability has been migrated into the independent product.

The static workbench reads [manifest.json](manifest.json). Original evidence stays
in the Roots repository, referenced by repository-relative path and SHA-256. The original-source copies are six visually reviewed screenshots of synthetic
fixtures, unchanged from the originals. A seventh, fresh manual walkthrough adds
two exact live-frame images and four sanitized receipts under `receipts/`, created
in this Daedlo repository. Their source paths are explicitly labeled. No
raw logs, credentials, account files, cookies, private records or traces are copied.

| Receipt                             | Captured source                                                               | What it establishes                                                                                                                                                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial UX drive, September 26      | Application `8deffdd`                                                         | Fifteen original destinations checked; four historical Profile UX concerns; the incorrect Refresh locator and corrected passing check remain separate.                                                                                          |
| Learned Journal flows, September 26 | Application `f198c9a`                                                         | Eleven browser checks, including the ten later recipes; retained drafts, no-write failures, lost-success recovery, persistence and keyboard focus.                                                                                              |
| Live controls, September 27         | Application `99c751`; separately hashed controller, later committed `b0370eb` | Six genuine missing-control baseline failures, then ten passing groups and ten recipe assertions; no replay, stale-action rejection and truthful save accounting.                                                                               |
| Timed regression, September 27      | Application `d4008e3`; QA executable changed during the run                   | Ten groups and ten recipes passed. Recorded wall times are not a single-binary benchmark; overlapping recipe intervals are not added to suite time.                                                                                             |
| Strains, September 27               | Hashed candidate based on `d4008e3`, later committed `9c9e938`                | Eleven product scenarios passed, eighteen Rust leaves were separately observed, zero uncaught errors; earlier focus and cursor-readiness failures are retained.                                                                                 |
| Consolidation, September 27         | Application `dd9cee67`; relocated controller/runtime uncommitted              | Passing baseline and final 10 live groups/10 recipes plus 11 Strains scenarios/18 leaves; stable source/four binaries, 290 Rust/74 frontend/13 Node checks, Docker and owned cleanup. Initial setup failure retained; no commit/push/remote CI. |

The canonical Roots report (`docs/verification/auth-release-2026-09-26/REPORT.md`
in the private Roots source)
owns verification and release status for that project. The 2026-09-27
consolidation receipt records completed local verification with its source then
uncommitted and its publication limits at capture. Its before/after durations are single
observed shared-host runs, not statistical performance benchmarks. This is a dated
archive; it does not monitor or automatically synchronize either source. The first Profile
findings are historical observations, not assertions that current Roots still
has those defects. A fresh manual drive belongs in a separate receipt with its
own source identity and observed time.

Original source references (private Roots repository; not files required from
a sibling checkout or prerequisites for using this archive):

- Initial UX review — `QA/ux-review-2026-09-26.md`
- Learned driver commands and assertions — `QA/driver-commands.md`
- Live-control evidence explanation — `QA/evidence/live-controls-2026-09-27/README.md`
- Timed regression provenance — `QA/evidence/live-regression-timing-2026-09-27/verification.json`
- Strains acceptance and evidence limits — `QA/strains-acceptance.md`
- Consolidation final verification — `QA/evidence/driver-consolidation-2026-09-27/verification.json`

## Manifest contract

`schemaVersion: 1` is a small static archive format. Each `runs[]` item contains:

- `id`, `kind`, `title`, `date`, `summary`, `status`, and `testLevel`.
- `source`: application or committed-candidate identity, evidence directory,
  optional captured base/controller identity, provenance explanation and original
  `artifacts[]` with `path`, `sha256`, `kind`, and `copied: false`.
- `coverage`: aggregate counts from that receipt. These are not additional
  scenarios and must not be added to the curated scenario count.
- `scenarios[]`: a stable `id`, readable `name`, `status`, actual `assertion`, and
  original `evidence[]` references. Optional `failure` and `correction` preserve
  the distinction between a defect, a driver mistake and a corrected run.
- Optional `history[]`: earlier attempts or later gates, with `status`, `stage`,
  `detail` and the source `evidence` reference.
- `images[]`: local `path`, descriptive `caption`, original `sourcePath`, and the
  SHA-256 shared by source and copied image.
- `limitations[]`: boundaries needed to interpret the result truthfully.

Run `PASS` means the recorded checks passed for the captured source.
`FINDINGS` identifies a review that found concerns. `IN_PROGRESS`, if present,
identifies an unclosed gate; it must not be inferred from a passing baseline.
`HISTORICAL_FINDING` is a scenario observation on an old application revision.
`NOT RUN` states an unverified gate; it is not zero failures. A setup failure in
`history` is not an application assertion failure.

Source SHA-256 values bind bytes read at curation time. Originals may subsequently
change, so consumers must not silently refresh the hashes or promote results to
current-source status. Hashing does not anonymize source material. Screenshots
alone demonstrate visible UI; the linked API/database assertions establish
persistence, record identity, no-write and retry behavior.

## Manual walkthrough — 2026-09-27

The `manual-walkthrough` receipt records three focused checks on committed Roots
`dd9cee67`: the original draft-retention recipe (11/11 steps), lost-response retry
recipe (10/10 steps), and a visible Strains search for `White`. It is a scoped
manual drive, not another full regression run. Its four [sanitized receipts](receipts/)
include frozen source/binary identity and the exact original-driver assertion names.
The two screenshots were captured from that controlled browser on 2026-09-27
and archived unchanged. The fixture was retained at that checkpoint; this archive
does not establish whether that session or its services are still available.

After draft retention, the monitor said Saved successfully while the experience
remained a draft: the private strain was the saved object. This concrete wording
observation is retained so the product can distinguish which object was persisted.
Earlier pointer-targeting and setup attempts are recorded as such, not presented
as failing Roots application assertions.

## The extracted candidate receipt

`standalone-roots-candidate` preserves the earlier real Roots acceptance of the
packed external runtime: nine browser/API/database groups, eight customer checks,
fifteen commands and one recipe. Its screenshot is copied unchanged from this
repository’s acceptance artifacts. It remains tied to rc2 and the earlier
`d4008e3` application baseline; it is not a claim that the latest original Roots
driver or its Strains feature has been migrated. Use the Driver source filter to
inspect that evidence separately. Original files stay under `artifacts/roots/`
and the durable narrative under `integrations/roots/`.
