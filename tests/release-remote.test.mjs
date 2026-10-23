import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createManifest,
  sha256,
  verifyBundle,
} from "../scripts/release/manifest.mjs";
import {
  checkForUpdates,
  downloadRelease,
} from "../scripts/release/remote.mjs";

const repo = "example/browser-driver";
const environment = {
  nodeVersion: "22.20.0",
  rustVersion: "1.96.0",
  protocol: 1,
};
const release = (version, changes = {}) => ({
  id: 1,
  tag_name: `v${version}`,
  draft: false,
  prerelease: version.includes("-"),
  ...changes,
});
async function temporary(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "driver-remote-test-")),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
function bundle(
  version = "0.2.0",
  change = () => {},
  prefix = "browser-driver",
) {
  const files = new Map();
  const artifacts = {};
  for (const [kind, name, extension] of [
    ["runtime", `@${prefix}/runtime`, "tgz"],
    ["engine", `${prefix}-engine`, "crate"],
  ]) {
    const bytes = Buffer.concat([
      Buffer.from([0, 255, 128]),
      Buffer.from(`${kind} exact immutable bytes`),
    ]);
    const file = `${prefix}-${kind}-${version}.${extension}`;
    files.set(file, bytes);
    artifacts[kind] = {
      file,
      name,
      version,
      sha256: sha256(bytes),
      bytes: bytes.length,
    };
  }
  const manifest = createManifest({
    version,
    source: {
      commit: "a".repeat(40),
      treeSha256: "b".repeat(64),
      dirty: false,
    },
    artifacts,
  });
  change(manifest);
  const raw = Buffer.from(JSON.stringify(manifest) + "\n");
  const digest = sha256(raw);
  files.set("manifest.json", raw);
  files.set(
    "SHA256SUMS",
    Buffer.from(
      `${artifacts.runtime.sha256}  ${artifacts.runtime.file}\n${artifacts.engine.sha256}  ${artifacts.engine.file}\n${digest}  manifest.json\n`,
    ),
  );
  return { files, manifest, digest };
}
function transportFor(fixture, version = fixture.manifest.version) {
  const calls = [];
  const assets = [...fixture.files].map(([name, bytes], index) => ({
    id: index + 1,
    name,
    size: bytes.length,
    state: "uploaded",
    digest: `sha256:${sha256(bytes)}`,
  }));
  const metadata = release(version, { assets });
  return {
    calls,
    metadata,
    async listReleases(input) {
      calls.push(["list", input]);
      return [metadata];
    },
    async getRelease(input) {
      calls.push(["get", input]);
      return metadata;
    },
    async downloadAsset(input) {
      calls.push(["asset", input]);
      return fixture.files.get(
        assets.find((asset) => asset.id === input.assetId)?.name,
      );
    },
  };
}

test("preview semantic ordering selects rc.10 over rc.2 and labels compatibility unverified", async () => {
  const transport = {
    async listReleases() {
      return [
        release("1.0.0-rc.2", { id: 2 }),
        release("1.0.0-rc.10", { id: 10 }),
        release("0.9.0", { id: 9 }),
      ];
    },
  };
  assert.deepEqual(
    await checkForUpdates({
      repo,
      currentVersion: "1.0.0-rc.2",
      channel: "preview",
      transport,
    }),
    {
      status: "update_available",
      repo,
      currentVersion: "1.0.0-rc.2",
      channel: "preview",
      version: "1.0.0-rc.10",
      tag: "v1.0.0-rc.10",
      url: `https://github.com/${repo}/releases/tag/v1.0.0-rc.10`,
      compatibility: "not_checked",
    },
  );
});

test("stable excludes draft and both forms of prerelease marking, never downgrades or replaces", async () => {
  const transport = {
    async listReleases() {
      return [
        release("2.0.0", { id: 20, draft: true }),
        release("1.9.0", { id: 19, prerelease: true }),
        release("1.8.0-rc.1", { id: 18, prerelease: false }),
        release("1.1.0", { id: 11 }),
      ];
    },
  };
  const result = await checkForUpdates({
    repo,
    currentVersion: "1.0.0",
    transport,
  });
  assert.equal(result.version, "1.1.0");
  for (const currentVersion of ["1.1.0", "1.2.0"]) {
    const current = await checkForUpdates({ repo, currentVersion, transport });
    assert.equal(current.status, "up_to_date");
    assert.equal(current.version, null);
    assert.equal(current.compatibility, "not_checked");
  }
});

