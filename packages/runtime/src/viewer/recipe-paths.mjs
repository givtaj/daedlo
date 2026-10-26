const incomparable = Symbol("incomparable recipe data");

function data(object, key) {
  const property = Object.getOwnPropertyDescriptor(object, key);
  if (!property?.enumerable || !("value" in property)) throw incomparable;
  return property.value;
}

function record(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// Compare JSON data without invoking getters/toJSON or dropping undefined values,
// sparse array entries, symbols or other information that JSON.stringify omits.
function canonical(value, ancestors = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (!value || typeof value !== "object" || ancestors.has(value))
    throw incomparable;
  ancestors.add(value);
  try {
    const keys = Reflect.ownKeys(value);
    if (Array.isArray(value)) {
      if (
        Object.getPrototypeOf(value) !== Array.prototype ||
        keys.length !== value.length + 1
      )
        throw incomparable;
      const items = [];
      for (let index = 0; index < value.length; index++)
        items.push(canonical(data(value, String(index)), ancestors));
      return "[" + items.join(",") + "]";
    }
    if (!record(value) || keys.some((key) => typeof key !== "string"))
      throw incomparable;
    return (
      "{" +
      keys
        .sort()
        .map(
          (key) =>
            JSON.stringify(key) + ":" + canonical(data(value, key), ancestors),
        )
        .join(",") +
      "}"
    );
  } finally {
    ancestors.delete(value);
  }
}

function comparableSteps(recipe) {
  try {
    if (!record(recipe)) return null;
    const steps = data(recipe, "steps");
    if (!Array.isArray(steps) || !steps.length) return null;
    const keys = [];
    for (let index = 0; index < steps.length; index++) {
      const step = data(steps, String(index));
      if (
        !record(step) ||
        Reflect.ownKeys(step).some(
          (key) => key !== "command" && key !== "params",
        )
      )
        return null;
      const command = data(step, "command"),
        params = data(step, "params");
      if (typeof command !== "string" || !command || !record(params))
        return null;
      keys.push(JSON.stringify([command, canonical(params)]));
    }
    return { steps, keys };
  } catch {
    // Invalid, cyclic or otherwise uncomparable input stays in its original card.
    return null;
  }
}

/** A display-only projection of literal canonical prefixes, never a new plan. */
export function groupRecipePaths(recipes) {
  if (!Array.isArray(recipes)) return [];
  const entries = [],
    byFirstStep = new Map();
  for (const recipe of recipes) {
    const path = comparableSteps(recipe);
    const existing = path && byFirstStep.get(path.keys[0]);
    if (existing) {
      let length = 0;
      while (
        length < existing.keys.length &&
        length < path.keys.length &&
        existing.keys[length] === path.keys[length]
      )
        length++;
      existing.keys.length = length;
      existing.entry.recipes.push(recipe);
      existing.entry.sharedSteps = existing.steps.slice(0, length);
    } else {
      const entry = { recipes: [recipe], sharedSteps: [] };
      entries.push(entry);
      if (path) byFirstStep.set(path.keys[0], { entry, ...path });
    }
  }
  return entries;
}
