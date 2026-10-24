import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createManifest } from "../scripts/release/manifest.mjs";
import {
  prepareInstallation,
  snapshotProject,
  verifyInstallation,
  runInstallationHook,
  validateRegistration,
} from "../scripts/release/ninja-installation.mjs";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const descriptor = {
  id: "ninja-fixture",
  version: "1",
  label: "Fixture",
  states: [{ id: "ready", label: "Ready", parent: null, support: "supported" }],
  commands: [],
  recipes: [],
};
const hook = `import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
let text=''; for await (const part of process.stdin) text+=part;
const ctx=JSON.parse(text), i=ctx.installation;
const runtime=await import(i.runtimePath);
const config=JSON.parse(await fs.readFile(i.sourcePath+'/config.json','utf8'));
const browser={version:'synthetic-browser-contract-1',executablePath:config.browserPath,sha256:createHash('sha256').update(await fs.readFile(config.browserPath)).digest('hex')};
if(runtime.version!==i.version) throw Error('Wrong candidate runtime');
await fs.writeFile(ctx.fixturePath+'/check.json', JSON.stringify({owned:true}));
console.log(JSON.stringify({schemaVersion:1,accepted:true,isolated:true,runtimePath:i.runtimePath,enginePath:i.enginePath,model:i.model,browser,tests:1,failed:0,...(ctx.phase==='health'?{ready:true}:{})}));`;
async function write(file, bytes) {
  await fs.mkdir(dirname(file), { recursive: true });
  await fs.writeFile(file, bytes);
}
async function fixture(t, packagePrefix = "browser-driver") {
  const root = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "ninja-install-test-")),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const ancestor = join(root, "ancestor"),
    sourceRoot = join(ancestor, "customer"),
    bundlePath = join(root, "bundle");
  await fs.mkdir(bundlePath);
  await write(
    join(ancestor, "package.json"),
    JSON.stringify({
      name: "unrelated-ancestor",
      private: true,
      workspaces: ["customer"],
    }),
  );
  await write(
    join(ancestor, "package-lock.json"),
    "unrelated ancestor lock bytes\n",
  );
  await write(join(ancestor, "application-data.json"), '{"saved":"keep me"}\n');
  // Tiny owned executable bytes represent the identity contract only, not Chromium acceptance.
  const browserPath = join(root, "synthetic-browser");
  await write(browserPath, "synthetic browser identity fixture\n");
  await fs.chmod(browserPath, 0o700);
  const files = {
    "package.json": JSON.stringify({
      name: "ninja-customer",
      version: "1.0.0",
      private: true,
      type: "module",
      scripts: { preinstall: "node -e \"throw Error('must not run')\"" },
    }),
    "package-lock.json": JSON.stringify({
      name: "ninja-customer",
      version: "1.0.0",
      lockfileVersion: 3,
      requires: true,
      packages: { "": { name: "ninja-customer", version: "1.0.0" } },
    }),
    "engine/Cargo.toml":
      '[package]\nname="ninja-customer"\nversion="1.0.0"\nedition="2021"\n[dependencies]\nbrowser-driver-engine = { path = "../old-engine", version = "=0.0.1" }\n[[bin]]\nname="ninja-engine"\npath="src/main.rs"\n',
    "engine/Cargo.lock":
      '# Original lock retained exactly\nversion = 4\n[[package]]\nname = "ninja-customer"\nversion = "1.0.0"\ndependencies = ["browser-driver-engine"]\n[[package]]\nname = "browser-driver-engine"\nversion = "0.0.1"\n',
    "engine/src/main.rs":
      'fn main() { println!("{}", browser_driver_engine::hello()); }\n',
    "adapter.mjs":
      'export function createAdapter(){ return { model:{id:"ninja-fixture",version:"1"}, handlers:{} }; }\n',
    "launcher.mjs":
      'import {createAdapter} from "./adapter.mjs";\nexport async function createManagedLaunch({runtime,enginePath}) { return {runtime,enginePath,adapter:createAdapter()}; }\n',
    "acceptance.mjs": hook,
    "health.mjs": hook,
    "FLOW.md": "Customer authored flow stays unchanged.\n",
    "AGENTS.md": "Customer custom instructions stay unchanged.\n",
    ".agents/skills/custom/SKILL.md": "Custom skill stays unchanged.\n",
    "config.json":
      JSON.stringify({
        project: "unchanged",
        data: "outside-updater-ownership",
        browserPath,
      }) + "\n",
  };
  for (const [file, bytes] of Object.entries(files))
    await write(join(sourceRoot, file), bytes);
  const runtimeRoot = join(root, "runtime", "package");
  await write(
    join(runtimeRoot, "package.json"),
    JSON.stringify({
      name: `@${packagePrefix}/runtime`,
      version: "1.0.0",
      type: "module",
      exports: "./index.mjs",
      engines: { node: ">=22" },
    }),
  );
  await write(
    join(runtimeRoot, "index.mjs"),
    'export const version="1.0.0";\nexport function createDriverSession(){}\n',
  );
  const crateRoot = join(root, "crate", `${packagePrefix}-engine-1.0.0`);
  await write(
    join(crateRoot, "Cargo.toml"),
    `[package]\nname="${packagePrefix}-engine"\nversion="1.0.0"\nedition="2021"\n[lib]\npath="src/lib.rs"\n`,
  );
  const hello = JSON.stringify({
    protocol: 1,
    id: "ninja-hello",
    ok: true,
    descriptor,
    capabilities: { recipeContext: 1 },
  });
  await write(
    join(crateRoot, "src/lib.rs"),
    `pub fn hello()-> &'static str { r###"${hello}"### }\n`,
  );
  const artifacts = {};
  for (const [kind, folder, prefix, extension, name] of [
    ["runtime", "runtime", "package", "tgz", `@${packagePrefix}/runtime`],
    [
      "engine",
      "crate",
      `${packagePrefix}-engine-1.0.0`,
      "crate",
      `${packagePrefix}-engine`,
    ],
  ]) {
    const file = `${packagePrefix}-${kind}-1.0.0.${extension}`;
    execFileSync(
      "tar",
      ["-czf", join(bundlePath, file), "-C", join(root, folder), prefix],
      { env: { ...process.env, COPYFILE_DISABLE: "1" } },
    );
    const bytes = await fs.readFile(join(bundlePath, file));
    artifacts[kind] = {
      file,
      name,
      version: "1.0.0",
      sha256: hash(bytes),
      bytes: bytes.length,
    };
  }
  const manifest = createManifest({
    version: "1.0.0",
    source: {
      commit: "a".repeat(40),
      dirty: false,
      treeSha256: "b".repeat(64),
    },
    artifacts,
  });
  const manifestBytes = JSON.stringify(manifest, null, 2) + "\n",
    manifestSha256 = hash(manifestBytes);
  await write(join(bundlePath, "manifest.json"), manifestBytes);
  await write(
    join(bundlePath, "SHA256SUMS"),
    `${artifacts.runtime.sha256}  ${artifacts.runtime.file}\n${artifacts.engine.sha256}  ${artifacts.engine.file}\n${manifestSha256}  manifest.json\n`,
  );
  const interfaces = {
    launcher: 1,
    nodeAdapter: 1,
    rustModel: 1,
    protocol: 1,
    capabilities: ["recipeContext"],
  };
  const registration = {
    schemaVersion: 1,
    projectId: "fixture",
    label: "Ninja fixture",
    sourceRoot,
    files: Object.keys(files).sort(),
    model: { id: descriptor.id, version: descriptor.version },
    interfaces,
    node: { packageJson: "package.json", packageLock: "package-lock.json" },
    rust: {
      manifest: "engine/Cargo.toml",
      lock: "engine/Cargo.lock",
      binary: "ninja-engine",
    },
    hooks: { acceptance: "acceptance.mjs", health: "health.mjs" },
    launcher: "launcher.mjs",
  };
  const verifiedKit = {
    bundlePath,
    kitPath: root,
    metadata: { version: "1.0.0" },
    identity: {
      version: "1.0.0",
      manifestSha256,
      contracts: { manager: 1, ...interfaces },
    },
  };
  const destination = join(root, "installation");
  const preserved = new Map(
    await Promise.all(
      [
        ...Object.keys(files).map((f) => join(sourceRoot, f)),
        ...["package.json", "package-lock.json", "application-data.json"].map(
          (f) => join(ancestor, f),
        ),
      ].map(async (f) => [f, await fs.readFile(f)]),
    ),
  );
  const prepare = (extra = {}) =>
    prepareInstallation({ registration, verifiedKit, destination, ...extra });
  return {
    root,
    ancestor,
    sourceRoot,
    registration,
    verifiedKit,
    destination,
    preserved,
    prepare,
  };
}
async function preserved(f) {
  for (const [file, bytes] of f.preserved)
    assert.deepEqual(
      await fs.readFile(file),
      bytes,
      `Original customer or ancestor bytes changed: ${file}`,
    );
}

