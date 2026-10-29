// Real Chromium lifecycle conformance; no customer resources or application acceptance.
import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";

const runtimeRequire = createRequire(
  process.env.CLI_TEST_RUNTIME || import.meta.url,
);
const { chromium } = runtimeRequire("playwright");
const { createViewer } = await import(
  process.env.CLI_TEST_RUNTIME
    ? pathToFileURL(process.env.CLI_TEST_RUNTIME).href
    : new URL("../src/index.mjs", import.meta.url).href
);

const privateDetail = "untrusted transport detail must stay private";

async function request(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { agent: false }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () =>
        resolve({ status: res.statusCode, body: Buffer.concat(chunks) }),
      );
      res.on("error", reject);
    });
    req.on("error", reject);
  });
}

async function stream(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url + "/stream", { agent: false }, (res) => {
      res.resume();
      resolve({ response: res, closed: once(res, "close") });
    });
    req.on("error", reject);
  });
}

function cleanupError(error) {
  assert.equal(error.error_code, "cleanup_incomplete");
  assert.match(error.message, /cleanup/i);
  const seen = new Set();
  const pending = [error];
  while (pending.length) {
    const value = pending.pop();
    if (typeof value === "string") {
      assert.equal(value.includes(privateDetail), false);
    } else if (value && typeof value === "object" && !seen.has(value)) {
      seen.add(value);
      pending.push(
        ...Object.values(value),
        value.message,
        value.stack,
        value.cause,
        value.errors,
      );
    }
  }
  return true;
}

