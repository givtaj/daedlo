import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { captureFeatureSnapshot } from './feature-snapshot.mjs';
import { dependencyReceipt } from './dependency-receipt.mjs';

const [sourceArg, appReceipt, controllerReceipt, outputArg] = process.argv.slice(2);
if (!outputArg) throw Error('Usage: node prepare-feature.mjs SOURCE APP_RECEIPT CONTROLLER_RECEIPT FRESH_OUTPUT');
const source = resolve(sourceArg), output = resolve(outputArg);
const app = JSON.parse(fs.readFileSync(resolve(appReceipt))), controller = JSON.parse(fs.readFileSync(resolve(controllerReceipt)));
const captured = captureFeatureSnapshot({ source, output: join(output, 'capture'), baseCommit: app.commit,
  files: { ...app.hashes, ...app.acceptanceFiles, ...controller.hashes } });
const snapshot = captured.snapshot;
const web = 'apps/web';
if (!fs.readFileSync(join(source, web, 'package-lock.json')).equals(fs.readFileSync(join(snapshot, web, 'package-lock.json')))) throw Error('Installed web dependency lock differs from frozen source');
fs.cpSync(join(source, web, 'node_modules'), join(snapshot, web, 'node_modules'), { recursive: true, dereference: true });
fs.writeFileSync(join(output, 'dependency-receipt.json'), JSON.stringify(dependencyReceipt(join(snapshot, web, 'node_modules')), null, 2) + '\n');
execFileSync('cargo', ['build', '--locked', '--offline', '--manifest-path', join(snapshot, 'Cargo.toml'), '-p', 'roots-api', '--features', 'db-tools', '--bin', 'roots-api', '--bin', 'db', '--target-dir', join(output, 'app-target')], { stdio: 'inherit' });
const hash = path => createHash('sha256').update(fs.readFileSync(path)).digest('hex');
fs.writeFileSync(join(output, 'application-build.json'), JSON.stringify({ sourceDigest: captured.sourceDigest,
  sourceKind: captured.sourceKind, baseCommit: captured.baseCommit, binaries: Object.fromEntries(['roots-api','db'].map(name => [name, hash(join(output, 'app-target/debug', name))])) }, null, 2) + '\n');
console.log(JSON.stringify({ snapshot, sourceKind: captured.sourceKind, sourceDigest: captured.sourceDigest }));
