import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInstalledControls } from "./installed-controls-acceptance.mjs";
import { verifyInstalledSwaggerChecks } from "./swagger-installed-acceptance.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const safety = new Map([
  ["installed-authorization-unit", 13],
  ["installed-authorization-browser", 10],
  ["installed-result-attribution", 1],
  ["installed-result-session", 1],
  ["installed-viewer-cleanup-unit", 12],
  ["installed-viewer-cleanup-browser", 8],
  ["installed-stalled-finalization", 9],
  ["installed-cli-stalled-finalization", 3],
  ["installed-scoped-finalization", 3],
  ["installed-resource-ownership", 5],
  ["installed-viewer-finalization", 4],
  ["installed-active-run", 5],
  ["installed-viewer-grid", 28],
  ["installed-viewer-restart", 1],
]);

const swaggerNavigationChecks = [
  "installed collapsed operation selection sends no request before one authorized Execute",
  "installed virtualized operation selection sends no request before one authorized Execute",
  "installed filtered operation refuses selection without API dispatch",
  "installed missing operation refuses selection without API dispatch",
  "installed ambiguous operation refuses selection without API dispatch",
  "installed HEAD response reports no write expected",
];
test("installed Swagger acceptance requires every navigation and read-result regression", () => {
  const original = Array.from(
    { length: 13 },
    (_, index) => `retained-${index}`,
  );
  assert.doesNotThrow(() =>
    verifyInstalledSwaggerChecks([...original, ...swaggerNavigationChecks]),
  );
  for (const name of swaggerNavigationChecks) {
    assert.throws(() =>
      verifyInstalledSwaggerChecks([
        ...original,
        ...swaggerNavigationChecks.filter((check) => check !== name),
      ]),
    );
    assert.throws(
      () =>
        verifyInstalledSwaggerChecks([
          ...original,
          ...swaggerNavigationChecks.map((check) =>
            check === name ? "unrelated replacement" : check,
          ),
        ]),
      /required installed Swagger/,
    );
  }
});

