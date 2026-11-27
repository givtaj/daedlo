import test from "node:test";
import assert from "node:assert/strict";
import { createUniversalServer } from "../packages/universal/src/server.mjs";
import { validateKnowledgeBody } from "../packages/universal/src/knowledge-http.mjs";

async function fixture(t) {
  const calls = [];
  const target = {
    id: "a",
    label: "A",
    environment: "test",
    origin: "https://example.test",
    model: { id: "fixture", version: "1" },
    revision: 1,
  };
  const record = {
    id: "record",
    targetId: "a",
    kind: "knowledge",
    revision: 1,
    headRevision: 1,
    title: "Manual knowledge",
    body: "Historical statement",
    state: "proposed",
    refs: [{ runId: "run", eventSequence: null, evidenceId: null }],
    integration: {
      revision: 1,
      model: target.model,
      sourceSha256: "b".repeat(64),
      configSha256: "a".repeat(64),
    },
    createdAt: "2026-11-10T10:00:00.000Z",
    reviewedAt: "2026-11-10T10:00:00.000Z",
    needsRevalidation: false,
    validation: { status: "valid", reasons: [] },
    reviews: [],
    revisions: [],
  };
  const artifact = {
    id: "file",
    targetId: "a",
    runId: "run",
    eventSequence: null,
    eventId: null,
    label: "Private proof",
    mediaType: "text/plain",
    bytes: 3,
    sha256: "c".repeat(64),
    createdAt: record.createdAt,
    provenance: {
      installationId: "install",
      runtimeVersion: "fixture",
      sourceSha256: "b".repeat(64),
      model: target.model,
    },
    integrity: "available",
  };
  const catalog = {
    catalogVersion: 2,
    listTargets: async () => [target],
    listRuns: async () => ({}),
    getRun: async () => ({}),
    indexTarget: async () => ({}),
    listRecords: async () => ({
      targetId: "a",
      records: [record],
      nextCursor: null,
    }),
    getRecord: async () => record,
    getTargetSummary: async () => ({
      targetId: "a",
      targetRevision: 1,
      items: [],
      excluded: [],
      historicalOnly: true,
    }),
    createRecord: async (input) => {
      calls.push(input);
      return record;
    },
    reviewRecord: async (input) => {
      calls.push(input);
      return { ...record, state: input.decision };
    },
    reviseRecord: async (input) => {
      calls.push(input);
      return { ...record, revision: 2 };
    },
    listEvidence: async () => ({
      targetId: "a",
      items: [artifact],
      nextCursor: null,
    }),
  };
  const evidence = {
    inspect: async () => artifact,
    read: async () => ({ metadata: artifact, bytes: Buffer.from("abc") }),
    listPending: async () => [],
    put: async (input) => {
      calls.push(input);
      return artifact;
    },
    retry: async (input) => {
      calls.push(input);
      return artifact;
    },
  };
  const server = await createUniversalServer({
    catalog,
    evidence,
    launch: async () => {
      throw Error("Knowledge must never launch");
    },
  });
  t.after(() => server.close());
  const url = new URL(server.url),
    token = new URLSearchParams(url.hash.slice(1)).get("token");
  const request = async (path, input) => {
    const response = await fetch(url.origin + path, {
      method: input === undefined ? "GET" : "POST",
      headers: {
        Authorization: "Bearer " + token,
        ...(input === undefined
          ? {}
          : { Origin: url.origin, "Content-Type": "application/json" }),
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
    return { response, body: await response.json() };
  };
  return { calls, record, artifact, catalog, evidence, url, token, request };
}

test("Universal exposes private target records and summary without launching or writing", async (t) => {
  const f = await fixture(t);
  const listed = await f.request("/api/targets/a/records");
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.records[0].id, "record");
  assert.equal(
    (await f.request("/api/targets/a/records/record")).body.record.id,
    "record",
  );
  assert.deepEqual((await f.request("/api/targets/a/summary")).body.items, []);
  assert.deepEqual(f.calls, []);
});

test("record mutations require exact target revision and forward record CAS", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await f.request("/api/targets/a/records/record/review", {
        revision: 2,
        expectedRevision: 1,
        decision: "accepted",
      })
    ).response.status,
    409,
  );
  assert.equal(f.calls.length, 0);
  const response = await f.request("/api/targets/a/records/record/review", {
    revision: 1,
    expectedRevision: 1,
    decision: "accepted",
  });
  assert.equal(response.response.status, 200);
  assert.equal(f.calls[0].expectedTargetRevision, 1);
  assert.equal(f.calls[0].expectedRevision, 1);
  assert.equal(f.calls[0].recordId, "record");
});

