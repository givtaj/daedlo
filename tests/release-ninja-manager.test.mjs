import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { createNinjaManager } from "../scripts/release/ninja-manager.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(
    join(await fs.realpath(os.tmpdir()), "ninja-manager-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let source = "original",
    offered = "1.0.0",
    failure = null,
    running = null,
    busy = false,
    dirty = false,
    cleanup = false;
  const log = [];
  const registration = {
    schemaVersion: 1,
    projectId: "fixture",
    label: "Test project",
  };
  const provider = {
    async check() {
      return {
        checkpoint: { generation: 1, sha256: "a".repeat(64) },
        available: { id: offered, version: offered },
      };
    },
    async download(release, path) {
      return { version: release.version, path };
    },
  };
  const installer = {
    async prepare({ verifiedKit, destination }) {
      if (failure === "build") throw Error("build failed");
      await fs.mkdir(destination);
      const receipt = {
        id: destination.split("/").at(-1),
        path: destination,
        version: verifiedKit.version,
        sourceSha256: source,
      };
      await fs.writeFile(
        join(destination, "receipt.json"),
        JSON.stringify(receipt),
      );
      return receipt;
    },
    async verify(path, { checkSource = true } = {}) {
      const r = JSON.parse(await fs.readFile(join(path, "receipt.json")));
      if (checkSource && r.sourceSha256 !== source)
        throw Error("Project inputs changed; prepare again");
      return r;
    },
  };
  const supervisor = {
    async status() {
      return { running, busy, paused: false, dirty, cleanupPending: cleanup };
    },
    async quiesce() {
      if (busy || dirty) throw Error("unsafe boundary");
      log.push("quiesce");
    },
    async report() {
      log.push("report");
      if (failure === "report") throw Error("report failed");
      return { format: "browser-driver-report/1", value: "preserved" };
    },
    async close() {
      log.push("close");
      if (cleanup) throw Error("cleanup incomplete");
      running = null;
    },
    async start(receipt) {
      log.push("start:" + receipt.version);
      if (failure === "boot" && receipt.version === "2.0.0")
        throw Error("boot failed");
      running = { id: receipt.id, version: receipt.version };
    },
  };
  let fault = null;
  const options = {
    root,
    registration,
    provider,
    installer,
    supervisor,
    fault: async (point) => {
      if (point === fault) {
        const e = Error("simulated crash");
        e.simulatedCrash = true;
        throw e;
      }
    },
  };
  const manager = await createNinjaManager(options);
  return {
    root,
    manager,
    options,
    log,
    setSource: (v) => (source = v),
    setOffer: (v) => (offered = v),
    setFailure: (v) => (failure = v),
    setBusy: (v) => (busy = v),
    setDirty: (v) => (dirty = v),
    setCleanup: (v) => (cleanup = v),
    setFault: (v) => (fault = v),
  };
}
async function install(f, version) {
  f.setOffer(version);
  await f.manager.check();
  const r = await f.manager.prepare(version);
  await f.manager.activate(r.operation.id, { acknowledgeRestart: true });
  return f.manager.status();
}

test("upgrade and rollback select complete immutable installations and persist reports", async (t) => {
  const f = await fixture(t);
  const first = await install(f, "1.0.0");
  f.log.length = 0;
  const second = await install(f, "2.0.0");
  assert.equal(second.selected?.version, "2.0.0");
  assert.equal(second.running?.version, "2.0.0");
  assert.equal(second.canRollback, true);
  f.setSource("later edits");
  const reverted = await f.manager.rollback({ acknowledgeRestart: true });
  assert.equal(reverted.selected.id, first.selected.id);
  assert.equal(reverted.selected.historicalSnapshot, true);
  assert.equal(reverted.running.version, "1.0.0");
  const reports = await fs.readdir(join(f.root, "reports"));
  assert.ok(reports.length >= 2);
  assert.ok(f.log.indexOf("report") < f.log.indexOf("close"));
});
test("status distinguishes unknown draft knowledge from a confirmed dirty draft", async (t) => {
  const f = await fixture(t);
  f.setDirty(null);
  let state = await f.manager.status();
  assert.equal(state.dirty, null);
  assert.ok(state.blockers.some((item) => item.code === "draft_unknown"));
  assert.equal(
    state.blockers.some((item) => item.code === "dirty_draft"),
    false,
  );
  f.setDirty(true);
  state = await f.manager.status();
  assert.equal(state.dirty, true);
  assert.ok(state.blockers.some((item) => item.code === "dirty_draft"));
  f.setDirty(false);
  assert.equal((await f.manager.status()).blockers.length, 0);
});

