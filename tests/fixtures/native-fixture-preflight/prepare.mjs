import assert from "node:assert/strict";
import { verifyCase } from "./select.mjs";

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
console.log(JSON.stringify({ schemaVersion: 1, ...input }));
