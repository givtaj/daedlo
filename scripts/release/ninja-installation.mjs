import {
  packageNames,
  releaseFamilies,
  releaseNames,
  runtimeNames,
} from "./names.mjs";
import fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { isDeepStrictEqual } from "node:util";
import { verifyBundle } from "./manifest.mjs";
import { readNativeFixture } from "./native-fixture.mjs";

const runtimePackages = releaseFamilies.map(
  (prefix) => packageNames(prefix).runtime,
);
const enginePackages = releaseFamilies.map(
  (prefix) => packageNames(prefix).engine,
);
const isRuntimeLock = (name) =>
  runtimePackages.some(
    (runtime) =>
      name === `node_modules/${runtime}` ||
      name.startsWith(`node_modules/${runtime}/`),
  );
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const digest = /^[a-f0-9]{64}$/;
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const markerName = ".ninja-installation.json";
const receiptName = "installation.json";
const maxFile = 64 * 1024 * 1024;
const maxSnapshot = 256 * 1024 * 1024;
const fail = (message) => {
  throw Error(message);
};
const same = (a, b, message) => {
  if (!isDeepStrictEqual(a, b)) fail(message);
};
const inside = (a, b) => a === b || b.startsWith(a + sep);
const json = (bytes) => JSON.parse(bytes.toString("utf8"));
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`Invalid ${label}`);
}
function only(value, keys, label) {
  object(value, label);
  if (Object.keys(value).some((key) => !keys.includes(key)))
    fail(`Unsupported ${label} fields`);
}
function localPath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\\") ||
    /[\x00-\x1f\x7f]/.test(value) ||
    isAbsolute(value) ||
    value.split("/").some((p) => !p || p === "." || p === "..")
  )
    fail("Registration paths must be safe relative file paths");
  return value;
}
async function stat(path) {
  try {
    return await fs.lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function checkedPath(path, { missing = false, directory = false } = {}) {
  if (
    typeof path !== "string" ||
    !isAbsolute(path) ||
    path.includes("\0") ||
    path.split(/[\\/]/).includes("..")
  )
    fail("Explicit absolute paths without traversal are required");
  const full = resolve(path),
    parts = full.split(sep).filter(Boolean);
  let current = sep;
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    const info = await stat(current);
    if (!info) {
      if (missing && i === parts.length - 1) return full;
      fail("A required installation path is missing");
    }
    if (info.isSymbolicLink()) fail("Symlink paths are unsupported");
    if (i < parts.length - 1 || directory) {
      if (!info.isDirectory()) fail("Expected a regular directory");
    } else if (!info.isFile() && !info.isDirectory())
      fail("Expected a regular file or directory");
  }
  return full;
}
async function bytes(path, limit = maxFile) {
  await checkedPath(path);
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit)
      fail("Expected a bounded regular file");
    const value = await handle.readFile();
    if (value.length > limit) fail("File exceeds size limit");
    return value;
  } finally {
    await handle.close();
  }
}
async function put(path, value) {
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await fs.writeFile(path, value, { flag: "wx", mode: 0o600 });
}
function registrationValue(value) {
  only(
    value,
    [
      "schemaVersion",
      "projectId",
      "label",
      "sourceRoot",
      "files",
      "model",
      "interfaces",
      "node",
      "rust",
      "hooks",
      "launcher",
      "descriptorSha256",
    ],
    "registration",
  );
  if (
    value.schemaVersion !== 1 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value.projectId ?? "") ||
    (value.label !== undefined &&
      (typeof value.label !== "string" ||
        !value.label.trim() ||
        value.label.length > 120))
  )
    fail("Unsupported registration identity");
  only(
    value.interfaces,
    ["launcher", "nodeAdapter", "rustModel", "protocol", "capabilities"],
    "interfaces",
  );
  for (const key of ["launcher", "nodeAdapter", "rustModel", "protocol"])
    if (value.interfaces[key] !== 1)
      fail("Unsupported registration interface; migration required");
  if (
    typeof value.sourceRoot !== "string" ||
    !isAbsolute(value.sourceRoot) ||
    resolve(value.sourceRoot) !== value.sourceRoot
  )
    fail("Registration sourceRoot must be an absolute normalized path");
  const caps = value.interfaces.capabilities;
  if (
    !Array.isArray(caps) ||
    caps.length > 64 ||
    new Set(caps).size !== caps.length ||
    caps.some(
      (cap) =>
        typeof cap !== "string" ||
        !/^[A-Za-z][A-Za-z0-9._-]{0,79}(?::[1-9][0-9]{0,5})?$/.test(cap),
    )
  )
    fail("Unsupported registration capabilities");
  only(value.model, ["id", "version"], "model");
  for (const name of ["id", "version"])
    if (
      typeof value.model[name] !== "string" ||
      !value.model[name] ||
      value.model[name].length > 256
    )
      fail("Invalid registered model identity");
  if (
    value.descriptorSha256 !== undefined &&
    !digest.test(value.descriptorSha256)
  )
    fail("Invalid descriptor digest");
  if (
    !Array.isArray(value.files) ||
    !value.files.length ||
    value.files.length > 4096 ||
    new Set(value.files).size !== value.files.length
  )
    fail("Registration requires a closed file inventory");
  for (const file of value.files) {
    localPath(file);
    if (
      file
        .split("/")
        .some((part) =>
          ["node_modules", "target", ".git", ".cargo"].includes(part),
        )
    )
      fail(
        "Generated dependencies, Cargo configuration and build outputs cannot be registered source",
      );
  }
  only(value.node, ["packageJson", "packageLock"], "Node registration");
  if (
    value.node.packageJson !== "package.json" ||
    value.node.packageLock !== "package-lock.json"
  )
    fail(
      "Only a standalone Node package at the registered source root is supported",
    );
  only(value.rust, ["manifest", "lock", "binary"], "Rust registration");
  if (
    basename(value.rust.manifest ?? "") !== "Cargo.toml" ||
    value.rust.lock !==
      join(dirname(value.rust.manifest), "Cargo.lock").split(sep).join("/") ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value.rust.binary ?? "")
  )
    fail("Unsupported Rust package registration");
  only(value.hooks, ["acceptance", "health", "preflight"], "hook registration");
  const hooks = [value.hooks.acceptance, value.hooks.health];
  if (Object.hasOwn(value.hooks, "preflight"))
    hooks.push(value.hooks.preflight);
  for (const file of [
    value.node.packageJson,
    value.node.packageLock,
    value.rust.manifest,
    value.rust.lock,
    value.launcher,
    ...hooks,
  ]) {
    localPath(file);
    if (!value.files.includes(file))
      fail(
        "Launcher, manifests, locks and registered hooks must be allowlisted source files",
      );
  }
  if (![value.launcher, ...hooks].every((file) => file.endsWith(".mjs")))
    fail("Managed launcher and hooks require explicit .mjs files");
  return structuredClone(value);
}
export async function snapshotProject(input) {
  const registration = registrationValue(input);
  const root = await checkedPath(registration.sourceRoot, { directory: true });
  let total = 0;
  const files = [];
  for (const file of [...registration.files].sort()) {
    const path = join(root, file),
      content = await bytes(path),
      info = await fs.lstat(path);
    total += content.length;
    if (total > maxSnapshot)
      fail("Registered source snapshot exceeds size limit");
    files.push({
      file,
      bytes: content.length,
      sha256: hash(content),
      mode: info.mode & 0o777,
    });
  }
  const registrationSha256 = hash(JSON.stringify(canonical(registration)));
  return {
    sha256: hash(JSON.stringify({ files, registrationSha256 })),
    registrationSha256,
    files,
  };
}
function safeEnvironment(extra = {}) {
  const env = {};
  for (const key of [
    "PATH",
    "HOME",
    "USERPROFILE",
    "SYSTEMROOT",
    "TMPDIR",
    "TEMP",
    "TMP",
    "RUSTUP_HOME",
    "CARGO_HOME",
  ])
    if (process.env[key]) env[key] = process.env[key];
  return {
    ...env,
    LANG: "C",
    LC_ALL: "C",
    CI: "1",
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
    ...extra,
  };
}
// Inputs are selected by trusted registration, never executable/argument strings from UI requests.
async function run(
  program,
  args,
  { cwd, input, env = {}, timeout = 180000, log } = {},
) {
  const result = await new Promise((done, reject) => {
    const child = spawn(program, args, {
      cwd,
      env: safeEnvironment(env),
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out = [],
      err = [];
    let size = 0,
      failure,
      killTimer;
    const terminate = () => {
      try {
        if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
        else child.kill("SIGTERM");
      } catch {}
    };
    const timer = setTimeout(() => {
      failure = "timed out";
      terminate();
      killTimer = setTimeout(() => {
        try {
          if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch {}
      }, 2000);
    }, timeout);
    const collect = (target) => (chunk) => {
      size += chunk.length;
      if (size > 16 * 1024 * 1024) {
        failure = "exceeded output limit";
        terminate();
      } else target.push(chunk);
    };
    child.stdout.on("data", collect(out));
    child.stderr.on("data", collect(err));
    child.stdin.on("error", () => {});
    child.on("error", (error) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      reject(
        new Error(`Installation tool ${program} could not start`, {
          cause: error,
        }),
      );
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      done({
        stdout: Buffer.concat(out),
        stderr: Buffer.concat(err),
        code,
        signal,
        failure,
      });
    });
    child.stdin.end(input);
  });
  if (log) await put(log, Buffer.concat([result.stdout, result.stderr]));
  if (result.code !== 0 || result.signal || result.failure)
    fail(
      `Installation tool ${basename(program)} ${result.failure || "failed"}; inspect its owned log`,
    );
  return result.stdout;
}
async function preflightSource(registration, contents) {
  const pkg = json(contents.get("package.json")),
    lock = json(contents.get("package-lock.json"));
  if (
    pkg.type !== "module" ||
    pkg.workspaces ||
    pkg.overrides ||
    ![2, 3].includes(lock.lockfileVersion) ||
    !lock.packages ||
    !lock.packages[""]
  )
    fail("Unsupported standalone npm package/lock contract");
  const dependencies = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.optionalDependencies,
  };
  for (const [name, spec] of Object.entries(dependencies)) {
    if (runtimePackages.includes(name)) continue;
    if (
      typeof spec !== "string" ||
      /^(?:workspace:|link:|git|https?:|\/|~\/)/.test(spec)
    )
      fail(
        "Unsupported adapter dependency; use a pinned registry or registered local tarball",
      );
    if (spec.startsWith("file:")) {
      const file = localPath(spec.slice(5).replace(/^\.\//, ""));
      if (!file.endsWith(".tgz") || !registration.files.includes(file))
        fail("Local adapter dependency must be an allowlisted tarball");
    }
  }
  for (const [file, content] of contents) {
    if (
      file.endsWith(".rs") &&
      /\binclude(?:_bytes|_str)?!\s*\(|#\s*\[\s*path\s*=/.test(
        content.toString(),
      )
    )
      fail(
        "Rust source includes outside the supported registered compilation contract",
      );
    if (!/\.(?:mjs|js|cjs)$/.test(file)) continue;
    const source = content.toString("utf8");
    if (runtimePackages.some((name) => source.includes(name)))
      fail(
        "Managed source must use the injected selected runtime; direct runtime bypass is unsupported",
      );
    const parser =
      "import{SourceTextModule}from'node:vm';let s='';for await(const c of process.stdin)s+=c;const m=new SourceTextModule(s);console.log(JSON.stringify(m.dependencySpecifiers));";
    const imports = json(
      await run(
        process.execPath,
        ["--experimental-vm-modules", "--input-type=module", "-e", parser],
        { cwd: registration.sourceRoot, input: source, timeout: 10000 },
      ),
    );
    if (
      ![registration.hooks.acceptance, registration.hooks.health].includes(
        file,
      ) &&
      /\b(?:import|require|eval)\s*\(|\bnew\s+Function\s*\(/.test(source)
    )
      fail(
        "Dynamic code loading is unsupported in the managed launcher/adapter closure",
      );
    for (const spec of imports) {
      if (spec.startsWith("node:")) continue;
      if (spec.startsWith(".")) {
        const target = relative(
          registration.sourceRoot,
          resolve(registration.sourceRoot, dirname(file), spec),
        )
          .split(sep)
          .join("/");
        if (!registration.files.includes(target))
          fail("Managed source import escapes its registered file closure");
      } else if (
        spec.startsWith("/") ||
        spec.includes(":") ||
        !Object.hasOwn(
          dependencies,
          spec.startsWith("@")
            ? spec.split("/").slice(0, 2).join("/")
            : spec.split("/")[0],
        )
      )
        fail("Managed source imports an unsupported external dependency");
    }
    if (
      file === registration.launcher &&
      (!/export\s+(?:async\s+)?function\s+createManagedLaunch\s*\(/.test(
        source,
      ) ||
        /\b(?:createProject|createSession|require|eval)\s*\(/.test(source) ||
        /\bimport\s*\(/.test(source))
    )
      fail(
        "Unsupported managed launcher; ordinary factories and runtime bypasses cannot enroll",
      );
  }
  return { pkg, lock };
}
// Read-only registration preflight. It parses authored modules without evaluating them.
export async function validateRegistration(input) {
  const registration = registrationValue(input);
  const snapshot = await snapshotProject(registration),
    contents = new Map();
  for (const entry of snapshot.files)
    contents.set(
      entry.file,
      await bytes(join(registration.sourceRoot, entry.file)),
    );
  await preflightSource(registration, contents);
  overlayCargo(
    contents.get(registration.rust.manifest).toString(),
    join(registration.sourceRoot, ".unselected-engine"),
    "0.0.0",
    registration,
  );
  await assertSource(registration, snapshot);
  return registration;
}

const octalMode = (mode) => mode.toString(8).padStart(4, "0");

export function installationUmask() {
  const mask = process.platform === "win32" ? 0 : process.umask();
  if (mask & 0o700)
    fail(
      `Installation umask ${octalMode(mask)} removes owner access needed to create, read, and execute files in a private slot.`,
    );
  return mask;
}

async function extractArchive(
  archive,
  prefix,
  destination,
  artifact,
  log,
  mask,
) {
  if (archive.length !== artifact.bytes || hash(archive) !== artifact.sha256)
    fail("Candidate archive integrity changed");
  const script = `import base64,io,json,sys,tarfile\np=json.load(sys.stdin); root=p['prefix']; files=[]; seen=set(); total=0\nwith tarfile.open(fileobj=io.BytesIO(base64.b64decode(p['archive'])),mode='r:gz') as tar:\n for entry in tar:\n  n=entry.name.rstrip('/') if entry.isdir() else entry.name\n  if not n or '\\\\' in n or n.startswith('/') or any(ord(c)<32 or ord(c)==127 for c in n) or any(c in ('','.','..') for c in n.split('/')) or (n!=root and not n.startswith(root+'/')) or n in seen: raise ValueError('Unsafe archive path: '+repr(n))\n  seen.add(n)\n  if len(seen)>4096: raise ValueError('Too many archive entries')\n  if entry.isdir(): continue\n  if not entry.isfile() or n==root or entry.size<0: raise ValueError('Only regular archive files supported')\n  total+=entry.size\n  if total>67108864: raise ValueError('Archive expansion exceeds bound')\n  data=tar.extractfile(entry).read()\n  if len(data)!=entry.size: raise ValueError('Truncated archive')\n  files.append({'file':n[len(root)+1:],'mode':entry.mode&511,'data':base64.b64encode(data).decode()})\nprint(json.dumps(files))`;
  const files = json(
    await run("python3", ["-c", script], {
      cwd: dirname(destination),
      input: JSON.stringify({ prefix, archive: archive.toString("base64") }),
      log,
    }),
  );
  const archiveFiles = new Map();
  for (const file of files) {
    const path = join(destination, localPath(file.file));
    const content = Buffer.from(file.data, "base64");
    await put(path, content);
    archiveFiles.set(file.file, {
      mode: file.mode,
      bytes: content.length,
      sha256: hash(content),
    });
    await fs.chmod(path, file.mode & ~mask);
  }
  return archiveFiles;
}
async function inventory(root, runtimeLabel) {
  const files = [];
  let total = 0;
  async function visit(directory) {
    for (const name of (await fs.readdir(directory)).sort()) {
      const path = join(directory, name),
        info = await fs.lstat(path),
        file = relative(root, path).split(sep).join("/");
      if (info.isSymbolicLink())
        fail("Installation inventory contains a symlink");
      if (info.isDirectory()) await visit(path);
      else {
        if (!info.isFile())
          fail("Installation inventory contains a nonregular file");
        const content = await bytes(path).catch((error) => {
          if (runtimeLabel && ["EPERM", "EACCES"].includes(error.code))
            throw Error(
              `${runtimeLabel} runtime file ${file} cannot be read (mode ${octalMode(info.mode & 0o777)}).`,
              { cause: error },
            );
          throw error;
        });
        total += content.length;
        if (total > 1024 * 1024 * 1024 || files.length > 50000)
          fail("Installation inventory exceeds limits");
        files.push({
          file,
          bytes: content.length,
          sha256: hash(content),
          mode: info.mode & 0o777,
        });
      }
    }
  }
  await visit(root);
  return { files, sha256: hash(JSON.stringify(files)) };
}
// npm applies the process umask during extraction and may retain masked execute
// bits on declared binaries. Compare signed file identities and only remove
// permissions. The resulting exact modes are sealed for subsequent verification.
async function verifyRuntimeFiles(
  installedRoot,
  extractedRoot,
  archiveFiles,
  mask,
) {
  const installed = await inventory(installedRoot, "Installed");
  const extracted = await inventory(extractedRoot, "Extracted reference");
  if (extracted.files.length !== archiveFiles.size)
    fail(
      "Extracted reference runtime file list differs from the signed archive.",
    );
  if (installed.files.length !== archiveFiles.size)
    fail("Installed runtime file list differs from the signed archive.");
  for (const [index, reference] of extracted.files.entries()) {
    const signed = archiveFiles.get(reference.file);
    if (!signed)
      fail(
        "Extracted reference runtime file list differs from the signed archive.",
      );
    if (reference.bytes !== signed.bytes || reference.sha256 !== signed.sha256)
      fail(
        `Extracted reference runtime content mismatch for ${reference.file}.`,
      );
    const actual = installed.files[index];
    if (actual.file !== reference.file)
      fail("Installed runtime file list differs from the signed archive.");
    if (actual.bytes !== signed.bytes || actual.sha256 !== signed.sha256)
      fail(`Installed runtime content mismatch for ${actual.file}.`);
    // Windows exposes a reduced set of permission bits through stat/chmod.
    // Keep comparing the installed file with the archive as extracted there.
    const expected =
      process.platform === "win32" ? reference.mode : signed.mode & ~mask;
    const possible = process.platform === "win32" ? expected : signed.mode;
    if (reference.mode !== expected)
      fail(
        `Extracted reference runtime mode mismatch for ${reference.file}: expected ${octalMode(expected)}, found ${octalMode(reference.mode)}.`,
      );
    if (
      (actual.mode & ~possible) !== 0 ||
      (actual.mode & expected) !== expected
    )
      fail(
        `Installed runtime mode mismatch for ${actual.file}: expected ${octalMode(expected)} (archive ${octalMode(signed.mode)}), found ${octalMode(actual.mode)}.`,
      );
    if (actual.mode !== expected) {
      const file = await fs.open(
        join(installedRoot, actual.file),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        if (((await file.stat()).mode & 0o777) !== actual.mode)
          fail(
            `Installed runtime mode changed during verification for ${actual.file}.`,
          );
        await file.chmod(expected);
      } finally {
        await file.close();
      }
    }
  }
}

export async function checkPlaywrightCache(path) {
  try {
    if (
      typeof path !== "string" ||
      !isAbsolute(path) ||
      /[\x00-\x1f\x7f]/.test(path)
    )
      throw Error("Invalid path");
    const resolved = await fs.realpath(path);
    await checkedPath(resolved, { directory: true });
    await fs.access(resolved, constants.R_OK | constants.X_OK);
    return resolved;
  } catch {
    fail(
      "The configured Playwright browser cache must resolve to an existing, readable and searchable directory. Supply its absolute path.",
    );
  }
}

// Run in a separate process with the same module and environment resolution as
// first acceptance. This is a diagnostic for Chromium. Custom hooks can select
// another browser, whose measured identity is established by actual acceptance.
async function recordPlaywrightResolution(
  path,
  runtimePath,
  playwrightBrowsersPath,
) {
  const script = `
    const fs = require("node:fs");
    const load = require("node:module").createRequire(process.argv[1]);
    let executablePath = null, accessible = false;
    try {
      executablePath = load("playwright").chromium.executablePath();
      fs.accessSync(executablePath, fs.constants.R_OK | fs.constants.X_OK);
      accessible = fs.statSync(executablePath).isFile();
    } catch {}
    process.stdout.write(JSON.stringify({browser:"chromium",cache:process.env.PLAYWRIGHT_BROWSERS_PATH ?? null,executablePath,accessible}));
  `;
  const output = await run(process.execPath, ["-e", script, runtimePath], {
    cwd: join(path, "project"),
    env: playwrightBrowsersPath
      ? { PLAYWRIGHT_BROWSERS_PATH: playwrightBrowsersPath }
      : {},
    timeout: 10000,
  });
  await put(join(path, "logs/playwright-browser.json"), output);
}

async function sealedInventory(path) {
  const sections = {};
  for (const section of ["snapshot", "project", "dependencies", "bin"])
    sections[section] = await inventory(join(path, section));
  const metadata = {};
  for (const file of ["registration.json", "release.json"])
    metadata[file] = hash(await bytes(join(path, file)));
  return {
    sections,
    metadata,
    sha256: hash(JSON.stringify({ sections, metadata })),
  };
}
function overlayCargo(source, cratePath, version, registration, engineName) {
  if (
    /^\s*\[(?:workspace\.|patch|replace)|\bworkspace\s*=\s*true|\bgit\s*=/m.test(
      source,
    )
  )
    fail("Unsupported Cargo workspace or source override; migration required");
  let section = "",
    count = 0;
  const lines = source.split(/\r?\n/).map((line) => {
    const heading = line.match(/^\s*\[\[?([^\]]+)\]\]?\s*(?:#.*)?$/);
    if (heading) section = heading[1];
    if (/^\s*(?:browser-driver-engine|daedlo-engine)\s*=/.test(line)) {
      if (
        section !== "dependencies" ||
        !/^\s*(?:browser-driver-engine|daedlo-engine)\s*=\s*(?:\{[^{}\n]+\}|"[^"\n]+")\s*(?:#.*)?$/.test(
          line,
        )
      )
        fail("Unsupported engine dependency declaration");
      count++;
      const dependency = line.match(/^\s*([a-z-]+)\s*=/)[1];
      const selected = engineName ?? dependency;
      const alias =
        dependency === selected
          ? ""
          : `package = ${JSON.stringify(selected)}, `;
      return `${dependency} = { ${alias}path = ${JSON.stringify(cratePath)}, version = "=${version}" }`;
    }
    if (/dependencies/.test(section) && /\bpath\s*=/.test(line))
      fail(
        "Additional Cargo path dependencies require an explicit supported build contract",
      );
    if (/^\s*(?:path|build)\s*=/.test(line)) {
      const file = line.match(
        /^\s*(?:path|build)\s*=\s*"([^"\n]+)"\s*(?:#.*)?$/,
      )?.[1];
      if (!file) fail("Unsupported Cargo source path declaration");
      try {
        localPath(file);
      } catch {
        fail(
          "Unsupported Cargo source path; a relative registered file is required",
        );
      }
      const registered = join(dirname(registration.rust.manifest), file)
        .split(sep)
        .join("/");
      if (!registration.files.includes(registered))
        fail("Cargo source path escapes the registered closure");
    }
    return line;
  });
  if (count !== 1) fail("Exactly one direct engine dependency is required");
  if (!/^\s*\[workspace\]\s*$/m.test(source)) lines.push("", "[workspace]", "");
  return lines.join("\n");
}
function lockedPackages(content) {
  return content
    .toString()
    .split(/^\[\[package\]\]\s*$/m)
    .slice(1)
    .map((part) =>
      Object.fromEntries(
        ["name", "version", "source", "checksum"].map((key) => [
          key,
          part.match(new RegExp(`^${key} = "([^"\\n]+)"`, "m"))?.[1] ?? null,
        ]),
      ),
    );
}
async function assertSource(registration, expected) {
  same(
    await snapshotProject(registration),
    expected,
    "Registered source changed; installation plan is stale",
  );
}
async function helloEngine(enginePath, registration, cwd, log) {
  const reply = json(
    await run(enginePath, [], {
      cwd,
      input:
        JSON.stringify({ protocol: 1, id: "ninja-hello", op: "hello" }) + "\n",
      timeout: 10000,
      log,
    }),
  );
  if (
    reply.protocol !== 1 ||
    reply.id !== "ninja-hello" ||
    reply.ok !== true ||
    !reply.descriptor
  )
    fail("Compiled engine handshake failed");
  same(
    { id: reply.descriptor.id, version: reply.descriptor.version },
    registration.model,
    "Compiled engine model identity does not match registration",
  );
  for (const list of ["states", "commands", "recipes"])
    if (!Array.isArray(reply.descriptor[list]))
      fail("Compiled engine descriptor is incomplete");
  for (const capability of registration.interfaces.capabilities) {
    const [name, version = "1"] = capability.split(":");
    if (reply.capabilities?.[name] !== Number(version))
      fail("Compiled engine lacks a required capability");
  }
  const descriptorSha256 = hash(JSON.stringify(reply.descriptor));
  if (
    registration.descriptorSha256 &&
    descriptorSha256 !== registration.descriptorSha256
  )
    fail("Compiled customer descriptor changed");
  return {
    descriptor: reply.descriptor,
    descriptorSha256,
    capabilities: reply.capabilities ?? {},
  };
}
/** Binds the external executable, not its linked browser framework/cache contents. */
export async function verifyBrowserIdentity(value) {
  let handle;
  try {
    only(value, ["version", "executablePath", "sha256"], "browser identity");
    if (
      typeof value.version !== "string" ||
      !value.version.trim() ||
      value.version.length > 160 ||
      !digest.test(value.sha256 ?? "")
    )
      fail("Invalid browser identity");
    const path = await checkedPath(value.executablePath);
    if (path !== value.executablePath)
      fail("Browser executable must use a normalized absolute path");
    handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.size < 1n ||
      before.size > 512n * 1024n * 1024n ||
      (process.platform !== "win32" && (before.mode & 0o111n) === 0n)
    )
      fail("Unsupported browser executable");
    const measured = createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false }))
      measured.update(chunk);
    const after = await handle.stat({ bigint: true }),
      current = await fs.lstat(path, { bigint: true });
    for (const field of ["dev", "ino", "size", "mtimeNs", "ctimeNs"])
      if (before[field] !== after[field] || before[field] !== current[field])
        fail("Browser executable changed during verification");
    if (current.isSymbolicLink() || measured.digest("hex") !== value.sha256)
      fail("Browser executable bytes changed");
    return structuredClone(value);
  } catch (cause) {
    const error = new Error(
      "External browser executable is missing, changed or unsupported; retain the previous browser cache and review recovery.",
      { cause },
    );
    error.code = "browser_changed";
    throw error;
  } finally {
    await handle?.close();
  }
}

function validateHookOutput(output, phase, receipt) {
  if (
    output?.schemaVersion !== 1 ||
    output.accepted !== true ||
    output.isolated !== true ||
    !Number.isSafeInteger(output.tests) ||
    output.tests < 1 ||
    output.failed !== 0 ||
    (phase === "health" && output.ready !== true)
  )
    fail(`Registered ${phase} hook did not establish accepted isolated checks`);
  same(output.model, receipt.model, "Hook model identity mismatch");
  if (
    output.runtimePath !== receipt.runtimePath ||
    output.enginePath !== receipt.enginePath
  )
    fail("Hook selected another runtime or engine");
  if (receipt.browser)
    same(
      output.browser,
      receipt.browser,
      "Registered hook browser identity changed",
    );
}

async function hookRun(
  receipt,
  phase,
  registration,
  { timeout = 180000, fixtureConfig } = {},
) {
  if (!["acceptance", "health"].includes(phase))
    fail("Unsupported installation hook");
  const fixture = await readNativeFixture(
    { ...fixtureConfig, registration },
    phase,
  );
  const mutable = join(receipt.path, "checks");
  await fs.mkdir(mutable, { recursive: true, mode: 0o700 });
  const fixturePath = await fs.mkdtemp(join(mutable, phase + "-"));
  const before = await sealedInventory(receipt.path);
  let output;
  try {
    output = json(
      await run(
        process.execPath,
        [join(receipt.sourcePath, registration.hooks[phase])],
        {
          cwd: receipt.sourcePath,
          env: receipt.playwrightBrowsersPath
            ? { PLAYWRIGHT_BROWSERS_PATH: receipt.playwrightBrowsersPath }
            : {},
          input: JSON.stringify({
            schemaVersion: 1,
            phase,
            installation: receipt,
            fixturePath,
            ...(fixture ? { fixture } : {}),
          }),
          timeout,
          ...(fixture ? {} : { log: join(fixturePath, "hook.log") }),
        },
      ).catch((error) => {
        if (!fixture)
          error.message += `. See checks/${basename(fixturePath)}/hook.log and, for Playwright, logs/playwright-browser.json inside the private installation.`;
        throw error;
      }),
    );
    validateHookOutput(output, phase, receipt);
    await verifyBrowserIdentity(output.browser);
  } catch (error) {
    if (!fixture || error.code === "browser_changed") throw error;
    fail(
      `Registered ${phase} hook failed or did not return an accepted receipt. Inspect its private fixture evidence.`,
    );
  } finally {
    same(
      await sealedInventory(receipt.path),
      before,
      "Installation changed during registered hook",
    );
  }
  return fixture
    ? {
        schemaVersion: 1,
        accepted: true,
        isolated: true,
        tests: output.tests,
        failed: 0,
        runtimePath: receipt.runtimePath,
        enginePath: receipt.enginePath,
        model: receipt.model,
        browser: output.browser,
        ...(phase === "health" ? { ready: true } : {}),
      }
    : output;
}

export async function prepareInstallation({
  registration: input,
  verifiedKit,
  destination,
  npmCache,
  cargoHome,
  playwrightBrowsersPath,
  offline = true,
  fixtureConfig,
} = {}) {
  const mask = installationUmask();
  const registration = registrationValue(input);
  await readNativeFixture({ ...fixtureConfig, registration }, "acceptance");
  await readNativeFixture({ ...fixtureConfig, registration }, "health");
  if (playwrightBrowsersPath !== undefined)
    playwrightBrowsersPath = await checkPlaywrightCache(playwrightBrowsersPath);
  if (
    !digest.test(verifiedKit?.identity?.manifestSha256 ?? "") ||
    typeof verifiedKit?.identity?.version !== "string"
  )
    fail(
      "Installation requires a trusted verified manifest digest and version identity",
    );
  const source = await snapshotProject(registration);
  const path = await checkedPath(destination, { missing: true });
  if (
    inside(registration.sourceRoot, path) ||
    inside(path, registration.sourceRoot) ||
    inside(verifiedKit?.bundlePath ?? "", path) ||
    inside(path, verifiedKit?.bundlePath ?? "")
  )
    fail(
      "Installation, source and bundle must be separate non-nested directories",
    );
  if (await stat(path)) fail("Installation destination must be fresh");
  const contracts = verifiedKit?.identity?.contracts;
  if (!contracts || ![1, 2].includes(contracts.manager))
    fail("Verified kit lacks supported manager contracts");
  for (const key of ["launcher", "nodeAdapter", "rustModel", "protocol"])
    if (contracts[key] !== registration.interfaces[key])
      fail("Candidate interface contract requires migration");
  if (
    !Array.isArray(contracts.capabilities) ||
    registration.interfaces.capabilities.some(
      (cap) => !contracts.capabilities.includes(cap),
    )
  )
    fail("Candidate lacks registered interface capabilities");
  const contents = new Map();
  for (const entry of source.files) {
    const content = await bytes(join(registration.sourceRoot, entry.file));
    if (hash(content) !== entry.sha256) fail("Source changed before snapshot");
    contents.set(entry.file, content);
  }
  const { pkg, lock } = await preflightSource(registration, contents);
  const rustVersion = (
    await run("rustc", ["--version"], { cwd: dirname(path), timeout: 10000 })
  )
    .toString()
    .match(/^rustc (\S+)/)?.[1];
  const environment = {
    nodeVersion: process.versions.node,
    rustVersion,
    protocol: 1,
  };
  const verified = await verifyBundle(verifiedKit.bundlePath, {
    expectedManifestSha256: verifiedKit.identity.manifestSha256,
    environment,
  });
  if (
    verified.manifest.source.dirty ||
    verified.manifest.version !== verifiedKit.identity.version
  )
    fail("Verified candidate source/version identity mismatch");
  const version = verified.manifest.version,
    names = releaseNames(verified.manifest.artifacts),
    archives = {};
  for (const [kind, artifact] of Object.entries(verified.manifest.artifacts)) {
    archives[kind] = await bytes(join(verifiedKit.bundlePath, artifact.file));
    if (hash(archives[kind]) !== artifact.sha256)
      fail("Candidate archive changed");
  }
  const cargoManifest = overlayCargo(
    contents.get(registration.rust.manifest).toString(),
    join(path, "dependencies", "engine"),
    version,
    registration,
    names.engine,
  );
  await assertSource(registration, source);
  await fs.mkdir(path, { mode: 0o700 });
  const owner = await fs.lstat(path),
    nonce = randomUUID();
  await put(
    join(path, markerName),
    JSON.stringify({
      schemaVersion: 1,
      kind: "ninja-project-installation",
      nonce,
      projectId: registration.projectId,
    }),
  );
  try {
    for (const dir of [
      "snapshot",
      "project",
      "dependencies",
      "bin",
      "logs",
      ".work",
    ])
      await fs.mkdir(join(path, dir));
    await put(
      join(path, "registration.json"),
      JSON.stringify(registration, null, 2) + "\n",
    );
    await put(
      join(path, "release.json"),
      JSON.stringify(verifiedKit.identity, null, 2) + "\n",
    );
    for (const entry of source.files)
      for (const section of ["snapshot", "project"]) {
        const file = join(path, section, entry.file);
        await put(file, contents.get(entry.file));
        await fs.chmod(file, entry.mode);
      }
    let signedRuntime;
    for (const [kind, prefix] of [
      ["runtime", "package"],
      ["engine", `${names.engine}-${version}`],
    ]) {
      const entries = await extractArchive(
        archives[kind],
        prefix,
        join(path, "dependencies", kind),
        verified.manifest.artifacts[kind],
        join(path, "logs", `extract-${kind}.log`),
        mask,
      );
      if (kind === "runtime") signedRuntime = entries;
    }
    const runtimePackage = json(
      await bytes(join(path, "dependencies/runtime/package.json")),
    );
    if (
      runtimePackage.name !== names.runtime ||
      runtimePackage.version !== version ||
      runtimePackage.type !== "module"
    )
      fail("Candidate runtime package identity mismatch");
    const entry =
      typeof runtimePackage.exports === "string"
        ? runtimePackage.exports
        : typeof runtimePackage.exports?.["."] === "string"
          ? runtimePackage.exports["."]
          : runtimePackage.exports?.["."]?.import;
    if (typeof entry !== "string" || !entry.startsWith("./"))
      fail("Unsupported runtime module entrypoint");
    const runtimeEntry = localPath(entry.slice(2));
    const runtimeTarball = join(
      path,
      "dependencies",
      verified.manifest.artifacts.runtime.file,
    );
    await put(runtimeTarball, archives.runtime);
    const generatedPackage = structuredClone(pkg);
    for (const group of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
    ])
      if (generatedPackage[group])
        for (const runtime of runtimePackages)
          delete generatedPackage[group][runtime];
    generatedPackage.dependencies = {
      ...generatedPackage.dependencies,
      [names.runtime]: `file:${runtimeTarball}`,
    };
    await fs.writeFile(
      join(path, "project/package.json"),
      JSON.stringify(generatedPackage, null, 2) + "\n",
    );
    const args = [
      "install",
      "--prefix",
      join(path, "project"),
      "--workspaces=false",
      "--ignore-scripts",
      "--bin-links=false",
      "--no-audit",
      "--no-fund",
      "--cache",
      npmCache ?? join(path, ".work/npm-cache"),
    ];
    if (offline) args.push("--offline");
    await run("npm", args, {
      cwd: join(path, "project"),
      log: join(path, "logs/npm-install.log"),
    });
    const installedLock = json(
      await bytes(join(path, "project/package-lock.json")),
    );
    for (const [name, record] of Object.entries(lock.packages))
      if (name && !isRuntimeLock(name)) {
        const actual = installedLock.packages?.[name];
        if (
          !actual ||
          ["version", "integrity", "resolved"].some(
            (field) => actual[field] !== record[field],
          )
        )
          fail("Existing adapter dependency lock changed; migration required");
      }
    const runtimeRoot = join(path, "project/node_modules", names.runtime);
    await verifyRuntimeFiles(
      runtimeRoot,
      join(path, "dependencies/runtime"),
      signedRuntime,
      mask,
    );
    if (playwrightBrowsersPath) {
      await put(
        join(path, "dependencies/playwright-cache.json"),
        JSON.stringify(playwrightBrowsersPath),
      );
    }
    if (playwrightBrowsersPath || runtimePackage.dependencies?.playwright)
      await recordPlaywrightResolution(
        path,
        join(runtimeRoot, runtimeEntry),
        playwrightBrowsersPath,
      );
    await fs.writeFile(
      join(path, "project", registration.rust.manifest),
      cargoManifest,
    );
    const cargoEnv = {
      ...(cargoHome ? { CARGO_HOME: cargoHome } : {}),
      CARGO_TARGET_DIR: join(path, ".work/target"),
    };
    const cargoArgs = [
      "--manifest-path",
      join(path, "project", registration.rust.manifest),
      ...(offline ? ["--offline"] : []),
    ];
    const metadata = json(
      await run("cargo", ["metadata", ...cargoArgs, "--format-version", "1"], {
        cwd: path,
        env: cargoEnv,
        log: join(path, "logs/cargo-metadata.log"),
      }),
    );
    const engines = metadata.packages.filter((p) =>
      enginePackages.includes(p.name),
    );
    if (
      engines.length !== 1 ||
      engines[0].name !== names.engine ||
      engines[0].version !== version ||
      engines[0].manifest_path !== join(path, "dependencies/engine/Cargo.toml")
    )
      fail("Cargo resolved an engine outside the selected candidate");
    for (const pkg of metadata.packages)
      if (pkg.source === null) {
        if (
          !inside(join(path, "project"), pkg.manifest_path) &&
          !inside(join(path, "dependencies/engine"), pkg.manifest_path)
        )
          fail("Cargo package source escapes the registered installation");
        for (const target of pkg.targets)
          if (!inside(dirname(pkg.manifest_path), target.src_path))
            fail("Cargo target source escapes its registered package closure");
      }
    await run(
      "cargo",
      ["build", ...cargoArgs, "--locked", "--bin", registration.rust.binary],
      { cwd: path, env: cargoEnv, log: join(path, "logs/cargo-build.log") },
    );
    const candidateLock = await bytes(
      join(path, "project", registration.rust.lock),
    );
    const originalPackages = lockedPackages(
        contents.get(registration.rust.lock),
      ),
      candidatePackages = lockedPackages(candidateLock);
    for (const original of originalPackages)
      if (
        !enginePackages.includes(original.name) &&
        !candidatePackages.some((candidate) =>
          isDeepStrictEqual(candidate, original),
        )
      )
        fail("Existing customer Cargo dependency changed; migration required");
    await run("cargo", ["test", ...cargoArgs, "--locked"], {
      cwd: path,
      env: cargoEnv,
      log: join(path, "logs/cargo-test.log"),
    });
    const enginePath = join(
      path,
      "bin",
      registration.rust.binary + (process.platform === "win32" ? ".exe" : ""),
    );
    await fs.copyFile(
      join(path, ".work/target/debug", basename(enginePath)),
      enginePath,
      constants.COPYFILE_EXCL,
    );
    await fs.chmod(enginePath, 0o700);
    const handshake = await helloEngine(
      enginePath,
      registration,
      path,
      join(path, "logs/engine-hello.log"),
    );
    for (const entry of source.files)
      if (
        ![
          registration.node.packageJson,
          registration.node.packageLock,
          registration.rust.manifest,
          registration.rust.lock,
        ].includes(entry.file)
      )
        if (
          hash(await bytes(join(path, "project", entry.file))) !== entry.sha256
        )
          fail("Build changed authored project source");
    const receipt = {
      schemaVersion: 1,
      kind: "ninja-installation",
      id: basename(path),
      projectId: registration.projectId,
      version,
      path,
      sourcePath: join(path, "project"),
      snapshotPath: join(path, "snapshot"),
      runtimePackage: names.runtime,
      ...(playwrightBrowsersPath ? { playwrightBrowsersPath } : {}),
      runtimePath: join(
        path,
        "project/node_modules",
        names.runtime,
        runtimeEntry,
      ),
      enginePath,
      launcherPath: join(path, "project", registration.launcher),
      sourceSha256: source.sha256,
      source,
      model: registration.model,
      interfaces: registration.interfaces,
      release: verifiedKit.identity,
      environment,
      handshake,
      createdAt: new Date().toISOString(),
      ownerNonce: nonce,
    };
    receipt.acceptance = await hookRun(receipt, "acceptance", registration, {
      fixtureConfig,
    });
    receipt.browser = structuredClone(receipt.acceptance.browser);
    receipt.browserDependency =
      "External executable and observed version; browser cache/framework contents are not bundled.";
    await assertSource(registration, source);
    receipt.health = await hookRun(receipt, "health", registration, {
      fixtureConfig,
    });
    await assertSource(registration, source);
    const sealed = await sealedInventory(path);
    receipt.inventory = sealed;
    receipt.inventorySha256 = sealed.sha256;
    const currentOwner = await fs.lstat(path);
    if (
      currentOwner.dev !== owner.dev ||
      currentOwner.ino !== owner.ino ||
      currentOwner.isSymbolicLink()
    )
      fail("Installation directory ownership changed");
    await put(join(path, receiptName), JSON.stringify(receipt, null, 2) + "\n");
    return await verifyInstallation(path, { registration });
  } catch (error) {
    // Preserve exact build/cleanup evidence. This slot is never selectable without a valid receipt.
    error.retainedOwnedDirectories = [path];
    throw error;
  }
}
async function readOwnedReceipt(input) {
  const path = await checkedPath(
    typeof input === "string" ? input : input?.path,
    { directory: true },
  );
  const receipt = json(await bytes(join(path, receiptName))),
    owner = json(await bytes(join(path, markerName)));
  if (
    receipt.schemaVersion !== 1 ||
    receipt.kind !== "ninja-installation" ||
    receipt.path !== path ||
    receipt.id !== basename(path) ||
    !digest.test(receipt.inventorySha256 ?? "") ||
    owner.kind !== "ninja-project-installation" ||
    owner.projectId !== receipt.projectId ||
    owner.nonce !== receipt.ownerNonce
  )
    fail("Invalid installation receipt or ownership");
  if (typeof input !== "string")
    same(input, receipt, "Installation receipt changed");
  return receipt;
}

// Status displays the recorded identity. Launch and activation still verify all sealed bytes.
export async function readInstallationIdentity(path, { registration }) {
  const receipt = await readOwnedReceipt(path);
  if (
    receipt.projectId !== registration.projectId ||
    typeof receipt.version !== "string" ||
    !receipt.version ||
    receipt.version !== receipt.release?.version ||
    !digest.test(receipt.sourceSha256 ?? "") ||
    receipt.sourceSha256 !== receipt.source?.sha256
  )
    fail("Invalid recorded installation identity");
  const { id, version, sourceSha256 } = receipt;
  return { id, version, sourceSha256 };
}

export async function verifyInstallation(
  input,
  { registration: supplied, checkSource = true } = {},
) {
  const receipt = await readOwnedReceipt(input);
  const path = receipt.path;
  const registration = registrationValue(
    json(await bytes(join(path, "registration.json"))),
  );
  if (supplied) {
    const expected = registrationValue(supplied);
    if (expected.projectId !== registration.projectId)
      fail("Historical installation belongs to another registered project");
    if (checkSource)
      same(
        expected,
        registration,
        "Registration changed; installation plan is stale",
      );
  }
  const actual = await sealedInventory(path);
  same(actual, receipt.inventory, "Installation inventory integrity changed");
  if (actual.sha256 !== receipt.inventorySha256)
    fail("Installation inventory digest mismatch");
  const cacheRecord = join(path, "dependencies/playwright-cache.json");
  const selectedCache = (await stat(cacheRecord))
    ? json(await bytes(cacheRecord))
    : undefined;
  if (receipt.playwrightBrowsersPath !== selectedCache)
    fail("Installation Playwright cache selection changed");
  const release = json(await bytes(join(path, "release.json")));
  same(release, receipt.release, "Installation release identity changed");
  const selectedRuntime = runtimePackages.find((name) =>
    receipt.runtimePath?.startsWith(
      join(path, "project/node_modules", name) + sep,
    ),
  );
  if (!selectedRuntime) fail("Invalid installed runtime path");
  const names = runtimeNames(selectedRuntime);
  const pkg = json(
    await bytes(
      join(path, "project/node_modules", names.runtime, "package.json"),
    ),
  );
  const entry =
    typeof pkg.exports === "string"
      ? pkg.exports
      : typeof pkg.exports?.["."] === "string"
        ? pkg.exports["."]
        : pkg.exports?.["."]?.import;
  if (typeof entry !== "string" || !entry.startsWith("./"))
    fail("Invalid installed runtime path");
  const expectedPaths = {
    sourcePath: join(path, "project"),
    snapshotPath: join(path, "snapshot"),
    runtimePath: join(
      path,
      "project/node_modules",
      names.runtime,
      localPath(entry.slice(2)),
    ),
    enginePath: join(
      path,
      "bin",
      registration.rust.binary + (process.platform === "win32" ? ".exe" : ""),
    ),
    launcherPath: join(path, "project", registration.launcher),
  };
  for (const [key, expected] of Object.entries(expectedPaths))
    if (receipt[key] !== expected)
      fail("Installation launch tuple path changed");
  if (
    receipt.version !== release.version ||
    pkg.version !== receipt.version ||
    pkg.name !== names.runtime ||
    (receipt.runtimePackage ?? "@browser-driver/runtime") !== pkg.name ||
    receipt.projectId !== registration.projectId
  )
    fail("Installation identity changed");
  same(
    receipt.model,
    registration.model,
    "Installation model identity changed",
  );
  same(
    receipt.interfaces,
    registration.interfaces,
    "Installation interface identity changed",
  );
  same(
    actual.sections.snapshot.files,
    receipt.source?.files,
    "Installation snapshot identity changed",
  );
  const registrationSha256 = hash(JSON.stringify(canonical(registration)));
  if (
    receipt.source?.registrationSha256 !== registrationSha256 ||
    receipt.sourceSha256 !==
      hash(JSON.stringify({ files: receipt.source.files, registrationSha256 }))
  )
    fail("Installation source identity changed");
  if (checkSource) await assertSource(registration, receipt.source);
  if (receipt.sourceSha256 !== receipt.source?.sha256)
    fail("Installation source identity changed");
  validateHookOutput(receipt.acceptance, "acceptance", receipt);
  validateHookOutput(receipt.health, "health", receipt);
  for (const name of [
    "runtimePath",
    "enginePath",
    "launcherPath",
    "sourcePath",
    "snapshotPath",
  ])
    if (!inside(path, receipt[name] ?? "") || receipt[name] === path)
      fail("Installation launch path escapes its slot");
  await verifyBrowserIdentity(receipt.browser);
  same(
    receipt.acceptance.browser,
    receipt.browser,
    "Accepted browser identity changed",
  );
  same(
    receipt.health.browser,
    receipt.browser,
    "Health browser identity changed",
  );
  return receipt;
}
export async function runInstallationHook(
  input,
  phase,
  { checkSource = true, timeout, fixtureConfig } = {},
) {
  const receipt = await verifyInstallation(input, { checkSource });
  const registration = json(
    await bytes(join(receipt.path, "registration.json")),
  );
  const result = await hookRun(receipt, phase, registration, {
    timeout,
    fixtureConfig,
  });
  await verifyInstallation(receipt.path, { checkSource });
  return result;
}

export async function readLaunchFixture(receipt, config = {}) {
  const registration = receipt.path
    ? json(await bytes(join(receipt.path, "registration.json")))
    : undefined;
  if (registration?.hooks?.preflight !== config.registration?.hooks?.preflight)
    throw Object.assign(
      Error(
        "Selected installation and current registration disagree on fixture preflight. Validate a matching installation before launch.",
      ),
      { code: "fixture_preflight" },
    );
  return readNativeFixture(config, "live");
}
