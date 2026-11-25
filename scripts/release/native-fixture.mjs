import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, renameSync } from "node:fs";
import fs from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  registrationFingerprint,
  snapshotRegisteredSource,
} from "./ninja-source.mjs";

const phases = ["acceptance", "health", "live"];
const inputLimit = 128 * 1024;
const outputLimit = 256 * 1024;
const envelopeLimit = outputLimit + 64 * 1024;
const hookTimeoutMs = 10000;
const cancelled = "Fixture preflight was cancelled.";
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const generationId =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const projectId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

class FixtureError extends Error {
  code = "fixture_preflight";
}

const fail = (message) => {
  throw new FixtureError(message);
};
function checkCancellation(signal) {
  if (signal?.aborted) fail(cancelled);
}
const absolute = (value) =>
  typeof value === "string" &&
  isAbsolute(value) &&
  !/[\x00-\x1f\x7f]/.test(value) &&
  resolve(value) === value;
const inside = (parent, item) => {
  const path = relative(parent, item);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(".." + sep) && !isAbsolute(path))
  );
};
const overlap = (a, b) => inside(a, b) || inside(b, a);

function fixtureSettings(config) {
  const options = config.fixturePreflight;
  const registration = config.registration;
  const hook = registration?.hooks?.preflight;
  if (options === undefined && hook === undefined) return;
  if (
    !object(options) ||
    hook === undefined ||
    Object.keys(options).some(
      (key) => !["input", "directory", "generation"].includes(key),
    ) ||
    !absolute(options.input) ||
    !absolute(options.directory) ||
    typeof options.generation !== "string" ||
    !generationId.test(options.generation)
  )
    fail(
      "Invalid fixture preflight configuration. Specify the registered hook, private input, fresh directory and generation.",
    );
  if (
    typeof hook !== "string" ||
    !hook.endsWith(".mjs") ||
    isAbsolute(hook) ||
    /[\\\x00-\x1f\x7f]/.test(hook) ||
    hook.split("/").some((part) => !part || part === "." || part === "..") ||
    !Array.isArray(registration?.files) ||
    !registration.files.includes(hook)
  )
    fail(
      "The fixture preflight hook must be an allowlisted registered .mjs file.",
    );
  if (
    !absolute(registration.sourceRoot) ||
    !absolute(config.store) ||
    typeof registration.projectId !== "string" ||
    !projectId.test(registration.projectId)
  )
    fail("Invalid fixture preflight project identity.");
  for (const location of [registration.sourceRoot, config.store]) {
    if (
      overlap(location, options.input) ||
      overlap(location, options.directory)
    )
      fail(
        "Fixture preflight paths must be disjoint from the registered source and managed store.",
      );
  }
  if (overlap(options.input, options.directory))
    fail("Fixture preflight input and output paths must be disjoint.");
  return {
    input: options.input,
    directory: options.directory,
    generation: options.generation,
    projectId: registration.projectId,
    sourceRoot: registration.sourceRoot,
    store: config.store,
    hook,
  };
}

async function localPath(path, type) {
  const info = await fs.lstat(path);
  if (info.isSymbolicLink() || (await fs.realpath(path)) !== path)
    fail("Fixture preflight requires regular local paths without symlinks.");
  if (type === "directory" ? !info.isDirectory() : !info.isFile())
    fail("Fixture preflight requires regular local files and directories.");
  return info;
}

async function verifyStorePath(path) {
  // Initial setup can have a prospective store. Check its existing prefix.
  for (let current = path; ; current = dirname(current)) {
    try {
      await localPath(current, "directory");
      return;
    } catch (error) {
      if (error.code !== "ENOENT" || current === dirname(current)) throw error;
    }
  }
}

function privateOwner(info) {
  return process.getuid?.() === info.uid && !(info.mode & 0o077);
}

async function privateDirectory(path) {
  const info = await localPath(path, "directory");
  if (!privateOwner(info) || (info.mode & 0o700) !== 0o700)
    fail(
      "Fixture preflight evidence directories require owner-only permissions.",
    );
}

function requirePrivateFile(info) {
  if (
    !info.isFile() ||
    info.nlink !== 1 ||
    !privateOwner(info) ||
    !(info.mode & 0o400)
  )
    fail(
      "Fixture preflight input requires a private owner-readable regular file.",
    );
}