test("discovery validates inputs and refuses malformed or incomplete pagination", async () => {
  const valid = {
    async listReleases() {
      return [];
    },
  };
  for (const bad of [
    { repo: "https://github.com/a/b" },
    { repo: "a/../b" },
    { currentVersion: "1.00.0" },
    { currentVersion: "1.0.0-rc.01" },
    { channel: "anything" },
  ]) {
    await assert.rejects(
      checkForUpdates({
        repo,
        currentVersion: "1.0.0",
        transport: valid,
        ...bad,
      }),
      /invalid|unsupported/i,
    );
  }
  for (const response of [
    { message: "not found" },
    [release("1.2.0", { draft: "false" })],
    [release("1.2.0", { tag_name: "nightly" })],
  ]) {
    await assert.rejects(
      checkForUpdates({
        repo,
        currentVersion: "1.0.0",
        transport: {
          async listReleases() {
            return response;
          },
        },
      }),
      /metadata|release|tag/i,
    );
  }
  let pages = 0;
  const endless = {
    async listReleases({ page, perPage }) {
      pages++;
      return Array.from({ length: perPage }, (_, i) =>
        release(`1.${page}.${i}`, { id: page * 100 + i }),
      );
    },
  };
  await assert.rejects(
    checkForUpdates({ repo, currentVersion: "1.0.0", transport: endless }),
    /pagination|limit|incomplete/i,
  );
  assert.ok(pages <= 10);
});

test("discovery reads later pages before declaring a result and propagates network failure", async () => {
  const pages = [];
  const transport = {
    async listReleases({ page, perPage }) {
      pages.push(page);
      return page === 1
        ? Array.from({ length: perPage }, (_, i) =>
            release(`0.1.${i}`, { id: i + 1 }),
          )
        : [release("2.0.0", { id: 1001 })];
    },
  };
  assert.equal(
    (await checkForUpdates({ repo, currentVersion: "1.0.0", transport }))
      .version,
    "2.0.0",
  );
  assert.deepEqual(pages, [1, 2]);
  transport.listReleases = async () => {
    throw Error("network unavailable");
  };
  await assert.rejects(
    checkForUpdates({ repo, currentVersion: "1.0.0", transport }),
    /network/,
  );
});

test("download publishes only the verified exact four-file bundle, leaving accepted state untouched", async (t) => {
  const root = await temporary(t),
    output = join(root, "download"),
    accepted = join(root, "current.json");
  await fs.writeFile(accepted, "accepted release state");
  const fixture = bundle(),
    transport = transportFor(fixture);
  transport.metadata.assets.push({
    id: 50,
    name: "agent-skill.tar.gz",
    size: 1,
    state: "uploaded",
    digest: null,
  });
  const result = await downloadRelease({
    repo,
    version: "0.2.0",
    output,
    expectedManifestSha256: fixture.digest,
    environment,
    transport,
  });
  assert.equal(result.bundlePath, output);
  assert.equal(result.manifestSha256, fixture.digest);
  assert.equal(result.compatibility, "checked");
  assert.deepEqual(
    (await fs.readdir(output)).sort(),
    [...fixture.files.keys()].sort(),
  );
  assert.equal(
    (
      await verifyBundle(output, {
        expectedManifestSha256: fixture.digest,
        environment,
      })
    ).manifest.version,
    "0.2.0",
  );
  assert.equal(await fs.readFile(accepted, "utf8"), "accepted release state");
  assert.deepEqual(transport.calls[0], ["get", { repo, tag: "v0.2.0" }]);
  assert.equal(transport.calls.filter(([name]) => name === "asset").length, 4);
});

