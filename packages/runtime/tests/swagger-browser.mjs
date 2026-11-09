// Independent, real Swagger UI coverage. No Roots source or data is required.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { createDriverSession } from "../src/index.mjs";
import { createSwaggerAdapter } from "../src/swagger/adapter.mjs";
import { buildCatalog } from "../src/swagger/catalog.mjs";
import { createSwaggerSession } from "../../../integrations/swagger/session.mjs";

const require = createRequire(import.meta.url);
const assets = dirname(require.resolve("swagger-ui-dist/package.json"));
const engine = fileURLToPath(
  new URL(
    "../../../integrations/swagger/engine/target/debug/swagger-engine",
    import.meta.url,
  ),
);
const jsonResponse = (schema) => ({
  description: "Independent fixture response",
  content: { "application/json": { schema } },
});
const messageSchema = {
  type: "object",
  required: ["message"],
  properties: { message: { type: "string" } },
};
const valueSchema = {
  type: "object",
  required: ["value"],
  properties: { value: { type: "string" } },
};
function specification(version = "3.0.3") {
  return {
    openapi: version,
    info: { title: "Independent API contract fixture", version: "1" },
    servers: [{ url: "/" }],
    paths: {
      "/hello": {
        get: {
          operationId: "hello",
          responses: { 200: jsonResponse(messageSchema) },
        },
      },
      "/items/{id}": {
        get: {
          operationId: "item",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "limit",
              in: "query",
              required: true,
              schema: { type: "integer", minimum: 1, maximum: 5 },
            },
            {
              name: "X-Mode",
              in: "header",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { 200: jsonResponse(messageSchema) },
        },
      },
      "/echo": {
        post: {
          operationId: "echo",
          requestBody: {
            required: true,
            content: { "application/json": { schema: valueSchema } },
          },
          responses: { 200: jsonResponse(valueSchema) },
        },
      },
      "/invalid": {
        get: {
          operationId: "invalid",
          responses: { 200: jsonResponse(messageSchema) },
        },
      },
      "/denied": {
        get: {
          operationId: "denied",
          responses: { 401: jsonResponse(messageSchema) },
        },
      },
      "/redirect": {
        get: {
          operationId: "redirect",
          responses: { 200: jsonResponse(messageSchema) },
        },
      },
      "/missing": {
        get: {
          operationId: "missing",
          responses: { 200: jsonResponse(messageSchema) },
        },
      },
      "/empty-body": {
        get: {
          operationId: "emptyBody",
          responses: { 200: { description: "No body" } },
        },
      },
      "/null-body": {
        get: {
          operationId: "nullBody",
          responses: { 200: { description: "No body" } },
        },
      },
      "/string-body": {
        get: {
          operationId: "stringBody",
          responses: { 200: { description: "No body" } },
        },
      },
    },
  };
}

