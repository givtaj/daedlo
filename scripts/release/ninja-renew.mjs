#!/usr/bin/env node
/** Production signed feed renewal. This issuer-side tool never deploys, changes
 * consumer verification, installs packages, or copies private keys. The CLI pins
 * one production origin/key and an explicitly pinned immutable release inventory. Reviewed source
 * changes must explicitly extend that inventory before a later product release.
 *
 * prepare --private-key ABS --output FRESH_ABS [--checkpoint SIGNED_CATALOG]
 * verify --output ABS  (immediately before deployment; live baseline must match)
 * live --output ABS [--wait-for-assets] (after deployment; verifies all bytes/boundaries)
 *
 * The workflow persists output/checkpoint before deployment. A checkpoint ahead
 * of the live feed is an operator-recovery condition, not permission to replay.
 * Injected policy/transport/source/clock are trusted test seams, never CLI options.
 */
import fs from "node:fs/promises";
import { constants } from "node:fs";
import { createPublicKey } from "node:crypto";
import { dirname, isAbsolute, join, parse, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { sha256 } from "./manifest.mjs";
import { verifyNinjaCatalog, compareNinjaVersions } from "./ninja-catalog.mjs";
import {
  inspectPublisherKey,
  publishNinjaCatalog,
} from "./ninja-publisher.mjs";
import {
  PUBLIC_FILES,
  CONTROL_FILES,
  createWebsiteManifest,
} from "../../website/scripts/manifest.mjs";
import { stageRelease } from "../../website/scripts/stage-release.mjs";
import { stageUpdates } from "../../website/scripts/stage-updates.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ORIGIN = "https://daedlo.com",
  FEED = ORIGIN + "/updates/preview.json",
  KEY = "daedlo-release-2026-10";
const VERSIONS = ["0.1.2-rc.1", "0.1.4-alpha.2", "0.1.4-alpha.3"];
const ALPHA4 = "0.1.4-alpha.4",
  ALPHA5 = "0.1.4-alpha.5",
  ALPHA6 = "0.1.4-alpha.6",
  ALPHA7 = "0.1.4-alpha.7",
  ALPHA9 = "0.1.4-alpha.9",
  ALPHA10 = "0.1.4-alpha.10",
  DAY = 86400000;
const CONTRACTS = {
  manager: 1,
  launcher: 1,
  nodeAdapter: 1,
  rustModel: 1,
  protocol: 1,
  capabilities: ["recipeContext:1"],
};
const item = (bytes, sha256) => ({ bytes, sha256 });
export const PRODUCTION_RENEWAL_POLICY = Object.freeze({
  publicKeyPemSha256:
    "df84f7d60ed2af949d394e338070ef66ab4debabf911ffd6c7b35bebe6ba4297",
  initialCheckpoint: {
    generation: 1,
    sha256: "bde773d01a3cb0bb33330b74b17dd7e5068e33fb650a55d558d446a10f5bbad0",
  },
  promotion: {
    version: "0.1.4-alpha.4",
    sourceCommit: "7bb3491aa49a7e9c8321e20db8904a75e7e63e03",
  },
  // Exact accepted package source; later publisher commits do not rebuild it.
  alpha5Promotion: {
    version: ALPHA5,
    sourceCommit: "6577d8fd578c1df8f3cc74eb6436dc537061ba21",
  },
  alpha6Promotion: {
    version: ALPHA6,
    sourceCommit: "9f1210053c09ead91e0e71c3b3423c560a818ca1",
  },
  alpha7Promotion: {
    version: ALPHA7,
    sourceCommit: "9cbff73ad1b8d5e64b11c7358050eebc3cd1d392",
  },
  alpha9Promotion: {
    version: ALPHA9,
    sourceCommit: "30d2a985964011c08d80db2e83a3716a2c151345",
  },
  alpha10Promotion: {
    version: ALPHA10,
    sourceCommit: "61163084f9b02ec2448eee04c7aebc4994075936",
  },
  releaseContracts: {
    "0.1.4-alpha.4": { ...CONTRACTS, manager: 2 },
    "0.1.4-alpha.5": { ...CONTRACTS, manager: 2 },
    "0.1.4-alpha.6": { ...CONTRACTS, manager: 2 },
    "0.1.4-alpha.7": { ...CONTRACTS, manager: 2 },
    "0.1.4-alpha.9": { ...CONTRACTS, manager: 2 },
    "0.1.4-alpha.10": { ...CONTRACTS, manager: 2 },
  },
  assets: {
    "0.1.4-alpha.10": {
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
    },
    "0.1.4-alpha.9": {
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
    },
    "0.1.4-alpha.7": {
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
    },
    "0.1.4-alpha.6": {
      "daedlo-0.1.4-alpha.6.zip": {
        bytes: 301268,
        sha256:
          "536476e8a3f160d58b269873ffb6da55820e804357a95aa0f4358c9d5a515123",
      },
      "release.json": {
        bytes: 8082,
        sha256:
          "e5ba120148d22474aa457582b48754ec635f532dffea52e23bc1f65c52c991c2",
      },
      SHA256SUMS: {
        bytes: 91,
        sha256:
          "f022fed5fe80291893dc0dadf9908bbe37bdd74a24a45fcb6bf856d3816b2838",
      },
    },
    "0.1.4-alpha.5": {
      "daedlo-0.1.4-alpha.5.zip": {
        bytes: 298366,
        sha256:
          "2d9cbae796edd4cd5967b76458020e3366fa9d33cc1eed65a3e1d523eb65122f",
      },
      "release.json": {
        bytes: 7869,
        sha256:
          "865cd55317899052a4e71fff1257e835a2abe418a818a66dd1a893bc2adea704",
      },
      SHA256SUMS: {
        bytes: 91,
        sha256:
          "3698a6f2ebe9025af0ddebb13558494ff7c0673710d590255233e966e808bd3a",
      },
    },
    "0.1.4-alpha.4": {
      "daedlo-0.1.4-alpha.4.zip": {
        bytes: 280815,
        sha256:
          "3676d52869a30fba57798afd64d64722b7c8ee1e622e56f52013adc4107a6e75",
      },
      "release.json": {
        bytes: 6978,
        sha256:
          "7ff86a221af63c212bf4a271263367e72c674ff9497281da9253d3f1ffc2f70b",
      },
      SHA256SUMS: {
        bytes: 91,
        sha256:
          "f3415dda3246bca2277c2d175b22aa97bb19c301843a0e2fa9f2401dbe162b07",
      },
    },
    "0.1.2-rc.1": {
      "daedlo-0.1.2-rc.1.zip": item(
        147172,
        "da5ce1387eb147a3fb3a7225decd3e51e9fc355a505583ccc20cb2a9bf33963b",
      ),
      "release.json": item(
        6558,
        "1ff4b7053ffbd2f1196974fa3691c30531964f121b7a8161871bd6cecbfe9060",
      ),
      SHA256SUMS: item(
        88,
        "b5635817e49c00db75490c79d7112b53b90811be3742f728da71dcb9f6e30e9e",
      ),
    },
    "0.1.4-alpha.2": {
      "daedlo-0.1.4-alpha.2.zip": item(
        160545,
        "b9555b6b237ac437f62b984f6994e3ef12ba4e8f95b730f52c9aa9313a375ee1",
      ),
      "release.json": item(
        7184,
        "666d3389c182d6aba28fa650ce5b9768a20cf4f75cbd7b3ff03af168ec862cc5",
      ),
      SHA256SUMS: item(
        91,
        "8fc8a1e1cd8e1777396f12a99c2ed0eb3414d5f246aaf9019c47400195d62cc9",
      ),
    },
    "0.1.4-alpha.3": {
      "daedlo-0.1.4-alpha.3.zip": item(
        206234,
        "f569bc0c84bf1b7ac5efe59c610916ac8ab0d5bb3322ed520114d8880262b190",
      ),
      "release.json": item(
        7067,
        "e771773a0fcdcfc578208cc6572da87670af4a44c2769b15c8a8a0b5c8aebe45",
      ),
      SHA256SUMS: item(
        91,
        "1a8a91494fe684d0eabebea97ae332dad4ce8f3f907873beb90a654102ae6b6f",
      ),
    },
  },
});
const SOURCE_FILES = [...PUBLIC_FILES]
  .filter((f) => !["install.html", "updates.html"].includes(f))
  .map((f) => "website/public/" + f)
  .concat([
    "website/wrangler.jsonc",
    "website/templates/install.html",
    "website/templates/updates.html",
  ]);
const PRIVATE_PATHS = [
  "/.env",
  "/_headers",
  "/.assetsignore",
  "/wrangler.jsonc",
  "/updates/private.pem",
  "/updates/keys/private.pem",
  "/downloads/0.1.4-alpha.3/SOURCE.json",
  "/scripts/release/ninja-publisher.mjs",
  "/package.json",
];
// Diagnostics may name only reviewed request paths, never response text, arbitrary
// headers, status text, query strings or values supplied through test policy seams.
const HTTP_DIAGNOSTIC_PATHS = new Set([
  "/",
  ...[...PUBLIC_FILES].flatMap((name) =>
    name.endsWith(".html")
      ? ["/" + name, "/" + name.slice(0, -5)]
      : ["/" + name],
  ),
  "/updates/preview.json",
  `/updates/keys/${KEY}.pem`,
  ...[...VERSIONS, ALPHA4, ALPHA5, ALPHA6, ALPHA7, ALPHA9, ALPHA10].flatMap(
    (version) =>
      [`daedlo-${version}.zip`, "release.json", "SHA256SUMS"].map(
        (name) => `/downloads/${version}/${name}`,
      ),
  ),
  ...PRIVATE_PATHS,
]);
function diagnosticPath(url) {
  const parsed = new URL(url);
  return parsed.origin === ORIGIN &&
    !parsed.username &&
    !parsed.password &&
    !parsed.search &&
    !parsed.hash &&
    HTTP_DIAGNOSTIC_PATHS.has(parsed.pathname)
    ? parsed.pathname
    : "[unreviewed-path]";
}
// A closed set of categories is useful without exposing error messages, peer
// addresses, URLs, response bodies or arbitrary transport codes. Causes are
// inspected only to a bounded depth and never attached to the reported error.
const NETWORK_CODES = new Map([
  ...[
    "ETIMEDOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_BODY_TIMEOUT",
  ].map((code) => [code, "timeout"]),
  ...["ENOTFOUND", "EAI_AGAIN"].map((code) => [code, "dns"]),
  ...[
    "ECONNREFUSED",
    "ECONNRESET",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "EPIPE",
    "UND_ERR_SOCKET",
  ].map((code) => [code, "connection"]),
  ...[
    "CERT_HAS_EXPIRED",
    "CERT_NOT_YET_VALID",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "ERR_TLS_CERT_ALTNAME_INVALID",
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  ].map((code) => [code, "tls"]),
  ["ABORT_ERR", "aborted"],
]);
function networkCategory(error, signal) {
  if (signal.aborted) return "timeout";
  try {
    for (let depth = 0; depth < 4 && error; depth++, error = error.cause) {
      if (error.name === "TimeoutError") return "timeout";
      if (error.name === "AbortError") return "aborted";
      const category = NETWORK_CODES.get(error.code);
      if (category) return category;
    }
  } catch {
    // An unexpected error shape must not leak or replace the safe diagnostic.
  }
  return "network";
}
function networkFailure(url, stage, phase, error, signal) {
  return Error(
    `Renewal network failure: stage=${stage} path=${diagnosticPath(url)} phase=${phase} category=${networkCategory(error, signal)}`,
  );
}
function httpStatusFailure(url, response, expected) {
  const path = diagnosticPath(url);
  const status =
    Number.isInteger(response.status) &&
    response.status >= 100 &&
    response.status <= 599
      ? response.status
      : "unknown";
  const mitigation =
    response.headers.get("cf-mitigated") === "challenge"
      ? " cf-mitigated=challenge"
      : "";
  return `Unexpected renewal HTTP status: ${path} status=${status} expected=${expected}${mitigation}`;
}
class RenewalHttpStatusError extends Error {
  constructor(url, response, expected) {
    super(httpStatusFailure(url, response, expected));
    this.path = diagnosticPath(url);
    this.status =
      Number.isInteger(response.status) &&
      response.status >= 100 &&
      response.status <= 599
        ? response.status
        : "unknown";
    this.expected = expected;
    this.challenged = response.headers.get("cf-mitigated") === "challenge";
  }
}
class LiveAvailabilityError extends Error {
  constructor(code) {
    super(`Live asset availability failed: ${code}`);
    this.code = code;
  }
}
const LIVE_AVAILABILITY_MS = 120000;
const LIVE_AVAILABILITY_INTERVAL_MS = 5000;
const LIVE_AVAILABILITY_ATTEMPTS = 25;
function liveRemaining(s) {
  if (!s.liveWindow) return 30000;
  const remaining = Math.floor(s.liveWindow.deadline - s.liveWindow.now());
  if (remaining <= 0) throw new LiveAvailabilityError("deadline_exceeded");
  return remaining;
}
function liveWallClock(s) {
  if (!s.liveWindow) return s.now;
  return clock(
    s.liveWindow.wallClock +
      Math.ceil(s.liveWindow.now() - s.liveWindow.started),
  );
}
async function discardResponse(response) {
  await response.body?.cancel().catch(() => {});
}
function fail(message) {
  throw Error(message);
}
function clock(now) {
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !Number.isFinite(new Date(now).getTime())
  )
    fail("Invalid renewal clock");
  return now;
}
async function pathInfo(value, { fresh = false, directory = false } = {}) {
  if (
    typeof value !== "string" ||
    !isAbsolute(value) ||
    value.includes("\0") ||
    value.split(/[\\/]/).includes("..")
  )
    fail("Explicit absolute renewal path required");
  const path = resolve(value);
  let at = parse(path).root;
  for (const part of path.slice(at.length).split(sep).filter(Boolean)) {
    at = join(at, part);
    let s;
    try {
      s = await fs.lstat(at);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    if (s?.isSymbolicLink()) fail("Renewal paths cannot contain symlinks");
    if (at !== path) {
      if (!s?.isDirectory()) fail("Renewal parent directory missing");
    } else if (fresh) {
      if (s) fail("Renewal output must be fresh");
    } else if (!s || (directory ? !s.isDirectory() : !s.isFile()))
      fail("Expected regular renewal input");
  }
  if (fresh && path === parse(path).root) fail("Renewal output must be fresh");
  return path;
}
async function read(path, max = 4 * 1024 * 1024) {
  await pathInfo(path);
  const h = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = await h.stat();
    if (!s.isFile() || s.size > max) fail("Renewal input exceeds bounded size");
    const b = await h.readFile();
    if (b.length !== s.size || b.length > max) fail("Renewal input changed");
    return b;
  } finally {
    await h.close();
  }
}
function settings(deps = {}, stage) {
  const policy = deps.policy ?? PRODUCTION_RENEWAL_POLICY;
  const versions = [
    ...VERSIONS,
    ...(Object.hasOwn(policy.assets, ALPHA4) ? [ALPHA4] : []),
    ...(Object.hasOwn(policy.assets, ALPHA5) ? [ALPHA5] : []),
    ...(Object.hasOwn(policy.assets, ALPHA6) ? [ALPHA6] : []),
    ...(Object.hasOwn(policy.assets, ALPHA7) ? [ALPHA7] : []),
    ...(Object.hasOwn(policy.assets, ALPHA9) ? [ALPHA9] : []),
    ...(Object.hasOwn(policy.assets, ALPHA10) ? [ALPHA10] : []),
  ];
  if (
    (Object.hasOwn(policy.assets, ALPHA5) &&
      !Object.hasOwn(policy.assets, ALPHA4)) ||
    (Object.hasOwn(policy.assets, ALPHA6) &&
      !Object.hasOwn(policy.assets, ALPHA5)) ||
    (Object.hasOwn(policy.assets, ALPHA7) &&
      !Object.hasOwn(policy.assets, ALPHA6)) ||
    (Object.hasOwn(policy.assets, ALPHA9) &&
      !Object.hasOwn(policy.assets, ALPHA7)) ||
    (Object.hasOwn(policy.assets, ALPHA10) &&
      !Object.hasOwn(policy.assets, ALPHA9)) ||
    !isDeepStrictEqual(Object.keys(policy.assets).sort(), [...versions].sort())
  )
    fail("Unsupported pinned renewal release inventory");
  const releaseContracts = policy.releaseContracts ?? {};
  if (
    !releaseContracts ||
    typeof releaseContracts !== "object" ||
    Array.isArray(releaseContracts) ||
    Object.keys(releaseContracts).some((v) => !versions.slice(1).includes(v))
  )
    fail("Unsupported pinned release contracts");
  for (const version of versions.slice(1)) {
    const expected = {
      ...CONTRACTS,
      manager: [ALPHA4, ALPHA5, ALPHA6, ALPHA7, ALPHA9, ALPHA10].includes(
        version,
      )
        ? 2
        : 1,
    };
    if (!isDeepStrictEqual(releaseContracts[version] ?? CONTRACTS, expected))
      fail("Unsupported pinned release contracts");
  }
  return {
    stage,
    versions,
    releaseContracts,
    fetchImpl: deps.fetchImpl ?? globalThis.fetch,
    now: clock(deps.now ?? Date.now()),
    sourceRoot: resolve(deps.sourceRoot ?? ROOT),
    policy,
  };
}
async function trust(s) {
  const path = join(s.sourceRoot, "docs/update-trust", KEY + ".pem");
  const pem = await read(path, 8192);
  if (
    sha256(pem) !== s.policy.publicKeyPemSha256 ||
    !pem.toString().startsWith("-----BEGIN PUBLIC KEY-----\n")
  )
    fail("Bundled production public key pin differs");
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== "ed25519")
    fail("Production key must be Ed25519");
  return { pem, key, keys: [{ id: KEY, publicKey: key }] };
}
async function fetchBytes(
  url,
  s,
  {
    maximum = 256 * 1024,
    status = 200,
    date = false,
    htmlRedirect = false,
  } = {},
) {
  if (!url.startsWith(ORIGIN + "/") || new URL(url).origin !== ORIGIN)
    fail("Unsupported renewal origin");
  const signal = AbortSignal.timeout(Math.min(30000, liveRemaining(s)));
  let response;
  try {
    response = await s.fetchImpl(url, {
      redirect: htmlRedirect ? "manual" : "error",
      headers: { "Cache-Control": "no-cache" },
      signal,
    });
  } catch (error) {
    liveRemaining(s);
    throw networkFailure(url, s.stage, "headers", error, signal);
  }
  try {
    liveRemaining(s);
  } catch (error) {
    await discardResponse(response);
    throw error;
  }
  if (response.redirected || (response.url && response.url !== url))
    fail("Renewal response changed origin or URL");
  if (htmlRedirect && [301, 302, 307, 308].includes(response.status)) {
    const canonical = url.endsWith("/index.html")
      ? ORIGIN + "/"
      : url.slice(0, -5);
    if (new URL(response.headers.get("location") ?? "", url).href !== canonical)
      fail("Unexpected HTML canonical redirect");
    await discardResponse(response);
    return fetchBytes(canonical, s, { maximum, status, date });
  }
  if (response.status !== status) {
    const error = new RenewalHttpStatusError(url, response, status);
    await discardResponse(response);
    throw error;
  }
  if (date) {
    const observed = Date.parse(response.headers.get("date") ?? "");
    if (!Number.isFinite(observed) || Math.abs(observed - s.now) > 5 * 60000)
      fail("Renewal clock disagrees with HTTPS Date");
  }
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum))
    fail("Renewal response exceeds bounded size");
  if (!response.body) fail("Missing renewal response body");
  const reader = response.body.getReader(),
    chunks = [];
  let total = 0;
  try {
    for (;;) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch (error) {
        liveRemaining(s);
        throw networkFailure(url, s.stage, "body", error, signal);
      }
      liveRemaining(s);
      const { done, value } = chunk;
      if (done) break;
      total += value.length;
      if (total > maximum) fail("Renewal response exceeds bounded size");
      chunks.push(Buffer.from(value));
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  } finally {
    reader.releaseLock();
  }
  return { bytes: Buffer.concat(chunks, total), headers: response.headers };
}
function history(bytes, s, t, previousState = null) {
  let envelope;
  try {
    envelope = JSON.parse(bytes);
  } catch {
    fail("Invalid renewal catalog JSON");
  }
  const issued = Date.parse(envelope.signed?.issuedAt);
  if (!Number.isFinite(issued) || issued > s.now)
    fail("Catalog issuance is ahead of renewal clock");
  // Issuer-only history authentication; downloaded/current consumer checks retain expiry.
  const verified = verifyNinjaCatalog({
    bytes,
    publisher: "daedlo",
    trustedKeys: t.keys,
    now: issued,
    previousState,
  });
  const versions = verified.catalog.releases
    .map((r) => r.version)
    .sort(compareNinjaVersions);
  if (
    !s.versions
      .slice(VERSIONS.length - 1)
      .some((_, index) =>
        isDeepStrictEqual(
          versions,
          s.versions.slice(1, VERSIONS.length + index),
        ),
      )
  )
    fail("Unsupported renewal release inventory");
  for (const release of verified.catalog.releases) {
    if (
      release.channel !== "preview" ||
      !isDeepStrictEqual(release.platforms, [
        { os: "darwin", arch: "arm64" },
      ]) ||
      !isDeepStrictEqual(
        release.contracts,
        s.releaseContracts[release.version] ?? CONTRACTS,
      ) ||
      release.notesUrl !== ORIGIN + "/updates.html"
    )
      fail("Unsupported immutable release contract");
    for (const [field, name] of [
      ["kit", `daedlo-${release.version}.zip`],
      ["metadata", "release.json"],
      ["checksums", "SHA256SUMS"],
    ]) {
      if (
        !isDeepStrictEqual(release[field], {
          url: `${ORIGIN}/downloads/${release.version}/${name}`,
          ...s.policy.assets[release.version][name],
        })
      )
        fail("Signed immutable asset identity or URL changed");
    }
  }
  return verified;
}
function requireBaselineInventory(
  verified,
  s,
  promoteAlpha4,
  promoteAlpha5 = false,
  promoteAlpha6 = false,
  promoteAlpha7 = false,
  promoteAlpha9 = false,
  promoteAlpha10 = false,
) {
  if (
    typeof promoteAlpha4 !== "boolean" ||
    typeof promoteAlpha5 !== "boolean" ||
    typeof promoteAlpha6 !== "boolean" ||
    typeof promoteAlpha7 !== "boolean" ||
    typeof promoteAlpha9 !== "boolean" ||
    typeof promoteAlpha10 !== "boolean" ||
    [
      promoteAlpha4,
      promoteAlpha5,
      promoteAlpha6,
      promoteAlpha7,
      promoteAlpha9,
      promoteAlpha10,
    ].filter(Boolean).length > 1
  )
    fail("Only one explicit release promotion may be selected");
  const selected = promoteAlpha10
    ? ALPHA10
    : promoteAlpha9
      ? ALPHA9
      : promoteAlpha7
        ? ALPHA7
        : promoteAlpha6
          ? ALPHA6
          : promoteAlpha5
            ? ALPHA5
            : promoteAlpha4
              ? ALPHA4
              : null;
  if (
    selected &&
    (!s.versions.includes(selected) || s.versions.at(-1) !== selected)
  )
    fail(
      "Release promotion requires its explicitly pinned next release inventory",
    );
  const actual = verified.catalog.releases
    .map((r) => r.version)
    .sort(compareNinjaVersions);
  const complete = s.versions.slice(1);
  if (isDeepStrictEqual(actual, complete)) return;
  // A promotion adds exactly one reviewed next release. It cannot skip a pinned predecessor,
  // replay an old promotion to add a later kit, or remove any retained entry.
  // Alpha.8 was held: alpha.9 follows retained alpha.7 in this closed inventory.
  if (selected && isDeepStrictEqual(actual, complete.slice(0, -1))) return;
  fail("Renewal baseline inventory requires explicit next-release promotion");
}
async function baseline(
  s,
  t,
  checkpointPath,
  promoteAlpha4,
  promoteAlpha5,
  promoteAlpha6,
  promoteAlpha7,
  promoteAlpha9,
  promoteAlpha10,
) {
  const response = await fetchBytes(FEED, s, { date: true });
  const retained = checkpointPath
    ? history(await read(checkpointPath, 256 * 1024), s, t)
    : null;
  const verified = history(response.bytes, s, t, retained?.checkpoint);
  requireBaselineInventory(
    verified,
    s,
    promoteAlpha4,
    promoteAlpha5,
    promoteAlpha6,
    promoteAlpha7,
    promoteAlpha9,
    promoteAlpha10,
  );
  if (retained) {
    for (const release of retained.catalog.releases)
      if (
        !isDeepStrictEqual(
          verified.catalog.releases.find((r) => r.version === release.version),
          release,
        )
      )
        fail("Live catalog omitted or changed retained release entries");
  }
  if (
    !checkpointPath &&
    !isDeepStrictEqual(verified.checkpoint, s.policy.initialCheckpoint)
  )
    fail(
      "Durable signed checkpoint required after initial released generation",
    );
  if (!Number.isSafeInteger(verified.catalog.generation + 1))
    fail("Catalog generation overflow");
  return { ...verified, bytes: response.bytes };
}
async function inventory(sourceRoot, paths) {
  return Promise.all(
    paths.map(async (path) => {
      const bytes = await read(join(sourceRoot, path));
      return { path, bytes: bytes.length, sha256: sha256(bytes) };
    }),
  );
}
async function jsonWrite(path, value) {
  await fs.writeFile(path, JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
}
async function assertBaseline(bytes, s, t) {
  const latest = await fetchBytes(FEED, s, { date: true });
  history(latest.bytes, s, t);
  if (!latest.bytes.equals(bytes))
    fail("Live catalog baseline changed; concurrent renewal or drift");
}

/** Prepare reviewed source plus authenticated immutable downloads in a fresh tree.
 * No publish authority is used here. The returned checkpoint is public signed data. */
export async function prepareNinjaRenewal(
  {
    privateKeyPath,
    output,
    checkpointPath,
    promoteAlpha4 = false,
    promoteAlpha5 = false,
    promoteAlpha6 = false,
    promoteAlpha7 = false,
    promoteAlpha9 = false,
    promoteAlpha10 = false,
    ...unknown
  } = {},
  deps = {},
) {
  if (Object.keys(unknown).length) fail("Unsupported renewal option");
  const s = settings(deps, "prepare"),
    t = await trust(s);
  output = await pathInfo(output, { fresh: true });
  const inspected = await inspectPublisherKey({ privateKeyPath, keyId: KEY });
  if (!Buffer.from(inspected.publicKeyPem).equals(t.pem))
    fail("Private signing key does not match bundled production pin");
  const prior = await baseline(
    s,
    t,
    checkpointPath,
    promoteAlpha4,
    promoteAlpha5,
    promoteAlpha6,
    promoteAlpha7,
    promoteAlpha9,
    promoteAlpha10,
  );
  const sourceBefore = await inventory(s.sourceRoot, SOURCE_FILES);
  await fs.mkdir(output, { mode: 0o700 });
  const site = join(output, "site"),
    downloads = join(output, "inputs");
  await fs.mkdir(site);
  await fs.mkdir(downloads);
  for (const file of SOURCE_FILES) {
    const target = join(site, file.slice("website/".length));
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.writeFile(target, await read(join(s.sourceRoot, file)), {
      flag: "wx",
      mode: 0o644,
    });
  }
  for (const version of s.versions) {
    const dir = join(downloads, version);
    await fs.mkdir(dir);
    for (const [name, pin] of Object.entries(s.policy.assets[version])) {
      const { bytes } = await fetchBytes(
        `${ORIGIN}/downloads/${version}/${name}`,
        s,
        { maximum: pin.bytes },
      );
      if (bytes.length !== pin.bytes || sha256(bytes) !== pin.sha256)
        fail("Immutable asset bytes or digest changed");
      await fs.writeFile(join(dir, name), bytes, { flag: "wx" });
    }
    await stageRelease({
      websiteRoot: site,
      releaseDirectory: dir,
      expectedVersion: version,
    });
  }
  const baselinePath = join(output, "baseline-catalog.json");
  await fs.writeFile(baselinePath, prior.bytes, { flag: "wx" });
  const pub = await publishNinjaCatalog(
    {
      schemaVersion: 1,
      publisher: "daedlo",
      keyId: KEY,
      privateKeyPath,
      generation: prior.catalog.generation + 1,
      issuedAt: new Date(s.now).toISOString(),
      expiresAt: new Date(s.now + 7 * DAY).toISOString(),
      origin: ORIGIN,
      catalogUrl: FEED,
      notesUrl: ORIGIN + "/updates.html",
      channel: "preview",
      platforms: [{ os: "darwin", arch: "arm64" }],
      contracts: CONTRACTS,
      releaseContracts: s.releaseContracts,
      kitDirectories: s.versions.slice(1).map((v) => join(downloads, v)),
      output: join(output, "signed"),
      previousCatalogPath: baselinePath,
    },
    { now: s.now },
  );
  const catalogPath = join(output, "signed/preview.json"),
    catalog = await read(catalogPath, 256 * 1024);
  const updateTrust = {
    keyId: KEY,
    publisher: "daedlo",
    expectedPublicKeySha256: s.policy.publicKeyPemSha256,
  };
  await stageUpdates({
    websiteRoot: site,
    catalogFile: catalogPath,
    publicKeyFile: join(s.sourceRoot, "docs/update-trust", KEY + ".pem"),
    expectedVersion: s.versions.at(-1),
    ...updateTrust,
  });
  const manifest = await createWebsiteManifest({
    websiteRoot: site,
    updateTrust,
  });
  if (
    !isDeepStrictEqual(
      await inventory(s.sourceRoot, SOURCE_FILES),
      sourceBefore,
    )
  )
    fail("Reviewed website source changed while preparing");
  await assertBaseline(prior.bytes, s, t);
  await fs.mkdir(join(output, "checkpoint"));
  await fs.writeFile(join(output, "checkpoint/catalog.json"), catalog, {
    flag: "wx",
  });
  await jsonWrite(join(output, "checkpoint/receipt.json"), {
    schemaVersion: 1,
    generation: pub.generation,
    catalogSha256: sha256(catalog),
    catalogPayloadSha256: pub.checkpoint.sha256,
  });
  const receipt = {
    schemaVersion: 1,
    kind: "daedlo-feed-renewal",
    promoteAlpha4,
    promoteAlpha5,
    promoteAlpha6,
    promoteAlpha7,
    promoteAlpha9,
    promoteAlpha10,
    status: "PREPARED",
    generation: pub.generation,
    baselineGeneration: prior.catalog.generation,
    baselineSha256: sha256(prior.bytes),
    baselinePayloadSha256: prior.catalogSha256,
    catalogSha256: sha256(catalog),
    catalogPayloadSha256: pub.checkpoint.sha256,
    issuedAt: new Date(s.now).toISOString(),
    expiresAt: new Date(s.now + 7 * DAY).toISOString(),
    sourceUnchanged: true,
    sourceFiles: sourceBefore,
    manifest,
  };
  await jsonWrite(join(output, "renewal-receipt.json"), receipt);
  return {
    status: "PREPARED",
    sitePath: site,
    receiptPath: join(output, "renewal-receipt.json"),
    generation: pub.generation,
    baselineSha256: receipt.baselineSha256,
    expiresAt: receipt.expiresAt,
  };
}
async function prepared(output, s, t) {
  output = await pathInfo(output, { directory: true });
  const receipt = JSON.parse(await read(join(output, "renewal-receipt.json")));
  if (
    receipt.schemaVersion !== 1 ||
    receipt.kind !== "daedlo-feed-renewal" ||
    receipt.status !== "PREPARED" ||
    receipt.generation !== receipt.baselineGeneration + 1
  )
    fail("Invalid renewal preparation receipt");
  const catalog = await read(
      join(output, "site/public/updates/preview.json"),
      256 * 1024,
    ),
    prior = await read(join(output, "baseline-catalog.json"), 256 * 1024);
  const verified = verifyNinjaCatalog({
    bytes: catalog,
    publisher: "daedlo",
    trustedKeys: t.keys,
    now: s.now,
  });
  if (
    sha256(catalog) !== receipt.catalogSha256 ||
    sha256(prior) !== receipt.baselineSha256 ||
    verified.catalog.generation !== receipt.generation ||
    verified.catalog.expiresAt !== receipt.expiresAt ||
    Date.parse(verified.catalog.issuedAt) > s.now
  )
    fail("Renewal catalog identity changed");
  const old = history(prior, s, t);
  requireBaselineInventory(
    old,
    s,
    receipt.promoteAlpha4 ?? false,
    receipt.promoteAlpha5 ?? false,
    receipt.promoteAlpha6 ?? false,
    receipt.promoteAlpha7 ?? false,
    receipt.promoteAlpha9 ?? false,
    receipt.promoteAlpha10 ?? false,
  );
  const next = history(catalog, s, t, old.checkpoint);
  requireBaselineInventory(next, s, false);
  if (
    old.catalog.generation !== receipt.baselineGeneration ||
    old.catalogSha256 !== receipt.baselinePayloadSha256
  )
    fail("Renewal baseline identity changed");
  for (const release of old.catalog.releases)
    if (
      !isDeepStrictEqual(
        verified.catalog.releases.find((r) => r.version === release.version),
        release,
      )
    )
      fail("Renewal changed immutable release entries");
  const manifest = await createWebsiteManifest({
    websiteRoot: join(output, "site"),
    updateTrust: {
      keyId: KEY,
      publisher: "daedlo",
      expectedPublicKeySha256: s.policy.publicKeyPemSha256,
    },
  });
  if (!isDeepStrictEqual(manifest, receipt.manifest))
    fail("Prepared website manifest changed");
  if (
    !isDeepStrictEqual(
      await inventory(s.sourceRoot, SOURCE_FILES),
      receipt.sourceFiles,
    )
  )
    fail("Reviewed source changed since preparation");
  const checkpoint = await read(
    join(output, "checkpoint/catalog.json"),
    256 * 1024,
  );
  if (!checkpoint.equals(catalog)) fail("Renewal checkpoint changed");
  const checkpointReceipt = JSON.parse(
    await read(join(output, "checkpoint/receipt.json"), 8192),
  );
  if (
    !isDeepStrictEqual(checkpointReceipt, {
      schemaVersion: 1,
      generation: verified.catalog.generation,
      catalogSha256: sha256(catalog),
      catalogPayloadSha256: verified.catalogSha256,
    })
  )
    fail("Renewal checkpoint receipt changed");
  return { output, receipt, prior, catalog, manifest, verified };
}
/** Read-only predeployment gate; has no approval/deployment side effect. */
export async function verifyNinjaRenewal({ output } = {}, deps = {}) {
  const s = settings(deps, "verify"),
    t = await trust(s),
    p = await prepared(output, s, t);
  await assertBaseline(p.prior, s, t);
  return {
    status: "PASS",
    generation: p.receipt.generation,
    catalogSha256: p.receipt.catalogSha256,
    manifestFiles: p.manifest.files.length,
  };
}
/** Verify the exact newly deployed static tree and signed feed over real HTTPS. */
async function verifyLivePass(output, s, t) {
  const p = await prepared(output, s, t);
  const checked = [];
  for (const file of p.manifest.files) {
    if (
      !file.path.startsWith("public/") ||
      CONTROL_FILES.has(file.path.slice(7))
    )
      continue;
    const name = file.path.slice(7);
    const { bytes, headers } = await fetchBytes(ORIGIN + "/" + name, s, {
      maximum: file.bytes,
      htmlRedirect: name.endsWith(".html"),
    });
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256)
      fail("Live public asset differs from prepared manifest");
    if (headers.get("x-content-type-options") !== "nosniff")
      fail("Live nosniff security header missing");
    const cache = headers.get("cache-control") ?? "";
    if (
      (name === "updates/preview.json" && !/no-cache/.test(cache)) ||
      (name === "updates/preview.json" && !/must-revalidate/.test(cache))
    )
      fail("Live feed cache policy differs");
    if (
      /^(downloads\/|updates\/keys\/)/.test(name) &&
      (!/immutable/.test(cache) || !/max-age=31536000/.test(cache))
    )
      fail("Live immutable asset cache policy differs");
    if (name === "updates/preview.json")
      verifyNinjaCatalog({
        bytes,
        publisher: "daedlo",
        trustedKeys: t.keys,
        now: liveWallClock(s),
        previousState: p.verified.checkpoint,
      });
    checked.push({ path: name, bytes: file.bytes, sha256: file.sha256 });
  }
  for (const path of PRIVATE_PATHS)
    await fetchBytes(ORIGIN + path, s, { status: 404, maximum: 1024 * 1024 });
  liveRemaining(s);
  if (s.liveWindow)
    verifyNinjaCatalog({
      bytes: p.catalog,
      publisher: "daedlo",
      trustedKeys: t.keys,
      now: liveWallClock(s),
      previousState: p.verified.checkpoint,
    });
  return {
    schemaVersion: 1,
    status: "PASS",
    generation: p.receipt.generation,
    catalogSha256: p.receipt.catalogSha256,
    servedAssets: checked.length,
    privateBoundaries: PRIVATE_PATHS.length,
    assets: checked,
  };
}
/** Optional post-activation readiness window. Only missing public assets can wait;
 * each attempt repeats the complete strict pass and has the same global deadline.
 * This never redeploys, signs another catalog, or retries integrity/security failures.
 */
