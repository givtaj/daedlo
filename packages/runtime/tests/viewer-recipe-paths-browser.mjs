// Shared-path presentation over legacy descriptors; synthetic conformance only.
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
const runtimeRequire = createRequire(
  process.env.CLI_TEST_RUNTIME || import.meta.url,
);
const { chromium } = runtimeRequire("playwright");
const { createViewer } = await import(
  process.env.CLI_TEST_RUNTIME
    ? pathToFileURL(process.env.CLI_TEST_RUNTIME).href
    : new URL("../src/index.mjs", import.meta.url).href
);

const root = resolve(
  process.env.RECIPE_PATHS_OUTPUT ?? "artifacts/shared-flow-panel/browser",
);
await mkdir(root, { recursive: true });
const output = await mkdtemp(join(root, "run-"));
console.log(`Shared-path browser evidence: ${output}`);

const privateValues = ["synthetic-parameter-one", "synthetic-parameter-two"];
const commands = [
  {
    id: "open",
    label: "Open editor",
    params: { target: { type: "text", label: "Target" } },
  },
  { id: "prepare", label: "Prepare draft", params: {} },
  { id: "save", label: "Save draft", params: {} },
  { id: "discard", label: "Discard draft", params: {} },
  { id: "inspect", label: "Inspect saved draft", params: {} },
  {
    id: "visit",
    label: "Open editor",
    params: { target: { type: "text", label: "Target" } },
  },
];
const step = (command, params = {}) => ({ command, params });
const recipes = [
  {
    id: "save-path",
    label: "Save the prepared draft",
    steps: [
      step("open", { target: privateValues[0] }),
      step("prepare"),
      step("save"),
    ],
  },
  {
    id: "discard-path",
    label: "Discard the prepared draft",
    steps: [
      step("open", { target: privateValues[0] }),
      step("prepare"),
      step("discard"),
    ],
  },
  {
    id: "other-target",
    label: "Save another draft",
    steps: [
      step("open", { target: privateValues[1] }),
      step("prepare"),
      step("save"),
    ],
  },
  {
    id: "other-command",
    label: "Use another entry command",
    steps: [
      step("visit", { target: privateValues[0] }),
      step("prepare"),
      step("save"),
    ],
  },
  {
    id: "inspect-path",
    label: "Inspect the saved draft",
    steps: [step("inspect")],
  },
];

