import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { renderInstallTemplate } from "../scripts/stage-release.mjs";

const sourceWebsite = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const website = resolve(process.env.DAEDLO_WEBSITE_ROOT ?? sourceWebsite);
const template = () =>
  readFile(resolve(website, "templates/install.html"), "utf8");
const metadata = (version, digest) => ({
  version,
  archive: { bytes: 206234, sha256: digest },
  tools: { sha256: "b".repeat(64) },
  bundle: { manifestSha256: "c".repeat(64) },
});
function promptFrom(html) {
  const matches = [
    ...html.matchAll(
      /<pre\b([^>]*\bid=["']onboarding-prompt["'][^>]*)>([\s\S]*?)<\/pre>/g,
    ),
  ];
  assert.equal(
    matches.length,
    1,
    "Installation needs exactly one complete, selectable onboarding prompt.",
  );
  assert.match(
    matches[0][1],
    /\btabindex=["']0["']/,
    "The prompt must be keyboard focusable.",
  );
  return matches[0][2]
    .replace(/<[^>]*>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .trim();
}

test("install has one accessible prompt, explicit copy control and live feedback", async () => {
  const html = await template();
  promptFrom(html);
  const buttons = [
    ...html.matchAll(
      /<button\b([^>]*\bid=["']copy-onboarding-prompt["'][^>]*)>([\s\S]*?)<\/button>/g,
    ),
  ];
  assert.equal(
    buttons.length,
    1,
    "There must be one copy action for the complete prompt.",
  );
  assert.match(buttons[0][1], /\btype=["']button["']/);
  assert.equal(
    buttons[0][2].replace(/<[^>]*>/g, "").trim(),
    "Copy Codex prompt",
  );
  const status = html.match(/<[^>]+\bid=["']copy-status["'][^>]*>/)?.[0];
  assert.ok(status, "Copy feedback must be present.");
  assert.match(status, /\brole=["']status["']/);
  assert.match(html, /<script\b[^>]*\bsrc=["']\/onboarding\.js["']/);
  assert.match(
    html,
    /<noscript\b[^>]*>[\s\S]*?(?:select|copy)[\s\S]*?<\/noscript\s*>/i,
  );
});

test("rendered prompt carries its selected HTTPS archive and exact digest without path placeholders", async () => {
  const html = await template();
  for (const [version, digest] of [
    [
      "0.1.4-alpha.3",
      "f569bc0c84bf1b7ac5efe59c610916ac8ab0d5bb3322ed520114d8880262b190",
    ],
    ["7.8.9-alpha.1", "d".repeat(64)],
  ]) {
    const rendered = renderInstallTemplate(
      html,
      metadata(version, digest),
    ).toString();
    const prompt = promptFrom(rendered);
    assert.ok(
      prompt.includes(
        `https://daedlo.com/downloads/${version}/daedlo-${version}.zip`,
      ),
      "The copied prompt must contain the complete selected HTTPS download URL.",
    );
    assert.ok(
      prompt.includes(digest),
      "The copied prompt must carry the independently pinned archive digest.",
    );
    assert.doesNotMatch(
      prompt,
      /{{|}}|\/absolute\/path\/to|REPLACE THE KIT PATH/i,
    );
    assert.match(prompt, /verif(?:y|ication)|check/i);
  }
});

test("copied prompt includes first-flow acceptance, preservation and managed-update handoff", async () => {
  const prompt = promptFrom(
    renderInstallTemplate(
      await template(),
      metadata("0.1.4-alpha.3", "a".repeat(64)),
    ).toString(),
  );
  for (const [label, pattern] of [
    ["kit setup", /START_HERE\.md/],
    ["agent handoff", /AGENT_START\.md/],
    ["complete bundled skill", /skills\/browser-driver\/SKILL\.md/],
    [
      "current application",
      /(?:current|this|open(?:ed)?) (?:application|project|repository)|application project/i,
    ],
    ["preservation", /preserv(?:e|ing|ation)/i],
    ["application data", /data/i],
    ["accepted model", /model/i],
    ["adapter", /adapter/i],
    [
      "existing flow",
      /(?:existing|accepted|agreed)[\s\S]{0,100}flow|flow[\s\S]{0,100}(?:existing|accepted|agreed)/i,
    ],
    ["visible browser evidence", /visible[\s\S]{0,50}(?:viewer|browser)/i],
    [
      "independent persistence",
      /independent[\s\S]{0,90}(?:persist|read)|(?:persist|read)[\s\S]{0,90}independent/i,
    ],
    ["negative case", /negative|no-write|zero writes/i],
    ["relaunch proof", /relaunch/i],
    ["final report", /report/i],
    ["signed update feed", /https:\/\/daedlo\.com\/updates\/preview\.json/],
    ["bundled trust pin", /docs\/update-trust\/production\.json/],
    ["managed launcher", /managed[ -]launch|createManagedLaunch/],
    ["safe restart", /restart/i],
    ["rollback", /rollback|revert/i],
    ["unsafe draft boundary", /draft/i],
  ])
    assert.match(prompt, pattern, `The copied prompt is missing ${label}.`);
});

test("canonical agent prompt appears before manual installation and identifies WBF only as an opened project", async () => {
  const html = await template();
  promptFrom(html);
  const position = html.indexOf('id="onboarding-prompt"');
  for (const id of ["verify", "tools", "manual"]) {
    const manual = html.indexOf(`id="${id}"`);
    assert.ok(
      manual >= 0 && position < manual,
      `The prompt must precede ${id} instructions.`,
    );
  }
  assert.match(html, /WBF/);
  assert.match(html, /open[\s\S]{0,160}WBF|WBF[\s\S]{0,160}open/i);
  assert.doesNotMatch(
    html,
    /<blockquote\b/i,
    "Do not retain a competing legacy onboarding prompt.",
  );
});

test("update setup points to the canonical install prompt instead of maintaining another prompt", async () => {
  const html = await readFile(
    resolve(website, "templates/updates.html"),
    "utf8",
  );
  assert.match(html, /href=["']\/install\.html#agent["']/);
  assert.doesNotMatch(
    html,
    /<blockquote\b|id=["'](?:onboarding-prompt|copy-onboarding-prompt)["']/i,
  );
});

test("homepage and integration guide retain discoverable installation entrypoints", async () => {
  for (const page of ["index.html", "guide.html"]) {
    const html = await readFile(resolve(website, "public", page), "utf8");
    assert.match(
      html,
      /href=["']\/install(?:\.html)?(?:#agent)?["']/,
      `${page} must lead to the one installation page.`,
    );
  }
});
