import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { runtime, runtimeUrl, chromium } from "./runtime.mjs";
import { createStarterFixture } from "./fixture.mjs";
import { createStarterAdapter } from "./adapter.mjs";
const { createEngineClient, createDriverSession, createViewer } = runtime;
const enginePath = process.env.DAEDLO_STARTER_ENGINE;
const invalidEnginePath = process.env.DAEDLO_STARTER_INVALID_ENGINE;
if (!enginePath || !invalidEnginePath || !process.env.DAEDLO_STARTER_OUTPUT)
  throw new Error(
    "Set DAEDLO_STARTER_ENGINE, DAEDLO_STARTER_INVALID_ENGINE and DAEDLO_STARTER_OUTPUT after building the exact model/crate pair.",
  );
const out = resolve(process.env.DAEDLO_STARTER_OUTPUT);
await mkdir(out, { recursive: true });
const checks = [],
  startedAt = new Date().toISOString();
let browser, fixture, session, viewer, adapter, page, context, cleanup;
const run = async (name, check) => {
  try {
    await check();
    checks.push({ name, status: "PASS" });
    console.log("PASS " + name);
  } catch (error) {
    checks.push({ name, status: "FAIL", error: error.message });
    throw error;
  }
};
const hash = async (file) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
const identity = {
  application: "starter-fixture/1",
  runtimeEntry: runtimeUrl,
  engineSha256: await hash(enginePath),
  invalidEngineSha256: await hash(invalidEnginePath),
};
try {
  await run(
    "real Rust hello and invalid Select metadata diagnostics",
    async () => {
      for (const [path, invalid] of [
        [enginePath, false],
        [invalidEnginePath, true],
      ]) {
        const engine = createEngineClient(path);
        try {
          const hello = await engine.request({ op: "hello" });
          if (invalid) {
            assert.equal(hello.ok, false);
            assert.equal(hello.error_code, "invalid_model");
            assert.match(hello.error, /maxLength|max_length/);
            assert.match(hello.error, /commands\[0\]|commands\/0/);
            await writeFile(
              resolve(out, "invalid-model-hello.json"),
              JSON.stringify(hello, null, 2),
            );
          } else {
            assert.equal(hello.ok, true);
            assert.equal(hello.descriptor.id, "starter");
          }
        } finally {
          await engine.close();
        }
      }
    },
  );
  fixture = await createStarterFixture();
  browser = await chromium.launch({ headless: true });
  identity.browserVersion = browser.version();
  context = await browser.newContext({
    viewport: { width: 1100, height: 800 },
    serviceWorkers: "block",
  });
  page = await context.newPage();
  adapter = createStarterAdapter(page);
  await page.goto(fixture.url);
  session = await createDriverSession({
    page,
    context,
    enginePath,
    adapter,
    identity,
  });
  session.setSpeed("fast");
  const command = async (id, params = {}) =>
    session.execute(id, params, (await session.snapshot()).revision);
  await run(
    "empty-note validation has no write or attempted effect",
    async () => {
      const edit = await command("edit", { text: "", category: "plain" });
      assert.equal(edit.execution, "completed", JSON.stringify(edit));
      assert.equal(edit.outcome.kind, "success");
      const report = await command("save");
      assert.equal(report.execution, "completed");
      assert.equal(report.outcome.kind, "validation");
      assert.equal(report.effect.status, "not_attempted");
      assert.equal(fixture.writes, 0);
    },
  );
  await run("existing and changed drafts reject without writes", async () => {
    await command("edit", { text: "Existing draft", category: "plain" });
    let snapshot = await session.snapshot();
    assert.equal(
      (await session.runRecipe("save_example", snapshot.revision)).execution,
      "rejected",
    );
    snapshot = await session.snapshot();
    await page
      .getByLabel("Note", { exact: true })
      .fill("Changed by an independent user");
    assert.equal(
      (await session.execute("save", {}, snapshot.revision)).execution,
      "rejected",
    );
    assert.equal(fixture.writes, 0);
  });
  await run(
    "guarded save confirms one operation through independent readback",
    async () => {
      await command("edit", {
        text: "A measured starter note",
        category: "work",
      });
      const report = await command("save");
      assert.equal(report.execution, "completed");
      assert.equal(report.outcome.kind, "success");
      assert.equal(report.effect.status, "saved");
      assert.equal(fixture.writes, 1);
      const result = await context.request
        .get(fixture.url + "/api/notes")
        .then((response) => response.json());
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].text, "A measured starter note");
      await writeFile(
        resolve(out, "save-report.json"),
        JSON.stringify(report, null, 2),
      );
    },
  );
  await run(
    "lost response remains uncertain despite a real server write",
    async () => {
      await command("edit", {
        text: "Response will be lost",
        category: "plain",
      });
      const pattern = "**/api/notes";
      const routeHandler = async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        await route.fetch();
        await route.abort("failed");
      };
      await page.route(pattern, routeHandler);
      try {
        const report = await command("save");
        assert.equal(report.outcome.kind, "recoverable_error");
        assert.equal(report.effect.status, "uncertain");
        assert.equal(fixture.writes, 2);
        assert.equal(
          await page.getByLabel("Note", { exact: true }).inputValue(),
          "Response will be lost",
        );
        await writeFile(
          resolve(out, "uncertain-report.json"),
          JSON.stringify(report, null, 2),
        );
      } finally {
        await page.unroute(pattern, routeHandler);
      }
    },
  );
  await run(
    "canonical Rust recipe and visible viewer render the actual result",
    async () => {
      await command("discard");
      const report = await session.runRecipe(
        "save_example",
        (await session.snapshot()).revision,
      );
      assert.equal(report.execution, "completed");
      assert.equal(report.outcome.kind, "success");
      assert.equal(fixture.writes, 3);
      viewer = await createViewer({
        page,
        context,
        session,
        frontend: {
          name: "Starter synthetic editor",
          targetOrigin: fixture.url,
          model: { id: "starter", version: "1" },
          evidenceLocation: out,
          ownership: {
            browser: "owned",
            context: "owned",
            application: "owned",
          },
        },
      });
      const monitor = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      try {
        const ui = await monitor.newPage();
        await ui.goto(viewer.url);
        await ui.locator('[data-command="save"]').waitFor();
        await ui.waitForFunction(
          () => document.querySelector("img")?.naturalWidth > 0,
        );
        await ui.screenshot({
          path: resolve(out, "viewer.png"),
          fullPage: true,
        });
        await page.screenshot({
          path: resolve(out, "fixture.png"),
          fullPage: true,
        });
      } finally {
        await monitor.close();
      }
    },
  );
  await run(
    "session cleanup preserves attached page and application",
    async () => {
      await viewer.close();
      viewer = undefined;
      await session.close();
      session = undefined;
      cleanup = adapter.requestDiagnostics();
      assert.equal(cleanup.closed, true);
      assert.equal(cleanup.pendingCount, 0);
      assert.equal(page.isClosed(), false);
      assert.equal((await context.request.get(fixture.url)).ok(), true);
    },
  );
  await run(
    "real-browser request accounting and unresolved evidence",
    async () => {
      const { checks: requestChecks } = await import(
        "./request-acceptance.mjs"
      );
      checks.push(...requestChecks);
    },
  );
} finally {
  const failures = [];
  for (const [label, resource] of [
    ["viewer", viewer],
    ["session", session],
    ["browser", browser],
    ["fixture", fixture],
  ]) {
    try {
      await resource?.close();
    } catch (error) {
      failures.push({ label, error: error.message });
    }
  }
  if (adapter && !cleanup) cleanup = adapter.close();
  await writeFile(
    resolve(out, "result.json"),
    JSON.stringify(
      {
        startedAt,
        finishedAt: new Date().toISOString(),
        identity,
        checks,
        cleanup: {
          adapter: cleanup,
          failures,
          ownedBrowserClosed: browser ? !browser.isConnected() : null,
        },
        limitations: [
          "Synthetic fixture only; customer acceptance not run.",
          "Missing browser terminal events remain unresolved. Settle or explicitly cancel old document work before navigation.",
          "HTTP response alone does not establish persistence.",
        ],
      },
      null,
      2,
    ),
  );
  if (failures.length)
    throw new Error("Owned cleanup incomplete; inspect result.json");
}
