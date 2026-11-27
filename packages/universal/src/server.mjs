import http from "node:http";
import { publicImportedRun } from "./archive-http.mjs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  knowledgeRoute,
  knowledgeBodyLimit,
  validateKnowledgeBody,
  readKnowledgeRoute,
  writeKnowledgeRoute,
} from "./knowledge-http.mjs";

const MAX_BODY = 8192;
const MAX_CURSOR = 4096;
const id = (value) =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value, limit = 256) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= limit &&
  !/[\x00-\x1f\x7f-\x9f]/.test(value);
const integer = (value, minimum = 0) =>
  Number.isSafeInteger(value) && value >= minimum;
const errors = {
  container_runner_required: [
    409,
    "Use the reviewed integration runner inside this container. Managed live viewers require a native installation.",
  ],
  catalog_upgrade_required: [
    409,
    "Use daedlo-universal upgrade --workspace ROOT before changing this workspace.",
  ],
  catalog_migration_pending: [
    409,
    "A storage upgrade is pending. Resume it explicitly with the upgrade command.",
  ],
  evidence_invalid: [400, "The evidence file or reference is invalid."],
  evidence_reference: [
    409,
    "Evidence must reference an observed run in this target.",
  ],
  evidence_not_found: [404, "The evidence does not exist in this target."],
  evidence_missing: [409, "The retained evidence file is missing."],
  evidence_corrupt: [
    409,
    "Evidence integrity verification failed. The stored record was retained.",
  ],
  evidence_uncommitted: [
    409,
    "The file was retained but catalog publication did not complete. Inspect pending evidence before explicitly retrying.",
  ],
  evidence_unproven: [
    409,
    "Pending evidence ownership is unproven. Preserve the files for inspection.",
  ],
  evidence_ownership_changed: [
    409,
    "Evidence ownership changed. Preserve the files for inspection.",
  ],
  evidence_cursor: [
    400,
    "The evidence cursor is invalid or stale. Read the first page again.",
  ],
  evidence_limit: [409, "The evidence operation exceeds its supported bound."],
  evidence_storage: [
    409,
    "Evidence storage could not complete. Inspect retained files before retrying.",
  ],
  evidence_cleanup_incomplete: [
    409,
    "Evidence cleanup is incomplete. Retained handles require an explicit shutdown retry.",
  ],
  knowledge_invalid: [400, "The manual record or reference is invalid."],
  knowledge_reference: [
    409,
    "A reference is unavailable or belongs to another target.",
  ],
  knowledge_not_found: [404, "The record does not exist in this target."],
  knowledge_conflict: [409, "The record changed. Refresh before reviewing it."],
  knowledge_revalidation: [
    409,
    "Acceptance requires current integration identity and available evidence.",
  ],
  knowledge_corrupt: [
    409,
    "The retained record needs inspection. Its data was preserved.",
  ],
  knowledge_limit: [
    409,
    "The knowledge operation exceeds its supported bound.",
  ],
  knowledge_cursor: [
    400,
    "The record cursor is invalid or stale. Read the first page again.",
  ],
  archive_storage: [
    409,
    "The archive could not be read or stored. Original files were preserved.",
  ],
  archive_cleanup_incomplete: [
    409,
    "Archive cleanup is incomplete. Retained handles require explicit retry.",
  ],
  archive_invalid: [400, "The managed archive is invalid."],
  archive_unsupported: [409, "The managed archive format is unsupported."],
  archive_limit: [409, "Archive import exceeds the supported bound."],
  archive_conflict: [
    409,
    "This run conflicts with retained history. Both sources were preserved.",
  ],
  archive_target_conflict: [
    409,
    "This archive belongs to a different explicit target mapping.",
  ],
  archive_source_changed: [
    409,
    "The archive changed during import. Its original files were preserved.",
  ],
  archive_not_found: [
    404,
    "The imported report does not exist in this target.",
  ],
  archive_corrupt: [
    409,
    "The retained archive needs inspection. Its data was preserved.",
  ],
  authentication_required: [
    401,
    "Open the local Universal link to authenticate this request.",
  ],
  origin_required: [403, "The exact local Host and Origin are required."],
  invalid_request: [400, "The request has an unsupported shape or value."],
  json_required: [415, "JSON content type is required."],
  request_too_large: [413, "The request exceeds the supported size limit."],
  not_found: [404, "This Universal route is unavailable."],
  target_not_found: [404, "The requested target is not registered."],
  target_changed: [
    409,
    "The target changed. Read its current registration before continuing.",
  ],
  target_configuration: [409, "The target configuration cannot be used."],
  target_mismatch: [
    409,
    "The requested target does not match its registered integration.",
  ],
  catalog_cursor: [
    400,
    "This history cursor is invalid or stale. Read the first page again.",
  ],
  catalog_incompatible: [
    409,
    "The catalog requires compatible Universal tools.",
  ],
  catalog_corrupt: [
    409,
    "The catalog needs inspection. Its data was preserved.",
  ],
  catalog_busy: [409, "Another catalog operation is in progress."],
  catalog_uninitialized: [
    409,
    "The Universal catalog has not been initialized.",
  ],
  catalog_recovery_required: [
    409,
    "An interrupted catalog transaction requires explicit indexing before history can be read.",
  ],
  catalog_rollback_unproven: [
    409,
    "Preserve the database and rollback journal for inspection; ownership proof is incomplete.",
  ],
  catalog_missing: [409, "The Universal catalog has not been initialized."],
  catalog_ownership_changed: [
    409,
    "Catalog ownership changed. Inspect the retained workspace.",
  ],
  catalog_storage: [409, "Catalog storage could not complete the operation."],
  catalog_limit: [409, "The operation exceeds the supported history bound."],
  target_invalid: [400, "The target registration is invalid."],
  target_conflict: [
    409,
    "The target registration changed or conflicts with an existing target.",
  ],
  catalog_changed: [
    409,
    "Catalog ownership changed. Inspect the retained workspace.",
  ],
  catalog_source_changed: [
    409,
    "Recorded source data changed. Inspect it before indexing again.",
  ],
  operation_busy: [409, "Another Universal mutation is in progress."],
  recovery_required: [
    409,
    "Retained ownership requires explicit recovery before continuing.",
  ],
  invalid_response: [
    409,
    "The operation did not return matching, usable evidence.",
  ],
  operation_failed: [
    409,
    "The operation did not complete. Inspect the local state before continuing.",
  ],
};
const fail = (code) => {
  throw Object.assign(Error(), { code });
};
const project = (value, keys) =>
  Object.fromEntries(
    keys
      .filter((key) => Object.hasOwn(value, key))
      .map((key) => [key, value[key]]),
  );