test("real isolated npm and Cargo prepare preserve source, custom instructions, locks and ancestor data", async (t) => {
  const f = await fixture(t),
    before = await snapshotProject(f.registration);
  const receipt = await f.prepare();
  assert.ok(receipt, "Installation must return a complete verified receipt");
  assert.equal(receipt.version, "1.0.0");
  assert.equal(receipt.path, f.destination);
  assert.equal(receipt.sourceSha256, before.sha256);
  assert.equal(receipt.acceptance.accepted, true);
  assert.equal(receipt.health.ready, true);
  assert.equal(
    JSON.parse(
      await fs.readFile(
        join(
          receipt.sourcePath,
          "node_modules/@browser-driver/runtime/package.json",
        ),
      ),
    ).version,
    "1.0.0",
  );
  assert.equal(
    JSON.parse(execFileSync(receipt.enginePath, { encoding: "utf8" }))
      .descriptor.id,
    "ninja-fixture",
  );
  assert.deepEqual(await snapshotProject(f.registration), before);
  assert.equal(
    (await verifyInstallation(f.destination, { registration: f.registration }))
      .inventorySha256,
    receipt.inventorySha256,
  );
  assert.equal(
    (await runInstallationHook(f.destination, "health")).ready,
    true,
  );
  await preserved(f);
  await assert.rejects(
    fs.access(join(f.ancestor, "node_modules/@browser-driver/runtime")),
    { code: "ENOENT" },
  );
});

