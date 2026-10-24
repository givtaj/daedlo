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
