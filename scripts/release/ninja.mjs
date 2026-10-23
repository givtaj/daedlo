#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve, dirname, join, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchNinjaCatalog,
  selectNinjaRelease,
  downloadNinjaKit,
} from "./ninja-catalog.mjs";
import {
  prepareInstallation,
  verifyInstallation,
  validateRegistration,
} from "./ninja-installation.mjs";
import {
  createNinjaManager,
  ninjaRead,
  ninjaDirectory,
} from "./ninja-manager.mjs";
import { createNinjaSupervisor } from "./ninja-supervisor.mjs";
import { createNinjaServer } from "./ninja-server.mjs";

import { frontendConfiguration, frontendIdentity } from "./native-session.mjs";

export const NINJA_CONTRACTS = Object.freeze({
  manager: 1,
  launcher: 1,
  nodeAdapter: 1,
  rustModel: 1,
  protocol: 1,
  capabilities: ["recipeContext:1"],
});
export function createNinjaProvider(
  config,
  { fetchImpl = fetch, now = () => Date.now() } = {},
) {
  let verified = null;
  return {
    async check({ previousState, currentVersion }) {
      verified = null;
      verified = await fetchNinjaCatalog({
        url: config.url,
        publisher: config.publisher,
        trustedKeys: config.trustedKeys,
        previousState,
        now: now(),
        fetchImpl,
      });
      if (verified.status === "unconfigured") {
        verified = null;
        return {
          status: "unconfigured",
          checkpoint: previousState,
          available: null,
          error: {
            code: "unconfigured",
            message:
              "Publisher feed is unconfigured; set an authenticated catalog and trust key.",
          },
        };
      }
      const result = selectNinjaRelease(verified, {
        channel: config.channel,
        platform: { os: process.platform, arch: process.arch },
        currentVersion: currentVersion || "0.0.0",
        contracts: NINJA_CONTRACTS,
      });
      if (result.status === "incompatible")
        return {
          checkpoint: verified.checkpoint,
          available: null,
          error: {
            code: "migration_required",
            message:
              "Available release requires a different managed interface.",
          },
        };
      return {
        checkpoint: verified.checkpoint,
        available: result.release
          ? { ...result.release, id: result.release.version }
          : null,
      };
    },
    async download(release, output) {
      if (!verified)
        throw Error(
          "Check the authenticated catalog again before installation.",
        );
      if (new Date(verified.catalog.expiresAt).getTime() <= now())
        throw Error("Catalog expired; check again before installation.");
      return downloadNinjaKit({
        verified,
        version: release.version,
        output,
        allowedOrigin: new URL(config.url).origin,
        fetchImpl,
        now: now(),
      });
    },
  };
}

/** Local bootstrap config is trusted code/configuration, never accepted from the viewer. */
export async function readNinjaConfig(
  configPath,
  { validateSource = true } = {},
) {
  configPath = resolve(configPath);
  await ninjaDirectory(dirname(configPath));
  const config = await ninjaRead(configPath);
  if (
    config.schemaVersion !== 1 ||
    !isAbsolute(config.store) ||
    !isAbsolute(config.registration?.sourceRoot) ||
    !Array.isArray(config.catalog?.trustedKeys) ||
    !config.catalog.trustedKeys.length
  )
    throw Error(
      "Ninja bootstrap needs schema 1, absolute store/source paths and configured publisher trust keys.",
    );
  frontendConfiguration(config.frontend);
  const source = resolve(config.registration.sourceRoot),
    store = resolve(config.store);
  if (
    source === store ||
    source.startsWith(store + sep) ||
    store.startsWith(source + sep)
  )
    throw Error(
      "Managed store and authored project must be separate, disjoint directories.",
    );
  if (!["stable", "preview"].includes(config.catalog.channel))
    throw Error("Choose the stable or preview update channel explicitly.");
  if (validateSource) await validateRegistration(config.registration);
  const keys = await Promise.all(
    config.catalog.trustedKeys.map(async (k) => {
      if (typeof k.publicKeyFile !== "string" || !k.id)
        throw Error(
          "Each trusted publisher key needs an ID and local PEM file.",
        );
      return {
        id: k.id,
        publicKey: await readFile(
          resolve(dirname(configPath), k.publicKeyFile),
          "utf8",
        ),
      };
    }),
  );
  const installation = config.installation || {};
  if (
    Object.keys(installation).some(
      (k) => !["offline", "npmCache", "cargoHome"].includes(k),
    ) ||
    (installation.offline !== undefined &&
      typeof installation.offline !== "boolean") ||
    ["npmCache", "cargoHome"].some(
      (k) => installation[k] !== undefined && !isAbsolute(installation[k]),
    )
  )
    throw Error(
      "Installation settings accept explicit offline mode and absolute cache paths only.",
    );
  return { config, keys, installation };
}

export async function openNinja(configPath, { recover = true } = {}) {
  const { config, keys, installation } = await readNinjaConfig(configPath);
  const supervisor = await createNinjaSupervisor({
    root: join(config.store, "supervisor"),
    settings: config.settings || {},
    frontend: frontendIdentity(config),
  });
  const manager = await createNinjaManager({
    recover,
    root: config.store,
    registration: config.registration,
    provider: createNinjaProvider({ ...config.catalog, trustedKeys: keys }),
    installer: {
      prepare: (args) => prepareInstallation({ ...args, ...installation }),
      verify: verifyInstallation,
    },
    supervisor,
  });
  return { manager, supervisor };
}
export async function runNinjaCli(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(
      "Operation Ninja-Update\n  ninja serve --config /absolute/local-config.json\n  ninja status --config /absolute/local-config.json\n\nThe one-time local registration pins a project, trusted publisher keys, isolated checks,\nand a managed launcher. Serve opens the local authenticated update screen. No feed\nor publisher key is enabled by default. Existing archive update/rollback commands\nretain their original meaning. Project data is outside updater ownership.\n",
    );
    return;
  }
  if (
    args.length !== 3 ||
    !["serve", "status"].includes(args[0]) ||
    args[1] !== "--config"
  )
    throw Error("Usage: ninja serve|status --config FILE");
  const { manager } = await openNinja(args[2]);
  if (args[0] === "status") {
    process.stdout.write(
      JSON.stringify(await manager.status(), null, 2) + "\n",
    );
    return;
  }
  if ((await manager.status()).selected) await manager.start();
  const server = await createNinjaServer({
    manager,
    host: "127.0.0.1",
    port: 0,
  });
  process.stdout.write(`Ninja-Update: ${server.url}\n`);
  let closing = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      if (closing) return;
      closing = true;
      try {
        await manager.close();
        await server.close();
      } catch (e) {
        process.stderr.write(`Shutdown deferred: ${e.message}\n`);
        closing = false;
      }
    });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  runNinjaCli().catch((e) => {
    process.stderr.write(e.message + "\n");
    process.exitCode = 1;
  });
