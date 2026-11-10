import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertComposeDiskSpace } from "./compose-ci-safety.mjs";

const architectures = new Set(["amd64", "arm64"]);
const shaPattern = /^[a-f0-9]{40}$/;
const imagePattern = /^sha256:[a-f0-9]{64}$/;
const stages = [
  "source",
  "toolchain",
  "dependencies",
  "native",
  "chromium",
  "images",
  "acceptance",
];
export const scenarioNames = Object.freeze({
  compose_disk: "Compose build disk space verified",
  compose_browser_cleanup: "host inspection browser cleanup",
  compose_evidence: "final Compose evidence archived",
  compose_image_cleanup: "owned Compose test images cleaned",
  compose_readiness: "image build and Compose readiness",
  compose_runtime:
    "customer integration path resolves the bundled runtime as non-root",
  compose_startup:
    "container browser reaches separate app service without startup writes",
  compose_boundaries:
    "published-port Host and Origin boundaries reject foreign requests",
  compose_viewer:
    "real viewer renders Chromium stream and controls through published port",
  compose_persistence:
    "guarded edit/save persists exactly one independently read record",
  compose_shutdown:
    "stopping Daedlo preserves app and data and exports final evidence",
  compose_restart:
    "restarting Daedlo reconnects without replaying application commands",
  compose_cleanup: "owned Compose resources cleaned",
});

const normalizeArchitecture = (value) =>
  ({
    amd64: "amd64",
    x64: "amd64",
    x86_64: "amd64",
    arm64: "arm64",
    aarch64: "arm64",
  })[value];

export function assertNativeArchitecture({
  expected,
  platform,
  node,
  machine,
  daemon,
}) {
  if (
    !architectures.has(expected) ||
    platform !== "linux" ||
    [node, machine, daemon].some(
      (value) => normalizeArchitecture(value) !== expected,
    )
  )
    throw Error("Expected native architecture was not verified.");
  return { architecture: expected, host: expected, daemon: expected };
}

function validNative(value, expected) {
  return (
    value?.architecture === expected &&
    value?.host === expected &&
    value?.daemon === expected
  );
}

function safeImage(value, expected) {
  if (
    !value ||
    !["runtime", "model-sdk"].includes(value.role) ||
    !imagePattern.test(value.id ?? "") ||
    value.os !== "linux" ||
    value.architecture !== expected
  )
    return null;
  return {
    role: value.role,
    id: value.id,
    os: "linux",
    architecture: expected,
  };
}

