// Launch the snapshot's original maintained entry point, signed out by default.
import fs from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";

const output = resolve(
  process.env.ROOTS_EXPERIENCE_ARTIFACTS ?? "artifacts/roots-experience",
);
const source = JSON.parse(fs.readFileSync(join(output, "source.json"), "utf8"));
if (Number(process.versions.node.split(".")[0]) < 24)
  throw Error("The original Roots launcher requires Node 24 or later.");
if (source.buildStatus !== "built")
  throw Error("Prepare and build the exact Roots snapshot first.");
for (const [name, expected] of Object.entries(source.binaries)) {
  const actual = createHash("sha256")
    .update(fs.readFileSync(join(source.snapshot, "target/debug", name)))
    .digest("hex");
  if (actual !== expected)
    throw Error("Frozen Roots binary identity changed: " + name);
}
const livePath = join(output, "live.json");
let live = {
  status: "starting",
  applicationCommit: source.applicationCommit,
  driverSourceCommit: source.driverSourceCommit,
  hostPid: process.pid,
  createdAt: new Date().toISOString(),
  label:
    "Roots original QA driver — committed snapshot " +
    source.driverSourceCommit.slice(0, 8),
};
fs.writeFileSync(livePath, JSON.stringify(live, null, 2));
const child = spawn(process.execPath, ["QA/start-live-driver.mjs"], {
  cwd: source.snapshot,
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});
live.launcherPid = child.pid;
fs.writeFileSync(livePath, JSON.stringify(live, null, 2));
const outputLines = createInterface({ input: child.stdout });
const errorLines = createInterface({ input: child.stderr });
let stopping = false;
const stop = () => {
  if (!stopping) {
    stopping = true;
    live.status = "stopping";
    fs.writeFileSync(livePath, JSON.stringify(live, null, 2));
    child.kill("SIGTERM");
  }
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
outputLines.on("line", (line) => {
  fs.appendFileSync(join(output, "launcher.log"), line + "\n");
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    return;
  }
  if (value.viewerUrl && value.fixtureRoot) {
    const manifest = JSON.parse(
      fs.readFileSync(join(value.fixtureRoot, "driver-manifest.json"), "utf8"),
    );
    if (manifest.sourceCommit !== source.applicationCommit) {
      stop();
      process.exitCode = 1;
      return;
    }
    live = {
      ...live,
      status: "ready",
      viewerUrl: value.viewerUrl,
      fixtureRoot: value.fixtureRoot,
      launcherPid: child.pid,
      processIdentity: {
        host: process.execPath,
        entry: "examples/roots/launch-live.mjs",
        launcher: "QA/start-live-driver.mjs",
        snapshot: source.snapshot,
      },
      readyAt: new Date().toISOString(),
    };
    fs.writeFileSync(livePath, JSON.stringify(live, null, 2));
    process.stdout.write(JSON.stringify(live) + "\n");
  }
});
errorLines.on("line", (line) => {
  fs.appendFileSync(join(output, "launcher.log"), line + "\n");
  process.stderr.write(line + "\n");
});
child.on("error", (error) => {
  live.status = "failed";
  fs.writeFileSync(livePath, JSON.stringify(live, null, 2));
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
await new Promise((resolve) =>
  child.once("exit", (code, signal) => {
    live = {
      ...live,
      status: code === 0 ? "stopped" : "failed",
      stoppedAt: new Date().toISOString(),
      exitCode: code,
      signal,
    };
    fs.writeFileSync(livePath, JSON.stringify(live, null, 2));
    process.exitCode = code ?? (stopping ? 0 : 1);
    resolve();
  }),
);
process.removeListener("SIGINT", stop);
process.removeListener("SIGTERM", stop);
