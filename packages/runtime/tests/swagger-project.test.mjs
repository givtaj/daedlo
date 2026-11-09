import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../../../integrations/swagger/project.mjs";
import { createSwaggerSession } from "../../../integrations/swagger/session.mjs";

const document = {
  openapi: "3.1.0",
  paths: {
    "/items": {
      get: { responses: { 200: { description: "OK" } } },
      post: { responses: { 204: { description: "Saved" } } },
    },
  },
};
const valid = {
  docsUrl: "http://localhost:4300/docs/",
  schemaUrl: "http://localhost:4300/schema/openapi.json",
  enginePath: "engine/swagger-engine",
  allowOperations: ["GET /items"],
  allowWrites: [],
};
async function withProfile(profile, fetchImpl, callback) {
  const directory = await mkdtemp(join(tmpdir(), "swagger-profile-test-"));
  const path = join(directory, "project.json");
  const previousProfile = process.env.DAEDLO_SWAGGER_PROFILE,
    previousFetch = globalThis.fetch;
  await writeFile(path, JSON.stringify(profile));
  process.env.DAEDLO_SWAGGER_PROFILE = path;
  globalThis.fetch = fetchImpl;
  try {
    return await callback(directory);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousProfile === undefined)
      delete process.env.DAEDLO_SWAGGER_PROFILE;
    else process.env.DAEDLO_SWAGGER_PROFILE = previousProfile;
    await rm(directory, { recursive: true, force: true });
  }
}
const fetchedDocument = async () =>
  new Response(JSON.stringify(document), {
    headers: { "content-type": "application/json" },
  });

test("project rejects malformed policy arrays and write escalation before fetching", async () => {
  for (const overrides of [
    { allowOperations: "GET /items" },
    { allowOperations: null },
    { allowOperations: [1] },
    { allowOperations: ["GET /items", "GET /items"] },
    { allowWrites: {} },
    { allowWrites: ["POST /items"] },
    { enginePath: "" },
    { docsUrl: "javascript:alert(1)" },
  ]) {
    let fetches = 0;
    await withProfile(
      { ...valid, ...overrides },
      async () => {
        fetches++;
        return fetchedDocument();
      },
      async () => {
        await assert.rejects(createProject());
        assert.equal(
          fetches,
          0,
          "Malformed project policy must fail before network access",
        );
      },
    );
  }
});

test("direct session policy must be arrays and explicitly authorize every write", async () => {
  const page = { url: () => valid.docsUrl };
  for (const policy of [
    { allowOperations: null },
    { allowOperations: "GET /items" },
    { allowOperations: ["GET /missing"] },
    { allowOperations: ["GET /items"], allowWrites: ["POST /items"] },
  ]) {
    await assert.rejects(
      createSwaggerSession({
        page,
        context: {},
        enginePath: "unused",
        document,
        baseUrl: valid.schemaUrl,
        ...policy,
      }),
      /policy|array|declared|write/i,
    );
  }
});

test("schema loader cancels an oversized response without reading its remainder", async () => {
  let cancelled = false;
  let chunks = 0;
  const stream = new ReadableStream(
    {
      pull(controller) {
        chunks++;
        if (chunks === 1)
          controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
        else {
          controller.enqueue(new Uint8Array([0]));
          controller.close();
        }
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  await withProfile(
    valid,
    async () => new Response(stream),
    async () => {
      await assert.rejects(createProject(), /size|limit/i);
      assert.equal(
        cancelled,
        true,
        "Oversized response must cancel the unread stream",
      );
      assert.equal(
        chunks,
        1,
        "Loader must stop at the first chunk crossing the bound",
      );
    },
  );
});

test("schema loader cancels non-success bodies and redacts parse errors", async () => {
  let cancelled = false;
  await withProfile(
    valid,
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { status: 401 },
      ),
    async () => {
      await assert.rejects(createProject(), /unavailable/);
      assert.equal(
        cancelled,
        true,
        "Rejected response stream must be cancelled",
      );
    },
  );
  await withProfile(
    valid,
    async () => new Response("PRIVATE_SENTINEL is not JSON"),
    async () => {
      await assert.rejects(
        createProject(),
        (error) =>
          !error.message.includes("PRIVATE_SENTINEL") &&
          /JSON|document/i.test(error.message),
      );
    },
  );
});

test("project retains the explicit schema retrieval URL", async () => {
  await withProfile(
    valid,
    async (url, options) => {
      assert.equal(url, valid.schemaUrl);
      assert.equal(options.redirect, "error");
      return fetchedDocument();
    },
    async () => {
      const project = await createProject();
      assert.equal(project.url, valid.docsUrl);
      assert.equal(typeof project.createSession, "function");
    },
  );
});

test("project refuses undeclared operation policy before launching a browser", async () => {
  await withProfile(
    { ...valid, allowOperations: ["GET /missing"] },
    fetchedDocument,
    async () => {
      await assert.rejects(createProject(), /declared|operation/i);
    },
  );
});

test("failed response cancellation is explicit and does not expose raw errors", async () => {
  await withProfile(
    valid,
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            throw Error("PRIVATE_CANCEL_SENTINEL");
          },
        }),
        { status: 401 },
      ),
    async () => {
      await assert.rejects(
        createProject(),
        (error) =>
          error.code === "cleanup_incomplete" &&
          !error.message.includes("PRIVATE_CANCEL_SENTINEL"),
      );
    },
  );
});
