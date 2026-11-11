import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nativeCommand, runNativeCli } from "../scripts/release/native.mjs";

test("native migration prepares and reviews a stopped project without starting its old model", async (t) => {
  const f = await fixture(t);
  const review = {
    operationId: "migration-1",
    reviewSha256: "a".repeat(64),
    before: { version: "1" },
    after: { version: "2" },
  };
  f.manager.prepareMigration = async () => {
    f.calls.push("migration-prepare");
    return { operation: { id: "migration-1", status: "review_required" } };
  };
  f.manager.reviewMigration = async (id) => {
    assert.equal(id, "migration-1");
    f.calls.push("migration-review");
    return review;
  };
  const prepared = await nativeCommand("migrate-prepare", f.configPath, f.deps);
  assert.equal(prepared.result.operation.status, "review_required");
  const inspected = await nativeCommand("migrate-review", f.configPath, {
    ...f.deps,
    operation: "migration-1",
  });
  assert.deepEqual(inspected.result.migration, review);
  assert.equal(f.calls.includes("start"), false);
  assert.equal(f.calls.includes("activate"), false);
});

test("native migration transports the exact reviewed identity to its existing owner", async (t) => {
  const f = await fixture(t);
  const first = await nativeCommand("start", f.configPath, f.deps);
  const review = {
    operationId: "migration-2",
    reviewSha256: "b".repeat(64),
    before: { version: "1" },
    after: { version: "2" },
  };
  f.manager.prepareMigration = async () => ({
    operation: { id: "migration-2", status: "review_required" },
  });
  f.manager.reviewMigration = async (id) => {
    assert.equal(id, "migration-2");
    return review;
  };
  let activation;
  f.manager.activateMigration = async (id, options) => {
    activation = { id, options };
  };
  await nativeCommand("migrate-prepare", f.configPath, f.deps);
  const inspected = await nativeCommand("migrate-review", f.configPath, {
    ...f.deps,
    operation: "migration-2",
  });
  assert.deepEqual(inspected.result.migration, review);
  await nativeCommand("migrate-activate", f.configPath, {
    ...f.deps,
    operation: "migration-2",
    reviewSha256: review.reviewSha256,
  });
  assert.deepEqual(activation, {
    id: "migration-2",
    options: { reviewSha256: review.reviewSha256, acknowledgeRestart: true },
  });
  f.manager.activateMigration = async () => {
    throw Object.assign(Error("private review details"), {
      code: "migration_review_required",
    });
  };
  await assert.rejects(
    nativeCommand("migrate-activate", f.configPath, {
      ...f.deps,
      operation: "migration-2",
      reviewSha256: "c".repeat(64),
    }),
    (error) =>
      error.code === "migration_review_required" &&
      !error.message.includes("private"),
  );
  await first.close();
});

test("reviewed abandonment closes the native controller only after confirmed owned cleanup", async (t) => {
  const f = await fixture(t);
  const open = f.deps.open;
  let attempts = 0;
  const review = {
    id: "review-1",
    originalResult: { effect: { status: "uncertain" } },
  };
  f.deps.open = async (...args) => {
    const opened = await open(...args);
    f.manager.reviewAbandonment = async () => review;
    f.manager.abandon = async ({ reviewId }) => {
      assert.equal(reviewId, review.id);
      if (++attempts === 1)
        throw Object.assign(Error("private cleanup failure"), {
          code: "cleanup_incomplete",
        });
      await f.manager.close();
      return { closed: true, reviewId };
    };
    return opened;
  };
  const owner = await nativeCommand("start", f.configPath, f.deps);
  try {
    const inspected = await nativeCommand(
      "abandon-review",
      f.configPath,
      f.deps,
    );
    assert.deepEqual(inspected.result.abandonment, review);
    assert.equal(inspected.result.ok, true);
    assert.equal(inspected.result.status, "review_required");
    await assert.rejects(
      nativeCommand("abandon", f.configPath, {
        ...f.deps,
        reviewId: review.id,
      }),
      { code: "cleanup_incomplete" },
    );
    assert.ok(await readFile(join(f.store, "native-session.json")));
    const done = await nativeCommand("abandon", f.configPath, {
      ...f.deps,
      reviewId: review.id,
    });
    assert.equal(done.result.abandonment.closed, true);
    await owner.closed;
    await assert.rejects(readFile(join(f.store, "native-session.json")), {
      code: "ENOENT",
    });
    assert.deepEqual(f.calls, ["open", "start", "close"]);
  } finally {
    await owner.close();
  }
});

