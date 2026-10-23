import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";

const MAX_BODY = 4096;
const phases = new Set([
  "idle",
  "checking",
  "available",
  "preparing",
  "validating",
  "ready",
  "activating",
  "updated",
  "failed",
  "rolled_back",
  "recovered",
  "recovery_required",
]);
const activePhases = new Set([
  "checking",
  "preparing",
  "validating",
  "activating",
  "recovery_required",
]);
const messages = {
  busy: "An active run must finish before this update can restart Daedlo.",
  operation_busy: "Another update operation is still running.",
  draft_unpreserved:
    "A draft or session cannot be preserved. Finish or preserve it before restarting.",
  dirty_draft:
    "A draft or session cannot be preserved. Finish or preserve it before restarting.",
  unsafe_restart: "The project is not at a safe restart boundary.",
  source_changed:
    "Project inputs changed. Prepare and validate the update again.",
  stale_source:
    "Project inputs changed. Prepare and validate the update again.",
  stale_generation:
    "This view changed. Review the current status before trying again.",
  validation_failed:
    "The candidate did not pass project validation. Review the local verification record.",
  migration_required:
    "This project needs a reviewed migration before it can use the candidate.",
  compatibility_failed: "The candidate is incompatible with this project.",
  cleanup_incomplete:
    "Owned cleanup is incomplete. Recovery is required before restarting.",
  recovery_required:
    "The manager requires recovery. Review its local record before continuing.",
  check_failed:
    "Release discovery is unavailable. This does not establish that your version is up to date.",
  operation_failed:
    "The update action failed. Review the current selection and local manager record.",
  status_unavailable:
    "Manager status is unavailable. The selected and running versions cannot be confirmed.",
  action_unavailable:
    "This action is unavailable in the current project state.",
};
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const id = (value) =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)
    ? value
    : null;
const label = (value, fallback) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 200 &&
  !/[\x00-\x1f\x7f-\x9f]/.test(value)
    ? value
    : fallback;
function safeError(error, fallback = "operation_failed") {
  const raw = error?.code ?? error?.error_code;
  const code = Object.hasOwn(messages, raw) ? raw : fallback;
  return { code, message: messages[code] };
}
function installation(value) {
  if (!object(value) || !id(value.id) || typeof value.version !== "string")
    return null;
  return {
    id: value.id,
    version: label(value.version, "Unknown version"),
    ...(typeof value.sourceSha256 === "string" &&
    /^[a-f0-9]{64}$/.test(value.sourceSha256)
      ? { sourceSha256: value.sourceSha256 }
      : {}),
    ...(value.historicalSnapshot === true ? { historicalSnapshot: true } : {}),
  };
}
function publicStatus(value) {
  const known =
    object(value) && phases.has(value.phase) && id(value.project?.id);
  return {
    project: {
      id: id(value?.project?.id),
      label: label(value?.project?.label, "Registered project"),
    },
    selected: installation(value?.selected),
    running: installation(value?.running),
    phase: known ? value.phase : "recovery_required",
    available:
      object(value?.available) && id(value.available.id)
        ? {
            id: value.available.id,
            version: label(value.available.version, "Unknown version"),
          }
        : null,
    operation:
      object(value?.operation) && id(value.operation.id)
        ? {
            id: value.operation.id,
            status: label(value.operation.status, "unknown"),
          }
        : null,
    canRollback: known && value.canRollback === true,
    blockers: Array.isArray(value?.blockers)
      ? value.blockers.slice(0, 16).map((item) => safeError(item))
      : [],
    ...(!known
      ? { error: safeError({ code: "recovery_required" }) }
      : value.error
        ? { error: safeError(value.error) }
        : {}),
  };
}

