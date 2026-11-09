import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateDescriptor, validateParams } from "../src/catalog.mjs";
import { createDriverSession } from "../src/session.mjs";

const descriptor = (type = "password") => ({
  id: "sensitive-fixture",
  version: "1",
  label: "Sensitive parameter fixture",
  states: [{ id: "ready", label: "Ready", parent: null, support: "supported" }],
  commands: [
    {
      id: "submit",
      label: "Submit",
      params: {
        value: { type, label: "Private input", required: true, maxLength: 3 },
      },
    },
  ],
  recipes: [],
});
const adapter = {
  model: { id: "sensitive-fixture", version: "1" },
  handlers: { submit() {} },
};

test("explicit password descriptors are supported without changing legacy text", () => {
  for (const type of ["password", "text"])
    assert.equal(
      validateDescriptor(descriptor(type), adapter).commands[0].params.value
        .type,
      type,
    );
  assert.throws(() => validateDescriptor(descriptor("secret-ish"), adapter), {
    code: "invalid_descriptor",
  });
});

test("password parameters enforce required bounded strings without changing their bytes", () => {
  const command = descriptor().commands[0];
  for (const value of ["", "é🙂", " a "])
    assert.deepEqual(validateParams(command, { value }), { value });
  for (const input of [
    {},
    { value: null },
    { value: 3 },
    { value: false },
    { value: {} },
    { value: "four" },
  ])
    assert.throws(() => validateParams(command, input), {
      code: "invalid_parameters",
    });
  assert.throws(
    () => validateParams(descriptor("secret-ish").commands[0], { value: "ok" }),
    { code: "invalid_parameters" },
  );
});

test("public password defaults and canonical recipe literals keep their validated semantics", () => {
  const model = descriptor();
  model.commands[0].params.value.default = "{}";
  model.recipes = [
    {
      id: "public-template",
      label: "Public template",
      steps: [{ command: "submit", params: {} }],
    },
  ];
  const validated = validateDescriptor(model, adapter);
  assert.deepEqual(validateParams(validated.commands[0], {}), { value: "{}" });
  model.recipes[0].steps[0].params = { value: "long" };
  assert.throws(() => validateDescriptor(model, adapter), {
    code: "invalid_parameters",
  });
});

test("submitted password values reach the handler but remain absent from public reports", async () => {
  const directory = await mkdtemp(join(tmpdir(), "daedlo-sensitive-test-"));
  let session;
  try {
    const source = await readFile(
      new URL("./fake-engine.mjs", import.meta.url),
      "utf8",
    );
    const enginePath = join(directory, "engine.mjs");
    const passwordSource = source.replace(
      'type: "text", label: "Text"',
      'type: "password", label: "Text"',
    );
    assert.equal(
      passwordSource !== source,
      true,
      "Fixture must declare the password wire type",
    );
    await writeFile(enginePath, passwordSource, { mode: 0o700 });
    let received;
    const privateValue = `private-${Date.now()}-parameter`;
    session = await createDriverSession({
      page: { isClosed: () => false },
      context: {},
      enginePath,
      adapter: {
        model: { id: "test", version: "1" },
        observe: async () => ({
          connected: true,
          session: "owned",
          facts: { text: "public fact", saved: false },
        }),
        handlers: {
          edit: async (params, execution) =>
            execution.effect(() => {
              received = params.text;
            }),
          save() {},
        },
      },
    });
    session.setSpeed("fast");
    const result = await session.execute(
      "edit",
      { text: privateValue },
      (await session.observe()).revision,
    );
    assert.equal(result.execution, "completed");
    assert.equal(
      received === privateValue,
      true,
      "Handler must receive unchanged private input",
    );
    for (const report of [
      session.report(),
      session.report({ runId: result.runId }),
      await session.snapshot(),
    ])
      assert.equal(
        JSON.stringify(report).includes(privateValue),
        false,
        "Submitted sensitive input must not enter public session output",
      );
  } finally {
    await session?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
