import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { buildPublicKit } from "../scripts/release/public-kit.mjs";
import { createManifest } from "../scripts/release/manifest.mjs";

const version = "0.1.2-rc.1";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const notices = {
  LICENSE: "MIT License. Roots-derived portions retain Apache-2.0.\n",
  "THIRD_PARTY_NOTICES.md": "Roots origins and applicable component notices.\n",
  "licenses/Apache-2.0.txt": "Apache License, Version 2.0\n",
  "licenses/MIT-legacy.txt": "MIT License\n",
};
const templates = {
  "START_HERE.md":
    "# Daedlo {{VERSION}}\nManifest {{MANIFEST_SHA256}}\nTools {{TOOLS_SHA256}}\n",
  "AGENT_START.md": "Use exact Daedlo {{VERSION}} and {{MANIFEST_SHA256}}.\n",
};

function tar(files, prefix, link) {
  return execFileSync(
    "python3",
    [
      "-c",
      `import io,json,sys,tarfile
p=json.load(sys.stdin)
o=io.BytesIO()
with tarfile.open(fileobj=o,mode='w:gz') as t:
 for name,data in sorted(p['files'].items()):
  b=data.encode(); i=tarfile.TarInfo(p['prefix']+'/'+name); i.size=len(b); i.mode=0o644; i.mtime=0; t.addfile(i,io.BytesIO(b))
 if p.get('link'):
  i=tarfile.TarInfo(p['prefix']+'/bad-link'); i.type=tarfile.SYMTYPE; i.linkname=p['link']; t.addfile(i)
sys.stdout.buffer.write(o.getvalue())`,
    ],
    { input: JSON.stringify({ files, prefix, link }), maxBuffer: 1024 * 1024 },
  );
}

function unzip(path) {
  return JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        `import base64,json,sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
 print(json.dumps([{'name':i.filename,'date':i.date_time,'mode':i.external_attr>>16,'bytes':base64.b64encode(z.read(i)).decode()} for i in z.infolist()]))`,
        path,
      ],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    ),
  );
}