test("manager status retains sanitized failed-observation knowledge", async (t) => {
  const f = await fixture(t);
  const status = f.options.supervisor.status;
  f.options.supervisor.status = async () => ({
    ...(await status()),
    dirty: null,
    observation: {
      status: "failed",
      error: {
        code: "observation_failed",
        message: "private-observation-path",
      },
    },
  });
  const state = await f.manager.status();
  assert.equal(state.observation?.status, "failed");
  assert.equal(state.observation.error.code, "observation_failed");
  assert.ok(state.blockers.some((item) => item.code === "observation_failed"));
  assert.equal(
    JSON.stringify(state).includes("private-observation-path"),
    false,
  );
});
test("explicit close can finish its own retained quiesce after fresh observation recovers", async (t) => {
  const f = await fixture(t);
  await install(f, "1.0.0");
  f.log.length = 0;
  const status = f.options.supervisor.status;
  const quiesce = f.options.supervisor.quiesce;
  const close = f.options.supervisor.close;
  let quiesced = false;
  let observation = { status: "available" };
  f.options.supervisor.status = async () => ({
    ...(await status()),
    quiesced,
    paused: quiesced,
    observation,
  });
  f.options.supervisor.quiesce = async () => {
    await quiesce();
    quiesced = true;
  };
  f.options.supervisor.close = async () => {
    if (
      observation.status === "available" &&
      f.log.filter((x) => x === "quiesce").length === 1
    ) {
      observation = { status: "failed", error: { code: "observation_failed" } };
      throw Object.assign(Error("Fresh observation unavailable before close"), {
        code: "observation_failed",
      });
    }
    return close();
  };
  await assert.rejects(f.manager.close(), { code: "observation_failed" });
  await assert.rejects(f.manager.close(), { code: "observation_failed" });
  assert.equal(f.log.filter((x) => x === "quiesce").length, 1);
  observation = { status: "available" };
  await assert.doesNotReject(f.manager.close());
  assert.equal(f.log.at(-1), "close");
  assert.equal((await f.manager.status()).running, null);
});

test("a retained own pause never waives user pause or unknown draft guards", async (t) => {
  const f = await fixture(t);
  const status = f.options.supervisor.status;
  let quiesced = false;
  f.options.supervisor.status = async () => ({
    ...(await status()),
    paused: true,
    quiesced,
    observation: { status: "available" },
  });
  await assert.rejects(f.manager.close(), { code: "busy" });
  quiesced = true;
  f.setDirty(null);
  await assert.rejects(f.manager.close(), { code: "draft_unknown" });
  f.setDirty(true);
  await assert.rejects(f.manager.close(), { code: "dirty_draft" });
  assert.deepEqual(f.log, []);
});

for (const code of ["engine_timeout", "child_unreachable"])
  test(`cleanup failure ${code} retains recovery state instead of becoming a safe refusal`, async (t) => {
    const f = await fixture(t);
    const first = await install(f, "1.0.0");
    f.setOffer("2.0.0");
    await f.manager.check();
    const candidate = await f.manager.prepare("2.0.0");
    f.options.supervisor.close = async () => {
      throw Object.assign(Error("Cleanup could not be established"), { code });
    };
    await assert.rejects(
      f.manager.activate(candidate.operation.id, { acknowledgeRestart: true }),
      { code, cleanupFailed: true },
    );
    const retained = await f.manager.status();
    assert.equal(retained.phase, "recovery_required");
    assert.equal(retained.selected.id, first.selected.id);
    assert.equal(retained.running.id, first.running.id);
  });

