import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  assertNativeArchitecture,
  buildImages,
  createSummary,
  preflight,
  scenarioNames,
} from "../scripts/compose-ci.mjs";

const sourceCommit = "a".repeat(40);
const imageId = (letter) => `sha256:${letter.repeat(64)}`;
const passing = () => ({
  sourceCommit,
  expectedArchitecture: "arm64",
  metadataResult: "success",
  fullVerification: "true",
  outcomes: Object.fromEntries(
    [
      "source",
      "toolchain",
      "dependencies",
      "native",
      "chromium",
      "images",
      "acceptance",
    ].map((id) => [id, "success"]),
  ),
  native: { architecture: "arm64", host: "arm64", daemon: "arm64" },
  images: [
    { role: "runtime", id: imageId("b"), os: "linux", architecture: "arm64" },
    { role: "model-sdk", id: imageId("c"), os: "linux", architecture: "arm64" },
  ],
  acceptance: {
    results: Object.values(scenarioNames).map((name) => ({
      name,
      status: "PASS",
    })),
  },
});

test("native preflight requires Linux host, Node and Docker to agree with the expected architecture", () => {
  for (const [expected, node, machine, daemon] of [
    ["amd64", "x64", "x86_64", "x86_64"],
    ["arm64", "arm64", "aarch64", "aarch64"],
  ]) {
    assert.deepEqual(
      assertNativeArchitecture({
        expected,
        platform: "linux",
        node,
        machine,
        daemon,
      }),
      {
        architecture: expected,
        host: expected,
        daemon: expected,
      },
    );
    for (const changed of [
      { platform: "darwin" },
      { node: "unknown" },
      { machine: "unknown" },
      { daemon: "unknown" },
      { expected: "unknown" },
      { daemon: expected === "amd64" ? "arm64" : "amd64" },
      { machine: expected === "amd64" ? "aarch64" : "x86_64" },
    ])
      assert.throws(
        () =>
          assertNativeArchitecture({
            expected,
            platform: "linux",
            node,
            machine,
            daemon,
            ...changed,
          }),
        /native architecture/,
      );
  }
});

test("summary requires complete native images and browser persistence/shutdown evidence for PASS", () => {
  assert.equal(createSummary(passing()).status, "PASS");
  for (const field of ["native", "images", "acceptance"]) {
    const input = passing();
    delete input[field];
    assert.equal(
      createSummary(input).status,
      "FAIL",
      `${field} cannot be inferred from a green process`,
    );
  }
  for (const tamper of [
    (input) => {
      input.images[1].architecture = "amd64";
    },
    (input) => {
      input.native.daemon = "amd64";
    },
    (input) => {
      input.images[1].id = "not-an-image-id";
    },
    (input) => {
      input.acceptance.results.pop();
    },
    (input) => {
      input.acceptance.results.push(input.acceptance.results[0]);
    },
    (input) => {
      input.acceptance.results[0].status = "unknown";
    },
    (input) => {
      input.sourceCommit = "not-a-commit";
    },
    (input) => {
      input.expectedArchitecture = "unknown";
    },
  ]) {
    const input = passing();
    tamper(input);
    assert.equal(createSummary(input).status, "FAIL");
  }
});

test("summary copies only fixed status names, valid image identities and source commit", () => {
  const input = passing();
  input.secret = "DO_NOT_UPLOAD";
  input.native.path = "/DO_NOT_UPLOAD";
  input.images[0].environment = { password: "DO_NOT_UPLOAD" };
  input.acceptance.project = "DO_NOT_UPLOAD";
  input.acceptance.viewerUrl = "http://DO_NOT_UPLOAD";
  for (const row of input.acceptance.results) row.error = "DO_NOT_UPLOAD";
  const summary = createSummary(input);
  assert.equal(summary.status, "PASS");
  assert.doesNotMatch(
    JSON.stringify(summary),
    /DO_NOT_UPLOAD|password|viewerUrl|error/,
  );
  assert.deepEqual(summary.images[0], {
    role: "runtime",
    id: imageId("b"),
    os: "linux",
    architecture: "arm64",
  });
  input.acceptance.results.push({
    name: "DO_NOT_UPLOAD",
    status: "FAIL",
    error: "DO_NOT_UPLOAD",
  });
  assert.equal(createSummary(input).status, "FAIL");
  assert.doesNotMatch(JSON.stringify(createSummary(input)), /DO_NOT_UPLOAD/);
});

