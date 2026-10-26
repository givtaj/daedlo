import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { createNotebookAdapter } from "./adapter.mjs";

// The selected runtime is injected by the managed owner. This same authored
// source works with both installed package families; it never imports a runtime.
export async function createManagedLaunch({
  runtime,
  resources,
  enginePath,
  installation,
  settings,
}) {
  const target = new URL(settings.origin);
  assert.equal(target.protocol, "http:");
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.origin, settings.origin);
  resources.attach(
    { origin: settings.origin },
    { label: "Separately owned synthetic notebook application" },
  );
  const load = createRequire(installation.runtimePath);
  const { chromium } = load("playwright");
  const executablePath = await realpath(
    installation.browser?.executablePath ?? chromium.executablePath(),
  );
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    handleSIGINT: false,
    handleSIGTERM: false,
  });
  resources.own(browser, {
    label: "Upgrade fixture controlled browser",
    close: (value) => value.close(),
  });
  if (runtime.registerBrowser)
    await runtime.registerBrowser({ browser, executablePath });
  const browserIdentity = {
    version: browser.version(),
    executablePath,
    sha256: createHash("sha256")
      .update(await readFile(executablePath))
      .digest("hex"),
  };
  const context = await browser.newContext({
    viewport: { width: 1100, height: 780 },
  });
  resources.own(context, {
    label: "Upgrade fixture browser context",
    close: (value) => value.close(),
  });
  const page = await context.newPage();
  await page.goto(settings.origin);
  await page.locator("#note").waitFor();
  await page.waitForFunction(
    () => document.querySelector("#account").textContent === "alpha",
  );
  const adapter = createNotebookAdapter(page);
  const sessionResources = runtime.createResourceScope();
  const session = await runtime.createDriverSession({
    page,
    context,
    enginePath,
    adapter,
    resources: {
      snapshot: () => resources.snapshot(),
      close: () => sessionResources.close(),
    },
    identity: {
      application: "Independent notebook",
      fixture: "Synthetic accepted-baseline to candidate upgrade",
    },
  });
  resources.own(session, {
    label: "Upgrade fixture driver session",
    close: (value) => value.close(),
  });
  session.setSpeed("fast");
  const viewer = await runtime.createViewer({
    page,
    context,
    session,
    port: 0,
  });
  resources.own(viewer, {
    label: "Upgrade fixture viewer",
    close: (value) => value.close(),
  });
  return {
    session,
    viewerUrl: viewer.url,
    browser: browserIdentity,
    async draftState() {
      return ["draft", "validation", "recovery", "saving"].includes(
        (await adapter.observe()).facts.phase,
      );
    },
  };
}
