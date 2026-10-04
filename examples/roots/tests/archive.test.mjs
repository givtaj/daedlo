import assert from "node:assert/strict";
import test from "node:test";
import { summarizeArchive, filterRuns } from "../app.mjs";

const runs = [
  {
    id: "original",
    kind: "roots-original",
    status: "PASS",
    scenarios: [
      { name: "Draft protection", status: "PASS" },
      { name: "Recovery", status: "PASS" },
      { name: "Baseline finding", status: "HISTORICAL_FINDING" },
    ],
  },
  {
    id: "candidate",
    kind: "standalone-candidate",
    status: "FAIL",
    scenarios: [
      { name: "Freshness", status: "PASS" },
      { name: "Outcome evidence", status: "FAIL" },
      { name: "Everyday promotion", status: "NOT RUN" },
    ],
  },
];

test("archive totals count only declared scenario rows and keep original and candidate evidence separate", () => {
  assert.deepEqual(summarizeArchive(runs), {
    runs: 2,
    scenarios: 6,
    passed: 3,
    failed: 1,
    findings: 1,
    notRun: 1,
  });
  const original = filterRuns(runs, {
    source: "roots-original",
    status: "all",
  });
  assert.deepEqual(
    original.map((run) => run.id),
    ["original"],
  );
  assert.deepEqual(summarizeArchive(original), {
    runs: 1,
    scenarios: 3,
    passed: 2,
    failed: 0,
    findings: 1,
    notRun: 0,
  });
  assert.deepEqual(
    filterRuns(runs, { source: "all", status: "NOT RUN" }).map((run) => run.id),
    ["candidate"],
  );
  assert.deepEqual(
    filterRuns(runs, { source: "roots-original", status: "FAIL" }),
    [],
  );
});
