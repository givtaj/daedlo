import { cp, readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export async function buildStarterModel({
  output,
  crate = fileURLToPath(new URL("../../crates/daedlo-engine", import.meta.url)),
  offline = false,
}) {
  if (!output) throw new Error("Select a fresh ignored output directory.");
  const out = resolve(output),
    cratePath = resolve(crate),
    model = join(out, "model");
  // Copies into a fresh destination so compiling never changes an application's
  // normal model, Cargo lockfile or target directory.
  await mkdir(out, { recursive: true });
  await cp(new URL("./model", import.meta.url), model, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  const manifest = join(model, "Cargo.toml");
  await writeFile(
    manifest,
    (await readFile(manifest, "utf8")).replace(
      /path = "\.\.\/\.\.\/\.\.\/crates\/daedlo-engine"/,
      `path = ${JSON.stringify(cratePath)}`,
    ),
  );
  const args = [
    "build",
    "--manifest-path",
    manifest,
    "--target-dir",
    join(out, "target"),
    "--bins",
  ];
  if (offline) args.push("--offline");
  const result = await promisify(execFile)("cargo", args, {
    maxBuffer: 8 * 1024 * 1024,
  });
  await writeFile(join(out, "cargo-build.log"), result.stdout + result.stderr);
  const suffix = process.platform === "win32" ? ".exe" : "";
  return {
    enginePath: join(out, "target/debug/daedlo-starter-engine" + suffix),
    invalidEnginePath: join(out, "target/debug/starter-invalid-model" + suffix),
    model,
    cratePath,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2),
    options = {};
  while (args.length) {
    const arg = args.shift();
    if (arg === "--offline") options.offline = true;
    else if (arg === "--crate" || arg === "--output") {
      const value = args.shift();
      if (!value) throw new Error(`${arg} requires a path`);
      options[arg.slice(2)] = value;
    } else throw new Error(`Unknown option ${arg}`);
  }
  console.log(JSON.stringify(await buildStarterModel(options), null, 2));
}
