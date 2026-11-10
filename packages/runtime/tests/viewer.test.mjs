import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import http from "node:http";
import test from "node:test";
import { createViewer } from "../src/viewer/server.mjs";

const descriptor = {
  id: "notebook",
  version: "1",
  label: "Notebook",
  states: [
    { id: "editor", label: "Editor", parent: null, support: "supported" },
  ],
  commands: [
    {
      id: "write",
      label: "Write note",
      params: { title: { type: "text", label: "Title", required: true } },
    },
  ],
  recipes: [
    {
      id: "draft",
      label: "Draft a note",
      steps: [{ command: "write", params: { title: "Hello" } }],
    },
  ],
};

function fixture({ failScreenshot = false, failStart = false } = {}) {
  const cdp = new EventEmitter();
  cdp.calls = [];
  cdp.send = async (method, params) => {
    cdp.calls.push([method, params]);
    if (failStart && method === "Page.startScreencast")
      throw Error("start failed");
  };
  cdp.detach = async () => {
    cdp.calls.push(["detach"]);
  };
  const page = new EventEmitter();
  page.isClosed = () => false;
  page.screenshot = async () => {
    if (failScreenshot) throw Error("screenshot failed");
    return Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  };
  page.close = () => {
    throw Error("Must not close the attached page");
  };
  const calls = [];
  const snapshot = {
    connected: true,
    descriptor,
    revision: "r1",
    state: { id: "editor" },
    commands: [{ id: "write", enabled: true }],
    recipes: [{ id: "draft", enabled: true }],
    display: [{ label: "Unsaved", value: "Yes" }],
    execution: "idle",
    busy: false,
    paused: false,
    speed: "normal",
    identity: { protocol: 1, driver: "0.1.0" },
  };
  const session = {
    snapshot: async () => snapshot,
    command: async (body) => {
      calls.push(["command", body]);
      return {
        execution: body.revision === "r1" ? "completed" : "rejected",
        outcome: { kind: "recoverable_error", label: "Save can be retried" },
      };
    },
    startPresentation: async (id, revision) => {
      calls.push(["presentation", id, revision]);
      return revision === "r1"
        ? {
            ok: true,
            execution: "completed",
            outcome: { kind: "success", label: "Observed result" },
          }
        : {
            ok: false,
            execution: "rejected",
            error_code: "stale_revision",
            error: "Observe the current state before presenting.",
          };
    },
    advancePresentation: async (stageId) => {
      calls.push(["advance", stageId]);
      return stageId === "stage-1"
        ? { ok: true }
        : {
            ok: false,
            error_code: "stale_stage",
            error: "This stage has already advanced.",
          };
    },
    setSpeed: async (value) => {
      calls.push(["speed", value]);
    },
    pause: async () => {
      calls.push(["pause"]);
    },
    resume: async () => {
      calls.push(["resume"]);
    },
    stop: async () => {
      calls.push(["stop"]);
    },
    close: () => {
      throw Error("Must not close the attached session");
    },
  };
  return {
    page,
    cdp,
    session,
    calls,
    snapshot,
    context: { newCDPSession: async () => cdp },
  };
}

async function start(t, options = {}) {
  const f = fixture(options);
  const viewer = await createViewer(f);
  t.after(() => viewer.close());
  return { ...f, viewer };
}

function request(
  url,
  { method = "GET", headers = {}, body, chunked = false, agent } = {},
) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers, agent }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString(),
        }),
      );
    });
    req.on("error", reject);
    if (chunked) {
      req.write(body);
      req.end();
    } else req.end(body);
  });
}

const post = (url, body, headers = {}) =>
  request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

