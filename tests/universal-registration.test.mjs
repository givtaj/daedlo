import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { captureTargetRegistration } from "../packages/universal/src/registration.mjs";
import { createTargetController } from "../packages/universal/src/controller.mjs";
import { readNinjaConfig, openNinja } from "../packages/universal/vendor/tools/lib/ninja.mjs";

async function fixture(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "universal-registration-")),
  );
  let retained = false;
  t.after(() =>
    retained ? undefined : fs.rm(root, { recursive: true, force: true }),
  );
  const sourceRoot = join(root, "source");
  const files = [
    "package.json",
    "package-lock.json",
    "engine/Cargo.toml",
    "engine/Cargo.lock",
    "launcher.mjs",
    "acceptance.mjs",
    "health.mjs",
  ];
  for (const name of files) {
    await fs.mkdir(dirname(join(sourceRoot, name)), { recursive: true });
    await fs.writeFile(
      join(sourceRoot, name),
      name.endsWith(".mjs")
        ? 'throw Error("Must never import customer source during registration");'
        : "{}",
    );
  }
  await fs.writeFile(
    join(sourceRoot, "package.json"),
    JSON.stringify({
      name: "universal-registration-fixture",
      version: "1.0.0",
      type: "module",
    }),
  );
  await fs.writeFile(
    join(sourceRoot, "package-lock.json"),
    JSON.stringify({ lockfileVersion: 3, packages: { "": {} } }),
  );
  await fs.writeFile(
    join(sourceRoot, "engine/Cargo.toml"),
    '[package]\nname = "fixture"\nversion = "1.0.0"\n[dependencies]\ndaedlo-engine = "0.1.0"\n',
  );
  await fs.writeFile(
    join(sourceRoot, "launcher.mjs"),
    'export function createManagedLaunch() { throw Error("Registration must never evaluate customer source"); }',
  );
  const config = {
    schemaVersion: 2,
    workspace: { id: "workspace", root: join(root, "data"), journal: 1 },
    store: join(root, "store"),
    frontend: { name: "Test site", targetOrigin: "https://example.test" },
    catalog: {
      channel: "preview",
      trustedKeys: [{ id: "conformance", publicKeyFile: "publisher.pem" }],
    },
    registration: {
      schemaVersion: 1,
      projectId: "project-a",
      sourceRoot,
      files,
      model: { id: "fixture", version: "1" },
      interfaces: {
        launcher: 1,
        nodeAdapter: 1,
        rustModel: 1,
        protocol: 1,
        capabilities: [],
      },
      node: { packageJson: "package.json", packageLock: "package-lock.json" },
      rust: {
        manifest: "engine/Cargo.toml",
        lock: "engine/Cargo.lock",
        binary: "fixture",
      },
      launcher: "launcher.mjs",
      hooks: { acceptance: "acceptance.mjs", health: "health.mjs" },
    },
  };
  const configPath = join(root, "config.json");
  await fs.writeFile(
    join(root, "publisher.pem"),
    "Independent public-key read fixture; no publisher requests are made.",
  );
  await fs.writeFile(configPath, JSON.stringify(config));
  const args = {
    configPath,
    id: "target-a",
    label: "Test",
    environment: "staging",
    authProfileRef: "profile-a",
  };
  return {
    root,
    config,
    configPath,
    args,
    retain: () => {
      retained = true;
    },
  };
}

test("registration pins configuration and authored source without importing or migrating them", async (t) => {
  const f = await fixture(t);
  const before = await fs.readFile(f.configPath);
  const { target } = await captureTargetRegistration(f.args);
  assert.match(
    target.configSha256 ?? "",
    /^[a-f0-9]{64}$/,
    "A target must bind its configuration before it can be launched",
  );
  assert.match(target.sourceSha256 ?? "", /^[a-f0-9]{64}$/);
  assert.deepEqual(await fs.readFile(f.configPath), before);
  await assert.rejects(fs.stat(f.config.workspace.root), { code: "ENOENT" });
});

