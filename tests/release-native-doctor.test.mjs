import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { nativeDoctor } from "../scripts/release/native-doctor.mjs";

async function fixture(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "native-doctor-")),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourceRoot = join(root, "customer");
  const files = {
    "package.json": JSON.stringify({
      name: "doctor-fixture",
      version: "1.0.0",
      type: "module",
      private: true,
    }),
    "package-lock.json": JSON.stringify({
      lockfileVersion: 3,
      packages: { "": { name: "doctor-fixture", version: "1.0.0" } },
    }),
    "engine/Cargo.toml":
      '[package]\nname="doctor-fixture"\nversion="1.0.0"\nedition="2021"\n[dependencies]\nbrowser-driver-engine = { version = "=0.1.4-alpha.3" }\n[[bin]]\nname="doctor-engine"\npath="src/main.rs"\n',
    "engine/Cargo.lock": "version = 4\n",
    "engine/src/main.rs": "fn main() {}\n",
    "launcher.mjs":
      'throw Error("Customer code must not execute during doctor");\nexport async function createManagedLaunch(){ return {}; }\n',
    "acceptance.mjs":
      'throw Error("Acceptance hook must not execute during doctor");\n',
    "health.mjs":
      'throw Error("Health hook must not execute during doctor");\n',
  };
  for (const [name, content] of Object.entries(files)) {
    await fs.mkdir(dirname(join(sourceRoot, name)), { recursive: true });
    await fs.writeFile(join(sourceRoot, name), content);
  }
  const key = generateKeyPairSync("ed25519").publicKey.export({
    type: "spki",
    format: "pem",
  });
  await fs.writeFile(join(root, "publisher.pem"), key);
  const configPath = join(root, "native.json");
  const config = {
    schemaVersion: 1,
    store: join(root, "store"),
    catalog: {
      url: "https://updates.example.test/preview.json",
      publisher: "daedlo",
      channel: "preview",
      trustedKeys: [{ id: "fixture-key", publicKeyFile: "publisher.pem" }],
    },
    registration: {
      schemaVersion: 1,
      projectId: "doctor-fixture",
      sourceRoot,
      files: Object.keys(files),
      model: { id: "doctor-fixture", version: "1" },
      interfaces: {
        launcher: 1,
        nodeAdapter: 1,
        rustModel: 1,
        protocol: 1,
        capabilities: ["recipeContext:1"],
      },
      node: { packageJson: "package.json", packageLock: "package-lock.json" },
      rust: {
        manifest: "engine/Cargo.toml",
        lock: "engine/Cargo.lock",
        binary: "doctor-engine",
      },
      launcher: "launcher.mjs",
      hooks: { acceptance: "acceptance.mjs", health: "health.mjs" },
    },
    installation: { offline: false },
    settings: { password: "private-settings-do-not-print" },
  };
  const save = () => fs.writeFile(configPath, JSON.stringify(config));
  await save();
  const calls = [];
  const runCommand = async (program, args, options) => {
    calls.push({ program, args, options });
    return {
      stdout:
        program === process.execPath
          ? "v24.1.0\n"
          : {
              npm: "11.0.0\n",
              rustc: "rustc 1.96.0 (fixture)\n",
              cargo: "cargo 1.96.0 (fixture)\n",
              python3: "Python 3.14.0\n",
            }[program],
      stderr: "",
    };
  };
  return { root, sourceRoot, configPath, config, save, calls, runCommand };
}
const check = (report, id) => report.checks.find((item) => item.id === id);

test("doctor parses the registered source without evaluating it or creating managed state", async (t) => {
  const f = await fixture(t);
  const before = await fs.readdir(f.root, { recursive: true });
  const report = await nativeDoctor(f.configPath, { runCommand: f.runCommand });
  assert.equal(check(report, "registration")?.status, "pass");
  assert.equal(report.ok, true);
  assert.equal(report.scope, "read-only-preflight");
  assert.match(report.notVerified.join(" "), /browser.*permission/i);
  assert.match(report.notVerified.join(" "), /application.*QA/i);
  assert.deepEqual(await fs.readdir(f.root, { recursive: true }), before);
  assert.equal(
    JSON.stringify(report).includes("private-settings-do-not-print"),
    false,
  );
  assert.deepEqual(
    f.calls.map((call) => call.program),
    [process.execPath, "npm", "rustc", "cargo", "python3"],
  );
  for (const call of f.calls) {
    assert.deepEqual(call.args, ["--version"]);
    assert.equal(call.options.shell, false);
    assert.equal(call.options.timeout, 10000);
    assert.equal(call.options.env.RUSTUP_AUTO_INSTALL, "0");
  }
});

