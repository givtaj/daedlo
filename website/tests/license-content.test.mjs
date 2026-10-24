import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { renderInstallTemplate } from "../scripts/stage-release.mjs";

const sourceWebsite = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const website = resolve(process.env.DAEDLO_WEBSITE_ROOT ?? sourceWebsite);

async function licenseParagraphs() {
  const template = await readFile(
    resolve(website, "templates/install.html"),
    "utf8",
  );
  const html = renderInstallTemplate(template, {
    version: "0.1.4-alpha.4",
    archive: { bytes: 1, sha256: "a".repeat(64) },
    tools: {
      file: "tools/daedlo-tools-0.1.4-alpha.4.tgz",
      sha256: "b".repeat(64),
    },
    bundle: {
      manifestSha256: "c".repeat(64),
      artifacts: {
        runtime: { name: "@daedlo/runtime" },
        engine: { name: "daedlo-engine" },
      },
    },
  }).toString();
  const section = html.match(
    /<section\b[^>]*aria-labelledby="license-title"[^>]*>([\s\S]*?)<\/section>/,
  )?.[1];
  assert.ok(
    section,
    "The rendered installation page needs visible licence terms.",
  );
  return [...section.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((match) =>
    match[1]
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

test("alpha.4 Apache terms retain legacy notices and prior permissions", async () => {
  const paragraphs = await licenseParagraphs();
  const future = paragraphs.find((text) => /From 0\.1\.4-alpha\.4/i.test(text));
  assert.ok(
    future,
    "Visitors must be told the Apache change starts with alpha.4.",
  );
  assert.match(future, /public core[^.]*Apache-2\.0/i);
  assert.match(future, /legacy MIT and third-party[^.]*notices/i);
  assert.match(future, /does not revoke permissions[^.]*earlier releases/i);
});

test("published alpha.3 keeps its distinct MIT and Apache terms and immutable downloads", async () => {
  const paragraphs = await licenseParagraphs();
  const published = paragraphs.find((text) =>
    /published 0\.1\.4-alpha\.3/i.test(text),
  );
  assert.ok(
    published,
    "The existing downloadable alpha needs an explicit version-specific licence statement.",
  );
  assert.match(published, /remains MIT AND Apache-2\.0/);
  assert.match(published, /additions[^.]*MIT/);
  assert.match(published, /Roots-derived[^.]*Apache-2\.0/);
  assert.match(published, /downloads[^.]*notices[^.]*unchanged/i);
});

test("customer models, flows, adapters and data are outside the core licence change", async () => {
  const paragraphs = await licenseParagraphs();
  const customer = paragraphs.find((text) =>
    /models, flows, adapters and data/i.test(text),
  );
  assert.ok(
    customer,
    "Visitors need the ownership boundary for their authored integration and data.",
  );
  assert.match(customer, /separate from Daedlo[^.]*licence/i);
  assert.match(
    customer,
    /does not transfer ownership or require you to publish/i,
  );
});
