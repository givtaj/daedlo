import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => fs.readFile(join(root, path), "utf8");

test("next release declares Apache-2.0 consistently without reusing alpha.3", async () => {
  const runtime = JSON.parse(await read("packages/runtime/package.json"));
  assert.equal(runtime.license, "Apache-2.0");
  assert.equal(runtime.version, "0.1.4-alpha.4");
  const lock = JSON.parse(await read("package-lock.json")).packages[
    "packages/runtime"
  ];
  assert.equal(lock.license, runtime.license);
  assert.equal(lock.version, runtime.version);
  assert.match(await read("Cargo.toml"), /^license = "Apache-2\.0"$/m);
  assert.match(
    await read("crates/daedlo-engine/Cargo.toml"),
    /^license\.workspace = true$/m,
  );
  assert.match(await read("skills/daedlo/SKILL.md"), /^license: Apache-2\.0$/m);
  const license = await read("LICENSE");
  assert.equal(license, await read("licenses/Apache-2.0.txt"));
  assert.match(license, /Grant of Patent License/);
  assert.doesNotMatch(license, /DRAFT|NOT OPERATIVE/);
  const legacy = await read("licenses/MIT-legacy.txt");
  assert.match(legacy, /Copyright \(c\) 2026 Aidin Givtaj/);
  assert.match(legacy, /Permission is hereby granted/);
  const notices = await read("THIRD_PARTY_NOTICES.md");
  assert.match(notices, /0\.1\.4-alpha\.4/);
  assert.match(notices, /0\.1\.4-alpha\.3/);
  assert.match(notices, /previously granted permissions/);
});

test("every public component carries matching notices and excludes evaluation terms", async () => {
  const components = [
    "packages/runtime",
    "crates/daedlo-engine",
    "skills/daedlo",
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