async function withViewer(name, run, selectedRecipes = recipes) {
  const receipt = {
    name,
    status: "RUNNING",
    setup: "RUNNING",
    screenshots: [],
    cleanup: {},
  };
  let server, browser, viewer, application, ui, failure;
  const calls = [];
  const requests = [];
  const snapshot = {
    connected: true,
    descriptor: {
      id: "recipe-path-fixture",
      version: "1",
      label: "Recipe path fixture",
      states: [
        { id: "ready", label: "Ready", parent: null, support: "supported" },
      ],
      commands: structuredClone(commands),
      recipes: structuredClone(selectedRecipes),
    },
    revision: "observed-r1",
    state: { id: "ready" },
    commands: commands.map(({ id }) => ({ id, enabled: true })),
    recipes: selectedRecipes.map(({ id }) => ({ id, enabled: true })),
    display: [{ label: "Observation", value: "initial" }],
    execution: "idle",
    busy: false,
    paused: false,
    speed: "normal",
  };
  try {
    server = http.createServer((req, res) =>
      res.end(
        "<!doctype html><title>Recipe fixture</title><h1>Synthetic draft editor</h1>",
      ),
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 900, height: 620 },
    });
    application = await context.newPage();
    await application.goto(origin);
    const session = {
      snapshot: async () => structuredClone(snapshot),
      command: async (body) => {
        calls.push(structuredClone(body));
        return {
          ok: true,
          execution: "completed",
          outcome: { kind: "unknown", label: "Synthetic dispatch only" },
        };
      },
    };
    viewer = await createViewer({
      page: application,
      context,
      session,
      frontend: {
        name: "Recipe fixture",
        targetOrigin: origin,
        model: {
          id: snapshot.descriptor.id,
          version: snapshot.descriptor.version,
        },
        evidenceLocation: "/local/synthetic/reports",
        ownership: {
          browser: "owned",
          context: "owned",
          application: "attached",
        },
      },
    });
    const monitor = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    ui = await monitor.newPage();
    ui.setDefaultTimeout(5000);
    ui.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/command"
      )
        requests.push(request.postDataJSON());
    });
    await ui.goto(viewer.url);
    await ui.waitForFunction(
      () => document.querySelector("#connection").textContent === "Connected",
    );
    assert.equal(
      await ui.locator("button[data-recipe]").count(),
      selectedRecipes.length,
    );
    receipt.setup = "PASS";
    const screenshot = async (label, selector, fullPage = true) => {
      const file = `${name}-${label}.png`;
      if (selector)
        await ui.locator(selector).screenshot({ path: join(output, file) });
      else await ui.screenshot({ path: join(output, file), fullPage });
      receipt.screenshots.push(file);
    };
    await run({
      ui,
      snapshot,
      calls,
      requests,
      application,
      origin,
      screenshot,
    });
    receipt.status = "PASS";
  } catch (error) {
    failure = error;
    receipt.status = "FAIL";
    receipt.failure = { message: error.message, code: error.code };
    if (ui) {
      try {
        const file = `${name}-failure.png`;
        await ui.screenshot({ path: join(output, file), fullPage: true });
        receipt.screenshots.push(file);
      } catch (captureError) {
        receipt.captureFailure = captureError.message;
      }
    }
  } finally {
    for (const [resource, close] of [
      [
        "viewer",
        async () => {
          await viewer?.close();
          if (application)
            assert.equal(
              application.isClosed(),
              false,
              "Viewer close must preserve its attached application page",
            );
        },
      ],
      [
        "browser",
        async () => {
          await browser?.close();
        },
      ],
      [
        "applicationServer",
        async () => {
          if (server?.listening)
            await new Promise((done, reject) =>
              server.close((error) => (error ? reject(error) : done())),
            );
        },
      ],
    ]) {
      try {
        await close();
        receipt.cleanup[resource] = "closed";
      } catch (error) {
        receipt.cleanup[resource] = "FAILED";
        failure ??= error;
      }
    }
    if (failure) receipt.status = "FAIL";
    receipt.dispatchCount = calls.length;
    await writeFile(
      join(output, `${name}.json`),
      JSON.stringify(receipt, null, 2) + "\n",
    );
  }
  if (failure) throw failure;
}

