import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const [checkout, sourceArg, output] = process.argv.slice(2);
if (!checkout || !sourceArg || !output)
  throw Error(
    "Usage: source-receipt.mjs LIVE_CHECKOUT ARCHIVED_SOURCE PRIVATE_OUTPUT",
  );
const source = resolve(sourceArg),
  commit = "068d573051f7e43213ba547f842624f6551706f6";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const entries = execFileSync(
  "git",
  ["-C", checkout, "ls-tree", "-r", "-z", commit, "dist"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const files = {};
for (const entry of entries) {
  const [metadata, path] = entry.split("\t"),
    [mode, type, id] = metadata.split(" ");
  if (type !== "blob" || mode !== "100644")
    throw Error("Expected regular committed source");
  const expected = execFileSync(
    "git",
    ["-C", checkout, "cat-file", "blob", id],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const actual = await readFile(join(source, path));
  if (!expected.equals(actual))
    throw Error("Archived source differs from committed source");
  files[path] = hash(actual);
}
const actualPaths = [];
async function walk(dir) {
  for (const entry of await readdir(join(source, dir), {
    withFileTypes: true,
  })) {
    const path = dir + "/" + entry.name;
    if (entry.isDirectory()) await walk(path);
    else actualPaths.push(path);
  }
}
await walk("dist");
if (
  JSON.stringify(actualPaths.sort()) !==
  JSON.stringify(Object.keys(files).sort())
)
  throw Error("Unexpected archived source paths");
await writeFile(
  output,
  JSON.stringify(
    {
      commit,
      sourceTarSha256: hash(await readFile(join(source, "..", "source.tar"))),
      files,
      treeSha256: hash(JSON.stringify(files)),
      matched: true,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(
  JSON.stringify({ matched: true, files: Object.keys(files).length }),
);
