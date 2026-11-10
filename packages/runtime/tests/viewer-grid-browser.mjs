// Real Chromium viewer layout and connection honesty; synthetic conformance only.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { createViewer } from "../src/viewer/server.mjs";

const evidenceRoot = resolve(
  process.env.VIEWER_GRID_OUTPUT ?? "artifacts/viewer-grid-20261106",
);
await mkdir(evidenceRoot, { recursive: true });
const evidence = await mkdtemp(join(evidenceRoot, "run-"));
console.log(`Viewer grid browser evidence: ${evidence}`);

const commands = [
  { id: "open", label: "Open the editor", params: {} },
  { id: "prepare", label: "Prepare the draft", params: {} },
  { id: "save", label: "Save the draft", params: {} },
  { id: "readback", label: "Read back the stored draft", params: {} },
  ...Array.from({ length: 24 }, (_, index) => ({
    id: `inspect-${index}`,
    label: `Inspect application section ${index + 1}`,
    params: {},
  })),
];
const recipe = {
  id: "save-and-verify",
  label: "Save the draft and verify storage",
  steps: ["open", "prepare", "save", "readback"].map((command) => ({
    command,
    params: {},
  })),
};

async function withViewer(
  name,
  run,
  { active = false, viewport, extraStates = [] } = {},
) {
  let browser, viewer, ui;
  const calls = [];
  const snapshot = {
    connected: true,
    descriptor: {
      id: "viewer-grid-fixture",
      version: "1",
      label: "Synthetic application workspace",
      states: [
        { id: "ready", label: "Ready", parent: null, support: "supported" },
        { id: "draft", label: "Draft", parent: null, support: "supported" },
        { id: "saved", label: "Saved", parent: null, support: "supported" },
        ...structuredClone(extraStates),
      ],
      commands: structuredClone(commands),
      recipes: [structuredClone(recipe)],
    },
    revision: "observed-r1",
    state: { id: "draft" },
    commands: commands.map(({ id }) => ({ id, enabled: true })),
    recipes: [{ id: recipe.id, enabled: true }],
    display: [{ label: "Draft", value: "Present" }],
    execution: active ? "running" : "idle",
    busy: active,
    paused: false,
    speed: "normal",
    runId: active ? "run-current" : "run-previous",
    activeRun: active ? { command: recipe.id, recipe: true } : null,
    progress: active
      ? { completed: 1, total: 4, label: "Prepare the draft" }
      : {},
    lastResult: {
      ok: true,
      runId: "run-previous",
      command: recipe.id,
      recipe: true,
      execution: "completed",
      outcome: {
        kind: "success",
        label: "The prior stored draft was verified",
      },
      effect: { status: "saved" },
      finishedAt: "2026-11-06T10:00:00.000Z",
    },
  };
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1000, height: 650 },
    });
    const application = await context.newPage();
    await application.setContent(`<!doctype html>
      <title>Synthetic draft workspace</title>
      <style>body{font:18px system-ui;margin:40px;background:#f4f5f7}
      main{background:white;padding:32px;border:1px solid #ccd3da}
      label{display:block;margin:24px 0}input{font:inherit;padding:12px;width:70%}
      button{font:inherit;padding:12px 24px}</style>
      <h1>Synthetic draft workspace</h1><main><h2>Draft editor</h2>
      <p>Independent viewer conformance fixture</p>
      <label>Draft title <input value="Example draft"></label>
      <button>Save draft</button></main>`);
    const session = {
      snapshot: async () => structuredClone(snapshot),
      command: async (body) => {
        calls.push(["command", structuredClone(body)]);
        return { ok: true, execution: "completed" };
      },
      pause: async () => calls.push(["pause"]),
      resume: async () => calls.push(["resume"]),
      stop: async () => calls.push(["stop"]),
      setSpeed: async (speed) => calls.push(["speed", speed]),
    };
    viewer = await createViewer({
      page: application,
      context,
      session,
      frontend: {
        name: "Synthetic workspace - draft authoring and storage verification",
        targetOrigin: null,
        model: {
          id: snapshot.descriptor.id,
          version: snapshot.descriptor.version,
        },
        evidenceLocation:
          "/local/synthetic/workspace/managed-store/supervisor/run-reports/long-evidence-location",
        ownership: {
          browser: "owned",
          context: "owned",
          application: "attached",
        },
      },
    });
    const monitor = await browser.newContext({
      viewport: viewport ?? { width: 1440, height: 900 },
    });
    ui = await monitor.newPage();
    ui.setDefaultTimeout(5000);
    await ui.goto(viewer.url);
    await ui.waitForFunction(
      () => document.querySelector("#connection").textContent === "Connected",
    );
    await ui.waitForFunction(
      () => document.querySelector("#browser-image").naturalWidth > 0,
    );
    await run({ ui, snapshot, calls, viewer, application });
  } finally {
    if (ui && !ui.isClosed())
      await ui.screenshot({
        path: join(evidence, `${name}.png`),
        fullPage: true,
      });
    await viewer?.close();
    await browser?.close();
  }
}

