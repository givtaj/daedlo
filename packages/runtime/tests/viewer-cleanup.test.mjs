import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import http from "node:http";
import test from "node:test";
import { createViewer } from "../src/viewer/server.mjs";
import { createResourceScope } from "../src/resources.mjs";

const privateFailure = "private-target-url-and-cookie";

function fixture() {
  const calls = [];
  const failures = new Set();
  const cdp = new EventEmitter();
  const page = new EventEmitter();
  let pageClosed = false;
  async function operation(method) {
    calls.push(method);
    if (failures.has(method)) throw Error(privateFailure);
  }
  cdp.send = operation;
  cdp.detach = () => operation("detach");
  page.isClosed = () => pageClosed;
  page.screenshot = async () => {
    await operation("screenshot");
    return Buffer.from([255, 216, 255, 217]);
  };
  const forbiddenClose = () => assert.fail("Attached resources must survive");
  page.close = forbiddenClose;
  const context = { newCDPSession: async () => cdp, close: forbiddenClose };
  const session = {
    snapshot: async () => ({ connected: true }),
    close: forbiddenClose,
  };
  return {
    page,
    cdp,
    context,
    session,
    calls,
    failures,
    count: (method) => calls.filter((call) => call === method).length,
    closeTarget: () => {
      pageClosed = true;
      page.emit("close");
    },
  };
}

function request(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { agent: false }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
  });
}

function safeCleanupError(error) {
  assert.equal(error.error_code, "cleanup_incomplete");
  assert.match(error.message, /cleanup.*incomplete/i);
  const inspect = (value) => {
    assert.doesNotMatch(String(value), new RegExp(privateFailure));
    for (const key of Object.getOwnPropertyNames(value)) {
      const child = value[key];
      if (typeof child === "string")
        assert.doesNotMatch(child, new RegExp(privateFailure));
      else if (child && typeof child === "object") inspect(child);
    }
  };
  inspect(error);
  return true;
}

async function start(t) {
  const f = fixture();
  const viewer = await createViewer(f);
  t.after(async () => {
    f.failures.clear();
    f.closeTarget();
    await viewer.close();
  });
  return { ...f, viewer };
}

test("live capture cleanup failure rejects safely, closes HTTP, and retries after recovery", async (t) => {
  const f = await start(t);
  f.failures.add("Page.stopScreencast").add("detach");
  const scope = createResourceScope();
  scope.own(f.viewer, { label: "viewer", close: (viewer) => viewer.close() });
  const attempts = await Promise.allSettled([
    f.viewer.close(),
    f.viewer.close(),
  ]);
  for (const attempt of attempts) {
    assert.equal(
      attempt.status,
      "rejected",
      "live cleanup failures must reject close",
    );
    safeCleanupError(attempt.reason);
  }
  assert.equal(f.count("Page.stopScreencast"), 1);
  assert.equal(f.count("detach"), 1);
  await assert.rejects(request(f.viewer.url), { code: "ECONNREFUSED" });
  await assert.rejects(scope.close(), /cleanup incomplete/i);
  assert.equal(scope.snapshot()[0].status, "cleanup_failed");
  f.failures.clear();
  await scope.close();
  assert.equal(scope.snapshot()[0].status, "closed");
  assert.equal(f.count("Page.stopScreencast"), 3);
  assert.equal(f.count("detach"), 3);
  await f.viewer.close();
  assert.equal(f.count("detach"), 3);
  assert.equal(f.page.listenerCount("close"), 0);
  assert.equal(f.cdp.listenerCount("Disconnected"), 0);
  assert.equal(f.cdp.listenerCount("close"), 0);
  assert.equal(f.cdp.listenerCount("Page.screencastFrame"), 0);
});

test("retry keeps successful stop and attempts only unresolved detach", async (t) => {
  const f = await start(t);
  f.failures.add("detach");
  await assert.rejects(f.viewer.close(), safeCleanupError);
  f.failures.clear();
  await f.viewer.close();
  await f.viewer.close();
  assert.equal(f.count("Page.stopScreencast"), 1);
  assert.equal(f.count("detach"), 2);
});

test("successful detach disposes capture even if stop failed", async (t) => {
  const f = await start(t);
  f.failures.add("Page.stopScreencast");
  await f.viewer.close();
  await f.viewer.close();
  assert.equal(f.count("Page.stopScreencast"), 1);
  assert.equal(f.count("detach"), 1);
});