test("legacy recipes expose only an exact shared prefix as an inspectable path group", async () => {
  await withViewer(
    "grouping",
    async ({ ui, snapshot, calls, requests, screenshot }) => {
      const groups = ui.locator(
        "#recipes > details.recipe-path-group[data-flow-group]",
      );
      assert.equal(
        await groups.count(),
        1,
        "Two legacy recipes sharing command IDs and parameters need one shared-path group",
      );
      assert.deepEqual(
        await groups
          .locator("button[data-recipe]")
          .evaluateAll((buttons) =>
            buttons.map((button) => button.dataset.recipe),
          ),
        ["save-path", "discard-path"],
      );
      assert.equal(
        await groups.evaluate((group) => group.open),
        true,
        "Shared paths start open so existing run buttons stay visible",
      );
      assert.equal(
        await ui.locator('button[data-recipe="save-path"]').isVisible(),
        true,
      );
      assert.match(
        await groups.locator(":scope > summary").innerText(),
        /Open editor/,
      );
      assert.equal(
        await groups
          .locator(".shared-path-steps")
          .evaluate((list) => list.tagName),
        "OL",
      );
      assert.deepEqual(
        (await groups.locator(".shared-path-steps > li").allTextContents()).map(
          (label) => label.trim(),
        ),
        ["Open editor", "Prepare draft"],
      );
      assert.deepEqual(
        await ui
          .locator("#recipes > .recipe-card button[data-recipe]")
          .evaluateAll((buttons) =>
            buttons.map((button) => button.dataset.recipe),
          ),
        ["other-target", "other-command", "inspect-path"],
        "Different parameter values or command IDs must not group merely because their labels match",
      );
      assert.equal(
        await ui.locator("#commands .command-card").count(),
        commands.length,
        "Legacy command forms remain available beside the paths",
      );
      assert.equal(
        await ui.locator("#recipes button:not([data-recipe])").count(),
        0,
        "Inspection must not add a run-all action",
      );

      const summary = groups.locator(":scope > summary");
      await summary.click();
      await observe(ui, snapshot, "closed-group");
      assert.equal(
        await groups.evaluate((group) => group.open),
        false,
        "Status polling preserves a collapsed group",
      );
      await summary.focus();
      await summary.press("Enter");
      assert.equal(await groups.evaluate((group) => group.open), true);
      for (const recipe of recipes) {
        const card = recipeCard(ui, recipe.id);
        const preview = card.locator("details.recipe-step-preview");
        assert.equal(
          await preview.count(),
          1,
          "Each existing recipe has a separate step disclosure",
        );
        await preview.locator(":scope > summary").click();
        assert.equal(
          await preview
            .locator(".recipe-step-list")
            .evaluate((list) => list.tagName),
          "OL",
        );
        assert.deepEqual(
          (
            await preview
              .locator(".recipe-step-list > li > span")
              .allTextContents()
          ).map((label) => label.trim()),
          recipe.steps.map(
            ({ command }) => commands.find(({ id }) => id === command).label,
          ),
          "Full previews retain the complete authored sequence, including shared setup",
        );
        assert.equal(
          await preview.locator(".recipe-step-list > li").count(),
          recipe.steps.length,
          "Annotations must not add or omit authored steps",
        );
        assert.equal(
          await preview.locator(".shared-step-label").count(),
          ["save-path", "discard-path"].includes(recipe.id) ? 2 : 0,
        );
      }
      await observe(ui, snapshot, "expanded-previews");
      assert.equal(
        await ui.locator("#recipes details.recipe-step-preview[open]").count(),
        recipes.length,
        "Status polling must not collapse inspected steps",
      );
      for (const value of privateValues) {
        assert.equal(
          (await ui.locator("#recipes").innerHTML()).includes(value),
          false,
          "New path labels, previews and attributes must not expose recipe parameter values",
        );
      }
      assert.deepEqual(
        calls,
        [],
        "Opening shared paths and previews never executes a recipe",
      );
      assert.deepEqual(
        requests,
        [],
        "Read-only disclosures send no command request",
      );
      await layoutFits(ui);
      await ui.locator(".action-panel").evaluate((panel) => {
        const recipes = panel.querySelector("#recipes");
        panel.scrollTop +=
          recipes.getBoundingClientRect().top -
          panel.getBoundingClientRect().top -
          24;
      });
      assert.equal(
        await groups.locator(":scope > summary").evaluate((summary) => {
          const panel = summary
            .closest(".action-panel")
            .getBoundingClientRect();
          const visible = summary.getBoundingClientRect();
          return visible.top >= panel.top && visible.bottom <= panel.bottom;
        }),
        true,
        "The shared path remains reachable in the existing desktop command-panel scroller",
      );
      await screenshot("desktop-paths", ".action-panel");
      await screenshot("desktop", undefined, false);
      await ui.setViewportSize({ width: 390, height: 844 });
      await layoutFits(ui);
      await screenshot("narrow-paths", "#recipes");
      await screenshot("narrow");
    },
  );
});

function recipeCard(ui, id) {
  return ui
    .locator("#recipes .recipe-card")
    .filter({ has: ui.locator(`button[data-recipe="${id}"]`) });
}

