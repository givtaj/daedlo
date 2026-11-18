import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const website = resolve(
  process.env.DAEDLO_WEBSITE_ROOT ??
    fileURLToPath(new URL("../", import.meta.url)),
);

test("the recording index links each run to its own evidence before its original capture", async () => {
  const html = await readFile(resolve(website, "public/demo.html"), "utf8");
  const directory = html.match(
    /<nav\b[^>]*aria-label="Recorded runs"[^>]*>([\s\S]*?)<\/nav>/,
  )?.[1];
  assert.ok(directory, "Provide an accessible index of the two recorded runs.");

  for (const [id, evidence, capture] of [
    ["roots-recording", "/demo-roots-evidence.json", "/demo-roots-save.png"],
    [
      "architecture-recording",
      "/demo-evidence.json",
      "/demo-verified-save.png",
    ],
  ]) {
    assert.ok(directory.includes(`href="#${id}"`), `Link the index to ${id}.`);
    const article = html.match(
      new RegExp(`<section\\b[^>]*id="${id}"[^>]*>([\\s\\S]*?)</section>`),
    )?.[1];
    assert.ok(article, `Retain the published anchor for ${id}.`);
    const receipt = article.indexOf(`href="${evidence}"`);
    const image = article.indexOf(`src="${capture}"`);
    assert.ok(
      receipt >= 0 && image > receipt,
      `Offer the ${id} receipt before its full-width capture.`,
    );
    assert.ok(
      article.includes(`href="${capture}"`),
      "Allow the original image to be opened at full size.",
    );
  }
});
