import fs from "node:fs/promises";
import { constants } from "node:fs";
import { createPublicKey } from "node:crypto";
import { execFile } from "node:child_process";
import { dirname, isAbsolute, join, parse, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ninjaDirectory, ninjaRead } from "./ninja-manager.mjs";
import {
  validateRegistration,
  verifyInstallation,
} from "./ninja-installation.mjs";

import { frontendConfiguration } from "./native-session.mjs";

const execute = promisify(execFile);
const permissionError = (error) => {
  const seen = new Set();
  for (let depth = 0; error && depth < 8 && !seen.has(error); depth++) {
    if (["EPERM", "EACCES"].includes(error.code)) return true;
    seen.add(error);
    error = error.cause;
  }
  return false;
};
const validId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const inside = (a, b) => a === b || b.startsWith(a + sep);
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const version = (value) =>
  /^(\d+)\.(\d+)(?:\.(\d+))?$/
    .exec(value)
    ?.slice(1)
    .map((part) => Number(part || 0));
const atLeast = (actual, required) => {
  const a = version(actual),
    b = version(required);
  if (!a || !b) return false;
  const difference = a.findIndex((part, index) => part !== b[index]);
  return difference < 0 || a[difference] > b[difference];
};

// Check each existing ancestor, without creating directories or following links.
async function directoryProbe(path) {
  let current = parse(path).root;
  for (const part of path.slice(current.length).split(sep).filter(Boolean)) {
    const next = join(current, part);
    let stat;
    try {
      stat = await fs.lstat(next);
    } catch (error) {
      if (error.code === "ENOENT") return { exists: false, parent: current };
      throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw Error("Unsafe directory");
    current = next;
  }
  return { exists: true, parent: current };
}
async function readPem(path) {
  await ninjaDirectory(dirname(path));
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 16384)
      throw Error("Invalid public key file");
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}
async function requirements() {
  const here = dirname(fileURLToPath(import.meta.url));
  // Portable tools carry values generated from the owning source manifests.
  try {
    const pkg = await ninjaRead(join(here, "../package.json"));
    const requirement = pkg.daedloCompatibility;
    if (
      Number.isSafeInteger(requirement?.nodeMajor) &&
      requirement.nodeMajor >= 22 &&
      version(requirement.rustVersion)
    )
      return requirement;
    throw Error("Missing tools compatibility metadata");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const root = resolve(here, "../..");
  const pkg = await ninjaRead(join(root, "packages/runtime/package.json"));
  const cargo = await fs.readFile(join(root, "Cargo.toml"), "utf8");
  const nodeMajor = Number(/^>=(\d+)$/.exec(pkg.engines?.node)?.[1]);
  const rustVersion = /^rust-version\s*=\s*"([0-9.]+)"\s*$/m.exec(cargo)?.[1];
  if (
    !Number.isSafeInteger(nodeMajor) ||
    nodeMajor < 22 ||
    !version(rustVersion)
  )
    throw Error("Missing source compatibility requirements");
  return { nodeMajor, rustVersion };
}
function commandEnvironment() {
  const env = {};
  for (const key of [
    "PATH",
    "HOME",
    "USERPROFILE",
    "SYSTEMROOT",
    "SystemRoot",
    "TMPDIR",
    "TEMP",
    "TMP",
    "RUSTUP_HOME",
    "CARGO_HOME",
  ])
    if (process.env[key]) env[key] = process.env[key];
  return {
    ...env,
    LANG: "C",
    LC_ALL: "C",
    RUSTUP_AUTO_INSTALL: "0",
    CARGO_NET_OFFLINE: "true",
    npm_config_update_notifier: "false",
    npm_config_logs_max: "0",
    npm_config_ignore_scripts: "true",
  };
}

/** Read-only static preflight. No customer evaluation, network, installation or browser launch. */
export async function nativeDoctor(configPath, { runCommand = execute } = {}) {
  const checks = [];
  const add = (id, status, category, message, remedy) =>
    checks.push({
      id,
      status,
      category,
      message,
      ...(remedy ? { remedy } : {}),
    });
  const finish = () => ({
    schemaVersion: 1,
    scope: "read-only-preflight",
    ok: checks.every((check) => check.status === "pass"),
    checks,
    notVerified: [
      "Browser launch, loopback listening and sandbox permission in the actual launch context.",
      "Application fixture readiness, authentication and QA outcomes.",
      "Network access, publisher feed availability and completeness of dependency caches.",
    ],
  });
  let config, storeProbe, installationProbe;
  try {
    configPath = resolve(configPath);
    await ninjaDirectory(dirname(configPath));
    config = await ninjaRead(configPath);
    if (
      !object(config) ||
      config.schemaVersion !== 1 ||
      !isAbsolute(config.store ?? "") ||
      !isAbsolute(config.registration?.sourceRoot ?? "") ||
      !object(config.catalog)
    )
      throw Error("Invalid config");
    frontendConfiguration(config.frontend);
    const source = resolve(config.registration.sourceRoot),
      store = resolve(config.store);
    if (inside(source, store) || inside(store, source))
      throw Error("Overlapping directories");
    if (
      !["stable", "preview"].includes(config.catalog.channel) ||
      typeof config.catalog.publisher !== "string" ||
      !config.catalog.publisher.trim() ||
      config.catalog.publisher.length > 128
    )
      throw Error("Invalid catalog settings");
    const url = new URL(config.catalog.url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      /%|\\/.test(url.pathname)
    )
      throw Error("Invalid feed URL");
    const installation = config.installation ?? {};
    if (
      !object(installation) ||
      Object.keys(installation).some(
        (key) => !["offline", "npmCache", "cargoHome"].includes(key),
      ) ||
      (installation.offline !== undefined &&
        typeof installation.offline !== "boolean") ||
      ["npmCache", "cargoHome"].some(
        (key) =>
          installation[key] !== undefined &&
          (typeof installation[key] !== "string" ||
            !isAbsolute(installation[key])),
      )
    )
      throw Error("Invalid installation settings");
    storeProbe = await directoryProbe(store);
    installationProbe = await directoryProbe(join(store, "installations"));
    add(
      "configuration",
      "pass",
      "configuration",
      "Schema, feed URL and disjoint source/store paths are valid.",
    );
  } catch (error) {
    add(
      "configuration",
      "blocked",
      permissionError(error) ? "permission" : "configuration",
      "The local native configuration cannot be safely read or validated.",
      "Use a readable schema-1 Ninja config, credential-free HTTPS feed, explicit channel and separate disjoint source/store directories without symlinks; review file permissions if access is denied.",
    );
    return finish();
  }
  try {
    await validateRegistration(config.registration);
    add(
      "registration",
      "pass",
      "configuration",
      "Registered source, manifests and managed launcher parse without executing customer code.",
    );
  } catch (error) {
    add(
      "registration",
      "blocked",
      permissionError(error) ? "permission" : "application",
      "The authored integration does not satisfy the managed registration preflight.",
      "Review the allowlisted files, standalone manifests/locks and injected-runtime launcher against docs/ninja-update.md. Keep the accepted integration intact while repairing a separate candidate.",
    );
  }
  try {
    const keys = config.catalog.trustedKeys;
    if (!Array.isArray(keys) || !keys.length || keys.length > 32)
      throw Error("Missing trust keys");
    const ids = new Set();
    for (const key of keys) {
      if (
        !object(key) ||
        typeof key.id !== "string" ||
        !key.id ||
        key.id.length > 64 ||
        ids.has(key.id) ||
        typeof key.publicKeyFile !== "string" ||
        !key.publicKeyFile
      )
        throw Error("Invalid trust key");
      ids.add(key.id);
      const publicKey = createPublicKey(
        await readPem(resolve(dirname(configPath), key.publicKeyFile)),
      );
      if (publicKey.asymmetricKeyType !== "ed25519")
        throw Error("Invalid signing algorithm");
    }
    add(
      "publisher-trust",
      "pass",
      "configuration",
      "Unique pinned Ed25519 public keys are readable; the remote feed has not been contacted.",
    );
  } catch (error) {
    add(
      "publisher-trust",
      "blocked",
      permissionError(error) ? "permission" : "configuration",
      "Pinned publisher trust is missing, unreadable or incompatible.",
      "Supply independently verified, unique key IDs and readable Ed25519 public PEM files. Do not replace a trusted key from an unverified download.",
    );
  }
  let required;
  try {
    required = await requirements();
    add(
      "requirements",
      "pass",
      "configuration",
      `Owning manifests require Node >=${required.nodeMajor} and Rust/Cargo >=${required.rustVersion}.`,
    );
  } catch (error) {
    add(
      "requirements",
      "blocked",
      permissionError(error) ? "permission" : "configuration",
      "The tools' dependency requirements cannot be established.",
      "Use a complete verified tools package with daedloCompatibility metadata or the complete source checkout.",
    );
  }
  if (required) {
    const env = commandEnvironment();
    const cwd = config.registration.sourceRoot;
    for (const probe of [
      {
        id: "node",
        program: process.execPath,
        pattern: /^v(\d+\.\d+\.\d+)\s*$/,
        minimum: `${required.nodeMajor}.0.0`,
      },
      {
        id: "npm",
        program: "npm",
        pattern: /^(\d+\.\d+\.\d+)\s*$/,
        minimum: "1.0.0",
      },
      {
        id: "rustc",
        program: "rustc",
        pattern: /^rustc (\d+\.\d+\.\d+)(?:\s|$)/,
        minimum: required.rustVersion,
      },
      {
        id: "cargo",
        program: "cargo",
        pattern: /^cargo (\d+\.\d+\.\d+)(?:\s|$)/,
        minimum: required.rustVersion,
      },
      {
        id: "python3",
        program: "python3",
        pattern: /^Python (\d+\.\d+\.\d+)\s*$/,
        minimum: "3.0.0",
      },
    ]) {
      try {
        const result = await runCommand(probe.program, ["--version"], {
          // The installer invokes rustc from installations/ and Cargo from a
          // fresh child slot, not from the original authored package. Its
          // safe environment also omits ambient RUSTUP_TOOLCHAIN overrides.
          // Use their nearest existing ancestor without creating either path.
          cwd: ["rustc", "cargo"].includes(probe.id)
            ? installationProbe.parent
            : cwd,
          env:
            probe.id === "cargo" && config.installation?.cargoHome
              ? { ...env, CARGO_HOME: config.installation.cargoHome }
              : env,
          encoding: "utf8",
          shell: false,
          timeout: 10000,
          maxBuffer: 65536,
        });
        const observed = probe.pattern.exec(
          result.stdout || result.stderr || "",
        )?.[1];
        if (!observed || !atLeast(observed, probe.minimum))
          throw Error("Unsupported tool version");
        add(
          probe.id,
          "pass",
          "dependency",
          `${probe.id} ${observed} satisfies the native requirement.`,
        );
      } catch (error) {
        const denied = permissionError(error);
        add(
          probe.id,
          "blocked",
          denied ? "permission" : "dependency",
          denied
            ? `${probe.id} version probing was denied by the current execution context.`
            : `${probe.id} is absent, unsupported or could not complete its bounded version probe.`,
          denied
            ? "Use the host's normal scoped permission or environment-action flow for this command; do not disable sandboxing globally."
            : `Install or select ${probe.id} >=${probe.minimum} on PATH (Node uses this process's executable). Preinstall the project Rust toolchain explicitly; doctor does not download it.`,
        );
      }
    }
  }
  try {
    await fs.access(
      storeProbe.parent,
      constants.R_OK | constants.W_OK | constants.X_OK,
    );
    add(
      "store-access",
      "pass",
      "permission",
      "The existing store or nearest parent reports writable/searchable access; no write was attempted.",
    );
  } catch {
    add(
      "store-access",
      "blocked",
      "permission",
      "The managed store's existing parent is not accessible for local setup.",
      "Choose a project-scoped writable store or grant scoped filesystem permission. Browser/network permissions still require separate runtime evidence.",
    );
  }
  for (const [key, id] of [
    ["npmCache", "npm-cache"],
    ["cargoHome", "cargo-home"],
  ]) {
    const path = config.installation?.[key];
    if (!path) continue;
    try {
      const probe = await directoryProbe(path);
      if (!probe.exists && config.installation?.offline !== false) {
        add(
          id,
          "blocked",
          "dependency",
          "The explicitly configured offline dependency cache does not exist.",
          "Populate this separate cache during an explicitly online setup, or configure an existing cache. Doctor does not create or download dependencies.",
        );
        continue;
      }
      await fs.access(
        probe.parent,
        constants.R_OK | constants.W_OK | constants.X_OK,
      );
      add(
        id,
        "pass",
        "permission",
        "Configured cache path is accessible; cached dependency completeness remains unchecked.",
      );
    } catch (error) {
      add(
        id,
        "blocked",
        permissionError(error) ? "permission" : "configuration",
        "The configured dependency cache is inaccessible or unsafe.",
        "Use an absolute cache directory with readable/writable access and no symlinks. Preserve caches needed by accepted installations.",
      );
    }
  }
  if (storeProbe.exists) {
    try {
      const owner = await ninjaRead(join(config.store, ".ninja-project.json"), {
        optional: true,
      });
      if (!owner) {
        if ((await fs.readdir(config.store)).length)
          throw Error("Unowned nonempty store");
        add(
          "store",
          "pass",
          "configuration",
          "The empty store is available for explicit first setup.",
        );
      } else {
        if (
          owner.schemaVersion !== 1 ||
          owner.kind !== "ninja-project-store" ||
          owner.projectId !== config.registration.projectId
        )
          throw Error("Ownership mismatch");
        add(
          "store",
          "pass",
          "configuration",
          "Existing managed store ownership matches the registered project.",
        );
        const state = await ninjaRead(join(config.store, "state.json"), {
          optional: true,
        });
        if (
          state &&
          (state.schemaVersion !== 1 ||
            state.projectId !== config.registration.projectId ||
            !Number.isSafeInteger(state.generation))
        )
          throw Error("Invalid managed state");
        if (state?.current) {
          if (!validId(state.current))
            throw Error("Invalid selected installation ID");
          try {
            const receipt = await verifyInstallation(
              join(config.store, "installations", state.current),
              {
                registration: config.registration,
                checkSource: !state.historicalSnapshot,
              },
            );
            add(
              "installation",
              "pass",
              "configuration",
              `Selected installation ${receipt.version} and retained browser executable match their recorded bytes${state.historicalSnapshot ? "; historical rollback snapshot is selected" : ""}. No browser was launched.`,
            );
          } catch (error) {
            add(
              "installation",
              "blocked",
              permissionError(error) ? "permission" : "recovery",
              "The selected installation, authored source or retained browser identity no longer verifies.",
              "Retain the installation and browser cache; inspect its receipts. Prepare and validate an explicit replacement or use a verified complete rollback. Do not rebuild accepted slots in place.",
            );
          }
        } else
          add(
            "installation",
            "pass",
            "configuration",
            "No installation is selected; explicit setup and isolated acceptance are still required.",
          );
        await directoryProbe(join(config.store, "supervisor"));
        const lock = await ninjaRead(join(config.store, "operation.lock"), {
          optional: true,
        });
        const transaction = await ninjaRead(
          join(config.store, "transaction.json"),
          { optional: true },
        );
        const child = await ninjaRead(
          join(config.store, "supervisor", "child.json"),
          { optional: true },
        );
        if (
          lock ||
          (transaction &&
            !["committed", "recovered"].includes(transaction.phase)) ||
          (child && child.status !== "closed")
        ) {
          add(
            "recovery",
            "blocked",
            "recovery",
            "An operation, transaction or managed child still has retained ownership; it may be live.",
            "Use native status to contact the recorded owner, then its safe stop/recovery path. Do not infer cleanup from a PID or remove ownership records automatically.",
          );
        } else
          add(
            "recovery",
            "pass",
            "recovery",
            "No unfinished managed ownership record was found.",
          );
      }
    } catch (error) {
      add(
        checks.some((check) => check.id === "store" && check.status === "pass")
          ? "managed-state"
          : "store",
        "blocked",
        permissionError(error) ? "permission" : "recovery",
        "Existing store ownership or managed state cannot be safely verified.",
        "Inspect the existing owner and recovery records without deleting them; use a separate empty store for another project.",
      );
    }
  } else {
    add(
      "store",
      "pass",
      "configuration",
      "Store is absent and was left untouched; explicit setup will initialize it.",
    );
    add(
      "installation",
      "pass",
      "configuration",
      "No installation is selected; explicit setup and isolated acceptance are still required.",
    );
  }
  return finish();
}
