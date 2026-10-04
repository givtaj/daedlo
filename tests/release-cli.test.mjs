import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
const cli = resolve("scripts/release/cli.mjs");
const invoke = (args) =>
  spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
test("rejects unknown commands and flags instead of reporting an operation succeeded", () => {
  for (const args of [
    ["publish"],
    ["update", "--everything"],
    ["status", "--store"],
    ["build", "--out", "one", "--out", "two"],
  ]) {
    const result = invoke(args);
    assert.notEqual(result.status, 0, JSON.stringify(args));
    assert.match(result.stderr, /Usage|Unknown|Missing|Duplicate/i);
  }
});
test("requires the selected release digest before creating an update store", async (t) => {
  const parent = await fs.mkdtemp(join(tmpdir(), "driver-release-cli-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const store = join(parent, "store");
  const result = invoke(["update", "--store", store, "--bundle", parent]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /sha256/i);
  await assert.rejects(fs.stat(store), { code: "ENOENT" });
});
test("help describes preparation and does not offer automatic customer modification", () => {
  const result = invoke(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /build/);
  assert.match(result.stdout, /rollback/);
  assert.match(result.stdout, /customer|Roots/);
});
test("preserves explicit path traversal for store validation instead of normalizing it away", async (t) => {
  const parent = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "driver-release-cli-path-")),
  );
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const result = invoke(["status", "--store", `${parent}/nested/../store`]);
  assert.notEqual(
    result.status,
    0,
    "Traversal must be rejected before returning an empty store",
  );
  assert.match(result.stderr, /traversal/);
});
test("version command reaches semantic-version validation without accepting a downgrade", () => {
  const result = invoke(["version", "--next", "0.0.0"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /newer|greater|increase/i);
});
test("reports retained recovery handles when an operation fails to clean up", () => {
  const script = `
    import fs from 'node:fs/promises';
    fs.lstat = async () => { throw Object.assign(new Error('Incomplete cleanup'), {
      rollbackFailed: [{file: 'Cargo.toml', backup: '/private/tmp/owned-version-backup'}],
      cleanupFailed: ['/private/tmp/owned-version-staged']
    }); };
    process.argv = [process.execPath, ${JSON.stringify(cli)}, 'status', '--store', '/private/tmp/owned-fixture'];
    await import(${JSON.stringify(pathToFileURL(cli).href)});
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /owned-version-backup/);
  assert.match(result.stderr, /owned-version-staged/);
});
