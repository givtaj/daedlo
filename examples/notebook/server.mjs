import http from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export async function createNotebookServer({ port = 0 } = {}) {
  const html = await readFile(new URL("./index.html", import.meta.url));
  const records = new Map();
  let writes = 0;
  const send = (r, status, value) => {
    r.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    r.end(JSON.stringify(value));
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const session =
        /notebook_session=(alpha|beta)/.exec(req.headers.cookie ?? "")?.[1] ??
        "alpha";
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, {
          "Content-Type": "text/html",
          "Cache-Control": "no-store",
          "Set-Cookie": `notebook_session=${session}; Path=/; SameSite=Strict; HttpOnly`,
        });
        res.end(html);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/session") {
        send(res, 200, { session });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/session") {
        const next = session === "alpha" ? "beta" : "alpha";
        res.setHeader(
          "Set-Cookie",
          `notebook_session=${next}; Path=/; SameSite=Strict; HttpOnly`,
        );
        send(res, 200, { session: next });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/notes") {
        send(res, 200, {
          items: [...records.values()].filter(
            (r) =>
              r.session === session &&
              (!url.searchParams.has("operationId") ||
                r.operationId === url.searchParams.get("operationId")),
          ),
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/notes") {
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 16384) {
            send(res, 413, { error: "Too large" });
            return;
          }
        }
        const value = JSON.parse(body);
        if (
          typeof value.text !== "string" ||
          !value.text.trim() ||
          value.text.length > 4000 ||
          typeof value.operationId !== "string" ||
          !value.operationId
        ) {
          send(res, 422, { error: "Please write a note." });
          return;
        }
        const key = session + ":" + value.operationId,
          existing = records.get(key);
        if (existing && existing.text !== value.text) {
          send(res, 409, { error: "Operation changed" });
          return;
        }
        if (existing) {
          send(res, 200, existing);
          return;
        }
        const row = {
          id: randomUUID(),
          session,
          operationId: value.operationId,
          text: value.text,
          urgent: value.urgent,
          category: value.category,
          priority: value.priority,
        };
        records.set(key, row);
        writes++;
        send(res, 201, row);
        return;
      }
      send(res, 404, { error: "Not found" });
    } catch {
      send(res, 400, { error: "Invalid request" });
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    get writes() {
      return writes;
    },
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
