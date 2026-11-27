import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute } from "node:path";

// This is an application-policy example, not the signed release/update catalog.
// Arbitrary private text is never copied into facts, identity, labels or reports.
export function validatePrivateCatalog(value) {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.allowedCommands) ||
    value.allowedCommands.some(
      (id) => !["edit", "save", "discard"].includes(id),
    ) ||
    new Set(value.allowedCommands).size !== value.allowedCommands.length ||
    typeof value.privateNote !== "string" ||
    value.privateNote.length > 4096 ||
    Object.keys(value).some(
      (key) =>
        !["schemaVersion", "allowedCommands", "privateNote"].includes(key),
    )
  )
    throw new Error("The private application policy is invalid.");
  return Object.freeze({
    schemaVersion: 1,
    allowedCommands: Object.freeze([...value.allowedCommands]),
  });
}

export async function readPrivateCatalog(path) {
  if (typeof path !== "string" || !isAbsolute(path))
    throw new Error("Select an explicit private application policy file.");
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 8192)
      throw new Error("Invalid private policy file");
    const bytes = await handle.readFile();
    if (bytes.length > 8192) throw new Error("Invalid private policy size");
    return validatePrivateCatalog(JSON.parse(bytes));
  } catch {
    throw new Error("The private application policy could not be validated.");
  } finally {
    await handle?.close();
  }
}
