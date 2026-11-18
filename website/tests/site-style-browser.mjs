// Compare the rendered public pages with the homepage in a locally staged site.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PUBLIC_FILES } from "../scripts/manifest.mjs";
import { createPreviewServer } from "../scripts/serve.mjs";
import {
  DEFAULT_WEBSITE_ROOT,
  parseOptions,
} from "../scripts/stage-release.mjs";

const archivedPage = "demo-2026-10-11.html";
const currentPages = [
  "index.html",
  ...[...PUBLIC_FILES]
    .filter(
      (file) =>
        file.endsWith(".html") &&
        file !== "index.html" &&
        file !== archivedPage,
    )
    .sort(),
];
const missing = "missing/nested/page";
const screens = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
  { name: "small-phone", width: 320, height: 640 },
];

async function renderedPage(page) {
  return page.evaluate(() => {
    const header = document.querySelector("header");
    const footer = document.querySelector("footer");
    const heading = document.querySelector("main h1");
    const headerNav = header.querySelector("nav");
    const brand = header.querySelector('a[href="/index.html"]');
    const links = (nav, visibleOnly) =>
      [...nav.querySelectorAll("a")]
        .filter((link) => !visibleOnly || link.getClientRects().length > 0)
        .map((link) => ({
          href: link.getAttribute("href"),
          label: link.textContent.trim().replace(/\s+/g, " "),
        }));
    const body = getComputedStyle(document.body);
    const masthead = header.getBoundingClientRect();
    const accent = [...heading.querySelectorAll("*")].some((word) => {
      const style = getComputedStyle(word);
      return (
        word.textContent.trim() &&
        style.fontFamily.includes("Instrument Serif") &&
        style.fontStyle === "italic" &&
        word.getClientRects().length > 0
      );
    });
    return {
      paper: body.backgroundColor,
      ink: body.color,
      type: body.fontFamily,
      title: heading.innerText,
      accent,
      fontLoaded: [...document.fonts].some(
        (face) =>
          face.family.includes("Instrument Serif") && face.status === "loaded",
      ),
      masthead: {
        left: Math.round(masthead.left),
        width: Math.round(masthead.width),
        height: Math.round(masthead.height),
        brandSize: getComputedStyle(brand).fontSize,
        border: getComputedStyle(header).borderBottom,
      },
      navigationFits:
        brand.getBoundingClientRect().right <=
        headerNav.getBoundingClientRect().left + 1,
      headerLinks: links(headerNav, true),
      footerLinks: links(footer.querySelector("nav"), false),
      pageWidth: document.documentElement.scrollWidth,
      deviceWidth: innerWidth,
    };
  });
}

const args = parseOptions(process.argv.slice(2), [
  "--website-root",
  "--evidence-root",
]);
const websiteRoot = resolve(args["--website-root"] ?? DEFAULT_WEBSITE_ROOT);
const evidenceRoot = resolve(
  args["--evidence-root"] ?? "artifacts/website-style",
);
await mkdir(evidenceRoot, { recursive: true });
const evidence = await mkdtemp(join(evidenceRoot, "browser-"));
const archiveIdentity = JSON.parse(
  await readFile(
    fileURLToPath(
      new URL("./fixtures/historical-public-files.json", import.meta.url),
    ),
    "utf8",
  ),
).files.find((file) => file.archivedPath === "public/" + archivedPage);
assert.ok(archiveIdentity, "The original dated page needs its frozen receipt.");

const server = createPreviewServer({ publicRoot: join(websiteRoot, "public") });
const receipt = { status: "RUNNING", pages: [], archive: [], screenshots: [] };
let browser;
try {
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", accept);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  receipt.chromium = browser.version();
  for (const { name, width, height } of screens) {
    const context = await browser.newContext({
      viewport: { width, height },
      colorScheme: "light",
      reducedMotion: "reduce",
    });
    const problems = [];
    await context.route("**/*", async (route) => {
      if (new URL(route.request().url()).origin === origin)
        return route.continue();
      problems.push("Unexpected external request " + route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => problems.push(error.message));
    page.on("response", (response) => {
      if (
        response.status() >= 400 &&
        new URL(response.url()).pathname !== "/" + missing
      ) {
        problems.push(
          response.status() + " " + new URL(response.url()).pathname,
        );
      }
    });
    let home;
    for (const file of [...currentPages, missing, archivedPage]) {
      const target = file === "index.html" ? "/" : "/" + file;
      const id = name + " " + target;
      const response = await page.goto(origin + target, { waitUntil: "load" });
      assert.equal(response.status(), file === missing ? 404 : 200, id);
      await page.evaluate(() => document.fonts.ready);
      if (name !== "small-phone" && file !== missing) {
        const filename = name + "-" + file.replace(/\.html$/, "") + ".png";
        await page.screenshot({ path: join(evidence, filename) });
        receipt.screenshots.push(filename);
      }
      if (file === archivedPage) {
        assert.equal(
          createHash("sha256")
            .update(await response.body())
            .digest("hex"),
          archiveIdentity.sha256,
          id + " must serve the original HTML",
        );
        assert.equal(await page.locator('link[href="/demo.css"]').count(), 1);
        assert.equal(await page.locator("main h1").isVisible(), true);
        assert.equal(
          await page.locator('img[src="/demo-verified-save.png"]').count(),
          1,
        );
        receipt.archive.push({
          screen: name,
          status: response.status(),
          sha256: archiveIdentity.sha256,
        });
        continue;
      }
      assert.equal(
        await page.locator("main h1").count(),
        1,
        id + " needs one main heading",
      );
      const result = await renderedPage(page);
      if (!home) home = result;
      assert.equal(
        result.paper,
        home.paper,
        id + " must use the same paper as the homepage",
      );
      for (const key of [
        "ink",
        "type",
        "masthead",
        "headerLinks",
        "footerLinks",
      ]) {
        assert.deepEqual(
          result[key],
          home[key],
          id + " must match homepage " + key,
        );
      }
      assert.ok(
        result.accent && result.fontLoaded,
        id +
          " must render its editorial heading in the local Instrument Serif Italic",
      );
      assert.ok(
        result.navigationFits,
        id + " brand and navigation must not overlap",
      );
      assert.ok(
        result.pageWidth <= result.deviceWidth + 1,
        id + " must fit the viewport",
      );
      assert.ok(
        result.headerLinks.some(({ href }) => href === "/install.html"),
        id + " must expose the installation route",
      );
      if (file === missing) {
        assert.equal(
          result.title,
          receipt.pages.find(
            (row) => row.screen === name && row.file === "404.html",
          ).title,
        );
      }
      await page.keyboard.press("Tab");
      assert.equal(
        await page.locator(":focus").getAttribute("href"),
        "#main",
        id + " first tab stop must skip the masthead",
      );
      await page.keyboard.press("Enter");
      assert.equal(
        new URL(page.url()).hash,
        "#main",
        id + " skip action must reach main",
      );
      receipt.pages.push({
        screen: name,
        file,
        title: result.title,
        status: response.status(),
        pageWidth: result.pageWidth,
      });
    }
    assert.deepEqual(
      problems,
      [],
      name + " should load local assets without browser errors",
    );
    await context.close();
  }
  receipt.status = "PASS";
} catch (error) {
  receipt.status = "FAIL";
  receipt.failure = error.message;
  throw error;
} finally {
  await browser?.close();
  if (server.listening) {
    const closed = once(server, "close");
    server.close();
    await closed;
  }
  await writeFile(
    join(evidence, "result.json"),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  console.log(receipt.status, evidence);
}
