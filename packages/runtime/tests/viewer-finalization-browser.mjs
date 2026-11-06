// Synthetic finalization conformance in Chromium, not customer acceptance.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createDriverSession, createViewer } from "../src/index.mjs";

const enginePath = fileURLToPath(new URL("./fake-engine.mjs", import.meta.url));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const outputRoot = resolve(
  process.env.FINALIZATION_VIEWER_OUTPUT || "artifacts/ci-stalled-hooks/viewer",
);

test("viewer distinguishes pending finalization from a completed run", async () => {
  const browser = await chromium.launch({ headless: true });
  let viewer;
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent("<h1>Synthetic finalization contract fixture</h1>");
    const snapshot = {
      connected: true,
      descriptor: {
        id: "finalization-contract",
        version: "1",
        label: "Finalization contract",
        states: [{ id: "saved", label: "Saved", support: "supported" }],
        commands: [],
        recipes: [],
      },
      state: { id: "saved" },
      revision: "r1",
      commands: [],
      recipes: [],
      presentations: [],
      presentation: null,
      display: [],
      runId: "current-run",
      busy: true,
      paused: false,
      execution: "completed",
      finalization: {
        runId: "current-run",
        phase: "run_cleanup",
        status: "pending",
        stopRequested: false,
      },
      lastResult: {
        runId: "current-run",
        execution: "completed",
        outcome: { kind: "success", label: "Saved" },
        effect: { status: "saved" },
      },
    };
    viewer = await createViewer({
      page,
      context,
      session: { snapshot: async () => structuredClone(snapshot) },
    });
    const ui = await context.newPage();
    await ui.goto(viewer.url);
    await ui.waitForFunction(
      () => document.querySelector("#run-id").textContent === "Run current-run",
    );
    assert.equal(
      await ui.locator("#execution-state").innerText(),
      "Finalizing",
      "A completed action with unfinished cleanup is still finalizing",
    );
    assert.match(
      await ui.locator("#active-outcome-label").innerText(),
      /Waiting for run cleanup/,
    );
    assert.equal(await ui.locator("#last-result").isVisible(), false);
    snapshot.finalization.runId = "prior-run";
    snapshot.execution = "running";
    await ui.reload();
    await ui.waitForFunction(
      () => document.querySelector("#run-id").textContent === "Run current-run",
    );
    assert.equal(await ui.locator("#execution-state").innerText(), "Running");
    assert.doesNotMatch(
      await ui.locator("#active-outcome-label").innerText(),
      /Waiting for run cleanup/,
      "Finalization from another run must not be attributed to the current run",
    );
  } finally {
    await viewer?.close();
    await browser.close();
  }
});

test("grid flow ignores foreign and invalid finalization metadata", async () => {
  const browser = await chromium.launch({ headless: true });
  let viewer;
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent("<h1>Synthetic flow attribution fixture</h1>");
    const snapshot = {
      connected: true,
      descriptor: {
        id: "flow-finalization-contract",
        version: "1",
        label: "Flow finalization contract",
        states: [{ id: "ready", label: "Ready", support: "supported" }],
        commands: [{ id: "save", label: "Save fixture", params: {} }],
        recipes: [],
      },
      state: { id: "ready" },
      revision: "r1",
      commands: [{ id: "save", enabled: true }],
      recipes: [],
      display: [],
      runId: "current-run",
      activeRun: { command: "save", recipe: false },
      progress: { step: 0, total: 1, lastAction: "save" },
      busy: true,
      paused: false,
      execution: "running",
      lastResult: {
        runId: "previous-run",
        command: "save",
        recipe: false,
        execution: "completed",
        outcome: { kind: "success", label: "Prior save" },
        effect: { status: "saved" },
      },
    };
    viewer = await createViewer({
      page,
      context,
      session: { snapshot: async () => structuredClone(snapshot) },
    });
    const ui = await context.newPage();
    for (const invalid of [
      { runId: "previous-run", phase: "effect_evidence", status: "pending" },
      { runId: "current-run", phase: "unknown_phase", status: "pending" },
      { runId: "current-run", phase: "effect_evidence", status: "unknown" },
    ]) {
      snapshot.finalization = { ...invalid, stopRequested: true };
      await ui.goto(viewer.url);
      await ui.waitForFunction(
        () =>
          document.querySelector("#flow-panel").dataset.runId === "current-run",
      );
      assert.equal(await ui.locator("#flow-title").innerText(), "Save fixture");
      assert.match(await ui.locator("#flow-status").innerText(), /^Running/);
      assert.equal(
        await ui.locator('#flow-steps [aria-current="step"]').count(),
        1,
      );
      assert.equal(
        await ui.locator("#last-result").getAttribute("data-attribution"),
        "previous",
      );
      assert.equal(await ui.locator("#finalization-detail").isVisible(), false);
    }
  } finally {
    await viewer?.close();
    await browser.close();
  }
});

