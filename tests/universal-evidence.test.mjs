import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createEvidenceStore } from "../packages/universal/src/evidence.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const source = {
  id: "fixture-installation",
  version: "0.1.0-fixture",
  sourceSha256: "a".repeat(64),
  model: { id: "fixture", version: "1" },
};
const run = (targetId, runId = "retained-run") => ({
  targetId,
  workspaceId: "fixture-workspace",
  projectId: `project-${targetId}`,
  runId,
  status: "finished",
  events: [
    {
      runId,
      sequence: 1,
      eventId: "start",
      type: "run_started",
      payload: { installation: source },
    },
    {
      runId,
      sequence: 2,
      eventId: "finished",
      type: "run_finished",
      payload: {},
    },
  ],
});
async function fixture(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "universal-evidence-")),
  );
  await fs.writeFile(
    join(root, "workspace.json"),
    JSON.stringify({
      schemaVersion: 1,
      kind: "daedlo-workspace",
      workspaceId: "fixture-workspace",
      formats: { managedRun: 1, runJournal: 1 },
    }),
  );
  const targets = new Map(
    ["a", "b"].map((id) => [
      id,
      {
        id,
        projectId: `project-${id}`,
        revision: 1,
        model: source.model,
        sourceSha256: source.sourceSha256,
      },
    ]),
  );
  const records = new Map();
  const catalog = {
    catalogVersion: 2,
    async getTarget(id) {
      if (!targets.has(id))
        throw Object.assign(Error(), { code: "target_not_found" });
      return structuredClone(targets.get(id));
    },
    async getRun({ targetId, runId }) {
      await this.getTarget(targetId);
      if (runId !== "retained-run")
        throw Object.assign(Error(), { code: "journal_missing" });
      return structuredClone(run(targetId, runId));
    },
    async addEvidence(record) {
      const key = `${record.targetId}/${record.id}`;
      if (records.has(key)) assert.deepEqual(records.get(key), record);
      records.set(key, structuredClone(record));
      return structuredClone(record);
    },
    async getEvidence({ targetId, evidenceId }) {
      await this.getTarget(targetId);
      const value = records.get(`${targetId}/${evidenceId}`);
      if (!value) throw Object.assign(Error(), { code: "evidence_not_found" });
      return structuredClone(value);
    },
  };
  const handles = [];
  const open = async () => {
    const value = await createEvidenceStore({ root, catalog });
    handles.push(value);
    return value;
  };
  t.after(async () => {
    for (const value of handles) await value.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const input = {
    targetId: "a",
    runId: "retained-run",
    eventSequence: 2,
    label: "Independent observed result",
    mediaType: "text/plain",
    bytes: Buffer.from("Synthetic evidence only\n"),
  };
  return {
    root,
    catalog,
    records,
    targets,
    open,
    input,
    file: (id) => join(root, "evidence", "a", `${id}.bin`),
  };
}

test("evidence persists exact private bytes and retained run provenance across current-model changes", async (t) => {
  const f = await fixture(t),
    store = await f.open();
  f.targets.get("a").model = { id: "fixture", version: "2" };
  const saved = await store.put(f.input);
  assert.equal(
    saved.sha256,
    hash(f.input.bytes),
    "Committed evidence must bind its exact file bytes",
  );
  assert.equal(saved.bytes, f.input.bytes.length);
  assert.equal(saved.eventId, "finished");
  assert.deepEqual(saved.provenance, {
    installationId: source.id,
    runtimeVersion: source.version,
    sourceSha256: source.sourceSha256,
    model: source.model,
  });
  assert.equal(f.records.size, 1);
  assert.doesNotMatch(
    await fs.readFile(
      join(f.root, "evidence", "a", `${saved.id}.json`),
      "utf8",
    ),
    /Synthetic evidence only/,
  );
  assert.deepEqual(
    (await store.read({ targetId: "a", evidenceId: saved.id })).bytes,
    f.input.bytes,
  );
  assert.equal((await fs.stat(f.file(saved.id))).mode & 0o777, 0o600);
  assert.deepEqual(await store.listPending({ targetId: "a" }), []);
  await store.close();
  assert.equal(
    (await (await f.open()).inspect({ targetId: "a", evidenceId: saved.id }))
      .integrity,
    "available",
  );
});

test("evidence rejects cross-target and missing event references before file creation", async (t) => {
  const f = await fixture(t),
    store = await f.open();
  await assert.rejects(store.put({ ...f.input, eventSequence: 99 }), {
    code: "evidence_reference",
  });
  const original = f.catalog.getRun;
  f.catalog.getRun = async (request) => ({
    ...(await original.call(f.catalog, request)),
    targetId: "b",
    projectId: "project-b",
  });
  await assert.rejects(store.put(f.input), { code: "evidence_reference" });
  await assert.rejects(fs.stat(join(f.root, "evidence")), { code: "ENOENT" });
  f.catalog.getRun = original;
  const saved = await store.put(f.input);
  await assert.rejects(store.read({ targetId: "b", evidenceId: saved.id }), {
    code: "evidence_not_found",
  });
});

test("evidence rejects traversal, unsafe types, oversized bytes and hardlinked reads", async (t) => {
  const f = await fixture(t),
    store = await f.open();
  for (const patch of [
    { targetId: "../a" },
    { runId: "../run" },
    { mediaType: "text/html" },
    { bytes: Buffer.alloc(16 * 1024 * 1024 + 1) },
    { eventSequence: 0 },
  ])
    await assert.rejects(store.put({ ...f.input, ...patch }), {
      code: "evidence_invalid",
    });
  await assert.rejects(
    store.read({ targetId: "a", evidenceId: "../outside" }),
    { code: "evidence_invalid" },
  );
  const saved = await store.put(f.input);
  await fs.link(f.file(saved.id), join(f.root, "unowned-link"));
  assert.equal(
    (await store.inspect({ targetId: "a", evidenceId: saved.id })).integrity,
    "corrupt",
  );
  await assert.rejects(store.read({ targetId: "a", evidenceId: saved.id }), {
    code: "evidence_corrupt",
  });
});

test("read-only evidence inspection discloses missing or changed bytes and never repairs them", async (t) => {
  const f = await fixture(t),
    store = await f.open(),
    saved = await store.put(f.input);
  const registered = structuredClone([...f.records.values()]);
  await fs.writeFile(f.file(saved.id), "Different bytes");
  const before = await fs.readFile(f.file(saved.id));
  assert.equal(
    (await store.inspect({ targetId: "a", evidenceId: saved.id })).integrity,
    "corrupt",
  );
  assert.deepEqual(await fs.readFile(f.file(saved.id)), before);
  await fs.unlink(f.file(saved.id));
  assert.equal(
    (await store.inspect({ targetId: "a", evidenceId: saved.id })).integrity,
    "missing",
  );
  await assert.rejects(store.read({ targetId: "a", evidenceId: saved.id }), {
    code: "evidence_missing",
  });
  assert.deepEqual([...f.records.values()], registered);
});

test("database commit failure retains published evidence and an explicit idempotent retry", async (t) => {
  const f = await fixture(t),
    store = await f.open(),
    add = f.catalog.addEvidence;
  f.catalog.addEvidence = async () => {
    throw Object.assign(Error("Private database detail"), {
      code: "catalog_storage",
    });
  };
  let failure;
  await assert.rejects(store.put(f.input), (error) => {
    failure = error;
    return error.code === "evidence_uncommitted" && error.retained === true;
  });
  assert.deepEqual(
    await fs.readFile(f.file(failure.evidenceId)),
    f.input.bytes,
  );
  const pending = await store.listPending({ targetId: "a" });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, failure.evidenceId);
  assert.equal(pending[0].state, "uncommitted");
  assert.equal(f.records.size, 0);
  f.catalog.addEvidence = add;
  await store.retry({ targetId: "a", evidenceId: failure.evidenceId });
  await store.retry({ targetId: "a", evidenceId: failure.evidenceId });
  assert.equal(f.records.size, 1);
  assert.deepEqual(await store.listPending({ targetId: "a" }), []);
});

