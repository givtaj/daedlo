// Roots owns the meaning of write receipts and application read-back evidence.
// Keep this summary separate from the command's execution outcome.
export function summarizeWriteEffects(attempts) {
  const grouped = new Map();
  for (const attempt of attempts) {
    // Missing operation identity cannot collapse two independent writes.
    const key = typeof attempt.operationKey === 'string' && attempt.operationKey
      ? `${attempt.kind || ''}:${attempt.operationKey}` : Symbol();
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(attempt);
  }
  const groups = [...grouped.values()];
  const operations = groups.map((group, index) => ({
    id: `operation-${index + 1}`,
    label: group[0].kind === 'edit_save' ? 'Requested edit'
      : group[0].kind === 'journal_save' && index < groups.length - 1 ? 'Setup entry' : 'Requested save',
    status: group.some((a) => a.confirmed === true && a.readbackConfirmed === true) ? 'saved'
      : group.every((a) => a.rejected === true) ? 'rejected' : 'uncertain',
  }));
  const status = operations.some((o) => o.status === 'uncertain') ? 'uncertain'
    : operations.some((o) => o.status === 'rejected') ? 'rejected'
      : operations.length ? 'saved' : 'not_attempted';
  return { status, operations };
}

const decimal = (value) => typeof value === 'string' && /^[1-9][0-9]*$/.test(value);
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const rating = (value) => value === null || Number.isInteger(value) && value >= 1 && value <= 5;
const expectedExperience = (body, receipt) => object(receipt) && decimal(receipt.id)
  && typeof body.notes === 'string' && receipt.notes === body.notes.trim()
  && typeof body.experienced_on === 'string' && receipt.experienced_on === body.experienced_on
  && rating(receipt.rating) && receipt.rating === (body.rating ?? null)
  && ((body.strain_id ?? null) === null ? receipt.strain === null
    : object(receipt.strain) && receipt.strain.id === body.strain_id
      && typeof receipt.strain.name === 'string');

export function validWriteReceipt(kind, body, receipt, targetId) {
  if (!object(body) || !decimal(body.profile_id)) return false;
  if (kind === 'profile_save') return object(receipt) && receipt.id === body.profile_id
    && typeof receipt.email === 'string' && typeof body.display_name === 'string'
    && receipt.display_name === body.display_name.trim() && Number.isSafeInteger(body.version)
    && body.version >= 0 && Number.isSafeInteger(receipt.version) && receipt.version === body.version + 1;
  if (typeof body.request_id !== 'string' || !body.request_id) return false;
  if (kind === 'journal_save') return Boolean(expectedExperience(body, receipt));
  if (kind === 'edit_save') return Boolean(expectedExperience(body, receipt))
    && decimal(targetId) && receipt.id === targetId
    && Object.hasOwn(body, 'strain_id') && Object.hasOwn(body, 'rating')
    && Number.isSafeInteger(body.version) && body.version >= 0
    && Number.isSafeInteger(receipt.version) && receipt.version === body.version + 1;
  if (kind === 'strain_save') return object(receipt) && decimal(receipt.id)
    && typeof body.name === 'string' && receipt.name === body.name.trim();
  return false;
}

// These status/code pairs are defined by the pinned baseline and verified edit
// AppError contracts. Only write_rejected promises rollback for a server error.
export function isWriteRejection(status, body) {
  const codes = { 400: ['invalid_input'], 401: ['unauthorized'], 403: ['forbidden'],
    404: ['not_found'], 409: ['conflict', 'duplicate_strain', 'stale_version', 'request_key_reused', 'account_changed'],
    503: ['write_rejected'] };
  return object(body) && typeof body.error === 'string' && Boolean(codes[status]?.includes(body.code));
}

