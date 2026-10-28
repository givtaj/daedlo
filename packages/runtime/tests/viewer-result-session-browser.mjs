// Real-session Chromium result attribution; synthetic conformance, not customer acceptance.
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

test(
  "real session attributes retained results through a second run and pending cleanup",
  { timeout: 30000 },
  async () => {
    const root = resolve(
      process.env.RESULT_SESSION_OUTPUT ||
        "artifacts/result-attribution/session",
    );
    await mkdir(root, { recursive: true });
    const output = await mkdtemp(join(root, "run-"));
    const receipt = {
      status: "RUNNING",
      setup: "RUNNING",
      cleanup: {},
      screenshots: [],
    };
    const beginEntered = deferred(),
      beginRelease = deferred();
    const endEntered = deferred(),
      endRelease = deferred();
    let browser, driver, viewer, ui, running, failure;
    let runs = 0,
      transientOwned = false,
      replayedCommands = 0;
    const errors = [];
    try {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        viewport: { width: 900, height: 620 },
      });
      const page = await context.newPage();
      await page.setContent(`<!doctype html><title>Result attribution fixture</title><h1>Synthetic save fixture</h1><button id="save">Save</button><output id="saved">0</output><script>
      document.querySelector('#save').onclick = () => {
        const saved = document.querySelector('#saved');
        saved.textContent = String(Number(saved.textContent) + 1);
      };
    </script>`);
      const writes = async () =>
        Number(await page.locator("#saved").textContent());
      driver = await createDriverSession({
        page,
        context,
        enginePath,
        adapter: {
          model: { id: "test", version: "1" },
          observe: async () => ({
            connected: true,
            session: "attribution-fixture",
            facts: { text: "Fixture", saved: (await writes()) > 0 },
          }),
          handlers: {
            edit: async () => {},
            save: async (_, execution) =>
              execution.click(page.locator("#save")),
          },
          beginRun: async () => {
            runs++;
            if (runs === 2) {
              transientOwned = true;
              beginEntered.resolve();
              await beginRelease.promise;
            }
          },
          effectStatus: async () => ({
            status: (await writes()) > 0 ? "saved" : "not_attempted",
          }),
          endRun: async () => {
            if (runs === 2) {
              endEntered.resolve();
              await endRelease.promise;
              // Retain this fixture handle for explicit close after the safe error.
              throw new Error("Synthetic private transient cleanup diagnostic");
            }
          },
          close: async () => {
            transientOwned = false;
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
      ui.on("request", (request) => {
        if (
          request.method() === "POST" &&
          new URL(request.url()).pathname === "/command"
        )
          replayedCommands++;
      });
      await ui.goto(viewer.url);
      await ui.waitForFunction(
        () => document.querySelector("#connection").textContent === "Connected",
      );
      const first = await driver.execute(
        "save",
        {},
        (await driver.snapshot()).revision,
      );
      assert.equal(first.execution, "completed");
      assert.equal(first.outcome.kind, "success");
      assert.equal(first.effect.status, "saved");
      assert.equal(await writes(), 1);
      const firstReport = driver.report({ runId: first.runId });
      await ui.waitForFunction(
        (id) => document.querySelector("#run-id").textContent.includes(id),
        first.runId,
      );
      receipt.setup = "PASS";

      running = driver.execute("save", {}, (await driver.snapshot()).revision);
      await beginEntered.promise;
      const active = await driver.snapshot();
      const secondId = active.runId;
      assert.notEqual(secondId, first.runId);
      assert.deepEqual(active.lastResult, first);
      await ui.waitForFunction(
        (id) => document.querySelector("#run-id").textContent.includes(id),
        secondId,
      );
      assert.equal(
        await ui.locator("#active-result").isVisible(),
        true,
        "Current run B must show its own pending outcome while retaining success A",
      );
      assert.equal(
        await ui.locator("#active-result").getAttribute("data-run-id"),
        secondId,
      );
      assert.match(
        await ui.locator("#active-result").innerText(),
        /Current run/,
      );
      assert.ok(
        (await ui.locator("#active-result").innerText()).includes(
          `Run ${secondId}`,
        ),
      );
      assert.match(
        await ui.locator("#active-result").innerText(),
        /final application outcome pending/,
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
      const firstIdentity = await ui.locator("#result-identity").innerText();
      assert.ok(firstIdentity.includes(first.runId));
      assert.ok(firstIdentity.includes(first.finishedAt));
      assert.equal(await ui.locator("#outcome-label").innerText(), "Saved");
      assert.equal(await writes(), 1, "Holding B must not replay A's write");
      assert.deepEqual(driver.report({ runId: first.runId }), firstReport);

      await ui.reload();
      await ui.waitForFunction(
        (id) => document.querySelector("#run-id").textContent.includes(id),
        secondId,
      );
      assert.equal(await ui.locator("#active-result").isVisible(), true);
      assert.equal(
        await ui.locator("#last-result").getAttribute("data-attribution"),
        "previous",
      );
      assert.equal(
        await ui.locator("#result-identity").innerText(),
        firstIdentity,
      );
      assert.equal(
        replayedCommands,
        0,
        "Viewer refresh must not replay a command",
      );
      await ui.screenshot({
        path: join(output, "running-after-refresh.png"),
        fullPage: true,
      });
      receipt.screenshots.push("running-after-refresh.png");

      await ui.setViewportSize({ width: 390, height: 844 });
      await ui.locator(".execution-panel").scrollIntoViewIfNeeded();
      const narrowLayout = await ui.evaluate(
        ({ firstId, secondId }) => {
          const identityMetrics = (selector, id) => {
            const element = document.querySelector(selector);
            const content = element.firstChild;
            const start = content.textContent.indexOf(id);
            if (start < 0) return { exactText: false };
            const range = document.createRange();
            range.setStart(content, start);
            range.setEnd(content, start + id.length);
            const box = element.getBoundingClientRect();
            const glyphs = [...range.getClientRects()];
            return {
              exactText: range.toString() === id,
              visible: element.checkVisibility(),
              fitsElement:
                glyphs.length > 0 &&
                glyphs.every(
                  (rect) =>
                    rect.width > 0 &&
                    rect.height > 0 &&
                    rect.left >= box.left - 1 &&
                    rect.right <= box.right + 1 &&
                    rect.top >= box.top - 1 &&
                    rect.bottom <= box.bottom + 1,
                ),
              fitsViewport: glyphs.every(
                (rect) =>
                  rect.left >= 0 &&
                  rect.right <= window.innerWidth &&
                  rect.top >= 0 &&
                  rect.bottom <= window.innerHeight,
              ),
              noTextOverflow: element.scrollWidth <= element.clientWidth,
            };
          };
          return {
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            pageWidth: document.documentElement.scrollWidth,
            previous: identityMetrics("#result-identity", firstId),
            current: identityMetrics("#active-run-identity", secondId),
          };
        },
        { firstId: first.runId, secondId },
      );
      assert.equal(narrowLayout.viewportWidth, 390);
      assert.equal(narrowLayout.viewportHeight, 844);
      assert.ok(
        narrowLayout.pageWidth <= narrowLayout.viewportWidth,
        "Full run identities must not cause horizontal page overflow at 390px",
      );
      for (const [owner, metrics] of Object.entries({
        previous: narrowLayout.previous,
        current: narrowLayout.current,
      })) {
        assert.deepEqual(
          metrics,
          {
            exactText: true,
            visible: true,
            fitsElement: true,
            fitsViewport: true,
            noTextOverflow: true,
          },
          `The complete ${owner} UUID must be visibly rendered without clipping at 390px`,
        );
      }
      await ui.screenshot({ path: join(output, "running-narrow.png") });
      receipt.screenshots.push("running-narrow.png");
      receipt.narrowLayout = narrowLayout;
      await ui.setViewportSize({ width: 1440, height: 1000 });

      beginRelease.resolve();
      await endEntered.promise;
      const finalizing = await driver.snapshot();
      assert.equal(finalizing.busy, true);
      assert.equal(finalizing.lastResult.runId, secondId);
      assert.equal(finalizing.lastResult.finishedAt, undefined);
      assert.equal(driver.report({ runId: secondId }), null);
      // Reload observes the matching but unfinished canonical result, not a cached A.
      await ui.reload();
      await ui.waitForFunction(
        (id) => document.querySelector("#run-id").textContent.includes(id),
        secondId,
      );
      assert.equal(await ui.locator("#active-result").isVisible(), true);
      assert.equal(
        await ui.locator("#last-result").isVisible(),
        false,
        "A matching result stays pending until owned transient finalization finishes",
      );
      assert.equal(await writes(), 2);

      endRelease.resolve();
      const second = await running;
      assert.equal(second.runId, secondId);
      assert.equal(second.execution, "completed");
      assert.equal(second.outcome.kind, "success");
      assert.equal(second.effect.status, "saved");
      assert.equal(second.ok, false);
      assert.equal(second.cleanupFailed, true);
      assert.equal(
        transientOwned,
        true,
        "Failed cleanup retains its owned fixture handle",
      );
      await ui.waitForFunction(
        () => document.querySelector("#active-result").hidden,
      );
      assert.equal(
        await ui.locator("#last-result").getAttribute("data-attribution"),
        "current",
      );
      assert.ok(
        (await ui.locator("#result-identity").innerText()).includes(secondId),
      );
      assert.ok(
        (await ui.locator("#result-identity").innerText()).includes(
          second.finishedAt,
        ),
      );
      assert.match(
        await ui.locator("#effect-label").innerText(),
        /Execution: Completed/,
      );
      assert.match(
        await ui.locator("#effect-label").innerText(),
        /Application effect: Saved/,
      );
      assert.match(
        await ui.locator("#effect-label").innerText(),
        /Owned transient cleanup incomplete/,
      );
      assert.doesNotMatch(
        await ui.locator("#last-result").innerText(),
        /private transient/,
      );
      assert.deepEqual(
        driver.report({ runId: first.runId }),
        firstReport,
        "Starting and finalizing B must preserve A's detached completed report",
      );
      assert.deepEqual(driver.report({ runId: secondId }).lastResult, second);
      assert.equal(replayedCommands, 0);
      assert.deepEqual(errors, []);
      driver.pause();
      await ui.waitForFunction(
        () =>
          document.querySelector("#execution-state").textContent ===
          "Driver paused",
      );
      assert.equal(
        await ui.locator("#active-result").isVisible(),
        false,
        "Pausing a completed direct action must not make its result pending",
      );
      assert.equal(
        await ui.locator("#last-result").getAttribute("data-attribution"),
        "current",
      );
      assert.ok(
        (await ui.locator("#result-identity").innerText()).includes(secondId),
      );
      await ui.screenshot({
        path: join(output, "cleanup-incomplete.png"),
        fullPage: true,
      });
      receipt.screenshots.push("cleanup-incomplete.png");
      receipt.status = "PASS";
      receipt.runs = { first: first.runId, second: secondId };
    } catch (error) {
      failure = error;
      receipt.status = "FAIL";
      receipt.failure = { message: error.message, code: error.code };
      if (ui) {
        try {
          await ui.screenshot({
            path: join(output, "failure.png"),
            fullPage: true,
          });
          receipt.screenshots.push("failure.png");
        } catch (captureError) {
          receipt.screenshotError = captureError.message;
        }
      }
    } finally {
      beginRelease.resolve();
      endRelease.resolve();
      driver?.stop();
      const cleanupErrors = [];
      for (const [name, close] of [
        ["activeRun", () => running],
        ["viewer", () => viewer?.close()],
        ["driver", () => driver?.close()],
        ["browser", () => browser?.close()],
      ]) {
        try {
          await close();
          receipt.cleanup[name] = "PASS";
        } catch (error) {
          receipt.cleanup[name] = { status: "FAIL", message: error.message };
          cleanupErrors.push(error);
        }
      }
      receipt.cleanup.transientReleased = !transientOwned;
      receipt.cleanup.browserClosed = !browser?.isConnected();
      if (transientOwned || browser?.isConnected())
        cleanupErrors.push(new Error("Owned fixture cleanup incomplete"));
      if (cleanupErrors.length) {
        receipt.status = "FAIL";
        failure = new AggregateError(
          [...(failure ? [failure] : []), ...cleanupErrors],
          "Result attribution test or owned cleanup failed",
        );
      }
      await writeFile(
        join(output, "receipt.json"),
        `${JSON.stringify(receipt, null, 2)}\n`,
      );
      console.log(`Result attribution session evidence: ${output}`);
    }
    if (failure) throw failure;
  },
);
