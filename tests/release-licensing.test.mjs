import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => fs.readFile(join(root, path), "utf8");

test("public release metadata preserves the operative component licenses", async () => {
  const runtime = JSON.parse(await read("packages/runtime/package.json"));
  assert.equal(runtime.license, "MIT AND Apache-2.0");
  assert.match(await read("Cargo.toml"), /^license = "MIT AND Apache-2\.0"$/m);
  assert.match(
    await read("crates/browser-driver-engine/Cargo.toml"),
    /^license\.workspace = true$/m,
  );
  assert.match(
    await read("skills/browser-driver/SKILL.md"),
    /^license: MIT AND Apache-2\.0$/m,
  );
  const license = await read("LICENSE");
  assert.match(license, /Permission is hereby granted/);
  assert.match(license, /Apache-2\.0/);
  assert.doesNotMatch(license, /DRAFT|NOT OPERATIVE/);
});

test("every public component carries matching notices and excludes evaluation terms", async () => {
  const components = [
    "packages/runtime",
    "crates/browser-driver-engine",
    "skills/browser-driver",
  ];
  const notices = [
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    "licenses/Apache-2.0.txt",
    "licenses/MIT-legacy.txt",
  ];
  for (const component of components) {
    for (const notice of notices) {
      assert.equal(
        await read(`${component}/${notice}`),
        await read(notice),
        `${component} must ship the complete ${notice}`,
      );
    }
  }
  for (const boundary of ["", ...components]) {
    const path = join(root, boundary, "EVALUATION-LICENSE.md");
    await assert.rejects(fs.access(path), { code: "ENOENT" });
  }
  const files = JSON.parse(await read("packages/runtime/package.json")).files;
  for (const path of ["LICENSE", "THIRD_PARTY_NOTICES.md", "licenses"])
    assert.ok(files.includes(path), `npm pack must include ${path}`);
  assert.ok(!files.includes("EVALUATION-LICENSE.md"));
});