test("an interrupted publication retains only receipt-bound bytes for explicit completion", async (t) => {
  const f = await fixture(t),
    store = await f.open(),
    link = fs.link;
  const mocked = mock.method(fs, "link", async (a, b) => {
    if (b.endsWith(".bin"))
      throw Object.assign(Error("Injected publication failure"), {
        code: "EIO",
      });
    return link(a, b);
  });
  let failure;
  try {
    await assert.rejects(store.put(f.input), (error) => {
      failure = error;
      return error.code === "evidence_uncommitted";
    });
  } finally {
    mocked.mock.restore();
  }
  assert.equal(f.records.size, 0);
  await assert.rejects(fs.stat(f.file(failure.evidenceId)), { code: "ENOENT" });
  assert.equal(
    (await store.listPending({ targetId: "a" }))[0].state,
    "uncommitted",
  );
  const saved = await store.retry({
    targetId: "a",
    evidenceId: failure.evidenceId,
  });
  assert.deepEqual(
    (await store.read({ targetId: "a", evidenceId: saved.id })).bytes,
    f.input.bytes,
  );
});

test("evidence refuses replaced workspace directories and symlink storage without changing their targets", async (t) => {
  const f = await fixture(t),
    store = await f.open();
  const external = join(f.root, "other");
  await fs.mkdir(external);
  await fs.symlink(external, join(f.root, "evidence"));
  await assert.rejects(store.put(f.input), {
    code: "evidence_ownership_changed",
  });
  assert.deepEqual(await fs.readdir(external), []);
});

