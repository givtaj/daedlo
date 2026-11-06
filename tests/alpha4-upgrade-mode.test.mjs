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
    "duplicate alpha.8 flag",
    ["--alpha8-upgrade", "--alpha8-upgrade"],
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
  [
    "alpha.6 release mixed with local candidate mode",
    ["--alpha6-upgrade", "--local-candidate"],
    "0.1.4-alpha.5",
    "0.1.4-alpha.6",
    /Alpha.6 upgrade mode cannot use local-candidate or legacy-only/,
  ],
  [
    "partial alpha.6 release run",
    ["--alpha6-upgrade", "--legacy-only"],
    "0.1.4-alpha.5",
    "0.1.4-alpha.6",
    /Alpha.6 upgrade mode cannot use local-candidate or legacy-only/,
  ],
  [
    "unreviewed alpha.6 release baseline",
    ["--alpha6-upgrade"],
    "0.1.4-alpha.4",
    "0.1.4-alpha.6",
    /Alpha.6 upgrade mode requires the published alpha.5 baseline/,
  ],
  [
    "unreviewed alpha.6 release candidate",
    ["--alpha6-upgrade", "--production-https"],
    "0.1.4-alpha.5",
    "0.1.4-alpha.7",
    /Alpha.6 upgrade mode requires exactly 0.1.4-alpha.6/,
  ],
  [
    "alpha.7 release mixed with local candidate mode",
    ["--alpha7-upgrade", "--local-candidate"],
    "0.1.4-alpha.6",
    "0.1.4-alpha.7",
    /Alpha.7 upgrade mode cannot use local-candidate, alpha6-upgrade or legacy-only/,
  ],
  [
    "alpha.7 release mixed with alpha.6 mode",
    ["--alpha7-upgrade", "--alpha6-upgrade"],
    "0.1.4-alpha.6",
    "0.1.4-alpha.7",
    /Alpha.7 upgrade mode cannot use local-candidate, alpha6-upgrade or legacy-only/,
  ],
  [
    "partial alpha.7 release run",
    ["--alpha7-upgrade", "--legacy-only"],
    "0.1.4-alpha.6",
    "0.1.4-alpha.7",
    /Alpha.7 upgrade mode cannot use local-candidate, alpha6-upgrade or legacy-only/,
  ],
  [
    "unreviewed alpha.7 release baseline",
    ["--alpha7-upgrade"],
    "0.1.4-alpha.5",
    "0.1.4-alpha.7",
    /Alpha.7 upgrade mode requires the published alpha.6 baseline/,
  ],
  [
    "unreviewed alpha.7 release candidate",
    ["--alpha7-upgrade", "--production-https"],
    "0.1.4-alpha.6",
    "0.1.4-alpha.8",
    /Alpha.7 upgrade mode requires exactly 0.1.4-alpha.7/,
  ],
  ...[
    ["local candidate mode", "--local-candidate"],
    ["alpha.6 mode", "--alpha6-upgrade"],
    ["alpha.7 mode", "--alpha7-upgrade"],
    ["legacy-only mode", "--legacy-only"],
  ].map(([label, flag]) => [
    `alpha.8 release mixed with ${label}`,
    ["--alpha8-upgrade", flag],
    "0.1.4-alpha.7",
    "0.1.4-alpha.8",
    /Alpha.8 upgrade mode cannot use local-candidate, alpha6-upgrade, alpha7-upgrade or legacy-only/,
  ]),
  [
    "unreviewed alpha.8 release baseline",
    ["--alpha8-upgrade"],
    "0.1.4-alpha.6",
    "0.1.4-alpha.8",
    /Alpha.8 upgrade mode requires the published alpha.7 baseline/,
  ],
  [
    "unreviewed alpha.8 release candidate",
    ["--alpha8-upgrade", "--production-https"],
    "0.1.4-alpha.7",
    "0.1.4-alpha.9",
    /Alpha.8 upgrade mode requires exactly 0.1.4-alpha.8/,
  ],
  [
    "implicit alpha.7 baseline tools policy",
    [],
    "0.1.4-alpha.7",
    "0.1.4-alpha.8",
    /Published alpha.7 baseline requires explicit alpha.8 upgrade mode/,
  ],
  [
    "implicit alpha.6 baseline tools policy",
    [],
    "0.1.4-alpha.6",
    "0.1.4-alpha.4",
    /Published alpha.6 baseline requires explicit alpha.7 upgrade mode/,
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

for (const [label, args] of [
  ["local candidate", ["--local-candidate"]],
  ["alpha.6 release", ["--alpha6-upgrade"]],
]) {
  test(`${label} retains the independent published alpha.5 ZIP pin before any installation`, async (t) => {
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
      execute(process.execPath, [harness, ...args], {
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
    assert.equal(receipt.transport, "ephemeral-signed-feed");
    assert.equal(receipt.localCandidate, label === "local candidate");
    assert.equal(receipt.reusePublishedTools, true);
    assert.equal(
      receipt.toolsPolicy,
      "Keep exact published alpha.5 tools for baseline, upgrade, restart and rollback",
    );
    assert.match(receipt.error.message, /Exact public-kit ZIP pin/);
    assert.deepEqual(receipt.checks, []);
    assert.deepEqual(receipt.cleanup, []);
    assert.deepEqual(await fs.readdir(join(output, runs[0], "work")), []);
  });
}

for (const [version, baselineVersion] of [
  ["7", "6"],
  ["8", "7"],
]) {
  test(`alpha.${version} pins immutable alpha.${baselineVersion} and requires a separately verified new tools bootstrap`, async (t) => {
    const root = await fs.mkdtemp(join(tmpdir(), `alpha${version}-pin-test-`));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const baseline = join(root, "baseline"),
      output = join(root, "output");
    await fs.mkdir(baseline);
    await fs.writeFile(
      join(baseline, "release.json"),
      JSON.stringify({
        version: `0.1.4-alpha.${baselineVersion}`,
        source: { dirty: false },
        archive: {
          file: `daedlo-0.1.4-alpha.${baselineVersion}.zip`,
          sha256: "a".repeat(64),
          bytes: 0,
        },
      }),
    );
    await fs.writeFile(
      join(baseline, `daedlo-0.1.4-alpha.${baselineVersion}.zip`),
      "",
    );
    await assert.rejects(
      execute(process.execPath, [harness, `--alpha${version}-upgrade`], {
        env: {
          ...process.env,
          DAEDLO_UPGRADE_BASELINE: `0.1.4-alpha.${baselineVersion}`,
          DAEDLO_UPGRADE_CANDIDATE_VERSION: `0.1.4-alpha.${version}`,
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
    assert.equal(receipt.transport, "ephemeral-signed-feed");
    assert.equal(receipt[`alpha${version}Upgrade`], true);
    assert.equal(receipt.reusePublishedTools, false);
    assert.equal(
      receipt.toolsPolicy,
      "Verify candidate tools bootstrap before upgrading the accepted installation",
    );
    assert.match(receipt.error.message, /Exact public-kit ZIP pin/);
    assert.deepEqual(receipt.checks, []);
    assert.deepEqual(receipt.cleanup, []);
    assert.deepEqual(await fs.readdir(join(output, runs[0], "work")), []);
  });
}

for (const [label, args, baseline, candidate] of [
  ["alpha.3 to alpha.4", [], "0.1.4-alpha.3", "0.1.4-alpha.4"],
  ["alpha.3 to alpha.5", [], "0.1.4-alpha.3", "0.1.4-alpha.5"],
  ["alpha.4 to alpha.5", [], "0.1.4-alpha.4", "0.1.4-alpha.5"],
  ["legacy-only", ["--legacy-only"], "0.1.4-alpha.3", "0.1.4-alpha.5"],
  [
    "production alpha.3 to alpha.4",
    ["--production-https"],
    "0.1.4-alpha.3",
    "0.1.4-alpha.4",
  ],
  [
    "production alpha.4 to alpha.5",
    ["--production-https"],
    "0.1.4-alpha.4",
    "0.1.4-alpha.5",
  ],
  [
    "explicit alpha.6 production upgrade",
    ["--alpha6-upgrade", "--production-https"],
    "0.1.4-alpha.5",
    "0.1.4-alpha.6",
  ],
  [
    "explicit alpha.8 tools bootstrap",
    ["--alpha8-upgrade"],
    "0.1.4-alpha.7",
    "0.1.4-alpha.8",
  ],
  [
    "explicit alpha.8 production upgrade",
    ["--alpha8-upgrade", "--production-https"],
    "0.1.4-alpha.7",
    "0.1.4-alpha.8",
  ],
  [
    "explicit alpha.7 tools bootstrap",
    ["--alpha7-upgrade"],
    "0.1.4-alpha.6",
    "0.1.4-alpha.7",
  ],
  [
    "explicit alpha.7 production upgrade",
    ["--alpha7-upgrade", "--production-https"],
    "0.1.4-alpha.6",
    "0.1.4-alpha.7",
  ],
]) {
  test(`${label} reaches the required kit gate without acquiring resources`, async (t) => {
    const root = await fs.mkdtemp(join(tmpdir(), "alpha-upgrade-mode-test-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const output = join(root, "must-not-create");
    await assert.rejects(
      execute(process.execPath, [harness, ...args], {
        env: {
          ...process.env,
          DAEDLO_UPGRADE_BASELINE: baseline,
          DAEDLO_UPGRADE_CANDIDATE_VERSION: candidate,
          ALPHA4_LEGACY_KIT: "",
          ALPHA4_UPGRADE_OUTPUT: output,
        },
      }),
      (error) => {
        assert.match(error.stderr, /Set ALPHA4_LEGACY_KIT/);
        return true;
      },
    );
    await assert.rejects(fs.stat(output), { code: "ENOENT" });
  });
}
