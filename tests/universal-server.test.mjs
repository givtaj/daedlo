import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createUniversalServer } from "../packages/universal/src/server.mjs";

const row = (id) => ({
  id,
  label: `Target ${id}`,
  environment: id,
  origin: "http://127.0.0.1:9999",
  model: { id: "fixture", version: "1" },
  revision: 1,
  configPath: "/private/config.json",
  token: "private-capability",
});
const summary = {
  runId: "shared-run",
  command: "save",
  recipe: false,
  startedAt: "2026-11-10T10:00:00.000Z",
  finishedAt: null,
  status: "incomplete",
  execution: "interrupted",
  effect: "uncertain",
  eventCount: 2,
  historyComplete: false,
  reportTruncated: false,
  indexedAt: "2026-11-10T10:00:01.000Z",
};
async function fixture(t) {
  const targets = [row("a"), row("b")],
    calls = [];
  const catalog = {
    listTargets: async () => {
      calls.push(["targets"]);
      return structuredClone(targets);
    },
    listRuns: async (request) => {
      calls.push(["runs", request]);
      return {
        targetId: request.targetId,
        items: [{ ...summary, privatePath: "/private/run" }],
        nextCursor: null,
        indexedAt: summary.indexedAt,
        generation: 1,
      };
    },
    getRun: async ({ targetId, runId }) => {
      calls.push(["run", { targetId, runId }]);
      return {
        format: "daedlo-run-journal/1",
        targetId,
        workspaceId: "workspace",
        projectId: targetId,
        runId,
        status: "incomplete",
        liveState: "unknown",
        historyComplete: false,
        partialTail: false,
        events: [],
        report: null,
        recovery: { execution: "interrupted", effect: { status: "uncertain" } },
        privatePath: "/private/journal",
      };
    },
    indexTarget: async (targetId) => {
      calls.push(["index", targetId]);
      return {
        targetId,
        generation: 2,
        indexedRuns: 1,
        unchangedRuns: 0,
        incompleteRuns: 1,
        invalidRuns: 0,
        bytesRead: 120,
        indexedAt: summary.indexedAt,
        privatePath: "/private/index",
      };
    },
  };
  const launchCalls = [];
  const launching = {
    fn: async (targetId, options) => {
      launchCalls.push([targetId, options]);
      return {
        viewerUrl: "http://127.0.0.1:12345/",
        status: "running",
        reused: false,
        controlUrl: "http://127.0.0.1:12345/#token=private-capability",
      };
    },
  };
  const server = await createUniversalServer({
    catalog,
    launch: (...args) => launching.fn(...args),
  });
  t.after(() => server.close());
  const url = new URL(server.url),
    headers = { Authorization: `Bearer ${url.hash.slice(7)}` };
  async function request(path, options = {}) {
    const response = await fetch(url.origin + path, {
      ...options,
      headers: { ...headers, ...options.headers },
    });
    return { status: response.status, body: await response.json() };
  }
  const post = (path, body, extra = {}) =>
    request(path, {
      method: "POST",
      headers: {
        Origin: url.origin,
        "Content-Type": "application/json",
        ...extra,
      },
      body: JSON.stringify(body),
    });
  return {
    targets,
    calls,
    catalog,
    launching,
    launchCalls,
    server,
    url,
    headers,
    request,
    post,
  };
}