// No raw command output, assertion text, application identity or browser data is
// copied to this public CI receipt. Unknown or absent proof cannot become PASS.
export function createSummary({
  sourceCommit,
  expectedArchitecture,
  metadataResult,
  fullVerification,
  outcomes = {},
  native,
  images,
  acceptance,
} = {}) {
  const source = shaPattern.test(sourceCommit ?? "") ? sourceCommit : null;
  const architecture = architectures.has(expectedArchitecture)
    ? expectedArchitecture
    : null;
  const selected =
    metadataResult === "success" &&
    ["true", "false"].includes(fullVerification);
  const full = selected && fullVerification === "true";
  const checks = [
    {
      id: "verification_decision",
      status: selected && source && architecture ? "PASS" : "FAIL",
    },
  ];
  for (const id of stages)
    checks.push({
      id,
      status: full
        ? outcomes[id] === "success"
          ? "PASS"
          : outcomes[id] === "failure"
            ? "FAIL"
            : "NOT RUN"
        : "NOT RUN",
    });
  const stage = (id) => checks.find((check) => check.id === id);
  const safeImages =
    full && Array.isArray(images)
      ? images.map((entry) => safeImage(entry, architecture)).filter(Boolean)
      : [];
  if (
    full &&
    outcomes.native === "success" &&
    !validNative(native, architecture)
  )
    stage("native").status = "FAIL";
  if (
    full &&
    outcomes.images === "success" &&
    (!Array.isArray(images) ||
      images.length !== 2 ||
      safeImages.length !== 2 ||
      new Set(safeImages.map((entry) => entry.role)).size !== 2)
  )
    stage("images").status = "FAIL";
  const attempted =
    full && ["success", "failure"].includes(outcomes.acceptance);
  const rows =
    attempted && Array.isArray(acceptance?.results) ? acceptance.results : [];
  const known = new Set(Object.values(scenarioNames));
  let malformed =
    attempted &&
    (!Array.isArray(acceptance?.results) ||
      rows.some(
        (row) =>
          !row ||
          !known.has(row.name) ||
          !["PASS", "FAIL", "BLOCKED"].includes(row.status),
      ));
  for (const [id, name] of Object.entries(scenarioNames)) {
    const matches = rows.filter((row) => row?.name === name);
    if (matches.length > 1) malformed = true;
    const status =
      matches.length === 1 &&
      ["PASS", "FAIL", "BLOCKED"].includes(matches[0].status)
        ? matches[0].status
        : matches.length > 0
          ? "FAIL"
          : "NOT RUN";
    checks.push({ id, status });
  }
  if (
    attempted &&
    (malformed ||
      (outcomes.acceptance === "success" &&
        checks.some(
          (row) => row.id.startsWith("compose_") && row.status !== "PASS",
        )))
  )
    stage("acceptance").status = "FAIL";
  const status = checks.some((check) => check.status === "FAIL")
    ? "FAIL"
    : !full
      ? "NOT RUN"
      : checks.every((check) => check.status === "PASS")
        ? "PASS"
        : "BLOCKED";
  return {
    format: "daedlo-compose-ci/1",
    sourceCommit: source,
    architecture,
    status,
    checks,
    images: safeImages,
  };
}

function runCommand(command, args, { capture = false } = {}) {
  const child = spawnSync(command, args, {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    maxBuffer: 4 * 1024 * 1024,
    timeout:
      args[0] === "build" ? 20 * 60 * 1000 : args[0] === "run" ? 120000 : 15000,
    killSignal: "SIGKILL",
  });
  if (child.error || child.status !== 0)
    throw Error("Compose CI command failed; inspect the preceding step log.");
  return capture ? child.stdout.trim() : "";
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}
async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + "\n");
}

export async function preflight({
  expectedArchitecture,
  output,
  run = runCommand,
  platform = process.platform,
  node = process.arch,
  checkDisk = assertComposeDiskSpace,
}) {
  const native = assertNativeArchitecture({
    expected: expectedArchitecture,
    platform,
    node,
    machine: run("uname", ["-m"], { capture: true }),
    daemon: run("docker", ["info", "--format", "{{.Architecture}}"], {
      capture: true,
    }),
  });
  const compose = run("docker", ["compose", "version", "--short"], {
    capture: true,
  });
  // Compose v5 preserves the v2 CLI. Parse the full version so malformed
  // output or a different major cannot masquerade as a supported release.
  const version =
    /^v?(0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      compose,
    );
  if (!version || !["2", "5"].includes(version[1]))
    throw Error("Docker Compose v2 or v5 is required.");
  await checkDisk({ output, run });
  await writeJson(resolve(output, "native.json"), native);
  return native;
}

