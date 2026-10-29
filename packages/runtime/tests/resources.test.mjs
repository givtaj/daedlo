import test from "node:test";
import assert from "node:assert/strict";
import { createResourceScope } from "../src/resources.mjs";
test("cleanup unwinds owned resources, retains failed handles for retry, preserves attached", async () => {
  const scope = createResourceScope();
  const closed = [];
  let fail = true;
  scope.attach(
    { name: "daily" },
    { label: "daily", close: () => closed.push("daily") },
  );
  scope.own({}, { label: "first", close: () => closed.push("first") });
  scope.own(
    {},
    {
      label: "replacement",
      close: () => {
        if (fail) throw Error("busy");
        closed.push("replacement");
      },
    },
  );
  await assert.rejects(scope.close(), /cleanup/i);
  assert.deepEqual(closed, ["first"]);
  assert.equal(
    scope.snapshot().find((r) => r.label === "replacement").status,
    "cleanup_failed",
  );
  fail = false;
  await scope.close();
  await scope.close();
  assert.deepEqual(closed, ["first", "replacement"]);
});
test("failed setup cleans only resources acquired by that scope", async () => {
  const scope = createResourceScope();
  let closed = 0;
  await assert.rejects(
    scope.setup(async () => {
      scope.own({}, { label: "owned", close: () => closed++ });
      throw Error("startup failed");
    }),
    /startup failed/,
  );
  assert.equal(closed, 1);
});

test("pending cleanup retains dependencies and propagates a sanitized retry signal", async () => {
  const scope = createResourceScope();
  const closed = [];
  let pending = true;
  scope.own(
    {},
    { label: "dependency", close: () => closed.push("dependency") },
  );
  scope.own(
    {},
    {
      label: "pending resource",
      close: () => {
        if (pending)
          throw Object.assign(Error("PRIVATE_CLEANUP_DIAGNOSTIC"), {
            cleanupPending: true,
          });
        closed.push("pending resource");
      },
    },
  );
  const failure = await scope.close().then(
    () => null,
    (error) => error,
  );
  assert.deepEqual(
    closed,
    [],
    "Pending work must settle before its dependency closes",
  );
  assert.equal(failure?.code, "cleanup_incomplete");
  assert.equal(failure?.cleanupPending, true);
  assert.doesNotMatch(
    [failure.message, ...failure.errors.map((error) => error.message)].join(
      " ",
    ),
    /PRIVATE_CLEANUP_DIAGNOSTIC/,
  );
  assert.deepEqual(
    scope.snapshot().map(({ status }) => status),
    ["owned", "cleanup_failed"],
  );
  pending = false;
  await scope.close();
  await scope.close();
  assert.deepEqual(closed, ["pending resource", "dependency"]);
});

for (const pending of [true, false]) {
  test(`failed setup preserves ${pending ? "pending" : "settled"} cleanup semantics through its outer owner`, async () => {
    const inner = createResourceScope(),
      outer = createResourceScope();
    const closed = [];
    let incomplete = true;
    const startup = Error("Startup failed");
    let startupFailure = await inner
      .setup(async (scope) => {
        scope.own(
          {},
          {
            label: "Startup resource",
            close: () => {
              if (incomplete)
                throw Object.assign(Error("PRIVATE_CLEANUP_DIAGNOSTIC"), {
                  ...(pending ? { cleanupPending: true } : {}),
                });
              closed.push("startup resource");
            },
          },
        );
        throw startup;
      })
      .then(
        () => null,
        (error) => error,
      );
    const setupFailure = startupFailure;
    outer.own(
      {},
      { label: "Startup dependency", close: () => closed.push("dependency") },
    );
    outer.own(inner, {
      label: "Startup cleanup handle",
      close: async (scope) => {
        if (startupFailure) {
          const error = startupFailure;
          startupFailure = null;
          throw error;
        }
        await scope.close();
      },
    });
    const failure = await outer.close().then(
      () => null,
      (error) => error,
    );
    assert.deepEqual(
      closed,
      pending ? [] : ["dependency"],
      "A failed setup must preserve whether cleanup is still pending",
    );
    assert.equal(setupFailure.errors[0], startup);
    assert.equal(setupFailure.cleanupPending, pending ? true : undefined);
    assert.equal(setupFailure.code, pending ? "cleanup_incomplete" : undefined);
    assert.equal(failure.cleanupPending, pending ? true : undefined);
    assert.equal(failure.code, pending ? "cleanup_incomplete" : undefined);
    assert.doesNotMatch(failure.message, /PRIVATE_CLEANUP_DIAGNOSTIC/);
    incomplete = false;
    await outer.close();
    await outer.close();
    assert.deepEqual(
      closed,
      pending
        ? ["startup resource", "dependency"]
        : ["dependency", "startup resource"],
    );
  });
}