async function assertAboveFold(ui, selector) {
  const element = ui.locator(selector);
  assert.equal(await element.isVisible(), true, `${selector} must be visible`);
  const box = await element.boundingBox();
  assert.ok(
    box && box.y >= 0 && box.y + box.height <= ui.viewportSize().height,
    `${selector} must remain above the fold: ${JSON.stringify(box)}`,
  );
}

test("development: a brief restart preserves the run result and reconnects without replay", async () => {
  await withViewer(
    "development-reconnecting",
    async ({ ui, snapshot, calls }) => {
      snapshot.execution = "completed";
      await ui.waitForFunction(
        () =>
          document.querySelector("#execution-state").textContent ===
          "Completed",
      );
      await ui.route("**/status", (route) => route.abort("failed"));
      await ui.waitForFunction(
        () =>
          document.querySelector("#connection").textContent === "Reconnecting",
        null,
        { timeout: 2000 },
      );
      assert.equal(
        await ui.locator("#execution-state").innerText(),
        "Completed",
        "Losing the viewer must not rewrite the last run's execution",
      );
      assert.match(
        await ui.locator("#outcome-label").innerText(),
        /prior stored draft was verified/,
      );
      assert.equal(
        await ui.locator('[data-command="open"]').isDisabled(),
        true,
      );
      assert.equal(
        await ui.locator("#stream-error").isVisible(),
        false,
        "Connection notice must not be duplicated over the retained image",
      );
      assert.match(
        await ui.locator("#mirror-status").innerText(),
        /last captured frame.*\d\d:\d\d/i,
      );
      assert.equal(
        await ui.locator('[data-channel="viewer"]').getAttribute("data-status"),
        "warning",
      );
      assert.match(
        await ui.locator('[data-channel="browser"]').innerText(),
        /Unknown/,
      );
      await ui.unroute("**/status");
      await ui.getByRole("button", { name: "Check connection" }).click();
      await ui.waitForFunction(
        () => document.querySelector("#connection").textContent === "Connected",
      );
      assert.deepEqual(
        calls,
        [],
        "A connection check and recovery only observe; they never replay a command",
      );
    },
  );
});

test("development: persistent connection loss is actionable and preserves completed evidence", async () => {
  await withViewer("development-connection-lost", async ({ ui, calls }) => {
    await ui.route("**/status", (route) => route.abort("failed"));
    await ui.waitForFunction(
      () =>
        document.querySelector("#connection").textContent === "Connection lost",
      null,
      { timeout: 8000 },
    );
    assert.equal(
      await ui.locator('[data-channel="viewer"]').getAttribute("data-status"),
      "error",
    );
    assert.match(
      await ui.locator("#connection-error").innerText(),
      /restart|running/i,
    );
    assert.match(
      await ui.locator("#outcome-label").innerText(),
      /prior stored draft was verified/,
    );
    assert.equal(await ui.locator('[data-command="open"]').isDisabled(), true);
    assert.equal(await ui.locator("#command-count").innerText(), "0 available");
    assert.deepEqual(calls, []);
  });
});

test("development: a hung status response times out and makes retained state stale", async () => {
  await withViewer("development-status-timeout", async ({ ui, calls }) => {
    await ui.route("**/status", () => new Promise(() => {}));
    await ui.waitForFunction(
      () =>
        document.querySelector("#connection").textContent === "Reconnecting",
      null,
      { timeout: 5000 },
    );
    assert.equal(
      await ui.locator("#connection-error").getAttribute("data-reason"),
      "status_timeout",
    );
    assert.equal(await ui.locator('[data-command="open"]').isDisabled(), true);
    assert.equal(
      await ui.locator('#state-tree [aria-current="true"]').count(),
      0,
    );
    assert.deepEqual(calls, []);
    await ui.unrouteAll({ behavior: "ignoreErrors" });
  });
});

