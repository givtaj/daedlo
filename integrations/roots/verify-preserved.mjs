import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
const source = resolve(process.env.ROOTS_SOURCE || '/Users/aidin/code/canvas/roots');
const output = resolve(process.env.ROOTS_CONSUMER_ARTIFACTS || 'artifacts/roots');
const before = JSON.parse(fs.readFileSync(join(output, 'live-before.json')));
const changed = Object.entries(before.trackedHashes).filter(([path, hash]) =>
  !fs.existsSync(join(source, path)) || createHash('sha256').update(fs.readFileSync(join(source, path))).digest('hex') !== hash).map(([path]) => path);
const status = execFileSync('git',['-C',source,'status','--porcelain','--untracked-files=all'],{encoding:'utf8'});
const head = execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
const result = { checkedAt:new Date().toISOString(), liveCheckout:source, baselineHead:before.head,currentHead:head,
  sourceHashesUnchanged:changed.length===0,gitStatusUnchanged:status===before.status,trackedFileCount:Object.keys(before.trackedHashes).length,
  observedConcurrentChanges:changed, writesByConsumerToLiveRoots:false,
  interpretation:changed.length ? 'Observed drift during parallel work; not restored or attributed to this consumer.' : 'All live tracked-file bytes match the pre-consumer inventory.' };
fs.writeFileSync(join(output,'live-after.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
