import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { trackPageRequests } from "../examples/starter/request-accounting.mjs";

function fixture() {
  const context = new EventEmitter();
  const page = { context: () => context };
  const request = () => ({
    frame: () => ({ page: () => page }),
    method: () => "GET",
    resourceType: () => "fetch",
  });
  return { context, page, request };
}
test("late and duplicate terminal events retire only the original request identity", async () => {
  const { context, page, request } = fixture();
  const tracker = trackPageRequests(page);
  const oldDocument = request(),
    currentDocument = request();
  context.emit("request", oldDocument);
  context.emit("request", currentDocument);
  // Model a terminal callback whose detached frame is no longer inspectable.
  // The helper must use the Request identity retained at start, not ask its frame.
  oldDocument.frame = () => {
    throw new Error("detached");
  };
  context.emit("requestfinished", oldDocument);
  context.emit("requestfailed", oldDocument);
  assert.equal(tracker.snapshot().pendingCount, 1);
  assert.equal(tracker.snapshot().finished, 1);
  assert.equal(tracker.snapshot().failed, 0);
  await assert.rejects(tracker.waitForIdle({ timeoutMs: 20 }), {
    code: "requests_pending",
  });
  context.emit("requestfailed", currentDocument);
  await tracker.waitForIdle();
  assert.equal(tracker.close().pendingCount, 0);
});
test("closing accounting rejects waits and preserves unresolved handles", async () => {
  const { context, page, request } = fixture();
  const foreignListener = () => {};
  context.on("requestfinished", foreignListener);
  const tracker = trackPageRequests(page);
  context.emit("request", request());
  const waiting = tracker.waitForIdle();
  const assertion = assert.rejects(waiting, {
    code: "request_tracking_closed",
  });
  const cleanup = tracker.close();
  await assertion;
  assert.equal(cleanup.pendingCount, 1);
  assert.equal(cleanup.closed, true);
  assert.deepEqual(context.listeners("requestfinished"), [foreignListener]);
  assert.equal(tracker.close().pendingCount, 1);
});