test("trusted hash, exact release identity, clean source and complete assets are required", async (t) => {
  const root = await temporary(t);
  for (const [index, mutate, options] of [
    [0, () => {}, { expectedManifestSha256: undefined }],
    [
      1,
      (f, tx) => {
        tx.metadata.draft = true;
      },
      {},
    ],
    [
      2,
      (f, tx) => {
        tx.metadata.tag_name = "v0.3.0";
      },
      {},
    ],
    [
      3,
      (f, tx) => {
        tx.metadata.assets.pop();
      },
      {},
    ],
    [
      4,
      (f, tx) => {
        tx.metadata.assets.push({ ...tx.metadata.assets[0] });
      },
      {},
    ],
    [
      5,
      (f, tx) => {
        tx.metadata.assets[0].name = "../escape.tgz";
      },
      {},
    ],
    [
      6,
      (f, tx) => {
        tx.metadata.assets[0].size = 65 * 1024 * 1024;
      },
      {},
    ],
    [7, () => {}, { expectedManifestSha256: "f".repeat(64) }],
  ]) {
    const f = bundle(),
      transport = transportFor(f);
    mutate(f, transport);
    const output = join(root, `rejected-${index}`);
    await assert.rejects(
      downloadRelease({
        repo,
        version: "0.2.0",
        output,
        expectedManifestSha256: f.digest,
        transport,
        ...options,
      }),
    );
    await assert.rejects(fs.lstat(output), { code: "ENOENT" });
  }
  const dirty = bundle("0.2.0", (m) => {
    m.source.dirty = true;
  });
  await assert.rejects(
    downloadRelease({
      repo,
      version: "0.2.0",
      output: join(root, "dirty"),
      expectedManifestSha256: dirty.digest,
      transport: transportFor(dirty),
    }),
    /dirty|clean/i,
  );
});

test("tamper, wrong manifest version, incompatible environment and partial failure publish nothing", async (t) => {
  const root = await temporary(t);
  const f = bundle(),
    transport = transportFor(f);
  const originalDownload = transport.downloadAsset.bind(transport);
  transport.downloadAsset = async (input) =>
    input.assetId === 1
      ? Buffer.from("tampered bytes")
      : originalDownload(input);
  await assert.rejects(
    downloadRelease({
      repo,
      version: "0.2.0",
      output: join(root, "tamper"),
      expectedManifestSha256: f.digest,
      transport,
    }),
    /digest|size|checksum/i,
  );
  transport.downloadAsset = async (input) => {
    if (input.assetId === 2) throw Error("partial network failure");
    return originalDownload(input);
  };
  await assert.rejects(
    downloadRelease({
      repo,
      version: "0.2.0",
      output: join(root, "partial"),
      expectedManifestSha256: f.digest,
      transport,
    }),
    /network/,
  );
  const wrong = bundle("0.3.0"),
    wrongTransport = transportFor(wrong, "0.2.0");
  for (const asset of wrongTransport.metadata.assets)
    asset.name = asset.name.replace("0.3.0", "0.2.0");
  wrongTransport.downloadAsset = async ({ assetId }) =>
    [...wrong.files.values()][assetId - 1];
  await assert.rejects(
    downloadRelease({
      repo,
      version: "0.2.0",
      output: join(root, "wrong"),
      expectedManifestSha256: wrong.digest,
      transport: wrongTransport,
    }),
    /version|file/i,
  );
  await assert.rejects(
    downloadRelease({
      repo,
      version: "0.2.0",
      output: join(root, "incompatible"),
      expectedManifestSha256: f.digest,
      transport: transportFor(f),
      environment: { ...environment, protocol: 9 },
    }),
    /protocol/,
  );
  assert.deepEqual(await fs.readdir(root), []);
});

test("unsafe paths and preexisting destinations are rejected without alteration", async (t) => {
  const root = await temporary(t),
    f = bundle();
  const target = join(root, "existing");
  await fs.mkdir(target);
  await fs.writeFile(join(target, "keep"), "unchanged");
  const link = join(root, "link");
  await fs.symlink(target, link);
  for (const output of [
    target,
    link,
    join(link, "child"),
    `${root}/../escape`,
    join(root, "missing-parent", "child"),
  ]) {
    await assert.rejects(
      downloadRelease({
        repo,
        version: "0.2.0",
        output,
        expectedManifestSha256: f.digest,
        transport: transportFor(f),
      }),
      /path|exist|parent|symlink|traversal/i,
    );
  }
  assert.equal(await fs.readFile(join(target, "keep"), "utf8"), "unchanged");
});