async function observe(ui, snapshot, marker) {
  snapshot.display = [{ label: "Observation", value: marker }];
  await ui.waitForFunction(
    (value) =>
      document.querySelector("#display-facts").textContent.includes(value),
    marker,
  );
}

async function layoutFits(ui) {
  const layout = await ui.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(
    layout.document <= layout.viewport + 1 &&
      layout.body <= layout.viewport + 1,
    `Recipe inspection must not introduce horizontal overflow: ${JSON.stringify(layout)}`,
  );
}

test("a chosen child preserves exact dispatch and all existing availability boundaries", async () => {
  await withViewer(
    "dispatch",
    async ({
      ui,
      snapshot,
      calls,
      requests,
      application,
      origin,
      screenshot,
    }) => {
      const save = ui.locator('button[data-recipe="save-path"]');
      const discard = ui.locator('button[data-recipe="discard-path"]');
      const denied = snapshot.recipes.find(({ id }) => id === "save-path");
      denied.enabled = false;
      denied.reason = "Save needs independent readback first.";
      snapshot.revision = "observed-r2";
      await observe(ui, snapshot, "available-r2");
      assert.equal(await save.isDisabled(), true);
      assert.equal(
        await discard.isEnabled(),
        true,
        "A disabled sibling must not disable another available branch",
      );
      assert.match(
        await recipeCard(ui, "save-path").innerText(),
        /Save needs independent readback first/,
      );
      await save.evaluate((button) => button.click());
      await observe(ui, snapshot, "disabled-not-dispatched");
      assert.deepEqual(calls, []);
      assert.deepEqual(requests, []);

      const response = ui.waitForResponse(
        (item) =>
          new URL(item.url()).pathname === "/command" &&
          item.request().method() === "POST",
      );
      await discard.evaluate((button) => {
        button.click();
        button.click();
      });
      assert.equal((await response).status(), 200);
      await ui.waitForFunction(
        () =>
          !document.querySelector('button[data-recipe="discard-path"]')
            .disabled,
      );
      const expected = {
        id: "discard-path",
        revision: "observed-r2",
        recipe: true,
      };
      assert.deepEqual(
        calls,
        [expected],
        "Only the selected canonical recipe runs once, using the newest observed revision",
      );
      assert.deepEqual(
        requests,
        [expected],
        "The viewer sends no recipe steps or private parameters, even on a rapid second click",
      );

      const commandResponse = ui.waitForResponse(
        (item) =>
          new URL(item.url()).pathname === "/command" &&
          item.request().method() === "POST",
      );
      await ui.locator('button[data-command="inspect"]').click();
      assert.equal((await commandResponse).status(), 200);
      await ui.waitForFunction(
        () =>
          !document.querySelector('button[data-command="inspect"]').disabled,
      );
      assert.deepEqual(
        calls[1],
        { id: "inspect", params: {}, revision: "observed-r2" },
        "Legacy command dispatch retains its original payload",
      );

      denied.enabled = true;
      denied.reason = "Ready after readback.";
      await observe(ui, snapshot, "enabled-again");
      assert.equal(await save.isEnabled(), true);
      assert.match(
        await recipeCard(ui, "save-path").innerText(),
        /Ready after readback/,
      );
      for (const [marker, changes] of [
        ["busy", { busy: true, execution: "running" }],
        ["paused", { busy: false, paused: true, execution: "paused" }],
        ["disconnected", { paused: false, connected: false }],
      ]) {
        Object.assign(snapshot, changes);
        await observe(ui, snapshot, marker);
        assert.equal(
          await discard.isDisabled(),
          true,
          `${marker} must disable grouped recipe execution`,
        );
        assert.equal(
          await ui.locator('button[data-recipe="inspect-path"]').isDisabled(),
          true,
          `${marker} must also disable flat recipes`,
        );
        await discard.evaluate((button) => button.click());
        await observe(ui, snapshot, `${marker}-no-dispatch`);
        assert.equal(calls.length, 2);
        assert.equal(requests.length, 2);
      }
      Object.assign(snapshot, {
        connected: true,
        busy: false,
        paused: false,
        execution: "idle",
        revision: null,
      });
      await observe(ui, snapshot, "missing-revision");
      await discard.evaluate((button) => button.click());
      await observe(ui, snapshot, "missing-revision-no-dispatch");
      assert.equal(
        requests.length,
        2,
        "A missing observed revision cannot dispatch a recipe",
      );

      snapshot.revision = "observed-r3";
      await observe(ui, snapshot, "before-mismatch");
      await application.goto("about:blank");
      await ui.locator("#frontend-warning").waitFor({ state: "visible" });
      assert.equal(
        await discard.isDisabled(),
        true,
        "Frontend mismatch disables grouped paths",
      );
      const refused = await ui.evaluate(async () => {
        const response = await fetch("/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: "discard-path",
            revision: "observed-r3",
            recipe: true,
          }),
        });
        return { status: response.status, body: await response.json() };
      });
      assert.equal(refused.status, 409);
      assert.equal(refused.body.error_code, "frontend_mismatch");
      assert.equal(
        calls.length,
        2,
        "The server also rejects a target mismatch before the session handler",
      );
      await screenshot("frontend-mismatch");
      await application.goto(origin);
      await ui.waitForFunction(
        () => document.querySelector("#connection").textContent === "Connected",
      );
      await ui.reload();
      await ui.waitForFunction(
        () => document.querySelector("#connection").textContent === "Connected",
      );
      assert.equal(
        calls.length,
        2,
        "Reconnect and viewer reload do not replay the chosen child",
      );
      assert.equal(
        requests.length,
        3,
        "Only the deliberate rejected frontend request was added",
      );
    },
  );
});

