import fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { loadTools } from "./tools.mjs";

export const ARCHIVE_SCHEMA = `
CREATE TABLE archive_imports (target_id TEXT NOT NULL REFERENCES targets(id), run_id TEXT NOT NULL, import_id TEXT NOT NULL UNIQUE, identity_hash TEXT NOT NULL UNIQUE, source_hash TEXT NOT NULL UNIQUE, source_bytes BLOB NOT NULL, metadata TEXT NOT NULL, summary TEXT NOT NULL, sort_at TEXT NOT NULL, journal_checkpoint_hash TEXT, PRIMARY KEY(target_id,run_id)) STRICT;
CREATE INDEX archive_imports_recent ON archive_imports(target_id,sort_at DESC,run_id DESC);
`;

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_TARGET_BYTES = 256 * 1024 * 1024;
const SOURCE_FORMAT = {
  kind: "daedlo-managed-run",
  schemaVersion: 1,
  reportFormat: "browser-driver-report/1",
};
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) =>
  object(value) && Object.keys(value).sort().join() === [...keys].sort().join();
const id = (value) =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const integer = (value) => Number.isSafeInteger(value) && value > 0;
const text = (value, max = 256) =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= max &&
  !/[\u0000-\u001f\u007f-\u009f]/.test(value);
const time = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const digest = (value) => createHash("sha256").update(value).digest("hex");
const hash = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const model = (value) =>
  exact(value, ["id", "version"]) && text(value.id) && text(value.version);