async function fixture(t) {
  const directory = await fs.realpath(
    await fs.mkdtemp(join(os.tmpdir(), "daedlo-kit-test-")),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const repoRoot = join(directory, "source");
  const bundle = join(directory, "bundle");
  const tools = join(directory, "tools");
  for (const path of [repoRoot, bundle, tools]) await fs.mkdir(path);
  for (const [file, content] of Object.entries(notices)) {
    await fs.mkdir(dirname(join(repoRoot, file)), { recursive: true });
    await fs.writeFile(join(repoRoot, file), content);
  }
  for (const [file, content] of Object.entries(templates)) {
    await fs.mkdir(join(repoRoot, "docs/public-downloads"), {
      recursive: true,
    });
    await fs.writeFile(join(repoRoot, "docs/public-downloads", file), content);
  }
  const f = {
    directory,
    repoRoot,
    bundle,
    tools,
    output: join(directory, "public"),
    source: { commit: "a".repeat(40), dirty: true, treeSha256: "b".repeat(64) },
    runtimeFiles: {
      ...notices,
      "package.json": JSON.stringify({
        name: "@browser-driver/runtime",
        version,
        license: "MIT AND Apache-2.0",
      }),
      "src/index.mjs": "export const fixture = true;\n",
    },
    engineFiles: {
      ...notices,
      "Cargo.toml": `[package]\nname = "browser-driver-engine"\nversion = "${version}"\nlicense = "MIT AND Apache-2.0"\n`,
      "src/lib.rs": "pub fn fixture() {}\n",
    },
    toolsFiles: {
      ...notices,
      "package.json": JSON.stringify({
        name: "@browser-driver/release-tools",
        version,
        license: "MIT AND Apache-2.0",
        private: true,
        type: "module",
      }),
      "lib/consumer-cli.mjs": "console.log('fixture');\n",
      "skills/browser-driver/SKILL.md": "# Fixture skill\n",
    },
  };
  await refreshBundle(f);
  await refreshTools(f);
  return f;
}

async function refreshBundle(f, runtimeLink) {
  const artifacts = {};
  for (const [kind, files, prefix, suffix, name] of [
    ["runtime", f.runtimeFiles, "package", "tgz", "@browser-driver/runtime"],
    [
      "engine",
      f.engineFiles,
      `browser-driver-engine-${version}`,
      "crate",
      "browser-driver-engine",
    ],
  ]) {
    const bytes = tar(
      files,
      prefix,
      kind === "runtime" ? runtimeLink : undefined,
    );
    const file = `browser-driver-${kind}-${version}.${suffix}`;
    artifacts[kind] = {
      file,
      name,
      version,
      sha256: hash(bytes),
      bytes: bytes.length,
    };
    await fs.writeFile(join(f.bundle, file), bytes);
  }
  f.manifest = createManifest({ version, source: f.source, artifacts });
  const bytes = Buffer.from(JSON.stringify(f.manifest) + "\n");
  f.expectedManifestSha256 = hash(bytes);
  await fs.writeFile(join(f.bundle, "manifest.json"), bytes);
  await fs.writeFile(
    join(f.bundle, "SHA256SUMS"),
    `${artifacts.runtime.sha256}  ${artifacts.runtime.file}\n${artifacts.engine.sha256}  ${artifacts.engine.file}\n${f.expectedManifestSha256}  manifest.json\n`,
  );
}

async function refreshTools(f, source = f.source) {
  const payload = Object.entries(f.toolsFiles)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([file, content]) => ({
      file,
      bytes: Buffer.byteLength(content),
      sha256: hash(content),
      mode: 0o644,
    }));
  const sourceReceipt = {
    schemaVersion: 1,
    kind: "browser-driver-release-tools",
    name: "@browser-driver/release-tools",
    version,
    source,
    files: payload,
  };
  const bytes = tar(
    { ...f.toolsFiles, "SOURCE.json": JSON.stringify(sourceReceipt) + "\n" },
    "package",
  );
  const file = `browser-driver-tools-${version}.tgz`;
  f.expectedToolsSha256 = hash(bytes);
  f.toolsReceipt = {
    ...sourceReceipt,
    archive: { file, sha256: f.expectedToolsSha256, bytes: bytes.length },
    fileCount: payload.length + 1,
  };
  const receiptBytes = Buffer.from(JSON.stringify(f.toolsReceipt) + "\n");
  await fs.writeFile(join(f.tools, file), bytes);
  await fs.writeFile(join(f.tools, "TOOLS_VERIFICATION.json"), receiptBytes);
  await fs.writeFile(
    join(f.tools, "TOOLS_SHA256SUMS"),
    `${f.expectedToolsSha256}  ${file}\n${hash(receiptBytes)}  TOOLS_VERIFICATION.json\n`,
  );
}

