import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { createUniversalServer } from "../packages/universal/src/server.mjs";

async function unusedPort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const { port } = socket.address();
  await new Promise((resolve, reject) =>
    socket.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

const target = {
  id: "container-target",
  label: "Container target",
  environment: "conformance",
  origin: "http://application:8080",
  model: { id: "notebook", version: "1" },
  revision: 1,
};
function dependencies() {
  const calls = [];
  return {
    calls,
    catalog: {
      async listTargets() {
        calls.push("list");
        return [target];
      },
      async listRuns() {
        throw Error("Unexpected history access");
      },
      async getRun() {
        throw Error("Unexpected journal access");
      },
      async indexTarget() {
        calls.push("index");
        return {
          targetId: target.id,
          generation: 1,
          indexedRuns: 0,
          unchangedRuns: 0,
          incompleteRuns: 0,
          invalidRuns: 0,
          bytesRead: 0,
          indexedAt: "2026-11-17T10:00:00.000Z",
        };
      },
    },
    async launch() {
      throw Error("Unexpected application launch");
    },
  };
}
async function mustReject(options, message) {
  let unexpected;
  try {
    await assert.rejects(
      async () => {
        unexpected = await createUniversalServer(options);
      },
      TypeError,
      message,
    );
  } finally {
    await unexpected?.close();
  }
}
function request(port, path, { headers = {}, method = "GET", body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path, method, headers },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (part) => {
          text += part;
        });
        res.on("error", reject);
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, text }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

test("explicit container binding advertises mapped loopback origin and preserves every request guard", async (t) => {
  const port = await unusedPort();
  // Deliberately different: host port publication is not the listening address.
  const publicPort = port === 43191 ? 43192 : 43191;
  const containerOrigin = `http://127.0.0.1:${publicPort}`;
  const d = dependencies();
  const server = await createUniversalServer({
    ...d,
    host: "0.0.0.0",
    port,
    containerOrigin,
  });
  t.after(() => server.close());
  const url = new URL(server.url);
  assert.equal(url.origin, containerOrigin);
  assert.match(url.hash, /^#token=[a-f0-9]{64}$/);
  const headers = {
    Host: url.host,
    Authorization: `Bearer ${url.hash.slice(7)}`,
  };
  const read = (extra = {}) =>
    request(port, "/api/targets", { headers: { ...headers, ...extra } });
  const shell = await request(port, "/", { headers: { Host: url.host } });
  assert.equal(shell.status, 200);
  assert.equal(shell.headers["access-control-allow-origin"], undefined);
  assert.match(
    shell.headers["content-security-policy"],
    /frame-ancestors 'none'/,
  );
  for (const Host of [
    `127.0.0.1:${port}`,
    `localhost:${publicPort}`,
    `0.0.0.0:${publicPort}`,
    "attacker.invalid",
    `127.0.0.1:${publicPort + 1}`,
  ]) {
    assert.equal((await read({ Host })).status, 403, Host);
  }
  for (const Origin of [
    "null",
    "http://attacker.invalid",
    `http://localhost:${publicPort}`,
    `http://127.0.0.1:${port}`,
    containerOrigin + "/",
  ]) {
    assert.equal((await read({ Origin })).status, 403, Origin);
  }
  assert.equal((await read({ "Sec-Fetch-Site": "cross-site" })).status, 403);
  assert.equal(
    (await request(port, "/api/targets", { headers: { Host: url.host } }))
      .status,
    401,
  );
  assert.equal((await read({ Authorization: "Bearer wrong" })).status, 401);
  assert.deepEqual(
    d.calls,
    [],
    "Rejected requests must not read or write customer data",
  );
  const valid = await read({ Origin: containerOrigin });
  assert.equal(valid.status, 200);
  assert.equal(JSON.parse(valid.text).targets[0].id, target.id);
  d.calls.length = 0;
  const post = (extra = {}) =>
    request(port, `/api/targets/${target.id}/index`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json", ...extra },
      body: JSON.stringify({ revision: 1 }),
    });
  assert.equal((await post()).status, 403);
  assert.equal((await post({ Origin: "http://attacker.invalid" })).status, 403);
  assert.deepEqual(d.calls, []);
  assert.equal((await post({ Origin: containerOrigin })).status, 200);
  assert.deepEqual(d.calls, ["list", "index"]);
});

