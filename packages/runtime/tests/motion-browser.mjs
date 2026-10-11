// Real browser regression for the accepted Roots visible-motion contract.
// This independent form exercises shared primitives, not customer application acceptance.
import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createDriverSession } from "../src/session.mjs";

const enginePath = fileURLToPath(new URL("./fake-engine.mjs", import.meta.url));
chmodSync(enginePath, 0o755);
const html = `<!doctype html><html><head><title>Visible motion contract</title>
<style>body{font:20px system-ui;margin:60px}label{display:block;margin:20px 0}textarea{width:600px;height:120px;font:20px system-ui}</style></head>
<body><h1>Visible motion contract</h1><label for="text">Note</label><textarea id="text"></textarea>
<label for="date">Date</label><input id="date" type="date" value="2026-10-11">
<button id="save">Save</button><p id="saved"></p></body></html>`;

async function fixture(t) {
  const browser = await chromium.launch({ headless: true });
  let driver;
  t.after(async () => {
    await driver?.close();
    await browser.close();
  });
  const context = await browser.newContext({
    viewport: { width: 1000, height: 780 },
  });
  const page = await context.newPage();
  await page.goto(`data:text/html,${encodeURIComponent(html)}`);
  let session = "alpha";
  const adapter = {
    model: { id: "test", version: "1" },
    observe: async () => ({
      connected: !page.isClosed(),
      session,
      facts: { text: await page.locator("#text").inputValue(), saved: false },
    }),
    handlers: {
      edit: async ({ text }, x) => x.fill(page.locator("#text"), text),
      save: async (_, x) => x.click(page.locator("#save")),
    },
  };
  driver = await createDriverSession({ page, context, enginePath, adapter });
  const edit = async (text) => {
    const before = await driver.snapshot();
    return driver.execute("edit", { text }, before.revision);
  };
  return {
    page,
    driver,
    edit,
    adapter,
    setSession: (value) => (session = value),
  };
}

test("visible typing emits individual input and keyboard events at the selected speed", async (t) => {
  const f = await fixture(t);
  await f.page.evaluate(() => {
    window.motion = { moves: 0, inputs: 0, keys: 0 };
    document.addEventListener("mousemove", () => window.motion.moves++);
    document.addEventListener("input", () => window.motion.inputs++);
    document.addEventListener("keydown", () => window.motion.keys++);
  });
  f.driver.setSpeed("slow");
  let started = performance.now();
  assert.equal((await f.edit("Slow QA")).ok, true);
  const slow = performance.now() - started;
  f.driver.setSpeed("fast");
  started = performance.now();
  assert.equal((await f.edit("Fast QA")).ok, true);
  const fast = performance.now() - started;
  const observed = await f.page.evaluate(() => window.motion);
  assert.ok(observed.moves > 10, JSON.stringify(observed));
  assert.ok(
    observed.inputs >= 14,
    `Expected >=14 typing inputs; observed ${observed.inputs}`,
  );
  assert.ok(
    observed.keys >= 14,
    `Expected >=14 typing keys; observed ${observed.keys}`,
  );
  assert.ok(slow > fast, `Slow ${slow}ms must exceed fast ${fast}ms`);
  assert.equal(await f.page.locator("#text").inputValue(), "Fast QA");
});

test("visible cursor survives page reload and removes its own overlay on close", async (t) => {
  const f = await fixture(t);
  f.driver.setSpeed("fast");
  assert.equal((await f.edit("Cursor check")).ok, true);
  assert.equal(await f.page.locator("[data-browser-driver-cursor]").count(), 1);
  const out = resolve(
    process.env.MOTION_EVIDENCE_DIR ||
      "artifacts/motion-parity-20261011/browser",
  );
  mkdirSync(out, { recursive: true });
  await f.page.screenshot({ path: resolve(out, "cursor.png") });
  await f.page.reload();
  await f.page
    .locator("[data-browser-driver-cursor]")
    .waitFor({ state: "attached" });
  assert.equal(await f.page.locator("[data-browser-driver-cursor]").count(), 1);
  await f.driver.close();
  assert.equal(f.page.isClosed(), false);
  assert.equal(await f.page.locator("[data-browser-driver-cursor]").count(), 0);
  await f.page.reload();
  assert.equal(await f.page.locator("[data-browser-driver-cursor]").count(), 0);
});

test("a human edit during visible typing stops the remaining keys", async (t) => {
  const f = await fixture(t);
  f.driver.setSpeed("slow");
  await f.page.exposeFunction("interruptTyping", () => f.driver.pause());
  await f.page.evaluate(() => {
    const field = document.querySelector("#text");
    field.addEventListener("input", () => {
      if (field.value === "S") void window.interruptTyping();
    });
  });
  const running = f.edit("Stop overwriting my input");
  await f.page.waitForFunction(
    () => document.querySelector("#text").value === "S",
    null,
    { timeout: 4000 },
  );
  await f.page.locator("#text").fill("Human draft");
  f.driver.resume();
  const result = await running;
  assert.equal(result.error_code, "stale_observation");
  assert.equal(await f.page.locator("#text").inputValue(), "Human draft");
});

test("date fill keeps native form semantics and session switches still reject", async (t) => {
  const f = await fixture(t);
  f.driver.setSpeed("fast");
  f.adapter.handlers.edit = async (_, x) =>
    x.fill(f.page.locator("#date"), "2026-10-12");
  assert.equal((await f.edit("date fixture")).ok, true);
  assert.equal(await f.page.locator("#date").inputValue(), "2026-10-12");
  const before = await f.driver.snapshot();
  f.setSession("beta");
  const result = await f.driver.execute(
    "edit",
    { text: "stale" },
    before.revision,
  );
  assert.equal(result.error_code, "stale_observation");
  assert.equal(await f.page.locator("#date").inputValue(), "2026-10-12");
});
