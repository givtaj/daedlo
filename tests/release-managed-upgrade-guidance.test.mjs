import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

for (const path of [
  "docs/public-downloads/START_HERE.md",
  "docs/public-downloads/AGENT_START.md",
]) {
  test(`${path} requires the alpha.13 tools bootstrap for native fixture preflight`, async () => {
    const guide = (
      await fs.readFile(new URL("../" + path, import.meta.url), "utf8")
    ).replace(/\s+/g, " ");
    assert.match(guide, /alpha\.13[\s\S]*tools bootstrap/i);
    assert.match(
      guide,
      /runtime-only update keeps the previous controller and setup tools/i,
    );
    assert.match(guide, /preflight --config/);
    assert.match(guide, /acceptance, health and live/i);
    assert.match(guide, /status poll/i);
    assert.match(guide, /playwrightBrowsersPath/);
    assert.match(guide, /draftState/);
    assert.match(guide, /safely stop the authenticated old owner/i);
    assert.match(
      guide,
      /same configuration, registration, store, publisher trust and checkpoint/i,
    );
    assert.match(guide, /cannot repair an already running older controller/i);
    assert.match(guide, /docs\/managed-abandonment\.md/);
    assert.match(guide, /docs\/model-migration\.md/);
  });
}
