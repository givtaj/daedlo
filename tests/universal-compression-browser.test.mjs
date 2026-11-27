// Synthetic compression conformance; this fixture is not customer activity.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { universalCommand } from "../packages/universal/src/cli.mjs";
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
import {
  openRunJournal,
  readRunJournal,
} from "../packages/universal/vendor/tools/lib/run-journal.mjs";
import { createNinjaEvidence } from "../packages/universal/vendor/tools/lib/ninja-evidence.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const { chromium } = createRequire(
  new URL("../packages/universal-runtime/src/index.mjs", import.meta.url),
)("playwright");
const output = resolve(
  process.env.DAEDLO_UNIVERSAL_COMPRESSION_OUTPUT ??
    join(repo, "artifacts/storage-r5c/browser"),
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

// Backup creates and retires project writer locks. File bytes, file timestamps,
// and every directory identity remain protected; those lock-directory mtimes are
// intentionally outside the preservation claim across the backup operation.
const withoutWriterDirectoryTimes = (rows) =>
  rows.map((entry) => {
    if (!entry.sha256 && /^projects\/[^/]+\/run-journals$/.test(entry.path)) {
      const { modified, ...retained } = entry;
      return retained;
    }
    return entry;
  });

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

function compressionRows(root) {
  const db = new DatabaseSync(join(root, "workspace.sqlite"), {
    readOnly: true,
  });
  try {
    return db
      .prepare("SELECT * FROM journal_compressions ORDER BY target_id,run_id")
      .all();
  } finally {
    db.close();
  }
}
const compressionData = (rows) =>
  rows.map(({ binding_dev, binding_ino, ...row }) => row);
async function assertCompressionBindings(root, expected) {
  const actual = compressionRows(root);
  assert.deepEqual(
    compressionData(actual),
    compressionData(expected),
    "Compressed bytes and original provenance survive exact file rebinding",
  );
  for (const row of actual) {
    assert.equal(row.state, "active");
    assert.equal(row.replacement, null);
    const stat = await fs.stat(
      join(
        root,
        "projects",
        row.target_id,
        "run-journals",
        row.run_id + ".jsonl",
      ),
      { bigint: true },
    );
    assert.equal(row.binding_dev, String(stat.dev));
    assert.equal(row.binding_ino, String(stat.ino));
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
        name: `compression-${targetId}`,
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
        'export function createManagedLaunch() { throw Error("Compression must never evaluate an application launcher"); }\n',
      "acceptance.mjs":
        'throw Error("Compression must never evaluate an application hook");\n',
      "health.mjs":
        'throw Error("Compression must never evaluate an application hook");\n',
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
    workspace: {
      id: "compression-conformance",
      root: workspaceRoot,
      journal: 1,
    },
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
  "Universal compresses closed journals across targets, restores mixed history and preserves rollback without replay",
  { timeout: 180000 },
  async (t) => {
    const root = await fs.realpath(
        await fs.mkdtemp(join(tmpdir(), "universal-compression-browser-")),
      ),
      originalRoot = join(root, "original"),
      externalRoot = join(root, "integration-and-original-reports"),
      backupRoot = join(root, "plain-before-compression"),
      restoredRoot = join(root, "restored-compressed"),
      latestBackup = join(root, "preserved-before-rollback"),
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
          `Compression browser cleanup failed; retained ${root}`,
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

    const { backupWorkspace, restoreWorkspace, rollbackWorkspace } =
      await import("../packages/universal/src/workspace-backup.mjs");
    const prior = await backupWorkspace({
      root: originalRoot,
      output: backupRoot,
    });
    assert.equal(prior.catalogVersion, 3);
    const priorBackupBefore = await treeSnapshot(backupRoot);
    const upgraded = await universalCommand([
      "upgrade",
      "--workspace",
      originalRoot,
      "--catalog-version",
      "4",
    ]);
    assert.equal(upgraded.result.catalogVersion, 4);
    const a = fixtures.get("target-a"),
      b = fixtures.get("target-b");
    const compress = (f, runId, replace = false) =>
      universalCommand([
        "compress",
        "--workspace",
        originalRoot,
        "--target",
        f.target.id,
        "--run",
        runId,
        ...(replace ? ["--replace"] : []),
      ]);
    const prepared = (await compress(a, a.journal.runId)).result;
    assert.equal(prepared.state, "retained");
    assert.equal(prepared.sourceRetained, true);
    assert.equal(prepared.rawBytes, a.journalBytes.length);
    assert.ok(prepared.compressedBytes < prepared.rawBytes);
    assert.deepEqual(
      await fs.readFile(
        join(a.workspace.journalRoot, a.journal.runId + ".jsonl"),
      ),
      a.journalBytes,
      "Default compression preserves the exact plain source",
    );
    assert.deepEqual((await compress(a, a.journal.runId)).result, prepared);

    for (const f of fixtures.values()) {
      const result = (await compress(f, f.journal.runId, true)).result;
      assert.equal(result.state, "active");
      assert.equal(result.sourceRetained, false);
      assert.equal(result.plainBytesRemoved, f.journalBytes.length);
      f.marker = await fs.readFile(
        join(f.workspace.journalRoot, f.journal.runId + ".jsonl"),
      );
      assert.ok(f.marker.length < f.journalBytes.length);
      assert.notDeepEqual(f.marker, f.journalBytes);
      await assert.rejects(
        readRunJournal({ workspace: f.workspace, runId: f.journal.runId }),
        {
          code: "journal_incompatible",
        },
      );
      assert.deepEqual((await compress(f, f.journal.runId, true)).result, {
        ...result,
        plainBytesRemoved: 0,
      });
    }

    // Existing basic writers still create new plain journals after opt-in cold
    // compression. These are deliberate actions, counted independently below.
    a.latest = await save(a, true);
    a.latestBytes = await fs.readFile(
      join(a.workspace.journalRoot, a.latest.runId + ".jsonl"),
    );
    assert.equal(app.writes, 5);
    for (const f of fixtures.values()) {
      const writer = await openRunJournal({
        workspace: f.workspace,
        installation: f.installation,
      });
      owned.push(writer);
      const first = f.history.events[0].payload;
      f.incompleteId = `uncompleted-${f.target.id}`;
      await writer.begin({
        runId: f.incompleteId,
        command: first.command,
        recipe: first.recipe,
        startedAt: new Date().toISOString(),
        identity: first.identity,
      });
      await writer.close();
      f.incompletePath = join(
        f.workspace.journalRoot,
        f.incompleteId + ".jsonl",
      );
      if (f === b) await fs.appendFile(f.incompletePath, '{"partial":');
      f.incompleteBytes = await fs.readFile(f.incompletePath);
      await assert.rejects(compress(f, f.incompleteId, true), {
        code: "compression_not_closed",
      });
      assert.deepEqual(await fs.readFile(f.incompletePath), f.incompleteBytes);
    }
    catalog = await openCatalog({ root: originalRoot });
    evidence = await createEvidenceStore({ root: originalRoot, catalog });
    for (const f of fixtures.values()) {
      await catalog.indexTarget(f.target.id, { rebuild: true });
      assert.deepEqual(
        await catalog.getRun({ targetId: f.target.id, runId: f.journal.runId }),
        f.history,
      );
      f.incomplete = await catalog.getRun({
        targetId: f.target.id,
        runId: f.incompleteId,
      });
      assert.equal(f.incomplete.status, "incomplete");
      assert.equal(f.incomplete.recovery.execution, "interrupted");
      assert.equal(f.incomplete.recovery.effect.status, "uncertain");
      assert.equal(f.incomplete.partialTail, f === b);
      const repeatedImport = await catalog.importManagedArchive({
        targetId: f.target.id,
        expectedTargetRevision: 1,
        sourceFile: f.sourceFile,
      });
      assert.equal(repeatedImport.imported, false);
      assert.deepEqual(
        await catalog.getImportedRun({
          targetId: f.target.id,
          runId: f.legacy.runId,
        }),
        f.imported,
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
    }
    a.latestHistory = await catalog.getRun({
      targetId: a.target.id,
      runId: a.latest.runId,
    });
    const currentRows = authoritativeRows(originalRoot),
      currentCompressions = compressionRows(originalRoot);
    assert.equal(currentCompressions.length, 2);
    await evidence.close();
    evidence = null;
    await catalog.close();
    catalog = null;
    const compressedBackup = join(root, "compressed-backup");
    assert.equal(
      (await backupWorkspace({ root: originalRoot, output: compressedBackup }))
        .catalogVersion,
      4,
    );
    const sourceBeforeRestore = await treeSnapshot(originalRoot),
      compressedBackupBefore = await treeSnapshot(compressedBackup);
    assert.equal(
      (
        await restoreWorkspace({
          backup: compressedBackup,
          root: restoredRoot,
          catalogVersion: 4,
        })
      ).restored,
      true,
    );
    assert.deepEqual(await treeSnapshot(originalRoot), sourceBeforeRestore);
    assert.deepEqual(
      await treeSnapshot(compressedBackup),
      compressedBackupBefore,
    );
    assert.deepEqual(authoritativeRows(restoredRoot), currentRows);
    await assertCompressionBindings(restoredRoot, currentCompressions);

    async function openRestored(rootToOpen) {
      catalog = await openCatalog({ root: rootToOpen });
      evidence = await createEvidenceStore({ root: rootToOpen, catalog });
      controller = createTargetController({
        root: rootToOpen,
        catalog,
        nativeCommand: async () => {
          launches++;
          throw Error("Compression history must not launch a native session");
        },
        toolsLoader: async () => {
          toolCalls++;
          throw Error("Restored bindings must refuse before native loading");
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
    async function assertCurrent(rootToCheck = restoredRoot) {
      assert.deepEqual(await catalog.listTargets(), [a.target, b.target]);
      for (const f of fixtures.values()) {
        assert.equal(
          (await catalog.listRuns({ targetId: f.target.id })).items.length,
          f === a ? 4 : 3,
        );
        assert.deepEqual(
          await catalog.getRun({
            targetId: f.target.id,
            runId: f.journal.runId,
          }),
          f.history,
        );
        assert.deepEqual(
          await catalog.getRun({
            targetId: f.target.id,
            runId: f.incompleteId,
          }),
          f.incomplete,
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
        assert.deepEqual(
          await fs.readFile(
            join(
              rootToCheck,
              "projects",
              f.target.id,
              "run-journals",
              f.incompleteId + ".jsonl",
            ),
          ),
          f.incompleteBytes,
        );
      }
      assert.deepEqual(
        await catalog.getRun({ targetId: a.target.id, runId: a.latest.runId }),
        a.latestHistory,
      );
    }
    await openRestored(restoredRoot);
    await assertCurrent();
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
        .getByRole("button", { name: f.incompleteId, exact: true })
        .click();
      await eventually(
        async () =>
          /interrupted|incomplete/i.test(
            await page.locator("#run-detail").innerText(),
          ),
        "Uncompressed interrupted history retains its disclosure",
      );
      await page
        .getByRole("button", { name: f.journal.runId, exact: true })
        .click();
      await eventually(
        async () =>
          /Complete journal/i.test(
            await page.locator("#run-detail").innerText(),
          ),
        "Compressed history has the identical complete journal interpretation",
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
        "Compressed run references still support accepted knowledge",
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
        "Superseded knowledge remains inspectable",
      );
      assert.match(await card.innerText(), /Superseded/);
      await page
        .locator(`[data-evidence-id="${f.attached.id}"]`)
        .getByRole("button", { name: "Preview", exact: true })
        .click();
      await page.locator("#evidence-preview img").waitFor();
      assert.deepEqual(
        Buffer.from(
          await (
            await request(
              server,
              `/api/targets/${f.target.id}/evidence/${f.attached.id}/content`,
            )
          ).arrayBuffer(),
        ),
        f.image,
      );
      await assert.rejects(controller.launch(f.target.id, { revision: 1 }), {
        code: "target_changed",
      });
      if (f === a) {
        await page.screenshot({
          path: join(output, "compressed-history-desktop.png"),
          fullPage: true,
        });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({
          path: join(output, "compressed-history-narrow.png"),
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
      `/api/targets/target-b/runs/${a.journal.runId}`,
      `/api/targets/target-b/imports/${a.legacy.runId}`,
      `/api/targets/target-b/evidence/${a.attached.id}/content`,
      `/api/targets/target-b/records/${a.knowledge.id}`,
    ])
      assert.ok(
        (await request(server, path)).status >= 400,
        "Compressed history retains target separation",
      );
    assert.deepEqual(await treeSnapshot(restoredRoot), restoredBeforeBrowse);
    await closeRestored();
    await openRestored(restoredRoot);
    for (const f of fixtures.values())
      await catalog.indexTarget(f.target.id, { rebuild: true });
    await assertCurrent();
    assert.deepEqual(authoritativeRows(restoredRoot), currentRows);
    await assertCompressionBindings(restoredRoot, currentCompressions);
    await closeRestored();

    const rolledBackRoot = join(root, "restored-compatible-plain");
    const rollback = await rollbackWorkspace({
      root: originalRoot,
      backup: backupRoot,
      output: rolledBackRoot,
      preserve: latestBackup,
      catalogVersion: 3,
    });
    assert.equal(rollback.preserved.catalogVersion, 4);
    assert.equal(rollback.restored.catalogVersion, 3);
    assert.deepEqual(authoritativeRows(rolledBackRoot), boundaryRows);
    assert.deepEqual(
      withoutWriterDirectoryTimes(await treeSnapshot(originalRoot)),
      withoutWriterDirectoryTimes(sourceBeforeRestore),
    );
    assert.deepEqual(await treeSnapshot(backupRoot), priorBackupBefore);
    for (const f of fixtures.values())
      assert.deepEqual(
        await fs.readFile(
          join(
            rolledBackRoot,
            "projects",
            f.target.id,
            "run-journals",
            f.journal.runId + ".jsonl",
          ),
        ),
        f.journalBytes,
      );
    const latestBackupBefore = await treeSnapshot(latestBackup);
    await restoreWorkspace({
      backup: latestBackup,
      root: latestRoot,
      catalogVersion: 4,
    });
    assert.deepEqual(authoritativeRows(latestRoot), currentRows);
    await assertCompressionBindings(latestRoot, currentCompressions);
    await openRestored(latestRoot);
    await assertCurrent(latestRoot);
    await closeRestored();
    assert.deepEqual(await treeSnapshot(latestBackup), latestBackupBefore);
    assert.deepEqual(
      await treeSnapshot(compressedBackup),
      compressedBackupBefore,
    );
    assert.deepEqual(await treeSnapshot(externalRoot), externalBefore);
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
        "Only deliberate saves reached the application",
      );
      assert.deepEqual(await fs.readFile(f.sourceFile), f.originalArchive);
    }
    assert.deepEqual(pageErrors, []);
  },
);