const fail = (code = "archive_invalid", extra = {}) => {
  throw Object.assign(
    Error(
      {
        archive_invalid:
          "The managed completed report or explicit mapping is invalid.",
        archive_unsupported:
          "Only supported managed completed report archives can be imported.",
        archive_limit:
          "The archive import exceeds the supported size or count bound.",
        archive_conflict:
          "This run identity already has different recorded content. All original data was preserved.",
        archive_target_conflict:
          "This archive identity is already mapped to another target.",
        archive_source_changed:
          "The selected archive source changed or is not an owned regular file. Its contents were not modified.",
        archive_not_found:
          "The selected target has no imported report with this run identity.",
        archive_corrupt:
          "The retained import failed validation. Preserve its original data for inspection.",
        archive_storage: "The archive could not be read or retained.",
        archive_cleanup_incomplete:
          "An archive read handle could not close. Its exact handle is retained for explicit catalog-close retry.",
        target_changed:
          "The target registration changed; read its current revision before importing.",
      }[code] ?? "Archive import was refused.",
    ),
    { code, ...extra },
  );
};
const canonical = (value) => {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (object(value))
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + canonical(value[key]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
};
const semanticHash = (value) => digest(canonical(value));
function bounded(value) {
  const todo = [[value, 0]];
  let count = 0;
  while (todo.length) {
    const [current, depth] = todo.pop();
    if (++count > 100000 || depth > 64) fail("archive_limit");
    if (typeof current === "number" && !Number.isFinite(current)) fail();
    if (current && typeof current === "object")
      for (const child of Object.values(current)) todo.push([child, depth + 1]);
  }
}
function parseArchive(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_BYTES)
    fail("archive_limit");
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail();
  }
  bounded(value);
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    value.kind !== SOURCE_FORMAT.kind ||
    value.report?.format !== SOURCE_FORMAT.reportFormat
  )
    fail("archive_unsupported");
  if (
    !exact(value, [
      "schemaVersion",
      "kind",
      "installation",
      "recordedAt",
      "report",
    ]) ||
    !time(value.recordedAt)
  )
    fail();
  const installation = value.installation,
    report = value.report,
    result = report.lastResult;
  if (
    !object(installation) ||
    !id(installation.id) ||
    Object.keys(installation).some(
      (key) => !["id", "version", "sourceSha256", "model"].includes(key),
    ) ||
    (installation.version !== undefined && !text(installation.version)) ||
    (installation.sourceSha256 !== undefined &&
      !(
        typeof installation.sourceSha256 === "string" &&
        /^[a-f0-9]{64}$/i.test(installation.sourceSha256)
      )) ||
    (installation.model !== undefined && !model(installation.model))
  )
    fail();
  if (
    !object(report) ||
    !id(report.runId) ||
    !object(result) ||
    result.runId !== report.runId ||
    Object.hasOwn(report, "completedRunIds") ||
    Object.hasOwn(report, "finalization")
  )
    fail();
  if (
    (result.ok !== undefined && typeof result.ok !== "boolean") ||
    (result.execution !== undefined &&
      !["completed", "failed", "rejected", "stopped"].includes(
        result.execution,
      )) ||
    (result.command !== undefined &&
      result.command !== null &&
      !text(result.command, 4096)) ||
    (result.recipe !== undefined && typeof result.recipe !== "boolean") ||
    (result.startedAt !== undefined && !time(result.startedAt)) ||
    (result.finishedAt !== undefined && !time(result.finishedAt)) ||
    (result.startedAt &&
      result.finishedAt &&
      result.finishedAt < result.startedAt)
  )
    fail();
  if (
    result.effect !== undefined &&
    (!object(result.effect) ||
      !["saved", "uncertain", "rejected", "not_attempted"].includes(
        result.effect.status,
      ))
  )
    fail();
  if (report.identity !== undefined && !object(report.identity)) fail();
  if (
    report.identity?.model !== undefined &&
    (!model(report.identity.model) ||
      (installation.model &&
        !isDeepStrictEqual(report.identity.model, installation.model)))
  )
    fail();
  if (
    report.resources !== undefined &&
    (!Array.isArray(report.resources) ||
      report.resources.length > 1000 ||
      report.resources.some(
        (item) =>
          !object(item) ||
          !text(item.label, 4096) ||
          typeof item.owned !== "boolean" ||
          !text(item.status),
      ))
  )
    fail();
  if (report.events !== undefined) {
    if (!Array.isArray(report.events) || report.events.length > 200) fail();
    let previous = 0;
    for (const event of report.events) {
      if (
        !object(event) ||
        !integer(event.sequence) ||
        event.sequence <= previous ||
        event.runId !== report.runId ||
        !time(event.at) ||
        !text(event.type, 128)
      )
        fail();
      previous = event.sequence;
    }
  }
  if (report.eventRange !== undefined) {
    const range = report.eventRange;
    if (
      !exact(range, ["first", "last", "retainedFirst", "truncated"]) ||
      ![range.first, range.last, range.retainedFirst].every(integer) ||
      range.first > range.retainedFirst ||
      range.retainedFirst > range.last ||
      typeof range.truncated !== "boolean" ||
      range.truncated !== range.retainedFirst > range.first
    )
      fail();
    if (
      report.events?.length &&
      (range.retainedFirst !== report.events[0].sequence ||
        range.last !== report.events.at(-1).sequence)
    )
      fail();
  }
  return value;
}
function limitations(archive) {
  const { installation, report } = archive,
    result = ["completed_report_only"];
  if (!report.events?.length) result.push("event_history_missing");
  if (!report.eventRange) result.push("event_range_missing");
  else if (report.eventRange.truncated) result.push("events_truncated");
  for (const [field, code] of [
    ["version", "installation_version_missing"],
    ["sourceSha256", "installation_source_missing"],
    ["model", "installation_model_missing"],
  ])
    if (installation[field] === undefined) result.push(code);
  if (!report.identity) result.push("runtime_identity_missing");
  if (!report.resources) result.push("resources_missing");
  if (!report.lastResult.startedAt || !report.lastResult.finishedAt)
    result.push("run_timestamps_missing");
  if (report.lastResult.command === undefined) result.push("command_missing");
  return result;
}
function summaryFor(archive, importedAt, importId) {
  const result = archive.report.lastResult;
  return {
    runId: archive.report.runId,
    importId,
    sourceKind: "archive",
    archivedAt: archive.recordedAt,
    command: result.command ?? null,
    commandTruncated: false,
    recipe: result.recipe ?? false,
    startedAt: result.startedAt ?? null,
    finishedAt: result.finishedAt ?? null,
    status: "imported",
    execution: result.execution ?? "unknown",
    effect: { status: result.effect?.status ?? "uncertain" },
    eventCount: archive.report.events?.length ?? 0,
    historyComplete: false,
    reportTruncated: archive.report.eventRange?.truncated ?? null,
    indexedAt: importedAt,
  };
}
const identityHash = (archive) =>
  semanticHash({
    sourceFormat: "daedlo-managed-run/1",
    installationId: archive.installation.id,
    runId: archive.report.runId,
  });
