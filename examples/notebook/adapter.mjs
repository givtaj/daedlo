export function createNotebookAdapter(page) {
  let attempted = false,
    confirmed = false;
  const response = (r) => {
    if (
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === "/api/notes"
    ) {
      attempted = true;
      if (r.status() >= 200 && r.status() < 300) confirmed = true;
    }
  };
  const request = (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === "/api/notes")
      attempted = true;
  };
  page.on("request", request);
  page.on("response", response);
  const button = (name) => page.getByRole("button", { name, exact: true });
  return {
    model: { id: "notebook", version: "1" },
    beginRun() {
      attempted = false;
      confirmed = false;
    },
    observe: () =>
      page.evaluate(() => ({
        connected: true,
        session: document.body.dataset.session,
        facts: {
          text: document.querySelector("#note").value,
          phase: document.body.dataset.phase,
          urgent: document.querySelector("#urgent").checked,
          category: document.querySelector("#category").value,
          priority: Number(document.querySelector("#priority").value),
        },
      })),
    handlers: {
      edit: async ({ text }, x) =>
        x.fill(page.getByLabel("Note", { exact: true }), text),
      save: async (_, x) => x.click(button("Save note")),
      cancel: async (_, x) => x.click(button("Clear draft")),
      change_mode: async ({ urgent, category, priority }, x) => {
        await x.effect(() => page.getByLabel("Urgent").setChecked(urgent));
        await x.select(page.getByLabel("Category"), category);
        await x.fill(page.getByLabel("Priority"), String(priority));
      },
    },
    settle: () =>
      page.waitForFunction(
        () => document.body.dataset.phase !== "saving",
        null,
        { timeout: 12000 },
      ),
    evidence: async (command) => {
      if (command !== "save") return {};
      const id = await page.locator("body").getAttribute("data-operation");
      const r = await page.request.get(
        new URL(
          "/api/notes?operationId=" + encodeURIComponent(id ?? ""),
          page.url(),
        ).href,
      );
      if (!r.ok()) return {};
      const rows = await r.json();
      return {
        count: rows.items.length,
        latestText: rows.items[0]?.text ?? "",
      };
    },
    effectStatus: () => ({
      status: confirmed ? "saved" : attempted ? "uncertain" : "not_attempted",
    }),
    close() {
      page.off("request", request);
      page.off("response", response);
    },
  };
}