test("public kit preserves exact verified bytes, rendered instructions and only allowed files", async (t) => {
  const f = await fixture(t);
  const result = await buildPublicKit(f);
  assert.equal(
    result.version,
    version,
    "The public download must identify the verified package version",
  );
  const archiveFile = `daedlo-${version}.zip`;
  assert.deepEqual(
    (await fs.readdir(f.output)).sort(),
    ["SHA256SUMS", archiveFile, "release.json"].sort(),
  );
  const release = JSON.parse(
    await fs.readFile(join(f.output, "release.json"), "utf8"),
  );
  const archive = await fs.readFile(join(f.output, archiveFile));
  assert.equal(release.schemaVersion, 1);
  assert.equal(release.version, version);
  assert.deepEqual(release.archive, {
    file: archiveFile,
    bytes: archive.length,
    sha256: hash(archive),
  });
  assert.deepEqual(
    release.source,
    f.source,
    "Candidate provenance must retain its dirty flag",
  );
  assert.equal(
    await fs.readFile(join(f.output, "SHA256SUMS"), "utf8"),
    `${hash(archive)}  ${archiveFile}\n`,
  );
  const contents = unzip(join(f.output, archiveFile));
  const expected = new Map();
  for (const [file, bytes] of Object.entries(notices))
    expected.set(file, Buffer.from(bytes));
  for (const [file, text] of Object.entries(templates))
    expected.set(
      file,
      Buffer.from(
        text
          .replaceAll("{{VERSION}}", version)
          .replaceAll("{{MANIFEST_SHA256}}", f.expectedManifestSha256)
          .replaceAll("{{TOOLS_SHA256}}", f.expectedToolsSha256),
      ),
    );
  for (const [prefix, dir] of [
    ["bundle", f.bundle],
    ["tools", f.tools],
  ])
    for (const file of await fs.readdir(dir))
      expected.set(`${prefix}/${file}`, await fs.readFile(join(dir, file)));
  assert.deepEqual(
    contents.map(({ name }) => name),
    [...expected.keys()].sort().map((file) => `daedlo-${version}/${file}`),
  );
  for (const item of contents) {
    assert.deepEqual(item.date, [1980, 1, 1, 0, 0, 0]);
    assert.equal(item.mode & 0o777, 0o644);
    assert.deepEqual(
      Buffer.from(item.bytes, "base64"),
      expected.get(item.name.slice(`daedlo-${version}/`.length)),
    );
  }
  const second = join(f.directory, "second");
  await buildPublicKit({ ...f, output: second });
  assert.deepEqual(
    await fs.readFile(join(second, archiveFile)),
    archive,
    "Same inputs must produce identical ZIP bytes",
  );
});

test("public kit rejects a trusted hash mismatch before creating output", async (t) => {
  for (const field of ["expectedManifestSha256", "expectedToolsSha256"]) {
    const f = await fixture(t);
    await assert.rejects(
      buildPublicKit({ ...f, [field]: "0".repeat(64) }),
      /digest|hash/i,
    );
    assert.equal(existsSync(f.output), false);
  }
});

test("public kit refuses unexpected input files, filesystem links and an existing output", async (t) => {
  for (const input of ["bundle", "tools"]) {
    const f = await fixture(t);
    await fs.writeFile(join(f[input], "private.env"), "Do not distribute\n");
    await assert.rejects(buildPublicKit(f), /inventory|unexpected|files/i);
    assert.equal(existsSync(f.output), false);
  }
  const f = await fixture(t);
  const original = join(f.repoRoot, "LICENSE");
  await fs.rename(original, original + ".original");
  await fs.symlink(original + ".original", original);
  await assert.rejects(buildPublicKit(f), /symlink|regular/i);
  const g = await fixture(t);
  await fs.mkdir(g.output);
  await fs.writeFile(join(g.output, "keep"), "keep");
  await assert.rejects(buildPublicKit(g), /exist/i);
  assert.equal(await fs.readFile(join(g.output, "keep"), "utf8"), "keep");
});

test("public kit rejects archive links even when the archive digest is trusted", async (t) => {
  const f = await fixture(t);
  await refreshBundle(f, "/private/file");
  await assert.rejects(buildPublicKit(f), /archive|link|regular/i);
  assert.equal(existsSync(f.output), false);
});

test("public kit rejects unsafe archive paths and draft package instructions", async (t) => {
  const f = await fixture(t);
  f.runtimeFiles["../outside"] = "Do not extract\n";
  await refreshBundle(f);
  await assert.rejects(buildPublicKit(f), /archive|path/i);
  assert.equal(existsSync(f.output), false);

  const g = await fixture(t);
  g.toolsFiles["docs/releases.md"] =
    "DRAFT — NOT OPERATIVE — NOT FOR CUSTOMER DISTRIBUTION\n";
  await refreshTools(g);
  await assert.rejects(buildPublicKit(g), /draft|evaluation/i);
  assert.equal(existsSync(g.output), false);
});

