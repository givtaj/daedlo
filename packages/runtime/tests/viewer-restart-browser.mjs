// Real application stop/restart with an attached browser; synthetic acceptance only.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chmod, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { createDriverSession, createViewer } from "../src/index.mjs";

test(
  "an application rebuild preserves the attached viewer and completed result without replay",
  { timeout: 30000 },
  async () => {
    let writes = 0;
    const app = createServer((req, res) => {
      if (req.method === "POST" && req.url === "/save") writes++;
      if (req.url === "/ready" || req.url === "/save") {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify({ saved: writes > 0 }));
      } else {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<!doctype html><title>Development restart fixture</title><h1>Application rebuild fixture</h1><p>The browser remains open while the application restarts.</p>",
        );
      }
    });
    const listen = (port = 0) =>
      new Promise((done, reject) => {
        app.once("error", reject);
        app.listen(port, "127.0.0.1", () => {
          app.off("error", reject);
          done();
        });
      });
    const stopApp = async () => {
      if (!app.listening) return;
      await new Promise((done, reject) => {
        app.close((error) => (error ? reject(error) : done()));
        app.closeAllConnections();
      });
    };
    let browser, driver, viewer;
    try {
      await listen();
      const port = app.address().port;
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${port}`);
      const enginePath = fileURLToPath(
        new URL("./fake-engine.mjs", import.meta.url),
      );
      await chmod(enginePath, 0o755);
      driver = await createDriverSession({
        page,
        context,
        enginePath,
        adapter: {
          model: { id: "test", version: "1" },
          observe: async () => {
            const observation = await page.evaluate(async () => {
              try {
                const response = await fetch("/ready", {
                  cache: "no-store",
                  signal: AbortSignal.timeout(1000),
                });
                if (!response.ok) return null;
                return await response.json();
              } catch {
                return null;
              }
            });
            return {
              connected: observation !== null,
              session: "restart-fixture",
              facts: { text: "Fixture", saved: observation?.saved === true },
            };
          },
          handlers: {
            edit: async () => {},
            save: async (_params, execution) =>
              execution.effect(() =>
                page.evaluate(async () => {
                  const response = await fetch("/save", { method: "POST" });
                  if (!response.ok) throw Error("Synthetic save failed");
                  await response.json();
                }),
              ),
          },
          effectStatus: () => ({
            status: writes > 0 ? "saved" : "not_attempted",
          }),
        },
      });
      driver.setSpeed("fast");
      viewer = await createViewer({ page, context, session: driver });
      const ui = await browser.newPage({
        viewport: { width: 1280, height: 800 },
      });
      ui.setDefaultTimeout(5000);
      await ui.goto(viewer.url);
      await ui.waitForFunction(
        () => document.querySelector("#connection").textContent === "Connected",
      );
      const result = await driver.execute(
        "save",
        {},
        (await driver.snapshot()).revision,
      );
      assert.equal(result.outcome.kind, "success");
      assert.equal(writes, 1);
      await ui.waitForFunction(
        (id) => document.querySelector("#last-result").textContent.includes(id),
        result.runId,
      );
      const completed = driver.report({ runId: result.runId });
      await stopApp();
      await ui.waitForFunction(
        () => document.querySelector("#connection").textContent !== "Connected",
      );
      assert.equal(
        await ui.locator("#execution-state").innerText(),
        "Completed",
        "A rebuild must not replace the completed execution with a connection failure",
      );
      assert.equal(page.isClosed(), false);
      for (const channel of ["viewer", "browser"])
        assert.equal(
          await ui
            .locator(`[data-channel="${channel}"]`)
            .getAttribute("data-status"),
          "success",
          "An application outage must not mark its attached viewer or browser disconnected",
        );
      assert.equal(
        await ui
          .locator('[data-channel="application"]')
          .getAttribute("data-status"),
        "warning",
      );
      assert.equal(
        await ui.locator('button[data-command="save"]').isDisabled(),
        true,
      );
      assert.equal(writes, 1);
      const evidence = resolve("artifacts/dev-restart-alerts");
      await mkdir(evidence, { recursive: true });
      await ui.screenshot({
        path: `${evidence}/application-rebuilding.png`,
        fullPage: true,
      });
      await listen(port);
      await ui.waitForFunction(
        () => document.querySelector("#connection").textContent === "Connected",
      );
      assert.equal(
        await ui.locator('button[data-command="save"]').isEnabled(),
        true,
      );
      assert.equal(
        await ui
          .locator('[data-channel="application"]')
          .getAttribute("data-status"),
        "success",
      );
      assert.equal(
        writes,
        1,
        "Fresh status after restart must not repeat the completed write",
      );
      assert.deepEqual(driver.report({ runId: result.runId }), completed);
      await ui.screenshot({
        path: `${evidence}/application-recovered.png`,
        fullPage: true,
      });

      // Close immediately after a new result while polling is unavailable. The
      // terminal event must carry the completed report rather than retain an
      // earlier run or invent a result from an unfinalized snapshot.
      await ui.route("**/status", (route) => route.abort("failed"));
      const final = await driver.execute(
        "save",
        {},
        (await driver.snapshot()).revision,
      );
      assert.notEqual(final.runId, result.runId);
      assert.equal(writes, 2);
      await viewer.close();
      await ui.waitForFunction(
        () =>
          document.querySelector("#connection").textContent === "Viewer closed",
      );
      assert.equal(page.isClosed(), false);
      assert.equal(
        await ui.locator("#result-identity").innerText(),
        `Run ${final.runId} · Finished ${final.finishedAt}`,
      );
      assert.equal(
        await ui.locator("#execution-state").innerText(),
        "Completed",
      );
      assert.equal(
        await ui.locator("#run-id").innerText(),
        `Run ${final.runId}`,
      );
      assert.equal(
        await ui
          .locator("#progress-bar")
          .evaluate(
            (bar) =>
              bar.classList.contains("running") ||
              bar.classList.contains("paused"),
          ),
        false,
      );
      assert.equal(
        await ui.locator("#progress-label").innerText(),
        "Run finished; step progress unavailable",
      );
      assert.equal(writes, 2);
      await ui.screenshot({
        path: `${evidence}/viewer-closed.png`,
        fullPage: true,
      });
    } finally {
      await viewer?.close();
      await driver?.close();
      await browser?.close();
      await stopApp();
    }
  },
);
