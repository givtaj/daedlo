// Independent conformance for manual evidence/review; no customer activity is represented.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createUniversalServer } from "../packages/universal/src/server.mjs";
import { openCatalog } from "../packages/universal/src/catalog.mjs";
import { createEvidenceStore } from "../packages/universal/src/evidence.mjs";
import { createNotebookServer } from "../examples/notebook/server.mjs";
import { createNotebookAdapter } from "../examples/notebook/adapter.mjs";
import { createDriverSession } from "../packages/universal-runtime/src/index.mjs";
import { initializeWorkspace } from "../packages/universal/vendor/tools/lib/workspace.mjs";
import { openRunJournal } from "../packages/universal/vendor/tools/lib/run-journal.mjs";

const { chromium } = createRequire(
  new URL("../packages/universal-runtime/src/index.mjs", import.meta.url),
)("playwright");
const repo = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(
  process.env.DAEDLO_UNIVERSAL_R4_OUTPUT ??
    join(repo, "artifacts/storage-r4/browser"),
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function request(server, path, body) {
  const url = new URL(server.url),
    token = new URLSearchParams(url.hash.slice(1)).get("token");
  return fetch(new URL(path, url.origin), {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined
        ? {}
        : { Origin: url.origin, "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function eventually(read, label, timeout = 10000) {
  const end = Date.now() + timeout;
  do {
    const result = await read();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (Date.now() < end);
  assert.fail(label);
}
async function waitTarget(page, target) {
  await page.waitForFunction(
    (id) =>
      document.querySelector("#target-select")?.value === id &&
      document.querySelector("#history-list")?.dataset.targetId === id &&
      document.querySelector("#history-list")?.getAttribute("aria-busy") ===
        "false",
    target,
  );
}
async function reloadKnowledge(page) {
  await page.locator("#reload-knowledge").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#target-knowledge")?.getAttribute("aria-busy") ===
      "false",
  );
}
async function waitRecord(page, title, state, revision = 1) {
  return eventually(
    async () => {
      const card = page.locator("#knowledge-records > .record-card").filter({
        has: page.getByRole("heading", { name: title, exact: true }),
      });
      return (await card.count()) === 1 &&
        (await card.getAttribute("data-state")) === state &&
        (await card.getAttribute("data-revision")) === String(revision)
        ? card
        : null;
    },
    `Record ${title} must have ${state} revision ${revision}; latest UI: ${await page.locator("#knowledge-error").textContent()}`,
  );
}

test(
  "Universal exposes a separate target knowledge workspace without starting a live application",
  { timeout: 45000 },
  async (t) => {
    const target = {
      id: "stage",
      label: "Synthetic staging",
      environment: "staging",
      origin: "https://synthetic.invalid",
      model: { id: "synthetic", version: "1" },
      revision: 1,
    };
    let launches = 0,
      browser,
      server;
    t.after(async () => {
      const failures = [];
      for (const handle of [browser, server]) {
        try {
          await handle?.close();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length)
        throw new AggregateError(
          failures,
          "Owned knowledge UI fixture cleanup failed",
        );
    });
    server = await createUniversalServer({
      catalog: {
        listTargets: async () => [target],
        getTarget: async () => target,
        listRuns: async () => ({
          targetId: target.id,
          items: [],
          generation: 0,
          indexedAt: null,
          nextCursor: null,
        }),
        getRun: async () => {
          throw Error("No run selected");
        },
        indexTarget: async () => {
          throw Error("Browsing must not index");
        },
      },
      launch: async () => {
        launches++;
        throw Error("Browsing must not launch");
      },
    });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(server.url);
    await page.waitForFunction(
      () => document.querySelector("#target-select")?.value === "stage",
    );
    assert.equal(
      await page.locator("#target-knowledge").count(),
      1,
      "Manual findings and knowledge need a visible target-scoped workspace",
    );
    await page.locator("#knowledge-tab").click();
    assert.match(
      await page.locator("#knowledge-error").innerText(),
      /explicit storage upgrade/,
    );
    assert.equal(await page.locator("#save-evidence").isDisabled(), true);
    assert.equal(await page.locator("#save-record").isDisabled(), true);
    assert.equal(launches, 0);
  },
);

test(
  "Universal retains reviewed evidence and target knowledge through restart without replaying application actions",
  { timeout: 120000 },
  async (t) => {
    const root = await fs.realpath(
        await fs.mkdtemp(join(tmpdir(), "universal-knowledge-browser-")),
      ),
      workspaceRoot = join(root, "workspace");
    const owned = [],
      fixtures = new Map();
    let app,
      browser,
      server,
      catalog,
      evidence,
      launches = 0;
    t.after(async () => {
      const failures = [];
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
          failures.push(error);
        }
      }
      if (failures.length)
        throw new AggregateError(
          failures,
          `Owned cleanup failed; retained fixture ${root}`,
        );
      await fs.rm(root, { recursive: true, force: true });
    });
    await fs.mkdir(output, { recursive: true });
    const enginePath = resolve(
      process.env.DAEDLO_UNIVERSAL_ENGINE_PATH ??
        join(repo, "target/debug/notebook-engine"),
    );
    await fs.access(enginePath);
    app = await createNotebookServer();
    browser = await chromium.launch({ headless: true });
    const sourceRoot = join(root, "integration");
    await fs.mkdir(sourceRoot);
    const source = await fs.readFile(
      new URL("../examples/notebook/adapter.mjs", import.meta.url),
    );
    await fs.writeFile(join(sourceRoot, "adapter.mjs"), source);
    const runtimeVersion = JSON.parse(
      await fs.readFile(
        new URL("../packages/universal-runtime/package.json", import.meta.url),
      ),
    ).version;
    for (const [id, session, environment] of [
      ["target-a", "alpha", "Development"],
      ["target-b", "beta", "Review"],
    ]) {
      const context = await browser.newContext();
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
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          new URL(request.url()).pathname === "/api/notes"
        )
          writes++;
      });
      await page.goto(app.url);
      await page.waitForFunction(
        (value) => document.body.dataset.session === value,
        session,
      );
      const config = {
        schemaVersion: 2,
        store: join(root, `manager-${id}`),
        workspace: {
          id: "knowledge-conformance",
          root: workspaceRoot,
          journal: 1,
        },
        registration: {
          projectId: id,
          sourceRoot,
          model: { id: "notebook", version: "1" },
        },
      };
      const workspace = await initializeWorkspace(config),
        configPath = join(root, `${id}.json`);
      await fs.writeFile(configPath, JSON.stringify(config));
      const installation = {
        id: `fixture-${id}`,
        version: runtimeVersion,
        sourceSha256: hash(source),
        model: config.registration.model,
      };
      const writer = await openRunJournal({ workspace, installation });
      owned.push(writer);
      const driver = await createDriverSession({
        page,
        context,
        enginePath,
        adapter: createNotebookAdapter(page),
        runJournal: {
          startRun: (input) => writer.begin(input),
          beforeEffect: (input) => writer.beforeEffect(input),
        },
      });
      owned.push(driver);
      driver.setSpeed("fast");
      const initial = await driver.snapshot(),
        result = await driver.runRecipe("save_example", initial.revision);
      assert.equal(result.execution, "completed");
      assert.equal(result.effect.status, "saved");
      await writer.finish({
        runId: result.runId,
        report: driver.report({ runId: result.runId }),
      });
      await driver.close();
      await writer.close();
      const journalPath = join(workspace.journalRoot, `${result.runId}.jsonl`),
        journal = await fs.readFile(journalPath);
      const screenshot = await page.screenshot({ fullPage: true });
      const target = {
        id,
        label: "Notebook",
        environment,
        origin: app.url,
        authProfileRef: `owned-context-${id}`,
        projectId: id,
        store: config.store,
        sourceRoot,
        configPath,
        configSha256: hash(await fs.readFile(configPath)),
        sourceSha256: installation.sourceSha256,
        model: installation.model,
      };
      fixtures.set(id, {
        target,
        context,
        page,
        screenshot,
        runId: result.runId,
        journalPath,
        journal,
        get writes() {
          return writes;
        },
      });
    }
    assert.equal(app.writes, 2);
    catalog = await openCatalog({ root: workspaceRoot, create: true });
    for (const f of fixtures.values()) {
      await catalog.registerTarget(f.target);
      await catalog.indexTarget(f.target.id);
    }
    async function start() {
      evidence = await createEvidenceStore({ root: workspaceRoot, catalog });
      server = await createUniversalServer({
        catalog,
        evidence,
        launch: async () => {
          launches++;
          throw Error("Reviewing evidence must not launch an application");
        },
      });
    }
    await start();
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1080 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const a = fixtures.get("target-a"),
      b = fixtures.get("target-b");
    await page.goto(server.url);
    await waitTarget(page, "target-a");
    await page.getByRole("button", { name: a.runId, exact: true }).click();
    await page
      .getByRole("button", { name: "Review evidence & findings", exact: true })
      .click();
    await page.locator("#record-title").fill("Save result inspected");
    await page
      .locator("#evidence-label")
      .fill("Observed saved notebook result");
    await page.locator("#evidence-file").setInputFiles({
      name: "observed-result.png",
      mimeType: "image/png",
      buffer: a.screenshot,
    });
    await page.locator("#save-evidence").click();
    const file = page
      .locator(".evidence-item")
      .filter({ hasText: "Observed saved notebook result" });
    await eventually(
      async () => (await file.count()) === 1,
      "Uploading evidence must create a visible, verified file for the selected run",
    );
    assert.match(await file.innerText(), /Verified file/);
    const evidenceId = await file.getAttribute("data-evidence-id");
    await file.getByRole("button", { name: "Preview", exact: true }).click();
    await page.waitForFunction(() => {
      const image = document.querySelector("#evidence-preview img");
      return image?.complete && image.naturalWidth > 0;
    });
    const downloadPromise = page.waitForEvent("download");
    await file.getByRole("button", { name: "Download", exact: true }).click();
    const download = await downloadPromise;
    assert.equal(
      hash(await fs.readFile(await download.path())),
      hash(a.screenshot),
    );
    await file.locator("input[type=checkbox]").check();
    await page
      .locator("#record-body")
      .fill(
        "The observed run saved exactly one note in this target's authenticated context.",
      );
    await page.locator("#save-record").click();
    let finding = await waitRecord(page, "Save result inspected", "proposed");
    assert.match(
      await page.locator("#knowledge-summary").innerText(),
      /No accepted knowledge/,
    );
    await finding.getByRole("button", { name: "Accept", exact: true }).click();
    finding = await waitRecord(page, "Save result inspected", "accepted");
    assert.match(
      await page.locator("#knowledge-summary").innerText(),
      /No accepted knowledge/,
      "Accepted findings are not automatically target knowledge",
    );
    await finding
      .getByRole("button", { name: "Use as knowledge", exact: true })
      .click();
    await eventually(
      async () =>
        (await page.locator("#record-kind").inputValue()) === "knowledge",
      "The manual knowledge proposal must use the finding's actual sources",
    );
    await page.locator("#record-title").fill("Save verification guidance");
    await page
      .locator("#record-body")
      .fill(
        "Confirm persistence in the current authenticated context after saving a note.",
      );
    await page.locator("#save-record").click();
    let knowledge = await waitRecord(
      page,
      "Save verification guidance",
      "proposed",
    );
    const knowledgeId = await knowledge.getAttribute("data-record-id");
    await knowledge
      .getByRole("button", { name: "Accept", exact: true })
      .click();
    knowledge = await waitRecord(
      page,
      "Save verification guidance",
      "accepted",
    );
    await eventually(
      async () =>
        (await page.locator("#knowledge-summary").innerText()).includes(
          "Save verification guidance",
        ),
      "Explicitly accepted knowledge appears in target summary",
    );
    await knowledge
      .getByRole("button", { name: "Revise", exact: true })
      .click();
    await eventually(
      async () =>
        (await page.locator("#save-record").textContent()) ===
        "Propose revision",
      "Revision composer must retain the source note identity",
    );
    await page
      .locator("#record-body")
      .fill(
        "Confirm one matching persisted note in the current authenticated context after saving.",
      );
    await page.locator("#save-record").click();
    knowledge = await waitRecord(
      page,
      "Save verification guidance",
      "proposed",
      2,
    );
    await knowledge
      .getByRole("button", { name: "Accept", exact: true })
      .click();
    knowledge = await waitRecord(
      page,
      "Save verification guidance",
      "accepted",
      2,
    );
    await knowledge.locator("summary").click();
    await knowledge
      .locator('.revision-item[data-revision="1"][data-state="superseded"]')
      .waitFor();
    await knowledge
      .getByRole("button", { name: "Inspect revision 1", exact: true })
      .click();
    await eventually(
      async () =>
        (
          await knowledge
            .locator('.revision-item[data-revision="1"]')
            .innerText()
        ).includes("Confirm persistence"),
      "Inspecting an earlier revision must retrieve its original body and review history",
    );
    assert.match(
      await knowledge.locator('.revision-item[data-revision="1"]').innerText(),
      /proposed.*accepted.*superseded/is,
    );
    await page.locator("#record-kind").selectOption("knowledge");
    await page.locator("#record-title").fill("Unestablished shortcut");
    await page
      .locator("#record-body")
      .fill("This proposal is retained for review and deliberately rejected.");
    await page.locator("#save-record").click();
    let rejected = await waitRecord(page, "Unestablished shortcut", "proposed");
    await rejected.getByRole("button", { name: "Reject", exact: true }).click();
    await waitRecord(page, "Unestablished shortcut", "rejected");
    assert.doesNotMatch(
      await page.locator("#knowledge-summary").innerText(),
      /Unestablished shortcut/,
    );
    const record = (
      await (
        await request(server, `/api/targets/target-a/records/${knowledgeId}`)
      ).json()
    ).record;
    assert.ok(
      record.refs.some(
        (ref) => ref.runId === a.runId && ref.evidenceId === evidenceId,
      ),
    );
    assert.equal(record.integration.revision, 1);
    assert.ok(
      record.revisions.some((revision) => revision.state === "superseded"),
    );
    const sourceRefs = [
      { runId: a.runId, eventSequence: 1, evidenceId: null },
      { runId: a.runId, eventSequence: 2, evidenceId: null },
    ];
    const multiSource = await request(server, "/api/targets/target-a/records", {
      revision: 1,
      kind: "finding",
      title: "Two retained sources",
      body: "Both source events remain part of this reviewed note.",
      refs: sourceRefs,
    });
    assert.equal(multiSource.status, 200);
    const multiSourceId = (await multiSource.json()).record.id;
    await reloadKnowledge(page);
    const multiCard = await waitRecord(
      page,
      "Two retained sources",
      "proposed",
    );
    await multiCard
      .getByRole("button", { name: "Revise", exact: true })
      .click();
    await eventually(
      async () =>
        (await page.locator("#save-record").textContent()) ===
        "Propose revision",
      "A saved note opens as a revision",
    );
    await page
      .locator("#record-body")
      .fill("Both source events still belong to this revised note.");
    await page.locator("#save-record").click();
    await waitRecord(page, "Two retained sources", "proposed", 2);
    const multiRevised = (
      await (
        await request(server, `/api/targets/target-a/records/${multiSourceId}`)
      ).json()
    ).record;
    assert.deepEqual(
      multiRevised.refs.map(({ runId, eventSequence, evidenceId }) => ({
        runId,
        eventSequence,
        evidenceId,
      })),
      sourceRefs,
      "Revising through the browser must preserve source references not represented by the primary run selector",
    );
    const stale = await request(
      server,
      `/api/targets/target-a/records/${knowledgeId}/review`,
      { revision: 1, expectedRevision: 1, decision: "accepted" },
    );
    assert.equal(
      stale.status,
      409,
      "A stale review cannot overwrite a later revision",
    );
    for (const [path, body] of [
      [`/api/targets/target-b/evidence/${evidenceId}/content`],
      [`/api/targets/target-b/records/${knowledgeId}`],
      [
        "/api/targets/target-b/records",
        {
          revision: 1,
          kind: "knowledge",
          title: "Wrong target",
          body: "A foreign run cannot be linked.",
          refs: [{ runId: a.runId, eventSequence: null, evidenceId: null }],
        },
      ],
      [
        "/api/targets/target-b/records",
        {
          revision: 1,
          kind: "finding",
          title: "Wrong evidence",
          body: "A foreign file cannot be linked.",
          refs: [{ runId: b.runId, eventSequence: null, evidenceId }],
        },
      ],
    ])
      assert.ok(
        (await request(server, path, body)).status >= 400,
        "Foreign references must be rejected",
      );
    await page.selectOption("#target-select", "target-b");
    await waitTarget(page, "target-b");
    await eventually(
      async () =>
        (await page
          .locator("#knowledge-records")
          .getAttribute("data-target-id")) === "target-b",
      "Knowledge list follows target selection",
    );
    assert.doesNotMatch(
      await page.locator("#target-knowledge").innerText(),
      /Save verification guidance|Observed saved notebook result|Save result inspected/,
    );
    assert.equal(
      await page.locator("#save-record").isDisabled(),
      true,
      "Target changes discard the previous target's selected run",
    );
    await server.close();
    server = null;
    await evidence.close();
    evidence = null;
    await catalog.close();
    catalog = null;
    catalog = await openCatalog({ root: workspaceRoot });
    await start();
    await page.goto(server.url);
    await waitTarget(page, "target-a");
    await page.getByRole("button", { name: a.runId, exact: true }).click();
    await page
      .getByRole("button", { name: "Review evidence & findings", exact: true })
      .click();
    await waitRecord(page, "Save verification guidance", "accepted", 2);
    await eventually(
      async () =>
        (await page.locator("#knowledge-summary").innerText()).includes(
          "Save verification guidance",
        ),
      "Accepted knowledge must survive server and catalog restart",
    );
    await page
      .locator(".evidence-item")
      .getByRole("button", { name: "Preview", exact: true })
      .click();
    await page.waitForFunction(
      () => document.querySelector("#evidence-preview img")?.naturalWidth > 0,
    );
    await page.screenshot({
      path: join(output, "knowledge-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: join(output, "knowledge-narrow.png"),
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      "Review controls remain within a narrow viewport",
    );
    // Tampering with owned fixture bytes must be visible; no source file is removed.
    const blobPath = join(
      workspaceRoot,
      "evidence",
      "target-a",
      `${evidenceId}.bin`,
    );
    await fs.writeFile(blobPath, Buffer.from("changed owned fixture evidence"));
    await reloadKnowledge(page);
    await eventually(
      async () =>
        (await page.locator("#evidence-list").innerText()).includes(
          "File changed or corrupt",
        ),
      "Evidence integrity failures must be explicit",
    );
    assert.doesNotMatch(
      await page.locator("#knowledge-summary").innerText(),
      /Save verification guidance/,
      "Corrupt evidence excludes knowledge from the accepted summary",
    );
    assert.equal(
      await page
        .locator(".evidence-item")
        .getByRole("button", { name: "Preview", exact: true })
        .isDisabled(),
      true,
    );
    await fs.writeFile(blobPath, a.screenshot);
    await reloadKnowledge(page);
    await eventually(
      async () =>
        (await page.locator("#knowledge-summary").innerText()).includes(
          "Save verification guidance",
        ),
      "Restored exact evidence becomes verifiable again",
    );
    const retainedBlobPath = join(root, "retained-evidence.bin");
    await fs.rename(blobPath, retainedBlobPath);
    await reloadKnowledge(page);
    await eventually(
      async () =>
        (await page.locator("#evidence-list").innerText()).includes(
          "File missing",
        ),
      "Missing evidence must be visible without removing its catalog history",
    );
    assert.doesNotMatch(
      await page.locator("#knowledge-summary").innerText(),
      /Save verification guidance/,
      "Missing evidence excludes knowledge from the accepted summary",
    );
    await waitRecord(page, "Save verification guidance", "accepted", 2);
    assert.equal(
      await page
        .locator(".evidence-item")
        .getByRole("button", { name: "Download", exact: true })
        .isDisabled(),
      true,
    );
    await fs.rename(retainedBlobPath, blobPath);
    await reloadKnowledge(page);
    await eventually(
      async () =>
        (await page.locator("#knowledge-summary").innerText()).includes(
          "Save verification guidance",
        ),
      "Restoring the exact retained evidence keeps its accepted source history",
    );
    await catalog.reviseTarget(
      { ...a.target, model: { id: "notebook", version: "2" } },
      { expectedRevision: 1 },
    );
    await page.reload();
    await waitTarget(page, "target-a");
    await page.locator("#knowledge-tab").click();
    knowledge = await waitRecord(
      page,
      "Save verification guidance",
      "accepted",
      2,
    );
    assert.match(await knowledge.innerText(), /Needs revalidation/i);
    const retainedRejected = await waitRecord(
      page,
      "Unestablished shortcut",
      "rejected",
    );
    assert.match(
      await retainedRejected.locator(".record-state").innerText(),
      /rejected/i,
      "Revalidation notices must preserve the visible review decision",
    );
    assert.doesNotMatch(
      await page.locator("#knowledge-summary").innerText(),
      /Save verification guidance/,
    );
    assert.match(
      await page.locator("#knowledge-summary").innerText(),
      /needs revalidation/,
    );
    await page.screenshot({
      path: join(output, "knowledge-stale-narrow.png"),
      fullPage: true,
    });
    const oldTargetWrite = await request(
      server,
      "/api/targets/target-a/records",
      {
        revision: 1,
        kind: "finding",
        title: "Stale target",
        body: "Outdated target selection",
        refs: [{ runId: a.runId, eventSequence: null, evidenceId: null }],
      },
    );
    assert.equal(oldTargetWrite.status, 409);
    for (const f of fixtures.values()) {
      assert.deepEqual(
        await fs.readFile(f.journalPath),
        f.journal,
        "Review/restart must preserve original canonical history bytes",
      );
      assert.equal(
        f.writes,
        1,
        "Evidence and review do not replay target actions",
      );
      assert.equal(
        (await (await f.context.request.get(`${app.url}/api/notes`)).json())
          .items.length,
        1,
        "Same-origin auth contexts keep distinct application data",
      );
    }
    assert.equal(app.writes, 2);
    assert.equal(launches, 0);
    assert.deepEqual(errors, []);
  },
);

test(
  "Universal revision composer can select a fresh source without changing the note identity",
  { timeout: 45000 },
  async (t) => {
    const target = {
      id: "source-choice",
      label: "Synthetic source selection",
      environment: "Review",
      origin: "https://synthetic.invalid",
      model: { id: "synthetic", version: "2" },
      revision: 2,
    };
    let record = {
      id: "retained-note",
      targetId: target.id,
      kind: "knowledge",
      revision: 1,
      state: "accepted",
      title: "Retained guidance",
      body: "Earlier reviewed guidance",
      refs: [{ runId: "old-run", eventSequence: 1, evidenceId: null }],
      integration: { revision: 1, model: { id: "synthetic", version: "1" } },
      needsRevalidation: true,
      validation: { status: "stale", reasons: ["integration_changed"] },
      revisions: [],
    };
    let browser,
      server,
      writes = [],
      launches = 0;
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
          "Source-selection fixture cleanup failed",
        );
    });
    server = await createUniversalServer({
      catalog: {
        catalogVersion: 2,
        indexTarget: async () => {
          throw Error("Source selection must not index");
        },
        listTargets: async () => [target],
        getTarget: async () => target,
        listRuns: async () => ({
          targetId: target.id,
          items: ["old-run", "new-run"].map((runId) => ({
            runId,
            status: "finished",
          })),
          generation: 1,
          indexedAt: null,
          nextCursor: null,
        }),
        getRun: async ({ targetId, runId }) => ({
          targetId,
          runId,
          format: "daedlo-run-journal/1",
          workspaceId: "source-choice",
          projectId: targetId,
          status: "finished",
          historyComplete: true,
          partialTail: false,
          liveState: "unknown",
          events: [{ sequence: 1, type: "run_started" }],
        }),
        listRecords: async () => ({
          targetId: target.id,
          records: [record],
          nextCursor: null,
        }),
        getTargetSummary: async () => ({
          targetId: target.id,
          targetRevision: 2,
          items: [],
          excluded: [],
          historicalOnly: true,
        }),
        listEvidence: async () => ({
          targetId: target.id,
          items: [],
          nextCursor: null,
        }),
        reviseRecord: async (input) => {
          writes.push(input);
          record = {
            ...record,
            revision: 2,
            state: "proposed",
            title: input.title,
            body: input.body,
            refs: input.refs,
            needsRevalidation: false,
            validation: { status: "valid", reasons: [] },
          };
          return record;
        },
        createRecord: async () => {
          throw Error(
            "Selecting a source must keep the original note identity",
          );
        },
      },
      evidence: { listPending: async () => [] },
      launch: async () => {
        launches++;
        throw Error("Source selection does not launch");
      },
    });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(server.url);
    await waitTarget(page, target.id);
    await page.locator("#knowledge-tab").click();
    const card = await waitRecord(page, "Retained guidance", "accepted");
    await card
      .getByRole("button", {
        name: "Revalidate with new revision",
        exact: true,
      })
      .click();
    await eventually(
      async () =>
        (await page.locator("#save-record").textContent()) ===
        "Propose revision",
      "Revalidation opens the original note revision",
    );
    await page.locator("#record-body").fill("Freshly reviewed guidance");
    await page.locator("#choose-evidence-run").click();
    await page.getByRole("button", { name: "new-run", exact: true }).click();
    await page
      .getByRole("button", { name: "Review evidence & findings", exact: true })
      .click();
    assert.equal(
      await page.locator("#record-body").inputValue(),
      "Freshly reviewed guidance",
      "Selecting a new source must retain the drafted revision",
    );
    assert.equal(
      await page.locator("#save-record").textContent(),
      "Propose revision",
    );
    await page.locator("#save-record").click();
    await waitRecord(page, "Retained guidance", "proposed", 2);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].recordId, "retained-note");
    assert.deepEqual(writes[0].refs, [
      { runId: "new-run", eventSequence: null, evidenceId: null },
    ]);
    assert.equal(launches, 0);
  },
);
