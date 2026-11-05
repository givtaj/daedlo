import assert from "node:assert/strict";
import test from "node:test";
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
        [version.endsWith("alpha.7")
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
