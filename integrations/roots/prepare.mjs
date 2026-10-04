import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
const source = resolve(process.env.ROOTS_SOURCE || '/Users/aidin/code/canvas/roots');
const output = resolve(process.env.ROOTS_CONSUMER_ARTIFACTS || 'artifacts/roots');
const pinned = 'd4008e39aeaa137bb54ff48ca2d11748083a971a';
const snapshot = join(output, 'snapshot');
if (fs.existsSync(snapshot)) throw Error('Snapshot already exists; select a fresh ROOTS_CONSUMER_ARTIFACTS directory');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(join(output, '.gitignore'), '*\n!.gitignore\n');
const git = args => execFileSync('git', ['-C',source,...args]);
const status = git(['status','--porcelain','--untracked-files=all']).toString();
const trackedHashes = Object.fromEntries(git(['ls-files','-z']).toString().split('\0').filter(Boolean)
  .filter(p => fs.statSync(join(source,p)).isFile()).map(p => [p,createHash('sha256').update(fs.readFileSync(join(source,p))).digest('hex')]));
fs.writeFileSync(join(output,'live-before.json'),JSON.stringify({ head:git(['rev-parse','HEAD']).toString().trim(),status,trackedHashes },null,2));
const archive = join(output,'baseline.tar');
git(['archive','--format=tar','--output',archive,pinned]);
fs.mkdirSync(snapshot);
execFileSync('tar',['-xf',archive,'-C',snapshot]);
execFileSync('git',['init','-q',snapshot]);
execFileSync('git',['-C',snapshot,'fetch','--quiet','--no-tags','--depth=1',source,pinned]);
execFileSync('git',['-C',snapshot,'reset','--mixed','--quiet',pinned]);
// git archive expands this export-subst placeholder. Restore the committed
// metadata before the fixture's clean-source check; the fixture archives again.
fs.writeFileSync(join(snapshot,'roots-starter.json'),git(['show',`${pinned}:roots-starter.json`]));
for (const path of ['apps/web/node_modules','tools/live-qa/node_modules']) {
  if (!fs.existsSync(join(source,path))) throw Error(`Pinned dependency installation required: ${path}`);
  const lock = path.replace('/node_modules','/package-lock.json');
  if (!git(['show',`${pinned}:${lock}`]).equals(fs.readFileSync(join(source,lock)))) throw Error(`Live lockfile differs from pinned baseline: ${lock}`);
  fs.cpSync(join(source,path),join(snapshot,path),{ recursive:true,dereference:true });
}
fs.writeFileSync(join(output,'source.json'),JSON.stringify({ rootsBaseline:pinned,archiveSha256:createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),snapshot,liveCheckout:source,dirtyLiveTreePreserved:true },null,2));
execFileSync('cargo',['build','--locked','--offline','--manifest-path',join(snapshot,'Cargo.toml'),'-p','roots-cli','-p','roots-api','--features','db-tools','--bin','roots-cli','--bin','roots-api','--bin','db'], { env:{...process.env,CARGO_TARGET_DIR:join(output,'target')},stdio:'inherit' });
console.log(JSON.stringify({snapshot,rootsBaseline:pinned}));
