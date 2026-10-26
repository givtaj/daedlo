import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
const harness = join(
  dirname(fileURLToPath(import.meta.url)),
  "alpha4-upgrade-acceptance.mjs",
);
for (const [label, args, pattern] of [
  ["unknown mode", ["--production"], /Unsupported upgrade acceptance argument/],
  [
    "arbitrary feed override",
    [
      "--production-https",
      "--catalog-url=https://untrusted.example.test/feed.json",
    ],
    /Unsupported upgrade acceptance argument/,
  ],
  [
    "duplicate production flag",
    ["--production-https", "--production-https"],
    /Duplicate upgrade acceptance argument/,
  ],
  [
    "partial production run",
    ["--production-https", "--legacy-only"],
    /Production HTTPS acceptance requires the complete upgrade drill/,
  ],
]) {
  test(`upgrade mode rejects ${label} before acquiring resources`, async (t) => {
    const root = await fs.mkdtemp(join(tmpdir(), "alpha4-mode-test-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const output = join(root, "must-not-create");
    await assert.rejects(
      execute(process.execPath, [harness, ...args], {
        env: {
          ...process.env,
          ALPHA4_LEGACY_KIT: join(root, "not-read"),
          ALPHA4_CANDIDATE_KIT: join(root, "not-read"),
          ALPHA4_CANDIDATE_SHA256: "a".repeat(64),
          ALPHA4_UPGRADE_OUTPUT: output,
        },
      }),
      (error) => {
        assert.match(error.stderr, pattern);
        return true;
      },
    );
    await assert.rejects(fs.stat(output), { code: "ENOENT" });
  });
}

for (const [label, args, baseline, candidate, pattern] of [
  [
    "local candidate against production",
    ["--local-candidate", "--production-https"],
    "0.1.4-alpha.5",
    "0.1.4-alpha.6",
    /Local candidate mode cannot use production HTTPS or legacy-only/,
  ],
  [
    "partial local candidate run",
    ["--local-candidate", "--legacy-only"],
    "0.1.4-alpha.5",
    "0.1.4-alpha.6",
    /Local candidate mode cannot use production HTTPS or legacy-only/,
  ],
  [
    "unreviewed local baseline",
    ["--local-candidate"],
    "0.1.4-alpha.4",
    "0.1.4-alpha.6",
    /Local candidate mode requires the published alpha.5 baseline/,
  ],
  [
    "unreviewed local candidate version",
    ["--local-candidate"],
    "0.1.4-alpha.5",
    "0.1.4-alpha.7",
    /Local candidate mode requires exactly 0.1.4-alpha.6/,
  ],
  [
    "local version without local mode",
    [],
    "0.1.4-alpha.5",
    "0.1.4-alpha.6",
    /Only the reviewed renamed candidate release may be selected/,
  ],
  [
    "local version in production",
    ["--production-https"],
    "0.1.4-alpha.5",
    "0.1.4-alpha.6",
    /Only the reviewed renamed candidate release may be selected/,
  ],
]) {
  test(`upgrade mode rejects ${label} before acquiring resources`, async (t) => {
    const root = await fs.mkdtemp(join(tmpdir(), "alpha4-local-mode-test-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const output = join(root, "must-not-create");
    await assert.rejects(
      execute(process.execPath, [harness, ...args], {
        env: {
          ...process.env,
          DAEDLO_UPGRADE_BASELINE: baseline,
          DAEDLO_UPGRADE_CANDIDATE_VERSION: candidate,
          ALPHA4_LEGACY_KIT: join(root, "not-read"),
          ALPHA4_CANDIDATE_KIT: join(root, "not-read"),
          ALPHA4_CANDIDATE_SHA256: "a".repeat(64),
          ALPHA4_UPGRADE_OUTPUT: output,
        },
      }),
      (error) => {
        assert.match(error.stderr, pattern);
        return true;
      },
    );
    await assert.rejects(fs.stat(output), { code: "ENOENT" });
  });
}

test("local candidate retains the independent published alpha.5 ZIP pin before any installation", async (t) => {
  const root = await fs.mkdtemp(join(tmpdir(), "alpha5-pin-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const baseline = join(root, "baseline"),
    output = join(root, "output");
  await fs.mkdir(baseline);
  await fs.writeFile(
    join(baseline, "release.json"),
    JSON.stringify({
      version: "0.1.4-alpha.5",
      source: { dirty: false },
      archive: {
        file: "daedlo-0.1.4-alpha.5.zip",
        sha256: "a".repeat(64),
        bytes: 0,
      },
    }),
  );
  await fs.writeFile(join(baseline, "daedlo-0.1.4-alpha.5.zip"), "");
  await assert.rejects(
    execute(process.execPath, [harness, "--local-candidate"], {
      env: {
        ...process.env,
        DAEDLO_UPGRADE_BASELINE: "0.1.4-alpha.5",
        DAEDLO_UPGRADE_CANDIDATE_VERSION: "0.1.4-alpha.6",
        ALPHA4_LEGACY_KIT: baseline,
        ALPHA4_LEGACY_SHA256: "a".repeat(64),
        ALPHA4_CANDIDATE_KIT: join(root, "candidate-must-not-read"),
        ALPHA4_CANDIDATE_SHA256: "b".repeat(64),
        ALPHA4_UPGRADE_OUTPUT: output,
      },
    }),
  );
  const runs = await fs.readdir(output);
  assert.equal(runs.length, 1);
  const receipt = JSON.parse(
    await fs.readFile(join(output, runs[0], "result.json"), "utf8"),
  );
  assert.equal(receipt.status, "FAIL");
  assert.match(receipt.error.message, /Exact public-kit ZIP pin/);
  assert.deepEqual(receipt.checks, []);
  assert.deepEqual(receipt.cleanup, []);
  assert.deepEqual(await fs.readdir(join(output, runs[0], "work")), []);
});
