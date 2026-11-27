import fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { ninjaDirectory, ninjaRead } from "./ninja-manager.mjs";
import { journalFilesystem } from "./run-journal.mjs";
import { openWorkspace } from "./workspace.mjs";
import { inspectProcessOwner } from "./process-owner.mjs";
import {
  inspectRunJournalRecovery,
  recoverRunJournal,
  verifyReleasedRunJournalRecovery,
} from "./journal-recovery.mjs";

const {
  directory: safeDirectory,
  sameFile,
  unlinkOwned,
  syncDirectory,
  smallFile,
} = journalFilesystem;

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const receiptPattern = /^([A-Za-z0-9][A-Za-z0-9._-]{0,127})\.([a-f0-9]{64})$/;
const fail = (code, message) => {
  throw Object.assign(Error(message), { code });
};
const changed = () =>
  fail(
    "recovery_changed",
    "Ownership records changed. Preserve them and inspect recovery again.",
  );
const blocked = () =>
  fail(
    "recovery_blocked",
    "The previous owner is not proven dead or its records do not match. Preserve the data and use its authenticated owner.",
  );

async function readRecord(path) {
  try {
    const { stat, bytes } = await smallFile(path, 1024 * 1024);
    const value = JSON.parse(bytes.toString("utf8"));
    return {
      dev: stat.dev.toString(),
      ino: stat.ino.toString(),
      sha256: digest(bytes),
      bytes: bytes.toString("base64"),
      value,
    };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
const same = (a, b) =>
  (a === null && b === null) ||
  Boolean(
    a && b && a.dev === b.dev && a.ino === b.ino && a.sha256 === b.sha256,
  );
const summary = (record) =>
  record ? { dev: record.dev, ino: record.ino, sha256: record.sha256 } : null;
function receipt(scope, expected, records) {
  return (
    expected.token +
    "." +
    digest(
      JSON.stringify({
        scope,
        expected,
        child: summary(records.child),
        native: summary(records.native),
      }),
    )
  );
}
function validateContext(context, scope, recoveryId) {
  if (
    context?.schemaVersion !== 1 ||
    context.scope !== scope ||
    context.recoveryId !== recoveryId ||
    !context.records ||
    !context.expected ||
    context.expected.token !== recoveryId.match(receiptPattern)?.[1]
  )
    changed();
  if (
    !/^[a-f0-9]{64}$/.test(context.expected.sha256) ||
    ![context.expected.dev, context.expected.ino].every(
      (value) => typeof value === "string" && /^\d+$/.test(value),
    )
  )
    changed();
  for (const record of [context.records.child, context.records.native]) {
    if (record === null) continue;
    if (
      !record ||
      ![record.dev, record.ino].every(
        (value) => typeof value === "string" && /^\d+$/.test(value),
      ) ||
      typeof record.bytes !== "string" ||
      record.bytes.length > 1400000
    )
      changed();
    const bytes = Buffer.from(record.bytes, "base64");
    if (
      bytes.toString("base64") !== record.bytes ||
      digest(bytes) !== record.sha256
    )
      changed();
    let value;
    try {
      value = JSON.parse(bytes);
    } catch {
      changed();
    }
    if (!isDeepStrictEqual(value, record.value)) changed();
  }
  if (receipt(scope, context.expected, context.records) !== recoveryId)
    changed();
  return context;
}
const completion = (context) => ({
  schemaVersion: 1,
  scope: context.scope,
  recoveryId: context.recoveryId,
  ownership: "retired",
  resourceCleanup: "unknown",
});
async function load(configPath) {
  configPath = resolve(configPath);
  await ninjaDirectory(dirname(configPath));
  const config = await ninjaRead(configPath);
  const workspace = await openWorkspace(config);
  if (workspace?.journal !== 1)
    fail(
      "journal_required",
      "Recovery requires an explicit journal workspace.",
    );
  const store = resolve(config.store);
  return {
    workspace,
    config,
    store,
    configPath,
    paths: {
      child: join(store, "supervisor", "child.json"),
      native: join(store, "native-session.json"),
    },
    scope: digest(
      JSON.stringify({
        store,
        workspace: config.workspace,
        projectId: config.registration.projectId,
      }),
    ),
  };
}
async function records(f) {
  await ninjaDirectory(f.store).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  await ninjaDirectory(dirname(f.paths.child)).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  return {
    child: await readRecord(f.paths.child),
    native: await readRecord(f.paths.native),
  };
}
function childMatches(record, writer) {
  if (!record) return !writer?.managed;
  const value = record.value;
  return (
    value?.pid === writer?.pid &&
    value.owner?.pid === value.pid &&
    typeof value.token === "string" &&
    ["starting", "running"].includes(value.status) &&
    writer?.managed?.childToken === value.token &&
    writer.managed.installationId === value.installationId
  );
}
async function nativeState(f, record, authorizedNativeInstance) {
  if (!record) return { state: "absent" };
  const value = record.value;
  if (
    value?.schemaVersion !== 1 ||
    value.projectId !== f.workspace.projectId ||
    value.configPath !== f.configPath ||
    !/^[a-f0-9]{32}$/.test(value.instance) ||
    value.owner?.pid !== value.pid
  )
    return { state: "unknown", reason: "invalid_native_owner" };
  if (authorizedNativeInstance === value.instance && value.pid === process.pid)
    return { state: "authenticated_owner" };
  return inspectProcessOwner(value.owner);
}
async function snapshot(f, options = {}) {
  const journal = await inspectRunJournalRecovery({ workspace: f.workspace });
  const retained = await records(f);
  const native = await nativeState(
    f,
    retained.native,
    options.authorizedNativeInstance,
  );
  const childBound = childMatches(retained.child, journal.writer);
  const child = retained.child
    ? await inspectProcessOwner(retained.child.value.owner)
    : { state: "absent" };
  const recoveryId = journal.expected
    ? receipt(f.scope, journal.expected, retained)
    : null;
  const writerLife = journal.writer?.owner
    ? await inspectProcessOwner(journal.writer.owner)
    : { state: "unknown" };
  const canInspectRecoverable =
    ["dead", "recovering", "recovered"].includes(journal.status) &&
    writerLife.state === "dead" &&
    childBound &&
    ["dead", "absent"].includes(child.state) &&
    ["dead", "absent", "live", "authenticated_owner"].includes(native.state);
  return {
    journal,
    retained,
    native,
    child,
    childBound,
    recoveryId,
    status: canInspectRecoverable
      ? "recoverable"
      : journal.status === "unlocked" &&
          !retained.native &&
          (!retained.child || retained.child.value?.status === "closed")
        ? "unlocked"
        : "blocked",
  };
}

/** No manager, launcher, browser or adapter is loaded during recovery inspection. */
export async function inspectManagedRecovery(configPath, options = {}) {
  const f = await load(configPath);
  const s = await snapshot(f, options);
  if (
    s.retained.child &&
    (await verifiedRetiredOwner(f.config, s.retained.child.value)) &&
    !["live", "dead"].includes(s.journal.status)
  )
    return {
      schemaVersion: 1,
      status: "recovered",
      recoveryId: s.retained.child.value.recoveryId,
      writer: { state: "retired", pid: s.retained.child.value.pid },
      historyUnchanged: true,
      applicationEffects: "unresolved",
      resourceCleanup: "unknown",
    };
  if (s.journal.expected && s.journal.directory) {
    const context = (
      await readRecord(join(s.journal.directory, "managed-context.json"))
    )?.value;
    if (context) {
      validateContext(context, f.scope, context.recoveryId);
      if (!isDeepStrictEqual(context.expected, s.journal.expected)) changed();
      // A crash can occur after retirement of a managed record and before the
      // final journal receipt. Keep the original explicit retry receipt usable.
      if (
        same(s.retained.child, context.records.child) ||
        retiredFor(s.retained.child, context)
      ) {
        s.recoveryId = context.recoveryId;
        if (
          ["dead", "recovering", "recovered"].includes(s.journal.status) &&
          (await inspectProcessOwner(s.journal.writer?.owner)).state === "dead"
        )
          s.status = "recoverable";
      }
    }
  }
  return {
    schemaVersion: 1,
    status: s.status,
    ...(s.status === "blocked" && !s.journal.expected
      ? { reason: "no_recorded_journal_owner" }
      : {}),
    recoveryId: s.recoveryId,
    writer: { state: s.journal.status, pid: s.journal.writer?.pid ?? null },
    child: { state: s.child.state, boundToWriter: s.childBound },
    native: {
      state: s.native.state,
      route: s.native.state === "live" ? "authenticated_owner" : "offline",
    },
    historyUnchanged: true,
    applicationEffects: "unresolved",
    resourceCleanup: "unknown",
  };
}

async function writeRecord(path, value, expected) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n");
  const temporary = path + "." + randomUUID() + ".tmp";
  const parent = await safeDirectory(dirname(path));
  let handle,
    identity,
    originalError,
    renamed = false;
  try {
    handle = await fs.open(temporary, "wx", 0o600);
    identity = await handle.stat({ bigint: true });
    await handle.writeFile(bytes);
    await handle.sync();
    if (!sameFile(parent, await safeDirectory(dirname(path)))) changed();
    if (expected !== undefined) {
      if (!same(await readRecord(path), expected)) changed();
      await fs.rename(temporary, path);
      renamed = true;
    } else {
      try {
        await fs.link(temporary, path);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        const existing = await readRecord(path);
        if (existing?.bytes !== bytes.toString("base64")) changed();
      }
    }
    await syncDirectory(dirname(path));
  } catch (error) {
    originalError = error;
  }
  let cleanupFailed = false;
  try {
    await handle?.close();
  } catch {
    cleanupFailed = true;
  }
  if (handle && !renamed) {
    try {
      await unlinkOwned(temporary, identity, parent);
    } catch (error) {
      if (error.code !== "ENOENT") cleanupFailed = true;
    }
  }
  if (cleanupFailed)
    throw Object.assign(
      Error("Recovery retained a temporary record after incomplete cleanup."),
      { code: "recovery_cleanup_incomplete", retainedPath: temporary },
    );
  if (originalError) throw originalError;
}
const retiredFor = (record, context) =>
  Boolean(
    record &&
      record.value.status === "retired" &&
      record.value.recoveryId === context.recoveryId &&
      record.value.token === context.records.child?.value.token &&
      record.value.pid === context.records.child?.value.pid &&
      isDeepStrictEqual(record.value, {
        ...context.records.child.value,
        status: "retired",
        recoveryId: context.recoveryId,
        recoveryComplete: true,
        resourceCleanup: "unknown",
      }) &&
      record.value.resourceCleanup === "unknown",
  );

/** Read a completed receipt before routing a retry to any replacement owner. */
export async function readCompletedManagedRecovery(configPath, recoveryId) {
  const matched =
    typeof recoveryId === "string" && recoveryId.match(receiptPattern);
  if (!matched) fail("usage", "Recovery requires the exact inspected receipt.");
  const f = await load(configPath);
  const directory = join(f.workspace.journalRoot, "recoveries", matched[1]);
  try {
    await safeDirectory(directory);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const context = (await readRecord(join(directory, "managed-context.json")))
    ?.value;
  if (!context) return null;
  validateContext(context, f.scope, recoveryId);
  const complete = (await readRecord(join(directory, "managed-complete.json")))
    ?.value;
  if (!complete) return null;
  if (!isDeepStrictEqual(complete, completion(context))) changed();
  if (
    !(await verifyReleasedRunJournalRecovery({
      workspace: f.workspace,
      expected: context.expected,
    }))
  )
    return null;
  return {
    status: "already_recovered",
    recoveryId,
    historyUnchanged: true,
    applicationEffects: "unresolved",
    resourceCleanup: "unknown",
  };
}

/** Private routing only: a surviving claimant may already have retired its file. */
export async function readPendingManagedNativeOwner(
  configPath,
  recoveryId,
  { includeCompleted = false } = {},
) {
  const matched =
    typeof recoveryId === "string" && recoveryId.match(receiptPattern);
  if (!matched) fail("usage", "Recovery requires the exact inspected receipt.");
  const f = await load(configPath);
  const directory = join(f.workspace.journalRoot, "recoveries", matched[1]);
  try {
    await safeDirectory(directory);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const context = (await readRecord(join(directory, "managed-context.json")))
    ?.value;
  if (!context) return null;
  validateContext(context, f.scope, recoveryId);
  const complete = (await readRecord(join(directory, "managed-complete.json")))
    ?.value;
  if (!complete) return null;
  if (!isDeepStrictEqual(complete, completion(context))) changed();
  if (
    !includeCompleted &&
    (await verifyReleasedRunJournalRecovery({
      workspace: f.workspace,
      expected: context.expected,
    }))
  )
    return null;
  return context.records.native?.value ?? null;
}

/** Explicit receipt-bound ownership retirement; never repairs/replays an application run. */
export async function recoverManaged(
  configPath,
  { recoveryId, authorizedNativeInstance, beforeNativeRelease } = {},
) {
  const matched =
    typeof recoveryId === "string" && recoveryId.match(receiptPattern);
  if (!matched)
    fail(
      "usage",
      "Recovery requires the exact receipt from recovery inspection.",
    );
  if (
    beforeNativeRelease !== undefined &&
    typeof beforeNativeRelease !== "function"
  )
    fail("usage", "Invalid native retirement coordinator.");
  const f = await load(configPath);
  const directory = join(f.workspace.journalRoot, "recoveries", matched[1]);
  await ninjaDirectory(directory).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  const contextPath = join(directory, "managed-context.json");
  let context = (await readRecord(contextPath))?.value;
  if (context) {
    validateContext(context, f.scope, recoveryId);
  } else {
    const s = await snapshot(f, { authorizedNativeInstance });
    if (s.recoveryId !== recoveryId) changed();
    if (
      s.status !== "recoverable" ||
      !["absent", "dead", "authenticated_owner"].includes(s.native.state)
    )
      blocked();
    context = {
      schemaVersion: 1,
      scope: f.scope,
      recoveryId,
      expected: s.journal.expected,
      records: s.retained,
    };
  }
  if (
    authorizedNativeInstance !== undefined &&
    (context.records.native?.value.instance !== authorizedNativeInstance ||
      context.records.native.value.pid !== process.pid)
  )
    changed();
  const completedPath = join(directory, "managed-complete.json");
  const completed = (await readRecord(completedPath))?.value;
  if (completed && !isDeepStrictEqual(completed, completion(context)))
    changed();
  const result = await recoverRunJournal({
    workspace: f.workspace,
    expected: context.expected,
    beforeRelease: async ({ directory: ownedDirectory }) => {
      if (ownedDirectory !== directory) changed();
      const current = await records(f);
      const prepared = (await readRecord(completedPath))?.value;
      if (prepared && !isDeepStrictEqual(prepared, completion(context)))
        changed();
      // Once all managed receipts are durable, native ownership may have been
      // retired by this claim. A replacement is left alone on explicit retry.
      if (!same(current.native, context.records.native) && !prepared) changed();
      if (same(current.native, context.records.native)) {
        const native = await nativeState(
          f,
          current.native,
          authorizedNativeInstance,
        );
        if (!["absent", "dead", "authenticated_owner"].includes(native.state))
          blocked();
      }
      if (
        !same(current.child, context.records.child) &&
        !retiredFor(current.child, context)
      )
        changed();
      if (
        context.records.child &&
        !retiredFor(current.child, context) &&
        (await inspectProcessOwner(context.records.child.value.owner)).state !==
          "dead"
      )
        blocked();
      await writeRecord(contextPath, context);
      if (context.records.child && !retiredFor(current.child, context)) {
        await writeRecord(
          f.paths.child,
          {
            ...context.records.child.value,
            status: "retired",
            recoveryId,
            recoveryComplete: true,
            resourceCleanup: "unknown",
          },
          context.records.child,
        );
      }
      // Start validates both this receipt AND the journal's released receipt.
      // All managed mutations finish under the exclusive journal recovery claim.
      await writeRecord(completedPath, completion(context));
      const native = await readRecord(f.paths.native);
      if (context.records.native && same(native, context.records.native)) {
        const state = await nativeState(f, native, authorizedNativeInstance);
        if (["dead", "authenticated_owner"].includes(state.state)) {
          if (state.state === "authenticated_owner")
            await beforeNativeRelease?.();
          const parent = await safeDirectory(f.store);
          if (!same(await readRecord(f.paths.native), context.records.native))
            changed();
          await unlinkOwned(
            f.paths.native,
            { dev: BigInt(native.dev), ino: BigInt(native.ino) },
            parent,
          );
          await syncDirectory(f.store);
        } else blocked();
      }
    },
  });
  // A journal-only recovery must never be mistaken for a managed completion.
  const durableContext = (await readRecord(contextPath))?.value;
  validateContext(durableContext, f.scope, recoveryId);
  if (
    !isDeepStrictEqual(
      (await readRecord(completedPath))?.value,
      completion(context),
    )
  )
    changed();
  return {
    status:
      result.status === "already_recovered" ? "already_recovered" : "recovered",
    recoveryId,
    historyUnchanged: true,
    applicationEffects: "unresolved",
    resourceCleanup: "unknown",
  };
}

/** A retired marker is reusable only with its exact durable recovery receipts. */
export async function verifiedRetiredOwner(config, record) {
  try {
    const matched = record?.recoveryId?.match(receiptPattern);
    if (
      !matched ||
      record.status !== "retired" ||
      record.recoveryComplete !== true ||
      record.resourceCleanup !== "unknown"
    )
      return false;
    const workspace = await openWorkspace(config);
    if (workspace?.journal !== 1) return false;
    const directory = join(workspace.journalRoot, "recoveries", matched[1]);
    await ninjaDirectory(directory);
    const scope = digest(
      JSON.stringify({
        store: resolve(config.store),
        workspace: config.workspace,
        projectId: config.registration.projectId,
      }),
    );
    const completed = (
      await readRecord(join(directory, "managed-complete.json"))
    )?.value;
    const context = (await readRecord(join(directory, "managed-context.json")))
      ?.value;
    validateContext(context, scope, record.recoveryId);
    const released = await verifyReleasedRunJournalRecovery({
      workspace,
      expected: context.expected,
    });
    return (
      isDeepStrictEqual(completed, completion(context)) &&
      retiredFor({ value: record }, context) &&
      released
    );
  } catch {
    return false;
  }
}