test("development: malformed status and rendering failures are not reported as network outages", async () => {
  await withViewer("development-invalid-status", async ({ ui, calls }) => {
    await ui.route("**/status", (route) => route.fulfill({ json: [] }));
    await ui.waitForFunction(
      () =>
        document.querySelector("#connection-error").dataset.reason ===
        "status_invalid",
      null,
      { timeout: 2000 },
    );
    assert.match(
      await ui.locator("#connection-error").innerText(),
      /invalid.*status|status.*invalid/i,
    );
    assert.equal(await ui.locator('[data-command="open"]').isDisabled(), true);
    await ui.unroute("**/status");
    await ui.waitForFunction(
      () => document.querySelector("#connection").textContent === "Connected",
    );
    await ui.route("**/status", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.frontend.ownership = null;
      await route.fulfill({ json: body });
    });
    await ui.waitForFunction(
      () =>
        document.querySelector("#connection-error").dataset.reason ===
        "render_failed",
      null,
      { timeout: 2000 },
    );
    assert.match(
      await ui.locator("#connection-error").innerText(),
      /display|render/i,
    );
    assert.equal(await ui.locator('[data-command="open"]').isDisabled(), true);
    await ui.unroute("**/status");
    await ui.waitForFunction(
      () => document.querySelector("#connection").textContent === "Connected",
    );
    assert.equal(await ui.locator('[data-command="open"]').isEnabled(), true);
    assert.deepEqual(calls, []);
  });
});

test("development: a final close wins over late status and a new viewer can reconnect", async () => {
  await withViewer(
    "development-lifecycle-race",
    async ({ ui, viewer, calls }) => {
      await ui.waitForFunction(
        () => document.body.dataset.lifecycleEvents === "connected",
      );
      const original = await (
        await ui.request.get(`${viewer.url}/status`)
      ).json();
      let release;
      let received;
      const intercepted = new Promise((resolve) => {
        received = resolve;
      });
      await ui.route("**/status", async (route) => {
        received();
        await new Promise((resolve) => {
          release = resolve;
        });
        await route.fulfill({ json: original });
      });
      await intercepted;
      await viewer.close();
      await ui.waitForFunction(
        () =>
          document.querySelector("#connection").textContent === "Viewer closed",
      );
      release();
      await ui.waitForFunction(
        () => !document.querySelector("#check-connection").disabled,
      );
      assert.equal(
        await ui.locator("#connection").innerText(),
        "Viewer closed",
        "An open status sampled before closure must not resurrect the ended viewer",
      );
      assert.equal(
        await ui.locator('[data-command="open"]').isDisabled(),
        true,
      );
      await ui.unroute("**/status");
      await ui.route("**/status", (route) =>
        route.fulfill({
          json: {
            ...original,
            lifecycle: { id: "replacement-viewer", status: "open" },
          },
        }),
      );
      await ui.getByRole("button", { name: "Check connection" }).click();
      await ui.waitForFunction(
        () => document.querySelector("#connection").textContent === "Connected",
      );
      assert.equal(await ui.locator('[data-command="open"]').isEnabled(), true);
      assert.deepEqual(
        calls,
        [],
        "A new viewer identity requires a fresh observation, never a replay",
      );
    },
  );
});

test("development: stable connection checks do not repeat live-region announcements", async () => {
  await withViewer(
    "development-accessible-status",
    async ({ ui, snapshot }) => {
      await ui.waitForFunction(
        () =>
          document.querySelector('[data-channel="image"] .channel-value')
            .textContent === "Live",
      );
      await ui.evaluate(() => {
        window.connectionTextChanges = 0;
        const observer = new MutationObserver((records) => {
          window.connectionTextChanges += records.length;
        });
        for (const id of ["connection-channels", "connection-detail"])
          observer.observe(document.getElementById(id), {
            subtree: true,
            childList: true,
            characterData: true,
          });
      });
      await ui.waitForResponse((response) =>
        response.url().endsWith("/status"),
      );
      await ui.waitForResponse((response) =>
        response.url().endsWith("/status"),
      );
      await ui.evaluate(() => new Promise(requestAnimationFrame));
      assert.equal(
        await ui.evaluate(() => window.connectionTextChanges),
        0,
        "Unchanged status text must not be rewritten on every poll",
      );
      snapshot.connected = false;
      await ui.waitForFunction(() => window.connectionTextChanges > 0);
      assert.match(
        await ui.locator('[data-channel="application"]').innerText(),
        /Unavailable/,
      );
    },
  );
});