export async function verifyLiveNinjaRenewal(
  { output, waitForAssets = false } = {},
  deps = {},
) {
  if (typeof waitForAssets !== "boolean")
    fail("Invalid live availability option");
  const s = settings(deps, "live"),
    t = await trust(s);
  if (!waitForAssets) return verifyLivePass(output, s, t);
  const now = deps.monotonicNow ?? (() => performance.now());
  const sleep = deps.sleep ?? delay;
  const started = now();
  s.liveWindow = {
    now,
    started,
    deadline: started + LIVE_AVAILABILITY_MS,
    wallClock: s.now,
  };
  const elapsed = () => Math.max(0, Math.floor(now() - started));
  const directory = await fs.mkdtemp(
    join(await pathInfo(output, { directory: true }), "live-verification-"),
  );
  const journal = await fs.open(
    join(directory, "events.jsonl"),
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    0o600,
  );
  const record = async (event) => {
    await journal.writeFile(
      JSON.stringify({ schemaVersion: 1, ...event }) + "\n",
    );
    await journal.sync();
  };
  let attempts = 0;
  const notFound = [];
  try {
    await record({
      event: "started",
      maximumMs: LIVE_AVAILABILITY_MS,
      maximumAttempts: LIVE_AVAILABILITY_ATTEMPTS,
    });
    for (;;) {
      liveRemaining(s);
      s.now = liveWallClock(s);
      attempts++;
      let result;
      try {
        result = await verifyLivePass(output, s, t);
      } catch (error) {
        if (
          !(error instanceof RenewalHttpStatusError) ||
          error.status !== 404 ||
          error.expected !== 200 ||
          error.challenged
        )
          throw error;
        const observation = {
          attempt: attempts,
          path: error.path,
          status: 404,
          elapsedMs: elapsed(),
        };
        notFound.push(observation);
        await record({ event: "not_ready", ...observation });
        if (attempts >= LIVE_AVAILABILITY_ATTEMPTS)
          throw new LiveAvailabilityError("attempt_limit_exceeded");
        await sleep(Math.min(LIVE_AVAILABILITY_INTERVAL_MS, liveRemaining(s)));
        continue;
      }
      liveRemaining(s);
      const availability = { attempts, elapsedMs: elapsed(), notFound };
      await record({
        event: "pass",
        ...availability,
        generation: result.generation,
        catalogSha256: result.catalogSha256,
        servedAssets: result.servedAssets,
        privateBoundaries: result.privateBoundaries,
      });
      return { ...result, availability };
    }
  } catch (error) {
    // Receipts are public CI artifacts: never serialize arbitrary messages/causes.
    const failure =
      error instanceof RenewalHttpStatusError
        ? {
            code: "http_status",
            path: error.path,
            status: error.status,
            expected: error.expected,
            challenged: error.challenged,
          }
        : {
            code:
              error instanceof LiveAvailabilityError
                ? error.code
                : "verification_failed",
          };
    await record({ event: "fail", attempts, elapsedMs: elapsed(), failure });
    throw error;
  } finally {
    await journal.close();
  }
}
export async function runNinjaRenewCli(
  args = process.argv.slice(2),
  deps = {},
) {
  const command = args.shift();
  if (!["prepare", "verify", "live"].includes(command))
    fail(
      "Usage: ninja-renew.mjs prepare --private-key ABS --output FRESH_ABS [--checkpoint FILE] | verify --output ABS | live --output ABS [--wait-for-assets]",
    );
  const allowed =
    command === "prepare"
      ? ["--private-key", "--output", "--checkpoint"]
      : ["--output"];
  const parsed = {};
  while (args.length) {
    const key = args.shift();
    if (command === "live" && key === "--wait-for-assets") {
      if (Object.hasOwn(parsed, key)) fail("Invalid renewal CLI arguments");
      parsed[key] = true;
      continue;
    }
    const value = args.shift();
    if (!allowed.includes(key) || !value || Object.hasOwn(parsed, key))
      fail("Invalid renewal CLI arguments");
    parsed[key] = value;
  }
  if (
    !parsed["--output"] ||
    (command === "prepare" && !parsed["--private-key"])
  )
    fail("Missing required renewal CLI argument");
  const input = {
    output: parsed["--output"],
  };
  if (command === "prepare") {
    input.privateKeyPath = parsed["--private-key"];
    input.checkpointPath = parsed["--checkpoint"];
  } else if (command === "live" && parsed["--wait-for-assets"]) {
    input.waitForAssets = true;
  }
  const result = await (
    command === "prepare"
      ? prepareNinjaRenewal
      : command === "verify"
        ? verifyNinjaRenewal
        : verifyLiveNinjaRenewal
  )(input, deps);
  const writeOutput =
    deps.writeOutput ?? process.stdout.write.bind(process.stdout);
  await writeOutput(JSON.stringify(result, null, 2) + "\n");
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  runNinjaRenewCli().catch((e) => {
    process.stderr.write(e.message + "\n");
    process.exitCode = 1;
  });
