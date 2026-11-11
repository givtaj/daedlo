import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sha256 } from "../scripts/release/manifest.mjs";
import { prepareNinjaPromotion } from "../scripts/release/ninja-promotion.mjs";
import { PRODUCTION_RENEWAL_POLICY } from "../scripts/release/ninja-renew.mjs";

const version = "0.1.4-alpha.4";
const commit = "a".repeat(40);
const base = "https://api.github.com/repos/givtaj/daedlo";
const publicBase = `https://daedlo.com/downloads/${version}/`;
const args = {
  privateKeyPath: "/private/test-key.pem",
  output: "/private/fresh-promotion",
  checkpointPath: "/private/checkpoint/catalog.json",
};

test("alpha9 CLI recognizes only its explicit selector and reaches credential validation without transport", () => {
  let error;
  try {
    execFileSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("../scripts/release/ninja-promotion.mjs", import.meta.url),
        ),
        "--promote-alpha9",
        "--private-key",
        args.privateKeyPath,
        "--output",
        args.output,
        "--checkpoint",
        args.checkpointPath,
      ],
      { env: { ...process.env, GITHUB_TOKEN: "" }, stdio: "pipe" },
    );
  } catch (value) {
    error = value;
  }
  assert.match(
    error?.stderr?.toString() ?? "",
    /Promotion requires a GitHub credential/,
  );
});

test("alpha10 CLI recognizes only its explicit selector and reaches credential validation without transport", () => {
  let error;
  try {
    execFileSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("../scripts/release/ninja-promotion.mjs", import.meta.url),
        ),
        "--promote-alpha10",
        "--private-key",
        args.privateKeyPath,
        "--output",
        args.output,
        "--checkpoint",
        args.checkpointPath,
      ],
      { env: { ...process.env, GITHUB_TOKEN: "" }, stdio: "pipe" },
    );
  } catch (value) {
    error = value;
  }
  assert.match(
    error?.stderr?.toString() ?? "",
    /Promotion requires a GitHub credential/,
  );
});

for (const selectors of [
  ["--promote-alpha8"],
  ["--promote-alpha12"],
  ["--promote-alpha11", "true"],
  ["--promote-alpha11", "--promote-alpha11"],
  ["--promote-alpha10", "--promote-alpha11"],
  ["--promote-alpha9", "--promote-alpha11"],
  ["--release", "0.1.4-alpha.11"],
  ["--promote-alpha11", "--release", "0.1.4-alpha.7"],
  ["--promote-alpha10", "true"],
  ["--promote-alpha10", "--promote-alpha10"],
  ["--promote-alpha9", "--promote-alpha10"],
  ["--promote-alpha10", "--release", "0.1.4-alpha.7"],
  ["--release", "0.1.4-alpha.10"],
  ["--promote-alpha9", "true"],
  ["--promote-alpha9", "--promote-alpha9"],
  ["--promote-alpha9", "--release", "0.1.4-alpha.7"],
  ["--release", "0.1.4-alpha.9"],
])
  test(`promotion CLI refuses ambiguous or unsupported selector ${selectors.join(" ")}`, () => {
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            fileURLToPath(
              new URL(
                "../scripts/release/ninja-promotion.mjs",
                import.meta.url,
              ),
            ),
            ...selectors,
            "--private-key",
            args.privateKeyPath,
            "--output",
            args.output,
            "--checkpoint",
            args.checkpointPath,
          ],
          { env: { ...process.env, GITHUB_TOKEN: "" }, stdio: "pipe" },
        ),
      (error) => {
        assert.match(
          error.stderr.toString(),
          /Promotion (CLI|unsupported release selector)/,
        );
        assert.doesNotMatch(error.stderr.toString(), /GitHub credential/);
        return true;
      },
    );
  });

test("production policy pins alpha9 independently and excludes held alpha8", () => {
  assert.deepEqual(PRODUCTION_RENEWAL_POLICY.alpha9Promotion, {
    version: "0.1.4-alpha.9",
    sourceCommit: "30d2a985964011c08d80db2e83a3716a2c151345",
  });
  assert.deepEqual(PRODUCTION_RENEWAL_POLICY.assets["0.1.4-alpha.9"], {
    "daedlo-0.1.4-alpha.9.zip": {
      bytes: 358374,
      sha256:
        "81b252cc4853278360e893713c778676b492df5d60afe4f19d7880484327f4b2",
    },
    "release.json": {
      bytes: 10880,
      sha256:
        "4d85aeafd0699ccd8a142b4e7ca4546763f7c0423476b13806d448fb4ea1a1a2",
    },
    SHA256SUMS: {
      bytes: 91,
      sha256:
        "e44b46953df301aa102655e8f14ee7d89e7cd9a17e8b2603c2589ddab7fa8631",
    },
  });
  assert.equal(PRODUCTION_RENEWAL_POLICY.assets["0.1.4-alpha.8"], undefined);
  assert.equal(PRODUCTION_RENEWAL_POLICY.alpha8Promotion, undefined);
  assert.deepEqual(
    PRODUCTION_RENEWAL_POLICY.releaseContracts["0.1.4-alpha.9"],
    PRODUCTION_RENEWAL_POLICY.releaseContracts["0.1.4-alpha.7"],
  );
});

