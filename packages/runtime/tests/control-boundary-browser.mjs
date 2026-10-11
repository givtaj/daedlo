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

async function fixture(t, { failVerification = false } = {}) {
  let release,
    entered,
    writes = 0,
    driver,
    running;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const ready = new Promise((resolve) => {
    entered = resolve;
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
    driver?.stop();
    await running;
    await driver?.close();
    await browser.close();
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
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
      await page.waitForFunction(
        () => document.querySelector("#status").textContent === "Saved",
      );
      if (failVerification)
        throw new DriverError(
          "unexpected_destination",
          "The declared postcondition was not verified.",
        );
    },
    effectStatus: async () => ({
      status: writes === 1 ? "saved" : "not_attempted",
    }),
  };
  driver = await createDriverSession({ page, context, enginePath, adapter });
  driver.setSpeed("fast");
  return {
    page,
    browser,
    driver,
    ready,
    release,
    writes: () => writes,
    async start() {
      const before = await driver.snapshot();
      running = driver.execute("save", {}, before.revision);
      return { result: running };
    },
  };
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
