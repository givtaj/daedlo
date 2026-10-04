import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { preflightFeatureCandidate } from '../feature-preflight.mjs';
import { dependencyReceipt } from '../dependency-receipt.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
function fixture(t) {
  const output = fs.mkdtempSync(join(os.tmpdir(), 'driver-preflight-test-'));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const snapshotRoot = join(output, 'capture/snapshot'), binaryDir = join(output, 'app-target/debug'), candidate = join(output, 'candidate');
  const put = (path, text) => { fs.mkdirSync(dirname(path), { recursive: true }); fs.writeFileSync(path, text); };
  const json = (path, value) => put(path, JSON.stringify(value));
  put(join(output, 'capture/base.tar'), 'baseline archive');
  put(join(snapshotRoot, 'apps/web/src/app.js'), 'verified application');
  put(join(snapshotRoot, 'apps/web/node_modules/example/index.js'), 'copied dependency');
  const source = { schemaVersion: 1, sourceKind: 'verified-working-tree-overlay', baseCommit: 'a'.repeat(40),
    files: { 'apps/web/src/app.js': hash('verified application') }, baseArchiveSha256: hash('baseline archive') };
  source.sourceDigest = hash(JSON.stringify({ baseCommit: source.baseCommit, files: source.files, archive: source.baseArchiveSha256 }));
  json(join(output, 'capture/source.json'), source);
  const binaries = Object.fromEntries(['roots-api', 'db'].map(name => {
    put(join(binaryDir, name), name + ' binary'); return [name, hash(name + ' binary')];
  }));
  json(join(output, 'application-build.json'), { sourceDigest: source.sourceDigest, sourceKind: source.sourceKind, baseCommit: source.baseCommit, binaries });
  json(join(output, 'dependency-receipt.json'), dependencyReceipt(join(snapshotRoot, 'apps/web/node_modules')));
  const consumerFiles = Object.fromEntries(['edit/adapter.mjs', 'edit/consumer.mjs', 'write-effects.mjs', 'edit/engine/src/main.rs'].map(path => {
    put(join(candidate, path), 'consumer ' + path); return [path, hash('consumer ' + path)];
  }));
  put(join(candidate, 'engine-target/debug/roots-edit-browser-driver-consumer'), 'compiled engine');
  put(join(output, 'runtime-package/package/src/index.mjs'), 'export const runtime = true;');
  put(join(output, 'runtime-package/package/package.json'), '{"name":"@browser-driver/runtime","version":"0.1.0"}');
  execFileSync('tar', ['-czf', join(output, 'runtime.tgz'), '-C', join(output, 'runtime-package'), 'package']);
  fs.cpSync(join(output, 'runtime-package/package'), join(candidate, 'node_modules/@browser-driver/runtime'), { recursive: true });
  json(join(candidate, 'package-lock.json'), { packages: { 'node_modules/@browser-driver/runtime': { resolved: 'file:../runtime.tgz' } } });
  json(join(candidate, 'candidate.json'), { source, consumerFiles, engineSha256: hash('compiled engine'),
    runtimeArtifactSha256: hash(fs.readFileSync(join(output, 'runtime.tgz'))), sharedCrateSha256: hash('crate archive') });
  return { output, snapshotRoot, binaryDir, candidate, put, json };
}

for (const [name, target] of [
  ['staged adapter', f => join(f.candidate, 'edit/adapter.mjs')],
  ['staged engine', f => join(f.candidate, 'engine-target/debug/roots-edit-browser-driver-consumer')],
  ['captured source', f => join(f.snapshotRoot, 'apps/web/src/app.js')],
  ['application binary', f => join(f.binaryDir, 'roots-api')],
  ['copied dependency', f => join(f.snapshotRoot, 'apps/web/node_modules/example/index.js')],
  ['base archive', f => join(f.output, 'capture/base.tar')],
  ['installed runtime', f => join(f.candidate, 'node_modules/@browser-driver/runtime/src/index.mjs')],
  ['runtime archive', f => join(f.output, 'runtime.tgz')],
]) test(`stale ${name} receipt rejects before fixture acquisition`, t => {
  const f = fixture(t); f.put(target(f), 'changed after receipt');
  assert.throws(() => preflightFeatureCandidate(f), /does not match|changed|mismatch/i);
});

test('an application build from another source is rejected', t => {
  const f = fixture(t), path = join(f.output, 'application-build.json');
  const build = JSON.parse(fs.readFileSync(path)); build.sourceDigest = 'b'.repeat(64); f.json(path, build);
  assert.throws(() => preflightFeatureCandidate(f), /source.*match|source.*mismatch/i);
});

test('missing required consumer receipt cannot silently reduce verification coverage', t => {
  const f = fixture(t), path = join(f.candidate, 'candidate.json');
  const candidate = JSON.parse(fs.readFileSync(path)); delete candidate.consumerFiles['write-effects.mjs']; f.json(path, candidate);
  assert.throws(() => preflightFeatureCandidate(f), /consumer.*receipt/i);
});

test('matching captured bytes extend the safe result identity', t => {
  const f = fixture(t), identity = preflightFeatureCandidate(f);
  assert.equal(identity.preflight.verified, true);
  assert.equal(identity.preflight.sourceFiles, 1);
  assert.equal(identity.preflight.consumerFiles, 4);
  assert.equal(identity.preflight.applicationBuild.sourceDigest, identity.source.sourceDigest);
  assert.equal(identity.preflight.dependencies.installedFromLockVerified, false);
  assert.equal(JSON.stringify(identity).includes(f.output), false);
});