test("receipt publication interrupted after its link can be explicitly completed without adopting a foreign hardlink", async (t) => {
  const f = await fixture(t),
    store = await f.open(),
    unlink = fs.unlink;
  const mocked = mock.method(fs, "unlink", async (path) => {
    if (path.endsWith(".json.tmp"))
      throw Object.assign(Error("Interrupted after receipt publication"), {
        code: "EIO",
      });
    return unlink(path);
  });
  let failure;
  try {
    await assert.rejects(store.put(f.input), (error) => {
      failure = error;
      return error.code === "evidence_uncommitted";
    });
  } finally {
    mocked.mock.restore();
  }
  const result = await store.retry({
    targetId: "a",
    evidenceId: failure.evidenceId,
  });
  assert.equal(
    result.integrity,
    "available",
    "The exact retained publication link must be resumable",
  );
  assert.equal(f.records.size, 1);
  assert.deepEqual(
    (await store.read({ targetId: "a", evidenceId: result.id })).bytes,
    f.input.bytes,
  );
});

test("stale expected target revision is rejected before publishing evidence", async (t) => {
  const f = await fixture(t),
    store = await f.open();
  await assert.rejects(store.put({ ...f.input, expectedTargetRevision: 2 }), {
    code: "target_changed",
  });
  await assert.rejects(fs.stat(join(f.root, "evidence")), { code: "ENOENT" });
});

test("a v1 catalog must be explicitly upgraded before evidence publication", async (t) => {
  const f = await fixture(t),
    store = await f.open();
  f.catalog.catalogVersion = 1;
  await assert.rejects(store.put(f.input), {
    code: "catalog_upgrade_required",
  });
  assert.equal(f.records.size, 0);
  await assert.rejects(fs.stat(join(f.root, "evidence")), { code: "ENOENT" });
});

test("optional caller revisions still pin the observed target at evidence commit and retry", async (t) => {
  const f = await fixture(t),
    store = await f.open(),
    add = f.catalog.addEvidence;
  const revisions = [];
  f.catalog.addEvidence = async (record, options) => {
    revisions.push(options?.expectedTargetRevision);
    return add.call(f.catalog, record);
  };
  const saved = await store.put(f.input);
  await store.retry({ targetId: "a", evidenceId: saved.id });
  assert.deepEqual(
    revisions,
    [1, 1],
    "Both publications must carry a captured target revision into the catalog transaction",
  );
});

