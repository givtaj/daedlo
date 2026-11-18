import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const ACTIVATION_WAIT_MS = 150_000;
const POLL_INTERVAL_MS = 5_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const isUuid = (value) => typeof value === "string" && UUID.test(value);

async function readActiveDeployment(url, token, fetchImpl, timeoutMs) {
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  assert.equal(response.status, 200, "Active deployment request failed");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    assert.ok(size <= 1_048_576, "Deployment response exceeded bound");
    chunks.push(chunk);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks));
  } catch {
    throw new Error("Invalid JSON in deployment response");
  }
  assert.ok(body?.success === true, "Deployment response was unsuccessful");
  assert.ok(
    Array.isArray(body.result?.deployments),
    "Missing deployments list",
  );
  const active = body.result.deployments[0];
  assert.ok(active, "No active deployment");
  assert.ok(isUuid(active.id), "Invalid active deployment ID");
  assert.ok(
    Array.isArray(active.versions) && active.versions.length === 1,
    "Expected a single active Worker version",
  );
  const [version] = active.versions;
  assert.ok(isUuid(version?.version_id), "Invalid active Worker version ID");
  assert.ok(
    version.percentage === 100,
    "Expected 100% traffic on the active Worker version",
  );
  return { deploymentId: active.id, versionId: version.version_id };
}

export async function verifyActiveDeployment(
  { accountId, token, versionId },
  { fetchImpl = fetch, now = () => performance.now(), sleep = delay } = {},
) {
  assert.match(accountId, /^[a-f0-9]{32}$/i);
  assert.ok(
    typeof token === "string" && token.length > 0,
    "Missing Cloudflare API token",
  );
  assert.ok(isUuid(versionId), "Invalid uploaded Worker version ID");
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/daedlo/deployments`;
  const deadline = now() + ACTIVATION_WAIT_MS;
  let remaining = ACTIVATION_WAIT_MS;
  let lastVersion;
  while (remaining > 0) {
    const active = await readActiveDeployment(
      url,
      token,
      fetchImpl,
      Math.min(30_000, Math.ceil(remaining)),
    );
    lastVersion = active.versionId;
    remaining = deadline - now();
    if (remaining <= 0) break;
    if (lastVersion === versionId) {
      return {
        schemaVersion: 1,
        worker: "daedlo",
        versionId,
        deploymentId: active.deploymentId,
        percentage: 100,
        verifiedAt: new Date().toISOString(),
      };
    }
    await sleep(Math.min(POLL_INTERVAL_MS, remaining));
    remaining = deadline - now();
  }
  throw new Error(
    `Worker version ${versionId} did not become active before the ${ACTIVATION_WAIT_MS / 1000}s deadline (last observed: ${lastVersion})`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const receipt = await verifyActiveDeployment({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_API_TOKEN,
    versionId: process.env.NINJA_VERSION_ID,
  });
  const json = JSON.stringify(receipt);
  await writeFile(
    join(process.env.RUNNER_TEMP, "daedlo-renewal/active-deployment.json"),
    json + "\n",
    { flag: "wx" },
  );
  console.log(json);
}