test("development: an image arriving before initial status cannot claim a connected viewer", async () => {
  await withViewer(
    "development-initial-status",
    async ({ ui, viewer, calls }) => {
      const status = await (
        await ui.request.get(`${viewer.url}/status`)
      ).json();
      let release;
      await ui.route("**/status", async (route) => {
        await new Promise((resolve) => {
          release = resolve;
        });
        await route.fulfill({ json: status });
      });
      await ui.reload();
      await ui.evaluate(() =>
        document
          .querySelector("#browser-image")
          .dispatchEvent(new Event("load")),
      );
      assert.equal(await ui.locator("#connection").innerText(), "Connecting");
      assert.equal(
        await ui.locator('[data-channel="viewer"]').getAttribute("data-status"),
        "neutral",
      );
      assert.equal(
        await ui.locator("#live-dot").getAttribute("data-status"),
        "neutral",
      );
      release();
      await ui.waitForFunction(
        () => document.querySelector("#connection").textContent === "Connected",
      );
      await ui.unroute("**/status");
      assert.deepEqual(calls, []);
    },
  );
});

test("development: observation loss keeps the reachable viewer separate from application health", async () => {
  await withViewer(
    "development-observation-unavailable",
    async ({ ui, snapshot, calls }) => {
      snapshot.connected = false;
      snapshot.error = "Application observation is unavailable.";
      await ui.waitForFunction(
        () =>
          document.querySelector('[data-channel="application"]')?.dataset
            .status === "warning",
        null,
        { timeout: 2000 },
      );
      assert.match(
        await ui.locator('[data-channel="viewer"]').innerText(),
        /Connected/,
      );
      assert.match(
        await ui.locator('[data-channel="browser"]').innerText(),
        /Connected/,
      );
      assert.match(
        await ui.locator('[data-channel="application"]').innerText(),
        /Unavailable/,
      );
      assert.doesNotMatch(
        await ui.locator("#connection-channels").innerText(),
        /API healthy|site healthy/i,
      );
      assert.equal(
        await ui.locator('[data-command="open"]').isDisabled(),
        true,
      );
      assert.deepEqual(calls, []);
    },
  );
});

test("development: a known viewer close is neutral and preserves its attached browser and result", async () => {
  await withViewer(
    "development-viewer-closed",
    async ({ ui, viewer, application, calls }) => {
      await ui.waitForFunction(
        () => document.body.dataset.lifecycleEvents === "connected",
      );
      await viewer.close();
      await ui.waitForFunction(
        () =>
          document.querySelector("#connection").textContent === "Viewer closed",
        null,
        { timeout: 2000 },
      );
      assert.equal(application.isClosed(), false);
      assert.equal(
        await ui.locator('[data-channel="viewer"]').getAttribute("data-status"),
        "neutral",
      );
      assert.match(
        await ui.locator("#outcome-label").innerText(),
        /prior stored draft was verified/,
      );
      assert.equal(await ui.locator("#stream-error").isVisible(), false);
      assert.equal(
        await ui.locator("#command-count").innerText(),
        "0 available",
      );
      assert.equal(
        await ui.locator("#live-dot").getAttribute("data-status"),
        "neutral",
      );
      assert.equal(
        await ui.locator('[data-command="open"]').isDisabled(),
        true,
      );
      await ui.getByRole("button", { name: "Check connection" }).click();
      assert.equal(
        await ui.locator("#connection").innerText(),
        "Viewer closed",
      );
      assert.deepEqual(calls, []);
    },
  );
});

