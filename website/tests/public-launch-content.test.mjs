import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const website = resolve(
  process.env.DAEDLO_WEBSITE_ROOT ??
    resolve(dirname(fileURLToPath(import.meta.url)), ".."),
);
const repository = "https://github.com/givtaj/daedlo";
// Independently reviewed original capture and candidate/published identities.
// This freezes historical evidence; it does not establish a newer release pass.
const acceptedRoots = {
  captureSha256:
    "053dcc221fb4f11f8f93193ba6bc7706c675f0943c8554b0b09bec180144c1e9",
  candidateSource: "32f11d42e027edf49066bac393cb9ddb558b79f9",
  publishedSource: "30d2a985964011c08d80db2e83a3716a2c151345",
};
const read = (path) => readFile(resolve(website, path), "utf8");
const text = (html) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const links = (html) =>
  [
    ...html.matchAll(
      /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi,
    ),
  ].map((match) => ({ href: match[1], label: text(match[2]) }));
function section(html, id) {
  return [
    ...html.matchAll(/<section\b([^>]*)>([\s\S]*?)<\/section\s*>/gi),
  ].find((match) => new RegExp(`\\bid=["']${id}["']`).test(match[1]))?.[2];
}
function linked(html, href) {
  return links(html).find((link) => link.href.replace(/\/$/, "") === href);
}

test("a public visitor can find the source and contributor guidance from the homepage", async () => {
  const home = await read("public/index.html");
  const source = linked(home, repository);
  assert.ok(
    source,
    "Homepage visitors need a direct route to Daedlo's public repository.",
  );
  assert.ok(
    source.label.length > 0,
    "The public source link needs an accessible text label.",
  );
  const contribute = linked(home, `${repository}/blob/main/CONTRIBUTING.md`);
  assert.ok(
    contribute,
    "Homepage visitors need a direct route to contribution instructions.",
  );
  assert.ok(contribute.label.length > 0);
  const header = home.match(/<header\b[^>]*>([\s\S]*?)<\/header>/i)?.[1] ?? "";
  const footer = home.match(/<footer\b[^>]*>([\s\S]*?)<\/footer>/i)?.[1] ?? "";
  assert.ok(
    linked(header, repository),
    "Public source must be discoverable in the main navigation.",
  );
  assert.ok(
    linked(footer, repository),
    "Public source must also be available from the footer.",
  );
});

