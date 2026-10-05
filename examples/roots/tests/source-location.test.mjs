import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const scripts = [
  "examples/roots/prepare-live.mjs",
  "integrations/roots/prepare.mjs",
  "integrations/roots/verify-preserved.mjs",
];

for (const script of scripts) {
  for (const explicit of [false, true]) {
    test(`${script} selects ${explicit ? "explicit ROOTS_SOURCE" : "its sibling Roots checkout independently of cwd"}`, async (t) => {
      const root = await fs.realpath(
        await fs.mkdtemp(join(tmpdir(), "roots-source-location-")),
      );
      t.after(() => fs.rm(root, { recursive: true, force: true }));
      const checkout = join(root, "browser-driver");
      const copiedScript = join(checkout, script);
      const bin = join(root, "bin");
      const cwd = join(root, "unrelated-cwd");
      const output = join(root, "output");
      const receipt = join(root, "git-args.json");
      for (const path of [dirname(copiedScript), bin, cwd, output])
        await fs.mkdir(path, { recursive: true });
      await fs.copyFile(join(repository, script), copiedScript);
      await fs.writeFile(
        join(output, "live-before.json"),
        JSON.stringify({ trackedHashes: {}, head: "unused", status: "" }),
      );
      // Stop at the first Git lookup: inspect its real arguments without
      // reading a customer checkout, building an app or starting services.
      await fs.writeFile(
        join(bin, "git"),
        `#!${process.execPath}\nrequire("node:fs").writeFileSync(process.env.ROOTS_TEST_GIT_ARGS, JSON.stringify(process.argv.slice(2))); process.exit(73);\n`,
        { mode: 0o755 },
      );
      const env = {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        ROOTS_TEST_GIT_ARGS: receipt,
        ROOTS_EXPERIENCE_ARTIFACTS: output,
        ROOTS_CONSUMER_ARTIFACTS: output,
      };
      const expectedSource = join(
        root,
        explicit ? "selected-customer" : "roots",
      );
      if (explicit) env.ROOTS_SOURCE = expectedSource;
      else delete env.ROOTS_SOURCE;
      const result = spawnSync(process.execPath, [copiedScript], {
        cwd,
        env,
        encoding: "utf8",
        timeout: 10000,
      });
      assert.equal(result.status, 1, "the intentional Git stop must end setup");
      const args = JSON.parse(await fs.readFile(receipt, "utf8"));
      assert.deepEqual(args.slice(0, 2), ["-C", expectedSource]);
      assert.ok(args.length > 2, "inspect an actual Git invocation");
    });
  }
}