const runFields = [
  "sourceKind",
  "archivedAt",
  "runId",
  "command",
  "commandTruncated",
  "recipe",
  "startedAt",
  "finishedAt",
  "status",
  "execution",
  "effect",
  "eventCount",
  "historyComplete",
  "reportTruncated",
  "indexedAt",
];
const detailFields = [
  "format",
  "workspaceId",
  "projectId",
  "runId",
  "status",
  "liveState",
  "historyComplete",
  "partialTail",
  "events",
  "report",
  "recovery",
];
const indexFields = [
  "targetId",
  "generation",
  "indexedRuns",
  "unchangedRuns",
  "incompleteRuns",
  "invalidRuns",
  "bytesRead",
  "indexedAt",
];
const runStatuses = new Set([
  "finished",
  "incomplete",
  "corrupt",
  "unsupported",
  "missing",
]);
const liveStatuses = new Set([
  "running",
  "starting",
  "stopped",
  "recovery_required",
  "failed",
  "observation_failed",
  "unreachable",
]);

function publicTarget(value) {
  let origin;
  try {
    origin = new URL(value?.origin);
  } catch {}
  if (
    !object(value) ||
    !id(value.id) ||
    !text(value.label) ||
    !text(value.environment) ||
    !integer(value.revision, 1) ||
    !object(value.model) ||
    !text(value.model.id) ||
    !text(value.model.version) ||
    !origin ||
    !["http:", "https:"].includes(origin.protocol) ||
    origin.origin !== value.origin
  )
    fail("invalid_response");
  return {
    ...project(value, ["id", "label", "environment", "origin", "revision"]),
    model: { id: value.model.id, version: value.model.version },
  };
}
function publicRuns(value, targetId, limit) {
  if (
    !object(value) ||
    value.targetId !== targetId ||
    !Array.isArray(value.items) ||
    value.items.length > limit ||
    !(value.nextCursor === null || text(value.nextCursor, MAX_CURSOR)) ||
    !(value.generation === null || integer(value.generation)) ||
    !(value.indexedAt === null || text(value.indexedAt, 64))
  )
    fail("invalid_response");
  const runs = value.items.map((item) => {
    if (
      !object(item) ||
      !id(item.runId) ||
      (item.sourceKind === "archive"
        ? item.status !== "imported" ||
          item.historyComplete !== false ||
          !text(item.archivedAt, 64)
        : !runStatuses.has(item.status) ||
          (item.sourceKind !== undefined && item.sourceKind !== "journal"))
    )
      fail("invalid_response");
    return project(item, runFields);
  });
  return {
    runs,
    nextCursor: value.nextCursor,
    indexedAt: value.indexedAt,
    generation: value.generation,
  };
}
function publicRun(value, targetId, runId) {
  if (
    !object(value) ||
    value.targetId !== targetId ||
    value.runId !== runId ||
    value.format !== "daedlo-run-journal/1" ||
    !id(value.workspaceId) ||
    !id(value.projectId) ||
    !["finished", "incomplete"].includes(value.status) ||
    value.liveState !== "unknown" ||
    !Array.isArray(value.events) ||
    typeof value.historyComplete !== "boolean" ||
    typeof value.partialTail !== "boolean"
  )
    fail("invalid_response");
  return { ...project(value, detailFields), targetId };
}
function publicIndex(value, targetId) {
  if (
    !object(value) ||
    value.targetId !== targetId ||
    !indexFields.slice(1, -1).every((key) => integer(value[key])) ||
    !text(value.indexedAt, 64)
  )
    fail("invalid_response");
  return project(value, indexFields);
}
function publicLive(value) {
  if (
    !object(value) ||
    !liveStatuses.has(value.status) ||
    typeof value.reused !== "boolean"
  )
    fail("invalid_response");
  let viewer;
  if (value.viewerUrl !== null) {
    try {
      viewer = new URL(value.viewerUrl);
    } catch {}
    if (
      !viewer ||
      viewer.protocol !== "http:" ||
      viewer.hostname !== "127.0.0.1" ||
      !viewer.port ||
      Number(viewer.port) < 1 ||
      viewer.username ||
      viewer.password ||
      viewer.pathname !== "/" ||
      viewer.search ||
      viewer.hash ||
      (viewer.href !== value.viewerUrl && viewer.origin !== value.viewerUrl)
    )
      fail("invalid_response");
  }
  if (value.status === "running" && !viewer) fail("invalid_response");
  return {
    viewerUrl: viewer?.href ?? null,
    status: value.status,
    reused: value.reused,
  };
}
function segment(value) {
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    fail("invalid_request");
  }
  if (!id(decoded) || encodeURIComponent(decoded) !== value)
    fail("invalid_request");
  return decoded;
}
function route(requestUrl, origin) {
  if (
    typeof requestUrl !== "string" ||
    !requestUrl.startsWith("/") ||
    requestUrl.startsWith("//") ||
    requestUrl.length > 16384 ||
    requestUrl.includes("#")
  )
    fail("invalid_request");
  const extended = knowledgeRoute(requestUrl, origin);
  if (extended) return extended;
  const pathname = requestUrl.split("?")[0];
  const query = new URL(requestUrl, origin).searchParams;
  let result;
  if (pathname === "/api/targets") result = { kind: "targets" };
  else {
    const match =
      /^\/api\/targets\/([^/]+)\/(runs|imports|index|launch)(?:\/([^/]+))?$/.exec(
        pathname,
      );
    if (
      !match ||
      (match[3] && !["runs", "imports"].includes(match[2])) ||
      (match[2] === "imports" && !match[3])
    )
      fail("not_found");
    result = {
      kind: match[3] ? (match[2] === "imports" ? "import" : "run") : match[2],
      targetId: segment(match[1]),
      ...(match[3] ? { runId: segment(match[3]) } : {}),
    };
  }
  const keys = [...query.keys()];
  if (result.kind !== "runs") {
    if (keys.length) fail("invalid_request");
    return result;
  }
  if (
    new Set(keys).size !== keys.length ||
    keys.some((key) => !["limit", "cursor"].includes(key))
  )
    fail("invalid_request");
  const rawLimit = query.get("limit");
  if (
    rawLimit !== null &&
    (!/^[1-9][0-9]{0,2}$/.test(rawLimit) || Number(rawLimit) > 100)
  )
    fail("invalid_request");
  const cursor = query.get("cursor");
  if (cursor !== null && !text(cursor, MAX_CURSOR)) fail("invalid_request");
  return {
    ...result,
    limit: rawLimit === null ? 20 : Number(rawLimit),
    cursor,
  };
}
async function body(req, requested) {
  const maximum = requested?.extended
    ? knowledgeBodyLimit(requested)
    : MAX_BODY;
  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
      req.headers["content-type"] ?? "",
    )
  ) {
    req.resume();
    fail("json_required");
  }
  if (Number(req.headers["content-length"]) > maximum) {
    req.resume();
    fail("request_too_large");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= maximum) chunks.push(chunk);
  }
  if (size > maximum) fail("request_too_large");
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail("invalid_request");
  }
  if (requested?.extended) return validateKnowledgeBody(value, requested);
  if (
    !object(value) ||
    Object.keys(value).join(",") !== "revision" ||
    !integer(value.revision, 1)
  )
    fail("invalid_request");
  return value;
}

