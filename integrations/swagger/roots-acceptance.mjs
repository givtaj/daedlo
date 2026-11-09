// Actual Roots Swagger browser acceptance. The caller owns the disposable API.
// This script owns only its fresh Chromium context and Daedlo session.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createSwaggerSession } from "./session.mjs";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} explicitly.`);
  return value;
};
const configuredOrigin = new URL(required("ROOTS_SWAGGER_ORIGIN"));
assert.ok(
  ["http:", "https:"].includes(configuredOrigin.protocol),
  "HTTP origin required",
);
assert.equal(
  configuredOrigin.username + configuredOrigin.password,
  "",
  "No URL credentials",
);
assert.equal(configuredOrigin.pathname, "/", "Supply an origin without a path");
assert.equal(
  configuredOrigin.search + configuredOrigin.hash,
  "",
  "Supply only an origin",
);
const origin = configuredOrigin.origin;
assert.equal(
  process.env.ROOTS_SWAGGER_DISPOSABLE,
  "1",
  "Set ROOTS_SWAGGER_DISPOSABLE=1 for the caller-owned disposable fixture",
);
const accountFile = resolve(required("ROOTS_SWAGGER_ACCOUNTS"));
const accounts = JSON.parse(fs.readFileSync(accountFile, "utf8"));
assert.equal(
  typeof accounts.customer?.email,
  "string",
  "Synthetic customer email required",
);
assert.equal(
  typeof accounts.customer?.password,
  "string",
  "Synthetic customer password required",
);
const output = resolve(required("SWAGGER_EVIDENCE_DIR"));
assert.ok(
  !fs.existsSync(output) || fs.readdirSync(output).length === 0,
  "Use a fresh evidence directory",
);
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const manifestFile = process.env.ROOTS_SWAGGER_MANIFEST
  ? resolve(process.env.ROOTS_SWAGGER_MANIFEST)
  : join(dirname(accountFile), "manifest.json");
const manifest = fs.existsSync(manifestFile)
  ? JSON.parse(fs.readFileSync(manifestFile, "utf8"))
  : null;
const enginePath = resolve(
  process.env.SWAGGER_ENGINE_PATH ||
    fileURLToPath(
      new URL("./engine/target/debug/swagger-engine", import.meta.url),
    ),
);
const docsUrl = `${origin}/api/docs/`;
const schemaResponse = await fetch(`${origin}/api/openapi.json`, {
  signal: AbortSignal.timeout(10000),
  redirect: "error",
});
assert.equal(
  schemaResponse.status,
  200,
  "The supplied API must serve its real schema",
);
const document = await schemaResponse.json();
const methodNames = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "trace",
]);
const operations = Object.entries(document.paths || {}).flatMap(
  ([path, item]) =>
    Object.keys(item)
      .filter((method) => methodNames.has(method))
      .map((method) => `${method.toUpperCase()} ${path}`),
);
const allowOperations = [
  "GET /api/hello",
  "GET /api/health",
  "GET /api/auth/me",
  "POST /api/auth/login",
  "GET /api/strains",
  "GET /api/checkins",
  "POST /api/strains",
];
for (const operation of allowOperations)
  assert.ok(
    operations.includes(operation),
    "Required Roots operation must be documented",
  );