async function fixture(t) {
  const application = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      '<!doctype html><title>Cleanup conformance</title><input id="draft" value="Retained draft">',
    );
  });
  const captures = [];
  const viewers = [];
  let browser;
  let page;
  const faults = { stop: false, detach: false };
  let attachedSessionCloseCalls = 0;
  t.after(async () => {
    faults.stop = false;
    faults.detach = false;
    const errors = [];
    for (const viewer of viewers) {
      try {
        await viewer.close();
      } catch (error) {
        errors.push(error);
      }
    }
    // The pre-fix implementation can forget a failed capture. The fixture owns
    // these real CDP handles and releases them even when a regression fails.
    for (const capture of captures) {
      if (capture.detached) continue;
      try {
        await capture.rawDetach();
      } catch (error) {
        if (!page?.isClosed() && browser?.isConnected()) errors.push(error);
      }
    }
    await browser?.close();
    assert.equal(browser?.isConnected() ?? false, false);
    assert.equal(page?.isClosed() ?? true, true);
    if (application.listening) {
      await new Promise((resolve, reject) => {
        application.close((error) => (error ? reject(error) : resolve()));
        application.closeAllConnections();
      });
    }
    assert.equal(application.listening, false);
    if (errors.length) throw new AggregateError(errors, "Probe cleanup failed");
  });
  application.listen(0, "127.0.0.1");
  await once(application, "listening");
  const origin = `http://127.0.0.1:${application.address().port}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  page = await context.newPage();
  await page.goto(origin);
  const captureContext = {
    newCDPSession: async (target) => {
      const cdp = await context.newCDPSession(target);
      const rawSend = cdp.send.bind(cdp);
      const rawDetach = cdp.detach.bind(cdp);
      const capture = { cdp, rawDetach, detached: false, calls: [] };
      captures.push(capture);
      cdp.on("close", () => {
        capture.detached = true;
      });
      cdp.send = async (method, params) => {
        capture.calls.push(method);
        if (method === "Page.stopScreencast" && faults.stop)
          throw Error(privateDetail);
        return rawSend(method, params);
      };
      cdp.detach = async () => {
        capture.calls.push("detach");
        if (faults.detach) throw Error(privateDetail);
        await rawDetach();
      };
      return cdp;
    },
  };
  const session = {
    snapshot: async () => ({ connected: true }),
    close: async () => {
      attachedSessionCloseCalls++;
    },
  };
  return {
    browser,
    context,
    page,
    faults,
    captures,
    origin,
    options: { page, context: captureContext, session },
    remember: (viewer) => {
      viewers.push(viewer);
      return viewer;
    },
    async assertAttachedAlive() {
      assert.equal(browser.isConnected(), true);
      assert.equal(page.isClosed(), false);
      assert.equal(context.pages().includes(page), true);
      assert.equal(await page.locator("#draft").inputValue(), "Retained draft");
      assert.equal((await request(origin)).status, 200);
      assert.equal(attachedSessionCloseCalls, 0);
    },
  };
}

function cleanupCalls(capture) {
  return capture.calls.filter((method) =>
    ["Page.stopScreencast", "detach"].includes(method),
  );
}

test("Chromium viewer closes HTTP, stream and CDP once while preserving attached resources", async (t) => {
  const f = await fixture(t);
  const viewer = f.remember(await createViewer(f.options));
  const feed = await stream(viewer.url);
  assert.match(feed.response.headers["content-type"], /multipart/);
  await Promise.all([viewer.close(), viewer.close()]);
  await feed.closed;
  await assert.rejects(request(viewer.url), { code: "ECONNREFUSED" });
  assert.equal(f.captures[0].detached, true);
  assert.deepEqual(cleanupCalls(f.captures[0]), [
    "Page.stopScreencast",
    "detach",
  ]);
  await viewer.close();
  assert.deepEqual(cleanupCalls(f.captures[0]), [
    "Page.stopScreencast",
    "detach",
  ]);
  await f.assertAttachedAlive();
});

test("live Chromium capture failures reject after HTTP teardown and retry unresolved ownership", async (t) => {
  const f = await fixture(t);
  const viewer = f.remember(await createViewer(f.options));
  const feed = await stream(viewer.url);
  f.faults.stop = true;
  f.faults.detach = true;
  await assert.rejects(viewer.close(), cleanupError);
  await feed.closed;
  await assert.rejects(request(viewer.url), { code: "ECONNREFUSED" });
  assert.equal(f.captures[0].detached, false);
  assert.deepEqual(cleanupCalls(f.captures[0]), [
    "Page.stopScreencast",
    "detach",
  ]);
  await f.assertAttachedAlive();
  f.faults.stop = false;
  f.faults.detach = false;
  await viewer.close();
  assert.equal(f.captures[0].detached, true);
  assert.deepEqual(cleanupCalls(f.captures[0]), [
    "Page.stopScreencast",
    "detach",
    "Page.stopScreencast",
    "detach",
  ]);
  await viewer.close();
  assert.equal(cleanupCalls(f.captures[0]).length, 4);
  await f.assertAttachedAlive();
});

test("Chromium detach recovery does not repeat a successful screencast stop", async (t) => {
  const f = await fixture(t);
  const viewer = f.remember(await createViewer(f.options));
  f.faults.detach = true;
  await assert.rejects(viewer.close(), cleanupError);
  assert.equal(f.captures[0].detached, false);
  f.faults.detach = false;
  await viewer.close();
  assert.equal(f.captures[0].detached, true);
  assert.deepEqual(cleanupCalls(f.captures[0]), [
    "Page.stopScreencast",
    "detach",
    "detach",
  ]);
  await f.assertAttachedAlive();
});

test("real CDP detachment resolves ownership despite a screencast stop error", async (t) => {
  const f = await fixture(t);
  const viewer = f.remember(await createViewer(f.options));
  f.faults.stop = true;
  await viewer.close();
  assert.equal(f.captures[0].detached, true);
  await viewer.close();
  assert.deepEqual(cleanupCalls(f.captures[0]), [
    "Page.stopScreencast",
    "detach",
  ]);
  await f.assertAttachedAlive();
});

test("external Chromium CDP close is terminal while the attached page stays live", async (t) => {
  const f = await fixture(t);
  const viewer = f.remember(await createViewer(f.options));
  f.faults.stop = true;
  f.faults.detach = true;
  const detached = once(f.captures[0].cdp, "close");
  await f.captures[0].rawDetach();
  await detached;
  const status = JSON.parse((await request(viewer.url + "/status")).body);
  assert.equal(status.connected, false);
  await viewer.close();
  await viewer.close();
  assert.deepEqual(cleanupCalls(f.captures[0]), []);
  await assert.rejects(request(viewer.url), { code: "ECONNREFUSED" });
  await f.assertAttachedAlive();
});

for (const target of ["page", "browser"]) {
  test(`actual Chromium ${target} closure resolves retained capture failure`, async (t) => {
    const f = await fixture(t);
    const viewer = f.remember(await createViewer(f.options));
    f.faults.stop = true;
    f.faults.detach = true;
    await assert.rejects(viewer.close(), cleanupError);
    const detached = once(f.captures[0].cdp, "close");
    await f[target].close();
    await detached;
    await viewer.close();
    await viewer.close();
    assert.equal(f.captures[0].detached, true);
    assert.deepEqual(cleanupCalls(f.captures[0]), [
      "Page.stopScreencast",
      "detach",
    ]);
    await assert.rejects(request(viewer.url), { code: "ECONNREFUSED" });
    assert.equal((await request(f.origin)).status, 200);
    if (target === "page") assert.equal(f.browser.isConnected(), true);
  });
}

test("failed Chromium viewer startup exposes a retry handle without taking the occupied port", async (t) => {
  const f = await fixture(t);
  f.faults.stop = true;
  f.faults.detach = true;
  let startupError;
  await assert.rejects(
    createViewer({ ...f.options, port: Number(new URL(f.origin).port) }),
    (error) => {
      startupError = error;
      return cleanupError(error);
    },
  );
  assert.equal(typeof startupError.close, "function");
  f.remember(startupError);
  assert.equal(f.captures[0].detached, false);
  await f.assertAttachedAlive();
  f.faults.stop = false;
  f.faults.detach = false;
  await startupError.close();
  assert.equal(f.captures[0].detached, true);
  assert.deepEqual(cleanupCalls(f.captures[0]), [
    "Page.stopScreencast",
    "detach",
    "Page.stopScreencast",
    "detach",
  ]);
  await startupError.close();
  assert.equal(cleanupCalls(f.captures[0]).length, 4);
  await f.assertAttachedAlive();
});
