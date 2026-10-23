// Customer-owned disposable application resources. No normal Roots configuration
// or browser is read or attached. Credentials stay in the owned private directory.
import fs from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { chromium } from 'playwright';
import { createResourceScope } from '@daedlo/runtime';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(check, label, milliseconds = 20000) {
  const until = Date.now() + milliseconds;
  while (Date.now() < until) {
    if (await check()) return;
    await pause(80);
  }
  throw Error(`Timed out waiting for ${label}`);
}
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  let timeout;
  await Promise.race([exited, new Promise(resolve => { timeout = setTimeout(resolve, 6000); })]);
  clearTimeout(timeout);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await exited;
  }
}
export async function createFeatureFixture({ snapshotRoot, binaryDir, output, headless = true }) {
  snapshotRoot = resolve(snapshotRoot); binaryDir = resolve(binaryDir); output = resolve(output);
  fs.mkdirSync(output, { recursive: true });
  const scope = createResourceScope(), root = fs.mkdtempSync('/tmp/browser-driver-roots-edit-');
  scope.own(root, { label: 'private fixture directory', close: path => {
    if (scope.snapshot().some(r => r.label !== 'private fixture directory' && r.owned && r.status !== 'closed')) throw Error('Preserve fixture directory until all owned resources close');
    fs.rmSync(path, { recursive: true, force: true });
  } });
  const container = 'browser-driver-edit-' + randomBytes(6).toString('hex');
  const accounts = Object.fromEntries(['admin', 'alpha', 'beta'].map(name => [name, { email: `driver-${name}@example.test`, password: randomBytes(24).toString('base64url') }]));
  const databasePassword = randomBytes(24).toString('hex');
  const secrets = [databasePassword, ...Object.values(accounts).map(x => x.password)];
  const redact = value => secrets.reduce((text, secret) => text.replaceAll(secret, '[redacted]'), String(value));
  const env = { ...process.env, POSTGRES_USER: 'driver_qa', POSTGRES_DB: 'driver_qa', POSTGRES_PASSWORD: databasePassword };
  for (const key of ['DATABASE_URL', 'DATABASE_HOST', 'DATABASE_PORT', 'API_PORT', 'WEB_PORT']) delete env[key];
  const lifecycle = [];
  const owned = { root, container, pids: [] };
  const recordOwned = () => fs.writeFileSync(join(output, 'owned.json'), JSON.stringify(owned, null, 2));
  const record = () => fs.writeFileSync(join(output, 'lifecycle.json'), JSON.stringify(lifecycle, null, 2) + '\n');
  const run = (command, args, options = {}) => {
    try { return execFileSync(command, args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim(); }
    catch (error) { throw Error(redact(error.stderr || error.message)); }
  };
  async function close() {
    try {
      await scope.close();
      fs.writeFileSync(join(output, 'cleanup.json'), JSON.stringify({ ok: true, resources: scope.snapshot() }, null, 2));
    } catch (error) {
      fs.writeFileSync(join(output, 'cleanup.json'), JSON.stringify({ ok: false, error: redact(error.message), resources: scope.snapshot() }, null, 2));
      throw error;
    }
  }
  try {
    recordOwned();
    for (const name of ['roots-api', 'db']) fs.copyFileSync(join(binaryDir, name), join(root, name));
    fs.writeFileSync(join(root, 'accounts.json'), JSON.stringify(accounts), { mode: 0o600 });
    const ownershipToken = randomBytes(24).toString('hex');
    let containerAttempted = false;
    scope.own(container, { label: 'disposable PostgreSQL', close: name => {
      if (!containerAttempted) return;
      // A failed detached start may still own a stopped container. Removing by
      // this generated name never targets another fixture.
      const ids = run('docker', ['ps', '-a', '--filter', `label=browser-driver.owner=${ownershipToken}`, '--format', '{{.ID}}']).split('\n').filter(Boolean);
      for (const id of ids) run('docker', ['rm', '--force', '--volumes', id]);
    } });
    containerAttempted = true;
    run('docker', ['run', '--detach', '--name', container, '--label', 'browser-driver.owned=roots-edit', '--label', `browser-driver.owner=${ownershipToken}`, '--tmpfs', '/var/lib/postgresql/data:rw', '--publish', '127.0.0.1::5432', '--env', 'POSTGRES_USER', '--env', 'POSTGRES_DB', '--env', 'POSTGRES_PASSWORD', 'postgres:17-bookworm']);
    await eventually(async () => {
      try { run('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'driver_qa', '-d', 'driver_qa']); return true; } catch { return false; }
    }, 'PostgreSQL readiness', 30000);
    const dbPort = JSON.parse(run('docker', ['inspect', container]))[0].NetworkSettings.Ports['5432/tcp'][0].HostPort;
    const apiPort = await freePort(), webPort = await freePort();
    const origin = `http://127.0.0.1:${webPort}`;
    Object.assign(env, { DATABASE_URL: `postgres://driver_qa:${databasePassword}@127.0.0.1:${dbPort}/driver_qa`, API_HOST: '127.0.0.1', API_PORT: String(apiPort), WEB_PORT: String(webPort), API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`, SESSION_COOKIE_SECURE: 'false', VITE_APP_NAME: 'Roots', COMPOSE_PROJECT_NAME: container });
    for (const name of ['alpha', 'beta']) run(join(root, 'db'), ['seed'], { env: { ...env, SEED_ADMIN_EMAIL: accounts.admin.email, SEED_ADMIN_PASSWORD: accounts.admin.password, SEED_CUSTOMER_EMAIL: accounts[name].email, SEED_CUSTOMER_PASSWORD: accounts[name].password } });
    // Readiness includes explicit shared-catalogue setup, not just two accounts.
    run(join(root, 'db'), ['seed-strains']);
    const spawnOwned = (label, executable, args, cwd) => {
      const child = spawn(executable, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      scope.own(child, { label, close: stop });
      if (child.pid) owned.pids.push({ label, pid: child.pid }); recordOwned();
      let log = '';
      for (const stream of [child.stdout, child.stderr]) {
        stream.on('data', bytes => { log += bytes.toString(); const last = log.lastIndexOf('\n'); if (last >= 0) { fs.appendFileSync(join(output, label + '.log'), redact(log.slice(0, last + 1))); log = log.slice(last + 1); } });
      }
      child.on('error', error => { fs.appendFileSync(join(output, label + '.log'), redact(error.message) + '\n'); });
      child.on('exit', () => { if (log) fs.appendFileSync(join(output, label + '.log'), redact(log)); });
      return child;
    };
    let api;
    async function startApi() {
      api = spawnOwned('api', join(root, 'roots-api'), [], root);
      await eventually(async () => {
        if (api.exitCode !== null) throw Error('Owned API exited during startup; inspect its redacted log');
        try { return (await fetch(`http://127.0.0.1:${apiPort}/api/health`)).ok; } catch { return false; }
      }, 'API readiness');
      lifecycle.push({ action: 'api-start', pid: api.pid, at: new Date().toISOString() }); record();
    }
    await startApi();
    // Vite's config runner also uses cwd for transient work, so both cwd and
    // dependency cache stay within this owned fixture instead of the snapshot.
    const web = spawnOwned('web', process.execPath, [join(import.meta.dirname, 'fixture-web.mjs'),
      join(snapshotRoot, 'apps/web'), join(root, 'vite-cache'), String(webPort)], root);
    await eventually(async () => {
      if (web.exitCode !== null) throw Error('Owned web process exited during startup; inspect its redacted log');
      try { return (await fetch(origin)).ok; } catch { return false; }
    }, 'web readiness');
    const browser = await chromium.launch({ headless });
    scope.own(browser, { label: 'acceptance Chromium', close: value => value.close() });
    const catalogues = [], profiles = [];
    for (const account of [accounts.alpha, accounts.beta]) {
      const context = await browser.newContext();
      try {
        const signed = await context.request.post(origin + '/api/auth/login', { data: account, headers: { 'X-Roots-CSRF': '1', Origin: origin } });
        if (signed.status() !== 200) throw Error('Synthetic account readiness failed');
        const profile = await context.request.get(origin + '/api/customers/me');
        if (profile.status() !== 200) throw Error('Synthetic profile readiness failed');
        profiles.push((await profile.json()).id);
        const response = await context.request.get(origin + '/api/strains?limit=100');
        if (response.status() !== 200) throw Error('Shared catalogue readiness failed');
        const body = await response.json();
        if (!Array.isArray(body.items)) throw Error('Shared catalogue response is not observable');
        catalogues.push(new Set(body.items.map(x => x.id)));
      } finally { await context.close(); }
    }
    if (!profiles[0] || !profiles[1] || profiles[0] === profiles[1] || ![...catalogues[0]].some(id => catalogues[1].has(id))) throw Error('Distinct synthetic customers must observe at least one shared catalogue choice');
    const readiness = { migrated: true, syntheticAccounts: true, sharedCatalogueSeeded: true, sharedCatalogueVerified: true, disposable: true };
    const binaryHashes = Object.fromEntries(['roots-api', 'db'].map(name => [name, createHash('sha256').update(fs.readFileSync(join(root, name))).digest('hex')]));
    fs.writeFileSync(join(output, 'fixture.json'), JSON.stringify({ origin, container, root, apiPid: api.pid, webPid: web.pid, browser: browser.version(), readiness, binaryHashes }, null, 2));
    lifecycle.push({ action: 'ready', at: new Date().toISOString() }); record();
    return { root, origin, browser, accounts, readiness, lifecycle, redact, close,
      restartApi: async () => {
        const previous = api;
        await stop(previous);
        await startApi(); // Replacement is registered before old handles can be forgotten.
        lifecycle.push({ action: 'api-restart', oldPid: previous.pid, newPid: api.pid, at: new Date().toISOString() }); record();
      } };
  } catch (error) {
    try { await close(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Fixture startup and cleanup failed; owned handles retained in cleanup.json'); }
    throw error;
  }
}
