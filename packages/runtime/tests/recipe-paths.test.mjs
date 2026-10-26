import test from "node:test";
import assert from "node:assert/strict";
import { groupRecipePaths } from "../src/viewer/recipe-paths.mjs";

const step = (command, params = {}) => ({ command, params });
const recipe = (id, steps, label = id) => ({ id, label, steps });
const ids = (groups) => groups.map((group) => group.recipes.map((r) => r.id));

test("equal canonical prefixes group despite nested object key order", () => {
  const first = recipe("details", [
    step("open_profile", {
      filter: { enabled: true, ids: [1, null] },
      tab: "main",
    }),
    step("read_profile"),
  ]);
  const second = recipe("settings", [
    step("open_profile", {
      tab: "main",
      filter: { ids: [1, null], enabled: true },
    }),
    step("read_settings"),
  ]);
  const groups = groupRecipePaths([first, second]);
  assert.equal(
    groups.length,
    1,
    "Equivalent canonical prefixes must share one group",
  );
  assert.deepEqual(ids(groups), [["details", "settings"]]);
  assert.deepEqual(groups[0].sharedSteps, [first.steps[0]]);
  assert.strictEqual(groups[0].sharedSteps[0], first.steps[0]);
});

test("different parameter values, JSON types, missing/null and array order stay separate", () => {
  const params = [
    {},
    { value: null },
    { value: 1 },
    { value: "1" },
    { value: true },
    { value: false },
    { value: [1, 2] },
    { value: [2, 1] },
    { value: { a: 1 } },
    { value: [{ a: 1 }] },
  ];
  const recipes = params.map((p, index) =>
    recipe(String(index), [step("open_profile", p)]),
  );
  const groups = groupRecipePaths(recipes);
  assert.deepEqual(
    ids(groups),
    recipes.map((r) => [r.id]),
  );
  assert.ok(groups.every((group) => group.sharedSteps.length === 0));
});

test("matching labels or later steps cannot manufacture a shared prefix", () => {
  const recipes = [
    recipe("profile", [step("open_profile"), step("inspect")], "Open"),
    recipe("settings", [step("open_settings"), step("inspect")], "Open"),
    recipe("reverse", [step("inspect"), step("open_profile")], "Open"),
  ];
  assert.deepEqual(ids(groupRecipePaths(recipes)), [
    ["profile"],
    ["settings"],
    ["reverse"],
  ]);
});

test("empty input, empty recipes and singletons have no shared path", () => {
  assert.deepEqual(groupRecipePaths([]), []);
  assert.deepEqual(groupRecipePaths(null), []);
  const recipes = [
    recipe("empty-a", []),
    recipe("only", [step("open_profile")]),
    recipe("empty-b", []),
  ];
  const groups = groupRecipePaths(recipes);
  assert.deepEqual(ids(groups), [["empty-a"], ["only"], ["empty-b"]]);
  assert.ok(groups.every((group) => group.sharedSteps.length === 0));
});

test("shared path is the longest common prefix across every member, bounded by a shorter recipe", () => {
  const recipes = [
    recipe("a", [step("open_profile"), step("load"), step("inspect")]),
    recipe("b", [step("open_profile"), step("load"), step("edit")]),
    recipe("c", [step("open_profile"), step("load")]),
  ];
  const groups = groupRecipePaths(recipes);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].sharedSteps, recipes[0].steps.slice(0, 2));
  const shortened = groupRecipePaths([
    ...recipes,
    recipe("d", [step("open_profile"), step("other")]),
  ]);
  assert.equal(shortened.length, 1);
  assert.deepEqual(shortened[0].sharedSteps, [recipes[0].steps[0]]);
});

test("nonadjacent members retain authored order and original identities without mutation", () => {
  const freeze = (value) => {
    if (value && typeof value === "object") {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
    return value;
  };
  const recipes = freeze([
    recipe("a", [step("profile", { nested: { value: 1 } }), step("one")]),
    recipe("solo", [step("elsewhere")]),
    recipe("b", [step("profile", { nested: { value: 1 } }), step("two")]),
    recipe("c", [step("settings"), step("three")]),
    recipe("d", [step("settings"), step("four")]),
  ]);
  const before = JSON.stringify(recipes);
  const groups = groupRecipePaths(recipes);
  assert.deepEqual(ids(groups), [["a", "b"], ["solo"], ["c", "d"]]);
  for (const group of groups) {
    for (const member of group.recipes)
      assert.strictEqual(
        member,
        recipes.find((r) => r.id === member.id),
      );
    for (const [index, prefix] of group.sharedSteps.entries())
      assert.strictEqual(prefix, group.recipes[0].steps[index]);
  }
  assert.equal(JSON.stringify(recipes), before);
});

test("malformed or uncomparable steps keep their whole recipe ungrouped without invoking getters", () => {
  let getterCalls = 0;
  const getter = Object.defineProperty({}, "private", {
    enumerable: true,
    get() {
      getterCalls++;
      throw new Error("Do not evaluate data");
    },
  });
  const cyclic = {};
  cyclic.self = cyclic;
  const malformed = [
    null,
    step("", {}),
    { command: "open_profile" },
    step("open_profile", null),
    step("open_profile", []),
    step("open_profile", { value: undefined }),
    step("open_profile", { value: NaN }),
    step("open_profile", { value: Infinity }),
    step("open_profile", { value: 1n }),
    step("open_profile", { value() {} }),
    step("open_profile", { value: new Date(0) }),
    step("open_profile", { value: [, 1] }),
    step("open_profile", getter),
    step("open_profile", cyclic),
    step("open_profile", { [Symbol("private")]: 1 }),
  ];
  const validA = recipe("valid-a", [step("open_profile")]);
  const validB = recipe("valid-b", [step("open_profile")]);
  const invalid = malformed.map((bad, index) =>
    recipe("bad-" + index, [step("open_profile"), bad]),
  );
  const groups = groupRecipePaths([validA, ...invalid, validB]);
  assert.deepEqual(ids(groups), [
    ["valid-a", "valid-b"],
    ...invalid.map((r) => [r.id]),
  ]);
  assert.ok(groups.slice(1).every((group) => group.sharedSteps.length === 0));
  assert.equal(getterCalls, 0);
});
