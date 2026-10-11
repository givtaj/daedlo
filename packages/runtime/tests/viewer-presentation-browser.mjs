// Viewer contract checks in real Chromium; this fixture is not customer acceptance.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { createViewer } from "../src/viewer/server.mjs";

test("presentation viewer renders human pacing and operates controls without replay", async () => {
  const browser = await chromium.launch({ headless: true });
  let viewer;
  let finish;
  const calls = [];
  const snapshot = {
    connected: true,
    descriptor: {
      id: "viewer-contract",
      version: "1",
      label: "Viewer contract fixture",
      states: [
        {
          id: "app-paused",
          label: "Application request paused",
          parent: null,
          support: "supported",
        },
      ],
      commands: [
        { id: "inspect", label: "Inspect", params: {} },
        {
          id: "recipe_evidence",
          label: "Internal evidence",
          params: {},
          recipeOnly: true,
        },
      ],
      recipes: [],
    },
    revision: "observed-r1",
    state: { id: "app-paused" },
    commands: [{ id: "inspect", enabled: true }],
    recipes: [],
    presentations: [],
    presentation: null,
    display: [],
    execution: "idle",
    busy: false,
    paused: false,
    speed: "slow",
  };
  const session = {
    snapshot: async () => structuredClone(snapshot),
    startPresentation: async (id, revision) => {
      calls.push(["start", id, revision]);
      snapshot.busy = true;
      snapshot.execution = "running";
      snapshot.presentation = {
        id,
        title: "Inspect request",
        status: "running",
        phase: "holding",
        stage: 1,
        total: 2,
        stageId: "run-1:stage-1",
        stageTitle: "Original <request>",
        explanation: "Inspect the original fields before advancing.",
        holdMs: 18000,
        remainingMs: 14500,
        manual: false,
      };
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    advancePresentation: async (stageId) => {
      calls.push(["advance", stageId]);
      if (session.refuseAdvance)
        return {
          ok: false,
          error_code: "stale_stage",
          error: "This stage has already advanced; inspect the current stage.",
        };
      snapshot.presentation.phase = "executing";
      return { ok: true };
    },
    pause: async () => {
      calls.push(["pause"]);
      snapshot.paused = true;
    },
    resume: async () => {
      calls.push(["resume"]);
      snapshot.paused = false;
    },
    stop: async () => {
      calls.push(["stop"]);
      snapshot.busy = false;
      snapshot.paused = false;
      snapshot.execution = "stopped";
      snapshot.presentation.status = "stopped";
      snapshot.presentation.phase = "finished";
      finish?.({
        ok: false,
        execution: "stopped",
        outcome: { kind: "unknown", label: "No application success claimed" },
      });
    },
    setSpeed: async (speed) => {
      calls.push(["speed", speed]);
      snapshot.speed = speed;
    },
    command: async (body) => {
      calls.push(["command", body]);
      return { ok: true, execution: "completed" };
    },
  };
  try {
    const context = await browser.newContext({
      viewport: { width: 900, height: 620 },
    });
    const page = await context.newPage();
    await page.setContent(
      "<h1>Viewer contract fixture</h1><p>Application request paused</p>",
    );
    viewer = await createViewer({ page, context, session });
    const monitor = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const ui = await monitor.newPage();
    await ui.goto(viewer.url);
    await ui.waitForFunction(
      () => document.querySelector("#connection").textContent === "Connected",
    );
    assert.equal(await ui.locator('[data-command-id="inspect"]').count(), 1);
    assert.equal(
      await ui.locator('[data-command-id="recipe_evidence"]').count(),
      0,
    );
    assert.equal(
      await ui.locator("#presentation-panel").count(),
      1,
      "Presentation UI must exist and stay hidden without authored presentations",
    );
    assert.equal(await ui.locator("#presentation-panel").isVisible(), false);
    assert.equal(await ui.locator("#presentation-catalog").isVisible(), false);
    snapshot.presentations = [
      {
        id: "tour",
        title: "Inspect request",
        explanation: "Show the existing request at a human pace.",
        enabled: true,
      },
      {
        id: "blocked",
        title: "Unavailable tour",
        explanation: "Requires another state.",
        enabled: false,
        reason: "Finish the existing request first.",
      },
    ];
    await ui.locator('[data-presentation="tour"]').waitFor();
    assert.equal(
      await ui.locator('[data-presentation="blocked"]').isDisabled(),
      true,
    );
    assert.match(
      await ui.locator("#presentation-catalog").innerText(),
      /Finish the existing request first/,
    );
    await ui.locator('[data-presentation="tour"]').click();
    await ui.locator("#presentation-panel").waitFor();
    await ui.waitForFunction(
      () =>
        document.querySelector("#presentation-stage").textContent ===
        "Original <request>",
    );
    assert.deepEqual(calls[0], ["start", "tour", "observed-r1"]);
    assert.deepEqual(
      {
        message: await ui.locator("#action-message").innerText(),
        outcome: await ui.locator("#outcome-label").innerText(),
      },
      {
        message: "Presentation running…",
        outcome: "Run in progress; final application outcome pending",
      },
    );
    assert.equal(await ui.locator("#presentation-stage request").count(), 0);
    assert.match(
      await ui.locator("#presentation-progress").innerText(),
      /Stage 1 of 2/,
    );
    assert.match(
      await ui.locator("#presentation-phase").innerText(),
      /Holding/,
    );
    assert.match(
      await ui.locator("#presentation-hold").innerText(),
      /15s remaining/,
    );
    assert.match(
      await ui.locator("#presentation-panel").innerText(),
      /Stage captions.*application success/i,
    );
    assert.equal(
      await ui.locator('[data-command="inspect"]').isDisabled(),
      true,
    );
    assert.equal(
      await ui.locator("#pause").isEnabled(),
      true,
      "Pause remains available while the start request waits for the presentation",
    );
    await ui.locator("#pause").click();
    await ui.waitForFunction(
      () =>
        document.querySelector("#execution-state").textContent ===
        "Driver paused",
    );
    assert.match(await ui.locator("#presentation-phase").innerText(), /Paused/);
    assert.equal(await ui.locator("#advance").isDisabled(), true);
    assert.match(
      await ui.locator("#state-label").innerText(),
      /Application request paused/,
    );
    await ui.locator("#resume").click();
    await ui.waitForFunction(
      () => !document.querySelector("#advance").disabled,
    );
    session.refuseAdvance = true;
    await ui.locator("#advance").click();
    await ui.waitForFunction(() =>
      document
        .querySelector("#action-message")
        .textContent.includes("This stage has already advanced"),
    );
    session.refuseAdvance = false;
    await ui.locator("#advance").dispatchEvent("click");
    await ui.locator("#advance").dispatchEvent("click");
    await ui.waitForFunction(() =>
      document
        .querySelector("#presentation-phase")
        .textContent.includes("Executing"),
    );
    assert.equal(
      calls.filter(([action]) => action === "advance").length,
      2,
      "One refused click and one accepted advance; double click never queues another stage",
    );
    assert.deepEqual(calls.filter(([action]) => action === "advance").at(-1), [
      "advance",
      "run-1:stage-1",
    ]);
    snapshot.presentation = {
      ...snapshot.presentation,
      stage: 2,
      stageId: "run-1:stage-2",
      stageTitle: "Edited request",
      phase: "holding",
      manual: true,
      remainingMs: 0,
    };
    await ui.waitForFunction(() =>
      document
        .querySelector("#presentation-hold")
        .textContent.includes("Waiting for Advance"),
    );
    await ui.locator("#speed").selectOption("fast");
    assert.equal(snapshot.presentation.manual, true);
    assert.equal(snapshot.presentation.holdMs, 18000);
    snapshot.lastResult = {
      execution: "completed",
      outcome: { kind: "success", label: "Prior observed outcome" },
      effect: { status: "not_attempted" },
    };
    await ui.waitForFunction(
      () =>
        document.querySelector("#outcome-label").textContent ===
        "Prior observed outcome",
    );
    await ui.evaluate(() => window.scrollTo(0, 0));
    const pauseBox = await ui.locator("#pause").boundingBox();
    assert.ok(
      pauseBox.y + pauseBox.height <= 1000,
      "Presenter controls must remain visible beside the application at desktop viewport size",
    );
    const out = resolve("artifacts/presentation-20261009");
    await mkdir(out, { recursive: true });
    await ui.screenshot({
      path: resolve(out, "viewer-contract-hold.png"),
      fullPage: true,
    });
    await ui.locator("#stop").click();
    await ui.waitForFunction(
      () =>
        document.querySelector("#presentation-phase").textContent === "Stopped",
    );
    assert.equal(await ui.locator("#advance").isDisabled(), true);
    const starts = calls.filter(([action]) => action === "start").length;
    await ui.reload();
    await ui.waitForFunction(
      () => document.querySelector("#connection").textContent === "Connected",
    );
    assert.equal(calls.filter(([action]) => action === "start").length, starts);
    snapshot.presentation.status = "halted";
    snapshot.presentation.reason =
      "The observed request changed. Inspect the application before starting again.";
    await ui.waitForFunction(
      () =>
        document.querySelector("#presentation-phase").textContent === "Halted",
    );
    assert.match(
      await ui.locator("#presentation-reason").innerText(),
      /observed request changed/,
    );
    snapshot.connected = false;
    await ui.waitForFunction(
      () =>
        document.querySelector("#connection").textContent === "Disconnected",
    );
    assert.equal(
      await ui.locator('[data-presentation="tour"]').isDisabled(),
      true,
    );
    assert.equal(await ui.locator("#advance").isDisabled(), true);
    await ui.screenshot({
      path: resolve(out, "viewer-contract-halted.png"),
      fullPage: true,
    });
    await viewer.close();
    assert.equal(
      page.isClosed(),
      false,
      "Closing the viewer preserves the attached controlled page",
    );
  } finally {
    await viewer?.close();
    await browser.close();
  }
});

test("viewer preserves intentional empty text while leaving untouched optional parameters omitted", async () => {
  const browser = await chromium.launch({ headless: true });
  let viewer;
  const calls = [];
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent("<h1>Independent parameter fixture</h1>");
    const snapshot = {
      connected: true,
      descriptor: {
        id: "parameter-fixture",
        version: "1",
        label: "Parameter fixture",
        states: [
          { id: "ready", label: "Ready", parent: null, support: "supported" },
        ],
        commands: [
          {
            id: "edit",
            label: "Apply draft",
            params: {
              notes: { type: "text", label: "Notes" },
              untouched: { type: "text", label: "Untouched" },
              count: { type: "number", label: "Count" },
            },
          },
        ],
        recipes: [],
      },
      revision: "observed-r1",
      state: { id: "ready" },
      commands: [{ id: "edit", enabled: true }],
      recipes: [],
      display: [],
      execution: "idle",
      busy: false,
      paused: false,
      speed: "normal",
    };
    const session = {
      snapshot: async () => structuredClone(snapshot),
      command: async (command) => {
        calls.push(structuredClone(command));
        return {
          ok: true,
          execution: "completed",
          outcome: { kind: "success", label: "Observed draft" },
          effect: { status: "not_attempted" },
        };
      },
    };
    viewer = await createViewer({ page, context, session });
    const ui = await browser.newPage();
    await ui.goto(viewer.url);
    const submit = async () => {
      const [response] = await Promise.all([
        ui.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/command" &&
            response.request().method() === "POST",
        ),
        ui.getByRole("button", { name: "Apply draft", exact: true }).click(),
      ]);
      assert.equal(response.status(), 200);
      return calls.at(-1).params;
    };
    assert.deepEqual(
      await submit(),
      {},
      "Untouched optional values must remain omitted",
    );
    await ui.getByLabel("Notes", { exact: true }).fill("Clear this draft");
    await ui.getByLabel("Count", { exact: true }).fill("4");
    assert.deepEqual(await submit(), { notes: "Clear this draft", count: 4 });
    await ui.getByLabel("Notes", { exact: true }).fill("");
    await ui.getByLabel("Count", { exact: true }).fill("");
    assert.deepEqual(
      await submit(),
      { notes: "" },
      "An explicitly cleared text value must reach the application as an empty string",
    );
    await ui.reload();
    assert.deepEqual(
      await submit(),
      {},
      "Reload does not replay earlier parameter intent",
    );
    await viewer.close();
    assert.equal(page.isClosed(), false);
  } finally {
    await viewer?.close();
    await browser.close();
  }
});
