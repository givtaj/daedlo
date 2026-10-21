// Extend exact-package acceptance before its owned consumer is cleaned up.
// These are independent runtime fixtures, not customer application acceptance.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const sha256 = (path) =>
  createHash("sha256").update(fs.readFileSync(path)).digest("hex");

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
    const engine = join(work, "tests/fake-engine.mjs");
    fs.copyFileSync(
      join(repoRoot, "packages/runtime/tests/fake-engine.mjs"),
      engine,
      fs.constants.COPYFILE_EXCL,
    );
    fs.chmodSync(engine, 0o755);
    receipt.provenance.fakeEngineSha256 = sha256(engine);
    for (const [name, sourceImport] of [
      ["cli-factory-browser.mjs", null],
      ["recipe-finalization.test.mjs", '"../src/session.mjs"'],
      ["control-boundary-browser.mjs", '"../src/index.mjs"'],
    ]) {
      const original = join(repoRoot, "packages/runtime/tests", name);
      let text = fs.readFileSync(original, "utf8");
      if (sourceImport) {
        assert.equal(
          text.split(sourceImport).length,
          2,
          `${name}: exactly one public runtime import substitution`,
        );
        text = text.replace(sourceImport, '"@browser-driver/runtime"');
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
        importOnlySubstitution: sourceImport !== null,
      });
    }
    for (const [name, file, expected] of [
      ["installed-cli", "cli-factory-browser.mjs", 10],
      ["installed-publication-unit", "recipe-finalization.test.mjs", 25],
      ["installed-publication-browser", "control-boundary-browser.mjs", 9],
    ]) {
      const log = await run(
        name,
        process.execPath,
        ["--test", "--test-reporter=tap", join(work, "tests", file)],
        {
          cwd: work,
          env: {
            CLI_TEST_RUNTIME: entry,
            CLI_TEST_BINARY: join(installed, "src/cli.mjs"),
            CLI_TEST_ENGINE: engine,
            CLI_TEST_EVIDENCE: join(evidence, "cli"),
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
