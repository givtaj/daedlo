// Opt-in exact-bundle acceptance: real installer, Rust handshake, native child,
// Chromium, saved data, sealed history and rollback. No customer application.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareManagedStarter } from "../examples/managed-starter/prepare.mjs";
import { createStarterFixture } from "../examples/starter/fixture.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const bundle = process.env.DAEDLO_MIGRATION_BUNDLE;
const expectedManifestSha256 = process.env.DAEDLO_MIGRATION_MANIFEST_SHA256;
const toolsRoot = resolve(
  process.env.DAEDLO_NATIVE_TOOLS_ROOT ?? join(repo, "scripts/release"),
);
const runtimePath = resolve(
  process.env.DAEDLO_NATIVE_RUNTIME_PATH ??
    join(repo, "packages/runtime/src/index.mjs"),
);
const crate = resolve(
  process.env.DAEDLO_MIGRATION_ENGINE_CRATE ??
    join(repo, "crates/daedlo-engine"),
);
const output = resolve(
  process.env.DAEDLO_MIGRATION_OUTPUT ??
    join(repo, "artifacts/native-model-migration-" + Date.now()),
);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const readJson = async (path) => JSON.parse(await fs.readFile(path, "utf8"));
const writeJson = (path, value) =>
  fs.writeFile(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
const load = (name) => import(pathToFileURL(join(toolsRoot, name + ".mjs")));

test(
  "reviewed native model version and pin migration preserves one store, real saves and complete rollback",
  {
    skip: !bundle
      ? "Set DAEDLO_MIGRATION_BUNDLE and DAEDLO_MIGRATION_MANIFEST_SHA256 for exact-bundle browser acceptance"
      : false,
    timeout: 600000,
  },
  async (t) => {
    assert.match(expectedManifestSha256 ?? "", /^[a-f0-9]{64}$/);
    await fs.mkdir(output, { mode: 0o700 });
    const root = await fs.realpath(
      await fs.mkdtemp(join(tmpdir(), "daedlo-model-migration-")),
    );
    const [
      { nativeCommand },
      { createNinjaManager },
      { createNinjaSupervisor },
      { frontendIdentity },
      { readNinjaConfig, NINJA_CONTRACTS },
      { prepareInstallation, verifyInstallation },
      { verifyBundle },
    ] = await Promise.all([
      load("native"),
      load("ninja-manager"),
      load("ninja-supervisor"),
      load("native-session"),
      load("ninja"),
      load("ninja-installation"),
      load("manifest"),
    ]);
    const verified = await verifyBundle(resolve(bundle), {
      expectedManifestSha256,
    });
    const version = verified.manifest.version;
    const result = {
      status: "RUNNING",
      cleanup: "PENDING",
      checks: [],
      toolsRoot,
      runtimePath,
      engineCrate: crate,
      scope:
        "Real installed bundle and native tools with independent managed starter; local verified bundle transport; no customer acceptance or publication",
      bundle: { version, manifestSha256: expectedManifestSha256 },
      tools: Object.fromEntries(
        await Promise.all(
          ["native", "ninja-manager", "ninja-supervisor", "ninja-child"].map(
            async (name) => [
              name,
              sha(await fs.readFile(join(toolsRoot, name + ".mjs"))),
            ],
          ),
        ),
      ),
    };
    const record = async (name) => {
      result.checks.push(name);
      await writeJson(join(output, "result.json"), result);
    };
    const owners = [],
      supervisors = [];
    let app, controller;
    t.after(async () => {
      const failures = [];
      for (const owner of owners.reverse()) {
        try {
          await owner.close();
          await owner.closed;
        } catch (e) {
          failures.push(e.message);
        }
      }
      for (const supervisor of supervisors.reverse()) {
        try {
          await supervisor.close();
        } catch (e) {
          failures.push(e.message);
        }
      }
      for (const resource of [controller, app]) {
        try {
          await resource?.close();
        } catch (e) {
          failures.push(e.message);
        }
      }
      result.cleanup = failures.length ? "INCOMPLETE" : "PASS";
      if (result.status === "RUNNING" || failures.length)
        result.status = "FAIL";
      result.cleanupErrors = failures;
      await writeJson(join(output, "result.json"), result);
      if (failures.length)
        throw new Error(
          "Owned migration fixture cleanup incomplete; retained " + root,
        );
      if (result.status === "PASS")
        await fs.rm(root, { recursive: true, force: true });
    });
    app = await createStarterFixture();
    const prepared = await prepareManagedStarter({
      output: join(root, "integration"),
      crate,
      origin: app.url,
      trustFile: join(repo, "docs/update-trust/daedlo-release-2026-10.pem"),
      projectId: "reviewed-model-migration",
      frontendName: "Reviewed model migration",
    });
    // Installed dependencies use this test's cache; no customer dependency tree
    // is modified. Later model preparations reuse the same exact release bytes.
    prepared.config.installation = {
      offline: false,
      npmCache: join(root, "npm-cache"),
    };
    await writeJson(prepared.configPath, prepared.config);
    const { chromium } = createRequire(runtimePath)("playwright");
    controller = await chromium.launch({
      headless: true,
      handleSIGINT: false,
      handleSIGTERM: false,
    });
    const page = await controller.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    let downloads = 0;
    const deps = {
      readConfig: readNinjaConfig,
      async open(configPath, { recover = true } = {}) {
        const { config, installation } = await readNinjaConfig(configPath);
        const supervisor = await createNinjaSupervisor({
          root: join(config.store, "supervisor"),
          settings: config.settings,
          frontend: frontendIdentity(config),
        });
        supervisors.push(supervisor);
        const manager = await createNinjaManager({
          root: config.store,
          registration: config.registration,
          recover,
          supervisor,
          installer: {
            prepare: (args) =>
              prepareInstallation({ ...args, ...installation }),
            verify: verifyInstallation,
          },
          provider: {
            async check() {
              return {
                checkpoint: { generation: 1 },
                available: { id: "selected-local-bundle", version },
              };
            },
            async download(_release, destination) {
              downloads++;
              const bundlePath = join(
                destination,
                `daedlo-${version}`,
                "bundle",
              );
              await fs.cp(resolve(bundle), bundlePath, {
                recursive: true,
                force: false,
                errorOnExist: true,
              });
              return {
                bundlePath,
                identity: {
                  version,
                  manifestSha256: expectedManifestSha256,
                  contracts: NINJA_CONTRACTS,
                },
              };
            },
          },
        });
        return { manager, supervisor };
      },
    };
    const command = async (action, options = {}) => {
      const result = await nativeCommand(action, prepared.configPath, {
        ...deps,
        ...options,
      });
      // Retain even unexpected failed-startup handles before assertions, so a
      // regression cannot leave a test-owned controller alive after cleanup.
      if (result.close) owners.push(result);
      return result;
    };
    const start = async (action = "start", options = {}) => {
      const owner = await command(action, options);
      assert.equal(
        owner.result.status,
        "running",
        JSON.stringify(owner.result),
      );
      return owner;
    };
    const viewerCommand = async (viewerUrl, id, params = {}) => {
      const origin = new URL(viewerUrl).origin;
      const state = await fetch(origin + "/status").then((r) => r.json());
      const response = await fetch(origin + "/command", {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ id, params, revision: state.driver.revision }),
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    await command("setup", { version });
    const first = await start();
    const acceptedState = await readJson(
      join(prepared.config.store, "state.json"),
    );
    const accepted = await verifyInstallation(
      join(prepared.config.store, "installations", acceptedState.current),
      { checkSource: true },
    );
    await viewerCommand(first.result.viewerUrl, "edit", {
      text: "Before model migration",
      category: "plain",
    });
    const firstSave = await viewerCommand(first.result.viewerUrl, "save");
    assert.equal(firstSave.effect.status, "saved");
    assert.equal(app.writes, 1);
    const archiveRoot = join(
      prepared.config.store,
      "supervisor",
      "run-reports",
    );
    const originalArchives = Object.fromEntries(
      await Promise.all(
        (await fs.readdir(archiveRoot)).map(async (name) => [
          name,
          sha(await fs.readFile(join(archiveRoot, name))),
        ]),
      ),
    );
    await command("stop");
    await first.closed;
    await record(
      "Accepted real model saves once; original native owner stops before model registration changes",
    );

    const modelFile = join(prepared.sourceRoot, "model/src/lib.rs");
    const adapterFile = join(prepared.sourceRoot, "starter/adapter.mjs");
    const oldModel = await fs.readFile(modelFile, "utf8");
    const oldAdapter = await fs.readFile(adapterFile, "utf8");
    const nextModel = oldModel.replace(
      '"id":"starter", "version":"1"',
      '"id":"starter", "version":"2"',
    );
    const nextAdapter = oldAdapter.replace(
      'model: { id: "starter", version: "1" }',
      'model: { id: "starter", version: "2" }',
    );
    assert.notEqual(nextModel, oldModel);
    assert.notEqual(nextAdapter, oldAdapter);
    await fs.writeFile(modelFile, nextModel);
    await fs.writeFile(adapterFile, nextAdapter);
    const changedDescriptor = {
      ...accepted.handshake.descriptor,
      version: "2",
    };
    prepared.config.registration.model.version = "2";
    prepared.config.registration.descriptorSha256 = sha(
      JSON.stringify(changedDescriptor),
    );
    await writeJson(prepared.configPath, prepared.config);
    await assert.rejects(command("refresh"), { code: "migration_required" });
    assert.equal(
      (await readJson(join(prepared.config.store, "state.json"))).current,
      accepted.id,
    );
    const migration = await command("migrate-prepare");
    assert.equal(migration.result.operation.status, "review_required");
    assert.equal(
      downloads,
      1,
      "Migration uses the retained exact bundle without another download",
    );
    const operation = migration.result.operation.id;
    const reviewed = await command("migrate-review", { operation });
    const review = reviewed.result.migration;
    assert.equal(review.accepted.descriptor.version, "1");
    assert.equal(review.candidate.descriptor.version, "2");
    assert.equal(
      review.candidate.descriptorSha256,
      prepared.config.registration.descriptorSha256,
    );
    await writeJson(join(output, "private-model-review.json"), review);
    await assert.rejects(command("restart"), { code: "action_unavailable" });
    await assert.rejects(
      command("migrate-activate", { operation, reviewSha256: "0".repeat(64) }),
      { code: "migration_review_required" },
    );
    assert.equal(
      (await readJson(join(prepared.config.store, "state.json"))).current,
      accepted.id,
    );
    assert.equal(app.writes, 1);
    await record(
      "Real compiled version/pin change requires exact review; ordinary refresh/restart and wrong review refuse without application effects",
    );

    const migrated = await start("migrate-activate", {
      operation,
      reviewSha256: review.reviewSha256,
    });
    const current = await fetch(
      new URL("/status", migrated.result.viewerUrl),
    ).then((r) => r.json());
    assert.equal(current.driver.descriptor.version, "2");
    assert.equal(app.writes, 1, "Activation never replays the accepted save");
    await page.goto(migrated.result.viewerUrl);
    await page.locator('[data-command="edit"]').waitFor();
    await viewerCommand(migrated.result.viewerUrl, "edit", {
      text: "After reviewed model migration",
      category: "work",
    });
    const nextSave = await viewerCommand(migrated.result.viewerUrl, "save");
    assert.equal(nextSave.effect.status, "saved");
    const notes = await fetch(app.url + "/api/notes").then((r) => r.json());
    assert.equal(notes.items.length, 2);
    assert.equal(app.writes, 2);
    await page
      .locator("#effect-label")
      .filter({ hasText: "Application effect: Saved" })
      .waitFor();
    await page.screenshot({
      path: join(output, "migrated-model-saved.png"),
      fullPage: true,
    });
    const histories = await Promise.all(
      (await fs.readdir(join(prepared.config.store, "history"))).map(
        async (name) => readJson(join(prepared.config.store, "history", name)),
      ),
    );
    const transaction = histories.find((entry) => entry.target === operation);
    assert.equal(transaction.phase, "committed");
    assert.equal(transaction.migration.reviewSha256, review.reviewSha256);
    for (const [name, digest] of Object.entries(originalArchives))
      assert.equal(sha(await fs.readFile(join(archiveRoot, name))), digest);
    await record(
      "Reviewed candidate serves real version-2 model, saves exactly once and preserves prior reports and migration history",
    );

    await page.goto(migrated.result.updateUrl);
    await page.locator("#acknowledge").check();
    await page
      .getByRole("button", { name: "Revert update", exact: true })
      .click();
    await page
      .locator("#phase-title")
      .filter({ hasText: "Previous installation selected" })
      .waitFor();
    const rolledBack = (await command("status")).result;
    const restored = await fetch(new URL("/status", rolledBack.viewerUrl)).then(
      (r) => r.json(),
    );
    assert.equal(restored.driver.descriptor.version, "1");
    assert.equal(
      (await readJson(join(prepared.config.store, "state.json"))).current,
      accepted.id,
    );
    assert.equal(await fs.readFile(modelFile, "utf8"), nextModel);
    assert.equal(await fs.readFile(adapterFile, "utf8"), nextAdapter);
    assert.equal(app.writes, 2);
    assert.equal((await fetch(app.url)).ok, true);
    await viewerCommand(rolledBack.viewerUrl, "edit", {
      text: "Rollback remains usable",
      category: "plain",
    });
    await viewerCommand(rolledBack.viewerUrl, "discard");
    await page.locator("#blockers:empty").waitFor({ state: "attached" });
    await page.screenshot({
      path: join(output, "rollback-history.png"),
      fullPage: true,
    });
    await command("stop");
    await migrated.closed;
    assert.equal((await fetch(app.url)).ok, true);
    assert.equal(app.writes, 2);
    await record(
      "Visible Revert restores real version-1 model while preserving authored version-2 source, saved data, attached application and safe cleanup",
    );
    result.status = "PASS";
  },
);
