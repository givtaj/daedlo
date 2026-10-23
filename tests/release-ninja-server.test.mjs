import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createNinjaServer } from "../scripts/release/ninja-server.mjs";

function fixture() {
  const calls = [];
  const state = {
    project: { id: "fixture", label: "Registered fixture" },
    selected: {
      id: "old",
      version: "0.1.4-alpha.2",
      sourceSha256: "a".repeat(64),
    },
    running: { id: "old", version: "0.1.4-alpha.2" },
    phase: "idle",
    available: null,
    operation: null,
    canRollback: false,
  };
  const manager = {
    status: async () => structuredClone(state),
    async check() {
      calls.push(["check"]);
      state.phase = "available";
      state.available = { id: "release-from-manager", version: "0.1.5" };
    },
    async prepare(id) {
      calls.push(["prepare", id]);
      state.phase = "ready";
      state.operation = { id: "operation-from-manager", status: "ready" };
    },
    async activate(id, options) {
      calls.push(["activate", id, options]);
      state.selected = { id: "candidate", version: "0.1.5" };
      state.running = { ...state.selected };
      state.phase = "updated";
      state.available = null;
      state.operation = null;
      state.canRollback = true;
    },
    async rollback(options) {
      calls.push(["rollback", options]);
      state.selected = {
        id: "old",
        version: "0.1.4-alpha.2",
        historicalSnapshot: true,
      };
      state.running = { ...state.selected };
      state.phase = "rolled_back";
      state.canRollback = false;
    },
  };
  return { manager, calls, state };
}

async function start(t, f = fixture()) {
  const server = await createNinjaServer({ manager: f.manager });
  t.after(() => server.close());
  const url = new URL(server.url);
  const token = new URLSearchParams(url.hash.slice(1)).get("token");
  const origin = url.origin;
  async function request(path, options = {}) {
    const res = await fetch(origin + path, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...options.headers },
    });
    return { status: res.status, body: await res.json(), headers: res.headers };
  }
  const status = () => request("/status");
  const action = async (action, extra = {}, generation) =>
    request("/action", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        generation: generation ?? (await status()).body.generation,
        ...extra,
      }),
    });
  return { ...f, server, origin, token, request, status, action };
}

test("status requires the local capability token and the page does not disclose it", async (t) => {
  const f = await start(t);
  assert.equal((await fetch(f.origin + "/status")).status, 401);
  const status = await f.status();
  assert.equal(status.status, 200);
  assert.equal(status.body.status.project.id, "fixture");
  assert.match(status.body.generation, /^[a-f0-9]{32}$/);
  const page = await fetch(f.origin);
  assert.equal(page.status, 200);
  assert.equal((await page.text()).includes(f.token), false);
  assert.match(
    page.headers.get("Content-Security-Policy"),
    /frame-ancestors 'none'/,
  );
  assert.match(
    page.headers.get("Content-Security-Policy"),
    /script-src 'nonce-/,
  );
  assert.equal(page.headers.get("Cache-Control"), "no-store");
  assert.equal(page.headers.get("Referrer-Policy"), "no-referrer");
  assert.deepEqual(f.calls, []);
});

test("only server-owned candidate and operation IDs reach the manager", async (t) => {
  const f = await start(t);
  const checked = await f.action("check");
  assert.equal(checked.status, 200);
  assert.equal(checked.body.status.phase, "available");
  assert.equal(
    (await f.action("install", { releaseId: "attacker" })).status,
    400,
  );
  assert.equal((await f.action("install")).status, 200);
  assert.equal((await f.action("restart")).status, 400);
  assert.equal(
    (await f.action("restart", { acknowledgeRestart: true })).status,
    200,
  );
  assert.equal(
    (await f.action("revert", { acknowledgeRestart: true })).status,
    200,
  );
  assert.deepEqual(f.calls, [
    ["check"],
    ["prepare", "release-from-manager"],
    ["activate", "operation-from-manager", { acknowledgeRestart: true }],
    ["rollback", { acknowledgeRestart: true }],
  ]);
});

