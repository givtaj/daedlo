import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { verifyBundle } from "./manifest.mjs";
import { updateRelease, rollbackRelease, releaseStatus } from "./store.mjs";
import { checkForUpdates, downloadRelease } from "./remote.mjs";

const usage = `Daedlo release tools (no publication or customer edits)
  check --repo OWNER/REPO --current VERSION [--channel stable|preview]
  download --repo OWNER/REPO --version VERSION --out DIR --sha256 DIGEST
  verify --bundle DIR [--sha256 DIGEST]
  update --store DIR --bundle DIR --sha256 DIGEST [--allow-dirty]
  rollback --store DIR [--allow-dirty]
  status --store DIR

The store selects exact archives for an opt-in consumer. It does not modify Roots,
install dependencies, run package scripts, migrate data, or restart services.
Get --sha256 from the selected trusted CI/release receipt; checksums alone are not
authentication. Dirty bundles require explicit local-development approval.
check reads release metadata. download stages exact archives without selecting them.
Protocol/toolchain verification is not customer-flow acceptance. Test candidates in
an isolated copy before explicitly changing a customer pin. No automatic updates.
`;
const commands = {
  check: { required: ["repo", "current"], optional: ["channel"] },
  download: { required: ["repo", "version", "out", "sha256"], optional: [] },
  "build-tools": { required: ["out"], optional: ["allow-dirty"] },
  version: { required: ["next"], optional: [] },
  build: { required: ["out"], optional: ["allow-dirty"] },
  verify: { required: ["bundle"], optional: ["sha256"] },
  update: {
    required: ["store", "bundle", "sha256"],
    optional: ["allow-dirty"],
  },
  rollback: { required: ["store"], optional: ["allow-dirty"] },
  status: { required: ["store"], optional: [] },
};
function parse(args, maintainer) {
  const [command, ...tail] = args,
    definition = commands[command];
  if (
    !definition ||
    (!maintainer && ["version", "build", "build-tools"].includes(command))
  )
    throw Error("Unknown command. Usage: daedlo-release --help");
  const options = {};
  for (let i = 0; i < tail.length; i++) {
    const name = tail[i].slice(2);
    if (
      !tail[i].startsWith("--") ||
      ![...definition.required, ...definition.optional].includes(name)
    )
      throw Error(`Unknown flag: ${tail[i]}`);
    if (name in options) throw Error(`Duplicate flag: --${name}`);
    if (name === "allow-dirty") options[name] = true;
    else {
      if (!tail[i + 1] || tail[i + 1].startsWith("--"))
        throw Error(`Missing value for --${name}`);
      options[name] = tail[++i];
    }
  }
  for (const name of definition.required)
    if (!options[name]) throw Error(`Missing --${name}`);
  return { command, options };
}
function localEnvironment() {
  let version;
  try {
    version = execFileSync("rustc", ["--version"], {
      encoding: "utf8",
      timeout: 10000,
      stdio: ["ignore", "pipe", "pipe"],
    }).match(/^rustc (\S+)/)?.[1];
  } catch {
    throw Error("Rust compiler unavailable; compatibility was not verified");
  }
  if (!version) throw Error("Rust compiler version could not be determined");
  return {
    nodeVersion: process.versions.node,
    rustVersion: version,
    protocol: 1,
  };
}

export async function runReleaseCli(
  args = process.argv.slice(2),
  { repoRoot = null } = {},
) {
  try {
    if (args.length === 1 && args[0] === "--help") {
      process.stdout.write(usage);
      if (repoRoot)
        process.stdout.write(
          "\nMaintainer commands:\n  version --next VERSION\n  build --out DIR [--allow-dirty]\n  build-tools --out DIR [--allow-dirty]\n",
        );
      return;
    }
    const { command, options } = parse(args, repoRoot !== null);
    let result;
    if (command === "version") {
      const { setReleaseVersion } = await import("./version.mjs");
      result = await setReleaseVersion({ repoRoot, version: options.next });
    } else if (command === "build" || command === "build-tools") {
      const builder =
        command === "build"
          ? (await import("./build.mjs")).buildBundle
          : (await import("./tools.mjs")).buildToolsArchive;
      result = await builder({
        repoRoot,
        output: resolve(options.out),
        allowDirty: options["allow-dirty"] === true,
      });
    } else if (command === "check") {
      result = await checkForUpdates({
        repo: options.repo,
        currentVersion: options.current,
        channel: options.channel,
      });
    } else if (command === "download") {
      result = await downloadRelease({
        repo: options.repo,
        version: options.version,
        output: options.out,
        expectedManifestSha256: options.sha256,
      });
    } else if (command === "status") {
      result = await releaseStatus({ store: options.store });
    } else {
      const environment = localEnvironment();
      if (command === "verify")
        result = {
          ...(await verifyBundle(resolve(options.bundle), {
            expectedManifestSha256: options.sha256,
            environment,
          })),
          trustedDigestProvided: options.sha256 !== undefined,
        };
      else if (command === "update")
        result = await updateRelease({
          store: options.store,
          bundle: options.bundle,
          expectedManifestSha256: options.sha256,
          environment,
          allowDirty: options["allow-dirty"] === true,
        });
      else
        result = await rollbackRelease({
          store: options.store,
          environment,
          allowDirty: options["allow-dirty"] === true,
        });
    }
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (error) {
    process.stderr.write((error?.message || "Release operation failed") + "\n");
    if (
      error?.rollbackFailed ||
      error?.cleanupFailed ||
      error?.retainedPaths ||
      error?.retainedOwnedDirectories
    ) {
      process.stderr.write(
        JSON.stringify(
          {
            rollbackFailed: error.rollbackFailed,
            cleanupFailed: error.cleanupFailed,
            retainedPaths: error.retainedPaths,
            retainedOwnedDirectories: error.retainedOwnedDirectories,
          },
          null,
          2,
        ) + "\n",
      );
    }
    process.exitCode = 1;
  }
}
