// Browser Driver adaptation of the Roots driver: generalized model, execution and viewer interfaces; later lifecycle and reporting changes. See THIRD_PARTY_NOTICES.md and licenses/Apache-2.0.txt at the package root.
import { reject } from "./errors.mjs";
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export function validateParams(command, input = {}) {
  if (!object(input))
    reject("invalid_parameters", "Command parameters must be an object.");
  const fields = command.params ?? {},
    output = {};
  for (const key of Object.keys(input))
    if (!Object.hasOwn(fields, key))
      reject("invalid_parameters", `Unknown parameter: ${key}.`);
  for (const [name, field] of Object.entries(fields)) {
    const value = Object.hasOwn(input, name) ? input[name] : field.default;
    if (value === undefined) {
      if (field.required)
        reject("invalid_parameters", `Missing parameter: ${name}.`);
      continue;
    }
    const type = field.type;
    if (
      type === "text" &&
      (typeof value !== "string" ||
        (field.maxLength !== undefined && [...value].length > field.maxLength))
    )
      reject("invalid_parameters", `Invalid text parameter: ${name}.`);
    if (
      type === "number" &&
      (typeof value !== "number" ||
        !Number.isFinite(value) ||
        (field.minimum !== undefined && value < field.minimum) ||
        (field.maximum !== undefined && value > field.maximum))
    )
      reject("invalid_parameters", `Invalid number parameter: ${name}.`);
    if (type === "boolean" && typeof value !== "boolean")
      reject("invalid_parameters", `Invalid boolean parameter: ${name}.`);
    if (
      type === "select" &&
      !field.options?.some((option) => Object.is(option.value, value))
    )
      reject("invalid_parameters", `Invalid choice parameter: ${name}.`);
    output[name] = value;
  }
  return output;
}
export function validateDescriptor(d, adapter) {
  if (
    !d ||
    typeof d.id !== "string" ||
    typeof d.version !== "string" ||
    !Array.isArray(d.states) ||
    !Array.isArray(d.commands) ||
    !Array.isArray(d.recipes)
  )
    reject("invalid_descriptor", "Invalid model descriptor.");
  if (d.id !== adapter.model?.id || d.version !== adapter.model?.version)
    reject("model_mismatch", "Adapter and engine model versions do not match.");
  for (const list of [d.states, d.commands, d.recipes]) {
    const ids = new Set();
    for (const item of list) {
      if (
        !item.id ||
        typeof item.id !== "string" ||
        ids.has(item.id) ||
        typeof item.label !== "string"
      )
        reject(
          "invalid_descriptor",
          "Model identifiers must be unique and labeled.",
        );
      ids.add(item.id);
    }
  }
  const states = new Map(d.states.map((s) => [s.id, s]));
  for (const s of d.states) {
    if (!["supported", "planned"].includes(s.support))
      reject("invalid_descriptor", "State support must be explicit.");
    const seen = new Set([s.id]);
    let p = s.parent;
    while (p) {
      if (!states.has(p) || seen.has(p))
        reject("invalid_descriptor", "Invalid state hierarchy.");
      seen.add(p);
      p = states.get(p).parent;
    }
  }
  for (const c of d.commands) {
    if (!object(c.params) || typeof adapter.handlers?.[c.id] !== "function")
      reject(
        "missing_handler",
        `Missing command parameters or handler: ${c.id}.`,
      );
    for (const p of Object.values(c.params))
      if (!["text", "number", "boolean", "select"].includes(p.type))
        reject("invalid_descriptor", "Unsupported parameter type.");
  }
  for (const r of d.recipes) {
    if (!Array.isArray(r.steps) || !r.steps.length)
      reject("invalid_descriptor", "A recipe needs explicit steps.");
    for (const step of r.steps) {
      const c = d.commands.find((c) => c.id === step.command);
      if (!c) reject("missing_handler", "Recipe command is unavailable.");
      validateParams(c, step.params);
    }
  }
  return structuredClone(d);
}
