import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { classifyDiff, selectCi } from "../scripts/ci-select.mjs";

const workflow = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);

test("Node-independent Rust checks execute once while both lanes build their fixture", () => {
  assert.match(
    workflow,
    /- name: Check Rust format, lints and contracts once\n\s+if: .*matrix\.node == 24[^\n]*\n\s+run: \|\n\s+cargo fmt --all -- --check\n\s+cargo clippy --workspace --all-targets --locked -- -D warnings\n\s+cargo test --workspace --locked/,
  );
  assert.match(workflow, /node: \[22, 24\]/);
  assert.match(
    workflow,
    /- name: Build the independent Rust fixture\n\s+if: needs\.public-metadata\.outputs\.full == 'true'\n\s+run: cargo build --workspace --locked/,
  );
});

test("required Node statuses fail on classification failure instead of silently skipping", () => {
  assert.match(
    workflow,
    /needs: public-metadata\n\s+if: \$\{\{ !cancelled\(\) \}\}/,
  );
  assert.match(workflow, /test "\$METADATA_RESULT" = success/);
  assert.match(workflow, /case "\$FULL_VERIFICATION" in/);
  assert.match(workflow, /node scripts\/ci-select\.mjs/);
  const gate = workflow.match(
    /      - name: Require a successful verification decision\n[\s\S]*?        run: \|\n([\s\S]*?)(?=      - name:)/,
  )?.[1];
  assert.ok(gate);
  const script = gate
    .split("\n")
    .map((line) => line.replace(/^          /, ""))
    .join("\n");
  for (const result of ["failure", "cancelled", "skipped", ""]) {
    const child = spawnSync("bash", ["-e", "-c", script], {
      env: {
        ...process.env,
        METADATA_RESULT: result,
        FULL_VERIFICATION: "false",
      },
    });
    assert.notEqual(child.status, 0, result);
  }
  for (const decision of ["", "yes", "False"]) {
    const child = spawnSync("bash", ["-e", "-c", script], {
      env: {
        ...process.env,
        METADATA_RESULT: "success",
        FULL_VERIFICATION: decision,
      },
    });
    assert.notEqual(child.status, 0, decision);
  }
  for (const decision of ["true", "false"]) {
    const child = spawnSync("bash", ["-e", "-c", script], {
      env: {
        ...process.env,
        METADATA_RESULT: "success",
        FULL_VERIFICATION: decision,
      },
      encoding: "utf8",
    });
    assert.equal(child.status, 0, child.stderr);
    if (decision === "false") assert.match(child.stdout, /checks NOT RUN/);
  }
});

const blob = "a".repeat(40);
const edit = (path, status = "M", oldMode = "100644", newMode = "100644") =>
  `:${oldMode} ${newMode} ${blob} ${blob} ${status}\0${path}\0`;

test("only ordinary modifications of the two non-shipped records take the light path", () => {
  for (const path of ["docs/plan.md", "docs/verification.md"])
    assert.equal(classifyDiff(edit(path)).full, false, path);
  assert.equal(
    classifyDiff(edit("docs/plan.md") + edit("docs/verification.md")).full,
    false,
  );
  for (const path of [
    "docs/contracts.md",
    "docs/rename.md",
    "docs/development-workflow.md",
    "docs/public-downloads/AGENT_START.md",
    "README.md",
    "skills/daedlo/SKILL.md",
    "packages/runtime/src/session.mjs",
    "new-guide.md",
    "docs/verification/new-record.md",
  ])
    assert.equal(classifyDiff(edit(path)).full, true, path);
  assert.equal(
    classifyDiff(
      edit("docs/plan.md") + edit("packages/runtime/src/session.mjs"),
    ).full,
    true,
  );
});

test("missing, malformed, added, deleted, renamed or non-regular records require full checks", () => {
  for (const raw of [
    undefined,
    "",
    "M\tdocs/plan.md\n",
    edit("docs/plan.md").slice(0, -1),
    "\0",
    edit("docs/plan.md") + "truncated\0",
  ])
    assert.equal(classifyDiff(raw).full, true, String(raw));
  for (const status of ["A", "D", "T", "R100", "C100", "U"])
    assert.equal(classifyDiff(edit("docs/plan.md", status)).full, true, status);
  for (const mode of ["120000", "160000", "100755", "000000"])
    assert.equal(
      classifyDiff(edit("docs/plan.md", "M", mode, mode)).full,
      true,
      mode,
    );
  assert.equal(
    classifyDiff(edit("docs/plan.md", "M", "100644", "100755")).full,
    true,
  );
});

test("main, manual, unknown events and missing revisions never skip full verification", () => {
  const git = () => {
    throw Error("Must not inspect an unsupported event");
  };
  for (const eventName of [
    "push",
    "workflow_dispatch",
    "schedule",
    "unknown",
    undefined,
  ])
    assert.equal(selectCi({ eventName, git }).full, true);
  for (const event of [
    undefined,
    {},
    { pull_request: { base: { sha: "--output=bad" }, head: { sha: blob } } },
  ])
    assert.equal(
      selectCi({ eventName: "pull_request", event, checkoutSha: blob, git })
        .full,
      true,
    );
});

