// A deliberately bounded OpenAPI subset. This module validates transport data;
// application authorization, state and business outcomes remain in the Rust model.
const METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
];
const MAX_DOCUMENT = 2 * 1024 * 1024;
const MAX_VALUE = 256 * 1024;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const scalar = (value) =>
  typeof value === "string" ||
  typeof value === "boolean" ||
  (typeof value === "number" && Number.isFinite(value));
const fail = (message) => {
  throw new Error(message);
};

function assertOperationPath(path) {
  // WHATWG URL parsing removes literal/encoded dot segments and raw whitespace.
  // Check both the declared template and its fully substituted path: individually
  // harmless scalar values can complete a dot segment across template boundaries.
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    /[?#\\\u0000-\u0020\u007f]/.test(path) ||
    /(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i.test(path)
  )
    fail("Invalid or normalizing OpenAPI path.");
}

function boundedJson(value, limit) {
  let nodes = 0;
  const active = new Set();
  function visit(current, depth) {
    if (++nodes > 50000 || depth > 48)
      fail("JSON structure exceeds the supported limit.");
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "boolean"
    )
      return;
    if (typeof current === "number" && Number.isFinite(current)) return;
    if (!Array.isArray(current) && !object(current))
      fail("Expected bounded JSON data.");
    if (active.has(current)) fail("Cyclic JSON data is unsupported.");
    active.add(current);
    for (const value of Object.values(current)) visit(value, depth + 1);
    active.delete(current);
  }
  visit(value, 0);
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > limit)
    fail("JSON data exceeds the supported size limit.");
  return JSON.parse(encoded);
}
function resolve(document, input, visited = new Set(), pathItem = false) {
  if (!object(input)) fail("Invalid OpenAPI object.");
  if (!own(input, "$ref")) return input;
  if (pathItem && Object.keys(input).some((key) => key !== "$ref"))
    fail("Path Item reference siblings are unsupported.");
  const ref = input.$ref;
  if (typeof ref !== "string" || !ref.startsWith("#/"))
    fail("Only local OpenAPI references are supported.");
  if (visited.has(ref) || visited.size > 32)
    fail("Cyclic or excessive OpenAPI references are unsupported.");
  let value = document;
  for (const part of ref.slice(2).split("/")) {
    if (/~(?:[^01]|$)/.test(part)) fail("Invalid local OpenAPI reference.");
    const name = part.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!object(value) || !own(value, name))
      fail("Unresolved local OpenAPI reference.");
    value = value[name];
  }
  return resolve(document, value, new Set([...visited, ref]), pathItem);
}
const annotations = new Set([
  "title",
  "description",
  "default",
  "example",
  "examples",
  "deprecated",
  "readOnly",
  "writeOnly",
  "xml",
  "externalDocs",
]);
const assertions = new Set([
  "$ref",
  "type",
  "enum",
  "const",
  "nullable",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "allOf",
  "anyOf",
  "oneOf",
  "format",
]);
const formats = new Set([
  "int32",
  "int64",
  "safe-integer",
  "float",
  "double",
  "password",
  "uuid",
  "date",
  "date-time",
  "email",
]);
const types = new Set([
  "null",
  "boolean",
  "object",
  "array",
  "number",
  "integer",
  "string",
]);
function schemaSupport(document, schema, depth = 0, refs = new Set()) {
  if (depth > 32) fail("Schema depth exceeds the supported limit.");
  const legacy = document.openapi.startsWith("3.0.");
  if (typeof schema === "boolean") {
    if (legacy) fail("Boolean schemas require OpenAPI 3.1 or later.");
    return;
  }
  if (!object(schema)) fail("Invalid schema.");
  if (
    legacy &&
    (Array.isArray(schema.type) ||
      schema.type === "null" ||
      own(schema, "const"))
  )
    fail("Schema keyword requires OpenAPI 3.1 or later.");
  if (!legacy && own(schema, "nullable"))
    fail("Nullable uses a type union in OpenAPI 3.1 and later.");
  for (const key of ["exclusiveMinimum", "exclusiveMaximum"])
    if (
      own(schema, key) &&
      typeof schema[key] !== (legacy ? "boolean" : "number")
    )
      fail("Exclusive bound is incompatible with this OpenAPI version.");
  for (const key of Object.keys(schema))
    if (!assertions.has(key) && !annotations.has(key) && !key.startsWith("x-"))
      fail("Schema contains an unsupported keyword.");
  if (own(schema, "$ref")) {
    if (refs.has(schema.$ref)) fail("Cyclic schemas are unsupported.");
    schemaSupport(
      document,
      resolve(document, schema),
      depth + 1,
      new Set([...refs, schema.$ref]),
    );
  }
  if (own(schema, "type")) {
    const list = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (
      !list.length ||
      list.some((type) => !types.has(type)) ||
      new Set(list).size !== list.length
    )
      fail("Invalid schema type.");
  }
  if (own(schema, "nullable") && typeof schema.nullable !== "boolean")
    fail("Invalid nullable schema.");
  for (const key of ["readOnly", "writeOnly"])
    if (own(schema, key) && typeof schema[key] !== "boolean")
      fail("Invalid directional schema annotation.");
  if (schema.readOnly === true && schema.writeOnly === true)
    fail("A property cannot be both read-only and write-only.");
  if (own(schema, "format") && !formats.has(schema.format))
    fail("Schema format is unsupported.");
  if (
    own(schema, "enum") &&
    (!Array.isArray(schema.enum) || !schema.enum.length)
  )
    fail("Invalid schema enum.");
  if (
    own(schema, "required") &&
    (!Array.isArray(schema.required) ||
      schema.required.some((key) => typeof key !== "string") ||
      new Set(schema.required).size !== schema.required.length)
  )
    fail("Invalid required properties.");
  if (own(schema, "properties")) {
    if (!object(schema.properties)) fail("Invalid schema properties.");
    for (const child of Object.values(schema.properties))
      schemaSupport(document, child, depth + 1, refs);
  }
  if (
    own(schema, "additionalProperties") &&
    typeof schema.additionalProperties !== "boolean"
  )
    schemaSupport(document, schema.additionalProperties, depth + 1, refs);
  if (own(schema, "items"))
    schemaSupport(document, schema.items, depth + 1, refs);
  for (const key of ["allOf", "anyOf", "oneOf"])
    if (own(schema, key)) {
      if (
        !Array.isArray(schema[key]) ||
        !schema[key].length ||
        schema[key].length > 32
      )
        fail("Invalid schema composition.");
      for (const child of schema[key])
        schemaSupport(document, child, depth + 1, refs);
    }
  for (const key of [
    "minItems",
    "maxItems",
    "minProperties",
    "maxProperties",
    "minLength",
    "maxLength",
  ])
    if (
      own(schema, key) &&
      (!Number.isSafeInteger(schema[key]) || schema[key] < 0)
    )
      fail("Invalid schema bound.");
  for (const key of ["minimum", "maximum"])
    if (
      own(schema, key) &&
      (typeof schema[key] !== "number" || !Number.isFinite(schema[key]))
    )
      fail("Invalid numeric schema bound.");
  for (const key of ["exclusiveMinimum", "exclusiveMaximum"])
    if (
      own(schema, key) &&
      typeof schema[key] !== "boolean" &&
      (typeof schema[key] !== "number" || !Number.isFinite(schema[key]))
    )
      fail("Invalid exclusive schema bound.");
  if (own(schema, "uniqueItems") && typeof schema.uniqueItems !== "boolean")
    fail("Invalid uniqueItems schema.");
}
function equal(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return (
      a.length === b.length && a.every((value, index) => equal(value, b[index]))
    );
  if (object(a) && object(b))
    return (
      Object.keys(a).length === Object.keys(b).length &&
      Object.keys(a).every((key) => own(b, key) && equal(a[key], b[key]))
    );
  return false;
}
function calendarDate(year, month, day) {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}
function formatValid(format, value) {
  if (format === "int32")
    return (
      Number.isInteger(value) && value >= -2147483648 && value <= 2147483647
    );
  if (["int64", "safe-integer"].includes(format))
    return Number.isSafeInteger(value);
  if (["float", "double"].includes(format))
    return typeof value === "number" && Number.isFinite(value);
  if (format === "password") return typeof value === "string";
  if (typeof value !== "string") return false;
  if (format === "uuid")
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    );
  if (format === "email")
    return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (format === "date")
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value
    );
  if (format === "date-time") {
    const parts =
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/i.exec(
        value,
      );
    if (!parts) return false;
    const [
      ,
      year,
      month,
      day,
      hour,
      minute,
      second,
      offsetHour = "0",
      offsetMinute = "0",
    ] = parts;
    return (
      calendarDate(Number(year), Number(month), Number(day)) &&
      Number(hour) <= 23 &&
      Number(minute) <= 59 &&
      Number(second) <= 59 &&
      Number(offsetHour) <= 23 &&
      Number(offsetMinute) <= 59 &&
      Number.isFinite(Date.parse(value))
    );
  }
  return false;
}
function directionFlag(document, schema, flag) {
  if (!object(schema)) return false;
  if (schema[flag] === true) return true;
  if (
    own(schema, "$ref") &&
    directionFlag(document, resolve(document, schema), flag)
  )
    return true;
  return (
    schema.allOf?.some((child) => directionFlag(document, child, flag)) ?? false
  );
}
function schemaValid(
  document,
  schema,
  value,
  depth = 0,
  direction = "response",
) {
  if (depth > 48) return false;
  if (typeof schema === "boolean") return schema;
  if (
    own(schema, "$ref") &&
    !schemaValid(
      document,
      resolve(document, schema),
      value,
      depth + 1,
      direction,
    )
  )
    return false;
  if (own(schema, "type")) {
    const list = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (
      !(schema.nullable === true && value === null) &&
      !list.some(
        (type) =>
          ({
            null: value === null,
            boolean: typeof value === "boolean",
            object: object(value),
            array: Array.isArray(value),
            number: typeof value === "number" && Number.isFinite(value),
            integer: Number.isSafeInteger(value),
            string: typeof value === "string",
          })[type],
      )
    )
      return false;
  }
  if (schema.enum && !schema.enum.some((candidate) => equal(candidate, value)))
    return false;
  if (own(schema, "const") && !equal(schema.const, value)) return false;
  if (
    schema.allOf &&
    !schema.allOf.every((child) =>
      schemaValid(document, child, value, depth + 1, direction),
    )
  )
    return false;
  if (
    schema.anyOf &&
    !schema.anyOf.some((child) =>
      schemaValid(document, child, value, depth + 1, direction),
    )
  )
    return false;
  if (
    schema.oneOf &&
    schema.oneOf.filter((child) =>
      schemaValid(document, child, value, depth + 1, direction),
    ).length !== 1
  )
    return false;
  if (typeof value === "string") {
    const length = [...value].length;
    if (
      length < (schema.minLength ?? 0) ||
      length > (schema.maxLength ?? Infinity)
    )
      return false;
  }
  if (typeof value === "number") {
    if (
      value < (schema.minimum ?? -Infinity) ||
      value > (schema.maximum ?? Infinity)
    )
      return false;
    if (
      typeof schema.exclusiveMinimum === "number" &&
      value <= schema.exclusiveMinimum
    )
      return false;
    if (
      typeof schema.exclusiveMaximum === "number" &&
      value >= schema.exclusiveMaximum
    )
      return false;
    if (
      schema.exclusiveMinimum === true &&
      own(schema, "minimum") &&
      value <= schema.minimum
    )
      return false;
    if (
      schema.exclusiveMaximum === true &&
      own(schema, "maximum") &&
      value >= schema.maximum
    )
      return false;
  }
  if (schema.format && value !== null && !formatValid(schema.format, value))
    return false;
  if (Array.isArray(value)) {
    if (
      value.length < (schema.minItems ?? 0) ||
      value.length > (schema.maxItems ?? Infinity)
    )
      return false;
    if (
      own(schema, "items") &&
      !value.every((item) =>
        schemaValid(document, schema.items, item, depth + 1, direction),
      )
    )
      return false;
    if (
      schema.uniqueItems &&
      value.some((item, index) =>
        value.slice(0, index).some((previous) => equal(item, previous)),
      )
    )
      return false;
  }
  if (object(value)) {
    const keys = Object.keys(value);
    if (
      keys.length < (schema.minProperties ?? 0) ||
      keys.length > (schema.maxProperties ?? Infinity)
    )
      return false;
    if (
      (schema.required ?? []).some(
        (key) =>
          !own(value, key) &&
          !directionFlag(
            document,
            schema.properties?.[key],
            direction === "request" ? "readOnly" : "writeOnly",
          ),
      )
    )
      return false;
    for (const key of keys) {
      if (own(schema.properties ?? {}, key)) {
        if (
          !schemaValid(
            document,
            schema.properties[key],
            value[key],
            depth + 1,
            direction,
          )
        )
          return false;
      } else if (
        schema.additionalProperties === false ||
        (object(schema.additionalProperties) &&
          !schemaValid(
            document,
            schema.additionalProperties,
            value[key],
            depth + 1,
            direction,
          ))
      )
        return false;
    }
  }
  return true;
}
function parameterSupport(document, parameter) {
  if (
    !object(parameter) ||
    typeof parameter.name !== "string" ||
    !parameter.name ||
    !["path", "query", "header"].includes(parameter.in)
  )
    fail("Parameter location is unsupported.");
  if (parameter.in === "path" && parameter.required !== true)
    fail("Path parameters must be required.");
  if (
    parameter.content ||
    parameter.allowReserved === true ||
    parameter.allowEmptyValue === true
  )
    fail("Parameter serialization is unsupported.");
  if (
    parameter.style &&
    parameter.style !== (parameter.in === "query" ? "form" : "simple")
  )
    fail("Parameter serialization is unsupported.");
  if (
    parameter.in === "header" &&
    !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(parameter.name)
  )
    fail("Invalid header parameter name.");
  if (
    parameter.in === "header" &&
    [
      "cookie",
      "host",
      "origin",
      "authorization",
      "content-type",
      "content-length",
      "connection",
      "referer",
    ].includes(parameter.name.toLowerCase())
  )
    fail("Managed header parameters are unsupported.");
  schemaSupport(document, parameter.schema ?? {});
  const schema = object(parameter.schema)
    ? resolve(document, parameter.schema)
    : parameter.schema;
  if (
    schema &&
    (["object", "array"].includes(schema.type) ||
      (Array.isArray(schema.type) &&
        schema.type.some((type) => ["object", "array", "null"].includes(type))))
  )
    fail("Only scalar parameter serialization is supported.");
}
function contentSchema(content, mediaType) {
  if (!object(content)) fail("Invalid media type content.");
  const media = content[mediaType];
  if (!object(media)) fail("Unsupported media type.");
  if (
    own(media, "itemSchema") ||
    own(media, "prefixEncoding") ||
    own(media, "itemEncoding")
  )
    fail("Streaming or positional media type semantics are unsupported.");
  if (media.encoding && Object.keys(media.encoding).length)
    fail("Media type encoding is unsupported.");
  return media.schema ?? {};
}
export function buildCatalog(input) {
  const document = boundedJson(input, MAX_DOCUMENT);
  if (
    !object(document) ||
    typeof document.openapi !== "string" ||
    !/^3\.[012]\.\d+$/.test(document.openapi) ||
    !object(document.paths)
  )
    fail("Only OpenAPI 3.0, 3.1 and 3.2 JSON documents are supported.");
  if (
    document.jsonSchemaDialect &&
    ![
      "https://spec.openapis.org/oas/3.1/dialect/base",
      "https://spec.openapis.org/oas/3.2/dialect/base",
      "https://json-schema.org/draft/2020-12/schema",
    ].includes(document.jsonSchemaDialect)
  )
    fail("OpenAPI schema dialect is unsupported.");
  const operations = [];
  for (const [path, rawPath] of Object.entries(document.paths)) {
    if (!path.startsWith("/")) continue;
    assertOperationPath(path);
    const pathItem = resolve(document, rawPath, new Set(), true);
    const entries = METHODS.filter((method) => own(pathItem, method)).map(
      (method) => [method.toUpperCase(), pathItem[method], false],
    );
    const modern = document.openapi.startsWith("3.2.");
    if (
      !modern &&
      (own(pathItem, "query") || own(pathItem, "additionalOperations"))
    )
      fail("Additional HTTP operations require OpenAPI 3.2.");
    if (modern && own(pathItem, "query"))
      entries.push(["QUERY", pathItem.query, true]);
    if (modern && own(pathItem, "additionalOperations")) {
      if (!object(pathItem.additionalOperations))
        fail("Invalid additional operations map.");
      for (const [method, operation] of Object.entries(
        pathItem.additionalOperations,
      )) {
        if (
          !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(method) ||
          [...METHODS, "query"].includes(method.toLowerCase())
        )
          fail("Invalid or duplicate additional HTTP method.");
        entries.push([method, operation, true]);
      }
    }
    for (const [method, entry, unavailableMethod] of entries) {
      if (operations.length >= 512) fail("OpenAPI operation limit exceeded.");
      const raw = resolve(document, entry);
      const unsupported = unavailableMethod
        ? ["HTTP method execution is not supported by this driver."]
        : [];
      const check = (fn) => {
        try {
          return fn();
        } catch (error) {
          unsupported.push(error.message);
          return undefined;
        }
      };
      const merged = new Map();
      for (const parameters of [
        pathItem.parameters ?? [],
        raw.parameters ?? [],
      ]) {
        if (!Array.isArray(parameters) || parameters.length > 64) {
          unsupported.push("Parameter limit or shape is unsupported.");
          continue;
        }
        const seen = new Set();
        for (const entry of parameters) {
          const parameter = check(() => resolve(document, entry));
          if (!parameter) continue;
          const key = `${parameter.in}:${parameter.in === "header" ? parameter.name?.toLowerCase() : parameter.name}`;
          if (seen.has(key))
            unsupported.push("Duplicate parameters are unsupported.");
          seen.add(key);
          merged.set(key, parameter);
        }
      }
      const parameters = [...merged.values()];
      for (const parameter of parameters)
        check(() => parameterSupport(document, parameter));
      const slots = [...path.matchAll(/\{([^{}]+)\}/g)].map(
        (match) => match[1],
      );
      if (
        slots.some(
          (name) =>
            !parameters.some(
              (parameter) => parameter.in === "path" && parameter.name === name,
            ),
        ) ||
        parameters.some(
          (parameter) =>
            parameter.in === "path" && !slots.includes(parameter.name),
        )
      )
        unsupported.push(
          "Path template parameters do not match the declaration.",
        );
      const requestBody = raw.requestBody
        ? (check(() => resolve(document, raw.requestBody)) ?? null)
        : null;
      if (requestBody)
        check(() =>
          schemaSupport(
            document,
            contentSchema(requestBody.content, "application/json"),
          ),
        );
      const responses = {};
      if (!object(raw.responses) || !Object.keys(raw.responses).length)
        unsupported.push("Response declarations are required.");
      else
        for (const [status, response] of Object.entries(raw.responses)) {
          if (status.startsWith("x-")) continue;
          if (!/^(?:[1-5]\d\d|[1-5]XX|default)$/.test(status)) {
            unsupported.push("Response status declaration is unsupported.");
            continue;
          }
          const resolved = check(() => resolve(document, response));
          if (resolved) responses[status] = resolved;
        }
      const declaredServers =
        raw.servers ?? pathItem.servers ?? document.servers ?? [];
      const servers =
        Array.isArray(declaredServers) && declaredServers.length === 0
          ? [{ url: "/" }]
          : declaredServers;
      if (
        !Array.isArray(servers) ||
        servers.length !== 1 ||
        !object(servers[0]) ||
        typeof servers[0].url !== "string" ||
        servers[0].url.includes("{")
      )
        unsupported.push(
          "Exactly one explicit non-templated server is supported.",
        );
      const security = raw.security ?? document.security ?? [];
      if (!Array.isArray(security))
        unsupported.push("Invalid security requirements.");
      operations.push({
        key: `${method} ${path}`,
        operationId:
          typeof raw.operationId === "string" ? raw.operationId : null,
        method,
        path,
        summary: typeof raw.summary === "string" ? raw.summary : "",
        parameters,
        requestBody,
        responses,
        security,
        servers,
        unsupported: [...new Set(unsupported)],
      });
    }
  }
  return { version: document.openapi, operations, document };
}
export function getOperation(catalog, key) {
  const operation = catalog.operations.find(
    (candidate) => candidate.key === key,
  );
  if (!operation) fail("Unknown OpenAPI operation.");
  return operation;
}
function result(valid = true, supported = true, errors = []) {
  return {
    valid: valid && supported,
    supported,
    errors: [...new Set(errors)].slice(0, 16),
  };
}
export function validateRequest(catalog, operation, input) {
  let request;
  try {
    request = boundedJson(input, MAX_VALUE);
  } catch {
    return result(false, true, ["Request must be bounded JSON data."]);
  }
  if (
    !object(request) ||
    Object.keys(request).some(
      (key) => !["path", "query", "headers", "body"].includes(key),
    )
  )
    return result(false, true, ["Invalid request input shape."]);
  if (operation.unsupported.length)
    return result(false, false, operation.unsupported);
  const errors = [];
  const fields = {
    path: request.path ?? {},
    query: request.query ?? {},
    header: request.headers ?? {},
  };
  for (const [location, values] of Object.entries(fields)) {
    if (!object(values))
      return result(false, true, ["Parameter inputs must be objects."]);
    if (
      location === "header" &&
      new Set(Object.keys(values).map((key) => key.toLowerCase())).size !==
        Object.keys(values).length
    )
      errors.push("Duplicate header inputs are invalid.");
    for (const [name, value] of Object.entries(values)) {
      const parameter = operation.parameters.find(
        (candidate) =>
          candidate.in === location &&
          (location === "header"
            ? candidate.name.toLowerCase() === name.toLowerCase()
            : candidate.name === name),
      );
      if (!parameter) errors.push("An undeclared parameter was supplied.");
      if (!scalar(value))
        errors.push("Only scalar parameter values are supported.");
      if (typeof value === "string" && /[\x00-\x1f\x7f]/.test(value))
        errors.push("Control characters are not valid parameter input.");
    }
  }
  try {
    for (const parameter of operation.parameters) {
      parameterSupport(catalog.document, parameter);
      const values = fields[parameter.in];
      const name = Object.keys(values).find((key) =>
        parameter.in === "header"
          ? key.toLowerCase() === parameter.name.toLowerCase()
          : key === parameter.name,
      );
      if (name === undefined) {
        if (parameter.required) errors.push("A required parameter is missing.");
        continue;
      }
      if (
        !schemaValid(
          catalog.document,
          parameter.schema ?? {},
          values[name],
          0,
          "request",
        )
      )
        errors.push("A parameter does not match its schema.");
    }
    if (!operation.requestBody && own(request, "body"))
      errors.push("This operation does not declare a request body.");
    if (operation.requestBody) {
      const schema = contentSchema(
        operation.requestBody.content,
        "application/json",
      );
      schemaSupport(catalog.document, schema);
      if (!own(request, "body")) {
        if (operation.requestBody.required)
          errors.push("A request body is required.");
      } else if (
        !schemaValid(catalog.document, schema, request.body, 0, "request")
      )
        errors.push("The request body does not match its schema.");
    }
  } catch (error) {
    return result(false, false, [error.message]);
  }
  return result(errors.length === 0, true, errors);
}
export function buildRequest(catalog, operation, request, baseUrl) {
  const validation = validateRequest(catalog, operation, request);
  if (!validation.valid) fail("Request is invalid or unsupported.");
  let base, server;
  try {
    base = new URL(baseUrl);
    server = new URL(operation.servers[0].url, base);
  } catch {
    fail("Invalid request origin or server.");
  }
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    server.origin !== base.origin ||
    server.username ||
    server.password ||
    server.search ||
    server.hash
  )
    fail("Request server must retain the configured origin.");
  let path = operation.path;
  for (const parameter of operation.parameters.filter(
    (parameter) => parameter.in === "path",
  )) {
    const value = String(request.path[parameter.name]);
    if (value === "." || value === "..")
      fail("Path values cannot be dot segments.");
    path = path.replaceAll(`{${parameter.name}}`, encodeURIComponent(value));
  }
  if (/[{}]/.test(path)) fail("Unresolved request path.");
  assertOperationPath(path);
  // Concatenate instead of URL-relative resolution: operation paths are relative
  // to a server's base path, even though every OpenAPI path starts with '/'.
  const url = new URL(`${server.href.replace(/\/$/, "")}${path}`);
  if (url.origin !== base.origin) fail("Request URL changed origin.");
  for (const [key, value] of Object.entries(request.query ?? {}))
    url.searchParams.append(key, String(value));
  const headers = { ...(request.headers ?? {}) };
  const built = { url: url.href, method: operation.method, headers };
  if (own(request, "body")) {
    built.body = JSON.stringify(request.body);
    headers["Content-Type"] = "application/json";
  }
  return built;
}
export function validateResponse(catalog, operation, response) {
  const status = response?.status;
  if (!Number.isInteger(status) || status < 100 || status > 599)
    return {
      documented: false,
      ...result(false, true, ["Response status is invalid."]),
    };
  const declaration =
    operation.responses[String(status)] ??
    operation.responses[`${Math.floor(status / 100)}XX`] ??
    operation.responses.default;
  if (!declaration)
    return {
      documented: false,
      ...result(false, true, ["Response status is not documented."]),
    };
  try {
    if (!declaration.content || !Object.keys(declaration.content).length)
      return {
        documented: true,
        ...result(
          response.body === undefined,
          true,
          response.body === undefined
            ? []
            : ["An undocumented response body was received."],
        ),
      };
    const mediaType = String(response.contentType ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (
      mediaType !== "application/json" &&
      !/^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(mediaType)
    )
      return {
        documented: true,
        ...result(false, true, ["Response media type is not supported JSON."]),
      };
    const schema = contentSchema(declaration.content, mediaType);
    schemaSupport(catalog.document, schema);
    const body = boundedJson(response.body, MAX_VALUE);
    const valid = schemaValid(catalog.document, schema, body);
    return {
      documented: true,
      ...result(
        valid,
        true,
        valid ? [] : ["Response body does not match its schema."],
      ),
    };
  } catch (error) {
    return { documented: true, ...result(false, false, [error.message]) };
  }
}