test("basic schema-1 clients cannot be silently converted into a Universal target", async (t) => {
  const f = await fixture(t);
  f.config.schemaVersion = 1;
  delete f.config.workspace;
  await fs.writeFile(f.configPath, JSON.stringify(f.config));
  const before = await fs.readFile(f.configPath);
  await assert.rejects(captureTargetRegistration(f.args), {
    code: "universal_journal_required",
  });
  assert.deepEqual(await fs.readFile(f.configPath), before);
});

test("registration rejects unsafe authentication profile references before any storage creation", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    captureTargetRegistration({ ...f.args, authProfileRef: "../profile" }),
    { code: "target_invalid" },
  );
  await assert.rejects(fs.stat(f.config.workspace.root), { code: "ENOENT" });
});

test("changed target origin or source cannot launch through a previously registered identity", async (t) => {
  const f = await fixture(t);
  const { target } = await captureTargetRegistration(f.args);
  let launches = 0;
  const controller = createTargetController({
    root: f.config.workspace.root,
    catalog: { getTarget: async () => ({ ...target, revision: 1 }) },
    nativeCommand: async () => {
      launches++;
      return {
        result: {
          status: "running",
          viewerUrl: "http://127.0.0.1:12345/",
          reused: true,
          running: { sourceSha256: target.sourceSha256 },
        },
      };
    },
  });
  f.config.frontend.targetOrigin = "https://other.example.test";
  await fs.writeFile(f.configPath, JSON.stringify(f.config));
  await assert.rejects(controller.launch(target.id, { revision: 1 }), {
    code: "target_changed",
  });
  assert.equal(launches, 0);
});

test("stale target revision cannot launch and attached native owners survive controller close", async (t) => {
  const f = await fixture(t);
  const { target } = await captureTargetRegistration(f.args);
  let launches = 0;
  const controller = createTargetController({
    root: f.config.workspace.root,
    catalog: { getTarget: async () => ({ ...target, revision: 1 }) },
    nativeCommand: async () => {
      launches++;
      return {
        result: {
          status: "running",
          viewerUrl: "http://127.0.0.1:12345/",
          reused: true,
          running: { sourceSha256: target.sourceSha256 },
        },
      };
    },
  });
  await assert.rejects(controller.launch(target.id, { revision: 2 }), {
    code: "target_changed",
  });
  assert.equal(launches, 0);
  assert.equal(
    (await controller.launch(target.id, { revision: 1 })).reused,
    true,
  );
  await controller.close();
  assert.equal(launches, 1);
});

test("owned target cleanup failures retain the exact handle for explicit retry", async (t) => {
  const f = await fixture(t);
  const { target } = await captureTargetRegistration(f.args);
  let closes = 0;
  const controller = createTargetController({
    root: f.config.workspace.root,
    catalog: { getTarget: async () => ({ ...target, revision: 1 }) },
    nativeCommand: async () => ({
      result: {
        status: "running",
        viewerUrl: "http://127.0.0.1:12345/",
        running: { sourceSha256: target.sourceSha256 },
      },
      async close() {
        if (++closes === 1) throw Error("Pending owned cleanup");
      },
    }),
  });
  await controller.launch(target.id, { revision: 1 });
  await assert.rejects(
    controller.close(),
    (error) =>
      error.code === "cleanup_incomplete" &&
      error.pendingTargets[0] === target.id,
  );
  await controller.close();
  assert.equal(closes, 2);
});

test("authored integration drift is rejected even when bootstrap metadata is unchanged", async (t) => {
  const f = await fixture(t);
  const { target } = await captureTargetRegistration(f.args);
  let launches = 0;
  const controller = createTargetController({
    root: f.config.workspace.root,
    catalog: { getTarget: async () => ({ ...target, revision: 1 }) },
    nativeCommand: async () => {
      launches++;
      throw Error("Must not launch");
    },
  });
  await fs.appendFile(
    join(f.config.registration.sourceRoot, "launcher.mjs"),
    "\n// Changed authored behavior\n",
  );
  await assert.rejects(controller.launch(target.id, { revision: 1 }), {
    code: "target_changed",
  });
  assert.equal(launches, 0);
});

