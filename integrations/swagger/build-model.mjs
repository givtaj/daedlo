import { readFile, writeFile, mkdir, lstat, realpath } from "node:fs/promises";
import {
  resolve,
  join,
  dirname,
  basename,
  relative,
  isAbsolute,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const files = ["Cargo.toml", "Cargo.lock", "src/lib.rs", "src/main.rs"];
/** Compile frozen generic model sources in a fresh owned output directory. */
export async function buildSwaggerModel({
  output,
  crate,
  offline = false,
} = {}) {
  if (
    typeof output !== "string" ||
    !output.trim() ||
    typeof crate !== "string" ||
    !crate.trim()
  )
    throw Error("Select a fresh output and the exact extracted core crate.");
  if (typeof offline !== "boolean") throw Error("offline must be a boolean.");
  const out = resolve(output),
    cratePath = resolve(crate);
  async function futurePath(path) {
    try {
      return await realpath(path);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return join(await futurePath(dirname(path)), basename(path));
    }
  }
  const destination = await futurePath(out);
  for (const input of [
    cratePath,
    fileURLToPath(new URL("./", import.meta.url)),
  ]) {
    const relation = relative(await realpath(input), destination);
    if (
      !relation ||
      (!isAbsolute(relation) &&
        relation !== ".." &&
        !relation.startsWith(".." + sep))
    )
      throw Error(
        "Build output must stay outside the model helpers and core crate; input/output overlap is refused.",
      );
  }
  const source = new Map();
  for (const file of files)
    source.set(
      file,
      await readFile(new URL("./engine/" + file, import.meta.url)),
    );
  const template = source.get("Cargo.toml").toString("utf8");
  const dependency =
    /^daedlo-engine\s*=\s*\{\s*path\s*=\s*"\.\.\/\.\.\/\.\.\/crates\/daedlo-engine",\s*version\s*=\s*"=([^"]+)"\s*\}/m.exec(
      template,
    );
  if (!dependency)
    throw Error(
      "The Swagger model template has an unsupported core dependency.",
    );
  const core = await readFile(join(cratePath, "Cargo.toml"), "utf8");
  const section =
    /^\[package\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m.exec(core)?.[1] ?? "";
  const name = /^name\s*=\s*"([^"]+)"\s*$/m.exec(section)?.[1];
  const version = /^version\s*=\s*"([^"]+)"\s*$/m.exec(section)?.[1];
  if (name !== "daedlo-engine" || version !== dependency[1])
    throw Error(
      "The extracted core crate name/version must match the Swagger model pin.",
    );
  try {
    await lstat(out);
    throw Error(
      "Select a fresh output directory; the destination already exists.",
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(dirname(out), { recursive: true });
  await mkdir(out);
  const model = join(out, "model");
  for (const [file, bytes] of source) {
    const path = join(model, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      file === "Cargo.toml"
        ? template.replace(
            dependency[0],
            `daedlo-engine = { path = ${JSON.stringify(cratePath)}, version = "=${version}" }`,
          )
        : bytes,
      { flag: "wx" },
    );
  }
  const args = [
    "build",
    "--locked",
    "--manifest-path",
    join(model, "Cargo.toml"),
    "--target-dir",
    join(out, "target"),
    "--bin",
    "swagger-engine",
  ];
  if (offline) args.push("--offline");
  try {
    const result = await promisify(execFile)("cargo", args, {
      cwd: out,
      maxBuffer: 8 * 1024 * 1024,
    });
    await writeFile(
      join(out, "cargo-build.log"),
      result.stdout + result.stderr,
    );
  } catch (error) {
    await writeFile(
      join(out, "cargo-build.log"),
      String(error.stdout ?? "") + String(error.stderr ?? ""),
    );
    throw Error(
      "Swagger model build failed; inspect the owned cargo-build.log.",
    );
  }
  const enginePath = join(
    out,
    "target/debug/swagger-engine" +
      (process.platform === "win32" ? ".exe" : ""),
  );
  if (!(await lstat(enginePath)).isFile())
    throw Error("Swagger model build did not produce its executable.");
  return { enginePath, model, cratePath, version };
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
      if (!value) throw Error(`${arg} requires a path`);
      options[arg.slice(2)] = value;
    } else throw Error(`Unknown option ${arg}`);
  }
  console.log(JSON.stringify(await buildSwaggerModel(options), null, 2));
}