test("evidence bytes require authentication and stay separate from JSON record output", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await fetch(f.url.origin + "/api/targets/a/evidence/file/content")).status,
    401,
  );
  const response = await fetch(
    f.url.origin + "/api/targets/a/evidence/file/content",
    { headers: { Authorization: "Bearer " + f.token } },
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "abc");
  assert.match(response.headers.get("content-disposition"), /^attachment/);
  assert.equal(
    (await f.request("/api/targets/a/evidence")).body.evidence[0].integrity,
    "available",
  );
});

test("evidence upload has a separate bound and rejects unsafe types or extra fields before file writes", async (t) => {
  const f = await fixture(t),
    input = {
      revision: 1,
      runId: "run",
      label: "Proof",
      mediaType: "text/plain",
      base64: Buffer.from("abc").toString("base64"),
    };
  assert.equal(
    (
      await f.request("/api/targets/a/evidence", {
        ...input,
        path: "/private/secret",
      })
    ).response.status,
    400,
  );
  assert.equal(
    (
      await f.request("/api/targets/a/evidence", {
        ...input,
        mediaType: "text/html",
      })
    ).response.status,
    400,
  );
  assert.equal(f.calls.length, 0);
  assert.equal(
    (await f.request("/api/targets/a/evidence", input)).response.status,
    200,
  );
  assert.deepEqual(f.calls[0].bytes, Buffer.from("abc"));
});

test("cross-target record/evidence responses are refused without exposing private fields", async (t) => {
  const f = await fixture(t);
  f.catalog.getRecord = async () => ({
    ...f.record,
    targetId: "b",
    configPath: "/private/path",
  });
  assert.equal(
    (await f.request("/api/targets/a/records/record")).response.status,
    409,
  );
  f.evidence.inspect = async () => ({ ...f.artifact, targetId: "b" });
  const response = await f.request("/api/targets/a/evidence/file");
  assert.equal(response.response.status, 409);
  assert.doesNotMatch(JSON.stringify(response.body), /private\/path/);
});

test("mutation-only record routes refuse GET and nested private metadata is not projected", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.request("/api/targets/a/records/record/review")).response.status,
    404,
  );
  assert.equal(
    (await f.request("/api/targets/a/records/record/revise")).response.status,
    404,
  );
  f.catalog.getRecord = async () => ({
    ...f.record,
    integration: {
      ...f.record.integration,
      model: {
        ...f.record.integration.model,
        privatePath: "/private/customer",
      },
    },
    validation: { status: "valid", reasons: ["/private/customer"] },
  });
  const result = await f.request("/api/targets/a/records/record");
  assert.doesNotMatch(JSON.stringify(result.body), /private\/customer/);
  assert.deepEqual(f.calls, []);
});

test("the advertised 16 MiB upload bound accepts canonical base64 without stack overflow", () => {
  const bytes = Buffer.alloc(16 * 1024 * 1024, 65),
    route = { resource: "evidence" };
  const input = {
    revision: 1,
    runId: "run",
    label: "Bounded file",
    mediaType: "text/plain",
    base64: bytes.toString("base64"),
  };
  assert.deepEqual(validateKnowledgeBody(input, route).bytes, bytes);
  assert.throws(
    () =>
      validateKnowledgeBody(
        { ...input, base64: Buffer.alloc(bytes.length + 1).toString("base64") },
        route,
      ),
    { code: "invalid_request" },
  );
  for (const base64 of ["AA=A", "YQ", "YQ==\\n", "YR=="])
    assert.throws(() => validateKnowledgeBody({ ...input, base64 }, route), {
      code: "invalid_request",
    });
});