async function fixture(schema) {
  const calls = [];
  let redirected = 0;
  let echoFailure = false;
  let heldEcho = null;
  const destination = createServer((_req, res) => {
    redirected++;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ message: "Unapproved destination" }));
  });
  await new Promise((resolve, reject) => {
    destination.once("error", reject);
    destination.listen(0, "127.0.0.1", resolve);
  });
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://fixture");
      const path = url.pathname;
      if (path === "/") {
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(
          '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/swagger-ui.css"></head><body><div id="swagger-ui"></div><script src="/swagger-ui-bundle.js"></script><script>window.ui=SwaggerUIBundle({url:"/openapi.json",dom_id:"#swagger-ui",validatorUrl:null});</script></body></html>',
        );
      } else if (["/swagger-ui.css", "/swagger-ui-bundle.js"].includes(path)) {
        res.setHeader(
          "content-type",
          path.endsWith(".css")
            ? "text/css; charset=utf-8"
            : "application/javascript; charset=utf-8",
        );
        res.end(await readFile(join(assets, path.slice(1))));
      } else if (path === "/openapi.json") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(schema));
      } else if (
        [
          "/hello",
          "/echo",
          "/invalid",
          "/denied",
          "/redirect",
          "/missing",
          "/empty-body",
          "/null-body",
          "/string-body",
        ].includes(path) ||
        path.startsWith("/items/")
      ) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks).toString();
        calls.push({
          method: req.method,
          path,
          query: url.search,
          mode: req.headers["x-mode"],
          body,
        });
        if (path === "/echo" && heldEcho) {
          const held = heldEcho;
          heldEcho = null;
          held.entered();
          await held.wait;
        }
        res.setHeader("content-type", "application/json");
        if (path === "/empty-body") res.end();
        else if (path === "/null-body") res.end("null");
        else if (path === "/string-body") res.end('""');
        else if (path === "/echo" && echoFailure) res.destroy();
        else if (path === "/echo") res.end(body);
        else if (path === "/invalid") res.end(JSON.stringify({ message: 123 }));
        else if (path === "/denied")
          res.writeHead(401).end(JSON.stringify({ message: "Unauthorized" }));
        else if (path === "/redirect")
          res
            .writeHead(302, {
              location: `http://127.0.0.1:${destination.address().port}/unapproved`,
            })
            .end();
        else if (path !== "/missing")
          res.end(JSON.stringify({ message: "Hello" }));
      } else res.writeHead(404).end();
    } catch {
      res.writeHead(500).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const closeServer = (owned) =>
    new Promise((resolve) => {
      owned.close(resolve);
      owned.closeAllConnections();
    });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    calls,
    redirected: () => redirected,
    failNextEcho: () => {
      echoFailure = true;
    },
    holdNextEcho: () => {
      let entered, release;
      const arrival = new Promise((resolve) => {
        entered = resolve;
      });
      const wait = new Promise((resolve) => {
        release = resolve;
      });
      heldEcho = { entered, wait };
      return { entered: arrival, release };
    },
    close: async () => {
      await closeServer(server);
      await closeServer(destination);
    },
  };
}

const shellQuote = (text) => `'${text.replaceAll("'", "'\\''")}'`;
async function setup(
  t,
  {
    version,
    allowOperations = ["GET /hello"],
    allowWrites = [],
    timeoutMs = 1000,
    verifyEffect,
    beforeAdapter,
    useSessionHelper = false,
  } = {},
) {
  const schema = specification(version);
  const app = await fixture(schema);
  const temporary = await mkdtemp(join(tmpdir(), "daedlo-swagger-browser-"));
  let browser, adapter, session;
  t.after(async () => {
    await session?.close();
    if (!session) await adapter?.close();
    await browser?.close();
    await app.close();
    await rm(temporary, { recursive: true, force: true });
  });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(app.url);
  await page.locator(".opblock").first().waitFor();
  assert.deepEqual(
    errors,
    [],
    "The real Swagger bundle must initialize without script errors",
  );
  const catalog = buildCatalog(schema);
  await beforeAdapter?.({ page, context, app });
  if (useSessionHelper) {
    ({ adapter, session } = await createSwaggerSession({
      page,
      context,
      enginePath: engine,
      document: schema,
      baseUrl: app.url,
      docsUrl: app.url + "/",
      allowOperations,
      allowWrites,
      timeoutMs,
      verifyEffect,
    }));
  } else {
    adapter = await createSwaggerAdapter({
      page,
      context,
      catalog,
      baseUrl: app.url,
      docsUrl: app.url + "/",
      allowOperations,
      allowWrites,
      timeoutMs,
      verifyEffect,
    });
    const profile = join(temporary, "profile.json");
    await writeFile(
      profile,
      JSON.stringify({
        specDigest: createHash("sha256")
          .update(JSON.stringify(schema))
          .digest("hex"),
        operations: catalog.operations.map((operation) => ({
          key: operation.key,
          method: operation.method,
          path: operation.path,
          allowExecute: allowOperations.includes(operation.key),
          allowWrite: allowWrites.includes(operation.key),
          autoRecipe: false,
        })),
      }),
    );
    const wrapper = join(temporary, "engine");
    await writeFile(
      wrapper,
      `#!/bin/sh\nexec ${shellQuote(engine)} ${shellQuote(profile)}\n`,
    );
    await chmod(wrapper, 0o700);
    session = await createDriverSession({
      page,
      context,
      enginePath: wrapper,
      adapter,
    });
  }
  session.setSpeed("fast");
  const run = async (command, params = {}) =>
    session.execute(command, params, (await session.snapshot()).revision);
  const select = async (operation) => {
    const result = await run("select", { operation });
    assert.equal(result.outcome?.kind, "success", JSON.stringify(result));
    return result;
  };
  const prepare = async (request = {}) => {
    const result = await run("prepare", { request: JSON.stringify(request) });
    assert.equal(result.outcome?.kind, "success", JSON.stringify(result));
    return result;
  };
  return { app, page, context, adapter, session, run, select, prepare };
}

