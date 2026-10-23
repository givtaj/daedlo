import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import { setReleaseVersion } from "../scripts/release/version.mjs";

const current = "0.1.1-rc.1";
const next = "0.1.1-rc.2";
async function fixture(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(join(os.tmpdir(), "driver-version-test-")),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const frameworkLock = `[[package]]\nname = "daedlo-engine"\nversion = "${current}"\ndependencies = ["serde"]\n\n`;
  const files = {
    "packages/runtime/package.json": `{ "name": "@daedlo/runtime", "version" : "${current}", "unchanged": "${current}", "dependencies": { "playwright": "1.62.1" } }\n`,
    "package-lock.json": `{\n  "lockfileVersion": 3, "packages": {\n    "node_modules/playwright": {"version":"1.62.1"},\n    "packages/runtime": { "name": "@daedlo/runtime", "version": "${current}" }\n  }, "unchanged":"${current}"\n}\n`,
    "Cargo.toml": `[workspace]\nmembers = ["crates/daedlo-engine", "examples/notebook-engine"]\n\n[workspace.package]\nversion = "${current}" # Preserve this comment.\nedition = "2021"\n\n[workspace.dependencies]\nserde = "1"\n`,
    "Cargo.lock": `# Preserve generated metadata.\nversion = 4\n\n${frameworkLock}[[package]]\nname = "notebook-engine"\nversion = "${current}"\ndependencies = ["daedlo-engine"]\n\n[[package]]\nname = "unchanged-library"\nversion = "${current}"\n`,
    "examples/notebook-engine/Cargo.toml": `[package]\nname = "notebook-engine"\nversion.workspace = true\n\n[dependencies]\ndaedlo-engine = { path = "../../crates/daedlo-engine", version = "=${current}" } # Preserve\n`,
  };
  for (const [directory, name] of [
    ["integrations/roots/engine", "roots-browser-driver-consumer"],
    ["integrations/roots/edit/engine", "roots-edit-browser-driver-consumer"],
  ]) {
    files[`${directory}/Cargo.toml`] =
      `[package]\nname = "${name}"\nversion = "0.1.0"\n\n[workspace]\n\n[dependencies]\ndaedlo-engine = { path = "preserve/framework/path", version = "=${current}" }\nroots-qa-driver = { path = "preserve/customer/path", version = "=0.1.0" }\n`;
    files[`${directory}/Cargo.lock`] =
      `version = 4\n\n${frameworkLock}[[package]]\nname = "${name}"\nversion = "0.1.0"\ndependencies = ["daedlo-engine", "roots-qa-driver"]\n\n[[package]]\nname = "roots-qa-driver"\nversion = "0.1.0"\n`;
  }
  for (const [path, content] of Object.entries(files)) {
    await fs.mkdir(dirname(join(root, path)), { recursive: true });
    await fs.writeFile(join(root, path), content);
  }
  return { root, files };
}
async function contents(root, files) {
  return Object.fromEntries(
    await Promise.all(
      Object.keys(files).map(async (path) => [
        path,
        await fs.readFile(join(root, path), "utf8"),
      ]),
    ),
  );
}

test("prepares all nine version files while preserving customer pins and unrelated text", async (t) => {
  const { root, files } = await fixture(t);
  const result = await setReleaseVersion({ repoRoot: root, version: next });
  assert.equal(result.previousVersion, current);
  assert.equal(result.version, next);
  assert.equal(result.files.length, 9);
  const changed = await contents(root, files);
  for (const [path, before] of Object.entries(files)) {
    assert.ok(
      changed[path].includes(next),
      `${path} must have its release version updated`,
    );
    const expected = before
      .replaceAll(current, next)
      .replaceAll(`"unchanged": "${next}"`, `"unchanged": "${current}"`)
      .replaceAll(`"unchanged":"${next}"`, `"unchanged":"${current}"`)
      .replaceAll(
        `name = "unchanged-library"\nversion = "${next}"`,
        `name = "unchanged-library"\nversion = "${current}"`,
      );
    assert.equal(
      changed[path],
      expected,
      `${path} must preserve every unrelated byte`,
    );
  }
});

test("an inconsistent last lock file refuses before changing any earlier file", async (t) => {
  const { root, files } = await fixture(t);
  const last = "integrations/roots/edit/engine/Cargo.lock";
  await fs.writeFile(join(root, last), files[last].replace(current, "0.0.9"));
  const before = await contents(root, files);
  await assert.rejects(
    setReleaseVersion({ repoRoot: root, version: next }),
    /inconsistent|mismatch|match/i,
  );
  assert.deepEqual(await contents(root, files), before);
});

test("invalid, reused and decreasing versions are refused without writes", async (t) => {
  const { root, files } = await fixture(t);
  for (const version of [
    current,
    "0.1.1-beta.9",
    "0.1.0",
    "0.1.1-rc.01",
    "01.2.3",
    "0.1.1+reused",
    "../1.2.3",
    "v1.2.3",
  ]) {
    await assert.rejects(
      setReleaseVersion({ repoRoot: root, version }),
      /version|semver|greater/i,
    );
    assert.deepEqual(await contents(root, files), files);
  }
});

test("SemVer ordering compares numeric prerelease identifiers and permits stable promotion", async (t) => {
  const { root } = await fixture(t);
  assert.equal(
    (await setReleaseVersion({ repoRoot: root, version: "0.1.1-rc.10" }))
      .version,
    "0.1.1-rc.10",
  );
  await assert.rejects(
    setReleaseVersion({ repoRoot: root, version: "0.1.1-rc.9" }),
    /greater|version/i,
  );
  assert.equal(
    (await setReleaseVersion({ repoRoot: root, version: "0.1.1" }))
      .previousVersion,
    "0.1.1-rc.10",
  );
});

test("missing files and source symlinks refuse before any version changes", async (t) => {
  const { root, files } = await fixture(t);
  const path = "integrations/roots/edit/engine/Cargo.lock";
  await fs.rename(join(root, path), join(root, "retained-lock"));
  await assert.rejects(
    setReleaseVersion({ repoRoot: root, version: next }),
    /missing|ENOENT/i,
  );
  const withoutLast = { ...files };
  delete withoutLast[path];
  assert.deepEqual(await contents(root, withoutLast), withoutLast);
  await fs.symlink(join(root, "retained-lock"), join(root, path));
  await assert.rejects(
    setReleaseVersion({ repoRoot: root, version: next }),
    /symlink|symbolic/i,
  );
  assert.equal(
    await fs.readFile(join(root, "retained-lock"), "utf8"),
    files[path],
  );
  assert.deepEqual(await contents(root, withoutLast), withoutLast);
});

test("a mid-commit rename failure restores all already-written files byte for byte", async (t) => {
  const { root, files } = await fixture(t);
  const original = fs.rename;
  let attempted = 0;
  const mock = t.mock.method(fs, "rename", async (...args) => {
    attempted++;
    if (attempted === 4) throw Error("Simulated write switch failure");
    return original(...args);
  });
  try {
    await assert.rejects(
      setReleaseVersion({ repoRoot: root, version: next }),
      /write switch failure/,
    );
  } finally {
    mock.mock.restore();
  }
  assert.ok(
    attempted >= 7,
    "Earlier committed files must be restored in reverse",
  );
  assert.deepEqual(await contents(root, files), files);
  async function temporaryEntries(directory) {
    const found = [];
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      if (item.name.startsWith(".browser-driver-version-"))
        found.push(item.name);
      if (item.isDirectory())
        found.push(...(await temporaryEntries(join(directory, item.name))));
    }
    return found;
  }
  assert.deepEqual(await temporaryEntries(root), []);
});
