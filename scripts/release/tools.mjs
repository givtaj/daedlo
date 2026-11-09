import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import { promisify } from "node:util";
import { sourceSnapshot, releaseVersion } from "./build.mjs";
import { sha256 } from "./manifest.mjs";
import { releaseLicense } from "./licensing.mjs";

const execute = promisify(execFile);
const libraries = [
  "consumer-cli",
  "commands",
  "manifest",
  "names",
  "store",
  "remote",
  "ninja",
  "ninja-catalog",
  "ninja-installation",
  "ninja-manager",
  "ninja-supervisor",
  "ninja-child",
  "ninja-server",
  "ninja-evidence",
  "native",
  "native-doctor",
  "native-session",
];
const documents = [
  "contracts",
  "agent-onboarding",
  "development-workflow",
  "releases",
  "update-client",
  "presentation",
  "ninja-update",
  "native-setup",
  "rename",
  "managed-integration",
  "evidence-reporting",
];
const starterFiles = [
  "README.md",
  "acceptance.mjs",
  "adapter.mjs",
  "build-model.mjs",
  "fixture.mjs",
  "index.html",
  "project.mjs",
  "request-acceptance.mjs",
  "request-accounting.mjs",
  "report-archive.mjs",
  "runtime.mjs",
  "model/Cargo.toml",
  "model/src/lib.rs",
  "model/src/main.rs",
  "model/src/bin/starter-invalid-model.rs",
];
const swaggerFiles = [
  "README.md",
  "session.mjs",
  "project.mjs",
  "runtime.mjs",
  "build-model.mjs",
  "engine/Cargo.toml",
  "engine/Cargo.lock",
  "engine/src/lib.rs",
  "engine/src/main.rs",
];
const managedFiles = [
  "README.md",
  "adapter.mjs",
  "catalog.mjs",
  "managed-launch.mjs",
  "installation-hook.mjs",
  "prepare.mjs",
  "serve-fixture.mjs",
];
const skillPrefix = "skills/daedlo/";
const requiredSkill = [
  "SKILL.md",
  "LICENSE",
  "references/onboarding.md",
  "references/model-and-flows.md",
  "references/swagger.md",
  "assets/flow-spec.md",
];

async function command(program, args, cwd, env = process.env) {
  try {
    return (
      await execute(program, args, {
        cwd,
        env,
        encoding: "utf8",
        timeout: 60000,
        maxBuffer: 8 * 1024 * 1024,
      })
    ).stdout;
  } catch (cause) {
    throw new Error(`${program} failed during tools packaging.`, { cause });
  }
}

async function existingDirectory(input) {
  const absolute = resolve(input);
  let current = parse(absolute).root;
  for (const part of absolute
    .slice(current.length)
    .split(sep)
    .filter(Boolean)) {
    current = join(current, part);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw Error(
        "Tools source and output parents must be regular directories without symlinks.",
      );
  }
  return absolute;
}

const inside = (root, child) => {
  const suffix = relative(root, child);
  return (
    suffix === "" ||
    (!suffix.startsWith(`..${sep}`) && suffix !== ".." && !isAbsolute(suffix))
  );
};

async function removeOwned(path, identity, error) {
  try {
    const stat = await fs.lstat(path);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.dev !== identity.dev ||
      stat.ino !== identity.ino
    )
      throw Error("Owned packaging directory was replaced.");
    await fs.rm(path, { recursive: true });
  } catch (cause) {
    if (cause.code === "ENOENT") return;
    error.cleanupFailed = true;
    error.retainedOwnedDirectories = [
      ...(error.retainedOwnedDirectories ?? []),
      path,
    ];
  }
}

