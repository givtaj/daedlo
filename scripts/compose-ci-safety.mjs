import { spawnSync } from "node:child_process";
import { realpath, statfs } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

export const DEFAULT_MIN_FREE_GIB = 15;
const GIB = 1024 ** 3;
const services = ["notebook-app", "daedlo"];
const imageIdPattern = /^sha256:[a-f0-9]{64}$/;
const projectPattern = /^daedlo-conformance-[a-z0-9][a-z0-9-]{0,100}$/;

function boundedRun(command, args, { env = process.env } = {}) {
  const child = spawnSync(command, args, {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15_000,
    killSignal: "SIGKILL",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (child.error || child.status !== 0) {
    const detail =
      child.error?.message || child.stderr?.trim() || `exit ${child.status}`;
    throw Error(
      `Compose safety command failed: ${command} ${args.join(" ")}: ${detail}`,
    );
  }
  return child.stdout;
}

async function capture(run, args, env) {
  const output = await run("docker", args, {
    capture: true,
    ...(env ? { env } : {}),
  });
  if (typeof output !== "string")
    throw Error("Docker inspection returned unreadable output.");
  return output.trim();
}

function minimumBytes(env) {
  const configured = env.DAEDLO_COMPOSE_MIN_FREE_GIB;
  const gib =
    configured === undefined ? DEFAULT_MIN_FREE_GIB : Number(configured);
  const bytes = Math.ceil(gib * GIB);
  if (!Number.isFinite(gib) || gib < 1 || !Number.isSafeInteger(bytes))
    throw Error(
      "DAEDLO_COMPOSE_MIN_FREE_GIB must be a finite number of at least 1 GiB.",
    );
  return { gib, bytes: BigInt(bytes) };
}

async function localEndpoint(env, run, platform) {
  let endpoint;
  if (env.DOCKER_CONTEXT) {
    endpoint = await capture(
      run,
      [
        "context",
        "inspect",
        env.DOCKER_CONTEXT,
        "--format",
        '{{(index .Endpoints "docker").Host}}',
      ],
      env,
    );
  } else if (env.DOCKER_HOST !== undefined) {
    endpoint = env.DOCKER_HOST;
  } else {
    endpoint = await capture(
      run,
      [
        "context",
        "inspect",
        "--format",
        '{{(index .Endpoints "docker").Host}}',
      ],
      env,
    );
  }
  const unix =
    typeof endpoint === "string" && /^unix:\/\/\/[^\0\r\n]+$/.test(endpoint);
  const pipe =
    platform === "win32" &&
    typeof endpoint === "string" &&
    /^npipe:\/\/\/\/\.\/pipe\/[^\0\r\n/]+$/.test(endpoint);
  if (!unix && !pipe)
    throw Error(
      "A local Docker endpoint is required to verify host disk space; remote or unknown endpoints are not supported.",
    );
  return endpoint;
}

// This receipt is private evidence: paths and endpoint details must not be
// copied into the sanitized public Compose CI summary.
export async function assertComposeDiskSpace({
  cwd = process.cwd(),
  output = cwd,
  env = process.env,
  platform = process.platform,
  home = homedir(),
  run = boundedRun,
  stat = statfs,
  resolvePath = realpath,
} = {}) {
  const minimum = minimumBytes(env);
  const endpoint = await localEndpoint(env, run, platform);
  let storage;
  if (env.DAEDLO_DOCKER_DISK_PATH !== undefined) {
    if (
      typeof env.DAEDLO_DOCKER_DISK_PATH !== "string" ||
      !env.DAEDLO_DOCKER_DISK_PATH.trim()
    )
      throw Error(
        "DAEDLO_DOCKER_DISK_PATH must identify the actual local Docker storage path.",
      );
    storage = resolve(cwd, env.DAEDLO_DOCKER_DISK_PATH);
  } else if (platform === "linux") {
    const operatingSystem = await capture(
      run,
      ["info", "--format", "{{.OperatingSystem}}"],
      env,
    );
    // Docker Desktop's Linux daemon reports a path inside its VM. A similarly
    // named host directory says nothing about the disk backing that VM.
    if (/docker desktop/i.test(operatingSystem))
      throw Error(
        "Docker Desktop on Linux requires DAEDLO_DOCKER_DISK_PATH to identify its actual host backing storage; DockerRootDir is inside the VM.",
      );
    if (!operatingSystem)
      throw Error(
        "Unknown Linux Docker backing storage; set DAEDLO_DOCKER_DISK_PATH to its actual local host path.",
      );
    storage = await capture(
      run,
      ["info", "--format", "{{.DockerRootDir}}"],
      env,
    );
    if (!isAbsolute(storage))
      throw Error(
        "Docker storage is unmeasurable; set DAEDLO_DOCKER_DISK_PATH to its actual local host path.",
      );
  } else if (platform === "darwin") {
    const operatingSystem = await capture(
      run,
      ["info", "--format", "{{.OperatingSystem}}"],
      env,
    );
    if (operatingSystem !== "Docker Desktop")
      throw Error(
        "Unknown macOS Docker backing storage; set DAEDLO_DOCKER_DISK_PATH to its actual local host path.",
      );
    storage = resolve(
      home,
      "Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw",
    );
  } else {
    throw Error(
      "Unknown Docker backing storage; set DAEDLO_DOCKER_DISK_PATH to its actual local host path.",
    );
  }
  const receipt = {
    minimumFreeGiB: minimum.gib,
    minimumFreeBytes: String(minimum.bytes),
    dockerEndpoint: endpoint,
    scope:
      "Available host filesystem space, not Docker VM virtual capacity or a guarantee against concurrent disk use.",
    locations: [],
  };
  for (const [role, path] of [
    ["source", cwd],
    ["evidence", output],
    ["docker", storage],
  ]) {
    let canonical;
    let available;
    try {
      canonical = await resolvePath(resolve(cwd, path));
      if (typeof canonical !== "string" || !isAbsolute(canonical))
        throw Error("invalid resolved path");
      const filesystem = await stat(canonical, { bigint: true });
      if (
        typeof filesystem.bavail !== "bigint" ||
        filesystem.bavail < 0n ||
        typeof filesystem.bsize !== "bigint" ||
        filesystem.bsize <= 0n
      )
        throw Error("invalid available-space measurement");
      available = filesystem.bavail * filesystem.bsize;
    } catch (cause) {
      const error = Error(
        `Cannot measure ${role} disk space at ${path}: ${cause.message}. Verify DAEDLO_DOCKER_DISK_PATH if Docker storage is custom.`,
      );
      error.diskReceipt = receipt;
      throw error;
    }
    receipt.locations.push({
      role,
      path: canonical,
      freeBytes: String(available),
    });
    if (available < minimum.bytes) {
      const error = Error(
        `Insufficient free disk space for ${role} at ${canonical}: ${(Number(available) / GIB).toFixed(2)} GiB available; ${minimum.gib} GiB required. The next build was not started.`,
      );
      error.diskReceipt = receipt;
      throw error;
    }
  }
  return receipt;
}

function prospectiveImages(project) {
  if (typeof project !== "string" || !projectPattern.test(project))
    throw Error(
      "A unique daedlo-conformance project name is required for image ownership.",
    );
  return services.map((service) => ({
    service,
    tag: `${project}-${service}:latest`,
  }));
}

export async function assertFreshComposeImages({ project, run = boundedRun }) {
  const prospective = prospectiveImages(project);
  const rows = await capture(run, [
    "image",
    "ls",
    "--no-trunc",
    "--format",
    "{{json .}}",
  ]);
  for (const line of rows.split("\n").filter(Boolean)) {
    const image = JSON.parse(line);
    if (typeof image.Repository !== "string" || typeof image.Tag !== "string")
      throw Error(
        "Docker image inventory is malformed; run ownership cannot be established.",
      );
    const tag = `${image.Repository}:${image.Tag}`;
    if (prospective.some((image) => image.tag === tag))
      throw Error(
        `Prospective Compose image ${tag} already exists; refusing to overwrite it.`,
      );
  }
  return prospective;
}

async function inspectOwnedImage(project, expected, run) {
  const inspected = JSON.parse(
    await capture(run, [
      "image",
      "inspect",
      expected.tag,
      "--format",
      "{{json .}}",
    ]),
  );
  const labels = inspected?.Config?.Labels;
  // The fixture declares these image build labels explicitly. Compose's own
  // labels vary by build backend/version and are not an ownership contract.
  if (
    !imageIdPattern.test(inspected?.Id ?? "") ||
    !Array.isArray(inspected.RepoTags) ||
    !inspected.RepoTags.includes(expected.tag) ||
    labels?.["io.daedlo.compose.project"] !== project ||
    labels?.["io.daedlo.compose.service"] !== expected.service
  )
    throw Error(
      `Compose image ownership could not be verified for ${expected.tag}.`,
    );
  if (expected.id && inspected.Id !== expected.id)
    throw Error(
      `Compose image identity changed for ${expected.tag}; preserving it.`,
    );
  return { service: expected.service, tag: expected.tag, id: inspected.Id };
}

export async function captureComposeImages({ project, run = boundedRun }) {
  const images = [];
  for (const expected of prospectiveImages(project))
    images.push(await inspectOwnedImage(project, expected, run));
  return images;
}

function validateCapturedImages(project, images) {
  const prospective = prospectiveImages(project);
  if (
    !Array.isArray(images) ||
    images.length !== prospective.length ||
    new Set(images.map((image) => image?.service)).size !== prospective.length
  )
    throw Error(
      "Exactly two distinct captured Compose image identities are required.",
    );
  for (const expected of prospective) {
    const image = images.find((entry) => entry?.service === expected.service);
    if (
      !image ||
      image.tag !== expected.tag ||
      !imageIdPattern.test(image.id ?? "")
    )
      throw Error("Captured Compose image identities do not match this run.");
  }
}

async function assertNoContainerReferences(image, run) {
  const containers = await capture(run, [
    "ps",
    "--all",
    "--filter",
    `ancestor=${image.id}`,
    "--format",
    "{{.ID}}",
  ]);
  if (containers)
    throw Error(
      `Compose image ${image.tag} still has container references; preserving it.`,
    );
}

// Call only after successful tests, durable evidence, and successful project
// teardown. Failed/interrupted runs and old runs must never reach this helper.
export async function removeComposeImages({
  project,
  images,
  run = boundedRun,
  shouldRetain = () => false,
}) {
  const removed = [];
  let pendingRemoval;
  const assertContinuing = async () => {
    if (await shouldRetain()) {
      const error = Error(
        "Compose image cleanup interrupted; retaining remaining images.",
      );
      error.code = "COMPOSE_IMAGES_RETAINED";
      throw error;
    }
  };
  try {
    validateCapturedImages(project, images);
    await assertContinuing();
    // Validate the whole set before the first deletion. Recheck each tag and
    // its container references immediately before removing that tag alone.
    for (const image of images) {
      await assertContinuing();
      await inspectOwnedImage(project, image, run);
      await assertNoContainerReferences(image, run);
      await assertContinuing();
    }
    for (const image of images) {
      await assertContinuing();
      await inspectOwnedImage(project, image, run);
      await assertNoContainerReferences(image, run);
      await assertContinuing();
      pendingRemoval = { ...image };
      await capture(run, ["image", "rm", "--no-prune", image.tag]);
      removed.push({ ...image });
      pendingRemoval = undefined;
    }
    return removed;
  } catch (cause) {
    const error = cause instanceof Error ? cause : Error(String(cause));
    error.removedImages = removed;
    // A disconnected or timed-out daemon might have processed the last rm.
    // Do not claim either successful removal or preservation without a recheck.
    error.possiblyRemovedImages = pendingRemoval ? [pendingRemoval] : [];
    throw error;
  }
}