export async function buildImages({
  expectedArchitecture,
  sourceCommit,
  output,
  run = runCommand,
  checkDisk = assertComposeDiskSpace,
}) {
  if (
    !architectures.has(expectedArchitecture) ||
    !shaPattern.test(sourceCommit ?? "") ||
    !validNative(
      await readJson(resolve(output, "native.json")),
      expectedArchitecture,
    )
  )
    throw Error(
      "Verified native architecture and source commit are required before building images.",
    );
  const images = [];
  await writeJson(resolve(output, "images.json"), images);
  for (const role of ["runtime", "model-sdk"]) {
    await checkDisk({ output, run });
    const tag = `daedlo-ci-${role}:${expectedArchitecture}-${sourceCommit.slice(0, 12)}`;
    run("docker", [
      "build",
      "--file",
      "container/Dockerfile",
      "--target",
      role,
      "--tag",
      tag,
      ".",
    ]);
    const inspected = JSON.parse(
      run("docker", ["image", "inspect", tag, "--format", "{{json .}}"], {
        capture: true,
      }),
    );
    const identity = safeImage(
      {
        role,
        id: inspected.Id,
        os: inspected.Os,
        architecture: inspected.Architecture,
      },
      expectedArchitecture,
    );
    if (!identity)
      throw Error("Built image does not match the native Linux architecture.");
    if (role === "runtime") {
      const probe = run(
        "docker",
        [
          "run",
          "--rm",
          "--init",
          "--shm-size=1gb",
          "--entrypoint",
          "node",
          tag,
          "--input-type=module",
          "-e",
          'import {createDriverSession} from "@daedlo/runtime";import {chromium} from "playwright";if(process.getuid()===0||typeof createDriverSession!=="function")process.exit(1);const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();await page.setContent("<h1>Native runtime</h1>");if(await page.locator("h1").textContent()!=="Native runtime")process.exitCode=1;console.log(JSON.stringify({architecture:process.arch,nonroot:true,browser:true}));}finally{await browser.close();}',
        ],
        { capture: true },
      );
      const observed = JSON.parse(probe);
      if (
        normalizeArchitecture(observed.architecture) !== expectedArchitecture ||
        observed.nonroot !== true ||
        observed.browser !== true
      )
        throw Error(
          "Reusable runtime did not pass its native non-root browser check.",
        );
    } else {
      const rust = run(
        "docker",
        ["run", "--rm", "--entrypoint", "rustc", tag, "-vV"],
        { capture: true },
      );
      const expectedTarget =
        expectedArchitecture === "amd64"
          ? "x86_64-unknown-linux-gnu"
          : "aarch64-unknown-linux-gnu";
      if (!rust.split("\n").includes(`host: ${expectedTarget}`))
        throw Error(
          "Model SDK compiler target does not match the native architecture.",
        );
    }
    images.push(identity);
    await writeJson(resolve(output, "images.json"), images);
  }
  return images;
}

export async function main(env = process.env, command = process.argv[2]) {
  const output = resolve(env.COMPOSE_CI_OUTPUT ?? "artifacts/compose-ci");
  await mkdir(output, { recursive: true });
  const expectedArchitecture = env.EXPECTED_ARCH;
  const sourceCommit = env.GITHUB_SHA;
  if (command === "preflight")
    return preflight({ expectedArchitecture, output });
  if (command === "images")
    return buildImages({ expectedArchitecture, sourceCommit, output });
  if (!["initialize", "summarize"].includes(command))
    throw Error("Unknown Compose CI command.");
  const summary = createSummary({
    sourceCommit,
    expectedArchitecture,
    metadataResult: env.METADATA_RESULT,
    fullVerification: env.FULL_VERIFICATION,
    outcomes: Object.fromEntries(
      stages.map((stage) => [stage, env[`CI_${stage.toUpperCase()}_OUTCOME`]]),
    ),
    native: await readJson(resolve(output, "native.json")),
    images: await readJson(resolve(output, "images.json")),
    acceptance: await readJson(resolve(output, "private/results.json")),
  });
  await writeJson(resolve(output, "summary.json"), summary);
  console.log(
    `Compose native ${summary.architecture ?? "unknown"}: ${summary.status}`,
  );
  if (command === "summarize" && !["PASS", "NOT RUN"].includes(summary.status))
    process.exitCode = 1;
  return summary;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  main().catch((error) => {
    console.error(
      "Compose CI verification failed; inspect the step and sanitized summary.",
      error.message,
    );
    process.exitCode = 1;
  });
