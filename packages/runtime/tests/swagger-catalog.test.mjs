import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCatalog,
  getOperation,
  validateRequest,
  buildRequest,
  validateResponse,
} from "../src/swagger/catalog.mjs";

const document = () => ({
  openapi: "3.1.0",
  info: { title: "Fixture", version: "1" },
  servers: [{ url: "/" }],
  security: [{ session: [] }],
  paths: {
    "/items/{id}": {
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "integer", minimum: 1 },
        },
        {
          name: "limit",
          in: "query",
          schema: { type: "integer", maximum: 99 },
        },
      ],
      get: {
        operationId: "getItem",
        parameters: [
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", maximum: 10 },
          },
        ],
        responses: {
          200: { $ref: "#/components/responses/Item" },
          "4XX": {
            description: "Invalid",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["error"],
                  properties: { error: { type: "string" } },
                },
              },
            },
          },
        },
      },
      patch: {
        operationId: "updateItem",
        parameters: [
          {
            name: "X-CSRF",
            in: "header",
            required: true,
            schema: { type: "string", const: "1" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Item" },
            },
          },
        },
        responses: { 204: { description: "Saved" } },
      },
    },
    "/public": {
      get: {
        security: [],
        servers: [{ url: "/v2" }],
        responses: { default: { description: "Fallback" } },
      },
    },
  },
  components: {
    schemas: {
      Item: {
        type: "object",
        required: ["name"],
        additionalProperties: false,
        properties: {
          name: { type: "string", minLength: 1, maxLength: 30 },
          count: { type: ["integer", "null"], minimum: 0 },
        },
      },
    },
    responses: {
      Item: {
        description: "Item",
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/Item" } },
        },
      },
    },
  },
});
const op = (catalog, method = "GET") =>
  getOperation(catalog, `${method} /items/{id}`);

test("catalog discovers operations, inherits metadata, and merges overridden parameters", () => {
  const catalog = buildCatalog(document());
  assert.equal(catalog.operations.length, 3);
  assert.deepEqual(
    op(catalog).parameters.map((p) => [p.name, p.schema.maximum]),
    [
      ["id", undefined],
      ["limit", 10],
    ],
  );
  assert.deepEqual(op(catalog).security, [{ session: [] }]);
  assert.deepEqual(getOperation(catalog, "GET /public").security, []);
  assert.equal(op(catalog).responses["200"].description, "Item");
  assert.throws(() => getOperation(catalog, "GET /missing"), /operation/i);
});

test("request validation blocks missing, unknown, malformed and schema-invalid inputs", () => {
  const catalog = buildCatalog(document());
  assert.equal(
    validateRequest(catalog, op(catalog), {
      path: { id: 1 },
      query: { limit: 2 },
    }).valid,
    true,
  );
  for (const request of [
    {},
    { path: { id: 0 } },
    { path: { id: "one" } },
    { path: { id: 1 }, query: { limit: 11 } },
    { path: { id: 1 }, query: { secret: "private-value" } },
    { path: { id: 1 }, body: {} },
    { path: { id: 1 }, unknown: true },
  ]) {
    const result = validateRequest(catalog, op(catalog), request);
    assert.equal(result.valid, false);
    assert.equal(JSON.stringify(result).includes("private-value"), false);
  }
  assert.equal(
    validateRequest(catalog, op(catalog, "PATCH"), {
      path: { id: 1 },
      headers: { "X-CSRF": "1" },
      body: { name: "new", count: null },
    }).valid,
    true,
  );
  assert.equal(
    validateRequest(catalog, op(catalog, "PATCH"), {
      path: { id: 1 },
      headers: { "X-CSRF": "1" },
      body: { name: "new", extra: 1 },
    }).valid,
    false,
  );
});

test("requests preserve server base path, encode values, and refuse origin escape", () => {
  const catalog = buildCatalog(document());
  assert.deepEqual(
    buildRequest(
      catalog,
      op(catalog),
      { path: { id: 2 }, query: { limit: 4 } },
      "http://127.0.0.1:4300/api/docs/",
    ),
    {
      url: "http://127.0.0.1:4300/items/2?limit=4",
      method: "GET",
      headers: {},
    },
  );
  assert.equal(
    buildRequest(
      catalog,
      getOperation(catalog, "GET /public"),
      {},
      "http://127.0.0.1:4300/",
    ).url,
    "http://127.0.0.1:4300/v2/public",
  );
  const doc = document();
  doc.paths["/public"].get.servers = [{ url: "https://example.invalid/" }];
  const foreign = buildCatalog(doc);
  assert.throws(
    () =>
      buildRequest(
        foreign,
        getOperation(foreign, "GET /public"),
        {},
        "http://127.0.0.1:4300/",
      ),
    /origin/i,
  );
});

