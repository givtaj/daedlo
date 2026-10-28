// Real Chromium presentation checks over synthetic reports; not customer acceptance.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { createViewer } from "../src/viewer/server.mjs";

const result = (runId, overrides = {}) => ({
  runId,
  execution: "completed",
  outcome: { kind: "success", label: "Saved" },
  effect: { status: "saved" },
  startedAt: "2026-10-28T10:00:00.000Z",
  finishedAt: "2026-10-28T10:00:01.000Z",
  ...overrides,
});

test("viewer attributes retained results through running, refresh and terminal transitions", async () => {
  const root = resolve(
    process.env.RESULT_ATTRIBUTION_OUTPUT ||
      "artifacts/result-attribution/browser",
  );
  await mkdir(root, { recursive: true });
  const output = await mkdtemp(join(root, "run-"));
  const receipt = {
    scope: "Synthetic viewer conformance",
    screenshots: [],
    errors: [],
    cleanup: {},
  };
  let browser, viewer;
  const snapshot = {
    connected: true,
    descriptor: {
      id: "result-fixture",
      version: "1",
      label: "Result attribution fixture",
      states: [
        { id: "ready", label: "Ready", parent: null, support: "supported" },
      ],
      commands: [],
      recipes: [],
    },
    revision: "fixture-r1",
    state: { id: "ready" },
    commands: [],
    recipes: [],
    display: [],
    execution: "completed",
    busy: false,
    paused: false,
    speed: "fast",
    runId: "run-A",
    lastResult: result("run-A"),
  };
  let calls = 0;
  try {
    browser = await chromium.launch({ headless: true });
    const application = await browser.newPage();
    await application.setContent(
      "<h1>Synthetic result fixture</h1><p>Viewer conformance only.</p>",
    );
    viewer = await createViewer({
      page: application,
      context: application.context(),
      session: {
        snapshot: async () => structuredClone(snapshot),
        command: async () => {
          calls++;
          throw Error("No dispatch expected");
        },
      },
    });
    const ui = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    ui.on("pageerror", (error) => receipt.errors.push(error.message));
    await ui.goto(viewer.url);
    await ui.waitForFunction(
      () => document.querySelector("#outcome-label").textContent === "Saved",
    );
    snapshot.runId = "run-B";
    snapshot.execution = "running";
    snapshot.busy = true;
    await ui.waitForFunction(
      () => document.querySelector("#run-id").textContent === "Run run-B",
    );
    assert.equal(
      await ui.locator("#active-result").count(),
      1,
      "Run B needs its own pending application outcome instead of borrowing A's success",
    );
    const pending = async () => {
      assert.equal(await ui.locator("#active-result").isVisible(), true);
      assert.match(
        await ui.locator("#active-result").innerText(),
        /final application outcome pending/,
      );
      assert.equal(
        await ui.locator("#active-result").getAttribute("data-run-id"),
        snapshot.runId,
      );
      assert.equal(
        await ui.locator("#active-result .outcome-success").count(),
        0,
      );
      assert.equal(
        await ui.locator("#last-result").getAttribute("data-attribution"),
        "previous",
      );
      assert.equal(
        await ui.locator("#result-heading").innerText(),
        "Previous run result",
      );
      assert.match(
        await ui.locator("#result-identity").innerText(),
        /Run run-A/,
      );
      assert.match(
        await ui.locator("#result-identity").innerText(),
        /2026-10-28T10:00:01.000Z/,
      );
      assert.equal(await ui.locator("#outcome-kind").innerText(), "Success");
      assert.equal(
        snapshot.lastResult.runId,
        "run-A",
        "Rendering must preserve canonical history",
      );
    };
    await pending();
    await ui.reload();
    await ui.waitForFunction(
      () => document.querySelector("#run-id").textContent === "Run run-B",
    );
    await pending();
    const capture = async (name, width, height) => {
      await ui.setViewportSize({ width, height });
      const layout = await ui.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      assert.equal(
        layout.scroll,
        layout.width,
        "Result identities must wrap without horizontal overflow",
      );
      await ui.screenshot({
        path: join(output, `${name}.png`),
        fullPage: true,
      });
      receipt.screenshots.push({ name, width, height });
    };
    await capture("running-desktop", 1440, 1000);
    await capture("running-narrow", 390, 844);
    const cases = [
      ["success", result("run-B-success")],
      [
        "rejected",
        result("run-B-rejected", {
          execution: "rejected",
          outcome: null,
          effect: { status: "not_attempted" },
        }),
      ],
      [
        "failed",
        result("run-B-failed", {
          execution: "failed",
          error: "Fixture failure",
          outcome: { kind: "unknown", label: "Effect unconfirmed" },
          effect: { status: "uncertain" },
        }),
      ],
      [
        "stopped",
        result("run-B-stopped", {
          execution: "stopped",
          outcome: { kind: "unknown", label: "Stopped after dispatch" },
          effect: { status: "saved" },
        }),
      ],
      [
        "cleanup",
        result("run-B-cleanup", {
          ok: false,
          cleanupFailed: true,
          effect: {
            status: "uncertain",
            operations: [
              { id: "setup", label: "Setup write", status: "saved" },
              { id: "edit", label: "Requested edit", status: "uncertain" },
              { id: "later", label: "Later write", status: "not_attempted" },
            ],
          },
        }),
      ],
      [
        "validation",
        result("run-B-validation", {
          outcome: { kind: "validation", label: "Needs correction" },
          effect: undefined,
        }),
      ],
    ];
    for (const [name, finished] of cases) {
      Object.assign(snapshot, {
        runId: finished.runId,
        busy: true,
        execution: "running",
        lastResult: result("run-A"),
      });
      await ui.waitForFunction(
        (id) => document.querySelector("#run-id").textContent === `Run ${id}`,
        finished.runId,
      );
      await pending();
      Object.assign(snapshot, {
        busy: false,
        execution: finished.execution,
        lastResult: finished,
      });
      await ui.waitForFunction(
        () => document.querySelector("#active-result").hidden,
      );
      assert.equal(
        await ui.locator("#last-result").getAttribute("data-attribution"),
        "current",
      );
      assert.equal(
        await ui.locator("#result-heading").innerText(),
        "Current run result",
      );
      assert.ok(
        (await ui.locator("#result-identity").innerText()).includes(
          finished.runId,
        ),
      );
      const expectedExecution =
        finished.execution[0].toUpperCase() + finished.execution.slice(1);
      assert.ok(
        (await ui.locator("#effect-label").innerText()).includes(
          `Execution: ${expectedExecution}`,
        ),
      );
      assert.equal(
        await ui.locator("#outcome-kind").innerText(),
        finished.outcome?.kind === "success"
          ? "Success"
          : finished.outcome?.kind === "validation"
            ? "Validation"
            : "Unknown",
      );
      if (name === "cleanup") {
        assert.match(
          await ui.locator("#effect-label").innerText(),
          /Application effect: Uncertain.*cleanup incomplete/,
        );
        assert.match(
          await ui.locator("#effect-operations").innerText(),
          /Setup write: Saved\s+Requested edit: Uncertain\s+Later write: Not attempted/,
        );
        await capture("cleanup-narrow", 390, 844);
      }
      if (name === "validation") {
        assert.match(
          await ui.locator("#effect-label").innerText(),
          /Persistence not confirmed/,
        );
        assert.equal(await ui.locator("#effect-operations").isVisible(), false);
      }
    }
    snapshot.paused = true;
    await ui.waitForFunction(
      () =>
        document.querySelector("#execution-state").textContent ===
        "Driver paused",
    );
    assert.equal(
      await ui.locator("#active-result").isVisible(),
      false,
      "Paused alone must not erase a completed result",
    );
    Object.assign(snapshot, {
      paused: false,
      busy: true,
      execution: "running",
      runId: "presentation-B",
      lastResult: result("run-A"),
      presentation: {
        id: "tour",
        title: "Inspect result",
        status: "running",
        phase: "holding",
        stage: 1,
        total: 1,
        stageId: "presentation-B:1",
        stageTitle: "Inspect",
        explanation: "Synthetic stage caption",
        holdMs: 10000,
        remainingMs: 8000,
      },
    });
    await ui.waitForFunction(
      () =>
        document.querySelector("#run-id").textContent === "Run presentation-B",
    );
    await pending();
    await capture("presentation-desktop", 1440, 1000);
    await capture("presentation-narrow", 390, 844);
    snapshot.paused = true;
    await ui.waitForFunction(
      () =>
        document.querySelector("#execution-state").textContent ===
        "Driver paused",
    );
    await pending();
    snapshot.lastResult = result("presentation-B", { finishedAt: undefined });
    await ui.waitForFunction(
      () => document.querySelector("#last-result").hidden,
    );
    assert.equal(
      await ui.locator("#active-result").isVisible(),
      true,
      "Matching result remains pending while finalization is active",
    );
    Object.assign(snapshot, {
      busy: false,
      paused: false,
      execution: "stopped",
      lastResult: result("presentation-B", {
        execution: "stopped",
        outcome: { kind: "unknown", label: "Presentation stopped" },
      }),
      presentation: {
        ...snapshot.presentation,
        status: "stopped",
        phase: "finished",
      },
    });
    await ui.waitForFunction(
      () =>
        document.querySelector("#presentation-phase").textContent === "Stopped",
    );
    assert.equal(
      await ui.locator("#last-result").getAttribute("data-attribution"),
      "current",
    );
    snapshot.lastResult = {
      execution: "completed",
      outcome: { kind: "success", label: "<untrusted result>" },
    };
    await ui.waitForFunction(
      () =>
        document.querySelector("#outcome-label").textContent ===
        "<untrusted result>",
    );
    assert.equal(
      await ui.locator("#last-result").getAttribute("data-attribution"),
      "unattributed",
    );
    assert.match(
      await ui.locator("#result-identity").innerText(),
      /Run identity unavailable.*Completion time unavailable/,
    );
    assert.equal(await ui.locator("#outcome-label untrusted").count(), 0);
    Object.assign(snapshot, {
      busy: true,
      lastResult: null,
      runId: "no-history",
    });
    await ui.waitForFunction(
      () => document.querySelector("#run-id").textContent === "Run no-history",
    );
    assert.equal(await ui.locator("#active-result").isVisible(), true);
    assert.equal(await ui.locator("#last-result").isVisible(), false);
    Object.assign(snapshot, {
      busy: false,
      runId: null,
      execution: "idle",
      presentation: null,
    });
    await ui.waitForFunction(
      () => document.querySelector("#execution-state").textContent === "Idle",
    );
    assert.equal(await ui.locator("#active-result").isVisible(), false);
    assert.equal(await ui.locator("#outcome-kind").isVisible(), false);
    assert.equal(
      await ui.locator("#outcome-label").innerText(),
      "No action has run yet",
    );
    assert.equal(
      calls,
      0,
      "Refresh and presentation rendering must not dispatch commands",
    );
    assert.deepEqual(receipt.errors, []);
    await viewer.close();
    receipt.cleanup.viewer = "closed";
    assert.equal(
      application.isClosed(),
      false,
      "Attached application survives viewer close",
    );
    receipt.status = "PASS";
  } catch (error) {
    receipt.status = "FAIL";
    receipt.failure = error.message;
    throw error;
  } finally {
    try {
      await viewer?.close();
      receipt.cleanup.viewer = "closed";
    } finally {
      await browser?.close();
      receipt.cleanup.browser = "closed";
      await writeFile(
        join(output, "receipt.json"),
        JSON.stringify(receipt, null, 2),
      );
    }
    console.log(`Result attribution evidence: ${output}`);
  }
});
