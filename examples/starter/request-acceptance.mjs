import assert from "node:assert/strict";
import { chromium } from "./runtime.mjs";
import { createStarterFixture } from "./fixture.mjs";
const baseline = process.env.STARTER_BASELINE === "1";
const { createNotebookAdapter } = baseline
  ? await import("../notebook/adapter.mjs")
  : {};
const { createStarterAdapter } = baseline ? {} : await import("./adapter.mjs");
export const checks = [];
const pass = (name) => {
  checks.push({ name, status: "PASS" });
  console.log("PASS " + name);
};
const fixture = await createStarterFixture();
let browser, adapter;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  const events = ["request", "requestfinished", "requestfailed"];
  const beforeListeners = events.map((event) => context.listenerCount(event));
  adapter = baseline
    ? createNotebookAdapter(page)
    : createStarterAdapter(page, { timeoutMs: 200 });
  await page.goto(fixture.url);
  const pending = fixture.barrier("pending");
  await page.evaluate(() => {
    window.pendingRead = fetch("/hold/pending")
      .then((response) => response.json())
      .catch(() => {});
  });
  await pending.arrived;
  // A deadline is an assertion boundary, not a sleep to force success. The server
  // deliberately has not released the request and the page is already ready.
  await assert.rejects(
    adapter.settle(),
    (error) => error.code === "requests_pending",
    "A ready DOM with a genuinely pending request must not settle successfully",
  );
  pending.release();
  await page.evaluate(() => window.pendingRead);
  await adapter.settle();
  pass("live pending request blocks settlement until its terminal event");

  const redirect = fixture.barrier("redirect");
  await page.evaluate(() => {
    window.redirectRead = fetch("/redirect?id=redirect").then((response) =>
      response.json(),
    );
  });
  await redirect.arrived;
  assert.equal(
    adapter.requestDiagnostics().pendingCount,
    1,
    "redirect successor remains pending",
  );
  redirect.release();
  await page.evaluate(() => window.redirectRead);
  await adapter.settle();
  assert.equal(adapter.requestDiagnostics().pendingCount, 0);
  pass("redirects retire their own request identities");

  const aborted = fixture.barrier("aborted");
  await page.evaluate(() => {
    window.abortController = new AbortController();
    window.abortedRead = fetch("/hold/aborted", {
      signal: window.abortController.signal,
    }).catch(() => {});
  });
  await aborted.arrived;
  const failed = context.waitForEvent("requestfailed", (request) =>
    request.url().endsWith("/hold/aborted"),
  );
  await page.evaluate(() => window.abortController.abort());
  await failed;
  await aborted.closed;
  await adapter.settle();
  assert.ok(adapter.requestDiagnostics().failed >= 1);
  aborted.release();
  pass("aborted requests retire on requestfailed");

  const terminal = (suffix) =>
    new Promise((resolve, reject) => {
      const finish = (request) => {
        if (!request.url().endsWith(suffix)) return;
        clearTimeout(timer);
        context.off("requestfinished", finish);
        context.off("requestfailed", finish);
        resolve(request);
      };
      const timer = setTimeout(() => {
        context.off("requestfinished", finish);
        context.off("requestfailed", finish);
        reject(new Error("Expected a terminal event for " + suffix));
      }, 5000);
      context.on("requestfinished", finish);
      context.on("requestfailed", finish);
    });
  const previous = fixture.barrier("previous-document");
  await page.evaluate(() => {
    window.previousAbort = new AbortController();
    fetch("/hold/previous-document", { signal: window.previousAbort.signal })
      .then((response) => response.json())
      .catch(() => {});
  });
  await previous.arrived;
  const previousTerminal = terminal("/hold/previous-document");
  await page.evaluate(() => window.previousAbort.abort());
  await previousTerminal;
  await page.goto(fixture.url + "/next");
  await adapter.settle();
  previous.release();
  pass("explicit cancellation settles landing work before navigation");

  await page.evaluate(() => {
    const frame = document.createElement("iframe");
    frame.src = "/frame";
    document.body.append(frame);
  });
  const frame =
    page.frame({ url: fixture.url + "/frame" }) ??
    (await page.waitForEvent("framenavigated", (value) =>
      value.url().endsWith("/frame"),
    ));
  const detached = fixture.barrier("detached-frame");
  await frame.evaluate(() => {
    window.frameAbort = new AbortController();
    fetch("/hold/detached-frame", { signal: window.frameAbort.signal })
      .then((response) => response.json())
      .catch(() => {});
  });
  await detached.arrived;
  const detachedTerminal = terminal("/hold/detached-frame");
  await frame.evaluate(() => window.frameAbort.abort());
  await detachedTerminal;
  await page.locator("iframe").evaluate((value) => value.remove());
  assert.equal(frame.isDetached(), true);
  await adapter.settle();
  detached.release();
  pass(
    "frame cancellation settles before detachment without deleting pending work",
  );

  const other = await context.newPage(),
    otherBarrier = fixture.barrier("other-page");
  await other.goto(fixture.url);
  await other.evaluate(() => {
    fetch("/hold/other-page")
      .then((response) => response.json())
      .catch(() => {});
  });
  await otherBarrier.arrived;
  await adapter.settle();
  assert.equal(
    adapter.requestDiagnostics().pendingCount,
    0,
    "attached other page is outside this adapter",
  );
  otherBarrier.release();
  await other.close();

  // Independently retain exact Request identities and their terminal evidence.
  // Navigation/frame loss can emit a terminal event on one browser version and
  // omit it on another. Neither document loss nor server completion retires it.
  const detachedRequests = new Set(),
    terminalRequests = new Set();
  const observeTerminal = (request) => terminalRequests.add(request);
  const unresolvedCount = () =>
    [...detachedRequests].filter((request) => !terminalRequests.has(request))
      .length;
  const requestStarted = (suffix) =>
    context.waitForEvent(
      "request",
      (request) => request.url() === fixture.url + suffix,
    );
  const assertSettlementMatchesEvidence = async () => {
    let settlementError;
    try {
      await adapter.settle();
    } catch (error) {
      settlementError = error;
    }
    const expected = unresolvedCount();
    assert.equal(
      adapter.requestDiagnostics().pendingCount,
      expected,
      "only an independently observed terminal event retires its Request",
    );
    if (expected) {
      assert.equal(settlementError?.code, "requests_pending");
      assert.equal(settlementError.diagnostics.pendingCount, expected);
    } else assert.ifError(settlementError);
    return expected;
  };
  context.on("requestfinished", observeTerminal);
  context.on("requestfailed", observeTerminal);
  try {
    await page.evaluate(() => {
      const frame = document.createElement("iframe");
      frame.src = "/frame";
      document.body.append(frame);
    });
    const departingFrame =
      page.frame({ url: fixture.url + "/frame" }) ??
      (await page.waitForEvent("framenavigated", (value) =>
        value.url().endsWith("/frame"),
      ));
    const departing = fixture.barrier("departing-document");
    const departingStarted = requestStarted("/hold/departing-document");
    await departingFrame.evaluate(() => {
      fetch("/hold/departing-document")
        .then((response) => response.json())
        .catch(() => {});
    });
    await departing.arrived;
    detachedRequests.add(await departingStarted);
    await page.locator("iframe").evaluate((value) => value.remove());
    departing.release();
    await departing.closed;
    const detachedUnresolved = await assertSettlementMatchesEvidence();
    pass(
      detachedUnresolved
        ? "missing detached-document terminal evidence remains unresolved"
        : "detached-document terminal evidence retires its original request",
    );

    const keepalive = fixture.barrier("keepalive-previous");
    const keepaliveStarted = requestStarted("/hold/keepalive-previous");
    await page.evaluate(() => {
      fetch("/hold/keepalive-previous", { keepalive: true })
        .then((response) => response.json())
        .catch(() => {});
    });
    await keepalive.arrived;
    const keepaliveRequest = await keepaliveStarted;
    detachedRequests.add(keepaliveRequest);
    assert.equal(terminalRequests.has(keepaliveRequest), false);
    // Prove this request is genuinely pending while its response is held. This
    // assertion is independent of what the browser later emits on navigation.
    await assert.rejects(
      adapter.settle(),
      (error) =>
        error.code === "requests_pending" &&
        error.diagnostics.pendingCount === unresolvedCount(),
    );
    await page.goto(fixture.url + "/next");
    assert.equal(
      adapter.requestDiagnostics().pendingCount,
      unresolvedCount(),
      "navigation alone cannot retire a keepalive Request",
    );
    keepalive.release();
    await keepalive.closed;
    await assertSettlementMatchesEvidence();
    pass(
      terminalRequests.has(keepaliveRequest)
        ? "keepalive terminal evidence retires its original request after navigation"
        : "missing keepalive terminal evidence stays unresolved after server completion",
    );

    const retained = fixture.barrier("cleanup-pending");
    await page.evaluate(() => {
      fetch("/hold/cleanup-pending")
        .then((response) => response.json())
        .catch(() => {});
    });
    await retained.arrived;
    const cleanup = adapter.close();
    assert.equal(
      cleanup.pendingCount,
      1 + unresolvedCount(),
      "cleanup retains all missing-terminal and still-pending request diagnostics",
    );
    assert.equal(cleanup.closed, true);
    context.off("requestfinished", observeTerminal);
    context.off("requestfailed", observeTerminal);
    assert.deepEqual(
      events.map((event) => context.listenerCount(event)),
      beforeListeners,
      "adapter cleanup removes only its own context listeners",
    );
    assert.equal(
      page.isClosed(),
      false,
      "attached page survives adapter cleanup",
    );
    assert.equal(context.pages().includes(page), true);
    await assert.rejects(
      adapter.settle(),
      (error) => error.code === "request_tracking_closed",
    );
    retained.release();
    pass(
      "cleanup preserves attached resources, removes owned listeners and retains unresolved evidence",
    );
  } finally {
    context.off("requestfinished", observeTerminal);
    context.off("requestfailed", observeTerminal);
  }
} finally {
  const cleanupErrors = [];
  for (const resource of [adapter, browser, fixture]) {
    try {
      await resource?.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length)
    throw new AggregateError(
      cleanupErrors,
      "Starter request fixture cleanup incomplete",
    );
}
