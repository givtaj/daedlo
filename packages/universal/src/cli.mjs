#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captureTargetRegistration } from "./registration.mjs";
import { loadTools } from "./tools.mjs";

const help = `Daedlo Universal (optional installation)
  daedlo-universal register --config FILE --id ID --name NAME --environment ENV --auth-profile REF
  daedlo-universal revise --workspace ROOT --target ID --revision NUMBER
  daedlo-universal upgrade --workspace ROOT [--catalog-version NUMBER]
  daedlo-universal compress --workspace ROOT --target ID --run RUN_ID [--replace]
  daedlo-universal journal-recovery --workspace ROOT --target ID
  daedlo-universal recover-journal --workspace ROOT --target ID --receipt RECEIPT
  daedlo-universal backup --workspace ROOT --output NEW_BACKUP
  daedlo-universal verify-backup --backup BACKUP
  daedlo-universal backup-recovery --backup INCOMPLETE_BACKUP
  daedlo-universal recover-backup --backup INCOMPLETE_BACKUP --receipt RECEIPT
  daedlo-universal restore --backup BACKUP --workspace NEW_ROOT [--catalog-version NUMBER]
  daedlo-universal rollback --workspace CURRENT_ROOT --backup BACKUP --output NEW_ROOT --preserve NEW_CURRENT_BACKUP --catalog-version NUMBER
  daedlo-universal summary --workspace ROOT --target ID
  daedlo-universal import --workspace ROOT --target ID --revision NUMBER --file ARCHIVE_JSON
  daedlo-universal targets --workspace ROOT
  daedlo-universal index --workspace ROOT --target ID [--rebuild]
  daedlo-universal history --workspace ROOT --target ID [--run RUN_ID [--source archive] | --limit NUMBER --cursor CURSOR]
  daedlo-universal serve --workspace ROOT [--port NUMBER] [--container-origin http://127.0.0.1:PORT]

Basic Daedlo remains a separate installation and keeps its existing live viewer.
Registration is explicit and preserves existing journals and configurations.
Upgrades are explicit and retain the previous catalog; stop older Universal writers first.
Compression requires explicit catalog version 4; default upgrades stay at 3.
Compression retains plain journals unless --replace is explicitly selected.
Stop workspace writers before backup. Restore always uses a new directory.
Rollback preserves current data and restores a compatible prior full backup separately.
Use the Evidence & knowledge tab to upload proof and review manual records.
History reads never launch an application or refresh an index implicitly.
Index/rebuild changes derived history only; it never replays an application action.
Keep the returned local workspace URL private.\n`;
const usage = () => {
  throw Object.assign(
    Error("Use daedlo-universal --help for supported commands."),
    { code: "usage" },
  );
};
const options = {
  register: ["config", "id", "name", "environment", "auth-profile"],
  revise: ["workspace", "target", "revision"],
  upgrade: ["workspace", "catalog-version"],
  compress: ["workspace", "target", "run", "replace"],
  "journal-recovery": ["workspace", "target"],
  "recover-journal": ["workspace", "target", "receipt"],
  backup: ["workspace", "output"],
  "verify-backup": ["backup"],
  "backup-recovery": ["backup"],
  "recover-backup": ["backup", "receipt"],
  restore: ["backup", "workspace", "catalog-version"],
  rollback: ["workspace", "backup", "output", "preserve", "catalog-version"],
  summary: ["workspace", "target"],
  targets: ["workspace"],
  index: ["workspace", "target", "rebuild"],
  history: ["workspace", "target", "run", "source", "limit", "cursor"],
  import: ["workspace", "target", "revision", "file"],
  serve: ["workspace", "port", "container-origin"],
};
export function parseUniversalArguments(args) {
  if (args.length === 1 && ["--help", "help"].includes(args[0]))
    return { command: "help" };
  const [command, ...rest] = args;
  if (!Object.hasOwn(options, command)) usage();
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i].startsWith("--") ? rest[i].slice(2) : "";
    if (!options[command].includes(key) || Object.hasOwn(flags, key)) usage();
    if (["rebuild", "replace"].includes(key)) flags[key] = true;
    else {
      const value = rest[++i];
      if (!value || value.startsWith("--")) usage();
      flags[key] = value;
    }
  }
  const required = [
    "register",
    "import",
    "backup",
    "verify-backup",
    "backup-recovery",
    "recover-backup",
    "journal-recovery",
    "recover-journal",
    "rollback",
  ].includes(command)
    ? options[command]
    : command === "compress"
      ? ["workspace", "target", "run"]
      : command === "restore"
        ? ["backup", "workspace"]
        : command === "revise"
          ? options.revise
          : [
              "workspace",
              ...(["history", "index", "summary"].includes(command)
                ? ["target"]
                : []),
            ];
  if (required.some((key) => !Object.hasOwn(flags, key))) usage();
  if (flags["container-origin"] !== undefined) {
    const value = flags["container-origin"];
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      usage();
    }
    if (
      !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(value) ||
      parsed.origin !== value ||
      Number(parsed.port) < 1 ||
      Number(parsed.port) > 65535 ||
      !flags.port ||
      flags.port === "0"
    )
      usage();
  }
  if (flags.run && (flags.limit || flags.cursor)) usage();
  if (
    flags.source &&
    (!flags.run || !["archive", "journal"].includes(flags.source))
  )
    usage();
  for (const [key, minimum, maximum] of [
    ["revision", 1, Number.MAX_SAFE_INTEGER],
    ["limit", 1, 100],
    ["port", 0, 65535],
    ["catalog-version", 1, 4],
  ]) {
    if (flags[key] !== undefined) {
      if (!/^(0|[1-9][0-9]*)$/.test(flags[key])) usage();
      flags[key] = Number(flags[key]);
      if (
        !Number.isSafeInteger(flags[key]) ||
        flags[key] < minimum ||
        flags[key] > maximum
      )
        usage();
    }
  }
  if (
    command === "upgrade" &&
    flags["catalog-version"] !== undefined &&
    ![2, 3, 4].includes(flags["catalog-version"])
  )
    usage();
  return { command, flags };
}
const summary = (target) => ({
  id: target.id,
  label: target.label,
  environment: target.environment,
  origin: target.origin,
  model: target.model,
  revision: target.revision,
});

