import assert from "node:assert/strict";

export async function notes(origin) {
  const response = await fetch(origin + "/api/notes", {
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 200);
  return (await response.json()).items;
}

// These assertions concern the independent notebook only, never customer data.
export async function assertFlow({ command, observe, origin, label }) {
  const before = await notes(origin);
  const runs = [];
  const run = async (id, params, kind = "success") => {
    const value = await command(id, params);
    assert.equal(value.ok, true, JSON.stringify(value));
    assert.equal(value.execution, "completed", JSON.stringify(value));
    assert.equal(value.outcome?.kind, kind, JSON.stringify(value));
    runs.push(value);
    return value;
  };
  await run("edit", { text: " " });
  const invalid = await run("save", {}, "validation");
  assert.equal((await observe()).state.id, "notebook.validation");
  assert.equal(invalid.effect.status, "not_attempted");
  assert.deepEqual(
    await notes(origin),
    before,
    "Rejected input must not persist a note",
  );
  await run("cancel", {});
  const text = "Synthetic preserved note " + label;
  await run("edit", { text });
  const saved = await run("save", {});
  assert.equal(saved.effect.status, "saved");
  const after = await notes(origin);
  assert.equal(
    after.length,
    before.length + 1,
    "Exactly one save per accepted flow",
  );
  assert.deepEqual(
    after.slice(0, before.length),
    before,
    "Existing notes must retain every field",
  );
  assert.equal(after.at(-1).text, text);
  assert.equal((await observe()).state.id, "notebook.saved");
  return { before, after, runs, invalid, saved };
}