/** Package consumer tools separately from the four-file runtime/engine bundle. */
export async function buildToolsArchive({
  repoRoot,
  output,
  allowDirty = false,
}) {
  if (
    typeof repoRoot !== "string" ||
    !repoRoot ||
    typeof output !== "string" ||
    !output ||
    typeof allowDirty !== "boolean"
  )
    throw TypeError(
      "repoRoot/output must be explicit paths and allowDirty must be boolean.",
    );
  repoRoot = await existingDirectory(repoRoot);
  if (
    (await fs.realpath(
      (await command("git", ["rev-parse", "--show-toplevel"], repoRoot)).trim(),
    )) !== repoRoot
  )
    throw Error("repoRoot must be the Git repository root.");
  output = join(
    await existingDirectory(dirname(resolve(output))),
    basename(resolve(output)),
  );
  if (inside(repoRoot, output)) {
    try {
      await command(
        "git",
        [
          "check-ignore",
          "--no-index",
          "--quiet",
          "--",
          `${relative(repoRoot, output)}/`,
        ],
        repoRoot,
      );
    } catch {
      throw Error(
        "Tools output inside the source repository must be Git-ignored.",
      );
    }
  }
  const before = await sourceSnapshot(repoRoot);
  if (before.source.dirty && !allowDirty)
    throw Error(
      "Tools release requires clean source; allowDirty is only for explicit candidates.",
    );
  const version = releaseVersion(before.files);
  const licensing = releaseLicense(before.files);
  const sourceFiles = new Map(before.files.map((entry) => [entry.path, entry]));
  const entries = new Map();
  const copy = (source, destination = source) => {
    const entry = sourceFiles.get(source);
    if (!entry) throw Error(`Required tools source is missing: ${source}.`);
    entries.set(destination, {
      bytes: entry.bytes,
      mode: [
        "lib/consumer-cli.mjs",
        "lib/ninja.mjs",
        "lib/native.mjs",
      ].includes(destination)
        ? 0o755
        : 0o644,
    });
  };
  for (const name of libraries)
    copy(`scripts/release/${name}.mjs`, `lib/${name}.mjs`);
  copy("scripts/release/ninja-ui.html", "lib/ninja-ui.html");
  copy("scripts/release/native-session-ui.html", "lib/native-session-ui.html");
  for (const name of documents) copy(`docs/${name}.md`);
  for (const file of starterFiles) copy(`examples/starter/${file}`);
  for (const file of swaggerFiles) copy(`integrations/swagger/${file}`);
  for (const file of managedFiles) copy(`examples/managed-starter/${file}`);
  copy("docs/update-trust/production.json");
  copy("docs/update-trust/daedlo-release-2026-10.pem");
  copy("docs/update-client.md", "README.md");
  // This guide is also the package-root README; keep its local guide link valid.
  entries.get("README.md").bytes = Buffer.from(
    entries
      .get("README.md")
      .bytes.toString("utf8")
      .replaceAll("](ninja-update.md)", "](docs/ninja-update.md)"),
  );
  for (const file of licensing.files) copy(file);
  for (const file of requiredSkill)
    if (!sourceFiles.has(skillPrefix + file))
      throw Error(`Required skill source is missing: ${file}.`);
  for (const file of sourceFiles.keys())
    if (file.startsWith(skillPrefix)) copy(file);
  const runtimePackage = JSON.parse(
    sourceFiles.get("packages/runtime/package.json").bytes.toString("utf8"),
  );
  const nodeMajor = Number(/^>=(\d+)$/.exec(runtimePackage.engines?.node)?.[1]);
  const rustVersion = /^rust-version\s*=\s*"([0-9.]+)"\s*$/m.exec(
    sourceFiles.get("Cargo.toml").bytes.toString("utf8"),
  )?.[1];
  if (!Number.isSafeInteger(nodeMajor) || nodeMajor < 22 || !rustVersion)
    throw Error("Tools require explicit Node and Rust compatibility metadata.");
  const pkg = {
    name: "@daedlo/release-tools",
    version,
    description:
      "Verify and select Daedlo release bundles in an isolated archive store",
    private: true,
    license: licensing.license,
    type: "module",
    engines: { node: ">=22" },
    daedloCompatibility: { nodeMajor, rustVersion },
    bin: {
      "daedlo-release": "lib/consumer-cli.mjs",
      "browser-driver-release": "lib/consumer-cli.mjs",
      "ninja-update": "lib/ninja.mjs",
      "daedlo-native": "lib/native.mjs",
    },
    files: [
      "lib",
      "docs",
      "skills",
      "examples/starter",
      "examples/managed-starter",
      "integrations/swagger",
      "README.md",
      ...licensing.files,
      "SOURCE.json",
    ],
  };
  entries.set("package.json", {
    bytes: Buffer.from(JSON.stringify(pkg, null, 2) + "\n"),
    mode: 0o644,
  });
  const source = before.source;
  const inventory = [...entries]
    .map(([file, { bytes, mode }]) => ({
      file,
      bytes: bytes.length,
      sha256: sha256(bytes),
      mode,
    }))
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const receipt = {
    schemaVersion: 1,
    kind: "browser-driver-release-tools",
    name: pkg.name,
    version,
    source,
    files: inventory,
  };
  entries.set("SOURCE.json", {
    bytes: Buffer.from(JSON.stringify(receipt, null, 2) + "\n"),
    mode: 0o644,
  });
  const files = [...entries.keys()].sort();

  await fs.mkdir(output); // Exclusive acquisition; existing output is never adopted.
  const outputIdentity = await fs.lstat(output);
  let temporary, temporaryIdentity, result, failure;
  try {
    temporary = await fs.realpath(
      await fs.mkdtemp(join(os.tmpdir(), "daedlo-tools-")),
    );
    temporaryIdentity = await fs.lstat(temporary);
    const staging = join(temporary, "package");
    for (const [file, { bytes, mode }] of entries) {
      await fs.mkdir(dirname(join(staging, file)), { recursive: true });
      await fs.writeFile(join(staging, file), bytes, { flag: "wx", mode });
    }
    const userConfig = join(temporary, "npm-user.conf"),
      globalConfig = join(temporary, "npm-global.conf");
    await fs.writeFile(userConfig, "", { flag: "wx" });
    await fs.writeFile(globalConfig, "", { flag: "wx" });
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key)),
    );
    const packed = JSON.parse(
      await command(
        "npm",
        [
          "pack",
          "--ignore-scripts",
          "--offline",
          "--json",
          "--pack-destination",
          temporary,
          "--cache",
          join(temporary, "npm-cache"),
          "--userconfig",
          userConfig,
          "--globalconfig",
          globalConfig,
        ],
        staging,
        env,
      ),
    );
    if (
      !Array.isArray(packed) ||
      packed.length !== 1 ||
      packed[0].filename !== `daedlo-release-tools-${version}.tgz` ||
      packed[0].name !== pkg.name ||
      packed[0].version !== version ||
      !Array.isArray(packed[0].files)
    )
      throw Error(
        "npm tools package metadata does not match the selected source.",
      );
    const actualFiles = packed[0].files.map(({ path }) => path).sort();
    if (JSON.stringify(actualFiles) !== JSON.stringify(files))
      throw Error(
        "npm tools package inventory does not match the closed file list.",
      );
    for (const { path, size } of packed[0].files)
      if (size !== entries.get(path).bytes.length)
        throw Error("npm tools package file size changed.");
    const after = await sourceSnapshot(repoRoot);
    if (JSON.stringify(after.source) !== JSON.stringify(before.source))
      throw Error(
        "Source changed during tools packaging; no archive was retained.",
      );
    const archiveFile = `daedlo-tools-${version}.tgz`;
    const archivePath = join(output, archiveFile);
    const bytes = await fs.readFile(join(temporary, packed[0].filename));
    const digest = sha256(bytes);
    await fs.writeFile(archivePath, bytes, { flag: "wx" });
    const verification = {
      ...receipt,
      archive: { file: archiveFile, sha256: digest, bytes: bytes.length },
      fileCount: files.length,
    };
    const verificationBytes = Buffer.from(
      JSON.stringify(verification, null, 2) + "\n",
    );
    await fs.writeFile(
      join(output, "TOOLS_VERIFICATION.json"),
      verificationBytes,
      { flag: "wx" },
    );
    await fs.writeFile(
      join(output, "TOOLS_SHA256SUMS"),
      `${digest}  ${archiveFile}\n${sha256(verificationBytes)}  TOOLS_VERIFICATION.json\n`,
      { flag: "wx" },
    );
    result = {
      archivePath,
      sha256: digest,
      version,
      source,
      files,
      output,
      bytes: bytes.length,
    };
  } catch (error) {
    failure = error;
  }
  const cleanupError =
    failure ?? Error("Owned tools packaging cleanup is incomplete.");
  if (temporary) await removeOwned(temporary, temporaryIdentity, cleanupError);
  if (failure) await removeOwned(output, outputIdentity, failure);
  if (failure || cleanupError.cleanupFailed) throw cleanupError;
  return result;
}