test("alpha9 preparation preserves every historical asset, contract, source and trust pin", () => {
  const p = PRODUCTION_RENEWAL_POLICY;
  const historical = Object.fromEntries(
    Object.entries(p.assets).filter(
      ([version]) =>
        !["0.1.4-alpha.9", "0.1.4-alpha.10", "0.1.4-alpha.11"].includes(
          version,
        ),
    ),
  );
  assert.deepEqual(Object.keys(historical).sort(), [
    "0.1.2-rc.1",
    "0.1.4-alpha.2",
    "0.1.4-alpha.3",
    "0.1.4-alpha.4",
    "0.1.4-alpha.5",
    "0.1.4-alpha.6",
    "0.1.4-alpha.7",
  ]);
  assert.equal(Object.values(historical).flatMap(Object.keys).length, 21);
  const releaseContracts = Object.fromEntries(
    Object.entries(p.releaseContracts).filter(
      ([version]) =>
        !["0.1.4-alpha.9", "0.1.4-alpha.10", "0.1.4-alpha.11"].includes(
          version,
        ),
    ),
  );
  assert.equal(
    sha256(
      Buffer.from(
        JSON.stringify({
          assets: Object.entries(historical).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
          releaseContracts,
          promotions: [
            p.promotion,
            p.alpha5Promotion,
            p.alpha6Promotion,
            p.alpha7Promotion,
          ],
          publicKeyPemSha256: p.publicKeyPemSha256,
          initialCheckpoint: p.initialCheckpoint,
        }),
      ),
    ),
    "4342cac09bea40bbbfc70722d68083db4ac10022c70604abc4ef7ca40024de4a",
  );
});

test("production alpha7 promotion binds the accepted clean source and complete immutable inventory", () => {
  assert.deepEqual(PRODUCTION_RENEWAL_POLICY.alpha7Promotion, {
    version: "0.1.4-alpha.7",
    sourceCommit: "9cbff73ad1b8d5e64b11c7358050eebc3cd1d392",
  });
  assert.deepEqual(PRODUCTION_RENEWAL_POLICY.assets["0.1.4-alpha.7"], {
    "daedlo-0.1.4-alpha.7.zip": {
      bytes: 311661,
      sha256:
        "cb56901e85572c73dbbeb2c2566c97db31608fa15dd861704b674ef84ba1fd5e",
    },
    "release.json": {
      bytes: 8752,
      sha256:
        "ec13bf2656751996b335805f3950ac29a97bbf6785d21a3a88fd283ee064ded0",
    },
    SHA256SUMS: {
      bytes: 91,
      sha256:
        "b3666e5be14f8542ceba3084086b0f6a57a0e4a266d58099bce158ff249b6c9f",
    },
  });
  assert.deepEqual(
    PRODUCTION_RENEWAL_POLICY.releaseContracts["0.1.4-alpha.7"],
    {
      manager: 2,
      launcher: 1,
      nodeAdapter: 1,
      rustModel: 1,
      protocol: 1,
      capabilities: ["recipeContext:1"],
    },
  );
});

