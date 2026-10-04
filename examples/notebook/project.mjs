import { fileURLToPath } from "node:url";
import { createNotebookServer } from "./server.mjs";
import { createNotebookAdapter } from "./adapter.mjs";
export async function createProject({ resources }) {
  const app = await createNotebookServer();
  resources.own(app, { label: "notebook fixture", close: (a) => a.close() });
  return {
    url: app.url,
    enginePath: fileURLToPath(
      new URL("../../target/debug/notebook-engine", import.meta.url),
    ),
    createAdapter: ({ page }) => createNotebookAdapter(page),
    identity: { application: "notebook-fixture/1" },
  };
}
