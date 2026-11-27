import { createHash, randomUUID } from "node:crypto";
import {
  buildRequest,
  getOperation,
  validateRequest,
  validateResponse,
} from "./catalog.mjs";

const canonical = (value) =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
export const swaggerDigest = (document) =>
  createHash("sha256").update(canonical(document)).digest("hex");
const problem = (message) => new Error(message);
const safeUrl = (value) => {
  const u = new URL(value);
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
    throw problem("An explicit HTTP(S) URL without credentials is required.");
  return u;
};
const sameUrl = (a, b) => {
  const x = new URL(a),
    y = new URL(b);
  x.searchParams.sort();
  y.searchParams.sort();
  return x.href === y.href;
};
const writes = (method) => !["GET", "HEAD"].includes(method);

/** Trusted Swagger UI 5 adapter. Policy is also enforced by the Rust model.
 * Raw request/response values stay private; observations contain only safe facts.
 */
export async function createSwaggerAdapter({
  page,
  context = page.context(),
  catalog,
  baseUrl,
  docsUrl = page.url(),
  allowOperations = [],
  allowWrites = [],
  verifyEffect,
  timeoutMs = 10000,
}) {
  const base = safeUrl(baseUrl),
    docs = safeUrl(docsUrl),
    specDigest = swaggerDigest(catalog.document);
  if (base.origin !== docs.origin)
    throw problem("Swagger and API schema must share the configured origin.");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000)
    throw problem("Invalid Swagger request timeout.");
  const workerPresent = async () =>
    page.evaluate(async () => {
      if (!navigator.serviceWorker) return false;
      return (
        Boolean(navigator.serviceWorker.controller) ||
        (await navigator.serviceWorker.getRegistrations()).length > 0
      );
    });
  if (await workerPresent())
    throw problem(
      "Swagger driving requires a browser context without service workers.",
    );
  const allowed = new Set(allowOperations),
    writeAllowed = new Set(allowWrites),
    session = randomUUID();
  for (const key of [...allowed, ...writeAllowed]) getOperation(catalog, key);
  let prepared = null,
    response = null,
    requestCount = 0,
    arm = null,
    closed = false,
    effect = { status: "not_attempted" },
    lastPrivate = null;
  let routeInstalled = false,
    activeNetwork = null;
  const retainedResponses = new Set();
  const pendingRoutes = new Set();
  const staticUrls = new Set(
    await page.evaluate(() =>
      [...document.querySelectorAll("script[src],link[href],img[src]")].map(
        (node) => node.src || node.href,
      ),
    ),
  );
  staticUrls.add(docs.href);
  const authentication = async () => {
    const [cookies, authorized] = await Promise.all([
      context.cookies(),
      page.evaluate(
        () => window.ui?.authSelectors?.authorized?.()?.toJS?.() ?? null,
      ),
    ]);
    cookies.sort((a, b) =>
      `${a.domain}/${a.path}/${a.name}`.localeCompare(
        `${b.domain}/${b.path}/${b.name}`,
      ),
    );
    // Private values never enter facts, reports or hashes. Only equality with
    // the prepared request controls its validity.
    return canonical({ cookies, authorized });
  };
  async function dispose(received) {
    retainedResponses.add(received);
    try {
      await received.dispose();
      retainedResponses.delete(received);
    } catch {}
  }
  async function readResource(route) {
    let received;
    try {
      received = await route.fetch({ maxRedirects: 0, timeout: timeoutMs });
      if (received.status() >= 300 && received.status() < 400)
        await route.abort("blockedbyclient");
      else await route.fulfill({ response: received });
    } catch {
      try {
        await route.abort("failed");
      } catch {}
    } finally {
      if (received) await dispose(received);
    }
  }
  const block = (operation) =>
    page.locator(`.opblock-${operation.method.toLowerCase()}`).filter({
      has: page.locator(`[data-path=${JSON.stringify(operation.path)}]`),
    });
  async function measured() {
    return page.evaluate(() => {
      const root = document.querySelector(".swagger-ui");
      const opened = [...document.querySelectorAll(".opblock.is-open")];
      const op = opened.length === 1 ? opened[0] : null;
      const method = op
        ?.querySelector(".opblock-summary-method")
        ?.textContent?.trim();
      const path = op
        ?.querySelector(".opblock-summary-path")
        ?.getAttribute("data-path");
      const fields = op
        ? [...op.querySelectorAll("tr[data-param-name]")].map((row) => ({
            name: row.getAttribute("data-param-name"),
            in: row.getAttribute("data-param-in"),
            value: row.querySelector("input,select,textarea")?.value ?? null,
          }))
        : [];
      const body =
        op?.querySelector("textarea.body-param__text")?.value ?? null;
      const ownServer = op?.querySelector(".servers select");
      const globalServer = document.querySelector(
        ".scheme-container .servers select",
      );
      let spec = null;
      try {
        spec = window.ui?.specSelectors?.specJson?.()?.toJS?.() ?? null;
      } catch {}
      return {
        ready: Boolean(root && document.querySelector(".opblock")),
        spec,
        key: method && path ? `${method} ${path}` : null,
        ambiguous: opened.length > 1,
        expanded: Boolean(op),
        tryEnabled: Boolean(op?.querySelector("button.execute")),
        fields,
        body,
        server: (ownServer ?? globalServer)?.value ?? null,
        contentType:
          op?.querySelector('select[aria-label="Request content type"]')
            ?.value ?? null,
      };
    });
  }
  function inputsMatch(ui, item) {
    if (!item || ui.key !== item.operation.key || !ui.tryEnabled) return false;
    for (const parameter of item.operation.parameters) {
      const group = parameter.in === "header" ? "headers" : parameter.in;
      const value = item.request[group]?.[parameter.name];
      const field = ui.fields.find(
        (f) => f.in === parameter.in && f.name === parameter.name,
      );
      if (!field || field.value !== (value === undefined ? "" : String(value)))
        return false;
    }
    if (item.operation.requestBody) {
      if (ui.contentType !== "application/json") return false;
      if (item.request.body === undefined) return ui.body === "";
      try {
        return canonical(JSON.parse(ui.body)) === canonical(item.request.body);
      } catch {
        return false;
      }
    }
    return true;
  }
  function targetMatches(ui, operation) {
    if (!operation) return true;
    try {
      const selected =
        ui.server === null ? (operation.servers?.[0]?.url ?? "/") : ui.server;
      const expected = operation.servers?.[0]?.url ?? "/";
      const actual = new URL(selected, base),
        wanted = new URL(expected, base);
      return actual.origin === base.origin && actual.href === wanted.href;
    } catch {
      return false;
    }
  }
  async function observe() {
    const facts = {
      docsReady: false,
      specMatches: false,
      selected: null,
      expanded: false,
      tryEnabled: false,
      prepared: false,
      inputValid: false,
      targetAllowed: false,
      requestCount,
      response,
    };
    if (closed || page.isClosed()) return { connected: false, session, facts };
    const here = new URL(page.url());
    if (here.origin !== docs.origin || here.pathname !== docs.pathname)
      return { connected: true, session, facts };
    const ui = await measured();
    facts.docsReady = ui.ready && !ui.ambiguous && !(await workerPresent());
    facts.specMatches =
      ui.spec !== null && swaggerDigest(ui.spec) === specDigest;
    const operation = catalog.operations.find((o) => o.key === ui.key);
    facts.selected = operation?.key ?? null;
    facts.expanded = Boolean(operation && ui.expanded);
    facts.tryEnabled = Boolean(operation && ui.tryEnabled);
    facts.prepared =
      inputsMatch(ui, prepared) && prepared.auth === (await authentication());
    facts.inputValid = facts.prepared;
    facts.targetAllowed = targetMatches(ui, operation);
    if (facts.response?.operation !== facts.selected) facts.response = null;
    return { connected: true, session, facts };
  }
  function matches(request, expected) {
    if (
      request.method() !== expected.method ||
      !sameUrl(request.url(), expected.url)
    )
      return false;
    const headers = request.headers();
    for (const [name, value] of Object.entries(expected.headers)) {
      const actual = headers[name.toLowerCase()];
      if (name.toLowerCase() === "content-type") {
        if (actual?.split(";")[0].trim() !== value) return false;
      } else if (actual !== String(value)) return false;
    }
    const body = request.postData();
    if (expected.body === undefined) return body === null || body === "";
    try {
      return (
        canonical(JSON.parse(body)) === canonical(JSON.parse(expected.body))
      );
    } catch {
      return false;
    }
  }
  const handleRoute = async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const isData = ["xhr", "fetch"].includes(request.resourceType());
    // Static docs/schema refreshes may load; every API dispatch requires one
    // exact guarded Execute permit. Remote resources/navigation are not followed.
    if (!isData) {
      if (
        url.origin === docs.origin &&
        request.method() === "GET" &&
        staticUrls.has(url.href)
      )
        return readResource(route);
      return route.abort("blockedbyclient");
    }
    if (
      request.method() === "GET" &&
      url.origin === base.origin &&
      url.href === base.href &&
      base.pathname !== "/"
    )
      return readResource(route);
    const permit = arm;
    if (
      !permit ||
      permit.consumed ||
      !matches(request, permit.expected) ||
      permit.auth !== (await authentication()) ||
      (await workerPresent())
    ) {
      if (permit) {
        permit.mismatch = true;
        // An unrelated request cannot complete an already dispatched request.
        if (!permit.consumed) permit.finish();
      }
      return route.abort("blockedbyclient");
    }
    // Authentication and worker observation yield to other intercepted
    // requests. Recheck the same permit after those awaits, then consume it
    // synchronously so only one matching request can reach route.fetch.
    if (arm !== permit || permit.consumed || permit.mismatch) {
      permit.mismatch = true;
      if (!permit.consumed) permit.finish();
      return route.abort("blockedbyclient");
    }
    permit.consumed = true;
    requestCount++;
    response = null;
    lastPrivate = null;
    if (writes(permit.operation.method)) effect = { status: "uncertain" };
    activeNetwork = (async () => {
      let received;
      try {
        // No redirect can dispatch a second operation or escape the target.
        received = await route.fetch({
          maxRedirects: 0,
          timeout: timeoutMs,
        });
        const status = received.status();
        const contentType = received.headers()["content-type"] ?? "";
        if (status >= 300 && status < 400) {
          response = {
            operation: permit.operation.key,
            status,
            matched: false,
            documented: false,
            schemaValid: false,
            schemaSupported: false,
          };
          await route.fulfill({
            status: 502,
            contentType: "application/json",
            body: '{"error":"Redirect refused by Daedlo"}',
          });
          return;
        }
        const bytes = await received.body();
        let body,
          parsed = true;
        if (bytes.length > 1024 * 1024) parsed = false;
        else if (bytes.length) {
          try {
            body = JSON.parse(bytes.toString("utf8"));
          } catch {
            parsed = false;
          }
        }
        const checked = parsed
          ? validateResponse(catalog, permit.operation, {
              status,
              contentType,
              body,
            })
          : { documented: false, valid: false, supported: false };
        response = {
          operation: permit.operation.key,
          status,
          matched: !permit.mismatch,
          documented: checked.documented,
          schemaValid: checked.valid,
          schemaSupported: checked.supported,
        };
        lastPrivate = {
          operation: permit.operation,
          request: permit.request,
          response: { status, contentType, body },
          matched: response.matched,
        };
        await route.fulfill({ response: received });
      } catch {
        response = null;
        try {
          await route.abort("failed");
        } catch {}
      } finally {
        if (received) await dispose(received);
        permit.finish();
      }
    })();
    await activeNetwork;
  };
  const routeHandler = (route) => {
    const task = handleRoute(route).finally(() => pendingRoutes.delete(task));
    pendingRoutes.add(task);
    return task;
  };
  await page.route("**/*", routeHandler);
  routeInstalled = true;
  const handlers = {
    async select({ operation: key }, execution) {
      const operation = getOperation(catalog, key);
      const opened = page.locator(".opblock.is-open .opblock-summary-control");
      while (await opened.count()) await execution.click(opened.first());
      await execution.click(
        block(operation).locator(".opblock-summary-control"),
      );
      await execution.effect(async () => {
        prepared = null;
        response = null;
        lastPrivate = null;
      });
    },
    async prepare({ request: raw }, execution) {
      let request;
      try {
        request = JSON.parse(raw);
      } catch {
        throw problem("Request must be valid JSON.");
      }
      const observed = await observe();
      const operation = getOperation(catalog, observed.facts.selected);
      const validation = validateRequest(catalog, operation, request);
      if (!validation.supported || !validation.valid)
        throw problem("Request inputs are invalid or unsupported.");
      // HTTP header names are case-insensitive, including DOM fill/readback.
      if (request.headers)
        request.headers = Object.fromEntries(
          Object.entries(request.headers).map(([name, value]) => [
            operation.parameters.find(
              (parameter) =>
                parameter.in === "header" &&
                parameter.name.toLowerCase() === name.toLowerCase(),
            )?.name ?? name,
            value,
          ]),
        );
      const expected = buildRequest(catalog, operation, request, base.href);
      const op = block(operation);
      if (!observed.facts.tryEnabled)
        await execution.click(
          op.getByRole("button", { name: "Try it out", exact: true }),
        );
      for (const parameter of operation.parameters) {
        const row = op.locator(
          `tr[data-param-name=${JSON.stringify(parameter.name)}][data-param-in=${JSON.stringify(parameter.in)}]`,
        );
        const input = row.locator("input,select,textarea");
        if ((await input.count()) !== 1)
          throw problem("Swagger parameter control is unsupported.");
        const value =
          request[parameter.in === "header" ? "headers" : parameter.in]?.[
            parameter.name
          ];
        const text = value === undefined ? "" : String(value);
        if ((await input.evaluate((e) => e.tagName)) === "SELECT")
          await execution.select(input, text);
        else await execution.fill(input, text);
      }
      if (operation.requestBody) {
        const content = op.getByRole("combobox", {
          name: "Request content type",
          exact: true,
        });
        if (await content.count())
          await execution.select(content, "application/json");
        await execution.fill(
          op.locator("textarea.body-param__text"),
          request.body === undefined
            ? ""
            : JSON.stringify(request.body, null, 2),
        );
      }
      await execution.effect(async () => {
        prepared = {
          operation,
          request,
          expected,
          auth: await authentication(),
        };
        response = null;
        lastPrivate = null;
      });
    },
    async execute(_params, execution) {
      const item = prepared;
      if (
        !item ||
        !allowed.has(item.operation.key) ||
        (writes(item.operation.method) && !writeAllowed.has(item.operation.key))
      )
        throw problem(
          "Operation execution is not allowed by the project profile.",
        );
      const facts = (await observe()).facts;
      if (!facts.prepared || !facts.targetAllowed || !facts.specMatches)
        throw problem("Prepared Swagger inputs changed.");
      await execution.effect(async () => {
        let finish;
        const complete = new Promise((resolve) => {
          finish = resolve;
        });
        const permit = { ...item, consumed: false, mismatch: false, finish };
        arm = permit;
        lastPrivate = null;
        let timer;
        try {
          // Dispatch intent is uncertain until observation/readback establishes
          // more; missing network observation must never imply no write.
          if (writes(item.operation.method)) effect = { status: "uncertain" };
          await block(item.operation)
            .getByRole("button", { name: "Execute", exact: true })
            .click();
          await Promise.race([
            complete,
            new Promise((_, reject) => {
              timer = setTimeout(
                () =>
                  reject(problem("No matching Swagger response was observed.")),
                timeoutMs + 1000,
              );
            }),
          ]);
          if (!permit.consumed || permit.mismatch)
            throw problem(
              "Swagger request did not match the prepared operation.",
            );
          await block(item.operation)
            .locator(".live-responses-table")
            .waitFor({ state: "visible", timeout: timeoutMs });
        } finally {
          clearTimeout(timer);
          if (activeNetwork) await activeNetwork;
          arm = null;
        }
      });
    },
    async reset(_params, execution) {
      const cancel = page.locator(
        ".opblock.is-open button.try-out__btn.cancel",
      );
      while (await cancel.count()) await execution.click(cancel.first());
      const opened = page.locator(".opblock.is-open .opblock-summary-control");
      while (await opened.count()) await execution.click(opened.first());
      await execution.effect(async () => {
        prepared = null;
        response = null;
        lastPrivate = null;
      });
    },
  };
  return {
    model: { id: "daedlo.swagger", version: "1" },
    handlers,
    observe,
    beginRun() {
      effect = { status: "not_attempted" };
      lastPrivate = null;
    },
    async endRun() {
      if (activeNetwork) await activeNetwork;
      for (const received of [...retainedResponses]) await dispose(received);
      if (retainedResponses.size)
        throw problem("Swagger response cleanup is incomplete.");
    },
    async effectStatus() {
      if (activeNetwork) await activeNetwork;
      if (
        effect.status === "uncertain" &&
        lastPrivate?.matched &&
        verifyEffect
      ) {
        try {
          const result = await verifyEffect(lastPrivate);
          if (
            ["saved", "uncertain", "rejected", "not_attempted"].includes(
              result?.status,
            )
          )
            effect = { status: result.status };
        } catch {}
      }
      return { ...effect };
    },
    async close() {
      if (activeNetwork) await activeNetwork;
      if (routeInstalled) {
        await page.unroute("**/*", routeHandler);
        routeInstalled = false;
      }
      await Promise.all([...pendingRoutes]);
      for (const received of [...retainedResponses]) await dispose(received);
      if (retainedResponses.size)
        throw problem("Swagger response cleanup is incomplete.");
      closed = true;
      prepared = null;
      lastPrivate = null;
      arm = null;
    },
  };
}