test("frontend identity is compact by default and keeps details available", async () => {
  await withViewer("frontend-identity", async ({ ui }) => {
    const identity = ui.locator("#frontend-identity");
    assert.equal(
      await identity.evaluate((element) => element.tagName),
      "DETAILS",
      "Frontend metadata must be an expandable disclosure",
    );
    assert.equal(await identity.evaluate((element) => element.open), false);
    assert.equal(await ui.locator("#frontend-name").isVisible(), true);
    assert.equal(await ui.locator("#frontend-details").isVisible(), false);
    await identity.locator("summary").click();
    assert.equal(await ui.locator("#frontend-details").isVisible(), true);
    assert.match(await ui.locator("#frontend-details").innerText(), /Evidence/);
    assert.match(
      await ui.locator("#frontend-details").innerText(),
      /application: attached/,
    );
    await identity.locator("summary").click();
    assert.equal(await ui.locator("#frontend-details").isVisible(), false);
  });
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
]) {
  test(`active flow and outcome remain visible at ${viewport.width}x${viewport.height}`, async () => {
    await withViewer(
      `active-${viewport.width}x${viewport.height}`,
      async ({ ui }) => {
        const boxes = {};
        for (const selector of [
          ".browser-screen",
          "#execution-state",
          "#stop",
          "#last-result",
          "#flow-panel",
        ])
          boxes[selector] = (await ui.locator(selector).count())
            ? await ui.locator(selector).boundingBox()
            : null;
        await writeFile(
          join(evidence, `geometry-${viewport.width}x${viewport.height}.json`),
          JSON.stringify(boxes, null, 2),
        );
        await assertAboveFold(ui, "#execution-state");
        await assertAboveFold(ui, "#stop");
        await assertAboveFold(ui, "#last-result");
        await assertAboveFold(ui, "#flow-panel");
        const image = boxes[".browser-screen"];
        assert.ok(
          image.width >= viewport.width * 0.42,
          "The application keeps the largest column",
        );
        assert.ok(
          image.height >= 280,
          "The application has a usable viewing height",
        );
        assert.ok(
          image.y + image.height <= viewport.height,
          "The full browser viewport remains above the fold",
        );
        assert.equal(
          await ui.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
          "Desktop grid must not require horizontal scrolling",
        );
      },
      { active: true, viewport },
    );
  });
}

test("active flow uses the authored recipe and observed run progress", async () => {
  await withViewer(
    "active-flow",
    async ({ ui, snapshot, calls }) => {
      assert.equal(await ui.locator("#flow-panel").isVisible(), true);
      assert.equal(await ui.locator("#flow-title").innerText(), recipe.label);
      const steps = ui.locator("#flow-steps > li");
      assert.equal(await steps.count(), 4);
      for (const [index, expected] of commands.slice(0, 4).entries())
        assert.match(
          await steps.nth(index).innerText(),
          new RegExp(expected.label),
        );
      assert.deepEqual(
        await steps.evaluateAll((items) =>
          items.map((item) => item.dataset.stepStatus),
        ),
        ["done", "current", "upcoming", "upcoming"],
      );
      assert.equal(await steps.nth(1).getAttribute("aria-current"), "step");
      assert.match(await ui.locator("#flow-panel").innerText(), /run-current/);
      snapshot.progress = { completed: 2, total: 4, label: "Save the draft" };
      await ui.waitForFunction(
        () =>
          document.querySelectorAll("#flow-steps > li")[2]?.dataset
            .stepStatus === "current",
      );
      assert.deepEqual(
        await steps.evaluateAll((items) =>
          items.map((item) => item.dataset.stepStatus),
        ),
        ["done", "done", "current", "upcoming"],
      );
      assert.equal(
        await ui.locator('#flow-steps [aria-current="step"]').count(),
        1,
      );
      assert.deepEqual(
        calls,
        [],
        "Rendering flow progress must not dispatch actions",
      );
    },
    { active: true },
  );
});

async function assertDisconnectedMirror(ui) {
  assert.match(
    await ui.locator(".mirror-tag").innerText(),
    /last captured frame/i,
    "A retained frame must not be labelled as a live mirror",
  );
  assert.match(
    await ui.locator("#mirror-status").innerText(),
    /last captured frame/i,
  );
  assert.equal(await ui.locator("#stream-error").isVisible(), false);
  assert.equal(await ui.locator("#connection-error").isVisible(), true);
  assert.doesNotMatch(
    await ui.locator("#frame-status").innerText(),
    /watching/i,
  );
  assert.doesNotMatch(
    await ui.locator("#browser-image").getAttribute("alt"),
    /live mirror/i,
  );
  assert.equal(
    await ui.locator('#state-tree [aria-current="true"]').count(),
    0,
  );
  assert.equal(await ui.locator("#state-tree .active").count(), 0);
  assert.match(
    await ui.locator("#state-label").innerText(),
    /last observed|unavailable|disconnected/i,
  );
  assert.equal(
    await ui.locator('button[data-command="open"]').isDisabled(),
    true,
  );
  assert.equal(
    await ui.locator(`button[data-recipe="${recipe.id}"]`).isDisabled(),
    true,
  );
  assert.equal(await ui.locator("#speed").isDisabled(), true);
}

