import fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { resolve, isAbsolute, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { loadTools } from "./tools.mjs";
import { openCatalog } from "./catalog.mjs";
import {
  checkedCompressionRecord,
  checkedCompressionReplacement,
  decodeCompression,
  compressionMarker,
  parseJournalBytes,
  MAX_RUN_BYTES,
} from "./compressed-journal.mjs";

const active = new Set(),
  pending = new Map();
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const validId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const same = (a, b) =>
  a && b && String(a.dev) === String(b.dev) && String(a.ino) === String(b.ino);
const stable = (a, b) =>
  same(a, b) &&
  a.size === b.size &&
  a.mtimeNs === b.mtimeNs &&
  a.ctimeNs === b.ctimeNs &&
  a.nlink === b.nlink;
const binding = (stat) => ({ dev: String(stat.dev), ino: String(stat.ino) });
const fail = (code = "compression_changed") => {
  throw Object.assign(
    Error(
      {
        compression_invalid:
          "Compression requires an explicit target and run in a compatible workspace.",
        compression_changed:
          "Journal data or ownership changed. All retained files must be preserved for inspection.",
        compression_not_closed:
          "Only verified terminal journals can be compressed. Incomplete history was preserved.",
        compression_pending:
          "Journal replacement is unfinished. Explicitly retry compression with replacement after resolving writer ownership.",
        compression_storage:
          "Journal compression failed. Original or verified compressed data and partial files were retained.",
        compression_cleanup_incomplete:
          "Compression cleanup is incomplete. Retry the same operation to close its retained owned handles.",
        compression_busy:
          "Another or interrupted journal writer owns this project. Inspect ownership before explicit recovery.",
      }[code] ?? "Journal compression was refused.",
    ),
    { code },
  );
};
function resources(key) {
  const handles = [];
  return {
    add(handle) {
      handles.push({ handle, failed: false });
      return handle;
    },
    async open(...args) {
      return this.add(await fs.open(...args));
    },
    async close(handle) {
      const i = handles.findIndex((v) => v.handle === handle);
      try {
        await handle.close();
        if (i >= 0) handles.splice(i, 1);
      } catch (error) {
        if (i >= 0) handles[i].failed = true;
        throw error;
      }
    },
    async cleanup() {
      while (handles.length) {
        if (handles[0].failed) {
          pending.set(key, handles);
          fail("compression_cleanup_incomplete");
        }
        try {
          await handles[0].handle.close();
          handles.shift();
        } catch {
          handles[0].failed = true;
          pending.set(key, handles);
          fail("compression_cleanup_incomplete");
        }
      }
      pending.delete(key);
    },
  };
}
async function retryCleanup(key) {
  const handles = pending.get(key);
  if (!handles) return;
  while (handles.length) {
    try {
      await handles[0].handle.retry?.();
      await handles[0].handle.close();
      handles.shift();
    } catch {
      fail("compression_cleanup_incomplete");
    }
  }
  pending.delete(key);
}
const optional = (path) =>
  fs.lstat(path, { bigint: true }).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
async function file(path, owned, limit = MAX_RUN_BYTES) {
  const { journalFilesystem: io } = await loadTools("run-journal");
  const parent = await io.directory(join(path, "..")),
    before = await fs.lstat(path, { bigint: true });
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size > BigInt(limit) ||
    before.nlink < 1n ||
    before.nlink > 2n
  )
    fail();
  const handle = await owned.open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  if (!stable(before, await handle.stat({ bigint: true }))) fail();
  const bytes = await handle.readFile();
  if (
    bytes.length !== Number(before.size) ||
    !stable(before, await handle.stat({ bigint: true })) ||
    !stable(before, await fs.lstat(path, { bigint: true })) ||
    !same(parent, await io.directory(join(path, "..")))
  )
    fail();
  await owned.close(handle);
  return { bytes, stat: before };
}
async function synced(path, bytes, owned, io) {
  const handle = await owned.open(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  const identity = await handle.stat({ bigint: true });
  await handle.writeFile(bytes);
  await handle.sync();
  await owned.close(handle);
  const after = await file(path, owned);
  if (
    !same(identity, after.stat) ||
    !after.bytes.equals(bytes) ||
    after.stat.nlink !== 1n
  )
    fail();
  await io.syncDirectory(join(path, ".."));
  return after;
}
function result(saved, plainBytesRemoved = 0) {
  return {
    targetId: saved.record.targetId,
    runId: saved.record.runId,
    compressionId: saved.record.id,
    state: saved.state,
    rawBytes: saved.record.source.bytes,
    compressedBytes: saved.record.gzip.bytes,
    sourceRetained: saved.state === "retained",
    plainBytesRemoved,
  };
}

/** Explicit storage work only; acquiring a writer never starts a run or action. */
export async function compressJournal(options = {}) {
  const {
    root,
    targetId,
    runId,
    replace = false,
    onProgress = async () => {},
  } = options;
  if (
    !options ||
    Object.keys(options).some(
      (key) =>
        !["root", "targetId", "runId", "replace", "onProgress"].includes(key),
    ) ||
    typeof root !== "string" ||
    !isAbsolute(root) ||
    resolve(root) !== root ||
    !validId(targetId) ||
    !validId(runId) ||
    typeof replace !== "boolean" ||
    typeof onProgress !== "function"
  )
    fail("compression_invalid");
  const key = JSON.stringify([root, targetId, runId]);
  if (active.has(key)) fail("compression_busy");
  active.add(key);
  const owned = resources(key);
  let catalog,
    plainBytesRemoved = 0;
  try {
    await retryCleanup(key);
    catalog = owned.add(await openCatalog({ root }));
    if (catalog.catalogVersion !== 4)
      throw Object.assign(
        Error("Compression requires an explicit catalog version 4 upgrade."),
        { code: "catalog_upgrade_required" },
      );
    const target = await catalog.getTarget(targetId);
    const { openRunJournal, journalFilesystem: io } =
      await loadTools("run-journal");
    const rootIdentity = await io.directory(root),
      marker = await file(join(root, "workspace.json"), owned, 8192),
      markerValue = JSON.parse(marker.bytes);
    const directory = join(root, "projects", target.projectId, "run-journals"),
      path = join(directory, runId + ".jsonl");
    const workspace = {
      root,
      id: markerValue.workspaceId,
      projectId: target.projectId,
      journal: 1,
      journalRoot: directory,
      assertCompatible: async () => {
        if (!same(rootIdentity, await io.directory(root))) fail();
        const current = await file(join(root, "workspace.json"), owned, 8192);
        if (
          !same(marker.stat, current.stat) ||
          !marker.bytes.equals(current.bytes)
        )
          fail();
      },
    };
    // Do not create a journal directory or claim a missing/nonexistent run.
    let saved = await catalog.getCompression({ targetId, runId });
    if (!saved && !(await optional(path))) fail("compression_invalid");
    let writer;
    try {
      writer = await openRunJournal({
        workspace,
        installation: {
          id: "daedlo-universal-compression",
          version: "1",
          sourceSha256: hash(Buffer.from("daedlo-journal-compression/1")),
          model: { id: "journal-compression", version: "1" },
        },
      });
    } catch (error) {
      if (error.code === "journal_locked") fail("compression_busy");
      throw error;
    }
    owned.add(writer);
    const directoryIdentity = await io.directory(directory);
    const lock = await file(join(directory, "writer.lock"), owned, 8192),
      writerRecord = JSON.parse(lock.bytes),
      writerProof = {
        token: writerRecord.token,
        sha256: hash(lock.bytes),
        ...binding(lock.stat),
      };
    const assertOwned = async () => {
      await workspace.assertCompatible();
      if (!same(directoryIdentity, await io.directory(directory))) fail();
      const current = await file(join(directory, "writer.lock"), owned, 8192);
      if (!same(lock.stat, current.stat) || !lock.bytes.equals(current.bytes))
        fail();
      const currentTarget = await catalog.getTarget(targetId);
      if (!isDeepStrictEqual(currentTarget, target)) fail();
    };
    await onProgress({ phase: "writer_locked" });
    await assertOwned();
    saved = await catalog.getCompression({ targetId, runId });
    if (!saved) {
      const history = await catalog.getRun({ targetId, runId });
      if (history.status !== "finished") fail("compression_not_closed");
      const source = await file(path, owned);
      if (source.stat.nlink !== 1n) fail();
      const parsed = parseJournalBytes({
        bytes: source.bytes,
        workspaceId: workspace.id,
        projectId: target.projectId,
        runId,
      });
      if (parsed.status !== "finished") fail("compression_not_closed");
      const gzipBytes = gzipSync(source.bytes, { level: 9 }),
        record = checkedCompressionRecord({
          format: "daedlo-journal-compression/1",
          id: randomUUID(),
          workspaceId: workspace.id,
          projectId: target.projectId,
          targetId,
          runId,
          source: {
            ...binding(source.stat),
            bytes: source.bytes.length,
            sha256: hash(source.bytes),
          },
          gzip: { bytes: gzipBytes.length, sha256: hash(gzipBytes) },
          createdAt: new Date().toISOString(),
        });
      decodeCompression({ record, gzipBytes });
      await assertOwned();
      const again = await file(path, owned);
      if (!stable(source.stat, again.stat) || !source.bytes.equals(again.bytes))
        fail();
      saved = await catalog.retainCompression({
        record,
        gzipBytes,
        expectedRevision: target.revision,
      });
    }
    checkedCompressionRecord(saved.record);
    decodeCompression(saved);
    const original = saved;
    const assertStored = async () => {
      await assertOwned();
      const current = await catalog.getCompression({ targetId, runId });
      if (
        !current ||
        !isDeepStrictEqual(current.record, original.record) ||
        !Buffer.from(current.gzipBytes).equals(Buffer.from(original.gzipBytes))
      )
        fail();
      decodeCompression(current);
      return current;
    };
    await onProgress({ phase: "retained" });
    saved = await assertStored();
    if (!replace) {
      if (saved.replacement) fail("compression_pending");
      const source = await file(path, owned);
      if (!same(source.stat, saved.binding)) fail();
      const expected =
        saved.state === "active"
          ? compressionMarker(saved.record)
          : decodeCompression(saved).bytes;
      if (!source.bytes.equals(expected) || source.stat.nlink !== 1n) fail();
      await owned.cleanup();
      return result(saved);
    }
    if (saved.state === "active" && !saved.replacement) {
      const source = await file(path, owned);
      if (
        !same(source.stat, saved.binding) ||
        !source.bytes.equals(compressionMarker(saved.record)) ||
        source.stat.nlink !== 1n
      )
        fail();
      await owned.cleanup();
      return result(saved);
    }
    if (!saved.replacement) {
      const source = await file(path, owned);
      if (
        saved.state !== "retained" ||
        !same(source.stat, saved.binding) ||
        source.stat.nlink !== 1n ||
        !source.bytes.equals(decodeCompression(saved).bytes)
      )
        fail();
      const temporary = `.compressed-${saved.record.id}-${randomUUID()}.marker.tmp`,
        tempPath = join(directory, temporary);
      const temp = await synced(
        tempPath,
        compressionMarker(saved.record),
        owned,
        io,
      );
      await onProgress({ phase: "marker_staged" });
      await assertOwned();
      const current = await file(path, owned);
      if (
        !stable(source.stat, current.stat) ||
        !source.bytes.equals(current.bytes)
      )
        fail();
      const replacement = checkedCompressionReplacement(
        {
          format: "daedlo-journal-replacement/1",
          source: { ...saved.binding },
          marker: binding(temp.stat),
          writer: writerProof,
          writerRecord,
          temporary,
          retained: `.compressed-${saved.record.id}.plain.retained`,
        },
        saved.record,
      );
      saved = await catalog.prepareCompressionReplacement({
        targetId,
        runId,
        id: saved.record.id,
        sourceBinding: saved.binding,
        replacement,
      });
    }
    const proof = checkedCompressionReplacement(
        saved.replacement,
        saved.record,
      ),
      temporaryPath = join(directory, proof.temporary),
      retainedPath = join(directory, proof.retained),
      sentinel = compressionMarker(saved.record),
      raw = decodeCompression(saved).bytes;
    const assertProof = async () => {
      const current = await assertStored();
      if (!isDeepStrictEqual(current.replacement, proof)) fail();
      return current;
    };
    const verifyMarker = async (candidate, expected) => {
      const value = await file(candidate, owned, 8192);
      if (!same(value.stat, expected) || !value.bytes.equals(sentinel)) fail();
      return value;
    };
    const verifyRaw = async (candidate) => {
      const value = await file(candidate, owned);
      if (!same(value.stat, proof.source) || !value.bytes.equals(raw)) fail();
      return value;
    };
    await onProgress({ phase: "replacement_prepared" });
    saved = await assertProof();
    if (saved.state === "retained") {
      let current = await optional(path),
        retained = await optional(retainedPath);
      if (current && same(current, proof.source)) {
        const source = await verifyRaw(path);
        if (
          source.stat.nlink !== 1n &&
          !(
            source.stat.nlink === 2n &&
            retained &&
            same(retained, proof.source)
          )
        )
          fail();
        if (!retained) {
          await fs.link(path, retainedPath);
          await io.syncDirectory(directory);
          retained = await optional(retainedPath);
        }
        await verifyRaw(retainedPath);
        await onProgress({ phase: "source_linked" });
        await assertProof();
        const sourceAgain = await verifyRaw(path),
          retainedAgain = await verifyRaw(retainedPath);
        if (sourceAgain.stat.nlink !== 2n || retainedAgain.stat.nlink !== 2n)
          fail();
        await verifyMarker(temporaryPath, proof.marker);
        await io.unlinkOwned(path, sourceAgain.stat, directoryIdentity);
        await io.syncDirectory(directory);
        await onProgress({ phase: "source_unlinked" });
        await assertProof();
        current = await optional(path);
      }
      if (!current) {
        const retainedSource = await verifyRaw(retainedPath);
        if (retainedSource.stat.nlink !== 1n) fail();
        const temp = await verifyMarker(temporaryPath, proof.marker);
        if (temp.stat.nlink !== 1n) fail();
        await fs.link(temporaryPath, path);
        await io.syncDirectory(directory);
      }
      const published = await verifyMarker(path, proof.marker),
        temp = await verifyMarker(temporaryPath, proof.marker);
      if (published.stat.nlink !== 2n || temp.stat.nlink !== 2n) fail();
      await onProgress({ phase: "marker_published" });
      await assertProof();
      await verifyRaw(retainedPath);
      await verifyMarker(path, proof.marker);
      saved = await catalog.activateCompression({
        targetId,
        runId,
        id: saved.record.id,
        sourceBinding: proof.source,
        binding: proof.marker,
      });
    }
    await onProgress({ phase: "activated" });
    saved = await assertProof();
    if (saved.state !== "active" || !same(saved.binding, proof.marker)) fail();
    await verifyMarker(path, saved.binding);
    const retained = await optional(retainedPath);
    if (retained) {
      const value = await verifyRaw(retainedPath);
      if (value.stat.nlink !== 1n) fail();
      await assertProof();
      await verifyMarker(path, saved.binding);
      await io.unlinkOwned(retainedPath, value.stat, directoryIdentity);
      plainBytesRemoved = raw.length;
      await io.syncDirectory(directory);
    }
    await onProgress({ phase: "source_retired" });
    await assertProof();
    const temporary = await optional(temporaryPath);
    if (temporary) {
      const value = await verifyMarker(temporaryPath, proof.marker),
        published = await verifyMarker(path, saved.binding);
      if (value.stat.nlink !== 2n || published.stat.nlink !== 2n) fail();
      await io.unlinkOwned(temporaryPath, value.stat, directoryIdentity);
      await io.syncDirectory(directory);
    }
    const final = await verifyMarker(path, saved.binding);
    if (
      final.stat.nlink !== 1n ||
      (await optional(retainedPath)) ||
      (await optional(temporaryPath))
    )
      fail();
    await onProgress({ phase: "cleanup_verified" });
    await assertProof();
    const verified = await verifyMarker(path, saved.binding);
    if (
      !stable(final.stat, verified.stat) ||
      (await optional(retainedPath)) ||
      (await optional(temporaryPath))
    )
      fail();
    saved = await catalog.clearCompressionReplacement({
      targetId,
      runId,
      id: saved.record.id,
      binding: saved.binding,
    });
    await owned.cleanup();
    return result(saved, plainBytesRemoved);
  } catch (error) {
    if (
      /^(compression_|catalog_|target_|workspace_|journal_)/.test(
        error?.code ?? "",
      )
    )
      throw error;
    fail("compression_storage");
  } finally {
    try {
      await owned.cleanup();
    } finally {
      active.delete(key);
    }
  }
}
