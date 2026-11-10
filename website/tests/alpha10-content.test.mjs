import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const source = fileURLToPath(new URL("../", import.meta.url));
const website = resolve(process.env.DAEDLO_WEBSITE_ROOT ?? source);
const read = (file) => readFile(resolve(website, file), "utf8");
const flat = (html) => html.replace(/\s+/g, " ");
function section(html, title) {
  const found = html.match(
    new RegExp(
      `<section[^>]*aria-labelledby="${title}"[^>]*>([\\s\\S]*?)</section>`,
    ),
  );
  assert.ok(found, `Missing customer guidance section: ${title}`);
  return flat(found[1]);
}

test("alpha10 download allowlist permits exactly the three frozen files and retains alpha9", async () => {
  const lines = (await read("public/.assetsignore")).split(/\r?\n/);
  assert.ok(lines.includes("*"));
  assert.ok(lines.includes("*.zip"));
  for (const version of ["0.1.4-alpha.9", "0.1.4-alpha.10"]) {
    assert.deepEqual(
      lines.filter((line) => line.startsWith(`!/downloads/${version}/`)),
      [
        `!/downloads/${version}/`,
        `!/downloads/${version}/daedlo-${version}.zip`,
        `!/downloads/${version}/SHA256SUMS`,
        `!/downloads/${version}/release.json`,
      ],
    );
  }
  assert.equal(
    lines.some((line) => line.startsWith("!/downloads/0.1.4-alpha.8/")),
    false,
  );
});

test("alpha10 installation explains independent status and safe development restart recovery", async () => {
  const html = section(
    await read("templates/install.html"),
    "development-restarts-title",
  );
  assert.match(
    html,
    /viewer[^.]*browser[^.]*application observation[^.]*live image/i,
  );
  assert.match(html, /last completed run[^.]*result/i);
  assert.match(html, /Check connection[^.]*read-only/i);
  assert.match(html, /never[^.]*replay[^.]*command/i);
  assert.match(html, /does not[^.]*API health/i);
  assert.match(html, /Viewer closed/);
  assert.match(html, /Reconnecting[^.]*Connection lost/);
  assert.match(html, /newly printed URL/i);
});

test("alpha9 to alpha10 is a normal managed upgrade with unchanged dependencies and tools", async () => {
  const html = section(
    await read("templates/updates.html"),
    "alpha10-upgrade-title",
  );
  assert.match(html, /alpha\.9[^.]*alpha\.10/i);
  assert.match(html, /same dependency closure[^.]*manager contract 2/i);
  assert.match(html, /keep[^.]*existing[^.]*alpha\.9[^.]*tools/i);
  assert.match(html, /no[^.]*dependency migration[^.]*tools bootstrap/i);
  assert.match(
    html,
    /Check for updates[^.]*Install update[^.]*Restart Daedlo/i,
  );
  assert.match(html, /Revert update/);
  assert.match(html, /same configuration[^.]*store[^.]*trust[^.]*checkpoint/i);
});

test("older migration remains explicitly historical and standalone Swagger remains separate", async () => {
  const page = await read("templates/updates.html");
  const historical = section(page, "native-tools-title");
  assert.match(historical, /Earlier installations: alpha\.7 to alpha\.9/i);
  assert.match(historical, /QA manifest[^.]*lock migration/i);
  assert.match(
    flat(page),
    /Native managed Swagger onboarding and updates are unsupported/i,
  );
});
