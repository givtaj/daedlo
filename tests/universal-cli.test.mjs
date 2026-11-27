import test from "node:test";
import assert from "node:assert/strict";
import {
  parseUniversalArguments,
  universalCommand,
} from "../packages/universal/src/cli.mjs";

test("backup and restore use explicit separate destinations, and rollback requires preserving current data", async () => {
  for (const [args, command, flags] of [
    [
      ["backup", "--workspace", "/data", "--output", "/backups/one"],
      "backup",
      { workspace: "/data", output: "/backups/one" },
    ],
    [
      ["verify-backup", "--backup", "/backups/one"],
      "verify-backup",
      { backup: "/backups/one" },
    ],
    [
      [
        "restore",
        "--backup",
        "/backups/one",
        "--workspace",
        "/restored",
        "--catalog-version",
        "2",
      ],
      "restore",
      { backup: "/backups/one", workspace: "/restored", "catalog-version": 2 },
    ],
    [
      [
        "rollback",
        "--workspace",
        "/data",
        "--backup",
        "/backups/one",
        "--output",
        "/rollback",
        "--preserve",
        "/backups/current",
        "--catalog-version",
        "2",
      ],
      "rollback",
      {
        workspace: "/data",
        backup: "/backups/one",
        output: "/rollback",
        preserve: "/backups/current",
        "catalog-version": 2,
      },
    ],
  ])
    assert.deepEqual(parseUniversalArguments(args), { command, flags });
  for (const args of [
    ["backup", "--workspace", "/data"],
    ["restore", "--backup", "/backups/one"],
    [
      "restore",
      "--backup",
      "/backups/one",
      "--workspace",
      "/restored",
      "--force",
    ],
    [
      "restore",
      "--backup",
      "/backups/one",
      "--workspace",
      "/restored",
      "--catalog-version",
      "5",
    ],
    [
      "rollback",
      "--workspace",
      "/data",
      "--backup",
      "/old",
      "--output",
      "/new",
      "--catalog-version",
      "2",
    ],
    [
      "rollback",
      "--workspace",
      "/data",
      "--backup",
      "/old",
      "--output",
      "/new",
      "--preserve",
      "/preserved",
    ],
  ])
    assert.throws(() => parseUniversalArguments(args), { code: "usage" });
  assert.match(
    (await universalCommand(["--help"])).text,
    /daedlo-universal backup/,
  );
  assert.match(
    (await universalCommand(["--help"])).text,
    /daedlo-universal rollback/,
  );
});

test("Universal has its own command and help without opening SQLite or an application", async () => {
  const result = await universalCommand(["--help"]);
  assert.match(result.text, /Basic Daedlo remains a separate installation/);
  assert.match(result.text, /daedlo-universal register/);
});
test("crashed backup recovery requires explicit inspection and a receipt", async () => {
  assert.deepEqual(
    parseUniversalArguments(["backup-recovery", "--backup", "/partial"]),
    { command: "backup-recovery", flags: { backup: "/partial" } },
  );
  assert.deepEqual(
    parseUniversalArguments([
      "recover-backup",
      "--backup",
      "/partial",
      "--receipt",
      "a".repeat(64),
    ]),
    {
      command: "recover-backup",
      flags: { backup: "/partial", receipt: "a".repeat(64) },
    },
  );
  assert.throws(
    () => parseUniversalArguments(["recover-backup", "--backup", "/partial"]),
    { code: "usage" },
  );
  assert.match(
    (await universalCommand(["--help"])).text,
    /daedlo-universal backup-recovery/,
  );
});
test("history always names its target and rejects ambiguous or unsupported arguments", () => {
  for (const args of [
    ["history", "--workspace", "/data"],
    [
      "history",
      "--workspace",
      "/data",
      "--target",
      "a",
      "--run",
      "r",
      "--limit",
      "3",
    ],
    ["history", "--workspace", "/data", "--target", "a", "--limit", "101"],
    ["targets", "--workspace", "/data", "--workspace", "/other"],
    ["index", "--workspace", "/data", "--target", "a", "--force"],
    ["revise", "--workspace", "/data", "--target", "a", "--revision", "0"],
  ])
    assert.throws(() => parseUniversalArguments(args), { code: "usage" });
  assert.deepEqual(
    parseUniversalArguments([
      "index",
      "--workspace",
      "/data",
      "--target",
      "a",
      "--rebuild",
    ]),
    {
      command: "index",
      flags: { workspace: "/data", target: "a", rebuild: true },
    },
  );
});

test("R4 exposes an explicit storage upgrade and target-scoped accepted summary", async () => {
  const help = (await universalCommand(["--help"])).text;
  assert.match(help, /daedlo-universal upgrade --workspace ROOT/);
  assert.deepEqual(
    parseUniversalArguments(["upgrade", "--workspace", "/data"]),
    { command: "upgrade", flags: { workspace: "/data" } },
  );
  assert.deepEqual(
    parseUniversalArguments([
      "summary",
      "--workspace",
      "/data",
      "--target",
      "a",
    ]),
    { command: "summary", flags: { workspace: "/data", target: "a" } },
  );
  for (const args of [
    ["summary", "--workspace", "/data"],
    ["upgrade", "--workspace", "/data", "--force"],
    ["upgrade", "--workspace", "/data", "--target", "a"],
  ])
    assert.throws(() => parseUniversalArguments(args), { code: "usage" });
});

