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