/** Local Universal shell; the caller retains the catalog and all launched resources. */
export async function createUniversalServer({
  catalog,
  evidence,
  launch,
  host = "127.0.0.1",
  port = 0,
  containerOrigin,
} = {}) {
  let publicOrigin;
  if (containerOrigin !== undefined) {
    try {
      const parsed = new URL(containerOrigin);
      if (
        typeof containerOrigin !== "string" ||
        !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(containerOrigin) ||
        parsed.origin !== containerOrigin ||
        !parsed.port
      )
        throw Error("Noncanonical container origin");
      publicOrigin = parsed.origin;
    } catch {
      throw new TypeError(
        "Universal container origin must be an exact HTTP loopback origin with an explicit port.",
      );
    }
  }
  if (
    (publicOrigin ? host !== "0.0.0.0" || port === 0 : host !== "127.0.0.1") ||
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65535
  )
    throw new TypeError("Universal must bind a valid local loopback port.");
  for (const method of ["listTargets", "listRuns", "getRun", "indexTarget"])
    if (typeof catalog?.[method] !== "function")
      throw new TypeError(`Catalog must implement ${method}.`);
  if (typeof launch !== "function")
    throw new TypeError("Universal requires an explicit launcher.");
  const token = randomBytes(32).toString("hex"),
    authorization = Buffer.from(`Bearer ${token}`);
  const assets = {
    "/": ["index.html", "text/html; charset=utf-8"],
    "/app.mjs": ["app.mjs", "text/javascript; charset=utf-8"],
    "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  };
  function staticAsset(requestUrl) {
    const pathname = requestUrl?.split("?")[0];
    if (!Object.hasOwn(assets, pathname)) return null;
    if (requestUrl.length > 1024 || requestUrl.includes("#"))
      fail("invalid_request");
    const query = new URL(requestUrl, origin).searchParams;
    const keys = [...query.keys()];
    if (
      (pathname !== "/" && keys.length > 0) ||
      new Set(keys).size !== keys.length ||
      keys.some(
        (key) =>
          !["target", "run", "source"].includes(key) || !id(query.get(key)),
      ) ||
      (query.has("run") && !query.has("target")) ||
      (query.has("source") &&
        (query.get("source") !== "archive" ||
          !query.has("run") ||
          !query.has("target")))
    )
      fail("invalid_request");
    return assets[pathname];
  }
  const pending = new Set();
  let origin,
    busy = false,
    closing,
    stopped = false;
  const json = (res, status, value) => {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(value));
  };
  async function handle(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    );
    try {
      if (
        req.headers.host !== new URL(origin).host ||
        (req.headers.origin !== undefined && req.headers.origin !== origin) ||
        req.headers["sec-fetch-site"] === "cross-site"
      )
        fail("origin_required");
      const asset = req.method === "GET" ? staticAsset(req.url) : null;
      if (asset) {
        const [file, type] = asset;
        const bytes = await readFile(new URL(`./ui/${file}`, import.meta.url));
        res.writeHead(200, { "Content-Type": type });
        res.end(bytes);
        return;
      }
      if (!req.url?.startsWith("/api/")) fail("not_found");
      const supplied = Buffer.from(req.headers.authorization ?? "");
      if (
        supplied.length !== authorization.length ||
        !timingSafeEqual(supplied, authorization)
      )
        fail("authentication_required");
      if (stopped) fail("operation_busy");
      const requested = route(req.url, origin);
      if (req.method === "GET") {
        if (requested.extended) {
          const result = await readKnowledgeRoute(requested, {
            catalog,
            evidence,
          });
          if (result.binary) {
            res.setHeader(
              "Content-Security-Policy",
              "default-src 'none'; sandbox",
            );
            res.writeHead(200, {
              "Content-Type": result.mediaType,
              "Content-Disposition": `attachment; filename="${result.filename}"`,
            });
            res.end(result.binary);
          } else json(res, 200, result.json);
        } else if (requested.kind === "targets") {
          const values = await catalog.listTargets();
          if (!Array.isArray(values)) fail("invalid_response");
          json(res, 200, {
            targets: values.map(publicTarget),
            ...(publicOrigin ? { liveLaunch: false } : {}),
            ...(Number.isInteger(catalog.catalogVersion)
              ? { catalogVersion: catalog.catalogVersion }
              : {}),
          });
        } else if (requested.kind === "runs") {
          const { targetId, limit, cursor } = requested;
          json(
            res,
            200,
            publicRuns(
              await catalog.listRuns({ targetId, limit, cursor }),
              targetId,
              limit,
            ),
          );
        } else if (requested.kind === "import") {
          const { targetId, runId } = requested;
          json(
            res,
            200,
            publicImportedRun(
              await catalog.getImportedRun({ targetId, runId }),
              targetId,
              runId,
            ),
          );
        } else if (requested.kind === "run") {
          const { targetId, runId } = requested;
          json(
            res,
            200,
            publicRun(
              await catalog.getRun({ targetId, runId }),
              targetId,
              runId,
            ),
          );
        } else fail("not_found");
        return;
      }
      if (
        req.method !== "POST" ||
        (!requested.extended && !["index", "launch"].includes(requested.kind))
      )
        fail("not_found");
      if (req.headers.origin !== origin) fail("origin_required");
      if (publicOrigin && requested.kind === "launch")
        fail("container_runner_required");
      const input = await body(req, requested);
      if (busy || stopped) fail("operation_busy");
      busy = true;
      try {
        const values = await catalog.listTargets();
        if (!Array.isArray(values)) fail("invalid_response");
        const value = values.find((item) => item?.id === requested.targetId);
        if (!value) fail("target_not_found");
        const target = publicTarget(value);
        if (target.revision !== input.revision) fail("target_changed");
        if (stopped) fail("operation_busy");
        if (requested.extended)
          json(
            res,
            200,
            await writeKnowledgeRoute(requested, input, { catalog, evidence }),
          );
        else if (requested.kind === "index")
          json(res, 200, {
            ok: true,
            index: publicIndex(
              await catalog.indexTarget(target.id, {
                expectedRevision: input.revision,
              }),
              target.id,
            ),
          });
        else
          json(res, 200, {
            ok: true,
            live: publicLive(
              await launch(target.id, { revision: input.revision }),
            ),
          });
      } finally {
        busy = false;
      }
    } catch (error) {
      req.resume();
      const code = Object.hasOwn(errors, error?.code)
        ? error.code
        : "operation_failed";
      const [status, message] = errors[code];
      json(res, status, {
        ok: false,
        error: {
          code,
          message,
          ...(code === "evidence_uncommitted" && id(error.evidenceId)
            ? { evidenceId: error.evidenceId }
            : {}),
        },
      });
    }
  }
  const server = http.createServer((req, res) => {
    const work = handle(req, res).finally(() => pending.delete(work));
    pending.add(work);
    work.catch(() => {
      if (!res.destroyed) res.destroy();
    });
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  origin = publicOrigin ?? `http://${host}:${server.address().port}`;
  return {
    url: `${origin}/#token=${token}`,
    async quiesce() {
      // Retain the listener and process liveness until caller-owned cleanup
      // succeeds. Failed cleanup stays retryable while new API work is refused.
      stopped = true;
      await Promise.allSettled([...pending]);
    },
    close() {
      return (closing ??= (async () => {
        stopped = true;
        const done = new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        server.closeAllConnections();
        await done;
        await Promise.allSettled([...pending]);
      })());
    },
  };
}