export async function universalCommand(args) {
  const { command, flags } = parseUniversalArguments(args);
  if (command === "help") return { text: help };
  if (["journal-recovery", "recover-journal"].includes(command)) {
    const { inspectJournalRecovery, recoverJournal } = await import(
      "./backup-recovery.mjs"
    );
    return {
      result: await (
        command === "journal-recovery" ? inspectJournalRecovery : recoverJournal
      )({
        root: resolve(flags.workspace),
        targetId: flags.target,
        ...(flags.receipt ? { receipt: flags.receipt } : {}),
      }),
    };
  }
  if (command === "compress") {
    const { compressJournal } = await import("./journal-compression.mjs");
    return {
      result: await compressJournal({
        root: resolve(flags.workspace),
        targetId: flags.target,
        runId: flags.run,
        replace: flags.replace ?? false,
      }),
    };
  }
  if (["backup-recovery", "recover-backup"].includes(command)) {
    const { inspectBackupRecovery, recoverBackup } = await import(
      "./backup-recovery.mjs"
    );
    return {
      result: await (
        command === "backup-recovery" ? inspectBackupRecovery : recoverBackup
      )({
        backup: resolve(flags.backup),
        ...(flags.receipt ? { receipt: flags.receipt } : {}),
      }),
    };
  }
  if (["backup", "verify-backup", "restore", "rollback"].includes(command)) {
    const {
      backupWorkspace,
      verifyWorkspaceBackup,
      restoreWorkspace,
      rollbackWorkspace,
    } = await import("./workspace-backup.mjs");
    if (command === "backup")
      return {
        result: await backupWorkspace({
          root: resolve(flags.workspace),
          output: resolve(flags.output),
        }),
      };
    if (command === "verify-backup")
      return {
        result: await verifyWorkspaceBackup({ backup: resolve(flags.backup) }),
      };
    if (command === "restore")
      return {
        result: await restoreWorkspace({
          backup: resolve(flags.backup),
          root: resolve(flags.workspace),
          ...(flags["catalog-version"] !== undefined
            ? { catalogVersion: flags["catalog-version"] }
            : {}),
        }),
      };
    return {
      result: await rollbackWorkspace({
        root: resolve(flags.workspace),
        backup: resolve(flags.backup),
        output: resolve(flags.output),
        preserve: resolve(flags.preserve),
        catalogVersion: flags["catalog-version"],
      }),
    };
  }
  // SQLite belongs only to this explicitly selected product, never to basic help/start.
  const { openCatalog, upgradeCatalog } = await import("./catalog.mjs");
  if (command === "upgrade")
    return {
      result: await upgradeCatalog({
        root: resolve(flags.workspace),
        ...(flags["catalog-version"] !== undefined
          ? { toVersion: flags["catalog-version"] }
          : {}),
      }),
    };
  if (command === "register") {
    const captured = await captureTargetRegistration({
      configPath: flags.config,
      id: flags.id,
      label: flags.name,
      environment: flags.environment,
      authProfileRef: flags["auth-profile"],
    });
    const { initializeWorkspace } = await loadTools("workspace");
    await initializeWorkspace(captured.config);
    const catalog = await openCatalog({
      root: captured.workspace.root,
      create: true,
    });
    try {
      return {
        result: {
          target: summary(await catalog.registerTarget(captured.target)),
        },
      };
    } finally {
      await catalog.close();
    }
  }
  const root = resolve(flags.workspace);
  const catalog = await openCatalog({ root });
  if (command === "serve") {
    let evidence;
    try {
      const { createEvidenceStore } = await import("./evidence.mjs");
      evidence = await createEvidenceStore({ root, catalog });
      const { createTargetController } = await import("./controller.mjs");
      const { createUniversalServer } = await import("./server.mjs");
      const controller = createTargetController({ root, catalog });
      const server = await createUniversalServer({
        catalog,
        evidence,
        launch: flags["container-origin"]
          ? async () => {
              throw Object.assign(
                Error(
                  "Run the reviewed integration runner inside the container. Managed native viewers require the native installation.",
                ),
                { code: "container_runner_required" },
              );
            }
          : controller.launch.bind(controller),
        ...(flags["container-origin"]
          ? { host: "0.0.0.0", containerOrigin: flags["container-origin"] }
          : {}),
        port: flags.port ?? 0,
      });
      let finish,
        closed = false,
        closing;
      const done = new Promise((resolve) => {
        finish = resolve;
      });
      return {
        result: { product: "daedlo-universal", url: server.url },
        closed: done,
        async close() {
          if (closed) return;
          if (closing) return closing;
          closing = (async () => {
            await server.quiesce();
            // Keep the listening socket alive until all retained handles close;
            // an unresolved Promise alone would allow the CLI to exit.
            await controller.close();
            await evidence.close();
            await catalog.close();
            await server.close();
            closed = true;
            finish();
          })();
          try {
            await closing;
          } finally {
            closing = undefined;
          }
        },
      };
    } catch (error) {
      await evidence?.close();
      await catalog.close();
      throw error;
    }
  }
  try {
    if (command === "import")
      return {
        result: await catalog.importManagedArchive({
          targetId: flags.target,
          expectedTargetRevision: flags.revision,
          sourceFile: resolve(flags.file),
        }),
      };
    if (command === "summary")
      return {
        result: await catalog.getTargetSummary({ targetId: flags.target }),
      };
    if (command === "targets")
      return {
        result: { targets: (await catalog.listTargets()).map(summary) },
      };
    if (command === "index")
      return {
        result: await catalog.indexTarget(flags.target, {
          rebuild: flags.rebuild === true,
        }),
      };
    if (command === "history")
      return {
        result: flags.run
          ? await (
              flags.source === "archive"
                ? catalog.getImportedRun
                : catalog.getRun
            )({ targetId: flags.target, runId: flags.run })
          : await catalog.listRuns({
              targetId: flags.target,
              limit: flags.limit ?? 25,
              cursor: flags.cursor ?? null,
            }),
      };
    if (command === "revise") {
      const current = await catalog.getTarget(flags.target);
      const captured = await captureTargetRegistration(current);
      if (captured.workspace.root !== root)
        throw Object.assign(
          Error("The target belongs to a different workspace."),
          { code: "target_changed" },
        );
      return {
        result: {
          target: summary(
            await catalog.reviseTarget(captured.target, {
              expectedRevision: flags.revision,
            }),
          ),
        },
      };
    }
    usage();
  } finally {
    await catalog.close();
  }
}

export async function runUniversalCli(args = process.argv.slice(2)) {
  const handle = await universalCommand(args);
  process.stdout.write(
    handle.text ?? JSON.stringify(handle.result, null, 2) + "\n",
  );
  if (!handle.close) return;
  const close = () => {
    void handle.close().catch((error) =>
      process.stderr.write(
        JSON.stringify({
          ok: false,
          code: error.code ?? "cleanup_incomplete",
          message:
            "Universal retained owned target cleanup. Resolve the target's guarded cleanup and retry shutdown.",
        }) + "\n",
      ),
    );
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
  try {
    await handle.closed;
  } finally {
    process.off("SIGINT", close);
    process.off("SIGTERM", close);
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  runUniversalCli().catch((error) => {
    process.stderr.write(
      JSON.stringify({
        ok: false,
        code: error.code ?? "universal_failed",
        message: error.message,
      }) + "\n",
    );
    process.exitCode = 1;
  });