test("one legacy recipe stays flat and runs unchanged while its preview remains read-only", async () => {
  await withViewer(
    "singleton",
    async ({ ui, snapshot, calls, requests }) => {
      assert.equal(
        await ui.locator("#recipes details.recipe-path-group").count(),
        0,
      );
      assert.equal(await ui.locator("#recipes > .recipe-card").count(), 1);
      const button = ui.locator('button[data-recipe="inspect-path"]');
      assert.equal(await button.isVisible(), true);
      assert.equal(await button.isEnabled(), true);
      const response = ui.waitForResponse(
        (item) =>
          new URL(item.url()).pathname === "/command" &&
          item.request().method() === "POST",
      );
      await button.click();
      assert.equal((await response).status(), 200);
      const expected = {
        id: "inspect-path",
        revision: "observed-r1",
        recipe: true,
      };
      assert.deepEqual(calls, [expected]);
      assert.deepEqual(requests, [expected]);
      const preview = recipeCard(ui, "inspect-path").locator(
        "details.recipe-step-preview",
      );
      await preview.locator(":scope > summary").click();
      await observe(ui, snapshot, "singleton-preview");
      assert.deepEqual(
        (await preview.locator(".recipe-step-list > li").allTextContents()).map(
          (label) => label.trim(),
        ),
        ["Inspect saved draft"],
      );
      assert.deepEqual(calls, [expected]);
      assert.deepEqual(requests, [expected]);
    },
    [recipes.find(({ id }) => id === "inspect-path")],
  );
});

test("a legacy descriptor without recipes preserves its empty state and command controls", async () => {
  await withViewer(
    "empty",
    async ({ ui, calls, requests }) => {
      assert.match(
        await ui.locator("#recipes").innerText(),
        /No authored recipes/,
      );
      assert.equal(
        await ui.locator("#recipes details, #recipes button").count(),
        0,
      );
      assert.equal(
        await ui.locator("#commands .command-card").count(),
        commands.length,
      );
      assert.equal(
        await ui.locator('button[data-command="inspect"]').isEnabled(),
        true,
      );
      assert.deepEqual(calls, []);
      assert.deepEqual(requests, []);
    },
    [],
  );
});