test("native CLI rejects missing review identities before opening an owner", async () => {
  const called = [];
  const command = async (...args) => {
    called.push(args);
    return { result: {} };
  };
  for (const args of [
    ["migrate-review", "--config", "/fixture/config.json"],
    [
      "migrate-activate",
      "--config",
      "/fixture/config.json",
      "--operation",
      "candidate",
    ],
    ["abandon", "--config", "/fixture/config.json"],
  ])
    await assert.rejects(runNativeCli(args, { command }), { code: "usage" });
  assert.equal(called.length, 0);
});

test("a stopped migration review refusal releases its transient controller before a corrected activation", async (t) => {
  const f = await fixture(t);
  const digest = "d".repeat(64);
  f.manager.reviewMigration = async () => ({ reviewSha256: digest });
  f.manager.activateMigration = async () => {
    f.calls.push("migrate-activate");
    await f.manager.start();
  };
  await assert.rejects(
    nativeCommand("migrate-activate", f.configPath, {
      ...f.deps,
      operation: "candidate",
      reviewSha256: "e".repeat(64),
    }),
    { code: "migration_review_required" },
  );
  assert.equal(f.calls.includes("start"), false);
  assert.equal(f.calls.includes("migrate-activate"), false);
  await assert.rejects(readFile(join(f.store, "native-session.json")), {
    code: "ENOENT",
  });
  const owner = await nativeCommand("migrate-activate", f.configPath, {
    ...f.deps,
    operation: "candidate",
    reviewSha256: digest,
  });
  try {
    assert.equal(owner.result.status, "running");
  } finally {
    await owner.close();
  }
});

test("a completed action with unavailable status preserves its no-replay result", async (t) => {
  const f = await fixture(t);
  const first = await nativeCommand("start", f.configPath, f.deps);
  const status = f.manager.status;
  f.manager.refresh = async () => {
    f.manager.status = async () => {
      throw Error("read unavailable");
    };
  };
  try {
    await assert.rejects(
      nativeCommand("refresh", f.configPath, f.deps),
      (error) =>
        error.code === "status_unavailable" &&
        error.actionCompleted === true &&
        error.doNotReplay === true,
    );
    await assert.rejects(nativeCommand("status", f.configPath, f.deps), {
      code: "status_unavailable",
    });
  } finally {
    f.manager.status = status;
    await first.close();
  }
});
import { createNinjaSupervisor } from "../scripts/release/ninja-supervisor.mjs";

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "native-cli-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = join(root, "config.json"),
    store = join(root, "store");
  const config = {
    schemaVersion: 1,
    store,
    registration: { projectId: "fixture" },
  };
  await writeFile(configPath, JSON.stringify(config));
  const calls = [];
  let running = false,
    selected = true,
    ready = false,
    dirty = false;
  const status = async () => ({
    project: { id: "fixture" },
    phase: ready ? "ready" : "idle",
    selected: selected ? { id: "installed", version: "1.0.0" } : null,
    running: running ? { id: "installed", version: "1.0.0" } : null,
    operation: ready ? { id: "candidate", status: "ready" } : null,
    available: { id: "1.0.0", version: "1.0.0" },
    blockers: [],
  });
  const manager = {
    status,
    start: async () => {
      calls.push("start");
      running = true;
    },
    close: async () => {
      if (dirty) throw Object.assign(Error("draft"), { code: "dirty_draft" });
      calls.push("close");
      running = false;
    },
    check: async () => {
      calls.push("check");
      return status();
    },
    prepare: async () => {
      calls.push("prepare");
      ready = true;
      return status();
    },
    activate: async () => {
      calls.push("activate");
      selected = true;
      ready = false;
      running = true;
    },
    rollback: async () => {},
    refresh: async () => {
      calls.push("refresh");
      ready = true;
      return status();
    },
  };
  const deps = {
    readConfig: async () => ({ config, keys: [], installation: {} }),
    open: async () => {
      calls.push("open");
      const { mkdir } = await import("node:fs/promises");
      await mkdir(store, { recursive: true });
      return {
        manager,
        supervisor: {
          status: async () => ({
            running: running
              ? { id: "installed", viewerUrl: "http://127.0.0.1:12345/" }
              : null,
          }),
          retryEvidence: async () => {},
        },
      };
    },
    doctor: async () => ({ ok: true, checks: [] }),
    toolsSha256: "c".repeat(64),
  };
  return {
    root,
    configPath,
    store,
    deps,
    calls,
    manager,
    setSelected: (v) => (selected = v),
    setDirty: (v) => (dirty = v),
  };
}

