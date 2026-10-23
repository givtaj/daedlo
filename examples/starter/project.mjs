import { resolve } from "node:path";
import { createStarterFixture } from "./fixture.mjs";
import { createStarterAdapter } from "./adapter.mjs";

export async function createProject({ resources }) {
  const enginePath = process.env.DAEDLO_STARTER_ENGINE;
  if (!enginePath)
    throw new Error(
      "Build the starter and set DAEDLO_STARTER_ENGINE to its exact executable.",
    );
  const fixture = await createStarterFixture();
  resources.own(fixture, {
    label: "starter disposable fixture",
    close: (value) => value.close(),
  });
  return {
    url: fixture.url,
    enginePath: resolve(enginePath),
    createAdapter: ({ page }) => createStarterAdapter(page),
    identity: { application: "starter-fixture/1" },
    frontend: {
      name: "Starter synthetic editor",
      targetOrigin: fixture.url,
      model: { id: "starter", version: "1" },
      evidenceLocation:
        process.env.DAEDLO_STARTER_OUTPUT ??
        "Use --report for a durable run report",
      ownership: { browser: "owned", context: "owned", application: "owned" },
    },
  };
}
