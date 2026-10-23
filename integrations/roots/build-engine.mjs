import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const [archive] = process.argv.slice(2);
if (!archive) throw Error('Usage: node integrations/roots/build-engine.mjs /absolute/engine.crate');
const frameworkVersion = JSON.parse(fs.readFileSync(new URL('../../packages/runtime/package.json', import.meta.url))).version;
const output = resolve(process.env.ROOTS_CONSUMER_ARTIFACTS || 'artifacts/roots');
const packageRoot = join(output, 'engine-package');
fs.mkdirSync(packageRoot, { recursive: true });
execFileSync('tar', ['-xf', resolve(archive), '-C', packageRoot]);
const engine = join(output, 'snapshot/browser-driver-consumer/engine');
fs.mkdirSync(join(engine, 'src'), { recursive: true });
const source = fileURLToPath(new URL('./engine/', import.meta.url));
fs.copyFileSync(join(source, 'src/main.rs'), join(engine, 'src/main.rs'));
const manifest = fs.readFileSync(join(source, 'Cargo.toml'), 'utf8')
  .replace('../../../crates/daedlo-engine', join(packageRoot, `daedlo-engine-${frameworkVersion}`))
  .replace('../../../artifacts/roots/snapshot/tools/qa-driver', join(output, 'snapshot/tools/qa-driver'));
fs.writeFileSync(join(engine, 'Cargo.toml'), manifest);
execFileSync('cargo', ['build','--offline','--manifest-path',join(engine,'Cargo.toml')], { env: { ...process.env, CARGO_TARGET_DIR: join(output,'engine-target') }, stdio: 'inherit' });
const hash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
fs.writeFileSync(join(output,'engine-package.json'), JSON.stringify({ artifact: resolve(archive), sha256: hash(archive), sourceSha256: hash(join(engine,'src/main.rs')), binarySha256: hash(join(output,'engine-target/debug/roots-browser-driver-consumer')), baseline: 'd4008e39aeaa137bb54ff48ca2d11748083a971a' }, null, 2));