function fixture(candidateVersion = version) {
  const version = candidateVersion;
  const publicBase = `https://daedlo.com/downloads/${version}/`;
  const files = new Map([
    [`daedlo-${version}.zip`, Buffer.from("exact pinned candidate archive")],
    [
      "release.json",
      Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          kind: "daedlo-public-kit",
          version,
          source: { commit, dirty: false, treeSha256: "b".repeat(64) },
        }),
      ),
    ],
    ["SHA256SUMS", Buffer.from("exact pinned checksum inventory")],
  ]);
  const policy = {
    promotion: { version, sourceCommit: commit },
    assets: {
      [version]: Object.fromEntries(
        [...files].map(([name, bytes]) => [
          name,
          { bytes: bytes.length, sha256: sha256(bytes) },
        ]),
      ),
    },
  };
  const repository = { id: 1391092739, full_name: "givtaj/daedlo" };
  const release = {
    id: 41,
    tag_name: `v${version}`,
    target_commitish: commit,
    draft: true,
    prerelease: true,
  };
  const assets = [...files].map(([name, bytes], i) => ({
    id: i + 101,
    name,
    state: "uploaded",
    size: bytes.length,
  }));
  const calls = [];
  const state = {
    prepared: 0,
    redirect: null,
    wrongBody: false,
    ref: {
      ref: `refs/tags/v${version}`,
      object: { type: "commit", sha: commit },
    },
    tags: new Map(),
  };
  const fetchImpl = async (url, options) => {
    url = String(url);
    calls.push({ url, options });
    if (url === base) return Response.json(repository);
    if (url === `${base}/git/ref/tags/v${version}`)
      return state.ref
        ? Response.json(state.ref)
        : new Response(null, { status: 404 });
    if (url.startsWith(`${base}/git/tags/`)) {
      const tag = state.tags.get(url.slice(`${base}/git/tags/`.length));
      return tag ? Response.json(tag) : new Response(null, { status: 404 });
    }
    if (url === `${base}/releases?per_page=100&page=1`)
      return Response.json([release]);
    if (url === `${base}/releases/41/assets?per_page=100&page=1`)
      return Response.json(assets);
    const item = assets.find((a) => url === `${base}/releases/assets/${a.id}`);
    if (item) {
      if (state.redirect)
        return new Response(null, {
          status: 302,
          headers: { location: state.redirect },
        });
      return new Response(
        state.wrongBody ? Buffer.alloc(item.size, 120) : files.get(item.name),
      );
    }
    if (url.startsWith("https://release-assets.githubusercontent.com/")) {
      const item = assets[calls.filter((c) => c.url === url).length - 1];
      return new Response(files.get(item.name));
    }
    if (url === "https://daedlo.com/updates/preview.json")
      return new Response("independent live feed");
    throw Error("unexpected test transport");
  };
  const deps = {
    policy,
    token: "test-github-token",
    fetchImpl,
    prepareImpl: async (options, renewalDeps) => {
      state.prepared++;
      assert.deepEqual(options, {
        ...args,
        [version.endsWith("alpha.11")
          ? "promoteAlpha11"
          : version.endsWith("alpha.10")
            ? "promoteAlpha10"
            : version.endsWith("alpha.9")
              ? "promoteAlpha9"
              : version.endsWith("alpha.7")
                ? "promoteAlpha7"
                : version.endsWith("alpha.6")
                  ? "promoteAlpha6"
                  : version.endsWith("alpha.5")
                    ? "promoteAlpha5"
                    : "promoteAlpha4"]: true,
      });
      assert.equal(renewalDeps.policy, policy);
      for (const [name, bytes] of files) {
        const response = await renewalDeps.fetchImpl(publicBase + name, {
          redirect: "error",
        });
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
      }
      assert.equal(
        await (
          await renewalDeps.fetchImpl("https://daedlo.com/updates/preview.json")
        ).text(),
        "independent live feed",
      );
      return { status: "PREPARED", generation: 7 };
    },
  };
  return { files, policy, repository, release, assets, calls, state, deps };
}

test("passes only exact pinned candidate bytes to the existing renewal path", async () => {
  for (const draft of [true, false]) {
    const f = fixture();
    f.release.draft = draft;
    assert.deepEqual(await prepareNinjaPromotion(args, f.deps), {
      status: "PREPARED",
      generation: 7,
    });
    assert.equal(f.state.prepared, 1);
    assert.equal(f.calls.filter((c) => c.url.startsWith(publicBase)).length, 0);
    for (const call of f.calls.filter((c) => c.url.startsWith(base))) {
      assert.equal(call.options.redirect, "manual");
      assert.equal(
        call.options.headers.Authorization,
        "Bearer test-github-token",
      );
      assert.ok(call.options.signal instanceof AbortSignal);
    }
    assert.equal(f.calls.at(-1).options?.headers?.Authorization, undefined);
  }
});

