import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDriverSession } from "../src/session.mjs";

async function fixture(t, { advertised = true, recipeOnly = true } = {}) {
  const folder = await mkdtemp(join(tmpdir(), "driver-recipe-context-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const engine = join(folder, "engine.mjs");
  const log = join(folder, "requests.jsonl");
  const base = await readFile(
    new URL("./fake-engine.mjs", import.meta.url),
    "utf8",
  );
  // The fixture rejects missing runtime context while preserving the real
  // JSON-lines transport. Actual canonical validation is tested in Rust.
  const source = base
    .replace(
      'import { readFileSync } from "node:fs";',
      'import { readFileSync, appendFileSync } from "node:fs";',
    )
    .replace(
      "for await (const line",
      `descriptor.commands[1].recipeOnly = ${recipeOnly};\nfor await (const line`,
    )
    .replace(
      "process.stdout.write(JSON.stringify(r)",
      `
      appendFileSync(${JSON.stringify(log)}, JSON.stringify(q) + "\\n");
      if (q.op === "hello" && ${advertised}) r.capabilities = {recipeContext:1};
      if (["command", "verify"].includes(q.op) && (q.command === "save" || q.params?.text === "recipe")) {
        const expected = {recipe:"sample",step:q.command === "edit" ? 0 : 1,session:"alpha"};
        if (JSON.stringify(q.recipeContext) !== JSON.stringify(expected))
          r = {protocol:1,id:q.id,ok:false,error_code:"recipe_scope_required",error:"Missing canonical runtime context"};
      }
      process.stdout.write(JSON.stringify(r)`,
    );
  await writeFile(engine, source, { mode: 0o755 });
  const facts = { text: "original", saved: false };
  let effects = 0;
  const contexts = [];
  const driver = await createDriverSession({
    page: { isClosed: () => false },
    enginePath: engine,
    adapter: {
      model: { id: "test", version: "1" },
      observe: async () => ({
        connected: true,
        session: "alpha",
        facts: { ...facts },
      }),
      handlers: {
        edit: async (p, x) => {
          contexts.push(x);
          await x.effect(() => {
            facts.text = p.text;
            effects++;
          });
        },
        save: async (_, x) => {
          contexts.push(x);
          await x.effect(() => {
            facts.saved = true;
            effects++;
          });
        },
      },
    },
  });
  t.after(() => driver.close());
  return {
    driver,
    facts,
    effects: () => effects,
    contexts,
    requests: async () =>
      (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse),
  };
}

test("runtime binds canonical context to every recipe action and verification", async (t) => {
  const f = await fixture(t);
  const before = await f.driver.snapshot();
  assert.equal(
    before.commands.some((command) => command.id === "save"),
    false,
  );
  const result = await f.driver.runRecipe("sample", before.revision);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(f.effects(), 2);
  const requests = (await f.requests()).filter((r) =>
    ["command", "verify"].includes(r.op),
  );
  assert.ok(requests.some((r) => r.op === "verify"));
  for (const request of requests) {
    assert.deepEqual(request.recipeContext, {
      recipe: "sample",
      step: request.command === "edit" ? 0 : 1,
      session: "alpha",
    });
    assert.equal(
      Object.hasOwn(request.observation.facts, "recipeContext"),
      false,
    );
  }
});

test("direct execution cannot forge context or reach a recipe-only handler", async (t) => {
  const f = await fixture(t);
  const before = await f.driver.snapshot();
  const result = await f.driver.command({
    id: "save",
    revision: before.revision,
    recipeContext: { recipe: "sample", step: 1, session: "alpha" },
  });
  assert.equal(result.error_code, "recipe_scope_required");
  assert.equal(f.effects(), 0);
  assert.equal(
    (await f.requests()).filter((r) => r.op === "command").length,
    0,
    "Runtime refuses recipe-only commands before protocol dispatch",
  );
});

test("a recipe-only model requires explicit engine context capability", async (t) => {
  await assert.rejects(
    fixture(t, { advertised: false }),
    (error) => error.code === "contract_mismatch",
  );
});

test("handlers receive immutable recipe context for application verification", async (t) => {
  const f = await fixture(t);
  const before = await f.driver.snapshot();
  const result = await f.driver.runRecipe("sample", before.revision);
  assert.equal(result.ok, true, JSON.stringify(result));
  for (const [step, execution] of f.contexts.entries()) {
    assert.deepEqual(execution.recipeContext, {
      recipe: "sample",
      step,
      session: "alpha",
    });
    assert.equal(Object.isFrozen(execution.recipeContext), true);
    assert.throws(() => {
      execution.recipeContext.step = 99;
    }, TypeError);
    assert.throws(() => {
      execution.recipeContext = undefined;
    }, TypeError);
  }
  const next = await f.driver.snapshot();
  const direct = await f.driver.execute(
    "edit",
    { text: "direct" },
    next.revision,
  );
  assert.equal(direct.ok, true, JSON.stringify(direct));
  assert.equal(f.contexts.at(-1).recipeContext, undefined);
});
