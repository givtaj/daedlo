import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
async function files(path) {
  const output = [];
  for (const item of await readdir(path, { withFileTypes: true })) {
    if (["node_modules", "target", "artifacts", ".git"].includes(item.name))
      continue;
    const p = join(path, item.name);
    if (item.isDirectory()) output.push(...(await files(p)));
    else if (p.endsWith(".mjs")) output.push(p);
  }
  return output;
}
for (const file of await files(".")) {
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log("JavaScript syntax checks passed.");
