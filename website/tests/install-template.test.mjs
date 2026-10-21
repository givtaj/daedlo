import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { renderInstallTemplate } from "../scripts/stage-release.mjs";

const website = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("homepage and guide give the preview an explicit installation path", async () => {
  for (const name of ["index.html", "guide.html"]) {
    const html = await readFile(resolve(website, "public", name), "utf8");
    assert.match(
      html,
      /href="\/install\.html"/,
      `${name} must link to installation.`,
    );
  }
});

test("install template binds downloads to one version and visible integrity evidence", async () => {
  const html = await readFile(
    resolve(website, "templates/install.html"),
    "utf8",
  );
  assert.deepEqual(
    [...new Set(html.match(/{{[^}]+}}/g))].sort(),
    [
      "{{VERSION}}",
      "{{ZIP_BYTES}}",
      "{{ZIP_SHA256}}",
      "{{TOOLS_SHA256}}",
      "{{MANIFEST_SHA256}}",
    ].sort(),
  );
  for (const target of [
    "/downloads/{{VERSION}}/daedlo-{{VERSION}}.zip",
    "/downloads/{{VERSION}}/SHA256SUMS",
    "/downloads/{{VERSION}}/release.json",
  ])
    assert.ok(
      html.includes(`href="${target}"`),
      `Missing pinned download: ${target}`,
    );
  const text = html.replace(/\s+/g, " ");
  assert.match(text, /shasum -a 256 -c SHA256SUMS/);
  assert.match(text, /unzip daedlo-{{VERSION}}\.zip/);
  assert.match(text, /AGENT_START\.md/);
  assert.match(text, /START_HERE\.md/);
  assert.match(text, /Windows[^<]*unverified/i);
  assert.match(text, /Chromium[^<]*separately/i);
  assert.doesNotMatch(text, /curl[^<]*\|\s*(?:sh|bash)/);
});

test("published tools block matches the version-specific verified setup instructions", async () => {
  const template = await readFile(
    resolve(website, "templates/install.html"),
    "utf8",
  );
  const install = await readFile(resolve(website, "public/install.html"), "utf8");
  const version = install.match(/href="\/downloads\/([^/]+)\/daedlo-/)[1];
  const directory = resolve(website, "public/downloads", version);
  const metadata = JSON.parse(await readFile(resolve(directory, "release.json"), "utf8"));
  const renderedGuide = execFileSync("python3", ["-c",
    "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(z.read(sys.argv[2]).decode(),end='')",
    resolve(directory, metadata.archive.file), `daedlo-${version}/START_HERE.md`], {encoding: "utf8"});
  const kitGuide = renderedGuide.replaceAll(version, "{{VERSION}}")
    .replaceAll(metadata.tools.sha256, "{{TOOLS_SHA256}}")
    .replaceAll(metadata.bundle.manifestSha256, "{{MANIFEST_SHA256}}");
  const actual = template.match(
    /<code id="tools-install-code">([\s\S]*?)<\/code>/,
  )?.[1];
  assert.ok(
    actual,
    "Visitors need the checked tools install block, not only a direction to another file.",
  );
  const decoded = actual
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
  assert.equal(
    decoded.trim(),
    kitGuide.match(/```sh\n([\s\S]*?)\n```/)[1].trim(),
  );
  const publishedBlock = install.match(/<code id="tools-install-code">([\s\S]*?)<\/code>/)?.[1];
  assert.ok(publishedBlock, "The rendered public page needs the exact verified installer block.");
  const publishedDecoded = publishedBlock.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
  assert.equal(publishedDecoded.trim(), renderedGuide.match(/```sh\n([\s\S]*?)\n```/)[1].trim());
  assert.match(publishedDecoded, /npm install --prefix "\$driver_kit\/installed-tools" --workspaces=false/);
  const page = template.replace(/\s+/g, " ");
  assert.match(page, /fresh dependency caches/i);
  assert.match(page, /existing[^<]*toolchains/i);
  assert.match(page, /href="\/demo\.html"/);
  assert.match(page, /application-specific Rust model and JavaScript adapter/);
});

test("tools commands refuse missing or malformed release digests", () => {
  const template =
    "{{VERSION}} {{ZIP_BYTES}} {{ZIP_SHA256}} {{TOOLS_SHA256}} {{MANIFEST_SHA256}}";
  const base = {
    version: "0.1.2-rc.1",
    archive: { bytes: 1, sha256: "a".repeat(64) },
  };
  assert.throws(() => renderInstallTemplate(template, base), /digest/i);
  assert.throws(
    () =>
      renderInstallTemplate(template, {
        ...base,
        tools: { sha256: "bad" },
        bundle: { manifestSha256: "b".repeat(64) },
      }),
    /digest/i,
  );
  const rendered = renderInstallTemplate(template, {
    ...base,
    tools: { sha256: "c".repeat(64) },
    bundle: { manifestSha256: "b".repeat(64) },
  }).toString();
  assert.ok(
    rendered.includes("c".repeat(64)) && rendered.includes("b".repeat(64)),
  );
  assert.doesNotMatch(rendered, /{{/);
});

test("home and guide lead visitors to the real recorded demo", async () => {
  for (const name of ["index.html", "guide.html"]) {
    const html = await readFile(resolve(website, "public", name), "utf8");
    assert.match(
      html,
      /href="\/demo\.html"/,
      `${name} must expose the recorded real demo.`,
    );
  }
});
