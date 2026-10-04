import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { journalRecordMatches } from './evidence.mjs';
import { createWriteEffectTracker, validWriteReceipt } from './write-effects.mjs';

export const MODEL = { id: 'roots', version: 'd4008e3-v1' };
export const COMMAND_IDS = [
  'home', 'profile', 'journal', 'refresh_connections', 'signin',
  'signin_invalid', 'signout', 'profile_edit', 'profile_save',
  'log_experience', 'journal_fill', 'journal_save', 'journal_cancel',
  'mobile', 'desktop',
];

// The customer retains its selectors/observation semantics. Only the shared
// package owns coordination, transport, action guards and viewer behavior.
export async function createRootsAdapter({ page, context, snapshotRoot, account }) {
  const module = (file) => import(pathToFileURL(join(snapshotRoot,
    'tools/live-qa/src/adapters/roots', file)).href);
  const [{ createObserver }, { trackRequests }, { createEvidenceReads, digest }] = await Promise.all([
    module('observe.mjs'), module('requests.mjs'), module('helpers.mjs'),
  ]);
  const origin = new URL(page.url()).origin;
  const requests = trackRequests({ page, origin });
  const secrets = account ? [account.password] : [];
  const responseRecords = new Map(), responseReads = new Set();
  const onResponse = (response) => {
    const request = response.request();
    if (request.method() !== 'POST' || request.url() !== origin + '/api/experiences' || response.status() !== 201) return;
    const reading = (async () => {
      const intent = request.postDataJSON();
      const token = digest(intent.request_id);
      const body = await response.json();
      if (validWriteReceipt('journal_save', intent, body)) responseRecords.set(token, body.id);
    })().catch(() => {}).finally(() => responseReads.delete(reading));
    responseReads.add(reading);
  };
  page.on('response', onResponse);
  const api = async (path) => {
    const r = await context.request.get(origin + path);
    return { status: r.status(), body: await r.json() };
  };
  const effects = createWriteEffectTracker({ page, origin, api });
  const reads = createEvidenceReads({ page, api });
  const observer = createObserver({ page, context, origin, requests, secrets, api,
    rust: { connected: () => true }, isClosed: () => page.isClosed(),
    capabilities: { restart_api: false, shared_compare: false, route_faults: false },
  });
  const observe = async () => {
    const facts = await observer.observe();
    return { connected: facts.connected, session: facts.session_key || facts.session, facts };
  };
  const button = (name) => page.getByRole('button', { name, exact: true });
  const field = (name) => page.getByLabel(name, { exact: true });
  let expected = null;
  const handlers = Object.fromEntries(COMMAND_IDS.map((id) => [id, async (params, e) => {
    expected = null;
    if (['home', 'profile', 'journal'].includes(id)) {
      const target = button({ home: 'Home', profile: 'Profile', journal: 'Smoking Journal' }[id]);
      if (await target.getAttribute('aria-current') !== 'page') await e.click(target);
    } else if (id === 'refresh_connections') {
      await e.click(await button('Refresh connections').count() ? button('Refresh connections') : button('Refresh'));
    } else if (id === 'signin' || id === 'signin_invalid') {
      if (!account) throw Error('Synthetic customer account is required');
      await e.fill(field('Email'), account.email);
      await e.fill(field('Password'), id === 'signin' ? account.password : 'wrong-synthetic-password');
      await e.click(button('Sign in'));
    } else if (id === 'signout') await e.click(button('Sign out'));
    else if (id === 'profile_edit') {
      expected = { profileEdit: params.value };
      await e.fill(field('Display name'), params.value);
    }
    else if (id === 'profile_save') {
      expected = { profile: await field('Display name').inputValue() };
      await e.click(button('Save profile'));
    } else if (id === 'log_experience') await e.click(button('Log experience'));
    else if (id === 'journal_fill') {
      await e.fill(field('How was it?'), params.notes);
      if (params.rating !== undefined) await e.select(field('Overall rating'), params.rating);
    } else if (id === 'journal_save') {
      const fields = await reads.fields();
      expected = { notes: fields['journal-notes'], date: fields['journal-date'],
        rating: fields['journal-rating'] === '' ? null : Number(fields['journal-rating']),
        strain: fields['journal-strain'] || '' };
      await e.click(button('Save experience'));
    } else if (id === 'journal_cancel') await e.click(button('Cancel'));
    else if (id === 'mobile' || id === 'desktop') {
      await e.effect(() => page.setViewportSize(id === 'mobile'
        ? { width: 390, height: 844 } : { width: 1360, height: 1000 }));
    } else throw Error(`Missing Roots handler: ${id}`);
  }]));
  async function settle() {
    let prior = null, count = 0;
    const until = Date.now() + 12000;
    while (Date.now() < until) {
      const o = await observe();
      const signature = JSON.stringify(o);
      count = o.connected && o.facts.pending === 'none' && signature === prior ? count + 1 : 0;
      if (count >= 2) return;
      prior = signature;
      await new Promise((r) => setTimeout(r, 75));
    }
    throw Error('Roots observation did not settle');
  }
  const effectStatus = () => effects.effectStatus();
  async function evidence(command) {
    const id = typeof command === 'string' ? command : command.id;
    const result = { effect: (await effectStatus()).status };
    if (id === 'profile_edit' && expected) {
      result.fieldMatches = await field('Display name').inputValue() === expected.profileEdit;
    } else if (id === 'profile_save' && expected) {
      const persisted = await api('/api/customers/me');
      result.persisted = result.effect === 'saved' && persisted.status === 200 && persisted.body.display_name === expected.profile;
    } else if (id === 'journal_save' && expected) {
      const entries = await reads.entries();
      result.matchingRecords = entries.filter((x) => x.notes === expected.notes && x.experienced_on === expected.date).length;
      await Promise.all(responseReads);
      result.persisted = result.effect === 'saved' && journalRecordMatches(entries, expected, responseRecords.get(requests.operationToken));
    }
    return result;
  }
  return { model: MODEL, handlers, observe, settle, evidence, effectStatus,
    beginRun: () => { effects.beginRun(); expected = null; },
    close: async () => { requests.close(); page.off('response', onResponse); await Promise.all(responseReads); await effects.close(); },
    // Customer-owned acceptance inspection; never exposed as a generic driver API.
    acceptance: { reads, requests, api },
  };
}
