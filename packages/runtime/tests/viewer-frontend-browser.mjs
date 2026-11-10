// Visible identity and target isolation in Chromium; synthetic conformance only.
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createRequire } from "node:module";
const runtimeRequire = createRequire(
  process.env.CLI_TEST_RUNTIME || import.meta.url,
);
const { chromium } = runtimeRequire("playwright");
const { createViewer } = await import(
  process.env.CLI_TEST_RUNTIME
    ? pathToFileURL(process.env.CLI_TEST_RUNTIME).href
    : new URL("../src/index.mjs", import.meta.url).href
);

test("viewer labels concurrent frontends and refuses a target mismatch without replay", async () => {
  const server = http.createServer((req, res) =>
    res.end(
      "<!doctype html><title>Synthetic portal</title><h1>Synthetic portal</h1>",
    ),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const viewers = [];
  const calls = [];
  try {
    for (const name of ["Diagnostics", "Settings portal"]) {
      const context = await browser.newContext({
        viewport: { width: 850, height: 500 },
      });
      const page = await context.newPage();
      await page.goto(origin);
      const snapshot = {
        connected: true,
        descriptor: {
          id: "portal",
          version: "1",
          label: "Portal",
          states: [
            { id: "ready", label: "Ready", parent: null, support: "supported" },
          ],
          commands: [{ id: "inspect", label: "Inspect", params: {} }],
          recipes: [],
        },
        state: { id: "ready" },
        revision: "r1",
        commands: [{ id: "inspect", enabled: true }],
        recipes: [],
        display: [],
        execution: "idle",
        busy: false,
        paused: false,
        speed: "normal",
      };
      const session = {
        snapshot: async () => structuredClone(snapshot),
        command: async () => {
          calls.push(name);
          return { ok: true, execution: "completed" };
        },
      };
      const viewer = await createViewer({
        page,
        context,
        session,
        frontend: {
          name,
          targetOrigin: origin,
          model: { id: "portal", version: "1" },
          evidenceLocation: `/local/synthetic/${name.toLowerCase().replaceAll(" ", "-")}/reports`,
          ownership: {
            browser: "owned",
            context: "owned",
            application: "attached",
          },
        },
      });
      viewers.push({ ...viewer, page });
    }
    const monitor = await browser.newContext({
      viewport: { width: 1440, height: 1050 },
    });
    const ui = await monitor.newPage();
    await ui.goto(viewers[1].url);
    await ui
      .locator("#frontend-name")
      .filter({ hasText: "Settings portal" })
      .waitFor();
    assert.equal(await ui.locator("#frontend-details").isVisible(), false);
    await ui.locator("#frontend-identity > summary").click();
    assert.match(
      await ui.locator("#frontend-details").innerText(),
      /application: attached/,
    );
    await ui.locator("#frontend-identity > summary").click();
    assert.equal(await ui.title(), "Settings portal · Daedlo");
    const out = resolve(
      process.env.FRONTEND_VIEWER_OUTPUT ?? "artifacts/alpha4-runtime/browser",
    );
    await mkdir(out, { recursive: true });
    await ui.screenshot({
      path: resolve(out, "frontend-connected.png"),
      fullPage: true,
    });
    await ui.reload();
    await ui.locator('[data-command-id="inspect"]').waitFor();
    assert.deepEqual(calls, [], "reload must not replay a flow");
    await viewers[1].page.goto("about:blank");
    await ui
      .locator('#connection-error[data-reason="target_mismatch"]')
      .waitFor({ state: "visible" });
    assert.equal(
      await ui.locator("#connection").innerText(),
      "Target mismatch",
    );
    assert.match(
      await ui.locator("#connection-error").innerText(),
      /Target or model mismatch/,
    );
    assert.equal(
      await ui.locator("#frontend-warning").isVisible(),
      false,
      "The primary notice must not be duplicated",
    );
    assert.equal(
      await ui.locator('button[data-command="inspect"]').isDisabled(),
      true,
    );
    assert.deepEqual(
      calls,
      [],
      "A mismatched target never dispatches or replays a flow",
    );
    assert.equal(
      (await (await fetch(viewers[0].url + "/status")).json()).connected,
      true,
    );
    await ui.screenshot({
      path: resolve(out, "frontend-mismatch.png"),
      fullPage: true,
    });
    await viewers[1].close();
    assert.equal(
      viewers[1].page.isClosed(),
      false,
      "viewer close preserves attached target",
    );
    assert.equal(
      (await (await fetch(viewers[0].url + "/status")).json()).frontend.name,
      "Diagnostics",
    );
  } finally {
    await Promise.all(viewers.map((v) => v.close()));
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
