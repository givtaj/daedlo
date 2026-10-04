import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { dependencyReceipt } from '../dependency-receipt.mjs';
const snapshot = resolve(process.env.ROOTS_EDIT_SNAPSHOT || 'artifacts/roots-edit-20261004/capture/snapshot');

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('fixture Vite serves existing config with cache outside immutable source dependencies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'driver-web-cache-contract-'));
  const app = join(directory, 'app'), owned = join(directory, 'owned'), dependencies = join(app, 'node_modules');
  fs.mkdirSync(join(dependencies, 'fixture-dependency'), { recursive: true });
  fs.mkdirSync(owned);
  fs.symlinkSync(join(snapshot, 'apps/web/node_modules/vite'), join(dependencies, 'vite'));
  fs.writeFileSync(join(app, 'package.json'), '{"type":"module","dependencies":{"fixture-dependency":"1.0.0"}}');
  fs.writeFileSync(join(app, 'vite.config.ts'), "export default { server: { headers: { 'X-Fixture-Config': 'preserved' } } };\n");
  fs.writeFileSync(join(app, 'index.html'), '<!doctype html><script type="module" src="/main.js"></script>');
  fs.writeFileSync(join(app, 'main.js'), 'import { value } from "fixture-dependency"; document.body.textContent=value;');
  fs.writeFileSync(join(dependencies, 'fixture-dependency/package.json'), '{"name":"fixture-dependency","version":"1.0.0","type":"module","exports":"./index.js"}');
  fs.writeFileSync(join(dependencies, 'fixture-dependency/index.js'), 'export const value = "fixture";');
  const before = dependencyReceipt(dependencies), configBefore = fs.readFileSync(join(app, 'vite.config.ts'), 'utf8');
  let child, output = '';
  try {
    const port = await freePort();
    child = spawn(process.execPath, [resolve('integrations/roots/fixture-web.mjs'), app, join(owned, 'vite-cache'), String(port)], { cwd: owned, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', bytes => { output += bytes.toString(); });
    child.stderr.on('data', bytes => { output += bytes.toString(); });
    const until = Date.now() + 20000;
    while (!output.includes('FIXTURE_WEB_READY') && Date.now() < until && child.exitCode === null)
      await new Promise(resolve => setTimeout(resolve, 50));
    assert.match(output, /FIXTURE_WEB_READY/, 'Fixture server must start before cache assertion');
    const origin = `http://127.0.0.1:${port}`;
    const html = await fetch(origin); assert.equal(html.status, 200);
    assert.equal(html.headers.get('x-fixture-config'), 'preserved', 'Existing customer Vite config must load');
    const module = await fetch(origin + '/main.js'); assert.equal(module.status, 200);
    const body = await module.text();
    const optimized = body.match(/from\s*["']([^"']*fixture-dependency[^"']*)["']/)?.[1];
    assert.ok(optimized, 'A real dependency must be transformed');
    assert.equal((await fetch(new URL(optimized, origin))).status, 200);
    const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit;
    assert.deepEqual(dependencyReceipt(dependencies), before, 'Starting Vite must not mutate installed dependency bytes');
    assert.equal(fs.existsSync(join(dependencies, '.vite-temp')), false, 'Config loader must not create a source dependency temp directory');
    assert.equal(fs.existsSync(join(dependencies, '.vite')), false, 'Dependency optimization belongs to owned cache');
    assert.equal(fs.readFileSync(join(app, 'vite.config.ts'), 'utf8'), configBefore);
    assert.ok(fs.existsSync(join(owned, 'vite-cache')), 'Owned cache must receive dependency output');
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit; }
    await rm(directory, { recursive: true, force: true });
  }
});
