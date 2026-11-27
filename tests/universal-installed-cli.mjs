import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Consume the existing live smoke receipt so this exercises a real saved run
// without starting a second browser or replaying the application save.
const [cli, receiptFile] = process.argv.slice(2);
const { workspace, target, runId } = JSON.parse(readFileSync(receiptFile));
const run = (...args) =>
  execFileSync(process.execPath, [cli, ...args], { encoding: "utf8" });
const result = (...args) => JSON.parse(run(...args));
const history = (root, ...args) =>
  result("history", "--workspace", root, "--target", target, ...args);

assert.match(run("--help"), /^Daedlo Universal \(optional installation\)/);
const before = history(workspace);
assert.equal(before.items.length, 1);
assert.equal(before.items[0].runId, runId);
const detail = history(workspace, "--run", runId);
assert.equal(detail.historyComplete, true);

const temp = realpathSync(mkdtempSync(join(tmpdir(), "daedlo-installed-cli-")));
try {
  const backup = join(temp, "backup");
  const restored = join(temp, "restored");
  const saved = result("backup", "--workspace", workspace, "--output", backup);
  assert.match(saved.sha256, /^[a-f0-9]{64}$/);
  const verified = result("verify-backup", "--backup", backup);
  assert.equal(verified.sha256, saved.sha256);
  const restoredReceipt = result(
    "restore",
    "--backup",
    backup,
    "--workspace",
    restored,
  );
  assert.equal(restoredReceipt.restored, true);
  assert.equal(restoredReceipt.backupId, saved.backupId);
  assert.deepEqual(history(restored), before);
  assert.deepEqual(history(restored, "--run", runId), detail);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
console.log(
  "Installed CLI help, saved history, verified backup and restored run passed.",
);
