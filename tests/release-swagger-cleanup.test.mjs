import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeSwaggerAcceptanceResources } from "./fixtures/swagger-acceptance.mjs";
import {
  cleanupInstalledSwaggerConsumer,
  recordSwaggerCleanupFailure,
} from "./swagger-installed-acceptance.mjs";

test("Swagger acceptance attempts every owned close and retains failed handles", async () => {
  const calls = [];
  const resources = [
    "CLI child",
    "driver session",
    "observer browser",
    "API fixture",
    "CLI diagnostic log",
  ].map((label) => ({
    label,
    close: async () => {
      calls.push(label);
      if (label === "driver session") throw Error("PRIVATE_CLEANUP_ERROR");
    },
  }));
  let failure;
  try {
    await closeSwaggerAcceptanceResources(resources);
  } catch (error) {
    failure = error;
  }
  assert.deepEqual(
    calls,
    resources.map(({ label }) => label),
    "One failed close must not skip the browser, API or evidence cleanup",
  );
  assert.equal(failure.code, "cleanup_incomplete");
  assert.deepEqual(
    failure.failedResources,
    [resources[1]],
    "The failed close handle must remain available for recovery",
  );
  assert.equal(failure.message.includes("PRIVATE_CLEANUP_ERROR"), false);
});

test("failed Swagger resource cleanup retains the exact consumer files and cannot report PASS", (t) => {
  const temporary = fs.mkdtempSync(
    join(tmpdir(), "swagger-cleanup-regression-"),
  );
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  fs.writeFileSync(join(temporary, "model-evidence"), "retained exact model");
  const result = { status: "PASS", cleanup: "PENDING" };
  cleanupInstalledSwaggerConsumer({
    temporary,
    ownedIdentity: fs.lstatSync(temporary),
    result,
    cleanupIncomplete: true,
  });
  assert.equal(
    fs.existsSync(join(temporary, "model-evidence")),
    true,
    "Do not remove model/runtime bytes while any owned resource may still use them",
  );
  assert.equal(result.status, "FAIL");
  assert.equal(result.cleanup, "FAIL");
  assert.equal(result.retainedTemporary, temporary);
});

test("core cleanup errors without fixture handles retain evidence with static diagnostics", () => {
  const result = {};
  assert.doesNotThrow(() =>
    assert.equal(
      recordSwaggerCleanupFailure({ code: "cleanup_incomplete" }, result),
      true,
    ),
  );
  assert.deepEqual(result.failedResources, [{ label: "Swagger resource" }]);
});