test("refuses absent policy pins, credentials or required checkpoint before transport", async () => {
  for (const change of [
    (f) => delete f.policy.promotion,
    (f) => delete f.policy.assets[version],
    (f) => (f.policy.promotion.sourceCommit = "main"),
    (f) =>
      (f.policy.assets[version].extra = { bytes: 1, sha256: "c".repeat(64) }),
    (f) => (f.deps.token = ""),
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(prepareNinjaPromotion(args, f.deps), /Promotion/);
    assert.equal(f.calls.length, 0);
    assert.equal(f.state.prepared, 0);
  }
  await assert.rejects(
    prepareNinjaPromotion(
      { ...args, checkpointPath: undefined },
      fixture().deps,
    ),
    /Promotion/,
  );
});

test("rejects wrong repository, tag, commit and asset inventories before preparation", async () => {
  for (const change of [
    (f) => (f.repository.id = 2),
    (f) => (f.repository.full_name = "attacker/daedlo"),
    (f) => (f.release.tag_name = "v0.1.4-alpha.3"),
    (f) => (f.release.target_commitish = "main"),
    (f) => (f.release.prerelease = false),
    (f) => f.assets.pop(),
    (f) => f.assets.push({ ...f.assets[0], id: 555 }),
    (f) => (f.assets[0].state = "new"),
    (f) => (f.assets[0].id = -1),
    (f) => (f.assets[0].size += 1),
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(prepareNinjaPromotion(args, f.deps), /Promotion/);
    assert.equal(f.state.prepared, 0);
  }
});

test("rejects mismatched downloaded bytes and authenticated dirty/wrong source metadata", async () => {
  const damaged = fixture();
  damaged.state.wrongBody = true;
  await assert.rejects(
    prepareNinjaPromotion(args, damaged.deps),
    /Promotion asset integrity/,
  );
  for (const source of [
    { commit, dirty: true, treeSha256: "b".repeat(64) },
    { commit: "c".repeat(40), dirty: false, treeSha256: "b".repeat(64) },
  ]) {
    const f = fixture();
    const metadata = JSON.parse(f.files.get("release.json"));
    metadata.source = source;
    const bytes = Buffer.from(JSON.stringify(metadata));
    f.files.set("release.json", bytes);
    f.policy.assets[version]["release.json"] = {
      bytes: bytes.length,
      sha256: sha256(bytes),
    };
    f.assets.find((a) => a.name === "release.json").size = bytes.length;
    await assert.rejects(
      prepareNinjaPromotion(args, f.deps),
      /Promotion source identity/,
    );
    assert.equal(f.state.prepared, 0);
  }
});

test("allows only HTTPS release-assets redirects without forwarding the bearer", async () => {
  const f = fixture();
  f.state.redirect =
    "https://release-assets.githubusercontent.com/exact?signature=private-test";
  await prepareNinjaPromotion(args, f.deps);
  const redirected = f.calls.filter((c) =>
    c.url.startsWith("https://release-assets."),
  );
  assert.equal(redirected.length, 3);
  for (const c of redirected) {
    assert.equal(c.options.headers, undefined);
    assert.equal(c.options.redirect, "error");
  }
  for (const url of [
    "http://release-assets.githubusercontent.com/file",
    "https://release-assets.githubusercontent.com.attacker.test/file",
    "https://user:pass@release-assets.githubusercontent.com/file",
    "https://release-assets.githubusercontent.com:444/file",
    "https://api.github.com/elsewhere",
  ]) {
    const f = fixture();
    f.state.redirect = url;
    await assert.rejects(
      prepareNinjaPromotion(args, f.deps),
      /Promotion asset redirect/,
    );
    assert.equal(f.state.prepared, 0);
  }
});

test("sanitizes transport errors and refuses API redirects and oversized responses", async () => {
  for (const response of [
    () => {
      throw Error("token=test-github-token query=secret");
    },
    () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://attacker.test/?secret" },
      }),
    () => new Response("x".repeat(1024 * 1024 + 1)),
  ]) {
    const f = fixture();
    f.deps.fetchImpl = response;
    await assert.rejects(prepareNinjaPromotion(args, f.deps), (error) => {
      assert.match(error.message, /^Promotion/);
      assert.doesNotMatch(
        error.message,
        /test-github-token|attacker|query|secret/,
      );
      return true;
    });
    assert.equal(f.state.prepared, 0);
  }
});

test("an existing tag must resolve to the pinned source even when release metadata matches", async () => {
  for (const draft of [true, false]) {
    const f = fixture();
    f.release.draft = draft;
    f.state.ref.object.sha = "c".repeat(40);
    await assert.rejects(
      prepareNinjaPromotion(args, f.deps),
      /Promotion tag target/,
    );
    assert.equal(f.state.prepared, 0);
  }
});

test("only a draft may precede its tag; published tags are mandatory", async () => {
  const draft = fixture();
  draft.state.ref = null;
  await prepareNinjaPromotion(args, draft.deps);
  const published = fixture();
  published.release.draft = false;
  published.state.ref = null;
  await assert.rejects(
    prepareNinjaPromotion(args, published.deps),
    /Promotion.*tag/,
  );
  assert.equal(published.state.prepared, 0);
});

test("bounded annotated tags must peel to the pinned commit without cycles", async () => {
  const f = fixture();
  const tag = "d".repeat(40);
  f.state.ref.object = { type: "tag", sha: tag };
  f.state.tags.set(tag, { sha: tag, object: { type: "commit", sha: commit } });
  await prepareNinjaPromotion(args, f.deps);
  for (const change of [
    (f) =>
      f.state.tags.set(tag, { sha: tag, object: { type: "tag", sha: tag } }),
    (f) =>
      f.state.tags.set(tag, {
        sha: "e".repeat(40),
        object: { type: "commit", sha: commit },
      }),
    (f) =>
      f.state.tags.set(tag, {
        sha: tag,
        object: { type: "tree", sha: commit },
      }),
  ]) {
    const f = fixture();
    f.state.ref.object = { type: "tag", sha: tag };
    change(f);
    await assert.rejects(prepareNinjaPromotion(args, f.deps), /Promotion.*tag/);
    assert.equal(f.state.prepared, 0);
  }
});

test("explicit alpha5 promotion uses only alpha5 pins and keeps the alpha4 path compatible", async () => {
  const f = fixture("0.1.4-alpha.5");
  f.policy.alpha5Promotion = f.policy.promotion;
  delete f.policy.promotion;
  const result = await prepareNinjaPromotion(
    { ...args, promoteAlpha5: true },
    f.deps,
  );
  assert.equal(result.status, "PREPARED");
  assert.equal(f.state.prepared, 1);
  assert.ok(
    f.calls.some((c) => c.url.endsWith("/git/ref/tags/v0.1.4-alpha.5")),
  );
  assert.ok(!f.calls.some((c) => c.url.includes("alpha.4")));
});