test("unsupported interfaces reject before creating a destination", async (t) => {
  const f = await fixture(t);
  f.registration.interfaces.launcher = 2;
  await assert.rejects(
    f.prepare(),
    /interface|contract|unsupported|migration/i,
  );
  await assert.rejects(fs.access(f.destination), { code: "ENOENT" });
  await preserved(f);
});

test("symlinked customer inputs and missing acceptance never become ready", async (t) => {
  const f = await fixture(t);
  await fs.rm(join(f.sourceRoot, "FLOW.md"));
  await fs.symlink(
    join(f.ancestor, "application-data.json"),
    join(f.sourceRoot, "FLOW.md"),
  );
  await assert.rejects(f.prepare(), /symlink|regular/i);
  await assert.rejects(fs.access(f.destination), { code: "ENOENT" });
  await fs.rm(join(f.sourceRoot, "FLOW.md"));
  await fs.writeFile(join(f.sourceRoot, "FLOW.md"), "Restored");
  delete f.registration.hooks.acceptance;
  await assert.rejects(f.prepare(), /acceptance|hook|registration/i);
});

test("existing destinations and nesting in the customer source are refused without alteration", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(f.destination);
  await write(join(f.destination, "keep"), "existing");
  await assert.rejects(f.prepare(), /exist|fresh|owned/i);
  assert.equal(
    await fs.readFile(join(f.destination, "keep"), "utf8"),
    "existing",
  );
  await assert.rejects(
    f.prepare({ destination: join(f.sourceRoot, "managed") }),
    /nested|separate|source/i,
  );
  await preserved(f);
});

