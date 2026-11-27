import fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { dirname, isAbsolute, join, parse, resolve, sep } from "node:path";
import { isDeepStrictEqual, TextDecoder } from "node:util";
import { captureProcessOwner } from "./process-owner.mjs";

const FORMAT = "daedlo-run-journal/1";
const MAX_RECORD_BYTES = 1024 * 1024;
const MAX_RUN_BYTES = 16 * MAX_RECORD_BYTES;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;
const fail = (code, message) => {
  throw Object.assign(Error(message), { code });
};
const exact = (value, keys) =>
  object(value) &&
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const validId = (value) => typeof value === "string" && idPattern.test(value);
const validTime = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value));
const validCommand = (value) => typeof value === "string" && value.length > 0;
const messages = {
  journal_record: "Run journal metadata is invalid.",
  journal_limit: "Run journal data exceeds the supported size limit.",
  journal_corrupt:
    "Run journal data is incomplete or inconsistent; the original data was preserved.",
  journal_ownership_changed:
    "Run journal ownership changed; restore the owned workspace before retrying.",
  journal_pending:
    "Run journal persistence needs explicit recovery before continuing or closing its writer.",
  journal_write_failed:
    "Run journal persistence failed; repair local storage and explicitly retry persistence.",
};
function invalid(code = "journal_record") {
  fail(code, messages[code]);
}
function publicError(error) {
  if (
    typeof error?.code === "string" &&
    /^(journal_|workspace_)/.test(error.code)
  )
    return error;
  return Object.assign(Error(messages.journal_write_failed), {
    code: "journal_write_failed",
  });
}

function workspaceInfo(workspace) {
  if (
    !object(workspace) ||
    workspace.journal !== 1 ||
    !validId(workspace.id) ||
    !validId(workspace.projectId) ||
    typeof workspace.root !== "string" ||
    !isAbsolute(workspace.root) ||
    workspace.root !== resolve(workspace.root) ||
    typeof workspace.assertCompatible !== "function" ||
    workspace.journalRoot !==
      join(workspace.root, "projects", workspace.projectId, "run-journals")
  )
    fail(
      "journal_config",
      "Run journals require a compatible explicitly enabled workspace.",
    );
  return Object.freeze({
    root: workspace.root,
    id: workspace.id,
    projectId: workspace.projectId,
    directory: workspace.journalRoot,
    assertCompatible: () => workspace.assertCompatible(),
  });
}

// Validate every component, not only the last path. Never adopt a symlink.
async function directory(path, create = false) {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of absolute
    .slice(current.length)
    .split(sep)
    .filter(Boolean)) {
    current = join(current, part);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (error.code !== "ENOENT" || !create) throw error;
      try {
        await fs.mkdir(current, { mode: 0o700 });
      } catch (race) {
        if (race.code !== "EEXIST") throw race;
      }
      stat = await fs.lstat(current);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink())
      invalid("journal_ownership_changed");
  }
  return fs.lstat(absolute, { bigint: true });
}
async function unlinkOwned(path, identity, parentIdentity) {
  const parent = await fs.lstat(dirname(path), { bigint: true });
  const current = await fs.lstat(path, { bigint: true });
  if (
    !identity ||
    !parentIdentity ||
    !parent.isDirectory() ||
    !sameFile(parent, parentIdentity) ||
    !current.isFile() ||
    !sameFile(current, identity)
  )
    invalid("journal_ownership_changed");
  await fs.unlink(path);
}
async function syncDirectory(path) {
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function readExactly(handle, length, position = 0) {
  const bytes = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(
      bytes,
      offset,
      length - offset,
      position + offset,
    );
    if (!bytesRead) invalid("journal_corrupt");
    offset += bytesRead;
  }
  return bytes;
}
async function smallFile(path, limit) {
  const before = await fs.lstat(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size > limit)
    invalid("journal_ownership_changed");
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile() || !sameFile(before, stat) || stat.size > limit)
      invalid("journal_ownership_changed");
    const bytes = await readExactly(handle, Number(stat.size));
    const after = await handle.stat({ bigint: true });
    if (after.size !== stat.size || after.mtimeNs !== stat.mtimeNs)
      invalid("journal_ownership_changed");
    return { stat, bytes };
  } finally {
    await handle.close();
  }
}
async function prefixHash(handle, length, suffix) {
  const hash = createHash("sha256");
  for (let offset = 0; offset < length; offset += 64 * 1024)
    hash.update(
      await readExactly(handle, Math.min(64 * 1024, length - offset), offset),
    );
  if (suffix) hash.update(suffix);
  return hash.digest("hex");
}

