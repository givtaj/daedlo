// Independent local Chromium/Rust conformance, not customer or installed-package acceptance.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createNotebookServer } from "../examples/notebook/server.mjs";
import { createNinjaSupervisor } from "../packages/universal/vendor/tools/lib/ninja-supervisor.mjs";
import { frontendIdentity } from "../packages/universal/vendor/tools/lib/native-session.mjs";
import { initializeWorkspace } from "../packages/universal/vendor/tools/lib/workspace.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const runtimePath = join(repo, "packages/universal-runtime/src/index.mjs");
const enginePath = resolve(
  process.env.DAEDLO_UNIVERSAL_ENGINE_PATH ??
    join(repo, "target/debug/notebook-engine"),
);
const output = resolve(
  process.env.DAEDLO_UNIVERSAL_OUTPUT ??
    join(repo, "artifacts/storage-r3/browser"),
);
const { chromium } = createRequire(runtimePath)("playwright");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const gate = () => {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
};
async function eventually(read, label, timeout = 15000) {
  const end = Date.now() + timeout;
  do {
    const result = await read();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 30));
  } while (Date.now() < end);
  assert.fail(label);
}
async function snapshotTree(root) {
  const entries = [];
  async function visit(path, relative) {
    const stat = await fs.lstat(path);
    entries.push({
      path: relative,
      mode: stat.mode,
      inode: stat.ino,
      modified: stat.mtimeMs,
      ...(stat.isFile() ? { bytes: await fs.readFile(path, "base64") } : {}),
    });
    if (stat.isDirectory())
      for (const name of (await fs.readdir(path)).sort())
        await visit(join(path, name), join(relative, name));
  }
  await visit(root, ".");
  return entries;
}
function request(server, path, options = {}) {
  const url = new URL(server.url);
  const token = new URLSearchParams(url.hash.slice(1)).get("token");
  return fetch(new URL(path, url.origin), {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.method === "POST"
        ? { Origin: url.origin, "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });
}
async function waitTarget(page, id) {
  await page.waitForFunction(
    (targetId) =>
      document.querySelector("#target-select")?.value === targetId &&
      document.querySelector("#history-list")?.dataset.targetId === targetId &&
      document.querySelector("#history-list")?.getAttribute("aria-busy") ===
        "false",
    id,
  );
}

test(
  "Universal shell keeps selection read-only and ignores delayed responses from the previous target",
  { timeout: 45000 },
  async (t) => {
    const { createUniversalServer } = await import(
      "../packages/universal/src/server.mjs"
    );
    const delayed = gate(),
      entered = gate();
    let holdA = false,
      indexes = 0,
      launches = 0,
      browser,
      server;
    const targets = [
      {
        id: "target-a",
        label: "Notebook",
        environment: "Development",
        origin: "http://127.0.0.1:12345",
        model: { id: "notebook", version: "1" },
        revision: 1,
      },
      {
        id: "target-b",
        label: "Notebook",
        environment: "Review",
        origin: "http://127.0.0.1:12345",
        model: { id: "notebook", version: "1" },
        revision: 1,
      },
    ];
    const catalog = {
      listTargets: async () => targets,
      getTarget: async (id) => targets.find((target) => target.id === id),
      listRuns: async ({ targetId, cursor }) => {
        if (targetId === "target-a" && holdA) {
          entered.release();
          await delayed.promise;
        }
        return {
          targetId,
          items: [
            {
              runId: `${targetId}-${cursor ? "older" : "recent"}`,
              command: "save",
              startedAt: "2026-11-10T10:00:00.000Z",
              status: "finished",
              execution: "completed",
              effect: "saved",
              historyComplete: true,
            },
          ],
          nextCursor: cursor ? null : `${targetId}-next`,
          indexedAt: "2026-11-10T10:01:00.000Z",
          generation: 1,
        };
      },
      getRun: async ({ targetId, runId }) => ({
        targetId,
        runId,
        format: "daedlo-run-journal/1",
        workspaceId: "shell-fixture",
        projectId: targetId,
        status: "finished",
        historyComplete: true,
        partialTail: false,
        liveState: "unknown",
        events: [],
        report: {
          runId,
          lastResult: {
            execution: "completed",
            outcome: {
              kind: "success",
              label: "Exactly one matching saved note confirmed",
            },
            effect: { status: "saved" },
          },
        },
      }),
      indexTarget: async (targetId) => {
        indexes++;
        return {
          targetId,
          generation: 1,
          indexedRuns: 1,
          unchangedRuns: 0,
          incompleteRuns: 0,
          invalidRuns: 0,
          bytesRead: 10,
          indexedAt: "2026-11-10T10:01:00.000Z",
        };
      },
    };
    t.after(async () => {
      delayed.release();
      const errors = [];
      for (const resource of [server, browser])
        try {
          await resource?.close();
        } catch (error) {
          errors.push(error);
        }
      if (errors.length)
        throw new AggregateError(errors, "Owned shell fixture cleanup failed");
    });
    server = await createUniversalServer({
      catalog,
      launch: async () => {
        launches++;
        return {
          viewerUrl: "http://127.0.0.1:12346/",
          status: "running",
          reused: true,
        };
      },
    });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 1360, height: 940 },
    });
    await page.goto(server.url);
    assert.equal(
      await page.locator("#target-select").count(),
      1,
      "Universal needs a visible target selector before history can be scoped",
    );
    await waitTarget(page, "target-a");
    assert.match(
      await page.locator("#target-select").innerText(),
      /Development/,
    );
    assert.match(await page.locator("#target-select").innerText(), /Review/);
    assert.equal(
      await page.locator("iframe").count(),
      0,
      "The existing live viewer must be linked, not embedded",
    );
    await page
      .getByRole("button", { name: "target-a-recent", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelector("#run-detail")?.dataset.runId ===
        "target-a-recent",
    );
    assert.match(
      await page.locator("#run-detail").innerText(),
      /Exactly one matching saved note confirmed/,
      "Recorded application outcome labels remain visible",
    );
    assert.match(
      await page.locator("#run-detail").innerText(),
      /Live application state is unknown/,
    );
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await page
      .getByRole("button", { name: "target-a-older", exact: true })
      .waitFor();
    assert.equal(indexes, 0);
    assert.equal(launches, 0);
    await page.selectOption("#target-select", "target-b");
    await waitTarget(page, "target-b");
    holdA = true;
    await page.selectOption("#target-select", "target-a");
    await entered.promise;
    await page.selectOption("#target-select", "target-b");
    await waitTarget(page, "target-b");
    const oldResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/targets/target-a/runs",
    );
    delayed.release();
    await oldResponse;
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert.equal(await page.locator("#target-select").inputValue(), "target-b");
    assert.equal(
      await page.locator("#history-list").getAttribute("data-target-id"),
      "target-b",
    );
    assert.doesNotMatch(
      await page.locator("#history-list").innerText(),
      /target-a/,
    );
    assert.equal(
      indexes,
      0,
      "Selecting and reading history never rebuilds its projection",
    );
    assert.equal(
      launches,
      0,
      "Selecting and reading history never launches a target",
    );
    await page
      .getByRole("button", { name: "Refresh history", exact: true })
      .click();
    await eventually(
      () => indexes === 1,
      "The explicit refresh indexes exactly once",
    );
    await waitTarget(page, "target-b");
    await page
      .getByRole("button", { name: "Open live session", exact: true })
      .click();
    await page
      .getByRole("link", { name: "Open live viewer", exact: true })
      .waitFor();
    assert.equal(launches, 1);
    assert.equal(
      await page
        .getByRole("link", { name: "Open live viewer", exact: true })
        .getAttribute("href"),
      "http://127.0.0.1:12346/",
    );
    await page.reload();
    await waitTarget(page, "target-b");
    assert.equal(
      launches,
      1,
      "Reloading the history shell does not reconnect or launch implicitly",
    );
    assert.equal(
      indexes,
      1,
      "Reloading the history shell only reads the current projection",
    );
  },
);

