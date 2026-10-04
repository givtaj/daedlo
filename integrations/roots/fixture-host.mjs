import fs from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const output = resolve(process.env.ROOTS_CONSUMER_ARTIFACTS || 'artifacts/roots');
const snapshot = join(output, 'snapshot');
const { createLiveFixture } = await import(pathToFileURL(join(snapshot, 'tools/live-qa/src/adapters/roots/fixture.mjs')));
const fixture = await createLiveFixture({ repo: snapshot, binaryDir: join(output, 'target/debug') });
fs.writeFileSync(join(output, 'fixture.json'), JSON.stringify({ ...fixture.manifest, hostPid: process.pid }, null, 2));
console.log(JSON.stringify({ status: 'ready', root: fixture.root, origin: fixture.origin, pid: process.pid }));
let stopping = false;
async function close() {
  if (stopping) return;
  stopping = true;
  try {
    await fixture.cleanup();
    fs.writeFileSync(join(output, 'fixture-cleanup.json'), JSON.stringify({ ok: true, root: fixture.root, at: new Date().toISOString() }, null, 2));
    process.exit(0);
  } catch (e) {
    fs.writeFileSync(join(output, 'fixture-cleanup.json'), JSON.stringify({ ok: false, error: fixture.redact(e.message) }, null, 2));
    process.exit(1);
  }
}
process.on('SIGTERM', close);
process.on('SIGINT', close);
await new Promise(() => {});
