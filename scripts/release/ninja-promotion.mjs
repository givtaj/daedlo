#!/usr/bin/env node
/** Trusted reviewed release preparation for the existing renewal workflow. It fetches a
 * fixed, reviewed kit from GitHub and delegates signing/staging to renewal. The
 * workflow must persist its normal checkpoint before any deployment. This tool
 * neither publishes a GitHub release nor deploys a Worker. Policy, transport and
 * preparation seams are for trusted tests only; the CLI accepts paths and one
 * allowlisted release selector only.
 */
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "./manifest.mjs";
import {
  prepareNinjaRenewal,
  PRODUCTION_RENEWAL_POLICY,
} from "./ninja-renew.mjs";

const REPOSITORY = "givtaj/daedlo";
const REPOSITORY_ID = 1391092739;
const BASE = `https://api.github.com/repos/${REPOSITORY}`;
const ALPHA4 = "0.1.4-alpha.4";
const ALPHA5 = "0.1.4-alpha.5";
const ALPHA6 = "0.1.4-alpha.6";
const ALPHA7 = "0.1.4-alpha.7";
const MAX_JSON = 1024 * 1024;
const MAX_ASSET = 64 * 1024 * 1024;
const fail = (message) => {
  throw Error(`Promotion ${message}`);
};
const positive = (n) => Number.isSafeInteger(n) && n > 0;

function pinned(policy, version) {
  const promotion =
    version === ALPHA7
      ? policy?.alpha7Promotion
      : version === ALPHA6
        ? policy?.alpha6Promotion
        : version === ALPHA5
          ? policy?.alpha5Promotion
          : policy?.promotion;
  const pins = policy?.assets?.[version];
  const names = [`daedlo-${version}.zip`, "release.json", "SHA256SUMS"];
  if (
    promotion?.version !== version ||
    !/^[a-f0-9]{40}$/.test(promotion?.sourceCommit ?? "") ||
    !pins ||
    Object.keys(pins).sort().join() !== [...names].sort().join() ||
    names.some(
      (name) =>
        !positive(pins[name]?.bytes) ||
        pins[name].bytes > (name === names[0] ? MAX_ASSET : MAX_JSON) ||
        !/^[a-f0-9]{64}$/.test(pins[name]?.sha256 ?? ""),
    )
  )
    fail("requires reviewed candidate source and exact asset pins");
  return {
    sourceCommit: promotion.sourceCommit,
    pins: structuredClone(pins),
    names,
  };
}
async function request(fetchImpl, url, options) {
  try {
    return await fetchImpl(url, {
      ...options,
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    // Do not surface credentials, signed URLs, headers or transport response text.
    fail("request failed");
  }
}
async function bounded(response, maximum) {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) {
    await response.body?.cancel().catch(() => {});
    fail("response exceeds size bound");
  }
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of response.body ?? []) {
      size += chunk.length;
      if (size > maximum) fail("response exceeds size bound");
      chunks.push(chunk);
    }
  } catch {
    fail("response could not be read within its bound");
  }
  return Buffer.concat(chunks, size);
}
function json(bytes) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("API returned invalid JSON");
  }
}