test("real Swagger selection, prepare, Execute and matching response evidence", async (t) => {
  const f = await setup(t);
  await f.select("GET /hello");
  assert.equal(
    await f.page.locator(".opblock-get.is-open").count(),
    1,
    "selected Swagger operation must visibly open",
  );
  await f.prepare();
  assert.equal((await f.adapter.observe()).facts.prepared, true);
  const result = await f.run("execute");
  assert.equal(result.outcome?.kind, "success", JSON.stringify(result));
  const facts = (await f.adapter.observe()).facts;
  assert.equal(facts.requestCount, 1);
  assert.equal(facts.response.status, 200);
  assert.equal(facts.response.matched, true);
  assert.equal(facts.response.schemaValid, true);
  assert.deepEqual(
    f.app.calls.map(({ method, path }) => ({ method, path })),
    [{ method: "GET", path: "/hello" }],
  );
  assert.equal(result.effect.status, "not_attempted");
  assert.match(result.outcome.label, /persistence is not established/);
});

for (const version of ["3.0.3", "3.1.0", "3.2.1"]) {
  test(`Swagger ${version} path, query and header inputs match the submitted request`, async (t) => {
    const f = await setup(t, { version, allowOperations: ["GET /items/{id}"] });
    await f.select("GET /items/{id}");
    await f.prepare({
      path: { id: "example-item" },
      query: { limit: 3 },
      headers: { "X-Mode": "brief" },
    });
    const result = await f.run("execute");
    assert.equal(result.outcome?.kind, "success", JSON.stringify(result));
    assert.deepEqual(f.app.calls, [
      {
        method: "GET",
        path: "/items/example-item",
        query: "?limit=3",
        mode: "brief",
        body: "",
      },
    ]);
    assert.equal((await f.adapter.observe()).facts.response.matched, true);
  });
}

test("Swagger session reports the actual Rust engine binary identity", async (t) => {
  const f = await setup(t, { useSessionHelper: true });
  const expected = createHash("sha256")
    .update(await readFile(engine))
    .digest("hex");
  assert.equal(f.session.report().identity.swaggerEngineSha256, expected);
  await f.select("GET /hello");
  await f.prepare();
  const result = await f.run("execute");
  assert.equal(result.outcome?.kind, "success", JSON.stringify(result));
  assert.equal(
    f.session.report({ runId: result.runId }).identity.swaggerEngineSha256,
    expected,
  );
});

test("only an absent HTTP body satisfies a response with no declared content", async (t) => {
  const f = await setup(t, {
    allowOperations: ["GET /empty-body", "GET /null-body", "GET /string-body"],
  });
  for (const [operation, expected] of [
    ["GET /empty-body", "success"],
    ["GET /null-body", "unknown"],
    ["GET /string-body", "unknown"],
  ]) {
    await f.select(operation);
    await f.prepare();
    const result = await f.run("execute");
    assert.equal(result.outcome?.kind, expected, JSON.stringify(result));
  }
  assert.equal(f.app.calls.length, 3);
});

test("invalid required inputs dispatch no request", async (t) => {
  const f = await setup(t, { allowOperations: ["GET /items/{id}"] });
  await f.select("GET /items/{id}");
  const missing = await f.run("prepare", { request: "{}" });
  assert.notEqual(missing.outcome?.kind, "success");
  const invalid = await f.run("prepare", {
    request: JSON.stringify({
      path: { id: "example-item" },
      query: { limit: 0 },
      headers: { "X-Mode": "brief" },
    }),
  });
  assert.notEqual(invalid.outcome?.kind, "success");
  assert.equal((await f.adapter.observe()).facts.prepared, false);
  assert.equal((await f.run("execute")).execution, "rejected");
  assert.deepEqual(f.app.calls, []);
});

