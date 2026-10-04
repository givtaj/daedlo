import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createWriteEffectTracker } from '../write-effects.mjs';

export const MODEL = { id: 'roots-edit', version: '96275b5-journal-edit-v1' };
export const RECIPE_IDS = ['edit-save', 'edit-cancel-retained', 'edit-lost-response-retry', 'edit-persisted'];
export const COMMAND_IDS = ['home', 'profile', 'journal', 'signin', 'signout',
  'log_experience', 'journal_fill', 'journal_save', 'journal_cancel',
  'edit_open', 'edit_fill', 'edit_save', 'edit_cancel', 'edit_retry_save',
  'reload', 'checkpoint', 'assert', 'restart_api', 'fault_on', 'fault_off'];

// Only customer facts, selectors and assertions are reused from the frozen
// application. Coordination and every effect belong to the public package.
export async function createRootsEditAdapter({ page, context, snapshotRoot, account,
  disposable = false, fixtureReady = false, restartApi }) {
  const module = (file) => import(pathToFileURL(join(snapshotRoot,
    'tools/browser-driver/runtime/src/adapters/roots', file)).href);
  const [{ createObserver }, { trackRequests }, { createEvidenceReads }, { createAssertions }] = await Promise.all([
    module('observe.mjs'), module('requests.mjs'), module('helpers.mjs'), module('assertions.mjs'),
  ]);
  const origin = new URL(page.url()).origin;
  const api = async (path) => {
    const response = await context.request.get(origin + path);
    return { status: response.status(), body: await response.json() };
  };
  const requests = trackRequests({ page, origin });
  const effects = createWriteEffectTracker({ page, origin, api });
  const reads = createEvidenceReads({ page, api });
  const observer = createObserver({ page, context, origin, requests,
    secrets: account ? [account.password] : [], api,
    rust: { connected: () => true }, isClosed: () => page.isClosed(),
    capabilities: { restart_api: disposable && typeof restartApi === 'function',
      shared_compare: false, route_faults: disposable },
  });
  const observe = async () => {
    const facts = await observer.observe();
    return { connected: facts.connected, session: facts.session_key || facts.session,
      facts: { ...facts, fixture: { ready: fixtureReady === true, disposable: disposable === true } } };
  };
  let recipeData = null, run = null, lastAssertion = null;
  const faults = [];
  const assertion = createAssertions({ page, entries: reads.entries, fields: reads.fields,
    getRecipeData: () => recipeData, requests });
  const button = (name) => page.getByRole('button', { name, exact: true });
  const field = (name) => page.getByLabel(name, { exact: true });
  const editor = () => page.getByRole('form', { name: 'Edit experience', exact: true });
  const requireRecipe = () => {
    assert.ok(run?.recipe && RECIPE_IDS.includes(run.command) && recipeData,
      'Evidence and fixture actions require an active canonical edit recipe');
    assert.equal(disposable && fixtureReady, true, 'Verified disposable fixture required');
    return recipeData;
  };
  const readEditFields = () => editor().evaluate((el) => Object.fromEntries(
    [...el.querySelectorAll('input,textarea,select')].map((item) => [item.id, item.value])));
  async function clearFaults(e) {
    const failed = [];
    for (const fault of [...faults]) {
      try {
        if (e) await e.effect(() => page.unroute(fault.pattern, fault.handler));
        else await page.unroute(fault.pattern, fault.handler);
        faults.splice(faults.indexOf(fault), 1);
      } catch (error) { failed.push(error); }
    }
    if (failed.length) throw new AggregateError(failed, 'Owned route cleanup incomplete; handles retained');
  }
  const handlers = Object.fromEntries(COMMAND_IDS.map((id) => [id, async (params, e) => {
    lastAssertion = null;
    if (['home', 'profile', 'journal'].includes(id)) {
      const target = button({ home: 'Home', profile: 'Profile', journal: 'Smoking Journal' }[id]);
      if (await target.getAttribute('aria-current') !== 'page') await e.click(target);
    } else if (id === 'signin') {
      assert.ok(account, 'A synthetic customer account is required');
      await e.fill(field('Email'), account.email);
      await e.fill(field('Password'), account.password);
      await e.click(button('Sign in'));
    } else if (id === 'signout') await e.click(button('Sign out'));
    else if (id === 'log_experience') await e.click(button('Log experience'));
    else if (id === 'journal_fill' || id === 'edit_fill') {
      const form = id === 'edit_fill' ? editor() : page.locator('.journal-form');
      if (params.date !== undefined) {
        let date = params.date;
        if (date === '@today') {
          requireRecipe();
          date = await page.evaluate(() => {
            const now = new Date();
            return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
          });
        }
        await e.fill(form.getByLabel('Date', { exact: true }), date);
      }
      if (params.notes !== undefined) {
        const notes = params.notes === '$notes' ? requireRecipe().notes
          : params.notes === '$edited' ? `${requireRecipe().notes} edited` : params.notes;
        await e.fill(form.getByLabel('How was it?', { exact: true }), notes);
      }
      if (params.rating !== undefined) await e.select(form.getByLabel('Overall rating', { exact: true }), params.rating);
      if (params.strain !== undefined) await e.select(form.getByLabel('Strain', { exact: true }), params.strain);
    } else if (id === 'journal_save') await e.click(button('Save experience'));
    else if (id === 'journal_cancel' || id === 'edit_cancel') await e.click(button('Cancel'));
    else if (id === 'edit_save') await e.click(button('Save changes'));
    else if (id === 'edit_retry_save') await e.click(button('Retry save'));
    else if (id === 'edit_open') {
      let targetId = params.entry_id;
      if (targetId === '@created') {
        const data = requireRecipe();
        const matching = (await reads.entries()).filter((row) => row.notes === data.notes);
        if (!data.editTarget) {
          assert.equal(matching.length, 1, 'Recipe setup must identify exactly one created entry');
          data.editTarget = matching[0].id;
        }
        targetId = data.editTarget;
      }
      const rows = await page.locator('article[data-experience-id]').all();
      const matches = [];
      for (const row of rows) if (await row.getAttribute('data-experience-id') === targetId) matches.push(row);
      assert.equal(matches.length, 1, 'Exact target must appear once in current visible history');
      await e.click(matches[0].getByRole('button', { name: 'Edit experience', exact: true }));
    } else if (id === 'checkpoint') {
      const data = requireRecipe();
      assert.equal(params.name, 'edit_before');
      const fields = await readEditFields(), target = await editor().getAttribute('data-edit-target');
      const entries = await reads.entries(), original = entries.find((row) => row.id === target);
      assert.ok(original, 'Read checkpoint for exact edit target');
      data.checkpoints.edit_before = { fields, target, entries, original, saveSequence: requests.saveSequence };
    } else if (id === 'assert') {
      requireRecipe();
      await assertion(params.name);
      lastAssertion = params.name;
    } else if (id === 'reload') await e.effect(() => page.reload({ waitUntil: 'domcontentloaded' }));
    else if (id === 'restart_api') {
      requireRecipe();
      assert.equal(typeof restartApi, 'function', 'Owned API restart capability required');
      await e.effect(restartApi);
    } else if (id === 'fault_on') {
      const data = requireRecipe();
      assert.equal(params.mode, 'edit_lost_response');
      assert.equal(faults.length, 0, 'Fault already owned by this run');
      const pattern = '**/api/experiences/*';
      const handler = async (route) => {
        if (route.request().method() !== 'PATCH') return route.continue();
        try { data.upstreamStatus = (await route.fetch()).status(); }
        catch { data.upstreamStatus = null; }
        finally { await route.abort('failed').catch(() => {}); }
      };
      await e.effect(async () => { await page.route(pattern, handler); faults.push({ pattern, handler }); });
    } else if (id === 'fault_off') { requireRecipe(); await clearFaults(e); }
    else throw Error('Missing customer edit handler');
  }]));
  async function settle() {
    let prior = null, count = 0;
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      const observation = await observe();
      const signature = JSON.stringify(observation);
      count = observation.connected && observation.facts.pending === 'none' && signature === prior ? count + 1 : 0;
      if (count >= 2) return;
      prior = signature;
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    throw Error('Roots edit observation did not settle');
  }
  async function effectStatus() {
    const report = await effects.effectStatus();
    if (run?.recipe) {
      for (const operation of report.operations) if (operation.label !== 'Requested edit') operation.label = 'Setup entry';
      if (!report.operations.some((operation) => operation.label === 'Requested edit'))
        report.operations.push({ id: 'requested-edit', label: 'Requested edit', status: 'not_attempted' });
    }
    return report;
  }
  async function evidence(id) {
    const report = await effectStatus();
    const result = { effect: report.status };
    if (id === 'journal_save') result.persisted = report.operations.some((o) =>
      ['Setup entry', 'Requested save'].includes(o.label) && o.status === 'saved');
    if (id === 'edit_save' || id === 'edit_retry_save') {
      result.persisted = report.operations.some((o) => o.label === 'Requested edit' && o.status === 'saved');
      if (id === 'edit_save' && run?.recipe && run.command === 'edit-lost-response-retry') {
        // Expected failure is a verified scenario step only after every customer
        // assertion succeeds. Its write effect remains uncertain until replay.
        await assertion('edit_uncertain');
        result.expectedUncertain = true;
      }
    }
    if (id === 'assert') result.asserted = lastAssertion;
    result.cancelledUnchanged = recipeData?.assertions.includes('edit_cancelled') ?? false;
    result.restartPersisted = recipeData?.assertions.includes('edit_persisted') ?? false;
    return result;
  }
  return { model: MODEL, handlers, observe, settle, evidence, effectStatus,
    async beginRun(info) {
      // Retry only retained owned cleanup before a new run; failures stay owned.
      await clearFaults();
      effects.beginRun();
      run = info;
      lastAssertion = null;
      recipeData = info.recipe ? { notes: `Synthetic edit acceptance ${randomUUID()}`, checkpoints: {}, assertions: [] } : null;
    },
    async endRun() { await clearFaults(); },
    async close() {
      await clearFaults();
      requests.close();
      await effects.close();
    },
    acceptance: { reads, requests, api, summary: () => ({
      assertions: [...new Set(recipeData?.assertions ?? [])],
      ownedFaults: faults.length,
      upstreamStatus: recipeData?.upstreamStatus ?? null,
    }) },
  };
}
