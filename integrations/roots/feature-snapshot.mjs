import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';

// The existing candidate preparation starts from a committed archive. Feature
// receipts will add an explicitly selected, verified source overlay.
export function captureFeatureSnapshot({ source, output, baseCommit, files }) {
  source = resolve(source); output = resolve(output);
  if (output === source || output.startsWith(source + '/')) throw Error('Capture must be outside the source checkout');
  if (fs.existsSync(output)) throw Error('Capture already exists; choose a fresh output directory');
  if (!/^[a-f0-9]{40}$/.test(baseCommit)) throw Error('A full pinned base commit is required');
  const resolved = execFileSync('git', ['-C', source, 'rev-parse', `${baseCommit}^{commit}`], { encoding: 'utf8' }).trim();
  if (resolved !== baseCommit) throw Error('Pinned commit does not match');
  if (!files || !Object.keys(files).length) throw Error('A nonempty reviewed source receipt is required');
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const captured = [];
  for (const [path, expected] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const parts = path.split('/');
    if (parts.some(p => !p || p === '.' || p === '..' || p.startsWith('.')) || path.includes('\\') ||
        !/^(apps\/(api\/(src|migrations)|web\/src)\/|tools\/browser-driver\/(engine\/src|runtime\/src)\/|QA\/(ux\.rs|journal-(edit-)?acceptance(?:-fixture)?\.mjs|journal-edit-extended\.mjs)$)/.test(path))
      throw Error(`Unsupported source path: ${path}`);
    if (!/^[a-f0-9]{64}$/.test(expected)) throw Error(`Invalid source digest: ${path}`);
    let current = source;
    for (const part of parts) {
      current = join(current, part);
      if (fs.lstatSync(current).isSymbolicLink()) throw Error(`Unsupported source path: ${path}`);
    }
    const bytes = fs.readFileSync(current);
    if (hash(bytes) !== expected) throw Error(`Source changed since verification: ${path}`);
    captured.push({ path, bytes, expected });
  }
  let ancestor = dirname(output);
  while (!fs.existsSync(ancestor)) ancestor = dirname(ancestor);
  const physicalSource = fs.realpathSync(source), physicalParent = fs.realpathSync(ancestor);
  if (physicalParent === physicalSource || physicalParent.startsWith(physicalSource + '/')) throw Error('Capture must be outside the source checkout');
  fs.mkdirSync(dirname(output), { recursive: true });
  // Exclusive acquisition: cleanup below may only remove a directory we created.
  fs.mkdirSync(output);
  const snapshot = join(output, 'snapshot');
  try {
    fs.mkdirSync(snapshot);
    const archive = join(output, 'base.tar');
    execFileSync('git', ['-C', source, 'archive', '--format=tar', '--output', archive, baseCommit]);
    execFileSync('tar', ['-xf', archive, '-C', snapshot]);
    for (const item of captured) {
      let current = snapshot;
      for (const part of item.path.split('/')) {
        current = join(current, part);
        if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw Error(`Snapshot symlink refused: ${item.path}`);
      }
      fs.mkdirSync(dirname(current), { recursive: true });
      fs.writeFileSync(current, item.bytes);
    }
    const manifest = { schemaVersion: 1, sourceKind: 'verified-working-tree-overlay', baseCommit,
      capturedAt: new Date().toISOString(), files: Object.fromEntries(captured.map(x => [x.path, x.expected])),
      baseArchiveSha256: hash(fs.readFileSync(archive)) };
    manifest.sourceDigest = hash(JSON.stringify({ baseCommit, files: manifest.files, archive: manifest.baseArchiveSha256 }));
    fs.writeFileSync(join(output, 'source.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    return { ...manifest, snapshot };
  } catch (error) {
    fs.rmSync(output, { recursive: true, force: true });
    throw error;
  }
}
