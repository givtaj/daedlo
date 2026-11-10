// Browser Driver adaptation of the Roots driver: generalized model, execution and viewer interfaces; later lifecycle and reporting changes. See THIRD_PARTY_NOTICES.md and licenses/Apache-2.0.txt at the package root.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const MAX_BODY_BYTES = 16 * 1024;
const BOUNDARY = "browser-driver-frame";
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'none'";
const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const validId = (value) =>
  typeof value === "string" && value.length > 0 && value.length <= 256;

// A close notice carries only the public result, never the session report or
// arbitrary fields supplied by a custom facade. Completed-run evidence is
// necessary: lastResult can exist while its finalization is still pending.
function completedResult(session) {
  try {
    const report = session.report?.();
    const runId = report?.lastResult?.runId;
    if (
      !validId(runId) ||
      report?.runId !== runId ||
      !Array.isArray(report?.completedRunIds) ||
      !report.completedRunIds.includes(runId)
    )
      return;
    const completed = session.report({ runId });
    const result = completed?.lastResult;
    if (
      completed?.runId !== runId ||
      result?.runId !== runId ||
      !["completed", "rejected", "failed", "stopped"].includes(
        result.execution,
      ) ||
      !Number.isFinite(Date.parse(result.finishedAt))
    )
      return;
    const fields = (value, keys) =>
      Object.fromEntries(
        keys
          .filter(
            (key) =>
              ["string", "number", "boolean"].includes(typeof value?.[key]) ||
              value?.[key] === null,
          )
          .map((key) => [key, value[key]]),
      );
    const safe = fields(result, [
      "ok",
      "execution",
      "runId",
      "command",
      "recipe",
      "startedAt",
      "finishedAt",
      "error_code",
      "error",
      "cleanupFailed",
    ]);
    if (result.outcome)
      safe.outcome = fields(result.outcome, ["kind", "label"]);
    if (result.effect) {
      safe.effect = fields(result.effect, ["status"]);
      if (Array.isArray(result.effect.operations))
        safe.effect.operations = result.effect.operations
          .slice(0, 16)
          .map((operation) => fields(operation, ["id", "label", "status"]));
    }
    for (const key of ["cleanupError", "interruptionError"])
      if (result[key]) safe[key] = fields(result[key], ["error_code", "error"]);
    if (result.presentation)
      safe.presentation = fields(result.presentation, [
        "id",
        "title",
        "status",
        "phase",
        "stage",
        "total",
        "stageId",
        "stageTitle",
        "explanation",
        "holdMs",
        "remainingMs",
        "manual",
        "reason",
      ]);
    return safe;
  } catch {
    // An unavailable report cannot prevent owned viewer cleanup or imply that a
    // still-finalizing run completed. The client retains its last known result.
  }
}

function frontendIdentity(value) {
  if (value === undefined) return null;
  const safeText = (text, limit) =>
    typeof text === "string" &&
    text.trim().length > 0 &&
    text.length <= limit &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(text);
  const invalid = () => {
    throw new TypeError("Invalid frontend identity metadata");
  };
  if (
    !isObject(value) ||
    Object.keys(value).some(
      (key) =>
        ![
          "name",
          "targetOrigin",
          "model",
          "evidenceLocation",
          "ownership",
        ].includes(key),
    ) ||
    !safeText(value.name, 120)
  )
    invalid();
  if (value.targetOrigin !== null) {
    let target;
    try {
      target = new URL(value.targetOrigin);
    } catch {
      invalid();
    }
    if (
      !["http:", "https:"].includes(target.protocol) ||
      target.origin !== value.targetOrigin ||
      target.username ||
      target.password
    )
      invalid();
  }
  if (
    !isObject(value.model) ||
    Object.keys(value.model).some((key) => !["id", "version"].includes(key)) ||
    !safeText(value.model.id, 256) ||
    !safeText(value.model.version, 256)
  )
    invalid();
  if (!safeText(value.evidenceLocation, 1024)) invalid();
  if (
    !isObject(value.ownership) ||
    Object.keys(value.ownership).some(
      (key) => !["browser", "context", "application"].includes(key),
    ) ||
    !["owned", "attached", "unknown"].includes(value.ownership.browser) ||
    !["owned", "attached", "unknown"].includes(value.ownership.context) ||
    !["owned", "attached", "unknown"].includes(value.ownership.application)
  )
    invalid();
  return structuredClone(value);
}

