import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const output = resolve(process.env.ROOTS_CONSUMER_ARTIFACTS || 'artifacts/roots');
const snapshotRoot = join(output, 'snapshot');
const fixture = JSON.parse(fs.readFileSync(join(output, 'fixture.json')));
const accounts = JSON.parse(fs.readFileSync(join(fixture.root, 'accounts.json')));
const { chromium } = await import(pathToFileURL(join(snapshotRoot, 'tools/live-qa/node_modules/playwright/index.mjs')));
// This is the migrated compatibility entrypoint inside the isolated customer.
const { attachRoots } = await import(pathToFileURL(join(snapshotRoot, 'QA/live-driver.mjs')));
const enginePath = join(output, 'engine-target/debug/roots-browser-driver-consumer');
const packageIdentity = JSON.parse(fs.readFileSync(join(output, 'package.json')));
const identity = { rootsSource: 'd4008e39aeaa137bb54ff48ca2d11748083a971a',
  candidate: packageIdentity, engineSha256: createHash('sha256').update(fs.readFileSync(enginePath)).digest('hex') };
const results = [];
const scenarioNames = [
  'Pinned external consumer signs in and verifies Profile API save',
  'Profile validation remains a validation outcome with no persistence',
  'Canonical customer recipe opens Journal; attachment preserves session and draft',
  'Human draft edit rejects stale save before request and preserves input',
  'Pause freezes a real guarded field action; resume and stop remain cooperative',
  'Failed Journal save and lost-success response retain recoverable outcomes; retry persists once',
  'Stop during an upstream-completed save reports saved after its response arrives',
  'Live generic viewer shows Roots hierarchy, dynamic parameters and reconnects without replay',
  'Account/session change rejects stale command without writing or clearing draft',
];
const save = () => fs.writeFileSync(join(output, 'browser-results.json'), JSON.stringify({ identity, fixture: { origin: fixture.origin, composeProject: fixture.composeProject }, results, notRun: scenarioNames.filter(name => !results.some(r => r.name === name)) }, null, 2));
async function scenario(name, fn) {
  try { await fn(); results.push({ name, status: 'PASS' }); }
  catch (e) { results.push({ name, status: 'FAIL', error: String(e.stack || e) }); save(); throw e; }
  save();
}
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
const page = await context.newPage();
let consumer, monitorPage;
try {
  await page.goto(fixture.origin);
  await page.getByRole('button', { name: 'Refresh connections', exact: true }).waitFor();
  consumer = await attachRoots({ page, context, snapshotRoot, enginePath, account: accounts.customer, identity });
  let session = consumer.session, adapter = consumer.adapter;
  session.setSpeed('fast');
  const field = (name) => page.getByLabel(name, { exact: true });
  const observe = async () => { await adapter.settle(); const s = await session.observe(); assert.equal(s.connected, true, JSON.stringify(s)); return s; };
  const command = async (id, params = {}, kind = 'success') => {
    const s = await observe(); const result = await session.execute(id, params, s.revision);
    assert.equal(result.execution, 'completed', `${id}: ${JSON.stringify(result)}`);
    assert.equal(result.outcome.kind, kind, `${id}: ${JSON.stringify(result)}`); return result;
  };
  await scenario('Pinned external consumer signs in and verifies Profile API save', async () => {
    const s = await observe(); assert.equal(s.state.id, 'home.connectivity');
    assert.equal(s.identity.runtime, `${packageIdentity.name}@${packageIdentity.version}`);
    assert.equal(s.descriptor.id, 'roots');
    assert.deepEqual(s.descriptor.commands.map(c => c.id).sort(), Object.keys(adapter.handlers).sort());
    await command('profile'); await command('signin');
    await command('profile_edit', { value: 'External Roots Customer' });
    const result = await command('profile_save'); assert.equal(result.effect.status, 'saved');
    assert.equal((await adapter.acceptance.api('/api/customers/me')).body.display_name, 'External Roots Customer');
  });
  await scenario('Profile validation remains a validation outcome with no persistence', async () => {
    await command('profile_edit', { value: '' });
    await command('profile_save', {}, 'validation');
    assert.equal((await adapter.acceptance.api('/api/customers/me')).body.display_name, 'External Roots Customer');
    await command('profile_edit', { value: 'External Roots Customer' });
    await command('profile_save');
  });
  await scenario('Canonical customer recipe opens Journal; attachment preserves session and draft', async () => {
    const before = await observe();
    const recipe = await session.runRecipe('journal-draft', before.revision);
    assert.equal(recipe.execution, 'completed', JSON.stringify(recipe));
    await command('journal_fill', { notes: 'Unsent consumer draft', rating: '4' });
    const cookies = JSON.stringify(await context.cookies()); const url = page.url();
    await consumer.close();
    consumer = await attachRoots({ page, context, snapshotRoot, enginePath, account: accounts.customer, identity });
    session = consumer.session; adapter = consumer.adapter; session.setSpeed('fast');
    assert.equal(page.url(), url); assert.equal(JSON.stringify(await context.cookies()), cookies);
    assert.equal(await field('How was it?').inputValue(), 'Unsent consumer draft');
    assert.equal((await observe()).state.id, 'journal.experience.draft');
  });
  await scenario('Human draft edit rejects stale save before request and preserves input', async () => {
    const old = await observe(); const writes = adapter.acceptance.requests.saveSequence;
    await field('How was it?').fill('Human edited draft');
    const result = await session.execute('journal_save', {}, old.revision);
    assert.equal(result.execution, 'rejected'); assert.equal(result.error_code, 'stale_observation');
    assert.equal(result.effect.status, 'not_attempted');
    assert.equal(adapter.acceptance.requests.saveSequence, writes);
    assert.equal(await field('How was it?').inputValue(), 'Human edited draft');
  });
  await scenario('Pause freezes a real guarded field action; resume and stop remain cooperative', async () => {
    const original = adapter.handlers.journal_fill;
    let entered; const reached = new Promise(r => { entered = r; });
    let release; const gate = new Promise(r => { release = r; });
    adapter.handlers.journal_fill = async (p, e) => { entered(); await gate; return original(p, e); };
    const s = await observe(); const running = session.execute('journal_fill', { notes: 'Resumed draft', rating: '3' }, s.revision);
    await reached; session.pause(); release();
    await new Promise(r => setTimeout(r, 200));
    assert.equal(await field('How was it?').inputValue(), 'Human edited draft');
    assert.equal((await session.snapshot()).paused, true);
    session.resume(); const result = await running;
    assert.equal(result.execution, 'completed', JSON.stringify(result));
    assert.equal(await field('How was it?').inputValue(), 'Resumed draft');
    adapter.handlers.journal_fill = original;
  });
  await scenario('Failed Journal save and lost-success response retain recoverable outcomes; retry persists once', async () => {
    const notes = `Consumer lost response ${Date.now()}`;
    await command('journal_fill', { notes, rating: '3' });
    const before = (await adapter.acceptance.reads.entries()).length;
    const failed = async route => route.request().method() === 'POST' ? route.abort('failed') : route.continue();
    await page.route('**/api/experiences', failed);
    await command('journal_save', {}, 'recoverable_error');
    assert.equal((await adapter.acceptance.reads.entries()).length, before);
    await page.unroute('**/api/experiences', failed);
    let upstream;
    const lost = async route => {
      if (route.request().method() !== 'POST') return route.continue();
      upstream = (await route.fetch()).status(); await route.abort('failed');
    };
    await page.route('**/api/experiences', lost);
    const uncertain = await command('journal_save', {}, 'recoverable_error');
    assert.equal(upstream, 201); assert.equal(uncertain.effect.status, 'uncertain');
    const token = adapter.acceptance.requests.operationToken;
    assert.equal((await adapter.acceptance.reads.entries()).filter(x => x.notes === notes).length, 1);
    assert.equal(await field('How was it?').inputValue(), notes);
    await page.unroute('**/api/experiences', lost);
    await command('journal_save');
    assert.equal(adapter.acceptance.requests.operationToken, token);
    assert.equal((await adapter.acceptance.reads.entries()).filter(x => x.notes === notes).length, 1);
  });
  await scenario('Stop during an upstream-completed save reports saved after its response arrives', async () => {
    await command('log_experience');
    const notes = `Consumer stopped save ${Date.now()}`;
    await command('journal_fill', { notes });
    let signal; const sent = new Promise(r => { signal = r; });
    let release; const responseGate = new Promise(r => { release = r; });
    const hold = async route => {
      if (route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch(); signal(); await responseGate; await route.fulfill({ response });
    };
    await page.route('**/api/experiences', hold);
    const s = await observe(); const running = session.execute('journal_save', {}, s.revision);
    await sent; session.stop(); release();
    const result = await running;
    assert.equal(result.execution, 'stopped', JSON.stringify(result));
    assert.equal(result.effect.status, 'saved', JSON.stringify(result));
    assert.equal((await adapter.acceptance.reads.entries()).filter(x => x.notes === notes).length, 1);
    await page.unroute('**/api/experiences', hold);
  });
  await scenario('Live generic viewer shows Roots hierarchy, dynamic parameters and reconnects without replay', async () => {
    monitorPage = await context.newPage();
    await monitorPage.goto(consumer.monitor.url);
    await monitorPage.getByText('Roots pinned consumer', { exact: false }).first().waitFor();
    const before = adapter.acceptance.requests.saveSequence;
    await monitorPage.reload(); await monitorPage.waitForTimeout(900);
    assert.equal(adapter.acceptance.requests.saveSequence, before);
    await monitorPage.screenshot({ path: join(output, 'roots-viewer.png'), fullPage: true });
    fs.writeFileSync(join(output, 'viewer.json'), JSON.stringify({ url: consumer.monitor.url, snapshot: await session.snapshot() }, null, 2));
  });
  await scenario('Account/session change rejects stale command without writing or clearing draft', async () => {
    await command('log_experience'); await command('journal_fill', { notes: 'Keep this stale session draft' });
    const s = await observe(); const before = adapter.acceptance.requests.saveSequence;
    await context.clearCookies();
    const result = await session.execute('journal_save', {}, s.revision);
    assert.equal(result.execution, 'rejected', JSON.stringify(result));
    assert.equal(result.effect.status, 'not_attempted'); assert.equal(adapter.acceptance.requests.saveSequence, before);
    assert.equal(await field('How was it?').inputValue(), 'Keep this stale session draft');
  });
} finally {
  await consumer?.close().catch(() => {});
  await browser.close();
  save();
}
console.log(JSON.stringify({ passed: results.filter(x => x.status === 'PASS').length, total: results.length }));
