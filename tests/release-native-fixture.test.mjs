import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  prepareNativeFixture,
  readNativeFixture,
} from "../scripts/release/native-fixture.mjs";

const phases = ["acceptance", "health", "live"];
const privateMarker = "synthetic-private-input-marker";
const json = (value) => JSON.stringify(value);
const readMode = async (path) => (await fs.stat(path)).mode & 0o777;
const noPath = (path) => assert.rejects(fs.lstat(path), { code: "ENOENT" });

async function project(t, eligibleIds = [privateMarker]) {
  const root = await fs.mkdtemp(
    join(await fs.realpath(tmpdir()), "native-fixture-test-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourceRoot = join(root, "source");
  await fs.mkdir(sourceRoot);
  const marker = join(root, "hook-called");
  const hook = join(sourceRoot, "fixture-hook.mjs");
  await fs.writeFile(
    hook,
    `
    import { appendFile } from "node:fs/promises";
    let raw = "";
    for await (const chunk of process.stdin) raw += chunk;
    const request = JSON.parse(raw);
    if (request.schemaVersion !== 1 || !${json(eligibleIds)}.includes(request.input.selectedId))
      process.exit(4);
    await appendFile(${json(marker)}, "1", {mode: 0o600});
    console.log(JSON.stringify({schemaVersion: 1,${phases.map((phase) => `${phase}: { selectedId: request.input.selectedId, phase: "${phase}" }`).join(",")}}));
  `,
  );
  const input = join(root, "input.json");
  await fs.writeFile(input, json({ selectedId: eligibleIds[0] }), {
    mode: 0o600,
  });
  const config = {
    schemaVersion: 1,
    store: join(root, "store"),
    registration: {
      projectId: "synthetic-project",
      sourceRoot,
      files: ["fixture-hook.mjs"],
      hooks: { preflight: "fixture-hook.mjs" },
    },
    fixturePreflight: {
      input,
      directory: join(root, "output"),
      generation: randomUUID(),
    },
  };
  return { root, config, marker, hook };
}

test("the registered hook runs once and publishes privately bound phase contexts", async (t) => {
  const { config, marker } = await project(t);
  const receipt = await prepareNativeFixture(config);
  assert.deepEqual(receipt, { ok: true, status: "prepared", phases });
  assert.equal(await fs.readFile(marker, "utf8"), "1");
  assert.equal(await readMode(config.fixturePreflight.directory), 0o700);
  const evidence = [];
  for (const phase of phases) {
    const context = await readNativeFixture(config, phase);
    assert.equal(context.phase, phase);
    assert.equal(context.generation, config.fixturePreflight.generation);
    assert.deepEqual(context.input, { selectedId: privateMarker, phase });
    evidence.push(context.evidenceDirectory);
    assert.equal(await readMode(context.evidenceDirectory), 0o700);
    assert.deepEqual(await fs.readdir(context.evidenceDirectory), []);
  }
  assert.equal(new Set(evidence).size, phases.length);
  const walk = async (path) => {
    for (const entry of await fs.readdir(path, { withFileTypes: true })) {
      const item = join(path, entry.name);
      assert.equal(await readMode(item), entry.isDirectory() ? 0o700 : 0o600);
      if (entry.isDirectory()) await walk(item);
    }
  };
  await walk(config.fixturePreflight.directory);
  await noPath(config.store);
});

test("changing the request at the same path requires a fresh preparation for every phase", async (t) => {
  const { config, marker, root } = await project(t, ["case-a", "case-b"]);
  const settings = config.fixturePreflight;
  await prepareNativeFixture(config);
  const first = await readNativeFixture(config, "live");
  assert.equal(first.input.selectedId, "case-a");
  const evidence = join(first.evidenceDirectory, "original.json");
  await fs.writeFile(evidence, "original evidence");

  await fs.writeFile(settings.input, json({ selectedId: "case-b" }));
  for (const phase of phases) {
    await assert.rejects(
      readNativeFixture(config, phase),
      { code: "fixture_preflight" },
      `${phase} must refuse the stale case`,
    );
  }
  const fresh = {
    ...config,
    fixturePreflight: {
      ...settings,
      directory: join(root, "next"),
      generation: randomUUID(),
    },
  };
  await prepareNativeFixture(fresh);
  for (const phase of phases) {
    const context = await readNativeFixture(fresh, phase);
    assert.deepEqual(context.input, { selectedId: "case-b", phase });
    assert.equal(context.generation, fresh.fixturePreflight.generation);
  }
  assert.equal(await fs.readFile(marker, "utf8"), "11");
  assert.equal(await fs.readFile(evidence, "utf8"), "original evidence");
});

test("a request edited during selection leaves no published receipt", async (t) => {
  const { config, hook } = await project(t);
  const { input, directory } = config.fixturePreflight;
  // Place an editor's byte change between selector dispatch and publication.
  await fs.appendFile(hook, `\nawait appendFile(${json(input)}, "\\n");\n`);
  await assert.rejects(prepareNativeFixture(config), {
    code: "fixture_preflight",
  });
  await noPath(join(directory, "receipt.json"));
});

test("older preparations without a request fingerprint require fresh preparation", async (t) => {
  const { config } = await project(t);
  await prepareNativeFixture(config);
  const path = join(config.fixturePreflight.directory, "receipt.json");
  const receipt = JSON.parse(await fs.readFile(path, "utf8"));
  delete receipt.inputSha256;
  await fs.writeFile(path, json(receipt));
  await assert.rejects(readNativeFixture(config, "live"), {
    code: "fixture_preflight",
  });
});

test("absent generation and cross-project or cross-phase substitution fail closed", async (t) => {
  const { config } = await project(t);
  await assert.rejects(readNativeFixture(config, "live"), /fixture/i);
  await prepareNativeFixture(config);
  await assert.rejects(
    readNativeFixture(
      {
        ...config,
        fixturePreflight: {
          ...config.fixturePreflight,
          generation: randomUUID(),
        },
      },
      "live",
    ),
    /fixture/i,
  );
  await assert.rejects(
    readNativeFixture(
      {
        ...config,
        registration: { ...config.registration, projectId: "other-project" },
      },
      "live",
    ),
    /fixture/i,
  );
  await assert.rejects(
    readNativeFixture({ ...config, store: config.store + "-other" }, "live"),
    /does not match/i,
  );
  const phaseFile = async (phase) => {
    const paths = await fs.readdir(config.fixturePreflight.directory, {
      recursive: true,
    });
    const match = paths.find(
      (path) => path.includes(phase) && path.endsWith(".json"),
    );
    assert.ok(match, "phase input is saved in the prepared directory");
    return join(config.fixturePreflight.directory, match);
  };
  await fs.copyFile(await phaseFile("acceptance"), await phaseFile("live"));
  await assert.rejects(readNativeFixture(config, "live"), /fixture/i);
  assert.equal((await readNativeFixture(config, "health")).phase, "health");
  await fs.appendFile(await phaseFile("health"), "\n");
  await assert.rejects(readNativeFixture(config, "health"), /fixture/i);
});

test("concurrent preparation claims a fresh destination once and never replaces evidence", async (t) => {
  const { config, marker } = await project(t);
  const results = await Promise.allSettled([
    prepareNativeFixture(config),
    prepareNativeFixture(config),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.filter((result) => result.status === "rejected").length,
    1,
  );
  const { evidenceDirectory } = await readNativeFixture(config, "acceptance");
  const original = join(evidenceDirectory, "original.json");
  await fs.writeFile(original, '{"owned":true}');
  await assert.rejects(prepareNativeFixture(config), /already exists/i);
  assert.equal(await fs.readFile(original, "utf8"), '{"owned":true}');
  assert.equal(await fs.readFile(marker, "utf8"), "1");
});

test("invalid input ownership, output permissions, symlinks and overlapping paths block before hook execution", async (t) => {
  const { config, marker, root } = await project(t);
  const { fixturePreflight: settings, registration } = config;
  await fs.chmod(settings.input, 0o644);
  await assert.rejects(prepareNativeFixture(config), /private|permissions/i);
  await fs.chmod(settings.input, 0o000);
  await assert.rejects(prepareNativeFixture(config), /owner-readable/i);
  await fs.chmod(settings.input, 0o600);
  await assert.rejects(
    prepareNativeFixture({
      ...config,
      fixturePreflight: { ...settings, input: join(root, "absent-input.json") },
    }),
    /input file could not be read/i,
  );
  const link = join(root, "link");
  await fs.symlink(settings.input, link);
  await assert.rejects(
    prepareNativeFixture({
      ...config,
      fixturePreflight: { ...settings, input: link },
    }),
    /fixture/i,
  );
  for (const directory of [
    join(registration.sourceRoot, "output"),
    join(config.store, "output"),
    root,
  ]) {
    await assert.rejects(
      prepareNativeFixture({
        ...config,
        fixturePreflight: { ...settings, directory },
      }),
      /disjoint/i,
    );
  }
  await assert.rejects(
    prepareNativeFixture({
      ...config,
      registration: {
        ...registration,
        hooks: { preflight: "unregistered.mjs" },
      },
    }),
    /registered/i,
  );
  if (process.getuid?.() !== 0) {
    const readonly = join(root, "readonly");
    await fs.mkdir(readonly, { mode: 0o500 });
    await assert.rejects(
      prepareNativeFixture({
        ...config,
        fixturePreflight: { ...settings, directory: join(readonly, "output") },
      }),
      /could not reserve the evidence destination/i,
    );
  }
  await noPath(marker);
  await noPath(settings.directory);
});

test("malformed, failed and overly verbose hooks leave no readable prepared generation and redact output", async (t) => {
  for (const [source, message] of [
    [
      `console.error(${json(privateMarker)}); process.exit(1)`,
      /selector did not accept/i,
    ],
    [`console.log(${json(privateMarker)})`, /must return valid JSON/i],
    [
      `console.log(JSON.stringify({schemaVersion:1,acceptance:{},health:{},live:${json(privateMarker)}}))`,
      /must return separate/i,
    ],
    [`console.log(${json(privateMarker)}.repeat(20000))`, /output limit/i],
  ]) {
    const { config, hook } = await project(t);
    await fs.writeFile(hook, source);
    await assert.rejects(prepareNativeFixture(config), (error) => {
      assert.match(error.message, /fixture.*hook/i);
      assert.match(error.message, message);
      assert.equal(error.code, "fixture_preflight");
      assert.ok(!error.message.includes(privateMarker));
      assert.equal(error.cause, undefined);
      return true;
    });
    await assert.rejects(readNativeFixture(config, "live"), /fixture/i);
  }
});

test("disabled reads preserve the existing path", async () => {
  assert.equal(await readNativeFixture({}, "live"), undefined);
});

test("cancelling a running selector terminates it and leaves no completed receipt", async (t) => {
  const { config, marker, hook } = await project(t);
  await fs.writeFile(
    hook,
    `import { writeFile } from "node:fs/promises";
     import { setTimeout } from "node:timers/promises";
     for await (const _ of process.stdin) {}
     await writeFile(${json(marker)}, String(process.pid));
     console.error(${json(privateMarker)});
     await setTimeout(1000);
     console.log(JSON.stringify({schemaVersion:1, acceptance:{}, health:{}, live:{}}));`,
  );
  const controller = new AbortController();
  const preparation = prepareNativeFixture(config, {
    signal: controller.signal,
  });
  const stopped = assert.rejects(preparation, {
    code: "fixture_preflight",
    message: "Fixture preflight was cancelled.",
  });
  // Wait for the running selector's sentry before requesting cancellation.
  const deadline = Date.now() + 5000;
  let pid;
  while (Date.now() < deadline && !pid) {
    const sentry = await fs.readFile(marker, "utf8").catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    pid = Number(sentry);
    if (!pid) await delay(5);
  }
  controller.abort(Error(privateMarker));
  await stopped;
  assert.ok(pid, "selector must be running at cancellation");
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  await fs.stat(config.fixturePreflight.directory);
  await noPath(join(config.fixturePreflight.directory, "receipt.json"));
  await assert.rejects(readNativeFixture(config, "live"), {
    code: "fixture_preflight",
  });
});

test("a store symlink cannot disguise a destination in the managed store", async (t) => {
  const { config, marker, root } = await project(t);
  const actualStore = join(root, "actual-store");
  await fs.mkdir(actualStore);
  await fs.symlink(actualStore, config.store, "dir");
  const directory = join(actualStore, "output");
  await assert.rejects(
    prepareNativeFixture({
      ...config,
      fixturePreflight: { ...config.fixturePreflight, directory },
    }),
    /without symlinks/i,
  );
  await noPath(directory);
  await noPath(marker);
});

test("either half of fixture opt-in without its counterpart fails closed", async (t) => {
  const { config } = await project(t);
  await assert.rejects(
    readNativeFixture({ ...config, fixturePreflight: undefined }, "live"),
    /configuration/i,
  );
  await assert.rejects(
    prepareNativeFixture({
      ...config,
      registration: { ...config.registration, hooks: undefined },
    }),
    /configuration/i,
  );
});
