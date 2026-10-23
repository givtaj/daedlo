// Restore only a signed public high-water checkpoint from this workflow's own
// default-branch runs. Failed publications and earlier attempts still count.
import fs from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { sha256 } from "./manifest.mjs";
import { verifyNinjaCatalog } from "./ninja-catalog.mjs";
const REPOSITORY = "givtaj/daedlo";
// The name changed; the repository and its renewal history did not. Pin its
// immutable identity so an old-name replacement or a fork is never trusted.
const REPOSITORY_ID = 1391092739;
const REPOSITORY_NAMES = new Set([REPOSITORY, "givtaj/browser-driver"]);
const WORKFLOW = ".github/workflows/ninja-renew.yml";
const ARTIFACT = /^ninja-renewal-checkpoint-([1-9][0-9]*)$/;
const MAX_BYTES = 4 * 1024 * 1024;
// One reviewed recovery for the first production run, which failed before any
// checkpoint or Cloudflare mutation. This is not a configurable retry policy.
const FAILED_BOOTSTRAP = {
  id: 39946067474,
  run_number: 1,
  run_attempt: 1,
  workflow_id: 393961684,
  path: WORKFLOW,
  event: "workflow_dispatch",
  head_branch: "main",
  head_sha: "e5e47d97c8226ff0f3a3f390e8c95926e7c44039",
  status: "completed",
  conclusion: "failure",
};
const FAILED_BOOTSTRAP_STEPS = [
  [1, "Set up job", "success"],
  [2, "Check out trusted default-branch source", "success"],
  [3, "Set up Node", "success"],
  [
    4,
    "Install locked source dependencies and pinned deployment tool",
    "success",
  ],
  [
    5,
    "Check renewal and publication safety before credential scope",
    "success",
  ],
  [6, "Restore authenticated renewal high-water checkpoint", "success"],
  [7, "Prepare verified public renewal with temporary signing key", "failure"],
  [8, "Validate the exact staged public website", "skipped"],
  [9, "Persist signed renewal checkpoint", "skipped"],
  [10, "Upload only the frozen existing-worker version", "skipped"],
  [
    11,
    "Recheck the live baseline and activate the exact uploaded version",
    "skipped",
  ],
  [12, "Verify the active deployment identity", "skipped"],
  [
    13,
    "Verify the live feed, exact public assets and security policies",
    "skipped",
  ],
  [14, "Remove any remaining temporary signing key", "success"],
  [27, "Post Set up Node", "skipped"],
  [28, "Post Check out trusted default-branch source", "success"],
  [29, "Complete job", "success"],
];
const fail = (message) => {
  throw Error(message);
};
function positive(n) {
  return Number.isSafeInteger(n) && n > 0;
}
function trustedRepository(repository) {
  return (
    repository?.id === REPOSITORY_ID &&
    REPOSITORY_NAMES.has(repository.full_name)
  );
}
function matches(record, expected) {
  return Object.entries(expected).every(
    ([key, value]) => record?.[key] === value,
  );
}
function reviewedBootstrapRecovery(
  current,
  workflow,
  history,
  listingCount,
  branch,
) {
  if (
    branch !== "main" ||
    workflow.id !== FAILED_BOOTSTRAP.workflow_id ||
    !matches(current, {
      run_number: 2,
      run_attempt: 1,
      workflow_id: FAILED_BOOTSTRAP.workflow_id,
      event: "workflow_dispatch",
      head_branch: "main",
      status: "in_progress",
      conclusion: null,
    }) ||
    listingCount !== 2 ||
    history.length !== 2 ||
    !/^[a-f0-9]{40}$/.test(current.head_sha ?? "") ||
    !matches(history[0].run, {
      id: current.id,
      run_number: 2,
      run_attempt: 1,
      workflow_id: FAILED_BOOTSTRAP.workflow_id,
      path: WORKFLOW,
      event: "workflow_dispatch",
      head_branch: "main",
      head_sha: current.head_sha,
      status: "in_progress",
      conclusion: null,
    }) ||
    !trustedRepository(history[0].run.head_repository) ||
    !matches(history[1].run, FAILED_BOOTSTRAP) ||
    !trustedRepository(history[1].run.head_repository) ||
    history.some(
      (entry) =>
        entry.artifacts?.total_count !== 0 ||
        entry.artifacts.artifacts.length !== 0,
    )
  )
    return null;
  const evidence = history[1].attempts;
  if (
    evidence.length !== 1 ||
    !matches(evidence[0].record, FAILED_BOOTSTRAP) ||
    !trustedRepository(evidence[0].record.head_repository) ||
    evidence[0].jobs.total_count !== 1 ||
    evidence[0].jobs.jobs.length !== 1
  )
    return null;
  const job = evidence[0].jobs.jobs[0];
  if (
    !matches(job, {
      id: 120388922333,
      run_id: FAILED_BOOTSTRAP.id,
      run_attempt: 1,
      head_sha: FAILED_BOOTSTRAP.head_sha,
      name: "renew",
      status: "completed",
      conclusion: "failure",
    }) ||
    !Array.isArray(job.steps) ||
    job.steps.length !== FAILED_BOOTSTRAP_STEPS.length ||
    !FAILED_BOOTSTRAP_STEPS.every(([number, name, conclusion], index) =>
      matches(job.steps[index], {
        number,
        name,
        conclusion,
        status: "completed",
      }),
    )
  )
    return null;
  // No checkpoint file is fabricated. With none, ninja-renew's independent
  // production policy still requires the exact released generation-1 payload.
  return {
    bootstrap: true,
    recovery: {
      failedRunId: FAILED_BOOTSTRAP.id,
      failedRunAttempt: 1,
      failedHeadSha: FAILED_BOOTSTRAP.head_sha,
      requiredGeneration: 1,
      requiredCatalogPayloadSha256:
        "bde773d01a3cb0bb33330b74b17dd7e5068e33fb650a55d558d446a10f5bbad0",
    },
  };
}
async function readResponse(response) {
  const chunks = [];
  let length = 0;
  for await (const part of response.body ?? []) {
    length += part.length;
    if (length > MAX_BYTES) fail("Checkpoint response exceeds size bound");
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}
function unpack(bytes) {
  // Decode in memory only: no archive member can become a filesystem path.
  try {
    const value = execFileSync(
      "python3",
      [
        "-c",
        `import io,json,stat,sys,zipfile
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:
 infos=z.infolist()
 assert len(infos)==2 and sorted(i.filename for i in infos)==['catalog.json','receipt.json']
 for i in infos:
  mode=(i.external_attr>>16)&0xffff
  assert not i.is_dir() and not (i.flag_bits&1) and not stat.S_ISLNK(mode)
  assert not stat.S_IFMT(mode) or stat.S_ISREG(mode)
  assert i.file_size<=1048576 and i.compress_size<=4194304
 print(json.dumps({i.filename:z.read(i).decode('utf-8') for i in infos}))`,
      ],
      { input: bytes, maxBuffer: MAX_BYTES, stdio: ["pipe", "pipe", "pipe"] },
    );
    return JSON.parse(value);
  } catch {
    fail("Invalid checkpoint archive entry inventory");
  }
}
function validatePublic(files, trust, now) {
  let envelope, receipt;
  try {
    envelope = JSON.parse(files["catalog.json"]);
    receipt = JSON.parse(files["receipt.json"]);
  } catch {
    fail("Invalid public checkpoint JSON");
  }
  const issued = Date.parse(envelope?.signed?.issuedAt);
  if (!Number.isFinite(issued) || issued > now + 300000)
    fail("Checkpoint issuance is in the future");
  // Expiry is ignored only for restoring signed history; renewal independently
  // authenticates the live baseline and produces a new bounded validity period.
  const verified = verifyNinjaCatalog({
    bytes: Buffer.from(files["catalog.json"]),
    ...trust,
    now: issued,
  });
  const expected = {
    schemaVersion: 1,
    generation: verified.catalog.generation,
    catalogSha256: sha256(Buffer.from(files["catalog.json"])),
    catalogPayloadSha256: verified.catalogSha256,
  };
  if (
    !receipt ||
    Object.keys(receipt).sort().join() !==
      Object.keys(expected).sort().join() ||
    Object.entries(expected).some(([k, v]) => receipt[k] !== v)
  )
    fail("Checkpoint receipt does not match exact signed public catalog");
  return expected;
}
export async function restoreCheckpoint({
  repository = REPOSITORY,
  runId,
  runAttempt,
  branch,
  token,
  output,
  fetchImpl = fetch,
  now = Date.now(),
  trust,
} = {}) {
  if (
    !REPOSITORY_NAMES.has(repository) ||
    !positive(runId) ||
    !positive(runAttempt) ||
    typeof branch !== "string" ||
    !/^[A-Za-z0-9._/-]+$/.test(branch) ||
    !token ||
    !output
  )
    fail("Invalid checkpoint workflow context");
  const destination = resolve(output);
  try {
    await fs.lstat(destination);
    fail("Checkpoint output already exists");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (!trust) {
    const pem = await fs.readFile(
      new URL(
        "../../docs/update-trust/daedlo-release-2026-10.pem",
        import.meta.url,
      ),
    );
    if (
      sha256(pem) !==
      "df84f7d60ed2af949d394e338070ef66ab4debabf911ffd6c7b35bebe6ba4297"
    )
      fail("Checkpoint public key pin mismatch");
    trust = {
      publisher: "daedlo",
      trustedKeys: [{ id: "daedlo-release-2026-10", publicKey: pem }],
    };
  }
  const base = `https://api.github.com/repos/${repository}`;
  async function request(path) {
    const response = await fetchImpl(base + path, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
    if (response.status !== 200)
      fail(`Checkpoint GitHub request failed (${response.status})`);
    try {
      return JSON.parse((await readResponse(response)).toString("utf8"));
    } catch (e) {
      if (e.message.includes("bound")) throw e;
      fail("Invalid checkpoint GitHub response");
    }
  }
  async function archive(id, digest) {
    if (!positive(id) || !/^sha256:[a-f0-9]{64}$/.test(digest ?? ""))
      fail("Missing authenticated artifact identity");
    let response = await fetchImpl(`${base}/actions/artifacts/${id}/zip`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
    if (response.status === 302) {
      let url;
      try {
        url = new URL(response.headers.get("location"));
      } catch {
        fail("Invalid artifact redirect");
      }
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        !(
          url.hostname.endsWith(".blob.core.windows.net") ||
          url.hostname.endsWith(".actions.githubusercontent.com")
        )
      )
        fail("Unsupported artifact redirect origin");
      // Never forward the GitHub token to signed object-storage URLs.
      response = await fetchImpl(url.href, {
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
    }
    if (response.status !== 200)
      fail(`Checkpoint artifact download failed (${response.status})`);
    const bytes = await readResponse(response);
    if ("sha256:" + sha256(bytes) !== digest)
      fail("Checkpoint artifact digest mismatch");
    return unpack(bytes);
  }
  const repositoryRecord = await request("");
  if (
    !trustedRepository(repositoryRecord) ||
    repositoryRecord.full_name !== repository
  )
    fail("Checkpoint repository identity mismatch");
  const workflow = await request("/actions/workflows/ninja-renew.yml");
  if (!positive(workflow.id) || workflow.path !== WORKFLOW)
    fail("Checkpoint workflow identity mismatch");
  const current = await request(`/actions/runs/${runId}`);
  function checkRun(run) {
    if (
      !positive(run.id) ||
      !positive(run.run_number) ||
      !positive(run.run_attempt) ||
      run.run_attempt > 20 ||
      run.workflow_id !== workflow.id ||
      run.path !== WORKFLOW ||
      !trustedRepository(run.head_repository) ||
      !["schedule", "workflow_dispatch"].includes(run.event)
    )
      fail("Untrusted checkpoint workflow origin or event");
  }
  checkRun(current);
  if (current.head_branch !== branch || current.run_attempt !== runAttempt)
    fail("Checkpoint run attempt mismatch");
  let priorRuns = 0;
  let expectedRunNumber = current.run_number;
  const history = [];
  for (let page = 1; page <= 10; page++) {
    const listing = await request(
      `/actions/workflows/${workflow.id}/runs?per_page=100&page=${page}`,
    );
    if (
      !Array.isArray(listing.workflow_runs) ||
      !Number.isSafeInteger(listing.total_count) ||
      listing.workflow_runs.length > 100
    )
      fail("Invalid checkpoint run listing");
    if (
      listing.workflow_runs.some((run) => run.run_number > current.run_number)
    )
      fail("A newer renewal run exists; stale reruns require a fresh dispatch");
    const runs = listing.workflow_runs
      .filter((r) => r.run_number <= current.run_number)
      .sort((a, b) => b.run_number - a.run_number);
    for (const run of runs) {
      checkRun(run);
      if (run.run_number !== expectedRunNumber--)
        fail("Checkpoint workflow history has an unexplained run-number gap");
      const evidence = { run, attempts: [] };
      history.push(evidence);
      if (run.head_branch !== branch) {
        if (run.status !== "completed" || run.conclusion !== "skipped")
          fail("Non-default checkpoint workflow run was not safely skipped");
        continue;
      }
      if (run.id !== runId) {
        priorRuns++;
        if (run.status !== "completed") fail("Prior renewal is still running");
      }
      const found = await request(
        `/actions/runs/${run.id}/artifacts?per_page=100`,
      );
      if (
        !Array.isArray(found.artifacts) ||
        found.total_count !== found.artifacts.length ||
        found.artifacts.length > 100
      )
        fail("Incomplete checkpoint artifact inventory");
      evidence.artifacts = found;
      const artifacts = found.artifacts
        .filter((a) => ARTIFACT.test(a.name))
        .map((a) => ({ ...a, attempt: Number(a.name.match(ARTIFACT)[1]) }))
        .filter((a) => run.id !== runId || a.attempt < runAttempt)
        .sort((a, b) => b.attempt - a.attempt);
      const lastAttempt = run.id === runId ? runAttempt - 1 : run.run_attempt;
      for (
        let attempt = lastAttempt;
        attempt > (artifacts[0]?.attempt ?? 0);
        attempt--
      ) {
        const attemptRecord = await request(
          `/actions/runs/${run.id}/attempts/${attempt}`,
        );
        if (attemptRecord.conclusion === "success")
          fail(
            "Successful renewal attempt has a missing checkpoint; operator recovery required",
          );
        const jobs = await request(
          `/actions/runs/${run.id}/attempts/${attempt}/jobs?per_page=100`,
        );
        if (!Array.isArray(jobs.jobs) || jobs.total_count !== jobs.jobs.length)
          fail("Incomplete checkpoint job inventory");
        evidence.attempts.push({ record: attemptRecord, jobs });
        if (
          jobs.jobs.some((job) =>
            job.steps?.some(
              (step) =>
                step.name === "Persist signed renewal checkpoint" &&
                step.conclusion === "success",
            ),
          )
        )
          fail(
            "Published checkpoint artifact missing; operator recovery required",
          );
      }
      if (artifacts.length) {
        const artifact = artifacts[0];
        if (
          artifacts.filter((a) => a.attempt === artifact.attempt).length !==
            1 ||
          artifact.attempt > run.run_attempt ||
          artifact.workflow_run?.id !== run.id ||
          artifact.workflow_run?.head_branch !== branch ||
          artifact.workflow_run?.repository_id !== REPOSITORY_ID ||
          (artifact.workflow_run?.head_repository_id !== undefined &&
            artifact.workflow_run.head_repository_id !== REPOSITORY_ID)
        )
          fail("Checkpoint artifact workflow origin mismatch");
        if (artifact.expired)
          fail(
            "Retained checkpoint artifact expired; operator recovery required",
          );
        if (
          !positive(artifact.size_in_bytes) ||
          artifact.size_in_bytes > MAX_BYTES
        )
          fail("Checkpoint artifact exceeds size bound");
        const files = await archive(artifact.id, artifact.digest);
        const receipt = validatePublic(files, trust, now);
        await fs.mkdir(destination, { mode: 0o700 });
        await fs.writeFile(
          join(destination, "catalog.json"),
          files["catalog.json"],
          { flag: "wx", mode: 0o600 },
        );
        await fs.writeFile(
          join(destination, "receipt.json"),
          JSON.stringify(receipt) + "\n",
          { flag: "wx", mode: 0o600 },
        );
        return {
          ...receipt,
          runId: run.id,
          runAttempt: artifact.attempt,
          bootstrap: false,
        };
      }
    }
    if (page * 100 >= listing.total_count) {
      if (priorRuns || runAttempt !== 1 || current.run_number !== 1) {
        const recovery = reviewedBootstrapRecovery(
          current,
          workflow,
          history,
          listing.total_count,
          branch,
        );
        if (recovery) return recovery;
        fail("Missing prior checkpoint; bootstrap is first-run only");
      }
      return { bootstrap: true };
    }
  }
  fail("Checkpoint run history exceeds supported bound");
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "--output")
      fail("Usage: ninja-checkpoint.mjs --output DIRECTORY");
    const result = await restoreCheckpoint({
      repository: process.env.GITHUB_REPOSITORY,
      runId: Number(process.env.GITHUB_RUN_ID),
      runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
      branch: process.env.NINJA_DEFAULT_BRANCH,
      token: process.env.GITHUB_TOKEN,
      output: process.argv[3],
    });
    console.log(JSON.stringify(result));
  } catch (e) {
    console.error(
      e.message.startsWith("fetch")
        ? "Checkpoint network request failed"
        : e.message,
    );
    process.exitCode = 1;
  }
}