test("missing tools and OS permission failures have distinct remedies without leaking stderr", async (t) => {
  const f = await fixture(t);
  const report = await nativeDoctor(f.configPath, {
    runCommand: async (program, ...args) => {
      if (program === "npm")
        throw Object.assign(Error("private stderr"), { code: "ENOENT" });
      if (program === "cargo")
        throw Object.assign(Error("private stderr"), { code: "EPERM" });
      if (program === "rustc") return { stdout: "rustc 1.80.0\n" };
      return f.runCommand(program, ...args);
    },
  });
  assert.equal(check(report, "npm")?.category, "dependency");
  assert.match(check(report, "npm").remedy, /install|PATH/i);
  assert.equal(check(report, "cargo")?.category, "permission");
  assert.match(check(report, "cargo").remedy, /permission|sandbox/i);
  assert.equal(check(report, "rustc")?.status, "blocked");
  assert.equal(report.ok, false);
  assert.equal(JSON.stringify(report).includes("private stderr"), false);
});

test("overlapping source/store and symlink paths fail before dependency probes or mutation", async (t) => {
  const f = await fixture(t);
  f.config.store = join(f.sourceRoot, "managed");
  await f.save();
  const report = await nativeDoctor(f.configPath, { runCommand: f.runCommand });
  assert.equal(check(report, "configuration")?.status, "blocked");
  assert.match(check(report, "configuration").remedy, /disjoint/i);
  assert.equal(f.calls.length, 0);
  f.config.store = join(f.root, "store-link");
  await fs.symlink(f.sourceRoot, f.config.store);
  await f.save();
  assert.equal(
    (await nativeDoctor(f.configPath, { runCommand: f.runCommand })).ok,
    false,
  );
  assert.equal(f.calls.length, 0);
});

test("publisher trust must contain unique Ed25519 keys and a credential-free HTTPS feed", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    join(f.root, "publisher.pem"),
    generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({
      type: "spki",
      format: "pem",
    }),
  );
  const report = await nativeDoctor(f.configPath, { runCommand: f.runCommand });
  assert.equal(check(report, "publisher-trust")?.status, "blocked");
  assert.match(check(report, "publisher-trust").remedy, /Ed25519/);
  f.config.catalog.url =
    "https://username:private-password@example.test/catalog.json";
  await f.save();
  const invalid = await nativeDoctor(f.configPath, {
    runCommand: f.runCommand,
  });
  assert.equal(check(invalid, "configuration")?.status, "blocked");
  assert.equal(JSON.stringify(invalid).includes("private-password"), false);
});

test("offline caches are inspected without creating or populating them", async (t) => {
  const f = await fixture(t);
  f.config.installation = {
    offline: true,
    npmCache: join(f.root, "missing-npm-cache"),
    cargoHome: join(f.root, "missing-cargo-home"),
  };
  await f.save();
  const report = await nativeDoctor(f.configPath, { runCommand: f.runCommand });
  assert.equal(check(report, "npm-cache")?.status, "blocked");
  assert.equal(check(report, "cargo-home")?.status, "blocked");
  assert.match(check(report, "npm-cache").message, /offline/i);
  await assert.rejects(fs.access(f.config.installation.npmCache), {
    code: "ENOENT",
  });
  await assert.rejects(fs.access(f.config.installation.cargoHome), {
    code: "ENOENT",
  });
});

test("unowned stores and interrupted ownership are retained for explicit recovery", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(f.config.store);
  await fs.writeFile(join(f.config.store, "private-existing-data"), "keep");
  let report = await nativeDoctor(f.configPath, { runCommand: f.runCommand });
  assert.equal(check(report, "store")?.category, "recovery");
  assert.equal(check(report, "store")?.status, "blocked");
  await fs.rm(join(f.config.store, "private-existing-data"));
  await fs.writeFile(
    join(f.config.store, ".ninja-project.json"),
    JSON.stringify({
      schemaVersion: 1,
      kind: "ninja-project-store",
      projectId: "doctor-fixture",
    }),
  );
  await fs.mkdir(join(f.config.store, "supervisor"));
  await fs.writeFile(
    join(f.config.store, "supervisor/child.json"),
    JSON.stringify({ status: "running", pid: 123, token: "private-token" }),
  );
  report = await nativeDoctor(f.configPath, { runCommand: f.runCommand });
  assert.equal(check(report, "recovery")?.status, "blocked");
  assert.match(check(report, "recovery").remedy, /status|owner/i);
  assert.equal(JSON.stringify(report).includes("private-token"), false);
  assert.equal(
    JSON.parse(await fs.readFile(join(f.config.store, "supervisor/child.json")))
      .status,
    "running",
  );
});

