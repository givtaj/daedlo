import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  setTimeout as delay,
  setImmediate as turn,
} from "node:timers/promises";
import { createDriverSession } from "../src/session.mjs";

const baseline = await readFile(
  new URL("./fake-engine.mjs", import.meta.url),
  "utf8",
);
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};
async function waitForFile(path) {
  const deadline = Date.now() + 2000;
  while (true) {
    try {
      await access(path);
      return;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      assert.ok(
        Date.now() < deadline,
        "Fixture engine must enter its authorization gate",
      );
      await delay(5);
    }
  }
}

async function fixture(t, phase, { inFlight = false } = {}) {
  const folder = await mkdtemp(join(tmpdir(), "daedlo-control-authorization-"));
  const readyPath = join(folder, "ready");
  const releasePath = join(folder, "release");
  const enginePath = join(folder, "engine.mjs");
  const gate = deferred();
  const entered = deferred();
  const dispatched = deferred();
  const effectGate = deferred();
  let reads = 0,
    effects = 0,
    session = "original",
    driver,
    running,
    closing;
  const facts = { text: "draft", saved: false };
  // Hold the actual child-process response to the second command request:
  // initial authorization is first; final x.effect authorization is second.
  const marker = '  process.stdout.write(JSON.stringify(r) + "\\n");';
  assert.ok(baseline.includes(marker));
  const source =
    phase === "engine response"
      ? baseline
          .replace(
            marker,
            `
  if (q.op === "command" && ++commandCount === 2) {
    writeFileSync(${JSON.stringify(readyPath)}, "ready");
    while (!existsSync(${JSON.stringify(releasePath)}))
      await new Promise(resolve => setTimeout(resolve, 5));
  }
${marker}`,
          )
          .replace(
            'import { readFileSync } from "node:fs";',
            'import { readFileSync, writeFileSync, existsSync } from "node:fs";\nlet commandCount = 0;',
          )
      : baseline;
  await writeFile(enginePath, source, { mode: 0o755 });
  async function release() {
    gate.resolve();
    await writeFile(releasePath, "release");
  }
  t.after(async () => {
    await release();
    effectGate.resolve();
    driver?.stop();
    await running;
    await closing;
    await driver?.close();
    await rm(folder, { recursive: true, force: true });
  });
  driver = await createDriverSession({
    page: { isClosed: () => false },
    enginePath,
    adapter: {
      model: { id: "test", version: "1" },
      observe: async () => {
        const observation = { connected: true, session, facts: { ...facts } };
        if (++reads === 3 && phase === "observation") {
          entered.resolve();
          await gate.promise;
        }
        return observation;
      },
      handlers: {
        edit: async () => {},
        save: async (_, x) =>
          x.effect(async () => {
            effects++;
            facts.saved = true;
            dispatched.resolve();
            if (inFlight) await effectGate.promise;
          }),
      },
      effectStatus: () => ({ status: effects ? "saved" : "not_attempted" }),
    },
  });
  return {
    driver,
    facts,
    release,
    effects: () => effects,
    setSession: () => (session = "replacement"),
    ready: () =>
      phase === "engine response" ? waitForFile(readyPath) : entered.promise,
    dispatched: dispatched.promise,
    finishEffect: effectGate.resolve,
    close: () => (closing = driver.close()),
    async start() {
      const before = await driver.snapshot();
      running = driver.execute("save", {}, before.revision);
      return { result: running };
    },
    async drain() {
      // A subsequent real protocol round-trip lets the held response and its
      // continuations run. No control or application effect is retried.
      await driver.snapshot();
      await turn();
      await turn();
    },
  };
}

for (const phase of ["observation", "engine response"]) {
  for (const control of ["stop", "close"]) {
    test(
      `${control} during final ${phase} prevents an undispatched effect`,
      { timeout: 10000 },
      async (t) => {
        const f = await fixture(t, phase);
        const { result } = await f.start();
        await f.ready();
        assert.equal(f.effects(), 0);
        if (control === "close") f.close();
        else assert.equal(f.driver.stop().ok, true);
        await f.release();
        const completed = await result;
        assert.equal(
          f.effects(),
          0,
          "Acknowledged Stop/Close must prevent the not-yet-started effect",
        );
        assert.equal(completed.execution, "stopped");
        assert.equal(completed.effect.status, "not_attempted");
        assert.equal(
          f.driver
            .report({ runId: completed.runId })
            .events.some((e) => e.type === "effect_started"),
          false,
        );
      },
    );
  }

  for (const change of ["none", "draft", "session"]) {
    test(
      `Pause during final ${phase} gates dispatch and reauthorizes ${change} on Resume`,
      { timeout: 10000 },
      async (t) => {
        const f = await fixture(t, phase);
        const { result } = await f.start();
        await f.ready();
        assert.equal(f.effects(), 0);
        assert.deepEqual(f.driver.pause(), { ok: true, paused: true });
        await f.release();
        await f.drain();
        assert.equal(f.effects(), 0, "No effect may dispatch before Resume");
        if (change === "draft") f.facts.text = "human edit";
        if (change === "session") f.setSession();
        assert.equal(f.driver.resume().ok, true);
        const completed = await result;
        assert.equal(f.effects(), change === "none" ? 1 : 0);
        assert.equal(
          completed.execution,
          change === "none" ? "completed" : "rejected",
        );
        assert.equal(
          completed.effect.status,
          change === "none" ? "saved" : "not_attempted",
        );
        if (change !== "none")
          assert.equal(
            completed.error_code,
            change === "draft" ? "stale_observation" : "session_changed",
          );
      },
    );
  }

  test(
    `Pause/Resume before final ${phase} returns invalidates its old authorization`,
    { timeout: 10000 },
    async (t) => {
      const f = await fixture(t, phase);
      const { result } = await f.start();
      await f.ready();
      assert.equal(f.driver.pause().ok, true);
      f.facts.text = "human edit during brief pause";
      assert.equal(f.driver.resume().ok, true);
      await f.release();
      const completed = await result;
      assert.equal(
        f.effects(),
        0,
        "Resume must not reuse authorization captured before Pause",
      );
      assert.equal(completed.error_code, "stale_observation");
      assert.equal(completed.effect.status, "not_attempted");
    },
  );
}

test(
  "Stop after dispatch preserves a saved effect and never replays it",
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t, "unheld", { inFlight: true });
    const { result } = await f.start();
    await f.dispatched;
    assert.equal(f.effects(), 1);
    assert.equal(f.driver.stop().ok, true);
    f.finishEffect();
    const completed = await result;
    assert.equal(completed.execution, "stopped");
    assert.equal(completed.effect.status, "saved");
    assert.equal(f.effects(), 1);
    assert.equal(
      f.driver
        .report({ runId: completed.runId })
        .events.filter((e) => e.type === "verified").length,
      1,
    );
  },
);
