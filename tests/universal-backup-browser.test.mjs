// Synthetic recovery conformance; this fixture is not customer activity.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { openCatalog } from "../packages/universal/src/catalog.mjs";
import { createEvidenceStore } from "../packages/universal/src/evidence.mjs";
import { createUniversalServer } from "../packages/universal/src/server.mjs";
import { createTargetController } from "../packages/universal/src/controller.mjs";
import {
  assertTargetRegistration,
  captureTargetRegistration,
} from "../packages/universal/src/registration.mjs";
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
  process.env.DAEDLO_UNIVERSAL_BACKUP_OUTPUT ??
    join(repo, "artifacts/storage-r5b/browser"),
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function treeSnapshot(root) {
  const entries = [];
  async function visit(path, relative) {
    const stat = await fs.lstat(path);
    entries.push({
      path: relative,
      inode: stat.ino,
      mode: stat.mode,
      modified: stat.mtimeMs,
      ...(stat.isFile() ? { sha256: hash(await fs.readFile(path)) } : {}),
    });
    if (stat.isDirectory())
      for (const name of (await fs.readdir(path)).sort())
        await visit(join(path, name), join(relative, name));
  }
  await visit(root, ".");
  return entries;
}

function authoritativeRows(root) {
  const db = new DatabaseSync(join(root, "workspace.sqlite"), {
    readOnly: true,
  });
  try {
    return Object.fromEntries(
      [
        "catalog_meta",
        "catalog_migrations",
        "targets",
        "target_revisions",
        "archive_imports",
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

async function eventually(read, label, timeout = 10000) {
  const end = Date.now() + timeout;
  do {
    if (await read()) return;
    await new Promise((done) => setTimeout(done, 25));
  } while (Date.now() < end);
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

function request(server, path, options = {}) {
  const url = new URL(server.url),
    token = new URLSearchParams(url.hash.slice(1)).get("token");
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

// A complete registration lets the launch test fail specifically on the copied
// workspace binding. Its source must never be evaluated by backup or browsing.
async function registration(root, workspaceRoot, targetId, origin) {
  const sourceRoot = join(root, `source-${targetId}`),
    store = join(root, `manager-${targetId}`),
    configPath = join(root, `${targetId}.json`),
    files = {
      "package.json": JSON.stringify({
        name: `restore-${targetId}`,
        version: "1.0.0",
        type: "module",
      }),
      "package-lock.json": JSON.stringify({
        lockfileVersion: 3,
        packages: { "": {} },
      }),
      "engine/Cargo.toml":
        '[package]\nname = "notebook-fixture"\nversion = "1.0.0"\n[dependencies]\ndaedlo-engine = "0.1.0"\n',
      "engine/Cargo.lock": "# Retained registration fixture\n",
      "launcher.mjs":
        'export function createManagedLaunch() { throw Error("Restoration must never evaluate an application launcher"); }\n',
      "acceptance.mjs":
        'throw Error("Restoration must never evaluate an application hook");\n',
      "health.mjs":
        'throw Error("Restoration must never evaluate an application hook");\n',
      "adapter.mjs": await fs.readFile(
        new URL("../examples/notebook/adapter.mjs", import.meta.url),
        "utf8",
      ),
    };
  for (const [name, bytes] of Object.entries(files)) {
    await fs.mkdir(dirname(join(sourceRoot, name)), { recursive: true });
    await fs.writeFile(join(sourceRoot, name), bytes);
  }
  await fs.mkdir(store);
  const config = {
    schemaVersion: 2,
    workspace: { id: "restore-conformance", root: workspaceRoot, journal: 1 },
    store,
    frontend: { name: "Notebook", targetOrigin: origin },
    catalog: {
      channel: "preview",
      trustedKeys: [{ id: "fixture", publicKeyFile: "publisher.pem" }],
    },
    registration: {
      schemaVersion: 1,
      projectId: targetId,
      sourceRoot,
      files: Object.keys(files),
      model: { id: "notebook", version: "1" },
      interfaces: {
        launcher: 1,
        nodeAdapter: 1,
        rustModel: 1,
        protocol: 1,
        capabilities: [],
      },
      node: { packageJson: "package.json", packageLock: "package-lock.json" },
      rust: {
        manifest: "engine/Cargo.toml",
        lock: "engine/Cargo.lock",
        binary: "notebook-fixture",
      },
      launcher: "launcher.mjs",
      hooks: { acceptance: "acceptance.mjs", health: "health.mjs" },
    },
  };
  await fs.writeFile(configPath, JSON.stringify(config));
  const workspace = await initializeWorkspace(config),
    { target } = await captureTargetRegistration({
      configPath,
      id: targetId,
      label: "Notebook",
      environment: targetId === "target-a" ? "Development" : "Separate review",
      authProfileRef: `owned-context-${targetId}`,
    });
  await assertTargetRegistration(target, workspaceRoot);
  return { target, workspace };
}

test(
  "Universal restores two targets at the backup boundary and preserves later work without replay",
  { timeout: 180000 },
  async (t) => {
    const root = await fs.realpath(
        await fs.mkdtemp(join(tmpdir(), "universal-backup-browser-")),
      ),
      originalRoot = join(root, "original"),
      externalRoot = join(root, "integration-and-original-reports"),
      backupRoot = join(root, "prior-backup"),
      restoredRoot = join(root, "restored-prior"),
      latestBackup = join(root, "latest-backup"),
      latestRoot = join(root, "restored-latest"),
      owned = [],
      fixtures = new Map();
    let browser,
      app,
      catalog,
      evidence,
      server,
      controller,
      toolCalls = 0,
      launches = 0;
    t.after(async () => {
      const errors = [];
      for (const resource of [
        server,
        controller,
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
          `Backup browser cleanup failed; retained ${root}`,
        );
      await fs.rm(root, { recursive: true, force: true });
    });
    await fs.mkdir(output, { recursive: true });
    await fs.mkdir(externalRoot);
    const enginePath = resolve(
        process.env.DAEDLO_UNIVERSAL_ENGINE_PATH ??
          join(repo, "target/debug/notebook-engine"),
      ),
      runtimeVersion = JSON.parse(
        await fs.readFile(
          new URL("../packages/universal-runtime/package.json", import.meta.url),
        ),
      ).version;
    await fs.access(enginePath);
    app = await createNotebookServer();
    browser = await chromium.launch({ headless: true });

    async function save(f, journal) {
      const writer = journal
        ? await openRunJournal({
            workspace: f.workspace,
            installation: f.installation,
          })
        : null;
      if (writer) owned.push(writer);
      const driver = await createDriverSession({
        page: f.page,
        context: f.context,
        enginePath,
        adapter: createNotebookAdapter(f.page),
        ...(writer
          ? {
              runJournal: {
                startRun: (input) => writer.begin(input),
                beforeEffect: (input) => writer.beforeEffect(input),
              },
            }
          : {}),
      });
      owned.push(driver);
      driver.setSpeed("fast");
      const result = await driver.runRecipe(
          "save_example",
          (await driver.snapshot()).revision,
        ),
        report = driver.report({ runId: result.runId });
      assert.equal(result.execution, "completed");
      assert.equal(result.effect.status, "saved");
      if (writer) await writer.finish({ runId: result.runId, report });
      await driver.close();
      await writer?.close();
      return { runId: result.runId, report, result };
    }

    for (const [id, session] of [
      ["target-a", "alpha"],
      ["target-b", "beta"],
    ]) {
      const registered = await registration(
          externalRoot,
          originalRoot,
          id,
          app.url,
        ),
        context = await browser.newContext();
      await context.addCookies([
        {
          name: "notebook_session",
          value: session,
          url: app.url,
          httpOnly: true,
          sameSite: "Strict",
        },
      ]);
      const page = await context.newPage();
      let writes = 0;
      page.on("request", (req) => {
        if (
          req.method() === "POST" &&
          new URL(req.url()).pathname === "/api/notes"
        )
          writes++;
      });
      await page.goto(app.url);
      await page.waitForFunction(
        (value) => document.body.dataset.session === value,
        session,
      );
      const f = {
        ...registered,
        context,
        page,
        installation: {
          id: `fixture-${id}`,
          version: runtimeVersion,
          sourceSha256: registered.target.sourceSha256,
          model: registered.target.model,
        },
        get writes() {
          return writes;
        },
      };
      f.legacy = await save(f, false);
      const archiveRoot = join(externalRoot, `reports-${id}`),
        archive = createNinjaEvidence({
          root: archiveRoot,
          installation: f.installation,
        });
      await archive.retain(f.legacy.result, () => f.legacy.report);
      await archive.drain();
      f.sourceFile = join(archiveRoot, (await fs.readdir(archiveRoot))[0]);
      f.originalArchive = await fs.readFile(f.sourceFile);
      f.journal = await save(f, true);
      f.journalBytes = await fs.readFile(
        join(f.workspace.journalRoot, `${f.journal.runId}.jsonl`),
      );
      f.image = await page.screenshot();
      fixtures.set(id, f);
    }
    assert.equal(app.writes, 4);
    catalog = await openCatalog({ root: originalRoot, create: true });
    evidence = await createEvidenceStore({ root: originalRoot, catalog });
    for (const f of fixtures.values()) {
      f.target = await catalog.registerTarget(f.target);
      await catalog.indexTarget(f.target.id);
      await catalog.importManagedArchive({
        targetId: f.target.id,
        expectedTargetRevision: 1,
        sourceFile: f.sourceFile,
      });
      f.imported = await catalog.getImportedRun({
        targetId: f.target.id,
        runId: f.legacy.runId,
      });
      f.attached = await evidence.put({
        targetId: f.target.id,
        runId: f.journal.runId,
        label: `Saved note ${f.target.id}`,
        mediaType: "image/png",
        bytes: f.image,
        expectedTargetRevision: 1,
      });
      f.text = await evidence.put({
        targetId: f.target.id,
        runId: f.journal.runId,
        label: `Readback ${f.target.id}`,
        mediaType: "text/plain",
        bytes: Buffer.from(`Exactly two deliberate saves for ${f.target.id}.`),
        expectedTargetRevision: 1,
      });
      const refs = [
        {
          runId: f.journal.runId,
          eventSequence: null,
          evidenceId: f.attached.id,
        },
      ];
      f.finding = await catalog.createRecord({
        targetId: f.target.id,
        expectedTargetRevision: 1,
        kind: "finding",
        title: `Saved note finding ${f.target.id}`,
        body: "The independent application readback confirms the deliberate save.",
        refs,
      });
      f.knowledge = await catalog.createRecord({
        targetId: f.target.id,
        expectedTargetRevision: 1,
        kind: "knowledge",
        title: `Save guidance ${f.target.id}`,
        body: `Original reviewed guidance ${f.target.id}.`,
        refs,
      });
      await catalog.reviewRecord({
        targetId: f.target.id,
        recordId: f.knowledge.id,
        expectedRevision: 1,
        expectedTargetRevision: 1,
        decision: "accepted",
        note: "Reviewed against saved evidence.",
      });
      await catalog.reviseRecord({
        targetId: f.target.id,
        recordId: f.knowledge.id,
        expectedRevision: 1,
        expectedTargetRevision: 1,
        title: `Save guidance ${f.target.id}`,
        body: `Accepted boundary guidance ${f.target.id}.`,
        refs,
      });
      await catalog.reviewRecord({
        targetId: f.target.id,
        recordId: f.knowledge.id,
        expectedRevision: 2,
        expectedTargetRevision: 1,
        decision: "accepted",
        note: "Second reviewed version retained at the backup boundary.",
      });
      f.record = await catalog.getRecord({
        targetId: f.target.id,
        recordId: f.knowledge.id,
      });
      f.oldRecord = await catalog.getRecord({
        targetId: f.target.id,
        recordId: f.knowledge.id,
        revision: 1,
      });
      f.summary = await catalog.getTargetSummary({ targetId: f.target.id });
      assert.equal(f.record.state, "accepted");
      assert.equal(f.oldRecord.state, "superseded");
      assert.equal(f.summary.items.length, 1);
      f.history = await catalog.getRun({
        targetId: f.target.id,
        runId: f.journal.runId,
      });
    }
    const boundaryRows = authoritativeRows(originalRoot),
      externalBefore = await treeSnapshot(externalRoot);
    await evidence.close();
    evidence = null;
    await catalog.close();
    catalog = null;

    // The production backup CLI has its own genuine unsupported-command RED.
    // An unavailable module is a setup failure, never browser behavior evidence.
    const { backupWorkspace, restoreWorkspace } = await import(
      "../packages/universal/src/workspace-backup.mjs"
    );
    const prior = await backupWorkspace({
      root: originalRoot,
      output: backupRoot,
    });
    assert.equal(prior.catalogVersion, 3);
    const backupBefore = await treeSnapshot(backupRoot);

    // New work deliberately occurs after the earlier backup. Restoring the
    // earlier boundary must neither invent it there nor discard it at source.
    const a = fixtures.get("target-a"),
      b = fixtures.get("target-b");
    a.latest = await save(a, true);
    catalog = await openCatalog({ root: originalRoot });
    await catalog.indexTarget(a.target.id);
    evidence = await createEvidenceStore({ root: originalRoot, catalog });
    a.latestEvidence = await evidence.put({
      targetId: a.target.id,
      runId: a.latest.runId,
      label: "Latest retained proof",
      mediaType: "text/plain",
      bytes: Buffer.from(
        "This later save must survive restoration of an older backup.",
      ),
      expectedTargetRevision: 1,
    });
    await catalog.reviseRecord({
      targetId: a.target.id,
      recordId: a.knowledge.id,
      expectedRevision: 2,
      expectedTargetRevision: 1,
      title: "Latest retained guidance",
      body: "This newer accepted revision remains recoverable.",
      refs: [
        {
          runId: a.latest.runId,
          eventSequence: null,
          evidenceId: a.latestEvidence.id,
        },
      ],
    });
    await catalog.reviewRecord({
      targetId: a.target.id,
      recordId: a.knowledge.id,
      expectedRevision: 3,
      expectedTargetRevision: 1,
      decision: "accepted",
    });
    const latestRows = authoritativeRows(originalRoot);
    await evidence.close();
    evidence = null;
    await catalog.close();
    catalog = null;
    const originalBeforeRestore = await treeSnapshot(originalRoot);
    const restored = await restoreWorkspace({
      backup: backupRoot,
      root: restoredRoot,
      catalogVersion: 3,
    });
    assert.equal(restored.restored, true);
    assert.deepEqual(
      await treeSnapshot(originalRoot),
      originalBeforeRestore,
      "Restoring an earlier boundary leaves every current source file and identity unchanged",
    );
    assert.deepEqual(await treeSnapshot(backupRoot), backupBefore);
    assert.deepEqual(
      authoritativeRows(restoredRoot),
      boundaryRows,
      "Both targets, imports and every review revision survive restoration exactly",
    );

    async function openRestored(rootToOpen) {
      catalog = await openCatalog({ root: rootToOpen });
      evidence = await createEvidenceStore({ root: rootToOpen, catalog });
      controller = createTargetController({
        root: rootToOpen,
        catalog,
        nativeCommand: async () => {
          launches++;
          throw Error("Restored browsing must never start a native session");
        },
        toolsLoader: async () => {
          toolCalls++;
          throw Error(
            "A stale workspace binding must refuse before loading native tools",
          );
        },
      });
      server = await createUniversalServer({
        catalog,
        evidence,
        launch: controller.launch,
      });
    }
    async function closeRestored() {
      await server.close();
      server = null;
      await controller.close();
      controller = null;
      await evidence.close();
      evidence = null;
      await catalog.close();
      catalog = null;
    }
    await openRestored(restoredRoot);
    assert.deepEqual(await catalog.listTargets(), [a.target, b.target]);
    for (const f of fixtures.values()) {
      assert.equal(
        (await catalog.listRuns({ targetId: f.target.id })).items.length,
        2,
      );
      assert.deepEqual(
        await catalog.getRun({ targetId: f.target.id, runId: f.journal.runId }),
        f.history,
      );
      assert.deepEqual(
        await catalog.getImportedRun({
          targetId: f.target.id,
          runId: f.legacy.runId,
        }),
        f.imported,
      );
      assert.deepEqual(
        await catalog.getRecord({
          targetId: f.target.id,
          recordId: f.knowledge.id,
        }),
        f.record,
      );
      assert.deepEqual(
        await catalog.getRecord({
          targetId: f.target.id,
          recordId: f.knowledge.id,
          revision: 1,
        }),
        f.oldRecord,
      );
      assert.deepEqual(
        await catalog.getTargetSummary({ targetId: f.target.id }),
        f.summary,
      );
      assert.deepEqual(
        (
          await evidence.read({
            targetId: f.target.id,
            evidenceId: f.attached.id,
          })
        ).bytes,
        f.image,
      );
      const evidenceFile = join(
        "evidence",
        f.target.id,
        `${f.attached.id}.bin`,
      );
      assert.notEqual(
        (await fs.stat(join(restoredRoot, evidenceFile))).ino,
        (await fs.stat(join(originalRoot, evidenceFile))).ino,
        "Restored evidence is an independent file, not a link to current data",
      );
      await assert.rejects(controller.launch(f.target.id, { revision: 1 }), {
        code: "target_changed",
      });
      // Use the existing relative layout, rather than relying on an inode copy.
      const relativeJournal = join(
        f.workspace.journalRoot.slice(originalRoot.length + 1),
        `${f.journal.runId}.jsonl`,
      );
      assert.deepEqual(
        await fs.readFile(join(restoredRoot, relativeJournal)),
        f.journalBytes,
      );
      assert.notEqual(
        (await fs.stat(join(restoredRoot, relativeJournal))).ino,
        (await fs.stat(join(originalRoot, relativeJournal))).ino,
      );
    }
    await assert.rejects(
      catalog.getRun({ targetId: "target-b", runId: a.latest.runId }),
    );
    await assert.rejects(
      catalog.getImportedRun({ targetId: "target-b", runId: a.legacy.runId }),
    );
    await assert.rejects(
      evidence.read({ targetId: "target-b", evidenceId: a.attached.id }),
    );
    await assert.rejects(
      catalog.getRecord({ targetId: "target-b", recordId: a.knowledge.id }),
    );
    assert.equal(toolCalls, 0);
    assert.equal(launches, 0);

    const page = await browser.newPage({
        viewport: { width: 1440, height: 1080 },
      }),
      pageErrors = [],
      restoredBeforeBrowse = await treeSnapshot(restoredRoot);
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(server.url);
    for (const f of fixtures.values()) {
      await page.selectOption("#target-select", f.target.id);
      await waitTarget(page, f.target.id);
      await page
        .getByRole("button", { name: "Open live session", exact: true })
        .click();
      await eventually(
        async () =>
          (await page.locator("#page-error").innerText()).includes("changed"),
        "The restored workspace refuses the original live configuration in the UI",
      );
      assert.equal(await page.locator("#live-link").isVisible(), false);
      assert.equal(
        await page
          .locator('#history-list tr[data-source-kind="archive"]')
          .count(),
        1,
      );
      assert.equal(
        await page
          .locator('#history-list tr[data-source-kind="journal"]')
          .count(),
        1,
      );
      await page
        .getByRole("button", { name: f.legacy.runId, exact: true })
        .click();
      await eventually(
        async () =>
          (await page
            .locator("#run-detail")
            .getAttribute("data-source-kind")) === "archive",
        "Restored imported history is visible",
      );
      assert.match(
        await page.locator("#run-detail").innerText(),
        /completed report only/i,
      );
      assert.match(
        await page.locator("#run-detail").innerText(),
        /historical origin or authentication/i,
      );
      await page
        .getByRole("button", { name: f.journal.runId, exact: true })
        .click();
      await eventually(
        async () =>
          (await page
            .locator("#run-detail")
            .getAttribute("data-source-kind")) === "journal",
        "Restored journal remains visible separately",
      );
      assert.match(
        await page.locator("#run-detail").innerText(),
        /Complete journal/i,
      );
      await page
        .getByRole("button", {
          name: "Review evidence & findings",
          exact: true,
        })
        .click();
      await eventually(
        async () =>
          (await page.locator("#knowledge-summary").innerText()).includes(
            `Accepted boundary guidance ${f.target.id}`,
          ),
        "Restored accepted knowledge retains current verified references",
      );
      const card = page
        .locator(`#knowledge-records [data-record-id="${f.knowledge.id}"]`)
        .first();
      await card.getByText("Revision history", { exact: true }).click();
      await card
        .getByRole("button", { name: "Inspect revision 1", exact: true })
        .click();
      await eventually(
        async () =>
          (await card.innerText()).includes(
            `Original reviewed guidance ${f.target.id}`,
          ),
        "Restored superseded revision remains inspectable",
      );
      assert.match(await card.innerText(), /Superseded/);
      await page
        .locator(`[data-evidence-id="${f.attached.id}"]`)
        .getByRole("button", { name: "Preview", exact: true })
        .click();
      await page.locator("#evidence-preview img").waitFor();
      const content = await request(
        server,
        `/api/targets/${f.target.id}/evidence/${f.attached.id}/content`,
      );
      assert.equal(content.status, 200);
      assert.deepEqual(Buffer.from(await content.arrayBuffer()), f.image);
      const refused = await request(
        server,
        `/api/targets/${f.target.id}/launch`,
        { method: "POST", body: JSON.stringify({ revision: 1 }) },
      );
      assert.equal(refused.status, 409);
      assert.equal((await refused.json()).error.code, "target_changed");
      if (f.target.id === "target-a") {
        await page.screenshot({
          path: join(output, "restored-history-desktop.png"),
          fullPage: true,
        });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({
          path: join(output, "restored-history-narrow.png"),
          fullPage: true,
        });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        await page.setViewportSize({ width: 1440, height: 1080 });
      }
      await page.getByRole("button", { name: "History", exact: true }).click();
    }
    for (const path of [
      `/api/targets/target-b/imports/${a.legacy.runId}`,
      `/api/targets/target-b/runs/${a.journal.runId}`,
      `/api/targets/target-b/evidence/${a.attached.id}/content`,
      `/api/targets/target-b/records/${a.knowledge.id}`,
    ])
      assert.ok(
        (await request(server, path)).status >= 400,
        "Restored target boundaries remain enforced",
      );
    assert.deepEqual(
      await treeSnapshot(restoredRoot),
      restoredBeforeBrowse,
      "History, previews, reviews and refused launches leave the restored workspace unchanged",
    );
    await closeRestored();
    await openRestored(restoredRoot);
    for (const f of fixtures.values())
      await catalog.indexTarget(f.target.id, { rebuild: true });
    assert.deepEqual(
      authoritativeRows(restoredRoot),
      boundaryRows,
      "Rebuild preserves original archive bytes, evidence, all content revisions and reviews",
    );
    await page.goto(server.url);
    await waitTarget(page, "target-a");
    assert.equal(await page.locator("#history-list tbody tr").count(), 2);
    assert.deepEqual(
      await catalog.getTargetSummary({ targetId: "target-a" }),
      a.summary,
    );
    await closeRestored();

    await backupWorkspace({ root: originalRoot, output: latestBackup });
    const latestSourceBefore = await treeSnapshot(originalRoot),
      latestBackupBefore = await treeSnapshot(latestBackup);
    await restoreWorkspace({
      backup: latestBackup,
      root: latestRoot,
      catalogVersion: 3,
    });
    assert.deepEqual(
      authoritativeRows(latestRoot),
      latestRows,
      "The separately retained latest snapshot contains all newer work",
    );
    await openRestored(latestRoot);
    assert.equal(
      (await catalog.listRuns({ targetId: "target-a" })).items.length,
      3,
    );
    assert.equal(
      (await catalog.listRuns({ targetId: "target-b" })).items.length,
      2,
    );
    const newest = await catalog.getRecord({
      targetId: "target-a",
      recordId: a.knowledge.id,
    });
    assert.equal(newest.revision, 3);
    assert.equal(newest.state, "accepted");
    assert.equal(
      newest.body,
      "This newer accepted revision remains recoverable.",
    );
    assert.equal(
      (
        await evidence.inspect({
          targetId: "target-a",
          evidenceId: a.latestEvidence.id,
        })
      ).integrity,
      "available",
    );
    await closeRestored();
    assert.deepEqual(await treeSnapshot(originalRoot), latestSourceBefore);
    assert.deepEqual(await treeSnapshot(backupRoot), backupBefore);
    assert.deepEqual(await treeSnapshot(latestBackup), latestBackupBefore);
    assert.deepEqual(
      await treeSnapshot(externalRoot),
      externalBefore,
      "Original report files, target configurations, source and managers retain bytes, inodes and timestamps",
    );
    assert.equal(toolCalls, 0);
    assert.equal(launches, 0);
    assert.equal(a.writes, 3);
    assert.equal(b.writes, 2);
    assert.equal(app.writes, 5);
    for (const f of fixtures.values()) {
      const readback = await (
        await f.context.request.get(`${app.url}/api/notes`)
      ).json();
      assert.equal(
        readback.items.length,
        f.writes,
        "Independent application readback counts only deliberately executed saves",
      );
      assert.deepEqual(await fs.readFile(f.sourceFile), f.originalArchive);
    }
    assert.deepEqual(pageErrors, []);
  },
);