async function privateBytes(path, limit) {
  requirePrivateFile(await localPath(path, "file"));
  const handle = await fs.open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const info = await handle.stat();
    requirePrivateFile(info);
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        size,
        buffer.length - size,
        size,
      );
      if (!bytesRead) break;
      size += bytesRead;
    }
    const current = await fs.lstat(path);
    requirePrivateFile(current);
    if (
      size > limit ||
      size !== info.size ||
      ["dev", "ino", "size", "mtimeMs", "ctimeMs"].some(
        (key) => current[key] !== info[key],
      )
    )
      fail("Fixture preflight input is oversized or changed while being read.");
    return buffer.subarray(0, size);
  } finally {
    await handle.close();
  }
}

async function requestBytes(path) {
  try {
    return await privateBytes(path, inputLimit);
  } catch (error) {
    if (error instanceof FixtureError) throw error;
    fail(
      "Fixture preflight input file could not be read. Check the input path and permissions.",
    );
  }
}

async function verifyRequest(path, expectedSha256) {
  if (digest(await requestBytes(path)) !== expectedSha256)
    fail(
      "Fixture preflight does not match the current request. Prepare a fresh directory and generation.",
    );
}

function parseJson(bytes, message) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail(message);
  }
}

function runHook(path, sourceRoot, input, signal) {
  checkCancellation(signal);
  const request = JSON.stringify({ schemaVersion: 1, input });
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [path], {
      cwd: sourceRoot,
      env: { PATH: process.env.PATH ?? "", LANG: "C", LC_ALL: "C" },
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    let size = 0;
    let failure;
    function terminate(message) {
      if (failure) return;
      failure = new FixtureError(message);
      try {
        if (process.platform === "win32") child.kill();
        else if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        // The child may already have exited.
      }
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
    }
    const timer = setTimeout(
      () => terminate("Fixture preflight hook exceeded its time limit."),
      hookTimeoutMs,
    );
    const onAbort = () => terminate(cancelled);
    signal?.addEventListener("abort", onAbort, { once: true });
    function collect(chunk, keep) {
      size += chunk.length;
      if (size > outputLimit)
        terminate("Fixture preflight hook exceeded its output limit.");
      if (keep && !failure) stdout.push(chunk);
    }
    child.stdout.on("data", (chunk) => collect(chunk, true));
    child.stderr.on("data", (chunk) => collect(chunk, false));
    child.on("error", () =>
      terminate("Fixture preflight hook could not start."),
    );
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (failure) reject(failure);
      else if (code !== 0)
        reject(
          new FixtureError(
            "Fixture preflight hook selector did not accept the fixture.",
          ),
        );
      else done(Buffer.concat(stdout));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(request);
  });
}

async function writePrivate(path, value) {
  const bytes = Buffer.from(JSON.stringify(value) + "\n");
  if (bytes.length > envelopeLimit)
    fail("Fixture preflight serialized file exceeds the size limit.");
  await fs.writeFile(path, bytes, { mode: 0o600, flag: "wx" });
  return digest(bytes);
}

const binding = (settings) => ({
  schemaVersion: 1,
  projectId: settings.projectId,
  generation: settings.generation,
  directory: settings.directory,
  sourceRoot: settings.sourceRoot,
  store: settings.store,
  hook: settings.hook,
  inputPath: settings.input,
});

function matches(value, expected) {
  return (
    object(value) &&
    Object.entries(expected).every(([key, item]) => value[key] === item)
  );
}

