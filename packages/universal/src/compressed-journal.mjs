import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { TextDecoder } from "node:util";

// Frozen journal format-1 validation, kept equivalent to the unchanged basic
// reader by differential tests. Compression does not define application behavior.
const FORMAT = "daedlo-run-journal/1";
export const MAX_RUN_BYTES = 16 * 1024 * 1024;
export const MAX_GZIP_BYTES = MAX_RUN_BYTES + 65536;
const MAX_RECORD_BYTES = 1024 * 1024;
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) =>
  object(value) && Object.keys(value).sort().join() === [...keys].sort().join();
const validId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const uuid = (value) =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const sha = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const decimal = (value) =>
  typeof value === "string" && /^[0-9]{1,30}$/.test(value);
const validTime = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value));
const validCommand = (value) => typeof value === "string" && value.length > 0;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (
  code,
  message = "Compressed journal data or ownership could not be verified.",
) => {
  throw Object.assign(Error(message), { code });
};
const invalid = (code = "journal_record") =>
  fail(code, "Run journal metadata or bytes are invalid.");
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

export function parseJournalBytes({
  bytes,
  workspaceId,
  projectId,
  runId,
} = {}) {
  if (
    !(bytes instanceof Uint8Array) ||
    !validId(workspaceId) ||
    !validId(projectId) ||
    !validId(runId)
  )
    invalid();
  bytes = Buffer.from(bytes);
  if (bytes.length > MAX_RUN_BYTES) invalid("journal_limit");
  const info = { id: workspaceId, projectId };
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

export function checkedCompressionRecord(record) {
  if (
    !exact(record, [
      "format",
      "id",
      "workspaceId",
      "projectId",
      "targetId",
      "runId",
      "source",
      "gzip",
      "createdAt",
    ]) ||
    record.format !== "daedlo-journal-compression/1" ||
    !uuid(record.id) ||
    ![
      record.workspaceId,
      record.projectId,
      record.targetId,
      record.runId,
    ].every(validId) ||
    !validTime(record.createdAt) ||
    !exact(record.source, ["dev", "ino", "bytes", "sha256"]) ||
    !decimal(record.source.dev) ||
    !decimal(record.source.ino) ||
    !Number.isSafeInteger(record.source.bytes) ||
    record.source.bytes < 1 ||
    record.source.bytes > MAX_RUN_BYTES ||
    !sha(record.source.sha256) ||
    !exact(record.gzip, ["bytes", "sha256"]) ||
    !Number.isSafeInteger(record.gzip.bytes) ||
    record.gzip.bytes < 1 ||
    record.gzip.bytes > MAX_GZIP_BYTES ||
    !sha(record.gzip.sha256)
  )
    fail("compression_corrupt");
  return record;
}
export function decodeCompression({ record, gzipBytes } = {}) {
  checkedCompressionRecord(record);
  if (
    !(gzipBytes instanceof Uint8Array) ||
    gzipBytes.byteLength !== record.gzip.bytes ||
    hash(gzipBytes) !== record.gzip.sha256
  )
    fail("compression_corrupt");
  let bytes;
  try {
    bytes = gunzipSync(gzipBytes, { maxOutputLength: MAX_RUN_BYTES });
  } catch {
    fail("compression_corrupt");
  }
  if (
    bytes.length !== record.source.bytes ||
    hash(bytes) !== record.source.sha256
  )
    fail("compression_corrupt");
  const history = parseJournalBytes({
    bytes,
    workspaceId: record.workspaceId,
    projectId: record.projectId,
    runId: record.runId,
  });
  if (history.status !== "finished") fail("compression_not_closed");
  return { bytes, history };
}
export function compressionMarker(record) {
  checkedCompressionRecord(record);
  return Buffer.from(
    JSON.stringify({
      format: "daedlo-compressed-journal/1",
      workspaceId: record.workspaceId,
      projectId: record.projectId,
      targetId: record.targetId,
      runId: record.runId,
      compressionId: record.id,
      sourceSha256: record.source.sha256,
      gzipSha256: record.gzip.sha256,
    }) + "\n",
  );
}
function processOwner(value) {
  if (
    !exact(value, ["schemaVersion", "pid", "instance", "host"]) ||
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.pid) ||
    value.pid < 1 ||
    !uuid(value.instance)
  )
    return false;
  const host = value.host;
  return (
    host === null ||
    (exact(host, ["platform", "bootId"]) &&
      host.platform === "darwin" &&
      typeof host.bootId === "string" &&
      host.bootId.length > 0 &&
      host.bootId.length <= 256) ||
    (exact(host, ["platform", "bootId", "pidNamespace"]) &&
      host.platform === "linux" &&
      typeof host.bootId === "string" &&
      host.bootId.length > 0 &&
      host.bootId.length <= 256 &&
      exact(host.pidNamespace, ["dev", "ino"]) &&
      decimal(host.pidNamespace.dev) &&
      decimal(host.pidNamespace.ino))
  );
}
export function checkedCompressionReplacement(value, record) {
  checkedCompressionRecord(record);
  const identity = (v) =>
    exact(v, ["dev", "ino"]) && decimal(v.dev) && decimal(v.ino);
  if (
    !exact(value, [
      "format",
      "source",
      "marker",
      "writer",
      "writerRecord",
      "temporary",
      "retained",
    ]) ||
    value.format !== "daedlo-journal-replacement/1" ||
    !identity(value.source) ||
    !identity(value.marker) ||
    !(
      typeof value.temporary === "string" &&
      value.temporary.startsWith(`.compressed-${record.id}-`) &&
      value.temporary.endsWith(".marker.tmp") &&
      uuid(value.temporary.slice(`.compressed-${record.id}-`.length, -11))
    ) ||
    value.retained !== `.compressed-${record.id}.plain.retained` ||
    !exact(value.writer, ["token", "sha256", "dev", "ino"]) ||
    !uuid(value.writer.token) ||
    !sha(value.writer.sha256) ||
    !decimal(value.writer.dev) ||
    !decimal(value.writer.ino)
  )
    fail("compression_corrupt");
  const writer = value.writerRecord;
  if (
    !exact(writer, [
      "format",
      "workspaceId",
      "projectId",
      "token",
      "pid",
      "hostname",
      "owner",
    ]) ||
    writer.format !== "daedlo-run-journal-lock/2" ||
    writer.workspaceId !== record.workspaceId ||
    writer.projectId !== record.projectId ||
    writer.token !== value.writer.token ||
    !Number.isSafeInteger(writer.pid) ||
    writer.pid < 1 ||
    typeof writer.hostname !== "string" ||
    writer.hostname.length > 1024 ||
    !processOwner(writer.owner) ||
    writer.owner.pid !== writer.pid ||
    hash(Buffer.from(JSON.stringify(writer) + "\n")) !== value.writer.sha256
  )
    fail("compression_corrupt");
  return value;
}