test("container networking requires explicit canonical loopback origin and fixed internal port", async () => {
  const badOrigins = [
    null,
    "",
    false,
    43191,
    "http://localhost:43191",
    "http://0.0.0.0:43191",
    "http://[::1]:43191",
    "https://127.0.0.1:43191",
    "http://127.0.0.1",
    "http://127.0.0.1:0",
    "http://127.0.0.1:65536",
    "http://127.0.0.1:043191",
    "http://127.0.0.1:43191/",
    "http://127.0.0.1:43191/path",
    "http://127.0.0.1:43191?x=y",
    "http://127.0.0.1:43191#x",
    "http://user@127.0.0.1:43191",
    "http://127.1:43191",
    "http://127.0.0.1:80",
    " http://127.0.0.1:43191",
    "http://127.0.0.1:43191\n",
  ];
  for (const containerOrigin of badOrigins) {
    await mustReject(
      { ...dependencies(), host: "0.0.0.0", port: 43190, containerOrigin },
      String(containerOrigin),
    );
  }
  for (const [host, port, containerOrigin] of [
    ["0.0.0.0", 43190, undefined],
    ["127.0.0.1", 43190, "http://127.0.0.1:43191"],
    ["localhost", 43190, "http://127.0.0.1:43191"],
    ["0.0.0.0", 0, "http://127.0.0.1:43191"],
    ["0.0.0.0", -1, "http://127.0.0.1:43191"],
    ["0.0.0.0", 65536, "http://127.0.0.1:43191"],
  ]) {
    await mustReject({ ...dependencies(), host, port, containerOrigin });
  }
});

test("ordinary Universal keeps its ephemeral loopback address and refuses wider binding", async (t) => {
  const d = dependencies();
  const server = await createUniversalServer(d);
  t.after(() => server.close());
  const url = new URL(server.url);
  assert.equal(url.hostname, "127.0.0.1");
  assert.ok(Number(url.port) > 0);
  assert.equal((await fetch(url.origin + "/")).status, 200);
  const listing = await request(Number(url.port), "/api/targets", {
    headers: { Host: url.host, Authorization: `Bearer ${url.hash.slice(7)}` },
  });
  assert.equal(listing.status, 200);
  assert.equal(Object.hasOwn(JSON.parse(listing.text), "liveLaunch"), false);
  for (const host of ["0.0.0.0", "localhost", "::", "::1"])
    await mustReject({ ...dependencies(), host });
});

test("container target listings declare live launch unavailable without changing native payloads", async (t) => {
  const port = await unusedPort();
  const server = await createUniversalServer({
    ...dependencies(),
    host: "0.0.0.0",
    port,
    containerOrigin: `http://127.0.0.1:${port}`,
  });
  t.after(() => server.close());
  const url = new URL(server.url);
  const response = await request(port, "/api/targets", {
    headers: { Host: url.host, Authorization: `Bearer ${url.hash.slice(7)}` },
  });
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.text).liveLaunch, false);
});

test("container live-launch requests refuse before calling an injected launcher", async (t) => {
  const port = await unusedPort();
  let launchCalls = 0;
  const server = await createUniversalServer({
    ...dependencies(),
    host: "0.0.0.0",
    port,
    containerOrigin: `http://127.0.0.1:${port}`,
    async launch() {
      launchCalls++;
      return {
        status: "running",
        reused: false,
        viewerUrl: "http://127.0.0.1:43199/",
      };
    },
  });
  t.after(() => server.close());
  const url = new URL(server.url);
  const response = await request(port, `/api/targets/${target.id}/launch`, {
    method: "POST",
    headers: {
      Host: url.host,
      Origin: url.origin,
      Authorization: `Bearer ${url.hash.slice(7)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ revision: 1 }),
  });
  assert.equal(
    launchCalls,
    0,
    "Container requests must never launch a managed native viewer",
  );
  assert.equal(response.status, 409);
  assert.equal(
    JSON.parse(response.text).error.code,
    "container_runner_required",
  );
});
