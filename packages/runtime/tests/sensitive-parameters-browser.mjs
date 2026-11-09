// Real Chromium viewer conformance over explicit synthetic model metadata.
// Generated input values stay in memory and are never written to evidence.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { createViewer } from "../src/viewer/server.mjs";

test("viewer masks only explicit password fields and clears them before dispatch completion", async () => {
  const root = resolve(
    process.env.SENSITIVE_PARAMETERS_OUTPUT || "artifacts/sensitive-parameters",
  );
  await mkdir(root, { recursive: true });
  const output = await mkdtemp(join(root, "run-"));
  let browser, viewer, release, acceptCommand;
  let received;
  let calls = 0;
  const snapshot = {
    connected: true,
    descriptor: {
      id: "password-fixture",
      version: "1",
      label: "Password presentation fixture",
      states: [
        { id: "ready", label: "Ready", parent: null, support: "supported" },
      ],
      commands: [
        {
          id: "submit",
          label: "Submit parameters",
          params: {
            secret: {
              type: "password",
              label: "Private value",
              required: true,
              maxLength: 64,
              default: "{}",
            },
            plain: {
              type: "text",
              label: "Password note",
              default: "Public note",
            },
          },
        },
      ],
      recipes: [
        {
          id: "public-template",
          label: "Public template",
          steps: [{ command: "submit", params: { secret: "{}" } }],
        },
      ],
    },
    state: { id: "ready" },
    revision: "ready-1",
    commands: [{ id: "submit", enabled: true }],
    recipes: [{ id: "public-template", enabled: true }],
    display: [],
    execution: "idle",
    busy: false,
    paused: false,
    speed: "fast",
    lastResult: null,
  };
  const session = {
    snapshot: async () => structuredClone(snapshot),
    command: async (body) => {
      calls += 1;
      received = body;
      const pending = new Promise((resolve) => {
        release = resolve;
      });
      acceptCommand?.();
      await pending;
      const result = {
        ok: calls === 1,
        execution: calls === 1 ? "completed" : "rejected",
        command: "submit",
        outcome: calls === 1 ? { kind: "success", label: "Observed" } : null,
        effect: { status: "not_attempted" },
      };
      snapshot.lastResult = result;
      return result;
    },
  };
  const receipt = {
    scope: "Synthetic real-browser password presentation",
    checks: [],
    cleanup: {},
  };
  try {
    browser = await chromium.launch({ headless: true });
    const application = await browser.newPage();
    await application.setContent("<h1>Independent presentation fixture</h1>");
    viewer = await createViewer({
      page: application,
      context: application.context(),
      session,
    });
    const ui = await browser.newPage({
      viewport: { width: 1360, height: 1000 },
    });
    await ui.goto(viewer.url);
    const secretInput = ui.getByLabel("Private value", { exact: true });
    const plainInput = ui.getByLabel("Password note", { exact: true });
    await secretInput.waitFor();
    assert.equal(
      await secretInput.getAttribute("type"),
      "password",
      "Explicit password metadata must render a masked HTML input",
    );
    assert.equal(await secretInput.getAttribute("autocomplete"), "off");
    assert.equal(await secretInput.getAttribute("spellcheck"), "false");
    assert.equal(await secretInput.getAttribute("maxlength"), "64");
    assert.equal(
      await plainInput.getAttribute("type"),
      "text",
      "Labels must never infer sensitivity",
    );
    assert.equal(
      (await secretInput.inputValue()) === "{}",
      true,
      "Public defaults retain their value behind masking",
    );
    await ui.getByText("Preview steps", { exact: true }).click();
    assert.equal(
      (await ui.locator(".recipe-step-preview").innerText()).includes("{}"),
      false,
      "Recipe previews must not render parameter literals",
    );
    receipt.checks.push(
      "Explicit type masks; legacy text remains text; recipe preview omits values",
    );
    const privateValue = `private-${randomUUID()}`;
    await secretInput.fill(privateValue);
    await ui.screenshot({
      path: join(output, "masked-input.png"),
      fullPage: true,
    });
    const sent = ui.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === "/command" &&
        request.method() === "POST",
    );
    const dispatched = new Promise((resolve) => {
      acceptCommand = resolve;
    });
    await ui
      .getByRole("button", { name: "Submit parameters", exact: true })
      .click();
    await sent;
    await dispatched;
    assert.equal(
      (await secretInput.inputValue()).length,
      0,
      "Sensitive form input must clear immediately after submission",
    );
    assert.equal(
      await plainInput.inputValue(),
      "Public note",
      "Ordinary fields must retain their input",
    );
    assert.equal(
      received?.params.secret === privateValue,
      true,
      "Handler must receive unchanged sensitive input",
    );
    assert.equal(received?.params.plain, "Public note");
    release();
    await ui.waitForFunction(
      () => !document.querySelector('[data-command="submit"]').disabled,
    );
    assert.equal(
      (await secretInput.inputValue()).length,
      0,
      "Status refresh must not restore sensitive defaults",
    );
    assert.equal(
      (await ui.locator("body").innerText()).includes(privateValue),
      false,
      "Results and viewer text must not expose submitted input",
    );
    receipt.checks.push(
      "Submitted value is unchanged; sensitive input clears before response and stays empty",
    );
    const rejectedValue = `private-${randomUUID()}`;
    await secretInput.fill(rejectedValue);
    const rejectedSent = ui.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === "/command" &&
        request.method() === "POST",
    );
    const rejectedDispatch = new Promise((resolve) => {
      acceptCommand = resolve;
    });
    await ui
      .getByRole("button", { name: "Submit parameters", exact: true })
      .click();
    await rejectedSent;
    await rejectedDispatch;
    assert.equal(
      (await secretInput.inputValue()).length,
      0,
      "Refused submissions must not retain sensitive input",
    );
    release();
    await ui.waitForFunction(
      () => !document.querySelector('[data-command="submit"]').disabled,
    );
    assert.equal((await secretInput.inputValue()).length, 0);
    assert.equal(calls, 2);
    receipt.checks.push("Refused submission stays empty without retry");
    await ui.screenshot({
      path: join(output, "cleared-input.png"),
      fullPage: true,
    });
  } finally {
    release?.();
    if (viewer) {
      await viewer.close();
      receipt.cleanup.viewer = "closed";
    }
    if (browser) {
      await browser.close();
      receipt.cleanup.browser = "closed";
    }
    await writeFile(
      join(output, "receipt.json"),
      JSON.stringify(receipt, null, 2) + "\n",
    );
  }
});
