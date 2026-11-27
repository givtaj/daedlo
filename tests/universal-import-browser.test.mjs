// Independent import conformance; these synthetic fixtures are not customer activity.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createUniversalServer } from "../packages/universal/src/server.mjs";
import { DatabaseSync } from "node:sqlite";
import { openCatalog } from "../packages/universal/src/catalog.mjs";
import { createEvidenceStore } from "../packages/universal/src/evidence.mjs";
import { createNotebookServer } from "../examples/notebook/server.mjs";
import { createNotebookAdapter } from "../examples/notebook/adapter.mjs";
import { createDriverSession } from "../packages/universal-runtime/src/index.mjs";
import { initializeWorkspace } from "../packages/universal/vendor/tools/lib/workspace.mjs";
import { openRunJournal } from "../packages/universal/vendor/tools/lib/run-journal.mjs";
import { createNinjaEvidence } from "../packages/universal/vendor/tools/lib/ninja-evidence.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const { chromium } = createRequire(
  new URL("../packages/universal-runtime/src/index.mjs", import.meta.url),
)("playwright");
const output = resolve(
  process.env.DAEDLO_UNIVERSAL_IMPORT_OUTPUT ??
    join(repo, "artifacts/storage-r5a/browser"),
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function eventually(read, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  do {
    if (await read()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  assert.fail(label);
}
async function waitTarget(page, targetId) {
  await page.waitForFunction(
    (id) =>
      document.querySelector("#target-select")?.value === id &&
      document.querySelector("#history-list")?.dataset.targetId === id &&
      document.querySelector("#history-list")?.getAttribute("aria-busy") ===
        "false",
    targetId,
  );
}

test(
  "Universal distinguishes imported reports from journal runs with the same ID",
  { timeout: 45000 },
  async (t) => {
    let browser,
      server,
      launches = 0;
    const target = {
      id: "target-a",
      label: "Synthetic history",
      environment: "Review",
      origin: "https://synthetic.invalid",
      model: { id: "synthetic", version: "2" },
      revision: 2,
    };
    const runId = "shared-run";
    t.after(async () => {
      const errors = [];
      for (const resource of [browser, server]) {
        try {
          await resource?.close();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length)
        throw new AggregateError(
          errors,
          "Imported history shell cleanup failed",
        );
    });
    server = await createUniversalServer({
      catalog: {
        catalogVersion: 3,
        listTargets: async () => [target],
        getTarget: async () => target,
        listRuns: async () => ({
          targetId: target.id,
          items: [],
          generation: 1,
          indexedAt: null,
          nextCursor: null,
        }),
        getRun: async () => {
          throw Error("Shell routes supply their source fixtures");
        },
        indexTarget: async () => {
          throw Error("Browsing cannot index");
        },
      },
      launch: async () => {
        launches++;
        throw Error("Browsing cannot launch");
      },
    });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 960 },
    });
    const journal = {
      format: "daedlo-run-journal/1",
      targetId: target.id,
      workspaceId: "shell",
      projectId: target.id,
      runId,
      status: "finished",
      liveState: "unknown",
      historyComplete: true,
      partialTail: false,
      events: [
        {
          sequence: 1,
          type: "run_started",
          timestamp: "2026-11-10T10:00:00.000Z",
        },
      ],
      report: {
        lastResult: { execution: "completed", effect: { status: "saved" } },
      },
    };
    const archive = {
      format: "daedlo-imported-report/1",
      targetId: target.id,
      runId,
      status: "imported",
      liveState: "unknown",
      historyComplete: false,
      events: [],
      report: {
        format: "browser-driver-report/1",
        runId,
        lastResult: {
          runId,
          execution: "completed",
          effect: { status: "saved" },
        },
        events: [
          {
            sequence: 201,
            type: "run_completed",
            at: "2026-10-01T10:00:00.000Z",
          },
        ],
        eventRange: {
          first: 1,
          last: 201,
          retainedFirst: 201,
          truncated: true,
        },
      },
      provenance: {
        source: {
          kind: "daedlo-managed-run",
          schemaVersion: 1,
          reportFormat: "browser-driver-report/1",
        },
        limitations: ["completed_report_only", "events_truncated"],
        recordedAt: "2026-10-01T10:01:00.000Z",
        installation: {
          id: "legacy",
          version: "0.1.4-alpha.9",
          sourceSha256: "a".repeat(64),
          model: { id: "synthetic", version: "1" },
        },
      },
    };
    const calls = [];
    await page.route("**/api/targets/target-a/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      calls.push(path);
      const value = path.endsWith("/runs")
        ? {
            runs: [
              {
                runId,
                sourceKind: "archive",
                status: "imported",
                command: null,
                archivedAt: archive.provenance.recordedAt,
                historyComplete: false,
                reportTruncated: true,
                execution: "completed",
                effect: { status: "saved" },
              },
              {
                runId,
                status: "finished",
                historyComplete: true,
                execution: "completed",
                effect: { status: "saved" },
              },
            ],
            nextCursor: null,
            generation: 1,
            indexedAt: null,
          }
        : path.endsWith(`/imports/${runId}`)
          ? archive
          : path.endsWith(`/runs/${runId}`)
            ? journal
            : path.endsWith("/records")
              ? { targetId: target.id, records: [], nextCursor: null }
              : path.endsWith("/summary")
                ? {
                    targetId: target.id,
                    targetRevision: 2,
                    items: [],
                    excluded: [],
                    historicalOnly: true,
                  }
                : path.endsWith("/evidence")
                  ? {
                      targetId: target.id,
                      evidence: [],
                      pending: [],
                      nextCursor: null,
                    }
                  : null;
      if (value)
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(value),
        });
      else await route.continue();
    });
    await page.goto(server.url);
    await waitTarget(page, target.id);
    const imported = page
      .locator("#history-list tr")
      .filter({ hasText: "Imported report" });
    assert.equal(
      await imported.count(),
      1,
      "Imported history needs a visible source label distinct from journal history",
    );
    await imported.getByRole("button", { name: runId, exact: true }).click();
    await eventually(
      async () =>
        (await page.locator("#run-detail").getAttribute("data-source-kind")) ===
        "archive",
      "Imported selection keeps a separate source identity",
    );
    assert.equal(new URL(page.url()).searchParams.get("source"), "archive");
    assert.match(
      await page.locator("#run-detail").innerText(),
      /completed report only/i,
    );
    assert.match(
      await page.locator("#run-detail").innerText(),
      /start.*intent.*not recorded/i,
    );
    assert.match(await page.locator("#run-detail").innerText(), /truncated/i);
    assert.equal(
      await page
        .locator("#run-detail .events li")
        .first()
        .getAttribute("value"),
      "201",
      "Truncated runtime events retain their original sequence numbers",
    );
    assert.doesNotMatch(
      await page.locator("#run-detail").innerText(),
      /Complete journal/i,
    );
    assert.equal(
      await page
        .getByRole("button", {
          name: "Review evidence & findings",
          exact: true,
        })
        .count(),
      0,
    );
    await page.locator("#knowledge-tab").click();
    assert.equal(await page.locator("#save-evidence").isDisabled(), true);
    assert.equal(await page.locator("#save-record").isDisabled(), true);
    await page.locator("#history-tab").click();
    await page.reload();
    await waitTarget(page, target.id);
    await eventually(
      async () =>
        (await page.locator("#run-detail").getAttribute("data-source-kind")) ===
        "archive",
      "Reload retains imported source selection",
    );
    delete archive.report.eventRange;
    delete archive.provenance.installation.sourceSha256;
    archive.provenance.limitations = [
      "completed_report_only",
      "event_range_missing",
      "installation_source_missing",
    ];
    await page.reload();
    await waitTarget(page, target.id);
    await eventually(
      async () =>
        (await page.locator("#run-detail").getAttribute("data-source-kind")) ===
        "archive",
      "Missing-metadata fixture remains an imported source",
    );
    assert.match(
      await page.locator("#run-detail").innerText(),
      /event completeness is unknown/i,
    );
    assert.match(
      await page.locator("#run-detail").innerText(),
      /installation metadata was not recorded/i,
    );
    assert.match(
      await page.locator("#run-detail").innerText(),
      /synthetic · 1/,
    );
    const journalRow = page
      .locator("#history-list tr")
      .filter({ has: page.getByRole("button", { name: runId, exact: true }) })
      .filter({ hasNotText: "Imported report" });
    await journalRow.getByRole("button", { name: runId, exact: true }).click();
    await eventually(
      async () =>
        (await page.locator("#run-detail").getAttribute("data-source-kind")) ===
        "journal",
      "Journal selection remains distinct from the imported copy",
    );
    assert.equal(new URL(page.url()).searchParams.has("source"), false);
    assert.match(
      await page.locator("#run-detail").innerText(),
      /Complete journal/i,
    );
    await page.goBack();
    await eventually(
      async () =>
        (await page.locator("#run-detail").getAttribute("data-source-kind")) ===
        "archive",
      "Back navigation restores the imported source with the same run ID",
    );
    await page.goForward();
    await eventually(
      async () =>
        (await page.locator("#run-detail").getAttribute("data-source-kind")) ===
        "journal",
      "Forward navigation restores the journal source with the same run ID",
    );
    await page
      .getByRole("button", { name: "Review evidence & findings", exact: true })
      .click();
    assert.equal(
      await page.locator("#save-evidence").isDisabled(),
      false,
      "Schema3 retains R4 evidence authoring for journal runs",
    );
    assert.equal(await page.locator("#save-record").isDisabled(), false);
    assert.ok(calls.includes(`/api/targets/${target.id}/imports/${runId}`));
    assert.equal(launches, 0);
  },
);