test("disconnected status identifies retained imagery and removes stale current state", async () => {
  await withViewer("disconnected-status", async ({ ui, snapshot, calls }) => {
    snapshot.connected = false;
    await ui.route("**/status", async (route) => {
      const response = await route.fetch();
      const status = await response.json();
      status.connections = { browser: false, application: false };
      await route.fulfill({ json: status });
    });
    await ui.waitForFunction(
      () =>
        document.querySelector("#connection").textContent ===
        "Browser unavailable",
    );
    await assertDisconnectedMirror(ui);
    await ui.unroute("**/status");
    snapshot.connected = true;
    await ui.waitForFunction(
      () => document.querySelector("#connection").textContent === "Connected",
    );
    assert.equal(
      await ui.locator('button[data-command="open"]').isEnabled(),
      true,
    );
    assert.equal(
      await ui.locator('#state-tree [aria-current="true"]').count(),
      1,
    );
    assert.deepEqual(calls, [], "Status recovery must not replay commands");
  });
});

test("failed status transport makes a retained frame stale and recovery never replays", async () => {
  await withViewer("disconnected-network", async ({ ui, calls }) => {
    await ui.locator('button[data-command="open"]').click();
    await ui.waitForFunction(
      () => !document.querySelector('button[data-command="open"]').disabled,
    );
    assert.equal(calls.length, 1);
    await ui.route("**/status", (route) => route.abort("failed"));
    await ui.waitForFunction(
      () =>
        document.querySelector("#connection").textContent === "Reconnecting",
    );
    await assertDisconnectedMirror(ui);
    await ui.screenshot({
      path: join(evidence, "network-stale-frame.png"),
      fullPage: true,
    });
    await ui.unroute("**/status");
    await ui.waitForFunction(
      () => document.querySelector("#connection").textContent === "Connected",
    );
    assert.equal(
      await ui.locator('button[data-command="open"]').isEnabled(),
      true,
    );
    assert.equal(
      await ui.locator('#state-tree [aria-current="true"]').count(),
      1,
    );
    assert.equal(
      calls.length,
      1,
      "Reconnecting must preserve the single original dispatch",
    );
  });
});

test("an image stream failure is labelled unavailable independently of status", async () => {
  await withViewer("image-unavailable", async ({ ui, calls }) => {
    await ui.route("**/stream*", (route) => route.abort("failed"));
    await ui.evaluate(() => {
      document.querySelector("#browser-image").src = "/stream?injected-failure";
    });
    await ui.waitForFunction(
      () =>
        document.querySelector("#connection-error").dataset.reason ===
        "image_unavailable",
    );
    assert.equal(await ui.locator("#stream-error").isVisible(), false);
    assert.match(
      await ui.locator("#connection-error").innerText(),
      /image unavailable/i,
    );
    assert.doesNotMatch(
      await ui.locator(".mirror-tag").innerText(),
      /live/i,
      "A broken image stream must not retain a live claim",
    );
    assert.match(
      await ui.locator("#mirror-status").innerText(),
      /unavailable/i,
    );
    assert.deepEqual(calls, []);
  });
});

for (const result of [
  {
    execution: "completed",
    outcome: { kind: "validation", label: "Draft needs correction" },
  },
  {
    execution: "completed",
    outcome: { kind: "recoverable_error", label: "Save response unavailable" },
  },
  { execution: "stopped", outcome: { kind: "unknown", label: "Run stopped" } },
]) {
  test(`edge: ${result.outcome.kind} result awaiting cleanup is finalizing`, async () => {
    await withViewer(
      `finalizing-${result.outcome.kind}`,
      async ({ ui, snapshot, calls }) => {
        snapshot.lastResult = {
          ...snapshot.lastResult,
          ...result,
          runId: snapshot.runId,
        };
        snapshot.execution = result.execution;
        await ui.waitForFunction(() =>
          document
            .querySelector("#active-outcome-label")
            .textContent.includes("Finalizing"),
        );
        assert.match(
          await ui.locator("#flow-status").innerText(),
          /finalizing/i,
          "An ended action awaiting cleanup must not be presented as executing a next step",
        );
        assert.equal(
          await ui.locator('#flow-steps [data-step-status="current"]').count(),
          0,
        );
        assert.equal(
          await ui.locator('#flow-steps [aria-current="step"]').count(),
          0,
        );
        assert.equal(await ui.locator("#last-result").isVisible(), false);
        assert.deepEqual(calls, []);
      },
      { active: true },
    );
  });
}

