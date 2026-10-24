#!/usr/bin/env node
/** Trusted alpha.4 preparation for the existing renewal workflow. It fetches a
 * fixed, reviewed kit from GitHub and delegates signing/staging to renewal. The
 * workflow must persist its normal checkpoint before any deployment. This tool
 * neither publishes a GitHub release nor deploys a Worker. Policy, transport and
 * preparation seams are for trusted tests only; the CLI accepts paths only.
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
const VERSION = "0.1.4-alpha.4";
const TAG = `v${VERSION}`;
const PUBLIC_BASE = `https://daedlo.com/downloads/${VERSION}/`;
const NAMES = [`daedlo-${VERSION}.zip`, "release.json", "SHA256SUMS"];
const MAX_JSON = 1024 * 1024;
const MAX_ASSET = 64 * 1024 * 1024;
const fail = (message) => {
  throw Error(`Promotion ${message}`);
};
const positive = (n) => Number.isSafeInteger(n) && n > 0;

function pinned(policy) {
  const promotion = policy?.promotion;
  const pins = policy?.assets?.[VERSION];
  if (
    promotion?.version !== VERSION ||
    !/^[a-f0-9]{40}$/.test(promotion?.sourceCommit ?? "") ||
    !pins ||
    Object.keys(pins).sort().join() !== [...NAMES].sort().join() ||
    NAMES.some(
      (name) =>
        !positive(pins[name]?.bytes) ||
        pins[name].bytes > (name === NAMES[0] ? MAX_ASSET : MAX_JSON) ||
        !/^[a-f0-9]{64}$/.test(pins[name]?.sha256 ?? ""),
    )
  )
    fail("requires reviewed candidate source and exact asset pins");
  return { sourceCommit: promotion.sourceCommit, pins: structuredClone(pins) };
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
  const { privateKeyPath, output, checkpointPath } = options;
  if (
    Object.keys(options).some(
      (key) => !["privateKeyPath", "output", "checkpointPath"].includes(key),
    ) ||
    [privateKeyPath, output, checkpointPath].some(
      (path) =>
        typeof path !== "string" || !isAbsolute(path) || path.includes("\0"),
    )
  )
    fail("requires explicit key, output and checkpoint paths");
  const policy = deps.policy ?? PRODUCTION_RENEWAL_POLICY;
  const { pins, sourceCommit } = pinned(policy);
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
    matches.push(...releases.filter((release) => release?.tag_name === TAG));
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
  const ref = await api(`/git/ref/tags/${TAG}`, { missingDraftTag: true });
  if (ref === null) {
    if (!release.draft) fail("published release tag is missing");
  } else {
    if (ref.ref !== `refs/tags/${TAG}`) fail("tag reference mismatch");
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
    assets.length !== NAMES.length ||
    assets
      .map((asset) => asset?.name)
      .sort()
      .join() !== [...NAMES].sort().join() ||
    new Set(assets.map((asset) => asset.id)).size !== NAMES.length ||
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
    downloaded.set(PUBLIC_BASE + asset.name, bytes);
  }
  const metadata = json(downloaded.get(PUBLIC_BASE + "release.json"));
  if (
    metadata?.schemaVersion !== 1 ||
    metadata.kind !== "daedlo-public-kit" ||
    metadata.version !== VERSION ||
    metadata.source?.commit !== sourceCommit ||
    metadata.source.dirty !== false ||
    !/^[a-f0-9]{64}$/.test(metadata.source.treeSha256 ?? "")
  )
    fail("source identity mismatch");
  const prepare = deps.prepareImpl ?? prepareNinjaRenewal;
  return prepare(
    { privateKeyPath, output, checkpointPath, promoteAlpha4: true },
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
        !["--private-key", "--output", "--checkpoint"].includes(key) ||
        Object.hasOwn(parsed, key) ||
        !value ||
        value.startsWith("--")
      )
        fail("CLI accepts only --private-key, --output and --checkpoint paths");
      parsed[key] = value;
    }
    const result = await prepareNinjaPromotion({
      privateKeyPath: parsed["--private-key"],
      output: parsed["--output"],
      checkpointPath: parsed["--checkpoint"],
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    // Underlying preparation errors are already bounded by the renewal tool.
    console.error(error.message);
    process.exitCode = 1;
  }
}
