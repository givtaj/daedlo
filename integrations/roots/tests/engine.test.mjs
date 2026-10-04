import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { COMMAND_IDS } from '../adapter.mjs';
const binary = resolve(process.env.ROOTS_CONSUMER_ARTIFACTS || 'artifacts/roots', 'engine-target/debug/roots-browser-driver-consumer');
const facts = {
  connected: true, session: 'customer', session_key: 'synthetic-session', screen: 'profile',
  profile_draft: false, journal_draft: false, strain_draft: false, form_open: false,
  pending: 'none', error: 'none', saved: true, selected_day: false, mobile: false,
  field_fingerprint: 'synthetic-fields', draft_token: '', history_count: 0,
  available_controls: ['profile_save', 'profile_edit'],
  capabilities: { restart_api: false, shared_compare: false, route_faults: false },
};
const observation = { connected: true, session: 'synthetic-session', facts };
function request(value) {
  const r = spawnSync(binary, [], { input: JSON.stringify({ protocol: 1, id: 1, ...value }) + '\n', encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout);
}
test('Roots descriptor uses explicit state IDs and exact executable handler coverage', () => {
  const r = request({ op: 'hello' }); assert.equal(r.ok, true);
  assert.equal(r.descriptor.id, 'roots');
  assert.deepEqual(r.descriptor.commands.map(c => c.id).sort(), [...COMMAND_IDS].sort());
  assert.ok(r.descriptor.states.some(s => s.id === 'profile.editing.saved'));
  assert.ok(r.descriptor.states.every(s => !s.id.includes('Root::')));
});
test('Roots missing facts are rejected rather than defaulted into readiness', () => {
  const incomplete = structuredClone(observation); delete incomplete.facts.field_fingerprint;
  const r = request({ op: 'observe', observation: incomplete }); assert.equal(r.ok, false);
});
test('Roots visible saved state requires independent persistence evidence', () => {
  const missing = request({ op: 'verify', before: observation, observation, command: 'profile_save', params: {}, evidence: {} });
  assert.equal(missing.ok, true); assert.equal(missing.outcome.kind, 'unknown');
  const saved = request({ op: 'verify', before: observation, observation, command: 'profile_save', params: {}, evidence: { persisted: true } });
  assert.equal(saved.ok, true); assert.equal(saved.outcome.kind, 'success');
});
test('Roots unknown parameter and stale state are rejected before authorization', () => {
  const observed = request({ op: 'observe', observation });
  const invalid = request({ op: 'command', observation, command: 'profile_save', fingerprint: observed.fingerprint, params: { injected: true } });
  assert.equal(invalid.ok, false);
  const changed = structuredClone(observation); changed.facts.field_fingerprint = 'human-edit';
  const stale = request({ op: 'command', observation: changed, command: 'profile_save', fingerprint: observed.fingerprint, params: {} });
  assert.equal(stale.ok, false); assert.equal(stale.error_code, 'stale_observation');
});
test('Correcting validation back to a persisted profile name verifies the field without claiming a new save', () => {
  const r = request({ op: 'verify', before: observation, observation, command: 'profile_edit', params: { value: 'Existing name' }, evidence: { fieldMatches: true } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.outcome.kind, 'success');
  assert.doesNotMatch(r.outcome.label, /Saved and read back/);
  const unproven = request({ op: 'verify', before: observation, observation, command: 'profile_edit', params: { value: 'Existing name' }, evidence: {} });
  assert.equal(unproven.ok, false);
});
