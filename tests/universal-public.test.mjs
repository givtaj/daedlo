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
