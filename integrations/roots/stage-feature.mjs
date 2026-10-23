import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const [runtimeArg, crateArg, snapshotArg, targetArg] = process.argv.slice(2);
if (!targetArg) throw Error('Usage: node stage-feature.mjs RUNTIME_TGZ ENGINE_CRATE SNAPSHOT FRESH_TARGET');
const runtime = resolve(runtimeArg), crate = resolve(crateArg), snapshot = resolve(snapshotArg), target = resolve(targetArg);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const frameworkVersion = JSON.parse(fs.readFileSync(join(root, 'packages/runtime/package.json'))).version;
if (fs.existsSync(target)) throw Error('Staged candidate already exists; use a fresh target');
fs.mkdirSync(target, { recursive: true });
const hash = path => createHash('sha256').update(fs.readFileSync(path)).digest('hex');
fs.mkdirSync(join(target, 'edit/engine/src'), { recursive: true });
const files = ['edit/adapter.mjs', 'edit/consumer.mjs', 'write-effects.mjs', 'edit/engine/src/main.rs'];
for (const path of files) fs.copyFileSync(join(root, 'integrations/roots', path), join(target, path));
fs.mkdirSync(join(target, 'crate'));
execFileSync('tar', ['-xf', crate, '-C', join(target, 'crate')]);
const manifest = fs.readFileSync(join(root, 'integrations/roots/edit/engine/Cargo.toml'), 'utf8')
  .replace('../../../../crates/daedlo-engine', join(target, `crate/daedlo-engine-${frameworkVersion}`))
  .replace('../../../../artifacts/roots-edit-20261004/capture/snapshot/tools/browser-driver/engine', join(snapshot, 'tools/browser-driver/engine'));
fs.writeFileSync(join(target, 'edit/engine/Cargo.toml'), manifest);
fs.copyFileSync(join(root, 'integrations/roots/edit/engine/Cargo.lock'), join(target, 'edit/engine/Cargo.lock'));
execFileSync('cargo', ['build', '--locked', '--offline', '--manifest-path', join(target, 'edit/engine/Cargo.toml'), '--target-dir', join(target, 'engine-target')], { stdio: 'inherit' });
fs.writeFileSync(join(target, 'package.json'), JSON.stringify({ name: 'roots-edit-isolated-candidate', private: true, type: 'module' }, null, 2));
const dependencyDir = join(target, 'dependency-packages'), cache = join(target, 'npm-cache');
fs.mkdirSync(dependencyDir);
const dependencies = ['playwright-core', 'playwright'].map(name => {
  const path = join(root, 'node_modules', name), info = JSON.parse(fs.readFileSync(join(path, 'package.json')));
  const result = JSON.parse(execFileSync('npm', ['pack', path, '--json', '--ignore-scripts', '--cache', cache, '--pack-destination', dependencyDir], { encoding: 'utf8' }));
  if (result[0].version !== info.version) throw Error('Dependency package mismatch');
  return join(dependencyDir, result[0].filename);
});
execFileSync('npm', ['install', runtime, ...dependencies, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', cache], { cwd: target, stdio: 'inherit' });
const enginePath = join(target, 'engine-target/debug/roots-edit-browser-driver-consumer');
const identity = { runtimeArtifactSha256: hash(runtime), sharedCrateSha256: hash(crate), engineSha256: hash(enginePath),
  consumerFiles: Object.fromEntries(files.map(path => [path, hash(join(target, path))])),
  source: JSON.parse(fs.readFileSync(join(dirname(snapshot), 'source.json'))) };
fs.writeFileSync(join(target, 'candidate.json'), JSON.stringify(identity, null, 2) + '\n');
console.log(JSON.stringify({ target, enginePath, runtimeArtifactSha256: identity.runtimeArtifactSha256 }));