/** Stable local update control. The caller retains ownership of the manager. */
export async function createNinjaServer({
  manager,
  host = "127.0.0.1",
  port = 0,
} = {}) {
  if (host !== "127.0.0.1")
    throw new TypeError("Ninja control must bind 127.0.0.1");
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new TypeError("Invalid Ninja control port");
  for (const method of ["status", "check", "prepare", "activate", "rollback"]) {
    if (typeof manager?.[method] !== "function")
      throw new TypeError(`Manager must implement ${method}`);
  }
  const html = await readFile(
    new URL("ninja-ui.html", import.meta.url),
    "utf8",
  );
  const token = randomBytes(32).toString("hex");
  const authorization = Buffer.from(`Bearer ${token}`);
  let generation = randomBytes(16).toString("hex"),
    fingerprint,
    busy = false,
    closing,
    origin;
  const rotate = () => {
    generation = randomBytes(16).toString("hex");
  };
  async function snapshot() {
    let status;
    try {
      status = publicStatus(await manager.status());
    } catch {
      status = {
        project: { id: null, label: "Registered project" },
        selected: null,
        running: null,
        phase: "recovery_required",
        available: null,
        operation: null,
        canRollback: false,
        blockers: [],
        error: safeError({ code: "status_unavailable" }),
      };
    }
    const next = JSON.stringify(status);
    if (fingerprint !== next) {
      fingerprint = next;
      rotate();
    }
    const permitted = !busy && !activePhases.has(status.phase);
    return {
      ok: true,
      generation,
      busy,
      status,
      actions: {
        check: permitted,
        install:
          permitted &&
          Boolean(status.available) &&
          status.operation?.status !== "ready",
        restart:
          permitted &&
          status.phase === "ready" &&
          status.operation?.status === "ready" &&
          status.blockers.length === 0,
        revert: permitted && status.canRollback && status.blockers.length === 0,
      },
    };
  }
  const json = (res, code, data) => {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data));
  };
  async function body(req, res) {
    if (
      !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
        req.headers["content-type"] ?? "",
      )
    ) {
      json(res, 415, { ok: false, error: "JSON content type required" });
      req.resume();
      return;
    }
    if (Number(req.headers["content-length"]) > MAX_BODY) {
      json(res, 413, { ok: false, error: "Request exceeds 4 KiB" });
      req.resume();
      return;
    }
    let size = 0;
    const chunks = [];
    // Keep draining an oversized stream without retaining its bytes.
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) {
        json(res, 413, { ok: false, error: "Request exceeds 4 KiB" });
        continue;
      }
      chunks.push(chunk);
    }
    if (size > MAX_BODY) return;
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!object(parsed)) throw Error();
      return parsed;
    } catch {
      json(res, 400, { ok: false, error: "A valid JSON object is required" });
    }
  }
  const server = http.createServer(async (req, res) => {
    const nonce = randomBytes(18).toString("base64");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
    );
    if (
      req.headers.host !== new URL(origin).host ||
      (req.headers.origin !== undefined && req.headers.origin !== origin) ||
      req.headers["sec-fetch-site"] === "cross-site"
    ) {
      json(res, 403, { ok: false, error: "Local Host and Origin required" });
      req.resume();
      return;
    }
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html.replaceAll("{{NONCE}}", nonce));
      return;
    }
    if (
      !(
        (req.method === "GET" && req.url === "/status") ||
        (req.method === "POST" && req.url === "/action")
      )
    ) {
      json(res, 404, { ok: false, error: "Unknown route" });
      req.resume();
      return;
    }
    const supplied = Buffer.from(req.headers.authorization ?? "");
    if (
      supplied.length !== authorization.length ||
      !timingSafeEqual(supplied, authorization)
    ) {
      json(res, 401, {
        ok: false,
        error: "Open the local control link supplied by the manager",
      });
      req.resume();
      return;
    }
    if (req.method === "GET") {
      json(res, 200, await snapshot());
      return;
    }
    if (req.headers.origin !== origin) {
      json(res, 403, { ok: false, error: "An exact local Origin is required" });
      req.resume();
      return;
    }
    try {
      const input = await body(req, res);
      if (!input) return;
      const restart = ["restart", "revert"].includes(input.action);
      const keys = [
        "action",
        "generation",
        ...(restart ? ["acknowledgeRestart"] : []),
      ]
        .sort()
        .join(",");
      if (
        !["check", "install", "restart", "revert"].includes(input.action) ||
        Object.keys(input).sort().join(",") !== keys ||
        !/^[a-f0-9]{32}$/.test(input.generation) ||
        (restart && input.acknowledgeRestart !== true)
      ) {
        json(res, 400, { ok: false, error: "Invalid update action" });
        return;
      }
      if (busy) {
        json(res, 409, {
          ...(await snapshot()),
          ok: false,
          requestError: safeError({ code: "operation_busy" }),
        });
        return;
      }
      // Own the mutation gate before awaiting manager state, so two tabs cannot race.
      busy = true;
      let failure;
      try {
        const current = await snapshot();
        if (input.generation !== current.generation)
          throw Object.assign(Error(), { code: "stale_generation" });
        // snapshot actions include the server gate; evaluate the manager state separately.
        const s = current.status;
        const allowed =
          !activePhases.has(s.phase) &&
          (input.action === "check" ||
            (input.action === "install" &&
              s.available &&
              s.operation?.status !== "ready") ||
            (input.action === "restart" &&
              s.phase === "ready" &&
              s.operation?.status === "ready" &&
              s.blockers.length === 0) ||
            (input.action === "revert" &&
              s.canRollback &&
              s.blockers.length === 0));
        if (!allowed)
          throw Object.assign(Error(), { code: "action_unavailable" });
        rotate();
        let result;
        if (input.action === "check") result = await manager.check();
        else if (input.action === "install")
          result = await manager.prepare(s.available.id);
        else if (input.action === "restart")
          result = await manager.activate(s.operation.id, {
            acknowledgeRestart: true,
          });
        else result = await manager.rollback({ acknowledgeRestart: true });
        if (result?.ok === false) throw result.error ?? result;
      } catch (error) {
        failure = safeError(
          error,
          input.action === "check" ? "check_failed" : "operation_failed",
        );
      } finally {
        busy = false;
        rotate();
      }
      json(res, failure ? 409 : 200, {
        ...(await snapshot()),
        ...(failure ? { ok: false, requestError: failure } : {}),
      });
    } catch {
      json(res, 400, { ok: false, error: "Request could not be read" });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  origin = `http://${host}:${server.address().port}`;
  return {
    url: `${origin}/#token=${token}`,
    close() {
      return (closing ??= new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }));
    },
  };
}