function lightRow(row, { catalogId } = {}) {
  if (!row) fail("archive_not_found");
  try {
    const metadata = JSON.parse(row.metadata),
      summary = JSON.parse(row.summary),
      p = metadata.provenance;
    if (
      !exact(metadata, [
        "format",
        "catalogId",
        "targetId",
        "runId",
        "importId",
        "identityHash",
        "reportSha256",
        "summarySha256",
        "sourcePath",
        "sourceFileIdentity",
        "provenance",
      ]) ||
      metadata.format !== "daedlo-archive-import/1" ||
      !id(metadata.catalogId) ||
      (catalogId !== undefined && metadata.catalogId !== catalogId) ||
      metadata.targetId !== row.target_id ||
      metadata.runId !== row.run_id ||
      metadata.importId !== row.import_id ||
      ![row.target_id, row.run_id, row.import_id].every(id) ||
      !hash(row.identity_hash) ||
      metadata.identityHash !== row.identity_hash ||
      !hash(row.source_hash) ||
      !hash(metadata.reportSha256) ||
      !hash(metadata.summarySha256) ||
      !(
        row.journal_checkpoint_hash === null ||
        hash(row.journal_checkpoint_hash)
      )
    )
      fail("archive_corrupt");
    if (
      !text(metadata.sourcePath, 4096) ||
      !isAbsolute(metadata.sourcePath) ||
      resolve(metadata.sourcePath) !== metadata.sourcePath ||
      !exact(metadata.sourceFileIdentity, ["dev", "ino"]) ||
      ![metadata.sourceFileIdentity.dev, metadata.sourceFileIdentity.ino].every(
        (value) => typeof value === "string" && /^[0-9]{1,30}$/.test(value),
      )
    )
      fail("archive_corrupt");
    if (
      !exact(p, [
        "source",
        "installation",
        "recordedAt",
        "importedAt",
        "mapping",
        "limitations",
      ]) ||
      !exact(p.source, [
        "kind",
        "schemaVersion",
        "reportFormat",
        "sha256",
        "bytes",
        "fileName",
      ]) ||
      p.source.kind !== SOURCE_FORMAT.kind ||
      p.source.schemaVersion !== 1 ||
      p.source.reportFormat !== SOURCE_FORMAT.reportFormat ||
      p.source.sha256 !== row.source_hash ||
      !Number.isSafeInteger(p.source.bytes) ||
      p.source.bytes < 1 ||
      p.source.bytes > MAX_BYTES ||
      p.source.fileName !== basename(metadata.sourcePath) ||
      !time(p.recordedAt) ||
      !time(p.importedAt) ||
      !exact(p.mapping, ["kind", "targetId", "targetRevision"]) ||
      p.mapping.kind !== "explicit" ||
      p.mapping.targetId !== row.target_id ||
      !integer(p.mapping.targetRevision) ||
      !Array.isArray(p.limitations) ||
      p.limitations.length > 12 ||
      p.limitations[0] !== "completed_report_only"
    )
      fail("archive_corrupt");
    if (
      !object(summary) ||
      summary.runId !== row.run_id ||
      summary.importId !== row.import_id ||
      summary.sourceKind !== "archive" ||
      summary.status !== "imported" ||
      summary.historyComplete !== false ||
      semanticHash(summary) !== metadata.summarySha256 ||
      row.sort_at !== (summary.finishedAt ?? p.recordedAt)
    )
      fail("archive_corrupt");
    return { metadata, summary };
  } catch (error) {
    if (error.code === "archive_corrupt") throw error;
    fail("archive_corrupt");
  }
}
/** Lightweight derived history view. Full detail separately verifies original bytes. */
export function archiveSummary(row, options) {
  return structuredClone(lightRow(row, options).summary);
}
export function checkedArchiveRow(row, options) {
  const { metadata, summary } = lightRow(row, options);
  try {
    if (
      !(row.source_bytes instanceof Uint8Array) ||
      row.source_bytes.length !== metadata.provenance.source.bytes ||
      digest(row.source_bytes) !== row.source_hash
    )
      fail("archive_corrupt");
    const bytes = Buffer.from(row.source_bytes),
      archive = parseArchive(bytes),
      p = metadata.provenance;
    if (
      identityHash(archive) !== row.identity_hash ||
      archive.report.runId !== row.run_id ||
      semanticHash(archive.report) !== metadata.reportSha256 ||
      !isDeepStrictEqual(archive.installation, p.installation) ||
      archive.recordedAt !== p.recordedAt ||
      !isDeepStrictEqual(limitations(archive), p.limitations) ||
      !isDeepStrictEqual(
        summaryFor(archive, p.importedAt, row.import_id),
        summary,
      )
    )
      fail("archive_corrupt");
    return { metadata, archive, summary, bytes };
  } catch (error) {
    if (error.code === "archive_corrupt") throw error;
    fail("archive_corrupt");
  }
}
export function validateArchiveJournal(row, history, options) {
  const { archive } = checkedArchiveRow(row, options),
    first = history?.events?.[0];
  if (
    history?.targetId !== row.target_id ||
    history.runId !== row.run_id ||
    history.format !== "daedlo-run-journal/1" ||
    history.status !== "finished" ||
    first?.type !== "run_started" ||
    first.sequence !== 1 ||
    !isDeepStrictEqual(first.payload?.installation, archive.installation) ||
    !isDeepStrictEqual(history.report, archive.report)
  )
    fail("archive_conflict");
  return true;
}
const same = (a, b) => a && b && a.dev === b.dev && a.ino === b.ino;
const unchanged = (a, b) =>
  same(a, b) &&
  a.size === b.size &&
  a.mtimeNs === b.mtimeNs &&
  a.ctimeNs === b.ctimeNs &&
  b.nlink === 1n &&
  b.isFile() &&
  !b.isSymbolicLink();
