import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildToolsArchive } from "../scripts/release/tools.mjs";

const version = "0.1.1-rc.2";
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
];
const trustFiles = [
  "docs/update-trust/production.json",
  "docs/update-trust/daedlo-release-2026-10.pem",
];
const skillFiles = [
  "SKILL.md",
  "LICENSE",
  "references/onboarding.md",
  "references/model-and-flows.md",
  "assets/flow-spec.md",
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
  "runtime.mjs",
  "model/Cargo.toml",
  "model/src/lib.rs",
  "model/src/main.rs",
  "model/src/bin/starter-invalid-model.rs",
];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function fixture(t) {
  const directory = await fs.realpath(
    await fs.mkdtemp(join(os.tmpdir(), "driver-tools-test-")),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const repoRoot = join(directory, "source");
  const files = {
    ".gitignore": "artifacts/\n.env\n",
    LICENSE: "MIT License\n",
    "docs/update-client.md": "# Portable update client\n",
    "packages/runtime/package.json": JSON.stringify({
      name: "@daedlo/runtime",
      version,
      license: "MIT",
      engines: { node: ">=22" },
    }),
    "Cargo.toml": `[workspace.package]\nversion = "${version}"\nrust-version = "1.96"\n`,
    "crates/daedlo-engine/Cargo.toml":
      '[package]\nname = "daedlo-engine"\nversion.workspace = true\n',
    "scripts/release/build.mjs":
      'throw Error("Maintainer builder must never ship");\n',
    "scripts/release/version.mjs":
      'throw Error("Maintainer version mutation must never ship");\n',
    "unrelated.txt": "Do not distribute the entire repository.\n",
    "scripts/release/native-session-ui.html":
      "<!doctype html><title>Frontend startup</title>\n",
    "scripts/release/ninja-ui.html":
      "<!doctype html><title>Ninja updates</title>\n",
  };
  for (const name of libraries)
    files[`scripts/release/${name}.mjs`] =
      `export const fixture = ${JSON.stringify(name)};\n`;
  for (const name of documents) files[`docs/${name}.md`] = `# ${name}\n`;
  for (const name of trustFiles) files[name] = `Public trust fixture ${name}\n`;
  for (const name of skillFiles)
    files[`skills/daedlo/${name}`] = `Fixture ${name}\n`;
  for (const name of starterFiles)
    files[`examples/starter/${name}`] = `Synthetic starter ${name}\n`;
  files["examples/starter/local-secret.txt"] = "PRIVATE_STARTER_SENTINEL\n";
  for (const [path, bytes] of Object.entries(files)) {
    await fs.mkdir(dirname(join(repoRoot, path)), { recursive: true });
    await fs.writeFile(join(repoRoot, path), bytes);
  }
  const git = (args) =>
    execFileSync("git", ["-C", repoRoot, ...args], {
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  git(["init", "-q"]);
  git(["add", "."]);
  git([
    "-c",
    "user.name=Release test",
    "-c",
    "user.email=release@example.test",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-qm",
    "Fixture baseline",
  ]);
  return { directory, repoRoot, output: join(directory, "tools"), git };
}

test("portable tools have a closed consumer inventory and complete agent references", async (t) => {
  const f = await fixture(t);
  const result = await buildToolsArchive(f);
  const expected = [
    "package.json",
    "README.md",
    "LICENSE",
    "SOURCE.json",
    "lib/ninja-ui.html",
    "lib/native-session-ui.html",
    ...libraries.map((name) => `lib/${name}.mjs`),
    ...documents.map((name) => `docs/${name}.md`),
    ...trustFiles,
    ...starterFiles.map((name) => `examples/starter/${name}`),
    ...skillFiles.map((name) => `skills/daedlo/${name}`),
  ].sort();
  assert.deepEqual(
    result.files,
    expected,
    "The portable archive must contain the consumer CLI, contracts, and complete skill without maintainer files",
  );
  assert.deepEqual((await fs.readdir(f.output)).sort(), [
    "TOOLS_SHA256SUMS",
    "TOOLS_VERIFICATION.json",
    `daedlo-tools-${version}.tgz`,
  ]);
  const archive = await fs.readFile(result.archivePath);
  assert.equal(hash(archive), result.sha256);
  assert.equal(result.version, version);
  assert.equal(result.source.commit, f.git(["rev-parse", "HEAD"]));
  assert.equal(result.source.dirty, false);
  const tarFiles = execFileSync("tar", ["-tf", result.archivePath], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .map((name) => name.replace(/^package\//, ""))
    .sort();
  assert.deepEqual(tarFiles, expected);
  const readPacked = (name) =>
    execFileSync("tar", ["-xOf", result.archivePath, "package/" + name]);
  const pkg = JSON.parse(readPacked("package.json"));
  assert.equal(pkg.name, "@daedlo/release-tools");
  assert.equal(pkg.version, version);
  assert.equal(pkg.private, true);
  assert.deepEqual(pkg.bin, {
    "daedlo-release": "lib/consumer-cli.mjs",
    "browser-driver-release": "lib/consumer-cli.mjs",
    "ninja-update": "lib/ninja.mjs",
    "daedlo-native": "lib/native.mjs",
  });
  assert.deepEqual(pkg.daedloCompatibility, {
    nodeMajor: 22,
    rustVersion: "1.96",
  });
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.scripts, undefined);
  const source = JSON.parse(readPacked("SOURCE.json"));
  for (const entry of source.files) {
    const bytes = readPacked(entry.file);
    assert.equal(bytes.length, entry.bytes);
    assert.equal(hash(bytes), entry.sha256);
  }
  const verification = await fs.readFile(
    join(f.output, "TOOLS_VERIFICATION.json"),
  );
  assert.equal(verification.includes(f.directory), false);
  assert.equal(
    await fs.readFile(join(f.output, "TOOLS_SHA256SUMS"), "utf8"),
    `${result.sha256}  daedlo-tools-${version}.tgz\n${hash(verification)}  TOOLS_VERIFICATION.json\n`,
  );
  assert.equal(f.git(["status", "--porcelain"]), "");
});

test("archives reproduce byte for byte and ignored private files never ship", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(join(f.repoRoot, ".env"), "PRIVATE_TOOLS_SENTINEL");
  const first = await buildToolsArchive(f);
  const second = await buildToolsArchive({
    ...f,
    output: join(f.directory, "second"),
  });
  assert.equal(first.sha256, second.sha256);
  assert.deepEqual(
    await fs.readFile(first.archivePath),
    await fs.readFile(second.archivePath),
  );
  for (const name of ["TOOLS_VERIFICATION.json", "TOOLS_SHA256SUMS"])
    assert.deepEqual(
      await fs.readFile(join(first.output, name)),
      await fs.readFile(join(second.output, name)),
    );
});

test("dirty source requires explicit candidate permission and all skill additions are bound", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    join(f.repoRoot, "skills/daedlo/references/extra.md"),
    "Additional authored reference.\n",
  );
  await assert.rejects(buildToolsArchive(f), /clean|dirty/i);
  assert.equal(existsSync(f.output), false);
  const first = await buildToolsArchive({ ...f, allowDirty: true });
  assert.equal(first.source.dirty, true);
  assert.ok(first.files.includes("skills/daedlo/references/extra.md"));
  await fs.writeFile(
    join(f.repoRoot, "unrelated.txt"),
    "Different source identity, still excluded.\n",
  );
  const second = await buildToolsArchive({
    ...f,
    output: join(f.directory, "second"),
    allowDirty: true,
  });
  assert.notEqual(first.source.treeSha256, second.source.treeSha256);
  assert.equal(second.files.includes("unrelated.txt"), false);
});

test("missing consumer sources refuse before acquiring output", async (t) => {
  const f = await fixture(t);
  await fs.unlink(join(f.repoRoot, "scripts/release/commands.mjs"));
  await assert.rejects(
    buildToolsArchive({ ...f, allowDirty: true }),
    /required.*source.*missing/i,
  );
  assert.equal(existsSync(f.output), false);
});

test("existing output, symlinked roots and source links are preserved and refused", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(f.output);
  await fs.writeFile(join(f.output, "keep"), "existing owned elsewhere");
  await assert.rejects(buildToolsArchive(f), /exist/i);
  const outputLink = join(f.directory, "output-link");
  await fs.symlink(f.output, outputLink);
  await assert.rejects(
    buildToolsArchive({ ...f, output: outputLink }),
    /exist|symlink/i,
  );
  await assert.rejects(
    buildToolsArchive({ ...f, output: join(outputLink, "child") }),
    /symlink/i,
  );
  const rootLink = join(f.directory, "source-link");
  await fs.symlink(f.repoRoot, rootLink);
  await assert.rejects(
    buildToolsArchive({ ...f, repoRoot: rootLink }),
    /symlink/i,
  );
  await fs.symlink(
    join(f.output, "keep"),
    join(f.repoRoot, "scripts/release/outside.mjs"),
  );
  await assert.rejects(
    buildToolsArchive({
      ...f,
      output: join(f.directory, "new"),
      allowDirty: true,
    }),
    /symbolic|symlink/i,
  );
  assert.equal(
    await fs.readFile(join(f.output, "keep"), "utf8"),
    "existing owned elsewhere",
  );
});

test("changes during npm packing refuse the archive and clean only owned output", async (t) => {
  const f = await fixture(t);
  const bin = join(f.directory, "bin");
  await fs.mkdir(bin);
  const npmCli = realpathSync(join(dirname(process.execPath), "npm"));
  const target = join(f.repoRoot, "docs/update-client.md");
  await fs.writeFile(
    join(bin, "npm"),
    `#!${process.execPath}\nimport fs from 'node:fs';\nimport {spawnSync} from 'node:child_process';\nconst r=spawnSync(${JSON.stringify(process.execPath)},[${JSON.stringify(npmCli)},...process.argv.slice(2)],{stdio:'inherit'});\nfs.writeFileSync(${JSON.stringify(target)},'Changed during pack.\\n');\nprocess.exit(r.status ?? 1);\n`,
    { mode: 0o755 },
  );
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${process.platform === "win32" ? ";" : ":"}${previousPath}`;
  try {
    await assert.rejects(buildToolsArchive(f), /source.*changed/i);
  } finally {
    process.env.PATH = previousPath;
  }
  assert.equal(existsSync(f.output), false);
  assert.equal(await fs.readFile(target, "utf8"), "Changed during pack.\n");
});

test("the exact archive installs offline and runs real consumer commands outside Git without Rust", async (t) => {
  const f = await fixture(t);
  const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
  for (const path of [
    "LICENSE",
    "docs/update-client.md",
    "scripts/release/ninja-ui.html",
    "scripts/release/native-session-ui.html",
    ...starterFiles.map((name) => `examples/starter/${name}`),
    ...libraries.map((name) => `scripts/release/${name}.mjs`),
    ...documents.map((name) => `docs/${name}.md`),
    ...skillFiles.map((name) => `skills/daedlo/${name}`),
  ])
    await fs.copyFile(join(sourceRoot, path), join(f.repoRoot, path));
  f.git(["add", "."]);
  f.git([
    "-c",
    "user.name=Release test",
    "-c",
    "user.email=release@example.test",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-qm",
    "Real consumer modules",
  ]);
  const result = await buildToolsArchive(f);
  const consumer = join(f.directory, "independent-install");
  await fs.mkdir(consumer);
  const config = join(f.directory, "empty-npm.conf");
  const globalConfig = join(f.directory, "empty-global-npm.conf");
  await fs.writeFile(config, "");
  await fs.writeFile(globalConfig, "");
  execFileSync(
    "npm",
    [
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--cache",
      join(f.directory, "install-cache"),
      "--userconfig",
      config,
      "--globalconfig",
      globalConfig,
      result.archivePath,
    ],
    { cwd: consumer, stdio: "pipe", timeout: 60000 },
  );
  assert.notEqual(
    spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: consumer,
      stdio: "pipe",
    }).status,
    0,
    "The consumer must not be inside a Git checkout",
  );
  const installed = join(consumer, "node_modules/@daedlo/release-tools");
  const executable = join(installed, "lib/consumer-cli.mjs");
  for (const file of result.files) {
    const archived = execFileSync("tar", [
      "-xOf",
      result.archivePath,
      "package/" + file,
    ]);
    assert.deepEqual(
      await fs.readFile(join(installed, file)),
      archived,
      `Installed ${file} must match exact archive bytes`,
    );
  }
  const missingLinks = [];
  for (const file of result.files.filter((name) => name.endsWith(".md"))) {
    const content = await fs.readFile(join(installed, file), "utf8");
    // Shipped guides use simple inline Markdown links. Check their local files;
    // source-only material must be an explicit upstream reference instead.
    for (const [, target] of content.matchAll(/\]\(([^\s)]+)\)/g)) {
      if (/^(?:[a-z]+:|#)/i.test(target)) continue;
      const local = posix.normalize(
        posix.join(posix.dirname(file), target.split("#")[0]),
      );
      if (!result.files.includes(local))
        missingLinks.push(`${file} -> ${target}`);
    }
  }
  assert.deepEqual(
    missingLinks,
    [],
    "Installed onboarding references must resolve without a source checkout",
  );
  assert.deepEqual(
    (await fs.readdir(join(installed, "lib"))).sort(),
    [
      ...libraries.map((name) => `${name}.mjs`),
      "ninja-ui.html",
      "native-session-ui.html",
    ].sort(),
  );
  assert.deepEqual(
    Object.keys(
      JSON.parse(await fs.readFile(join(consumer, "package.json"), "utf8")),
    ).sort(),
    ["dependencies"],
  );
  const bin = join(f.directory, "empty-path");
  await fs.mkdir(bin);
  const env = { ...process.env, PATH: bin };
  const run = (args) =>
    execFileSync(process.execPath, [executable, ...args], {
      cwd: consumer,
      env,
      encoding: "utf8",
      timeout: 15000,
      stdio: "pipe",
    });
  const help = run(["--help"]);
  for (const command of [
    "check",
    "download",
    "verify",
    "update",
    "rollback",
    "status",
  ])
    assert.match(help, new RegExp(`^  ${command} `, "m"));
  assert.doesNotMatch(help, /^  (?:build|build-tools|version) /m);
  const store = join(consumer, "store-not-created");
  assert.equal(JSON.parse(run(["status", "--store", store])).current, null);
  assert.equal(
    existsSync(store),
    false,
    "Read-only status must not create a store",
  );
  for (const command of ["build", "build-tools", "version"]) {
    const rejected = spawnSync(process.execPath, [executable, command], {
      cwd: consumer,
      env,
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /unknown command/i);
    assert.doesNotMatch(
      rejected.stderr,
      /module_not_found|cannot find/i,
      "Maintainer commands must be refused before any absent module import",
    );
  }
  await fs.writeFile(
    join(bin, "gh"),
    `#!${process.execPath}\nprocess.stdout.write('[]');\n`,
    { mode: 0o755 },
  );
  const checked = JSON.parse(
    run([
      "check",
      "--repo",
      "example/browser-driver",
      "--current",
      version,
      "--channel",
      "preview",
    ]),
  );
  assert.equal(checked.status, "up_to_date");
  assert.equal(checked.compatibility, "not_checked");
  assert.equal(hash(await fs.readFile(result.archivePath)), result.sha256);
});

test("incomplete owned cleanup is reported with a recoverable path", async (t) => {
  const f = await fixture(t);
  const remove = fs.rm;
  fs.rm = async (target, options) => {
    if (String(target).includes("/daedlo-tools-"))
      throw Object.assign(Error("Cleanup unavailable"), { code: "EACCES" });
    return remove(target, options);
  };
  let failure;
  try {
    await assert.rejects(buildToolsArchive(f), (error) => {
      failure = error;
      return /cleanup.*incomplete/i.test(error.message);
    });
  } finally {
    fs.rm = remove;
  }
  assert.equal(failure.cleanupFailed, true);
  assert.equal(failure.retainedOwnedDirectories.length, 1);
  const retained = failure.retainedOwnedDirectories[0];
  t.after(() => remove(retained, { recursive: true, force: true }));
  assert.equal((await fs.lstat(retained)).isDirectory(), true);
  assert.equal(existsSync(join(retained, "package/SOURCE.json")), true);
  assert.equal(
    existsSync(join(f.output, `daedlo-tools-${version}.tgz`)),
    true,
    "Completed archive is retained when only staging cleanup fails",
  );
});
