import fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { loadTools } from "./tools.mjs";

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_RECORDS = 10000;
const MAX_PENDING = 100;
// A committed item retains its file and receipt; an interrupted publication may
// retain both temporary links as well. Match the catalog's supported record cap.
const MAX_ENTRIES = 2 * MAX_RECORDS + 4 * MAX_PENDING;
const MAX_PENDING_BYTES = 128 * 1024 * 1024;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA = /^[a-f0-9]{64}$/;
const TYPES = new Set([
  "text/plain",
  "application/json",
  "image/png",
  "image/jpeg",
  "application/pdf",
]);
const same = (a, b) => Boolean(a && b && a.dev === b.dev && a.ino === b.ino);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) =>
  object(value) &&
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const id = (value) => typeof value === "string" && ID.test(value);
const text = (value, max = 256) =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= max &&
  !/[\x00-\x1f\x7f-\x9f]/.test(value);
const time = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value));
const fail = (code, extra = {}) => {
  throw Object.assign(
    Error(
      {
        evidence_invalid:
          "Evidence identity, type, reference or bytes are invalid.",
        evidence_reference:
          "Evidence must reference a recorded event from the selected target.",
        evidence_ownership_changed:
          "Evidence storage ownership changed; preserve the files for inspection.",
        evidence_uncommitted:
          "Evidence publication is incomplete. Preserve its files and explicitly retry the retained evidence ID.",
        evidence_unproven:
          "Evidence publication ownership cannot be proven. Preserve the retained files for inspection.",
        evidence_missing: "The recorded evidence file is missing.",
        evidence_corrupt:
          "The recorded evidence file failed integrity verification.",
        evidence_limit: "The evidence operation exceeds the supported bound.",
        evidence_closed: "The evidence store is closed.",
        evidence_storage: "Evidence storage could not complete the operation.",
        evidence_cleanup_incomplete:
          "Evidence file cleanup is incomplete. Its owned handles are retained for explicit close retry.",
        catalog_upgrade_required:
          "Explicitly upgrade this Universal catalog before adding or recovering evidence.",
        target_changed:
          "The target registration changed; read it again before adding evidence.",
      }[code] ?? "Evidence storage rejected the operation.",
    ),
    { code, ...extra },
  );
};
export function checkedEvidence(value) {
  if (
    !exact(value, [
      "id",
      "targetId",
      "runId",
      "eventSequence",
      "eventId",
      "label",
      "mediaType",
      "sha256",
      "bytes",
      "createdAt",
      "provenance",
    ]) ||
    ![value.id, value.targetId, value.runId].every(id) ||
    !text(value.label, 200) ||
    !TYPES.has(value.mediaType) ||
    !SHA.test(value.sha256) ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 0 ||
    value.bytes > MAX_BYTES ||
    !time(value.createdAt) ||
    !(value.eventSequence === null
      ? value.eventId === null
      : Number.isSafeInteger(value.eventSequence) &&
        value.eventSequence > 0 &&
        id(value.eventId)) ||
    !exact(value.provenance, [
      "installationId",
      "runtimeVersion",
      "sourceSha256",
      "model",
    ]) ||
    !id(value.provenance.installationId) ||
    !text(value.provenance.runtimeVersion) ||
    !SHA.test(value.provenance.sourceSha256) ||
    !exact(value.provenance.model, ["id", "version"]) ||
    !text(value.provenance.model.id) ||
    !text(value.provenance.model.version)
  )
    fail("evidence_invalid");
  return structuredClone(value);
}
function checkedContent(bytes, mediaType) {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength > MAX_BYTES ||
    !TYPES.has(mediaType)
  )
    fail("evidence_invalid");
  bytes = Buffer.from(bytes);
  try {
    if (mediaType === "text/plain" || mediaType === "application/json") {
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (mediaType === "application/json") JSON.parse(decoded);
    } else if (
      mediaType === "image/png" &&
      !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
    )
      throw Error();
    else if (
      mediaType === "image/jpeg" &&
      !(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    )
      throw Error();
    else if (
      mediaType === "application/pdf" &&
      bytes.subarray(0, 5).toString("ascii") !== "%PDF-"
    )
      throw Error();
  } catch {
    fail("evidence_invalid");
  }
  return bytes;
}

