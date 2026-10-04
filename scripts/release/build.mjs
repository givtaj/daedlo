import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { createManifest, sha256, verifyBundle } from "./manifest.mjs";

const execute = promisify(execFile);

async function command(program, args, cwd, env = process.env) {
  try {
    return await execute(program, args, {
      cwd,
      env,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (cause) {
    // Raw subprocess output can contain local paths or configuration values.
    throw new Error(`${program} failed (exit ${cause.code ?? "unknown"}).`, {
      cause,
    });
  }
}

const git = async (root, args) =>
  (await command("git", ["-C", root, ...args], root)).stdout;

function inside(root, path) {
  const fromRoot = relative(root, path);
  return (
    fromRoot === "" ||
    (!fromRoot.startsWith(`..${sep}`) &&
      fromRoot !== ".." &&
      !isAbsolute(fromRoot))
  );
}

async function sourceSnapshot(repoRoot) {
  const commit = (await git(repoRoot, ["rev-parse", "HEAD"])).trim();
  const dirty =
    (
      await git(repoRoot, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
      ])
    ).length > 0;
  const paths = [
    ...new Set(
      (
        await git(repoRoot, [
          "ls-files",
          "--cached",
          "--others",
          "--exclude-standard",
          "-z",
        ])
      )
        .split("\0")
        .filter(Boolean),
    ),
  ].sort();
  const files = [];
  for (const path of paths) {
    const absolute = resolve(repoRoot, path);
    if (
      !inside(repoRoot, absolute) ||
      absolute === repoRoot ||
      path.includes("\\")
    ) {
      throw new Error("Source contains an unsupported path.");
    }
    let missing = false;
    for (const segment of [path, ...parentPaths(path)]) {
      try {
        const stat = await fs.lstat(join(repoRoot, segment));
        if (stat.isSymbolicLink()) {
          throw new Error("Source symbolic links are not supported.");
        }
      } catch (error) {
        if (error.code === "ENOENT") {
          missing = true;
          break;
        }
        throw error;
      }
    }
    if (missing) continue; // A tracked deletion is represented by absence and dirty:true.
    const stat = await fs.lstat(absolute);
    if (!stat.isFile())
      throw new Error(
        "Source entries must be regular files; submodules are not supported.",
      );
    const bytes = await fs.readFile(absolute);
    files.push({ path, mode: stat.mode & 0o111 ? 0o755 : 0o644, bytes });
  }
  const treeSha256 = sha256(
    Buffer.from(
      files
        .map(({ path, mode, bytes }) =>
          JSON.stringify([path, mode, sha256(bytes)]),
        )
        .join("\n") + "\n",
    ),
  );
  return { source: { commit, dirty, treeSha256 }, files };
}

function parentPaths(path) {
  const parents = [];
  let parent = dirname(path);
  while (parent !== ".") {
    parents.push(parent);
    parent = dirname(parent);
  }
  return parents;
}

function releaseVersion(files) {
  const content = (path) => {
    const file = files.find((entry) => entry.path === path);
    if (!file) throw new Error(`Required release source is missing: ${path}.`);
    return file.bytes.toString("utf8");
  };
  const runtime = JSON.parse(content("packages/runtime/package.json"));
  const workspace = content("Cargo.toml");
  const section = workspace.match(
    /^\[workspace\.package\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m,
  )?.[1];
  const rustVersion = section?.match(
    /^version\s*=\s*"([^"\n]+)"\s*(?:#.*)?$/m,
  )?.[1];
  if (runtime.name !== "@browser-driver/runtime")
    throw new Error(
      "Runtime package name does not match the release contract.",
    );
  if (typeof runtime.version !== "string" || runtime.version !== rustVersion) {
    throw new Error("Runtime and Cargo workspace versions must match.");
  }
  const semver = runtime.version.match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/,
  );
  if (
    !semver ||
    semver[4]
      ?.split(".")
      .some(
        (part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"),
      )
  ) {
    throw new Error("Release version must be a supported semantic version.");
  }
  const crate = content("crates/browser-driver-engine/Cargo.toml");
  if (
    !/^name\s*=\s*"browser-driver-engine"\s*$/m.test(crate) ||
    !/^version\.workspace\s*=\s*true\s*$/m.test(crate)
  ) {
    throw new Error(
      "Engine package must inherit the release workspace version.",
    );
  }
  return runtime.version;
}

async function artifact(directory, file, name, version) {
  const bytes = await fs.readFile(join(directory, file));
  return {
    file,
    name,
    version,
    sha256: sha256(bytes),
    bytes: bytes.byteLength,
  };
}

/** Build two verified source packages without touching application services. */
export async function buildBundle({ repoRoot, output, allowDirty = false }) {
  if (
    typeof repoRoot !== "string" ||
    typeof output !== "string" ||
    typeof allowDirty !== "boolean"
  ) {
    throw new TypeError(
      "repoRoot/output must be paths and allowDirty must be boolean.",
    );
  }
  repoRoot = await fs.realpath(resolve(repoRoot));
  if (
    (await fs.realpath(
      (await git(repoRoot, ["rev-parse", "--show-toplevel"])).trim(),
    )) !== repoRoot
  ) {
    throw new Error("repoRoot must be the Git repository root.");
  }
  // Resolve the existing parent, never follow or replace an existing output entry.
  output = join(
    await fs.realpath(dirname(resolve(output))),
    resolve(output).split(sep).at(-1),
  );
  if (inside(repoRoot, output)) {
    try {
      await git(repoRoot, [
        "check-ignore",
        "--no-index",
        "--quiet",
        "--",
        `${relative(repoRoot, output)}/`,
      ]);
    } catch {
      throw new Error(
        "Output inside the source repository must be Git-ignored.",
      );
    }
  }
  const before = await sourceSnapshot(repoRoot);
  if (before.source.dirty && !allowDirty)
    throw new Error(
      "Release requires a clean source tree; allowDirty is only for explicit candidates.",
    );
  const version = releaseVersion(before.files);
  await fs.mkdir(output); // Exclusive acquisition: EEXIST leaves all pre-existing bytes alone.
  let temporary;
  try {
    temporary = await fs.mkdtemp(join(os.tmpdir(), "browser-driver-release-"));
    const snapshot = join(temporary, "source");
    for (const { path, mode, bytes } of before.files) {
      const destination = join(snapshot, path);
      await fs.mkdir(dirname(destination), { recursive: true });
      await fs.writeFile(destination, bytes, { mode, flag: "wx" });
    }
    const userConfig = join(temporary, "npm-user.conf");
    const globalConfig = join(temporary, "npm-global.conf");
    await fs.writeFile(userConfig, "");
    await fs.writeFile(globalConfig, "");
    await command(
      "npm",
      [
        "pack",
        "--ignore-scripts",
        "--offline",
        "--json",
        "--pack-destination",
        output,
        "--cache",
        join(temporary, "npm-cache"),
        "--userconfig",
        userConfig,
        "--globalconfig",
        globalConfig,
      ],
      join(snapshot, "packages/runtime"),
    );
    const target = join(temporary, "target");
    await command(
      "cargo",
      [
        "package",
        "--locked",
        "--offline",
        "--manifest-path",
        join(snapshot, "crates/browser-driver-engine/Cargo.toml"),
        "--target-dir",
        target,
      ],
      snapshot,
      { ...process.env, CARGO_TARGET_DIR: target, CARGO_INCREMENTAL: "0" },
    );
    const engineFile = `browser-driver-engine-${version}.crate`;
    await fs.copyFile(
      join(target, "package", engineFile),
      join(output, engineFile),
    );
    const artifacts = {
      runtime: await artifact(
        output,
        `browser-driver-runtime-${version}.tgz`,
        "@browser-driver/runtime",
        version,
      ),
      engine: await artifact(
        output,
        engineFile,
        "browser-driver-engine",
        version,
      ),
    };
    const after = await sourceSnapshot(repoRoot);
    if (JSON.stringify(after.source) !== JSON.stringify(before.source)) {
      throw new Error(
        "Source changed during release packaging; no bundle was retained.",
      );
    }
    const manifest = createManifest({
      version,
      source: before.source,
      artifacts,
    });
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    const manifestSha256 = sha256(manifestBytes);
    await fs.writeFile(join(output, "manifest.json"), manifestBytes, {
      flag: "wx",
    });
    const sums = [
      ...Object.values(artifacts).map(({ file, sha256 }) => [file, sha256]),
      ["manifest.json", manifestSha256],
    ]
      .map(([file, digest]) => `${digest}  ${file}\n`)
      .join("");
    await fs.writeFile(join(output, "SHA256SUMS"), sums, { flag: "wx" });
    await verifyBundle(output, { expectedManifestSha256: manifestSha256 });
    return { manifest, manifestSha256, output };
  } catch (error) {
    await fs.rm(output, { recursive: true, force: true });
    throw error;
  } finally {
    if (temporary) await fs.rm(temporary, { recursive: true, force: true });
  }
}