test(
  "Universal browses isolated same-origin managed histories without replay or read-side writes",
  { timeout: 120000 },
  async (t) => {
    const { createUniversalServer } = await import(
      "../packages/universal/src/server.mjs"
    );
    const { openCatalog } = await import(
      "../packages/universal/src/catalog.mjs"
    );
    const root = await fs.realpath(
      await fs.mkdtemp(join(tmpdir(), "daedlo-universal-browser-")),
    );
    const contexts = [],
      supervisors = [],
      fixtures = new Map();
    let app, shellBrowser, catalog, server;
    t.after(async () => {
      const errors = [];
      for (const resource of [
        server,
        ...supervisors.toReversed(),
        catalog,
        shellBrowser,
        ...contexts.toReversed(),
        app,
      ]) {
        try {
          await resource?.close();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length)
        throw new AggregateError(
          errors,
          `Owned cleanup incomplete; retained fixture ${root}`,
        );
      await fs.rm(root, { recursive: true, force: true });
    });
    await fs.mkdir(output, { recursive: true });
    await fs.access(enginePath);
    app = await createNotebookServer();
    const executablePath = await fs.realpath(chromium.executablePath());
    const browserHash = digest(await fs.readFile(executablePath));
    const workspaceRoot = join(root, "workspace");
    const launchWitness = join(root, "launcher-entries.jsonl");
    const sourceRoot = join(root, "integration");
    await fs.mkdir(sourceRoot);
    const launcher = join(sourceRoot, "launcher.mjs");
    await fs.writeFile(
      launcher,
      `
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { createNotebookAdapter } from ${JSON.stringify(new URL("../examples/notebook/adapter.mjs", import.meta.url).href)};
const { chromium } = createRequire(${JSON.stringify(pathToFileURL(runtimePath).href)})("playwright");
export async function createManagedLaunch({ runtime, resources, settings, installation }) {
  await fs.appendFile(${JSON.stringify(launchWitness)}, settings.targetId+"\\n");
  const browser = await chromium.connectOverCDP(settings.browserEndpoint);
  resources.attach(browser, { label: "Parent-owned isolated target browser" });
  resources.own({ disconnect: () => browser.close() }, { label: "Owned CDP connection", close: item => item.disconnect() });
  await runtime.registerBrowser({ browser, executablePath: installation.browser.executablePath });
  const context = browser.contexts()[0];
  resources.attach(context, { label: "Parent-owned isolated authentication context" });
  const page = context.pages().find(page => page.url() === settings.target + "/");
  if (!page) throw Error("Expected parent-owned target page");
  resources.attach(page, { label: "Parent-owned target page" });
  const adapter = createNotebookAdapter(page);
  const session = await runtime.createDriverSession({ page, context, adapter });
  const viewer = await runtime.createViewer({ page, context, session });
  return { session, viewerUrl: viewer.url, draftState: async () => false };
}
`,
    );
    const runtimePackage = JSON.parse(
      await fs.readFile(join(repo, "packages/universal-runtime/package.json"), "utf8"),
    );
    for (const [id, environment, cookie] of [
      ["target-a", "Development", "alpha"],
      ["target-b", "Review", "beta"],
    ]) {
      const profile = join(root, `owned-profile-${id}`);
      const context = await chromium.launchPersistentContext(profile, {
        executablePath,
        headless: true,
        args: ["--remote-debugging-port=0"],
        handleSIGINT: false,
        handleSIGTERM: false,
      });
      contexts.push(context);
      const port = await eventually(async () => {
        try {
          return Number(
            (
              await fs.readFile(join(profile, "DevToolsActivePort"), "utf8")
            ).split("\n")[0],
          );
        } catch (error) {
          if (error.code === "ENOENT") return null;
          throw error;
        }
      }, "Owned target Chromium CDP endpoint must be ready");
      await context.addCookies([
        {
          name: "notebook_session",
          value: cookie,
          url: app.url,
          httpOnly: true,
          sameSite: "Strict",
        },
      ]);
      const page = context.pages()[0] ?? (await context.newPage());
      let requests = 0;
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          new URL(request.url()).pathname === "/api/notes"
        )
          requests++;
      });
      await page.goto(app.url);
      await page.waitForFunction(
        (session) => document.body.dataset.session === session,
        cookie,
      );
      const config = {
        schemaVersion: 2,
        store: join(root, `manager-${id}`),
        workspace: {
          id: "universal-conformance",
          root: workspaceRoot,
          journal: 1,
        },
        registration: {
          projectId: id,
          sourceRoot,
          model: { id: "notebook", version: "1" },
        },
        frontend: { name: `Notebook · ${environment}`, targetOrigin: app.url },
      };
      await initializeWorkspace(config);
      const configPath = join(root, `${id}.json`);
      await fs.writeFile(configPath, JSON.stringify(config));
      const receipt = {
        id: `reviewed-${id}`,
        version: runtimePackage.version,
        runtimePackage: runtimePackage.name,
        sourceSha256: digest(await fs.readFile(launcher)),
        runtimePath,
        enginePath,
        launcherPath: launcher,
        sourcePath: sourceRoot,
        model: config.registration.model,
        browser: {
          executablePath,
          version: context.browser().version(),
          sha256: browserHash,
        },
      };
      fixtures.set(id, {
        id,
        config,
        configPath,
        context,
        page,
        receipt,
        environment,
        settings: {
          target: app.url,
          targetId: id,
          browserEndpoint: `http://127.0.0.1:${port}`,
        },
        get requests() {
          return requests;
        },
        runs: [],
      });
    }
    catalog = await openCatalog({ root: workspaceRoot, create: true });
    for (const f of fixtures.values()) {
      await catalog.registerTarget({
        id: f.id,
        label: "Notebook",
        environment: f.environment,
        origin: app.url,
        authProfileRef: `owned-context-${f.id}`,
        projectId: f.config.registration.projectId,
        store: f.config.store,
        sourceRoot,
        configPath: f.configPath,
        configSha256: digest(await fs.readFile(f.configPath)),
        sourceSha256: f.receipt.sourceSha256,
        model: f.receipt.model,
      });
    }
    async function start(f) {
      const supervisor = await createNinjaSupervisor({
        root: join(f.config.store, "supervisor"),
        settings: f.settings,
        frontend: frontendIdentity(f.config),
        workspaceConfig: f.config,
        timeoutMs: 15000,
      });
      supervisors.push(supervisor);
      await supervisor.start(f.receipt);
      await supervisor.accept();
      const state = await supervisor.status();
      assert.equal(state.ready, true);
      f.supervisor = supervisor;
      f.viewerUrl = state.running.viewerUrl;
      return f.viewerUrl;
    }
    shellBrowser = await chromium.launch({
      executablePath,
      headless: true,
      handleSIGINT: false,
      handleSIGTERM: false,
    });
    const live = await shellBrowser.newPage({
      viewport: { width: 1400, height: 960 },
    });
    let writes = 0;
    for (const f of fixtures.values()) {
      await start(f);
      await live.goto(f.viewerUrl);
      await live.locator('[data-recipe="save_example"]').waitFor();
      assert.equal(
        await live.locator("#target-select").count(),
        0,
        "Basic live viewer has no Universal dependency or history controls",
      );
      for (let n = 0; n < (f.id === "target-a" ? 2 : 1); n++) {
        const response = live.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === "/command" &&
            r.request().method() === "POST",
        );
        await live.locator('[data-recipe="save_example"]').click();
        const resultResponse = await response;
        assert.equal(resultResponse.status(), 200);
        const result = await resultResponse.json();
        assert.equal(result.execution, "completed");
        assert.equal(result.outcome.kind, "success");
        assert.equal(result.effect.status, "saved");
        f.runs.push(result.runId);
        assert.equal(
          app.writes,
          ++writes,
          "Independent application observed precisely the requested write",
        );
        await live.waitForFunction(
          () =>
            !document.querySelector('[data-recipe="save_example"]')?.disabled,
        );
      }
    }
    const a = fixtures.get("target-a"),
      b = fixtures.get("target-b");
    assert.equal(a.requests, 2);
    assert.equal(b.requests, 1);
    for (const f of fixtures.values()) {
      const rows = await f.context.request
        .get(`${app.url}/api/notes`)
        .then((r) => r.json());
      assert.equal(
        rows.items.length,
        f.runs.length,
        "Each authentication context reads only its own independently saved rows",
      );
    }
    let launchCalls = 0;
    server = await createUniversalServer({
      catalog,
      launch: async (targetId, { revision }) => {
        launchCalls++;
        const target = await catalog.getTarget(targetId);
        assert.equal(revision, target.revision);
        const f = fixtures.get(targetId);
        const reused = Boolean(f.supervisor);
        return {
          viewerUrl: reused ? f.viewerUrl : await start(f),
          status: "running",
          reused,
        };
      },
    });
    const page = await shellBrowser.newPage({
      viewport: { width: 1400, height: 960 },
    });
    await page.goto(server.url);
    assert.equal(
      await page.locator("#target-select").count(),
      1,
      "Actual persisted runs need a Universal target selector",
    );
    await waitTarget(page, a.id);
    for (const f of fixtures.values()) {
      await page.selectOption("#target-select", f.id);
      await waitTarget(page, f.id);
      await page
        .getByRole("button", { name: "Refresh history", exact: true })
        .click();
      await page
        .getByRole("button", { name: f.runs[0], exact: true })
        .waitFor();
    }
    const before = await snapshotTree(workspaceRoot);
    const launchesBefore = await fs.readFile(launchWitness, "utf8");
    for (const f of fixtures.values()) {
      await page.selectOption("#target-select", f.id);
      await waitTarget(page, f.id);
      const other = f.id === a.id ? b : a;
      assert.doesNotMatch(
        await page.locator("#history-list").innerText(),
        new RegExp(other.runs[0]),
      );
      await page.getByRole("button", { name: f.runs[0], exact: true }).click();
      await page.waitForFunction(
        (runId) =>
          document.querySelector("#run-detail")?.dataset.runId === runId,
        f.runs[0],
      );
      assert.match(
        await page.locator("#run-detail").innerText(),
        /Recorded run/,
      );
      assert.match(
        await page.locator("#run-detail").innerText(),
        /Exactly one matching saved note confirmed/,
      );
      assert.match(
        await page.locator("#run-detail").innerText(),
        /Live application state is unknown/,
      );
      await page.reload();
      await waitTarget(page, f.id);
    }
    const firstPageResponse = await request(
      server,
      `/api/targets/${a.id}/runs?limit=1`,
    );
    assert.equal(firstPageResponse.status, 200);
    const firstPage = await firstPageResponse.json();
    assert.equal(firstPage.runs.length, 1);
    assert.ok(firstPage.nextCursor);
    const secondPageResponse = await request(
      server,
      `/api/targets/${a.id}/runs?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
    );
    assert.equal(secondPageResponse.status, 200);
    const secondPage = await secondPageResponse.json();
    assert.equal(secondPage.runs.length, 1);
    assert.notEqual(secondPage.runs[0].runId, firstPage.runs[0].runId);
    const crossCursor = await request(
      server,
      `/api/targets/${b.id}/runs?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
    );
    assert.ok(
      crossCursor.status >= 400,
      "A cursor from another target is rejected",
    );
    assert.equal(
      JSON.stringify(await crossCursor.json()).includes(a.runs[0]),
      false,
    );
    const crossRun = await request(
      server,
      `/api/targets/${b.id}/runs/${a.runs[0]}`,
    );
    assert.ok(
      crossRun.status >= 400,
      "An arbitrary run ID cannot cross target boundaries",
    );
    assert.equal(
      JSON.stringify(await crossRun.json()).includes(a.runs[0]),
      false,
    );
    assert.deepEqual(
      await snapshotTree(workspaceRoot),
      before,
      "History navigation and direct reads leave catalogs, indexes, reports and journals byte-for-byte unchanged",
    );
    assert.equal(await fs.readFile(launchWitness, "utf8"), launchesBefore);
    assert.equal(launchCalls, 0);
    assert.equal(app.writes, 3);
    assert.equal(a.requests + b.requests, 3);
    await page.selectOption("#target-select", a.id);
    await waitTarget(page, a.id);
    await page.getByRole("button", { name: a.runs[0], exact: true }).click();
    await page.waitForFunction(
      (runId) => document.querySelector("#run-detail")?.dataset.runId === runId,
      a.runs[0],
    );
    await page.screenshot({
      path: join(output, "universal-history-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      scrollTo(0, 0);
      return new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });
    assert.equal(
      await page.locator(".sidebar").count(),
      1,
      "Responsive layout contains exactly one target sidebar",
    );
    assert.equal(await page.locator("#target-select").count(), 1);
    await page.screenshot({
      path: join(output, "universal-history-narrow.png"),
      fullPage: false,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      "History fits a narrow viewport without horizontal overflow",
    );
    await page.locator("#run-detail").scrollIntoViewIfNeeded();
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert.equal(
      await page.locator("#run-detail").evaluate((element) => {
        const box = element.getBoundingClientRect();
        return box.top >= 0 && box.bottom <= innerHeight;
      }),
      true,
      "Recorded detail is visible after scrolling in the narrow layout",
    );
    await page.screenshot({
      path: join(output, "universal-history-narrow-detail.png"),
      fullPage: false,
    });
    await page.setViewportSize({ width: 1400, height: 960 });
    await page
      .getByRole("button", { name: "Open live session", exact: true })
      .click();
    await page
      .getByRole("link", { name: "Open live viewer", exact: true })
      .waitFor();
    assert.equal(launchCalls, 1);
    assert.equal(
      await page
        .getByRole("link", { name: "Open live viewer", exact: true })
        .getAttribute("href"),
      new URL(a.viewerUrl).href,
    );
    assert.equal(
      await fs.readFile(launchWitness, "utf8"),
      launchesBefore,
      "Explicit reconnect reuses the selected live session",
    );
    await a.page
      .getByLabel("Note", { exact: true })
      .fill("Retained authentication guard draft");
    const stale = await fetch(new URL("/status", a.viewerUrl)).then((r) =>
      r.json(),
    );
    await a.page
      .getByRole("button", { name: "Switch account", exact: true })
      .click();
    await a.page.waitForFunction(
      () => document.body.dataset.session === "beta",
    );
    const refused = await fetch(new URL("/command", a.viewerUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: new URL(a.viewerUrl).origin,
      },
      body: JSON.stringify({ id: "save", revision: stale.driver.revision }),
    });
    const refusal = await refused.json();
    assert.equal(refused.status, 409);
    assert.equal(
      refusal.execution,
      "rejected",
      "Changed authentication cannot accept the saved live revision",
    );
    assert.equal(refusal.effect.status, "not_attempted");
    assert.equal(a.requests + b.requests, 3);
    assert.equal(app.writes, 3);
    assert.equal(
      await b.page.locator("body").getAttribute("data-session"),
      "beta",
    );
    await a.page
      .getByRole("button", { name: "Switch account", exact: true })
      .click();
    await a.page.waitForFunction(
      () => document.body.dataset.session === "alpha",
    );
    await a.page
      .getByRole("button", { name: "Clear draft", exact: true })
      .click();
    for (const f of fixtures.values()) {
      await f.supervisor.close();
      f.supervisor = null;
      assert.equal(f.context.browser().isConnected(), true);
    }
    const offlineBefore = await snapshotTree(workspaceRoot);
    const offlineLaunches = await fs.readFile(launchWitness, "utf8");
    await page.reload();
    await waitTarget(page, a.id);
    await page.getByRole("button", { name: a.runs[0], exact: true }).click();
    await page.waitForFunction(
      (runId) => document.querySelector("#run-detail")?.dataset.runId === runId,
      a.runs[0],
    );
    assert.deepEqual(
      await snapshotTree(workspaceRoot),
      offlineBefore,
      "Offline history inspection never repairs or changes persisted state",
    );
    assert.equal(
      await fs.readFile(launchWitness, "utf8"),
      offlineLaunches,
      "Offline inspection does not start a managed child",
    );
    assert.equal(launchCalls, 1);
    assert.equal(app.writes, 3);
    assert.equal(a.requests + b.requests, 3);
    await page
      .getByRole("button", { name: "Open live session", exact: true })
      .click();
    await page
      .getByRole("link", { name: "Open live viewer", exact: true })
      .waitFor();
    assert.equal(launchCalls, 2);
    assert.equal(
      await fs.readFile(launchWitness, "utf8"),
      offlineLaunches + a.id + "\n",
      "Only explicit launch enters the selected target's customer launcher",
    );
    assert.equal(
      b.supervisor,
      null,
      "Launching one target leaves the other stopped",
    );
    const popup = page.waitForEvent("popup");
    await page
      .getByRole("link", { name: "Open live viewer", exact: true })
      .click();
    const reopenedViewer = await popup;
    await reopenedViewer.locator('[data-recipe="save_example"]').waitFor();
    assert.match(
      await reopenedViewer.locator("#frontend-name").innerText(),
      /Development/,
    );
    assert.equal(await reopenedViewer.locator("#target-select").count(), 0);
    assert.equal(
      await a.page.locator("body").getAttribute("data-session"),
      "alpha",
    );
    assert.equal(app.writes, 3);
    assert.equal(a.requests + b.requests, 3);
    await fs.writeFile(
      join(output, "evidence.json"),
      JSON.stringify(
        {
          fixture: "Independent notebook conformance",
          browser: {
            version: contexts[0].browser().version(),
            sha256: browserHash,
          },
          sameOriginTargets: 2,
          isolatedAuthenticationContexts: 2,
          acceptedRuns: 3,
          applicationRequests: a.requests + b.requests,
          applicationWrites: app.writes,
          historyReadsUnchanged: true,
          offlineHistoryNoLaunch: true,
          explicitTargetRestartNoReplay: true,
          basicLiveViewerUnchanged: true,
        },
        null,
        2,
      ) + "\n",
    );
  },
);
