import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// Frozen public facts transcribed from the 11 October 2026 acceptance and
// integrity audit. Keep tests independent of ignored, local-only run artifacts.
const accepted = {
  release: "0.1.2-rc.1",
  zipSha256: "da5ce1387eb147a3fb3a7225decd3e51e9fc355a505583ccc20cb2a9bf33963b",
  presentationRun: "9feb54d4-6ca0-431a-82d1-8da2ed206657",
  saveEvidence: {
    save_status: 200,
    persisted: true,
    disk_revision: 3,
    disk_name: "Daedlo delivery pipeline — verified",
    disk_notes: "Saved from a clean public Daedlo installation.",
  },
  notEstablished: [
    "Clean OS/toolchain installation",
    "Linux/Windows",
    "Claude Code",
    "Automatic agent skill discovery",
    "Independent human onboarding",
    "Concurrent writers or save fault injection",
  ],
};
const read = async (path) =>
  readFile(resolve(root, path), "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });

test("real demo presents two recorded captures with accessible context and installation CTA", async () => {
  const html = await read("website/public/demo.html");
  assert.match(html, /Recorded real application run/);
  for (const name of ["demo-verified-save.png", "demo-restored-fields.png"]) {
    assert.match(
      html,
      new RegExp(`<img[^>]+src="/${name}"[^>]+alt="[^"]{30,}"`),
    );
  }
  assert.match(html, /not a live session/i);
  assert.match(html, /datetime="2026-10-11"/);
  assert.match(html, /href="\/install\.html"/);
  assert.match(html, /href="\/demo-evidence\.json"/);
});

test("demo explains persistence, invalid draft and acceptance boundaries without inflated claims", async () => {
  const html = (await read("website/public/demo.html")).replace(/\s+/g, " ");
  for (const expression of [
    /one PUT/i,
    /response, API and disk/i,
    /name and notes/i,
    /empty name/i,
    /zero PUT/i,
    /13 Rust/,
    /7 Node/,
    /fresh dependency caches/i,
    /existing.*toolchains/i,
    /authored 3D simulation/i,
    /Linux, Windows and Claude Code.*unverified/i,
    /Rust state model and JavaScript adapter/i,
  ])
    assert.match(html, expression);
  assert.doesNotMatch(
    html,
    /https?:\/\/(?:localhost|127\.0\.0\.1)|\/Users\/|\/private\/tmp\//,
  );
  assert.doesNotMatch(html, /<iframe|<script|onclick=/i);
});

test("public demo evidence retains exact acceptance values and package identity", async () => {
  const published = JSON.parse(
    (await read("website/public/demo-evidence.json")) || "{}",
  );
  assert.equal(published.status, "PASS");
  assert.equal(published.release.version, accepted.release);
  assert.equal(published.release.zipSha256, accepted.zipSha256);
  assert.equal(published.release.packagesUnchanged, true);
  assert.deepEqual(published.tests, { rust: 13, node: 7 });
  assert.equal(published.presentation.runId, accepted.presentationRun);
  assert.equal(published.presentation.stages, 5);
  assert.equal(published.presentation.workspacePutRequests, 1);
  assert.deepEqual(published.presentation.saveEvidence, accepted.saveEvidence);
  assert.equal(published.reopenedEditor.workspacePutRequests, 0);
  assert.deepEqual(published.reopenedEditor.outcome, {
    kind: "success",
    label: "Editor opened with persisted model fields",
  });
  assert.deepEqual(published.notEstablished, accepted.notEstablished);
});

test("public demo metadata contains only curated evidence, never local resource or session details", async () => {
  const raw = await read("website/public/demo-evidence.json");
  const published = JSON.parse(raw || "{}");
  assert.deepEqual(
    Object.keys(published).sort(),
    [
      "recordedOn",
      "status",
      "release",
      "application",
      "environment",
      "tests",
      "negativeCase",
      "presentation",
      "reopenedEditor",
      "notEstablished",
      "captures",
      "scope",
    ].sort(),
  );
  assert.doesNotMatch(
    raw,
    /\/Users\/|\/private\/|localhost|127\.0\.0\.1|sessionId|processId|cookie|authorization|rawLog/i,
  );
  assert.deepEqual(
    published.captures.map((capture) => capture.path),
    ["/demo-verified-save.png", "/demo-restored-fields.png"],
  );
});
