import {
  checkedCompressionRecord,
  decodeCompression,
  compressionMarker,
  MAX_GZIP_BYTES,
} from "./compressed-journal.mjs";

const fail = () => {
  throw Object.assign(
    Error(
      "Stored journal compression or its file binding could not be verified.",
    ),
    { code: "compression_corrupt" },
  );
};
const decimal = (value) =>
  typeof value === "string" && /^[0-9]{1,30}$/.test(value);
export const COMPRESSION_COLUMNS =
  "target_id,run_id,id,metadata,state,binding_dev,binding_ino,replacement,length(gzip_bytes) AS gzip_bytes_length";

// Uses the caller's already-held SQLite transaction. Opening another source
// database connection here would release the process-wide snapshot lock on close.
export function readSnapshotCompression(db, row, workspaceId, projectId) {
  if (
    !row ||
    !Number.isSafeInteger(row.gzip_bytes_length) ||
    row.gzip_bytes_length < 1 ||
    row.gzip_bytes_length > MAX_GZIP_BYTES ||
    typeof row.metadata !== "string" ||
    Buffer.byteLength(row.metadata) > 8192 ||
    !["retained", "active"].includes(row.state) ||
    !decimal(row.binding_dev) ||
    !decimal(row.binding_ino)
  )
    fail();
  if (row.replacement !== null)
    throw Object.assign(
      Error(
        "Finish explicit journal compression cleanup before making or restoring a backup.",
      ),
      { code: "compression_pending" },
    );
  let record;
  try {
    record = checkedCompressionRecord(JSON.parse(row.metadata));
  } catch {
    fail();
  }
  if (
    record.workspaceId !== workspaceId ||
    record.targetId !== row.target_id ||
    record.runId !== row.run_id ||
    record.id !== row.id ||
    record.projectId !== projectId ||
    record.gzip.bytes !== row.gzip_bytes_length
  )
    fail();
  const stored = db
    .prepare(
      "SELECT gzip_bytes FROM journal_compressions WHERE target_id=? AND run_id=?",
    )
    .get(row.target_id, row.run_id);
  if (!stored || stored.gzip_bytes.length !== row.gzip_bytes_length) fail();
  const { bytes, history } = decodeCompression({
    record,
    gzipBytes: Buffer.from(stored.gzip_bytes),
  });
  return {
    record,
    bytes,
    history,
    state: row.state,
    binding: { dev: row.binding_dev, ino: row.binding_ino },
    markerBytes: compressionMarker(record),
  };
}