for (const phase of ["effect_evidence", "run_cleanup"]) {
  test(
    `real session shows stalled ${phase}, Stop, and late settlement without replay`,
    { timeout: 30000 },
    async () => {
      await mkdir(outputRoot, { recursive: true });
      const output = await mkdtemp(join(outputRoot, `${phase}-`));
      const entered = deferred(),
        release = deferred();
      const receipt = { status: "RUNNING", cleanup: {}, screenshots: [] };
      let browser, driver, viewer, running, ui, failure;
      let hookCalls = 0,
        cleanupCalls = 0,
        signal;
      const errors = [];
      try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.setContent(`<!doctype html><h1>Synthetic save fixture</h1><button id="save">Save</button><output id="writes">0</output><script>
          document.querySelector('#save').onclick = () => {
            const writes = document.querySelector('#writes');
            writes.textContent = String(Number(writes.textContent) + 1);
          };
        </script>`);
        const writes = async () =>
          Number(await page.locator("#writes").innerText());
        const hold = async (info) => {
          hookCalls++;
          signal = info?.signal;
          entered.resolve();
          await release.promise;
        };
        driver = await createDriverSession({
          page,
          context,
          enginePath,
          finalizationWaitMs: 1000,
          adapter: {
            model: { id: "test", version: "1" },
            observe: async () => ({
              connected: true,
              session: "finalization-browser",
              facts: { text: "Fixture", saved: (await writes()) > 0 },
            }),
            handlers: {
              edit: async () => {},
              save: async (_, execution) =>
                execution.click(page.locator("#save")),
            },
            effectStatus: async (info) => {
              if (phase === "effect_evidence") await hold(info);
              return { status: "saved" };
            },
            endRun: async (info) => {
              cleanupCalls++;
              if (phase === "run_cleanup") await hold(info);
            },
          },
        });
        driver.setSpeed("fast");
        viewer = await createViewer({ page, context, session: driver });
        const monitor = await browser.newContext({
          viewport: { width: 1440, height: 1000 },
        });
        ui = await monitor.newPage();
        ui.setDefaultTimeout(5000);
        ui.on("pageerror", (error) => errors.push(error.message));
        await ui.goto(viewer.url);
        await ui.waitForFunction(
          () =>
            document.querySelector("#connection").textContent === "Connected",
        );
        running = driver.execute(
          "save",
          {},
          (await driver.snapshot()).revision,
        );
        await entered.promise;
        const runId = driver.report().runId;
        const pending = await driver.snapshot();
        assert.equal(pending.finalization.phase, phase);
        assert.equal(pending.busy, true);
        assert.deepEqual(pending.activeRun, { command: "save", recipe: false });
        assert.equal(driver.report({ runId }), null);
        // Reload reads the held phase immediately rather than depending on polling timing.
        await ui.reload();
        await ui.waitForFunction(
          (id) => document.querySelector("#run-id").textContent.includes(id),
          runId,
        );
        const phaseLabel =
          phase === "effect_evidence"
            ? "Waiting for effect evidence"
            : "Waiting for run cleanup";
        assert.match(
          await ui.locator("#active-outcome-label").innerText(),
          new RegExp(phaseLabel),
        );
        assert.equal(
          await ui.locator("#execution-state").innerText(),
          "Finalizing",
        );
        assert.equal(
          await ui.locator("#flow-panel").getAttribute("data-run-id"),
          runId,
        );
        assert.equal(
          await ui.locator("#flow-title").innerText(),
          pending.descriptor.commands.find((command) => command.id === "save")
            .label,
        );
        assert.match(
          await ui.locator("#flow-status").innerText(),
          /^Finalizing/,
          "The authored flow must await same-run evidence and cleanup, not claim it is still running",
        );
        assert.equal(
          await ui.locator('#flow-steps [aria-current="step"]').count(),
          0,
        );
        assert.equal(await ui.locator("#last-result").isVisible(), false);
        await ui.waitForFunction(() =>
          document
            .querySelector("#finalization-detail")
            ?.textContent.includes("Taking longer than expected"),
        );
        await ui.locator("#stop").click();
        await ui.waitForFunction(() =>
          document
            .querySelector("#finalization-detail")
            ?.textContent.includes("Stop requested"),
        );
        assert.equal(signal?.aborted, true);
        assert.equal(driver.report({ runId }), null);
        assert.equal((await driver.snapshot()).busy, true);
        assert.equal(await writes(), 1);
        assert.equal(
          await ui.locator('[data-command="save"]').isDisabled(),
          true,
        );
        assert.equal(hookCalls, 1);
        assert.match(
          await ui.locator("#flow-status").innerText(),
          /^Finalizing/,
        );
        assert.equal(
          await ui.locator("#flow-panel").getAttribute("data-run-id"),
          runId,
        );
        await ui.screenshot({
          path: join(output, "stalled-desktop.png"),
          fullPage: true,
        });
        receipt.screenshots.push("stalled-desktop.png");
        await ui.setViewportSize({ width: 390, height: 844 });
        await ui.locator("#active-result").scrollIntoViewIfNeeded();
        const layout = await ui
          .locator("#finalization-detail")
          .evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            return {
              visible: element.checkVisibility(),
              textFits: element.scrollWidth <= element.clientWidth,
              left: bounds.left,
              right: bounds.right,
              width: window.innerWidth,
              pageWidth: document.documentElement.scrollWidth,
            };
          });
        assert.equal(layout.visible, true);
        assert.equal(layout.textFits, true);
        assert.ok(layout.left >= 0 && layout.right <= layout.width);
        assert.ok(layout.pageWidth <= layout.width);
        receipt.narrowLayout = layout;
        await ui.screenshot({ path: join(output, "stalled-narrow.png") });
        receipt.screenshots.push("stalled-narrow.png");
        await assert.rejects(driver.close({ timeoutMs: 25 }), {
          code: "cleanup_incomplete",
        });
        assert.equal(browser.isConnected(), true);
        assert.equal(page.isClosed(), false);
        assert.equal(ui.isClosed(), false);
        assert.equal(driver.report({ runId }), null);
        assert.equal(await writes(), 1);
        assert.equal(hookCalls, 1);
        // A bounded close failure keeps this owned viewer available. Observe a
        // later ordinary poll, not a synthetic snapshot or forced HTTP request.
        const statusResponse = await ui.waitForResponse(
          (response) =>
            response.url() === new URL("/status", viewer.url).href &&
            response.status() === 200,
        );
        const afterClose = await statusResponse.json();
        assert.equal(afterClose.connected, true);
        assert.equal(afterClose.driver.busy, true);
        assert.equal(afterClose.driver.finalization.phase, phase);
        assert.equal(afterClose.driver.finalization.stopRequested, true);
        assert.equal(await ui.locator("#active-result").isVisible(), true);
        assert.equal(
          await ui.locator("#execution-state").innerText(),
          "Finalizing",
        );
        receipt.closeWhilePending = {
          status: "cleanup_incomplete",
          browserPreserved: true,
          completedReportAbsent: true,
          viewerPolling: "PASS",
          writes: 1,
        };
        await ui.screenshot({ path: join(output, "close-pending-narrow.png") });
        receipt.screenshots.push("close-pending-narrow.png");
        await ui.reload();
        await ui.waitForFunction(() =>
          document
            .querySelector("#finalization-detail")
            ?.textContent.includes("Stop requested"),
        );
        assert.equal(
          await writes(),
          1,
          "Reload cannot replay the dispatched save",
        );
        release.resolve();
        const result = await running;
        assert.equal(result.effect.status, "saved");
        assert.equal(
          result.execution,
          phase === "effect_evidence" ? "stopped" : "completed",
        );
        assert.equal(hookCalls, 1);
        assert.equal(cleanupCalls, 1);
        assert.equal(await writes(), 1);
        assert.deepEqual(driver.report({ runId }).lastResult, result);
        await ui.waitForFunction(
          () => document.querySelector("#active-result").hidden,
        );
        assert.equal(
          await ui.locator("#finalization-detail").isVisible(),
          false,
        );
        assert.equal((await driver.snapshot()).finalization, null);
        assert.equal((await driver.snapshot()).activeRun, null);
        assert.equal(await ui.locator("#last-result").isVisible(), true);
        assert.match(
          await ui.locator("#flow-status").innerText(),
          new RegExp(
            `^${result.execution === "stopped" ? "Stopped" : "Completed"}`,
          ),
        );
        const completed = driver.report({ runId });
        await driver.close();
        assert.equal(browser.isConnected(), true);
        assert.equal(page.isClosed(), false);
        assert.equal(ui.isClosed(), false);
        assert.equal(await writes(), 1);
        assert.equal(hookCalls, 1);
        assert.equal(cleanupCalls, 1);
        assert.deepEqual(driver.report({ runId }), completed);
        receipt.closeRetry = {
          status: "PASS",
          attachedBrowserPreserved: true,
          hookCalls,
          cleanupCalls,
          writes: 1,
        };
        assert.deepEqual(errors, []);
        receipt.status = "PASS";
      } catch (error) {
        failure = error;
        receipt.status = "FAIL";
        receipt.failure = { message: error.message, code: error.code };
      } finally {
        release.resolve();
        driver?.stop();
        const cleanupErrors = [];
        for (const [name, close] of [
          ["run", () => running],
          ["viewer", () => viewer?.close()],
          ["session", () => driver?.close()],
          ["browser", () => browser?.close()],
        ]) {
          try {
            await close();
            receipt.cleanup[name] = "PASS";
          } catch (error) {
            receipt.cleanup[name] = "FAIL";
            cleanupErrors.push(error);
          }
        }
        if (cleanupErrors.length) {
          receipt.status = "FAIL";
          failure = new AggregateError([
            ...(failure ? [failure] : []),
            ...cleanupErrors,
          ]);
        }
        await writeFile(
          join(output, "receipt.json"),
          `${JSON.stringify(receipt, null, 2)}\n`,
        );
        console.log(`Finalization browser evidence: ${output}`);
      }
      if (failure) throw failure;
    },
  );
}