test("public kit permits an explicit statement that no evaluation agreement applies", async (t) => {
  const f = await fixture(t);
  f.toolsFiles["docs/releases.md"] =
    "This public preview carries no time-limited evaluation agreement.\n";
  await refreshTools(f);
  assert.equal((await buildPublicKit(f)).version, version);
});

test("public kit rejects evaluation material and mismatched component notices", async (t) => {
  for (const mutate of [
    async (f) => {
      await fs.writeFile(
        join(f.repoRoot, "LICENSE"),
        "DRAFT — NOT OPERATIVE — NOT FOR CUSTOMER DISTRIBUTION\n",
      );
    },
    async (f) => {
      f.runtimeFiles["EVALUATION-LICENSE.md"] = "Terms\n";
      await refreshBundle(f);
    },
    async (f) => {
      f.engineFiles.LICENSE = "Different grant\n";
      await refreshBundle(f);
    },
  ]) {
    const f = await fixture(t);
    await mutate(f);
    await assert.rejects(buildPublicKit(f), /draft|evaluation|notice|license/i);
    assert.equal(existsSync(f.output), false);
  }
});

test("public kit requires matching tool provenance and an honest payload inventory", async (t) => {
  const f = await fixture(t);
  await refreshTools(f, { ...f.source, treeSha256: "c".repeat(64) });
  await assert.rejects(buildPublicKit(f), /source|provenance/i);
  const g = await fixture(t);
  g.toolsReceipt.files[0].sha256 = "0".repeat(64);
  const bytes = Buffer.from(JSON.stringify(g.toolsReceipt) + "\n");
  await fs.writeFile(join(g.tools, "TOOLS_VERIFICATION.json"), bytes);
  await fs.writeFile(
    join(g.tools, "TOOLS_SHA256SUMS"),
    `${g.expectedToolsSha256}  browser-driver-tools-${version}.tgz\n${hash(bytes)}  TOOLS_VERIFICATION.json\n`,
  );
  await assert.rejects(buildPublicKit(g), /receipt|inventory|SOURCE|digest/i);
  assert.equal(existsSync(g.output), false);
});

test("public kit refuses unrendered template tokens", async (t) => {
  const f = await fixture(t);
  await fs.appendFile(
    join(f.repoRoot, "docs/public-downloads/START_HERE.md"),
    "{{UNKNOWN}}\n",
  );
  await assert.rejects(buildPublicKit(f), /placeholder|template/i);
  assert.equal(existsSync(f.output), false);
});

test("public kit requires the selected public license and effective engine version", async (t) => {
  for (const [label, mutate] of [
    [
      "runtime MIT-only declaration",
      async (f) => {
        const pkg = JSON.parse(f.runtimeFiles["package.json"]);
        pkg.license = "MIT";
        f.runtimeFiles["package.json"] = JSON.stringify(pkg);
        await refreshBundle(f);
      },
    ],
    [
      "tools draft-style declaration",
      async (f) => {
        const pkg = JSON.parse(f.toolsFiles["package.json"]);
        pkg.license = "SEE LICENSE IN LICENSE";
        f.toolsFiles["package.json"] = JSON.stringify(pkg);
        await refreshTools(f);
      },
    ],
    [
      "engine wrong license",
      async (f) => {
        f.engineFiles["Cargo.toml"] = f.engineFiles["Cargo.toml"].replace(
          'license = "MIT AND Apache-2.0"',
          'license = "MIT"',
        );
        await refreshBundle(f);
      },
    ],
    [
      "engine wrong version",
      async (f) => {
        f.engineFiles["Cargo.toml"] = f.engineFiles["Cargo.toml"].replace(
          `version = "${version}"`,
          'version = "0.0.1"',
        );
        await refreshBundle(f);
      },
    ],
  ]) {
    const f = await fixture(t);
    await mutate(f);
    await assert.rejects(buildPublicKit(f), /license|version|identity/i, label);
    assert.equal(existsSync(f.output), false);
  }
});
