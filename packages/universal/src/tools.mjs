import fs from "node:fs/promises";

const allowed = new Set([
  "workspace",
  "run-journal",
  "journal-recovery",
  "native",
  "native-session",
  "ninja",
  "ninja-installation",
  "ninja-supervisor",
  "ninja-manager",
  "process-owner",
]);
let directory;

/** Universal reuses exact Daedlo tools; basic tools never import Universal. */
export async function loadTools(name) {
  if (!allowed.has(name))
    throw new TypeError("Unsupported Daedlo tools module.");
  if (!directory) {
    const pkg = JSON.parse(
      await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    if (pkg.name !== "@daedlo/universal")
      throw Error("Invalid Universal package.");
    if (pkg.daedloToolsLayout === "bundled")
      directory = new URL("../vendor/tools/lib/", import.meta.url);
    else if (pkg.daedloToolsLayout === "source") {
      const root = JSON.parse(
        await fs.readFile(
          new URL("../../../package.json", import.meta.url),
          "utf8",
        ),
      );
      if (root.name !== "daedlo-workspace" || root.private !== true)
        throw Error("Universal needs its bundled Daedlo tools.");
      directory = new URL("../../../scripts/release/", import.meta.url);
    } else throw Error("Universal needs its bundled Daedlo tools.");
  }
  return import(new URL(`${name}.mjs`, directory));
}
