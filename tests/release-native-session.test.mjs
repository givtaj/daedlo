import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createNinjaServer } from "../scripts/release/ninja-server.mjs";

test("native reconnect exposes only the current owned viewer and stop keeps safe-boundary failures", async (t) => {
  let closed = 0,
    dirty = true;
  const state = {
    project: { id: "fixture" },
    phase: "idle",
    selected: null,
    running: { id: "installed", version: "1.0.0" },
    blockers: [],
  };
  const manager = Object.fromEntries(
    ["status", "check", "prepare", "activate", "rollback"].map((key) => [
      key,
      async () => state,
    ]),
  );
  const server = await createNinjaServer({
    manager,
    lifecycle: {
      snapshot: async () => ({
        instance: "a".repeat(32),
        configSha256: "b".repeat(64),
        toolsSha256: "c".repeat(64),
        runningId: "installed",
        viewerUrl: "http://127.0.0.1:12345/",
        evidence: null,
      }),
      stop: async () => {
        if (dirty)
          throw Object.assign(Error("private draft"), { code: "dirty_draft" });
        closed++;
      },
      refresh: async () => state,
      restart: async () => state,
      retryEvidence: async () => {},
    },
  });
  t.after(() => server.close());
  const url = new URL(server.url);
  const headers = { Authorization: `Bearer ${url.hash.slice(7)}` };
  const get = () => fetch(url.origin + "/native", { headers });
  const response = await get();
  assert.equal(
    response.status,
    200,
    "native handoff must be available to an authenticated reconnect",
  );
  const snapshot = await response.json();
  assert.equal(snapshot.native.viewerUrl, "http://127.0.0.1:12345/");
  const post = (generation) =>
    fetch(url.origin + "/native", {
      method: "POST",
      headers: {
        ...headers,
        Origin: url.origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "stop", generation }),
    });
  assert.equal((await post(snapshot.generation)).status, 409);
  assert.equal(closed, 0);
  dirty = false;
  assert.equal(
    (await post(snapshot.generation)).status,
    409,
    "old generation cannot replay stop",
  );
  assert.equal(
    (await post((await (await get()).json()).generation)).status,
    200,
  );
  assert.equal(closed, 1);
  assert.equal((await fetch(url.origin + "/native")).status, 401);
});

test("legacy Ninja servers do not expose native lifecycle routes", async (t) => {
  const manager = Object.fromEntries(
    ["status", "check", "prepare", "activate", "rollback"].map((key) => [
      key,
      async () => ({}),
    ]),
  );
  const server = await createNinjaServer({ manager });
  t.after(() => server.close());
  assert.equal(
    (await fetch(new URL(server.url).origin + "/native")).status,
    404,
  );
});

for (const code of ["retained_bundle_missing", "retained_bundle_invalid"])
  test(`native refresh reports ${code} without leaking archive paths`, async (t) => {
    const f = await nativeFixture(t);
    const generation = (await f.request()).body.generation;
    f.lifecycle.refresh = async () => {
      throw Object.assign(Error("private-bundle-path"), { code });
    };
    const response = await f.post("refresh", generation);
    assert.equal(response.status, 409);
    assert.equal(response.body.requestError.code, code);
    assert.match(response.body.requestError.message, /exact.*verified.*bytes/i);
    assert.equal(
      JSON.stringify(response.body).includes("private-bundle-path"),
      false,
    );
  });

async function nativeFixture(t) {
  const state = {
    project: { id: "fixture" },
    phase: "idle",
    selected: { id: "installed", version: "1.0.0" },
    running: { id: "installed", version: "1.0.0" },
    blockers: [],
  };
  const view = {
    instance: "a".repeat(32),
    configSha256: "b".repeat(64),
    toolsSha256: "c".repeat(64),
    runningId: "installed",
    viewerUrl: "http://127.0.0.1:12345/",
  };
  const calls = [];
  const manager = Object.fromEntries(
    ["status", "check", "prepare", "activate", "rollback"].map((key) => [
      key,
      async () => structuredClone(state),
    ]),
  );
  const lifecycle = {
    snapshot: async () => structuredClone(view),
    ...Object.fromEntries(
      ["stop", "refresh", "restart", "retryEvidence"].map((key) => [
        key,
        async () => calls.push(key),
      ]),
    ),
  };
  const server = await createNinjaServer({ manager, lifecycle });
  t.after(() => server.close());
  const url = new URL(server.url);
  const headers = { Authorization: `Bearer ${url.hash.slice(7)}` };
  async function request(path = "/native", options = {}) {
    const response = await fetch(url.origin + path, {
      ...options,
      headers: { ...headers, ...options.headers },
    });
    return { status: response.status, body: await response.json() };
  }
  const post = (action, generation, extra = {}) =>
    request("/native", {
      method: "POST",
      headers: { Origin: url.origin, "Content-Type": "application/json" },
      body: JSON.stringify({ action, generation, ...extra }),
    });
  return {
    state,
    view,
    calls,
    manager,
    lifecycle,
    url,
    headers,
    request,
    post,
  };
}