test("start twice reconnects to one owner; stop honors safe boundaries and removes only its receipt", async (t) => {
  const f = await fixture(t);
  const first = await nativeCommand("start", f.configPath, f.deps);
  assert.equal(first.result.status, "running");
  t.after(() => first.close());
  const second = await nativeCommand("start", f.configPath, f.deps);
  assert.equal(second.result.reused, true);
  assert.equal(second.result.viewerUrl, first.result.viewerUrl);
  assert.deepEqual(f.calls, ["open", "start"]);
  f.setDirty(true);
  await assert.rejects(nativeCommand("stop", f.configPath, f.deps), {
    code: "dirty_draft",
  });
  assert.equal(
    JSON.parse(await readFile(join(f.store, "native-session.json"))).instance
      .length,
    32,
  );
  f.setDirty(false);
  await nativeCommand("stop", f.configPath, f.deps);
  await first.closed;
  assert.deepEqual(f.calls, ["open", "start", "close"]);
  assert.equal(
    (await nativeCommand("status", f.configPath, f.deps)).result.status,
    "stopped",
  );
});

test("native status reports observation failure and unreachable child instead of stopped", async (t) => {
  const f = await fixture(t);
  let observation;
  const baseStatus = f.manager.status;
  f.manager.status = async () => ({
    ...(await baseStatus()),
    ...(observation ? { observation, dirty: null } : {}),
  });
  const open = f.deps.open;
  f.deps.open = async (...args) => {
    const value = await open(...args);
    const status = value.supervisor.status;
    value.supervisor.status = async () => {
      const current = await status();
      return observation
        ? {
            ...current,
            observation,
            running: { ...current.running, viewerUrl: null },
          }
        : current;
    };
    return value;
  };
  const first = await nativeCommand("start", f.configPath, f.deps);
  try {
    for (const [kind, expected] of [
      ["failed", "observation_failed"],
      ["unreachable", "unreachable"],
    ]) {
      observation = {
        status: kind,
        error: {
          code: "observation_failed",
          message: "private-observation-error",
        },
      };
      const { result } = await nativeCommand("status", f.configPath, f.deps);
      assert.equal(result.status, expected);
      assert.equal(result.ok, false);
      assert.equal(result.observation.status, kind);
      assert.equal(result.running.id, "installed");
      assert.equal(result.viewerUrl, null);
      assert.equal(result.dirty, null);
      assert.equal(
        JSON.stringify(result).includes("private-observation-error"),
        false,
      );
    }
    observation = undefined;
    assert.equal(
      (await nativeCommand("status", f.configPath, f.deps)).result.status,
      "running",
    );
  } finally {
    observation = undefined;
    await first.close();
  }
});