test("preview ordering handles stable, numeric/text identifiers and large semantic versions precisely", async () => {
  for (const [currentVersion, candidate] of [
    ["1.0.0-rc.10", "1.0.0"],
    ["1.0.0-10", "1.0.0-alpha"],
    ["1.0.0-rc", "1.0.0-rc.1"],
    ["9007199254740992.0.0", "9007199254740993.0.0"],
  ]) {
    const transport = {
      async listReleases() {
        return [release(candidate)];
      },
    };
    assert.equal(
      (
        await checkForUpdates({
          repo,
          currentVersion,
          channel: "preview",
          transport,
        })
      ).version,
      candidate,
    );
  }
});

test("a destination created during download is retained and cannot be replaced", async (t) => {
  const root = await temporary(t),
    output = join(root, "bundle"),
    f = bundle(),
    transport = transportFor(f);
  const original = transport.downloadAsset.bind(transport);
  transport.downloadAsset = async (input) => {
    if (input.assetId === 2) {
      await fs.mkdir(output);
      await fs.writeFile(join(output, "keep"), "other writer");
    }
    return original(input);
  };
  await assert.rejects(
    downloadRelease({
      repo,
      version: "0.2.0",
      output,
      expectedManifestSha256: f.digest,
      transport,
    }),
    /exist/,
  );
  assert.equal(await fs.readFile(join(output, "keep"), "utf8"), "other writer");
  assert.deepEqual(await fs.readdir(root), ["bundle"]);
});

test("failed final rename removes only the owned empty reservation and staging", async (t) => {
  const root = await temporary(t),
    output = join(root, "bundle"),
    f = bundle();
  const rename = fs.rename;
  fs.rename = async (source, destination) => {
    if (destination === output)
      throw Object.assign(Error("rename failure"), { code: "EIO" });
    return rename(source, destination);
  };
  try {
    await assert.rejects(
      downloadRelease({
        repo,
        version: "0.2.0",
        output,
        expectedManifestSha256: f.digest,
        transport: transportFor(f),
      }),
      /rename failure/,
    );
  } finally {
    fs.rename = rename;
  }
  assert.deepEqual(await fs.readdir(root), []);
});

test("cleanup failure retains the precise owned staging handle for operator recovery", async (t) => {
  const root = await temporary(t),
    output = join(root, "bundle"),
    f = bundle(),
    transport = transportFor(f);
  transport.downloadAsset = async () => {
    throw Error("download interrupted");
  };
  const remove = fs.rm;
  fs.rm = async (target, options) => {
    if (target.startsWith(join(root, ".browser-driver-download-")))
      throw Object.assign(Error("cleanup unavailable"), { code: "EACCES" });
    return remove(target, options);
  };
  let failure;
  try {
    await assert.rejects(
      downloadRelease({
        repo,
        version: "0.2.0",
        output,
        expectedManifestSha256: f.digest,
        transport,
      }),
      (error) => {
        failure = error;
        return /download interrupted/.test(error.message);
      },
    );
  } finally {
    fs.rm = remove;
  }
  assert.equal(failure.cleanupFailed, true);
  assert.equal(failure.retainedPaths.length, 1);
  assert.equal((await fs.lstat(failure.retainedPaths[0])).isDirectory(), true);
  await assert.rejects(fs.lstat(output), { code: "ENOENT" });
});

test("a replaced staging directory is never published or deleted after verification", async (t) => {
  const root = await temporary(t),
    output = join(root, "bundle"),
    f = bundle();
  const mkdir = fs.mkdir;
  let replacement;
  fs.mkdir = async (destination, options) => {
    const result = await mkdir(destination, options);
    if (destination === output) {
      const name = (await fs.readdir(root)).find((entry) =>
        entry.startsWith(".browser-driver-download-"),
      );
      replacement = join(root, name);
      await fs.rename(replacement, join(root, "verified-backup"));
      await mkdir(replacement);
      await fs.writeFile(join(replacement, "keep"), "unverified replacement");
    }
    return result;
  };
  let failure;
  try {
    await assert.rejects(
      downloadRelease({
        repo,
        version: "0.2.0",
        output,
        expectedManifestSha256: f.digest,
        transport: transportFor(f),
      }),
      (error) => {
        failure = error;
        return /staging|ownership/i.test(error.message);
      },
    );
  } finally {
    fs.mkdir = mkdir;
  }
  assert.equal(failure.cleanupFailed, true);
  assert.deepEqual(failure.retainedPaths, [replacement]);
  assert.equal(
    await fs.readFile(join(replacement, "keep"), "utf8"),
    "unverified replacement",
  );
  await assert.rejects(fs.lstat(output), { code: "ENOENT" });
});