test("alpha5 requires its own reviewed policy and cannot silently use alpha4 pins", async () => {
  const f = fixture();
  await assert.rejects(
    prepareNinjaPromotion({ ...args, promoteAlpha5: true }, f.deps),
    /reviewed candidate/,
  );
  assert.equal(f.calls.length, 0);
  assert.equal(f.state.prepared, 0);
});

test("promotion selector must be a boolean rather than truthy caller input", async () => {
  const f = fixture();
  await assert.rejects(
    prepareNinjaPromotion({ ...args, promoteAlpha5: "true" }, f.deps),
    /Promotion/,
  );
  assert.equal(f.calls.length, 0);
});

test("explicit alpha6 promotion uses its own frozen source and three files only", async () => {
  const f = fixture("0.1.4-alpha.6");
  f.policy.alpha6Promotion = f.policy.promotion;
  delete f.policy.promotion;
  const result = await prepareNinjaPromotion(
    { ...args, promoteAlpha6: true },
    f.deps,
  );
  assert.equal(result.status, "PREPARED");
  assert.equal(f.state.prepared, 1);
  assert.ok(
    f.calls.some((c) => c.url.endsWith("/git/ref/tags/v0.1.4-alpha.6")),
  );
  assert.ok(!f.calls.some((c) => /alpha\.[45]/.test(c.url)));
});

test("alpha6 promotion requires independent complete pins and refuses mixed or nonboolean selection before transport", async () => {
  for (const change of [
    (f) => delete f.policy.alpha6Promotion,
    (f) => (f.policy.alpha6Promotion.sourceCommit = "main"),
    (f) => delete f.policy.assets["0.1.4-alpha.6"],
    ...["daedlo-0.1.4-alpha.6.zip", "release.json", "SHA256SUMS"].map(
      (name) => (f) => delete f.policy.assets["0.1.4-alpha.6"][name],
    ),
  ]) {
    const f = fixture("0.1.4-alpha.6");
    f.policy.alpha6Promotion = f.policy.promotion;
    delete f.policy.promotion;
    change(f);
    await assert.rejects(
      prepareNinjaPromotion({ ...args, promoteAlpha6: true }, f.deps),
      /reviewed candidate/,
    );
    assert.equal(f.calls.length, 0);
    assert.equal(f.state.prepared, 0);
  }
  for (const options of [
    { promoteAlpha6: "true" },
    { promoteAlpha5: true, promoteAlpha6: true },
  ]) {
    const f = fixture("0.1.4-alpha.6");
    await assert.rejects(
      prepareNinjaPromotion({ ...args, ...options }, f.deps),
      /Promotion/,
    );
    assert.equal(f.calls.length, 0);
  }
});

test("alpha6 refuses a tag that differs from its independently pinned source", async () => {
  const f = fixture("0.1.4-alpha.6");
  f.policy.alpha6Promotion = f.policy.promotion;
  delete f.policy.promotion;
  f.state.ref.object.sha = "c".repeat(40);
  await assert.rejects(
    prepareNinjaPromotion({ ...args, promoteAlpha6: true }, f.deps),
    /tag target does not match pinned source/,
  );
  assert.equal(f.state.prepared, 0);
});

test("explicit alpha7 promotion uses only its independently pinned source and three assets", async () => {
  const f = fixture("0.1.4-alpha.7");
  f.policy.alpha7Promotion = f.policy.promotion;
  delete f.policy.promotion;
  const result = await prepareNinjaPromotion(
    { ...args, promoteAlpha7: true },
    f.deps,
  );
  assert.equal(result.status, "PREPARED");
  assert.equal(f.state.prepared, 1);
  assert.ok(
    f.calls.some((c) => c.url.endsWith("/git/ref/tags/v0.1.4-alpha.7")),
  );
  assert.ok(!f.calls.some((c) => /alpha\.[456]/.test(c.url)));
});

test("alpha7 promotion requires independent pins and refuses mixed or nonboolean selectors before transport", async () => {
  for (const change of [
    (f) => delete f.policy.alpha7Promotion,
    (f) => (f.policy.alpha7Promotion.sourceCommit = "main"),
    ...["daedlo-0.1.4-alpha.7.zip", "release.json", "SHA256SUMS"].map(
      (name) => (f) => delete f.policy.assets["0.1.4-alpha.7"][name],
    ),
  ]) {
    const f = fixture("0.1.4-alpha.7");
    f.policy.alpha7Promotion = f.policy.promotion;
    delete f.policy.promotion;
    change(f);
    await assert.rejects(
      prepareNinjaPromotion({ ...args, promoteAlpha7: true }, f.deps),
      /reviewed candidate/,
    );
    assert.equal(f.calls.length, 0);
  }
  for (const options of [
    { promoteAlpha7: "true" },
    { promoteAlpha5: true, promoteAlpha7: true },
    { promoteAlpha6: true, promoteAlpha7: true },
    { promoteAlpha5: true, promoteAlpha6: true, promoteAlpha7: true },
  ]) {
    const f = fixture("0.1.4-alpha.7");
    await assert.rejects(
      prepareNinjaPromotion({ ...args, ...options }, f.deps),
      /Promotion/,
    );
    assert.equal(f.calls.length, 0);
  }
});

