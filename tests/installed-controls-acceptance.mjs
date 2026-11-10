// Extend exact-package acceptance before its owned consumer is cleaned up.
// These are independent runtime fixtures, not customer application acceptance.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const sha256 = (path) =>
  createHash("sha256").update(fs.readFileSync(path)).digest("hex");

// Reuse the source assertions verbatim, changing only their runtime/fixture
// locations. Counts include Node's parent test wrappers, and forbid silent skips.
const suites = [
  ["installed-cli", "cli-factory-browser.mjs", 10, []],
  [
    "installed-publication-unit",
    "recipe-finalization.test.mjs",
    25,
    ["../src/session.mjs"],
  ],
  [
    "installed-publication-browser",
    "control-boundary-browser.mjs",
    9,
    ["../src/index.mjs"],
  ],
  [
    "installed-authorization-unit",
    "control-authorization.test.mjs",
    13,
    ["../src/session.mjs"],
  ],
  [
    "installed-authorization-browser",
    "control-authorization-acceptance.mjs",
    10,
    ["../packages/runtime/src/session.mjs"],
  ],
  [
    "installed-result-attribution",
    "viewer-result-attribution-browser.mjs",
    1,
    ["../src/viewer/server.mjs"],
  ],
  [
    "installed-result-session",
    "viewer-result-session-browser.mjs",
    1,
    ["../src/index.mjs"],
  ],
  [
    "installed-viewer-cleanup-unit",
    "viewer-cleanup.test.mjs",
    12,
    ["../src/viewer/server.mjs", "../src/resources.mjs"],
  ],
  ["installed-viewer-cleanup-browser", "viewer-cleanup-browser.mjs", 8, []],
  [
    "installed-stalled-finalization",
    "stalled-finalization.test.mjs",
    9,
    ["../src/session.mjs"],
  ],
  [
    "installed-cli-stalled-finalization",
    "cli-stalled-finalization.test.mjs",
    3,
    ["../src/index.mjs"],
  ],
  [
    "installed-scoped-finalization",
    "scoped-finalization.test.mjs",
    3,
    ["../src/session.mjs", "../src/resources.mjs"],
  ],
  [
    "installed-viewer-finalization",
    "viewer-finalization-browser.mjs",
    4,
    ["../src/index.mjs"],
  ],
  [
    "installed-resource-ownership",
    "resources.test.mjs",
    5,
    ["../src/resources.mjs"],
  ],
  ["installed-active-run", "active-run.test.mjs", 5, ["../src/session.mjs"]],
  [
    "installed-viewer-grid",
    "viewer-grid-browser.mjs",
    28,
    ["../src/viewer/server.mjs"],
  ],
  [
    "installed-viewer-restart",
    "viewer-restart-browser.mjs",
    1,
    ["../src/index.mjs"],
  ],
];

