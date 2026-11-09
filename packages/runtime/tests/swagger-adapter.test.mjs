import test from "node:test";
import assert from "node:assert/strict";
import { createSwaggerAdapter } from "../src/swagger/adapter.mjs";
import { buildCatalog } from "../src/swagger/catalog.mjs";

// Deterministic transport race: two matching requests arrive before either
// asynchronous authentication/worker observation resumes. This is a guard-unit
// test; the separate swagger-browser suite exercises real Swagger and Chromium.
test("one Execute permit cannot dispatch two concurrently matching requests", async () => {
  const document = {
    openapi: "3.1.0",
    info: { title: "Independent guard fixture", version: "1" },
    servers: [{ url: "/" }],
    paths: {
      "/write": { post: { responses: { 204: { description: "Written" } } } },
    },
  };
  let handle,
    dispatches = 0,
    blocked = 0;
  const ui = {
    ready: true,
    spec: document,
    key: "POST /write",
    ambiguous: false,
    expanded: true,
    tryEnabled: true,
    fields: [],
    body: null,
    server: "/",
    contentType: null,
  };
  const route = () => ({
    request: () => ({
      url: () => "http://fixture/write",
      method: () => "POST",
      resourceType: () => "fetch",
      headers: () => ({}),
      postData: () => null,
    }),
    fetch: async () => {
      dispatches++;
      return {
        status: () => 204,
        headers: () => ({}),
        body: async () => Buffer.alloc(0),
        dispose: async () => {},
      };
    },
    fulfill: async () => {},
    abort: async () => {
      blocked++;
    },
  });
  const locator = {
    filter() {
      return this;
    },
    locator() {
      return this;
    },
    count: async () => 0,
    waitFor: async () => {},
    getByRole(_role, { name }) {
      return name === "Execute"
        ? { click: async () => Promise.all([handle(route()), handle(route())]) }
        : this;
    },
  };
  const context = { cookies: async () => [] };
  const page = {
    context: () => context,
    url: () => "http://fixture/docs/",
    isClosed: () => false,
    locator: () => locator,
    route: async (_glob, callback) => {
      handle = callback;
    },
    unroute: async () => {},
    evaluate: async (fn) => {
      const source = String(fn);
      if (source.includes("navigator.serviceWorker")) return false;
      if (source.includes("script[src]")) return [];
      if (source.includes("const root")) return ui;
      return null;
    },
  };
  const adapter = await createSwaggerAdapter({
    page,
    context,
    catalog: buildCatalog(document),
    baseUrl: "http://fixture/openapi.json",
    docsUrl: "http://fixture/docs/",
    allowOperations: ["POST /write"],
    allowWrites: ["POST /write"],
  });
  try {
    const execution = { effect: (fn) => fn() };
    await adapter.handlers.prepare({ request: "{}" }, execution);
    let failure;
    try {
      await adapter.handlers.execute({}, execution);
    } catch (error) {
      failure = error;
    }
    assert.equal(
      dispatches,
      1,
      "An Execute permit authorizes exactly one network dispatch",
    );
    assert.equal(blocked, 1);
    assert.match(failure?.message ?? "", /did not match/);
    const observed = await adapter.observe();
    assert.equal(observed.facts.requestCount, 1);
    assert.equal(observed.facts.response.matched, false);
    assert.equal((await adapter.effectStatus()).status, "uncertain");
  } finally {
    await adapter.close();
  }
});
