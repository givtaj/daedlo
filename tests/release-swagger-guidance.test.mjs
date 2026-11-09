import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const read = (path) =>
  fs.readFile(new URL("../" + path, import.meta.url), "utf8");
test("current installation guides select the exact candidate browser dependency", async () => {
  const pkg = JSON.parse(await read("packages/runtime/package.json"));
  for (const path of [
    "docs/public-downloads/START_HERE.md",
    "skills/daedlo/references/onboarding.md",
    "docs/public-downloads/releases.md",
    "docs/releases.md",
  ]) {
    const guide = await read(path);
    assert.ok(
      guide.includes(pkg.dependencies.playwright),
      `${path} must document the exact runtime Playwright pin`,
    );
  }
  const skill = await read("skills/daedlo/SKILL.md");
  assert.ok(
    skill.includes(pkg.version),
    "Shipped skill must identify its candidate version",
  );
});
test("downloaded onboarding explicitly routes Swagger to the shipped standalone model", async () => {
  for (const path of [
    "docs/public-downloads/START_HERE.md",
    "docs/public-downloads/AGENT_START.md",
  ]) {
    const guide = await read(path);
    assert.ok(guide.includes("integrations/swagger/README.md"), path);
    assert.match(guide, /Swagger[\s\S]*standalone/);
    assert.match(guide, /managed Swagger.*not (?:included|supported)/i);
  }
});
