import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
// Records the frozen installed dependency bytes. A matching lockfile alone is
// not evidence that a mutable installation was produced from that lockfile.
export function dependencyReceipt(directory) {
  const digest = createHash('sha256');
  let files = 0;
  function visit(relative) {
    const path = join(directory, relative);
    for (const name of fs.readdirSync(path).sort()) {
      const child = join(path, name), local = join(relative, name), stat = fs.lstatSync(child);
      if (stat.isSymbolicLink()) {
        digest.update(local + '\0link\0' + fs.readlinkSync(child) + '\0');
      } else if (stat.isDirectory()) visit(local);
      else if (stat.isFile()) {
        files++; digest.update(local + '\0'); digest.update(fs.readFileSync(child)); digest.update('\0');
      }
    }
  }
  visit('');
  return { kind: 'copied-installed-dependencies', files, sha256: digest.digest('hex'), installedFromLockVerified: false };
}