test("a native handoff never combines a viewer with a different or unavailable running identity", async (t) => {
  const f = await nativeFixture(t);
  f.view.runningId = "different-installation";
  let result = await f.request();
  assert.equal(result.status, 503);
  assert.equal(result.body.native, undefined);
  assert.equal(JSON.stringify(result.body).includes("12345"), false);
  f.view.runningId = null;
  f.view.viewerUrl = null;
  f.manager.status = async () => {
    throw Error("private-status-failure");
  };
  result = await f.request();
  assert.equal(
    result.status,
    503,
    "Unknown manager state cannot become a confirmed stopped handoff",
  );
  assert.equal(result.body.requestError.code, "status_unavailable");
  assert.equal(
    JSON.stringify(result.body).includes("private-status-failure"),
    false,
  );
});

test("native handoff preserves failed observations and sanitizes their reasons", async (t) => {
  const f = await nativeFixture(t);
  const observation = {
    status: "failed",
    error: {
      code: "observation_failed",
      message: "private-observation-detail",
    },
  };
  f.state.observation = observation;
  f.state.dirty = null;
  f.state.blockers = [
    { code: "draft_unknown" },
    { code: "observation_failed" },
  ];
  f.view.observation = observation;
  f.view.viewerUrl = null;
  const failed = await f.request();
  assert.equal(failed.status, 200);
  assert.equal(failed.body.status.observation?.status, "failed");
  assert.equal(failed.body.native.observation?.status, "failed");
  assert.equal(failed.body.status.dirty, null);
  assert.equal(failed.body.native.viewerUrl, null);
  assert.equal(failed.body.status.blockers[0].code, "draft_unknown");
  assert.equal(
    JSON.stringify(failed.body).includes("private-observation-detail"),
    false,
  );
  f.state.observation = { status: "available" };
  f.view.observation = { status: "available" };
  f.state.dirty = false;
  f.state.blockers = [];
  f.view.viewerUrl = "http://127.0.0.1:12345/";
  const recovered = await f.request();
  assert.equal(recovered.body.native.observation.status, "available");
  assert.equal(recovered.body.native.viewerUrl, f.view.viewerUrl);
});

test("native handoff rejects observation state changing across its two reads", async (t) => {
  const f = await nativeFixture(t);
  f.state.observation = {
    status: "failed",
    error: { code: "observation_failed" },
  };
  f.view.observation = { status: "available" };
  const result = await f.request();
  assert.equal(result.status, 503);
  assert.equal(result.body.native, undefined);
});

test("native handoff rejects unsafe or noncanonical owned viewer URLs", async (t) => {
  const f = await nativeFixture(t);
  for (const viewerUrl of [
    "https://example.test/",
    "javascript:alert(1)",
    "http://user:secret@127.0.0.1:12345/",
    "http://localhost:12345/",
    "http://127.0.0.1:0/",
    "http://127.0.0.1:12345/private",
    "http://127.0.0.1:12345/?secret=value",
    "http://127.0.0.1:12345/#secret=value",
  ]) {
    f.view.viewerUrl = viewerUrl;
    const response = await f.request();
    assert.equal(response.status, 503, viewerUrl);
    assert.equal(response.body.native, undefined);
    assert.equal(JSON.stringify(response.body).includes("secret"), false);
  }
});