test("alpha7 refuses a tag that differs from its independently pinned package source", async () => {
  const f = fixture("0.1.4-alpha.7");
  f.policy.alpha7Promotion = f.policy.promotion;
  delete f.policy.promotion;
  f.state.ref.object.sha = "c".repeat(40);
  await assert.rejects(
    prepareNinjaPromotion({ ...args, promoteAlpha7: true }, f.deps),
    /tag target does not match pinned source/,
  );
  assert.equal(f.state.prepared, 0);
});

test("explicit alpha9 promotion uses only its independently pinned source and three assets", async () => {
  const f = fixture("0.1.4-alpha.9");
  f.policy.alpha9Promotion = f.policy.promotion;
  delete f.policy.promotion;
  const result = await prepareNinjaPromotion(
    { ...args, promoteAlpha9: true },
    f.deps,
  );
  assert.equal(result.status, "PREPARED");
  assert.equal(f.state.prepared, 1);
  assert.ok(
    f.calls.some((c) => c.url.endsWith("/git/ref/tags/v0.1.4-alpha.9")),
  );
  assert.ok(!f.calls.some((c) => /alpha\.[4567]/.test(c.url)));
});

test("alpha9 promotion requires independent pins and refuses mixed or nonboolean selectors before transport", async () => {
  for (const change of [
    (f) => delete f.policy.alpha9Promotion,
    (f) => (f.policy.alpha9Promotion.sourceCommit = "main"),
    ...["daedlo-0.1.4-alpha.9.zip", "release.json", "SHA256SUMS"].map(
      (name) => (f) => delete f.policy.assets["0.1.4-alpha.9"][name],
    ),
  ]) {
    const f = fixture("0.1.4-alpha.9");
    f.policy.alpha9Promotion = f.policy.promotion;
    delete f.policy.promotion;
    change(f);
    await assert.rejects(
      prepareNinjaPromotion({ ...args, promoteAlpha9: true }, f.deps),
      /reviewed candidate/,
    );
    assert.equal(f.calls.length, 0);
  }
  for (const options of [
    { promoteAlpha9: "true" },
    { promoteAlpha5: true, promoteAlpha9: true },
    { promoteAlpha6: true, promoteAlpha9: true },
    { promoteAlpha7: true, promoteAlpha9: true },
    { promoteAlpha5: true, promoteAlpha6: true, promoteAlpha9: true },
  ]) {
    const f = fixture("0.1.4-alpha.9");
    await assert.rejects(
      prepareNinjaPromotion({ ...args, ...options }, f.deps),
      /Promotion/,
    );
    assert.equal(f.calls.length, 0);
  }
});

test("alpha9 refuses a tag that differs from its independently pinned package source", async () => {
  const f = fixture("0.1.4-alpha.9");
  f.policy.alpha9Promotion = f.policy.promotion;
  delete f.policy.promotion;
  f.state.ref.object.sha = "c".repeat(40);
  await assert.rejects(
    prepareNinjaPromotion({ ...args, promoteAlpha9: true }, f.deps),
    /tag target does not match pinned source/,
  );
  assert.equal(f.state.prepared, 0);
});

test("alpha10 explicit promotion authenticates its own frozen source and retained selector", async () => {
  const f = fixture("0.1.4-alpha.10");
  f.policy.alpha10Promotion = f.policy.promotion;
  delete f.policy.promotion;
  const result = await prepareNinjaPromotion(
    { ...args, promoteAlpha10: true },
    f.deps,
  );
  assert.equal(result.status, "PREPARED");
  assert.equal(f.state.prepared, 1);
  assert.ok(
    f.calls.some((c) => c.url.endsWith("/git/ref/tags/v0.1.4-alpha.10")),
  );
  assert.ok(!f.calls.some((c) => /alpha\.[4-9](?:\D|$)/.test(c.url)));
});

test("alpha10 promotion requires independent pins and refuses mixed or nonboolean selectors before transport", async () => {
  for (const change of [
    (f) => delete f.policy.alpha10Promotion,
    (f) => (f.policy.alpha10Promotion.sourceCommit = "main"),
    ...["daedlo-0.1.4-alpha.10.zip", "release.json", "SHA256SUMS"].map(
      (name) => (f) => delete f.policy.assets["0.1.4-alpha.10"][name],
    ),
  ]) {
    const f = fixture("0.1.4-alpha.10");
    f.policy.alpha10Promotion = f.policy.promotion;
    delete f.policy.promotion;
    change(f);
    await assert.rejects(
      prepareNinjaPromotion({ ...args, promoteAlpha10: true }, f.deps),
      /reviewed candidate/,
    );
    assert.equal(f.calls.length, 0);
  }
  for (const options of [
    { promoteAlpha10: "true" },
    { promoteAlpha5: true, promoteAlpha10: true },
    { promoteAlpha6: true, promoteAlpha10: true },
    { promoteAlpha7: true, promoteAlpha10: true },
    { promoteAlpha9: true, promoteAlpha10: true },
    { promoteAlpha5: true, promoteAlpha6: true, promoteAlpha10: true },
  ]) {
    const f = fixture("0.1.4-alpha.10");
    await assert.rejects(
      prepareNinjaPromotion({ ...args, ...options }, f.deps),
      /Promotion/,
    );
    assert.equal(f.calls.length, 0);
  }
});

