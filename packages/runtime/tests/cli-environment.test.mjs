// Actual CLI subprocesses; only the bare default Playwright import is replaced.
// Override modules are real ESM files. Their launch is a recording sentinel, not
// a browser: real executable selection/OS rejection remain browser acceptance.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const cli =
  process.env.CLI_ENVIRONMENT_BINARY ||
  fileURLToPath(new URL("../src/cli.mjs", import.meta.url));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "daedlo cli environment "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const events = join(root, "events.jsonl");
  const record = `import {appendFileSync} from 'node:fs'; const record=(event)=>appendFileSync(${JSON.stringify(events)},JSON.stringify(event)+'\\n');`;
  const moduleSource = (name) => `${record}
    record({event:'import',name:${JSON.stringify(name)}});
    export const chromium={launch:async(options)=>{record({event:'launch',name:${JSON.stringify(name)},options});throw Error('recorded launch sentinel')}};`;
  const defaultModule = join(root, "default.mjs");
  const custom = join(root, "selected module.mjs");
  const bare = join(root, "chosen.mjs");
  writeFileSync(defaultModule, moduleSource("default"));
  writeFileSync(custom, moduleSource("custom"));
  writeFileSync(bare, moduleSource("bare-path"));
  const hook = join(root, "hook.mjs");
  writeFileSync(
    hook,
    `import {registerHooks} from 'node:module'; registerHooks({resolve(specifier,context,next){return next(specifier==='playwright'?${JSON.stringify(pathToFileURL(defaultModule).href)}:specifier,context)}});`,
  );
  const project = join(root, "project.mjs");
  writeFileSync(
    project,
    `${record}
    record({event:'project-import'});
    export async function createProject({resources}) {
      record({event:'project-create'});
      resources.own({}, {label:'owned fixture',close(){record({event:'owned-close'})}});
      resources.attach({}, {label:'attached fixture',close(){record({event:'attached-close'})}});
      return {url:'about:blank',enginePath:'/unused/engine',createAdapter(){record({event:'adapter'});throw Error('no adapter expected')}};
    }`,
  );
  return {
    root,
    custom,
    bare,
    record,
    run(overrides = {}, args = ["--project", project]) {
      const env = { ...process.env };
      delete env.PLAYWRIGHT_MODULE;
      delete env.CHROMIUM;
      Object.assign(env, overrides);
      const result = spawnSync(
        process.execPath,
        ["--import", hook, cli, ...args],
        { cwd: root, env, encoding: "utf8", timeout: 5000 },
      );
      assert.ifError(result.error);
      assert.equal(result.signal, null, result.stderr);
      let observed = [];
      try {
        observed = readFileSync(events, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map(JSON.parse);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      return { ...result, events: observed };
    },
  };
}
function launchResult(result, name, executablePath) {
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /recorded launch sentinel/);
  assert.deepEqual(
    result.events.map((x) => x.event),
    ["import", "project-import", "project-create", "launch", "owned-close"],
  );
  assert.equal(result.events[0].name, name, JSON.stringify(result.events));
  const launches = result.events.filter((x) => x.event === "launch");
  assert.equal(launches.length, 1, "No fallback launch or retry");
  assert.equal(launches[0].name, name, JSON.stringify(result.events));
  assert.deepEqual(launches[0].options, {
    headless: true,
    handleSIGINT: false,
    handleSIGTERM: false,
    ...(executablePath ? { executablePath } : {}),
  });
  assert.doesNotMatch(result.stdout, /Daedlo monitor:/);
}

test("CLI help ignores poisoned browser overrides without project or launch", (t) => {
  const f = fixture(t),
    r = f.run(
      {
        PLAYWRIGHT_MODULE: "https://invalid.test/poison.mjs",
        CHROMIUM: "/invalid/browser",
      },
      ["--help"],
    );
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /browser-driver --project/);
  assert.match(r.stdout, /PLAYWRIGHT_MODULE/);
  assert.match(r.stdout, /CHROMIUM/);
  assert.deepEqual(r.events, [], "Help must not evaluate a browser module");
});
for (const mode of ["unset", "empty"])
  test(`CLI ${mode} browser overrides retain the default module and omit executablePath`, (t) => {
    const f = fixture(t);
    launchResult(
      f.run(mode === "empty" ? { PLAYWRIGHT_MODULE: "", CHROMIUM: "" } : {}),
      "default",
    );
  });
for (const mode of ["absolute", "relative", "file-url", "bare-path"])
  test(`CLI ${mode} override imports once before project setup and forwards exact executable path`, (t) => {
    const f = fixture(t);
    const selection = {
      absolute: f.custom,
      relative: "./selected module.mjs",
      "file-url": pathToFileURL(f.custom).href,
      "bare-path": "chosen.mjs",
    }[mode];
    launchResult(
      f.run({
        PLAYWRIGHT_MODULE: selection,
        CHROMIUM: " ./browser with spaces ",
      }),
      mode === "bare-path" ? "bare-path" : "custom",
      " ./browser with spaces ",
    );
  });
test("CLI executable override also applies to the default module without fallback", (t) => {
  const f = fixture(t);
  launchResult(
    f.run({ CHROMIUM: "/missing/chromium executable" }),
    "default",
    "/missing/chromium executable",
  );
});
for (const mode of [
  "missing",
  "throws",
  "unsupported-url",
  "missing-chromium",
  "noncallable-launch",
])
  test(`CLI ${mode} selected module fails closed before project resources`, (t) => {
    const f = fixture(t);
    let selected = f.custom;
    if (mode === "missing") selected = join(f.root, "absent.mjs");
    else if (mode === "unsupported-url")
      selected = "https://invalid.test/unsupported.mjs";
    else
      writeFileSync(
        selected,
        `${f.record} record({event:'import',name:'invalid'}); ${mode === "throws" ? "throw Error('selected import failed');" : mode === "missing-chromium" ? "export const firefox={};" : "export const chromium={launch:17};"}`,
      );
    const r = f.run({ PLAYWRIGHT_MODULE: selected });
    assert.equal(r.status, 1, r.stderr);
    assert.equal(
      r.events.some((e) => e.name === "default"),
      false,
      JSON.stringify(r.events),
    );
    assert.equal(
      r.events.some((e) => e.event !== "import"),
      false,
      "Module validation must precede project import/fixture acquisition",
    );
    assert.doesNotMatch(r.stdout, /Daedlo monitor:/);
    assert.doesNotMatch(r.stderr, /recorded launch sentinel/);
  });