function events(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${url}/events`, { agent: false, headers }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk.toString()));
      const ended = new Promise((done, fail) => {
        res.on("end", () => done(body));
        res.on("error", fail);
      });
      resolve({ res, ended, body: () => body });
    });
    req.on("error", reject);
  });
}

function endedEvent(body) {
  const event = body
    .split("\n\n")
    .find((entry) => entry.startsWith("event: viewer-ended\n"));
  assert.ok(event, "explicit close must deliver a viewer-ended event");
  return JSON.parse(event.split("\ndata: ")[1]);
}

test("status separates viewer, browser, and fresh application observation through a restart", async (t) => {
  const { viewer, snapshot, session, page, calls } = await start(t);
  const status = async () =>
    JSON.parse((await request(`${viewer.url}/status`)).body);
  const first = await status();
  assert.equal(first.lifecycle?.status, "open");
  assert.match(first.lifecycle.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(first.connections, { browser: true, application: true });
  snapshot.connected = false;
  let current = await status();
  assert.deepEqual(current.connections, { browser: true, application: false });
  assert.equal(current.connected, false);
  snapshot.connected = true;
  current = await status();
  assert.deepEqual(current.connections, { browser: true, application: true });
  assert.equal(current.lifecycle.id, first.lifecycle.id);
  assert.deepEqual(
    calls,
    [],
    "observing restart recovery must not dispatch actions",
  );
  session.snapshot = async () => ({});
  current = await status();
  assert.equal(
    current.connected,
    false,
    "missing observation cannot imply readiness",
  );
  assert.equal(current.connections.application, false);
  session.snapshot = async () => {
    throw Error("unpublished-metadata");
  };
  current = await status();
  assert.deepEqual(current.connections, { browser: true, application: false });
  assert.doesNotMatch(JSON.stringify(current), /unpublished-metadata/);
  page.emit("close");
  current = await status();
  assert.deepEqual(current.connections, { browser: false, application: false });
});

test("explicit viewer close publishes the completed result without reobserving or closing attached resources", async (t) => {
  const { viewer, session, calls, page, cdp } = await start(t);
  const state = JSON.parse((await request(`${viewer.url}/status`)).body);
  const result = {
    ok: true,
    execution: "completed",
    runId: "completed-run",
    command: "write",
    recipe: false,
    startedAt: "2026-11-10T10:00:00.000Z",
    finishedAt: "2026-11-10T10:00:01.000Z",
    outcome: {
      kind: "success",
      label: "Response verified",
      extra: "unpublished-metadata",
    },
    effect: { status: "not_attempted", extra: "unpublished-metadata" },
    extra: "unpublished-metadata",
  };
  session.report = (options) =>
    options?.runId === result.runId
      ? {
          runId: result.runId,
          lastResult: result,
          identity: { extra: "unpublished-metadata" },
        }
      : {
          runId: result.runId,
          lastResult: result,
          completedRunIds: [result.runId],
          extra: "unpublished-metadata",
        };
  session.snapshot = () =>
    assert.fail("close must not observe a restarting application");
  const stream = await events(viewer.url);
  assert.equal(stream.res.statusCode, 200);
  assert.match(stream.res.headers["content-type"], /text\/event-stream/);
  await Promise.all([viewer.close(), viewer.close()]);
  const body = await stream.ended;
  const event = endedEvent(body);
  assert.equal(event.lifecycle.id, state.lifecycle.id);
  assert.equal(event.lifecycle.status, "ended");
  assert.ok(Number.isFinite(Date.parse(event.lifecycle.endedAt)));
  assert.equal(event.lastResult.runId, result.runId);
  assert.deepEqual(event.lastResult.outcome, {
    kind: "success",
    label: "Response verified",
  });
  assert.deepEqual(event.lastResult.effect, { status: "not_attempted" });
  assert.doesNotMatch(body, /unpublished-metadata/);
  assert.equal((body.match(/event: viewer-ended/g) || []).length, 1);
  assert.deepEqual(calls, []);
  assert.equal(page.listenerCount("close"), 0);
  assert.equal(cdp.listenerCount("close"), 0);
  // Probe the closed listener with a new connection, not an idle keepalive
  // socket whose close notification can still be pending in the HTTP agent.
  await assert.rejects(request(`${viewer.url}/status`, { agent: false }), {
    code: "ECONNREFUSED",
  });
});

test("viewer close never promotes a result whose finalization is still pending", async (t) => {
  const { viewer, session } = await start(t);
  session.report = () => ({
    runId: "pending-run",
    lastResult: { runId: "pending-run", execution: "completed", ok: true },
    completedRunIds: [],
    finalization: { status: "pending" },
  });
  const stream = await events(viewer.url);
  assert.equal(stream.res.statusCode, 200);
  await viewer.close();
  assert.equal("lastResult" in endedEvent(await stream.ended), false);
});

test("an in-flight ended status carries the same immutable terminal proof as the close event", async (t) => {
  const { viewer, session, snapshot } = await start(t);
  let releaseSnapshot;
  let snapshotStarted;
  const started = new Promise((resolve) => {
    snapshotStarted = resolve;
  });
  const earlierSnapshot = structuredClone(snapshot);
  earlierSnapshot.lastResult = { runId: "earlier-run", execution: "completed" };
  session.snapshot = () =>
    new Promise((resolve) => {
      releaseSnapshot = () => resolve(earlierSnapshot);
      snapshotStarted();
    });
  const result = {
    ok: true,
    execution: "completed",
    runId: "final-run",
    command: "write",
    recipe: false,
    startedAt: "2026-11-10T10:00:00.000Z",
    finishedAt: "2026-11-10T10:00:01.000Z",
    outcome: { kind: "success", label: "Final response verified" },
    effect: { status: "not_attempted" },
  };
  session.report = (options) => {
    // Let the already-running observation finish only after close begins.
    releaseSnapshot();
    return options?.runId
      ? { runId: result.runId, lastResult: result }
      : {
          runId: result.runId,
          lastResult: result,
          completedRunIds: [result.runId],
        };
  };
  const stream = await events(viewer.url);
  const pending = request(`${viewer.url}/status`);
  await started;
  const closing = viewer.close();
  const endedStatus = JSON.parse((await pending).body);
  await closing;
  const terminal = endedEvent(await stream.ended);
  assert.equal(endedStatus.lifecycle.status, "ended");
  assert.equal(endedStatus.driver.lastResult.runId, "earlier-run");
  assert.deepEqual(endedStatus.terminal, terminal);
  assert.equal(endedStatus.terminal.lastResult.runId, "final-run");
});

for (const scenario of ["newer active run", "malformed completed IDs"]) {
  test(`viewer close omits old completion with ${scenario}`, async (t) => {
    const { viewer, session } = await start(t);
    const result = {
      runId: "old-run",
      execution: "completed",
      ok: true,
      finishedAt: "2026-11-10T10:00:01.000Z",
    };
    session.report = (options) =>
      options?.runId
        ? { runId: "old-run", lastResult: result }
        : {
            runId: scenario === "newer active run" ? "new-run" : "old-run",
            lastResult: result,
            completedRunIds:
              scenario === "newer active run" ? ["old-run"] : "old-run",
          };
    const stream = await events(viewer.url);
    await viewer.close();
    assert.equal("lastResult" in endedEvent(await stream.ended), false);
  });
}

test("browser loss leaves the observer open and does not claim deliberate viewer closure", async (t) => {
  const { viewer, page } = await start(t);
  const stream = await events(viewer.url);
  assert.equal(stream.res.statusCode, 200);
  page.emit("close");
  const status = JSON.parse((await request(`${viewer.url}/status`)).body);
  assert.equal(status.lifecycle.status, "open");
  assert.equal(stream.res.complete, false);
  assert.doesNotMatch(stream.body(), /viewer-ended/);
  await viewer.close();
  assert.equal(endedEvent(await stream.ended).lifecycle.status, "ended");
});

test("lifecycle observation rejects foreign origins and mutation methods", async (t) => {
  const { viewer, calls } = await start(t);
  for (const headers of [
    { origin: "https://foreign.invalid" },
    { "sec-fetch-site": "cross-site" },
    { host: "foreign.invalid" },
  ]) {
    assert.equal(
      (await request(`${viewer.url}/events`, { headers })).status,
      403,
    );
  }
  assert.equal(
    (await post(`${viewer.url}/events`, { action: "resume" })).status,
    404,
  );
  assert.deepEqual(calls, []);
});

test("serves a generic descriptor-driven viewer and a fresh snapshot without inline scripts", async (t) => {
  const { viewer } = await start(t);
  const html = await request(viewer.url);
  assert.equal(html.status, 200);
  assert.match(html.body, /<title>Daedlo · Live session<\/title>/);
  assert.match(html.body, /aria-label="Daedlo home"/);
  assert.doesNotMatch(html.headers["content-security-policy"], /unsafe-inline/);
  assert.match(
    html.headers["content-security-policy"],
    /frame-ancestors 'none'/,
  );
  const state = JSON.parse((await request(`${viewer.url}/status`)).body);
  assert.equal(state.driver.descriptor.id, "notebook");
  assert.equal(state.connected, true);
  for (const asset of ["monitor.mjs", "styles.css", "recipe-paths.mjs"])
    assert.equal((await request(`${viewer.url}/${asset}`)).status, 200);
  const client = (await request(`${viewer.url}/monitor.mjs`)).body;
  assert.doesNotMatch(
    client,
    /innerHTML|profile_draft|journal_draft|Name or experience/,
  );
});

test("dispatches exact command, recipe and controls, preserving outcome separate from execution", async (t) => {
  const { viewer, calls } = await start(t);
  const command = { id: "write", params: { title: "Hello" }, revision: "r1" };
  const result = await post(`${viewer.url}/command`, command, {
    origin: viewer.url,
  });
  assert.equal(result.status, 200);
  assert.equal(JSON.parse(result.body).outcome.kind, "recoverable_error");
  assert.deepEqual(calls[0], ["command", command]);
  const recipe = { id: "draft", revision: "r1", recipe: true };
  assert.equal((await post(`${viewer.url}/command`, recipe)).status, 200);
  assert.deepEqual(calls[1], ["command", recipe]);
  assert.equal(
    (await post(`${viewer.url}/command`, { ...command, revision: "old" }))
      .status,
    409,
  );
  for (const action of ["pause", "resume", "stop"])
    assert.equal((await post(`${viewer.url}/control`, { action })).status, 200);
  assert.equal(
    (await post(`${viewer.url}/control`, { action: "speed", value: "fast" }))
      .status,
    200,
  );
  assert.deepEqual(calls.slice(-4), [
    ["pause"],
    ["resume"],
    ["stop"],
    ["speed", "fast"],
  ]);
});

test("dispatches presentations and tokenized advance while preserving actionable refusals", async (t) => {
  const { viewer, calls } = await start(t);
  const result = await post(`${viewer.url}/presentation`, {
    id: "tour",
    revision: "r1",
  });
  assert.equal(result.status, 200);
  assert.equal(JSON.parse(result.body).outcome.label, "Observed result");
  assert.deepEqual(calls[0], ["presentation", "tour", "r1"]);
  const stale = await post(`${viewer.url}/presentation`, {
    id: "tour",
    revision: "old",
  });
  assert.equal(stale.status, 409);
  assert.equal(JSON.parse(stale.body).error_code, "stale_revision");
  const advanced = await post(`${viewer.url}/control`, {
    action: "advance",
    value: "stage-1",
  });
  assert.equal(advanced.status, 200);
  assert.deepEqual(calls[2], ["advance", "stage-1"]);
  const duplicate = await post(`${viewer.url}/control`, {
    action: "advance",
    value: "stage-0",
  });
  assert.equal(duplicate.status, 409);
  assert.equal(
    JSON.parse(duplicate.body).error,
    "This stage has already advanced.",
  );
});

test("presentation endpoints enforce the command request and connection boundaries", async (t) => {
  const { viewer, calls, page } = await start(t);
  const url = `${viewer.url}/presentation`;
  const body = { id: "tour", revision: "r1" };
  for (const invalid of [
    null,
    [],
    {},
    { ...body, revision: "" },
    { ...body, id: "" },
    { ...body, params: {} },
    { ...body, recipe: true },
  ])
    assert.equal((await post(url, invalid)).status, 400);
  assert.equal(
    (await post(url, body, { origin: "https://attacker.example" })).status,
    403,
  );
  assert.equal(
    (await post(url, body, { "sec-fetch-site": "cross-site" })).status,
    403,
  );
  assert.equal(
    (await post(url, body, { host: "attacker.example" })).status,
    403,
  );
  assert.equal(
    (
      await request(url, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "{}",
      })
    ).status,
    415,
  );
  assert.equal(
    (await post(url, { ...body, id: "x".repeat(17000) })).status,
    413,
  );
  for (const value of [undefined, "", [], 1])
    assert.equal(
      (await post(`${viewer.url}/control`, { action: "advance", value }))
        .status,
      400,
    );
  assert.equal(calls.length, 0);
  page.emit("close");
  assert.equal((await post(url, body)).status, 409);
  assert.equal(
    (
      await post(`${viewer.url}/control`, {
        action: "advance",
        value: "stage-1",
      })
    ).status,
    409,
  );
  assert.equal(calls.length, 0);
});

test("refuses hostile Host, cross-origin mutation, non-JSON, oversized and malformed requests before dispatch", async (t) => {
  const { viewer, calls } = await start(t);
  const url = `${viewer.url}/command`;
  const body = { id: "write", revision: "r1", params: {} };
  assert.equal(
    (
      await request(`${viewer.url}/status`, {
        headers: { host: "attacker.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(`${viewer.url}/status`, {
        headers: { host: "127.0.0.1:1" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await post(url, body, { origin: "https://attacker.example" })).status,
    403,
  );
  assert.equal(
    (await post(url, body, { "sec-fetch-site": "cross-site" })).status,
    403,
  );
  assert.equal(
    (
      await request(url, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "{}",
      })
    ).status,
    415,
  );
  assert.equal(
    (await post(url, { ...body, params: { text: "x".repeat(17000) } })).status,
    413,
  );
  assert.equal(
    (
      await request(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, params: { text: "x".repeat(17000) } }),
        chunked: true,
      })
    ).status,
    413,
  );
  assert.equal(
    (
      await request(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      })
    ).status,
    400,
  );
  for (const value of [
    null,
    [],
    {},
    { ...body, params: [] },
    { ...body, recipe: "yes" },
    { ...body, revision: "" },
  ])
    assert.equal((await post(url, value)).status, 400);
  assert.equal(
    (await post(`${viewer.url}/control`, { action: "speed", value: "instant" }))
      .status,
    400,
  );
  assert.equal(
    (await post(`${viewer.url}/control`, { action: "__proto__" })).status,
    400,
  );
  assert.equal(calls.length, 0);
});

test("streams actual JPEG frames, acknowledges CDP, and closes only owned resources once", async (t) => {
  const { viewer, cdp } = await start(t);
  const stream = await new Promise((resolve, reject) => {
    const req = http.get(`${viewer.url}/stream`, resolve);
    req.on("error", reject);
  });
  const received = [];
  stream.on("data", (chunk) => received.push(chunk));
  cdp.emit("Page.screencastFrame", {
    data: Buffer.from("new-jpeg-frame").toString("base64"),
    sessionId: 7,
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(stream.headers["content-type"], /multipart\/x-mixed-replace/);
  assert.match(Buffer.concat(received).toString(), /new-jpeg-frame/);
  assert.deepEqual(
    cdp.calls.find(([method]) => method === "Page.screencastFrameAck"),
    ["Page.screencastFrameAck", { sessionId: 7 }],
  );
  const status = JSON.parse((await request(`${viewer.url}/status`)).body);
  assert.equal(status.frames, 1);
  const streamClosed = once(stream, "close");
  await Promise.all([viewer.close(), viewer.close()]);
  await streamClosed;
  assert.equal(
    cdp.calls.filter(([method]) => method === "Page.stopScreencast").length,
    1,
  );
  assert.equal(cdp.calls.filter(([method]) => method === "detach").length, 1);
  assert.equal(cdp.listenerCount("Page.screencastFrame"), 0);
  assert.equal(stream.destroyed, true);
});

test("browser disconnect closes the stream and reports disconnection without destroying the user session", async (t) => {
  const { viewer, cdp, page } = await start(t);
  page.emit("close");
  await new Promise((resolve) => setTimeout(resolve, 10));
  const result = JSON.parse((await request(`${viewer.url}/status`)).body);
  assert.equal(result.connected, false);
  assert.equal(
    (await post(`${viewer.url}/command`, { id: "write", revision: "r1" }))
      .status,
    409,
  );
  assert.equal(cdp.listenerCount("Page.screencastFrame"), 0);
});

test("unwinds CDP after screenshot, screencast startup, and port binding failures", async () => {
  for (const options of [{ failScreenshot: true }, { failStart: true }]) {
    const f = fixture(options);
    await assert.rejects(createViewer(f));
    assert.equal(
      f.cdp.calls.filter(([method]) => method === "detach").length,
      1,
    );
    assert.equal(f.cdp.listenerCount("Page.screencastFrame"), 0);
  }
  const first = await createViewer(fixture());
  try {
    const f = fixture();
    await assert.rejects(
      createViewer({ ...f, port: Number(new URL(first.url).port) }),
      /EADDRINUSE/,
    );
    assert.equal(
      f.cdp.calls.filter(([method]) => method === "detach").length,
      1,
    );
    assert.equal(f.cdp.listenerCount("Page.screencastFrame"), 0);
  } finally {
    await first.close();
  }
});

test("named frontend status binds the visible identity to observed target and model", async (t) => {
  const f = fixture();
  let actualUrl = "http://127.0.0.1:4101/settings?private=do-not-display";
  f.page.url = () => actualUrl;
  const frontend = {
    name: "Settings portal",
    targetOrigin: "http://127.0.0.1:4101",
    model: { id: "notebook", version: "1" },
    evidenceLocation: "/local/synthetic/settings/reports",
    ownership: { browser: "owned", context: "owned", application: "attached" },
  };
  const viewer = await createViewer({ ...f, frontend });
  t.after(() => viewer.close());
  const status = async () =>
    JSON.parse((await request(`${viewer.url}/status`)).body);
  let observed = await status();
  assert.equal(observed.frontend?.name, "Settings portal");
  assert.equal(observed.frontend.currentOrigin, frontend.targetOrigin);
  assert.equal(observed.frontend.matchesTarget, true);
  assert.equal(observed.frontend.matchesModel, true);
  assert.equal(JSON.stringify(observed.frontend).includes("private="), false);
  frontend.name = "changed by caller";
  assert.equal((await status()).frontend.name, "Settings portal");
  actualUrl = "http://127.0.0.1:4102/other";
  observed = await status();
  assert.equal(observed.frontend.matchesTarget, false);
  assert.equal(observed.connected, false);
  const rejected = await post(`${viewer.url}/command`, {
    id: "write",
    revision: "r1",
  });
  assert.equal(rejected.status, 409);
  assert.equal(
    f.calls.length,
    0,
    "a viewer showing a different frontend must not dispatch a command",
  );
  for (const body of [
    { action: "resume" },
    { action: "advance", value: "stage-1" },
  ]) {
    const result = await post(`${viewer.url}/control`, body);
    assert.equal(
      result.status,
      409,
      "controls that can cause effects must reject a target mismatch",
    );
    assert.equal(JSON.parse(result.body).error_code, "frontend_mismatch");
  }
  assert.equal(f.calls.length, 0);
  for (const action of ["pause", "stop"]) {
    assert.equal((await post(`${viewer.url}/control`, { action })).status, 200);
  }
  assert.deepEqual(f.calls, [["pause"], ["stop"]]);
  actualUrl = frontend.targetOrigin + "/settings";
  f.snapshot.descriptor = { ...descriptor, id: "different-model" };
  assert.equal((await status()).frontend.matchesModel, false);
});

test("invalid frontend metadata fails before acquiring browser capture", async (t) => {
  for (const bad of [
    { name: "Portal\nsecret", targetOrigin: "http://127.0.0.1:4101" },
    { name: "Portal", targetOrigin: "http://user:secret@127.0.0.1:4101" },
    { name: "Portal", targetOrigin: "https://example.test/path?token=secret" },
  ]) {
    const f = fixture();
    await assert.rejects(async () => {
      const viewer = await createViewer({ ...f, frontend: bad });
      t.after(() => viewer.close());
    }, /Invalid frontend/);
    assert.equal(f.cdp.calls.length, 0);
  }
});

test("container viewer preserves an explicit loopback origin across a remapped port", async (t) => {
  const f = fixture();
  // Forward bytes with the original Host and Origin, as a published container
  // port does. The viewer must validate the public authority, not this hop.
  let targetPort;
  const published = http.createServer((req, res) => {
    const upstream = http.request(
      {
        hostname: "127.0.0.1",
        port: targetPort,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (response) => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      },
    );
    upstream.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });
  await new Promise((resolve) => published.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    published.closeAllConnections();
    return new Promise((resolve) => published.close(resolve));
  });
  const publicOrigin = `http://127.0.0.1:${published.address().port}`;
  const reservation = http.createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  targetPort = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const viewer = await createViewer({
    ...f,
    host: "0.0.0.0",
    port: targetPort,
    publicOrigin,
  });
  t.after(() => viewer.close());
  const state = await request(`${publicOrigin}/status`);
  assert.equal(state.status, 200, "the mapped public port must be accepted");
  assert.equal(JSON.parse(state.body).connected, true);
  assert.equal(viewer.url, publicOrigin);
  assert.notEqual(Number(new URL(publicOrigin).port), targetPort);
  const lifecycleStream = await events(publicOrigin, { origin: publicOrigin });
  assert.equal(
    lifecycleStream.res.statusCode,
    200,
    "mapped same-origin lifecycle events must remain available",
  );
  const command = { id: "write", revision: "r1" };
  assert.equal(
    (await post(`${publicOrigin}/command`, command, { origin: publicOrigin }))
      .status,
    200,
  );
  assert.deepEqual(f.calls, [["command", command]]);
  f.calls.length = 0;
  for (const headers of [
    { host: `127.0.0.1:${targetPort}` },
    { host: `localhost:${published.address().port}` },
    {
      host: "attacker.example",
      "x-forwarded-host": new URL(publicOrigin).host,
    },
    { origin: "https://attacker.example" },
    { origin: `http://127.0.0.1:${targetPort}` },
    { origin: "null" },
    { "sec-fetch-site": "cross-site" },
  ]) {
    assert.equal(
      (await request(`${publicOrigin}/events`, { headers })).status,
      403,
    );
    for (const [path, body] of [
      ["/command", command],
      ["/presentation", { id: "tour", revision: "r1" }],
      ["/control", { action: "resume" }],
    ])
      assert.equal(
        (await post(`${publicOrigin}${path}`, body, headers)).status,
        403,
        `${path} must reject a foreign authority or origin`,
      );
  }
  assert.deepEqual(
    f.calls,
    [],
    "rejected requests must have no command effect",
  );
  await viewer.close();
  assert.match(await lifecycleStream.ended, /event: viewer-ended/);
  assert.equal((await request(`${publicOrigin}/status`)).status, 502);
  assert.equal(f.cdp.calls.filter(([method]) => method === "detach").length, 1);
});

