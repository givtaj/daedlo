import { releaseNames } from "../../scripts/release/names.mjs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

// First run release-tools verify with this digest and the actual Node/Rust
// environment. This builder consumes that trusted pair in a fresh directory.
const [bundleArg, outputArg, trustedDigest] = process.argv.slice(2);
if (!bundleArg || !outputArg || !/^[a-f0-9]{64}$/.test(trustedDigest ?? ""))
  throw Error(
    "Usage: prepare.mjs VERIFIED_BUNDLE FRESH_CONSUMER MANIFEST_SHA256",
  );
const bundle = resolve(bundleArg),
  output = resolve(outputArg);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifestBytes = await readFile(join(bundle, "manifest.json"));
if (hash(manifestBytes) !== trustedDigest)
  throw Error("Trusted manifest digest mismatch");
const manifest = JSON.parse(manifestBytes);
const selected = releaseNames(manifest.artifacts);
let engineBytes;
for (const [kind, suffix] of [
  ["runtime", "tgz"],
  ["engine", "crate"],
]) {
  const artifact = manifest.artifacts[kind];
  const expected = `${selected.prefix}-${kind}-${manifest.version}.${suffix}`;
  if (artifact.file !== expected || !/^[0-9A-Za-z.-]+$/.test(manifest.version))
    throw Error("Invalid release artifact path");
  const bytes = await readFile(join(bundle, artifact.file));
  if (hash(bytes) !== artifact.sha256 || bytes.length !== artifact.bytes)
    throw Error("Artifact verification failed");
  if (kind === "engine") engineBytes = bytes;
}
await mkdir(output);
await mkdir(join(output, "engine-package"));
const prefix = `${selected.engine}-${manifest.version}`;
const names = execFileSync("tar", ["-tf", "-"], {
  encoding: "utf8",
  input: engineBytes,
})
  .trim()
  .split("\n");
const kinds = execFileSync("tar", ["-tvf", "-"], {
  encoding: "utf8",
  input: engineBytes,
})
  .trim()
  .split("\n");
if (
  names.length !== kinds.length ||
  names.some(
    (name, index) =>
      !/^[A-Za-z0-9._/-]+$/.test(name) ||
      name.split("/").some((part) => part === ".." || part === ".") ||
      !(
        name === prefix ||
        name === prefix + "/" ||
        name.startsWith(prefix + "/")
      ) ||
      !["-", "d"].includes(kinds[index][0]),
  )
)
  throw Error(
    "Crate archive must contain only regular files and directories under its exact package prefix",
  );
execFileSync("tar", ["-xf", "-", "-C", join(output, "engine-package")], {
  input: engineBytes,
});
await mkdir(join(output, "engine", "src"), { recursive: true });
await copyFile(
  fileURLToPath(new URL("./engine/src/main.rs", import.meta.url)),
  join(output, "engine", "src/main.rs"),
);
const crate = join(
  output,
  "engine-package",
  `${selected.engine}-${manifest.version}`,
);
await writeFile(
  join(output, "engine", "Cargo.toml"),
  `[package]\nname = "seeruntime-browser-driver"\nversion = "0.1.0"\nedition = "2021"\npublish = false\n\n[workspace]\n\n[dependencies]\ndaedlo-engine = { package = ${JSON.stringify(selected.engine)}, path = ${JSON.stringify(crate)}, version = "=${manifest.version}" }\nserde = { version = "1", features = ["derive"] }\nserde_json = "1"\n`,
);
await writeFile(
  join(output, "package.json"),
  JSON.stringify(
    {
      name: "seeruntime-driver-isolated-consumer",
      private: true,
      type: "module",
      dependencies: {
        [selected.runtime]: `file:${join(bundle, manifest.artifacts.runtime.file)}`,
      },
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  join(output, "receipt.json"),
  JSON.stringify(
    {
      version: manifest.version,
      manifestSha256: trustedDigest,
      artifacts: manifest.artifacts,
      applicationCommit: "068d573051f7e43213ba547f842624f6551706f6",
      modelSourceSha256: hash(
        await readFile(join(output, "engine", "src/main.rs")),
      ),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    consumer: output,
    version: manifest.version,
    engineManifest: join(output, "engine", "Cargo.toml"),
    target: join(output, "target"),
  }),
);