test("ordinary factories and direct runtime bypass cannot enroll as managed launchers", async (t) => {
  const f = await fixture(t);
  await write(
    join(f.sourceRoot, "launcher.mjs"),
    'import {createDriverSession} from "@browser-driver/runtime"; export async function createProject(){ throw Error("must never execute"); }',
  );
  await assert.rejects(f.prepare(), /launcher|runtime|managed|unsupported/i);
  await assert.rejects(fs.access(f.destination), { code: "ENOENT" });
});

test("failed registered acceptance does not produce a ready installation", async (t) => {
  const f = await fixture(t);
  await write(
    join(f.sourceRoot, "acceptance.mjs"),
    hook.replace("accepted:true", "accepted:false"),
  );
  await assert.rejects(f.prepare(), /acceptance|accepted|hook/i);
  await assert.rejects(fs.access(join(f.destination, "installation.json")), {
    code: "ENOENT",
  });
});

test("verification detects installation tampering and authoring drift; historical rollback remains explicit", async (t) => {
  const f = await fixture(t),
    receipt = await f.prepare();
  assert.ok(receipt);
  await fs.appendFile(join(f.sourceRoot, "FLOW.md"), "New authoring\n");
  await assert.rejects(
    verifyInstallation(f.destination, { registration: f.registration }),
    /source|stale|changed/i,
  );
  assert.equal(
    (await verifyInstallation(f.destination, { checkSource: false }))
      .sourceSha256,
    receipt.sourceSha256,
  );
  await fs.appendFile(receipt.enginePath, "tampered");
  await assert.rejects(
    verifyInstallation(f.destination, { checkSource: false }),
    /integrity|inventory|changed/i,
  );
});

test("receipt paths and identity are bound to the sealed registered launch tuple", async (t) => {
  const f = await fixture(t),
    receipt = await f.prepare();
  const file = join(f.destination, "installation.json");
  await fs.writeFile(
    file,
    JSON.stringify({
      ...receipt,
      launcherPath: join(receipt.sourcePath, "acceptance.mjs"),
    }),
  );
  await assert.rejects(
    verifyInstallation(f.destination, { checkSource: false }),
    /launch|tuple|path|identity/i,
  );
});

test("a verified-kit label without its trusted manifest digest is refused before installation", async (t) => {
  const f = await fixture(t);
  delete f.verifiedKit.identity.manifestSha256;
  await assert.rejects(f.prepare(), /trusted|digest|identity/i);
  await assert.rejects(fs.access(f.destination), { code: "ENOENT" });
  await preserved(f);
});

test("Cargo binary sources outside the registered snapshot are rejected before building", async (t) => {
  const f = await fixture(t),
    external = join(f.root, "external-main.rs");
  await write(
    external,
    'fn main() { println!("{}", browser_driver_engine::hello()); }\n',
  );
  const manifest = join(f.sourceRoot, "engine/Cargo.toml");
  await fs.writeFile(
    manifest,
    (await fs.readFile(manifest, "utf8")).replace(
      'path="src/main.rs"',
      `path=${JSON.stringify(external)}`,
    ),
  );
  await assert.rejects(
    f.prepare(),
    /closure|source path|registered|unsupported/i,
  );
  await assert.rejects(fs.access(join(f.destination, "logs/cargo-build.log")), {
    code: "ENOENT",
  });
});

test("registration changes invalidate the same file bytes and source generation", async (t) => {
  const f = await fixture(t),
    first = await snapshotProject(f.registration),
    receipt = await f.prepare();
  const changed = { ...f.registration, label: "Different registration" };
  assert.notEqual((await snapshotProject(changed)).sha256, first.sha256);
  await assert.rejects(
    verifyInstallation(receipt.path, { registration: changed }),
    /registration|stale|changed/i,
  );
});

test("a hook cannot rewrite the staged adapter and retain accepted status", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    join(f.sourceRoot, "acceptance.mjs"),
    hook.replace(
      "const runtime=",
      'await fs.appendFile(i.sourcePath+"/adapter.mjs","\\n// mutation");\nconst runtime=',
    ),
  );
  await assert.rejects(f.prepare(), /installation changed|inventory/i);
  await assert.rejects(fs.access(join(f.destination, "installation.json")), {
    code: "ENOENT",
  });
});