for (const gone of ["page", "Disconnected", "close"]) {
  test(`confirmed ${gone} closure resolves retained capture without retrying dead transport`, async (t) => {
    const f = await start(t);
    f.failures.add("Page.stopScreencast").add("detach");
    await assert.rejects(f.viewer.close(), safeCleanupError);
    if (gone === "page") f.closeTarget();
    else f.cdp.emit(gone);
    await assert.doesNotReject(f.viewer.close());
    await f.viewer.close();
    assert.equal(f.count("Page.stopScreencast"), 1);
    assert.equal(f.count("detach"), 1);
    assert.equal(f.page.listenerCount("close"), 0);
    assert.equal(f.cdp.listenerCount("Disconnected"), 0);
    assert.equal(f.cdp.listenerCount("close"), 0);
  });
}

test("a frame acknowledgement failure does not prove target disappearance", async (t) => {
  const f = await start(t);
  f.failures
    .add("Page.screencastFrameAck")
    .add("Page.stopScreencast")
    .add("detach");
  f.cdp.emit("Page.screencastFrame", { data: "AA==", sessionId: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    f.count("detach"),
    1,
    "event cleanup must attempt owned disposal",
  );
  const status = await (await fetch(`${f.viewer.url}/status`)).json();
  assert.equal(status.connected, false);
  assert.equal(status.cleanupError.error_code, "cleanup_incomplete");
  assert.doesNotMatch(JSON.stringify(status), new RegExp(privateFailure));
  await assert.rejects(f.viewer.close(), safeCleanupError);
  assert.equal(f.count("detach"), 2);
  f.failures.clear();
  await f.viewer.close();
  assert.equal(f.count("detach"), 3);
});

for (const step of ["Page.stopScreencast", "detach"]) {
  test(`target disappearance during ${step} resolves the in-flight cleanup`, async (t) => {
    const f = await start(t);
    const original = step === "detach" ? f.cdp.detach : f.cdp.send;
    const closeDuringOperation = async (...args) => {
      const method = step === "detach" ? "detach" : args[0];
      await original(...args);
      if (method === step) {
        f.cdp.emit("close");
        throw Error(privateFailure);
      }
    };
    if (step === "detach") f.cdp.detach = closeDuringOperation;
    else f.cdp.send = closeDuringOperation;
    await assert.doesNotReject(f.viewer.close());
    await f.viewer.close();
    assert.equal(f.count("Page.stopScreencast"), 1);
    assert.equal(f.count("detach"), step === "detach" ? 1 : 0);
    assert.equal(f.cdp.listenerCount("close"), 0);
  });
}

test("confirmed CDP closure at a failed cleanup settlement clears stale ownership and diagnostics", async (t) => {
  const f = await start(t);
  f.failures.add("Page.screencastFrameAck").add("Page.stopScreencast");
  let rejectDetach;
  f.cdp.detach = () => {
    f.calls.push("detach");
    return new Promise((_resolve, reject) => {
      rejectDetach = reject;
    });
  };
  f.cdp.emit("Page.screencastFrame", { data: "AA==", sessionId: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof rejectDetach, "function");
  rejectDetach(Error(privateFailure));
  queueMicrotask(() => f.cdp.emit("close"));
  await new Promise((resolve) => setImmediate(resolve));
  const status = await (await fetch(`${f.viewer.url}/status`)).json();
  assert.equal(
    status.cleanupError,
    undefined,
    "confirmed disposal must clear stale cleanup failure",
  );
  assert.equal(f.cdp.listenerCount("close"), 0);
  assert.equal(f.page.listenerCount("close"), 0);
  await f.viewer.close();
  assert.equal(f.count("detach"), 1);
});

for (const failure of ["screenshot", "Page.startScreencast"]) {
  test(`failed startup at ${failure} exposes safe retry authority when cleanup also fails`, async (t) => {
    const f = fixture();
    f.failures.add(failure).add("Page.stopScreencast").add("detach");
    let failureError;
    t.after(async () => {
      f.failures.clear();
      f.closeTarget();
      await failureError?.close?.();
    });
    await assert.rejects(createViewer(f), (error) => {
      failureError = error;
      safeCleanupError(error);
      assert.equal(
        typeof error.close,
        "function",
        "failed startup must retain a retry handle",
      );
      return true;
    });
    f.failures.clear();
    await failureError.close();
    assert.equal(f.count("detach"), 2);
    await failureError.close();
    assert.equal(f.count("detach"), 2);
    assert.equal(f.cdp.listenerCount("Disconnected"), 0);
  });
}