test("setup resumes a prepared first installation and never upgrades a selected installation", async (t) => {
  const f = await fixture(t);
  await nativeCommand("setup", f.configPath, { ...f.deps, version: "1.0.0" });
  assert.deepEqual(f.calls, ["open", "close"]);
  f.calls.length = 0;
  f.setSelected(false);
  const prepared = await nativeCommand("setup", f.configPath, {
    ...f.deps,
    version: "1.0.0",
  });
  assert.equal(prepared.result.status, "ready");
  assert.deepEqual(f.calls, ["open", "check", "prepare", "close"]);
  f.calls.length = 0;
  await nativeCommand("setup", f.configPath, { ...f.deps, version: "1.0.0" });
  assert.deepEqual(
    f.calls,
    ["open", "close"],
    "repeated setup must not build again",
  );
  const first = await nativeCommand("start", f.configPath, f.deps);
  assert.equal(first.result.status, "running");
  assert.ok(f.calls.includes("activate"));
  await first.close();
});

test("changed tools refuse reuse but can safely stop the existing authenticated owner", async (t) => {
  const f = await fixture(t);
  const first = await nativeCommand("start", f.configPath, f.deps);
  assert.equal(first.result.status, "running");
  t.after(() => first.close());
  const changed = { ...f.deps, toolsSha256: "d".repeat(64) };
  await assert.rejects(nativeCommand("start", f.configPath, changed), {
    code: "stale_session",
  });
  await nativeCommand("stop", f.configPath, changed);
  await first.closed;
});

test("stopped source refresh can activate its ready candidate explicitly", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await nativeCommand("refresh", f.configPath, f.deps)).result.status,
    "ready",
  );
  const handle = await nativeCommand("restart", f.configPath, f.deps);
  assert.equal(handle.result.status, "running");
  assert.ok(f.calls.includes("activate"));
  await handle.close();
});

test("failed startup retains a reachable control owner when cleanup needs retry", async (t) => {
  const f = await fixture(t);
  f.manager.start = async () => {
    throw Object.assign(Error("boot failed"), { code: "boot_failed" });
  };
  const realClose = f.manager.close;
  f.manager.close = async () => {
    throw Object.assign(Error("cleanup failed"), {
      code: "cleanup_incomplete",
    });
  };
  const first = await nativeCommand("start", f.configPath, f.deps);
  assert.equal(first.result.ok, false);
  assert.equal(first.result.status, "recovery_required");
  assert.equal(
    (await nativeCommand("status", f.configPath, f.deps)).result.status,
    "recovery_required",
  );
  f.manager.close = realClose;
  await nativeCommand("stop", f.configPath, f.deps);
  await first.closed;
});

test("failed evidence retry remains a failed command", async (t) => {
  const f = await fixture(t);
  const open = f.deps.open;
  f.deps.open = async (...args) => {
    const value = await open(...args);
    value.supervisor.retryEvidence = async () => ({ pending: 0, failed: 1 });
    return value;
  };
  const first = await nativeCommand("start", f.configPath, f.deps);
  t.after(() => first.close());
  await assert.rejects(nativeCommand("retry-evidence", f.configPath, f.deps), {
    code: "evidence_incomplete",
  });
  await first.close();
});