function fixture(t, { corrupt, skipped, omitted } = {}) {
  const root = fs.realpathSync(
    fs.mkdtempSync(join(tmpdir(), "daedlo-installed-safety-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repoRoot = join(root, "source"),
    work = join(root, "consumer"),
    installed = join(work, "node_modules/@daedlo/runtime"),
    output = join(root, "evidence");
  fs.mkdirSync(join(repoRoot, "packages/runtime"), { recursive: true });
  fs.cpSync(
    join(repository, "packages/runtime/tests"),
    join(repoRoot, "packages/runtime/tests"),
    { recursive: true },
  );
  fs.mkdirSync(join(repoRoot, "tests"));
  fs.copyFileSync(
    join(repository, "tests/control-authorization-acceptance.mjs"),
    join(repoRoot, "tests/control-authorization-acceptance.mjs"),
  );
  fs.mkdirSync(join(installed, "src"), { recursive: true });
  fs.mkdirSync(join(work, "tests"));
  fs.mkdirSync(join(output, "logs"), { recursive: true });
  fs.writeFileSync(
    join(installed, "package.json"),
    JSON.stringify({
      name: "@daedlo/runtime",
      version: "0.0.0-test",
      type: "module",
      exports: { ".": { import: "./src/index.mjs" } },
    }),
  );
  for (const name of ["index", "session", "cli"])
    fs.writeFileSync(join(installed, `src/${name}.mjs`), "export {};\n");
  corrupt?.({ repoRoot, installed });
  const invocations = [];
  const run = async (name, _program, args, options) => {
    invocations.push({ name, args, ...options });
    if (name === "installed-public-runtime-resolution") {
      const log = execFileSync(_program, args, {
        cwd: options.cwd,
        encoding: "utf8",
      });
      fs.writeFileSync(join(output, "logs", `${name}.log`), log);
      return log;
    }
    const total =
      safety.get(name) ??
      {
        "installed-cli": 10,
        "installed-publication-unit": 25,
        "installed-publication-browser": 9,
      }[name];
    assert.ok(total, `Unexpected installed acceptance group ${name}`);
    const executed = total - (name === omitted ? 1 : 0);
    const skip = name === skipped ? 1 : 0;
    const log = `# tests ${executed}\n# pass ${executed - skip}\n# fail 0\n# cancelled 0\n# skipped ${skip}\n# todo 0\n`;
    fs.writeFileSync(join(output, "logs", `${name}.log`), log);
    return log;
  };
  const options = {
    repoRoot,
    work,
    installed,
    entry: pathToFileURL(join(installed, "src/index.mjs")).href,
    output,
    run,
    source: {
      commit: "a".repeat(40),
      dirty: false,
      treeSha256: "b".repeat(64),
    },
    version: "0.0.0-test",
  };
  return { options, invocations };
}

test("installed acceptance schedules every new safety suite through the physical consumer", async (t) => {
  const { options, invocations } = fixture(t);
  const result = await runInstalledControls(options);
  for (const [name, expected] of safety) {
    const invocation = invocations.find((value) => value.name === name);
    assert.ok(
      invocation,
      `${name}: safety suite omitted from installed acceptance`,
    );
    assert.equal(invocation.cwd, options.work);
    const file = invocation.args.at(-1);
    assert.equal(dirname(file), join(options.work, "tests"));
    const text = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(text, /from\s+["']\.\.\/.*src\//);
    if (name === "installed-viewer-cleanup-browser")
      assert.equal(
        invocation.env.CLI_TEST_RUNTIME,
        fileURLToPath(options.entry),
      );
    else assert.match(text, /from "@daedlo\/runtime"/);
    assert.equal(
      result.extendedChecks.find((value) => value.name === name).pass,
      expected,
    );
  }
  assert.equal(
    result.extendedProvenance.resolvedPublicRuntimeEntry,
    options.entry,
  );
  for (const check of result.extendedProvenance.copiedChecks) {
    assert.match(check.sourceSha256, /^[a-f0-9]{64}$/);
    assert.match(check.consumerSha256, /^[a-f0-9]{64}$/);
  }
  const cli = fs.readFileSync(
    join(options.work, "tests/cli-stalled-finalization.test.mjs"),
    "utf8",
  );
  assert.ok(
    cli.includes(pathToFileURL(join(options.installed, "src/cli.mjs")).href),
  );
});

test("an omitted or skipped installed safety case cannot pass its receipt", async (t) => {
  const { options } = fixture(t, { skipped: "installed-stalled-finalization" });
  await assert.rejects(runInstalledControls(options), /every case must pass/);
  const receipt = JSON.parse(
    fs.readFileSync(join(options.output, "installed-controls/results.json")),
  );
  assert.equal(receipt.status, "FAIL");
});

test("installed grid and active-run checks preserve source assertions and bind output to the consumer receipt", async (t) => {
  const { options, invocations } = fixture(t);
  const result = await runInstalledControls(options);
  for (const [name, file, specifier] of [
    ["installed-active-run", "active-run.test.mjs", "../src/session.mjs"],
    [
      "installed-viewer-grid",
      "viewer-grid-browser.mjs",
      "../src/viewer/server.mjs",
    ],
    [
      "installed-viewer-restart",
      "viewer-restart-browser.mjs",
      "../src/index.mjs",
    ],
  ]) {
    const invocation = invocations.find((value) => value.name === name);
    assert.ok(invocation, `${name}: required installed regression is absent`);
    const original = fs.readFileSync(
      join(options.repoRoot, "packages/runtime/tests", file),
      "utf8",
    );
    const copied = fs.readFileSync(join(options.work, "tests", file), "utf8");
    let expectedCopy = original.replace(
      JSON.stringify(specifier),
      '"@daedlo/runtime"',
    );
    if (name === "installed-viewer-restart")
      expectedCopy = expectedCopy.replace(
        'resolve("artifacts/dev-restart-alerts")',
        "resolve(process.env.VIEWER_RESTART_OUTPUT)",
      );
    assert.equal(
      copied,
      expectedCopy,
      `${name}: application assertions must be copied without changes`,
    );
    const provenance = result.extendedProvenance.copiedChecks.find(
      (value) => value.name === file,
    );
    assert.equal(
      provenance.importOnlySubstitution,
      name !== "installed-viewer-restart",
    );
    const expectedSubstitutions = [
      {
        kind: "public-runtime-import",
        from: JSON.stringify(specifier),
        to: '"@daedlo/runtime"',
      },
    ];
    if (name === "installed-viewer-restart")
      expectedSubstitutions.push({
        kind: "evidence-location",
        from: 'resolve("artifacts/dev-restart-alerts")',
        to: "resolve(process.env.VIEWER_RESTART_OUTPUT)",
      });
    assert.deepEqual(provenance.substitutions, expectedSubstitutions);
    if (name === "installed-viewer-grid")
      assert.equal(
        invocation.env.VIEWER_GRID_OUTPUT,
        join(options.output, "installed-controls/viewer-grid"),
      );
    if (name === "installed-viewer-restart")
      assert.equal(
        invocation.env.VIEWER_RESTART_OUTPUT,
        join(options.output, "installed-controls/viewer-restart"),
      );
  }
});

for (const name of ["installed-viewer-grid", "installed-viewer-restart"])
  for (const failure of ["omitted", "skipped"])
    test(`the ${failure} ${name} case cannot pass its receipt`, async (t) => {
      const { options } = fixture(t, { [failure]: name });
      await assert.rejects(runInstalledControls(options), /every case must/);
      const receipt = JSON.parse(
        fs.readFileSync(
          join(options.output, "installed-controls/results.json"),
        ),
      );
      assert.equal(receipt.status, "FAIL");
    });

test("public package resolution cannot silently select another runtime entry", async (t) => {
  const { options } = fixture(t, {
    corrupt: ({ installed }) => {
      const path = join(installed, "package.json");
      const manifest = JSON.parse(fs.readFileSync(path));
      manifest.exports = "./src/session.mjs";
      fs.writeFileSync(path, JSON.stringify(manifest));
    },
  });
  await assert.rejects(runInstalledControls(options), /public runtime.*entry/i);
});

test("installed runtime provenance follows ESM import conditions rather than require conditions", async (t) => {
  const { options } = fixture(t, {
    corrupt: ({ installed }) => {
      const path = join(installed, "package.json");
      const manifest = JSON.parse(fs.readFileSync(path));
      manifest.exports["."].require = "./src/session.mjs";
      fs.writeFileSync(path, JSON.stringify(manifest));
    },
  });
  const result = await runInstalledControls(options);
  assert.equal(
    result.extendedProvenance.resolvedPublicRuntimeEntry,
    options.entry,
  );
});