test("archive import requires an explicit file, target and registration revision", async () => {
  const args = [
    "import",
    "--workspace",
    "/data",
    "--target",
    "a",
    "--revision",
    "1",
    "--file",
    "/archive/run.json",
  ];
  assert.deepEqual(parseUniversalArguments(args), {
    command: "import",
    flags: {
      workspace: "/data",
      target: "a",
      revision: 1,
      file: "/archive/run.json",
    },
  });
  for (const key of ["--target", "--revision", "--file"]) {
    const removed = [...args],
      at = removed.indexOf(key);
    removed.splice(at, 2);
    assert.throws(() => parseUniversalArguments(removed), { code: "usage" });
  }
  assert.match(
    (await universalCommand(["--help"])).text,
    /daedlo-universal import/,
  );
  assert.deepEqual(
    parseUniversalArguments([
      "history",
      "--workspace",
      "/data",
      "--target",
      "a",
      "--run",
      "old",
      "--source",
      "archive",
    ]).flags.source,
    "archive",
  );
  assert.throws(
    () =>
      parseUniversalArguments([
        "history",
        "--workspace",
        "/data",
        "--target",
        "a",
        "--source",
        "archive",
      ]),
    { code: "usage" },
  );
});

test("compression is target/run scoped, retains plain by default and requires explicit format opt-in", async () => {
  const args = [
    "compress",
    "--workspace",
    "/data",
    "--target",
    "a",
    "--run",
    "r",
  ];
  assert.deepEqual(parseUniversalArguments(args), {
    command: "compress",
    flags: { workspace: "/data", target: "a", run: "r" },
  });
  assert.deepEqual(parseUniversalArguments([...args, "--replace"]).flags, {
    workspace: "/data",
    target: "a",
    run: "r",
    replace: true,
  });
  assert.deepEqual(
    parseUniversalArguments([
      "upgrade",
      "--workspace",
      "/data",
      "--catalog-version",
      "4",
    ]),
    { command: "upgrade", flags: { workspace: "/data", "catalog-version": 4 } },
  );
  assert.deepEqual(
    parseUniversalArguments(["upgrade", "--workspace", "/data"]).flags,
    { workspace: "/data" },
  );
  for (const invalid of [
    args.slice(0, -2),
    ["compress", "--workspace", "/data", "--run", "r"],
    [...args, "--force"],
    [...args, "--replace", "true"],
    ["upgrade", "--workspace", "/data", "--catalog-version", "1"],
    ["upgrade", "--workspace", "/data", "--catalog-version", "5"],
  ])
    assert.throws(() => parseUniversalArguments(invalid), { code: "usage" });
  assert.match(
    (await universalCommand(["--help"])).text,
    /compress .*--target ID --run RUN_ID \[--replace\]/,
  );
});

test("journal recovery is target scoped and requires an inspected receipt", () => {
  assert.deepEqual(
    parseUniversalArguments([
      "journal-recovery",
      "--workspace",
      "/data",
      "--target",
      "a",
    ]),
    { command: "journal-recovery", flags: { workspace: "/data", target: "a" } },
  );
  assert.deepEqual(
    parseUniversalArguments([
      "recover-journal",
      "--workspace",
      "/data",
      "--target",
      "a",
      "--receipt",
      "abc",
    ]),
    {
      command: "recover-journal",
      flags: { workspace: "/data", target: "a", receipt: "abc" },
    },
  );
  for (const args of [
    ["journal-recovery", "--workspace", "/data"],
    ["recover-journal", "--workspace", "/data", "--target", "a"],
  ])
    assert.throws(() => parseUniversalArguments(args), { code: "usage" });
});

test("container exposure requires an explicit canonical loopback origin and fixed internal port", () => {
  assert.deepEqual(
    parseUniversalArguments([
      "serve",
      "--workspace",
      "/data",
      "--port",
      "43110",
      "--container-origin",
      "http://127.0.0.1:43111",
    ]),
    {
      command: "serve",
      flags: {
        workspace: "/data",
        port: 43110,
        "container-origin": "http://127.0.0.1:43111",
      },
    },
  );
  for (const origin of [
    "http://0.0.0.0:43111",
    "http://localhost:43111",
    "https://127.0.0.1:43111",
    "http://127.0.0.1:43111/",
    "http://127.0.0.1:43111/path",
    "http://127.0.0.1:43111?x",
    "http://127.0.0.1:43111#x",
  ]) {
    assert.throws(
      () =>
        parseUniversalArguments([
          "serve",
          "--workspace",
          "/data",
          "--port",
          "43110",
          "--container-origin",
          origin,
        ]),
      { code: "usage" },
    );
  }
  assert.throws(
    () =>
      parseUniversalArguments([
        "serve",
        "--workspace",
        "/data",
        "--container-origin",
        "http://127.0.0.1:43111",
      ]),
    { code: "usage" },
  );
  assert.throws(
    () =>
      parseUniversalArguments([
        "serve",
        "--workspace",
        "/data",
        "--port",
        "0",
        "--container-origin",
        "http://127.0.0.1:43111",
      ]),
    { code: "usage" },
  );
});
