// Prepare the original Roots QA driver from an immutable committed snapshot.
// This never edits the source checkout or consumes its application binaries.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const source = resolve(
  process.env.ROOTS_SOURCE ??
    fileURLToPath(new URL("../../../roots", import.meta.url)),
);
const output = resolve(
  process.env.ROOTS_EXPERIENCE_ARTIFACTS ?? "artifacts/roots-experience",
);
const commit =
  process.env.ROOTS_EXPERIENCE_COMMIT ??
  "dd9cee67e3886333a7fe8eb7f8545d428167fb07";
const buildTarget = resolve(
  process.env.ROOTS_EXPERIENCE_TARGET ?? join(output, "build-target"),
);
const target = join(output, "target");
const snapshot = join(output, "snapshot");
const git = (args) => execFileSync("git", ["-C", source, ...args]);
const hash = (data) => createHash("sha256").update(data).digest("hex");
if (fs.existsSync(snapshot))
  throw Error(
    "Select a fresh artifacts directory; the source snapshot already exists.",
  );
if (
  git(["rev-parse", commit + "^{commit}"])
    .toString()
    .trim() !== commit
)
  throw Error("An explicit full source commit is required.");
const dependencies = [
  { snapshot: "apps/web", live: "apps/web" },
  { snapshot: "tools/live-qa", live: "tools/browser-driver/runtime" },
];
for (const dependency of dependencies) {
  const lock = git([
    "show",
    `${commit}:${dependency.snapshot}/package-lock.json`,
  ]);
  if (
    !lock.equals(
      fs.readFileSync(join(source, dependency.live, "package-lock.json")),
    )
  )
    throw Error(`Dependency lock differs: ${dependency.snapshot}`);
  if (!fs.existsSync(join(source, dependency.live, "node_modules")))
    throw Error(`Installed dependencies unavailable: ${dependency.live}`);
}
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(join(output, ".gitignore"), "*\n!.gitignore\n");
fs.writeFileSync(
  join(output, "live-before.json"),
  JSON.stringify(
    {
      head: git(["rev-parse", "HEAD"]).toString().trim(),
      status: git([
        "status",
        "--porcelain",
        "--untracked-files=all",
      ]).toString(),
    },
    null,
    2,
  ),
);
const archive = join(output, "source.tar");
git(["archive", "--format=tar", "--output", archive, commit]);
fs.mkdirSync(snapshot);
execFileSync("tar", ["-xf", archive, "-C", snapshot]);
// Keep original commit identity so the maintained fixture can perform its own
// clean-HEAD archive. This Git repository is newly created, isolated and owned.
execFileSync("git", ["init", "-q", snapshot]);
execFileSync("git", [
  "-C",
  snapshot,
  "fetch",
  "--quiet",
  "--no-tags",
  "--depth=1",
  source,
  commit,
]);
execFileSync("git", ["-C", snapshot, "reset", "--mixed", "--quiet", commit]);
fs.writeFileSync(
  join(snapshot, "roots-starter.json"),
  git(["show", `${commit}:roots-starter.json`]),
);
for (const dependency of dependencies)
  fs.cpSync(
    join(source, dependency.live, "node_modules"),
    join(snapshot, dependency.snapshot, "node_modules"),
    { recursive: true, dereference: true },
  );
fs.mkdirSync(buildTarget, { recursive: true });
const record = {
  applicationCommit: commit,
  driverSourceCommit: commit,
  snapshot,
  sourceCheckout: source,
  buildTarget,
  target,
  archiveSha256: hash(fs.readFileSync(archive)),
  createdAt: new Date().toISOString(),
  dependencyLocks: dependencies.map((d) => ({
    path: d.snapshot + "/package-lock.json",
    sha256: hash(git(["show", `${commit}:${d.snapshot}/package-lock.json`])),
  })),
  buildStatus: "building",
};
fs.writeFileSync(join(output, "source.json"), JSON.stringify(record, null, 2));
execFileSync(
  "cargo",
  [
    "build",
    "--locked",
    "--offline",
    "--manifest-path",
    join(snapshot, "Cargo.toml"),
    "-p",
    "roots-cli",
    "-p",
    "roots-api",
    "-p",
    "roots-qa-driver",
    "--features",
    "db-tools",
    "--bin",
    "roots-cli",
    "--bin",
    "roots-api",
    "--bin",
    "db",
    "--bin",
    "roots-qa-driver",
  ],
  {
    cwd: snapshot,
    env: { ...process.env, CARGO_TARGET_DIR: buildTarget },
    stdio: "inherit",
  },
);
fs.mkdirSync(join(target, "debug"), { recursive: true });
for (const name of ["roots-cli", "roots-api", "db", "roots-qa-driver"])
  fs.copyFileSync(
    join(buildTarget, "debug", name),
    join(target, "debug", name),
  );
fs.symlinkSync(target, join(snapshot, "target"), "dir");
record.buildStatus = "built";
record.builtAt = new Date().toISOString();
record.binaries = Object.fromEntries(
  ["roots-cli", "roots-api", "db", "roots-qa-driver"].map((name) => [
    name,
    hash(fs.readFileSync(join(target, "debug", name))),
  ]),
);
fs.writeFileSync(join(output, "source.json"), JSON.stringify(record, null, 2));
process.stdout.write(
  JSON.stringify({
    status: "built",
    snapshot,
    applicationCommit: commit,
    driverSourceCommit: commit,
  }) + "\n",
);