function jsonCopy(value) {
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch {
    invalid();
  }
  if (typeof encoded !== "string") invalid();
  if (Buffer.byteLength(encoded) > MAX_RECORD_BYTES) invalid("journal_limit");
  return JSON.parse(encoded);
}
function installationInfo(value) {
  const result = jsonCopy({
    id: value?.id,
    version: value?.version,
    sourceSha256: value?.sourceSha256,
    model: value?.model,
  });
  if (
    !exact(result, ["id", "version", "sourceSha256", "model"]) ||
    !validId(result.id) ||
    typeof result.version !== "string" ||
    !result.version ||
    typeof result.sourceSha256 !== "string" ||
    !/^[a-f0-9]{64}$/i.test(result.sourceSha256) ||
    !object(result.model)
  )
    invalid();
  return result;
}
function startInfo(value) {
  if (
    !exact(value, ["runId", "command", "recipe", "startedAt", "identity"]) ||
    !validId(value.runId) ||
    !(value.command === null || validCommand(value.command)) ||
    typeof value.recipe !== "boolean" ||
    !validTime(value.startedAt) ||
    !object(value.identity)
  )
    invalid();
  return jsonCopy(value);
}
function effectInfo(value) {
  if (
    !exact(value, ["runId", "command", "effectIndex"]) ||
    !validId(value.runId) ||
    !validCommand(value.command) ||
    !Number.isSafeInteger(value.effectIndex) ||
    value.effectIndex < 1
  )
    invalid();
  return jsonCopy(value);
}
function finalInfo(value) {
  if (
    !exact(value, ["runId", "report"]) ||
    !validId(value.runId) ||
    value.report?.format !== "browser-driver-report/1" ||
    value.report.runId !== value.runId ||
    value.report.lastResult?.runId !== value.runId ||
    !["completed", "failed", "rejected", "stopped"].includes(
      value.report.lastResult.execution,
    ) ||
    !object(value.report.lastResult.effect) ||
    !object(value.report.identity) ||
    !Array.isArray(value.report.events) ||
    !Array.isArray(value.report.resources) ||
    !object(value.report.eventRange)
  )
    invalid();
  return jsonCopy(value);
}
function encode(record) {
  const bytes = Buffer.from(JSON.stringify(record) + "\n");
  if (bytes.length > MAX_RECORD_BYTES) invalid("journal_limit");
  return bytes;
}