const detailFor = (row) => {
  const { archive, metadata } = checkedArchiveRow(row);
  return {
    format: "daedlo-imported-report/1",
    targetId: row.target_id,
    runId: row.run_id,
    importId: row.import_id,
    status: "imported",
    historyComplete: false,
    liveState: "unknown",
    events: [],
    report: archive.report,
    provenance: metadata.provenance,
  };
};
export function createArchiveImports({
  catalogId,
  use,
  targetIn,
  getTarget,
  getRun,
  assertV3,
}) {
  const handles = new Set();
  async function closeHandle(handle) {
    await handle.close();
    handles.delete(handle);
  }
  async function readSource(path) {
    const { journalFilesystem: io } = await loadTools("run-journal");
    const parent = await io.directory(dirname(path));
    const before = await fs.lstat(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n)
      fail("archive_source_changed");
    if (before.size > BigInt(MAX_BYTES)) fail("archive_limit");
    const handle = await fs.open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    handles.add(handle);
    try {
      if (!unchanged(before, await handle.stat({ bigint: true })))
        fail("archive_source_changed");
      const bytes = Buffer.alloc(Number(before.size));
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(
          bytes,
          offset,
          bytes.length - offset,
          offset,
        );
        if (!bytesRead) fail("archive_source_changed");
        offset += bytesRead;
      }
      if (
        !unchanged(before, await handle.stat({ bigint: true })) ||
        !unchanged(before, await fs.lstat(path, { bigint: true })) ||
        !same(parent, await io.directory(dirname(path)))
      )
        fail("archive_source_changed");
      return { bytes, stat: before, parent };
    } finally {
      try {
        await closeHandle(handle);
      } catch {
        fail("archive_cleanup_incomplete", {
          retained: true,
          pendingHandles: handles.size,
        });
      }
    }
  }
  function assertCatalogRow(row) {
    const value = checkedArchiveRow(row);
    if (value.metadata.catalogId !== catalogId) fail("archive_corrupt");
    return value;
  }
  const resultFor = (row, imported) => ({
    targetId: row.target_id,
    runId: row.run_id,
    importId: row.import_id,
    imported,
    sourceKind: "archive",
    sourceSha256: row.source_hash,
    provenance: assertCatalogRow(row).metadata.provenance,
  });
  async function importManagedArchive(input = {}) {
    assertV3();
    if (
      !exact(input, ["targetId", "expectedTargetRevision", "sourceFile"]) ||
      !id(input.targetId) ||
      !integer(input.expectedTargetRevision) ||
      !text(input.sourceFile, 4096) ||
      !isAbsolute(input.sourceFile) ||
      resolve(input.sourceFile) !== input.sourceFile
    )
      fail();
    const { targetId, expectedTargetRevision, sourceFile } = input,
      target = await getTarget(targetId);
    if (target.id !== targetId || target.revision !== expectedTargetRevision)
      fail("target_changed");
    let source;
    try {
      source = await readSource(sourceFile);
    } catch (error) {
      if (error.code?.startsWith("archive_")) throw error;
      if (["ENOENT", "ELOOP", "journal_ownership_changed"].includes(error.code))
        fail("archive_source_changed");
      fail("archive_storage");
    }
    const archive = parseArchive(source.bytes),
      runId = archive.report.runId,
      sourceHash = digest(source.bytes),
      identity = identityHash(archive),
      importId = randomUUID(),
      importedAt = new Date().toISOString();
    const provenance = {
      source: {
        ...SOURCE_FORMAT,
        sha256: sourceHash,
        bytes: source.bytes.length,
        fileName: basename(sourceFile),
      },
      installation: archive.installation,
      recordedAt: archive.recordedAt,
      importedAt,
      mapping: {
        kind: "explicit",
        targetId,
        targetRevision: expectedTargetRevision,
      },
      limitations: limitations(archive),
    };
    const summary = summaryFor(archive, importedAt, importId),
      metadata = {
        format: "daedlo-archive-import/1",
        catalogId,
        targetId,
        runId,
        importId,
        identityHash: identity,
        reportSha256: semanticHash(archive.report),
        summarySha256: semanticHash(summary),
        sourcePath: sourceFile,
        sourceFileIdentity: {
          dev: String(source.stat.dev),
          ino: String(source.stat.ino),
        },
        provenance,
      };
    const row = {
      target_id: targetId,
      run_id: runId,
      import_id: importId,
      identity_hash: identity,
      source_hash: sourceHash,
      source_bytes: source.bytes,
      metadata: JSON.stringify(metadata),
      summary: JSON.stringify(summary),
      sort_at: summary.finishedAt ?? archive.recordedAt,
      journal_checkpoint_hash: null,
    };
    // Pin the projection observed before reading its journal. A first index or
    // replacement arriving during that read cannot silently hide this archive.
    const projectedBefore = await use(true, (db) =>
      db
        .prepare("SELECT * FROM runs WHERE target_id=? AND run_id=?")
        .get(targetId, runId),
    );
    let history;
    try {
      history = await getRun({ targetId, runId });
    } catch (error) {
      if (!["ENOENT", "journal_missing"].includes(error.code)) throw error;
    }
    if (history) validateArchiveJournal(row, history);
    const { journalFilesystem: io } = await loadTools("run-journal");
    try {
      if (
        !unchanged(source.stat, await fs.lstat(sourceFile, { bigint: true })) ||
        !same(source.parent, await io.directory(dirname(sourceFile)))
      )
        fail("archive_source_changed");
    } catch {
      fail("archive_source_changed");
    }
    return use(false, (db) => {
      if (!isDeepStrictEqual(targetIn(db, targetId), target))
        fail("target_changed");
      const projected = db
        .prepare("SELECT * FROM runs WHERE target_id=? AND run_id=?")
        .get(targetId, runId);
      if (!isDeepStrictEqual(projected, projectedBefore))
        fail("archive_conflict");
      const found = db
        .prepare(
          "SELECT * FROM archive_imports WHERE source_hash=? OR identity_hash=? OR (target_id=? AND run_id=?)",
        )
        .all(sourceHash, identity, targetId, runId);
      for (const existing of found) {
        const original = assertCatalogRow(existing);
        if (existing.target_id !== targetId) fail("archive_target_conflict");
        if (
          existing.run_id !== runId ||
          !isDeepStrictEqual(original.archive.report, archive.report) ||
          !isDeepStrictEqual(
            original.archive.installation,
            archive.installation,
          )
        )
          fail("archive_conflict");
      }
      if (found.length) {
        if (found.length !== 1) fail("archive_conflict");
        return resultFor(found[0], false);
      }
      const capacity = db
        .prepare(
          "SELECT count(*) AS count,coalesce(sum(length(source_bytes)),0) AS bytes FROM archive_imports WHERE target_id=?",
        )
        .get(targetId);
      const journalCount = db
        .prepare("SELECT count(*) AS count FROM runs WHERE target_id=?")
        .get(targetId).count;
      if (
        capacity.count + journalCount >= 10000 ||
        capacity.bytes + source.bytes.length > MAX_TARGET_BYTES
      )
        fail("archive_limit");
      if (history?.historyComplete === true && history.partialTail === false) {
        if (
          projected &&
          projected.source_hash === projected.checkpoint_hash &&
          projected.checkpoint_sequence === history.events.length &&
          JSON.parse(projected.summary).status === "finished"
        )
          row.journal_checkpoint_hash = projected.checkpoint_hash;
      }
      db.prepare(
        "INSERT INTO archive_imports(target_id,run_id,import_id,identity_hash,source_hash,source_bytes,metadata,summary,sort_at,journal_checkpoint_hash) VALUES(?,?,?,?,?,?,?,?,?,?)",
      ).run(
        row.target_id,
        row.run_id,
        row.import_id,
        row.identity_hash,
        row.source_hash,
        row.source_bytes,
        row.metadata,
        row.summary,
        row.sort_at,
        row.journal_checkpoint_hash,
      );
      db.prepare(
        "UPDATE history_state SET generation=generation+1 WHERE target_id=?",
      ).run(targetId);
      return resultFor(row, true);
    });
  }
  async function getImportedRun({ targetId, runId } = {}) {
    assertV3();
    if (!id(targetId) || !id(runId)) fail();
    return use(true, (db) => {
      targetIn(db, targetId);
      const row = db
        .prepare("SELECT * FROM archive_imports WHERE target_id=? AND run_id=?")
        .get(targetId, runId);
      assertCatalogRow(row);
      return detailFor(row);
    });
  }
  async function closeArchiveImports() {
    for (const handle of [...handles])
      try {
        await closeHandle(handle);
      } catch {
        /* Retain exact failed handle. */
      }
    if (handles.size)
      fail("archive_cleanup_incomplete", {
        retained: true,
        pendingHandles: handles.size,
      });
  }
  return { importManagedArchive, getImportedRun, closeArchiveImports };
}