export async function prepareNinjaPromotion(options = {}, deps = {}) {
  const {
    privateKeyPath,
    output,
    checkpointPath,
    promoteAlpha5 = false,
    promoteAlpha6 = false,
    promoteAlpha7 = false,
  } = options;
  if (
    Object.keys(options).some(
      (key) =>
        ![
          "privateKeyPath",
          "output",
          "checkpointPath",
          "promoteAlpha5",
          "promoteAlpha6",
          "promoteAlpha7",
        ].includes(key),
    ) ||
    typeof promoteAlpha5 !== "boolean" ||
    typeof promoteAlpha6 !== "boolean" ||
    typeof promoteAlpha7 !== "boolean" ||
    [promoteAlpha5, promoteAlpha6, promoteAlpha7].filter(Boolean).length > 1 ||
    [privateKeyPath, output, checkpointPath].some(
      (path) =>
        typeof path !== "string" || !isAbsolute(path) || path.includes("\0"),
    )
  )
    fail("requires explicit key, output and checkpoint paths");
  const policy = deps.policy ?? PRODUCTION_RENEWAL_POLICY;
  const version = promoteAlpha7
    ? ALPHA7
    : promoteAlpha6
      ? ALPHA6
      : promoteAlpha5
        ? ALPHA5
        : ALPHA4;
  const tag = `v${version}`;
  const publicBase = `https://daedlo.com/downloads/${version}/`;
  const { pins, sourceCommit, names } = pinned(policy, version);
  const token = deps.token ?? process.env.GITHUB_TOKEN;
  if (typeof token !== "string" || !token || /\s/.test(token))
    fail("requires a GitHub credential");
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  async function api(path, { missingDraftTag = false } = {}) {
    const response = await request(fetchImpl, BASE + path, {
      headers,
      redirect: "manual",
    });
    if (response.status === 404 && missingDraftTag) return null;
    if (response.status !== 200)
      fail(`GitHub request failed (${response.status})`);
    return json(await bounded(response, MAX_JSON));
  }
  const repository = await api("");
  if (repository?.id !== REPOSITORY_ID || repository.full_name !== REPOSITORY)
    fail("repository identity mismatch");
  // The tag endpoint exposes published releases only. Bounded listing also finds
  // drafts when this workflow's read token has permission to see them.
  const matches = [];
  for (let page = 1; ; page++) {
    if (page > 10) fail("release inventory exceeds page bound");
    const releases = await api(`/releases?per_page=100&page=${page}`);
    if (!Array.isArray(releases) || releases.length > 100)
      fail("invalid release inventory");
    matches.push(...releases.filter((release) => release?.tag_name === tag));
    if (releases.length < 100) break;
  }
  if (matches.length !== 1)
    fail("requires exactly one visible candidate release");
  const release = matches[0];
  if (
    !positive(release.id) ||
    release.target_commitish !== sourceCommit ||
    typeof release.draft !== "boolean" ||
    release.prerelease !== true
  )
    fail("release tag or source identity mismatch");
  // target_commitish is release metadata, not proof of an existing Git tag.
  // Resolve the fixed ref independently; drafts may not have created it yet.
  const ref = await api(`/git/ref/tags/${tag}`, { missingDraftTag: true });
  if (ref === null) {
    if (!release.draft) fail("published release tag is missing");
  } else {
    if (ref.ref !== `refs/tags/${tag}`) fail("tag reference mismatch");
    let object = ref.object;
    const seen = new Set();
    for (let depth = 0; object?.type === "tag"; depth++) {
      if (
        depth >= 5 ||
        !/^[a-f0-9]{40}$/.test(object.sha ?? "") ||
        seen.has(object.sha)
      )
        fail("annotated tag history is invalid or exceeds its bound");
      seen.add(object.sha);
      const tag = await api(`/git/tags/${object.sha}`);
      if (tag?.sha !== object.sha) fail("annotated tag identity mismatch");
      object = tag.object;
    }
    if (object?.type !== "commit" || object.sha !== sourceCommit)
      fail("tag target does not match pinned source");
  }
  const assets = await api(
    `/releases/${release.id}/assets?per_page=100&page=1`,
  );
  if (
    !Array.isArray(assets) ||
    assets.length !== names.length ||
    assets
      .map((asset) => asset?.name)
      .sort()
      .join() !== [...names].sort().join() ||
    new Set(assets.map((asset) => asset.id)).size !== names.length ||
    assets.some(
      (asset) =>
        !positive(asset.id) ||
        asset.state !== "uploaded" ||
        asset.size !== pins[asset.name].bytes,
    )
  )
    fail("asset inventory or identity mismatch");
  const downloaded = new Map();
  for (const asset of assets) {
    let response = await request(
      fetchImpl,
      `${BASE}/releases/assets/${asset.id}`,
      {
        headers: { ...headers, Accept: "application/octet-stream" },
        redirect: "manual",
      },
    );
    if (response.status === 302) {
      let url;
      try {
        url = new URL(response.headers.get("location"));
      } catch {
        fail("asset redirect is invalid");
      }
      if (
        url.protocol !== "https:" ||
        url.hostname !== "release-assets.githubusercontent.com" ||
        url.username ||
        url.password ||
        url.port ||
        url.hash
      )
        fail("asset redirect origin is not allowed");
      response = await request(fetchImpl, url.href, { redirect: "error" });
    }
    if (response.status !== 200)
      fail(`asset request failed (${response.status})`);
    const bytes = await bounded(response, pins[asset.name].bytes);
    if (
      bytes.length !== pins[asset.name].bytes ||
      sha256(bytes) !== pins[asset.name].sha256
    )
      fail("asset integrity mismatch");
    downloaded.set(publicBase + asset.name, bytes);
  }
  const metadata = json(downloaded.get(publicBase + "release.json"));
  if (
    metadata?.schemaVersion !== 1 ||
    metadata.kind !== "daedlo-public-kit" ||
    metadata.version !== version ||
    metadata.source?.commit !== sourceCommit ||
    metadata.source.dirty !== false ||
    !/^[a-f0-9]{64}$/.test(metadata.source.treeSha256 ?? "")
  )
    fail("source identity mismatch");
  const prepare = deps.prepareImpl ?? prepareNinjaRenewal;
  return prepare(
    {
      privateKeyPath,
      output,
      checkpointPath,
      [promoteAlpha7
        ? "promoteAlpha7"
        : promoteAlpha6
          ? "promoteAlpha6"
          : promoteAlpha5
            ? "promoteAlpha5"
            : "promoteAlpha4"]: true,
    },
    {
      policy,
      ...(deps.now === undefined ? {} : { now: deps.now }),
      ...(deps.sourceRoot === undefined ? {} : { sourceRoot: deps.sourceRoot }),
      fetchImpl: (input, init) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input?.url;
        const bytes = downloaded.get(url);
        if (bytes) {
          if (init?.method && init.method !== "GET")
            fail("candidate transport requires GET");
          return Promise.resolve(
            new Response(bytes, {
              headers: { "content-length": String(bytes.length) },
            }),
          );
        }
        return fetchImpl(input, init);
      },
    },
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2),
      parsed = {};
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i],
        value = args[i + 1];
      if (
        !["--private-key", "--output", "--checkpoint", "--release"].includes(
          key,
        ) ||
        Object.hasOwn(parsed, key) ||
        !value ||
        value.startsWith("--")
      )
        fail("CLI accepts only explicit paths and an allowlisted --release");
      parsed[key] = value;
    }
    if (
      parsed["--release"] &&
      ![ALPHA4, ALPHA5, ALPHA6, ALPHA7].includes(parsed["--release"])
    )
      fail("unsupported release selector");
    const result = await prepareNinjaPromotion({
      privateKeyPath: parsed["--private-key"],
      output: parsed["--output"],
      checkpointPath: parsed["--checkpoint"],
      promoteAlpha5: parsed["--release"] === ALPHA5,
      promoteAlpha6: parsed["--release"] === ALPHA6,
      promoteAlpha7: parsed["--release"] === ALPHA7,
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    // Underlying preparation errors are already bounded by the renewal tool.
    console.error(error.message);
    process.exitCode = 1;
  }
}