test("Host, Origin, token and strict request shape refuse cross-site and arbitrary inputs", async (t) => {
  const f = await start(t);
  const generation = (await f.status()).body.generation;
  for (const headers of [
    { Origin: "https://evil.example" },
    { Origin: "null" },
    { Origin: "" },
    { Authorization: "Bearer wrong" },
    { "Sec-Fetch-Site": "cross-site" },
  ]) {
    const res = await f.request("/action", {
      method: "POST",
      headers: {
        Origin: f.origin,
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify({ action: "check", generation }),
    });
    assert.ok([401, 403].includes(res.status), JSON.stringify(headers));
  }
  const wrongHost = await new Promise((resolve, reject) => {
    const req = http.request(
      f.origin + "/status",
      { headers: { Host: "evil.example", Authorization: `Bearer ${f.token}` } },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(wrongHost, 403);
  for (const body of [
    "[]",
    "null",
    "{",
    JSON.stringify({ action: "check", generation, path: "/tmp" }),
    JSON.stringify({
      action: "check",
      generation,
      url: "https://evil.example",
    }),
    JSON.stringify({ action: "shell", generation }),
  ]) {
    assert.equal(
      (
        await f.request("/action", {
          method: "POST",
          headers: { Origin: f.origin, "Content-Type": "application/json" },
          body,
        })
      ).status,
      400,
    );
  }
  assert.equal(
    (
      await f.request("/action", {
        method: "POST",
        headers: { Origin: f.origin, "Content-Type": "text/plain" },
        body: "{}",
      })
    ).status,
    415,
  );
  assert.equal((await f.request("/status?token=wrong")).status, 404);
  assert.deepEqual(f.calls, []);
});

test("bounded bodies reject both declared and chunked oversized requests without dispatch", async (t) => {
  const f = await start(t);
  const payload = JSON.stringify({
    action: "check",
    generation: "x".repeat(20000),
  });
  assert.equal(
    (
      await f.request("/action", {
        method: "POST",
        headers: { Origin: f.origin, "Content-Type": "application/json" },
        body: payload,
      })
    ).status,
    413,
  );
  const code = await new Promise((resolve, reject) => {
    const req = http.request(
      f.origin + "/action",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${f.token}`,
          Origin: f.origin,
          "Content-Type": "application/json",
          "Transfer-Encoding": "chunked",
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      },
    );
    req.on("error", reject);
    req.write(payload.slice(0, 9000));
    req.end(payload.slice(9000));
  });
  assert.equal(code, 413);
  assert.deepEqual(f.calls, []);
});

test("generations reject replay and manager state changes observed after the page snapshot", async (t) => {
  const f = await start(t);
  const old = (await f.status()).body.generation;
  assert.equal((await f.action("check", {}, old)).status, 200);
  assert.equal((await f.action("check", {}, old)).status, 409);
  const before = (await f.status()).body.generation;
  f.state.available.id = "replacement-release";
  assert.equal((await f.action("install", {}, before)).status, 409);
  assert.deepEqual(f.calls, [["check"]]);
});

test("a pending operation exposes progress but refuses a second mutation", async (t) => {
  const f = fixture();
  let finish;
  f.manager.check = async () => {
    f.calls.push(["check"]);
    f.state.phase = "checking";
    await new Promise((r) => {
      finish = r;
    });
    f.state.phase = "available";
  };
  const s = await start(t, f);
  const generation = (await s.status()).body.generation;
  const first = s.action("check", {}, generation);
  while (!finish) await new Promise((r) => setTimeout(r, 5));
  const pending = await s.status();
  assert.equal(pending.body.busy, true);
  assert.equal(pending.body.status.phase, "checking");
  assert.equal(
    (await s.action("check", {}, pending.body.generation)).status,
    409,
  );
  finish();
  assert.equal((await first).status, 200);
  assert.deepEqual(f.calls, [["check"]]);
});

test("busy/draft/recovery failures remain failures and never leak manager diagnostics", async (t) => {
  const f = await start(t);
  await f.action("check");
  await f.action("install");
  for (const code of [
    "busy",
    "draft_unpreserved",
    "recovery_required",
    "unexpected",
  ]) {
    f.manager.activate = async () => {
      throw Object.assign(new Error("secret /customer/path token123"), {
        code,
      });
    };
    const response = await f.action("restart", { acknowledgeRestart: true });
    assert.equal(response.body.ok, false);
    assert.equal(response.status, 409);
    assert.equal(response.body.status.selected.version, "0.1.4-alpha.2");
    assert.equal(JSON.stringify(response.body).includes("token123"), false);
  }
});

test("status exposes only safe contract fields and unknown phases fail closed", async (t) => {
  const f = fixture();
  f.state.privatePath = "/secrets";
  f.state.project.root = "/customer";
  f.state.error = { code: "source_changed", message: "secret token123" };
  f.state.phase = "future_phase";
  const s = await start(t, f);
  const response = await s.status();
  assert.equal(response.body.status.phase, "recovery_required");
  assert.equal(JSON.stringify(response.body).includes("secret"), false);
  assert.equal(JSON.stringify(response.body).includes("/customer"), false);
  assert.equal(response.body.actions.install, false);
});

test("an explicitly failed manager result is not reported as a successful action", async (t) => {
  const f = await start(t);
  await f.action("check");
  f.manager.prepare = async () => ({
    ok: false,
    error: { code: "validation_failed", message: "private diagnostics" },
  });
  const response = await f.action("install");
  assert.equal(response.body.ok, false);
  assert.equal(response.body.requestError.code, "validation_failed");
  assert.equal(response.status, 409);
});

test("recovery restores a selection without claiming a running session", async (t) => {
  const f = fixture();
  f.state.phase = "recovered";
  f.state.running = null;
  const s = await start(t, f);
  const response = await s.status();
  assert.equal(response.body.status.phase, "recovered");
  assert.equal(response.body.status.selected.version, "0.1.4-alpha.2");
  assert.equal(response.body.status.running, null);
  assert.equal(response.body.actions.restart, false);
});

test("server rejects non-loopback binding and does not close the externally owned manager", async () => {
  const f = fixture();
  await assert.rejects(
    createNinjaServer({ manager: f.manager, host: "0.0.0.0" }),
    /127\.0\.0\.1/,
  );
  let closed = 0;
  f.manager.close = () => {
    closed++;
  };
  const server = await createNinjaServer({ manager: f.manager });
  await server.close();
  await server.close();
  assert.equal(closed, 0);
});