test("failed, cancelled and missing prerequisites cannot become successful acceptance", () => {
  const input = passing();
  input.outcomes.dependencies = "failure";
  input.outcomes.native = "skipped";
  input.outcomes.chromium = "skipped";
  input.outcomes.images = "skipped";
  input.outcomes.acceptance = "skipped";
  delete input.native;
  delete input.images;
  delete input.acceptance;
  const summary = createSummary(input);
  assert.equal(summary.status, "FAIL");
  assert.equal(
    summary.checks.find((row) => row.id === "dependencies").status,
    "FAIL",
  );
  assert.equal(
    summary.checks.find((row) => row.id === "compose_persistence").status,
    "NOT RUN",
  );
  input.outcomes.dependencies = "cancelled";
  assert.equal(createSummary(input).status, "BLOCKED");
  input.outcomes = {};
  assert.equal(createSummary(input).status, "BLOCKED");
});

test("record-only selection reports NOT RUN and cannot consume stale passing receipts", () => {
  const input = passing();
  input.fullVerification = "false";
  const summary = createSummary(input);
  assert.equal(summary.status, "NOT RUN");
  assert.deepEqual(summary.images, []);
  assert.equal(
    summary.checks.find((row) => row.id === "compose_persistence").status,
    "NOT RUN",
  );
  for (const changed of [
    { metadataResult: "failure" },
    { metadataResult: "" },
    { fullVerification: "" },
  ])
    assert.equal(createSummary({ ...input, ...changed }).status, "FAIL");
});

