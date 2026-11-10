// Independent fixture portability at the HTTP service-name origin used by Compose.
import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createNotebookServer } from "../examples/notebook/server.mjs";

test("notebook saves exactly once through a non-loopback HTTP origin", async () => {
  const app = await createNotebookServer();
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--host-resolver-rules=MAP notebook.test 127.0.0.1",
        "--no-proxy-server",
      ],
    });
    const page = await browser.newPage();
    const url = new URL(app.url);
    url.hostname = "notebook.test";
    await page.goto(url.href);
    assert.deepEqual(
      await page.evaluate(() => ({
        secure: isSecureContext,
        randomUUID: typeof crypto.randomUUID,
        getRandomValues: typeof crypto.getRandomValues,
      })),
      { secure: false, randomUUID: "undefined", getRandomValues: "function" },
    );
    await page.getByLabel("Note", { exact: true }).fill("Compose origin note");
    const completion = Promise.race([
      page
        .waitForFunction(
          () => ["saved", "recovery"].includes(document.body.dataset.phase),
          null,
          { timeout: 3000 },
        )
        .then(() => ({ kind: "settled" })),
      page
        .waitForEvent("pageerror", { timeout: 3000 })
        .then((error) => ({ kind: "page-error", message: error.message })),
    ]);
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    const result = await completion;
    assert.deepEqual(
      result,
      { kind: "settled" },
      "A save at the Compose-style HTTP origin must settle without a browser page error",
    );
    assert.equal(
      await page.locator("body").getAttribute("data-phase"),
      "saved",
    );
    const operation = await page.locator("body").getAttribute("data-operation");
    assert.match(operation, /^[a-f0-9]{32}$/);
    let rows = await (await fetch(`${app.url}/api/notes`)).json();
    assert.equal(rows.items.length, 1);
    assert.equal(rows.items[0].text, "Compose origin note");
    assert.equal(rows.items[0].operationId, operation);
    assert.equal(app.writes, 1);

    // Repeating the unchanged save must retain the operation identity and record.
    const repeated = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/notes" &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    assert.equal((await repeated).status(), 200);
    await page.waitForFunction(() => document.body.dataset.phase === "saved");
    assert.equal(
      await page.locator("body").getAttribute("data-operation"),
      operation,
    );
    rows = await (await fetch(`${app.url}/api/notes`)).json();
    assert.equal(rows.items.length, 1);
    assert.equal(app.writes, 1);
  } finally {
    try {
      await browser?.close();
    } finally {
      await app.close();
    }
  }
});
