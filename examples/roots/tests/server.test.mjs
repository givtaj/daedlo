import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readLiveSession, startServer } from "../serve.mjs";

async function environment(t) {
  const root = await mkdtemp(join(tmpdir(), "roots-workbench-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const archiveDir = join(root, "archive"),
    liveFile = join(root, "live.json");
  await mkdir(join(archiveDir, "images"), { recursive: true });
  const manifest = {
    schemaVersion: 1,
    runs: [
      {
        id: "recorded",
        source: { commit: "abc123" },
        scenarios: [{ name: "Recorded check", status: "PASS" }],
        images: [
          { path: "images/recorded.png", caption: "Historical fixture" },
          { path: "images/escape.png", caption: "Forbidden symlink" },
        ],
      },
    ],
  };
  await writeFile(join(archiveDir, "manifest.json"), JSON.stringify(manifest));
  await writeFile(
    join(archiveDir, "images/recorded.png"),
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  );
  await writeFile(join(root, "private.png"), "must not be served");
  await symlink(
    join(root, "private.png"),
    join(archiveDir, "images/escape.png"),
  );
  return { root, archiveDir, liveFile, manifest };
}

function request(url, { path, method = "GET", headers = {} } = {}) {
  const address = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: address.hostname,
        port: address.port,
        path: path || address.pathname,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString(),
            headers: res.headers,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function fakeViewer(t, handle) {
  const server = http.createServer(handle);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  return `http://127.0.0.1:${server.address().port}`;
}

test("serves only declared archive images and fixed assets; traversal, symlink escapes, hostile Host and mutations are refused", async (t) => {
  const e = await environment(t);
  const server = await startServer(e);
  t.after(() => server.close());
  const index = await request(server.url);
  assert.equal(index.status, 200);
  assert.match(index.body, /Roots, in action/);
  assert.doesNotMatch(
    index.headers["content-security-policy"],
    /unsafe-inline/,
  );
  const manifest = await request(server.url, {
    path: "/archive/manifest.json",
  });
  assert.deepEqual(JSON.parse(manifest.body), e.manifest);
  assert.equal(
    (await request(server.url, { path: "/archive/images/recorded.png" }))
      .status,
    200,
  );
  for (const path of [
    "/archive/images/escape.png",
    "/archive/images/undeclared.png",
    "/archive/%2e%2e/serve.mjs",
    "/archive/images/../../serve.mjs",
    "/serve.mjs",
    "/artifacts/roots-experience/live.json",
    "/api/command",
  ]) {
    assert.equal((await request(server.url, { path })).status, 404, path);
  }
  assert.equal(
    (await request(server.url, { headers: { Host: "attacker.example" } }))
      .status,
    403,
  );
  assert.equal(
    (await request(server.url, { path: "/api/live", method: "POST" })).status,
    405,
  );
  const offline = JSON.parse(
    (await request(server.url, { path: "/api/live" })).body,
  );
  assert.equal(offline.available, false);
  assert.equal(offline.viewerUrl, undefined);
});

test("missing or malformed live metadata never creates a fake session or a usable live link", async (t) => {
  const e = await environment(t);
  for (const value of [
    undefined,
    null,
    [],
    "ready",
    {},
    { status: "ready", viewerUrl: "https://example.com" },
    { status: "ready", viewerUrl: "http://127.0.0.1:1234/arbitrary" },
    { status: "ready", viewerUrl: "http://user:secret@127.0.0.1:1234" },
  ]) {
    if (value !== undefined) await writeFile(e.liveFile, JSON.stringify(value));
    const live = await readLiveSession(e.liveFile);
    assert.equal(live.available, false);
    assert.equal(live.viewerUrl, undefined);
  }
});

test("live probe is read-only, projects the actual Roots state, and excludes private fixture paths and raw observations", async (t) => {
  const e = await environment(t),
    requests = [];
  const url = await fakeViewer(t, (req, res) => {
    requests.push([req.method, req.url]);
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        connected: true,
        frames: 27,
        driver: {
          state: { root: "Root::Strains(Strains::Detail)" },
          execution: "idle",
          observation: { session: "secret-session", notes: "private" },
        },
      }),
    );
  });
  await writeFile(
    e.liveFile,
    JSON.stringify({
      status: "ready",
      viewerUrl: url,
      applicationCommit: "app-commit",
      driverSourceCommit: "driver-commit",
      fixtureRoot: "/private/fixture",
      hostPid: 999,
      createdAt: "2026-09-27T00:00:00Z",
    }),
  );
  const live = await readLiveSession(e.liveFile);
  assert.equal(live.available, true);
  assert.equal(live.currentState, "Root::Strains(Strains::Detail)");
  assert.equal(live.applicationCommit, "app-commit");
  assert.equal(live.label, "Roots original QA driver");
  assert.deepEqual(requests, [["GET", "/status"]]);
  assert.doesNotMatch(
    JSON.stringify(live),
    /private|secret-session|fixtureRoot|hostPid/,
  );
});

test("unreachable, redirecting, oversized and disconnected viewer responses stay unavailable without forwarding or replay", async (t) => {
  const e = await environment(t),
    requests = [];
  for (const mode of [
    "redirect",
    "oversized",
    "disconnected",
    "timeout",
    "trickle",
  ]) {
    const url = await fakeViewer(t, (req, res) => {
      requests.push(req.url);
      if (mode === "redirect") {
        res.writeHead(302, { Location: "/command" });
        res.end();
      } else if (mode === "oversized")
        res.end(
          JSON.stringify({ connected: true, raw: "x".repeat(150 * 1024) }),
        );
      else if (mode === "disconnected")
        res.end(JSON.stringify({ connected: false }));
      else if (mode === "trickle") {
        const interval = setInterval(() => res.write(" "), 80);
        res.once("close", () => clearInterval(interval));
      }
      // Deliberately no response for timeout, proving the UI cannot hang indefinitely.
    });
    await writeFile(
      e.liveFile,
      JSON.stringify({ status: "ready", viewerUrl: url }),
    );
    const start = Date.now();
    const live = await readLiveSession(e.liveFile);
    assert.equal(live.available, false, mode);
    assert.equal(live.viewerUrl, undefined, mode);
    assert.ok(Date.now() - start < 4000, `${mode} probe must be bounded`);
  }
  assert.deepEqual(requests, [
    "/status",
    "/status",
    "/status",
    "/status",
    "/status",
  ]);
});
