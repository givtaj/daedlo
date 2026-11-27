import fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, resolve, join, dirname } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { loadTools } from "./tools.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const id = (v) =>
  typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v);
const sha = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const number = (v) => typeof v === "string" && /^[0-9]{1,30}$/.test(v);
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const exact = (v, keys) =>
  object(v) && Object.keys(v).sort().join() === [...keys].sort().join();
const same = (a, b) =>
  a && b && String(a.dev) === String(b.dev) && String(a.ino) === String(b.ino);
const handles = new Set();
let active = false;
const fail = (code = "backup_recovery_unproven") => {
  throw Object.assign(
    Error(
      {
        backup_recovery_unproven:
          "Backup writer ownership is incomplete or unproven. Preserve the source and partial backup for inspection.",
        backup_recovery_changed:
          "The backup or writer changed since inspection. Preserve it and inspect again; replacement writers are not retired.",
        backup_recovery_busy:
          "The backup writer or recovery claimant is live or unproven. No ownership was retired.",
        backup_cleanup_incomplete:
          "Backup recovery retains an unclosed read handle. Retry this explicit operation to finish cleanup.",
      }[code],
    ),
    { code },
  );
};
async function closeHandles() {
  for (const handle of [...handles]) {
    try {
      await handle.close();
      handles.delete(handle);
    } catch {
      /* Retain exact handle. */
    }
  }
  if (handles.size) fail("backup_cleanup_incomplete");
}
async function readFile(path, max = 65536) {
  const { journalFilesystem: io } = await loadTools("run-journal");
  const parent = await io.directory(dirname(path));
  let handle;
  try {
    const before = await fs.lstat(path, { bigint: true });
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1n ||
      before.size > max
    )
      fail();
    handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    handles.add(handle);
    if (!same(before, await handle.stat({ bigint: true }))) fail();
    const bytes = await handle.readFile(),
      after = await handle.stat({ bigint: true });
    if (
      bytes.length !== Number(before.size) ||
      !same(before, after) ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs ||
      !same(before, await fs.lstat(path, { bigint: true })) ||
      !same(parent, await io.directory(dirname(path)))
    )
      fail();
    return { bytes, stat: before };
  } finally {
    if (handle) {
      try {
        await handle.close();
        handles.delete(handle);
      } catch {
        fail("backup_cleanup_incomplete");
      }
    }
  }
}
const optional = async (path) =>
  fs.lstat(path, { bigint: true }).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
function parse(bytes) {
  try {
    return JSON.parse(bytes);
  } catch {
    fail();
  }
}

