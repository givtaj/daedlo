// Independent Chromium conformance: controls must win before a guarded dispatch.
// This synthetic fixture does not establish customer application acceptance.
import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import fs from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createDriverSession } from "../packages/runtime/src/session.mjs";

const output = resolve(
  process.env.BROWSER_DRIVER_CONTROL_OUTPUT ??
    "artifacts/a1-control-authorization/browser",
);
const fakeEngine = new URL(
  "../packages/runtime/tests/fake-engine.mjs",
  import.meta.url,
);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function gate() {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function fixture(t, browser, pending = "observation") {
  const entered = gate(),
    held = gate(),
    posted = gate(),
    response = gate();
  let reads = 0,
    writes = 0,
    ended = 0,
    driver,
    running,
    engineDir;
  const records = [];
  const server = http.createServer(async (req, res) => {
    if (req.url === "/authorization") {
      entered.release();
      await held.promise;
      res.end("released");
    } else if (req.method === "POST" && req.url === "/save") {
      let body = "";
      for await (const chunk of req) body += chunk;
      records.push(JSON.parse(body));
      writes++;
      posted.release();
      if (pending === "dispatched") await response.promise;
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ saved: true }));
    } else {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!doctype html><title>Final authorization conformance</title>
        <label>Note <textarea id="note">Retain this draft</textarea></label>
        <button id="save">Save</button><output id="status">Draft</output>
        <script>
        document.querySelector('#save').onclick = async () => {
          document.querySelector('#status').textContent = 'Saving';
          const response = await fetch('/save', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({text: document.querySelector('#note').value})
          });
          if (response.ok) document.querySelector('#status').textContent = 'Saved';
        };
        </script>`);
    }
  });
  const context = await browser.newContext();
  t.after(async () => {
    held.release();
    response.release();
    driver?.stop();
    await running;
    await driver?.close();
    assert.equal(
      context.pages().every((page) => !page.isClosed()),
      true,
      "Closing the driver preserves its attached pages",
    );
    await context.close();
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
    if (engineDir) await fs.rm(engineDir, { recursive: true, force: true });
    assert.equal(server.listening, false, "Owned HTTP fixture must close");
    assert.equal(
      context.pages().length,
      0,
      "Owned Chromium context must close",
    );
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  let enginePath = fileURLToPath(fakeEngine);
  if (pending === "engine") {
    await fs.mkdir(output, { recursive: true });
    engineDir = await fs.mkdtemp(join(output, "engine-"));
    enginePath = join(engineDir, "engine.mjs");
    // Keep the existing fixture's fingerprint/authorization semantics. Only
    // hold its fourth command response: x.click's final pre-dispatch check.
    const source = await fs.readFile(fakeEngine, "utf8");
    const emit = '  process.stdout.write(JSON.stringify(r) + "\\n");';
    assert.equal(source.includes(emit), true, "Fixture response seam exists");
    await fs.writeFile(
      enginePath,
      source
        .replace("let behavior = {};", "let behavior = {}; let commands = 0;")
        .replace(
          emit,
          `  if (q.op === "command" && ++commands === 4) await fetch(${JSON.stringify(url + "/authorization")});\n${emit}`,
        ),
      { mode: 0o755 },
    );
  }
  const page = await context.newPage();
  await page.goto(url);
  const adapter = {
    model: { id: "test", version: "1" },
    observe: async () => {
      const observation = await page.evaluate(() => ({
        connected: true,
        session: "control-fixture",
        facts: {
          text: document.querySelector("#note").value,
          saved: document.querySelector("#status").textContent === "Saved",
        },
      }));
      // snapshot, initial authorization, both motion checks, final effect check.
      if (++reads === 5 && pending === "observation") {
        entered.release();
        await held.promise;
      }
      return observation;
    },
    handlers: {
      edit: async ({ text }, x) => x.fill(page.getByLabel("Note"), text),
      save: async (_, x) =>
        x.click(page.getByRole("button", { name: "Save", exact: true })),
    },
    settle: async () => {
      await page.waitForFunction(
        () => document.querySelector("#status").textContent === "Saved",
      );
    },
    effectStatus: () => ({ status: writes ? "saved" : "not_attempted" }),
    endRun: () => {
      ended++;
    },
  };
  driver = await createDriverSession({ page, context, enginePath, adapter });
  driver.setSpeed("fast");
  return {
    driver,
    page,
    records,
    ready: entered.promise,
    posted: posted.promise,
    release: held.release,
    releaseResponse: response.release,
    writes: () => writes,
    ended: () => ended,
    async start() {
      const before = await driver.snapshot();
      running = driver.execute("save", {}, before.revision);
      return { result: running };
    },
  };
}

await test(
  "final authorization controls in isolated Chromium",
  { timeout: 60000 },
  async (t) => {
    const browser = await chromium.launch({ headless: true });
    t.after(async () => {
      await browser.close();
      assert.equal(browser.isConnected(), false, "Owned Chromium must close");
    });
    for (const pending of ["observation", "engine"]) {
      await t.test(
        `Stop while ${pending} is pending prevents the first write`,
        { timeout: 12000 },
        async (t) => {
          const f = await fixture(t, browser, pending);
          const { result } = await f.start();
          await f.ready;
          assert.equal(f.writes(), 0);
          assert.equal(f.driver.stop().ok, true);
          f.release();
          const completed = await result;
          assert.equal(
            f.writes(),
            0,
            "Acknowledged Stop must prevent an unstarted browser write",
          );
          assert.equal(await f.page.locator("#status").textContent(), "Draft");
          assert.equal(completed.execution, "stopped");
          assert.equal(completed.effect.status, "not_attempted");
          assert.equal(completed.outcome, undefined);
          assert.equal(f.ended(), 1);
        },
      );
      await t.test(
        `Pause while ${pending} is pending defers dispatch until Resume`,
        { timeout: 12000 },
        async (t) => {
          const f = await fixture(t, browser, pending);
          const { result } = await f.start();
          await f.ready;
          assert.equal(f.driver.pause().ok, true);
          f.release();
          // A bounded observation window detects the original immediate dispatch;
          // this is not a retry, and a later Resume must produce exactly one write.
          await delay(150);
          assert.equal(
            f.writes(),
            0,
            "No browser write may begin while paused",
          );
          assert.equal(await f.page.locator("#status").textContent(), "Draft");
          assert.equal(f.driver.resume().ok, true);
          const completed = await result;
          assert.equal(completed.execution, "completed");
          assert.equal(completed.outcome.kind, "success");
          assert.equal(completed.effect.status, "saved");
          assert.equal(f.writes(), 1);
          assert.deepEqual(f.records, [{ text: "Retain this draft" }]);
          const events = f.driver.report({ runId: completed.runId }).events;
          assert.ok(
            events.find((event) => event.type === "effect_started").sequence >
              events.find((event) => event.type === "resumed").sequence,
            "Guarded dispatch must occur after the acknowledged Resume",
          );
        },
      );
      for (const resumeBeforeRelease of [false, true]) {
        await t.test(
          `Changed draft after Pause invalidates ${pending} authorization (${resumeBeforeRelease ? "early" : "late"} Resume)`,
          { timeout: 12000 },
          async (t) => {
            const f = await fixture(t, browser, pending);
            const { result } = await f.start();
            await f.ready;
            assert.equal(f.driver.pause().ok, true);
            await f.page.getByLabel("Note").fill("Human edit while paused");
            if (resumeBeforeRelease) {
              assert.equal(f.driver.resume().ok, true);
              f.release();
            } else {
              f.release();
              await delay(150);
              assert.equal(
                f.writes(),
                0,
                "Pause must protect the edited draft before Resume",
              );
              assert.equal(f.driver.resume().ok, true);
            }
            const completed = await result;
            assert.equal(
              f.writes(),
              0,
              "Resume must freshly authorize and refuse the changed draft",
            );
            assert.equal(completed.execution, "rejected");
            assert.equal(completed.error_code, "stale_observation");
            assert.equal(completed.effect.status, "not_attempted");
            assert.equal(
              await f.page.getByLabel("Note").inputValue(),
              "Human edit while paused",
            );
          },
        );
      }
    }
    await t.test(
      "Stop after a dispatched browser write preserves saved evidence without replay",
      { timeout: 12000 },
      async (t) => {
        const f = await fixture(t, browser, "dispatched");
        const { result } = await f.start();
        await f.posted;
        assert.equal(f.writes(), 1);
        assert.equal(f.driver.stop().ok, true);
        f.releaseResponse();
        const completed = await result;
        assert.equal(completed.execution, "stopped");
        assert.equal(completed.effect.status, "saved");
        assert.equal(completed.outcome, undefined);
        assert.equal(f.writes(), 1);
        assert.equal(await f.page.locator("#status").textContent(), "Saved");
        assert.deepEqual(f.records, [{ text: "Retain this draft" }]);
        assert.equal(f.ended(), 1);
      },
    );
  },
);
