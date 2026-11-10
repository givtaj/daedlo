import http from "node:http";
import { pathToFileURL } from "node:url";

/** Probe readiness without dispatching a command or printing private status. */
export async function checkHealth({ port, publicOrigin }) {
  const publicUrl = new URL(publicOrigin);
  return new Promise((resolve) => {
    const request = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: "/status",
        headers: { Host: publicUrl.host },
        timeout: 3000,
      },
      (response) => {
        let bytes = 0;
        const chunks = [];
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 1024 * 1024) request.destroy();
          else chunks.push(chunk);
        });
        response.on("error", () => resolve(false));
        response.on("end", () => {
          try {
            const status = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            resolve(
              response.statusCode === 200 &&
                status.connected === true &&
                status.frames > 0 &&
                status.driver?.connected === true &&
                typeof status.driver?.descriptor?.id === "string",
            );
          } catch {
            resolve(false);
          }
        });
      },
    );
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(false));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.exitCode = (await checkHealth({
      port: Number(process.env.DAEDLO_PORT ?? 43100),
      publicOrigin:
        process.env.DAEDLO_PUBLIC_ORIGIN ?? "http://127.0.0.1:43100",
    }))
      ? 0
      : 1;
  } catch {
    process.exitCode = 1;
  }
}