export async function prepareNativeFixture(config, { signal } = {}) {
  try {
    checkCancellation(signal);
    const settings = fixtureSettings(config);
    if (!settings) fail("Fixture preflight is not configured.");
    if (!process.getuid || process.umask() & 0o700)
      fail("Fixture preflight requires an umask that preserves owner access.");
    await verifyStorePath(settings.store);
    const hook = join(settings.sourceRoot, settings.hook);
    await localPath(hook, "file");
    const bytes = await requestBytes(settings.input);
    const inputSha256 = digest(bytes);
    const input = parseJson(
      bytes,
      "Fixture preflight input must be valid JSON.",
    );
    try {
      await localPath(dirname(settings.directory), "directory");
      checkCancellation(signal);
      await fs.mkdir(settings.directory, { mode: 0o700 });
    } catch (error) {
      if (error.code === "EEXIST")
        fail(
          "Fixture preflight destination already exists. Use a fresh directory.",
        );
      if (error instanceof FixtureError) throw error;
      fail(
        "Fixture preflight could not reserve the evidence destination. Check the parent directory and permissions.",
      );
    }
    const source = await snapshotRegisteredSource(config.registration);
    const data = parseJson(
      await runHook(hook, settings.sourceRoot, input, signal),
      "Fixture preflight hook must return valid JSON.",
    );
    if (
      !object(data) ||
      data.schemaVersion !== 1 ||
      Object.keys(data).length !== phases.length + 1 ||
      !phases.every((phase) => object(data[phase]))
    )
      fail(
        "Fixture preflight hook must return separate acceptance, health and live JSON objects.",
      );
    const identity = binding(settings);
    const checksums = {};
    for (const phase of phases) {
      checkCancellation(signal);
      const directory = join(settings.directory, phase);
      await fs.mkdir(directory, { mode: 0o700 });
      await fs.mkdir(join(directory, "evidence"), { mode: 0o700 });
      checksums[phase] = await writePrivate(join(directory, "input.json"), {
        ...identity,
        phase,
        input: data[phase],
      });
    }
    const receiptPath = join(settings.directory, "receipt.json");
    const temporary = receiptPath + ".tmp";
    await writePrivate(temporary, {
      ...identity,
      inputSha256,
      sourceSha256: source.sha256,
      registrationSha256: source.registrationSha256,
      checksums,
    });
    if (
      (await snapshotRegisteredSource(config.registration)).sha256 !==
      source.sha256
    )
      fail(
        "Registered fixture source changed during preflight. Prepare a fresh directory and generation.",
      );
    await verifyRequest(settings.input, inputSha256);
    // Publish at a single boundary after the last cancellation check.
    checkCancellation(signal);
    renameSync(temporary, receiptPath);
    return { ok: true, status: "prepared", phases: [...phases] };
  } catch (error) {
    if (error instanceof FixtureError) throw error;
    fail(
      "Fixture preflight could not prepare the private input and destination.",
    );
  }
}

export async function readNativeFixture(config, phase, installation) {
  try {
    const settings = fixtureSettings(config);
    if (!settings) return;
    if (!phases.includes(phase)) fail("Invalid fixture preflight phase.");
    await verifyStorePath(settings.store);
    await privateDirectory(settings.directory);
    const identity = binding(settings);
    const receipt = parseJson(
      await privateBytes(
        join(settings.directory, "receipt.json"),
        envelopeLimit,
      ),
      "Fixture preflight receipt is invalid.",
    );
    if (!matches(receipt, identity))
      fail(
        "Fixture preflight receipt does not match this project and generation.",
      );
    if (
      typeof receipt.sourceSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(receipt.sourceSha256) ||
      receipt.registrationSha256 !==
        registrationFingerprint(config.registration) ||
      (installation && receipt.sourceSha256 !== installation.sourceSha256)
    )
      fail(
        "Fixture preflight does not match the registered installation source. Prepare a fresh generation with the matching source.",
      );
    const directory = join(settings.directory, phase);
    await privateDirectory(directory);
    const bytes = await privateBytes(
      join(directory, "input.json"),
      envelopeLimit,
    );
    if (receipt.checksums?.[phase] !== digest(bytes))
      fail("Fixture preflight phase input does not match its receipt.");
    const data = parseJson(bytes, "Fixture preflight phase input is invalid.");
    if (!matches(data, { ...identity, phase }) || !object(data.input))
      fail("Fixture preflight input does not match this phase and generation.");
    const evidenceDirectory = join(directory, "evidence");
    await privateDirectory(evidenceDirectory);
    await verifyRequest(settings.input, receipt.inputSha256);
    return {
      phase,
      generation: settings.generation,
      input: data.input,
      evidenceDirectory,
    };
  } catch (error) {
    if (error instanceof FixtureError) throw error;
    fail(
      "Fixture preflight phase input or evidence is unavailable. Check the prepared generation and local permissions.",
    );
  }
}
