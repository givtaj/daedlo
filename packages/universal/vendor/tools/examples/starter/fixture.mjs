import http from "node:http";
import { readFile } from "node:fs/promises";

export async function createStarterFixture() {
  const html = await readFile(new URL("./index.html", import.meta.url));
  const records = new Map(),
    barriers = new Map();
  let writes = 0;
  const json = (res, status, value) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(value));
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/" || url.pathname === "/next") {
        res.writeHead(200, {
          "content-type": "text/html",
          "cache-control": "no-store",
        });
        res.end(html);
        return;
      }
      if (url.pathname === "/frame") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<!doctype html><title>Request accounting frame</title>Frame");
        return;
      }
      if (url.pathname === "/redirect") {
        res.writeHead(302, {
          location: "/hold/" + encodeURIComponent(url.searchParams.get("id")),
        });
        res.end();
        return;
      }
      if (url.pathname.startsWith("/hold/")) {
        const id = decodeURIComponent(url.pathname.slice("/hold/".length));
        const barrier = barriers.get(id);
        if (!barrier) {
          json(res, 404, { error: "Unknown test barrier" });
          return;
        }
        barrier.responses.add(res);
        barrier.arrivedResolve();
        res.on("close", () => {
          barrier.responses.delete(res);
          barrier.closedResolve();
        });
        await barrier.releasePromise;
        if (!res.destroyed) json(res, 200, { complete: true });
        return;
      }
      if (url.pathname === "/api/notes" && req.method === "GET") {
        const operation = url.searchParams.get("operation");
        json(res, 200, {
          items: [...records.values()].filter(
            (row) => !operation || row.operation === operation,
          ),
        });
        return;
      }
      if (url.pathname === "/api/notes" && req.method === "POST") {
        let body = "";
        for await (const part of req) {
          body += part;
          if (body.length > 4096) {
            json(res, 413, {});
            return;
          }
        }
        const input = JSON.parse(body);
        if (
          typeof input.text !== "string" ||
          !input.text.trim() ||
          input.text.length > 1000 ||
          !["plain", "work"].includes(input.category) ||
          typeof input.operation !== "string" ||
          !input.operation
        ) {
          json(res, 422, { error: "Invalid note" });
          return;
        }
        const previous = records.get(input.operation);
        if (
          previous &&
          (previous.text !== input.text || previous.category !== input.category)
        ) {
          json(res, 409, { error: "Operation payload changed" });
          return;
        }
        if (!previous) {
          records.set(input.operation, input);
          writes++;
        }
        json(res, previous ? 200 : 201, records.get(input.operation));
        return;
      }
      json(res, 404, { error: "Not found" });
    } catch {
      if (!res.headersSent) json(res, 400, { error: "Invalid request" });
      else res.destroy();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    get writes() {
      return writes;
    },
    barrier(id) {
      if (barriers.has(id))
        throw new Error("Barrier names are unique per fixture");
      let arrivedResolve, closedResolve, release;
      const arrived = new Promise((resolve) => {
        arrivedResolve = resolve;
      });
      const closed = new Promise((resolve) => {
        closedResolve = resolve;
      });
      const releasePromise = new Promise((resolve) => {
        release = resolve;
      });
      barriers.set(id, {
        arrivedResolve,
        closedResolve,
        releasePromise,
        release,
        responses: new Set(),
      });
      return { arrived, closed, release };
    },
    close: () => {
      for (const barrier of barriers.values()) barrier.release();
      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    },
  };
}
