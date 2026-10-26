import test from "node:test";
import assert from "node:assert/strict";
import { createManagedStarterAdapter } from "../examples/managed-starter/adapter.mjs";

const page = () => ({
  context: () => ({ on() {}, off() {} }),
  getByRole: () => ({ name: "Save note" }),
  on() {},
  off() {},
});

test("private command policy refuses save before a guarded effect, without exposing its private reason", async () => {
  const adapter = createManagedStarterAdapter(page(), {
    catalog: {
      schemaVersion: 1,
      allowedCommands: ["edit", "discard"],
      privateNote: "fixture-private-reason",
    },
  });
  let effects = 0;
  try {
    await assert.rejects(
      adapter.handlers.save({}, { click: async () => effects++ }),
      {
        code: "private_policy_denied",
        message:
          "This command is not enabled by the private integration policy.",
      },
    );
    assert.equal(effects, 0);
  } finally {
    adapter.close();
  }
});
