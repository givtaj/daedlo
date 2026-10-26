import {
  cp,
  mkdir,
  readFile,
  readdir,
  writeFile,
  realpath,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const writeJson = (path, value) =>
  writeFile(path, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
async function files(root, prefix = "") {
  const result = [];
  for (const item of await readdir(join(root, prefix), {
    withFileTypes: true,
  })) {
    const name = prefix ? prefix + "/" + item.name : item.name;
    if (item.isDirectory()) result.push(...(await files(root, name)));
    else if (item.isFile()) result.push(name);
    else throw new Error("Only regular example files may be registered.");
  }
  return result.sort();
}

// This prepares a NEW disposable integration; it never enrolls or rewrites an
// existing customer integration. Keep source, store and private policy separate.
export async function prepareManagedStarter({
  output,
  crate,
  origin,
  trustFile,
  catalogUrl = "https://daedlo.com/updates/preview.json",
  publisher = "daedlo",
  keyId = "daedlo-release-2026-10",
  projectId = "managed-starter",
  frontendName = "Managed starter",
  offline = true,
}) {
  for (const value of [output, crate, trustFile])
    if (typeof value !== "string" || !isAbsolute(value))
      throw new Error(
        "Supply explicit absolute output, crate and public trust paths.",
      );
  const target = new URL(origin);
  if (
    target.protocol !== "http:" ||
    target.hostname !== "127.0.0.1" ||
    target.origin !== origin
  )
    throw new Error("Select the separately owned loopback starter origin.");
  if (new URL(catalogUrl).protocol !== "https:")
    throw new Error("Use the reviewed HTTPS signed-update catalog.");
  const cratePath = await realpath(crate);
  const publicKeyFile = await realpath(trustFile);
  if (!(await readFile(publicKeyFile, "utf8")).includes("BEGIN PUBLIC KEY"))
    throw new Error("Supply the verified publisher public key.");
  const destination = resolve(output);
  await mkdir(destination, { mode: 0o700 });
  const sourceRoot = join(destination, "project");
  await mkdir(sourceRoot, { mode: 0o700 });
  await mkdir(join(sourceRoot, "starter"));
  await mkdir(join(sourceRoot, "managed-starter"));
  for (const name of [
    "adapter.mjs",
    "request-accounting.mjs",
    "fixture.mjs",
    "index.html",
  ])
    await cp(
      join(here, "../starter", name),
      join(sourceRoot, "starter", name),
      { errorOnExist: true, force: false },
    );
  for (const name of [
    "adapter.mjs",
    "catalog.mjs",
    "managed-launch.mjs",
    "installation-hook.mjs",
  ])
    await cp(join(here, name), join(sourceRoot, "managed-starter", name), {
      errorOnExist: true,
      force: false,
    });
  await cp(join(here, "../starter/model"), join(sourceRoot, "model"), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  const manifest = join(sourceRoot, "model/Cargo.toml");
  const before = await readFile(manifest, "utf8");
  const after = before.replace(
    /path = "\.\.\/\.\.\/\.\.\/crates\/daedlo-engine"/,
    `path = ${JSON.stringify(cratePath)}`,
  );
  if (after === before)
    throw new Error(
      "The selected starter model has an unsupported dependency layout.",
    );
  await writeFile(manifest, after);
  await writeJson(join(sourceRoot, "package.json"), {
    name: "managed-starter-integration",
    version: "1.0.0",
    private: true,
    type: "module",
  });
  const npm = await execute(
    "npm",
    [
      "install",
      "--prefix",
      sourceRoot,
      "--workspaces=false",
      "--package-lock-only",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--offline",
    ],
    { cwd: sourceRoot },
  );
  await writeFile(join(destination, "npm-lock.log"), npm.stdout + npm.stderr, {
    mode: 0o600,
  });
  const cargo = await execute(
    "cargo",
    [
      "generate-lockfile",
      "--manifest-path",
      manifest,
      ...(offline ? ["--offline"] : []),
    ],
    { cwd: sourceRoot },
  );
  await writeFile(
    join(destination, "cargo-lock.log"),
    cargo.stdout + cargo.stderr,
    { mode: 0o600 },
  );
  const registration = {
    schemaVersion: 1,
    projectId,
    label: frontendName,
    sourceRoot,
    files: await files(sourceRoot),
    model: { id: "starter", version: "1" },
    interfaces: {
      launcher: 1,
      nodeAdapter: 1,
      rustModel: 1,
      protocol: 1,
      capabilities: ["recipeContext:1"],
    },
    node: { packageJson: "package.json", packageLock: "package-lock.json" },
    rust: {
      manifest: "model/Cargo.toml",
      lock: "model/Cargo.lock",
      binary: "daedlo-starter-engine",
    },
    hooks: {
      acceptance: "managed-starter/installation-hook.mjs",
      health: "managed-starter/installation-hook.mjs",
    },
    launcher: "managed-starter/managed-launch.mjs",
  };
  const privateCatalogFile = join(destination, "private-policy.json");
  await writeJson(privateCatalogFile, {
    schemaVersion: 1,
    allowedCommands: ["edit", "save", "discard"],
    privateNote: "Local application metadata; never a public label or result",
  });
  const config = {
    schemaVersion: 1,
    store: join(destination, "store"),
    frontend: { name: frontendName, targetOrigin: origin },
    registration,
    catalog: {
      url: catalogUrl,
      publisher,
      channel: "preview",
      trustedKeys: [{ id: keyId, publicKeyFile }],
    },
    installation: { offline },
    settings: { origin, privateCatalogFile, headless: true },
  };
  const configPath = join(destination, "ninja.json");
  await writeJson(configPath, config);
  return { configPath, config, sourceRoot, privateCatalogFile };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const options = {};
  const keys = {
    "--output": "output",
    "--crate": "crate",
    "--origin": "origin",
    "--trust": "trustFile",
    "--catalog-url": "catalogUrl",
  };
  const args = process.argv.slice(2);
  while (args.length) {
    const key = args.shift();
    if (!keys[key] || !args.length)
      throw new Error(
        "Use --output ABS --crate ABS --origin URL --trust ABS [--catalog-url HTTPS].",
      );
    options[keys[key]] = args.shift();
  }
  const prepared = await prepareManagedStarter(options);
  console.log(
    JSON.stringify(
      {
        configPath: prepared.configPath,
        sourceRoot: prepared.sourceRoot,
        scope:
          "New disposable independent starter; inspect before managed setup",
      },
      null,
      2,
    ),
  );
}
