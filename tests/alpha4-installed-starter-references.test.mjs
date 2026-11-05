import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { runInstalledStarterReferences } from "./alpha4-installed-starter.mjs";

// These fixtures exercise dispatch and receipt validation only. Exact installed
// reference/browser acceptance runs separately against the release candidate.
const options = {
  runtimePath: "/verified/runtime/src/index.mjs",
  enginePath: "/verified/starter-build/starter-engine",
  starterRoot: "/verified/tools/examples/starter",
  output: "/retained/installed-starter",
  toolsRoot: "/verified/tools/lib",
  engineCrate: "/verified/crate",
  exampleRoot: "/verified/tools/examples/managed-starter",
  bundle: "/verified/bundle",
  expectedManifestSha256: "a".repeat(64),
};
function references() {
  const calls = [];
  const evidence = {
    status: "PASS",
    checks: Array.from({ length: 9 }, (_, i) => ({
      name: `reference check ${i + 1}`,
      status: "PASS",
    })),
    cleanup: { failures: [] },
  };
  const managed = { status: "PASS", cleanup: "PASS" };
  return {
    calls,
    evidence,
    managed,
    runners: {
      evidenceRunner: async (args) => {
        calls.push({ reference: "evidence", args });
        return evidence;
      },
      managedRunner: async (args) => {
        calls.push({ reference: "managed", args });
        return managed;
      },
    },
  };
}
for (const version of ["0.1.4-alpha.5", "0.1.4-alpha.6", "0.1.4-alpha.7"]) {
  test(`${version} runs both installed references and retains their receipts`, async () => {
    const fixture = references();
    const result = { version };
    await runInstalledStarterReferences(result, options, fixture.runners);
    assert.deepEqual(
      fixture.calls.map((call) => call.reference),
      ["evidence", "managed"],
      "Both shipped reference checks must run before installed acceptance can pass",
    );
    assert.deepEqual(fixture.calls[0].args, {
      runtimePath: options.runtimePath,
      enginePath: options.enginePath,
      starterRoot: options.starterRoot,
      output: join(options.output, "evidence"),
    });
    assert.deepEqual(fixture.calls[1].args, {
      runtimePath: options.runtimePath,
      toolsRoot: options.toolsRoot,
      engineCrate: options.engineCrate,
      exampleRoot: options.exampleRoot,
      bundle: options.bundle,
      expectedManifestSha256: options.expectedManifestSha256,
      output: join(options.output, "managed"),
    });
    assert.equal(result.evidenceReference, fixture.evidence);
    assert.equal(result.managedReference, fixture.managed);
    assert.match(result.managedDependencyInstall, /registry access/);
  });
}

test("historical alpha.4 keeps its existing starter-only acceptance", async () => {
  const fixture = references();
  const result = { version: "0.1.4-alpha.4" };
  await runInstalledStarterReferences(result, options, fixture.runners);
  assert.deepEqual(fixture.calls, []);
  assert.deepEqual(result, { version: "0.1.4-alpha.4" });
});

for (const [name, alter] of [
  [
    "failed evidence",
    (value) => {
      value.status = "FAIL";
    },
  ],
  [
    "incomplete evidence",
    (value) => {
      value.checks.pop();
    },
  ],
  [
    "pending evidence cleanup",
    (value) => {
      value.cleanup.failures.push("owned fixture");
    },
  ],
]) {
  test(`alpha.6 ${name} blocks acceptance before the managed reference`, async () => {
    const fixture = references();
    alter(fixture.evidence);
    const result = { version: "0.1.4-alpha.6" };
    await assert.rejects(
      runInstalledStarterReferences(result, options, fixture.runners),
      { code: "ERR_ASSERTION" },
    );
    assert.deepEqual(
      fixture.calls.map((call) => call.reference),
      ["evidence"],
    );
    assert.equal(result.evidenceReference, fixture.evidence);
    assert.equal(result.managedReference, undefined);
  });
}

for (const field of ["status", "cleanup"]) {
  test(`alpha.6 failed managed ${field} cannot pass and retains both receipts`, async () => {
    const fixture = references();
    fixture.managed[field] = "FAIL";
    const result = { version: "0.1.4-alpha.6" };
    await assert.rejects(
      runInstalledStarterReferences(result, options, fixture.runners),
      { code: "ERR_ASSERTION" },
    );
    assert.deepEqual(
      fixture.calls.map((call) => call.reference),
      ["evidence", "managed"],
    );
    assert.equal(result.evidenceReference, fixture.evidence);
    assert.equal(result.managedReference, fixture.managed);
  });
}

test("alpha.6 reference exceptions propagate without a replacement success receipt", async () => {
  const fixture = references();
  const failure = new Error("Reference could not complete");
  fixture.runners.managedRunner = async () => {
    throw failure;
  };
  const result = { version: "0.1.4-alpha.6" };
  await assert.rejects(
    runInstalledStarterReferences(result, options, fixture.runners),
    (error) => error === failure,
  );
  assert.equal(result.evidenceReference, fixture.evidence);
  assert.equal(result.managedReference, undefined);
});
