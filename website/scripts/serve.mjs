import { createServer } from "node:http";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTROL_FILES, PUBLIC_FILES } from "./manifest.mjs";
import {
  DEFAULT_WEBSITE_ROOT,
  VERSION_PATTERN,
  readRegularFile,
  requireDirectory,
  verifyReleaseDirectory,
} from "./stage-release.mjs";

const root = join(DEFAULT_WEBSITE_ROOT, "public");
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".zip": "application/zip",
  ".json": "application/json; charset=utf-8",
};
export async function readPreviewResponse(
  requestUrl,
  { publicRoot = root } = {},
) {
  try {
    await requireDirectory(publicRoot);
    const pathname = decodeURIComponent(
      new URL(requestUrl, "http://127.0.0.1").pathname,
    );
    const relative = pathname === "/" ? "index.html" : pathname.slice(1);
    let body;
    if (PUBLIC_FILES.has(relative) && !CONTROL_FILES.has(relative)) {
      body = await readRegularFile(join(publicRoot, relative));
    } else {
      const parts = relative.split("/");
      if (
        parts.length !== 3 ||
        parts[0] !== "downloads" ||
        !VERSION_PATTERN.test(parts[1])
      )
        throw new Error("Unknown public path");
      await requireDirectory(join(publicRoot, "downloads"));
      const release = await verifyReleaseDirectory({
        releaseDirectory: join(publicRoot, "downloads", parts[1]),
        expectedVersion: parts[1],
      });
      const file = release.files.find(
        (candidate) => candidate.file === parts[2],
      );
      if (!file) throw new Error("Unknown download path");
      body = file.content;
    }
    const headers = {
      "Content-Type":
        basename(relative) === "SHA256SUMS"
          ? "text/plain; charset=utf-8"
          : types[extname(relative)] || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    };
    if (extname(relative) === ".zip")
      headers["Content-Disposition"] =
        `attachment; filename="${basename(relative)}"`;
    return { status: 200, headers, body };
  } catch {
    return {
      status: 404,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
      body: await readRegularFile(join(publicRoot, "404.html")).catch(() =>
        Buffer.from("Not found"),
      ),
    };
  }
}
export function createPreviewServer(options = {}) {
  return createServer(async (request, response) => {
    const result = await readPreviewResponse(request.url, options);
    response.writeHead(result.status, result.headers);
    response.end(result.body);
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const server = createPreviewServer();
  server.listen(Number(process.env.DAEDLO_PREVIEW_PORT || 0), "127.0.0.1", () =>
    console.log(
      `Daedlo website preview: http://127.0.0.1:${server.address().port}`,
    ),
  );
}
