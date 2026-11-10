// Public visitor journeys against a local, explicitly staged website.
// External link activation is intercepted; this does not verify GitHub uptime
// or publish anything. Product/customer acceptance remains separate.
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createPreviewServer } from "../scripts/serve.mjs";
import { parseOptions } from "../scripts/stage-release.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceUrl = "https://github.com/givtaj/daedlo";

export async function checkPublicLaunchBrowser({
  websiteRoot,
  evidenceRoot = join(repository, "artifacts/website-public-launch"),
} = {}) {
  assert.ok(
    websiteRoot,
    "--website-root must name an explicitly staged website.",
  );
  const site = resolve(websiteRoot);
  await mkdir(evidenceRoot, { recursive: true });
  const evidence = await mkdtemp(join(resolve(evidenceRoot), "browser-"));
  const receipt = {
    schemaVersion: 1,
    status: "RUNNING",
    mode: "Local Chromium visitor journeys; GitHub navigation intercepted",
    evidence,
    checks: [],
    screenshots: [],
    cleanup: {},
  };
  const server = createPreviewServer({ publicRoot: join(site, "public") });
  const errors = [];
  let browser;
  let failure;
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
    receipt.browserVersion = browser.version();

    for (const [label, viewport] of [
      ["desktop", { width: 1365, height: 900 }],
      ["narrow", { width: 390, height: 844 }],
    ]) {
      const context = await browser.newContext({
        viewport,
        colorScheme: "light",
        reducedMotion: "reduce",
      });
      const activated = [];
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === origin || url.protocol === "data:") {
          await route.continue();
        } else if (
          url.origin === "https://github.com" &&
          /^\/givtaj\/daedlo(?:\/|$)/.test(url.pathname) &&
          route.request().isNavigationRequest()
        ) {
          activated.push(url.href);
          await route.fulfill({
            contentType: "text/html",
            body: "<!doctype html><title>Intercepted public link</title><p>Local destination check only.</p>",
          });
        } else {
          errors.push(`Unexpected external request: ${url.origin}`);
          await route.abort();
        }
      });
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      page.on("pageerror", (error) => errors.push(error.message));
      async function open(path) {
        const response = await page.goto(origin + path, { waitUntil: "load" });
        assert.equal(response.status(), 200, `${label}: ${path} must load.`);
      }
      async function layout(name) {
        const widths = await page.evaluate(() => ({
          viewport: innerWidth,
          document: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
        }));
        assert.ok(
          widths.document <= widths.viewport + 1 &&
            widths.body <= widths.viewport + 1,
          `${label} ${name} must fit horizontally: ${JSON.stringify(widths)}`,
        );
        receipt.checks.push({
          name: `${label} ${name} fits viewport`,
          status: "PASS",
          ...widths,
        });
      }
      async function screenshot(name, fullPage = true) {
        const filename = `${label}-${name}.png`;
        await page.screenshot({ path: join(evidence, filename), fullPage });
        receipt.screenshots.push(filename);
      }
      async function activate(locator, expected) {
        assert.equal(
          await locator.isVisible(),
          true,
          `${label}: public navigation must be visible.`,
        );
        assert.match(
          (await locator.innerText()).trim(),
          /\S/,
          "Public links need text labels.",
        );
        await locator.focus();
        const response = context.waitForEvent("response", {
          predicate: (value) =>
            value.url() === expected && value.request().isNavigationRequest(),
        });
        await locator.press("Enter");
        await response;
        assert.ok(
          activated.includes(expected),
          `${label}: link must activate the intended public destination.`,
        );
      }

      await open("/");
      await layout("homepage");
      await screenshot("home");
      await screenshot("hero", false);
      const current = page.locator("#latest-release");
      assert.equal(
        await current.isVisible(),
        true,
        "Latest release must be visible, not hidden in a reference disclosure.",
      );
      // CSS text-transform can uppercase the visible prerelease name. Compare
      // the authored version with release URLs, rather than its presentation.
      const version = (await current.textContent()).match(
        /\b\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?\b/,
      )?.[0];
      assert.ok(
        version,
        "The latest-release summary must name its available version.",
      );
      const notes = current.locator(
        'a[href^="https://github.com/givtaj/daedlo/releases"]',
      );
      assert.ok(
        (await notes.count()) > 0,
        "Visitors need the public release notes.",
      );
      const releaseHref = await notes.first().getAttribute("href");
      assert.match(
        releaseHref,
        /^https:\/\/github\.com\/givtaj\/daedlo\/releases(?:\/tag\/[^/]+)?\/?$/,
      );
      if (releaseHref.includes("/tag/"))
        assert.equal(
          new URL(releaseHref).pathname.split("/").at(-1).replace(/^v/, ""),
          version,
          "The release-note tag must exactly match the advertised version.",
        );
      const roadmap = page.locator("#roadmap");
      await roadmap.scrollIntoViewIfNeeded();
      assert.equal(await roadmap.isVisible(), true);
      for (const pattern of [
        /(?:persistent|durable|target)[\s\S]*?(?:history|recover)/i,
        /Docker Compose/i,
      ]) {
        const item = roadmap
          .locator("article, li")
          .filter({ hasText: pattern })
          .first();
        assert.equal(
          await item.isVisible(),
          true,
          "Each development direction must be readable on the page.",
        );
        assert.match(await item.innerText(), /in development/i);
      }
      assert.match(
        await roadmap.innerText(),
        /not (?:yet )?(?:included|available|shipped)|unreleased/i,
      );
      const roadmapLink = roadmap.locator(
        `a[href="${sourceUrl}/blob/main/ROADMAP.md"]`,
      );
      assert.equal(await roadmapLink.isVisible(), true);
      await screenshot("roadmap", false);
      receipt.checks.push({
        name: `${label} current release and unreleased roadmap remain distinct`,
        status: "PASS",
        version,
      });

      await activate(
        page.locator(`header a[href="${sourceUrl}"]`).first(),
        sourceUrl,
      );
      await open("/");
      await activate(
        page
          .locator(`a[href="${sourceUrl}/blob/main/CONTRIBUTING.md"]`)
          .first(),
        `${sourceUrl}/blob/main/CONTRIBUTING.md`,
      );
      receipt.checks.push({
        name: `${label} keyboard source and contribution navigation`,
        status: "PASS",
        destinations: [...activated],
      });

      await open("/");
      await page
        .locator('a[href="/demo.html#roots-recording"]')
        .first()
        .click();
      assert.equal(new URL(page.url()).pathname, "/demo.html");
      assert.equal(new URL(page.url()).hash, "#roots-recording");
      const roots = page.locator("#roots-recording");
      assert.equal(await roots.isVisible(), true);
      assert.equal(
        await roots.locator('time[datetime="2026-11-09"]').isVisible(),
        true,
      );
      const rootsText = await roots.innerText();
      for (const pattern of [
        /recorded/i,
        /candidate/i,
        /32f11d4/,
        /published/i,
        /30d2a98/,
        /independent/i,
        /reload/i,
      ])
        assert.match(rootsText, pattern);
      const capture = roots.locator('img[src="/demo-roots-save.png"]');
      assert.equal(await capture.isVisible(), true);
      assert.deepEqual(
        await capture.evaluate((image) => ({
          complete: image.complete,
          width: image.naturalWidth,
          height: image.naturalHeight,
        })),
        { complete: true, width: 1440, height: 900 },
        "The accepted Roots capture must load at its original dimensions.",
      );
      const rootsEvidence = roots.locator(
        'a[href="/demo-roots-evidence.json"]',
      );
      assert.equal(await rootsEvidence.isVisible(), true);
      const evidenceResponse = await page.request.get(
        origin + (await rootsEvidence.getAttribute("href")),
      );
      assert.equal(
        evidenceResponse.status(),
        200,
        "Visitors must be able to retrieve the separate Roots evidence.",
      );
      const rootsRecord = await evidenceResponse.json();
      assert.equal(rootsRecord.recordedOn, "2026-11-09");
      assert.ok(rootsRecord.recording.candidateSource.startsWith("32f11d4"));
      assert.ok(rootsRecord.recording.publishedSource.startsWith("30d2a98"));
      assert.equal(rootsRecord.independentEvidence.exactlyOneNewRow, true);
      assert.equal(
        rootsRecord.independentEvidence.sameSavedRowAfterBrowserReload,
        true,
      );
      assert.equal(rootsRecord.independentEvidence.reloadMutationDelta, 0);
      await layout("recorded demos");
      await screenshot("recorded-demos");
      await roots.scrollIntoViewIfNeeded();
      await screenshot("roots-recording", false);
      receipt.checks.push({
        name: `${label} homepage reaches recorded Roots candidate and its independent save/reload evidence`,
        status: "PASS",
      });
      assert.match(await page.locator("main").innerText(), /0\.1\.2-rc\.1/);
      assert.equal(
        await page.locator('time[datetime="2026-10-11"]').count(),
        1,
      );
      const install = page
        .locator('a[href="/install.html"]')
        .filter({ hasText: /current|latest/i })
        .first();
      assert.equal(await install.isVisible(), true);
      await install.click();
      assert.equal(new URL(page.url()).pathname, "/install.html");
      assert.ok(
        (await page.title()).includes(version),
        "Historical-demo CTA must arrive at the advertised current release.",
      );
      assert.doesNotMatch(
        await page.locator(".onboarding-steps").innerText(),
        /\bWBF\b/i,
      );
      assert.equal(await page.locator("#onboarding-prompt").isVisible(), true);
      await layout("installation");
      receipt.checks.push({
        name: `${label} historical demo reaches current public onboarding`,
        status: "PASS",
        version,
      });
      await screenshot("install");
      await context.close();
    }
    assert.deepEqual(
      errors,
      [],
      "Visitor journeys must not trigger unexpected errors or external traffic.",
    );
    receipt.status = "PASS";
  } catch (error) {
    failure = error;
    receipt.status = "FAIL";
    receipt.failure = error.message;
  } finally {
    if (browser) {
      try {
        await browser.close();
        receipt.cleanup.browser = "closed";
      } catch (error) {
        receipt.cleanup.browser = "failed";
        failure ??= error;
      }
    } else receipt.cleanup.browser = "not_started";
    try {
      if (server.listening) {
        await new Promise((done, reject) =>
          server.close((error) => (error ? reject(error) : done())),
        );
        receipt.cleanup.server = "closed";
      } else receipt.cleanup.server = "not_started";
    } catch (error) {
      receipt.cleanup.server = "failed";
      failure ??= error;
    }
    if (failure) receipt.status = "FAIL";
    await writeFile(
      join(evidence, "results.json"),
      JSON.stringify(receipt, null, 2) + "\n",
      { flag: "wx" },
    );
  }
  if (failure) throw Object.assign(failure, { evidence });
  return receipt;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = parseOptions(process.argv.slice(2), [
      "--website-root",
      "--evidence-root",
    ]);
    console.log(
      JSON.stringify(
        await checkPublicLaunchBrowser({
          websiteRoot: args["--website-root"],
          evidenceRoot: args["--evidence-root"],
        }),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        status: "FAIL",
        message: error.message,
        evidence: error.evidence,
      }),
    );
    process.exitCode = 1;
  }
}
