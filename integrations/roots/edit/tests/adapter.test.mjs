import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMAND_IDS } from '../adapter.mjs';

test('the extracted consumer supplies existing-entry edit and persistence handlers', () => {
  for (const id of ['edit_open', 'edit_fill', 'edit_save', 'edit_cancel', 'edit_retry_save', 'checkpoint', 'assert', 'restart_api', 'reload', 'fault_on', 'fault_off'])
    assert.ok(COMMAND_IDS.includes(id), `Missing extracted handler: ${id}`);
});

import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import { createRootsEditAdapter } from '../adapter.mjs';
const snapshotRoot = resolve(process.env.ROOTS_EDIT_SNAPSHOT || 'artifacts/roots-edit-20261004/capture/snapshot');
function mockPage() {
  const page = new EventEmitter();
  page.url = () => 'http://127.0.0.1:12345';
  return page;
}

test('customer fixture and evidence handlers reject direct use without a canonical recipe before effects', async () => {
  const page = mockPage();
  const adapter = await createRootsEditAdapter({ page, context: {}, snapshotRoot, disposable: true, fixtureReady: true });
  let effects = 0;
  const guarded = { effect: async () => { effects++; }, click: async () => { effects++; } };
  for (const [id, params] of [['fault_on', { mode: 'edit_lost_response' }], ['fault_off', {}], ['restart_api', {}], ['checkpoint', { name: 'edit_before' }], ['assert', { name: 'edit_saved' }]]) {
    await adapter.beginRun({ command: id, recipe: false });
    await assert.rejects(adapter.handlers[id](params, guarded), /active canonical edit recipe/);
  }
  assert.equal(effects, 0);
  await adapter.close();
});
test('an unready fixture cannot perform an owned recipe fault', async () => {
  const adapter = await createRootsEditAdapter({ page: mockPage(), context: {}, snapshotRoot, disposable: true, fixtureReady: false });
  await adapter.beginRun({ command: 'edit-lost-response-retry', recipe: true });
  let effects = 0;
  await assert.rejects(adapter.handlers.fault_on({ mode: 'edit_lost_response' }, { effect: async () => { effects++; } }), /Verified disposable fixture/);
  assert.equal(effects, 0);
  await adapter.close();
});
test('a recipe reports the target edit separately before any write', async () => {
  const adapter = await createRootsEditAdapter({ page: mockPage(), context: {}, snapshotRoot, disposable: true, fixtureReady: true });
  await adapter.beginRun({ command: 'edit-cancel-retained', recipe: true });
  assert.deepEqual(await adapter.effectStatus(), { status: 'not_attempted', operations: [{ id: 'requested-edit', label: 'Requested edit', status: 'not_attempted' }] });
  await adapter.close();
});

test('end of an interrupted run removes owned route faults and leaves unrelated routes attached', async () => {
  const page = mockPage(), owned = new Set(), unrelated = () => {};
  owned.add(unrelated);
  page.route = async (_pattern, handler) => { owned.add(handler); };
  page.unroute = async (_pattern, handler) => { owned.delete(handler); };
  const adapter = await createRootsEditAdapter({ page, context: {}, snapshotRoot, disposable: true, fixtureReady: true });
  await adapter.beginRun({ command: 'edit-lost-response-retry', recipe: true });
  await adapter.handlers.fault_on({ mode: 'edit_lost_response' }, { effect: async (fn) => fn() });
  assert.equal(owned.size, 2);
  if (adapter.endRun) await adapter.endRun({ execution: 'stopped' });
  assert.equal(owned.size, 1, 'Stopped run must remove its owned fault');
  assert.ok(owned.has(unrelated));
  await adapter.close();
});

test('failed cleanup retains its handle and the next run retries exactly that owned route', async () => {
  const page = mockPage();
  let installed = null, fail = true, removals = 0;
  page.route = async (_pattern, handler) => { installed = handler; };
  page.unroute = async (_pattern, handler) => {
    assert.equal(handler, installed);
    removals++;
    if (fail) throw Error('Synthetic cleanup failure');
    installed = null;
  };
  const adapter = await createRootsEditAdapter({ page, context: {}, snapshotRoot, disposable: true, fixtureReady: true });
  await adapter.beginRun({ command: 'edit-lost-response-retry', recipe: true });
  await adapter.handlers.fault_on({ mode: 'edit_lost_response' }, { effect: async (fn) => fn() });
  await assert.rejects(adapter.endRun(), /handles retained/);
  assert.equal(adapter.acceptance.summary().ownedFaults, 1);
  fail = false;
  await adapter.beginRun({ command: 'journal', recipe: false });
  assert.equal(adapter.acceptance.summary().ownedFaults, 0);
  assert.equal(removals, 2);
  await adapter.close();
});
