import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
const { createDriverSession, createViewer, createResourceScope } = await import(
  process.env.BROWSER_DRIVER_ACCEPTANCE_RUNTIME ??
    "../packages/runtime/src/index.mjs"
);
import { createNotebookServer } from "../examples/notebook/server.mjs";
import { createNotebookAdapter } from "../examples/notebook/adapter.mjs";
const out = resolve(
  process.env.BROWSER_DRIVER_ACCEPTANCE_OUTPUT ?? "artifacts/notebook",
);
await fs.mkdir(out, { recursive: true });
const scope = createResourceScope(),
  results = [];
const enginePath = resolve(
  process.env.BROWSER_DRIVER_ACCEPTANCE_ENGINE ??
    "target/debug/notebook-engine",
);
const identity = {
  app: "notebook-fixture/1",
  engineSha256: createHash("sha256")
    .update(await fs.readFile(enginePath))
    .digest("hex"),
};
let browser, page, ui, session, viewer, server;
async function run(name, fn) {
  const began = Date.now();
  try {
    await fn();
    results.push({ name, status: "PASS", durationMs: Date.now() - began });
    console.log(`PASS ${name}`);
  } catch (e) {
    results.push({ name, status: "FAIL", error: e.message });
    throw e;
  }
}
const command = async (id, params = {}) =>
  session.execute(id, params, (await session.snapshot()).revision);