test("edge: status recovery cannot certify an unrecovered image stream", async () => {
  await withViewer("status-without-stream", async ({ ui, calls }) => {
    let streamAttempts = 0;
    await ui.route("**/stream*", (route) => {
      streamAttempts++;
      return route.abort("failed");
    });
    await ui.route("**/status", (route) => route.abort("failed"));
    await ui.waitForFunction(
      () =>
        document.querySelector("#connection").textContent === "Reconnecting",
    );
    assert.ok(
      await ui
        .locator("#browser-image")
        .evaluate((image) => image.naturalWidth > 0),
    );
    await ui.unroute("**/status");
    await ui.waitForFunction(
      () => document.querySelector("#connection").textContent === "Connected",
    );
    assert.doesNotMatch(
      await ui.locator("#mirror-status").innerText(),
      /live/i,
      "Recovered status must not relabel an old frame as a live stream",
    );
    assert.ok(
      streamAttempts > 0,
      "Status recovery must request a fresh image stream",
    );
    await ui.screenshot({
      path: join(evidence, "status-recovered-stream-blocked.png"),
      fullPage: true,
    });
    await ui.unroute("**/stream*");
    await ui.waitForFunction(
      () =>
        /live mirror/i.test(
          document.querySelector("#mirror-status").textContent,
        ),
      undefined,
      { timeout: 15000 },
    );
    assert.ok(
      await ui
        .locator("#browser-image")
        .evaluate((image) => image.naturalWidth > 0),
    );
    assert.deepEqual(
      calls,
      [],
      "Stream recovery must never replay an application action",
    );
  });
});

test("edge: missing recipe progress remains unknown instead of inventing step results", async () => {
  await withViewer("missing-progress", async ({ ui }) => {
    assert.match(await ui.locator("#flow-title").innerText(), /Save the draft/);
    assert.match(
      await ui.locator("#flow-status").innerText(),
      /progress unavailable/i,
      "Missing progress is not proof that zero steps ran",
    );
    assert.equal(
      await ui
        .locator(
          '#flow-steps [data-step-status="done"], #flow-steps [data-step-status="not-run"], #flow-steps [data-step-status="current"]',
        )
        .count(),
      0,
    );
    assert.equal(
      await ui.locator('#flow-steps [aria-current="step"]').count(),
      0,
    );
  });
});

test("mobile flow fits the viewport and reload retains current run attribution", async () => {
  await withViewer(
    "mobile-active-reloaded",
    async ({ ui, calls }) => {
      await ui.reload();
      await ui.waitForFunction(
        () => document.querySelector("#connection").textContent === "Connected",
      );
      assert.equal(
        await ui.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        "The mobile grid must not require horizontal scrolling",
      );
      assert.equal(await ui.locator("#flow-title").innerText(), recipe.label);
      assert.match(
        await ui.locator("#flow-run-identity").innerText(),
        /run-current/,
      );
      const current = ui.locator('#flow-steps [aria-current="step"]');
      assert.equal(await current.count(), 1);
      await current.scrollIntoViewIfNeeded();
      assert.equal(await current.isVisible(), true);
      assert.deepEqual(
        calls,
        [],
        "Reload must observe the existing run without replay",
      );
    },
    { active: true, viewport: { width: 390, height: 844 } },
  );
});

const largeStateHierarchy = Array.from({ length: 15 }, (_, branch) => [
  {
    id: `section-${branch}`,
    label: `Application section ${branch + 1} and its observed workflow states`,
    parent: null,
    support: "supported",
  },
  ...Array.from({ length: 10 }, (_, state) => ({
    id: `section-${branch}-state-${state}`,
    label: `Observed state ${state + 1}: draft editing, validation and independent storage verification`,
    parent: `section-${branch}`,
    support: "supported",
  })),
]).flat();