test("homepage current-release information offers release notes alongside the existing install journey", async () => {
  const home = await read("public/index.html");
  const release = section(home, "latest-release");
  assert.ok(
    release,
    "Homepage visitors need a distinct latest-release section.",
  );
  assert.match(
    text(release),
    /\b\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?\b/,
    "The release summary must identify its available version.",
  );
  assert.ok(
    links(release).some(({ href }) =>
      /^https:\/\/github\.com\/givtaj\/daedlo\/releases(?:\/tag\/[^/]+)?\/?$/.test(
        href,
      ),
    ),
    "Current-release information must link to public release notes.",
  );
  assert.ok(
    links(home).some(({ href }) => /^\/install(?:\.html)?(?:#.*)?$/.test(href)),
    "The source/contribution route must preserve the existing installation journey.",
  );
});

test("historical demo provenance survives while its install CTA identifies a current release", async () => {
  const demo = await read("public/demo.html");
  assert.match(demo, /0\.1\.2-rc\.1/);
  assert.match(demo, /datetime=["']2026-10-11["']/);
  const installation = links(demo).filter(({ href }) =>
    /^\/install(?:\.html)?(?:#.*)?$/.test(href),
  );
  assert.ok(installation.length > 0);
  assert.ok(
    installation.every(
      ({ label }) =>
        !/same (?:public )?kit|same (?:preview|release)/i.test(label),
    ),
    "A historical recording must not promise its old kit at the current installation URL.",
  );
  assert.ok(
    installation.some(({ label }) => /current|latest/i.test(label)),
    "Visitors leaving the historical demo need an explicit current-release installation link.",
  );
});

test("the newer Roots recording preserves its candidate provenance and separate saved-and-reloaded evidence", async () => {
  const home = await read("public/index.html");
  const demo = await read("public/demo.html");
  const roots = section(demo, "roots-recording");
  assert.ok(
    roots,
    "The accepted Roots recording needs a separately identified demo section.",
  );
  assert.ok(
    linked(home, "/demo.html#roots-recording"),
    "Homepage visitors need a direct route to the newer Roots recording.",
  );
  assert.match(
    roots,
    /datetime=["']2026-11-09["']/,
    "The Roots recording must retain its actual capture date.",
  );
  const description = text(roots);
  assert.match(
    description,
    /recorded/i,
    "Historical capture must not be presented as a live browser.",
  );
  assert.match(description, /candidate/i);
  assert.match(
    description,
    /32f11d4/,
    "The recorded candidate must retain its source identity.",
  );
  assert.match(description, /published/i);
  assert.match(
    description,
    /30d2a98/,
    "The published source must remain distinguishable from the recorded candidate.",
  );
  assert.match(
    description,
    /independent(?:ly)?/i,
    "The result must explain the independent evidence behind the save.",
  );
  assert.match(description, /sav(?:e|ed)|persist/i);
  assert.match(
    description,
    /reload/i,
    "The recorded result must retain the reload check.",
  );
  assert.ok(
    linked(roots, "/demo-roots-evidence.json"),
    "The Roots recording needs its own public evidence record, separate from rc.1.",
  );
});

test("public Roots evidence retains the independently reviewed capture and selected-recipe outcome", async () => {
  const published = JSON.parse(await read("public/demo-roots-evidence.json"));
  const capture = await readFile(
    resolve(website, "public/demo-roots-save.png"),
  );
  assert.equal(
    createHash("sha256").update(capture).digest("hex"),
    acceptedRoots.captureSha256,
    "The public Roots screenshot must retain the independently inspected original bytes.",
  );
  assert.equal(published.capture.sha256, acceptedRoots.captureSha256);
  assert.equal(published.capture.path, "/demo-roots-save.png");
  assert.equal(published.capture.width, 1440);
  assert.equal(published.capture.height, 900);
  assert.equal(published.schemaVersion, 1);
  assert.equal(published.recordedOn, "2026-11-09");
  assert.equal(published.status, "PASS");
  assert.equal(published.application, "Roots");
  assert.equal(published.recording.candidateVersion, "0.1.4-alpha.9");
  assert.equal(
    published.recording.candidateSource,
    acceptedRoots.candidateSource,
  );
  assert.equal(
    published.recording.publishedSource,
    acceptedRoots.publishedSource,
  );
  assert.match(published.recording.kind, /candidate.*not a live session/i);
  assert.match(published.recording.continuity, /non-Swagger.*unchanged/i);
  assert.match(
    published.recording.continuity,
    /earlier candidate.*not the final package/i,
  );
  assert.deepEqual(published.flow, {
    recipe: "keyboard-saved",
    label: "Save with the keyboard on mobile",
    steps: 10,
    execution: "completed",
    applicationEffect: "saved",
  });
  assert.deepEqual(published.independentEvidence, {
    recipeSaveMutationDelta: 1,
    exactlyOneNewRow: true,
    priorRowsUnchanged: true,
    sameSavedRowAfterBrowserReload: true,
    reloadMutationDelta: 0,
  });
  assert.deepEqual(published.limits, [
    "Browser reload persistence; no application-service or database restart",
    "No complete Roots parity or everyday dependency promotion",
    "The one-save count concerns the selected recipe, not fixture preparation",
    "Recorded alpha.9 candidate evidence; not an alpha.10 acceptance claim",
  ]);
});

test("public Roots evidence admits only curated metadata without account values or private traces", async () => {
  const raw = await read("public/demo-roots-evidence.json");
  const published = JSON.parse(raw);
  assert.deepEqual(
    Object.keys(published).sort(),
    [
      "schemaVersion",
      "recordedOn",
      "status",
      "application",
      "fixture",
      "recording",
      "flow",
      "independentEvidence",
      "capture",
      "limits",
    ].sort(),
  );
  assert.deepEqual(
    Object.keys(published.recording).sort(),
    [
      "kind",
      "candidateVersion",
      "candidateSource",
      "publishedSource",
      "continuity",
    ].sort(),
  );
  assert.deepEqual(
    Object.keys(published.capture).sort(),
    ["path", "sha256", "width", "height", "description"].sort(),
  );
  assert.doesNotMatch(
    raw,
    /\/Users\/|\/private\/|\/home\/|\/tmp\/|localhost|127\.0\.0\.1|file:\/\/|[A-Z]:\\\\/i,
    "Public evidence must not disclose local paths or private service addresses.",
  );
  assert.doesNotMatch(
    raw,
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|password|credential|cookie|sessionId|userId|accountId|userName|userEmail|authorization|accessToken|rawLog|rawTrace|tracePath|processId/i,
    "Public evidence must not grow account values, authentication material or raw trace fields.",
  );
});

test("public onboarding starts from the visitor's own application without a WBF-specific instruction", async () => {
  const install = await read("templates/install.html");
  const steps = install.match(
    /<ol\b[^>]*class=["'][^"']*onboarding-steps[^"']*["'][^>]*>([\s\S]*?)<\/ol>/i,
  )?.[1];
  assert.ok(steps, "Public onboarding needs its visible initial steps.");
  assert.match(text(steps), /(?:application|project|repository)/i);
  assert.doesNotMatch(
    text(steps),
    /\bWBF\b/i,
    "The public entry steps must work for a visitor's application, without a private customer instruction.",
  );
});

test("homepage roadmap separates unreleased development from planned teaching", async () => {
  const home = await read("public/index.html");
  const roadmap = section(home, "roadmap");
  assert.ok(
    roadmap,
    "Homepage visitors need a separately identified roadmap section.",
  );
  assert.ok(
    linked(roadmap, `${repository}/blob/main/ROADMAP.md`),
    "Roadmap details must lead to the public repository roadmap.",
  );
  const cards = [
    ...roadmap.matchAll(
      /<(?:article|li)\b[^>]*>([\s\S]*?)<\/(?:article|li)>/gi,
    ),
  ].map((match) => text(match[1]));
  for (const [label, pattern] of [
    [
      "persistent target history/recovery",
      /(?:persistent|durable|target)[\s\S]*(?:history|recover)/i,
    ],
    ["Docker Compose", /Docker Compose/i],
  ]) {
    const card = cards.find((value) => pattern.test(value));
    assert.ok(
      card,
      `The roadmap must identify ${label} in its own readable item.`,
    );
    assert.match(
      card,
      /in development/i,
      `${label} must visibly remain in development.`,
    );
  }
  assert.match(
    text(roadmap),
    /not (?:yet )?(?:included|available|shipped)|unreleased/i,
    "Roadmap work must be explicitly separated from the available release.",
  );
  const teaching =
    section(home, "teaching") ??
    [...home.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/gi)].find(
      (match) => /teaching-teaser-title/.test(match[1]),
    )?.[1];
  assert.ok(teaching, "The existing teaching plan must remain discoverable.");
  assert.match(text(teaching), /planned/i);
  assert.match(text(teaching), /not included|not yet implemented/i);
});
