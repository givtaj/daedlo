import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const checker = fileURLToPath(
  new URL("../scripts/check-public-metadata.mjs", import.meta.url),
);
const conversation = (host = "chatgpt.com", route = ["c"]) =>
  ["https:", "", host, ...route, "synthetic-private-conversation"].join("/");
const thread = () =>
  ["codex:", "", "threads", "synthetic-private-thread"].join("/");

async function fixture(t) {
  const directory = await fs.mkdtemp(
    join(os.tmpdir(), "daedlo-public-metadata-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", ["-C", directory, ...args], {
      encoding: "utf8",
      stdio: "pipe",
    });
  git("init", "-q");
  const write = async (path, content, tracked = true) => {
    await fs.mkdir(dirname(join(directory, path)), { recursive: true });
    await fs.writeFile(join(directory, path), content);
    if (tracked) git("add", "--", path);
  };
  const run = (cwd = directory) =>
    spawnSync(process.execPath, [checker], { cwd, encoding: "utf8" });
  return { directory, git, write, run };
}

for (const [label, url] of [
  ["direct conversation", conversation()],
  ["legacy conversation", conversation("chat.openai.com")],
  [
    "project conversation",
    conversation("chatgpt.com", ["g", "g-p-synthetic", "c"]),
  ],
  [
    "project route",
    conversation("chatgpt.com", ["g", "g-p-synthetic", "project", "c"]),
  ],
  [
    "custom GPT conversation",
    conversation("chatgpt.com", ["g", "g-synthetic", "c"]),
  ],
  ["bare host", conversation().replace("https://", "")],
  ["case-insensitive host", conversation("CHATGPT.COM")],
]) {
  test(`rejects a staged ${label} without printing private text`, async (t) => {
    const f = await fixture(t);
    const path = "docs/a file with spaces.md";
    await f.write(path, `Source: ${url}\n`);
    const before = f.git("status", "--porcelain=v1", "-z");
    const result = f.run();
    assert.equal(
      result.status,
      1,
      "Private conversation metadata must fail the check",
    );
    assert.match(result.stderr, /private-chat-conversation/);
    assert.ok(result.stderr.includes(JSON.stringify(path)));
    assert.ok(!`${result.stdout}${result.stderr}`.includes(url));
    assert.ok(
      !`${result.stdout}${result.stderr}`.includes(
        "synthetic-private-conversation",
      ),
    );
    assert.equal(f.git("status", "--porcelain=v1", "-z"), before);
  });
}

test("rejects private Codex thread links with only a path and rule report", async (t) => {
  const f = await fixture(t);
  const url = thread();
  await f.write("docs/thread.json", JSON.stringify({ source: url }));
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /private-codex-thread/);
  assert.ok(result.stderr.includes(JSON.stringify("docs/thread.json")));
  assert.ok(!`${result.stdout}${result.stderr}`.includes(url));
  assert.ok(
    !`${result.stdout}${result.stderr}`.includes("synthetic-private-thread"),
  );
});

test("rejects a tracked customer path without needing to open its contents", async (t) => {
  const f = await fixture(t);
  await f.write("customers/example/empty.txt", "");
  await fs.rm(join(f.directory, "customers/example/empty.txt"));
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /customer-path/);
  assert.ok(
    result.stderr.includes(JSON.stringify("customers/example/empty.txt")),
  );
});

for (const path of ["notes/customers/account/contact.txt", "notes/customers"]) {
  test(`rejects a nested customer path before reading: ${path}`, async (t) => {
    const f = await fixture(t);
    await f.write(".gitignore", "customers/\n");
    await f.write(path, "", false);
    f.git("add", "--force", "--", path);
    await fs.rm(join(f.directory, path));
    const result = f.run();
    assert.equal(
      result.status,
      1,
      "Every customers path segment must be rejected",
    );
    assert.match(result.stderr, /customer-path/);
    assert.ok(result.stderr.includes(JSON.stringify(path)));
  });
}