function mergedFixture(t, { sourceOnBase = false, renameSource = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "daedlo-ci-policy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  git(["init", "--initial-branch=main"]);
  git(["config", "user.name", "CI policy fixture"]);
  git(["config", "user.email", "ci-policy@example.invalid"]);
  git(["config", "core.hooksPath", "/dev/null"]);
  git(["config", "commit.gpgSign", "false"]);
  const put = (path, text) => writeFileSync(join(root, path), text);
  mkdirSync(join(root, "docs"));
  put("docs/plan.md", "Original plan\n");
  put("docs/verification.md", "Original evidence\n");
  put("runtime.mjs", "export const version = 1;\n");
  git(["add", "."]);
  git(["commit", "-m", "base"]);
  git(["checkout", "-b", "records"]);
  if (renameSource) {
    git(["rm", "docs/plan.md"]);
    git(["mv", "runtime.mjs", "docs/plan.md"]);
  } else put("docs/plan.md", "Updated plan\n");
  git(["add", "."]);
  git(["commit", "-m", "record update"]);
  const head = git(["rev-parse", "HEAD"]).trim();
  git(["checkout", "main"]);
  if (sourceOnBase) {
    put("runtime.mjs", "export const version = 2;\n");
    git(["add", "."]);
    git(["commit", "-m", "base-side runtime change"]);
  }
  const base = git(["rev-parse", "HEAD"]).trim();
  git(["merge", "--no-ff", "records", "-m", "PR merge"]);
  const checkoutSha = git(["rev-parse", "HEAD"]).trim();
  const event = { pull_request: { base: { sha: base }, head: { sha: head } } };
  return { root, eventName: "pull_request", event, checkoutSha, git };
}

test("real PR merge selection includes base-side changes and deleted source paths", (t) => {
  assert.deepEqual(selectCi(mergedFixture(t)), {
    full: false,
    reason: "planning-records-only",
  });
  assert.equal(selectCi(mergedFixture(t, { sourceOnBase: true })).full, true);
  assert.equal(selectCi(mergedFixture(t, { renameSource: true })).full, true);
});

test("unverified checkouts and unavailable Git history fall back to full verification", (t) => {
  const fixture = mergedFixture(t);
  assert.equal(selectCi({ ...fixture, checkoutSha: blob }).full, true);
  assert.equal(
    selectCi({
      ...fixture,
      event: {
        pull_request: {
          base: fixture.event.pull_request.head,
          head: fixture.event.pull_request.base,
        },
      },
    }).full,
    true,
  );
  assert.equal(
    selectCi({
      ...fixture,
      git: () => {
        throw Error("missing object");
      },
    }).full,
    true,
  );
  fixture.git(["checkout", "records"]);
  assert.equal(
    selectCi({ ...fixture, checkoutSha: fixture.event.pull_request.head.sha })
      .full,
    true,
  );
});

test("CLI writes an explicit decision, including full verification for malformed events", (t) => {
  const fixture = mergedFixture(t);
  const eventPath = join(fixture.root, "event.json");
  const outputPath = join(fixture.root, "output.txt");
  const script = new URL("../scripts/ci-select.mjs", import.meta.url);
  const run = (overrides = {}) =>
    execFileSync(process.execPath, [fileURLToPath(script)], {
      cwd: fixture.root,
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: fixture.eventName,
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_SHA: fixture.checkoutSha,
        GITHUB_WORKSPACE: fixture.root,
        GITHUB_OUTPUT: outputPath,
        ...overrides,
      },
      encoding: "utf8",
    });
  writeFileSync(eventPath, JSON.stringify(fixture.event));
  assert.equal(JSON.parse(run()).full, false);
  assert.equal(
    readFileSync(outputPath, "utf8"),
    "full=false\nreason=planning-records-only\n",
  );
  writeFileSync(eventPath, "invalid JSON");
  assert.equal(JSON.parse(run()).full, true);
  assert.match(
    readFileSync(outputPath, "utf8"),
    /full=true\nreason=unavailable-revisions\n$/,
  );
  assert.equal(
    JSON.parse(run({ GITHUB_EVENT_PATH: join(fixture.root, "missing.json") }))
      .full,
    true,
  );
  assert.throws(
    () => run({ GITHUB_OUTPUT: join(fixture.root, "missing", "output.txt") }),
    /Command failed/,
  );
});

test("shipped tools documents retain full verification and exclude the two record paths", () => {
  const tools = readFileSync(
    new URL("../scripts/release/tools.mjs", import.meta.url),
    "utf8",
  );
  const documents = tools.match(/const documents = \[([\s\S]*?)\];/)?.[1];
  assert.ok(
    documents,
    "Inspect the tools document inventory when its format changes",
  );
  const names = [...documents.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(names.length > 0);
  for (const name of names)
    assert.equal(classifyDiff(edit(`docs/${name}.md`)).full, true, name);
  assert.ok(!names.includes("plan") && !names.includes("verification"));
});

test("Cargo caches exclude independent installed outputs and never bypass cargo checks", () => {
  assert.match(workflow, /actions\/cache\/restore@[a-f0-9]{40}/);
  assert.match(workflow, /actions\/cache\/save@[a-f0-9]{40}/);
  assert.match(
    workflow,
    /runner\.os.*runner\.arch.*rust-toolchain\.toml.*\*\*\/Cargo\.lock.*\*\*\/Cargo\.toml/,
  );
  const cachePaths = [
    ...workflow.matchAll(/path: \|\n((?:            [^\n]+\n)+)\s+key:/g),
  ];
  assert.equal(cachePaths.length, 2);
  for (const [, paths] of cachePaths) {
    assert.match(paths, /target\//);
    assert.doesNotMatch(
      paths,
      /artifacts|RUNNER_TEMP|credentials|config|\.cargo\/$/m,
    );
  }
  assert.equal(
    (workflow.match(/cargo test --workspace --locked/g) ?? []).length,
    1,
  );
  assert.equal(
    (workflow.match(/cargo clippy --workspace --all-targets --locked/g) ?? [])
      .length,
    1,
  );
  assert.doesNotMatch(workflow, /cache-hit[^\n]*\n\s+run: cargo/);
});
