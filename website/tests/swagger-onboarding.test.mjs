import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
const source = fileURLToPath(new URL("../", import.meta.url));
const website = resolve(process.env.DAEDLO_WEBSITE_ROOT ?? source);
const read = (file) => readFile(resolve(website, file), "utf8");
const flat = (text) => text.replace(/\s+/g, " ");

test("alpha10 homepage retains bounded reusable Swagger support", async () => {
  const html = flat(await read("public/index.html"));
  assert.match(html, /0\.1\.4-alpha\.10 · Assisted alpha\./);
  assert.match(html, /Swagger UI/);
  assert.match(html, /OpenAPI 3\.0, 3\.1 and 3\.2/);
  assert.match(html, /bounded|supported subset/i);
  assert.match(
    html,
    /For other browser flows, application-specific integration/i,
  );
});

test("copied onboarding prompt routes Swagger to the shipped standalone integration", async () => {
  const html = await read("templates/install.html");
  const prompt = flat(
    html.match(/id="onboarding-prompt"[\s\S]*?>([\s\S]*?)<\/pre/)[1],
  );
  assert.match(prompt, /integrations\/swagger\/README\.md/);
  assert.match(prompt, /runtimeRoot/);
  assert.match(prompt, /allowOperations/);
  assert.match(prompt, /allowWrites/);
  assert.match(prompt, /standalone Swagger[^.]*skip steps 5 and 6/i);
  assert.match(prompt, /5\. For a managed application integration/);
  assert.match(prompt, /6\. For that managed integration/);
  assert.match(prompt, /Swagger[^.]*native managed[^.]*unsupported/i);
});

test("installation copy separates API transport evidence from persistence and full OpenAPI conformance", async () => {
  const html = flat(await read("templates/install.html"));
  assert.match(html, /OpenAPI 3\.0, 3\.1 and 3\.2/);
  assert.match(html, /HTTP[^.]*does not prove[^.]*persist/i);
  assert.match(html, /unsupported[^.]*fail closed/i);
  assert.match(html, /explicit[^.]*password[^.]*mask/i);
});

test("update guidance preserves alpha7 recovery and keeps standalone Swagger outside managed promises", async () => {
  const html = flat(await read("templates/updates.html"));
  assert.match(html, /alpha\.7[^.]*alpha\.9/i);
  assert.match(html, /alpha\.8[^.]*held/i);
  assert.match(html, /standalone Swagger/i);
  assert.match(html, /integrations\/swagger\/README\.md/);
  assert.match(html, /native managed Swagger[^.]*unsupported/i);
});

test("integration guide offers reusable Swagger and scoped migration without implying managed support", async () => {
  const html = flat(await read("public/guide.html"));
  assert.match(html, /integrations\/swagger\/README\.md/);
  assert.match(html, /standalone[^.]*CLI/i);
  assert.match(html, /native managed Swagger[^.]*unsupported/i);
  assert.match(html, /explicit[^.]*password[^.]*mask/i);
  assert.match(html, /legacy[^.]*QA[^.]*dependencies/i);
  assert.match(html, /snapshot[^.]*restore/i);
  assert.match(html, /OpenAPI 3\.0, 3\.1 and 3\.2/);
});

test("alpha7 migration guidance names the changed QA dependency closure", async () => {
  const html = flat(await read("templates/updates.html"));
  assert.match(html, /Playwright[^.]*dependency closure/i);
  assert.match(html, /QA manifest[^.]*lock/i);
  assert.match(html, /snapshot[^.]*restore/i);
  assert.match(html, /normal application dependencies[^.]*unchanged/i);
});
