import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createFeatureFixture } from './feature-fixture.mjs';
import { preflightFeatureCandidate } from './feature-preflight.mjs';

const [snapshotArg, binariesArg, candidateArg, outputArg] = process.argv.slice(2);
if (!outputArg) throw Error('Usage: node feature-acceptance.mjs SNAPSHOT APP_BINARIES STAGED_CANDIDATE FRESH_RUN_OUTPUT');
const snapshotRoot = resolve(snapshotArg), candidate = resolve(candidateArg), output = resolve(outputArg);
const identity = preflightFeatureCandidate({ snapshotRoot, binaryDir: resolve(binariesArg), candidate });
if (fs.existsSync(output)) throw Error('Run output already exists; finished checkpoints are immutable');
fs.mkdirSync(output, { recursive: true }); fs.mkdirSync(join(output, 'screenshots')); fs.mkdirSync(join(output, 'runs'));
const { attachRootsEdit } = await import(pathToFileURL(join(candidate, 'edit/consumer.mjs')));
const enginePath = join(candidate, 'engine-target/debug/roots-edit-browser-driver-consumer');
const containers = () => execFileSync('docker', ['ps', '--format', '{{.ID}}'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).sort();
let beforeContainers = null;
const scenarioIds = ['fixture-readiness', 'missing-prerequisite-rejects-before-effect', 'edit-save', 'edit-cancel-retained', 'edit-lost-response-retry', 'edit-persisted', 'stop-uncertain-edit-cleans-fault-and-allows-explicit-retry', 'completed-report-and-viewer-reconnect'];
const results = [], diagnostics = [];
let f, consumer, ui, fatal;
const write = (path, value) => fs.writeFileSync(join(output, path), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
async function test(id, fn) {
  const started = performance.now();
  try { const evidence = await fn(); results.push({ id, status: 'PASS', elapsedMs: Math.round(performance.now() - started), ...evidence }); console.log('PASS ' + id); }
  catch (error) { results.push({ id, status: 'FAIL', elapsedMs: Math.round(performance.now() - started), error: f?.redact(error.message) ?? error.message }); throw error; }
}
const began = performance.now();
try {
  beforeContainers = containers();
  f = await createFeatureFixture({ snapshotRoot, binaryDir: resolve(binariesArg), output: join(output, 'fixture') });
  await test('fixture-readiness', async () => {
    const catalogues = [];
    for (const account of [f.accounts.alpha, f.accounts.beta]) {
      const context = await f.browser.newContext();
      try {
        const signed = await context.request.post(f.origin + '/api/auth/login', { data: account, headers: { 'X-Roots-CSRF': '1', Origin: f.origin } });
        assert.equal(signed.status(), 200, 'Synthetic account must authenticate');
        const response = await context.request.get(f.origin + '/api/strains?limit=100');
        assert.equal(response.status(), 200);
        const body = await response.json(); assert.ok(Array.isArray(body.items));
        catalogues.push(new Set(body.items.map(x => x.id)));
      } finally { await context.close(); }
    }
    assert.ok([...catalogues[0]].some(id => catalogues[1].has(id)), 'Seeded shared choice must be visible to both synthetic accounts');
    return { sharedChoiceVisibleToBothAccounts: true, disposable: true };
  });
  const context = await f.browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', error => diagnostics.push(f.redact(error.message)));
  await page.goto(f.origin);
  await page.getByRole('button', { name: 'Refresh connections', exact: true }).waitFor();
  const attach = (ready, restartApi = f.restartApi) => attachRootsEdit({ page, context, snapshotRoot, enginePath, account: f.accounts.alpha,
    identity: { application: identity.source.sourceDigest, candidate: identity.runtimeArtifactSha256 }, fixtureReady: ready, disposable: true, restartApi });
  consumer = await attach(true);
  let { session, adapter } = consumer;
  session.setSpeed('fast');
  const observe = async () => { await adapter.settle(); const s = await session.snapshot(); assert.equal(s.connected, true, 'Customer observation must decode'); return s; };
  const command = async id => {
    const result = await session.execute(id, {}, (await observe()).revision);
    assert.equal(result.execution, 'completed', `${id}: ${JSON.stringify(result)}`);
    assert.equal(result.outcome.kind, 'success', `${id}: ${JSON.stringify(result)}`);
    return result;
  };
  await command('profile'); await command('signin'); await command('journal');
  await test('missing-prerequisite-rejects-before-effect', async () => {
    await consumer.close(); consumer = await attach(false); ({ session, adapter } = consumer);
    const state = await observe(); assert.equal(state.recipes.length, 4);
    assert.ok(state.recipes.every(x => !x.enabled && x.reason));
    const writes = adapter.acceptance.requests.saveSequence;
    const result = await session.runRecipe('edit-save', state.revision);
    assert.equal(result.execution, 'rejected'); assert.equal(result.effect.status, 'not_attempted');
    assert.equal(adapter.acceptance.requests.saveSequence, writes);
    await consumer.close(); consumer = await attach(true, null); ({ session, adapter } = consumer);
    const absentRestart = await observe();
    assert.equal(absentRestart.recipes.find(x => x.id === 'edit-persisted').enabled, false);
    const blockedRestart = await session.runRecipe('edit-persisted', absentRestart.revision);
    assert.equal(blockedRestart.execution, 'rejected'); assert.equal(blockedRestart.effect.status, 'not_attempted');
    await consumer.close(); consumer = await attach(true); ({ session, adapter } = consumer); session.setSpeed('fast');
    return { requestsAdded: 0, recipesDisabled: 4 };
  });
  const monitorContext = await f.browser.newContext({ viewport: { width: 1600, height: 1100 } });
  ui = await monitorContext.newPage();
  await ui.goto(consumer.monitor.url);
  write('viewer.json', { url: consumer.monitor.url, mode: 'headless Chromium streamed to visible viewer', source: identity.source.sourceDigest });
  console.log('VIEWER ' + consumer.monitor.url);
  // Small optional hold lets the operator open the same viewer, not another app session.
  if (process.env.DRIVER_VIEWER_HOLD_MS) await new Promise(resolve => setTimeout(resolve, Math.min(30000, Number(process.env.DRIVER_VIEWER_HOLD_MS))));
  let firstRun, firstReport;
  const expected = {
    'edit-save': ['saved_once', 'edit_saved'],
    'edit-cancel-retained': ['saved_once', 'edit_draft_retained', 'edit_cancelled'],
    'edit-lost-response-retry': ['saved_once', 'edit_uncertain', 'edit_saved'],
    'edit-persisted': ['saved_once', 'edit_saved', 'edit_reloaded', 'edit_persisted'],
  };
  for (const [id, assertions] of Object.entries(expected)) await test(id, async () => {
    const before = await adapter.acceptance.reads.entries();
    const previousRun = (await session.snapshot()).runId;
    await ui.locator(`[data-recipe="${id}"]`).click();
    const until = Date.now() + 90000;
    let state;
    while (Date.now() < until) {
      state = await session.snapshot();
      if (state.runId !== previousRun && !state.busy && state.lastResult) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(state.runId !== previousRun && !state.busy, 'Recipe must complete within its bounded acceptance window');
    const result = state.lastResult;
    assert.equal(result.execution, 'completed', JSON.stringify(result));
    assert.equal(result.outcome.kind, 'success', JSON.stringify(result));
    assert.deepEqual(adapter.acceptance.summary().assertions, assertions);
    const after = await adapter.acceptance.reads.entries(), old = new Map(before.map(x => [x.id, x]));
    for (const row of before) assert.deepEqual(after.find(x => x.id === row.id), row, 'Existing entry must remain unchanged');
    const created = after.filter(x => !old.has(x.id));
    assert.equal(created.length, 1, 'Exactly one recipe setup entry');
    assert.equal(created[0].version, id === 'edit-cancel-retained' ? 0 : 1, 'Exactly one edit or no edit after cancellation');
    assert.equal(after.length, before.length + 1);
    const setup = result.effect.operations.find(x => x.label === 'Setup entry'), edit = result.effect.operations.find(x => x.label === 'Requested edit');
    assert.equal(setup?.status, 'saved');
    assert.equal(edit?.status, id === 'edit-cancel-retained' ? 'not_attempted' : 'saved');
    assert.equal(adapter.acceptance.summary().ownedFaults, 0);
    if (id === 'edit-lost-response-retry') assert.equal(adapter.acceptance.summary().upstreamStatus, 200);
    if (id === 'edit-persisted') assert.ok(f.lifecycle.some(x => x.action === 'api-restart' && x.oldPid !== x.newPid));
    await ui.locator('#effect-operations li').first().waitFor();
    assert.match(await ui.locator('#effect-operations').innerText(), /Setup entry/);
    assert.match(await ui.locator('#effect-operations').innerText(), /Requested edit/);
    await ui.screenshot({ path: join(output, `screenshots/${id}-viewer.png`), fullPage: true });
    await page.screenshot({ path: join(output, `screenshots/${id}-app.png`), fullPage: true });
    const report = session.report({ runId: result.runId }); assert.ok(report);
    write(`runs/${id}.json`, report);
    if (!firstRun) { firstRun = result.runId; firstReport = JSON.stringify(report); }
    return { runId: result.runId, assertions, unchangedPriorEntries: true, addedEntries: 1, finalVersion: created[0].version,
      effect: result.effect, screenshot: `screenshots/${id}-viewer.png` };
  });
  await test('stop-uncertain-edit-cleans-fault-and-allows-explicit-retry', async () => {
    const handler = adapter.handlers.edit_save;
    adapter.handlers.edit_save = async (params, execution) => {
      await handler(params, execution);
      await adapter.settle();
      session.stop();
    };
    let result;
    try { result = await session.runRecipe('edit-lost-response-retry', (await observe()).revision); }
    finally { adapter.handlers.edit_save = handler; }
    assert.equal(result.execution, 'stopped', JSON.stringify(result));
    assert.equal(result.effect.status, 'uncertain');
    assert.equal(result.effect.operations.find(x => x.label === 'Setup entry')?.status, 'saved');
    assert.equal(result.effect.operations.find(x => x.label === 'Requested edit')?.status, 'uncertain');
    assert.equal(adapter.acceptance.summary().ownedFaults, 0, 'Stopped recipe cleans its injected fault');
    assert.ok(!result.cleanupFailed);
    write('runs/stopped-edit.json', session.report({ runId: result.runId }));
    const savedBeforeRetry = await adapter.acceptance.reads.entries();
    const recovered = await command('edit_retry_save');
    assert.equal(recovered.effect.status, 'saved');
    assert.deepEqual(await adapter.acceptance.reads.entries(), savedBeforeRetry, 'Exact retry cannot add a second update');
    return { stoppedEffect: result.effect, ownedFaults: 0, explicitRetrySavedOnce: true };
  });
  await test('completed-report-and-viewer-reconnect', async () => {
    assert.equal(JSON.stringify(session.report({ runId: firstRun })), firstReport, 'Later recipes cannot alter first report');
    const sequence = adapter.acceptance.requests.saveSequence;
    await ui.reload(); await ui.locator('[data-recipe="edit-save"]').waitFor();
    assert.equal(adapter.acceptance.requests.saveSequence, sequence, 'Viewer client reload cannot replay writes');
    assert.equal(JSON.stringify(session.report({ runId: firstRun })), firstReport);
    return { earlierReportUnchanged: true, requestsAdded: 0 };
  });
  assert.deepEqual(diagnostics, []);
} catch (error) {
  fatal = f?.redact(error.stack || error.message) ?? String(error);
  console.error(fatal);
  process.exitCode = 1;
} finally {
  try { await consumer?.close(); } catch (error) { fatal ??= f?.redact(error.message) ?? error.message; process.exitCode = 1; }
  try { await f?.close(); } catch (error) { fatal ??= f?.redact(error.message) ?? error.message; process.exitCode = 1; }
  let preserved = null;
  if (beforeContainers !== null) {
    try {
      const afterContainers = containers();
      preserved = beforeContainers.every(id => afterContainers.includes(id));
      if (!preserved) { fatal ??= 'A pre-existing running container is no longer running'; process.exitCode = 1; }
    } catch { fatal ??= 'Container preservation check unavailable'; process.exitCode = 1; }
  }
  write('results.json', { schemaVersion: 1, capturedAt: new Date().toISOString(), testLevel: 'packaged public runtime and shared crate, real Chromium/API/disposable PostgreSQL',
    identity, elapsedMs: Math.round(performance.now() - began), results, notRun: scenarioIds.filter(id => !results.some(result => result.id === id)),
    setupStatus: f ? 'PASS' : 'FAIL', diagnostics, preExistingContainersPreserved: preserved, fatal: fatal ?? null });
}