try {
  server = await createNotebookServer();
  scope.own(server, { label: "notebook server", close: (s) => s.close() });
  browser = await chromium.launch({ headless: true });
  scope.own(browser, { label: "browser", close: (b) => b.close() });
  const context = await browser.newContext({
    viewport: { width: 1100, height: 780 },
  });
  page = await context.newPage();
  await page.goto(server.url);
  await page.getByLabel("Note").fill("Existing human draft");
  session = await createDriverSession({
    page,
    context,
    enginePath,
    adapter: createNotebookAdapter(page),
    identity,
  });
  scope.own(session, { label: "driver session", close: (s) => s.close() });
  session.setSpeed("fast");
  viewer = await createViewer({ page, context, session });
  scope.own(viewer, { label: "viewer", close: (v) => v.close() });
  const monitor = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  ui = await monitor.newPage();
  await ui.goto(viewer.url);
  await run("attachment and generic descriptor UI", async () => {
    assert.equal(
      await page.getByLabel("Note").inputValue(),
      "Existing human draft",
    );
    await ui.locator('[data-command="save"]').waitFor();
    assert.equal(
      await ui
        .locator('[data-command-id="change_mode"] input[type="checkbox"]')
        .count(),
      1,
    );
    assert.equal(
      await ui.locator('[data-command-id="change_mode"] select').count(),
      1,
    );
    assert.equal(
      await ui
        .locator('[data-command-id="change_mode"] input[type="number"]')
        .count(),
      1,
    );
    const s = await session.snapshot();
    assert.equal(s.state.id, "notebook.draft");
  });
  await run(
    "stale draft and account changes refuse without writes",
    async () => {
      let old = await session.snapshot();
      await page.getByLabel("Note").fill("New human draft");
      let r = await session.execute("save", {}, old.revision);
      assert.equal(r.execution, "rejected");
      assert.equal(r.effect.status, "not_attempted");
      assert.equal(server.writes, 0);
      old = await session.snapshot();
      await page.getByRole("button", { name: "Switch account" }).click();
      await page.waitForFunction(
        () => document.body.dataset.session === "beta",
      );
      r = await session.execute("save", {}, old.revision);
      assert.equal(r.execution, "rejected");
      assert.equal(server.writes, 0);
    },
  );
  await run("validation, typed fields, successful persistence", async () => {
    assert.equal(
      (await command("edit", { text: "Clear this draft" })).outcome.kind,
      "success",
    );
    assert.equal((await command("edit", { text: "" })).outcome.kind, "success");
    let r = await command("save");
    assert.equal(r.outcome?.kind, "validation", JSON.stringify(r));
    assert.equal(server.writes, 0);
    r = await command("change_mode", {
      urgent: true,
      category: "work",
      priority: 3,
    });
    assert.equal(r.execution, "completed");
    await command("edit", { text: "A real saved note" });
    r = await command("save");
    assert.equal(r.outcome.kind, "success");
    assert.equal(r.effect.status, "saved");
    assert.equal(server.writes, 1);
    const rows = await page.request
      .get(server.url + "/api/notes")
      .then((r) => r.json());
    assert.equal(rows.items[0].text, "A real saved note");
  });
  await run(
    "lost response retries same operation with one persisted record",
    async () => {
      await command("edit", { text: "Save reply is lost" });
      let id;
      await page.route("**/api/notes", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        id = route.request().postDataJSON().operationId;
        await route.fetch();
        await route.abort("failed");
      });
      const r = await command("save");
      assert.equal(r.outcome.kind, "recoverable_error");
      assert.equal(
        await page.getByLabel("Note").inputValue(),
        "Save reply is lost",
      );
      await page.unroute("**/api/notes");
      const retry = await command("save");
      assert.equal(retry.outcome.kind, "success");
      const rows = await page.request
        .get(server.url + "/api/notes?operationId=" + encodeURIComponent(id))
        .then((r) => r.json());
      assert.equal(rows.items.length, 1);
      assert.equal(server.writes, 2);
    },
  );
  await run(
    "pause/resume, stop in flight and no replay on reconnect",
    async () => {
      session.setSpeed("slow");
      let s = await session.snapshot();
      const edit = session.execute("edit", { text: "Paused edit" }, s.revision);
      session.pause();
      await new Promise((r) => setTimeout(r, 150));
      assert.equal((await session.snapshot()).paused, true);
      assert.notEqual(
        await page.getByLabel("Note").inputValue(),
        "Paused edit",
      );
      session.resume();
      assert.equal((await edit).execution, "completed");
      session.setSpeed("fast");
      let notify;
      const saving = new Promise((r) => (notify = r));
      await page.route("**/api/notes", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        const response = await route.fetch();
        notify();
        await new Promise((r) => setTimeout(r, 150));
        await route.fulfill({ response });
      });
      s = await session.snapshot();
      const save = session.execute("save", {}, s.revision);
      await saving;
      session.stop();
      const r = await save;
      assert.equal(r.execution, "stopped");
      assert.equal(r.effect.status, "saved");
      await page.unroute("**/api/notes");
      const writes = server.writes;
      await ui.reload();
      await ui.locator('[data-command="save"]').waitFor();
      assert.equal(server.writes, writes);
    },
  );
  await run(
    "public viewer command executes and live frames render",
    async () => {
      const form = ui.locator('[data-command-id="edit"]');
      await form
        .locator('textarea,input[type="text"]')
        .fill("From the live monitor");
      await ui.locator('[data-command="edit"]').click();
      await page.waitForFunction(
        () => document.querySelector("#note").value === "From the live monitor",
      );
      await ui.waitForFunction(
        () => document.querySelector("img")?.naturalWidth > 0,
      );
      await ui.waitForFunction(
        () =>
          !document.querySelector('[data-command="save"]').disabled &&
          document.querySelector("#execution-state").textContent ===
            "Completed",
      );
      // Allow the next CDP frame and MJPEG paint to reach the mirror before visual evidence.
      await ui.waitForTimeout(600);
      await ui.screenshot({
        path: resolve(out, "monitor.png"),
        fullPage: true,
      });
      await page.screenshot({ path: resolve(out, "controlled-page.png") });
      const status = await ui.request
        .get(viewer.url + "/status")
        .then((r) => r.json());
      assert.ok(status.frames > 0);
      assert.equal(status.driver.descriptor.id, "notebook");
    },
  );
  await run("incompatible adapter fails before browser action", async () => {
    const adapter = createNotebookAdapter(page);
    adapter.model.version = "incompatible";
    await assert.rejects(
      createDriverSession({ page, context, enginePath, adapter }),
      /versions do not match/,
    );
    assert.equal(
      await page.getByLabel("Note").inputValue(),
      "From the live monitor",
    );
  });
  await run(
    "authored recipe protects human draft and runs after explicit cancellation",
    async () => {
      let s = await session.snapshot();
      const refused = await session.runRecipe("save_example", s.revision);
      assert.equal(refused.execution, "rejected");
      assert.equal(
        await page.getByLabel("Note").inputValue(),
        "From the live monitor",
      );
      assert.equal((await command("cancel")).outcome.kind, "success");
      s = await session.snapshot();
      const recipe = await session.runRecipe("save_example", s.revision);
      assert.equal(recipe.execution, "completed");
      assert.equal(recipe.outcome.kind, "success");
      assert.equal(recipe.effect.status, "saved");
    },
  );
} finally {
  const report = session?.report();
  let cleanup = "PASS";
  try {
    await scope.close();
  } catch (e) {
    cleanup = "FAIL";
    console.error(e);
    process.exitCode = 1;
  }
  await fs.writeFile(
    resolve(out, "results.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        identity,
        results,
        cleanup,
        resources: scope.snapshot(),
        report,
      },
      null,
      2,
    ),
  );
}
