import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  symlink,
  rm,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./prepare.mjs", import.meta.url));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
for (const kind of ["regular", "symlink", "wrong-prefix"]) {
  test(`prepared crate accepts only scoped regular entries: ${kind}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "seeruntime-prepare-"));
    try {
      const bundle = join(root, "bundle"),
        source = join(root, "source"),
        version = "0.1.1-rc.2";
      await mkdir(bundle);
      await mkdir(source);
      const prefix =
        kind === "wrong-prefix"
          ? "outside"
          : `browser-driver-engine-${version}`;
      await mkdir(join(source, prefix));
      if (kind === "symlink")
        await symlink("../outside", join(source, prefix, "README.md"));
      else await writeFile(join(source, prefix, "README.md"), "fixture");
      const engineFile = `browser-driver-engine-${version}.crate`,
        runtimeFile = `browser-driver-runtime-${version}.tgz`;
      execFileSync("tar", [
        "-cf",
        join(bundle, engineFile),
        "-C",
        source,
        prefix,
      ]);
      await writeFile(join(bundle, runtimeFile), "unused runtime fixture");
      const artifacts = {};
      for (const [key, file] of [
        ["engine", engineFile],
        ["runtime", runtimeFile],
      ]) {
        const bytes = await readFile(join(bundle, file));
        artifacts[key] = { name: key === "runtime" ? "@browser-driver/runtime" : "browser-driver-engine", file, sha256: hash(bytes), bytes: bytes.length };
      }
      const manifest = JSON.stringify({ version, artifacts });
      await writeFile(join(bundle, "manifest.json"), manifest);
      const result = spawnSync(
        process.execPath,
        [script, bundle, join(root, "consumer"), hash(manifest)],
        { encoding: "utf8" },
      );
      if (kind === "regular") {
        assert.equal(result.status, 0, result.stderr);
        assert.equal(
          await readFile(
            join(root, "consumer/engine-package", prefix, "README.md"),
            "utf8",
          ),
          "fixture",
        );
      } else {
        assert.notEqual(result.status, 0);
        assert.match(
          result.stderr,
          /only regular files and directories under its exact package prefix/,
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