/** One local writer per registered project. Existing locks require explicit owner recovery. */
export async function openRunJournal({
  workspace,
  installation,
  managedOwner,
}) {
  const info = workspaceInfo(workspace);
  const installed = installationInfo(installation);
  if (
    managedOwner !== undefined &&
    (!exact(managedOwner, ["childToken", "installationId"]) ||
      !validId(managedOwner.childToken) ||
      managedOwner.installationId !== installed.id)
  )
    invalid();
  const processOwner = await captureProcessOwner();
  await info.assertCompatible();
  const dirIdentity = await directory(info.directory, true);
  // Persist the directory entries needed to find a synced run after replacement.
  for (const path of [
    info.directory,
    dirname(info.directory),
    dirname(dirname(info.directory)),
    info.root,
  ])
    await syncDirectory(path);
  await info.assertCompatible();
  const lockPath = join(info.directory, "writer.lock");
  const lockBytes = Buffer.from(
    JSON.stringify({
      format: "daedlo-run-journal-lock/2",
      workspaceId: info.id,
      projectId: info.projectId,
      token: randomUUID(),
      pid: process.pid,
      hostname: hostname(),
      owner: processOwner,
      ...(managedOwner ? { managed: structuredClone(managedOwner) } : {}),
    }) + "\n",
  );
  const temporaryLock = join(info.directory, `.writer-${randomUUID()}.tmp`);
  let lock,
    lockIdentity,
    published = false;
  try {
    lock = await fs.open(
      temporaryLock,
      constants.O_RDWR |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    lockIdentity = await lock.stat({ bigint: true });
    await lock.writeFile(lockBytes);
    await lock.sync();
    await fs.link(temporaryLock, lockPath);
    published = true;
    await syncDirectory(info.directory);
    await unlinkOwned(temporaryLock, lockIdentity, dirIdentity);
  } catch (error) {
    let cleanupFailed = false;
    if (published) {
      try {
        await unlinkOwned(lockPath, lockIdentity, dirIdentity);
        await syncDirectory(info.directory);
      } catch {
        cleanupFailed = true;
      }
    }
    if (lock) {
      try {
        await unlinkOwned(temporaryLock, lockIdentity, dirIdentity);
      } catch (cleanup) {
        if (cleanup.code !== "ENOENT") cleanupFailed = true;
      }
      try {
        await lock.close();
      } catch {
        cleanupFailed = true;
      }
    }
    if (cleanupFailed)
      throw Object.assign(
        Error(
          "Run-journal initialization failed and its owned lock cleanup is incomplete.",
        ),
        {
          code: "journal_cleanup_incomplete",
          retainedPath: temporaryLock,
          lockPath,
        },
      );
    if (!published && error.code === "EEXIST")
      fail(
        "journal_locked",
        "Another or interrupted run-journal writer owns this project. Inspect the owner before explicitly recovering its lock.",
      );
    throw publicError(error);
  }
  let queue = Promise.resolve(),
    active = null,
    pending = null,
    failure = null,
    closed = false,
    lockReleased = false,
    retiredHandle = null;
  const serialized = (work) => {
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  };
  async function assertOwned() {
    await info.assertCompatible();
    const currentDirectory = await directory(info.directory);
    if (!sameFile(currentDirectory, dirIdentity))
      invalid("journal_ownership_changed");
    let current;
    try {
      current = await smallFile(lockPath, 8192);
    } catch {
      invalid("journal_ownership_changed");
    }
    if (
      !sameFile(current.stat, lockIdentity) ||
      !current.bytes.equals(lockBytes)
    )
      invalid("journal_ownership_changed");
    if (active?.handle) {
      const currentFile = await fs.lstat(active.path, { bigint: true });
      if (!currentFile.isFile() || !sameFile(currentFile, active.fileIdentity))
        invalid("journal_ownership_changed");
      const stat = await active.handle.stat({ bigint: true });
      if (
        stat.size < active.offset ||
        stat.size > active.offset + (pending?.bytes.length ?? 0) ||
        (await prefixHash(active.handle, active.offset)) !==
          active.committedHash
      )
        invalid("journal_corrupt");
    }
  }
  function ready() {
    if (closed || lockReleased)
      fail("journal_closed", "The run-journal writer is closed.");
    if (failure || pending) invalid("journal_pending");
  }
  async function checked(work) {
    ready();
    try {
      return await work();
    } catch (error) {
      failure = publicError(error);
      throw failure;
    }
  }
  function prepare(type, payload) {
    const record = {
      format: FORMAT,
      workspaceId: info.id,
      projectId: info.projectId,
      runId: active.runId,
      sequence: active.sequence + 1,
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
      type,
      payload,
    };
    const bytes = encode(record);
    if (active.offset + bytes.length > MAX_RUN_BYTES) invalid("journal_limit");
    pending = { record, bytes, offset: active.offset };
  }
  async function persist() {
    await assertOwned();
    if (retiredHandle) {
      await retiredHandle.close();
      retiredHandle = null;
    }
    if (!active.handle) {
      try {
        active.handle = await fs.open(
          active.path,
          constants.O_RDWR |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
      } catch (error) {
        if (error.code === "EEXIST" || error.code === "ELOOP")
          fail(
            "journal_exists",
            "A journal already occupies this run identity; its data was preserved.",
          );
        throw error;
      }
      active.fileIdentity = await active.handle.stat({ bigint: true });
    }
    const current = await fs.lstat(active.path, { bigint: true });
    if (!current.isFile() || !sameFile(current, active.fileIdentity))
      invalid("journal_ownership_changed");
    const stat = await active.handle.stat({ bigint: true });
    if (
      stat.size < pending.offset ||
      stat.size > pending.offset + pending.bytes.length
    )
      invalid("journal_corrupt");
    // A retry can only complete the unchanged prefix of its own encoded event.
    let offset = Number(stat.size) - pending.offset;
    const prefix = await readExactly(active.handle, offset, pending.offset);
    if (!prefix.equals(pending.bytes.subarray(0, offset)))
      invalid("journal_corrupt");
    while (offset < pending.bytes.length) {
      const { bytesWritten } = await active.handle.write(
        pending.bytes,
        offset,
        pending.bytes.length - offset,
        pending.offset + offset,
      );
      if (!bytesWritten) throw Error("No write progress");
      offset += bytesWritten;
    }
    await active.handle.sync();
    if (pending.record.sequence === 1) await syncDirectory(info.directory);
    await assertOwned();
    const after = await fs.lstat(active.path, { bigint: true });
    if (
      !sameFile(after, active.fileIdentity) ||
      after.size !== BigInt(pending.offset + pending.bytes.length)
    )
      invalid("journal_ownership_changed");
    const committedHash = await prefixHash(
      active.handle,
      active.offset,
      pending.bytes,
    );
    if ((await prefixHash(active.handle, Number(after.size))) !== committedHash)
      invalid("journal_corrupt");
    active.offset += pending.bytes.length;
    active.committedHash = committedHash;
    active.sequence = pending.record.sequence;
    if (pending.record.type === "effect_intent")
      active.effectIndex = pending.record.payload.effectIndex;
    if (pending.record.type === "run_finished") {
      active.finished = true;
      active.report = pending.record.payload.report;
    }
    pending = null;
    failure = null;
  }
  async function releaseRun() {
    if (retiredHandle) {
      await retiredHandle.close();
      retiredHandle = null;
    }
    if (active?.handle) {
      await active.handle.close();
      active.handle = null;
    }
  }
  async function completeRelease() {
    // The name has already been removed: never touch a replacement writer's lock.
    await syncDirectory(info.directory);
    await lock.close();
    closed = true;
    failure = null;
  }
  const api = {
    begin(value) {
      return serialized(() =>
        checked(async () => {
          const start = startInfo(value);
          if (active && !active.finished)
            fail(
              "journal_active",
              "The previous run has no durable final report.",
            );
          // Size validation must not reserve the run identity when the request is invalid.
          const payload = {
            command: start.command,
            recipe: start.recipe,
            startedAt: start.startedAt,
            identity: start.identity,
            installation: installed,
          };
          encode({
            format: FORMAT,
            workspaceId: info.id,
            projectId: info.projectId,
            runId: start.runId,
            sequence: 1,
            eventId: randomUUID(),
            timestamp: new Date().toISOString(),
            type: "run_started",
            payload,
          });
          retiredHandle = active?.handle ?? null;
          active = {
            runId: start.runId,
            path: join(info.directory, start.runId + ".jsonl"),
            sequence: 0,
            offset: 0,
            committedHash: createHash("sha256").digest("hex"),
            effectIndex: 0,
            handle: null,
            finished: false,
          };
          prepare("run_started", payload);
          await persist();
        }),
      );
    },
    beforeEffect(value) {
      return serialized(() =>
        checked(async () => {
          const effect = effectInfo(value);
          if (
            !active ||
            active.finished ||
            active.runId !== effect.runId ||
            effect.effectIndex !== active.effectIndex + 1
          )
            invalid();
          prepare("effect_intent", {
            command: effect.command,
            effectIndex: effect.effectIndex,
          });
          await persist();
        }),
      );
    },
    finish(value) {
      return serialized(() =>
        checked(async () => {
          const final = finalInfo(value);
          if (!active || active.runId !== final.runId) invalid();
          if (active.finished) {
            await assertOwned();
            if (!isDeepStrictEqual(active.report, final.report))
              fail(
                "journal_conflict",
                "A different final report already owns this run identity.",
              );
            return;
          }
          prepare("run_finished", { report: final.report });
          await persist();
        }),
      );
    },
    status() {
      return {
        directory: info.directory,
        activeRunId: active?.runId ?? null,
        pending: pending ? 1 : 0,
        failed: failure ? 1 : 0,
        locked: !closed && !lockReleased,
        cleanupPending: lockReleased && !closed,
        ...(failure
          ? { error: { code: failure.code, message: failure.message } }
          : {}),
      };
    },
    retry() {
      return serialized(async () => {
        if (closed) return;
        try {
          if (lockReleased) return await completeRelease();
          await assertOwned();
          if (pending) await persist();
          failure = null;
        } catch (error) {
          failure = publicError(error);
          throw failure;
        }
      });
    },
    close() {
      return serialized(async () => {
        if (closed) return;
        if (!lockReleased) ready();
        try {
          if (lockReleased) return await completeRelease();
          await assertOwned();
          await releaseRun();
          await unlinkOwned(lockPath, lockIdentity, dirIdentity);
          lockReleased = true;
          await completeRelease();
        } catch (error) {
          failure = publicError(error);
          throw failure;
        }
      });
    },
  };
  return api;
}

// Internal storage primitives shared with explicit recovery. Recovery never opens
// a journal for writing and uses the same workspace and ancestor checks.
export const journalFilesystem = Object.freeze({
  workspaceInfo,
  directory,
  smallFile,
  syncDirectory,
  sameFile,
  unlinkOwned,
});

function validateRecord(record, info, runId, sequence, seen, state) {
  if (record?.format !== FORMAT)
    fail(
      "journal_incompatible",
      "This run-journal format is unsupported; use compatible tools.",
    );
  if (
    !exact(record, [
      "format",
      "workspaceId",
      "projectId",
      "runId",
      "sequence",
      "eventId",
      "timestamp",
      "type",
      "payload",
    ]) ||
    record.workspaceId !== info.id ||
    record.projectId !== info.projectId ||
    record.runId !== runId ||
    record.sequence !== sequence ||
    !validId(record.eventId) ||
    seen.has(record.eventId) ||
    !validTime(record.timestamp) ||
    state.finished
  )
    invalid("journal_corrupt");
  seen.add(record.eventId);
  try {
    if (record.type === "run_started" && sequence === 1) {
      if (
        !exact(record.payload, [
          "command",
          "recipe",
          "startedAt",
          "identity",
          "installation",
        ])
      )
        invalid();
      const { installation, ...start } = record.payload;
      startInfo({ runId, ...start });
      if (!exact(installation, ["id", "version", "sourceSha256", "model"]))
        invalid();
      installationInfo(installation);
    } else if (record.type === "effect_intent" && sequence > 1) {
      effectInfo({ runId, ...record.payload });
      if (
        !exact(record.payload, ["command", "effectIndex"]) ||
        record.payload.effectIndex !== state.effectIndex + 1
      )
        invalid();
      state.effectIndex++;
    } else if (record.type === "run_finished" && sequence > 1) {
      if (!exact(record.payload, ["report"])) invalid();
      finalInfo({ runId, report: record.payload.report });
      state.finished = true;
      state.report = record.payload.report;
    } else invalid();
  } catch {
    invalid("journal_corrupt");
  }
}

/** A bounded snapshot of one run. Reading never acquires a writer lock or starts a browser. */
export async function readRunJournal({ workspace, runId }) {
  const info = workspaceInfo(workspace);
  if (!validId(runId)) invalid();
  await info.assertCompatible();
  const identity = await directory(info.directory);
  const path = join(info.directory, runId + ".jsonl");
  const before = await fs.lstat(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink())
    invalid("journal_ownership_changed");
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes, fileIdentity;
  try {
    fileIdentity = await handle.stat({ bigint: true });
    if (!fileIdentity.isFile() || !sameFile(before, fileIdentity))
      invalid("journal_ownership_changed");
    if (fileIdentity.size > MAX_RUN_BYTES) invalid("journal_limit");
    bytes = await readExactly(handle, Number(fileIdentity.size));
  } finally {
    await handle.close();
  }
  await info.assertCompatible();
  if (
    !sameFile(await directory(info.directory), identity) ||
    !sameFile(await fs.lstat(path, { bigint: true }), fileIdentity)
  )
    invalid("journal_ownership_changed");
  const events = [],
    seen = new Set(),
    state = { effectIndex: 0, finished: false, report: null };
  let position = 0;
  while (position < bytes.length) {
    const newline = bytes.indexOf(10, position);
    if (newline === -1) break;
    if (newline - position + 1 > MAX_RECORD_BYTES) invalid("journal_limit");
    let record;
    try {
      record = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          bytes.subarray(position, newline),
        ),
      );
    } catch {
      invalid("journal_corrupt");
    }
    validateRecord(record, info, runId, events.length + 1, seen, state);
    events.push(record);
    position = newline + 1;
  }
  const partialTail = position !== bytes.length;
  if (bytes.length - position > MAX_RECORD_BYTES) invalid("journal_limit");
  const finished = state.finished && !partialTail;
  return {
    format: FORMAT,
    workspaceId: info.id,
    projectId: info.projectId,
    runId,
    status: finished ? "finished" : "incomplete",
    liveState: "unknown",
    historyComplete: finished,
    partialTail,
    events,
    report: finished ? state.report : null,
    ...(finished
      ? {}
      : {
          recovery: {
            execution: "interrupted",
            effect: { status: "uncertain" },
          },
        }),
  };
}
