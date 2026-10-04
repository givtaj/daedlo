import http from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const defaultLiveFile = resolve(
  directory,
  "../../artifacts/roots-experience/live.json",
);
const contentTypes = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};
const safeImage = (value) =>
  typeof value === "string" &&
  /^images\/[a-zA-Z0-9._-]+\.(png|jpe?g|webp)$/.test(value);
const unavailable = (reason) => ({
  available: false,
  status: "unavailable",
  reason,
});

/** Only local HTTP viewer roots may be probed. There is no proxy or command endpoint. */
function localViewerUrl(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "[::1]"].includes(url.hostname) ||
      !url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

function probeViewer(url) {
  return new Promise((resolveProbe) => {
    let timer;
    const finish = (value) => {
      clearTimeout(timer);
      resolveProbe(value);
    };
    const request = http.get(
      new URL("/status", url),
      { timeout: 1200, headers: { Accept: "application/json" } },
      (response) => {
        if (response.statusCode !== 200) {
          response.destroy();
          finish(null);
          return;
        }
        let bytes = 0;
        const chunks = [];
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 128 * 1024) {
            response.destroy();
            finish(null);
          } else chunks.push(chunk);
        });
        response.on("error", () => finish(null));
        response.on("end", () => {
          try {
            const state = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            finish(typeof state.connected === "boolean" ? state : null);
          } catch {
            finish(null);
          }
        });
      },
    );
    request.on("timeout", () => {
      request.destroy();
      finish(null);
    });
    request.on("error", () => finish(null));
    timer = setTimeout(() => {
      request.destroy();
      finish(null);
    }, 1200);
  });
}

export async function readLiveSession(liveFile = defaultLiveFile) {
  let metadata;
  try {
    if ((await stat(liveFile)).size > 16 * 1024)
      return unavailable("Live session metadata is invalid.");
    metadata = JSON.parse(await readFile(liveFile, "utf8"));
  } catch {
    return unavailable(
      "No live Roots session is registered. The archive remains available.",
    );
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    return unavailable("Live session metadata is invalid.");
  const url = localViewerUrl(metadata.viewerUrl);
  if (!url || metadata.status !== "ready")
    return unavailable("Live Roots is not ready.");
  const state = await probeViewer(url);
  if (!state?.connected)
    return unavailable(
      "The registered Roots session is offline. No replacement session was started.",
    );
  const driver = state.driver || {};
  const currentState =
    typeof driver.state?.root === "string"
      ? driver.state.root
      : typeof driver.root === "string"
        ? driver.root
        : typeof driver.state?.id === "string"
          ? driver.state.id
          : null;
  return {
    available: true,
    status: "ready",
    viewerUrl: url.href,
    label: "Roots original QA driver",
    applicationCommit:
      typeof metadata.applicationCommit === "string"
        ? metadata.applicationCommit
        : null,
    driverSourceCommit:
      typeof metadata.driverSourceCommit === "string"
        ? metadata.driverSourceCommit
        : null,
    createdAt:
      typeof metadata.createdAt === "string" ? metadata.createdAt : null,
    frames: Number.isSafeInteger(state.frames) ? state.frames : null,
    currentState,
    execution: typeof driver.execution === "string" ? driver.execution : null,
  };
}

export async function startServer({
  port = 0,
  archiveDir = resolve(directory, "archive"),
  liveFile = defaultLiveFile,
} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Invalid port");
  const assets = new Map(
    await Promise.all(
      [
        ["/", "index.html", "text/html; charset=utf-8"],
        ["/app.mjs", "app.mjs", "text/javascript; charset=utf-8"],
        ["/styles.css", "styles.css", "text/css; charset=utf-8"],
      ].map(async ([route, file, type]) => [
        route,
        { type, data: await readFile(resolve(directory, file)) },
      ]),
    ),
  );
  const json = (response, status, value) => {
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify(value));
  };
  let livePending,
    liveCached,
    liveExpires = 0;
  const live = async () => {
    if (Date.now() < liveExpires) return liveCached;
    livePending ??= readLiveSession(liveFile)
      .then((value) => {
        liveCached = value;
        liveExpires = Date.now() + 1500;
        return value;
      })
      .finally(() => {
        livePending = null;
      });
    return livePending;
  };
  const readManifest = async () => {
    const file = resolve(archiveDir, "manifest.json");
    if ((await stat(file)).size > 1024 * 1024)
      throw new Error("Archive manifest is too large");
    const manifest = JSON.parse(await readFile(file, "utf8"));
    if (!manifest || !Array.isArray(manifest.runs))
      throw new Error("Archive runs are missing");
    return manifest;
  };
  const server = http.createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'none'",
    );
    const host = request.headers.host;
    const boundPort = server.address()?.port;
    if (host !== `127.0.0.1:${boundPort}` && host !== `localhost:${boundPort}`)
      return json(response, 403, { error: "Use the local workbench address." });
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      return json(response, 405, {
        error: "This workbench only reads archive and live status.",
      });
    }
    try {
      const rawPath = decodeURIComponent(request.url.split("?")[0]);
      if (
        rawPath.split("/").includes("..") ||
        rawPath.includes("\\") ||
        rawPath.includes("\0")
      )
        return json(response, 404, { error: "Not found" });
      const path = new URL(request.url, `http://${host}`).pathname;
      if (assets.has(path)) {
        const asset = assets.get(path);
        response.writeHead(200, { "Content-Type": asset.type });
        response.end(asset.data);
        return;
      }
      if (path === "/api/live") return json(response, 200, await live());
      if (path === "/archive/manifest.json")
        return json(response, 200, await readManifest());
      if (path.startsWith("/archive/images/")) {
        const file = path.slice("/archive/".length);
        const manifest = await readManifest();
        const declared = manifest.runs
          .flatMap((run) => run.images || [])
          .some((item) => item.path === file);
        if (!safeImage(file) || !declared)
          return json(response, 404, { error: "Not found" });
        const base = await realpath(archiveDir),
          image = await realpath(resolve(base, file));
        if (!image.startsWith(base + sep))
          return json(response, 404, { error: "Not found" });
        const size = (await stat(image)).size;
        if (size > 20 * 1024 * 1024)
          return json(response, 413, { error: "Image too large" });
        response.writeHead(200, {
          "Content-Type": contentTypes[extname(image)],
        });
        response.end(await readFile(image));
        return;
      }
      json(response, 404, { error: "Not found" });
    } catch (error) {
      json(response, error?.code === "ENOENT" ? 404 : 503, {
        error: "The requested local evidence is unavailable.",
      });
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListen();
    });
  });
  let closing;
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      (closing ??= new Promise((resolveClose) => {
        server.close(resolveClose);
        server.closeAllConnections();
      })),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const server = await startServer();
  console.log(`Roots workbench: ${server.url}`);
  const stop = async () => {
    await server.close();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
