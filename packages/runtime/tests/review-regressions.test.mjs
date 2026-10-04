import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { createDriverSession } from "../src/session.mjs";
import { createEngineClient } from "../src/engine-client.mjs";

const baseline = await readFile(
  new URL("./fake-engine.mjs", import.meta.url),
  "utf8",
);
async function fixture(
  t,
  { source = baseline, config = {}, extend = () => ({}) } = {},
) {
  const folder = await mkdtemp(join(tmpdir(), "browser-driver-review-"));
  const enginePath = join(folder, "engine.mjs");
  await writeFile(enginePath, source, { mode: 0o755 });
  await writeFile(join(folder, "fixture-config.json"), JSON.stringify(config));
  let session = "alpha",
    effects = 0;
  const facts = { text: "original", saved: false };
  const state = {
    facts,
    setSession: (value) => (session = value),
    count: () => effects,
  };
  const adapter = {
    model: { id: "test", version: "1" },
    observe: async () => ({ connected: true, session, facts: { ...facts } }),
    handlers: {
      edit: async (p, x) =>
        x.effect(() => {
          facts.text = p.text;
          facts.saved = false;
          effects++;
        }),
      save: async (_, x) =>
        x.effect(() => {
          facts.saved = true;
          effects++;
        }),
    },
  };
  Object.assign(adapter, extend(state, adapter));
  const driver = await createDriverSession({
    page: { isClosed: () => false },
    enginePath,
    adapter,
  });
  t.after(async () => {
    await driver.close();
    await rm(folder, { recursive: true, force: true });
  });
  return { driver, adapter, ...state };
}

for (const name of ["missing", "wrong id", "wrong parameters"])
  test(`malformed authorization (${name}) cannot cause effects`, async (t) => {
    const f = await fixture(t, { config: { action: name } });
    const snapshot = await f.driver.snapshot();
    const result = await f.driver.execute("save", {}, snapshot.revision);
    assert.equal(result.execution, "rejected");
    assert.equal(result.error_code, "invalid_action");
    assert.equal(f.count(), 0);
    assert.equal(f.facts.saved, false);
  });

test("recipe does not adopt an intervening edit after its verified step", async (t) => {
  const f = await fixture(t, {
    extend: (state) => ({
      evidence: async (command) => {
        if (command === "edit") state.facts.text = "human edit";
        return {};
      },
    }),
  });
  const snapshot = await f.driver.snapshot();
  const result = await f.driver.runRecipe("sample", snapshot.revision);
  assert.equal(result.error_code, "stale_observation");
  assert.equal(f.count(), 1);
  assert.equal(f.facts.saved, false);
  assert.equal(f.facts.text, "human edit");
});

test("recipe defaults are normalized before checking the canonical plan", async (t) => {
  const f = await fixture(t, { config: { recipeDefaults: true } });
  const snapshot = await f.driver.snapshot();
  assert.equal(
    (await f.driver.runRecipe("sample", snapshot.revision)).execution,
    "completed",
  );
  assert.equal(f.count(), 2);
});

test("declared session-changing command can finish its own later primitive", async (t) => {
  let completed = 0;
  const f = await fixture(t, {
    config: { sessionChange: true },
    extend: (state, adapter) => ({
      handlers: {
        ...adapter.handlers,
        edit: async (p, x) => {
          await x.effect(() => state.setSession("beta"));
          await x.effect(() => {
            state.facts.text = p.text;
            completed++;
          });
        },
      },
    }),
  });
  const snapshot = await f.driver.snapshot();
  const result = await f.driver.execute(
    "edit",
    { text: "signed-in update" },
    snapshot.revision,
  );
  assert.equal(result.execution, "completed");
  assert.equal(completed, 1);
});

test("close excludes a run started by an earlier completion callback", async (t) => {
  let entered,
    release,
    began = 0;
  const inside = new Promise((r) => (entered = r)),
    held = new Promise((r) => (release = r));
  const f = await fixture(t, {
    extend: (_, adapter) => ({
      beginRun: () => began++,
      handlers: {
        ...adapter.handlers,
        save: async (_, x) => {
          await x.effect(() => {});
          entered();
          await held;
        },
      },
    }),
  });
  const snapshot = await f.driver.snapshot();
  const running = f.driver.execute("save", {}, snapshot.revision);
  await inside;
  const subsequent = running.then(() =>
    f.driver.execute("save", {}, snapshot.revision),
  );
  const closing = f.driver.close();
  release();
  const result = await subsequent;
  await closing;
  assert.equal(result.error_code, "closed");
  assert.equal(began, 1);
});

function fakeChild(t, onKill) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = (signal) => onKill(signal ?? "SIGTERM", child);
  const replacement = mock.method(childProcess, "spawn", () => child);
  syncBuiltinESMExports();
  t.after(() => {
    replacement.mock.restore();
    syncBuiltinESMExports();
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
  });
  return child;
}

test("engine cleanup resolves only after its owned process actually exits", async (t) => {
  let didExit = false;
  fakeChild(t, (signal, child) => {
    if (signal === "SIGKILL")
      setTimeout(() => {
        didExit = true;
        child.emit("exit", null, "SIGKILL");
      }, 30);
    return true;
  });
  const client = createEngineClient("/synthetic-test-engine");
  await client.close();
  assert.equal(didExit, true);
});

test("unconfirmed engine cleanup rejects and can be retried", async (t) => {
  const child = fakeChild(t, () => false);
  const client = createEngineClient("/synthetic-test-engine");
  await assert.rejects(
    client.close(),
    (error) => error.code === "cleanup_incomplete",
  );
  child.emit("exit", 0, null);
  await client.close();
});
