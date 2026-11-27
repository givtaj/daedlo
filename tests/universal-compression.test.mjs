import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { materializeV1 } from "./fixtures/storage-r3/materialize.mjs";
import { readRunJournal } from "../packages/universal/vendor/tools/lib/run-journal.mjs";
import {
  parseJournalBytes,
  decodeCompression,
  checkedCompressionRecord,
  compressionMarker,
} from "../packages/universal/src/compressed-journal.mjs";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function fixture(t) {
  const base = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "universal-compression-")),
  );
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const f = await materializeV1(base);
  const workspace = {
    root: f.root,
    id: f.retained.workspace.workspaceId,
    projectId: f.current.projectId,
    journal: 1,
    journalRoot: join(f.root, "projects", f.current.projectId, "run-journals"),
    assertCompatible: async () => {},
  };
  return { ...f, base, workspace, runId: f.retained.run.runId };
}
const parse = (f, bytes) =>
  parseJournalBytes({
    bytes,
    workspaceId: f.workspace.id,
    projectId: f.workspace.projectId,
    runId: f.runId,
  });
test("Universal compressed reader preserves the unchanged basic v1 parser contract", async (t) => {
  const f = await fixture(t),
    original = await fs.readFile(f.journalPath);
  const lines = original.toString().trimEnd().split("\n");
  const cases = [
    original,
    Buffer.from(lines[0] + "\n"),
    Buffer.from(lines[0] + '\n{"partial"'),
    Buffer.from(
      original
        .toString()
        .replace("daedlo-run-journal/1", "daedlo-run-journal/99"),
    ),
    Buffer.from(original.toString().replace('"sequence":2', '"sequence":12')),
    Buffer.from(
      original.toString().replaceAll(f.workspace.id, "foreign-workspace"),
    ),
    Buffer.concat([original, Buffer.from(lines[0] + "\n")]),
    Buffer.from([0xff, 10]),
  ];
  for (const bytes of cases) {
    await fs.writeFile(f.journalPath, bytes);
    let expected, actual;
    try {
      expected = {
        result: await readRunJournal({
          workspace: f.workspace,
          runId: f.runId,
        }),
      };
    } catch (e) {
      expected = { error: e.code };
    }
    try {
      actual = { result: parse(f, bytes) };
    } catch (e) {
      actual = { error: e.code };
    }
    assert.deepEqual(actual, expected);
  }
});
test("compression validates exact bounded original bytes and refuses malformed or foreign proof", async (t) => {
  const f = await fixture(t),
    bytes = await fs.readFile(f.journalPath),
    compressed = gzipSync(bytes),
    stat = await fs.stat(f.journalPath, { bigint: true });
  const record = {
    format: "daedlo-journal-compression/1",
    id: randomUUID(),
    workspaceId: f.workspace.id,
    projectId: f.workspace.projectId,
    targetId: f.current.id,
    runId: f.runId,
    source: {
      dev: String(stat.dev),
      ino: String(stat.ino),
      bytes: bytes.length,
      sha256: hash(bytes),
    },
    gzip: { bytes: compressed.length, sha256: hash(compressed) },
    createdAt: new Date().toISOString(),
  };
  const result = decodeCompression({ record, gzipBytes: compressed });
  assert.deepEqual(result.bytes, bytes);
  assert.deepEqual(
    result.history,
    await readRunJournal({ workspace: f.workspace, runId: f.runId }),
  );
  assert.throws(() =>
    decodeCompression({
      record: { ...record, projectId: "foreign" },
      gzipBytes: compressed,
    }),
  );
  assert.throws(() =>
    decodeCompression({ record, gzipBytes: compressed.subarray(0, -1) }),
  );
  assert.throws(() =>
    checkedCompressionRecord({
      ...record,
      source: { ...record.source, bytes: 16 * 1024 * 1024 + 1 },
    }),
  );
  assert.throws(() =>
    checkedCompressionRecord({ ...record, codec: "unknown" }),
  );
  const marker = compressionMarker(record);
  await fs.writeFile(f.journalPath, marker);
  await assert.rejects(
    readRunJournal({ workspace: f.workspace, runId: f.runId }),
    { code: "journal_incompatible" },
  );
});

import {
  openCatalog,
  upgradeCatalog,
} from "../packages/universal/src/catalog.mjs";
import { compressJournal } from "../packages/universal/src/journal-compression.mjs";
test("retaining then replacing a closed journal preserves exact history and reserves the basic run name", async (t) => {
  const f = await fixture(t),
    original = await fs.readFile(f.journalPath);
  await upgradeCatalog({ root: f.root, toVersion: 4 });
  const retained = await compressJournal({
    root: f.root,
    targetId: f.current.id,
    runId: f.runId,
  });
  assert.equal(retained.state, "retained");
  assert.deepEqual(await fs.readFile(f.journalPath), original);
  const active = await compressJournal({
    root: f.root,
    targetId: f.current.id,
    runId: f.runId,
    replace: true,
  });
  assert.equal(active.state, "active");
  assert.equal(active.sourceRetained, false);
  assert.equal(active.plainBytesRemoved, original.length);
  await assert.rejects(
    readRunJournal({ workspace: f.workspace, runId: f.runId }),
    { code: "journal_incompatible" },
  );
  const catalog = await openCatalog({ root: f.root });
  try {
    const saved = await catalog.getCompression({
      targetId: f.current.id,
      runId: f.runId,
    });
    assert.equal(saved.replacement, null);
    assert.deepEqual(decodeCompression(saved).bytes, original);
    assert.deepEqual(
      (await catalog.getRun({ targetId: f.current.id, runId: f.runId })).report,
      f.retained.run.report,
    );
    await catalog.indexTarget(f.current.id, { rebuild: true });
    assert.deepEqual(
      (await catalog.getRun({ targetId: f.current.id, runId: f.runId })).report,
      f.retained.run.report,
    );
  } finally {
    await catalog.close();
  }
  const again = await compressJournal({
    root: f.root,
    targetId: f.current.id,
    runId: f.runId,
    replace: true,
  });
  assert.equal(again.compressionId, active.compressionId);
  assert.equal(again.plainBytesRemoved, 0);
});

test("a gzip stream cannot expand beyond the declared bounded journal", async (t) => {
  const f = await fixture(t),
    source = await fs.readFile(f.journalPath),
    stat = await fs.stat(f.journalPath, { bigint: true }),
    bomb = gzipSync(Buffer.alloc(17 * 1024 * 1024, 97));
  const record = {
    format: "daedlo-journal-compression/1",
    id: randomUUID(),
    workspaceId: f.workspace.id,
    projectId: f.workspace.projectId,
    targetId: f.current.id,
    runId: f.runId,
    source: {
      dev: String(stat.dev),
      ino: String(stat.ino),
      bytes: source.length,
      sha256: hash(source),
    },
    gzip: { bytes: bomb.length, sha256: hash(bomb) },
    createdAt: new Date().toISOString(),
  };
  assert.throws(() => decodeCompression({ record, gzipBytes: bomb }), {
    code: "compression_corrupt",
  });
});