async function treeSnapshot(root) {
  const entries = [];
  async function visit(path, relative) {
    const stat = await fs.lstat(path);
    entries.push({
      path: relative,
      inode: stat.ino,
      mode: stat.mode,
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
function retainedR4Rows(root) {
  const db = new DatabaseSync(join(root, "workspace.sqlite"), {
    readOnly: true,
  });
  try {
    return Object.fromEntries(
      [
        "evidence",
        "knowledge_records",
        "knowledge_revisions",
        "knowledge_reviews",
      ].map((table) => [
        table,
        db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      ]),
    );
  } finally {
    db.close();
  }
}
function authenticated(server, path) {
  const url = new URL(server.url),
    token = new URLSearchParams(url.hash.slice(1)).get("token");
  return fetch(new URL(path, url.origin), {
    headers: { Authorization: `Bearer ${token}` },
  });
}

test(
  "Universal imports an actual completed report beside new journal history without replay or loss",
  { timeout: 120000 },
  async (t) => {
    const root = await fs.realpath(
        await fs.mkdtemp(join(tmpdir(), "universal-import-browser-")),
      ),
      workspaceRoot = join(root, "workspace"),
      owned = [];
    let browser,
      app,
      catalog,
      evidence,
      server,
      launches = 0,
      writes = 0;
    t.after(async () => {
      const errors = [];
      for (const resource of [
        server,
        evidence,
        catalog,
        ...owned.toReversed(),
        browser,
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
          `Imported history cleanup failed; retained ${root}`,
        );
      await fs.rm(root, { recursive: true, force: true });
    });
    await fs.mkdir(output, { recursive: true });
    const enginePath = resolve(
      process.env.DAEDLO_UNIVERSAL_ENGINE_PATH ??
        join(repo, "target/debug/notebook-engine"),
    );
    await fs.access(enginePath);
    const sourceRoot = join(root, "integration");
    await fs.mkdir(sourceRoot);
    const source = await fs.readFile(
      new URL("../examples/notebook/adapter.mjs", import.meta.url),
    );
    await fs.writeFile(join(sourceRoot, "adapter.mjs"), source);
    const installation = {
      id: "accepted-fixture",
      version: JSON.parse(
        await fs.readFile(
          new URL("../packages/universal-runtime/package.json", import.meta.url),
        ),
      ).version,
      sourceSha256: hash(source),
      model: { id: "notebook", version: "1" },
    };
    const targets = [];
    let workspace;
    app = await createNotebookServer();
    browser = await chromium.launch({ headless: true });
    for (const id of ["target-a", "target-b"]) {
      const config = {
        schemaVersion: 2,
        store: join(root, `manager-${id}`),
        workspace: {
          id: "import-conformance",
          root: workspaceRoot,
          journal: 1,
        },
        registration: { projectId: id, sourceRoot, model: installation.model },
      };
      const created = await initializeWorkspace(config);
      if (id === "target-a") workspace = created;
      const configPath = join(root, `${id}.json`);
      await fs.writeFile(configPath, JSON.stringify(config));
      targets.push({
        id,
        label: "Notebook",
        environment: id === "target-a" ? "Development" : "Separate review",
        origin: app.url,
        authProfileRef: `owned-context-${id}`,
        projectId: id,
        store: config.store,
        sourceRoot,
        configPath,
        configSha256: hash(await fs.readFile(configPath)),
        sourceSha256: installation.sourceSha256,
        model: installation.model,
      });
    }
    const context = await browser.newContext();
    await context.addCookies([
      {
        name: "notebook_session",
        value: "alpha",
        url: app.url,
        httpOnly: true,
        sameSite: "Strict",
      },
    ]);
    const appPage = await context.newPage();
    appPage.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/notes"
      )
        writes++;
    });
    await appPage.goto(app.url);
    await appPage.waitForFunction(
      () => document.body.dataset.session === "alpha",
    );
    const legacyDriver = await createDriverSession({
      page: appPage,
      context,
      enginePath,
      adapter: createNotebookAdapter(appPage),
    });
    owned.push(legacyDriver);
    legacyDriver.setSpeed("fast");
    const legacy = await legacyDriver.runRecipe(
      "save_example",
      (await legacyDriver.snapshot()).revision,
    );
    assert.equal(legacy.execution, "completed");
    assert.equal(legacy.effect.status, "saved");
    const legacyReport = legacyDriver.report({ runId: legacy.runId });
    const sourceDirectory = join(root, "retained-managed-reports");
    const archiveWriter = createNinjaEvidence({
      root: sourceDirectory,
      installation,
    });
    await archiveWriter.retain(legacy, () => legacyReport);
    await archiveWriter.drain();
    await legacyDriver.close();
    const archiveNames = await fs.readdir(sourceDirectory);
    assert.equal(archiveNames.length, 1);
    const sourceFile = join(sourceDirectory, archiveNames[0]),
      sourceBytes = await fs.readFile(sourceFile),
      sourceBefore = await treeSnapshot(sourceDirectory);
    const original = JSON.parse(sourceBytes);
    assert.equal(original.kind, "daedlo-managed-run");
    assert.equal(original.report.runId, legacy.runId);
    assert.deepEqual(
      await fs.readdir(workspace.journalRoot).catch((error) => {
        if (error.code === "ENOENT") return [];
        throw error;
      }),
      [],
      "The archived run did not gain journal start or intent events",
    );
    const writer = await openRunJournal({ workspace, installation });
    owned.push(writer);
    const journalDriver = await createDriverSession({
      page: appPage,
      context,
      enginePath,
      adapter: createNotebookAdapter(appPage),
      runJournal: {
        startRun: (input) => writer.begin(input),
        beforeEffect: (input) => writer.beforeEffect(input),
      },
    });
    owned.push(journalDriver);
    journalDriver.setSpeed("fast");
    const newer = await journalDriver.runRecipe(
      "save_example",
      (await journalDriver.snapshot()).revision,
    );
    assert.equal(newer.execution, "completed");
    assert.equal(newer.effect.status, "saved");
    await writer.finish({
      runId: newer.runId,
      report: journalDriver.report({ runId: newer.runId }),
    });
    await journalDriver.close();
    await writer.close();
    const journalPath = join(workspace.journalRoot, `${newer.runId}.jsonl`),
      journalBytes = await fs.readFile(journalPath);
    assert.equal(writes, 2);
    assert.equal(app.writes, 2);
    catalog = await openCatalog({ root: workspaceRoot, create: true });
    for (const target of targets) await catalog.registerTarget(target);
    await catalog.indexTarget("target-a");
    evidence = await createEvidenceStore({ root: workspaceRoot, catalog });
    const attached = await evidence.put({
      targetId: "target-a",
      runId: newer.runId,
      label: "Observed second saved note",
      mediaType: "image/png",
      bytes: await appPage.screenshot(),
      expectedTargetRevision: 1,
    });
    const knowledge = await catalog.createRecord({
      targetId: "target-a",
      kind: "knowledge",
      title: "Retained R4 knowledge",
      body: "Check the saved result in the current authenticated context.",
      refs: [
        { runId: newer.runId, eventSequence: null, evidenceId: attached.id },
      ],
      expectedTargetRevision: 1,
    });
    await catalog.reviewRecord({
      targetId: "target-a",
      recordId: knowledge.id,
      expectedRevision: 1,
      expectedTargetRevision: 1,
      decision: "accepted",
    });
    const r4Before = retainedR4Rows(workspaceRoot),
      evidenceBefore = await fs.readFile(
        join(workspaceRoot, "evidence", "target-a", `${attached.id}.bin`),
      );
    const input = {
      targetId: "target-a",
      expectedTargetRevision: 1,
      sourceFile,
    };
    await catalog.importManagedArchive(input);
    const imported = await catalog.getImportedRun({
      targetId: "target-a",
      runId: legacy.runId,
    });
    assert.deepEqual(
      imported.report,
      legacyReport,
      "Import retains the actual completed runtime report",
    );
    assert.deepEqual(
      imported.events,
      [],
      "Imported reports never receive invented journal events",
    );
    assert.equal(imported.historyComplete, false);
    assert.equal(imported.liveState, "unknown");
    assert.deepEqual(imported.provenance.installation, installation);
    assert.equal(imported.provenance.recordedAt, original.recordedAt);
    await catalog.importManagedArchive(input);
    assert.equal(
      (
        await catalog.getImportedRun({
          targetId: "target-a",
          runId: legacy.runId,
        })
      ).importId,
      imported.importId,
      "Repeated import preserves one stable imported identity",
    );
    const mixed = await catalog.listRuns({ targetId: "target-a", limit: 100 });
    assert.equal(
      mixed.items.length,
      2,
      "The actual old report and new journal appear once each",
    );
    assert.equal(
      mixed.items.filter((item) => item.sourceKind === "archive").length,
      1,
    );
    await assert.rejects(
      catalog.importManagedArchive({ ...input, targetId: "target-b" }),
      "An already mapped archive cannot silently move to a second target",
    );
    await assert.rejects(
      catalog.getImportedRun({ targetId: "target-b", runId: legacy.runId }),
    );
    assert.equal(
      (await catalog.listRuns({ targetId: "target-b" })).items.length,
      0,
    );
    await evidence.close();
    evidence = null;
    await catalog.close();
    catalog = null;
    catalog = await openCatalog({ root: workspaceRoot });
    await catalog.indexTarget("target-a", { rebuild: true });
    assert.equal(
      (await catalog.listRuns({ targetId: "target-a", limit: 100 })).items
        .length,
      2,
      "Rebuild after restart preserves imported authoritative history",
    );
    assert.deepEqual(
      retainedR4Rows(workspaceRoot),
      r4Before,
      "Archive import and rebuild leave retained R4 records unchanged",
    );
    assert.deepEqual(
      await fs.readFile(
        join(workspaceRoot, "evidence", "target-a", `${attached.id}.bin`),
      ),
      evidenceBefore,
    );
    assert.deepEqual(await fs.readFile(journalPath), journalBytes);
    assert.deepEqual(await fs.readFile(sourceFile), sourceBytes);
    assert.deepEqual(
      await treeSnapshot(sourceDirectory),
      sourceBefore,
      "Original archive bytes, inode and timestamps stay unchanged",
    );
    evidence = await createEvidenceStore({ root: workspaceRoot, catalog });
    server = await createUniversalServer({
      catalog,
      evidence,
      launch: async () => {
        launches++;
        throw Error("Import browsing does not launch application actions");
      },
    });
    const workspaceBefore = await treeSnapshot(workspaceRoot);
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1080 },
      }),
      pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(server.url);
    await waitTarget(page, "target-a");
    const archiveRow = page.locator(
      '#history-list tr[data-source-kind="archive"]',
    );
    assert.equal(
      await archiveRow.count(),
      1,
      `Imported history must remain visible after restart: ${await page.locator("#page-error").textContent()}`,
    );
    await archiveRow
      .getByRole("button", { name: legacy.runId, exact: true })
      .click();
    await eventually(
      async () =>
        (await page.locator("#run-detail").getAttribute("data-source-kind")) ===
        "archive",
      "The imported report detail is visible",
    );
    assert.match(
      await page.locator("#run-detail").innerText(),
      /completed report only/i,
    );
    assert.match(
      await page.locator("#run-detail").innerText(),
      /Exactly one matching saved note confirmed/,
    );
    assert.match(
      await page.locator("#run-detail").innerText(),
      /historical origin or authentication/i,
    );
    await page.locator("#run-detail summary").click();
    assert.equal(
      await page.locator("#run-detail .events li").count(),
      legacyReport.events.length,
    );
    assert.doesNotMatch(
      await page.locator("#run-detail .events li time").first().innerText(),
      /Time not recorded/,
      "The original runtime event timestamp must remain visible after import",
    );
    assert.equal(
      await page
        .locator("#run-detail .events li time")
        .first()
        .getAttribute("datetime"),
      legacyReport.events[0].at,
    );
    await page.screenshot({
      path: join(output, "import-history-events.png"),
      fullPage: true,
    });
    await page.locator("#run-detail summary").click();
    await page.screenshot({
      path: join(output, "import-history-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: join(output, "import-history-narrow.png"),
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      "Imported provenance and history controls fit a narrow viewport",
    );
    await page.reload();
    await waitTarget(page, "target-a");
    await eventually(
      async () =>
        (await page.locator("#run-detail").getAttribute("data-source-kind")) ===
        "archive",
      "Imported selection survives browser reload",
    );
    const response = await authenticated(
      server,
      `/api/targets/target-b/imports/${legacy.runId}`,
    );
    assert.ok(response.status >= 400);
    await page.selectOption("#target-select", "target-b");
    await waitTarget(page, "target-b");
    assert.doesNotMatch(
      await page.locator("#history-list").innerText(),
      new RegExp(legacy.runId),
    );
    await page.selectOption("#target-select", "target-a");
    await waitTarget(page, "target-a");
    await page.getByRole("button", { name: newer.runId, exact: true }).click();
    await eventually(
      async () =>
        (await page.locator("#run-detail").getAttribute("data-source-kind")) ===
        "journal",
      "New journal history stays separately inspectable",
    );
    assert.match(
      await page.locator("#run-detail").innerText(),
      /Complete journal/i,
    );
    await page
      .getByRole("button", { name: "Review evidence & findings", exact: true })
      .click();
    await eventually(
      async () =>
        (await page.locator("#knowledge-summary").innerText()).includes(
          "Retained R4 knowledge",
        ),
      "Previously accepted knowledge remains available after import and rebuild",
    );
    assert.equal(await page.locator("#save-record").isDisabled(), false);
    assert.deepEqual(
      await treeSnapshot(workspaceRoot),
      workspaceBefore,
      "Browsing mixed history and accepted knowledge performs no workspace writes",
    );
    assert.deepEqual(await treeSnapshot(sourceDirectory), sourceBefore);
    assert.equal(writes, 2);
    assert.equal(app.writes, 2);
    assert.equal(launches, 0);
    assert.equal(
      (await (await context.request.get(`${app.url}/api/notes`)).json()).items
        .length,
      2,
      "The independent application retains exactly the two deliberately executed saves",
    );
    assert.deepEqual(pageErrors, []);
  },
);
