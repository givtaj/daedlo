// Independent application fixture only. Product code is loaded from verified installed packages.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

const fixtureRequire = createRequire(import.meta.url);
const assets = dirname(fixtureRequire.resolve("swagger-ui-dist/package.json"));
const response = (schema) => ({
  description: "Fixture response",
  content: { "application/json": { schema } },
});
const message = {
  type: "object",
  required: ["message"],
  properties: { message: { type: "string" } },
};
const value = {
  type: "object",
  required: ["value"],
  properties: { value: { type: "string" } },
};
function specification(version) {
  return {
    openapi: version,
    info: { title: "Installed Swagger acceptance", version: "1" },
    servers: [{ url: "/api" }],
    paths: {
      "/hello": { get: { responses: { 200: response(message) } } },
      "/allowed/%2{id}/private": {
        post: {
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { 204: { description: "Saved" } },
        },
      },
      "/items/{id}": {
        get: {
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
          responses: { 200: response(message) },
        },
      },
      "/echo": {
        post: {
          requestBody: {
            required: true,
            content: { "application/json": { schema: value } },
          },
          responses: { 200: response(value) },
        },
      },
    },
  };
}
async function fixture() {
  let schema = specification("3.2.1"),
    saved;
  const calls = [];
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://fixture");
      if (url.pathname === "/docs/") {
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(
          '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/swagger-ui.css"><div id="swagger-ui"></div><script src="/swagger-ui-bundle.js"></script><script>window.ui=SwaggerUIBundle({url:"/schema.json",dom_id:"#swagger-ui",validatorUrl:null});</script>',
        );
      } else if (
        ["/swagger-ui.css", "/swagger-ui-bundle.js"].includes(url.pathname)
      ) {
        res.setHeader(
          "content-type",
          url.pathname.endsWith(".css")
            ? "text/css; charset=utf-8"
            : "application/javascript; charset=utf-8",
        );
        res.end(await readFile(join(assets, url.pathname.slice(1))));
      } else if (url.pathname === "/schema.json") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(schema));
      } else if (url.pathname === "/readback") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ value: saved }));
      } else if (url.pathname.startsWith("/api/")) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks).toString();
        calls.push({
          method: req.method,
          path: url.pathname,
          query: url.search,
          mode: req.headers["x-mode"],
          body,
        });
        res.setHeader("content-type", "application/json");
        if (url.pathname === "/api/echo") {
          saved = JSON.parse(body).value;
          res.end(body);
        } else res.end(JSON.stringify({ message: "Independent greeting" }));
      } else {
        res.statusCode = 404;
        res.end();
      }
    } catch {
      res.statusCode = 500;
      res.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    calls,
    document: () => schema,
    configure: (document) => {
      schema = document;
    },
    version: (version) => {
      schema = specification(version);
    },
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  };
}
async function boundedExit(exited) {
  let timer;
  try {
    return await Promise.race([
      exited,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error("Installed Swagger CLI did not close")),
          15000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function closeSwaggerAcceptanceResources(resources) {
  const failedResources = [];
  for (const resource of resources) {
    try {
      await resource.close();
    } catch {
      failedResources.push(resource);
    }
  }
  if (failedResources.length)
    throw Object.assign(
      Error("Owned Swagger acceptance cleanup is incomplete."),
      {
        code: "cleanup_incomplete",
        failedResources,
      },
    );
}

export async function runSwaggerBrowserAcceptance({
  toolsRoot,
  runtimeRoot,
  enginePath,
  output,
}) {
  const helper = await import(
    pathToFileURL(join(toolsRoot, "integrations/swagger/session.mjs")).href
  );
  const loaded = await (
    await import(
      pathToFileURL(join(toolsRoot, "integrations/swagger/runtime.mjs")).href
    )
  ).loadSwaggerRuntime({ runtimeRoot });
  assert.equal(loaded.runtimeRoot, runtimeRoot);
  const { chromium } = createRequire(loaded.runtimeUrl)("playwright");
  const engineHash = createHash("sha256")
    .update(await readFile(enginePath))
    .digest("hex");
  const app = await fixture(),
    checks = [];
  let browser,
    session,
    child,
    exited,
    childOutput = "";
  const reportPath = join(output, "installed-cli-report.json");
  try {
    browser = await chromium.launch({ headless: true });
    const profilePath = join(output, "project.json");
    await writeFile(
      profilePath,
      JSON.stringify({
        docsUrl: app.url + "/docs/",
        schemaUrl: app.url + "/schema.json",
        enginePath,
        runtimeRoot,
        allowOperations: ["GET /hello", "POST /echo"],
        allowWrites: [],
      }),
    );
    child = spawn(
      process.execPath,
      [
        join(runtimeRoot, "src/cli.mjs"),
        "--project",
        join(toolsRoot, "integrations/swagger/project.mjs"),
        "--report",
        reportPath,
      ],
      {
        cwd: output,
        env: {
          ...process.env,
          NODE_PATH: "",
          PLAYWRIGHT_MODULE: "",
          DAEDLO_SWAGGER_PROFILE: profilePath,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    exited = once(child, "exit");
    child.stdout.on("data", (data) => {
      childOutput += data;
    });
    child.stderr.on("data", (data) => {
      childOutput += data;
    });
    const deadline = Date.now() + 20000;
    while (
      !childOutput.includes("Daedlo monitor:") &&
      child.exitCode === null &&
      Date.now() < deadline
    )
      await delay(30);
    assert.match(
      childOutput,
      /Daedlo monitor: http:\/\/127\.0\.0\.1:\d+/,
      "Installed CLI must launch the shipped Swagger project",
    );
    const viewerUrl = childOutput.match(
      /Daedlo monitor: (http:\/\/127\.0\.0\.1:\d+)/,
    )[1];
    const viewer = await browser.newPage();
    await viewer.goto(viewerUrl);
    await viewer.locator('[data-command="select"]').waitFor();
    const status = async () =>
      (await (await viewer.request.get(viewerUrl + "/status")).json()).driver;
    const command = async (id, params = {}) =>
      await (
        await viewer.request.post(viewerUrl + "/command", {
          data: { id, params, revision: (await status()).revision },
        })
      ).json();
    assert.equal((await status()).lastResult, null);
    assert.equal(app.calls.length, 0);
    await viewer.request.post(viewerUrl + "/control", {
      data: { action: "speed", value: "fast" },
    });
    assert.equal(
      (await command("select", { operation: "GET /hello" })).outcome?.kind,
      "success",
    );
    assert.equal(
      (await command("prepare", { request: "{}" })).outcome?.kind,
      "success",
    );
    const cliRead = await command("execute");
    assert.equal(cliRead.outcome?.kind, "success");
    assert.equal(
      cliRead.outcome.label,
      "Documented API response verified; no write expected",
    );
    assert.equal(cliRead.effect.status, "not_attempted");
    assert.equal(app.calls.length, 1);
    assert.equal(app.calls[0].path, "/api/hello");
    checks.push("installed CLI and shipped project execute OpenAPI 3.2.1 read");
    assert.equal(
      (await command("select", { operation: "POST /echo" })).outcome?.kind,
      "success",
    );
    const privateRequest = JSON.stringify({
      body: { value: "PRIVATE_FIXTURE_BODY" },
    });
    const requestInput = viewer.locator("#parameter-prepare-request");
    assert.equal(await requestInput.getAttribute("type"), "password");
    assert.equal(await requestInput.getAttribute("autocomplete"), "off");
    assert.equal(await requestInput.getAttribute("spellcheck"), "false");
    await requestInput.fill(privateRequest);
    await viewer.screenshot({
      path: join(output, "installed-masked-request.png"),
      fullPage: true,
    });
    const submitted = viewer.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === "/command" &&
        request.method() === "POST",
    );
    const prepared = viewer.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/command" &&
        response.request().method() === "POST",
    );
    await viewer.locator('[data-command="prepare"]').click();
    const sent = await submitted;
    assert.equal(
      sent.postDataJSON().params.request === privateRequest,
      true,
      "Masked input must submit the request unchanged",
    );
    assert.equal(
      await requestInput.inputValue(),
      "",
      "Sensitive request must clear after submission",
    );
    assert.equal((await (await prepared).json()).outcome?.kind, "success");
    assert.equal(
      (await viewer.locator("body").innerText()).includes(
        "PRIVATE_FIXTURE_BODY",
      ),
      false,
    );
    assert.equal((await command("execute")).execution, "rejected");
    assert.equal(app.calls.length, 1);
    checks.push(
      "installed viewer masks and clears unchanged private input; denied write sends no request",
    );
    child.kill("SIGTERM");
    assert.equal((await boundedExit(exited))[0], 0);
    child = null;
    const cliReport = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(cliReport.identity.swaggerEngineSha256, engineHash);
    assert.ok(
      cliReport.resources.every(
        (resource) => !resource.owned || resource.status === "closed",
      ),
    );
    assert.equal(
      JSON.stringify(cliReport).includes("PRIVATE_FIXTURE_BODY"),
      false,
    );
    await viewer.close();
    checks.push(
      "CLI final report binds actual Rust binary and closes owned resources",
    );

    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    async function open(options = {}, beforeSession) {
      await page.goto(app.url + "/docs/");
      await page.locator(".opblock").first().waitFor();
      await beforeSession?.();
      const built = await helper.createSwaggerSession({
        page,
        context,
        enginePath,
        runtimeRoot,
        document: app.document(),
        baseUrl: app.url + "/schema.json",
        docsUrl: app.url + "/docs/",
        allowOperations: ["GET /items/{id}", "POST /echo"],
        allowWrites: ["POST /echo"],
        ...options,
      });
      session = built.session;
      session.setSpeed("fast");
      return built;
    }
    const run = async (id, params = {}) =>
      session.execute(id, params, (await session.snapshot()).revision);
    const select = async (operation) =>
      assert.equal(
        (await run("select", { operation })).outcome?.kind,
        "success",
      );
    const prepare = async (request) =>
      assert.equal(
        (await run("prepare", { request: JSON.stringify(request) })).outcome
          .kind,
        "success",
      );
    const inputs = {
      path: { id: "example" },
      query: { limit: 2 },
      headers: { "X-Mode": "brief" },
    };
    for (const version of ["3.0.3", "3.1.0", "3.2.1"]) {
      app.version(version);
      await open();
      await select("GET /items/{id}");
      await prepare(inputs);
      const beforeRead = app.calls.length;
      const read = await run("execute");
      assert.equal(read.outcome?.kind, "success");
      assert.equal(
        read.outcome.label,
        "Documented API response verified; no write expected",
      );
      assert.equal(read.effect.status, "not_attempted");
      assert.equal(
        app.calls.length,
        beforeRead + 1,
        "Each read must dispatch exactly one API request",
      );
      assert.deepEqual(app.calls.at(-1), {
        method: "GET",
        path: "/api/items/example",
        query: "?limit=2",
        mode: "brief",
        body: "",
      });
      await session.close();
      session = null;
      checks.push(
        `installed helper validates ${version} scalar path/query/header request`,
      );
    }
    for (const mode of ["collapsed", "virtualized"]) {
      const document = specification("3.2.1");
      if (mode === "virtualized")
        document.paths = {
          ...Object.fromEntries(
            Array.from({ length: 150 }, (_, index) => [
              `/filler-${index}`,
              {
                get: {
                  operationId: `filler${index}`,
                  responses: { 200: response(message) },
                },
              },
            ]),
          ),
          ...document.paths,
        };
      app.configure(document);
      await open(
        {
          allowOperations: ["GET /hello"],
          allowWrites: [],
          timeoutMs: 1000,
        },
        async () => {
          if (mode === "collapsed") {
            await page.evaluate(() =>
              window.ui.layoutActions.show(
                ["operations-tag", "default"],
                false,
              ),
            );
            await page
              .locator(".opblock")
              .first()
              .waitFor({ state: "hidden", timeout: 2000 });
          } else {
            await page.locator(".operations-virtual").waitFor();
            assert.equal(
              await page.locator('[data-path="/hello"]').count(),
              0,
              "The installed selection target must initially be absent from the virtualized DOM",
            );
          }
        },
      );
      const beforeNavigation = app.calls.length;
      if (mode === "virtualized") await select("GET /filler-0");
      await select("GET /hello");
      assert.equal(
        await page.locator('.opblock-get.is-open [data-path="/hello"]').count(),
        1,
      );
      if (mode === "virtualized")
        assert.equal(
          await page.evaluate(() =>
            window.ui.layoutSelectors.isShown(
              ["operations", "default", "filler0"],
              false,
            ),
          ),
          false,
          "The previous open row must close before navigation unmounts it",
        );
      assert.equal(
        app.calls.length,
        beforeNavigation,
        "Navigation and selection must not send API requests",
      );
      await prepare({});
      const read = await run("execute");
      assert.equal(read.outcome?.kind, "success");
      assert.equal(
        read.outcome.label,
        "Documented API response verified; no write expected",
      );
      assert.equal(read.effect.status, "not_attempted");
      assert.deepEqual(
        app.calls
          .slice(beforeNavigation)
          .map(({ method, path }) => ({ method, path })),
        [{ method: "GET", path: "/api/hello" }],
      );
      await session.close();
      session = null;
      checks.push(
        `installed ${mode} operation selection sends no request before one authorized Execute`,
      );
    }
    app.configure(specification("3.2.1"));
    for (const mode of ["filtered", "missing", "ambiguous"]) {
      await open(
        {
          allowOperations: ["GET /hello"],
          allowWrites: [],
          timeoutMs: 1000,
        },
        async () => {
          if (mode === "filtered") {
            await page.evaluate(() =>
              window.ui.layoutActions.updateFilter("PRIVATE_FIXTURE_FILTER"),
            );
            await page
              .locator(".opblock")
              .first()
              .waitFor({ state: "hidden", timeout: 2000 });
          } else {
            await page
              .locator(".opblock-get")
              .filter({ has: page.locator('[data-path="/hello"]') })
              .evaluate((node, duplicate) => {
                if (duplicate) node.after(node.cloneNode(true));
                else node.remove();
              }, mode === "ambiguous");
          }
        },
      );
      const beforeSelection = app.calls.length;
      const refused = await run("select", { operation: "GET /hello" });
      assert.equal(refused.ok, false);
      assert.equal(refused.error_code, `swagger_operation_${mode}`);
      assert.equal(refused.effect.status, "not_attempted");
      assert.doesNotMatch(
        JSON.stringify(session.report()),
        /PRIVATE_FIXTURE_FILTER|data-path|private local diagnostics/,
      );
      assert.equal(
        app.calls.length,
        beforeSelection,
        "Failed selection must never dispatch an API request",
      );
      await session.close();
      session = null;
      checks.push(
        `installed ${mode} operation refuses selection without API dispatch`,
      );
    }
    const headDocument = specification("3.2.1");
    headDocument.paths["/head"] = {
      head: { responses: { 200: { description: "Headers only" } } },
    };
    app.configure(headDocument);
    await open({ allowOperations: ["HEAD /head"], allowWrites: [] });
    const beforeHead = app.calls.length;
    await select("HEAD /head");
    await prepare({});
    const head = await run("execute");
    assert.equal(head.outcome?.kind, "success");
    assert.equal(
      head.outcome.label,
      "Documented API response verified; no write expected",
    );
    assert.equal(head.effect.status, "not_attempted");
    assert.deepEqual(
      app.calls.slice(beforeHead).map(({ method, path }) => ({ method, path })),
      [{ method: "HEAD", path: "/api/head" }],
    );
    await session.close();
    session = null;
    checks.push("installed HEAD response reports no write expected");
    app.configure(specification("3.2.1"));
    const normalizationOperation = "POST /allowed/%2{id}/private";
    const normalization = await open({
      allowOperations: [normalizationOperation],
      allowWrites: [normalizationOperation],
    });
    await select(normalizationOperation);
    const beforeNormalization = app.calls.length;
    assert.notEqual(
      (await run("prepare", { request: JSON.stringify({ path: { id: "e" } }) }))
        .outcome?.kind,
      "success",
    );
    assert.equal((await normalization.adapter.observe()).facts.prepared, false);
    assert.equal((await run("execute")).execution, "rejected");
    assert.equal(app.calls.length, beforeNormalization);
    await session.close();
    session = null;
    checks.push(
      "composed dot-segment path refuses preparation and dispatches no write",
    );
    const { adapter } = await open();
    await select("GET /items/{id}");
    const beforeInvalid = app.calls.length;
    assert.notEqual(
      (await run("prepare", { request: "{}" })).outcome?.kind,
      "success",
    );
    assert.equal((await run("execute")).execution, "rejected");
    assert.equal(app.calls.length, beforeInvalid);
    checks.push("required-input refusal sends no API request");
    await prepare(inputs);
    const staleRevision = (await session.snapshot()).revision;
    await page
      .locator('.opblock.is-open tr[data-param-name="id"] input')
      .fill("manual-change");
    assert.equal(
      (await session.execute("execute", {}, staleRevision)).execution,
      "rejected",
    );
    assert.equal(app.calls.length, beforeInvalid);
    checks.push("manual input change refuses stale execution");
    await prepare(inputs);
    const authRevision = (await session.snapshot()).revision;
    await context.addCookies([
      {
        name: "fixture_session",
        value: "PRIVATE_FIXTURE_COOKIE",
        domain: "127.0.0.1",
        path: "/api",
      },
    ]);
    assert.equal((await adapter.observe()).facts.prepared, false);
    assert.equal(
      (await session.execute("execute", {}, authRevision)).execution,
      "rejected",
    );
    assert.equal(app.calls.length, beforeInvalid);
    checks.push("authentication change invalidates prepared request");
    await select("POST /echo");
    await prepare({ body: { value: "PRIVATE_FIXTURE_BODY" } });
    const uncertain = await run("execute");
    assert.equal(uncertain.outcome?.kind, "success");
    assert.equal(
      uncertain.outcome.label,
      "Documented API response verified; persistence is not established",
    );
    assert.equal(uncertain.effect.status, "uncertain");
    assert.equal(
      JSON.stringify(session.report()).includes("PRIVATE_FIXTURE_"),
      false,
    );
    checks.push(
      "allowed write remains uncertain without independent persistence proof",
    );
    await session.close();
    session = null;
    assert.equal(page.isClosed(), false);
    assert.equal(
      (await context.cookies()).some(
        (cookie) => cookie.name === "fixture_session",
      ),
      true,
    );
    await open({
      verifyEffect: async ({ request, response }) => {
        const readback = await (await fetch(app.url + "/readback")).json();
        return {
          status:
            response.status === 200 &&
            response.body.value === request.body.value &&
            readback.value === request.body.value
              ? "saved"
              : "uncertain",
        };
      },
    });
    await select("POST /echo");
    await prepare({ body: { value: "PRIVATE_FIXTURE_SAVED" } });
    const saved = await run("execute");
    assert.equal(saved.effect.status, "saved");
    assert.equal(
      saved.outcome.label,
      "Documented API response verified; persistence is not established",
    );
    assert.equal(session.report().identity.swaggerEngineSha256, engineHash);
    assert.equal(
      JSON.stringify(session.report()).includes("PRIVATE_FIXTURE_"),
      false,
    );
    checks.push(
      "exact operation readback proves saved while reports omit private values",
    );
    await session.close();
    session = null;
    assert.equal(page.isClosed(), false);
    assert.equal((await fetch(app.url + "/schema.json")).status, 200);
    await context.close();
    checks.push(
      "attached page authentication and application survive session close",
    );
    return {
      checks,
      swaggerEngineSha256: engineHash,
      swaggerUiVersion: JSON.parse(
        await readFile(join(assets, "package.json"), "utf8"),
      ).version,
    };
  } finally {
    await closeSwaggerAcceptanceResources([
      {
        label: "CLI child",
        pid: child?.pid,
        close: async () => {
          if (child && child.exitCode === null) {
            child.kill("SIGTERM");
            await boundedExit(exited);
          }
        },
      },
      { label: "driver session", close: () => session?.close() },
      { label: "observer browser", close: () => browser?.close() },
      { label: "API fixture", close: () => app.close() },
      {
        label: "CLI diagnostic log",
        close: () => writeFile(join(output, "cli.log"), childOutput),
      },
    ]);
  }
}
