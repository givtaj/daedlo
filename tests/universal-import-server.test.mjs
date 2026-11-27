import test from "node:test";
import assert from "node:assert/strict";
import { createUniversalServer } from "../packages/universal/src/server.mjs";

async function fixture(t) {
  const calls = [];
  const report = {
    format: "browser-driver-report/1",
    runId: "old",
    lastResult: {
      runId: "old",
      execution: "failed",
      effect: { status: "saved" },
    },
    events: [],
  };
  const detail = {
    format: "daedlo-imported-report/1",
    targetId: "a",
    runId: "old",
    importId: "import-old",
    status: "imported",
    historyComplete: false,
    liveState: "unknown",
    events: [],
    report,
    provenance: {
      source: {
        kind: "daedlo-managed-run",
        schemaVersion: 1,
        reportFormat: report.format,
        sha256: "a".repeat(64),
        bytes: 500,
        fileName: "old.json",
        sourcePath: "/private/archive",
      },
      installation: {
        id: "old-install",
        version: "old",
        model: { id: "fixture", version: "1", privatePath: "/private/model" },
      },
      recordedAt: "2026-10-01T10:00:00.000Z",
      importedAt: "2026-11-10T10:00:00.000Z",
      mapping: {
        kind: "explicit",
        targetId: "a",
        targetRevision: 1,
        authProfile: "private-auth",
      },
      limitations: ["completed_report_only", "event_range_missing"],
    },
  };
  const catalog = {
    catalogVersion: 3,
    listTargets: async () => [],
    indexTarget: async () => {
      throw Error("read must not index");
    },
    getRun: async () => {
      throw Error("Imported history is not a journal");
    },
    listRuns: async () => ({
      targetId: "a",
      items: [
        {
          sourceKind: "archive",
          runId: "old",
          status: "imported",
          archivedAt: detail.provenance.recordedAt,
          historyComplete: false,
          reportTruncated: false,
          execution: "failed",
          effect: { status: "saved" },
          eventCount: 0,
        },
      ],
      nextCursor: null,
      indexedAt: null,
      generation: 1,
    }),
    getImportedRun: async (query) => {
      calls.push(query);
      return detail;
    },
  };
  const server = await createUniversalServer({
    catalog,
    launch: async () => {
      throw Error("Import history must not launch");
    },
  });
  t.after(() => server.close());
  const url = new URL(server.url),
    headers = { Authorization: "Bearer " + url.hash.slice(7) };
  const get = async (path, auth = true) => {
    const res = await fetch(url.origin + path, {
      headers: auth ? headers : {},
    });
    return { status: res.status, body: await res.json() };
  };
  return { detail, catalog, calls, url, headers, get };
}
test("imported history stays typed, private and report-only without journal dispatch", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.get("/api/targets/a/imports/old", false)).status, 401);
  const listed = await f.get("/api/targets/a/runs");
  assert.equal(listed.status, 200);
  assert.equal(listed.body.runs[0].sourceKind, "archive");
  const actual = await f.get("/api/targets/a/imports/old");
  assert.equal(actual.status, 200);
  assert.deepEqual(actual.body.report, f.detail.report);
  assert.deepEqual(actual.body.events, []);
  assert.equal(actual.body.historyComplete, false);
  assert.equal(actual.body.provenance.mapping.kind, "explicit");
  assert.doesNotMatch(JSON.stringify(actual.body), /private/);
  assert.deepEqual(f.calls, [{ targetId: "a", runId: "old" }]);
});
test("foreign imported records and mutation routes refuse before exposing or importing bytes", async (t) => {
  const f = await fixture(t);
  f.catalog.getImportedRun = async () => ({ ...f.detail, targetId: "b" });
  assert.equal((await f.get("/api/targets/a/imports/old")).status, 409);
  const response = await fetch(f.url.origin + "/api/targets/a/imports/old", {
    method: "POST",
    headers: {
      ...f.headers,
      Origin: f.url.origin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ revision: 1, file: "/private/secret" }),
  });
  assert.equal(response.status, 404);
});
test("archive deep links preserve source identity and reject ambiguous source parameters", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await fetch(f.url.origin + "/?target=a&run=old&source=archive")).status,
    200,
  );
  for (const query of [
    "source=archive",
    "target=a&source=archive",
    "target=a&run=old&source=unknown",
    "target=a&run=old&source=archive&source=archive",
  ])
    assert.equal((await fetch(f.url.origin + "/?" + query)).status, 400);
});
