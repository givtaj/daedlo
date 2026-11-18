import assert from "node:assert/strict";
import test from "node:test";
import { verifyActiveDeployment } from "../scripts/release/ninja-deployment.mjs";

const accountId = "0".repeat(32);
const token = "fixture";
const versionId = "0773a556-46fd-4287-9045-b363ea35323b";
const active = {
  id: "f9790394-1a3b-41e2-a1e0-4751bdb9af68",
  versions: [{ version_id: versionId, percentage: 100 }],
};
const previous = {
  id: "10000000-0000-4000-8000-000000000001",
  versions: [
    { version_id: "1921fb8d-4541-4503-b569-8c138112a6f5", percentage: 100 },
  ],
};

function deployments(...entries) {
  return Response.json({ success: true, result: { deployments: entries } });
}

function rollout(read) {
  const calls = [];
  let elapsed = 0;
  const advance = (ms) => {
    elapsed += ms;
  };
  const deps = {
    now: () => elapsed,
    sleep: async (ms) => advance(ms),
    fetchImpl: async (url, options) => {
      assert.equal(
        String(url),
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/daedlo/deployments`,
      );
      assert.equal(options.method ?? "GET", "GET");
      assert.equal(options.redirect, "error");
      assert.equal(
        new Headers(options.headers).get("authorization"),
        `Bearer ${token}`,
      );
      assert.ok(options.signal instanceof AbortSignal);
      assert.ok(calls.length < 31, "Exceeded the bounded number of requests");
      calls.push(elapsed);
      return read(elapsed, advance);
    },
  };
  return {
    calls,
    elapsed: () => elapsed,
    verify: () => verifyActiveDeployment({ accountId, token, versionId }, deps),
  };
}

test("alpha.12 rollout waits for the active Worker even when the first read still shows its predecessor", async () => {
  // Reproduce the two recorded identities across the observed 129-second gap.
  const run = rollout((ms) =>
    ms < 130_000 ? deployments(previous) : deployments(active, previous),
  );
  const receipt = await run.verify();
  assert.deepEqual(
    run.calls,
    Array.from({ length: 27 }, (_, i) => i * 5_000),
  );
  const { verifiedAt, ...identity } = receipt;
  assert.deepEqual(identity, {
    schemaVersion: 1,
    worker: "daedlo",
    versionId,
    deploymentId: active.id,
    percentage: 100,
  });
  assert.equal(new Date(verifiedAt).toISOString(), verifiedAt);
});

test("a Worker that stays active until the deadline fails even if history contains the uploaded version", async () => {
  const run = rollout(() => deployments(previous, active));
  await assert.rejects(
    run.verify(),
    /did not become active|timed out|deadline/i,
  );
  assert.equal(run.calls.at(-1), 145_000);
  assert.equal(run.elapsed(), 150_000);
  assert.deepEqual(
    run.calls,
    run.calls.map((_, i) => i * 5_000),
  );
});

test("an immediately active Worker needs only one read", async () => {
  const run = rollout(() => deployments(active));
  assert.equal((await run.verify()).deploymentId, active.id);
  assert.deepEqual(run.calls, [0]);
});

test("an otherwise valid response that arrives after the deadline cannot confirm activation", async () => {
  const run = rollout((ms, advance) => {
    if (ms < 145_000) return deployments(previous);
    advance(5_001);
    return deployments(active);
  });
  await assert.rejects(
    run.verify(),
    /did not become active|timed out|deadline/i,
  );
  assert.equal(run.calls.at(-1), 145_000);
});

for (const [name, read] of [
  [
    "partial traffic on the target",
    () =>
      deployments({
        ...active,
        versions: [{ ...active.versions[0], percentage: 80 }],
      }),
  ],
  [
    "partial traffic on the predecessor",
    () =>
      deployments({
        ...previous,
        versions: [{ ...previous.versions[0], percentage: 80 }],
      }),
  ],
  [
    "split traffic",
    () =>
      deployments({
        ...active,
        versions: [
          { ...active.versions[0], percentage: 70 },
          { ...previous.versions[0], percentage: 30 },
        ],
      }),
  ],
  ["missing deployment", () => deployments()],
  ["missing deployment ID", () => deployments({ versions: active.versions })],
  [
    "missing Worker version ID",
    () => deployments({ ...active, versions: [{ percentage: 100 }] }),
  ],
  ["invalid JSON", () => new Response("invalid JSON")],
  ["oversized response", () => new Response(" ".repeat(1_048_577))],
  ["rejected API request", () => new Response(null, { status: 403 })],
  [
    "unsuccessful API result",
    () => Response.json({ success: false, result: { deployments: [active] } }),
  ],
]) {
  test(`${name} stops the rollout check immediately`, async () => {
    const run = rollout(read);
    await assert.rejects(run.verify());
    assert.deepEqual(run.calls, [0]);
  });
}
