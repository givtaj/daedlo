import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { COMMAND_IDS, RECIPE_IDS } from '../adapter.mjs';
const binary = resolve(process.env.ROOTS_EDIT_ENGINE || 'integrations/roots/edit/engine/target/debug/roots-edit-browser-driver-consumer');
function request(value) {
  const result = spawnSync(binary, [], { input: JSON.stringify({ protocol: 1, id: 1, ...value }) + '\n', encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
const facts = {
  connected: true, session: 'customer', session_key: 'synthetic-session', screen: 'journal',
  profile_draft: false, journal_draft: false, strain_draft: false, form_open: false,
  pending: 'none', error: 'none', saved: false, selected_day: true, mobile: false,
  field_fingerprint: 'synthetic-fields', draft_token: '', history_count: 1,
  available_controls: ['journal', 'edit_open', 'log_experience'],
  capabilities: { restart_api: true, shared_compare: false, route_faults: true },
  fixture: { ready: true, disposable: true },
};
const observation = (changes = {}) => ({ connected: true, session: 'synthetic-session', facts: { ...structuredClone(facts), ...changes } });

test('edit descriptor exposes exactly the implemented four recipes and handler surface', () => {
  const { descriptor, ok } = request({ op: 'hello' });
  assert.equal(ok, true);
  assert.deepEqual(descriptor.recipes.map((r) => r.id).sort(), [...RECIPE_IDS].sort(), 'Extracted edit recipe coverage is incomplete');
  assert.deepEqual(descriptor.commands.map((c) => c.id).sort(), [...COMMAND_IDS].sort());
  assert.ok(descriptor.states.some((s) => s.id === 'journal.edit.recovery.uncertain_save'));
  assert.ok(descriptor.states.every((s) => !s.id.includes('Root::')));
});
test('fixture readiness and capabilities disable recipes before any plan or effect', () => {
  for (const changed of [{ fixture: { ready: false, disposable: true } }, { fixture: { ready: true, disposable: false } }]) {
    const o = observation(changed);
    const result = request({ op: 'observe', observation: o });
    assert.equal(result.ok, true);
    assert.ok(result.recipes.every((r) => r.enabled === false));
    const rejected = request({ op: 'recipe', observation: o, fingerprint: result.fingerprint, recipe: 'edit-save' });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error_code, 'fixture_not_ready');
    assert.equal(rejected.plan, undefined);
  }
  const o = observation({ capabilities: { restart_api: false, route_faults: false, shared_compare: false } });
  const result = request({ op: 'observe', observation: o });
  assert.equal(result.recipes.find((r) => r.id === 'edit-save').enabled, true);
  for (const id of ['edit-persisted', 'edit-lost-response-retry']) assert.equal(result.recipes.find((r) => r.id === id).enabled, false);
});
test('missing required facts and undeclared parameter cannot silently enable edits', () => {
  const o = observation(); delete o.facts.fixture;
  assert.equal(request({ op: 'observe', observation: o }).ok, false);
  const current = observation(), observed = request({ op: 'observe', observation: current });
  const invalid = request({ op: 'command', observation: current, fingerprint: observed.fingerprint,
    command: 'edit_open', params: { entry_id: '42', ignored: true } });
  assert.equal(invalid.ok, false);
});
test('assertion commands need evidence rather than only a reachable page', () => {
  const o = observation();
  const result = request({ op: 'verify', before: o, observation: o, command: 'assert', params: { name: 'edit_saved' }, evidence: {} });
  assert.equal(result.ok, true);
  assert.equal(result.outcome.kind, 'unknown');
});
