import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { createAdapter } from "./adapter.mjs";

/** One-time managed entrypoint; the accepted model and adapter are unchanged. */
export async function createManagedLaunch({
  runtime,
  resources,
  enginePath,
  installation,
  settings,
}) {
  const { origin, appRoot, dataPath, evidencePath, viewerPort = 0 } = settings;
  const target = new URL(origin);
  if (
    target.protocol !== "http:" ||
    target.hostname !== "127.0.0.1" ||
    target.origin !== origin
  )
    throw Error("An explicit isolated loopback application is required");
  const health = await fetch(origin + "/api/health", {
    signal: AbortSignal.timeout(5000),
  }).then((response) => response.json());
  if (
    health.root !== appRoot + "/" ||
    health.data !== dataPath.slice(0, dataPath.lastIndexOf("/"))
  )
    throw Error("Isolated application ownership mismatch");
  resources.attach(
    { origin },
    { label: "Separately owned synthetic Architecture Studio application" },
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
    label: "Managed controlled browser",
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
    label: "Managed browser context",
    close: (value) => value.close(),
  });
  const page = await context.newPage();
  await page.goto(origin + "/?model=daedlo-first-flow");
  await page.getByRole("heading", { level: 1 }).waitFor();
  await page
    .getByRole("img", {
      name: "Interactive 3D topology. Drag to orbit; scroll to zoom. Equivalent node controls follow.",
      exact: true,
    })
    .waitFor();
  const adapter = createAdapter({ page, origin, dataPath, evidencePath });
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
      application: "Architecture Studio",
      applicationCommit: "d8cb9396609b722418015cdd3367b3ef659aeb69",
      fixture: "Synthetic Ninja-Update acceptance",
    },
  });
  resources.own(session, {
    label: "Managed entrypoint session",
    close: (value) => value.close(),
  });
  const viewer = await runtime.createViewer({
    page,
    context,
    session,
    port: viewerPort,
  });
  resources.own(viewer, {
    label: "Managed entrypoint viewer",
    close: (value) => value.close(),
  });
  return {
    session,
    viewerUrl: viewer.url,
    browser: browserIdentity,
    async draftState() {
      const { facts: f } = await adapter.observe();
      return (
        f.editor_open && (f.draft_name !== f.name || f.draft_notes !== f.notes)
      );
    },
  };
}
