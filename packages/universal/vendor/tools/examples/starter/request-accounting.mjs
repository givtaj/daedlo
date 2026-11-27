// Tracks Request identities, not URLs or a count tied to the current document.
// Context terminal events can arrive after their document/frame has detached.
export function trackPageRequests(page) {
  const context = page.context(),
    pending = new Map(),
    waiters = new Set();
  let sequence = 0,
    finished = 0,
    failed = 0,
    closed = false;
  const diagnostic = () => ({
    closed,
    pendingCount: pending.size,
    finished,
    failed,
    pending: [...pending.values()].map((value) => ({ ...value })),
  });
  const error = (code, message) =>
    Object.assign(new Error(message), { code, diagnostics: diagnostic() });
  const update = () => {
    if (pending.size === 0) for (const waiter of [...waiters]) waiter.resolve();
  };
  const request = (value) => {
    // This starter controls one page and its frames. Other tabs are attached
    // resources. A service worker has no frame and requires its own integration.
    try {
      if (value.frame().page() !== page) return;
    } catch {
      return;
    }
    pending.set(value, {
      request: ++sequence,
      method: value.method(),
      resourceType: value.resourceType(),
    });
  };
  const terminal = (value, kind) => {
    if (!pending.delete(value)) return;
    if (kind === "failed") failed++;
    else finished++;
    update();
  };
  const requestFinished = (value) => terminal(value, "finished");
  const requestFailed = (value) => terminal(value, "failed");
  context.on("request", request);
  context.on("requestfinished", requestFinished);
  context.on("requestfailed", requestFailed);
  return {
    snapshot: diagnostic,
    waitForIdle({ timeoutMs = 5000 } = {}) {
      if (closed)
        return Promise.reject(
          error(
            "request_tracking_closed",
            "Request tracking is closed; readiness cannot be established.",
          ),
        );
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
        throw new Error("A positive request deadline is required.");
      if (pending.size === 0) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const finish = (callback) => {
          clearTimeout(timer);
          waiters.delete(waiter);
          callback();
        };
        const waiter = {
          resolve: () => finish(resolve),
          reject: (failure) => finish(() => reject(failure)),
        };
        const timer = setTimeout(
          () =>
            waiter.reject(
              error(
                "requests_pending",
                "Browser requests are still pending; inspect request diagnostics.",
              ),
            ),
          timeoutMs,
        );
        waiters.add(waiter);
      });
    },
    close() {
      if (!closed) {
        closed = true;
        context.off("request", request);
        context.off("requestfinished", requestFinished);
        context.off("requestfailed", requestFailed);
        for (const waiter of [...waiters])
          waiter.reject(
            error(
              "request_tracking_closed",
              "Request tracking closed before settlement.",
            ),
          );
      }
      // Preserve unresolved handles/evidence. Closing listeners is not proof that
      // pending application work stopped; the owner must close its own browser.
      return diagnostic();
    },
  };
}