test("alpha10 refuses a tag that differs from its independently pinned package source", async () => {
  const f = fixture("0.1.4-alpha.10");
  f.policy.alpha10Promotion = f.policy.promotion;
  delete f.policy.promotion;
  f.state.ref.object.sha = "c".repeat(40);
  await assert.rejects(
    prepareNinjaPromotion({ ...args, promoteAlpha10: true }, f.deps),
    /tag target does not match pinned source/,
  );
  assert.equal(f.state.prepared, 0);
});

test("alpha10 preparation preserves every historical pin including alpha9 and publisher trust", () => {
  const p = PRODUCTION_RENEWAL_POLICY;
  const historical = Object.fromEntries(
    Object.entries(p.assets).filter(
      ([version]) => !["0.1.4-alpha.10", "0.1.4-alpha.11"].includes(version),
    ),
  );
  const releaseContracts = Object.fromEntries(
    Object.entries(p.releaseContracts).filter(
      ([version]) => !["0.1.4-alpha.10", "0.1.4-alpha.11"].includes(version),
    ),
  );
  assert.deepEqual(Object.keys(historical).sort(), [
    "0.1.2-rc.1",
    "0.1.4-alpha.2",
    "0.1.4-alpha.3",
    "0.1.4-alpha.4",
    "0.1.4-alpha.5",
    "0.1.4-alpha.6",
    "0.1.4-alpha.7",
    "0.1.4-alpha.9",
  ]);
  assert.equal(Object.values(historical).flatMap(Object.keys).length, 24);
  assert.equal(
    sha256(
      Buffer.from(
        JSON.stringify({
          assets: Object.entries(historical).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
          releaseContracts,
          promotions: [
            p.promotion,
            p.alpha5Promotion,
            p.alpha6Promotion,
            p.alpha7Promotion,
            p.alpha9Promotion,
          ],
          publicKeyPemSha256: p.publicKeyPemSha256,
          initialCheckpoint: p.initialCheckpoint,
        }),
      ),
    ),
    "391aaa3ae2e416bdc2bbe6b6ad70473d2312bd7073577c1b82a7f2004f753d39",
  );
});

test("production policy pins alpha10 to the exact frozen source and three accepted files", () => {
  assert.deepEqual(PRODUCTION_RENEWAL_POLICY.alpha10Promotion, {
    version: "0.1.4-alpha.10",
    sourceCommit: "61163084f9b02ec2448eee04c7aebc4994075936",
  });
  assert.deepEqual(PRODUCTION_RENEWAL_POLICY.assets["0.1.4-alpha.10"], {
    "daedlo-0.1.4-alpha.10.zip": {
      bytes: 366928,
      sha256:
        "543ab597a1c5d30af7d9b12cefa6dec8a01bed2e985426056f5fed57ea8a0c29",
    },
    "release.json": {
      bytes: 6951,
      sha256:
        "87190840350b08caca0c5c279bd4c6364cea021ee13c7c500947f1d2a6eed033",
    },
    SHA256SUMS: {
      bytes: 92,
      sha256:
        "009e217bc512ecae1b9c0af6c5b384f6a6d8288a4aa0bf42ab3d209e60e20206",
    },
  });
  assert.deepEqual(
    PRODUCTION_RENEWAL_POLICY.releaseContracts["0.1.4-alpha.10"],
    {
      manager: 2,
      launcher: 1,
      nodeAdapter: 1,
      rustModel: 1,
      protocol: 1,
      capabilities: ["recipeContext:1"],
    },
  );
});

test("production policy pins alpha11 to the exact frozen source and three accepted files", () => {
  assert.deepEqual(PRODUCTION_RENEWAL_POLICY.alpha11Promotion, {
    version: "0.1.4-alpha.11",
    sourceCommit: "8ddd8d7f770f3a6c7e14315ebee3164d45a9ac33",
  });
  assert.deepEqual(PRODUCTION_RENEWAL_POLICY.assets["0.1.4-alpha.11"], {
    "daedlo-0.1.4-alpha.11.zip": {
      bytes: 380817,
      sha256:
        "4c9c747f7530984db09e859783f447ba720c87bc5b41b609039453644230249c",
    },
    "release.json": {
      bytes: 7561,
      sha256:
        "113eaa403420e22a532164be052cc43a61075f6d77038f7baa45e31f360615d5",
    },
    SHA256SUMS: {
      bytes: 92,
      sha256:
        "c088b9f82c0a60c8d5e36d2f71ec17c492a30c4d04d1b89a7e7f96fc97afe832",
    },
  });
  assert.deepEqual(
    PRODUCTION_RENEWAL_POLICY.releaseContracts["0.1.4-alpha.11"],
    {
      manager: 2,
      launcher: 1,
      nodeAdapter: 1,
      rustModel: 1,
      protocol: 1,
      capabilities: ["recipeContext:1"],
    },
  );
});