test("Universal API authentication precedes catalog access and static shell stays public", async (t) => {
  const f = await fixture(t);
  const unauthenticated = await fetch(f.url.origin + "/api/targets");
  assert.equal(unauthenticated.status, 401);
  assert.deepEqual(f.calls, []);
  const shell = await fetch(f.url.origin + "/");
  assert.equal(shell.status, 200);
  assert.match(
    shell.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  assert.match(
    shell.headers.get("content-security-policy"),
    /script-src 'self'/,
  );
  assert.equal(shell.headers.get("x-content-type-options"), "nosniff");
  assert.equal(shell.headers.get("access-control-allow-origin"), null);
  assert.match(f.url.hash, /^#token=[a-f0-9]{64}$/);
});

test("Universal reads expose bounded public fields and preserve explicit target scope", async (t) => {
  const f = await fixture(t);
  const listed = await f.request("/api/targets");
  assert.equal(listed.status, 200);
  assert.deepEqual(
    listed.body.targets,
    f.targets.map(({ configPath, token, ...value }) => value),
  );
  for (const targetId of ["a", "b"]) {
    const runs = await f.request(
      `/api/targets/${targetId}/runs?limit=5&cursor=opaque-cursor`,
    );
    assert.equal(runs.status, 200);
    assert.deepEqual(runs.body, {
      runs: [summary],
      nextCursor: null,
      indexedAt: summary.indexedAt,
      generation: 1,
    });
    const run = await f.request(`/api/targets/${targetId}/runs/shared-run`);
    assert.equal(run.status, 200);
    assert.equal(run.body.targetId, targetId);
    assert.equal(run.body.projectId, targetId);
    assert.equal(run.body.recovery.effect.status, "uncertain");
    assert.doesNotMatch(JSON.stringify(run.body), /private/);
  }
  assert.deepEqual(
    f.calls.filter(([name]) => name === "runs"),
    [
      ["runs", { targetId: "a", limit: 5, cursor: "opaque-cursor" }],
      ["runs", { targetId: "b", limit: 5, cursor: "opaque-cursor" }],
    ],
  );
  assert.equal(
    f.calls.some(([name]) => name === "index"),
    false,
  );
  assert.deepEqual(f.launchCalls, []);
});

test("Universal shell reload preserves bounded target and run query state without catalog access", async (t) => {
  const f = await fixture(t);
  for (const path of ["/?target=a", "/?target=a&run=shared-run"]) {
    const response = await fetch(f.url.origin + path);
    assert.equal(
      response.status,
      200,
      "A selected history page must remain reloadable",
    );
    assert.match(response.headers.get("content-type"), /text\/html/);
  }
  for (const path of [
    "/?unknown=a",
    "/?run=shared-run",
    "/?target=a&target=b",
    "/?target=..",
    "/?target=" + "x".repeat(129),
    "/app.mjs?target=a",
  ])
    assert.equal((await fetch(f.url.origin + path)).status, 400);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.launchCalls, []);
});

test("Universal exposes labels and environments through the catalog's accepted length bound", async (t) => {
  const f = await fixture(t);
  f.targets[0].label = "x".repeat(256);
  f.targets[0].environment = "y".repeat(256);
  const response = await f.request("/api/targets");
  assert.equal(response.status, 200);
  assert.equal(response.body.targets[0].label, f.targets[0].label);
  assert.equal(response.body.targets[0].environment, f.targets[0].environment);
});

test("Universal rejects noncanonical routes, unbounded or ambiguous query shapes before reads", async (t) => {
  const f = await fixture(t);
  for (const path of [
    "/api/targets?extra=1",
    "/api/targets/%61/runs",
    "/api/targets/a%2Fb/runs",
    "/api/targets/a/runs?limit=0",
    "/api/targets/a/runs?limit=101",
    "/api/targets/a/runs?limit=01",
    "/api/targets/a/runs?limit=1&limit=2",
    "/api/targets/a/runs?other=1",
    "/api/targets/a/runs?cursor=",
    "/api/targets/a/runs?cursor=" + "x".repeat(4097),
    "/api/targets/a/runs/shared-run?limit=1",
  ])
    assert.equal((await f.request(path)).status, 400, path.slice(0, 100));
  assert.equal((await f.request("/api/unknown")).status, 404);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.launchCalls, []);
});

test("Universal enforces loopback Host, exact Origin and token before mutations", async (t) => {
  const f = await fixture(t);
  for (const headers of [
    { Origin: "https://evil.example" },
    { Origin: "null" },
    { Origin: "" },
    { Authorization: "Bearer wrong" },
    { "Sec-Fetch-Site": "cross-site" },
  ])
    assert.ok(
      [401, 403].includes(
        (await f.post("/api/targets/a/index", { revision: 1 }, headers)).status,
      ),
    );
  const missingOrigin = await f.request("/api/targets/a/index", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"revision":1}',
  });
  assert.equal(missingOrigin.status, 403);
  const wrongHost = await new Promise((resolve, reject) => {
    const req = http.request(
      f.url.origin + "/api/targets",
      { headers: { ...f.headers, Host: "evil.example" } },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(wrongHost, 403);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.launchCalls, []);
});

