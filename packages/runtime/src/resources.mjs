// Browser Driver adaptation of the Roots driver: generalized model, execution and viewer interfaces; later lifecycle and reporting changes. See THIRD_PARTY_NOTICES.md and licenses/Apache-2.0.txt at the package root.
export function createResourceScope() {
  const records = [];
  let closing;
  function register(resource, { label, close }, owned) {
    if (closing) throw Error("Cannot acquire resources during cleanup.");
    if (!label || (owned && typeof close !== "function"))
      throw Error("Owned resources require a label and cleanup function.");
    const record = {
      label,
      owned,
      status: owned ? "owned" : "attached",
      resource,
      close,
    };
    records.push(record);
    return resource;
  }
  const api = {
    own: (resource, options) => register(resource, options, true),
    attach: (resource, options) => register(resource, options, false),
    snapshot: () =>
      records.map(({ label, owned, status }) => ({ label, owned, status })),
    async setup(fn) {
      try {
        return await fn(api);
      } catch (error) {
        try {
          await api.close();
        } catch (cleanup) {
          throw new AggregateError(
            [error, cleanup],
            `${error.message}; cleanup incomplete`,
          );
        }
        throw error;
      }
    },
    close() {
      if (closing) return closing;
      closing = (async () => {
        const errors = [];
        for (const r of [...records].reverse()) {
          if (!r.owned || r.status === "closed") continue;
          try {
            await r.close(r.resource);
            r.status = "closed";
          } catch {
            r.status = "cleanup_failed";
            errors.push(Error(`Cleanup failed: ${r.label}`));
          }
        }
        if (errors.length)
          throw new AggregateError(
            errors,
            "Resource cleanup incomplete; failed handles retained for retry.",
          );
      })().finally(() => {
        closing = null;
      });
      return closing;
    },
  };
  return api;
}