test("startup cleanup can retry the actual owned child before a session becomes ready", async (t) => {
  const f = await fixture(t);
  const flag = join(f.root, "cleanup-blocked");
  await writeFile(flag, "owned cleanup currently fails");
  await writeFile(
    join(f.root, "runtime.mjs"),
    `export {createResourceScope} from ${JSON.stringify(new URL("../packages/runtime/src/resources.mjs", import.meta.url).href)};`,
  );
  await writeFile(
    join(f.root, "launcher.mjs"),
    `
    import fs from 'node:fs/promises'; import {join} from 'node:path';
    export async function createManagedLaunch({resources,sourceRoot}) {
      resources.own({}, {label:'partial startup resource',close:async()=>{
        try {await fs.access(join(sourceRoot,'cleanup-blocked'));}
        catch(error){if(error.code==='ENOENT')return;throw error;}
        throw Error('owned cleanup must be repaired');
      }});
      throw Error('startup failed before session creation');
    }`,
  );
  const supervisor = await createNinjaSupervisor({
    root: join(f.store, "supervisor"),
    timeoutMs: 3000,
  });
  const receipt = {
    id: "partial",
    version: "1.0.0",
    runtimePath: join(f.root, "runtime.mjs"),
    launcherPath: join(f.root, "launcher.mjs"),
    sourcePath: f.root,
  };
  const open = f.deps.open;
  f.deps.open = async (...args) => ({ ...(await open(...args)), supervisor });
  f.manager.start = () => supervisor.start(receipt);
  f.manager.close = async () => {
    const live = await supervisor.status();
    if (live.busy || live.paused || live.dirty !== false)
      throw Object.assign(
        Error("Unknown startup state is not a normal safe boundary"),
        { code: "busy" },
      );
    await supervisor.quiesce();
    await supervisor.close({ requireSafe: true });
  };
  const first = await nativeCommand("start", f.configPath, f.deps);
  try {
    assert.equal(first.result.status, "recovery_required");
    const partial = await supervisor.status();
    assert.equal(partial.ready, false);
    assert.equal(partial.running, null);
    assert.equal(partial.dirty, null);
    assert.equal(partial.cleanupPending, true);
    await unlink(flag);
    await assert.doesNotReject(
      nativeCommand("stop", f.configPath, f.deps),
      "The retained owner must be able to retry cleanup before any session was ready",
    );
    await first.closed;
    assert.equal((await supervisor.status()).cleanupPending, false);
  } finally {
    await rm(flag, { force: true });
    await supervisor.close();
    f.manager.close = async () => {};
    await first.close();
  }
});

test("status and stop refuse an external child or an unfinished transaction without mutating it", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.store, "supervisor"), { recursive: true });
  const child = join(f.store, "supervisor", "child.json");
  const bytes = JSON.stringify({
    pid: process.pid,
    status: "running",
    installationId: "external",
    token: "retained",
  });
  await writeFile(child, bytes);
  for (const command of ["status", "stop"])
    await assert.rejects(nativeCommand(command, f.configPath, f.deps), {
      code: "recovery_required",
    });
  assert.equal(await readFile(child, "utf8"), bytes);
  assert.deepEqual(
    f.calls,
    [],
    "Read-only owner discovery cannot open or adopt the manager",
  );
  await writeFile(child, JSON.stringify({ status: "closed" }));
  await writeFile(
    join(f.store, "transaction.json"),
    JSON.stringify({ phase: "booting" }),
  );
  await assert.rejects(nativeCommand("status", f.configPath, f.deps), {
    code: "recovery_required",
  });
  await writeFile(
    join(f.store, "transaction.json"),
    JSON.stringify({ phase: "committed" }),
  );
  assert.equal(
    (await nativeCommand("status", f.configPath, f.deps)).result.status,
    "stopped",
  );
});

test("an unresponsive native receipt is retained and never adopted or killed", async (t) => {
  const f = await fixture(t);
  await mkdir(f.store, { recursive: true });
  const path = join(f.store, "native-session.json");
  const bytes = JSON.stringify({
    schemaVersion: 1,
    projectId: "fixture",
    configPath: f.configPath,
    instance: "a".repeat(32),
    pid: process.pid,
    controlUrl: `http://127.0.0.1:1/#token=${"b".repeat(64)}`,
  });
  await writeFile(path, bytes);
  for (const command of ["start", "status", "stop"])
    await assert.rejects(nativeCommand(command, f.configPath, f.deps), {
      code: "recovery_required",
    });
  assert.equal(await readFile(path, "utf8"), bytes);
  assert.deepEqual(f.calls, []);
});

test("setup cannot resume a prepared installation with a different requested version", async (t) => {
  const f = await fixture(t);
  f.setSelected(false);
  await nativeCommand("setup", f.configPath, { ...f.deps, version: "1.0.0" });
  f.calls.length = 0;
  await assert.rejects(
    nativeCommand("setup", f.configPath, { ...f.deps, version: "2.0.0" }),
    { code: "version_unavailable" },
  );
  assert.deepEqual(
    f.calls,
    ["open", "close"],
    "Mismatch must not check, replace or activate the prepared candidate",
  );
});