test("Universal mutation body bounds and revision checks prevent stale or arbitrary work", async (t) => {
  const f = await fixture(t);
  for (const body of [
    {},
    { revision: 0 },
    { revision: "1" },
    { revision: 1, path: "/private" },
    null,
    [],
  ])
    assert.equal((await f.post("/api/targets/a/index", body)).status, 400);
  assert.equal(
    (await f.post("/api/targets/a/index?extra=1", { revision: 1 })).status,
    400,
  );
  assert.equal(
    (
      await f.post(
        "/api/targets/a/index",
        { revision: 1 },
        { "Content-Type": "text/plain" },
      )
    ).status,
    415,
  );
  assert.equal(
    (
      await f.post("/api/targets/a/index", {
        revision: 1,
        excess: "x".repeat(8192),
      })
    ).status,
    413,
  );
  const stale = await f.post("/api/targets/a/index", { revision: 2 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, "target_changed");
  assert.equal(
    f.calls.some(([name]) => name === "index"),
    false,
  );
  assert.deepEqual(f.launchCalls, []);
});

test("Universal explicit indexing and launching dispatch once with sanitized results", async (t) => {
  const f = await fixture(t);
  const indexed = await f.post("/api/targets/a/index", { revision: 1 });
  assert.equal(indexed.status, 200);
  assert.equal(indexed.body.index.targetId, "a");
  assert.doesNotMatch(JSON.stringify(indexed.body), /private/);
  const launched = await f.post("/api/targets/b/launch", { revision: 1 });
  assert.equal(launched.status, 200);
  assert.deepEqual(launched.body, {
    ok: true,
    live: {
      viewerUrl: "http://127.0.0.1:12345/",
      status: "running",
      reused: false,
    },
  });
  assert.deepEqual(
    f.calls.filter(([name]) => name === "index"),
    [["index", "a"]],
  );
  assert.deepEqual(f.launchCalls, [["b", { revision: 1 }]]);
});

test("Universal index intent stays bound to its observed revision across catalog drift", async (t) => {
  const f = await fixture(t);
  f.catalog.listTargets = async () => {
    const observed = structuredClone(f.targets);
    f.targets[0].revision = 2;
    return observed;
  };
  let writes = 0,
    accepted;
  f.catalog.indexTarget = async (targetId, options = {}) => {
    accepted = options;
    if (
      options.expectedRevision !== undefined &&
      options.expectedRevision !== f.targets[0].revision
    )
      throw Object.assign(Error("private changed configuration"), {
        code: "catalog_changed",
      });
    writes++;
    return {
      targetId,
      generation: 2,
      indexedRuns: 1,
      unchangedRuns: 0,
      incompleteRuns: 1,
      invalidRuns: 0,
      bytesRead: 120,
      indexedAt: summary.indexedAt,
    };
  };
  const response = await f.post("/api/targets/a/index", { revision: 1 });
  assert.equal(
    response.status,
    409,
    "The original UI revision must reach atomic catalog validation",
  );
  assert.equal(response.body.error.code, "catalog_changed");
  assert.deepEqual(accepted, { expectedRevision: 1 });
  assert.equal(writes, 0);
});

test("Universal global mutation gate rejects concurrent targets without retrying", async (t) => {
  const f = await fixture(t);
  let entered, finish;
  const waiting = new Promise((done) => {
    entered = done;
  });
  const held = new Promise((done) => {
    finish = done;
  });
  const original = f.catalog.indexTarget;
  f.catalog.indexTarget = async (id, options) => {
    entered();
    await held;
    return original(id, options);
  };
  const indexing = f.post("/api/targets/a/index", { revision: 1 });
  let indexed;
  try {
    await waiting;
    const busy = await f.post("/api/targets/b/launch", { revision: 1 });
    assert.equal(busy.status, 409);
    assert.equal(busy.body.error.code, "operation_busy");
    assert.equal((await f.request("/api/targets")).status, 200);
  } finally {
    finish();
    indexed = await indexing;
  }
  assert.equal(indexed.status, 200);
  assert.deepEqual(f.launchCalls, []);
});

test("Universal rejects an oversized chunked body without retaining or dispatching it", async (t) => {
  const f = await fixture(t);
  const response = await new Promise((resolve, reject) => {
    const req = http.request(
      f.url.origin + "/api/targets/a/index",
      {
        method: "POST",
        headers: {
          ...f.headers,
          Origin: f.url.origin,
          "Content-Type": "application/json",
          "Transfer-Encoding": "chunked",
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            body: JSON.parse(Buffer.concat(chunks)),
          }),
        );
      },
    );
    req.on("error", reject);
    req.write('{"revision":1,"excess":"');
    req.write("x".repeat(8192));
    req.end('"}');
  });
  assert.equal(response.status, 413);
  assert.equal(response.body.error.code, "request_too_large");
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.launchCalls, []);
});

test("Universal preserves an unavailable live session without inventing a viewer or application success", async (t) => {
  const f = await fixture(t);
  f.launching.fn = async () => ({
    viewerUrl: null,
    status: "unreachable",
    reused: true,
  });
  const response = await f.post("/api/targets/a/launch", { revision: 1 });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    ok: true,
    live: { viewerUrl: null, status: "unreachable", reused: true },
  });
});