test("a replacement native handle never erases an earlier owned cleanup handle", async (t) => {
  const f = await fixture(t);
  const { target } = await captureTargetRegistration(f.args);
  const closed = [];
  let launches = 0;
  const controller = createTargetController({
    root: f.config.workspace.root,
    catalog: { getTarget: async () => ({ ...target, revision: 1 }) },
    nativeCommand: async () => {
      const id = ++launches;
      return {
        result: {
          status: "running",
          viewerUrl: "http://127.0.0.1:12345/",
          running: { sourceSha256: target.sourceSha256 },
        },
        async close() {
          closed.push(id);
        },
      };
    },
  });
  await controller.launch(target.id, { revision: 1 });
  await controller.launch(target.id, { revision: 1 });
  await controller.close();
  assert.deepEqual(closed.sort(), [1, 2]);
});

test("controller refuses a bootstrap edit after its catalog check before native reads it", async (t) => {
  const f = await fixture(t);
  const { target } = await captureTargetRegistration(f.args);
  let reads = 0,
    launches = 0;
  const controller = createTargetController({
    root: f.config.workspace.root,
    catalog: {
      getTarget: async () => {
        if (++reads === 2) {
          f.config.frontend.targetOrigin = "https://other.example.test";
          await fs.writeFile(f.configPath, JSON.stringify(f.config));
        }
        return { ...target, revision: 1 };
      },
    },
    nativeCommand: async (_command, path, options = {}) => {
      await (options.readConfig ?? readNinjaConfig)(path, {
        validateSource: false,
      });
      launches++;
      return {
        result: {
          status: "running",
          viewerUrl: "http://127.0.0.1:12345/",
          reused: true,
        },
      };
    },
  });
  await assert.rejects(controller.launch(target.id, { revision: 1 }), {
    code: "target_changed",
  });
  assert.equal(
    launches,
    0,
    "The actual config consumed by native must still match the registered target",
  );
  await controller.close();
});

test("controller pins the second config read used to open the native manager", async (t) => {
  const f = await fixture(t);
  const { target } = await captureTargetRegistration(f.args);
  let launches = 0;
  const controller = createTargetController({
    root: f.config.workspace.root,
    catalog: { getTarget: async () => ({ ...target, revision: 1 }) },
    nativeCommand: async (_command, path, options = {}) => {
      await (options.readConfig ?? readNinjaConfig)(path, {
        validateSource: false,
      });
      f.config.frontend.targetOrigin = "https://other.example.test";
      await fs.writeFile(f.configPath, JSON.stringify(f.config));
      const opened = await (options.open ?? openNinja)(path, {
        recover: false,
      });
      launches++;
      await opened.supervisor.close();
      return {
        result: {
          status: "running",
          viewerUrl: "http://127.0.0.1:12345/",
          reused: true,
        },
      };
    },
  });
  await assert.rejects(controller.launch(target.id, { revision: 1 }), {
    code: "target_changed",
  });
  assert.equal(
    launches,
    0,
    "A native manager cannot consume a later different target configuration",
  );
  await assert.rejects(fs.stat(f.config.store), { code: "ENOENT" });
  await controller.close();
});

test("openNinja consumes an explicit checked reader before storage initialization", async (t) => {
  const f = await fixture(t);
  let reads = 0;
  await assert.rejects(
    openNinja(f.configPath, {
      recover: false,
      readConfig: async () => {
        reads++;
        throw Object.assign(Error("Checked configuration refused"), {
          code: "target_changed",
        });
      },
    }),
    { code: "target_changed" },
  );
  assert.equal(reads, 1);
  await assert.rejects(fs.stat(f.config.store), { code: "ENOENT" });
});

