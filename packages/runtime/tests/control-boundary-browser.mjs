// Shared interruption contract in real Chromium against an owned HTTP service.
// Customer application/database acceptance remains the consumer's responsibility.
import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createDriverSession, DriverError } from "../src/index.mjs";
const enginePath = fileURLToPath(new URL("./fake-engine.mjs", import.meta.url));
chmodSync(enginePath, 0o755);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fixture(
  t,
  { failVerification = false, deferEffectStatus = false } = {},
) {
  let release,
    entered,
    releaseEffectStatus,
    enteredEffectStatus,
    returnedEffectStatus,
    writes = 0,
    ended = 0,
    driver,
    running;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  const effectGate = new Promise((resolve) => {
    releaseEffectStatus = resolve;
  });
  const effectReady = new Promise((resolve) => {
    enteredEffectStatus = resolve;
  });
  const effectReturned = new Promise((resolve) => {
    returnedEffectStatus = resolve;
  });
  const server = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/save") {
      writes++;
      entered();
      await gate;
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ saved: true }));
    } else {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!doctype html><title>Interruption contract</title><textarea id="note">Retain my note</textarea><button id="save">Save</button><output id="status">Draft</output><script>
        document.querySelector('#save').onclick = async () => {
          document.querySelector('#status').textContent = 'Saving';
          const response = await fetch('/save', {method:'POST'});
          if(response.ok) document.querySelector('#status').textContent = 'Saved';
        };
      </script>`);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  t.after(async () => {
    release();
    releaseEffectStatus();
    driver?.stop();
    await running;
    await driver?.close();
    await browser.close();
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
    assert.equal(browser.isConnected(), false, "Owned browser must close");
    assert.equal(server.listening, false, "Owned HTTP fixture must close");
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const adapter = {
    model: { id: "test", version: "1" },
    observe: async () => ({
      connected: true,
      session: "alpha",
      facts: {
        text: await page.locator("#note").inputValue(),
        saved: (await page.locator("#status").textContent()) === "Saved",
      },
    }),
    handlers: {
      edit: async ({ text }, x) => x.fill(page.locator("#note"), text),
      save: async (_, x) => x.click(page.locator("#save")),
    },
    settle: async () => {
      if (writes === 0) return;
      await page.waitForFunction(
        () => document.querySelector("#status").textContent === "Saved",
      );
      if (failVerification)
        throw new DriverError(
          "unexpected_destination",
          "The declared postcondition was not verified.",
        );
    },
    effectStatus: async () => {
      if (deferEffectStatus) {
        enteredEffectStatus();
        await effectGate;
        returnedEffectStatus();
      }
      return { status: writes === 1 ? "saved" : "not_attempted" };
    },
    endRun: async () => {
      ended++;
    },
  };
  driver = await createDriverSession({ page, context, enginePath, adapter });
  driver.setSpeed("fast");
  return {
    page,
    browser,
    driver,
    ready,
    release,
    effectReady,
    effectReturned,
    releaseEffectStatus,
    writes: () => writes,
    ended: () => ended,
    async start({ recipe = false } = {}) {
      const before = await driver.snapshot();
      running = recipe
        ? driver.runRecipe("sample", before.revision)
        : driver.execute("save", {}, before.revision);
      return { result: running };
    },
  };
}

for (const mode of ["pause-resume", "pause-stop", "stop", "direct-stop"]) {
  test(
    `${mode} during asynchronous effect collection preserves one verified write`,
    { timeout: 10000 },
    async (t) => {
      const f = await fixture(t, { deferEffectStatus: true });
      const { result } = await f.start({ recipe: mode !== "direct-stop" });
      await f.ready;
      f.release();
      await f.effectReady;
      const runId = f.driver.report().runId;
      assert.equal(f.writes(), 1);
      assert.equal(await f.page.locator("#status").textContent(), "Saved");
      assert.ok(
        f.driver
          .report()
          .events.some(
            (event) =>
              event.runId === runId &&
              event.type === "verified" &&
              event.command === "save",
          ),
        "The real write must be verified before interrupting effect collection",
      );
      if (mode.startsWith("pause-")) f.driver.pause();
      else f.driver.stop();
      f.releaseEffectStatus();
      await f.effectReturned;
      if (mode.startsWith("pause-")) {
        // A new protocol observation lets effect collection settle without a
        // sleep; the paused recipe must still await an explicit control choice.
        const held = await f.driver.snapshot();
        assert.equal(held.paused, true);
        assert.equal(
          held.busy,
          true,
          "Pause during effect collection must keep the verified recipe active",
        );
        assert.equal(held.execution, "paused");
        assert.equal(f.ended(), 0, "Cleanup must wait for Resume or Stop");
        assert.equal(f.driver.report({ runId }), null);
        assert.equal(f.writes(), 1);
        if (mode === "pause-resume") f.driver.resume();
        else f.driver.stop();
      }
      const completed = await result;
      assert.equal(completed.effect.status, "saved");
      assert.equal(
        f.writes(),
        1,
        "Finalization must never replay the saved request",
      );
      assert.equal(
        f.ended(),
        1,
        "The completed run must clean up exactly once",
      );
      if (mode === "pause-resume") {
        assert.equal(completed.ok, true);
        assert.equal(completed.execution, "completed");
        assert.equal(completed.outcome.kind, "success");
      } else {
        assert.equal(completed.ok, false);
        assert.equal(completed.execution, "stopped");
        assert.equal(completed.error_code, "stopped");
        assert.equal(completed.outcome, undefined);
      }
      assert.deepEqual(f.driver.report({ runId }).lastResult, completed);
      await f.driver.close();
      assert.equal(f.ended(), 1);
      assert.equal(f.page.isClosed(), false);
      assert.equal(f.browser.isConnected(), true);
      assert.equal(await f.page.locator("#status").textContent(), "Saved");
      assert.equal(f.writes(), 1);
    },
  );
}

for (const mode of ["pause", "stop", "stop-unverified"]) {
  test(`${mode} preserves one dispatched write and completes without replay`, async (t) => {
    const f = await fixture(t, {
      failVerification: mode === "stop-unverified",
    });
    const { result } = await f.start();
    await f.ready;
    mode === "pause" ? f.driver.pause() : f.driver.stop();
    f.release();
    const timeout = Symbol("pending");
    const completed = await Promise.race([
      result,
      delay(3000).then(() => timeout),
    ]);
    assert.notEqual(
      completed,
      timeout,
      "A completed direct write must finish read-only verification while paused",
    );
    assert.equal(f.writes(), 1);
    assert.equal(await f.page.locator("#status").textContent(), "Saved");
    assert.equal(completed.effect.status, "saved");
    if (mode === "pause") {
      assert.equal(completed.ok, true);
      assert.equal(completed.execution, "completed");
      assert.equal(completed.outcome.kind, "success");
      const paused = await f.driver.snapshot();
      assert.equal(paused.busy, false);
      assert.equal(paused.paused, true);
      assert.equal(paused.execution, "paused");
      f.driver.resume();
      assert.equal((await f.driver.snapshot()).paused, false);
    } else {
      assert.equal(completed.execution, "stopped");
      assert.equal(completed.error_code, "stopped");
      if (mode === "stop-unverified") {
        assert.equal(
          completed.interruptionError.error_code,
          "unexpected_destination",
        );
        assert.equal(
          completed.outcome,
          undefined,
          "Unverified postconditions cannot become successful outcomes",
        );
        assert.equal(
          f.driver.report().events.some((e) => e.type === "verified"),
          false,
        );
      } else
        assert.equal(
          f.driver.report().events.some((e) => e.type === "verified"),
          true,
        );
    }
    assert.equal(
      f.writes(),
      1,
      "Resuming or reporting must never replay a write",
    );
    await f.driver.close();
    assert.equal(f.page.isClosed(), false);
    assert.equal(f.browser.isConnected(), true);
    assert.equal(await f.page.locator("#note").inputValue(), "Retain my note");
  });
}
