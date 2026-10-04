import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
const output = resolve(process.env.ROOTS_CONSUMER_ARTIFACTS || 'artifacts/roots');
const fixture = JSON.parse(fs.readFileSync(join(output, 'fixture.json')));
const child = spawn(process.execPath, [join(output, 'snapshot/QA/start-live-driver.mjs')], {
  env: { ...process.env, ROOTS_CONSUMER_ARTIFACTS: output }, stdio: ['ignore','pipe','pipe'],
});
let stderr = '', stdout = '';
child.stderr.on('data', b => { stderr += b; });
const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(Error('Isolated Roots entrypoint did not start')), 20000);
  child.once('exit', (code) => { clearTimeout(timeout); reject(Error(`Launcher exited ${code}: ${stderr}`)); });
  child.stdout.on('data', b => {
    stdout += b;
    const line = stdout.split('\n').find(x => x.startsWith('{'));
    if (!line) return;
    try { const result = JSON.parse(line); clearTimeout(timeout); resolve(result); } catch {}
  });
});
let result;
try {
  const launch = await ready;
  const status = await (await fetch(new URL('/status', launch.viewerUrl))).json();
  const candidate = JSON.parse(fs.readFileSync(join(output, 'package.json')));
  assert.equal(status.driver.identity.runtime, `@browser-driver/runtime@${candidate.version}`);
  assert.equal(status.driver.identity.candidate.sha256, JSON.parse(fs.readFileSync(join(output, 'package.json'))).sha256);
  assert.equal(status.driver.state.id, 'home.connectivity');
  assert.equal(status.driver.descriptor.id, 'roots');
  result = { status: 'PASS', entrypoint: 'QA/start-live-driver.mjs', identity: status.driver.identity,
    observedState: status.driver.state, fixtureAttached: launch.fixtureAttached };
} finally {
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  child.kill('SIGTERM');
  const exit = await Promise.race([exited, new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 15000))]);
  assert.equal(exit.code, 0, `Launcher cleanup failed: ${JSON.stringify(exit)}`);
  const health = await fetch(fixture.origin + '/api/health');
  assert.equal(health.status, 200, 'Closing attached driver must preserve fixture services');
  if (result) { result.cleanup = exit; result.attachedFixtureHealthy = true; fs.writeFileSync(join(output, 'launcher-results.json'), JSON.stringify(result, null, 2)); }
}
console.log(JSON.stringify({ status: 'PASS', normalSnapshotEntrypoint: true, attachedFixturePreserved: true }));
