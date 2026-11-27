import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createStarterFixture } from "../starter/fixture.mjs";
import { createManagedLaunch } from "./managed-launch.mjs";

// Hooks are the documented dynamic-runtime boundary. A separate engine preflight
// runs here and closes here, never through the native launcher's injected facade.
let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
  assert.ok(input.length < 1024 * 1024);
}
const context = JSON.parse(input);
assert.equal(context.schemaVersion, 1);
assert.ok(["acceptance", "health"].includes(context.phase));
const installation = context.installation;
const runtime = await import(installation.runtimePath);
const resources = runtime.createResourceScope();
let fixture,
  handle,
  failure,
  tests = 0;
try {
  const preflight = runtime.createEngineClient(installation.enginePath);
  try {
    const hello = await preflight.request({ op: "hello" });
    assert.equal(hello.ok, true);
    assert.deepEqual(
      { id: hello.descriptor.id, version: hello.descriptor.version },
      installation.model,
    );
    assert.ok(
      hello.descriptor.commands.some((command) => command.id === "save"),
    );
    tests++;
  } finally {
    await preflight.close();
  }
  fixture = await createStarterFixture();
  const privateCatalogFile = join(context.fixturePath, "private-policy.json");
  await writeFile(
    privateCatalogFile,
    JSON.stringify({
      schemaVersion: 1,
      allowedCommands: ["edit", "save", "discard"],
      privateNote: "hook-owned private fixture policy",
    }),
    { mode: 0o600, flag: "wx" },
  );
  handle = await createManagedLaunch({
    runtime,
    resources,
    enginePath: installation.enginePath,
    installation,
    settings: { origin: fixture.url, privateCatalogFile },
  });
  const session = handle.session;
  const snapshot = await session.snapshot();
  assert.equal(snapshot.connected, true);
  assert.deepEqual(snapshot.identity.model, installation.model);
  assert.equal(await handle.draftState(), false);
  assert.equal(
    fixture.writes,
    0,
    "Startup and model preflight execute no application write",
  );
  tests++;
  if (context.phase === "acceptance") {
    session.setSpeed("fast");
    const run = async (id, params) => {
      const result = await session.execute(
        id,
        params,
        (await session.snapshot()).revision,
      );
      assert.equal(result.ok, true);
      const report = session.report({ runId: result.runId });
      assert.ok(report);
      await writeFile(
        join(context.fixturePath, result.runId + ".json"),
        JSON.stringify(report, null, 2),
        { mode: 0o600, flag: "wx" },
      );
      return result;
    };
    await run("edit", { text: "Managed starter note", category: "work" });
    const saved = await run("save", {});
    assert.equal(saved.outcome.kind, "success");
    assert.equal(saved.effect.status, "saved");
    const records = await fetch(fixture.url + "/api/notes").then((r) =>
      r.json(),
    );
    assert.equal(records.items.length, 1);
    assert.equal(records.items[0].text, "Managed starter note");
    assert.equal(fixture.writes, 1);
    tests++;
    const report = JSON.stringify(session.report({ runId: saved.runId }));
    assert.ok(!report.includes("hook-owned private fixture policy"));
    assert.ok(!report.includes(records.items[0].operation));
    tests++;
  }
  const before = fixture.writes;
  await resources.close();
  assert.ok(
    resources
      .snapshot()
      .filter((r) => r.owned)
      .every((r) => r.status === "closed"),
  );
  assert.equal((await fetch(fixture.url + "/api/notes")).ok, true);
  assert.equal(fixture.writes, before);
  tests++;
  await fixture.close();
  fixture = null;
  console.log(
    JSON.stringify({
      schemaVersion: 1,
      accepted: true,
      isolated: true,
      tests,
      failed: 0,
      runtimePath: installation.runtimePath,
      enginePath: installation.enginePath,
      model: installation.model,
      browser: handle.browser,
      ...(context.phase === "health" ? { ready: true } : {}),
    }),
  );
} catch (error) {
  failure = error;
} finally {
  const cleanup = [];
  try {
    await resources.close();
  } catch (error) {
    cleanup.push(error);
  }
  try {
    await fixture?.close();
  } catch (error) {
    cleanup.push(error);
  }
  if (failure || cleanup.length) {
    throw new AggregateError(
      [...(failure ? [failure] : []), ...cleanup],
      "Managed acceptance or owned-resource cleanup failed; inspect retained hook evidence.",
    );
  }
}