async function inspect(backup) {
  if (
    typeof backup !== "string" ||
    !isAbsolute(backup) ||
    resolve(backup) !== backup
  )
    fail();
  const { journalFilesystem: io } = await loadTools("run-journal");
  const processOwners = await loadTools("process-owner"),
    recovery = await loadTools("journal-recovery");
  const backupIdentity = await io.directory(backup),
    intentFile = await readFile(join(backup, "intent.json"), 256 * 1024);
  const intent = parse(intentFile.bytes);
  if (
    !exact(intent, [
      "format",
      "backupId",
      "workspaceId",
      "sourceRoot",
      "source",
      "owner",
      "projects",
      "createdAt",
    ]) ||
    intent.format !== "daedlo-workspace-backup-intent/1" ||
    !id(intent.backupId) ||
    !id(intent.workspaceId) ||
    typeof intent.sourceRoot !== "string" ||
    !isAbsolute(intent.sourceRoot) ||
    resolve(intent.sourceRoot) !== intent.sourceRoot ||
    !exact(intent.source, ["dev", "ino", "workspaceSha256"]) ||
    !number(intent.source.dev) ||
    !number(intent.source.ino) ||
    !sha(intent.source.workspaceSha256) ||
    !processOwners.isProcessOwnerRecord(intent.owner) ||
    !Array.isArray(intent.projects) ||
    intent.projects.length > 1024 ||
    intent.projects.some((p) => !id(p)) ||
    new Set(intent.projects).size !== intent.projects.length ||
    typeof intent.createdAt !== "string" ||
    !Number.isFinite(Date.parse(intent.createdAt))
  )
    fail();
  const markerPath = join(intent.sourceRoot, "workspace.json");
  const assertSource = async () => {
    const marker = await readFile(markerPath, 8192),
      value = parse(marker.bytes);
    if (
      !same(intent.source, await io.directory(intent.sourceRoot)) ||
      digest(marker.bytes) !== intent.source.workspaceSha256 ||
      value.workspaceId !== intent.workspaceId ||
      value.schemaVersion !== 1 ||
      value.kind !== "daedlo-workspace" ||
      !isDeepStrictEqual(value.formats, { managedRun: 1, runJournal: 1 }) ||
      !same(backupIdentity, await io.directory(backup)) ||
      !(await readFile(join(backup, "intent.json"), 256 * 1024)).bytes.equals(
        intentFile.bytes,
      )
    )
      fail("backup_recovery_changed");
  };
  await assertSource();
  const locksRoot = join(backup, "locks"),
    state = [],
    scopes = [];
  if (await optional(locksRoot)) {
    await io.directory(locksRoot);
    const names = await fs.readdir(locksRoot);
    if (
      names.length > 1024 ||
      names.some((name) => !intent.projects.some((p) => name === p + ".json"))
    )
      fail();
  }
  for (const projectId of intent.projects) {
    const directory = join(
      intent.sourceRoot,
      "projects",
      projectId,
      "run-journals",
    );
    const workspace = {
      root: intent.sourceRoot,
      id: intent.workspaceId,
      projectId,
      journal: 1,
      journalRoot: directory,
      assertCompatible: assertSource,
    };
    const receiptPath = join(locksRoot, projectId + ".json"),
      lockPath = join(directory, "writer.lock");
    if (!(await optional(receiptPath))) {
      // Never infer ownership in the gap between lock publication and its receipt.
      if (await optional(lockPath)) fail();
      state.push({ projectId, status: "unlocked", receipt: null });
      continue;
    }
    const saved = await readFile(receiptPath, 16384),
      proof = parse(saved.bytes),
      record = proof.record,
      expected = proof.expected;
    if (
      !exact(proof, ["format", "projectId", "path", "expected", "record"]) ||
      proof.format !== "daedlo-workspace-backup-lock/1" ||
      proof.projectId !== projectId ||
      proof.path !== `projects/${projectId}/run-journals/writer.lock` ||
      !exact(expected, ["token", "sha256", "dev", "ino"]) ||
      !id(expected.token) ||
      !sha(expected.sha256) ||
      !number(expected.dev) ||
      !number(expected.ino) ||
      !exact(record, [
        "format",
        "workspaceId",
        "projectId",
        "token",
        "pid",
        "hostname",
        "owner",
      ]) ||
      record.format !== "daedlo-run-journal-lock/2" ||
      record.workspaceId !== intent.workspaceId ||
      record.projectId !== projectId ||
      record.token !== expected.token ||
      record.pid !== intent.owner.pid ||
      !isDeepStrictEqual(record.owner, intent.owner) ||
      typeof record.hostname !== "string"
    )
      fail();
    const actual = await recovery.inspectRunJournalRecovery({ workspace });
    if (await optional(lockPath)) {
      const current = await readFile(lockPath, 8192);
      if (
        !same(expected, current.stat) ||
        digest(current.bytes) !== expected.sha256 ||
        !isDeepStrictEqual(parse(current.bytes), record)
      )
        fail("backup_recovery_changed");
    } else if (actual.status === "unlocked" || actual.status === "recovered") {
      state.push({
        projectId,
        status: "complete",
        receipt: digest(saved.bytes),
      });
      continue;
    }
    if (
      !isDeepStrictEqual(actual.expected, expected) ||
      !isDeepStrictEqual(actual.writer, record)
    )
      fail("backup_recovery_changed");
    if (actual.status !== "dead") fail("backup_recovery_busy");
    state.push({
      projectId,
      status: "dead",
      receipt: digest(saved.bytes),
      expected,
    });
    scopes.push({ workspace, expected });
  }
  await assertSource();
  const receipt = digest(
    JSON.stringify({
      backupId: intent.backupId,
      intent: digest(intentFile.bytes),
      backup: {
        dev: String(backupIdentity.dev),
        ino: String(backupIdentity.ino),
      },
      state,
    }),
  );
  return {
    result: {
      backupId: intent.backupId,
      workspaceId: intent.workspaceId,
      status: scopes.length ? "recoverable" : "complete",
      projects: scopes.length,
      receipt,
    },
    scopes,
    recovery,
    assertSource,
  };
}
async function safe(operation) {
  if (active) fail("backup_recovery_busy");
  active = true;
  try {
    await closeHandles();
    return await operation();
  } catch (error) {
    if (
      /^(backup_|journal_|workspace_|catalog_|target_)/.test(error.code ?? "")
    )
      throw error;
    fail();
  } finally {
    active = false;
  }
}
export async function inspectBackupRecovery({ backup } = {}) {
  return safe(async () => (await inspect(backup)).result);
}
export async function recoverBackup({ backup, receipt } = {}) {
  return safe(async () => {
    if (!sha(receipt)) fail("backup_recovery_changed");
    const checked = await inspect(backup);
    if (checked.result.receipt !== receipt) fail("backup_recovery_changed");
    for (const scope of checked.scopes) {
      await checked.assertSource();
      await checked.recovery.recoverRunJournal(scope);
    }
    return {
      backupId: checked.result.backupId,
      workspaceId: checked.result.workspaceId,
      recovered: checked.scopes.length,
      status: "complete",
    };
  });
}

