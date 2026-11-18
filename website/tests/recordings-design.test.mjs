import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const website = resolve(
  process.env.DAEDLO_WEBSITE_ROOT ??
    fileURLToPath(new URL("../", import.meta.url)),
);

test("the first product screenshot shows the released viewer and keeps the Roots evidence dated", async () => {
  for (const [page, section] of [
    ["index.html", "workbench"],
    ["demo.html", "current-viewer"],
  ]) {
    const html = await readFile(resolve(website, "public", page), "utf8");
    const panel = html.match(
      new RegExp(`<section\\b[^>]*id="${section}"[^>]*>([\\s\\S]*?)</section>`),
    )?.[1];
    assert.ok(panel, `Expose the current viewer on ${page}.`);
    assert.match(panel, /src="\/viewer-alpha11-workspace\.webp"/);
    assert.match(panel, /alpha\.11/);
    assert.match(panel, /Swagger/);
    if (page === "demo.html") {
      assert.match(panel, /src="\/viewer-alpha11-connections\.webp"/);
      assert.match(panel, /GET \/hello/);
      assert.match(panel, /HTTP 200/);
      assert.match(panel, /exactly one request/);
    }
    assert.match(html, /href="\/demo-roots-save\.png"/);
    const oldImage = html.indexOf('src="/demo-roots-save.png"');
    assert.ok(
      oldImage < 0 ||
        html.indexOf('src="/viewer-alpha11-workspace.webp"') < oldImage,
    );
  }
});

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