test("reads tracked working-tree bytes and handles a nested invocation", async (t) => {
  const f = await fixture(t);
  await f.write("docs/current.md", "Public staged bytes.\n");
  await f.write("docs/current.md", conversation(), false);
  const result = f.run(join(f.directory, "docs"));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /private-chat-conversation/);
});

test("allows public URLs, ordinary identifiers and binary files without matches", async (t) => {
  const f = await fixture(t);
  await f.write(
    "docs/public.md",
    [
      ["https:", "", "chatgpt.com", "share", "public-example"].join("/"),
      "https://chatgpt.com/",
      "https://github.com/givtaj/daedlo",
      '"session": "00000000-0000-4000-8000-000000000000"',
      conversation("notchatgpt.com"),
      conversation("chatgpt.com.example.test"),
    ].join("\n"),
  );
  await f.write("assets/no matches.bin", Buffer.from([0, 255, 1, 128, 7, 0]));
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Public metadata check passed/);
});

test("detects literal private routes embedded in binary bytes", async (t) => {
  const f = await fixture(t);
  await f.write(
    "assets/embedded.bin",
    Buffer.concat([
      Buffer.from([0, 255, 1]),
      Buffer.from(conversation()),
      Buffer.from([0, 255]),
    ]),
  );
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /private-chat-conversation/);
});

test("does not inspect untracked files or follow a tracked symlink", async (t) => {
  const f = await fixture(t);
  await f.write("tracked.txt", "Public.\n");
  await f.write("untracked.txt", conversation(), false);
  await f.write("customers/example/private.txt", thread(), false);
  await fs.symlink("untracked.txt", join(f.directory, "linked.txt"));
  f.git("add", "--", "linked.txt");
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
});

test("does not follow a replaced directory into untracked data", async (t) => {
  const f = await fixture(t);
  await f.write("docs/tracked.txt", "Public.\n");
  await fs.rename(
    join(f.directory, "docs"),
    join(f.directory, "untracked-directory"),
  );
  await f.write("untracked-directory/tracked.txt", conversation(), false);
  await fs.symlink("untracked-directory", join(f.directory, "docs"));
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unreadable-tracked-path/);
  assert.ok(!result.stderr.includes("private-chat-conversation"));
});

test("reports multiple rules once per file and escapes unusual filenames", async (t) => {
  const f = await fixture(t);
  const path = "docs/a\nname.md";
  await f.write(path, `${conversation()} ${thread()} ${conversation()}`);
  const result = f.run();
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(JSON.stringify(path)));
  assert.equal(result.stderr.match(/private-chat-conversation/g)?.length, 1);
  assert.equal(result.stderr.match(/private-codex-thread/g)?.length, 1);
  assert.ok(!result.stderr.includes(path));
});

test("fails closed outside a Git repository without printing Git diagnostics", async (t) => {
  const directory = await fs.mkdtemp(
    join(os.tmpdir(), "daedlo-no-repository-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [checker], {
    cwd: directory,
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unable to inspect tracked files/);
  assert.ok(!result.stderr.includes(directory));
});

test("checks the current tree without scanning index blobs or historical commits", async (t) => {
  const f = await fixture(t);
  await f.write("docs/old.md", conversation());
  f.git(
    "-c",
    "user.name=Metadata test",
    "-c",
    "user.email=metadata@example.test",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-qm",
    "Synthetic private fixture",
  );
  await f.write("docs/old.md", "Sanitized working-tree metadata.\n", false);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
});

test("the guard and its synthetic regression fixtures pass their own rules", async (t) => {
  const f = await fixture(t);
  await f.write(
    "scripts/check-public-metadata.mjs",
    await fs.readFile(checker),
  );
  await f.write(
    "tests/public-metadata.test.mjs",
    await fs.readFile(fileURLToPath(import.meta.url)),
  );
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
});
