import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);

function composeJob() {
  const job = workflow
    .split("\n  compose:\n")[1]
    ?.split(/\n  [a-z][\w-]*:\n/)[0];
  assert.ok(
    job,
    "CI must run the Compose browser flow on native AMD64 and ARM64 runners",
  );
  return job;
}

test("Compose CI builds and runs both native architectures without emulation", () => {
  const job = composeJob();
  assert.match(job, /runs-on: \$\{\{ matrix\.runner \}\}/);
  assert.match(job, /fail-fast: false/);
  assert.match(job, /arch: amd64\n\s+runner: ubuntu-24\.04\n/);
  assert.match(job, /arch: arm64\n\s+runner: ubuntu-24\.04-arm\n/);
  assert.match(job, /EXPECTED_ARCH: \$\{\{ matrix\.arch \}\}/);
  assert.match(job, /node scripts\/compose-ci\.mjs preflight/);
  assert.match(job, /node scripts\/compose-ci\.mjs images/);
  assert.match(job, /npm run test:compose/);
  assert.match(job, /npx playwright install --with-deps chromium/);
  assert.doesNotMatch(job, /setup-qemu|continue-on-error:\s*true/);
  for (const action of ["checkout", "setup-node", "upload-artifact"])
    assert.match(job, new RegExp(`actions/${action}@[a-f0-9]{40}`));
});

test("Compose required statuses keep fail-closed full and light verification decisions", () => {
  const job = composeJob();
  assert.match(
    job,
    /needs: public-metadata\n\s+if: \$\{\{ !cancelled\(\) \}\}/,
  );
  const gate = job.match(
    /      - name: Require a successful Compose verification decision\n[\s\S]*?        run: \|\n([\s\S]*?)(?=      - name:)/,
  )?.[1];
  assert.ok(gate, "Compose checks must execute their own decision gate");
  const script = gate
    .split("\n")
    .map((line) => line.replace(/^          /, ""))
    .join("\n");
  for (const [metadata, selection, pass] of [
    ["success", "true", true],
    ["success", "false", true],
    ["failure", "false", false],
    ["cancelled", "true", false],
    ["skipped", "false", false],
    ["", "false", false],
    ["success", "", false],
    ["success", "unknown", false],
  ]) {
    const result = spawnSync("bash", ["-e", "-c", script], {
      env: {
        ...process.env,
        METADATA_RESULT: metadata,
        FULL_VERIFICATION: selection,
      },
      encoding: "utf8",
    });
    assert.equal(result.status === 0, pass, `${metadata}/${selection}`);
    if (pass && selection === "false") assert.match(result.stdout, /NOT RUN/);
  }
});

test("Compose CI always finalizes and uploads only its sanitized summary", () => {
  const job = composeJob();
  assert.match(
    job,
    /- name: Initialize sanitized Compose evidence\n\s+if:.*always\(\)/,
  );
  assert.match(
    job,
    /- name: Finalize sanitized Compose evidence\n\s+if:.*always\(\)/,
  );
  assert.match(
    job,
    /- name: Retain sanitized Compose evidence\n\s+if:.*always\(\)/,
  );
  assert.match(
    job,
    /CI_ACCEPTANCE_OUTCOME: \$\{\{ steps\.acceptance\.outcome \}\}/,
  );
  assert.match(job, /DAEDLO_COMPOSE_OUTPUT: artifacts\/compose-ci\/private/);
  assert.match(job, /path: artifacts\/compose-ci\/summary\.json\n/);
  assert.match(job, /if-no-files-found: error/);
  const upload = job.split("- name: Retain sanitized Compose evidence")[1];
  assert.doesNotMatch(upload, /compose\.log|session\.json|\.png|path:.*\*/);
});