// Target-scoped recovery uses the same R2 protocol; it never assumes that a
// writer was started by compression and never retires managed/native owners.
const journalFail = (code = "journal_recovery_unproven") => {
  const message = {
    journal_recovery_unproven:
      "Journal writer ownership is unproven or managed by another coordinator. Preserve it and use its owning recovery procedure.",
    journal_recovery_changed:
      "The target or journal writer changed since inspection. Inspect again; replacement ownership was preserved.",
    journal_recovery_busy:
      "A live or unproven journal writer owns this target. No ownership was retired.",
    journal_recovery_cleanup:
      "Recovery cleanup is incomplete. Retry this explicit operation to close retained owned handles.",
  }[code];
  throw Object.assign(Error(message), { code });
};
async function journalSafe(operation) {
  try {
    return await safe(operation);
  } catch (error) {
    if (error.code === "backup_recovery_busy")
      journalFail("journal_recovery_busy");
    if (error.code === "backup_cleanup_incomplete")
      journalFail("journal_recovery_cleanup");
    if (error.code?.startsWith("backup_")) journalFail();
    throw error;
  }
}
async function withJournalInspection({ root, targetId }, operation) {
  if (
    typeof root !== "string" ||
    !isAbsolute(root) ||
    resolve(root) !== root ||
    !id(targetId)
  )
    journalFail();
  const { openCatalog } = await import("./catalog.mjs");
  const { journalFilesystem: io } = await loadTools("run-journal");
  const recovery = await loadTools("journal-recovery");
  const rootIdentity = await io.directory(root);
  const markerFile = await readFile(join(root, "workspace.json"), 8192),
    marker = parse(markerFile.bytes);
  const catalog = await openCatalog({ root });
  handles.add(catalog);
  try {
    const target = await catalog.getTarget(targetId);
    if (!target || !id(target.projectId)) journalFail();
    const assertCompatible = async () => {
      if (
        !same(rootIdentity, await io.directory(root)) ||
        !(await readFile(join(root, "workspace.json"), 8192)).bytes.equals(
          markerFile.bytes,
        ) ||
        !isDeepStrictEqual(await catalog.getTarget(targetId), target)
      )
        journalFail("journal_recovery_changed");
    };
    const workspace = {
      root,
      id: marker.workspaceId,
      projectId: target.projectId,
      journal: 1,
      journalRoot: join(root, "projects", target.projectId, "run-journals"),
      assertCompatible,
    };
    const actual = await recovery.inspectRunJournalRecovery({ workspace });
    const complete = ["unlocked", "recovered"].includes(actual.status);
    if (!complete) {
      if (
        !exact(actual.writer, [
          "format",
          "workspaceId",
          "projectId",
          "token",
          "pid",
          "hostname",
          "owner",
        ]) ||
        actual.writer.format !== "daedlo-run-journal-lock/2" ||
        actual.writer.workspaceId !== marker.workspaceId ||
        actual.writer.projectId !== target.projectId ||
        !actual.expected
      )
        journalFail();
      if (!["dead", "recovering"].includes(actual.status))
        journalFail("journal_recovery_busy");
      const lockPath = join(workspace.journalRoot, "writer.lock");
      if (await optional(lockPath)) {
        const file = await readFile(lockPath, 8192);
        if (
          !same(file.stat, actual.expected) ||
          digest(file.bytes) !== actual.expected.sha256 ||
          !isDeepStrictEqual(parse(file.bytes), actual.writer)
        )
          journalFail("journal_recovery_changed");
      } else if (actual.status !== "recovering")
        journalFail("journal_recovery_changed");
    }
    await assertCompatible();
    const receipt = digest(
      JSON.stringify({
        workspaceId: marker.workspaceId,
        target,
        root: { dev: String(rootIdentity.dev), ino: String(rootIdentity.ino) },
        marker: digest(markerFile.bytes),
        status: actual.status,
        expected: actual.expected,
        writer: actual.writer,
      }),
    );
    return await operation({
      workspace,
      recovery,
      actual,
      complete,
      assertCompatible,
      result: {
        workspaceId: marker.workspaceId,
        targetId,
        status: complete
          ? "complete"
          : actual.status === "dead"
            ? "recoverable"
            : "recovery_pending",
        receipt,
      },
    });
  } finally {
    try {
      await catalog.close();
      handles.delete(catalog);
    } catch {
      journalFail("journal_recovery_cleanup");
    }
  }
}
export async function inspectJournalRecovery(options = {}) {
  return journalSafe(() =>
    withJournalInspection(options, async (checked) => checked.result),
  );
}
export async function recoverJournal({ root, targetId, receipt } = {}) {
  return journalSafe(async () => {
    if (!sha(receipt)) journalFail("journal_recovery_changed");
    return withJournalInspection({ root, targetId }, async (checked) => {
      if (receipt !== checked.result.receipt)
        journalFail("journal_recovery_changed");
      if (!checked.complete)
        await checked.recovery.recoverRunJournal({
          workspace: checked.workspace,
          expected: checked.actual.expected,
          beforeRelease: checked.assertCompatible,
        });
      return {
        workspaceId: checked.result.workspaceId,
        targetId,
        status: "complete",
        recovered: checked.complete ? 0 : 1,
      };
    });
  });
}