test(
  "pending discovery supports more than five thousand committed evidence pairs without reopening each record",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t),
      store = await f.open(),
      seed = await store.put(f.input);
    const { integrity, ...record } = seed;
    const ids = Array.from(
      { length: 5000 },
      (_, index) => `retained-${String(index).padStart(5, "0")}`,
    );
    let offset = 0;
    await Promise.all(
      Array.from({ length: 32 }, async () => {
        for (;;) {
          const index = offset++;
          if (index >= ids.length) return;
          const id = ids[index],
            value = { ...record, id },
            file = f.file(id);
          f.records.set(`a/${id}`, value);
          await fs.writeFile(file, f.input.bytes, { mode: 0o600 });
          const stat = await fs.stat(file, { bigint: true });
          await fs.writeFile(
            join(f.root, "evidence", "a", `${id}.json`),
            JSON.stringify({
              format: "daedlo-evidence-publication/1",
              workspaceId: "fixture-workspace",
              record: value,
              file: { dev: String(stat.dev), ino: String(stat.ino) },
            }),
            { mode: 0o600 },
          );
        }
      }),
    );
    let pages = 0,
      lookups = 0;
    const get = f.catalog.getEvidence;
    f.catalog.getEvidence = async (input) => {
      lookups++;
      return get.call(f.catalog, input);
    };
    f.catalog.listEvidence = async ({ targetId, limit, cursor }) => {
      pages++;
      const all = [...f.records.values()]
          .filter((value) => value.targetId === targetId)
          .sort((a, b) => a.id.localeCompare(b.id)),
        start = cursor === null ? 0 : Number(cursor);
      return {
        targetId,
        items: all.slice(start, start + limit),
        nextCursor: start + limit < all.length ? String(start + limit) : null,
      };
    };
    assert.deepEqual(await store.listPending({ targetId: "a" }), []);
    assert.equal(
      pages,
      51,
      "Discovery reads committed catalog pages in bounded batches",
    );
    assert.equal(
      lookups,
      0,
      "Committed records do not require one new database lookup per receipt",
    );
  },
);

test("a v1 catalog refuses evidence retry without changing retained publication files", async (t) => {
  const f = await fixture(t),
    store = await f.open(),
    add = f.catalog.addEvidence;
  f.catalog.addEvidence = async () => {
    throw Object.assign(Error(), { code: "catalog_storage" });
  };
  let failure;
  await assert.rejects(store.put(f.input), (error) => {
    failure = error;
    return error.code === "evidence_uncommitted";
  });
  const path = f.file(failure.evidenceId),
    before = await fs.readFile(path),
    stat = await fs.stat(path, { bigint: true });
  f.catalog.addEvidence = add;
  f.catalog.catalogVersion = 1;
  await assert.rejects(
    store.retry({ targetId: "a", evidenceId: failure.evidenceId }),
    { code: "catalog_upgrade_required" },
  );
  assert.equal(f.records.size, 0);
  assert.deepEqual(await fs.readFile(path), before);
  assert.equal((await fs.stat(path, { bigint: true })).ino, stat.ino);
});