test("response checks require declared status, matching media type and full supported schema", () => {
  const catalog = buildCatalog(document());
  assert.deepEqual(
    validateResponse(catalog, op(catalog), {
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: { name: "valid", count: 2 },
    }),
    { documented: true, valid: true, supported: true, errors: [] },
  );
  assert.equal(
    validateResponse(catalog, op(catalog), {
      status: 200,
      contentType: "application/json",
      body: { name: "" },
    }).valid,
    false,
  );
  assert.equal(
    validateResponse(catalog, op(catalog), {
      status: 200,
      contentType: "text/html",
      body: { name: "valid" },
    }).valid,
    false,
  );
  assert.equal(
    validateResponse(catalog, op(catalog), {
      status: 418,
      contentType: "application/json",
      body: { error: "safe" },
    }).valid,
    true,
  );
  assert.equal(
    validateResponse(catalog, op(catalog), {
      status: 500,
      contentType: "application/json",
      body: {},
    }).documented,
    false,
  );
  assert.equal(
    validateResponse(catalog, op(catalog, "PATCH"), {
      status: 204,
      contentType: "",
      body: undefined,
    }).valid,
    true,
  );
});

test("external and cyclic refs, unsupported assertions and serialization fail closed", () => {
  for (const schema of [
    { $ref: "https://example.invalid/schema" },
    { $ref: "#/components/schemas/Loop" },
    { type: "string", pattern: "^safe$" },
    { type: "object", unevaluatedProperties: false },
  ]) {
    const doc = document();
    doc.components.schemas.Item = schema;
    doc.components.schemas.Loop = { $ref: "#/components/schemas/Loop" };
    const catalog = buildCatalog(doc);
    const result = validateResponse(catalog, op(catalog), {
      status: 200,
      contentType: "application/json",
      body: "safe",
    });
    assert.equal(result.valid, false);
    assert.equal(result.supported, false);
  }
  const doc = document();
  doc.paths["/items/{id}"].get.parameters[0].style = "deepObject";
  const catalog = buildCatalog(doc);
  assert.equal(
    validateRequest(catalog, op(catalog), { path: { id: 1 } }).supported,
    false,
  );
});

test("bounded JSON catalogs reject malformed versions and excessive operation count", () => {
  assert.throws(() => buildCatalog({ swagger: "2.0", paths: {} }), /OpenAPI/i);
  assert.throws(
    () => buildCatalog({ openapi: "3.3.0", paths: {} }),
    /OpenAPI/i,
  );
  const doc = document();
  doc.paths = Object.fromEntries(
    Array.from({ length: 513 }, (_, index) => [
      `/p${index}`,
      { get: { responses: { 200: { description: "ok" } } } },
    ]),
  );
  assert.throws(() => buildCatalog(doc), /limit/i);
});

test("schema composition, false items, nullable enum and nested unsupported keywords remain strict", () => {
  const check = (schema, body, version = "3.1.0") => {
    const doc = document();
    doc.openapi = version;
    doc.components.schemas.Item = schema;
    const catalog = buildCatalog(doc);
    return validateResponse(catalog, op(catalog), {
      status: 200,
      contentType: "application/json",
      body,
    });
  };
  assert.equal(check({ type: "array", items: false }, [1]).valid, false);
  assert.equal(
    check({ type: "string", nullable: true, enum: ["ok"] }, null, "3.0.4")
      .valid,
    false,
  );
  assert.equal(
    check({ type: "string", nullable: true }, null, "3.0.4").valid,
    true,
  );
  assert.equal(
    check({ oneOf: [{ type: "number" }, { type: "integer" }] }, 1).valid,
    false,
  );
  assert.equal(
    check({ allOf: [{ type: "number", minimum: 1 }, { maximum: 3 }] }, 2).valid,
    true,
  );
  assert.equal(
    check({ anyOf: [{ type: "string" }, { type: "integer" }] }, 2).valid,
    true,
  );
  assert.equal(
    check(
      {
        type: "object",
        properties: { optional: { type: "string", pattern: "^x$" } },
      },
      {},
    ).supported,
    false,
  );
});

test("path dot segments cannot escape the declared request target", () => {
  const doc = document();
  doc.paths["/items/{id}"].parameters[0].schema = { type: "string" };
  const catalog = buildCatalog(doc);
  for (const id of [".", ".."])
    assert.throws(
      () =>
        buildRequest(
          catalog,
          op(catalog),
          { path: { id } },
          "http://127.0.0.1:4300/",
        ),
      /path/i,
    );
  assert.equal(
    buildRequest(
      catalog,
      op(catalog),
      { path: { id: "a/b ?#" } },
      "http://127.0.0.1:4300/",
    ).url,
    "http://127.0.0.1:4300/items/a%2Fb%20%3F%23",
  );
});

