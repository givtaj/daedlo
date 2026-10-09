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
  { method = "GET", headers = {}, body, chunked = false } = {},
) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, (res) => {
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

test("serves a generic descriptor-driven viewer and a fresh snapshot without inline scripts", async (t) => {
  const { viewer } = await start(t);
  const html = await request(viewer.url);
  assert.equal(html.status, 200);
  assert.match(html.body, /Browser Driver/);
  assert.doesNotMatch(html.headers["content-security-policy"], /unsafe-inline/);
  assert.match(
    html.headers["content-security-policy"],
    /frame-ancestors 'none'/,
  );
  const state = JSON.parse((await request(`${viewer.url}/status`)).body);
  assert.equal(state.driver.descriptor.id, "notebook");
  assert.equal(state.connected, true);
  for (const asset of ["monitor.mjs", "styles.css"])
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