test("Universal accepts the existing basic viewer origin without requiring a trailing slash", async (t) => {
  const f = await fixture(t);
  f.launching.fn = async () => ({
    viewerUrl: "http://127.0.0.1:12345",
    status: "running",
    reused: true,
  });
  const response = await f.post("/api/targets/a/launch", { revision: 1 });
  assert.equal(
    response.status,
    200,
    "Current basic viewer URLs must remain compatible",
  );
  assert.deepEqual(response.body.live, {
    viewerUrl: "http://127.0.0.1:12345/",
    status: "running",
    reused: true,
  });
});

test("Universal refuses cross-target catalog output and unsafe live viewer handoffs", async (t) => {
  const f = await fixture(t);
  const original = f.catalog.listRuns;
  f.catalog.listRuns = async (request) => ({
    ...(await original(request)),
    targetId: "b",
  });
  assert.equal((await f.request("/api/targets/a/runs")).status, 409);
  const detail = f.catalog.getRun;
  f.catalog.getRun = async (request) => ({
    ...(await detail(request)),
    runId: "other-run",
  });
  assert.equal((await f.request("/api/targets/a/runs/shared-run")).status, 409);
  for (const viewerUrl of [
    "https://example.test/",
    "http://localhost:12345/",
    "http://user:secret@127.0.0.1:12345/",
    "http://127.0.0.1:0/",
    "http://127.0.0.1:12345/path",
    "http://127.0.0.1:12345/?secret=1",
    "http://127.0.0.1:12345/#token=secret",
  ]) {
    f.launching.fn = async () => ({
      viewerUrl,
      status: "running",
      reused: false,
    });
    const response = await f.post("/api/targets/a/launch", { revision: 1 });
    assert.equal(response.status, 409, viewerUrl);
    assert.doesNotMatch(
      JSON.stringify(response.body),
      /secret|example\.test|localhost/,
    );
  }
});

test("Universal discloses incomplete rollback proof without suggesting an unsafe retry", async (t) => {
  const f = await fixture(t);
  f.catalog.listTargets = async () => {
    throw Object.assign(Error("private source"), {
      code: "catalog_rollback_unproven",
    });
  };
  const response = await f.request("/api/targets");
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, "catalog_rollback_unproven");
  assert.match(response.body.error.message, /preserve.*inspection/i);
  assert.doesNotMatch(
    response.body.error.message,
    /private source|indexing|retry/i,
  );
});

test("Universal error output contains only static safe messages", async (t) => {
  const f = await fixture(t);
  f.catalog.listRuns = async () => {
    throw Object.assign(Error("/private/database secret-capability"), {
      code: "SQLITE_CORRUPT",
    });
  };
  const unexpected = await f.request("/api/targets/a/runs");
  assert.equal(unexpected.status, 409);
  assert.equal(unexpected.body.error.code, "operation_failed");
  assert.doesNotMatch(
    JSON.stringify(unexpected.body),
    /private|database secret|SQLITE_CORRUPT/,
  );
  f.catalog.listRuns = async () => {
    throw Object.assign(Error("/private/target"), { code: "target_not_found" });
  };
  const missing = await f.request("/api/targets/missing/runs");
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, "target_not_found");
  assert.doesNotMatch(JSON.stringify(missing.body), /private/);
});

test("Universal only binds loopback and close owns neither catalog nor application", async (t) => {
  await assert.rejects(createUniversalServer({ host: "0.0.0.0" }), TypeError);
  const f = await fixture(t);
  let closed = 0;
  f.catalog.close = () => closed++;
  f.launching.close = () => closed++;
  await f.server.close();
  await f.server.close();
  assert.equal(closed, 0);
});

test("Universal close drains already-dispatched work without closing caller resources", async (t) => {
  const f = await fixture(t);
  let entered,
    finish,
    resourceCloses = 0;
  const waiting = new Promise((done) => {
    entered = done;
  });
  const held = new Promise((done) => {
    finish = done;
  });
  const original = f.launching.fn;
  f.launching.fn = async (...args) => {
    entered();
    await held;
    return original(...args);
  };
  f.catalog.close = () => resourceCloses++;
  const request = f
    .post("/api/targets/a/launch", { revision: 1 })
    .catch(() => ({ disconnected: true }));
  await waiting;
  let closed = false;
  const closing = f.server.close().then(() => {
    closed = true;
  });
  try {
    await new Promise((done) => setImmediate(done));
    assert.equal(closed, false);
    assert.equal(resourceCloses, 0);
  } finally {
    finish();
    await request;
    await closing;
  }
  assert.equal(resourceCloses, 0);
  assert.deepEqual(f.launchCalls, [["a", { revision: 1 }]]);
});
