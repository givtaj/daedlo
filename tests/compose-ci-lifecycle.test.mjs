import assert from "node:assert/strict";
import test from "node:test";
import { finalizeComposeRun } from "../scripts/compose-ci-lifecycle.mjs";

function fixture(overrides = {}) {
  const events = [];
  const results = [];
  const options = {
    passed: true,
    owned: true,
    results,
    finalReport: "final-session.json",
    async compose(...args) {
      events.push(["compose", ...args]);
    },
    async persist(receipt) {
      events.push(["persist", receipt.phase]);
    },
    async removeImages() {
      events.push(["images"]);
      return { removed: ["owned-tag"] };
    },
    ...overrides,
  };
  return { events, results, options };
}

test("successful run archives durable evidence before scoped teardown and image removal", async () => {
  const f = fixture();
  assert.equal(await finalizeComposeRun(f.options), true);
  assert.deepEqual(f.events, [
    ["compose", "stop", "-t", "30", "daedlo"],
    ["compose", "logs", "--no-color"],
    ["compose", "cp", "daedlo:/evidence/session.json", "final-session.json"],
    ["persist", "resources-retained"],
    ["compose", "down", "--volumes", "--timeout", "30"],
    ["persist", "images-retained"],
    ["images"],
    ["persist", "complete"],
  ]);
  assert.ok(f.results.every((row) => row.status === "PASS"));
});

for (const scenario of [
  { name: "failed build or assertion", passed: false },
  { name: "interrupted run", interrupted: () => true },
  { name: "blocked preflight", owned: false },
]) {
  test(`${scenario.name} retains images and evidence volumes`, async () => {
    const f = fixture(scenario);
    assert.equal(await finalizeComposeRun(f.options), false);
    assert.equal(
      f.events.some((e) => e[0] === "images" || e[1] === "down"),
      false,
    );
    if (scenario.owned === false)
      assert.equal(
        f.events.some((e) => e[0] === "compose"),
        false,
      );
    else
      assert.deepEqual(
        f.events[0],
        ["compose", "stop", "-t", "30", "daedlo"],
        "failed-run application data remains available for inspection",
      );
    assert.equal(f.events.at(-1)[1], "resources-retained");
  });
}

for (const failing of ["stop", "logs", "cp"]) {
  test(`failed ${failing} preserves all Docker resources and records the failure`, async () => {
    const f = fixture();
    f.options.compose = async (...args) => {
      f.events.push(["compose", ...args]);
      if (args[0] === failing) throw Error("fixture archive failure");
    };
    assert.equal(await finalizeComposeRun(f.options), false);
    assert.equal(
      f.events.some((e) => e[1] === "down" || e[0] === "images"),
      false,
    );
    assert.equal(f.results[0].status, "FAIL");
  });
}

test("disk-full evidence write prevents both volume and image removal", async () => {
  const f = fixture({
    persist: async () => {
      throw Error("ENOSPC");
    },
  });
  await assert.rejects(finalizeComposeRun(f.options), /ENOSPC/);
  assert.equal(
    f.events.some((e) => e[1] === "down" || e[0] === "images"),
    false,
  );
});

test("teardown failure prevents image removal", async () => {
  const f = fixture();
  f.options.compose = async (...args) => {
    f.events.push(["compose", ...args]);
    if (args[0] === "down") throw Error("fixture teardown failure");
  };
  assert.equal(await finalizeComposeRun(f.options), false);
  assert.equal(
    f.events.some((e) => e[0] === "images"),
    false,
  );
  assert.equal(f.events.at(-1)[1], "teardown-incomplete");
});

test("failed post-teardown receipt and late interruption both retain images", async () => {
  for (const mode of ["write-error", "signal"]) {
    let interrupted = false;
    const f = fixture({ interrupted: () => interrupted });
    f.options.persist = async ({ phase }) => {
      if (phase === "images-retained") {
        if (mode === "write-error") throw Error("ENOSPC");
        interrupted = true;
      }
    };
    if (mode === "write-error")
      await assert.rejects(finalizeComposeRun(f.options), /ENOSPC/);
    else assert.equal(await finalizeComposeRun(f.options), false);
    assert.equal(
      f.events.some((e) => e[0] === "images"),
      false,
    );
  }
});

test("image deletion failure records partial cleanup without claiming completion", async () => {
  const f = fixture({
    removeImages: async () => {
      throw Object.assign(Error("daemon disconnected"), {
        removedImages: ["first-owned-tag"],
        possiblyRemovedImages: ["second-owned-tag"],
      });
    },
  });
  let receipt;
  f.options.persist = async (value) => {
    receipt = value;
  };
  assert.equal(await finalizeComposeRun(f.options), false);
  assert.equal(receipt.phase, "images-retained");
  assert.deepEqual(receipt.imageCleanup.removed, ["first-owned-tag"]);
  assert.deepEqual(receipt.imageCleanup.possiblyRemoved, ["second-owned-tag"]);
  assert.equal(f.results.at(-1).status, "FAIL");
});