test("a wrong engine model rejects before acceptance and preserves an existing installation", async (t) => {
  const f = await fixture(t),
    original = await f.prepare();
  const before = await fs.readFile(join(original.path, "installation.json"));
  const changed = {
    ...f.registration,
    model: { id: "wrong-model", version: "1" },
  };
  await assert.rejects(
    f.prepare({ registration: changed, destination: join(f.root, "rejected") }),
    /model identity/i,
  );
  assert.deepEqual(
    await fs.readFile(join(original.path, "installation.json")),
    before,
  );
  assert.equal(
    (await verifyInstallation(original.path)).inventorySha256,
    original.inventorySha256,
  );
  await preserved(f);
});

test("versioned capability tokens match the actual engine capability and read-only registration preflight", async (t) => {
  const f = await fixture(t);
  f.registration.interfaces.capabilities = ["recipeContext:1"];
  f.verifiedKit.identity.contracts.capabilities = ["recipeContext:1"];
  assert.deepEqual(await validateRegistration(f.registration), f.registration);
  await assert.rejects(fs.access(f.destination), { code: "ENOENT" });
  const receipt = await f.prepare();
  assert.equal(receipt.handshake.capabilities.recipeContext, 1);
  assert.deepEqual(receipt.interfaces.capabilities, ["recipeContext:1"]);
  await preserved(f);
});

test("browser cache changes invalidate prepared and historical installations", async (t) => {
  const f = await fixture(t),
    receipt = await f.prepare();
  const browserPath = JSON.parse(
    await fs.readFile(join(f.sourceRoot, "config.json"), "utf8"),
  ).browserPath;
  await fs.appendFile(browserPath, "changed external cache");
  await assert.rejects(
    verifyInstallation(receipt.path, { checkSource: false }),
    (error) => error.code === "browser_changed",
  );
});

test("missing browser identity cannot satisfy accepted hook output", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    join(f.sourceRoot, "health.mjs"),
    hook.replace("model:i.model,browser,tests:", "model:i.model,tests:"),
  );
  await assert.rejects(f.prepare(), /browser/i);
  await assert.rejects(fs.access(join(f.destination, "installation.json")), {
    code: "ENOENT",
  });
});

test("historical snapshot verification tolerates changed registration only for the same project", async (t) => {
  const f = await fixture(t),
    receipt = await f.prepare();
  const changed = { ...f.registration, label: "New generation" };
  assert.equal(
    (
      await verifyInstallation(receipt.path, {
        registration: changed,
        checkSource: false,
      })
    ).id,
    receipt.id,
  );
  await assert.rejects(
    verifyInstallation(receipt.path, {
      registration: { ...changed, projectId: "other" },
      checkSource: false,
    }),
    /project|registration/i,
  );
});

async function refreshBundle(f) {
  const manifest = JSON.parse(
    await fs.readFile(join(f.verifiedKit.bundlePath, "manifest.json"), "utf8"),
  );
  for (const artifact of Object.values(manifest.artifacts)) {
    const content = await fs.readFile(
      join(f.verifiedKit.bundlePath, artifact.file),
    );
    artifact.sha256 = hash(content);
    artifact.bytes = content.length;
  }
  const content = JSON.stringify(manifest, null, 2) + "\n";
  const digest = hash(content);
  f.verifiedKit.identity.manifestSha256 = digest;
  await fs.writeFile(join(f.verifiedKit.bundlePath, "manifest.json"), content);
  await fs.writeFile(
    join(f.verifiedKit.bundlePath, "SHA256SUMS"),
    `${manifest.artifacts.runtime.sha256}  ${manifest.artifacts.runtime.file}\n${manifest.artifacts.engine.sha256}  ${manifest.artifacts.engine.file}\n${digest}  manifest.json\n`,
  );
}

