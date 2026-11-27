import fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  captureProcessOwner,
  inspectProcessOwner,
  isProcessOwnerRecord,
} from "./process-owner.mjs";
import { journalFilesystem } from "./run-journal.mjs";

const {
  workspaceInfo,
  directory,
  smallFile,
  syncDirectory,
  sameFile,
  unlinkOwned,
} = journalFilesystem;
const MAX_METADATA = 16384;
const MAX_CLAIMS = 256;
const MAX_RECOVERIES = 1024;
const MAX_TRANSACTION_FILES = 4096;
const safeId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) =>
  object(value) &&
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const encoded = (value) => Buffer.from(JSON.stringify(value) + "\n");
function fail(code, message) {
  throw Object.assign(Error(message), { code });
}
const corrupt = () =>
  fail(
    "journal_recovery_corrupt",
    "Recovery records changed or are inconsistent; all retained evidence was preserved.",
  );
function validExpected(value) {
  return (
    exact(value, ["token", "sha256", "dev", "ino"]) &&
    safeId(value.token) &&
    typeof value.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(value.sha256) &&
    [value.dev, value.ino].every(
      (part) => typeof part === "string" && /^\d+$/.test(part),
    )
  );
}
function parseLock(bytes, info) {
  let record;
  try {
    record = JSON.parse(bytes);
  } catch {
    corrupt();
  }
  if (!object(record)) corrupt();
  const keys = [
    "format",
    "workspaceId",
    "projectId",
    "token",
    "pid",
    "hostname",
  ];
  if (record.format === "daedlo-run-journal-lock/2") {
    keys.push("owner");
    if (Object.hasOwn(record, "managed")) keys.push("managed");
  } else if (record.format !== "daedlo-run-journal-lock/1")
    fail(
      "journal_recovery_incompatible",
      "This writer lock format is unsupported; compatible recovery tools are required.",
    );
  if (
    !exact(record, keys) ||
    record.workspaceId !== info.id ||
    record.projectId !== info.projectId ||
    !safeId(record.token) ||
    !Number.isSafeInteger(record.pid) ||
    record.pid < 1 ||
    typeof record.hostname !== "string" ||
    record.hostname.length > 1024 ||
    (record.format.endsWith("/2") &&
      (!object(record.owner) || record.owner.pid !== record.pid)) ||
    (Object.hasOwn(record, "managed") &&
      (!exact(record.managed, ["childToken", "installationId"]) ||
        !safeId(record.managed.childToken) ||
        !safeId(record.managed.installationId)))
  )
    corrupt();
  return record;
}
async function readLock(info) {
  const path = join(info.directory, "writer.lock");
  let file;
  try {
    file = await smallFile(path, 8192);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const stat = await fs.lstat(path, { bigint: true });
  if (
    stat.dev.toString() !== String(file.stat.dev) ||
    stat.ino.toString() !== String(file.stat.ino)
  )
    corrupt();
  const writer = parseLock(file.bytes, info);
  return {
    writer,
    bytes: file.bytes,
    identity: stat,
    expected: {
      token: writer.token,
      sha256: digest(file.bytes),
      dev: stat.dev.toString(),
      ino: stat.ino.toString(),
    },
  };
}
async function optionalBytes(path, limit = MAX_METADATA) {
  try {
    return (await smallFile(path, limit)).bytes;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function jsonFile(path) {
  const bytes = await optionalBytes(path);
  if (!bytes) return null;
  try {
    return { value: JSON.parse(bytes), bytes };
  } catch {
    corrupt();
  }
}
async function boundedNames(path, limit) {
  const names = [];
  for await (const entry of await fs.opendir(path)) {
    if (names.length >= limit)
      fail(
        "journal_recovery_limit",
        "Recovery inspection exceeded its bounded file count.",
      );
    names.push(entry.name);
  }
  return names;
}
function baseRecord(info, expected) {
  return {
    workspaceId: info.id,
    projectId: info.projectId,
    recoveryId: expected.token,
    expected,
  };
}
function transactionRecord(info, expected) {
  return { format: "daedlo-journal-recovery/1", ...baseRecord(info, expected) };
}
function phaseRecord(info, expected, phase, claim) {
  return {
    format: "daedlo-journal-recovery-receipt/1",
    ...baseRecord(info, expected),
    phase,
    ...(phase === "released"
      ? {
          finalClaim: {
            sequence: claim.value.sequence,
            sha256: digest(claim.bytes),
          },
        }
      : {}),
  };
}
function recoveryDirectory(info, expected) {
  return join(info.directory, "recoveries", expected.token);
}

// Publish complete immutable records without replacing a competing publisher.
async function publish(path, bytes, { identical = true } = {}) {
  if (bytes.length > MAX_METADATA) corrupt();
  const temporary = path + "." + randomUUID() + ".tmp";
  const parentIdentity = await directory(join(path, ".."));
  let handle,
    identity,
    originalError,
    linked = false;
  try {
    handle = await fs.open(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    identity = await handle.stat({ bigint: true });
    await handle.writeFile(bytes);
    await handle.sync();
    try {
      await fs.link(temporary, path);
      linked = true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const current = await optionalBytes(path);
      if (!identical || !current?.equals(bytes))
        fail(
          "journal_recovery_busy",
          "Another recovery claim owns this transaction; inspect it before retrying.",
        );
    }
    await syncDirectory(join(path, ".."));
  } catch (error) {
    originalError = error;
  }
  let cleanupFailed = false;
  try {
    await handle?.close();
  } catch {
    cleanupFailed = true;
  }
  if (handle) {
    try {
      await unlinkOwned(temporary, identity, parentIdentity);
    } catch (error) {
      if (error.code !== "ENOENT") cleanupFailed = true;
    }
  }
  if (cleanupFailed)
    throw Object.assign(
      Error(
        "Recovery retained an owned temporary file after incomplete cleanup.",
      ),
      { code: "journal_cleanup_incomplete", retainedPath: temporary },
    );
  if (originalError) throw originalError;
  return linked;
}
async function transaction(info, expected) {
  const root = recoveryDirectory(info, expected);
  try {
    await directory(root);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const meta = await jsonFile(join(root, "transaction.json"));
  const prepared = await jsonFile(join(root, "prepared.json"));
  const released = await jsonFile(join(root, "released.json"));
  if (!meta) {
    if (prepared || released || (await claims(root, expected))) corrupt();
    return { directory: root, partial: true };
  }
  if (!isDeepStrictEqual(meta.value, transactionRecord(info, expected)))
    corrupt();
  const original = await optionalBytes(join(root, "original.lock"), 8192);
  if (!original) {
    if (prepared || released || (await claims(root, expected))) corrupt();
    return { directory: root, partial: true };
  }
  if (digest(original) !== expected.sha256) corrupt();
  const writer = parseLock(original, info);
  if (writer.token !== expected.token) corrupt();
  const latestClaim =
    prepared || released ? await claims(root, expected) : null;
  if ((prepared || released) && !latestClaim) corrupt();
  for (const [record, phase] of [
    [prepared, "prepared"],
    [released, "released"],
  ])
    if (
      record &&
      !isDeepStrictEqual(
        record.value,
        phaseRecord(info, expected, phase, latestClaim),
      )
    )
      corrupt();
  if (released && !prepared) corrupt();
  return {
    directory: root,
    writer,
    original,
    prepared: Boolean(prepared),
    released: Boolean(released),
  };
}

/** Verify immutable release evidence before accepting a coordinator's retired owner. */
export async function verifyReleasedRunJournalRecovery({
  workspace,
  expected,
}) {
  const info = workspaceInfo(workspace);
  if (!validExpected(expected))
    fail(
      "journal_recovery_request",
      "Release verification requires an exact recovery identity.",
    );
  await info.assertCompatible();
  const tx = await transaction(info, expected);
  return Boolean(tx && !tx.partial && tx.released);
}
async function claims(root, expected) {
  const entries = await boundedNames(root, MAX_TRANSACTION_FILES);
  const names = entries
    .filter((name) => /^claim-\d{6}\.json$/.test(name))
    .sort();
  if (names.length > MAX_CLAIMS)
    fail(
      "journal_recovery_limit",
      "This recovery reached its bounded claim limit; retained evidence requires inspection.",
    );
  let previous = null;
  for (let index = 0; index < names.length; index++) {
    if (names[index] !== `claim-${String(index + 1).padStart(6, "0")}.json`)
      corrupt();
    const file = await jsonFile(join(root, names[index]));
    const record = file?.value;
    if (
      !exact(record, [
        "format",
        "recoveryId",
        "expected",
        "sequence",
        "previousSha256",
        "claimant",
      ]) ||
      record.format !== "daedlo-journal-recovery-claim/1" ||
      record.recoveryId !== expected.token ||
      !isDeepStrictEqual(record.expected, expected) ||
      record.sequence !== index + 1 ||
      record.previousSha256 !== (previous ? digest(previous.bytes) : null) ||
      !isProcessOwnerRecord(record.claimant, { requireHost: true })
    )
      corrupt();
    previous = file;
  }
  return previous;
}
async function acquireClaim(root, expected, owner) {
  const previous = await claims(root, expected);
  if (previous && isDeepStrictEqual(previous.value.claimant, owner))
    return previous;
  if (
    previous &&
    (await inspectProcessOwner(previous.value.claimant)).state !== "dead"
  )
    fail(
      "journal_recovery_busy",
      "A live or unverified recovery owner retains this transaction.",
    );
  const sequence = (previous?.value.sequence ?? 0) + 1;
  if (sequence > MAX_CLAIMS)
    fail(
      "journal_recovery_limit",
      "This recovery reached its bounded claim limit; retained evidence requires inspection.",
    );
  const value = {
    format: "daedlo-journal-recovery-claim/1",
    recoveryId: expected.token,
    expected,
    sequence,
    previousSha256: previous ? digest(previous.bytes) : null,
    claimant: owner,
  };
  const bytes = encoded(value);
  await publish(
    join(root, `claim-${String(sequence).padStart(6, "0")}.json`),
    bytes,
    { identical: false },
  );
  return { value, bytes };
}
async function assertClaim(root, expected, claim) {
  const latest = await claims(root, expected);
  if (!latest?.bytes.equals(claim.bytes)) corrupt();
}
async function ownerState(writer) {
  return writer.format.endsWith("/2")
    ? inspectProcessOwner(writer.owner)
    : { state: "unknown", reason: "legacy_owner_requires_exit_witness" };
}
async function proveDead(writer, expected, legacyExitProof) {
  const state = await ownerState(writer);
  if (state.state === "dead") return;
  if (writer.format.endsWith("/1") && typeof legacyExitProof === "function") {
    const proof = await legacyExitProof({
      writer: structuredClone(writer),
      expected: structuredClone(expected),
    });
    if (
      exact(proof, ["exited", "pid", "token"]) &&
      proof.exited === true &&
      proof.pid === writer.pid &&
      proof.token === writer.token
    )
      return;
  }
  fail(
    state.state === "live" ? "journal_owner_live" : "journal_owner_unknown",
    "The original writer has not been independently proved exited in this process namespace; ownership was preserved.",
  );
}
function result(info, expected, tx, status) {
  return {
    status,
    recoveryId: expected.token,
    directory: tx.directory,
    expected: structuredClone(expected),
    writer: structuredClone(tx.writer),
    historyUnchanged: true,
    applicationEffects: "unresolved",
    resourceCleanup: "unknown",
  };
}

/** Read-only ownership inspection. Missing/foreign/legacy identity never implies death. */
export async function inspectRunJournalRecovery({ workspace }) {
  const info = workspaceInfo(workspace);
  await info.assertCompatible();
  try {
    await directory(info.directory);
  } catch (error) {
    if (error.code === "ENOENT")
      return {
        status: "unlocked",
        writer: null,
        expected: null,
        recoveryId: null,
      };
    throw error;
  }
  let current;
  try {
    current = await readLock(info);
  } catch (error) {
    if (/^(journal_|workspace_)/.test(error.code ?? ""))
      return {
        status: "unknown",
        writer: null,
        expected: null,
        recoveryId: null,
        reason: error.code,
      };
    throw error;
  }
  if (current) {
    const state = await ownerState(current.writer);
    const tx = await transaction(info, current.expected);
    if (tx?.released) corrupt();
    const claim =
      tx && !tx.partial ? await claims(tx.directory, current.expected) : null;
    const claimantState = claim
      ? await inspectProcessOwner(claim.value.claimant)
      : null;
    return {
      status:
        claim && claimantState.state !== "dead" ? "recovering" : state.state,
      writer: current.writer,
      expected: current.expected,
      recoveryId: current.writer.token,
      reason: state.reason,
      ...(tx ? { directory: tx.directory } : {}),
    };
  }
  // A claimant may have died after unlink but before committing its final receipt.
  const recoveryRoot = join(info.directory, "recoveries");
  let names;
  try {
    await directory(recoveryRoot);
    names = await boundedNames(recoveryRoot, MAX_RECOVERIES);
  } catch (error) {
    if (error.code === "ENOENT")
      return {
        status: "unlocked",
        writer: null,
        expected: null,
        recoveryId: null,
      };
    throw error;
  }
  if (names.length > MAX_RECOVERIES)
    fail(
      "journal_recovery_limit",
      "Recovery inspection exceeded its bounded transaction count.",
    );
  const found = [];
  for (const name of names) {
    if (!safeId(name)) continue;
    await directory(join(recoveryRoot, name));
    const meta = await jsonFile(join(recoveryRoot, name, "transaction.json"));
    if (!meta) continue;
    if (
      !validExpected(meta.value?.expected) ||
      meta.value.expected.token !== name
    )
      corrupt();
    const tx = await transaction(info, meta.value.expected);
    if (tx && !tx.partial && tx.prepared)
      found.push({ tx, expected: meta.value.expected });
  }
  const unresolved = found.filter(({ tx }) => !tx.released);
  const selected =
    unresolved.length === 1
      ? unresolved[0]
      : found.length === 1
        ? found[0]
        : null;
  if (!selected)
    return {
      status: unresolved.length ? "unknown" : "unlocked",
      writer: null,
      expected: null,
      recoveryId: null,
      ...(unresolved.length
        ? {
            reason: "multiple_recoveries",
            recoveries: unresolved.map(({ expected }) => ({
              recoveryId: expected.token,
              expected,
            })),
          }
        : {}),
    };
  return {
    status: selected.tx.released ? "recovered" : "recovering",
    writer: selected.tx.writer,
    expected: selected.expected,
    recoveryId: selected.expected.token,
    directory: selected.tx.directory,
  };
}

// One module/process serializes its attempts; immutable claim slots coordinate
// other processes and preserve proof when a claimant itself exits unexpectedly.
const queueKey = Symbol.for("daedlo.journal-recovery.queues");
const queues = (globalThis[queueKey] ??= new Map());
function serialize(key, callback) {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(callback);
  queues.set(key, next);
  next
    .finally(() => {
      if (queues.get(key) === next) queues.delete(key);
    })
    .catch(() => {});
  return next;
}

/** Retire proven dead writer ownership. This operation never writes run journals. */
export function recoverRunJournal({
  workspace,
  expected,
  legacyExitProof,
  beforeRelease = async () => {},
}) {
  const info = workspaceInfo(workspace);
  if (!validExpected(expected) || typeof beforeRelease !== "function")
    fail(
      "journal_recovery_request",
      "Recovery requires the exact inspected writer identity and a valid coordinator.",
    );
  expected = structuredClone(expected);
  return serialize(info.directory, async () => {
    try {
      await info.assertCompatible();
      const journalIdentity = await directory(info.directory);
      let tx = await transaction(info, expected);
      const current = await readLock(info);
      const matching = current && isDeepStrictEqual(current.expected, expected);
      if (tx?.released) {
        if (matching) corrupt();
        // Publication can be visible even when a prior directory sync failed.
        // Retry only these barriers, never the coordinator or a replacement lock.
        await syncDirectory(tx.directory);
        await syncDirectory(info.directory);
        return result(info, expected, tx, "already_recovered");
      }
      if (!matching && !tx?.prepared)
        fail(
          "journal_recovery_changed",
          "The writer changed since inspection; no replacement ownership was modified.",
        );
      const writer = tx?.writer ?? current?.writer;
      if (!writer) corrupt();
      if (!tx?.prepared) await proveDead(writer, expected, legacyExitProof);
      const owner = await captureProcessOwner();
      if (!owner.host)
        fail(
          "journal_owner_unknown",
          "This recovery process lacks a verified local process identity.",
        );
      const root = recoveryDirectory(info, expected);
      const rootIdentity = await directory(root, true);
      const assertDirectories = async () => {
        await info.assertCompatible();
        if (
          !sameFile(journalIdentity, await directory(info.directory)) ||
          !sameFile(rootIdentity, await directory(root))
        )
          fail(
            "journal_ownership_changed",
            "Recovery storage ownership changed; retained evidence requires inspection.",
          );
      };
      await assertDirectories();
      await publish(
        join(root, "transaction.json"),
        encoded(transactionRecord(info, expected)),
      );
      await publish(join(root, "original.lock"), tx?.original ?? current.bytes);
      await syncDirectory(join(root, ".."));
      await syncDirectory(info.directory);
      tx = await transaction(info, expected);
      if (!tx || tx.partial) corrupt();
      const claim = await acquireClaim(root, expected, owner);
      await publish(
        join(root, "prepared.json"),
        encoded(phaseRecord(info, expected, "prepared")),
      );
      await assertDirectories();
      await beforeRelease({ recoveryId: expected.token, directory: root });
      await assertDirectories();
      const verified = await transaction(info, expected);
      if (
        !verified ||
        verified.partial ||
        !verified.prepared ||
        verified.released
      )
        corrupt();
      await assertClaim(root, expected, claim);
      const latest = await readLock(info);
      if (latest && isDeepStrictEqual(latest.expected, expected)) {
        await unlinkOwned(
          join(info.directory, "writer.lock"),
          latest.identity,
          journalIdentity,
        );
        // No subsequent operation targets writer.lock: a fresh writer can own it now.
      } else if (!tx.prepared && matching) {
        fail(
          "journal_recovery_changed",
          "The original writer lock changed before release; replacement ownership was preserved.",
        );
      }
      await syncDirectory(info.directory);
      await assertDirectories();
      await publish(
        join(root, "released.json"),
        encoded(phaseRecord(info, expected, "released", claim)),
      );
      return result(info, expected, tx, "recovered");
    } catch (error) {
      if (
        /^(journal_|workspace_)/.test(error?.code ?? "") ||
        [
          "recovery_changed",
          "recovery_blocked",
          "recovery_cleanup_incomplete",
        ].includes(error?.code)
      )
        throw error;
      fail(
        "journal_recovery_failed",
        "Recovery did not complete; original evidence and transaction records are retained for explicit retry.",
      );
    }
  });
}
