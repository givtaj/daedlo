import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
const hash = async (path) =>
  createHash("sha256")
    .update(await fs.readFile(path))
    .digest("hex");

export async function runEvidenceReporting({
  runtimePath = resolve(sourceRoot, "packages/runtime/src/index.mjs"),
  starterRoot = resolve(sourceRoot, "examples/starter"),
  enginePath,
  output = resolve(
    sourceRoot,
    `artifacts/evidence-guidance/browser-${Date.now()}-${process.pid}`,
  ),
} = {}) {
  output = resolve(output);
  runtimePath = resolve(runtimePath);
  starterRoot = resolve(starterRoot);
  await fs.mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await fs.mkdir(output, { mode: 0o700 });
  if (!enginePath) {
    const { buildStarterModel } = await import(
      pathToFileURL(join(starterRoot, "build-model.mjs"))
    );
    ({ enginePath } = await buildStarterModel({
      output: join(output, "build"),
      offline: true,
    }));
  }
  const runtime = await import(pathToFileURL(runtimePath));
  const { chromium } = createRequire(pathToFileURL(runtimePath))("playwright");
  const { createStarterFixture } = await import(
    pathToFileURL(join(starterRoot, "fixture.mjs"))
  );
  const { createStarterAdapter } = await import(
    pathToFileURL(join(starterRoot, "adapter.mjs"))
  );
  const { createReportArchive } = await import(
    pathToFileURL(join(starterRoot, "report-archive.mjs"))
  );
  const checks = [],
    cleanupFailures = [];
  const result = {
    schemaVersion: 1,
    status: "FAIL",
    testLevel:
      "real Rust starter engine, real Chromium, public runtime and custom-runner capture",
    identity: {
      runtimePath,
      engineSha256: await hash(enginePath),
      starterArchiveSha256: await hash(join(starterRoot, "report-archive.mjs")),
    },
    checks,
    cleanup: { failures: cleanupFailures },
  };
  let fixture, browser, context, page, session;
  const run = async (name, check) => {
    await check();
    checks.push({ name, status: "PASS" });
    console.log("PASS " + name);
  };
  try {
    fixture = await createStarterFixture();
    browser = await chromium.launch({ headless: true });
    result.identity.browserVersion = browser.version();
    context = await browser.newContext({ serviceWorkers: "block" });
    page = await context.newPage();
    const adapter = createStarterAdapter(page);
    const originalEvidence = adapter.evidence,
      originalEffect = adapter.effectStatus,
      originalEdit = adapter.handlers.edit;
    let unavailableProof = false,
      rejectedByFixture = false,
      longEdit = false,
      beforeWrites = 0,
      proofGate = null;
    adapter.evidence = async (...args) =>
      unavailableProof
        ? { count: 0, matching: false }
        : originalEvidence(...args);
    adapter.effectStatus = async () => {
      if (proofGate) {
        proofGate.enter();
        await proofGate.wait;
      }
      if (rejectedByFixture) {
        // This synthetic route owns an explicit pre-storage rejection. A generic
        // HTTP error or empty readback is not enough to establish rejection.
        assert.equal(fixture.writes, beforeWrites);
        return {
          status: "rejected",
          operations: [
            {
              id: "note-save",
              label: "Requested note save",
              status: "rejected",
            },
          ],
        };
      }
      return originalEffect();
    };
    adapter.handlers.edit = async (params, x) => {
      if (longEdit)
        for (let i = 0; i < 105; i++)
          await x.select(
            page.getByLabel("Category", { exact: true }),
            params.category,
          );
      return originalEdit(params, x);
    };
    await page.goto(fixture.url);
    session = await runtime.createDriverSession({
      page,
      context,
      enginePath,
      adapter,
    });
    result.identity.runtime = session.report().identity;
    session.setSpeed("fast");
    const directory = join(output, "private-reports");
    const archive = createReportArchive({ directory });
    const command = async (id, params = {}, revision) =>
      archive.run(session, async () =>
        session.execute(
          id,
          params,
          revision ?? (await session.snapshot()).revision,
        ),
      );
    let firstRunId, firstBytes;
    await run(
      "real engine handshake and async persistence evidence finish before the immutable result",
      async () => {
        await command("edit", { text: "Evidence example", category: "work" });
        let enter, release;
        const entered = new Promise((resolve) => {
          enter = resolve;
        });
        proofGate = {
          enter,
          wait: new Promise((resolve) => {
            release = resolve;
          }),
        };
        let finished = false;
        const pendingSave = command("save").then((value) => {
          finished = true;
          return value;
        });
        await entered;
        assert.equal(finished, false);
        const active = await session.snapshot();
        assert.equal(active.busy, true);
        assert.equal(
          session.report({ runId: active.runId }),
          null,
          "Active runs have no completed report yet",
        );
        release();
        const saved = await pendingSave;
        proofGate = null;
        assert.equal(saved.execution, "completed");
        assert.equal(saved.outcome.kind, "success");
        assert.equal(saved.effect.status, "saved");
        assert.equal(fixture.writes, 1);
        assert.equal(archive.status().pending, false);
        firstRunId = saved.runId;
        firstBytes = await fs.readFile(
          join(directory, `${firstRunId}.json`),
          "utf8",
        );
        assert.deepEqual(
          JSON.parse(firstBytes),
          session.report({ runId: firstRunId }),
        );
      },
    );
    await run(
      "unavailable proof remains uncertain despite a persisted write; later proof cannot rewrite the run",
      async () => {
        await command("edit", {
          text: "Later independently verified",
          category: "plain",
        });
        unavailableProof = true;
        const uncertain = await command("save");
        unavailableProof = false;
        assert.equal(uncertain.execution, "completed");
        assert.equal(uncertain.outcome.kind, "unknown");
        assert.equal(uncertain.effect.status, "uncertain");
        const frozen = session.report({ runId: uncertain.runId });
        const operation = await page
          .locator("body")
          .getAttribute("data-operation");
        const independent = await context.request
          .get(
            fixture.url +
              "/api/notes?operation=" +
              encodeURIComponent(operation),
          )
          .then((response) => response.json());
        assert.equal(independent.items.length, 1);
        assert.equal(independent.items[0].text, "Later independently verified");
        const observation = await adapter.observe();
        await originalEvidence("save", observation, observation);
        assert.equal(
          originalEffect().status,
          "saved",
          "The private adapter can now have later proof",
        );
        assert.deepEqual(session.report({ runId: uncertain.runId }), frozen);
        assert.equal(
          JSON.parse(
            await fs.readFile(
              join(directory, `${uncertain.runId}.json`),
              "utf8",
            ),
          ).lastResult.effect.status,
          "uncertain",
        );
        await fs.writeFile(
          join(output, "later-verification.json"),
          JSON.stringify({
            runId: uncertain.runId,
            verifiedAt: new Date().toISOString(),
            persistence: "saved",
            originalResultUnchanged: true,
          }) + "\n",
          { flag: "wx", mode: 0o600 },
        );
      },
    );
    await run(
      "exact-operation evidence does not transfer a prior successful save to a new edit",
      async () => {
        const edited = await command("edit", {
          text: "New operation",
          category: "plain",
        });
        assert.equal(edited.effect.status, "not_attempted");
        assert.equal(fixture.writes, 2);
      },
    );
    await run(
      "an observed fixture rejection remains separate from application recovery outcome",
      async () => {
        beforeWrites = fixture.writes;
        const pattern = "**/api/notes";
        const reject = async (route) => {
          if (route.request().method() !== "POST") return route.continue();
          rejectedByFixture = true;
          await route.fulfill({
            status: 422,
            contentType: "application/json",
            body: '{"error":"Synthetic pre-storage rejection"}',
          });
        };
        await page.route(pattern, reject);
        try {
          const rejected = await command("save");
          assert.equal(rejected.effect.status, "rejected");
          assert.equal(rejected.outcome.kind, "recoverable_error");
          assert.equal(fixture.writes, beforeWrites);
        } finally {
          rejectedByFixture = false;
          await page.unroute(pattern, reject);
        }
      },
    );
    await run(
      "guard refusal has no attempted effect or business write",
      async () => {
        const before = fixture.writes;
        const revision = (await session.snapshot()).revision;
        await page.getByLabel("Note", { exact: true }).fill("Independent edit");
        const refused = await command("save", {}, revision);
        assert.equal(refused.execution, "rejected");
        assert.equal(refused.effect.status, "not_attempted");
        assert.equal(fixture.writes, before);
      },
    );
    await run(
      "lost-response retry keeps the exact original operation and one persisted effect",
      async () => {
        await command("edit", {
          text: "Exact retry evidence",
          category: "work",
        });
        const before = fixture.writes;
        const attempts = [];
        const pattern = "**/api/notes";
        const dropResponse = async (route) => {
          if (route.request().method() !== "POST") return route.continue();
          attempts.push(route.request().postDataJSON());
          await route.fetch();
          await route.abort("failed");
        };
        await page.route(pattern, dropResponse);
        let lost;
        try {
          lost = await command("save");
          assert.equal(lost.outcome.kind, "recoverable_error");
          assert.equal(lost.effect.status, "uncertain");
          assert.equal(fixture.writes, before + 1);
        } finally {
          await page.unroute(pattern, dropResponse);
        }
        const observeRetry = (request) => {
          if (
            request.method() === "POST" &&
            request.url() === fixture.url + "/api/notes"
          )
            attempts.push(request.postDataJSON());
        };
        page.on("request", observeRetry);
        try {
          const retried = await command("save");
          assert.equal(retried.effect.status, "saved");
          assert.equal(retried.outcome.kind, "success");
          assert.equal(attempts.length, 2);
          assert.deepEqual(attempts[1], attempts[0]);
          assert.equal(fixture.writes, before + 1);
          assert.equal(
            session.report({ runId: lost.runId }).lastResult.effect.status,
            "uncertain",
          );
        } finally {
          page.off("request", observeRetry);
        }
      },
    );
    await run(
      "immediate capture preserves early immutable reports after real session cache eviction",
      async () => {
        for (let i = 0; i < 18; i++)
          await command("edit", {
            text: "Retention example",
            category: "plain",
          });
        assert.equal(session.report({ runId: firstRunId }), null);
        assert.equal(
          await fs.readFile(join(directory, `${firstRunId}.json`), "utf8"),
          firstBytes,
        );
        assert.equal(
          (await fs.readdir(directory)).filter((name) => name.endsWith(".json"))
            .length,
          archive.status().saved,
        );
        assert.ok(archive.status().saved > 16);
      },
    );
    await run(
      "a long real-browser run discloses truncation even when its report is archived immediately",
      async () => {
        longEdit = true;
        const edited = await command("edit", {
          text: "Bounded history",
          category: "plain",
        });
        longEdit = false;
        const report = session.report({ runId: edited.runId });
        assert.equal(edited.execution, "completed");
        assert.equal(report.eventRange.truncated, true);
        assert.ok(report.eventRange.retainedFirst > report.eventRange.first);
        assert.ok(report.events.length <= 200);
        assert.deepEqual(
          JSON.parse(
            await fs.readFile(join(directory, `${edited.runId}.json`), "utf8"),
          ),
          report,
        );
      },
    );
    await run(
      "owned session cleanup preserves attached browser page and application",
      async () => {
        await session.close();
        session = null;
        assert.equal(page.isClosed(), false);
        assert.equal((await context.request.get(fixture.url)).ok(), true);
      },
    );
    result.status = "PASS";
  } catch (error) {
    result.error = error.message;
    throw error;
  } finally {
    for (const [name, resource] of [
      ["session", session],
      ["browser", browser],
      ["fixture", fixture],
    ]) {
      try {
        await resource?.close();
      } catch (error) {
        cleanupFailures.push({ resource: name, error: error.message });
      }
    }
    result.cleanup.ownedBrowserClosed = browser ? !browser.isConnected() : null;
    if (cleanupFailures.length) result.status = "FAIL";
    await fs.writeFile(
      join(output, "result.json"),
      JSON.stringify(result, null, 2) + "\n",
      { mode: 0o600 },
    );
    if (cleanupFailures.length)
      throw new Error("Evidence reporting acceptance cleanup is incomplete");
  }
  return result;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  await runEvidenceReporting({
    runtimePath: process.env.DAEDLO_EVIDENCE_RUNTIME,
    enginePath: process.env.DAEDLO_EVIDENCE_ENGINE,
    starterRoot: process.env.DAEDLO_EVIDENCE_STARTER,
    output: process.env.DAEDLO_EVIDENCE_OUTPUT,
  });