test("only final overridden parameter declarations control capability", () => {
  const doc = document();
  doc.paths["/items/{id}"].parameters[1].style = "deepObject";
  const catalog = buildCatalog(doc);
  assert.deepEqual(op(catalog).unsupported, []);
});

test("safe-integer format rejects lossy numeric identifiers", () => {
  const doc = document();
  doc.paths["/items/{id}"].parameters[0].schema = {
    type: "integer",
    format: "safe-integer",
  };
  const catalog = buildCatalog(doc);
  assert.equal(
    validateRequest(catalog, op(catalog), {
      path: { id: Number.MAX_SAFE_INTEGER },
    }).valid,
    true,
  );
  assert.equal(
    validateRequest(catalog, op(catalog), {
      path: { id: Number.MAX_SAFE_INTEGER + 1 },
    }).valid,
    false,
  );
});

test("OpenAPI 3.2 discovers standard, QUERY and case-sensitive additional operations", () => {
  const doc = {
    openapi: "3.2.1",
    info: { title: "Independent current standard fixture", version: "1" },
    servers: [],
    paths: {
      "/widgets": {
        get: {
          responses: {
            200: {
              description: "Widgets",
              content: {
                "application/json": {
                  schema: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
        query: { responses: { 200: { description: "Search" } } },
        additionalOperations: {
          COPY: { responses: { 204: { description: "Copied" } } },
          "Search-Widgets": { responses: { 200: { description: "Searched" } } },
        },
      },
    },
  };
  const catalog = buildCatalog(doc);
  assert.deepEqual(
    catalog.operations.map((operation) => operation.key),
    [
      "GET /widgets",
      "QUERY /widgets",
      "COPY /widgets",
      "Search-Widgets /widgets",
    ],
  );
  assert.equal(getOperation(catalog, "GET /widgets").operationId, null);
  assert.equal(
    validateRequest(catalog, getOperation(catalog, "GET /widgets"), {}).valid,
    true,
  );
  assert.equal(
    buildRequest(
      catalog,
      getOperation(catalog, "GET /widgets"),
      {},
      "http://localhost:4300/schema/openapi.json",
    ).url,
    "http://localhost:4300/widgets",
  );
  assert.equal(
    validateResponse(catalog, getOperation(catalog, "GET /widgets"), {
      status: 200,
      contentType: "application/json",
      body: ["one"],
    }).valid,
    true,
  );
  for (const key of [
    "QUERY /widgets",
    "COPY /widgets",
    "Search-Widgets /widgets",
  ])
    assert.equal(
      validateRequest(catalog, getOperation(catalog, key), {}).supported,
      false,
    );
});

test("new media/querystring semantics cannot silently become successful validation", () => {
  const doc = document();
  doc.openapi = "3.2.0";
  doc.paths["/public"].get.parameters = [
    {
      name: "query",
      in: "querystring",
      content: { "application/json": { schema: { type: "object" } } },
    },
  ];
  const catalog = buildCatalog(doc);
  assert.equal(
    validateRequest(catalog, getOperation(catalog, "GET /public"), {})
      .supported,
    false,
  );
  doc.paths["/items/{id}"].get.responses = {
    200: {
      description: "Stream",
      content: { "application/json": { itemSchema: { type: "integer" } } },
    },
  };
  const stream = buildCatalog(doc);
  assert.equal(
    validateResponse(stream, op(stream), {
      status: 200,
      contentType: "application/json",
      body: "invalid item",
    }).supported,
    false,
  );
});

test("path reference siblings are rejected, and server resolution uses the supplied document URL", () => {
  const doc = document();
  doc.components.pathItems = {
    shared: { get: { responses: { 200: { description: "ok" } } } },
  };
  doc.paths["/from-ref"] = {
    $ref: "#/components/pathItems/shared",
    parameters: [
      {
        name: "required",
        in: "query",
        required: true,
        schema: { type: "string" },
      },
    ],
  };
  assert.throws(() => buildCatalog(doc), /Path Item reference siblings/i);
  delete doc.paths["/from-ref"].parameters;
  doc.components.pathItems.shared.servers = [{ url: "../api/v2" }];
  const catalog = buildCatalog(doc);
  assert.equal(
    buildRequest(
      catalog,
      getOperation(catalog, "GET /from-ref"),
      {},
      "http://localhost:4300/specs/openapi.json",
    ).url,
    "http://localhost:4300/api/v2/from-ref",
  );
});

test("minor-version-incompatible schema semantics fail closed", () => {
  const check = (version, schema, body) => {
    const doc = document();
    doc.openapi = version;
    doc.components.schemas.Item = schema;
    const catalog = buildCatalog(doc);
    return validateResponse(catalog, op(catalog), {
      status: 200,
      contentType: "application/json",
      body,
    });
  };
  assert.equal(
    check("3.0.4", { type: "string", nullable: true }, null).valid,
    true,
  );
  assert.equal(
    check("3.1.2", { type: "string", nullable: true }, null).supported,
    false,
  );
  assert.equal(check("3.2.1", { type: ["string", "null"] }, null).valid, true);
  assert.equal(
    check("3.0.4", { type: ["string", "null"] }, null).supported,
    false,
  );
  assert.equal(check("3.0.4", { const: "ok" }, "ok").supported, false);
  assert.equal(
    check("3.1.2", { type: "number", minimum: 0, exclusiveMinimum: true }, 1)
      .supported,
    false,
  );
});

test("readOnly and writeOnly required properties respect request and response direction", () => {
  for (const version of ["3.0.4", "3.1.2", "3.2.1"]) {
    const doc = document();
    doc.openapi = version;
    doc.components.schemas.Item = {
      type: "object",
      required: ["id", "password", "name"],
      properties: {
        id: { type: "integer", readOnly: true },
        password: { type: "string", writeOnly: true },
        name: { type: "string" },
      },
    };
    delete doc.paths["/items/{id}"].patch.parameters[0].schema.const;
    const catalog = buildCatalog(doc);
    assert.equal(
      validateRequest(catalog, op(catalog, "PATCH"), {
        path: { id: 1 },
        headers: { "X-CSRF": "1" },
        body: { password: "fixture-input", name: "sample" },
      }).valid,
      true,
      "A request need not contain a response-only required field",
    );
    assert.equal(
      validateResponse(catalog, op(catalog), {
        status: 200,
        contentType: "application/json",
        body: { id: 1, name: "sample" },
      }).valid,
      true,
      "A response need not contain a request-only required field",
    );
    assert.equal(
      validateRequest(catalog, op(catalog, "PATCH"), {
        path: { id: 1 },
        headers: { "X-CSRF": "1" },
        body: { name: "sample" },
      }).valid,
      false,
    );
    assert.equal(
      validateResponse(catalog, op(catalog), {
        status: 200,
        contentType: "application/json",
        body: { name: "sample" },
      }).valid,
      false,
    );
  }
});

test("directional annotations follow local references and reject malformed flags", () => {
  const doc = document();
  doc.components.schemas.Identifier = { type: "integer", readOnly: true };
  doc.components.schemas.Item = {
    type: "object",
    required: ["id", "name"],
    properties: {
      id: { $ref: "#/components/schemas/Identifier" },
      name: { type: "string" },
    },
  };
  const catalog = buildCatalog(doc);
  assert.equal(
    validateRequest(catalog, op(catalog, "PATCH"), {
      path: { id: 1 },
      headers: { "X-CSRF": "1" },
      body: { name: "sample" },
    }).valid,
    true,
  );
  for (const invalid of [
    { readOnly: "true" },
    { writeOnly: 1 },
    { readOnly: true, writeOnly: true },
  ]) {
    doc.components.schemas.Identifier = { type: "integer", ...invalid };
    const broken = buildCatalog(doc);
    assert.equal(
      validateRequest(broken, op(broken, "PATCH"), {
        path: { id: 1 },
        headers: { "X-CSRF": "1" },
        body: { name: "sample" },
      }).supported,
      false,
    );
  }
});

test("invalid calendar dates and out-of-range clock fields cannot pass date-time validation", () => {
  const doc = document();
  doc.components.schemas.Item = { type: "string", format: "date-time" };
  const catalog = buildCatalog(doc);
  const check = (body) =>
    validateResponse(catalog, op(catalog), {
      status: 200,
      contentType: "application/json",
      body,
    });
  for (const timestamp of [
    "2026-02-31T12:00:00Z",
    "2026-02-29T12:00:00Z",
    "2026-04-31T12:00:00+01:00",
    "2026-01-01T24:00:00Z",
    "2026-01-01T00:00:00+24:00",
  ])
    assert.equal(check(timestamp).valid, false, timestamp);
  for (const timestamp of [
    "2024-02-29T12:00:00Z",
    "2026-04-30T23:59:59.123+02:30",
    "2026-01-01t00:00:00z",
  ])
    assert.equal(check(timestamp).valid, true, timestamp);
});

test("an absent response body is distinct from JSON null and an empty JSON string", () => {
  const catalog = buildCatalog(document());
  const operation = op(catalog, "PATCH");
  assert.equal(
    validateResponse(catalog, operation, { status: 204, contentType: "" })
      .valid,
    true,
  );
  for (const body of [null, "", false, 0, {}])
    assert.equal(
      validateResponse(catalog, operation, {
        status: 204,
        contentType: "application/json",
        body,
      }).valid,
      false,
      "Undocumented JSON bytes must not be treated as an absent body",
    );
});