test("default gh transport uses only generated GitHub GET endpoints and preserves binary bytes", async (t) => {
  const root = await temporary(t),
    f = bundle(),
    transport = transportFor(f),
    log = join(root, "calls.jsonl");
  const executable = join(root, "gh"),
    fixtureFile = join(root, "fixture.json");
  await fs.writeFile(
    fixtureFile,
    JSON.stringify({
      release: {
        ...transport.metadata,
        browser_download_url: "https://untrusted.invalid/never-use",
      },
      files: [...f.files.values()].map((bytes) => bytes.toString("base64")),
    }),
  );
  await fs.writeFile(
    executable,
    `#!${process.execPath}\nconst fs = require('node:fs');\nconst args = process.argv.slice(2);\nfs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');\nconst fixture = JSON.parse(fs.readFileSync(${JSON.stringify(fixtureFile)}, 'utf8'));\nconst endpoint = args[5];\nif (endpoint.includes('/assets/')) process.stdout.write(Buffer.from(fixture.files[Number(endpoint.split('/').at(-1)) - 1], 'base64'));\nelse process.stdout.write(JSON.stringify(endpoint.includes('/tags/') ? fixture.release : [fixture.release]));\n`,
    { mode: 0o700 },
  );
  const previousPath = process.env.PATH;
  process.env.PATH = `${root}${process.platform === "win32" ? ";" : ":"}${previousPath}`;
  try {
    assert.equal(
      (await checkForUpdates({ repo, currentVersion: "0.1.0" })).version,
      "0.2.0",
    );
    await downloadRelease({
      repo,
      version: "0.2.0",
      output: join(root, "download"),
      expectedManifestSha256: f.digest,
    });
  } finally {
    process.env.PATH = previousPath;
  }
  const calls = (await fs.readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(calls.length, 6);
  for (const args of calls) {
    assert.deepEqual(args.slice(0, 5), [
      "api",
      "--hostname",
      "github.com",
      "--method",
      "GET",
    ]);
    assert.ok(args[5].startsWith(`repos/${repo}/releases`));
    assert.equal(
      args.some((arg) => arg.includes("untrusted.invalid")),
      false,
    );
  }
  assert.equal(
    calls.filter((args) => args.includes("Accept: application/octet-stream"))
      .length,
    4,
  );
  assert.deepEqual(
    await fs.readFile(
      join(root, "download", f.manifest.artifacts.runtime.file),
    ),
    f.files.get(f.manifest.artifacts.runtime.file),
  );
});

test("remote downloads accept a complete Daedlo family and reject mixed release assets", async (t) => {
  const root = await temporary(t),
    fixture = bundle("0.2.0", () => {}, "daedlo"),
    transport = transportFor(fixture);
  const output = join(root, "download");
  await downloadRelease({
    repo,
    version: "0.2.0",
    output,
    expectedManifestSha256: fixture.digest,
    environment,
    transport,
  });
  assert.equal(
    (await verifyBundle(output)).manifest.artifacts.runtime.name,
    "@daedlo/runtime",
  );
  const mixed = transportFor(fixture);
  mixed.metadata.assets.push({
    id: 999,
    name: "browser-driver-engine-0.2.0.crate",
    size: 10,
    state: "uploaded",
    digest: null,
  });
  await assert.rejects(
    downloadRelease({
      repo,
      version: "0.2.0",
      output: join(root, "mixed"),
      expectedManifestSha256: fixture.digest,
      environment,
      transport: mixed,
    }),
    /mixed.*name families/i,
  );
  assert.equal(
    mixed.calls.some(([kind]) => kind === "asset"),
    false,
  );
});