test("failed build and stale authored input retain old runnable selection", async (t) => {
  const f = await fixture(t);
  const before = await install(f, "1.0.0");
  f.setOffer("2.0.0");
  await f.manager.check();
  f.setFailure("build");
  await assert.rejects(f.manager.prepare("2.0.0"), /build failed/);
  assert.equal((await f.manager.status()).selected.id, before.selected.id);
  f.setFailure(null);
  const ready = await f.manager.prepare("2.0.0");
  f.setSource("changed");
  await assert.rejects(
    f.manager.activate(ready.operation.id, { acknowledgeRestart: true }),
    /inputs changed/,
  );
  assert.equal((await f.manager.status()).running.version, "1.0.0");
});
test("busy runs, dirty drafts, failed report and failed cleanup block activation", async (t) => {
  const f = await fixture(t);
  await install(f, "1.0.0");
  f.setOffer("2.0.0");
  await f.manager.check();
  const r = await f.manager.prepare("2.0.0");
  f.setBusy(true);
  await assert.rejects(
    f.manager.activate(r.operation.id, { acknowledgeRestart: true }),
    /busy|safe boundary/i,
  );
  f.setBusy(false);
  f.setDirty(true);
  await assert.rejects(
    f.manager.activate(r.operation.id, { acknowledgeRestart: true }),
    /draft|safe boundary/i,
  );
  f.setDirty(false);
  f.setFailure("report");
  await assert.rejects(
    f.manager.activate(r.operation.id, { acknowledgeRestart: true }),
    /report failed/,
  );
  f.setFailure(null);
  f.setCleanup(true);
  await assert.rejects(
    f.manager.activate(r.operation.id, { acknowledgeRestart: true }),
    /cleanup/i,
  );
  assert.equal((await f.manager.status()).selected.version, "1.0.0");
});
test("failed candidate boot restores previous selection and starts it", async (t) => {
  const f = await fixture(t);
  await install(f, "1.0.0");
  f.setOffer("2.0.0");
  await f.manager.check();
  const r = await f.manager.prepare("2.0.0");
  f.setFailure("boot");
  await assert.rejects(
    f.manager.activate(r.operation.id, { acknowledgeRestart: true }),
    /boot failed/,
  );
  const s = await f.manager.status();
  assert.equal(s.selected.version, "1.0.0");
  assert.equal(s.running.version, "1.0.0");
  assert.equal(s.phase, "failed");
});
for (const point of [
  "journal_prepared",
  "selection_written",
  "candidate_started",
])
  test(`interruption at ${point} recovers accepted previous tuple`, async (t) => {
    const f = await fixture(t);
    await install(f, "1.0.0");
    f.setOffer("2.0.0");
    await f.manager.check();
    const r = await f.manager.prepare("2.0.0");
    f.setFault(point);
    await assert.rejects(
      f.manager.activate(r.operation.id, { acknowledgeRestart: true }),
      /simulated crash/,
    );
    f.setFault(null);
    // A real supervisor refuses recovery until orphan cleanup completes; simulate its exited child here.
    await f.options.supervisor.close();
    const recovered = await createNinjaManager(f.options);
    const s = await recovered.status();
    assert.equal(s.selected.version, "1.0.0");
    assert.equal(s.phase, "recovered");
  });
test("a concurrent manager cannot prepare while another owns the project lock", async (t) => {
  const f = await fixture(t);
  await f.manager.check();
  let release;
  let entered;
  const waiting = new Promise((r) => (entered = r)),
    hold = new Promise((r) => (release = r));
  const original = f.options.installer.prepare;
  f.options.installer.prepare = async (args) => {
    entered();
    await hold;
    return original(args);
  };
  const pending = f.manager.prepare("1.0.0");
  await waiting;
  await assert.rejects(
    createNinjaManager({ ...f.options, recover: false }),
    /locked|in progress/i,
  );
  await assert.rejects(f.manager.check(), /locked|in progress/i);
  release();
  await pending;
});

test("durable shutdown report records completed owned cleanup before activation", async (t) => {
  const f = await fixture(t);
  await install(f, "1.0.0");
  const close = f.options.supervisor.close;
  f.options.supervisor.close = async () => {
    await close();
    return {
      report: {
        format: "browser-driver-report/1",
        resources: [{ owned: true, status: "closed" }],
      },
    };
  };
  await install(f, "2.0.0");
  const reports = await fs.readdir(join(f.root, "reports"));
  const report = JSON.parse(
    await fs.readFile(join(f.root, "reports", reports[0])),
  );
  assert.equal(report.resources?.[0]?.status, "closed");
});
