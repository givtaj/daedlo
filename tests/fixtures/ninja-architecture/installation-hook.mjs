import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { createManagedLaunch } from "./managed-launch.mjs";
import {
  assertAcceptedFlow,
  readJson,
  startFixture,
  storage,
  writeJson,
} from "./fixture-support.mjs";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const context = JSON.parse(input),
  installation = context.installation;
assert.equal(context.schemaVersion, 1);
const config = await readJson(join(installation.sourcePath, "fixture.json")),
  seed = await readJson(join(installation.sourcePath, "synthetic-seed.json"));
const runtime = await import(installation.runtimePath),
  resources = runtime.createResourceScope();
let app,
  session,
  tests = 0;
try {
  app = await startFixture({
    appRoot: config.appRoot,
    seed,
    output: context.fixturePath,
  });
  const handle = await createManagedLaunch({
    runtime,
    resources,
    enginePath: installation.enginePath,
    installation,
    settings: app,
  });
  session = handle.session;
  const observed = await session.snapshot();
  assert.equal(observed.connected, true);
  assert.deepEqual(observed.identity.model, installation.model);
  assert.equal(
    observed.identity.runtime.split("@").at(-1),
    installation.version,
  );
  assert.equal(await handle.draftState(), false);
  assert.deepEqual(await storage(app), seed);
  tests++;
  if (context.phase === "acceptance") {
    session.setSpeed("fast");
    const command = async (id, params = {}, outcome = "success") => {
      const snapshot = await session.snapshot();
      const result = await session.execute(id, params, snapshot.revision);
      assert.equal(result.ok, true);
      assert.equal(result.execution, "completed");
      assert.equal(result.outcome?.kind, outcome);
      return result;
    };
    const flow = await assertAcceptedFlow({
      command,
      observe: () => session.snapshot(),
      settings: app,
      label: installation.version,
    });
    await writeJson(join(context.fixturePath, "flow.json"), flow);
    tests += 4;
    const result = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--test", "evidence.test.mjs", "save-request.test.mjs"],
        { cwd: installation.sourcePath, stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "";
      child.stdout.on("data", (c) => {
        output += c;
      });
      child.stderr.on("data", (c) => {
        output += c;
      });
      child.once("error", reject);
      child.once("exit", (code) => resolve({ code, output }));
    });
    await writeJson(join(context.fixturePath, "node-tests.json"), result);
    assert.equal(result.code, 0);
    assert.match(result.output, /# pass 7\b/);
    tests += 7;
    const gate = await readJson(config.acceptanceGateFile);
    assert.notEqual(
      gate.rejectVersion,
      installation.version,
      "Controlled registered acceptance rejection after real browser checks",
    );
  }
  await resources.close();
  assert.ok(
    resources
      .snapshot()
      .filter((r) => r.owned)
      .every((r) => r.status === "closed"),
  );
  await storage(app);
  await writeJson(
    join(context.fixturePath, "session-report.json"),
    session.report(),
  );
  tests++;
  await app.close();
  app = null;
  console.log(
    JSON.stringify({
      schemaVersion: 1,
      accepted: true,
      isolated: true,
      runtimePath: installation.runtimePath,
      enginePath: installation.enginePath,
      model: installation.model,
      browser: handle.browser,
      tests,
      failed: 0,
      ...(context.phase === "health" ? { ready: true } : {}),
    }),
  );
} finally {
  await resources.close();
  await app?.close();
}