for (const mismatch of ["source", "model"])
  test(`Universal rejects a historical selected installation with a different pinned ${mismatch}`, async (t) => {
    const f = await fixture(t);
    const { target } = await captureTargetRegistration(f.args);
    let launches = 0;
    const candidate = {
      historicalSnapshot: true,
      sourceSha256:
        mismatch === "source" ? "0".repeat(64) : target.sourceSha256,
      model:
        mismatch === "model" ? { ...target.model, version: "2" } : target.model,
    };
    const ninja = {
      readNinjaConfig,
      async openNinja(_path, options = {}) {
        await options.installationGuard?.(candidate);
        launches++;
        return {};
      },
    };
    const controller = createTargetController({
      root: f.config.workspace.root,
      catalog: { getTarget: async () => ({ ...target, revision: 1 }) },
      toolsLoader: async (name) => {
        assert.equal(name, "ninja");
        return ninja;
      },
      nativeCommand: async (_command, path, options = {}) => {
        await (options.open ?? ninja.openNinja)(path, { recover: false });
        return {
          result: {
            status: "running",
            viewerUrl: "http://127.0.0.1:12345/",
            running: candidate,
          },
        };
      },
    });
    await assert.rejects(controller.launch(target.id, { revision: 1 }), {
      code: "target_changed",
    });
    assert.equal(
      launches,
      0,
      "Historical selection cannot bypass the Universal source/model binding",
    );
    await controller.close();
  });

test("reconnection refuses a running source outside the target pin and preserves an owned cleanup handle", async (t) => {
  const f = await fixture(t);
  const { target } = await captureTargetRegistration(f.args);
  let closes = 0;
  const controller = createTargetController({
    root: f.config.workspace.root,
    catalog: { getTarget: async () => ({ ...target, revision: 1 }) },
    nativeCommand: async () => ({
      result: {
        status: "running",
        viewerUrl: "http://127.0.0.1:12345/",
        reused: true,
        running: { sourceSha256: "0".repeat(64) },
      },
      close: async () => {
        closes++;
      },
    }),
  });
  await assert.rejects(controller.launch(target.id, { revision: 1 }), {
    code: "target_changed",
  });
  assert.equal(closes, 0);
  await controller.close();
  assert.equal(
    closes,
    1,
    "An owned handle is retained even when its returned identity fails validation",
  );
});

test("the matching selected installation passes the supplied guard before dispatch", async (t) => {
  const f = await fixture(t);
  const { target } = await captureTargetRegistration(f.args);
  let launches = 0,
    guards = 0;
  const candidate = { sourceSha256: target.sourceSha256, model: target.model };
  const controller = createTargetController({
    root: f.config.workspace.root,
    catalog: { getTarget: async () => ({ ...target, revision: 1 }) },
    toolsLoader: async (name) => {
      assert.equal(name, "ninja");
      return {
        readNinjaConfig,
        openNinja: async (path, options) => {
          await options.readConfig(path);
          guards++;
          await options.installationGuard(candidate);
          launches++;
        },
      };
    },
    nativeCommand: async (_command, path, options) => {
      await options.readConfig(path, { validateSource: false });
      await options.open(path, { recover: false });
      return {
        result: {
          status: "running",
          viewerUrl: "http://127.0.0.1:12345/",
          running: candidate,
          reused: true,
        },
      };
    },
  });
  assert.equal(
    (await controller.launch(target.id, { revision: 1 })).status,
    "running",
  );
  assert.equal(guards, 1);
  assert.equal(launches, 1);
  await controller.close();
});

test(
  "production controller and native manager retain an unconfigured target owner until explicit close",
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t);
    const { target } = await captureTargetRegistration(f.args);
    const controller = createTargetController({
      root: f.config.workspace.root,
      catalog: { getTarget: async () => ({ ...target, revision: 1 }) },
    });
    try {
      const result = await controller.launch(target.id, { revision: 1 });
      assert.equal(
        result.status,
        "failed",
        "Without a selected installation the real native path requires explicit setup",
      );
      assert.equal(result.viewerUrl, null);
      assert.equal(result.reused, false);
      const receipt = JSON.parse(
        await fs.readFile(join(f.config.store, "native-session.json"), "utf8"),
      );
      assert.equal(receipt.pid, process.pid);
      await assert.rejects(
        fs.stat(join(f.config.store, "supervisor/child.json")),
        { code: "ENOENT" },
      );
    } finally {
      try {
        await controller.close();
      } catch (error) {
        f.retain();
        throw Object.assign(error, { retainedFixture: f.root });
      }
    }
    await assert.rejects(fs.stat(join(f.config.store, "native-session.json")), {
      code: "ENOENT",
    });
  },
);