/** Mirror one existing controlled page. Closing the viewer never closes its session or browser. */
export async function createViewer({
  page,
  context,
  session,
  port = 0,
  frontend,
}) {
  const identity = frontendIdentity(frontend);
  if (!page || !context || !session)
    throw new TypeError("A page, context and driver session are required");
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new TypeError("Invalid viewer port");
  const assets = new Map(
    await Promise.all(
      [
        ["/", "index.html", "text/html; charset=utf-8"],
        ["/monitor.mjs", "monitor.mjs", "text/javascript; charset=utf-8"],
        [
          "/recipe-paths.mjs",
          "recipe-paths.mjs",
          "text/javascript; charset=utf-8",
        ],
        ["/styles.css", "styles.css", "text/css; charset=utf-8"],
      ].map(async ([path, file, type]) => [
        path,
        { type, body: await readFile(new URL(file, import.meta.url)) },
      ]),
    ),
  );
  const clients = new Set();
  const eventClients = new Set();
  const viewerId = randomUUID();
  let endedAt = null;
  let terminalEvent = null;
  const lifecycle = () => ({
    id: viewerId,
    status: endedAt ? "ended" : "open",
    ...(endedAt ? { endedAt } : {}),
  });
  let cdp,
    server,
    frame,
    heartbeat,
    url,
    disconnected = false,
    closed = false;
  let frames = 0,
    updatedAt = null,
    captureCleanup,
    closing,
    captureError,
    targetGone = false,
    screencastStopped = false,
    detached = false;

  const json = (res, code, data) => {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data));
  };
  const sendFrame = (res) => {
    if (
      !frame ||
      res.destroyed ||
      res.writableEnded ||
      res.writableLength > 1024 * 1024
    )
      return;
    res.write(
      Buffer.concat([
        Buffer.from(
          `--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`,
        ),
        frame,
        Buffer.from("\r\n"),
      ]),
    );
  };
  const receive = (event) => {
    if (closed || disconnected) return;
    frame = Buffer.from(event.data, "base64");
    frames++;
    updatedAt = new Date().toISOString();
    for (const res of clients) sendFrame(res);
    cdp
      .send("Page.screencastFrameAck", { sessionId: event.sessionId })
      .catch(disconnect);
  };
  const captureReleased = () =>
    !cdp || detached || targetGone || page.isClosed();
  function finishCapture() {
    page.off("close", targetDisconnected);
    cdp?.off("close", targetDisconnected);
    cdp?.off("Disconnected", targetDisconnected);
    captureError = null;
  }
  function cleanupCapture() {
    if (captureCleanup) return captureCleanup;
    captureCleanup = (async () => {
      clearInterval(heartbeat);
      cdp?.off("Page.screencastFrame", receive);
      for (const res of clients) res.end();
      clients.clear();
      if (!captureReleased() && !screencastStopped) {
        try {
          await cdp.send("Page.stopScreencast");
          screencastStopped = true;
        } catch {
          // Detaching can still dispose capture after a failed stop command.
        }
      }
      if (!captureReleased()) {
        try {
          await cdp.detach();
          detached = true;
        } catch {
          // A closed target is terminal; a live transport failure stays owned.
        }
      }
      if (captureReleased()) {
        finishCapture();
        return;
      }
      captureError = Object.assign(
        new AggregateError(
          [
            ...(!screencastStopped
              ? [Error("Screencast stop incomplete.")]
              : []),
            Error("Capture detach incomplete."),
          ],
          "Viewer capture cleanup incomplete; failed handles retained for retry.",
        ),
        { error_code: "cleanup_incomplete" },
      );
      throw captureError;
    })()
      .catch((error) => {
        // Target closure can arrive as the failed CDP operation settles.
        if (!captureReleased()) throw error;
        finishCapture();
      })
      .finally(() => {
        captureCleanup = null;
      });
    return captureCleanup;
  }
  function disconnect() {
    disconnected = true;
    // Event callbacks cannot return cleanup failures to a caller. Keep ownership
    // and expose the safe failure in status until an explicit close retries it.
    void cleanupCapture().catch(() => {});
  }
  function targetDisconnected() {
    targetGone = true;
    finishCapture();
    disconnect();
  }
  async function closeHttp() {
    if (server?.listening)
      await new Promise((resolve, reject) => {
        server.close((error) =>
          error ? reject(Error("Viewer HTTP cleanup incomplete.")) : resolve(),
        );
        server.closeAllConnections();
      });
  }
  async function endObservers() {
    if (!terminalEvent) {
      const lastResult = completedResult(session);
      terminalEvent = `event: viewer-ended\ndata: ${JSON.stringify({
        lifecycle: lifecycle(),
        ...(lastResult ? { lastResult } : {}),
      })}\n\n`;
    }
    await Promise.all(
      [...eventClients].map(
        (res) =>
          new Promise((resolve) => {
            if (res.destroyed || res.writableEnded) return resolve();
            const done = () => {
              clearTimeout(timer);
              res.off("close", done);
              res.off("error", done);
              resolve();
            };
            // Give connected readers a bounded chance to receive the terminal
            // notice before closeAllConnections; receipt is never inferred by UI.
            const timer = setTimeout(done, 250);
            res.once("close", done);
            res.once("error", done);
            try {
              res.end(terminalEvent, done);
            } catch {
              done();
            }
          }),
      ),
    );
    eventClients.clear();
  }
  async function close() {
    if (closing) return closing;
    closed = true;
    endedAt ??= new Date().toISOString();
    closing = (async () => {
      try {
        await endObservers();
      } catch {
        // A notification failure is a lost connection, not authority to skip
        // owned cleanup. Readers only claim closure after receiving the event.
      } finally {
        eventClients.clear();
      }
      // Always tear down HTTP, even when capture cleanup rejects.
      const results = await Promise.allSettled([cleanupCapture(), closeHttp()]);
      const errors = results
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason);
      if (errors.length)
        throw Object.assign(
          new AggregateError(
            errors,
            "Viewer cleanup incomplete; call close() to retry.",
          ),
          { error_code: "cleanup_incomplete" },
        );
    })().finally(() => {
      closing = null;
    });
    return closing;
  }
  function frontendStatus(driver) {
    if (!identity) return null;
    let currentOrigin = null;
    try {
      const actual = new URL(page.url());
      if (["http:", "https:"].includes(actual.protocol))
        currentOrigin = actual.origin;
    } catch {
      /* An unavailable target remains unknown. */
    }
    const model = driver.descriptor;
    return {
      ...structuredClone(identity),
      currentOrigin,
      matchesTarget:
        identity.targetOrigin === null
          ? null
          : currentOrigin === identity.targetOrigin,
      matchesModel:
        model?.id === identity.model.id &&
        model?.version === identity.model.version,
    };
  }
  async function status() {
    let driver;
    try {
      driver = await session.snapshot();
    } catch {
      driver = {
        connected: false,
        commands: [],
        recipes: [],
        error: "Driver observation unavailable",
      };
    }
    const frontend = frontendStatus(driver);
    const browser = !closed && !disconnected && !page.isClosed();
    const application =
      browser &&
      frontend?.matchesTarget !== false &&
      frontend?.matchesModel !== false &&
      driver.connected === true;
    return {
      frontend,
      lifecycle: lifecycle(),
      // This is observation availability, not an API health probe. A rebuild
      // may leave the controlled browser connected while observation fails.
      connections: { browser, application },
      connected: application,
      frames,
      updatedAt,
      viewers: clients.size,
      driver,
      ...(captureError
        ? {
            cleanupError: {
              error_code: "cleanup_incomplete",
              error:
                "Viewer capture cleanup is incomplete; close the viewer to retry.",
            },
          }
        : {}),
    };
  }
  async function readBody(req, res) {
    if (Number(req.headers["content-length"]) > MAX_BODY_BYTES) {
      json(res, 413, { ok: false, error: "Request exceeds 16 KiB" });
      req.resume();
      return;
    }
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        json(res, 413, { ok: false, error: "Request exceeds 16 KiB" });
        return;
      }
      chunks.push(chunk);
    }
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!isObject(body)) throw Error("Object required");
      return body;
    } catch {
      json(res, 400, { ok: false, error: "A valid JSON object is required" });
    }
  }
  try {
    cdp = await context.newCDPSession(page);
    page.on("close", targetDisconnected);
    cdp.on("close", targetDisconnected);
    cdp.on("Disconnected", targetDisconnected);
    cdp.on("Page.screencastFrame", receive);
    frame = await page.screenshot({ type: "jpeg", quality: 75, timeout: 5000 });
    updatedAt = new Date().toISOString();
    await cdp.send("Page.enable");
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 75,
      maxWidth: 1920,
      maxHeight: 1440,
      everyNthFrame: 1,
    });
    if (disconnected)
      throw Error("The browser disconnected while starting the viewer");
    server = http.createServer(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", CSP);
      res.setHeader("Referrer-Policy", "no-referrer");
      const actualPort = server.address()?.port;
      const host = req.headers.host;
      if (
        host !== `127.0.0.1:${actualPort}` &&
        host !== `localhost:${actualPort}`
      ) {
        json(res, 403, {
          ok: false,
          error: "This viewer requires its loopback host and port",
        });
        return;
      }
      try {
        const path = new URL(req.url, url).pathname;
        if (req.method === "GET" && assets.has(path)) {
          const asset = assets.get(path);
          res.writeHead(200, { "Content-Type": asset.type });
          res.end(asset.body);
        } else if (req.method === "GET" && path === "/status") {
          json(res, 200, await status());
        } else if (req.method === "GET" && path === "/events") {
          if (
            (req.headers.origin && req.headers.origin !== `http://${host}`) ||
            req.headers["sec-fetch-site"] === "cross-site"
          )
            return json(res, 403, {
              ok: false,
              error: "Same-origin requests are required",
            });
          res.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            Connection: "keep-alive",
          });
          res.flushHeaders();
          if (closed) return res.end(terminalEvent || ": viewer closed\n\n");
          eventClients.add(res);
          res.on("close", () => eventClients.delete(res));
          res.write(": viewer connected\n\n");
        } else if (req.method === "GET" && path === "/stream") {
          if (disconnected || closed)
            return json(res, 409, { ok: false, error: "Browser disconnected" });
          res.writeHead(200, {
            "Content-Type": `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
            Connection: "keep-alive",
          });
          res.flushHeaders();
          clients.add(res);
          sendFrame(res);
          res.on("close", () => clients.delete(res));
        } else if (
          req.method === "POST" &&
          ["/command", "/presentation", "/control"].includes(path)
        ) {
          if (
            (req.headers.origin && req.headers.origin !== `http://${host}`) ||
            req.headers["sec-fetch-site"] === "cross-site"
          ) {
            return json(res, 403, {
              ok: false,
              error: "Same-origin requests are required",
            });
          }
          if (
            !/^application\/json(?:\s*;|$)/i.test(
              req.headers["content-type"] || "",
            )
          ) {
            return json(res, 415, {
              ok: false,
              error: "application/json is required",
            });
          }
          const body = await readBody(req, res);
          if (!body) return;
          if (disconnected || closed || page.isClosed())
            return json(res, 409, { ok: false, error: "Browser disconnected" });
          if (
            path !== "/control" ||
            ["resume", "advance"].includes(body.action)
          ) {
            const current = frontendStatus(await session.snapshot());
            if (
              current?.matchesTarget === false ||
              current?.matchesModel === false
            )
              return json(res, 409, {
                ok: false,
                error_code: "frontend_mismatch",
                error:
                  "The observed target or model differs from this named frontend. Check its identity before running a command.",
              });
          }
          if (path === "/command") {
            if (
              !validId(body.id) ||
              !validId(body.revision) ||
              (body.params !== undefined && !isObject(body.params)) ||
              (body.recipe !== undefined && typeof body.recipe !== "boolean") ||
              Object.keys(body).some(
                (key) => !["id", "revision", "params", "recipe"].includes(key),
              )
            ) {
              return json(res, 400, {
                ok: false,
                error:
                  "Supply a command ID, observed revision, and optional parameter object or recipe flag",
              });
            }
            const result = await session.command(body);
            const rejected =
              result.execution === "rejected" ||
              (!result.execution && result.ok === false);
            json(res, rejected ? 409 : 200, result);
          } else if (path === "/presentation") {
            if (
              !validId(body.id) ||
              !validId(body.revision) ||
              Object.keys(body).some((key) => !["id", "revision"].includes(key))
            )
              return json(res, 400, {
                ok: false,
                error: "Supply a presentation ID and observed revision",
              });
            const result = await session.startPresentation(
              body.id,
              body.revision,
            );
            const rejected =
              result.execution === "rejected" ||
              (!result.execution && result.ok === false);
            json(res, rejected ? 409 : 200, result);
          } else {
            if (
              Object.keys(body).some(
                (key) => !["action", "value"].includes(key),
              )
            )
              return json(res, 400, {
                ok: false,
                error: "Unknown control field",
              });
            if (
              body.action === "speed" &&
              ["slow", "normal", "fast"].includes(body.value)
            )
              await session.setSpeed(body.value);
            else if (body.action === "advance" && validId(body.value)) {
              const result = await session.advancePresentation(body.value);
              if (!result.ok) return json(res, 409, result);
            } else if (
              ["pause", "resume", "stop"].includes(body.action) &&
              body.value === undefined
            )
              await session[body.action]();
            else
              return json(res, 400, {
                ok: false,
                error: "Unknown control or speed",
              });
            json(res, 200, { ok: true, ...(await status()) });
          }
        } else json(res, 404, { ok: false, error: "Unknown endpoint" });
      } catch {
        if (!res.headersSent)
          json(res, 503, {
            ok: false,
            error:
              "Driver unavailable; refresh its observed state before trying again",
          });
        else res.end();
      }
    });
    server.requestTimeout = 5000;
    server.headersTimeout = 5000;
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    if (disconnected || page.isClosed())
      throw Error("The browser disconnected while starting the viewer");
    url = `http://127.0.0.1:${server.address().port}`;
    heartbeat = setInterval(() => {
      for (const res of clients) sendFrame(res);
    }, 1000);
    heartbeat.unref();
    return { url, close };
  } catch (error) {
    try {
      await close();
    } catch (cleanup) {
      // There is no returned viewer on failed startup. Retain explicit retry
      // authority without copying private browser error messages or causes.
      throw Object.assign(
        new AggregateError(
          [Error("Viewer startup failed."), cleanup],
          "Viewer startup failed; cleanup incomplete. Call error.close() to retry.",
        ),
        { error_code: "cleanup_incomplete", close },
      );
    }
    throw error;
  }
}