test("alpha11 explicit promotion authenticates its own frozen source and retained selector", async () => {
  const f = fixture("0.1.4-alpha.11");
  f.policy.alpha11Promotion = f.policy.promotion;
  delete f.policy.promotion;
  const result = await prepareNinjaPromotion(
    { ...args, promoteAlpha11: true },
    f.deps,
  );
  assert.equal(result.status, "PREPARED");
  assert.equal(f.state.prepared, 1);
  assert.ok(
    f.calls.some((c) => c.url.endsWith("/git/ref/tags/v0.1.4-alpha.11")),
  );
  assert.ok(!f.calls.some((c) => /alpha\.[4-9](?:\D|$)/.test(c.url)));
});

test("alpha11 promotion requires independent pins and refuses mixed or nonboolean selectors before transport", async () => {
  for (const change of [
    (f) => delete f.policy.alpha11Promotion,
    (f) => (f.policy.alpha11Promotion.sourceCommit = "main"),
    ...["daedlo-0.1.4-alpha.11.zip", "release.json", "SHA256SUMS"].map(
      (name) => (f) => delete f.policy.assets["0.1.4-alpha.11"][name],
    ),
  ]) {
    const f = fixture("0.1.4-alpha.11");
    f.policy.alpha11Promotion = f.policy.promotion;
    delete f.policy.promotion;
    change(f);
    await assert.rejects(
      prepareNinjaPromotion({ ...args, promoteAlpha11: true }, f.deps),
      /reviewed candidate/,
    );
    assert.equal(f.calls.length, 0);
  }
  for (const options of [
    { promoteAlpha11: "true" },
    { promoteAlpha5: true, promoteAlpha11: true },
    { promoteAlpha6: true, promoteAlpha11: true },
    { promoteAlpha7: true, promoteAlpha11: true },
    { promoteAlpha9: true, promoteAlpha11: true },
    { promoteAlpha10: true, promoteAlpha11: true },
    { promoteAlpha5: true, promoteAlpha6: true, promoteAlpha11: true },
  ]) {
    const f = fixture("0.1.4-alpha.11");
    await assert.rejects(
      prepareNinjaPromotion({ ...args, ...options }, f.deps),
      /Promotion/,
    );
    assert.equal(f.calls.length, 0);
  }
});

test("alpha11 refuses a tag that differs from its independently pinned package source", async () => {
  const f = fixture("0.1.4-alpha.11");
  f.policy.alpha11Promotion = f.policy.promotion;
  delete f.policy.promotion;
  f.state.ref.object.sha = "c".repeat(40);
  await assert.rejects(
    prepareNinjaPromotion({ ...args, promoteAlpha11: true }, f.deps),
    /tag target does not match pinned source/,
  );
  assert.equal(f.state.prepared, 0);
});

test("alpha11 preparation preserves all 27 prior assets, contracts, source pins and publisher trust", () => {
  const p = PRODUCTION_RENEWAL_POLICY;
  const assets = Object.fromEntries(
    Object.entries(p.assets).filter(
      ([version]) => version !== "0.1.4-alpha.11",
    ),
  );
  const releaseContracts = Object.fromEntries(
    Object.entries(p.releaseContracts).filter(
      ([version]) => version !== "0.1.4-alpha.11",
    ),
  );
  assert.equal(Object.keys(assets).length, 9);
  assert.equal(Object.values(assets).flatMap(Object.keys).length, 27);
  assert.equal(
    sha256(
      Buffer.from(
        JSON.stringify({
          assets: Object.entries(assets).sort(([a], [b]) => a.localeCompare(b)),
          releaseContracts,
          promotions: [
            p.promotion,
            p.alpha5Promotion,
            p.alpha6Promotion,
            p.alpha7Promotion,
            p.alpha9Promotion,
            p.alpha10Promotion,
          ],
          publicKeyPemSha256: p.publicKeyPemSha256,
          initialCheckpoint: p.initialCheckpoint,
        }),
      ),
    ),
    "e949c870d044150dbb87c9938430496f7b28c4470b9518dde9bb3d59d9fcb6e6",
  );
  assert.equal(p.assets["0.1.4-alpha.8"], undefined);
});

test("alpha11 CLI accepts its unique selector and requires a credential before transport", () => {
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [
          fileURLToPath(
            new URL("../scripts/release/ninja-promotion.mjs", import.meta.url),
          ),
          "--promote-alpha11",
          "--private-key",
          args.privateKeyPath,
          "--output",
          args.output,
          "--checkpoint",
          args.checkpointPath,
        ],
        { env: { ...process.env, GITHUB_TOKEN: "" }, stdio: "pipe" },
      ),
    (error) => {
      assert.match(
        error.stderr.toString(),
        /Promotion requires a GitHub credential/,
      );
      return true;
    },
  );
});
