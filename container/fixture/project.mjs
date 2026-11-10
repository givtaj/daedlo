import { createNotebookAdapter } from "../../examples/notebook/adapter.mjs";

export async function createProject({ resources }) {
  const url = process.env.DAEDLO_TARGET_URL ?? "http://notebook-app:8080";
  resources.attach({ url }, { label: "Compose notebook application" });
  return {
    url,
    enginePath: "/opt/daedlo/models/notebook-engine",
    createAdapter: ({ page }) => createNotebookAdapter(page),
    identity: { application: "independent-compose-notebook/1" },
    frontend: {
      name: "Compose conformance fixture",
      targetOrigin: new URL(url).origin,
      model: { id: "notebook", version: "1" },
      evidenceLocation: "/evidence/session.json (latest clean shutdown)",
      ownership: {
        browser: "owned",
        context: "owned",
        application: "attached",
      },
    },
  };
}
