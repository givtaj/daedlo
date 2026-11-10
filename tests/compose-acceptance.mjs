// Independent Compose conformance, not acceptance of a customer's application.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import http from "node:http";
import {
  mkdir,
  readFile,
  readdir,
  open,
  rename,
  access,
} from "node:fs/promises";
import { openSync, writeSync, fsyncSync, closeSync, constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  assertComposeDiskSpace,
  assertFreshComposeImages,
  captureComposeImages,
  removeComposeImages,
} from "../scripts/compose-ci-safety.mjs";
import { finalizeComposeRun } from "../scripts/compose-ci-lifecycle.mjs";

const output = resolve(
  process.env.DAEDLO_COMPOSE_OUTPUT ?? `artifacts/compose-${Date.now()}`,
);
await mkdir(output, { recursive: true });
if ((await readdir(output)).length !== 0)
  throw Error(
    `Compose evidence directory must be empty; existing evidence retained: ${output}`,
  );
const logFd = openSync(resolve(output, "compose.log"), "wx", 0o600);
const project = `daedlo-conformance-${process.pid}-${Date.now()}-${randomUUID()}`;
const results = [];
async function unusedPort() {
  const server = createServer();
  await new Promise((done, fail) =>
    server.once("error", fail).listen(0, "127.0.0.1", done),
  );
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}
const environment = { ...process.env };
let viewerUrl, appUrl;
let browser,
  chromium,
  owned = false,
  passed = false,
  finalizing = false,
  activeChild,
  interrupted,
  logFailure,
  disk,
  images = [];
const interruption = new AbortController();
function signalRun(signal) {
  interrupted ??= signal;
  process.exitCode = signal === "SIGINT" ? 130 : 143;
  interruption.abort(Error(`Compose run interrupted by ${signal}`));
  activeChild?.kill("SIGTERM");
  const child = activeChild;
  if (child) {
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    timer.unref();
    child.once("close", () => clearTimeout(timer));
  }
}
const onSigint = () => signalRun("SIGINT");
const onSigterm = () => signalRun("SIGTERM");
process.on("SIGINT", onSigint);
process.on("SIGTERM", onSigterm);