test("viewer rejects unsafe container addresses before acquiring browser capture", async (t) => {
  const invalid = [
    { host: "0.0.0.0" },
    { host: "::" },
    { host: "localhost" },
    { host: "192.0.2.1" },
    { host: null },
    ...[
      null,
      "",
      "http://127.0.0.1",
      "http://127.0.0.1:0",
      "http://127.0.0.1:80",
      "http://127.0.0.1:65536",
      "https://127.0.0.1:43100",
      "http://127.0.0.1:43100/",
      "http://127.0.0.1:43100/path",
      "http://127.0.0.1:43100?token=private",
      "http://127.0.0.1:43100#fragment",
      "http://user:private@127.0.0.1:43100",
      "http://attacker.example:43100",
      "http://0.0.0.0:43100",
      "http://127.1:43100",
      "http://LOCALHOST:43100",
      "http://localhost:043100",
      "http://localhost:43100\n",
    ].map((publicOrigin) => ({ host: "0.0.0.0", publicOrigin })),
  ];
  for (const options of invalid) {
    const f = fixture();
    await assert.rejects(async () => {
      const viewer = await createViewer({ ...f, ...options });
      t.after(() => viewer.close());
    }, /Invalid viewer (host|public origin)|public origin is required/);
    assert.equal(
      f.cdp.calls.length,
      0,
      "invalid configuration must not capture",
    );
  }
});

test("default viewer keeps both loopback hostnames and exact same-origin mutations", async (t) => {
  const { viewer, calls } = await start(t);
  const port = new URL(viewer.url).port;
  assert.equal(new URL(viewer.url).hostname, "127.0.0.1");
  for (const host of [`127.0.0.1:${port}`, `localhost:${port}`]) {
    assert.equal(
      (await request(`${viewer.url}/status`, { headers: { host } })).status,
      200,
    );
    assert.equal(
      (
        await post(
          `${viewer.url}/control`,
          { action: "pause" },
          {
            host,
            origin: `http://${host}`,
          },
        )
      ).status,
      200,
    );
  }
  assert.deepEqual(calls, [["pause"], ["pause"]]);
});