async function readLargeModelGeometry(ui) {
  return ui.evaluate(() => {
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const scrollBox = (selector) => {
      const element = document.querySelector(selector);
      return {
        ...box(element),
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
        overflowY: getComputedStyle(element).overflowY,
      };
    };
    const image = document.querySelector("#browser-image");
    const rect = box(image);
    // object-fit: contain centers the actual frame inside the image element.
    // A tall image box can otherwise pass visibility checks while its pixels are
    // thousands of pixels below the viewport in an empty letterboxed area.
    const scale = Math.min(
      rect.width / image.naturalWidth,
      rect.height / image.naturalHeight,
    );
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    const painted = {
      x: rect.x + (rect.width - width) / 2,
      y: rect.y + (rect.height - height) / 2,
      width,
      height,
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      pageScrollY: scrollY,
      sidebar: scrollBox(".sidebar"),
      stateTreeVisible:
        document.querySelector("#state-tree").getBoundingClientRect().height >
        0,
      browser: box(document.querySelector(".browser-panel")),
      image: rect,
      painted,
      execution: box(document.querySelector(".execution-panel")),
      flow: box(document.querySelector(".flow-region")),
      catalog: scrollBox(".action-catalog"),
    };
  });
}

for (const width of [732, 747, 920, 390, 1440]) {
  test(`large state hierarchy preserves usable viewer layout at ${width}x888`, async () => {
    await withViewer(
      `large-model-${width}x888`,
      async ({ ui, calls }) => {
        const geometry = await readLargeModelGeometry(ui);
        await writeFile(
          join(evidence, `large-model-geometry-${width}x888.json`),
          JSON.stringify(geometry, null, 2),
        );
        await ui.screenshot({
          path: join(evidence, `large-model-initial-${width}x888.png`),
          fullPage: false,
        });
        assert.ok(
          geometry.sidebar.height <= 888,
          `The state sidebar must be bounded by the viewport: ${JSON.stringify(geometry.sidebar)}`,
        );
        assert.ok(
          geometry.browser.height <= 888,
          `The browser panel must not stretch with the state list: ${JSON.stringify(geometry.browser)}`,
        );
        assert.ok(
          geometry.painted.y < 888 * 0.65,
          `Actual frame pixels must start near the top: ${JSON.stringify(geometry.painted)}`,
        );
        const visiblePaintedHeight = Math.max(
          0,
          Math.min(888, geometry.painted.y + geometry.painted.height) -
            Math.max(0, geometry.painted.y),
        );
        assert.ok(
          visiblePaintedHeight >= 120,
          `The initial viewport must show useful frame content: ${visiblePaintedHeight}px`,
        );
        assert.ok(
          geometry.execution.height <= 888,
          "Execution panel must keep its natural content height",
        );
        assert.ok(
          geometry.flow.height <= 888,
          "Flow panel must keep its natural content height",
        );
        assert.ok(
          geometry.catalog.height <= 888,
          "Command catalog must be bounded",
        );
        assert.ok(
          geometry.catalog.scrollHeight > geometry.catalog.clientHeight,
          "Large command catalog must scroll independently",
        );
        assert.match(geometry.catalog.overflowY, /auto|scroll/);
        assert.ok(
          geometry.documentWidth <= width,
          "Large labels must not create page-wide horizontal scrolling",
        );

        if (geometry.stateTreeVisible) {
          assert.ok(
            geometry.sidebar.scrollHeight > geometry.sidebar.clientHeight,
            "The large state list must scroll within its bounded sidebar",
          );
          assert.match(geometry.sidebar.overflowY, /auto|scroll/);
          await ui.locator(".sidebar").evaluate((element) => {
            element.scrollTop = element.scrollHeight;
          });
          const afterStateScroll = await readLargeModelGeometry(ui);
          assert.ok(afterStateScroll.sidebar.scrollTop > 0);
          assert.equal(
            afterStateScroll.painted.y,
            geometry.painted.y,
            "Reading later states must not push the browser image into blank space",
          );
          assert.equal(afterStateScroll.pageScrollY, geometry.pageScrollY);
        }
        await ui.locator(".action-catalog").evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        const afterCatalogScroll = await readLargeModelGeometry(ui);
        assert.ok(afterCatalogScroll.catalog.scrollTop > 0);
        assert.equal(
          afterCatalogScroll.browser.height,
          geometry.browser.height,
        );
        assert.equal(
          afterCatalogScroll.painted.y,
          geometry.painted.y,
          "Reading later commands must not move the application image",
        );
        assert.deepEqual(
          calls,
          [],
          "Reading a large model must not execute application actions",
        );
      },
      {
        active: true,
        viewport: { width, height: 888 },
        extraStates: largeStateHierarchy,
      },
    );
  });
}