test(
  "actual process death between file publication and database commit retains an explicit same-ID recovery",
  { timeout: 20000 },
  async (t) => {
    const f = await fixture(t);
    const moduleUrl = new URL(
      "../packages/universal/src/evidence.mjs",
      import.meta.url,
    ).href;
    const script = join(f.root, "child.mjs");
    await fs.writeFile(
      script,
      `import {createEvidenceStore} from ${JSON.stringify(moduleUrl)};\nconst root=${JSON.stringify(f.root)}, input=${JSON.stringify({ ...f.input, bytes: null })},history=${JSON.stringify(run("a"))};\ninput.bytes=Buffer.from(${JSON.stringify(f.input.bytes.toString("utf8"))});\nconst catalog={catalogVersion:2,getTarget:async id=>({id,projectId:'project-'+id,revision:1}),getRun:async()=>history,addEvidence:async record=>{process.stdout.write(JSON.stringify({id:record.id})+'\\n');await new Promise(()=>{});}};\nconst store=await createEvidenceStore({root,catalog});\nsetInterval(()=>{},1000);await store.put(input);\n`,
    );
    const child = spawn(process.execPath, [script], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exited = once(child, "exit");
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await exited;
      }
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const saved = await new Promise((resolve, reject) => {
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
        if (output.includes("\n")) resolve(JSON.parse(output.split("\n")[0]));
      });
      child.once("exit", () =>
        reject(Error("Child exited before publication: " + stderr)),
      );
    });
    child.kill("SIGKILL");
    await exited;
    const store = await f.open();
    assert.equal(f.records.size, 0);
    assert.equal((await store.listPending({ targetId: "a" }))[0].id, saved.id);
    const bytes = await fs.readFile(f.file(saved.id));
    assert.deepEqual(bytes, f.input.bytes);
    const recovered = await store.retry({
      targetId: "a",
      evidenceId: saved.id,
    });
    assert.equal(recovered.id, saved.id);
    assert.equal(f.records.size, 1);
    assert.deepEqual(await fs.readFile(f.file(saved.id)), bytes);
  },
);

test("failed evidence handle cleanup is retained for an explicit close retry", async (t) => {
  const f = await fixture(t),
    store = await f.open(),
    open = fs.open;
  let closes = 0;
  const mocked = mock.method(fs, "open", async (...args) => {
    const handle = await open(...args);
    if (String(args[0]).endsWith(".bin.tmp")) {
      const close = handle.close.bind(handle);
      handle.close = async () => {
        if (++closes < 3)
          throw Object.assign(Error("Injected close failure"), { code: "EIO" });
        return close();
      };
    }
    return handle;
  });
  try {
    await assert.rejects(store.put(f.input), { code: "evidence_uncommitted" });
    await assert.rejects(store.close(), {
      code: "evidence_cleanup_incomplete",
    });
    await store.close();
    assert.equal(closes, 3);
  } finally {
    mocked.mock.restore();
  }
});

for (const phase of ["write", "sync"]) {
  test(`evidence ${phase} failure retains partial publication without a catalog success`, async (t) => {
    const f = await fixture(t),
      store = await f.open(),
      open = fs.open;
    const mocked = mock.method(fs, "open", async (...args) => {
      const handle = await open(...args);
      if (String(args[0]).endsWith(".bin.tmp")) {
        if (phase === "write")
          handle.writeFile = async (bytes) => {
            await handle.write(bytes.subarray(0, 5));
            throw Object.assign(Error("Synthetic storage full"), {
              code: "ENOSPC",
            });
          };
        else
          handle.sync = async () => {
            throw Object.assign(Error("Synthetic sync failure"), {
              code: "EIO",
            });
          };
      }
      return handle;
    });
    let failure;
    try {
      await assert.rejects(store.put(f.input), (error) => {
        failure = error;
        return error.code === "evidence_uncommitted" && error.retained === true;
      });
    } finally {
      mocked.mock.restore();
    }
    assert.equal(f.records.size, 0);
    assert.deepEqual(await store.listPending({ targetId: "a" }), [
      {
        id: failure.evidenceId,
        targetId: "a",
        state: "unproven",
        integrity: "unproven",
      },
    ]);
    const path = join(
        f.root,
        "evidence",
        "a",
        `.${failure.evidenceId}.bin.tmp`,
      ),
      before = await fs.readFile(path);
    await assert.rejects(
      store.retry({ targetId: "a", evidenceId: failure.evidenceId }),
      { code: "evidence_unproven" },
    );
    assert.deepEqual(await fs.readFile(path), before);
  });
}
