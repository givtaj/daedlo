import { trackPageRequests } from "./request-accounting.mjs";

export function createStarterAdapter(page, { timeoutMs = 5000 } = {}) {
  const requests = trackPageRequests(page);
  let attempted = false,
    confirmed = false,
    operation,
    closed = false;
  const request = (value) => {
    if (value.method() !== "POST") return;
    try {
      if (
        value.frame().page() !== page ||
        new URL(value.url()).origin !== new URL(page.url()).origin ||
        new URL(value.url()).pathname !== "/api/notes"
      )
        return;
      attempted = true;
      operation = value.postDataJSON()?.operation;
    } catch {
      attempted = true;
      operation = undefined;
    }
  };
  page.context().on("request", request);
  return {
    model: { id: "starter", version: "1" },
    beginRun() {
      attempted = false;
      confirmed = false;
      operation = undefined;
    },
    observe: () =>
      page.evaluate(() => ({
        connected: true,
        session: "synthetic-fixture",
        facts: {
          text: document.querySelector("#note").value,
          category: document.querySelector("#category").value,
          phase: document.body.dataset.phase,
        },
      })),
    handlers: {
      edit: async ({ text, category }, x) => {
        await x.fill(page.getByLabel("Note", { exact: true }), text);
        await x.select(page.getByLabel("Category", { exact: true }), category);
      },
      save: async (_, x) =>
        x.click(page.getByRole("button", { name: "Save note", exact: true })),
      discard: async (_, x) =>
        x.click(
          page.getByRole("button", { name: "Discard draft", exact: true }),
        ),
    },
    async settle() {
      await page.waitForFunction(
        () =>
          document.body.dataset.phase &&
          document.body.dataset.phase !== "saving",
        null,
        { timeout: timeoutMs },
      );
      await requests.waitForIdle({ timeoutMs });
    },
    async evidence(command, before, after) {
      if (
        command !== "save" ||
        after.facts.phase !== "saved" ||
        !attempted ||
        typeof operation !== "string"
      )
        return {};
      const visibleOperation = await page
        .locator("body")
        .getAttribute("data-operation");
      if (visibleOperation !== operation) return {};
      const response = await page.request.get(
        new URL(
          "/api/notes?operation=" + encodeURIComponent(operation),
          page.url(),
        ).href,
      );
      if (!response.ok()) return {};
      const { items } = await response.json();
      confirmed =
        Array.isArray(items) &&
        items.length === 1 &&
        items[0].operation === operation &&
        items[0].text === before.facts.text &&
        items[0].text === after.facts.text &&
        items[0].category === before.facts.category &&
        items[0].category === after.facts.category;
      return {
        count: Array.isArray(items) ? items.length : -1,
        matching: confirmed,
      };
    },
    effectStatus: () => ({
      status: confirmed ? "saved" : attempted ? "uncertain" : "not_attempted",
    }),
    requestDiagnostics: requests.snapshot,
    close() {
      if (!closed) {
        closed = true;
        page.context().off("request", request);
      }
      return requests.close();
    },
  };
}