test("real npm retains the locked adapter/browser dependency closure and verifies its installed bytes", async (t) => {
  const f = await fixture(t),
    archiveName = "vendor/playwright.tgz",
    library = join(f.root, "browser-library", "package");
  await write(
    join(library, "package.json"),
    JSON.stringify({
      name: "playwright",
      version: "1.62.1",
      main: "index.cjs",
    }),
  );
  await write(
    join(library, "index.cjs"),
    'module.exports={closureIdentity:"locked-browser-library-fixture"};\n',
  );
  await fs.mkdir(join(f.sourceRoot, "vendor"));
  execFileSync(
    "tar",
    [
      "-czf",
      join(f.sourceRoot, archiveName),
      "-C",
      dirname(library),
      "package",
    ],
    { env: { ...process.env, COPYFILE_DISABLE: "1" } },
  );
  f.registration.files.push(archiveName);
  const pkg = JSON.parse(
    await fs.readFile(join(f.sourceRoot, "package.json"), "utf8"),
  );
  pkg.dependencies = { playwright: "file:" + archiveName };
  await fs.writeFile(join(f.sourceRoot, "package.json"), JSON.stringify(pkg));
  execFileSync(
    "npm",
    [
      "install",
      "--package-lock-only",
      "--prefix",
      f.sourceRoot,
      "--workspaces=false",
      "--offline",
      "--ignore-scripts",
      "--bin-links=false",
      "--no-audit",
      "--no-fund",
      "--cache",
      join(f.root, "fixture-cache"),
    ],
    { cwd: f.sourceRoot, stdio: "pipe" },
  );
  const beforeLock = JSON.parse(
    await fs.readFile(join(f.sourceRoot, "package-lock.json"), "utf8"),
  );
  const runtimePkg = join(f.root, "runtime/package/package.json");
  const runtime = JSON.parse(await fs.readFile(runtimePkg, "utf8"));
  runtime.dependencies = { playwright: "1.62.1" };
  await fs.writeFile(runtimePkg, JSON.stringify(runtime));
  execFileSync(
    "tar",
    [
      "-czf",
      join(f.verifiedKit.bundlePath, "browser-driver-runtime-1.0.0.tgz"),
      "-C",
      join(f.root, "runtime"),
      "package",
    ],
    { env: { ...process.env, COPYFILE_DISABLE: "1" } },
  );
  await refreshBundle(f);
  const dependencyHook =
    "import {createRequire} from 'node:module';\n" +
    hook.replace(
      "if(runtime.version!==i.version)",
      "const load=createRequire(i.runtimePath); if(load('playwright').closureIdentity!=='locked-browser-library-fixture')throw Error('Wrong browser dependency');\nif(runtime.version!==i.version)",
    );
  for (const file of ["acceptance.mjs", "health.mjs"])
    await fs.writeFile(join(f.sourceRoot, file), dependencyHook);
  for (const file of [
    "package.json",
    "package-lock.json",
    "acceptance.mjs",
    "health.mjs",
    archiveName,
  ])
    f.preserved.set(
      join(f.sourceRoot, file),
      await fs.readFile(join(f.sourceRoot, file)),
    );
  const receipt = await f.prepare();
  const afterLock = JSON.parse(
    await fs.readFile(join(receipt.sourcePath, "package-lock.json"), "utf8"),
  );
  assert.deepEqual(
    afterLock.packages["node_modules/playwright"],
    beforeLock.packages["node_modules/playwright"],
  );
  assert.equal(receipt.acceptance.tests, 1);
  await preserved(f);
  await fs.appendFile(
    join(receipt.sourcePath, "node_modules/playwright/index.cjs"),
    "// changed",
  );
  await assert.rejects(
    verifyInstallation(receipt.path, { checkSource: false }),
    /inventory|integrity/i,
  );
});

test("a symlink inside a signed candidate tarball is refused before npm installation", async (t) => {
  const f = await fixture(t),
    module = join(f.root, "runtime/package/index.mjs");
  await fs.rm(module);
  await fs.symlink(join(f.sourceRoot, "adapter.mjs"), module);
  execFileSync(
    "tar",
    [
      "-czf",
      join(f.verifiedKit.bundlePath, "browser-driver-runtime-1.0.0.tgz"),
      "-C",
      join(f.root, "runtime"),
      "package",
    ],
    { env: { ...process.env, COPYFILE_DISABLE: "1" } },
  );
  await refreshBundle(f);
  await assert.rejects(f.prepare(), /python3|archive/i);
  await assert.rejects(fs.access(join(f.destination, "logs/npm-install.log")), {
    code: "ENOENT",
  });
  await preserved(f);
});