async function outputDirectory(t) {
  const output = await mkdtemp(join(tmpdir(), "daedlo-compose-ci-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  return output;
}

function composePreflightRun(version) {
  return (command, args) => {
    if (command === "uname") return "aarch64";
    if (args[0] === "info") return "aarch64";
    assert.deepEqual(
      [command, ...args],
      ["docker", "compose", "version", "--short"],
    );
    return version;
  };
}

for (const version of [
  "5.5.1",
  "v5.5.1",
  "2.42.0",
  "v2.42.0",
  "v2.40.0-desktop.1",
  "5.5.1+desktop.1",
]) {
  test(`native preflight accepts supported Compose ${version}`, async (t) => {
    const output = await outputDirectory(t);
    let diskChecks = 0;
    const native = await preflight({
      expectedArchitecture: "arm64",
      output,
      platform: "linux",
      node: "arm64",
      run: composePreflightRun(version),
      checkDisk: async () => {
        diskChecks++;
      },
    });
    assert.equal(diskChecks, 1);
    assert.deepEqual(native, passing().native);
    assert.deepEqual(
      JSON.parse(await readFile(join(output, "native.json"), "utf8")),
      native,
    );
  });
}

for (const version of [
  "1.29.2",
  "3.0.0",
  "4.0.0",
  "6.0.0",
  "2.",
  "5.5",
  "5.5.1trailing",
  "2.42.0\nextra output",
  "5.5.1-",
  "5.5.1+",
  "5.05.1",
]) {
  test(`native preflight rejects unsupported or malformed Compose ${JSON.stringify(version)}`, async (t) => {
    const output = await outputDirectory(t);
    let diskChecks = 0;
    await assert.rejects(
      preflight({
        expectedArchitecture: "arm64",
        output,
        platform: "linux",
        node: "arm64",
        run: composePreflightRun(version),
        checkDisk: async () => {
          diskChecks++;
        },
      }),
      /Docker Compose/,
    );
    assert.equal(diskChecks, 0);
    await assert.rejects(readFile(join(output, "native.json")), {
      code: "ENOENT",
    });
  });
}

test("supported Compose cannot leave native proof when the disk guard fails", async (t) => {
  const output = await outputDirectory(t);
  await assert.rejects(
    preflight({
      expectedArchitecture: "arm64",
      output,
      platform: "linux",
      node: "arm64",
      run: composePreflightRun("5.5.1"),
      checkDisk: async () => {
        throw Error("Insufficient disk space");
      },
    }),
    /Insufficient disk space/,
  );
  await assert.rejects(readFile(join(output, "native.json")), {
    code: "ENOENT",
  });
});

test("preflight cannot leave a native PASS receipt after a daemon architecture mismatch", async (t) => {
  const output = await outputDirectory(t);
  const calls = [];
  await assert.rejects(
    preflight({
      expectedArchitecture: "arm64",
      output,
      platform: "linux",
      node: "arm64",
      run(command, args) {
        calls.push([command, args]);
        return command === "uname" ? "aarch64" : "x86_64";
      },
    }),
    /native architecture/,
  );
  await assert.rejects(readFile(join(output, "native.json")), {
    code: "ENOENT",
  });
  assert.equal(calls.length, 2);
});

test("image verification refuses missing native proof before issuing Docker builds", async (t) => {
  const output = await outputDirectory(t);
  let commands = 0;
  await assert.rejects(
    buildImages({
      expectedArchitecture: "arm64",
      sourceCommit,
      output,
      run() {
        commands++;
      },
    }),
    /native architecture/,
  );
  assert.equal(commands, 0);
});

test("low disk space blocks CI image builds before Docker can consume more storage", async (t) => {
  const output = await outputDirectory(t);
  await writeFile(
    join(output, "native.json"),
    JSON.stringify(passing().native),
  );
  let builds = 0;
  const error = await buildImages({
    expectedArchitecture: "arm64",
    sourceCommit,
    output,
    checkDisk: async () => {
      throw Error("Insufficient disk space");
    },
    run(command, args) {
      if (args[0] === "build") builds++;
      if (args[0] === "image")
        return JSON.stringify({
          Id: imageId(args[2].includes("model-sdk") ? "c" : "b"),
          Os: "linux",
          Architecture: "arm64",
        });
      if (args.includes("rustc")) return "host: aarch64-unknown-linux-gnu";
      if (args[0] === "run")
        return JSON.stringify({
          architecture: "arm64",
          nonroot: true,
          browser: true,
        });
      return "";
    },
  }).catch((error) => error);
  assert.equal(builds, 0, "low disk must stop every build before it starts");
  assert.match(error?.message ?? "", /Insufficient disk space/);
});

test("image verification rejects foreign image architecture before runtime browser execution", async (t) => {
  const output = await outputDirectory(t);
  await writeFile(
    join(output, "native.json"),
    JSON.stringify(passing().native),
  );
  const calls = [];
  await assert.rejects(
    buildImages({
      expectedArchitecture: "arm64",
      sourceCommit,
      output,
      checkDisk: async () => {},
      run(command, args) {
        calls.push([command, args]);
        return args[0] === "image"
          ? JSON.stringify({
              Id: imageId("b"),
              Os: "linux",
              Architecture: "amd64",
            })
          : "";
      },
    }),
    /image does not match/,
  );
  assert.equal(calls.filter(([, args]) => args[0] === "run").length, 0);
  assert.deepEqual(
    JSON.parse(await readFile(join(output, "images.json"), "utf8")),
    [],
  );
});

test("reusable images need both a native non-root browser and the matching SDK compiler", async (t) => {
  const output = await outputDirectory(t);
  await writeFile(
    join(output, "native.json"),
    JSON.stringify(passing().native),
  );
  let sdkTarget = "x86_64-unknown-linux-gnu";
  const calls = [];
  const run = (command, args) => {
    calls.push([command, args]);
    if (args[0] === "image")
      return JSON.stringify({
        Id: imageId(args[2].includes("model-sdk") ? "c" : "b"),
        Os: "linux",
        Architecture: "arm64",
      });
    if (args.includes("rustc")) return `rustc 1.96.0\nhost: ${sdkTarget}`;
    if (args[0] === "run")
      return JSON.stringify({
        architecture: "arm64",
        nonroot: true,
        browser: true,
      });
    return "";
  };
  await assert.rejects(
    buildImages({
      expectedArchitecture: "arm64",
      sourceCommit,
      output,
      run,
      checkDisk: async () => {},
    }),
    /compiler target/,
  );
  assert.deepEqual(
    JSON.parse(await readFile(join(output, "images.json"), "utf8")),
    [passing().images[0]],
  );
  sdkTarget = "aarch64-unknown-linux-gnu";
  calls.length = 0;
  assert.deepEqual(
    await buildImages({
      expectedArchitecture: "arm64",
      sourceCommit,
      output,
      run,
      checkDisk: async () => {},
    }),
    passing().images,
  );
  assert.deepEqual(
    calls
      .filter(([, args]) => args[0] === "build")
      .map(([, args]) => args[args.indexOf("--target") + 1]),
    ["runtime", "model-sdk"],
  );
  assert.equal(calls.filter(([, args]) => args[0] === "run").length, 2);
  assert.ok(
    calls.every(([, args]) => !args.includes("--platform")),
    "native builds must not select emulation",
  );
});

test("the real helper CLI retains sanitized failure evidence when prerequisites never ran", async (t) => {
  const output = await outputDirectory(t);
  const script = fileURLToPath(
    new URL("../scripts/compose-ci.mjs", import.meta.url),
  );
  const env = {
    ...process.env,
    COMPOSE_CI_OUTPUT: output,
    EXPECTED_ARCH: "arm64",
    GITHUB_SHA: sourceCommit,
    METADATA_RESULT: "success",
    FULL_VERIFICATION: "true",
    CI_SOURCE_OUTCOME: "success",
    CI_TOOLCHAIN_OUTCOME: "failure",
    CI_DEPENDENCIES_OUTCOME: "skipped",
    CI_NATIVE_OUTCOME: "skipped",
    CI_CHROMIUM_OUTCOME: "skipped",
    CI_IMAGES_OUTCOME: "skipped",
    CI_ACCEPTANCE_OUTCOME: "skipped",
  };
  const initialized = spawnSync(process.execPath, [script, "initialize"], {
    env,
    encoding: "utf8",
  });
  assert.equal(initialized.status, 0, initialized.stderr);
  const finished = spawnSync(process.execPath, [script, "summarize"], {
    env,
    encoding: "utf8",
  });
  assert.equal(finished.status, 1, finished.stderr);
  const receipt = JSON.parse(
    await readFile(join(output, "summary.json"), "utf8"),
  );
  assert.equal(receipt.status, "FAIL");
  assert.equal(
    receipt.checks.find((row) => row.id === "toolchain").status,
    "FAIL",
  );
  assert.equal(
    receipt.checks.find((row) => row.id === "compose_persistence").status,
    "NOT RUN",
  );
  assert.deepEqual(receipt.images, []);
  assert.doesNotMatch(JSON.stringify(receipt), new RegExp(output));
});

test("CI rechecks disk before each image rather than trusting earlier preflight", async (t) => {
  const output = await outputDirectory(t);
  await writeFile(
    join(output, "native.json"),
    JSON.stringify(passing().native),
  );
  let checks = 0;
  let builds = 0;
  await assert.rejects(
    buildImages({
      expectedArchitecture: "arm64",
      sourceCommit,
      output,
      checkDisk: async () => {
        if (++checks === 2) throw Error("Disk filled after runtime build");
      },
      run(command, args) {
        if (args[0] === "build") builds++;
        if (args[0] === "image")
          return JSON.stringify({
            Id: imageId("b"),
            Os: "linux",
            Architecture: "arm64",
          });
        if (args[0] === "run")
          return JSON.stringify({
            architecture: "arm64",
            nonroot: true,
            browser: true,
          });
        return "";
      },
    }),
    /Disk filled/,
  );
  assert.equal(checks, 2);
  assert.equal(builds, 1);
});
