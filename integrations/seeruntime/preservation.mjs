import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Private evidence only: record bytes without copying application contents.
// Ignored files, running services and external data are outside this inventory.
export async function inventory(checkout) {
  const git = (...args) =>
    execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8" });
  const paths = git(
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  )
    .split("\0")
    .filter(Boolean);
  const files = {};
  for (const path of [...new Set(paths)].sort()) {
    try {
      const stat = await lstat(join(checkout, path));
      const bytes = stat.isSymbolicLink()
        ? Buffer.from(await readlink(join(checkout, path)))
        : await readFile(join(checkout, path));
      files[path] = {
        kind: stat.isSymbolicLink() ? "symlink" : "file",
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      files[path] = { kind: "missing" };
    }
  }
  return {
    head: git("rev-parse", "HEAD").trim(),
    status: git("status", "--porcelain=v1", "-z"),
    files,
  };
}

if (process.argv[1]?.endsWith("/preservation.mjs")) {
  const [checkout, output] = process.argv.slice(2);
  if (!checkout || !output)
    throw Error("Usage: preservation.mjs CHECKOUT PRIVATE_OUTPUT");
  const result = await inventory(checkout);
  await writeFile(output, JSON.stringify(result, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      head: result.head,
      fileCount: Object.keys(result.files).length,
      dirtyEntries: result.status.split("\0").filter(Boolean).length,
    }),
  );
}
