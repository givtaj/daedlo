import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { createReportArchive } from "../examples/starter/report-archive.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(
    join(await fs.realpath(os.tmpdir()), "evidence-guide-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = join(root, "reports");
  let calls = 0;
  const reports = new Map();
  const session = {
    async execute(id = `run-${calls + 1}`) {
      calls++;
      const result = {
        runId: id,
        execution: "completed",
        outcome: { kind: "success" },
        effect: { status: "saved" },
      };
      reports.set(id, {
        format: "browser-driver-report/1",
        runId: id,
        lastResult: structuredClone(result),
        events: [{ sequence: calls, type: "run_completed" }],
        eventRange: {
          first: calls,
          last: calls,
          retainedFirst: calls,
          truncated: false,
        },
      });
      if (reports.size > 16) reports.delete(reports.keys().next().value);
      return result;
    },
    report({ runId }) {
      return structuredClone(reports.get(runId) ?? null);
    },
  };
  return {
    root,
    directory,
    session,
    reports,
    calls: () => calls,
    archive: createReportArchive({ directory }),
  };
}

test("custom-runner capture preserves every completed run beyond sixteen-report eviction", async (t) => {
  const f = await fixture(t);
  for (let i = 1; i <= 20; i++)
    await f.archive.run(f.session, () => f.session.execute());
  assert.equal(
    f.archive.status().saved,
    20,
    "Each awaited run must be archived immediately, not sampled later",
  );
  assert.equal(f.session.report({ runId: "run-1" }), null);
  const first = JSON.parse(
    await fs.readFile(join(f.directory, "run-1.json"), "utf8"),
  );
  assert.equal(first.runId, "run-1");
  assert.equal(first.lastResult.effect.status, "saved");
  assert.equal((await fs.readdir(f.directory)).length, 20);
  assert.equal((await fs.stat(f.directory)).mode & 0o777, 0o700);
  assert.equal(
    (await fs.stat(join(f.directory, "run-1.json"))).mode & 0o777,
    0o600,
  );
});

test("archive failure retains the original result and retry saves it without replay", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.directory, "fixture obstruction");
  const result = await f.archive.run(f.session, () => f.session.execute());
  assert.equal(result.effect.status, "saved");
  assert.equal(f.archive.status().pending, true);
  assert.equal(f.archive.status().error.code, "evidence_incomplete");
  await assert.rejects(
    f.archive.run(f.session, () => f.session.execute()),
    { code: "evidence_incomplete" },
  );
  assert.equal(f.calls(), 1);
  f.reports.get(result.runId).lastResult.effect.status = "uncertain";
  await fs.unlink(f.directory);
  assert.equal((await f.archive.retry()).pending, false);
  assert.equal(f.calls(), 1, "Retry must never invoke the application action");
  assert.equal(
    JSON.parse(await fs.readFile(join(f.directory, "run-1.json"), "utf8"))
      .lastResult.effect.status,
    "saved",
  );
});

test("conflicting immutable evidence is preserved instead of overwritten", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(f.directory, { mode: 0o700 });
  const prior = "existing different evidence\n";
  await fs.writeFile(join(f.directory, "run-1.json"), prior, { mode: 0o600 });
  await f.archive.run(f.session, () => f.session.execute());
  assert.equal(f.archive.status().pending, true);
  assert.equal(
    await fs.readFile(join(f.directory, "run-1.json"), "utf8"),
    prior,
  );
  await f.archive.retry();
  assert.equal(f.archive.status().pending, true);
  assert.equal(
    await fs.readFile(join(f.directory, "run-1.json"), "utf8"),
    prior,
  );
});

test("immediate refusal without a run does not manufacture an archived report", async (t) => {
  const f = await fixture(t);
  const refusal = {
    execution: "rejected",
    error_code: "revision_required",
    effect: { status: "not_attempted" },
  };
  assert.equal(await f.archive.run(f.session, async () => refusal), refusal);
  assert.equal(f.archive.status().pending, false);
  assert.equal(f.archive.status().saved, 0);
  await assert.rejects(fs.access(f.directory), { code: "ENOENT" });
});

test("unavailable canonical report blocks further runs without changing the application result", async (t) => {
  const f = await fixture(t);
  const session = { report: () => null };
  const result = await f.archive.run(session, () => f.session.execute());
  assert.equal(result.execution, "completed");
  assert.equal(f.archive.status().pending, true);
  await assert.rejects(
    f.archive.run(f.session, () => f.session.execute()),
    { code: "evidence_incomplete" },
  );
  assert.equal(f.calls(), 1);
});

test("capture rejects concurrent calls before their actions run", async (t) => {
  const f = await fixture(t);
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  const active = f.archive.run(f.session, async () => {
    await barrier;
    return f.session.execute();
  });
  await assert.rejects(
    f.archive.run(f.session, () => f.session.execute()),
    { code: "evidence_busy" },
  );
  assert.equal(f.calls(), 0);
  release();
  await active;
  assert.equal(f.calls(), 1);
});

test("unsafe run IDs cannot become archive paths", async (t) => {
  const f = await fixture(t);
  await f.archive.run(f.session, () => f.session.execute("../outside"));
  assert.equal(f.archive.status().pending, true);
  await assert.rejects(fs.access(join(f.root, "outside.json")), {
    code: "ENOENT",
  });
});

test("symlink archive roots are refused without writing through them", async (t) => {
  const f = await fixture(t);
  const other = join(f.root, "other");
  await fs.mkdir(other, { mode: 0o700 });
  await fs.symlink(other, f.directory);
  await f.archive.run(f.session, () => f.session.execute());
  assert.equal(f.archive.status().pending, true);
  assert.deepEqual(await fs.readdir(other), []);
});

test("failed owned temporary cleanup is retained and retried without another application action", async (t) => {
  const f = await fixture(t);
  const unlink = fs.unlink;
  fs.unlink = async (path) => {
    if (String(path).endsWith(".tmp"))
      throw Object.assign(new Error("Synthetic cleanup failure"), {
        code: "EACCES",
      });
    return unlink(path);
  };
  try {
    await f.archive.run(f.session, () => f.session.execute());
  } finally {
    fs.unlink = unlink;
  }
  assert.equal(f.archive.status().pending, true);
  assert.equal((await fs.readdir(f.directory)).length, 2);
  assert.equal((await f.archive.retry()).pending, false);
  assert.deepEqual(await fs.readdir(f.directory), ["run-1.json"]);
  assert.equal(f.calls(), 1);
  assert.equal(f.archive.status().saved, 1);
});
