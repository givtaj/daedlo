import { releaseNames } from "../../scripts/release/names.mjs";
import assert from "node:assert/strict";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createStaticFixture } from "./server.mjs";
import { createSeeRuntimeAdapter, readMetrics } from "./adapter.mjs";

const [consumerArg, sourceArg, outputArg, mode] = process.argv.slice(2);
if (
  !consumerArg ||
  !sourceArg ||
  !outputArg ||
  !["retain", "close"].includes(mode)
)
  throw Error("Usage: run.mjs CONSUMER SOURCE OUTPUT retain|close");
const consumer = resolve(consumerArg),
  output = resolve(outputArg);
const receipt = JSON.parse(await readFile(join(consumer, "receipt.json")));
const runtimeRoot = join(consumer, "node_modules", releaseNames(receipt.artifacts).runtime);
const { createDriverSession, createViewer, createResourceScope } = await import(
  pathToFileURL(join(runtimeRoot, "src/index.mjs"))
);
const { chromium } = await import(
  pathToFileURL(join(consumer, "node_modules/playwright/index.mjs"))
);
const resources = createResourceScope();
const sourceReceipt = JSON.parse(
  await readFile(join(resolve(sourceArg), "..", "source-identity.json")),
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function verifySource() {
  const files = {};
  for (const path of Object.keys(sourceReceipt.files))
    files[path] = hash(await readFile(join(resolve(sourceArg), path)));
  const paths = [];
  async function walk(dir) {
    for (const entry of await readdir(join(resolve(sourceArg), dir), {
      withFileTypes: true,
    })) {
      const path = dir + "/" + entry.name;
      if (entry.isDirectory()) await walk(path);
      else paths.push(path);
    }
  }
  await walk("dist");
  assert.deepEqual(paths.sort(), Object.keys(files).sort());
  assert.equal(hash(JSON.stringify(files)), sourceReceipt.treeSha256);
  assert.equal(sourceReceipt.commit, receipt.applicationCommit);
}
await verifySource();
assert.equal(
  hash(await readFile(join(consumer, "engine/src/main.rs"))),
  receipt.modelSourceSha256,
);
const adapterSourceSha256 = hash(
  await readFile(new URL("./adapter.mjs", import.meta.url)),
);
const results = [];
let session;
let scenarioError;
const owner = {
  pid: process.pid,
  consumer,
  source: resolve(sourceArg),
  cleanup:
    "Send SIGTERM only to this recorded owner PID; it closes or retries its owned resources.",
};
const recordOwner = () =>
  writeFile(
    join(output, "owner.json"),
    JSON.stringify({ ...owner, resources: resources.snapshot() }, null, 2) +
      "\n",
  );
await recordOwner();
try {
  const app = resources.own(await createStaticFixture(sourceArg), {
    label: "isolated SeeRuntime static fixture",
    close: (r) => r.close(),
  });
  owner.application = app.url;
  await recordOwner();
  const browser = resources.own(await chromium.launch({ headless: true }), {
    label: "owned SeeRuntime Chromium",
    close: (r) => r.close(),
  });
  await recordOwner();
  const context = await browser.newContext({
    viewport: { width: 1360, height: 1000 },
  });
  const blocked = [];
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === app.url) return route.continue();
    blocked.push(url.origin);
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto(app.url);
  await page.waitForFunction(
    () =>
      document.querySelector("#stage canvas") &&
      document.querySelector("#scene-error")?.hidden &&
      !document.querySelector("#play")?.disabled,
  );
  const adapter = createSeeRuntimeAdapter(page);
  const enginePath = join(consumer, "target/debug/seeruntime-browser-driver");
  session = await createDriverSession({
    page,
    context,
    enginePath,
    adapter,
    resources,
    identity: {
      application: `seeruntime/${receipt.applicationCommit}`,
      model: "seeruntime-playback/068d573-v1",
    },
  });
  const viewer = resources.own(
    await createViewer({ page, context, session, port: 0 }),
    { label: "SeeRuntime live driver viewer", close: (r) => r.close() },
  );
  owner.viewer = viewer.url;
  await recordOwner();
  await session.setSpeed("fast");
  async function command(id, verify) {
    const snapshot = await session.observe();
    const result = await session.execute(id, {}, snapshot.revision);
    assert.equal(result.execution, "completed", JSON.stringify(result));
    assert.equal(result.outcome.kind, "success", JSON.stringify(result));
    const metrics = await readMetrics(page);
    await verify?.(metrics);
    const report = session.report({ runId: result.runId });
    assert.ok(report);
    results.push({
      id,
      result,
      metrics,
      evidence: adapter.acceptance.evidence(),
      report,
    });
  }
  await command("select_io", async (m) => {
    assert.equal(
      await page.locator("#model-node").getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(await page.locator("#scenario").inputValue(), "io");
    assert.equal(await page.locator(".event-pill").count(), 11);
    assert.deepEqual(m, { phase: "Ready", event: 0, timeline: 0, active: 0 });
  });
  await command("step", (m) => {
    assert.equal(m.phase, "File request");
    assert.equal(m.event, 1);
    assert.equal(m.active, 1);
  });
  await command("play", async () => {
    assert.equal(
      await page.locator("#play").getAttribute("aria-label"),
      "Pause simulation",
    );
    const a = await readMetrics(page);
    await page.waitForTimeout(180);
    const b = await readMetrics(page);
    assert.ok(b.timeline > a.timeline);
  });
  await command("pause", async () => {
    assert.equal(
      await page.locator("#play").getAttribute("aria-label"),
      "Play simulation",
    );
    const a = await readMetrics(page);
    await page.waitForTimeout(180);
    assert.deepEqual(await readMetrics(page), a);
  });
  const paused = await readMetrics(page);
  await command("step", (m) => assert.equal(m.event, paused.event + 1));
  await command("reset", (m) =>
    assert.deepEqual(m, { phase: "Ready", event: 0, timeline: 0, active: 0 }),
  );
  const snapshot = await session.observe();
  const recipe = await session.runRecipe("io_walkthrough", snapshot.revision);
  assert.equal(recipe.execution, "completed", JSON.stringify(recipe));
  assert.equal(recipe.outcome.kind, "success");
  assert.deepEqual(await readMetrics(page), {
    phase: "Ready",
    event: 0,
    timeline: 0,
    active: 0,
  });
  results.push({
    id: "io_walkthrough",
    result: recipe,
    report: session.report({ runId: recipe.runId }),
  });
  // State/recipe guards are measured independently at the public session boundary.
  const idle = await session.observe();
  const rejected = await session.execute("pause", {}, idle.revision);
  assert.equal(rejected.execution, "rejected");
  assert.deepEqual(await readMetrics(page), {
    phase: "Ready",
    event: 0,
    timeline: 0,
    active: 0,
  });
  results.push({ id: "pause_from_idle_rejected", result: rejected });
  // Retain the negative evidence, then leave the visible demo in a successful ready state.
  await command("reset", (m) =>
    assert.deepEqual(m, { phase: "Ready", event: 0, timeline: 0, active: 0 }),
  );
  await page.screenshot({
    path: join(output, "application.png"),
    fullPage: true,
  });
  const viewerPage = await context.newPage();
  // Viewer is another explicitly owned loopback surface, not an external site.
  await context.unroute("**/*");
  await context.route("**/*", (route) =>
    [app.url, viewer.url.replace(/\/$/, "")].includes(
      new URL(route.request().url()).origin,
    )
      ? route.continue()
      : route.abort(),
  );
  await viewerPage.goto(viewer.url);
  await viewerPage.waitForFunction(
    () => document.querySelector("img")?.naturalWidth > 0,
  );
  await viewerPage.screenshot({
    path: join(output, "viewer.png"),
    fullPage: true,
  });
  const status = await (await fetch(new URL("/status", viewer.url))).json();
  assert.equal(status.connected, true);
  assert.equal(status.driver.state.id, "lesson.idle");
  assert.ok(status.frames > 0);
  await viewerPage.close();
  const engineSha256 = createHash("sha256")
    .update(await readFile(enginePath))
    .digest("hex");
  await verifySource();
  const summary = {
    status: "passed",
    receipt,
    engineSha256,
    adapterSourceSha256,
    sourceIdentity: {
      commit: sourceReceipt.commit,
      sourceTarSha256: sourceReceipt.sourceTarSha256,
      treeSha256: sourceReceipt.treeSha256,
      verifiedDistFiles: Object.keys(sourceReceipt.files).length,
      beforeAndAfterMatched: true,
    },
    results,
    blockedExternalOrigins: [...new Set(blocked)],
    viewer: viewer.url,
    application: app.url,
    ownerPid: process.pid,
    resources: resources.snapshot(),
    browserMode: "headless Chromium with visible MJPEG viewer",
    limitations: [
      "One Node I/O lesson flow; no full-app coverage",
      "No persistence, account or clipboard flow",
      "Pinned committed snapshot excludes live uncommitted work",
    ],
  };
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  await recordOwner();
  console.log(
    JSON.stringify({
      status: "passed",
      groups: results.length,
      viewer: viewer.url,
      application: app.url,
      ownerPid: process.pid,
      mode,
    }),
  );
  if (mode === "retain")
    await new Promise((resolve) => {
      const stop = () => resolve();
      process.once("SIGTERM", stop);
      process.once("SIGINT", stop);
    });
} catch (error) {
  scenarioError = error;
  await writeFile(
    join(output, "failure.json"),
    JSON.stringify(
      { message: error.message, owner, resources: resources.snapshot() },
      null,
      2,
    ) + "\n",
  );
} finally {
  let complete = false;
  while (!complete) {
    try {
      if (session) await session.close();
      else await resources.close();
      complete = true;
    } catch (error) {
      await writeFile(
        join(output, "cleanup.json"),
        JSON.stringify(
          {
            status: "cleanup_failed",
            message: error.message,
            owner,
            resources: resources.snapshot(),
            originalScenarioError: scenarioError?.message ?? null,
          },
          null,
          2,
        ) + "\n",
      );
      await recordOwner();
      console.error(
        "Owned cleanup incomplete; this owner retains recovery handles. Send SIGTERM to retry.",
      );
      // Keep the actual handles alive instead of replacing a failure with success.
      await new Promise((resolve) => {
        const timer = setInterval(() => {}, 1000);
        process.once("SIGTERM", () => {
          clearInterval(timer);
          resolve();
        });
      });
    }
  }
  await writeFile(
    join(output, "cleanup.json"),
    JSON.stringify(
      {
        status: "closed",
        owner,
        resources: resources.snapshot(),
        originalScenarioError: scenarioError?.message ?? null,
      },
      null,
      2,
    ) + "\n",
  );
  await recordOwner();
}
if (scenarioError) throw scenarioError;