test("symlinked external browsers and zero-check acceptance cannot be selected", async (t) => {
  const f = await fixture(t),
    configPath = join(f.sourceRoot, "config.json"),
    config = JSON.parse(await fs.readFile(configPath, "utf8"));
  const link = join(f.root, "browser-link");
  await fs.symlink(config.browserPath, link);
  config.browserPath = link;
  await fs.writeFile(configPath, JSON.stringify(config));
  await assert.rejects(
    f.prepare(),
    (error) => error.code === "browser_changed",
  );
  const other = await fixture(t);
  await fs.writeFile(
    join(other.sourceRoot, "acceptance.mjs"),
    hook.replace("tests:1", "tests:0"),
  );
  await assert.rejects(other.prepare(), /acceptance|isolated|accepted/i);
});

test("persisted hook receipts retain every accepted check invariant", async (t) => {
  const f = await fixture(t),
    receipt = await f.prepare();
  const file = join(receipt.path, "installation.json");
  const alterations = [
    ["acceptance", "failed", 1],
    ["acceptance", "tests", 0],
    ["health", "isolated", false],
    ["health", "accepted", false],
    ["acceptance", "runtimePath", join(f.root, "other-runtime.mjs")],
    ["health", "enginePath", join(f.root, "other-engine")],
    ["health", "model", { id: "other-model", version: "1" }],
    ["acceptance", "schemaVersion", 2],
  ];
  for (const [phase, key, value] of alterations) {
    const altered = structuredClone(receipt);
    altered[phase][key] = value;
    await fs.writeFile(file, JSON.stringify(altered));
    await assert.rejects(
      verifyInstallation(receipt.path, { checkSource: false }),
      /hook|accepted|identity|model|runtime|engine|isolated/i,
      phase + "." + key,
    );
  }
  await fs.writeFile(file, JSON.stringify(receipt));
  await verifyInstallation(receipt.path);
  await preserved(f);
});

test("Daedlo installation compiles an unchanged historical Rust import and verifies its selected runtime", async (t) => {
  const f = await fixture(t, "daedlo");
  const receipt = await f.prepare();
  assert.match(receipt.runtimePath, /node_modules\/@daedlo\/runtime\//);
  assert.match(
    await fs.readFile(join(receipt.sourcePath, "engine/Cargo.toml"), "utf8"),
    /browser-driver-engine = \{ package = "daedlo-engine"/,
  );
  assert.equal(
    (await verifyInstallation(f.destination)).inventorySha256,
    receipt.inventorySha256,
  );
  await preserved(f);
});

test("historical installation receipts infer only the legacy package identity", async (t) => {
  for (const prefix of ["browser-driver", "daedlo"]) {
    const f = await fixture(t, prefix);
    const receipt = await f.prepare();
    delete receipt.runtimePackage;
    await fs.writeFile(
      join(f.destination, "installation.json"),
      JSON.stringify(receipt),
    );
    if (prefix === "browser-driver") {
      assert.equal(
        (await verifyInstallation(f.destination)).runtimePackage,
        undefined,
      );
    } else {
      await assert.rejects(
        verifyInstallation(f.destination),
        /identity changed/,
      );
    }
    await preserved(f);
  }
});

test("new installer accepts manager2 renamed packages and refuses unknown manager3 before acquisition", async (t) => {
  const f = await fixture(t, "daedlo");
  f.verifiedKit.identity.contracts.manager = 2;
  const before = await snapshotProject(f.registration);
  const installed = await f.prepare();
  await verifyInstallation(installed.path);
  assert.deepEqual(await snapshotProject(f.registration), before);
  const other = await fixture(t, "daedlo");
  other.verifiedKit.identity.contracts.manager = 3;
  await assert.rejects(other.prepare(), /supported manager contracts/);
  await assert.rejects(fs.stat(other.destination), { code: "ENOENT" });
});
