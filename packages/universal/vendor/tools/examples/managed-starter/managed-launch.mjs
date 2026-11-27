import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { readPrivateCatalog } from "./catalog.mjs";
import { createManagedStarterAdapter } from "./adapter.mjs";

export async function createManagedLaunch({
  runtime,
  resources,
  enginePath,
  installation,
  settings,
  signal,
}) {
  const check = () => signal?.throwIfAborted();
  check();
  const target = new URL(settings.origin);
  if (
    target.protocol !== "http:" ||
    target.hostname !== "127.0.0.1" ||
    target.origin !== settings.origin
  )
    throw new Error("Select the separately owned loopback starter fixture.");
  const catalog = await readPrivateCatalog(settings.privateCatalogFile);
  check();
  // Explicit target/settings replace environment lookups. The managed child has
  // a restricted environment and refuses dynamic loading in this source closure.
  const health = await fetch(target.origin + "/api/notes", {
    signal: signal ?? AbortSignal.timeout(5000),
  });
  if (!health.ok || !Array.isArray((await health.json()).items))
    throw new Error("The starter fixture prerequisite is unavailable.");
  resources.attach(
    { origin: target.origin },
    { label: "Separately owned starter fixture" },
  );
  const load = createRequire(installation.runtimePath);
  const { chromium } = load("playwright");
  const executablePath = await realpath(
    installation.browser?.executablePath ?? chromium.executablePath(),
  );
  const browser = await chromium.launch({
    executablePath,
    headless: settings.headless !== false,
    handleSIGINT: false,
    handleSIGTERM: false,
  });
  resources.own(browser, {
    label: "Managed starter browser",
    close: (value) => value.close(),
  });
  check();
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
    serviceWorkers: "block",
    viewport: { width: 1100, height: 780 },
  });
  resources.own(context, {
    label: "Managed starter context",
    close: (value) => value.close(),
  });
  const page = await context.newPage();
  // Install request listeners before the initial navigation.
  const adapter = createManagedStarterAdapter(page, { catalog });
  resources.own(adapter, {
    label: "Managed starter observers",
    close: (value) => value.close(),
  });
  await page.goto(target.origin);
  await page.locator("#note").waitFor();
  await adapter.settle();
  check();
  const session = await runtime.createDriverSession({
    page,
    context,
    enginePath,
    adapter,
    identity: { application: "Independent managed starter" },
  });
  resources.own(session, {
    label: "Managed starter session",
    close: (value) => value.close(),
  });
  const viewer = await runtime.createViewer({
    page,
    context,
    session,
    port: 0,
  });
  resources.own(viewer, {
    label: "Managed starter viewer",
    close: (value) => value.close(),
  });
  check();
  return {
    // Return exactly the injected object. No Proxy or replacement session.
    session,
    viewerUrl: viewer.url,
    browser: browserIdentity,
    async draftState() {
      const { facts } = await adapter.observe();
      return ["draft", "saving", "validation", "recovery"].includes(
        facts.phase,
      );
    },
  };
}
