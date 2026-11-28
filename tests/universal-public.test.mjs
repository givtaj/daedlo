import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("hosted Node lanes build, exercise and retain the isolated Universal HTTPS assets", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const build = workflow.indexOf("node scripts/release/universal-public.mjs");
  const sdk = workflow.indexOf(
    "$RUNNER_TEMP/universal-https/daedlo-engine-0.1.4-alpha.9.crate",
  );
  const live = workflow.indexOf(
    'node "$RUNNER_TEMP/universal-model/examples/universal-live/record.mjs"',
  );
  const upload = workflow.indexOf("name: daedlo-universal-");
  assert.ok(
    build > 0,
    "Universal release files must be assembled by the hosted consumer checks",
  );
  assert.ok(
    sdk > build && live > sdk,
    "Build the recipient model from the distributed crate before recording with the assembled packages",
  );
  assert.ok(
    upload > live,
    "Retain distributable files only after the installed live flow passes",
  );
  assert.match(
    workflow.slice(live, upload),
    /record\.mjs[^\n]*>"\$RUNNER_TEMP\/universal-smoke\.json"/,
    "Keep raw workspace paths and run identifiers out of public job output",
  );
});

test("the hosted recipient installs the frozen components, checks both npm shortcuts and uploads the nine release assets", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const start = workflow.indexOf(
    "- name: Exercise the packaged Universal live recording example",
  );
  const end = workflow.indexOf(
    "- name: Build an immutable candidate bundle",
    start,
  );
  const job = workflow.slice(start, end);
  assert.match(
    job,
    /npm install --prefix[^\n]+daedlo-universal-0\.1\.0-alpha\.7\.tgz[^\n]+daedlo-universal-runtime-0\.1\.0-alpha\.6\.tgz/,
  );
  assert.match(
    job,
    /npm install --global[^\n]+daedlo-universal-0\.1\.0-alpha\.7\.tgz/,
  );
  assert.match(job, /daedlo-universal --help/);
  assert.match(
    job,
    /node tests\/universal-installed-cli\.mjs "\$RUNNER_TEMP\/universal-smoke\.json"/,
  );
  assert.match(job, /name: daedlo-universal-0\.1\.0-alpha\.7-node/);
  const assets = Array.from(
    job.matchAll(/\$\{\{ runner\.temp \}\}\/universal-https\/(\S+)/g),
    (match) => match[1],
  );
  assert.deepEqual(
    assets.sort(),
    [
      "INSTALL.md",
      "SHA256SUMS",
      "UNIVERSAL_RUNTIME_VERIFICATION.json",
      "UNIVERSAL_SHA256SUMS",
      "UNIVERSAL_VERIFICATION.json",
      "daedlo-engine-0.1.4-alpha.9.crate",
      "daedlo-universal-0.1.0-alpha.7.tgz",
      "daedlo-universal-runtime-0.1.0-alpha.6.tgz",
      "release.json",
    ].sort(),
  );
});
