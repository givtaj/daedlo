import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
const sourceWebsite = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const website = resolve(process.env.DAEDLO_WEBSITE_ROOT ?? sourceWebsite);
const read = (path) => readFile(resolve(website, path), "utf8");
const flat = (html) => html.replace(/\s+/g, " ");

test("homepage release label matches the current runtime release", async () => {
  const runtime = JSON.parse(await readFile(
    resolve(sourceWebsite, "../packages/runtime/package.json"), "utf8",
  ));
  assert.ok(
    (await read("public/index.html")).includes(`${runtime.version} · Assisted alpha.`),
    "The public release label must not lag the release being staged.",
  );
});

test("alpha home and install state the supported assisted release scope", async () => {
  for (const file of ["public/index.html", "templates/install.html"]) {
    const html = flat(await read(file));
    assert.match(
      html,
      /assisted[^<]*macOS arm64[^<]*Codex/i,
      `${file}: visitors need the supported assisted alpha path`,
    );
    assert.doesNotMatch(
      html,
      /publication pending|alpha candidate/i,
      `${file}: release copy must not retain stale candidate status`,
    );
    assert.doesNotMatch(html, /In Codex or Claude Code|this unchanged kit/i);
  }
});

test("alpha install explains concrete changes and remaining onboarding limits", async () => {
  const html = flat(await read("templates/install.html"));
  for (const text of [
    /cleared text stays empty/i,
    /Pause and Stop[^<]*final evidence/i,
    /negative case/i,
    /relaunch/i,
    /Claude Code[^<]*unverified/i,
    /cannot undo a request already sent/i,
  ])
    assert.match(html, text);
  assert.match(html, /0\.1\.2-rc\.1[^<]*11 October 2026/i);
  assert.doesNotMatch(html, /Verified on macOS arm64/);
  assert.match(html, /Previous alpha\.2 release checks on 21 October 2026/i);
  assert.doesNotMatch(html, /pending|will include a dated verification/i);
  assert.match(html, /Release &amp; verification metadata/);
  assert.match(html, /dated verification record/i);
});

test("recorded demo and prior preview keep their copied bytes", async () => {
  const baseline = JSON.parse(
    await readFile(
      resolve(sourceWebsite, "tests/fixtures/historical-public-files.json"),
      "utf8",
    ),
  );
  const retained = baseline.files;
  assert.equal(retained.length, 11);
  for (const f of retained)
    assert.equal(
      createHash("sha256")
        .update(await readFile(resolve(website, f.path)))
        .digest("hex"),
      f.sha256,
      `${f.path}: historic evidence/download must be immutable`,
    );
});

test("alpha tools installation stays inside the extracted kit even inside an npm workspace", async () => {
  const html = flat(await read("templates/install.html"));
  assert.ok(
    html.includes(
      'npm install --prefix "$driver_kit/installed-tools" --workspaces=false',
    ),
    "The public install command must explicitly isolate npm prefix and disable workspaces",
  );
});

test("retained alpha.2 metadata supports its explicitly historical release claims", async () => {
  const metadata = JSON.parse(
    await read("public/downloads/0.1.4-alpha.2/release.json"),
  );
  assert.equal(metadata.version, "0.1.4-alpha.2");
  assert.equal(metadata.source.dirty, false);
  assert.equal(
    metadata.archive.sha256,
    "b9555b6b237ac437f62b984f6994e3ef12ba4e8f95b730f52c9aa9313a375ee1",
  );
  const v = metadata.verification;
  assert.equal(v.date, "2026-10-21");
  assert.equal(v.sourceCi.status, "PASS");
  assert.equal(v.sourceCi.commit, metadata.source.commit);
  assert.deepEqual(v.sourceCi.nodeVersions, [22, 24]);
  assert.equal(v.exactInstalledPackage.status, "PASS");
  assert.equal(v.exactInstalledPackage.cleanup, "PASS");
  assert.deepEqual(
    [
      v.exactInstalledPackage.browserApiGroups,
      v.exactInstalledPackage.cliCases,
      v.exactInstalledPackage.finalizationCases,
      v.exactInstalledPackage.browserControlCases,
    ],
    [8, 10, 25, 9],
  );
  assert.equal(v.realApplication.status, "PASS");
  assert.deepEqual(
    [
      v.realApplication.acceptanceCheckpoints,
      v.realApplication.rustTests,
      v.realApplication.nodeTests,
    ],
    [7, 13, 7],
  );
  assert.equal(v.realApplication.postRunIntegrity, "PASS");
  assert.equal(v.installer.status, "PASS");
  assert.equal(v.installer.nestedWorkspacePreserved, true);
  assert.ok(v.limits.some((limit) => /not the application server/.test(limit)));
});
