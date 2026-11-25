import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { join } from "node:path";

const readJson = async (path) => JSON.parse(await fs.readFile(path));
const writeJson = (path, value) =>
  fs.writeFile(path, JSON.stringify(value) + "\n", { mode: 0o600 });

async function revert(page, url) {
  await page.goto(url);
  await page.locator("#acknowledge").check();
  const result = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/action" &&
      response.request().method() === "POST",
  );
  await page.locator("#revert").click();
  const response = await result;
  return { http: response.status(), body: await response.json() };
}

export async function verifyFixtureRollback({
  root,
  config,
  configPath,
  request,
  currentCases,
  freshAcceptance,
  cli,
  restart,
  stop,
  page,
  checks,
}) {
  // Only these two registered modules change. Both slots use the same paths.
  const { sourceRoot, hooks, launcher } = config.registration;
  for (const [name, file] of [
    ["prepare", hooks.preflight],
    ["launch", launcher],
  ]) {
    await fs.copyFile(
      new URL(
        `./fixtures/native-fixture-rollback-v2/${name}.mjs`,
        import.meta.url,
      ),
      join(sourceRoot, file),
    );
  }
  const { store, fixturePreflight } = config;
  const counts = () =>
    Object.fromEntries(
      Object.entries(currentCases).map(([phase, fixture]) => [
        phase,
        fixture.count(),
      ]),
    );
  const archiveDirectory = join(store, "supervisor/run-reports");
  async function archiveContents() {
    const entries = await fs.readdir(archiveDirectory);
    return Promise.all(
      entries
        .sort()
        .map(async (entry) => [
          entry,
          await fs.readFile(join(archiveDirectory, entry), "utf8"),
        ]),
    );
  }
  const archives = await archiveContents();
  assert.equal(archives.length, 2);
  config.frontend.targetOrigin = request.live.origin;
  config.settings.origin = request.live.origin;
  async function prepareSlot(name, cases) {
    config.fixturePreflight = {
      input: fixturePreflight.input,
      directory: join(root, name),
      generation: randomUUID(),
    };
    await writeJson(configPath, config);
    await writeJson(fixturePreflight.input, cases);
    await cli.ok("preflight", "prepared");
    const slot = await cli.ok("refresh", "ready");
    const session = await restart();
    assert.equal(session.status, "running");
    assert.equal(session.running.id, slot.operation.id);
    return session;
  }
  const first = await prepareSlot("revised-contract", request);
  const markerPath = join(store, "supervisor/child.json");
  const marker = await fs.readFile(markerPath, "utf8");
  const before = counts();
  const refusal = await revert(page, first.updateUrl);
  const after = counts();
  const observed = {
    check:
      "Revert refuses a historical selector with a different phase schema at the same path",
    http: refusal.http,
    diagnostic: refusal.body.requestError?.code,
    sameChild: (await fs.readFile(markerPath, "utf8")) === marker,
    sameSlot: refusal.body.status.selected?.id === first.selected.id,
    sameArchives:
      JSON.stringify(await archiveContents()) === JSON.stringify(archives),
    before,
    after,
  };
  checks.push(observed);
  assert.equal(
    observed.diagnostic,
    "fixture_preflight",
    "Revert must refuse the incompatible prepared fixture before stopping the current viewer",
  );
  assert.equal(observed.http, 409);
  assert.equal(observed.sameChild, true);
  assert.equal(observed.sameSlot, true);
  assert.equal(observed.sameArchives, true);
  assert.deepEqual(after, before);
  const retained = await cli.ok("status", "running");
  assert.equal(retained.running.id, first.running.id);
  assert.equal(retained.viewerUrl, first.viewerUrl);
  await page.goto(first.viewerUrl);
  await page.locator('[data-state="editor.ready"].active').waitFor();
  await stop();

  // Create a second slot with the identical authored contract, using a fresh
  // disposable acceptance case. The live fixture remains eligible for Revert.
  const next = structuredClone(request);
  Object.assign(next.acceptance, {
    caseId: freshAcceptance.caseId,
    origin: freshAcceptance.origin,
    expectedRevision: freshAcceptance.revision,
  });
  const second = await prepareSlot("compatible-contract", next);
  assert.notEqual(second.running.id, first.running.id);
  const slotReceipt = (id) =>
    readJson(join(store, "installations", id, "installation.json"));
  const v2 = await slotReceipt(first.running.id);
  assert.equal(
    (await slotReceipt(second.running.id)).sourceSha256,
    v2.sourceSha256,
  );
  const restored = await revert(page, second.updateUrl);
  assert.equal(restored.http, 200);
  const running = await cli.ok("status", "running");
  assert.equal(running.selected.id, first.running.id);
  assert.equal(running.running.id, first.running.id);
  await page.goto(running.viewerUrl);
  await page.locator('[data-state="editor.ready"].active').waitFor();
  assert.equal(currentCases.live.count().posts, 0);
  assert.equal(currentCases.live.count().commits, 0);
  assert.deepEqual(await archiveContents(), archives);
  await stop();
  checks.push({
    check:
      "Revert restores the first of two distinct slots with an identical authored contract",
    http: restored.http,
    historicalSlotRunning: true,
    live: currentCases.live.count(),
    freshAcceptance: freshAcceptance.count(),
    retainedReports: archives.length,
  });
}
