import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

// Synthetic integration-owned case check. The native layer only transports
// the verified phase envelope. The application confirms the chosen case.
export async function verifyCase({ caseId, origin, expectedRevision }, phase) {
  assert.equal(new URL(origin).origin, origin);
  assert.equal(new URL(origin).protocol, "http:");
  assert.equal(new URL(origin).hostname, "127.0.0.1");
  const response = await fetch(origin + "/fixture-case", {
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200);
  const actual = await response.json();
  assert.equal(
    actual.caseId,
    caseId,
    "The application selected a different case",
  );
  assert.equal(
    actual.phase,
    phase,
    "The application case belongs to a different phase",
  );
  assert.equal(
    actual.revision,
    expectedRevision,
    "The case revision has changed",
  );
  assert.equal(actual.ready, true, "The case is not ready");
  assert.equal(actual.historyEntries, 0, "The case already contains history");
  return origin;
}

export function selectCase(fixture, phase) {
  assert.equal(fixture.phase, phase);
  return verifyCase(fixture.input, phase);
}

export function recordCase(fixture, details = {}) {
  return writeFile(
    join(fixture.evidenceDirectory, `checked-case-${randomUUID()}.json`),
    JSON.stringify({
      phase: fixture.phase,
      generation: fixture.generation,
      caseId: fixture.input.caseId,
      ...details,
    }) + "\n",
    { mode: 0o600, flag: "wx" },
  );
}

export async function readSelectedCases() {
  let stdin = "";
  for await (const chunk of process.stdin) stdin += chunk;
  const { schemaVersion, input } = JSON.parse(stdin);
  assert.equal(schemaVersion, 1);
  const phases = ["acceptance", "health", "live"];
  assert.deepEqual(Object.keys(input).sort(), phases.toSorted());
  assert.equal(new Set(phases.map((phase) => input[phase].caseId)).size, 3);
  assert.equal(new Set(phases.map((phase) => input[phase].origin)).size, 3);
  for (const phase of phases) {
    const { caseId, expectedRevision, note, privateTag } = input[phase];
    for (const value of [caseId, expectedRevision, note, privateTag])
      assert.equal(typeof value, "string");
    await verifyCase(input[phase], phase);
  }
  return input;
}
