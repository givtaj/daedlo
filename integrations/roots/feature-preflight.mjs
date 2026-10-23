import fs from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { execFileSync } from 'node:child_process';
import { dependencyReceipt } from './dependency-receipt.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const json = path => JSON.parse(fs.readFileSync(path));
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const requiredConsumerFiles = ['edit/adapter.mjs', 'edit/consumer.mjs', 'write-effects.mjs', 'edit/engine/src/main.rs'];
function measuredFile(root, path, expected, label) {
  if (!digest(expected) || typeof path !== 'string' || path.includes('\\') ||
    path.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.')))
    throw Error(`Invalid ${label} receipt`);
  let current = root;
  for (const part of path.split('/')) {
    current = join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw Error(`${label} changed to a symlink`);
  }
  if (!fs.statSync(current).isFile() || hash(fs.readFileSync(current)) !== expected)
    throw Error(`${label} does not match its recorded receipt`);
  return expected;
}

function installedRuntimeReceipt(candidate, expectedArchive) {
  const lock = json(join(candidate, 'package-lock.json'));
  const names = ['@daedlo/runtime', '@browser-driver/runtime'].filter(name => lock.packages?.[`node_modules/${name}`]);
  if (names.length !== 1) throw Error('Candidate must contain exactly one supported runtime package');
  const runtimeName = names[0];
  const reference = lock.packages[`node_modules/${runtimeName}`].resolved;
  if (typeof reference !== 'string' || !reference.startsWith('file:')) throw Error('Runtime must resolve to an explicit local package archive');
  const archive = resolve(candidate, reference.slice(5));
  if (hash(fs.readFileSync(archive)) !== expectedArchive) throw Error('Runtime archive does not match its recorded receipt');
  const entries = execFileSync('tar', ['-tf', archive], { encoding: 'utf8', maxBuffer: 1024 * 1024 })
    .split('\n').filter(path => path && !path.endsWith('/'));
  const directory = join(candidate, 'node_modules', runtimeName), expected = [];
  for (const entry of entries) {
    if (!entry.startsWith('package/')) throw Error('Unsupported runtime archive layout');
    const path = entry.slice('package/'.length);
    if (expected.includes(path)) throw Error('Duplicate runtime archive entry');
    const bytes = execFileSync('tar', ['-xOf', archive, entry], { maxBuffer: 16 * 1024 * 1024 });
    measuredFile(directory, path, hash(bytes), 'Installed runtime file');
    expected.push(path);
  }
  const actual = [];
  function visit(path = '') {
    for (const name of fs.readdirSync(join(directory, path))) {
      const relative = path ? `${path}/${name}` : name, info = fs.lstatSync(join(directory, relative));
      if (info.isSymbolicLink()) throw Error('Installed runtime changed to a symlink');
      if (info.isDirectory()) visit(relative);
      else if (info.isFile()) actual.push(relative);
      else throw Error('Unsupported installed runtime file');
    }
  }
  visit();
  if (!expected.length || !isDeepStrictEqual(actual.sort(), expected.sort())) throw Error('Installed runtime file inventory mismatch');
  return { installedFiles: actual.length, archiveSha256: expectedArchive, packageLockSha256: hash(fs.readFileSync(join(candidate, 'package-lock.json'))) };
}

// Extracted from the acceptance launcher so provenance checks can fail before
// any application, container or browser resource is acquired.
export function preflightFeatureCandidate({ candidate, snapshotRoot, binaryDir }) {
  candidate = resolve(candidate); snapshotRoot = resolve(snapshotRoot); binaryDir = resolve(binaryDir);
  const identity = json(join(candidate, 'candidate.json'));
  const consumerFiles = identity.consumerFiles;
  if (!consumerFiles || !isDeepStrictEqual(Object.keys(consumerFiles).sort(), [...requiredConsumerFiles].sort()))
    throw Error('Consumer file receipt must cover the exact staged integration');
  for (const [path, expected] of Object.entries(consumerFiles)) measuredFile(candidate, path, expected, 'Consumer file');
  measuredFile(candidate, 'engine-target/debug/roots-edit-browser-driver-consumer', identity.engineSha256, 'Consumer engine');
  if (!digest(identity.runtimeArtifactSha256) || !digest(identity.sharedCrateSha256)) throw Error('Invalid candidate artifact receipt');
  const runtime = installedRuntimeReceipt(candidate, identity.runtimeArtifactSha256);

  const capture = dirname(snapshotRoot), applicationRoot = dirname(capture);
  const source = json(join(capture, 'source.json'));
  if (source.schemaVersion !== 1 || source.sourceKind !== 'verified-working-tree-overlay' ||
    !/^[a-f0-9]{40}$/.test(source.baseCommit) || !source.files || !Object.keys(source.files).length)
    throw Error('Invalid source receipt');
  const sourceDigest = hash(JSON.stringify({ baseCommit: source.baseCommit, files: source.files, archive: source.baseArchiveSha256 }));
  if (sourceDigest !== source.sourceDigest || !isDeepStrictEqual(identity.source, source))
    throw Error('Candidate source does not match the supplied snapshot receipt');
  measuredFile(capture, 'base.tar', source.baseArchiveSha256, 'Base archive');
  for (const [path, expected] of Object.entries(source.files)) measuredFile(snapshotRoot, path, expected, 'Captured source');

  const build = json(join(applicationRoot, 'application-build.json'));
  if (build.sourceDigest !== sourceDigest || build.sourceKind !== source.sourceKind || build.baseCommit !== source.baseCommit)
    throw Error('Application build source does not match the candidate source');
  if (!build.binaries || !isDeepStrictEqual(Object.keys(build.binaries).sort(), ['db', 'roots-api']))
    throw Error('Application binary receipt is incomplete');
  for (const [name, expected] of Object.entries(build.binaries)) measuredFile(binaryDir, name, expected, 'Application binary');

  const dependencies = dependencyReceipt(join(snapshotRoot, 'apps/web/node_modules'));
  if (!isDeepStrictEqual(dependencies, json(join(applicationRoot, 'dependency-receipt.json'))))
    throw Error('Copied dependency receipt mismatch');
  // Return only intentionally public provenance fields. These hashes identify
  // bytes; they do not claim that the reused dependencies were installed from lock.
  return {
    runtimeArtifactSha256: identity.runtimeArtifactSha256, sharedCrateSha256: identity.sharedCrateSha256,
    engineSha256: identity.engineSha256, consumerFiles,
    source: { schemaVersion: source.schemaVersion, sourceKind: source.sourceKind,
      baseCommit: source.baseCommit, ...(source.capturedAt ? { capturedAt: source.capturedAt } : {}),
      files: source.files, baseArchiveSha256: source.baseArchiveSha256, sourceDigest },
    preflight: { verified: true, checkedAt: new Date().toISOString(), sourceFiles: Object.keys(source.files).length,
      consumerFiles: Object.keys(consumerFiles).length,
      applicationBuild: { sourceDigest, sourceKind: build.sourceKind, baseCommit: build.baseCommit, binaries: build.binaries },
      dependencies, runtime },
  };
}
