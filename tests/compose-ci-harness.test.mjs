import assert from "node:assert/strict";
import test from "node:test";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const script = fileURLToPath(
  new URL("./compose-acceptance.mjs", import.meta.url),
);
const root = dirname(dirname(script));

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "daedlo-compose-harness-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = join(directory, "bin");
  const output = join(directory, "evidence");
  const calls = join(directory, "calls.jsonl");
  const fixtureScript = join(directory, "tests", "compose-acceptance.mjs");
  const playwright = join(directory, "node_modules", "playwright");
  await mkdir(bin);
  await mkdir(join(directory, "tests"));
  await mkdir(join(directory, "scripts"));
  await mkdir(playwright, { recursive: true });
  await copyFile(script, fixtureScript);
  for (const name of ["compose-ci-safety.mjs", "compose-ci-lifecycle.mjs"])
    await copyFile(
      join(root, "scripts", name),
      join(directory, "scripts", name),
    );
  // The real harness and helpers run in an isolated tree. This tiny package
  // keeps the test independent of installed npm dependencies and browsers.
  await writeFile(
    join(playwright, "package.json"),
    JSON.stringify({
      name: "playwright",
      type: "module",
      exports: "./index.js",
    }),
  );
  await writeFile(
    join(playwright, "index.js"),
    `
export const chromium = {
  executablePath: () => process.env.FAKE_BROWSER_PATH || process.execPath,
  launch() { throw Error("Fixture browser must never launch"); },
};
`,
  );
  // This executable never forwards to Docker. The build-shaped command only
  // simulates a failed/interrupted subprocess; it creates no images or services.
  await writeFile(
    join(bin, "docker"),
    `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_CALLS, JSON.stringify(args) + "\\n");
if (args[0] === "context") console.log("unix:///test-only/docker.sock");
else if (args[0] === "image" && args[1] === "ls") {}
else if (args[0] === "image" && args[1] === "inspect") process.exitCode = 1;
else if (args[0] === "compose") {
  if (args.includes("--build")) {
    console.log("fake build subprocess: no Docker daemon used");
    if (process.env.FAKE_MODE === "signal") {
      setInterval(() => {}, 1000);
      process.kill(process.ppid, "SIGTERM");
    } else process.exitCode = 9;
  } else if (args.includes("cp")) fs.writeFileSync(args.at(-1), '{"fixture":true}');
  else if (args.includes("logs")) console.log("retained failed-run logs");
  else if (!args.includes("stop")) process.exitCode = 97;
} else process.exitCode = 98;
`,
    { mode: 0o700 },
  );
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    FAKE_CALLS: calls,
    DAEDLO_COMPOSE_OUTPUT: output,
    DAEDLO_COMPOSE_MIN_FREE_GIB: "1",
    DAEDLO_DOCKER_DISK_PATH: directory,
  };
  delete env.DOCKER_HOST;
  delete env.DOCKER_CONTEXT;
  return {
    directory,
    output,
    env,
    run: (extra = {}) =>
      spawnSync(process.execPath, [fixtureScript], {
        cwd: directory,
        env: { ...env, ...extra },
        encoding: "utf8",
        timeout: 15000,
      }),
    calls: async () =>
      (await readFile(calls, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse),
    receipt: async () =>
      JSON.parse(await readFile(join(output, "results.json"), "utf8")),
  };
}

test("actual Compose harness blocks low disk before any build or resource teardown", async (t) => {
  const f = await fixture(t);
  const result = f.run({ DAEDLO_COMPOSE_MIN_FREE_GIB: "1000000" });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Insufficient free disk space/);
  assert.ok((await f.calls()).every((args) => args[0] === "context"));
  const receipt = await f.receipt();
  assert.equal(receipt.phase, "resources-retained");
  assert.equal(
    receipt.results.find((r) => r.name === "Compose build disk space verified")
      .status,
    "BLOCKED",
  );
});

for (const missing of ["package", "browser"]) {
  test(`missing Playwright ${missing} blocks before build or deletion`, async (t) => {
    const f = await fixture(t);
    const extra = {};
    if (missing === "package")
      await rm(join(f.directory, "node_modules", "playwright"), {
        recursive: true,
      });
    else extra.FAKE_BROWSER_PATH = join(f.directory, "browser-not-installed");
    const result = f.run(extra);
    assert.equal(result.status, 1, result.stderr);
    if (missing === "package")
      assert.match(result.stderr, /Cannot find package 'playwright'/);
    else assert.match(result.stderr, /ENOENT|browser-not-installed/);
    const calls = await f.calls();
    assert.equal(
      calls.some(
        (args) =>
          args.includes("--build") ||
          args.includes("down") ||
          args.includes("rm") ||
          args.includes("prune"),
      ),
      false,
    );
    assert.ok(
      calls.every(
        (args) =>
          args[0] === "context" || (args[0] === "image" && args[1] === "ls"),
      ),
    );
    const receipt = await f.receipt();
    assert.equal(receipt.phase, "resources-retained");
    assert.equal(receipt.resourcesToInspect, null);
  });
}

for (const mode of ["failure", "signal"]) {
  test(`actual harness preserves failed-run resources after ${mode}`, async (t) => {
    const f = await fixture(t);
    const result = f.run({ FAKE_MODE: mode });
    assert.equal(result.status, mode === "signal" ? 143 : 1, result.stderr);
    const calls = await f.calls();
    assert.equal(calls.filter((args) => args.includes("--build")).length, 1);
    assert.equal(
      calls.some(
        (args) =>
          args.includes("down") ||
          args.includes("rm") ||
          args.includes("prune"),
      ),
      false,
    );
    const stop = calls.find((args) => args.includes("stop"));
    assert.equal(stop.at(-1), "daedlo", "application memory remains available");
    const receipt = await f.receipt();
    assert.equal(receipt.phase, "resources-retained");
    assert.equal(receipt.interrupted, mode === "signal" ? "SIGTERM" : null);
    assert.equal(receipt.resourcesToInspect.imageTags.length, 2);
    assert.match(
      await readFile(join(f.output, "compose.log"), "utf8"),
      /fake build subprocess/,
    );
    assert.deepEqual(
      JSON.parse(await readFile(join(f.output, "session-final.json"), "utf8")),
      { fixture: true },
    );
  });
}

test("reusing an evidence directory cannot overwrite an earlier run", async (t) => {
  const f = await fixture(t);
  await mkdir(f.output);
  const previous = '{"unique":"failed-run evidence"}';
  await writeFile(join(f.output, "results.json"), previous);
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /evidence directory must be empty/);
  assert.equal(
    await readFile(join(f.output, "results.json"), "utf8"),
    previous,
  );
  await assert.rejects(f.calls(), { code: "ENOENT" });
});
