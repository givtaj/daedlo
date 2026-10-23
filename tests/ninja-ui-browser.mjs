// Real Chromium UI acceptance against a controlled manager contract fixture.
// This does not establish installed-package or customer-upgrade acceptance.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { createNinjaServer } from "../scripts/release/ninja-server.mjs";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("local update UI validates, defers unsafe restart, activates and reverts without browser-supplied IDs", async () => {
  const state = {
    project: {
      id: "ui-fixture",
      label: "Architecture Studio · update fixture",
    },
    selected: { id: "accepted", version: "0.1.4-alpha.2" },
    running: { id: "accepted", version: "0.1.4-alpha.2" },
    phase: "idle",
    available: null,
    operation: null,
    canRollback: false,
  };
  const calls = [];
  let rejection = "busy",
    prepared,
    validated,
    activated;
  const manager = {
    status: async () => structuredClone(state),
    async check() {
      calls.push("check");
      state.phase = "checking";
      await pause(550);
      state.available = { id: "verified-release", version: "0.1.5-candidate" };
      state.phase = "available";
    },
    async prepare(id) {
      assert.equal(id, "verified-release");
      calls.push("prepare");
      state.phase = "preparing";
      await new Promise((r) => {
        prepared = r;
      });
      state.phase = "validating";
      await new Promise((r) => {
        validated = r;
      });
      state.phase = "ready";
      state.operation = { id: "validated-operation", status: "ready" };
    },
    async activate(id, options) {
      assert.equal(id, "validated-operation");
      assert.deepEqual(options, { acknowledgeRestart: true });
      calls.push("activate");
      if (rejection)
        throw Object.assign(Error("private manager path"), { code: rejection });
      state.phase = "activating";
      await new Promise((r) => {
        activated = r;
      });
      state.selected = { id: "candidate", version: "0.1.5-candidate" };
      state.running = { ...state.selected };
      state.operation = null;
      state.available = null;
      state.canRollback = true;
      state.phase = "updated";
    },
    async rollback(options) {
      assert.deepEqual(options, { acknowledgeRestart: true });
      calls.push("rollback");
      state.selected = {
        id: "accepted",
        version: "0.1.4-alpha.2",
        historicalSnapshot: true,
      };
      state.running = null;
      state.canRollback = false;
      state.phase = "rolled_back";
    },
  };
  let server, browser;
  try {
    server = await createNinjaServer({ manager });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 1100, height: 900 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(server.url);
    await page.locator("#check:not(:disabled)").waitFor();
    assert.equal(new URL(page.url()).hash, "");
    assert.deepEqual(
      calls,
      [],
      "Loading the control screen must not discover or mutate automatically",
    );
    await page.getByRole("button", { name: "Check for updates" }).click();
    await page
      .locator("#phase-title")
      .filter({ hasText: "Update available" })
      .waitFor();
    await page.locator("#install:not(:disabled)").waitFor();
    await page.getByRole("button", { name: "Install update" }).click();
    await page
      .locator("#phase-title")
      .filter({ hasText: "Preparing the update" })
      .waitFor();
    prepared();
    await page
      .locator("#phase-title")
      .filter({ hasText: "Validating your project" })
      .waitFor();
    validated();
    await page
      .locator("#phase-title")
      .filter({ hasText: "Ready — restart Daedlo" })
      .waitFor();
    assert.equal(
      await page.locator("#selected").textContent(),
      "0.1.4-alpha.2",
    );
    assert.equal(await page.locator("#restart").isDisabled(), true);
    await page.locator("#acknowledge").check();
    await page.getByRole("button", { name: "Restart Daedlo" }).click();
    await page
      .locator("#message")
      .filter({ hasText: "active run must finish" })
      .waitFor();
    assert.equal(
      await page.locator("#selected").textContent(),
      "0.1.4-alpha.2",
    );
    rejection = "draft_unpreserved";
    await page.locator("#acknowledge").check();
    await page.getByRole("button", { name: "Restart Daedlo" }).click();
    await page
      .locator("#message")
      .filter({ hasText: "draft or session cannot be preserved" })
      .waitFor();
    rejection = null;
    await page.locator("#acknowledge").check();
    await page.getByRole("button", { name: "Restart Daedlo" }).click();
    await page
      .locator("#phase-title")
      .filter({ hasText: "Restarting Daedlo" })
      .waitFor();
    activated();
    await page
      .locator("#phase-title")
      .filter({ hasText: "Update selected" })
      .waitFor();
    assert.equal(
      await page.locator("#selected").textContent(),
      "0.1.5-candidate",
    );
    assert.equal(
      await page.locator("#running").textContent(),
      "0.1.5-candidate",
    );
    const output = resolve(
      process.env.NINJA_UI_ARTIFACTS ?? "artifacts/ninja-update/ui",
    );
    await mkdir(output, { recursive: true });
    await page.screenshot({
      path: resolve(output, "updated-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: resolve(output, "updated-mobile.png"),
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.locator("#acknowledge").check();
    await page.getByRole("button", { name: "Revert update" }).click();
    await page
      .locator("#phase-title")
      .filter({ hasText: "Previous installation selected" })
      .waitFor();
    assert.equal(
      await page.locator("#selected").textContent(),
      "0.1.4-alpha.2",
    );
    assert.equal(
      await page.locator("#running").textContent(),
      "No running session",
    );
    assert.equal(await page.locator("#historical").isVisible(), true);
    await page.reload();
    await page
      .locator("#phase-title")
      .filter({ hasText: "Previous installation selected" })
      .waitFor();
    assert.deepEqual(calls, [
      "check",
      "prepare",
      "activate",
      "activate",
      "activate",
      "rollback",
    ]);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server?.close();
  }
});

test("failed discovery remains unavailable and a tokenless page cannot operate the manager", async () => {
  let calls = 0;
  const manager = {
    status: async () => ({
      project: { id: "failure", label: "Discovery fixture" },
      selected: null,
      running: null,
      phase: "idle",
      canRollback: false,
    }),
    check: async () => {
      calls++;
      throw Error("private path");
    },
    prepare: async () => {},
    activate: async () => {},
    rollback: async () => {},
  };
  let server, browser;
  try {
    server = await createNinjaServer({ manager });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(new URL(server.url).origin);
    assert.equal(await page.locator("#check").isDisabled(), true);
    assert.equal(calls, 0);
    await page.goto(server.url);
    await page.locator("#check:not(:disabled)").waitFor();
    await page.locator("#check").click();
    await page
      .locator("#message")
      .filter({ hasText: "Release discovery is unavailable" })
      .waitFor();
    await pause(600);
    assert.match(
      await page.locator("#message").textContent(),
      /does not establish/,
    );
    assert.equal(calls, 1);
  } finally {
    await browser?.close();
    await server?.close();
  }
});
