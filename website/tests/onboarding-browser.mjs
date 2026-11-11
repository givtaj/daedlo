// Local browser acceptance of staged public onboarding assets. No customer app,
// installation, production request or update operation is performed.
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createPreviewServer } from "../scripts/serve.mjs";
import {
  parseOptions,
  renderInstallTemplate,
  verifyReleaseDirectory,
  websiteReleaseNames,
} from "../scripts/stage-release.mjs";

import { UPDATE_TRUST } from "../scripts/stage-updates.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const success =
  "Copied. Paste this into Codex with your application project open.";
const unavailable =
  "Copy unavailable. Select the prompt below and copy it manually.";

export async function checkOnboardingBrowser({
  websiteRoot,
  updateTrust = UPDATE_TRUST,
  evidenceRoot = join(repository, "artifacts/unified-onboarding"),
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
    mode: "headless Chromium inspecting a local staged website",
    evidence,
    trust: {
      publicKeySha256: updateTrust.expectedPublicKeySha256,
      mode:
        updateTrust.expectedPublicKeySha256 ===
        UPDATE_TRUST.expectedPublicKeySha256
          ? "production pin"
          : "explicit isolated test pin",
    },
    checks: [],
    screenshots: [],
    cleanup: {},
  };
  const server = createPreviewServer({
    publicRoot: join(site, "public"),
    updateTrust,
  });
  let browser;
  const errors = [];
  let failure;
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
    receipt.browserVersion = browser.version();
    async function context({
      width = 1280,
      height = 900,
      clipboard = "success",
      javaScriptEnabled = true,
    } = {}) {
      const owned = await browser.newContext({
        viewport: { width, height },
        javaScriptEnabled,
        colorScheme: "light",
        reducedMotion: "reduce",
      });
      await owned.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === origin || url.protocol === "data:")
          await route.continue();
        else {
          errors.push("Unexpected external website request");
          await route.abort();
        }
      });
      if (javaScriptEnabled && clipboard !== "native")
        await owned.addInitScript(
          ({ clipboard }) => {
            window.__onboardingCopyAttempts = 0;
            window.__onboardingCopies = [];
            Object.defineProperty(navigator, "clipboard", {
              configurable: true,
              value: {
                async writeText(value) {
                  window.__onboardingCopyAttempts++;
                  if (clipboard === "denied")
                    throw new DOMException(
                      "Denied by acceptance fixture",
                      "NotAllowedError",
                    );
                  window.__onboardingCopies.push(value);
                },
              },
            });
          },
          { clipboard },
        );
      if (clipboard === "native")
        await owned.grantPermissions(["clipboard-read", "clipboard-write"], {
          origin,
        });
      const page = await owned.newPage();
      page.setDefaultTimeout(5000);
      page.on("pageerror", () =>
        errors.push("Unexpected browser script error"),
      );
      return { owned, page };
    }
    async function open(page, path = "/install.html#agent") {
      const response = await page.goto(origin + path, { waitUntil: "load" });
      assert.equal(
        response.status(),
        200,
        "Staged page must be served successfully.",
      );
    }
    async function screenshot(page, name) {
      const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: join(evidence, name), fullPage: true });
      await page.evaluate(({ x, y }) => scrollTo(x, y), scroll);
      receipt.screenshots.push(name);
    }
    async function noOverflow(page, label) {
      const widths = await page.evaluate(() => ({
        viewport: innerWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }));
      assert.ok(
        widths.document <= widths.viewport + 1 &&
          widths.body <= widths.viewport + 1,
        `${label} must not scroll horizontally: ${JSON.stringify(widths)}`,
      );
      receipt.checks.push({
        name: `${label} horizontal layout`,
        status: "PASS",
        ...widths,
      });
    }
    const desktop = await context();
    await open(desktop.page);
    await screenshot(desktop.page, "desktop-initial.png");
    const prompt = desktop.page.locator("#onboarding-prompt");
    assert.equal(
      await prompt.count(),
      1,
      "Rendered installation needs exactly one complete onboarding prompt.",
    );
    assert.equal(await prompt.getAttribute("tabindex"), "0");
    assert.equal(await prompt.isVisible(), true);
    const payload = await prompt.evaluate((element) =>
      element.textContent.trim(),
    );
    assert.ok(
      payload.length > 1000,
      "The visible prompt must be a complete integration handoff.",
    );
    const version = payload.match(
      /https:\/\/daedlo\.com\/downloads\/([^/\s]+)\/daedlo-\1\.zip/,
    )?.[1];
    assert.ok(
      version,
      "The complete copied payload must identify a pinned HTTPS release.",
    );
    const release = await verifyReleaseDirectory({
      releaseDirectory: join(site, "public/downloads", version),
      expectedVersion: version,
    });
    assert.ok(
      payload.includes(release.metadata.archive.sha256),
      "The visible payload must contain the exact staged archive digest.",
    );
    const html = await readFile(join(site, "public/install.html"));
    const template = await readFile(
      join(site, "templates/install.html"),
      "utf8",
    );
    assert.ok(
      html.equals(renderInstallTemplate(template, release.metadata)),
      "The browser must inspect the current rendered source template.",
    );
    const names = websiteReleaseNames(release.metadata);
    assert.ok(payload.includes(`skills/${names.skill}/SKILL.md`));
    receipt.release = {
      version,
      archiveSha256: release.metadata.archive.sha256,
      promptCharacters: payload.length,
    };
    await noOverflow(desktop.page, "desktop");
    const copy = desktop.page.getByRole("button", {
      name: "Copy Codex prompt",
      exact: true,
    });
    assert.equal(await copy.getAttribute("type"), "button");
    await copy.waitFor({ state: "visible" });
    await copy.click();
    await desktop.page.waitForFunction(
      (expected) =>
        document.querySelector("#copy-status")?.textContent.trim() === expected,
      success,
    );
    assert.equal(
      await desktop.page.locator("#copy-status").getAttribute("role"),
      "status",
    );
    assert.deepEqual(
      await desktop.page.evaluate(() => window.__onboardingCopies),
      [payload],
      "Clipboard must receive the complete textContent.trim() exactly once.",
    );
    assert.equal(
      await desktop.page.evaluate(() => window.__onboardingCopyAttempts),
      1,
    );
    receipt.checks.push({
      name: "desktop exact complete clipboard payload and success feedback",
      status: "PASS",
    });
    await screenshot(desktop.page, "desktop-copy-success.png");

    const narrow = await context({ width: 390, height: 844 });
    await open(narrow.page);
    await noOverflow(narrow.page, "narrow");
    assert.equal(
      await narrow.page
        .locator("#onboarding-prompt")
        .evaluate((element) => element.textContent.trim()),
      payload,
    );
    await narrow.page
      .getByRole("button", { name: "Copy Codex prompt", exact: true })
      .click();
    await narrow.page.waitForFunction(
      () => window.__onboardingCopies.length === 1,
    );
    assert.deepEqual(
      await narrow.page.evaluate(() => window.__onboardingCopies),
      [payload],
    );
    receipt.checks.push({
      name: "narrow exact complete clipboard payload",
      status: "PASS",
    });
    await screenshot(narrow.page, "narrow-copy-success.png");

    const native = await context({ clipboard: "native" });
    await open(native.page);
    assert.equal(
      await native.page.evaluate(() =>
        Object.hasOwn(window, "__onboardingCopies"),
      ),
      false,
      "The native clipboard context must not install the stub.",
    );
    await native.page
      .getByRole("button", { name: "Copy Codex prompt", exact: true })
      .click();
    await native.page.waitForFunction(
      (expected) =>
        document.querySelector("#copy-status")?.textContent.trim() === expected,
      success,
    );
    assert.equal(
      await native.page.evaluate(() => navigator.clipboard.readText()),
      payload,
      "The real Clipboard API must read back the exact complete prompt.",
    );
    receipt.checks.push({
      name: "native Clipboard API write/read matches complete payload with permissions limited to owned loopback context",
      status: "PASS",
    });
    await screenshot(native.page, "native-clipboard-success.png");

    const denied = await context({ clipboard: "denied" });
    await open(denied.page);
    await denied.page
      .getByRole("button", { name: "Copy Codex prompt", exact: true })
      .click();
    await denied.page.waitForFunction(
      (expected) =>
        document.querySelector("#copy-status")?.textContent.trim() === expected,
      unavailable,
    );
    assert.equal(
      await denied.page.evaluate(() => window.__onboardingCopyAttempts),
      1,
      "The denial path must actually attempt clipboard access.",
    );
    assert.deepEqual(
      await denied.page.evaluate(() => window.__onboardingCopies),
      [],
    );
    assert.equal(
      await denied.page.evaluate(() => getSelection().toString().trim()),
      payload,
      "Denied clipboard permission must select the full manual-copy payload.",
    );
    assert.equal(
      await denied.page.locator("#copy-status").textContent(),
      unavailable,
    );
    receipt.checks.push({
      name: "denied clipboard selects full prompt and reports failure without claiming success",
      status: "PASS",
    });
    await screenshot(denied.page, "clipboard-denied-selection.png");

    const manual = await context({
      javaScriptEnabled: false,
      width: 390,
      height: 844,
    });
    await open(manual.page);
    const manualPrompt = manual.page.locator("#onboarding-prompt");
    assert.equal(await manualPrompt.isVisible(), true);
    assert.equal(
      await manualPrompt.evaluate((element) => element.textContent.trim()),
      payload,
    );
    assert.equal(
      await manual.page.locator("#copy-onboarding-prompt").isVisible(),
      false,
      "JavaScript-disabled visitors must not be offered a nonfunctional copy button.",
    );
    assert.match(
      await manual.page.locator("noscript").textContent(),
      /select[\s\S]*copy|copy[\s\S]*select/i,
    );
    assert.equal(await manual.page.locator("noscript").isVisible(), true);
    await manualPrompt.focus();
    assert.equal(
      await manualPrompt.evaluate(
        (element) => document.activeElement === element,
      ),
      true,
    );
    await noOverflow(manual.page, "JavaScript-disabled narrow");
    receipt.checks.push({
      name: "JavaScript-disabled complete selectable manual prompt and visible guidance",
      status: "PASS",
    });
    await screenshot(manual.page, "javascript-disabled-manual.png");

    await open(desktop.page, "/updates.html");
    for (const [label, current] of [
      ["desktop", desktop],
      ["narrow", narrow],
    ]) {
      if (current !== desktop) await open(current.page, "/updates.html");
      const text = (await current.page.locator("main").innerText()).replace(
        /\s+/g,
        " ",
      );
      assert.ok(text.includes(`node_modules/${names.tools}/lib/ninja.mjs`));
      assert.match(
        text,
        /Alpha\.3 cannot install the renamed alpha\.4 package family/,
      );
      assert.match(text, /same existing configuration and managed store/);
      assert.match(
        text,
        /Preserve the publisher trust pin and signed catalog checkpoint/,
      );
      await noOverflow(current.page, `${label} updates`);
      await screenshot(current.page, `${label}-updates.png`);
      await current.page
        .locator('[aria-labelledby="bootstrap-title"]')
        .scrollIntoViewIfNeeded();
      await current.page.screenshot({
        path: join(evidence, `${label}-bootstrap.png`),
      });
      receipt.screenshots.push(`${label}-bootstrap.png`);
      receipt.checks.push({
        name: `${label} update bootstrap and exact tools family`,
        status: "PASS",
      });
    }
    const entry = desktop.page.locator('a[href="/install.html#agent"]');
    assert.ok(
      (await entry.count()) >= 1,
      "Updates must point to the canonical onboarding prompt.",
    );
    assert.equal(
      await desktop.page
        .locator("blockquote, #onboarding-prompt, #copy-onboarding-prompt")
        .count(),
      0,
      "Updates must not maintain a competing prompt.",
    );
    await entry.first().click();
    assert.equal(new URL(desktop.page.url()).pathname, "/install.html");
    assert.equal(new URL(desktop.page.url()).hash, "#agent");
    assert.equal(
      await desktop.page
        .locator("#onboarding-prompt")
        .evaluate((element) => element.textContent.trim()),
      payload,
    );
    receipt.checks.push({
      name: "updates links to the same complete install prompt",
      status: "PASS",
    });
    await desktop.page.locator("#manual > summary").click();
    await desktop.page.locator("#tools details > summary").click();
    assert.equal(
      await desktop.page.locator("#tools-install-code").isVisible(),
      true,
    );
    const installer = await desktop.page
      .locator("#tools-install-code")
      .textContent();
    assert.ok(installer.includes(release.metadata.tools.file));
    assert.ok(
      installer.includes(`node_modules/${names.tools}/lib/consumer-cli.mjs`),
    );
    await writeFile(
      join(evidence, "browser-installer.sh"),
      installer.trim() + "\n",
      { flag: "wx" },
    );
    await desktop.page.locator("#tools").scrollIntoViewIfNeeded();
    await desktop.page.screenshot({
      path: join(evidence, "desktop-installer.png"),
    });
    receipt.screenshots.push("desktop-installer.png");
    receipt.checks.push({
      name: "installer copied from rendered browser DOM uses verified package family",
      status: "PASS",
    });
    for (const [label, current] of [
      ["desktop", desktop],
      ["narrow", narrow],
    ]) {
      await open(current.page, "/index.html");
      const upgrade = current.page.locator(
        'a[href="/updates.html#alpha11-tools-title"]',
      );
      await upgrade.scrollIntoViewIfNeeded();
      const presentation = await upgrade.evaluate((link) => {
        const style = getComputedStyle(link);
        return {
          underlined:
            style.textDecorationLine.includes("underline") ||
            (style.borderBottomStyle !== "none" &&
              parseFloat(style.borderBottomWidth) > 0),
          spacing: parseFloat(getComputedStyle(link.parentElement).marginTop),
        };
      });
      assert.equal(
        presentation.underlined,
        true,
        `${label}: the tools upgrade link needs a visible affordance`,
      );
      assert.ok(
        presentation.spacing >= 16,
        `${label}: the upgrade note needs separation from release cards`,
      );
      await upgrade.click();
      assert.equal(new URL(current.page.url()).hash, "#alpha11-tools-title");
      assert.match(
        await current.page
          .locator('[aria-labelledby="alpha11-tools-title"]')
          .innerText(),
        /same configuration, registration, store/,
      );
      await noOverflow(current.page, `${label} tools upgrade destination`);
      receipt.checks.push({
        name: `${label} discoverable tools upgrade link reaches preserved-installation instructions`,
        status: "PASS",
      });
    }
    assert.deepEqual(errors, []);
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
      await new Promise((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      );
      receipt.cleanup.server = "closed";
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
    const receipt = await checkOnboardingBrowser({
      websiteRoot: args["--website-root"],
      evidenceRoot: args["--evidence-root"],
    });
    console.log(JSON.stringify(receipt, null, 2));
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
