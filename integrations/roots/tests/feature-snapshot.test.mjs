import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { captureFeatureSnapshot } from '../feature-snapshot.mjs';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(join(os.tmpdir(), 'driver-snapshot-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source'), output = join(root, 'capture');
  fs.mkdirSync(join(source, 'apps/web/src'), { recursive: true });
  fs.writeFileSync(join(source, 'apps/web/src/app.js'), 'baseline');
  fs.writeFileSync(join(source, 'README.md'), 'baseline docs');
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
  git(['init', '-q']); git(['add', '.']);
  git(['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'baseline']);
  const baseCommit = git(['rev-parse', 'HEAD']);
  fs.writeFileSync(join(source, 'apps/web/src/app.js'), 'reviewed feature');
  fs.writeFileSync(join(source, 'README.md'), 'unrelated dirty work');
  fs.writeFileSync(join(source, '.env'), 'PRIVATE_TEST_SENTINEL');
  const files = { 'apps/web/src/app.js': digest('reviewed feature') };
  return { root, source, output, baseCommit, files };
}
test('frozen feature includes only receipt-verified changes over its pinned base', t => {
  const f = fixture(t);
  const captured = captureFeatureSnapshot(f);
  assert.equal(fs.readFileSync(join(captured.snapshot, 'apps/web/src/app.js'), 'utf8'), 'reviewed feature');
  assert.equal(fs.readFileSync(join(captured.snapshot, 'README.md'), 'utf8'), 'baseline docs');
  assert.equal(fs.existsSync(join(captured.snapshot, '.env')), false);
  fs.writeFileSync(join(f.source, 'apps/web/src/app.js'), 'later change');
  assert.equal(fs.readFileSync(join(captured.snapshot, 'apps/web/src/app.js'), 'utf8'), 'reviewed feature');
  assert.equal(captured.sourceKind, 'verified-working-tree-overlay');
  assert.equal(captured.files['apps/web/src/app.js'], f.files['apps/web/src/app.js']);
  assert.throws(() => captureFeatureSnapshot(f), /already exists/);
});
test('mismatched receipt refuses before creating output', t => {
  const f = fixture(t); f.files['apps/web/src/app.js'] = digest('old');
  assert.throws(() => captureFeatureSnapshot(f), /Source changed/);
  assert.equal(fs.existsSync(f.output), false);
});
test('private paths and path escapes are refused before source reads', t => {
  const f = fixture(t);
  for (const path of ['.env', '../outside', 'apps/web/src/.env', 'QA/evidence/session.json']) {
    assert.throws(() => captureFeatureSnapshot({ ...f, files: { [path]: digest('x') } }), /Unsupported source path/);
  }
  assert.equal(fs.existsSync(f.output), false);
});
test('capture refuses a destination inside the source checkout', t => {
  const f = fixture(t);
  assert.throws(() => captureFeatureSnapshot({ ...f, output: join(f.source, 'capture') }), /outside the source/);
  assert.equal(fs.existsSync(join(f.source, 'capture')), false);
});
