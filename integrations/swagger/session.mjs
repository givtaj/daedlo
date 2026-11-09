import { mkdtemp, readFile, writeFile, chmod, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createDriverSession,
  createResourceScope,
} from "../../packages/runtime/src/index.mjs";
import {
  buildCatalog,
  validateRequest,
} from "../../packages/runtime/src/swagger/catalog.mjs";
import {
  createSwaggerAdapter,
  swaggerDigest,
} from "../../packages/runtime/src/swagger/adapter.mjs";

const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
// Shared by file-based projects and direct session callers. Operation policies
// are explicit arrays; strings and other iterables must not become capabilities.
export function validateSwaggerPolicy(allowOperations = [], allowWrites = []) {
  for (const values of [allowOperations, allowWrites]) {
    if (
      !Array.isArray(values) ||
      values.length > 512 ||
      values.some(
        (value) =>
          typeof value !== "string" ||
          value.length > 512 ||
          !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+ \/[^\s?#\\]*$/.test(value) ||
          /[\u0000-\u001f\u007f-\u009f]/.test(value),
      ) ||
      new Set(values).size !== values.length
    )
      throw Error(
        "Swagger policy must contain bounded arrays of unique operation keys.",
      );
  }
  const allowed = new Set(allowOperations);
  if (allowWrites.some((key) => !allowed.has(key)))
    throw Error(
      "Every write policy entry must also be explicitly allowed for execution.",
    );
  return {
    allowOperations: [...allowOperations],
    allowWrites: [...allowWrites],
  };
}

export async function createSwaggerSession({
  page,
  context = page.context(),
  enginePath,
  document,
  baseUrl,
  docsUrl = page.url(),
  allowOperations = [],
  allowWrites = [],
  verifyEffect,
  timeoutMs,
}) {
  ({ allowOperations, allowWrites } = validateSwaggerPolicy(
    allowOperations,
    allowWrites,
  ));
  if (
    typeof enginePath !== "string" ||
    !enginePath.trim() ||
    /[\u0000\r\n]/.test(enginePath)
  )
    throw Error("An explicit Swagger engine path is required.");
  const catalog = buildCatalog(document);
  const allowed = new Set(allowOperations),
    writes = new Set(allowWrites);
  if (catalog.operations.length > 200)
    throw Error(
      "This Swagger driver supports at most 200 operations per session.",
    );
  for (const key of [...allowed, ...writes])
    if (!catalog.operations.some((op) => op.key === key))
      throw Error("Project policy names an undeclared operation.");
  const profile = {
    specDigest: swaggerDigest(catalog.document),
    operations: catalog.operations.map((operation) => ({
      key: operation.key,
      method: operation.method,
      path: operation.path,
      allowExecute:
        allowed.has(operation.key) && operation.unsupported.length === 0,
      allowWrite: writes.has(operation.key),
      autoRecipe:
        allowed.has(operation.key) &&
        ["GET", "HEAD"].includes(operation.method) &&
        validateRequest(catalog, operation, {}).valid,
    })),
  };
  const resolvedEnginePath = resolve(enginePath);
  const swaggerEngineSha256 = createHash("sha256")
    .update(await readFile(resolvedEnginePath))
    .digest("hex");
  const scope = createResourceScope();
  scope.attach(context, { label: "attached Swagger browser context" });
  scope.attach(new URL(baseUrl).origin, { label: "attached API service" });
  return scope.setup(async () => {
    const directory = await mkdtemp(join(tmpdir(), "daedlo-swagger-"));
    await chmod(directory, 0o700);
    scope.own(directory, {
      label: "owned Swagger model profile",
      close: (path) => rm(path, { recursive: true, force: true }),
    });
    const profilePath = join(directory, "profile.json"),
      launcher = join(directory, "engine");
    await writeFile(profilePath, JSON.stringify(profile), { mode: 0o600 });
    await writeFile(
      launcher,
      `#!/bin/sh\nexec ${quote(resolvedEnginePath)} ${quote(profilePath)}\n`,
      { mode: 0o700 },
    );
    const adapter = await createSwaggerAdapter({
      page,
      context,
      catalog,
      baseUrl,
      docsUrl,
      allowOperations: profile.operations
        .filter((o) => o.allowExecute)
        .map((o) => o.key),
      allowWrites,
      verifyEffect,
      timeoutMs,
    });
    scope.own(adapter, {
      label: "owned Swagger network guard",
      close: (value) => value.close(),
    });
    const session = await createDriverSession({
      page,
      context,
      enginePath: launcher,
      adapter,
      resources: scope,
      identity: {
        application: "swagger-api",
        schemaSha256: profile.specDigest,
        // engineSha256 belongs to the runtime launcher; this identifies the
        // actual Rust model executable selected by that launcher.
        swaggerEngineSha256,
      },
    });
    return { session, adapter, catalog };
  });
}
