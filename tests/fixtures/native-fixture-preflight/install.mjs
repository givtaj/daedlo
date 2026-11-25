import assert from "node:assert/strict";
import { createManagedLaunch } from "../managed-starter/managed-launch.mjs";
import { recordCase, selectCase } from "./select.mjs";

let stdin = "";
for await (const chunk of process.stdin) stdin += chunk;
const { schemaVersion, phase, installation, fixture } = JSON.parse(stdin);
assert.equal(schemaVersion, 1);
assert.ok(["acceptance", "health"].includes(phase));
const origin = await selectCase(fixture, phase);
const runtime = await import(installation.runtimePath);
const resources = runtime.createResourceScope();
let result;
try {
  const engine = runtime.createEngineClient(installation.enginePath);
  try {
    const hello = await engine.request({ op: "hello" });
    assert.equal(hello.ok, true);
    assert.equal(hello.descriptor.id, installation.model.id);
    assert.equal(hello.descriptor.version, installation.model.version);
  } finally {
    await engine.close();
  }
  const privateCatalogFile = fixture.input.privateCatalogFile;
  const handle = await createManagedLaunch({
    runtime,
    resources,
    installation,
    enginePath: installation.enginePath,
    settings: { origin, privateCatalogFile },
  });
  const session = handle.session;
  assert.equal((await session.snapshot()).connected, true);
  assert.equal(await handle.draftState(), false);
  const readback = async () => {
    const response = await fetch(origin + "/api/notes");
    assert.equal(response.status, 200);
    return (await response.json()).items;
  };
  assert.deepEqual(await readback(), []);
  if (phase === "acceptance") {
    session.setSpeed("fast");
    const execute = async (command, params) =>
      session.execute(command, params, (await session.snapshot()).revision);
    assert.equal(
      (
        await execute("edit", {
          text: fixture.input.note,
          category: "work",
        })
      ).ok,
      true,
    );
    const saved = await execute("save", {});
    assert.equal(saved.outcome.kind, "success");
    assert.equal(saved.effect.status, "saved");
    const [note, ...more] = await readback();
    assert.equal(note.text, fixture.input.note);
    assert.equal(more.length, 0);
    const report = JSON.stringify(session.report({ runId: saved.runId }));
    assert.ok(!report.includes(fixture.input.privateTag));
    assert.ok(!report.includes(note.operation));
  }
  await resources.close();
  assert.ok(
    resources
      .snapshot()
      .filter((resource) => resource.owned)
      .every((resource) => resource.status === "closed"),
  );
  const records = await readback();
  await recordCase(fixture, { records: records.length, ownedClosed: true });
  result = {
    schemaVersion: 1,
    accepted: true,
    isolated: true,
    tests: phase === "acceptance" ? 5 : 3,
    failed: 0,
    runtimePath: installation.runtimePath,
    enginePath: installation.enginePath,
    model: installation.model,
    browser: handle.browser,
    ...(phase === "health" ? { ready: true } : {}),
  };
} finally {
  await resources.close();
}
console.log(JSON.stringify(result));
