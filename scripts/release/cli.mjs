#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { buildBundle } from "./build.mjs";
import { verifyBundle } from "./manifest.mjs";
import { setReleaseVersion } from "./version.mjs";
import { updateRelease, rollbackRelease, releaseStatus } from "./store.mjs";

const usage = `Browser-driver release preparation (no publication or customer edits)
  version --next VERSION
  build --out DIR [--allow-dirty]
  verify --bundle DIR [--sha256 DIGEST]
  update --store DIR --bundle DIR --sha256 DIGEST [--allow-dirty]
  rollback --store DIR [--allow-dirty]
  status --store DIR

The store selects exact archives for an opt-in consumer. It does not modify Roots,
install dependencies, run package scripts, migrate data, or restart services.
Get --sha256 from the selected trusted CI/release receipt; checksums alone are not
authentication. Dirty bundles require explicit local-development approval.
`;
const commands = {
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
function parse(args) {
  const [command, ...tail] = args,
    definition = commands[command];
  if (!definition)
    throw Error("Unknown command. Usage: node scripts/release/cli.mjs --help");
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

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") process.stdout.write(usage);
  else {
    const { command, options } = parse(args);
    const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
    let result;
    if (command === "version")
      result = await setReleaseVersion({ repoRoot, version: options.next });
    else if (command === "build")
      result = await buildBundle({
        repoRoot,
        output: resolve(options.out),
        allowDirty: options["allow-dirty"] === true,
      });
    else if (command === "status")
      result = await releaseStatus({ store: options.store });
    else {
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
  }
} catch (error) {
  process.stderr.write((error?.message || "Release operation failed") + "\n");
  if (error?.rollbackFailed || error?.cleanupFailed) {
    process.stderr.write(
      JSON.stringify(
        {
          rollbackFailed: error.rollbackFailed,
          cleanupFailed: error.cleanupFailed,
        },
        null,
        2,
      ) + "\n",
    );
  }
  process.exitCode = 1;
}
