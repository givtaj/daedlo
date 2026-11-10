// Independent conformance fixture only; no customer application lifecycle.
import http from "node:http";
import { createNotebookServer } from "../../examples/notebook/server.mjs";

const notebook = await createNotebookServer();
const upstream = new URL(notebook.url);
const server = http.createServer((request, response) => {
  const forwarded = http.request(
    {
      hostname: upstream.hostname,
      port: upstream.port,
      path: request.url,
      method: request.method,
      headers: { ...request.headers, host: upstream.host },
    },
    (result) => {
      response.writeHead(result.statusCode, result.headers);
      result.pipe(response);
    },
  );
  forwarded.on("error", () => {
    if (!response.headersSent) response.writeHead(502);
    response.end();
  });
  request.on("aborted", () => forwarded.destroy());
  response.on("close", () => forwarded.destroy());
  request.pipe(forwarded);
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(8080, "0.0.0.0", resolve);
});
console.log("Independent notebook conformance app listening on port 8080");
let closing;
const close = () =>
  (closing ??= (async () => {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
    await notebook.close();
  })());
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void close().catch(() => {
      process.exitCode = 1;
    });
  });
}