test("doctor identifies malformed state separately from valid store ownership", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(f.config.store);
  await fs.writeFile(
    join(f.config.store, ".ninja-project.json"),
    JSON.stringify({
      schemaVersion: 1,
      kind: "ninja-project-store",
      projectId: "doctor-fixture",
    }),
  );
  await fs.writeFile(
    join(f.config.store, "state.json"),
    JSON.stringify({
      schemaVersion: 9,
      projectId: "doctor-fixture",
      generation: 1,
    }),
  );
  const report = await nativeDoctor(f.configPath, { runCommand: f.runCommand });
  assert.equal(check(report, "store")?.status, "pass");
  assert.equal(check(report, "managed-state")?.status, "blocked");
  assert.equal(
    new Set(report.checks.map((item) => item.id)).size,
    report.checks.length,
  );
});

test("Rust probes use managed-installation ancestry and the actual installer environment", async (t) => {
  const f = await fixture(t);
  const previousToolchain = process.env.RUSTUP_TOOLCHAIN;
  const previousCargoHome = process.env.CARGO_HOME;
  process.env.RUSTUP_TOOLCHAIN = "authoring-only-toolchain";
  process.env.CARGO_HOME = join(f.root, "ambient-cargo");
  t.after(() => {
    for (const [key, value] of [
      ["RUSTUP_TOOLCHAIN", previousToolchain],
      ["CARGO_HOME", previousCargoHome],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  f.config.installation.cargoHome = join(f.root, "configured-cargo");
  await f.save();
  await fs.writeFile(
    join(f.sourceRoot, "engine/rust-toolchain.toml"),
    '[toolchain]\nchannel = "authoring-only-toolchain"\n',
  );
  const before = await fs.readdir(f.root, { recursive: true });
  const report = await nativeDoctor(f.configPath, { runCommand: f.runCommand });
  assert.equal(check(report, "rustc")?.status, "pass");
  assert.equal(check(report, "cargo")?.status, "pass");
  for (const id of ["rustc", "cargo"]) {
    const call = f.calls.find((entry) => entry.program === id);
    assert.equal(
      call.options.cwd,
      f.root,
      "A new managed slot inherits the store ancestor's toolchain, not the authored engine directory's override",
    );
    assert.equal(call.options.env.RUSTUP_TOOLCHAIN, undefined);
    assert.equal(call.options.env.RUSTUP_AUTO_INSTALL, "0");
    assert.equal(
      call.options.env.CARGO_HOME,
      id === "cargo" ? f.config.installation.cargoHome : process.env.CARGO_HOME,
    );
  }
  assert.deepEqual(await fs.readdir(f.root, { recursive: true }), before);
  await fs.mkdir(join(f.config.store, "installations"), { recursive: true });
  f.calls.length = 0;
  await nativeDoctor(f.configPath, { runCommand: f.runCommand });
  for (const id of ["rustc", "cargo"])
    assert.equal(
      f.calls.find((entry) => entry.program === id).options.cwd,
      join(f.config.store, "installations"),
    );
});

test("wrapped OS permission failures retain their category without exposing private causes", async (t) => {
  const f = await fixture(t);
  const report = await nativeDoctor(f.configPath, {
    runCommand: async (program, ...args) => {
      if (program === "rustc") {
        const cause = Object.assign(Error("private-denied-path"), {
          code: "EACCES",
        });
        throw new Error("private-installation-wrapper", {
          cause: new Error("private-browser-wrapper", { cause }),
        });
      }
      if (program === "cargo") {
        const cyclic = Error("private-cyclic-error");
        cyclic.cause = cyclic;
        throw cyclic;
      }
      return f.runCommand(program, ...args);
    },
  });
  assert.equal(check(report, "rustc")?.category, "permission");
  assert.match(check(report, "rustc").remedy, /permission|sandbox/i);
  assert.equal(check(report, "cargo")?.category, "dependency");
  assert.equal(JSON.stringify(report).includes("private-"), false);
});
