import { reject } from "./errors.mjs";
import { validateParams } from "./catalog.mjs";

const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const publicText = (v, limit, required = false) =>
  typeof v === "string" &&
  v.length <= limit &&
  (!required || v.trim()) &&
  !/[\u0000-\u001f\u007f-\u009f]/u.test(v);
const invalid = () =>
  reject(
    "invalid_presentation",
    "Presentation requires a known command or recipe, public captions and one valid hold per canonical step.",
  );

// Presentation metadata decorates the existing model plan; it cannot supply a
// second action graph. All captions are trusted, customer-authored public text.
export function validatePresentations(input, descriptor) {
  if (!Array.isArray(input) || input.length > 32) invalid();
  const ids = new Set();
  return input.map((p) => {
    if (
      !object(p) ||
      Object.keys(p).some(
        (k) =>
          ![
            "id",
            "title",
            "explanation",
            "command",
            "params",
            "recipe",
            "stages",
          ].includes(k),
      ) ||
      typeof p.id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(p.id) ||
      ids.has(p.id) ||
      !publicText(p.title, 120, true) ||
      !publicText(p.explanation ?? "", 600) ||
      (typeof p.command === "string") === (typeof p.recipe === "string")
    )
      invalid();
    ids.add(p.id);
    const recipe = descriptor.recipes.find((r) => r.id === p.recipe);
    const command = descriptor.commands.find((c) => c.id === p.command);
    if (
      (!recipe && !command) ||
      (recipe && Object.hasOwn(p, "params")) ||
      (recipe && Object.hasOwn(p, "command")) ||
      (command && Object.hasOwn(p, "recipe"))
    )
      invalid();
    const count = recipe ? recipe.steps.length : 1;
    if (!Array.isArray(p.stages) || p.stages.length !== count) invalid();
    const stages = p.stages.map((s) => {
      if (
        !object(s) ||
        Object.keys(s).some(
          (k) => !["title", "explanation", "holdMs", "manual"].includes(k),
        ) ||
        !publicText(s.title, 120, true) ||
        !publicText(s.explanation ?? "", 600) ||
        (s.manual !== undefined && typeof s.manual !== "boolean") ||
        (s.holdMs !== undefined &&
          (!Number.isInteger(s.holdMs) || s.holdMs < 0 || s.holdMs > 3600000))
      )
        invalid();
      return {
        title: s.title,
        explanation: s.explanation ?? "",
        holdMs: s.holdMs ?? 10000,
        manual: s.manual ?? false,
      };
    });
    return {
      id: p.id,
      title: p.title,
      explanation: p.explanation ?? "",
      stages,
      ...(recipe
        ? { recipe: recipe.id }
        : { command: command.id, params: validateParams(command, p.params) }),
    };
  });
}
