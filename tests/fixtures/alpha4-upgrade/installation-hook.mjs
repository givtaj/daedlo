import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createNotebookServer } from "./server.mjs";
import { createManagedLaunch } from "./managed-launch.mjs";
import { assertFlow, notes } from "./flow.mjs";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const context = JSON.parse(input),
  installation = context.installation;
assert.equal(context.schemaVersion, 1);
const runtime = await import(installation.runtimePath);
const resources = runtime.createResourceScope();
const app = await createNotebookServer();
let session,
  checks = 0,
  browser;
try {
  const handle = await createManagedLaunch({
    runtime,
    resources,
    enginePath: installation.enginePath,
    installation,
    settings: { origin: app.url },
  });
  session = handle.session;
  browser = handle.browser;
  assert.equal((await session.snapshot()).connected, true);
  assert.deepEqual(
    (await session.snapshot()).identity.model,
    installation.model,
  );
  assert.equal(await handle.draftState(), false);
  checks++;
  if (context.phase === "acceptance") {
    const flow = await assertFlow({
      command: async (id, params) =>
        session.execute(id, params, (await session.snapshot()).revision),
      observe: () => session.snapshot(),
      origin: app.url,
      label: installation.version,
    });
    await writeFile(
      join(context.fixturePath, "flow.json"),
      JSON.stringify(flow, null, 2),
    );
    checks += 3;
  }
  const persisted = await notes(app.url);
  await resources.close();
  assert.ok(
    resources
      .snapshot()
      .filter((r) => r.owned)
      .every((r) => r.status === "closed"),
  );
  assert.deepEqual(
    await notes(app.url),
    persisted,
    "Attached app survives driver close",
  );
  await writeFile(
    join(context.fixturePath, "report.json"),
    JSON.stringify(session.report(), null, 2),
  );
  checks++;
  console.log(
    JSON.stringify({
      schemaVersion: 1,
      accepted: true,
      isolated: true,
      runtimePath: installation.runtimePath,
      enginePath: installation.enginePath,
      model: installation.model,
      browser,
      tests: checks,
      failed: 0,
      ...(context.phase === "health" ? { ready: true } : {}),
    }),
  );
} finally {
  await resources.close();
  await app.close();
}