export async function runInstalledControls({
  repoRoot,
  work,
  installed,
  entry,
  output,
  run,
  source,
  version,
}) {
  assert.equal(entry, pathToFileURL(join(installed, "src/index.mjs")).href);
  assert.equal(
    JSON.parse(fs.readFileSync(join(installed, "package.json"))).version,
    version,
  );
  const evidence = join(output, "installed-controls");
  fs.mkdirSync(evidence); // Exclusive acquisition preserves prior receipts.
  const receipt = {
    schemaVersion: 1,
    status: "FAIL",
    testLevel:
      "exact installed runtime; real Chromium/HTTP and lifecycle fixtures",
    checks: [],
    provenance: {
      samePhysicalConsumer: true,
      publicRuntimeEntry: entry,
      consumerDirectory: work,
      installedRuntimeVersion: version,
      source,
      runtimeIndexSha256: sha256(join(installed, "src/index.mjs")),
      runtimeSessionSha256: sha256(join(installed, "src/session.mjs")),
      runtimeCliSha256: sha256(join(installed, "src/cli.mjs")),
      copiedChecks: [],
    },
  };
  try {
    const manifest = JSON.parse(
      fs.readFileSync(join(installed, "package.json")),
    );
    // The runtime exports an ESM import target, not a require target. Resolve
    // from the actual consumer, using the same conditions as the copied suites.
    receipt.provenance.resolvedPublicRuntimeEntry = (
      await run(
        "installed-public-runtime-resolution",
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `console.log(import.meta.resolve(${JSON.stringify(manifest.name)}));`,
        ],
        { cwd: work },
      )
    ).trim();
    assert.equal(
      receipt.provenance.resolvedPublicRuntimeEntry,
      entry,
      "Public runtime package must resolve to the exact installed entry",
    );
    const engine = join(work, "tests/fake-engine.mjs");
    fs.copyFileSync(
      join(repoRoot, "packages/runtime/tests/fake-engine.mjs"),
      engine,
      fs.constants.COPYFILE_EXCL,
    );
    fs.chmodSync(engine, 0o755);
    receipt.provenance.fakeEngineSha256 = sha256(engine);
    for (const [, name, , imports] of suites) {
      const original = join(
        repoRoot,
        name === "control-authorization-acceptance.mjs"
          ? "tests"
          : "packages/runtime/tests",
        name,
      );
      let text = fs.readFileSync(original, "utf8");
      const substitutions = imports.map((specifier) => ({
        kind: "public-runtime-import",
        from: JSON.stringify(specifier),
        to: JSON.stringify(manifest.name),
      }));
      if (name === "control-authorization-acceptance.mjs")
        substitutions.push({
          kind: "fixture-location",
          from: '"../packages/runtime/tests/fake-engine.mjs"',
          to: '"./fake-engine.mjs"',
        });
      if (name === "cli-stalled-finalization.test.mjs")
        substitutions.push({
          kind: "installed-cli-location",
          from: 'new URL("../src/cli.mjs", import.meta.url)',
          to: `new URL(${JSON.stringify(pathToFileURL(join(installed, "src/cli.mjs")).href)})`,
        });
      if (name === "viewer-restart-browser.mjs")
        substitutions.push({
          kind: "evidence-location",
          from: 'resolve("artifacts/dev-restart-alerts")',
          to: "resolve(process.env.VIEWER_RESTART_OUTPUT)",
        });
      for (const { from, to, kind } of substitutions) {
        assert.equal(
          text.split(from).length,
          2,
          `${name}: exactly one ${kind} substitution`,
        );
        text = text.replace(from, to);
      }
      const destination = join(work, "tests", name);
      fs.writeFileSync(destination, text, { flag: "wx" });
      fs.copyFileSync(
        destination,
        join(evidence, name),
        fs.constants.COPYFILE_EXCL,
      );
      receipt.provenance.copiedChecks.push({
        name,
        sourceSha256: sha256(original),
        consumerSha256: sha256(destination),
        importOnlySubstitution:
          substitutions.length > 0 &&
          substitutions.every(
            (value) => value.kind === "public-runtime-import",
          ),
        substitutions,
      });
    }
    for (const [name, file, expected] of suites) {
      const log = await run(
        name,
        process.execPath,
        ["--test", "--test-reporter=tap", join(work, "tests", file)],
        {
          cwd: work,
          env: {
            CLI_TEST_RUNTIME:
              file === "viewer-cleanup-browser.mjs"
                ? fileURLToPath(entry)
                : entry,
            CLI_TEST_BINARY: join(installed, "src/cli.mjs"),
            CLI_TEST_ENGINE: engine,
            CLI_TEST_EVIDENCE: join(evidence, "cli"),
            BROWSER_DRIVER_CONTROL_OUTPUT: join(evidence, "authorization"),
            RESULT_ATTRIBUTION_OUTPUT: join(evidence, "attribution"),
            RESULT_SESSION_OUTPUT: join(evidence, "attribution-session"),
            FINALIZATION_VIEWER_OUTPUT: join(evidence, "finalization-viewer"),
            VIEWER_GRID_OUTPUT: join(evidence, "viewer-grid"),
            VIEWER_RESTART_OUTPUT: join(evidence, "viewer-restart"),
          },
        },
      );
      const totals = Object.fromEntries(
        ["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(
          (field) => [
            field,
            Number(log.match(new RegExp(`^# ${field} (\\d+)$`, "m"))?.[1]),
          ],
        ),
      );
      assert.equal(totals.tests, expected, `${name}: every case must execute`);
      assert.equal(totals.pass, expected, `${name}: every case must pass`);
      for (const field of ["fail", "cancelled", "skipped", "todo"])
        assert.equal(totals[field], 0, `${name}: no ${field} cases`);
      receipt.checks.push({
        name,
        expected,
        ...totals,
        log: `logs/${name}.log`,
        logSha256: sha256(join(output, "logs", `${name}.log`)),
      });
    }
    for (const [file, field] of [
      ["index.mjs", "runtimeIndexSha256"],
      ["session.mjs", "runtimeSessionSha256"],
      ["cli.mjs", "runtimeCliSha256"],
    ])
      assert.equal(
        sha256(join(installed, "src", file)),
        receipt.provenance[field],
        `${file}: installed bytes must remain unchanged`,
      );
    receipt.status = "PASS";
    return {
      extendedChecks: receipt.checks,
      extendedProvenance: receipt.provenance,
    };
  } catch (error) {
    receipt.error = error.message;
    throw error;
  } finally {
    fs.writeFileSync(
      join(evidence, "results.json"),
      JSON.stringify(receipt, null, 2) + "\n",
      { flag: "wx" },
    );
  }
}