// Stream raw output to disk. Only commands whose result is parsed retain a
// bounded stdout buffer; build output is never accumulated in RAM.
function docker(command, args, { capture = false } = {}) {
  if (command !== "docker") throw Error("Unexpected Compose command");
  if (interrupted && !finalizing)
    throw Error(`Compose run interrupted by ${interrupted}`);
  return new Promise((done, fail) => {
    const child = spawn(command, args, {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeChild = child;
    let stdout = "",
      capturedBytes = 0,
      failure,
      killTimer;
    const abort = (error) => {
      failure ??= error;
      child.kill("SIGTERM");
      killTimer ??= setTimeout(() => child.kill("SIGKILL"), 5000);
      killTimer.unref();
    };
    const timeoutMs = args.includes("--build")
      ? 20 * 60 * 1000
      : args[0] === "compose"
        ? 120000
        : 15000;
    const timeout = setTimeout(
      () => abort(Error(`Docker ${args[0]} timed out`)),
      timeoutMs,
    );
    const drains = new Map();
    const log = (bytes, source, destination) => {
      try {
        if (logFailure) throw logFailure;
        let offset = 0;
        while (offset < bytes.length) {
          const written = writeSync(logFd, bytes, offset);
          if (written === 0) throw Error("Compose log write made no progress");
          offset += written;
        }
        if (!destination.write(bytes)) {
          source.pause();
          const resume = () => {
            drains.delete(destination);
            source.resume();
          };
          destination.once("drain", resume);
          drains.set(destination, resume);
        }
      } catch (error) {
        logFailure ??= error;
        abort(error);
      }
    };
    child.stdout.on("data", (bytes) => {
      log(bytes, child.stdout, process.stdout);
      if (capture) {
        capturedBytes += bytes.length;
        if (capturedBytes > 4 * 1024 * 1024)
          abort(Error("Compose command output exceeded the capture limit"));
        else stdout += bytes.toString();
      }
    });
    child.stderr.on("data", (bytes) =>
      log(bytes, child.stderr, process.stderr),
    );
    child.once("error", (error) => {
      failure ??= error;
    });
    child.once("close", (code) => {
      clearTimeout(killTimer);
      clearTimeout(timeout);
      for (const [destination, resume] of drains)
        destination.off("drain", resume);
      if (activeChild === child) activeChild = undefined;
      if (failure) fail(failure);
      else if (code !== 0) fail(Error(`Docker ${args[0]} exited ${code}`));
      else if (interrupted && !finalizing)
        fail(Error(`Compose run interrupted by ${interrupted}`));
      else done(stdout);
    });
  });
}
function compose(...args) {
  return docker(
    "docker",
    [
      "compose",
      "-p",
      project,
      "-f",
      "container/compose.notebook.yaml",
      ...args,
    ],
    { capture: ["ps", "run"].includes(args[0]) },
  );
}
async function persist({ phase, imageCleanup } = {}) {
  if (logFailure) throw logFailure;
  fsyncSync(logFd);
  const receipt = {
    project,
    viewerUrl,
    appUrl,
    phase,
    interrupted: interrupted ?? null,
    disk,
    images,
    imageCleanup,
    results,
    resourcesToInspect:
      !owned || phase === "complete"
        ? null
        : {
            imageTags: ["daedlo", "notebook-app"].map(
              (service) => `${project}-${service}:latest`,
            ),
            ...(phase === "images-retained"
              ? {}
              : { project, evidenceVolume: `${project}_evidence` }),
          },
  };
  const temporary = resolve(output, "results.json.tmp");
  const file = await open(temporary, "w", 0o600);
  try {
    await file.writeFile(JSON.stringify(receipt, null, 2) + "\n");
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, resolve(output, "results.json"));
}
async function check(name, fn) {
  try {
    if (interrupted) throw Error(`Compose run interrupted by ${interrupted}`);
    await fn();
    if (interrupted) throw Error(`Compose run interrupted by ${interrupted}`);
    results.push({ name, status: "PASS" });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: "FAIL", error: error.message });
    throw error;
  }
}
async function json(url, options) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.any([AbortSignal.timeout(15000), interruption.signal]),
  });
  assert.equal(response.status, 200);
  return response.json();
}
const notes = () => json(`${appUrl}/api/notes`);
const status = () => json(`${viewerUrl}/status`);
async function command(id, params = {}) {
  const before = await status();
  return json(`${viewerUrl}/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: viewerUrl },
    body: JSON.stringify({ id, params, revision: before.driver.revision }),
  });
}

try {
  await persist({ phase: "preflight" });
  try {
    disk = await assertComposeDiskSpace({ output, run: docker });
    results.push({ name: "Compose build disk space verified", status: "PASS" });
  } catch (error) {
    disk = error.diskReceipt ?? disk;
    results.push({
      name: "Compose build disk space verified",
      status: "BLOCKED",
      error: error.message,
    });
    throw error;
  }
  await assertFreshComposeImages({ project, run: docker });
  ({ chromium } = await import("playwright"));
  await access(chromium.executablePath(), constants.X_OK);
  const viewerPort = await unusedPort();
  let appPort = await unusedPort();
  while (appPort === viewerPort) appPort = await unusedPort();
  environment.DAEDLO_VIEWER_PORT = String(viewerPort);
  environment.DAEDLO_APP_PORT = String(appPort);
  viewerUrl = `http://127.0.0.1:${viewerPort}`;
  appUrl = `http://127.0.0.1:${appPort}`;
  if (interrupted) throw Error(`Compose run interrupted by ${interrupted}`);
  owned = true;
  try {
    await persist({ phase: "building" });
    await compose("up", "--build", "-d", "--wait", "--wait-timeout", "120");
    images = await captureComposeImages({ project, run: docker });
    await persist({ phase: "running" });
    results.push({ name: "image build and Compose readiness", status: "PASS" });
  } catch (error) {
    results.push({
      name: "image build and Compose readiness",
      status: "BLOCKED",
      error: error.message,
    });
    throw error;
  }
  await check(
    "customer integration path resolves the bundled runtime as non-root",
    async () => {
      const inspected = await compose(
        "run",
        "--rm",
        "--no-deps",
        "--workdir",
        "/opt/daedlo/project",
        "--entrypoint",
        "node",
        "daedlo",
        "--input-type=module",
        "-e",
        'import {createDriverSession} from "@daedlo/runtime"; if(typeof createDriverSession!=="function"||process.getuid()===0)process.exit(1);console.log("customer-module-resolution-pass");',
      );
      assert.match(inspected, /customer-module-resolution-pass/);
    },
  );
  await check(
    "container browser reaches separate app service without startup writes",
    async () => {
      const snapshot = await status();
      assert.equal(snapshot.connected, true);
      assert.equal(snapshot.driver.descriptor.id, "notebook");
      assert.deepEqual((await notes()).items, []);
    },
  );
  await check(
    "published-port Host and Origin boundaries reject foreign requests",
    async () => {
      // Fetch normalizes Host in this Node version. Send the actual forged
      // header through node:http so this checks the server's real boundary.
      const badHostStatus = await new Promise((done, fail) => {
        const request = http.get(
          `${viewerUrl}/status`,
          {
            headers: { Host: "attacker.invalid" },
            timeout: 5000,
            signal: interruption.signal,
          },
          (response) => {
            response.resume();
            response.on("end", () => done(response.statusCode));
          },
        );
        request.on("timeout", () =>
          request.destroy(Error("Host probe timed out")),
        );
        request.on("error", fail);
      });
      assert.equal(badHostStatus, 403);
      const before = await status();
      const badOrigin = await fetch(`${viewerUrl}/command`, {
        signal: AbortSignal.any([
          AbortSignal.timeout(15000),
          interruption.signal,
        ]),
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://attacker.invalid",
        },
        body: JSON.stringify({
          id: "edit",
          params: { text: "Rejected edit" },
          revision: before.driver.revision,
        }),
      });
      assert.equal(badOrigin.status, 403);
      assert.equal((await status()).driver.revision, before.driver.revision);
      assert.deepEqual((await notes()).items, []);
    },
  );
  await check(
    "real viewer renders Chromium stream and controls through published port",
    async () => {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      await page.goto(viewerUrl, { waitUntil: "domcontentloaded" });
      await page.locator('[data-command="edit"]').waitFor();
      await page.waitForFunction(
        () => document.querySelector("#browser-image")?.naturalWidth > 0,
      );
      await page.screenshot({
        path: resolve(output, "compose-viewer.png"),
        fullPage: true,
      });
      await page.close();
    },
  );
  await check(
    "guarded edit/save persists exactly one independently read record",
    async () => {
      const edited = await command("edit", {
        text: "Compose conformance note",
      });
      assert.equal(edited.execution, "completed");
      assert.equal(edited.outcome.kind, "success");
      const saved = await command("save");
      assert.equal(saved.execution, "completed");
      assert.equal(saved.outcome.kind, "success");
      assert.equal(saved.effect.status, "saved");
      const rows = (await notes()).items;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].text, "Compose conformance note");
    },
  );
  await check(
    "stopping Daedlo preserves app and data and exports final evidence",
    async () => {
      await compose("stop", "-t", "30", "daedlo");
      const rows = (await notes()).items;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].text, "Compose conformance note");
      await compose(
        "cp",
        "daedlo:/evidence/session.json",
        resolve(output, "session.json"),
      );
      const report = JSON.parse(
        await readFile(resolve(output, "session.json"), "utf8"),
      );
      assert.equal(report.lastResult.outcome.kind, "success");
      assert.equal(report.lastResult.effect.status, "saved");
      const containers = JSON.parse(
        `[${(await compose("ps", "--all", "--format", "json")).trim().split("\n").filter(Boolean).join(",")}]`,
      );
      const driver = containers.find((entry) => entry.Service === "daedlo");
      assert.equal(driver.State, "exited");
      assert.equal(driver.ExitCode, 0);
      assert.equal(
        containers.find((entry) => entry.Service === "notebook-app").State,
        "running",
      );
    },
  );
  await check(
    "restarting Daedlo reconnects without replaying application commands",
    async () => {
      await compose(
        "up",
        "-d",
        "--no-deps",
        "--wait",
        "--wait-timeout",
        "60",
        "daedlo",
      );
      assert.equal((await status()).connected, true);
      assert.equal((await notes()).items.length, 1);
    },
  );
  passed = true;
} catch (error) {
  console.error(error);
  process.exitCode ||= 1;
} finally {
  finalizing = true;
  try {
    await browser?.close();
    results.push({ name: "host inspection browser cleanup", status: "PASS" });
  } catch (error) {
    passed = false;
    process.exitCode ||= 1;
    results.push({
      name: "host inspection browser cleanup",
      status: "FAIL",
      error: error.message,
    });
  }
  try {
    // A partial build may have produced some images. The exact prospective tags
    // remain in every receipt even when complete identity capture is impossible.
    if (owned && images.length === 0) {
      try {
        images = await captureComposeImages({ project, run: docker });
      } catch {
        /* Retain incomplete-run resources; never infer cleanup ownership. */
      }
    }
    const complete = await finalizeComposeRun({
      passed,
      owned,
      interrupted: () => Boolean(interrupted),
      compose,
      finalReport: resolve(output, "session-final.json"),
      persist,
      results,
      removeImages: () =>
        removeComposeImages({
          project,
          images,
          run: docker,
          shouldRetain: () => Boolean(interrupted),
        }),
    });
    if (!complete) process.exitCode ||= 1;
  } catch (error) {
    process.exitCode ||= 1;
    console.error(
      "Compose finalization incomplete; retained resources require inspection:",
      project,
      error.message,
    );
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    try {
      fsyncSync(logFd);
    } catch {
      process.exitCode ||= 1;
    }
    closeSync(logFd);
  }
  console.log(`Compose evidence: ${output}`);
}
