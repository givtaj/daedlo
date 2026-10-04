import test from 'node:test';
import assert from 'node:assert/strict';
import { journalRecordMatches } from '../evidence.mjs';
const expected = { notes: 'Same note', date: '2026-09-27', rating: null, strain: '' };
const old = { id: 'previous-record', notes: expected.notes, experienced_on: expected.date, rating: null, strain: null };
test('An older matching Journal entry cannot prove this save persisted', () => {
  assert.equal(journalRecordMatches([old], expected, 'new-response-id'), false);
  assert.equal(journalRecordMatches([old], expected, undefined), false);
});
test('Journal success binds response record identity and the full intended payload', () => {
  const saved = { ...old, id: 'new-response-id' };
  assert.equal(journalRecordMatches([old, saved], expected, saved.id), true);
  assert.equal(journalRecordMatches([{ ...saved, rating: 4 }], expected, saved.id), false);
  assert.equal(journalRecordMatches([{ ...saved, strain: { id: 'wrong-strain' } }], expected, saved.id), false);
});
