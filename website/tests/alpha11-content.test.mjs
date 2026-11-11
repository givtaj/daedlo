import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const website = resolve(
  process.env.DAEDLO_WEBSITE_ROOT ??
    fileURLToPath(new URL("../", import.meta.url)),
);
const read = (file) => readFile(resolve(website, file), "utf8");
const text = (html) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
function section(html, title) {
  const found = html.match(
    new RegExp(
      `<section[^>]*aria-labelledby="${title}"[^>]*>([\\s\\S]*?)</section>`,
    ),
  );
  assert.ok(found, `Missing customer guidance section: ${title}`);
  return found[1];
}

test("alpha11 homepage identifies the new release without relabelling the recorded alpha9 flow", async () => {
  const html = await read("public/index.html");
  const current = section(html, "latest-release-title");
  assert.match(text(current), /Available now · 0\.1\.4-alpha\.11/);
  assert.match(current, /releases\/tag\/v0\.1\.4-alpha\.11/);
  assert.match(text(current), /review[^.]*session/i);
  assert.match(text(current), /model[^.]*history/i);
  assert.match(html, /href="\/updates\.html#alpha11-tools-title"/);
  assert.match(text(html), /Roots · Recorded alpha\.9 candidate flow/);
  assert.match(html, /demo-roots-save\.png/);
});

test("existing users get an explicit tools bootstrap that preserves the original managed installation", async () => {
  const html = section(
    await read("templates/updates.html"),
    "alpha11-tools-title",
  );
  const copy = text(html);
  assert.match(copy, /alpha\.9 tools[^.]*alpha\.10 runtime/i);
  assert.match(copy, /runtime update[^.]*keeps[^.]*existing tools/i);
  assert.match(copy, /separate bootstrap of the verified alpha\.11 tools/i);
  assert.match(
    copy,
    /safely stop[^.]*old owner[^.]*original tools[^.]*configuration/i,
  );
  assert.match(
    copy,
    /same configuration[^.]*registration[^.]*store[^.]*publisher trust[^.]*signed checkpoint/i,
  );
  assert.match(
    copy,
    /retain[^.]*old tools[^.]*browser[^.]*installation[^.]*reports/i,
  );
  assert.match(copy, /cannot[^.]*retrofit[^.]*running[^.]*older/i);
  assert.match(html, /href="\/install\.html#manual"/);
  assert.match(html, /blob\/v{{VERSION}}\/docs\/native-setup\.md/);
});

test("recovery guidance requires review and independent safety while preserving uncertain evidence", async () => {
  for (const file of ["templates/install.html", "templates/updates.html"]) {
    const html = section(await read(file), "managed-recovery-title");
    const copy = text(html);
    assert.match(copy, /abandon-review[\s\S]*abandon/);
    assert.match(copy, /draft[^.]*pending[^.]*effects/i);
    assert.match(copy, /unknown[^.]*block/i);
    assert.match(copy, /attached[^.]*remain/i);
    assert.match(copy, /original[^.]*uncertain[^.]*report/i);
    assert.match(copy, /later[^.]*verification[^.]*separate[^.]*record/i);
    assert.match(copy, /never[^.]*replay/i);
    assert.match(html, /blob\/v{{VERSION}}\/docs\/managed-abandonment\.md/);
  }
});

test("model migration guidance requires full review and preserves the same store and rollback", async () => {
  const html = section(
    await read("templates/updates.html"),
    "model-migration-title",
  );
  const copy = text(html);
  assert.match(
    copy,
    /migrate-prepare[\s\S]*migrate-review[\s\S]*migrate-activate/,
  );
  assert.match(copy, /complete descriptors/i);
  assert.match(copy, /exact review[^.]*SHA-256/i);
  assert.match(copy, /same store[^.]*history/i);
  assert.match(copy, /accepted runtime[^.]*release/i);
  assert.match(copy, /stop[^.]*old owner[^.]*before[^.]*registration/i);
  assert.match(copy, /ordinary[^.]*refresh[^.]*refuse/i);
  assert.match(copy, /Revert[^.]*authored files[^.]*application writes/i);
  assert.match(html, /blob\/v{{VERSION}}\/docs\/model-migration\.md/);
});

test("the copied onboarding prompt preserves existing ownership and reads the packaged recovery guides", async () => {
  const html = await read("templates/install.html");
  const prompt = html.match(
    /id="onboarding-prompt"[\s\S]*?>\s*([\s\S]*?)<\/pre/,
  )?.[1];
  assert.ok(prompt);
  assert.match(prompt, /docs\/native-setup\.md/);
  assert.match(prompt, /docs\/managed-abandonment\.md/);
  assert.match(prompt, /docs\/model-migration\.md/);
  assert.match(
    prompt,
    /safely stop[^.]*old owner[^.]*original tools[^.]*configuration/i,
  );
  assert.match(
    prompt,
    /same configuration[^.]*registration[^.]*store[^.]*publisher trust[^.]*signed checkpoint/i,
  );
  assert.match(prompt, /runtime update[^.]*does not[^.]*replace[^.]*tools/i);
});