test("manual input edits invalidate preparation and stale execution", async (t) => {
  const f = await setup(t, { allowOperations: ["GET /items/{id}"] });
  await f.select("GET /items/{id}");
  await f.prepare({
    path: { id: "original" },
    query: { limit: 2 },
    headers: { "X-Mode": "brief" },
  });
  const revision = (await f.session.snapshot()).revision;
  await f.page
    .locator('.opblock.is-open tr[data-param-name="id"] input')
    .fill("manual-edit");
  assert.equal((await f.adapter.observe()).facts.prepared, false);
  assert.equal(
    (await f.session.execute("execute", {}, revision)).execution,
    "rejected",
  );
  assert.equal((await f.run("execute")).execution, "rejected");
  assert.deepEqual(f.app.calls, []);
});

test("manual Swagger Execute cannot bypass the guarded request gate", async (t) => {
  const f = await setup(t);
  await f.select("GET /hello");
  await f.prepare();
  const failed = f.page.waitForEvent("requestfailed", {
    predicate: (request) => new URL(request.url()).pathname === "/hello",
  });
  await f.page.locator(".opblock.is-open button.execute").click();
  await failed;
  assert.deepEqual(f.app.calls, []);
  assert.notEqual((await f.adapter.observe()).facts.response?.matched, true);
});

test("writes require separate policy and successful HTTP does not prove persistence", async (t) => {
  const denied = await setup(t, { allowOperations: ["POST /echo"] });
  await denied.select("POST /echo");
  await denied.prepare({ body: { value: "synthetic fixture value" } });
  assert.equal((await denied.run("execute")).execution, "rejected");
  assert.deepEqual(denied.app.calls, []);
  const allowed = await setup(t, {
    allowOperations: ["POST /echo"],
    allowWrites: ["POST /echo"],
  });
  await allowed.select("POST /echo");
  await allowed.prepare({ body: { value: "synthetic fixture value" } });
  const result = await allowed.run("execute");
  assert.equal(result.outcome?.kind, "success", JSON.stringify(result));
  assert.equal(result.effect.status, "uncertain");
  assert.equal(allowed.app.calls.length, 1);
  assert.deepEqual(JSON.parse(allowed.app.calls[0].body), {
    value: "synthetic fixture value",
  });
  const report = allowed.session.report({ runId: result.runId });
  assert.ok(
    report?.lastResult,
    "A completed report must exist before checking redaction",
  );
  assert.equal(
    JSON.stringify(report).includes("synthetic fixture value"),
    false,
  );
});

test("schema-invalid and documented HTTP error responses are not success", async (t) => {
  const f = await setup(t, {
    allowOperations: ["GET /invalid", "GET /denied"],
  });
  await f.select("GET /invalid");
  await f.prepare();
  assert.equal((await f.run("execute")).outcome?.kind, "unknown");
  assert.equal((await f.adapter.observe()).facts.response.schemaValid, false);
  await f.select("GET /denied");
  await f.prepare();
  assert.equal((await f.run("execute")).outcome?.kind, "recoverable_error");
  assert.equal((await f.adapter.observe()).facts.response.status, 401);
  assert.equal(f.app.calls.length, 2);
});

test("an API redirect never reaches an unapproved destination", async (t) => {
  const f = await setup(t, { allowOperations: ["GET /redirect"] });
  await f.select("GET /redirect");
  await f.prepare();
  assert.notEqual((await f.run("execute")).outcome?.kind, "success");
  assert.equal(
    f.app.redirected(),
    0,
    "A redirect must not dispatch a second network request",
  );
  assert.equal(f.app.calls.length, 1);
});

test("a missing response remains unknown and is never replayed", async (t) => {
  const f = await setup(t, {
    allowOperations: ["GET /missing"],
    timeoutMs: 250,
  });
  await f.select("GET /missing");
  await f.prepare();
  assert.notEqual((await f.run("execute")).outcome?.kind, "success");
  assert.equal(f.app.calls.length, 1);
  assert.equal((await f.adapter.observe()).facts.response, null);
});

test("reset returns to the catalog without dispatching an API call", async (t) => {
  const f = await setup(t);
  await f.select("GET /hello");
  await f.prepare();
  assert.equal((await f.run("reset")).outcome?.kind, "success");
  const facts = (await f.adapter.observe()).facts;
  assert.equal(facts.selected, null);
  assert.equal(facts.prepared, false);
  assert.equal(await f.page.locator(".opblock.is-open").count(), 0);
  assert.deepEqual(f.app.calls, []);
});

