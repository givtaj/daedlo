import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { summarizeWriteEffects, createWriteEffectTracker } from '../write-effects.mjs';

const saved = { operationKey: 'private-original-key', kind: 'journal_save', status: 201,
  confirmed: true, readbackConfirmed: true };

test('an earlier confirmed setup does not hide a later unresolved edit', () => {
  const report = summarizeWriteEffects([saved,
    { operationKey: 'private-edit-key', kind: 'edit_save', status: 'response_unavailable' }]);
  assert.equal(report.status, 'uncertain');
  assert.deepEqual(report.operations, [
    { id: 'operation-1', label: 'Setup entry', status: 'saved' },
    { id: 'operation-2', label: 'Requested edit', status: 'uncertain' },
  ]);
  assert.equal(JSON.stringify(report).includes('private-'), false);
});

test('a 2xx needs a verified matching receipt and independent read-back', () => {
  for (const attempt of [{ status: 201 }, { status: 200, confirmed: true },
    { status: 201, readbackConfirmed: true }])
    assert.equal(summarizeWriteEffects([attempt]).status, 'uncertain');
  assert.equal(summarizeWriteEffects([saved]).status, 'saved');
});

test('unclassified server and wire failures remain uncertain', () => {
  for (const status of [500, 503, 408, 429, 0, 'pending', 'response_unavailable'])
    assert.equal(summarizeWriteEffects([{ status }]).status, 'uncertain');
});

test('only explicit contract rejection establishes no committed write', () => {
  assert.equal(summarizeWriteEffects([{ status: 400 }]).status, 'uncertain');
  assert.equal(summarizeWriteEffects([{ status: 400, rejected: true }]).status, 'rejected');
});

test('confirmed evidence is reusable only for the same immutable operation', () => {
  assert.equal(summarizeWriteEffects([saved,
    { operationKey: saved.operationKey, kind: saved.kind, status: 'response_unavailable' }]).status, 'saved');
  assert.equal(summarizeWriteEffects([saved,
    { operationKey: 'different-payload', kind: saved.kind, status: 'response_unavailable' }]).status, 'uncertain');
  assert.equal(summarizeWriteEffects([{ ...saved, operationKey: '' },
    { kind: saved.kind, operationKey: '', status: 'response_unavailable' }]).status, 'uncertain');
});

test('no write attempts report not attempted', () => {
  assert.deepEqual(summarizeWriteEffects([]), { status: 'not_attempted', operations: [] });
});

const intent = { request_id: 'synthetic-operation', profile_id: '12',
  notes: ' saved note ', experienced_on: '2026-10-04', rating: null, strain_id: null };
const receipt = { id: '43', notes: 'saved note', experienced_on: intent.experienced_on,
  rating: null, strain: null };
function fixture(readback = { status: 200, body: { profile_id: '12', items: [receipt], next_cursor: null } }) {
  const page = new EventEmitter(), reads = [];
  const tracker = createWriteEffectTracker({ page, origin: 'http://fixture.test',
    api: async (path) => { reads.push(path); return typeof readback === 'function' ? readback(path) : readback; } });
  const request = (body = intent, method = 'POST', path = '/api/experiences') => {
    const req = { url: () => `http://fixture.test${path}`, method: () => method, postDataJSON: () => body };
    page.emit('request', req); return req;
  };
  const respond = (req, status = 201, body = receipt) =>
    page.emit('response', { request: () => req, status: () => status, json: async () => body });
  return { page, tracker, reads, request, respond };
}

test('tracker confirms the full receipt with an independent paginated owner read', async () => {
  const f = fixture((path) => ({ status: 200, body: { profile_id: '12',
    items: path.includes('cursor=next') ? [receipt] : [],
    next_cursor: path.includes('cursor=next') ? null : 'next' } }));
  f.respond(f.request());
  assert.equal((await f.tracker.effectStatus()).status, 'saved');
  assert.equal(f.reads.length, 2);
  await f.tracker.close();
  assert.equal(f.page.listenerCount('response'), 0);
});

test('tracker leaves malformed 2xx and mismatching or unavailable read-back uncertain', async () => {
  for (const body of [{ id: receipt.id }, { ...receipt, rating: 5 }]) {
    const f = fixture(); f.respond(f.request(), 201, body);
    assert.equal((await f.tracker.effectStatus()).status, 'uncertain');
    assert.equal(f.reads.length, 0);
    await f.tracker.close();
  }
  for (const fresh of [{ status: 503, body: {} },
    { status: 200, body: { profile_id: 'another-owner', items: [receipt], next_cursor: null } },
    { status: 200, body: { profile_id: '12', items: [{ ...receipt, id: 'old-row' }], next_cursor: null } }]) {
    const f = fixture(fresh); f.respond(f.request());
    assert.equal((await f.tracker.effectStatus()).status, 'uncertain');
    await f.tracker.close();
  }
});

test('tracker classifies known contract rejection, never a generic server failure', async () => {
  for (const [status, body, expected] of [[400, { code: 'invalid_input', error: 'Invalid record' }, 'rejected'],
    [400, {}, 'uncertain'], [503, { code: 'database_unavailable', error: 'Unavailable' }, 'uncertain']]) {
    const f = fixture(); f.respond(f.request(), status, body);
    assert.equal((await f.tracker.effectStatus()).status, expected);
    await f.tracker.close();
  }
});

