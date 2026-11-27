import { createStarterAdapter } from "../starter/adapter.mjs";
import { validatePrivateCatalog } from "./catalog.mjs";

// Extend application guards, not the managed session object. Rust remains the
// authority for states, parameters, recipes and outcomes. The existing adapter's
// operation-scoped readback feeds effectStatus before the result is finalized.
export function createManagedStarterAdapter(page, { catalog, ...options }) {
  const policy = validatePrivateCatalog({
    ...catalog,
    privateNote: catalog.privateNote ?? "",
  });
  const adapter = createStarterAdapter(page, options);
  const handlers = Object.fromEntries(
    Object.entries(adapter.handlers).map(([id, handler]) => [
      id,
      async (params, execution) => {
        if (!policy.allowedCommands.includes(id)) {
          const error = new Error(
            "This command is not enabled by the private integration policy.",
          );
          error.code = "private_policy_denied";
          throw error;
        }
        return handler(params, execution);
      },
    ]),
  );
  return { ...adapter, handlers };
}