test("a failed repeated write cannot reuse a previous private receipt", async (t) => {
  let evidenceChecks = 0;
  const f = await setup(t, {
    allowOperations: ["POST /echo"],
    allowWrites: ["POST /echo"],
    timeoutMs: 250,
    verifyEffect: async ({ response }) => {
      evidenceChecks++;
      assert.equal(response.status, 200);
      assert.equal(response.body.value, "first receipt only");
      return { status: "saved" };
    },
  });
  await f.select("POST /echo");
  await f.prepare({ body: { value: "first receipt only" } });
  const first = await f.run("execute");
  assert.equal(first.effect.status, "saved");
  assert.equal(evidenceChecks, 1);
  f.app.failNextEcho();
  const second = await f.run("execute");
  assert.equal(
    f.app.calls.length,
    2,
    "Each guarded request was dispatched once",
  );
  assert.equal(
    second.effect.status,
    "uncertain",
    "Failed repeat must not reuse prior write proof",
  );
  assert.equal(
    evidenceChecks,
    1,
    "No fresh receipt exists for the evidence hook",
  );
});

test("an unrelated fetch cannot finalize an active consumed request", async (t) => {
  const f = await setup(t, {
    allowOperations: ["POST /echo"],
    allowWrites: ["POST /echo"],
    timeoutMs: 5000,
  });
  await f.select("POST /echo");
  await f.prepare({ body: { value: "delayed receipt" } });
  assert.equal((await f.run("execute")).outcome?.kind, "success");
  const held = f.app.holdNextEcho();
  let second;
  try {
    second = f.run("execute");
    await held.entered;
    await f.page.evaluate(async () => {
      try {
        await fetch("/unrelated");
      } catch {}
    });
    const settled = await Promise.race([
      second.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 300)),
    ]);
    assert.equal(
      settled,
      false,
      "Consumed request must retain ownership until its original response settles",
    );
    assert.equal((await f.session.snapshot()).busy, true);
    assert.equal((await f.run("reset")).execution, "rejected");
  } finally {
    held.release();
    await second;
  }
  assert.notEqual((await second).outcome?.kind, "success");
  assert.equal((await f.session.snapshot()).busy, false);
  assert.equal(f.app.calls.length, 2);
});

test("authentication changes invalidate prepared inputs and the old revision", async (t) => {
  const f = await setup(t, { allowOperations: ["GET /items/{id}"] });
  await f.select("GET /items/{id}");
  await f.prepare({
    path: { id: "auth-scope" },
    query: { limit: 1 },
    headers: { "X-Mode": "brief" },
  });
  const revision = (await f.session.snapshot()).revision;
  await f.context.addCookies([
    {
      name: "fixture_session",
      value: randomUUID(),
      domain: new URL(f.app.url).hostname,
      path: "/items",
    },
  ]);
  assert.equal(
    (await f.adapter.observe()).facts.prepared,
    false,
    "A prepared request belongs to its observed authentication context",
  );
  assert.equal(
    (await f.session.execute("execute", {}, revision)).execution,
    "rejected",
  );
  assert.deepEqual(f.app.calls, []);
});

test("request header names are case insensitive when filling Swagger controls", async (t) => {
  const f = await setup(t, { allowOperations: ["GET /items/{id}"] });
  await f.select("GET /items/{id}");
  await f.prepare({
    path: { id: "case-insensitive" },
    query: { limit: 1 },
    headers: { "x-mode": "brief" },
  });
  const result = await f.run("execute");
  assert.equal(result.outcome?.kind, "success", JSON.stringify(result));
  assert.equal(f.app.calls.length, 1);
  assert.equal(
    f.app.calls[0].mode,
    "brief",
    "The differently cased request header must reach the API",
  );
});

for (const state of ["active", "registered"]) {
  test(`service-worker preflight contract refuses ${state} workers before API effects`, async (t) => {
    let calls;
    await assert.rejects(
      setup(t, {
        beforeAdapter: async ({ page, app }) => {
          calls = app.calls;
          // This checks the browser-facing preflight contract using a controlled
          // observation, not actual service-worker network interception.
          await page.evaluate((state) => {
            Object.defineProperty(navigator, "serviceWorker", {
              configurable: true,
              value: {
                controller: state === "active" ? {} : null,
                getRegistrations: async () =>
                  state === "registered" ? [{}] : [],
              },
            });
          }, state);
        },
      }),
      /service.?worker/i,
    );
    assert.deepEqual(calls, []);
  });
}
