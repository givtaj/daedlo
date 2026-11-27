// Only deliberate public fields leave the local catalog service. Original report
// content remains the customer's recorded data; import filesystem paths do not.
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const id = (value) =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const text = (value, max = 256) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  !/[\u0000-\u001f\u007f]/.test(value);
const pick = (value, keys) =>
  Object.fromEntries(
    keys
      .filter((key) => Object.hasOwn(value, key))
      .map((key) => [key, value[key]]),
  );
const fail = () => {
  throw Object.assign(Error(), { code: "invalid_response" });
};
const time = (value) => text(value, 40) && Number.isFinite(Date.parse(value));
const limitations = new Set([
  "completed_report_only",
  "event_history_missing",
  "event_range_missing",
  "events_truncated",
  "installation_version_missing",
  "installation_source_missing",
  "installation_model_missing",
  "runtime_identity_missing",
  "resources_missing",
  "run_timestamps_missing",
  "command_missing",
]);
export function publicImportedRun(value, targetId, runId) {
  if (
    !object(value) ||
    value.targetId !== targetId ||
    value.runId !== runId ||
    !id(value.importId) ||
    value.format !== "daedlo-imported-report/1" ||
    value.status !== "imported" ||
    value.liveState !== "unknown" ||
    value.historyComplete !== false ||
    !Array.isArray(value.events) ||
    value.events.length ||
    !object(value.report) ||
    value.report.format !== "browser-driver-report/1" ||
    value.report.runId !== runId ||
    value.report.lastResult?.runId !== runId
  )
    fail();
  const p = value.provenance,
    s = p?.source,
    m = p?.mapping,
    i = p?.installation;
  if (
    !object(p) ||
    !object(s) ||
    s.kind !== "daedlo-managed-run" ||
    s.schemaVersion !== 1 ||
    s.reportFormat !== "browser-driver-report/1" ||
    !text(s.fileName, 255) ||
    /[\\/]/.test(s.fileName) ||
    !/^[a-f0-9]{64}$/.test(s.sha256) ||
    !Number.isSafeInteger(s.bytes) ||
    s.bytes < 1 ||
    s.bytes > 16 * 1024 * 1024 ||
    !object(i) ||
    !text(i.id) ||
    !time(p.recordedAt) ||
    !time(p.importedAt) ||
    !object(m) ||
    m.kind !== "explicit" ||
    m.targetId !== targetId ||
    !Number.isSafeInteger(m.targetRevision) ||
    m.targetRevision < 1 ||
    !Array.isArray(p.limitations) ||
    !p.limitations.includes("completed_report_only") ||
    p.limitations.some((code) => !limitations.has(code))
  )
    fail();
  if (
    (i.version !== undefined && !text(i.version)) ||
    (i.sourceSha256 !== undefined && !/^[a-f0-9]{64}$/i.test(i.sourceSha256)) ||
    (i.model !== undefined &&
      (!object(i.model) || !text(i.model.id) || !text(i.model.version)))
  )
    fail();
  return {
    ...pick(value, [
      "format",
      "targetId",
      "runId",
      "importId",
      "status",
      "historyComplete",
      "liveState",
      "events",
      "report",
    ]),
    provenance: {
      source: pick(s, [
        "kind",
        "schemaVersion",
        "reportFormat",
        "sha256",
        "bytes",
        "fileName",
      ]),
      installation: {
        ...pick(i, ["id", "version", "sourceSha256"]),
        ...(i.model ? { model: pick(i.model, ["id", "version"]) } : {}),
      },
      recordedAt: p.recordedAt,
      importedAt: p.importedAt,
      mapping: pick(m, ["kind", "targetId", "targetRevision"]),
      limitations: [...p.limitations],
    },
  };
}