/** Private immutable files. Opening, inspection and reads never create or repair. */
export async function createEvidenceStore({ root, catalog } = {}) {
  if (
    typeof root !== "string" ||
    !isAbsolute(root) ||
    resolve(root) !== root ||
    !catalog ||
    typeof catalog.getTarget !== "function"
  )
    fail("evidence_invalid");
  const { journalFilesystem: io } = await loadTools("run-journal");
  const rootIdentity = await io.directory(root);
  const manifest = await io.smallFile(join(root, "workspace.json"), 8192);
  let marker;
  try {
    marker = JSON.parse(manifest.bytes);
  } catch {
    fail("evidence_invalid");
  }
  if (
    marker.kind !== "daedlo-workspace" ||
    marker.schemaVersion !== 1 ||
    !id(marker.workspaceId) ||
    !isDeepStrictEqual(marker.formats, { managedRun: 1, runJournal: 1 }) ||
    manifest.stat.nlink !== 1n
  )
    fail("evidence_invalid");
  let closed = false;
  const handles = new Set();
  async function openHandle(...args) {
    const handle = await fs.open(...args);
    handles.add(handle);
    return handle;
  }
  async function closeHandle(handle) {
    await handle.close();
    handles.delete(handle);
  }
  const base = join(root, "evidence");
  async function rootGuard() {
    if (closed) fail("evidence_closed");
    try {
      const current = await io.smallFile(join(root, "workspace.json"), 8192);
      if (
        !same(rootIdentity, await io.directory(root)) ||
        !same(manifest.stat, current.stat) ||
        !current.bytes.equals(manifest.bytes)
      )
        fail("evidence_ownership_changed");
    } catch (error) {
      if (error.code === "evidence_closed") throw error;
      fail("evidence_ownership_changed");
    }
  }
  async function directory(targetId, create = false) {
    if (!id(targetId)) fail("evidence_invalid");
    await rootGuard();
    const target = await catalog.getTarget(targetId);
    if (target.id !== targetId) fail("evidence_reference");
    const path = join(base, targetId);
    try {
      if (create) {
        await io.directory(base, true);
        await io.syncDirectory(root);
        await io.directory(path, true);
        await io.syncDirectory(base);
      }
      const parent = await io.directory(base),
        identity = await io.directory(path);
      await rootGuard();
      return { path, parent, identity, target };
    } catch (error) {
      if (error.code === "ENOENT" && !create)
        return { path, parent: null, identity: null, target };
      if (error.code?.startsWith("evidence_")) throw error;
      fail("evidence_ownership_changed");
    }
  }
  async function guard(directory) {
    await rootGuard();
    try {
      if (
        !directory.identity ||
        !same(directory.parent, await io.directory(base)) ||
        !same(directory.identity, await io.directory(directory.path))
      )
        fail("evidence_ownership_changed");
    } catch {
      fail("evidence_ownership_changed");
    }
  }
  const paths = (dir, evidenceId) => ({
    file: join(dir.path, `${evidenceId}.bin`),
    receipt: join(dir.path, `${evidenceId}.json`),
    temporary: join(dir.path, `.${evidenceId}.bin.tmp`),
    receiptTemporary: join(dir.path, `.${evidenceId}.json.tmp`),
  });
  async function stableFile(path, limit, { links = 1n, identity } = {}) {
    const before = await fs.lstat(path, { bigint: true });
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== links ||
      before.size > BigInt(limit) ||
      (identity && !same(before, identity))
    )
      fail("evidence_corrupt");
    const handle = await openHandle(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const stat = await handle.stat({ bigint: true });
      if (
        !same(stat, before) ||
        stat.nlink !== links ||
        stat.size !== before.size
      )
        fail("evidence_corrupt");
      const bytes = Buffer.alloc(Number(stat.size));
      let offset = 0;
      while (offset < bytes.length) {
        const read = await handle.read(
          bytes,
          offset,
          bytes.length - offset,
          offset,
        );
        if (!read.bytesRead) fail("evidence_corrupt");
        offset += read.bytesRead;
      }
      const after = await handle.stat({ bigint: true }),
        current = await fs.lstat(path, { bigint: true });
      if (
        !same(current, before) ||
        after.size !== before.size ||
        after.mtimeNs !== before.mtimeNs ||
        current.nlink !== links
      )
        fail("evidence_corrupt");
      return { bytes, stat: after };
    } finally {
      await closeHandle(handle);
    }
  }
  async function reference(
    targetId,
    runId,
    eventSequence,
    expectedTargetRevision,
  ) {
    const target = await catalog.getTarget(targetId),
      history = await catalog.getRun({ targetId, runId });
    if (
      expectedTargetRevision !== undefined &&
      target.revision !== expectedTargetRevision
    )
      fail("target_changed");
    if (
      target.id !== targetId ||
      !Number.isSafeInteger(target.revision) ||
      target.revision < 1 ||
      history.targetId !== targetId ||
      history.workspaceId !== marker.workspaceId ||
      history.projectId !== target.projectId ||
      history.runId !== runId ||
      !Array.isArray(history.events)
    )
      fail("evidence_reference");
    const first = history.events[0],
      event =
        eventSequence === null
          ? null
          : history.events.find((item) => item.sequence === eventSequence);
    if (
      first?.type !== "run_started" ||
      first.sequence !== 1 ||
      (eventSequence !== null && !event)
    )
      fail("evidence_reference");
    const installation = first.payload?.installation;
    if (!installation) fail("evidence_reference");
    return {
      targetRevision: target.revision,
      eventId: event?.eventId ?? null,
      provenance: {
        installationId: installation.id,
        runtimeVersion: installation.version,
        sourceSha256: installation.sourceSha256,
        model: structuredClone(installation.model),
      },
    };
  }
  async function readReceipt(dir, evidenceId) {
    await guard(dir);
    let file, value;
    try {
      const p = paths(dir, evidenceId),
        before = await fs.lstat(p.receipt, { bigint: true });
      let links = 1n;
      if (before.nlink === 2n) {
        const temporary = await fs.lstat(p.receiptTemporary, { bigint: true });
        if (
          !same(before, temporary) ||
          !temporary.isFile() ||
          temporary.isSymbolicLink()
        )
          fail("evidence_unproven");
        links = 2n;
      }
      file = await stableFile(p.receipt, 8192, { links });
      value = JSON.parse(file.bytes);
    } catch (error) {
      if (error.code === "ENOENT") throw error;
      fail("evidence_unproven");
    }
    if (
      !exact(value, ["format", "workspaceId", "record", "file"]) ||
      value.format !== "daedlo-evidence-publication/1" ||
      value.workspaceId !== marker.workspaceId ||
      !exact(value.file, ["dev", "ino"]) ||
      ![value.file.dev, value.file.ino].every(
        (v) => typeof v === "string" && /^[0-9]{1,30}$/.test(v),
      )
    )
      fail("evidence_unproven");
    try {
      checkedEvidence(value.record);
    } catch {
      fail("evidence_unproven");
    }
    if (
      value.record.id !== evidenceId ||
      value.record.targetId !== dir.target.id
    )
      fail("evidence_unproven");
    await guard(dir);
    return {
      ...file,
      ...value,
      identity: { dev: BigInt(value.file.dev), ino: BigInt(value.file.ino) },
    };
  }
  async function publishReceipt(dir, value) {
    const p = paths(dir, value.record.id);
    await guard(dir);
    const handle = await openHandle(p.receiptTemporary, "wx", 0o600);
    let stat;
    try {
      stat = await handle.stat({ bigint: true });
      await handle.writeFile(JSON.stringify(value) + "\n");
      await handle.sync();
    } finally {
      await closeHandle(handle);
    }
    await guard(dir);
    await fs.link(p.receiptTemporary, p.receipt);
    await io.syncDirectory(dir.path);
    await io.unlinkOwned(p.receiptTemporary, stat, dir.identity);
    await io.syncDirectory(dir.path);
  }
  async function finishPublication(dir, receipt) {
    const p = paths(dir, receipt.record.id);
    await guard(dir);
    const receiptTemporary = await fs
      .lstat(p.receiptTemporary, { bigint: true })
      .catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
    if (receiptTemporary) {
      if (
        !same(receiptTemporary, receipt.stat) ||
        receiptTemporary.nlink !== 2n ||
        !same(await fs.lstat(p.receipt, { bigint: true }), receipt.stat)
      )
        fail("evidence_unproven");
      await io.unlinkOwned(p.receiptTemporary, receipt.stat, dir.identity);
      await io.syncDirectory(dir.path);
    }
    let final = await fs.lstat(p.file, { bigint: true }).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    const temporary = await fs
      .lstat(p.temporary, { bigint: true })
      .catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
    const sourcePath = final ? p.file : p.temporary;
    const links = final && temporary && same(final, temporary) ? 2n : 1n;
    if (
      (!final && !temporary) ||
      (temporary && !same(temporary, receipt.identity))
    )
      fail("evidence_unproven");
    const source = await stableFile(sourcePath, MAX_BYTES, {
      links,
      identity: receipt.identity,
    });
    if (
      source.bytes.length !== receipt.record.bytes ||
      hash(source.bytes) !== receipt.record.sha256
    )
      fail("evidence_corrupt");
    await guard(dir);
    if (!final) {
      await fs.link(p.temporary, p.file);
      final = await fs.lstat(p.file, { bigint: true });
    }
    await io.syncDirectory(dir.path);
    if (temporary) {
      if (!same(final, receipt.identity)) fail("evidence_ownership_changed");
      await io.unlinkOwned(p.temporary, receipt.identity, dir.identity);
      await io.syncDirectory(dir.path);
    }
    const verified = await stableFile(p.file, MAX_BYTES, {
      identity: receipt.identity,
    });
    if (
      hash(verified.bytes) !== receipt.record.sha256 ||
      verified.bytes.length !== receipt.record.bytes
    )
      fail("evidence_corrupt");
    await guard(dir);
  }
  async function commit(dir, receipt, options) {
    await finishPublication(dir, receipt);
    const actual = await reference(
      receipt.record.targetId,
      receipt.record.runId,
      receipt.record.eventSequence,
      options?.expectedTargetRevision,
    );
    if (
      actual.eventId !== receipt.record.eventId ||
      !isDeepStrictEqual(actual.provenance, receipt.record.provenance)
    )
      fail("evidence_reference");
    const registered = await catalog.addEvidence(receipt.record, options);
    if (!isDeepStrictEqual(checkedEvidence(registered), receipt.record))
      fail("evidence_reference");
    await guard(dir);
    return { ...receipt.record, integrity: "available" };
  }
  async function put(input) {
    if (![2, 3, 4].includes(catalog.catalogVersion))
      fail("catalog_upgrade_required");
    if (object(input)) input = { ...input };
    if (
      !object(input) ||
      Object.keys(input).some(
        (key) =>
          ![
            "targetId",
            "runId",
            "eventSequence",
            "label",
            "mediaType",
            "bytes",
            "expectedTargetRevision",
          ].includes(key),
      ) ||
      !id(input.targetId) ||
      !id(input.runId) ||
      !text(input.label, 200) ||
      (input.eventSequence !== undefined &&
        input.eventSequence !== null &&
        (!Number.isSafeInteger(input.eventSequence) ||
          input.eventSequence < 1)) ||
      (input.expectedTargetRevision !== undefined &&
        (!Number.isSafeInteger(input.expectedTargetRevision) ||
          input.expectedTargetRevision < 1))
    )
      fail("evidence_invalid");
    const bytes = checkedContent(input.bytes, input.mediaType),
      eventSequence = input.eventSequence ?? null;
    await rootGuard();
    const { targetRevision, ...observed } = await reference(
      input.targetId,
      input.runId,
      eventSequence,
      input.expectedTargetRevision,
    );
    const record = checkedEvidence({
      id: randomUUID(),
      targetId: input.targetId,
      runId: input.runId,
      eventSequence,
      ...observed,
      label: input.label,
      mediaType: input.mediaType,
      sha256: hash(bytes),
      bytes: bytes.length,
      createdAt: new Date().toISOString(),
    });
    const dir = await directory(input.targetId, true),
      p = paths(dir, record.id);
    let started = false;
    try {
      await guard(dir);
      const handle = await openHandle(p.temporary, "wx", 0o600);
      started = true;
      let stat;
      try {
        stat = await handle.stat({ bigint: true });
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await closeHandle(handle);
      }
      await guard(dir);
      await publishReceipt(dir, {
        format: "daedlo-evidence-publication/1",
        workspaceId: marker.workspaceId,
        record,
        file: { dev: String(stat.dev), ino: String(stat.ino) },
      });
      return await commit(dir, await readReceipt(dir, record.id), {
        expectedTargetRevision: input.expectedTargetRevision ?? targetRevision,
      });
    } catch (error) {
      if (started)
        fail("evidence_uncommitted", {
          evidenceId: record.id,
          targetId: input.targetId,
          retained: true,
        });
      if (error.code?.startsWith("evidence_")) throw error;
      fail("evidence_storage");
    }
  }
  async function registered(targetId, evidenceId) {
    if (!id(targetId) || !id(evidenceId)) fail("evidence_invalid");
    await rootGuard();
    const record = checkedEvidence(
      await catalog.getEvidence({ targetId, evidenceId }),
    );
    if (record.targetId !== targetId || record.id !== evidenceId)
      fail("evidence_reference");
    return record;
  }
  async function verified(record) {
    const dir = await directory(record.targetId);
    if (!dir.identity) return { integrity: "missing" };
    try {
      const file = await stableFile(paths(dir, record.id).file, MAX_BYTES);
      await guard(dir);
      if (
        file.bytes.length !== record.bytes ||
        hash(file.bytes) !== record.sha256
      )
        return { integrity: "corrupt" };
      return { integrity: "available", bytes: file.bytes };
    } catch (error) {
      if (error.code === "ENOENT") return { integrity: "missing" };
      if (error.code === "evidence_corrupt") return { integrity: "corrupt" };
      throw error;
    }
  }
  async function inspect({ targetId, evidenceId } = {}) {
    const record = await registered(targetId, evidenceId);
    return { ...record, integrity: (await verified(record)).integrity };
  }
  async function read({ targetId, evidenceId } = {}) {
    const record = await registered(targetId, evidenceId),
      file = await verified(record);
    if (file.integrity !== "available") fail(`evidence_${file.integrity}`);
    return { metadata: record, bytes: file.bytes };
  }
  async function retry({ targetId, evidenceId, expectedTargetRevision } = {}) {
    if (![2, 3, 4].includes(catalog.catalogVersion))
      fail("catalog_upgrade_required");
    if (
      !id(targetId) ||
      !id(evidenceId) ||
      (expectedTargetRevision !== undefined &&
        (!Number.isSafeInteger(expectedTargetRevision) ||
          expectedTargetRevision < 1))
    )
      fail("evidence_invalid");
    const dir = await directory(targetId);
    if (
      expectedTargetRevision !== undefined &&
      dir.target.revision !== expectedTargetRevision
    )
      fail("target_changed");
    if (!dir.identity) fail("evidence_missing");
    let receipt;
    try {
      receipt = await readReceipt(dir, evidenceId);
    } catch (error) {
      if (error.code === "ENOENT") fail("evidence_unproven");
      throw error;
    }
    try {
      return await commit(dir, receipt, {
        expectedTargetRevision: expectedTargetRevision ?? dir.target.revision,
      });
    } catch (error) {
      if (error.code?.startsWith("evidence_")) throw error;
      fail("evidence_uncommitted", { evidenceId, targetId, retained: true });
    }
  }
  async function listPending({ targetId } = {}) {
    const dir = await directory(targetId);
    if (!dir.identity) return [];
    const ids = new Set();
    let count = 0;
    const handle = await fs.opendir(dir.path);
    for await (const entry of handle) {
      if (++count > MAX_ENTRIES) fail("evidence_limit");
      const match =
        /^(?:\.)?([A-Za-z0-9][A-Za-z0-9._-]{0,127})\.(?:bin|json)(?:\.tmp)?$/.exec(
          entry.name,
        );
      if (!match) fail("evidence_unproven");
      ids.add(match[1]);
    }
    await guard(dir);
    const committed = new Set();
    if (typeof catalog.listEvidence === "function") {
      let cursor = null;
      const seenCursors = new Set();
      do {
        const page = await catalog.listEvidence({
          targetId,
          limit: 100,
          cursor,
        });
        if (
          !object(page) ||
          page.targetId !== targetId ||
          !Array.isArray(page.items) ||
          page.items.length > 100 ||
          !(
            page.nextCursor === null ||
            (typeof page.nextCursor === "string" &&
              page.nextCursor.length > 0 &&
              page.nextCursor.length <= 4096 &&
              page.items.length === 100)
          )
        )
          fail("evidence_reference");
        for (const item of page.items) {
          const record = checkedEvidence(item);
          if (record.targetId !== targetId || committed.has(record.id))
            fail("evidence_reference");
          committed.add(record.id);
        }
        if (
          committed.size > MAX_RECORDS ||
          (page.nextCursor !== null && committed.size >= MAX_RECORDS)
        )
          fail("evidence_limit");
        cursor = page.nextCursor;
        if (cursor !== null) {
          if (seenCursors.has(cursor)) fail("evidence_reference");
          seenCursors.add(cursor);
        }
      } while (cursor !== null);
    }
    const result = [];
    let bytesRead = 0;
    for (const evidenceId of [...ids].sort()) {
      // Catalog metadata is authoritative after commit. Receipts authorize only
      // explicit recovery; inspect/read still verify committed file bytes, and
      // retry always proves its receipt before touching a publication.
      if (committed.has(evidenceId)) continue;
      let receipt;
      try {
        receipt = await readReceipt(dir, evidenceId);
      } catch (error) {
        if (!["ENOENT", "evidence_unproven"].includes(error.code)) throw error;
      }
      let existing;
      try {
        existing = await registered(targetId, evidenceId);
      } catch (error) {
        if (error.code !== "evidence_not_found") throw error;
      }
      if (existing) {
        if (receipt && !isDeepStrictEqual(existing, receipt.record))
          fail("evidence_reference");
        continue;
      }
      if (receipt && (bytesRead += receipt.record.bytes) > MAX_PENDING_BYTES)
        fail("evidence_limit");
      result.push(
        receipt
          ? {
              ...receipt.record,
              state: "uncommitted",
              integrity: (await verified(receipt.record)).integrity,
            }
          : {
              id: evidenceId,
              targetId,
              state: "unproven",
              integrity: "unproven",
            },
      );
      if (result.length > MAX_PENDING) fail("evidence_limit");
    }
    await guard(dir);
    return result;
  }
  return Object.freeze({
    put,
    inspect,
    read,
    retry,
    listPending,
    async close() {
      closed = true;
      for (const handle of [...handles]) {
        try {
          await closeHandle(handle);
        } catch {
          /* Retain the exact handle. */
        }
      }
      if (handles.size)
        fail("evidence_cleanup_incomplete", {
          retained: true,
          pendingHandles: handles.size,
        });
    },
  });
}