test("native routes enforce exact Host, Origin, capability token and action shape before dispatch", async (t) => {
  const f = await nativeFixture(t);
  const generation = (await f.request()).body.generation;
  assert.equal((await fetch(f.url.origin + "/native")).status, 401);
  for (const headers of [
    { Origin: "https://example.test" },
    { Origin: "null" },
    { Origin: "" },
    { Authorization: "Bearer wrong" },
    { "Sec-Fetch-Site": "cross-site" },
  ]) {
    const response = await f.request("/native", {
      method: "POST",
      headers: {
        Origin: f.url.origin,
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify({ action: "refresh", generation }),
    });
    assert.ok([401, 403].includes(response.status));
  }
  const wrongHost = await new Promise((resolve, reject) => {
    const req = http.request(
      f.url.origin + "/native",
      {
        headers: { ...f.headers, Host: "evil.example" },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(wrongHost, 403);
  assert.equal((await f.request("/native?token=anything")).status, 404);
  for (const extra of [
    { path: "/private/other-project" },
    { url: "https://example.test" },
    { command: "arbitrary" },
    { installationId: "other" },
  ])
    assert.equal((await f.post("refresh", generation, extra)).status, 400);
  assert.equal((await f.post("arbitrary", generation)).status, 400);
  assert.equal(
    (
      await f.request("/native", {
        method: "POST",
        headers: { Origin: f.url.origin, "Content-Type": "text/plain" },
        body: "{}",
      })
    ).status,
    415,
  );
  assert.deepEqual(f.calls, []);
});

test("native reads during a mutation do not return a handoff and mutation replay remains blocked", async (t) => {
  const f = await nativeFixture(t);
  let finish, entered;
  const waiting = new Promise((done) => {
    entered = done;
  });
  const hold = new Promise((done) => {
    finish = done;
  });
  t.after(() => finish());
  f.lifecycle.refresh = async () => {
    f.calls.push("refresh");
    entered();
    await hold;
  };
  const generation = (await f.request()).body.generation;
  const mutation = f.post("refresh", generation);
  await waiting;
  const during = await f.request();
  assert.equal(during.status, 503);
  assert.equal(during.body.native, undefined);
  const progress = await f.request("/status");
  assert.equal(progress.body.busy, true);
  assert.equal((await f.post("refresh", progress.body.generation)).status, 409);
  finish();
  assert.equal((await mutation).status, 200);
  assert.equal((await f.post("refresh", generation)).status, 409);
  assert.deepEqual(f.calls, ["refresh"]);
});

test("a read crossing a completed mutation rejects even when the running installation id is unchanged", async (t) => {
  const f = await nativeFixture(t);
  const generation = (await f.request()).body.generation;
  let finish,
    entered,
    pause = true;
  const waiting = new Promise((done) => {
    entered = done;
  });
  const hold = new Promise((done) => {
    finish = done;
  });
  t.after(() => finish());
  f.lifecycle.snapshot = async () => {
    const before = structuredClone(f.view);
    if (pause) {
      pause = false;
      entered();
      await hold;
    }
    return before;
  };
  const reading = f.request();
  await waiting;
  assert.equal((await f.post("refresh", generation)).status, 200);
  finish();
  const response = await reading;
  assert.equal(response.status, 503, "The handoff crossed a mutation boundary");
  assert.equal(response.body.native, undefined);
});

for (const completed of [true, false])
  test(`failed post-action observation preserves ${completed ? "completed" : "unknown"} action outcome without inviting replay`, async (t) => {
    const f = await nativeFixture(t);
    const generation = (await f.request()).body.generation;
    f.lifecycle.refresh = async () => {
      f.calls.push("refresh");
      f.lifecycle.snapshot = async () => {
        throw Error("private-snapshot-failure");
      };
      if (!completed)
        throw Object.assign(Error("private-action-failure"), {
          code: "validation_failed",
        });
    };
    const response = await f.post("refresh", generation);
    assert.equal(response.status, 503);
    assert.equal(response.body.requestError.code, "status_unavailable");
    assert.equal(response.body.actionCompleted, completed ? true : null);
    assert.equal(response.body.doNotReplay, true);
    assert.equal(JSON.stringify(response.body).includes("private-"), false);
    assert.deepEqual(f.calls, ["refresh"]);
    assert.equal((await f.request("/status")).status, 200);
  });

test("a rejected asynchronous afterStop cleanup remains handled and retains a private local diagnostic", async () => {
  const moduleUrl = new URL(
    "../scripts/release/ninja-server.mjs",
    import.meta.url,
  ).href;
  const source = `
    import { createNinjaServer } from ${JSON.stringify(moduleUrl)};
    let unhandled = false;
    process.on('unhandledRejection', () => { unhandled = true; });
    const state = {project:{id:'fixture'},phase:'idle',selected:null,running:null,blockers:[]};
    const manager = Object.fromEntries(['status','check','prepare','activate','rollback'].map(k=>[k,async()=>state]));
    const server = await createNinjaServer({manager,lifecycle:{
      snapshot:async()=>({instance:'a'.repeat(32),configSha256:'b'.repeat(64),toolsSha256:'c'.repeat(64),runningId:null,viewerUrl:null}),
      stop:async()=>{},refresh:async()=>{},restart:async()=>{},retryEvidence:async()=>{},
      afterStop:async()=>{throw Error('private-cleanup-secret');}
    }});
    const url = new URL(server.url);
    const headers={Authorization:'Bearer '+url.hash.slice(7)};
    const status = await (await fetch(url.origin+'/native',{headers})).json();
    const response = await fetch(url.origin+'/native',{method:'POST',headers:{...headers,Origin:url.origin,'Content-Type':'application/json'},body:JSON.stringify({action:'stop',generation:status.generation})});
    await response.json();
    await new Promise(done=>setImmediate(done));
    await server.close();
    console.log(JSON.stringify({unhandled,status:response.status}));
  `;
  const result = await promisify(execFile)(
    process.execPath,
    ["--input-type=module", "-e", source],
    {
      timeout: 10000,
      maxBuffer: 32768,
    },
  );
  assert.deepEqual(JSON.parse(result.stdout), {
    unhandled: false,
    status: 200,
  });
  assert.equal(result.stderr.includes("private-cleanup-secret"), false);
  assert.match(result.stderr, /cleanup.*retain|cleanup.*recover/i);
});
