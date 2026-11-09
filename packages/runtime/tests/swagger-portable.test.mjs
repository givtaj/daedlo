import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadSwaggerRuntime } from "../../../integrations/swagger/runtime.mjs";
import { buildSwaggerModel } from "../../../integrations/swagger/build-model.mjs";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const version = JSON.parse(
  await readFile(join(root, "packages/runtime/package.json")),
).version;
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "swagger-portable-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
async function runtimePackage(directory, overrides = {}) {
  await mkdir(join(directory, "public"), { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name: "@daedlo/runtime",
      version,
      type: "module",
      exports: {
        ".": { import: "./public/driver.mjs" },
        "./swagger": { import: "./public/swagger.mjs" },
      },
      ...overrides,
    }),
  );
  await writeFile(
    join(directory, "public/driver.mjs"),
    'export const marker = "selected runtime";',
  );
  await writeFile(
    join(directory, "public/swagger.mjs"),
    'export const marker = "selected swagger";',
  );
}
test("portable resolver uses both declared exports of the exact selected runtime", async (t) => {
  const directory = await fixture(t);
  await runtimePackage(directory);
  const loaded = await loadSwaggerRuntime({ runtimeRoot: directory });
  assert.equal(loaded.runtimeRoot, directory);
  assert.equal(loaded.runtime.marker, "selected runtime");
  assert.equal(loaded.swagger.marker, "selected swagger");
});
test("portable resolver refuses wrong identity and exports escaping the package", async (t) => {
  const directory = await fixture(t);
  await runtimePackage(directory, { name: "unrelated-runtime" });
  await assert.rejects(
    loadSwaggerRuntime({ runtimeRoot: directory }),
    /runtime|package/i,
  );
  await runtimePackage(directory, {
    exports: { ".": "../outside.mjs", "./swagger": "./public/swagger.mjs" },
  });
  await assert.rejects(
    loadSwaggerRuntime({ runtimeRoot: directory }),
    /export|package/i,
  );
});
test("installed helper requires explicit runtime and refuses a different tools version", async (t) => {
  const directory = await fixture(t),
    tools = join(directory, "tools"),
    runtime = join(directory, "runtime");
  await mkdir(join(tools, "integrations/swagger"), { recursive: true });
  await writeFile(
    join(tools, "package.json"),
    JSON.stringify({ name: "@daedlo/release-tools", version: "0.0.1" }),
  );
  await cp(
    join(root, "integrations/swagger/runtime.mjs"),
    join(tools, "integrations/swagger/runtime.mjs"),
  );
  const helper = await import(
    pathToFileURL(join(tools, "integrations/swagger/runtime.mjs")).href
  );
  await assert.rejects(helper.loadSwaggerRuntime(), /explicit|runtimeRoot/i);
  await runtimePackage(runtime);
  await assert.rejects(
    helper.loadSwaggerRuntime({ runtimeRoot: runtime }),
    /version/i,
  );
});
test("builder refuses an existing output and a mismatched core crate before invoking cargo", async (t) => {
  const directory = await fixture(t),
    crate = join(directory, "crate");
  await mkdir(crate);
  await writeFile(
    join(crate, "Cargo.toml"),
    '[package]\nname = "daedlo-engine"\nversion = "0.0.1"\n',
  );
  await assert.rejects(
    buildSwaggerModel({ output: join(directory, "out"), crate }),
    /version/i,
  );
  await writeFile(
    join(crate, "Cargo.toml"),
    `[package]\nname = "daedlo-engine"\nversion = "${version}"\n`,
  );
  await assert.rejects(
    buildSwaggerModel({ output: directory, crate }),
    /exist|fresh/i,
  );
});
test("builder freezes only model sources and uses locked cargo without mutating inputs", async (t) => {
  const directory = await fixture(t),
    crate = join(directory, "crate"),
    bin = join(directory, "bin"),
    output = join(directory, "out");
  await mkdir(crate);
  await mkdir(bin);
  const core = `[package]\nname = "daedlo-engine"\nversion = "${version}"\n`;
  await writeFile(join(crate, "Cargo.toml"), core);
  await writeFile(
    join(bin, "cargo"),
    '#!/bin/sh\nfor arg in "$@"; do printf "%s\\n" "$arg"; done\nwhile [ "$#" -gt 0 ]; do if [ "$1" = "--target-dir" ]; then shift; target="$1"; fi; shift; done\nmkdir -p "$target/debug"\nprintf "fixture binary" > "$target/debug/swagger-engine"\n',
    { mode: 0o700 },
  );
  const old = process.env.PATH;
  process.env.PATH = bin + ":" + old;
  const originalLock = await readFile(
    join(root, "integrations/swagger/engine/Cargo.lock"),
  );
  try {
    await assert.rejects(
      buildSwaggerModel({
        output: join(crate, "nested-build"),
        crate,
        offline: true,
      }),
      /outside|overlap/i,
    );
    const built = await buildSwaggerModel({ output, crate, offline: true });
    assert.equal(built.enginePath, join(output, "target/debug/swagger-engine"));
    const log = await readFile(join(output, "cargo-build.log"), "utf8");
    assert.match(log, /--locked/);
    assert.match(log, /--offline/);
    const manifest = await readFile(join(output, "model/Cargo.toml"), "utf8");
    assert.ok(manifest.includes(JSON.stringify(crate)));
    assert.deepEqual(
      await readFile(join(output, "model/Cargo.lock")),
      originalLock,
    );
    assert.equal(await readFile(join(crate, "Cargo.toml"), "utf8"), core);
    assert.deepEqual(
      await readFile(join(root, "integrations/swagger/engine/Cargo.lock")),
      originalLock,
    );
  } finally {
    process.env.PATH = old;
  }
});
