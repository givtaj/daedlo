import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const repository = fileURLToPath(new URL("../", import.meta.url));
const version = "0.0.0-installer-fixture";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function fixture(t, nested) {
  const root = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "daedlo-installer-test-")),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const ancestor = join(root, "customer-workspace");
  const kit = nested
    ? join(ancestor, "artifacts", `daedlo-${version}`)
    : join(root, `daedlo-${version}`);
  const tools = join(kit, "tools");
  const bundle = join(kit, "bundle");
  const source = join(root, "fixture-package");
  const cache = join(root, "npm-cache");
  for (const path of [tools, bundle, join(source, "lib"), cache])
    await fs.mkdir(path, { recursive: true });
  const environment = { ...process.env };
  for (const name of Object.keys(environment))
    if (/^npm_config_/i.test(name)) delete environment[name];
  Object.assign(environment, {
    npm_config_cache: cache,
    npm_config_userconfig: join(root, "empty-user.npmrc"),
    npm_config_globalconfig: join(root, "empty-global.npmrc"),
    npm_config_update_notifier: "false",
  });
  await fs.writeFile(environment.npm_config_userconfig, "");
  await fs.writeFile(environment.npm_config_globalconfig, "");
  const preserved = new Map();
  if (nested) {
    const pkg = {
      name: "unrelated-customer-workspace",
      version: "1.0.0",
      private: true,
      workspaces: ["packages/*"],
    };
    const files = {
      "package.json": JSON.stringify(pkg, null, 2) + "\n",
      "package-lock.json":
        JSON.stringify(
          {
            name: pkg.name,
            version: pkg.version,
            lockfileVersion: 3,
            requires: true,
            packages: {
              "": pkg,
              "node_modules/existing-customer": {
                resolved: "packages/customer",
                link: true,
              },
              "packages/customer": {
                name: "existing-customer",
                version: "1.0.0",
              },
            },
          },
          null,
          2,
        ) + "\n",
      "packages/customer/package.json":
        '{"name":"existing-customer","version":"1.0.0","private":true}\n',
      "packages/customer/retained.txt":
        "Existing customer work must survive.\n",
    };
    for (const [path, text] of Object.entries(files)) {
      const destination = join(ancestor, path);
      await fs.mkdir(dirname(destination), { recursive: true });
      await fs.writeFile(destination, text);
      preserved.set(destination, Buffer.from(text));
    }
  }
  const manifest = Buffer.from('{"fixture":"verified local bundle"}\n');
  await fs.writeFile(join(bundle, "manifest.json"), manifest);
  const manifestDigest = hash(manifest);
  await fs.writeFile(
    join(source, "package.json"),
    JSON.stringify({
      name: "@browser-driver/release-tools",
      version,
      private: true,
      type: "module",
      files: ["lib"],
    }) + "\n",
  );
  const cli = `import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const expectedBundle = ${JSON.stringify(bundle)};
const expectedDigest = ${JSON.stringify(manifestDigest)};
assert.deepEqual(process.argv.slice(2), ['verify', '--bundle', expectedBundle, '--sha256', expectedDigest]);
assert.equal(createHash('sha256').update(readFileSync(join(expectedBundle, 'manifest.json'))).digest('hex'), expectedDigest);
writeFileSync(join(process.cwd(), 'cli-invocation.json'), JSON.stringify({module:import.meta.url,cwd:process.cwd(),args:process.argv.slice(2),status:'PASS'})+'\\n', {flag:'wx'});
console.log('Fixture CLI verified exact local bundle arguments and digest.');
`;
  await fs.writeFile(join(source, "lib/consumer-cli.mjs"), cli);
  const packed = JSON.parse(
    execFileSync(
      "npm",
      [
        "pack",
        source,
        "--json",
        "--offline",
        "--ignore-scripts",
        "--pack-destination",
        tools,
      ],
      { cwd: root, env: environment, encoding: "utf8", timeout: 30000 },
    ),
  );
  assert.equal(packed.length, 1);
  const archive = join(tools, `browser-driver-tools-${version}.tgz`);
  await fs.rename(join(tools, packed[0].filename), archive);
  const template = await fs.readFile(
    join(repository, "docs/public-downloads/START_HERE.md"),
    "utf8",
  );
  const blocks = [...template.matchAll(/^```sh\n([\s\S]*?)^```$/gm)];
  assert.equal(blocks.length, 1, "Execute the exact shipped installer block");
  const script = blocks[0][1]
    .replaceAll("{{VERSION}}", version)
    .replaceAll("{{TOOLS_SHA256}}", hash(await fs.readFile(archive)))
    .replaceAll("{{MANIFEST_SHA256}}", manifestDigest);
  assert.doesNotMatch(script, /{{[A-Z_]+}}/);
  return {
    root,
    ancestor,
    kit,
    environment,
    preserved,
    script,
    manifestDigest,
  };
}

for (const nested of [false, true]) {
  test(`exact shipped installer stays local ${nested ? "inside an unrelated npm workspace" : "outside npm workspaces"}`, async (t) => {
    const f = await fixture(t, nested);
    const run = spawnSync("/bin/sh", ["-s"], {
      cwd: f.kit,
      input: f.script,
      env: f.environment,
      encoding: "utf8",
      timeout: 30000,
    });
    const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
    for (const [path, before] of f.preserved)
      assert.equal(
        (await fs.readFile(path)).toString(),
        before.toString(),
        `Installer must preserve ancestor file bytes: ${path}\n${output}`,
      );
    assert.ifError(run.error);
    assert.equal(run.signal, null, output);
    assert.equal(run.status, 0, output);
    const installed = join(f.kit, "installed-tools");
    const packageRoot = join(
      installed,
      "node_modules/@browser-driver/release-tools",
    );
    assert.equal((await fs.lstat(packageRoot)).isDirectory(), true);
    const pkg = JSON.parse(
      await fs.readFile(join(packageRoot, "package.json"), "utf8"),
    );
    assert.equal(pkg.name, "@browser-driver/release-tools");
    assert.equal(pkg.version, version);
    const invocation = JSON.parse(
      await fs.readFile(join(installed, "cli-invocation.json"), "utf8"),
    );
    assert.equal(invocation.status, "PASS");
    assert.equal(invocation.cwd, installed);
    assert.equal(
      invocation.module,
      pathToFileURL(join(packageRoot, "lib/consumer-cli.mjs")).href,
    );
    assert.deepEqual(invocation.args, [
      "verify",
      "--bundle",
      join(f.kit, "bundle"),
      "--sha256",
      f.manifestDigest,
    ]);
    if (nested)
      await assert.rejects(
        fs.access(
          join(f.ancestor, "node_modules/@browser-driver/release-tools"),
        ),
        { code: "ENOENT" },
      );
  });
}