test("startup recovery never bypasses a known dirty draft or a running session", async (t) => {
  for (const running of [false, true]) {
    const f = await fixture(t);
    let partial = false,
      directCloses = 0;
    const open = f.deps.open;
    const start = f.manager.start,
      close = f.manager.close;
    f.deps.open = async (...args) => {
      const value = await open(...args);
      value.supervisor.status = async () =>
        partial
          ? {
              ready: running,
              running: running
                ? { id: "installed", viewerUrl: "http://127.0.0.1:12345/" }
                : null,
              dirty: true,
              cleanupPending: true,
            }
          : { running: null };
      value.supervisor.close = async () => {
        directCloses++;
      };
      return value;
    };
    f.manager.start = async () => {
      partial = true;
      if (running) await start();
      throw Error("startup did not return");
    };
    f.manager.close = async () => {
      throw Object.assign(Error("private draft"), { code: "dirty_draft" });
    };
    const first = await nativeCommand("start", f.configPath, f.deps);
    try {
      assert.equal(first.result.status, "recovery_required");
      await assert.rejects(nativeCommand("stop", f.configPath, f.deps), {
        code: "dirty_draft",
      });
      assert.equal(
        directCloses,
        0,
        "Recovery must retain the manager's safe boundary for dirty or running sessions",
      );
    } finally {
      partial = false;
      f.manager.close = close;
      await first.close();
    }
  }
});

test("alpha4 exposes startup before a blocked launcher finishes and retains named identity", async (t) => {
  const f = await fixture(t);
  const parsed = await f.deps.readConfig();
  parsed.config.frontend = {
    name: "Settings portal",
    targetOrigin: "http://127.0.0.1:45001",
  };
  parsed.config.registration.model = { id: "gm", version: "1" };
  const start = f.manager.start;
  let finish;
  const held = new Promise((done) => {
    finish = done;
  });
  f.manager.start = async () => {
    await held;
    return start();
  };
  let progress;
  let entered;
  const announced = new Promise((done) => {
    entered = done;
  });
  const launching = nativeCommand("start", f.configPath, {
    ...f.deps,
    onProgress: (value) => {
      progress = value;
      entered();
    },
  });
  try {
    await Promise.race([
      announced,
      new Promise((done) => setTimeout(done, 100)),
    ]);
    assert.ok(
      progress?.startupUrl,
      "the startup page must be handed off before launcher readiness",
    );
    assert.equal(progress.status, "starting");
    assert.equal(progress.viewerUrl, null);
    assert.equal(progress.frontend.name, "Settings portal");
    const current = await nativeCommand("status", f.configPath, f.deps);
    assert.equal(
      current.result.frontend.targetOrigin,
      "http://127.0.0.1:45001",
    );
    assert.equal(current.result.status, "starting");
  } finally {
    finish();
    const handle = await launching;
    await handle.close();
  }
});

test("alpha4 retains a failed startup page with sanitized failure and completed owned cleanup", async (t) => {
  const f = await fixture(t);
  f.manager.start = async () => {
    throw Object.assign(Error("private-launcher-secret"), {
      code: "boot_failed",
    });
  };
  let handle;
  try {
    handle = await nativeCommand("start", f.configPath, f.deps);
    assert.equal(handle.result.status, "failed");
    assert.equal(handle.result.ok, false);
    assert.equal(handle.result.startup.phase, "failed");
    assert.equal(handle.result.startup.cleanup, "complete");
    assert.equal(handle.result.viewerUrl, null);
    assert.ok(handle.result.startupUrl);
    assert.equal(
      JSON.stringify(handle.result).includes("private-launcher-secret"),
      false,
    );
    const current = await nativeCommand("status", f.configPath, f.deps);
    assert.equal(current.result.status, "failed");
  } finally {
    await handle?.close();
  }
});
