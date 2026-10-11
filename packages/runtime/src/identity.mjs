// Browser Driver adaptation of the Roots driver: generalized model, execution and viewer interfaces; later lifecycle and reporting changes. See THIRD_PARTY_NOTICES.md and licenses/Apache-2.0.txt at the package root.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
function files(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) =>
      entry.isDirectory()
        ? files(join(dir, entry.name))
        : [join(dir, entry.name)],
    );
}
export function executableHash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
export function runtimeIdentity() {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const digest = createHash("sha256");
  for (const path of [
    join(root, "package.json"),
    ...files(join(root, "src")),
  ]) {
    digest.update(relative(root, path).replaceAll("\\", "/"));
    digest.update("\0");
    digest.update(readFileSync(path));
    digest.update("\0");
  }
  return {
    runtime: `${pkg.name}@${pkg.version}`,
    runtimeBuild: digest.digest("hex"),
  };
}