const scenarioNames = [
  "Discover the actual Roots schema and execute greeting through Swagger UI",
  "Execute the PostgreSQL health check through Swagger UI",
  "Unauthenticated current-user response stays a non-success outcome",
  "Missing required query input is rejected before an API request",
  "A write without explicit write permission is rejected before an API request",
  "A stale revision cannot execute a prepared request",
  "Login through Swagger with a JSON body and CSRF header",
  "The owned browser session authenticates a subsequent current-user operation",
  "A documented query parameter reaches the authenticated strains operation",
  "Reset clears the selected request without replaying it",
  "A successful write response with absent independent readback remains uncertain",
  "An explicitly allowed synthetic strain write is saved only after exact independent readback",
];
const results = [];
const reports = [];
const startedAt = new Date().toISOString();
const identity = {
  rootsSourceCommit: /^[a-f0-9]{40}$/.test(manifest?.sourceCommit || "")
    ? manifest.sourceCommit
    : null,
  rootsSourceKind:
    manifest?.sourceState ===
    "Current working tree, including pre-existing uncommitted changes"
      ? "working-tree-including-pre-existing-changes"
      : "not-established-by-this-run",
  rootsApiSha256: /^[a-f0-9]{64}$/.test(manifest?.apiSha256 || "")
    ? manifest.apiSha256
    : null,
  schemaSha256: createHash("sha256")
    .update(JSON.stringify(document))
    .digest("hex"),
  schemaVersion: String(document.openapi),
  documentedOperationCount: operations.length,
  engineSha256: createHash("sha256")
    .update(fs.readFileSync(enginePath))
    .digest("hex"),
};
let cleanup = {
  session: "not-started",
  browser: "not-started",
  attachedApi: "preserved",
};
const save = () =>
  fs.writeFileSync(
    join(output, "summary.json"),
    JSON.stringify(
      {
        format: "daedlo-roots-swagger-acceptance/1",
        startedAt,
        recordedAt: new Date().toISOString(),
        identity,
        testLevel:
          "real Chromium + actual Roots Swagger UI + native API + caller-owned disposable PostgreSQL",
        results,
        notRun: scenarioNames.filter(
          (name) => !results.some((r) => r.name === name),
        ),
        cleanup,
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
let browser, context, page;
let consumer;
let requestCount = 0;
const responses = [];
const isApplicationRequest = (request) => {
  const url = new URL(request.url());
  return (
    url.origin === origin &&
    url.pathname.startsWith("/api/") &&
    url.pathname !== "/api/openapi.json" &&
    !url.pathname.startsWith("/api/docs")
  );
};
const publicResult = (result) => ({
  command: ["select", "prepare", "execute", "reset"].includes(result.command)
    ? result.command
    : null,
  execution: result.execution,
  outcome: result.outcome?.kind ?? null,
  effect: result.effect?.status ?? null,
  ok: result.ok === true,
  errorCode: /^[a-z_]{1,80}$/.test(result.error_code || "")
    ? result.error_code
    : null,
});
const run = async (id, params = {}) => {
  const before = await consumer.session.observe();
  assert.equal(
    before.connected,
    true,
    "Swagger observation must remain connected",
  );
  const result = await consumer.session.execute(id, params, before.revision);
  reports.push(publicResult(result));
  return result;
};
const success = (result, label) => {
  assert.equal(result.execution, "completed", `${label} must complete`);
  assert.equal(result.outcome?.kind, "success", `${label} must verify success`);
};
const select = async (operation) =>
  success(await run("select", { operation }), "Select");
const prepare = async (request = {}) =>
  success(
    await run("prepare", { request: JSON.stringify(request) }),
    "Prepare",
  );
const responseFor = (start, method, path, status) => {
  const matches = responses
    .slice(start)
    .filter(
      (response) =>
        response.request().method() === method &&
        new URL(response.url()).pathname === path,
    );
  assert.equal(
    matches.length,
    1,
    "An execution must produce exactly one matching response",
  );
  assert.equal(
    matches[0].status(),
    status,
    "The actual API response status must match",
  );
  return matches[0];
};
const executeRead = async (operation, request, status = 200) => {
  await select(operation);
  await prepare(request);
  const responseStart = responses.length;
  const requestsBefore = requestCount;
  const result = await run("execute");
  assert.equal(
    requestCount,
    requestsBefore + 1,
    "Execute must issue exactly one API request",
  );
  const [method, path] = operation.split(" ");
  const response = responseFor(responseStart, method, path, status);
  return { result, response };
};
const scenario = async (name, fn) => {
  try {
    await fn();
    results.push({ name, status: "PASS" });
  } catch (error) {
    // Our assertions use static public messages. Keep only that authored first
    // line, never the assertion's actual/expected values or other exceptions.
    const detail =
      error instanceof assert.AssertionError && !error.generatedMessage
        ? error.message.split("\n")[0]
        : "Acceptance assertion failed; private inputs omitted.";
    results.push({
      name,
      status: "FAIL",
      detail,
    });
    throw new Error("Swagger acceptance scenario failed.");
  } finally {
    save();
    fs.writeFileSync(
      join(output, "results.json"),
      JSON.stringify(reports, null, 2) + "\n",
      { mode: 0o600 },
    );
  }
};
try {
  browser = await chromium.launch({
    headless: process.env.ROOTS_SWAGGER_HEADED !== "1",
  });
  cleanup.browser = "owned";
  context = await browser.newContext({
    viewport: { width: 1360, height: 1000 },
  });
  page = await context.newPage();
  page.on("request", (request) => {
    if (isApplicationRequest(request)) requestCount += 1;
  });
  page.on("response", (response) => {
    if (isApplicationRequest(response.request())) responses.push(response);
  });
  await page.goto(docsUrl);
  await page.locator(".swagger-ui .opblock").first().waitFor();
  consumer = await createSwaggerSession({
    page,
    context,
    enginePath,
    document,
    baseUrl: origin,
    docsUrl,
    allowOperations,
    allowWrites: ["POST /api/auth/login"],
  });
  cleanup.session = "owned";
  consumer.session.setSpeed("fast");
  await scenario(scenarioNames[0], async () => {
    assert.ok(
      consumer.catalog,
      "The actual served schema must produce a catalog",
    );
    const { result, response } = await executeRead("GET /api/hello", {});
    success(result, "Greeting");
    assert.deepEqual(
      await response.json(),
      { message: "Hello, world!" },
      "Actual greeting body must match",
    );
    await page.screenshot({
      path: join(output, "greeting-swagger.png"),
      fullPage: false,
    });
  });
  await scenario(scenarioNames[1], async () => {
    const { result, response } = await executeRead("GET /api/health", {});
    success(result, "Health");
    assert.deepEqual(
      await response.json(),
      { status: "ok" },
      "Actual health body must match",
    );
  });
  await scenario(scenarioNames[2], async () => {
    const { result } = await executeRead("GET /api/auth/me", {}, 401);
    assert.equal(
      result.outcome?.kind,
      "recoverable_error",
      "Documented HTTP 401 must remain a verified non-success response",
    );
    assert.notEqual(
      result.effect?.status,
      "saved",
      "Unauthenticated read cannot establish persistence",
    );
  });
  await scenario(scenarioNames[3], async () => {
    await select("GET /api/checkins");
    const before = requestCount;
    const result = await run("prepare", { request: "{}" });
    assert.notEqual(
      result.outcome?.kind,
      "success",
      "Required query must not silently default",
    );
    assert.equal(result.ok, false, "Invalid input must be rejected");
    assert.equal(requestCount, before, "Invalid input must not send a request");
  });
  await scenario(scenarioNames[4], async () => {
    const before = requestCount;
    await select("POST /api/strains");
    await prepare({
      headers: { "X-Roots-CSRF": "1" },
      body: {
        request_id: randomUUID(),
        profile_id: "1",
        name: "Unsubmitted synthetic strain",
      },
    });
    const rejected = await run("execute");
    assert.equal(
      rejected.ok,
      false,
      "A write requires explicit operation permission",
    );
    assert.equal(
      rejected.execution,
      "rejected",
      "Write permission must fail at authorization",
    );
    assert.equal(
      rejected.error_code,
      "command_disabled",
      "Write permission must be the rejected gate",
    );
    assert.equal(
      requestCount,
      before,
      "Write guard must run before an API request",
    );
    assert.notEqual(
      rejected.effect?.status,
      "saved",
      "Refused write cannot be saved",
    );
  });
  await scenario(scenarioNames[5], async () => {
    await select("GET /api/hello");
    const stale = await consumer.session.observe();
    await prepare({});
    const before = requestCount;
    const result = await consumer.session.execute(
      "execute",
      {},
      stale.revision,
    );
    reports.push(publicResult(result));
    assert.equal(result.execution, "rejected", "A stale revision must reject");
    assert.equal(
      result.error_code,
      "stale_observation",
      "Revision guard must identify staleness",
    );
    assert.equal(
      requestCount,
      before,
      "Stale revision must not send a request",
    );
  });
  await scenario(scenarioNames[6], async () => {
    await select("POST /api/auth/login");
    await prepare({
      headers: { "X-Roots-CSRF": "1" },
      body: accounts.customer,
    });
    const responseStart = responses.length;
    const before = requestCount;
    const result = await run("execute");
    success(result, "Login");
    assert.equal(requestCount, before + 1, "Login must execute exactly once");
    responseFor(responseStart, "POST", "/api/auth/login", 200);
    // A successful login response alone is not independent persistence evidence.
    assert.notEqual(
      result.effect?.status,
      "saved",
      "No write readback verifier was supplied",
    );
  });
  await scenario(scenarioNames[7], async () => {
    const { result, response } = await executeRead("GET /api/auth/me", {});
    success(result, "Authenticated current-user read");
    assert.equal(
      (await response.json()).email,
      accounts.customer.email,
      "Owned browser cookie must resolve the synthetic customer",
    );
  });
  await scenario(scenarioNames[8], async () => {
    const { result, response } = await executeRead("GET /api/strains", {
      query: { limit: 1 },
    });
    success(result, "Strains query");
    assert.equal(
      new URL(response.url()).searchParams.get("limit"),
      "1",
      "Swagger must serialize the query parameter",
    );
    const body = await response.json();
    assert.ok(
      Array.isArray(body.items),
      "Strains response must contain the documented page",
    );
    assert.ok(
      body.items.length <= 1,
      "The actual API must apply the page-size query",
    );
  });
  await scenario(scenarioNames[9], async () => {
    const before = requestCount;
    success(await run("reset"), "Reset");
    assert.equal(requestCount, before, "Reset must not replay an API request");
    const result = await run("execute");
    assert.equal(
      result.ok,
      false,
      "Reset must remove permission to execute the previous prepared request",
    );
    assert.equal(
      requestCount,
      before,
      "Execute after reset must not replay an API request",
    );
  });
  let profileId;
  let absentProbe = true;
  let readbackChecks;
  const verifyEffect = async ({ operation, request, response }) => {
    readbackChecks.calls += 1;
    if (
      operation.key !== "POST /api/strains" ||
      response.status !== 201 ||
      !/^[1-9][0-9]*$/.test(response.body?.id || "") ||
      response.body?.name !== request.body?.name ||
      request.body?.profile_id !== profileId
    )
      return { status: "uncertain" };
    const queryName = absentProbe
      ? `Absent Swagger probe ${randomUUID()}`
      : request.body.name;
    // Independent read-only API evidence; the write itself uses Swagger UI.
    const readback = await context.request.get(
      `${origin}/api/strains?${new URLSearchParams({ exact_name: queryName })}`,
    );
    readbackChecks.status = readback.status();
    if (readback.status() !== 200) return { status: "uncertain" };
    const body = await readback.json();
    if (body.profile_id !== profileId || !Array.isArray(body.items))
      return { status: "uncertain" };
    readbackChecks.returnedRows = body.items.length;
    readbackChecks.matchingRows = body.items.filter(
      (item) => item.id === response.body.id && item.name === request.body.name,
    ).length;
    return {
      status:
        body.items.length === 1 && readbackChecks.matchingRows === 1
          ? "saved"
          : "uncertain",
    };
  };
  const createSyntheticStrain = async () => {
    readbackChecks = {
      calls: 0,
      status: null,
      returnedRows: null,
      matchingRows: null,
    };
    await select("POST /api/strains");
    await prepare({
      headers: { "X-Roots-CSRF": "1" },
      body: {
        request_id: randomUUID(),
        profile_id: profileId,
        name: `Swagger acceptance ${randomUUID()}`,
      },
    });
    assert.equal(
      readbackChecks.calls,
      0,
      "Preparing a write must not invoke persistence verification",
    );
    const responseStart = responses.length;
    const before = requestCount;
    const result = await run("execute");
    success(result, "Synthetic strain write");
    assert.equal(
      requestCount,
      before + 1,
      "The synthetic write must execute exactly once",
    );
    responseFor(responseStart, "POST", "/api/strains", 201);
    assert.equal(
      readbackChecks.calls,
      1,
      "Runtime must invoke the independent verifier once for the write",
    );
    assert.equal(
      readbackChecks.status,
      200,
      "The independent readback must complete successfully",
    );
    return result;
  };
  await scenario(scenarioNames[10], async () => {
    await consumer.session.close();
    cleanup.session = "closed";
    assert.equal(
      page.isClosed(),
      false,
      "Closing a session must preserve its attached browser page",
    );
    // Read-only fixture setup establishes the synthetic customer's expected owner.
    const profileResponse = await context.request.get(
      `${origin}/api/customers/me`,
    );
    assert.equal(
      profileResponse.status(),
      200,
      "Reattachment must preserve the owned browser authentication",
    );
    const profile = await profileResponse.json();
    assert.equal(
      profile.email,
      accounts.customer.email,
      "Fixture profile must belong to the synthetic customer",
    );
    assert.match(
      profile.id,
      /^[1-9][0-9]*$/,
      "Fixture profile must expose a canonical identifier",
    );
    profileId = profile.id;
    consumer = await createSwaggerSession({
      page,
      context,
      enginePath,
      document,
      baseUrl: origin,
      docsUrl,
      allowOperations,
      allowWrites: ["POST /api/strains"],
      verifyEffect,
    });
    cleanup.session = "owned";
    consumer.session.setSpeed("fast");
    const result = await createSyntheticStrain();
    assert.equal(
      readbackChecks.returnedRows,
      0,
      "The negative readback probe must return no matching record",
    );
    assert.equal(
      readbackChecks.matchingRows,
      0,
      "No record can establish the expected write identity",
    );
    assert.equal(
      result.effect?.status,
      "uncertain",
      "HTTP 201 with an empty readback must remain uncertain",
    );
  });
  await scenario(scenarioNames[11], async () => {
    absentProbe = false;
    const result = await createSyntheticStrain();
    assert.equal(
      readbackChecks.returnedRows,
      1,
      "Exact-name readback must contain one record",
    );
    assert.equal(
      readbackChecks.matchingRows,
      1,
      "Readback must match the response identity and requested name exactly once",
    );
    assert.equal(
      result.effect?.status,
      "saved",
      "Only confirmed independent readback establishes saved persistence",
    );
    success(await run("reset"), "Reset");
  });
} catch {
  process.exitCode = 1;
  console.error(
    "Roots Swagger acceptance did not pass; inspect the sanitized summary.",
  );
} finally {
  if (consumer) {
    try {
      await consumer.session.close();
      cleanup.session = "closed";
    } catch {
      cleanup.session = "incomplete";
      process.exitCode = 1;
    }
  }
  if (browser) {
    try {
      await browser.close();
      cleanup.browser = "closed";
    } catch {
      cleanup.browser = "incomplete";
      process.exitCode = 1;
    }
  }
  save();
  console.log(
    JSON.stringify({
      passed: results.filter((result) => result.status === "PASS").length,
      failed: results.filter((result) => result.status === "FAIL").length,
      notRun: scenarioNames.length - results.length,
      cleanup,
    }),
  );
}
