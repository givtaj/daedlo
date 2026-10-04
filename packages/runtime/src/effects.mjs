const statuses = new Set(["saved", "uncertain", "rejected", "not_attempted"]);
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// Only adapter-authored public labels and local IDs belong here. Request tokens,
// field hashes and payloads remain private evidence, even when hashed.
export function publicEffectReport(value) {
  const uncertain = { status: "uncertain" };
  if (!object(value) || !statuses.has(value.status)) return uncertain;
  if (value.operations === undefined) return { status: value.status };
  if (!Array.isArray(value.operations) || value.operations.length > 16)
    return uncertain;
  const ids = new Set();
  const operations = [];
  for (const operation of value.operations) {
    if (
      !object(operation) ||
      typeof operation.id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(operation.id) ||
      ids.has(operation.id) ||
      typeof operation.label !== "string" ||
      !operation.label.trim() ||
      operation.label.length > 120 ||
      /[\u0000-\u001f\u007f-\u009f]/.test(operation.label) ||
      !statuses.has(operation.status)
    )
      return uncertain;
    ids.add(operation.id);
    operations.push({
      id: operation.id,
      label: operation.label,
      status: operation.status,
    });
  }
  return { status: value.status, operations };
}
