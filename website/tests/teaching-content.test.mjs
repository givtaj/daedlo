import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PUBLIC_FILES } from "../scripts/manifest.mjs";

const root = process.env.DAEDLO_WEBSITE_ROOT
  ? resolve(process.env.DAEDLO_WEBSITE_ROOT, "public")
  : fileURLToPath(new URL("../public/", import.meta.url));
const read = async (name) =>
  (
    await readFile(resolve(root, name), "utf8").catch((error) => {
      if (error.code === "ENOENT") return "";
      throw error;
    })
  ).replace(/\s+/g, " ");

test("teaching is discoverable and consistently disclosed as planned", async () => {
  const home = await read("index.html");
  assert.match(
    home,
    /href="\/teaching\.html"/,
    "The homepage must link to the teaching plan.",
  );
  const teaching = await read("teaching.html");
  assert.match(teaching, /<h1[^>]*>[\s\S]*learn[\s\S]*<\/h1>/i);
  assert.match(teaching, /Teaching mode[\s\S]*Planned/);
  assert.match(
    teaching,
    /not included in the[\s\S]*current release/i,
  );
  for (const mode of ["Show me", "Guide me", "Let me try"])
    assert.ok(teaching.includes(mode));
  assert.match(teaching, /Help me now[\s\S]*Later/);
});

test("the first lesson separates historical Roots behavior from proposed teaching and saving", async () => {
  const teaching = await read("teaching.html");
  assert.match(teaching, /Journal draft retention/);
  assert.match(teaching, /Home[\s\S]*Profile[\s\S]*Journal/);
  assert.match(teaching, /date, notes, rating[\s\S]*selected strain/);
  assert.match(
    teaching,
    /Draft retained[\s\S]*does not mean[\s\S]*experience saved/i,
  );
  assert.match(teaching, /26[–-]27 September 2026/);
  assert.match(teaching, /original Roots driver/);
  assert.match(teaching, /not a teaching-mode test/i);
  assert.match(teaching, /proposed lesson outline/i);
  assert.doesNotMatch(teaching, /<iframe|<script|onclick=|<form|<button/i);
  assert.doesNotMatch(
    teaching,
    /\/Users\/|\/private\/tmp\/|localhost|127\.0\.0\.1/,
  );
  assert.doesNotMatch(teaching, /<img[^>]+src="[^\"]*(?:roots|journal)/i);
});

test("teaching assets and working navigation are deployable without changing the release", async () => {
  for (const name of ["teaching.html", "teaching.css"]) {
    assert.ok(
      PUBLIC_FILES.has(name),
      `${name} must be explicitly allowlisted.`,
    );
    assert.ok((await read(".assetsignore")).includes(`!/${name}`));
  }
  assert.ok(
    (await read("sitemap.xml")).includes("https://daedlo.com/teaching.html"),
  );
  const teaching = await read("teaching.html");
  for (const href of [
    "#main",
    "#first-lesson",
    "/index.html",
    "/demo.html",
    "/guide.html",
    "/install.html",
  ]) {
    assert.ok(
      teaching.includes(`href="${href}"`),
      `${href} must be navigable.`,
    );
  }
  assert.match(teaching, /Watching[\s\S]*independent completion/i);
  assert.match(teaching, /Rust state model and JavaScript adapter/);
});