async function readbackMatches(kind, body, receipt, api, targetId) {
  if (kind === 'profile_save') {
    const fresh = await api('/api/customers/me');
    return fresh.status === 200 && validWriteReceipt(kind, body, fresh.body)
      && fresh.body.email === receipt.email;
  }
  if (kind === 'edit_save') {
    const owner = await api('/api/customers/me');
    if (owner.status !== 200 || owner.body?.id !== body.profile_id) return false;
    const fresh = await api(`/api/experiences/${encodeURIComponent(targetId)}`);
    return fresh.status === 200 && validWriteReceipt(kind, body, fresh.body, targetId);
  }
  const path = kind === 'journal_save' ? '/api/experiences' : '/api/strains';
  let cursor = null, matches = 0;
  const seen = new Set();
  do {
    const fresh = await api(`${path}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    if (fresh.status !== 200 || fresh.body?.profile_id !== body.profile_id
      || !Array.isArray(fresh.body.items)) return false;
    for (const item of fresh.body.items) {
      if (item.id !== receipt.id) continue;
      if (!validWriteReceipt(kind, body, item)) return false;
      matches++;
    }
    cursor = fresh.body.next_cursor;
    if (cursor !== null && (typeof cursor !== 'string' || !cursor || seen.has(cursor))) return false;
    seen.add(cursor);
  } while (cursor);
  return matches === 1;
}

// Private request payloads and identifiers never leave this customer tracker.
// A fresh independent API read runs even if Stop skips the model's verification.
export function createWriteEffectTracker({ page, origin, api }) {
  const byRequest = new WeakMap(), pending = new Set(), confirmed = new Map(), unresolved = new Set();
  let forgottenUncertainty = false;
  let attempts = [];
  const onRequest = (request) => {
    const url = new URL(request.url());
    if (url.origin !== origin) return;
    const kind = request.method() === 'POST' && url.pathname === '/api/experiences' ? 'journal_save'
      : request.method() === 'POST' && url.pathname === '/api/strains' ? 'strain_save'
        : request.method() === 'PATCH' && url.pathname === '/api/customers/me' ? 'profile_save'
          : request.method() === 'PATCH' && /^\/api\/experiences\/[^/]+$/.test(url.pathname) ? 'edit_save' : null;
    if (!kind) return;
    let body;
    try { body = structuredClone(request.postDataJSON()); } catch {}
    const targetId = kind === 'edit_save' ? url.pathname.split('/').at(-1) : undefined;
    const operationKey = object(body) ? JSON.stringify([kind, url.pathname, canonical(body)]) : '';
    const prior = operationKey && confirmed.get(operationKey);
    const attempt = { kind, operationKey, body, targetId, status: 'pending',
      priorUnknown: unresolved.has(operationKey) || forgottenUncertainty && !prior,
      confirmed: Boolean(prior), readbackConfirmed: Boolean(prior),
      ...(prior ? { receipt: structuredClone(prior.receipt) } : {}) };
    if (operationKey) {
      unresolved.add(operationKey);
      if (unresolved.size > 128) {
        unresolved.delete(unresolved.values().next().value);
        // Forgetting an unknown operation must not make a later rejection conclusive.
        forgottenUncertainty = true;
      }
    }
    attempts.push(attempt);
    byRequest.set(request, attempt);
  };
  const onResponse = (response) => {
    const attempt = byRequest.get(response.request());
    if (!attempt) return;
    attempt.status = response.status();
    const reading = (async () => {
      const body = await response.json();
      attempt.rejected = isWriteRejection(attempt.status, body) && !attempt.priorUnknown;
      if (attempt.rejected) unresolved.delete(attempt.operationKey);
      const expectedStatus = ['profile_save', 'edit_save'].includes(attempt.kind) ? 200 : 201;
      if (attempt.status !== expectedStatus || !validWriteReceipt(attempt.kind, attempt.body, body, attempt.targetId)) return;
      attempt.confirmed = true;
      attempt.receipt = structuredClone(body);
      attempt.readbackConfirmed ||= await readbackMatches(attempt.kind, attempt.body, body, api, attempt.targetId);
      if (attempt.readbackConfirmed && attempt.operationKey) {
        confirmed.set(attempt.operationKey, { receipt: structuredClone(body) });
        unresolved.delete(attempt.operationKey);
        // Eviction only makes very old retries conservative, never successful.
        if (confirmed.size > 128) confirmed.delete(confirmed.keys().next().value);
      }
    })().catch(() => {}).finally(() => pending.delete(reading));
    pending.add(reading);
  };
  const onFailed = (request) => {
    const attempt = byRequest.get(request);
    if (attempt) attempt.status = 'response_unavailable';
  };
  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('requestfailed', onFailed);
  return {
    // Private customer evidence only. Never copy these payloads to session reports.
    get attempts() { return structuredClone(attempts); },
    beginRun() { attempts = []; },
    async effectStatus() { await Promise.all(pending); return summarizeWriteEffects(attempts); },
    async close() {
      page.off('request', onRequest); page.off('response', onResponse); page.off('requestfailed', onFailed);
      await Promise.all(pending);
    },
  };
}