test('tracker retains confirmed evidence across an exact retry only', async () => {
  const f = fixture(); f.respond(f.request());
  assert.equal((await f.tracker.effectStatus()).status, 'saved');
  f.tracker.beginRun(); f.page.emit('requestfailed', f.request());
  assert.equal((await f.tracker.effectStatus()).status, 'saved');
  f.tracker.beginRun(); f.page.emit('requestfailed', f.request({ ...intent, notes: 'changed note' }));
  assert.equal((await f.tracker.effectStatus()).status, 'uncertain');
  f.tracker.beginRun(); f.page.emit('requestfailed', f.request({ ...intent, unknown_field: 'changed wire intent' }));
  assert.equal((await f.tracker.effectStatus()).status, 'uncertain');
  await f.tracker.close();
});

test('tracker never lets an earlier accepted entry hide another pending operation', async () => {
  const f = fixture(); f.respond(f.request());
  assert.equal((await f.tracker.effectStatus()).status, 'saved');
  f.request({ ...intent, request_id: 'another-operation' });
  const report = await f.tracker.effectStatus();
  assert.equal(report.status, 'uncertain');
  assert.deepEqual(report.operations.map(o => o.status), ['saved', 'uncertain']);
  assert.equal(JSON.stringify(report).includes(intent.request_id), false);
  assert.equal(JSON.stringify(report).includes(intent.notes), false);
  await f.tracker.close();
});

test('profile confirmation binds owner, full receipt and one version increment', async () => {
  const body = { profile_id: '12', display_name: ' New name ', version: 2 };
  const profile = { id: '12', display_name: 'New name', version: 3, email: 'synthetic@example.test' };
  const f = fixture({ status: 200, body: profile });
  f.respond(f.request(body, 'PATCH', '/api/customers/me'), 200, profile);
  assert.equal((await f.tracker.effectStatus()).status, 'saved');
  f.tracker.beginRun();
  f.respond(f.request({ ...body, version: 3 }, 'PATCH', '/api/customers/me'), 200, profile);
  assert.equal((await f.tracker.effectStatus()).status, 'uncertain');
  await f.tracker.close();
});

test('edit confirmation binds target, owner, exact fields and one version increment', async () => {
  const body = { ...intent, version: 2 };
  const editReceipt = { ...receipt, version: 3 };
  const f = fixture((path) => ({ status: 200,
    body: path === '/api/customers/me' ? { id: '12' } : editReceipt }));
  f.respond(f.request(body, 'PATCH', '/api/experiences/43'), 200, editReceipt);
  assert.equal((await f.tracker.effectStatus()).status, 'saved');
  assert.deepEqual(f.reads.sort(), ['/api/customers/me', '/api/experiences/43']);
  f.tracker.beginRun();
  f.page.emit('requestfailed', f.request(body, 'PATCH', '/api/experiences/44'));
  assert.equal((await f.tracker.effectStatus()).status, 'uncertain');
  await f.tracker.close();
});

test('edit receipt cannot confirm a wrong target, version, missing field or owner', async () => {
  const body = { ...intent, version: 2 };
  for (const editReceipt of [{ ...receipt, id: '44', version: 3 },
    { ...receipt, version: 4 }, { ...receipt }]) {
    const f = fixture();
    f.respond(f.request(body, 'PATCH', '/api/experiences/43'), 200, editReceipt);
    assert.equal((await f.tracker.effectStatus()).status, 'uncertain');
    assert.equal(f.reads.length, 0);
    await f.tracker.close();
  }
  const f = fixture(path => ({ status: 200, body: path === '/api/customers/me'
    ? { id: '99' } : { ...receipt, version: 3 } }));
  f.respond(f.request(body, 'PATCH', '/api/experiences/43'), 200, { ...receipt, version: 3 });
  assert.equal((await f.tracker.effectStatus()).status, 'uncertain');
  await f.tracker.close();
});

test('edit rejection recognises the explicit no-update contract', async () => {
  const f = fixture();
  f.respond(f.request({ ...intent, version: 2 }, 'PATCH', '/api/experiences/43'),
    409, { code: 'stale_version', error: 'This record changed' });
  assert.equal((await f.tracker.effectStatus()).status, 'rejected');
  await f.tracker.close();
});

test('a rejected retry cannot erase an earlier attempt with unknown delivery', async () => {
  const f = fixture();
  f.page.emit('requestfailed', f.request());
  assert.equal((await f.tracker.effectStatus()).status, 'uncertain');
  f.tracker.beginRun();
  f.respond(f.request(), 409, { code: 'conflict', error: 'Request conflicted' });
  assert.equal((await f.tracker.effectStatus()).status, 'uncertain');
  await f.tracker.close();
});

test('only the explicit rolled-back 503 receipt is an authoritative rejection', async () => {
  for (const [code, expected] of [['write_rejected', 'rejected'], ['database_unavailable', 'uncertain'], ['service_unavailable', 'uncertain']]) {
    const f = fixture();
    f.respond(f.request({ ...intent, version: 2 }, 'PATCH', '/api/experiences/43'), 503,
      { code, error: 'The save was not confirmed' });
    assert.equal((await f.tracker.effectStatus()).status, expected);
    await f.tracker.close();
  }
});
