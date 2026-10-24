import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderInstallTemplate } from "../scripts/stage-release.mjs";
import { renderUpdatesTemplate } from "../scripts/stage-updates.mjs";
const template = (name) =>
  readFile(new URL("../templates/" + name + ".html", import.meta.url), "utf8");
const metadata = (family, version) => ({
  schemaVersion: 1,
  version,
  archive: {
    file: `daedlo-${version}.zip`,
    bytes: 123,
    sha256: "a".repeat(64),
  },
  tools: {
    file: `tools/${family}-tools-${version}.tgz`,
    sha256: "b".repeat(64),
  },
  bundle: {
    manifestSha256: "c".repeat(64),
    artifacts: {
      runtime: { name: `@${family}/runtime` },
      engine: { name: `${family}-engine` },
    },
  },
});
for (const [family, version] of [
  ["browser-driver", "0.1.4-alpha.3"],
  ["daedlo", "0.1.4-alpha.4"],
]) {
  test(`verified ${family} family selects matching tools commands and skill`, async () => {
    const html = renderInstallTemplate(
      await template("install"),
      metadata(family, version),
    ).toString();
    assert.ok(html.includes(`tools/${family}-tools-${version}.tgz`));
    assert.ok(
      html.includes(
        `node_modules/@${family}/release-tools/lib/consumer-cli.mjs`,
      ),
    );
    assert.ok(html.includes(`skills/${family}/SKILL.md`));
    const other = family === "daedlo" ? "browser-driver" : "daedlo";
    const block = html.match(
      /<code id="tools-install-code">([\s\S]*?)<\/code>/,
    )[1];
    assert.equal(block.includes(`@${other}/release-tools`), false);
  });
}
test("rendering refuses missing, mixed or inconsistent package-family metadata", async () => {
  const html = await template("install");
  for (const change of [
    (m) => delete m.bundle.artifacts,
    (m) => (m.bundle.artifacts.engine.name = "browser-driver-engine"),
    (m) => (m.tools.file = "tools/browser-driver-tools-0.1.4-alpha.4.tgz"),
  ]) {
    const m = metadata("daedlo", "0.1.4-alpha.4");
    change(m);
    assert.throws(
      () => renderInstallTemplate(html, m),
      /family|identity|tools/i,
    );
  }
});
test("update instructions bind new tools and preserve the legacy bootstrap boundary", async () => {
  const html = renderUpdatesTemplate(await template("updates"), {
    catalog: { expiresAt: "2026-10-30T00:00:00.000Z" },
    version: "0.1.4-alpha.4",
    publicKeySha256: "d".repeat(64),
    metadata: metadata("daedlo", "0.1.4-alpha.4"),
  }).toString();
  assert.ok(html.includes("node_modules/@daedlo/release-tools/lib/ninja.mjs"));
  const text = html.replace(/\s+/g, " ");
  for (const pattern of [
    /alpha\.3[^.]*cannot install/i,
    /independently verified[^.]*tools/i,
    /same existing configuration/i,
    /trust[^.]*checkpoint/i,
    /old tools/i,
  ])
    assert.match(text, pattern);
});
