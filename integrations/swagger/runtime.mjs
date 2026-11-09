import { readFile, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ownerRoot = fileURLToPath(new URL("../../", import.meta.url));
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
async function packageAt(root) {
  try {
    return JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  } catch {
    throw Error("The selected runtime package is unavailable.");
  }
}
async function exportedFile(root, value) {
  const target =
    typeof value === "string"
      ? value
      : object(value)
        ? (value.import ?? value.default)
        : null;
  if (
    typeof target !== "string" ||
    !target.startsWith("./") ||
    target.includes("\\") ||
    target.includes("?") ||
    target.includes("#")
  )
    throw Error("The selected runtime has an unsupported package export.");
  const path = await realpath(resolve(root, target));
  const rel = relative(await realpath(root), path);
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel))
    throw Error(
      "Runtime package exports must stay inside the selected package.",
    );
  return pathToFileURL(path).href;
}

/** Select one exact runtime package; portable tools never borrow checkout code. */
export async function loadSwaggerRuntime({ runtimeRoot } = {}) {
  const owner = await packageAt(ownerRoot);
  if (runtimeRoot === undefined) {
    if (owner.name !== "daedlo-workspace")
      throw Error("Installed Swagger helpers require an explicit runtimeRoot.");
    // This relative source route exists only in the reviewed repository layout.
    runtimeRoot = resolve(ownerRoot, "packages/runtime");
  }
  if (
    typeof runtimeRoot !== "string" ||
    !runtimeRoot.trim() ||
    /[\u0000\r\n]/.test(runtimeRoot)
  )
    throw Error("Select an explicit runtimeRoot package directory.");
  runtimeRoot = resolve(runtimeRoot);
  const pkg = await packageAt(runtimeRoot);
  if (
    pkg.name !== "@daedlo/runtime" ||
    typeof pkg.version !== "string" ||
    !object(pkg.exports)
  )
    throw Error("Select the @daedlo/runtime package with its public exports.");
  if (owner.name === "@daedlo/release-tools" && owner.version !== pkg.version)
    throw Error("Swagger tools and runtime package versions must match.");
  const runtimeUrl = await exportedFile(runtimeRoot, pkg.exports["."]);
  const swaggerUrl = await exportedFile(runtimeRoot, pkg.exports["./swagger"]);
  const [runtime, swagger] = await Promise.all([
    import(runtimeUrl),
    import(swaggerUrl),
  ]);
  return {
    runtime,
    swagger,
    runtimeRoot,
    runtimeUrl,
    swaggerUrl,
    version: pkg.version,
  };
}
