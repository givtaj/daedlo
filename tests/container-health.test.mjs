import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { checkHealth } from "../container/healthcheck.mjs";

async function fixture(t, body, code = 200) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ path: req.url, host: req.headers.host });
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { port: server.address().port, requests };
}

test("container health checks the internal port with the configured public Host", async (t) => {
  const app = await fixture(t, {
    connected: true,
    frames: 1,
    driver: { connected: true, descriptor: { id: "fixture", version: "1" } },
  });
  assert.equal(
    await checkHealth({
      port: app.port,
      publicOrigin: "http://127.0.0.1:49219",
    }),
    true,
  );
  assert.deepEqual(app.requests, [
    { path: "/status", host: "127.0.0.1:49219" },
  ]);
});

for (const [name, body, code] of [
  [
    "disconnected",
    {
      connected: false,
      frames: 1,
      driver: { connected: true, descriptor: { id: "fixture" } },
    },
    200,
  ],
  [
    "unobserved driver",
    { connected: true, frames: 1, driver: { connected: false } },
    200,
  ],
  [
    "missing frame",
    {
      connected: true,
      frames: 0,
      driver: { connected: true, descriptor: { id: "fixture" } },
    },
    200,
  ],
  [
    "missing model",
    { connected: true, frames: 1, driver: { connected: true } },
    200,
  ],
  ["invalid JSON", "not json", 200],
  ["HTTP failure", {}, 503],
]) {
  test(`container health refuses ${name}`, async (t) => {
    const app = await fixture(t, body, code);
    assert.equal(
      await checkHealth({
        port: app.port,
        publicOrigin: "http://localhost:49219",
      }),
      false,
    );
  });
}

test("container health refuses a closed listener", async () => {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  assert.equal(
    await checkHealth({ port, publicOrigin: "http://localhost:49219" }),
    false,
  );
});
