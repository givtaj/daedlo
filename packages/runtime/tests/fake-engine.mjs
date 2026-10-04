#!/usr/bin/env node
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
let behavior = {};
try {
  behavior = JSON.parse(
    readFileSync(new URL("./fixture-config.json", import.meta.url), "utf8"),
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const descriptor = {
  id: "test",
  version: "1",
  label: "Test model",
  states: [
    { id: "draft", label: "Draft", parent: null, support: "supported" },
    { id: "saved", label: "Saved", parent: null, support: "supported" },
  ],
  commands: [
    {
      id: "edit",
      label: "Edit",
      params: { text: { type: "text", label: "Text", required: true } },
    },
    { id: "save", label: "Save", params: {} },
  ],
  recipes: [
    {
      id: "sample",
      label: "Sample",
      steps: [
        { command: "edit", params: { text: "recipe" } },
        { command: "save", params: {} },
      ],
    },
  ],
};
if (behavior.sessionChange) descriptor.commands[0].changesSession = true;
if (behavior.recipeDefaults) {
  descriptor.commands[0].params.text.default = "recipe";
  descriptor.recipes[0].steps[0].params = {};
}
for await (const line of createInterface({ input: process.stdin })) {
  const q = JSON.parse(line),
    o = q.observation,
    fp = o && createHash("sha256").update(JSON.stringify(o)).digest("hex");
  let r = { protocol: 1, id: q.id, ok: true };
  if (q.op === "hello") r.descriptor = descriptor;
  else if (q.op === "observe")
    Object.assign(r, {
      state: { id: o.facts.saved ? "saved" : "draft" },
      fingerprint: fp,
      commands: descriptor.commands.map((c) => ({ id: c.id, enabled: true })),
      recipes: [{ id: "sample", enabled: true }],
      display: [],
    });
  else if (q.op === "verify")
    r.outcome = {
      kind:
        q.command !== "save" || q.observation.facts.saved
          ? "success"
          : "recoverable_error",
      label: q.observation.facts.saved ? "Saved" : "Observed",
    };
  else if (q.fingerprint !== fp)
    Object.assign(r, {
      ok: false,
      error_code: "stale_observation",
      error: "Changed",
    });
  else if (q.op === "command") r.action = { id: q.command, params: q.params };
  else if (q.op === "recipe") r.plan = descriptor.recipes[0].steps;
  if (q.op === "command" && r.ok) {
    if (behavior.action === "missing") delete r.action;
    if (behavior.action === "wrong id")
      r.action = { id: "edit", params: q.params };
    if (behavior.action === "wrong parameters")
      r.action = { id: q.command, params: { injected: true } };
  }
  if (q.op === "recipe" && r.ok && behavior.recipeDefaults)
    r.plan = descriptor.recipes[0].steps.map((s) => ({
      ...s,
      params: s.command === "edit" ? { text: "recipe" } : {},
    }));
  process.stdout.write(JSON.stringify(r) + "\n");
}
