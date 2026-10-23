import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { sha256 } from "../scripts/release/manifest.mjs";
import { ninjaCatalogSigningBytes } from "../scripts/release/ninja-catalog.mjs";
import { restoreCheckpoint } from "../scripts/release/ninja-checkpoint.mjs";
const now = Date.parse("2026-10-23T12:00:00.000Z");
const repo = "givtaj/browser-driver";
function archive(files) {
  return execFileSync(
    "python3",
    [
      "-c",
      'import io,json,sys,zipfile\nb=io.BytesIO()\nwith zipfile.ZipFile(b,"w",compression=zipfile.ZIP_DEFLATED) as z:\n for k,v in json.load(sys.stdin).items():z.writestr(k,v)\nsys.stdout.buffer.write(b.getvalue())',
    ],
    { input: JSON.stringify(files) },
  );
}
async function fixture(t, change = () => {}) {
  const root = await fs.mkdtemp(join(tmpdir(), "ninja-checkpoint-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const signed = {
    schemaVersion: 1,
    kind: "daedlo-public-kit-catalog",
    publisher: "daedlo",
    generation: 2,
    issuedAt: "2026-10-22T12:00:00.000Z",
    expiresAt: "2026-10-29T12:00:00.000Z",
    releases: [],
  };
  const catalog =
    JSON.stringify({
      schemaVersion: 1,
      kind: "daedlo-signed-catalog",
      signed,
      signature: {
        keyId: "fixture",
        value: sign(
          null,
          ninjaCatalogSigningBytes(signed),
          privateKey,
        ).toString("base64"),
      },
    }) + "\n";
  const receipt = {
    schemaVersion: 1,
    generation: 2,
    catalogSha256: sha256(Buffer.from(catalog)),
    catalogPayloadSha256: sha256(ninjaCatalogSigningBytes(signed)),
  };
  const run = (id, number, attempt = 1) => ({
    id,
    run_number: number,
    run_attempt: attempt,
    workflow_id: 7,
    event: "schedule",
    head_branch: "main",
    head_repository: { full_name: repo },
    path: ".github/workflows/ninja-renew.yml",
    status: id === 20 ? "in_progress" : "completed",
    conclusion: id === 20 ? null : "failure",
  });
  const state = {
    current: run(20, 2),
    previous: run(10, 1),
    files: { "catalog.json": catalog, "receipt.json": JSON.stringify(receipt) },
    artifact: {
      id: 99,
      name: "ninja-renewal-checkpoint-1",
      expired: false,
      size_in_bytes: 1024,
      workflow_run: { id: 10, head_branch: "main", repository_id: 1 },
    },
    uploaded: true,
  };
  change(state);
  const zip = archive(state.files);
  state.artifact.digest = "sha256:" + sha256(zip);
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, headers: options.headers });
    const path = new URL(url).pathname;
    if (path === `/repos/${repo}/actions/workflows/ninja-renew.yml`)
      return Response.json({
        id: 7,
        path: ".github/workflows/ninja-renew.yml",
      });
    if (path === `/repos/${repo}/actions/runs/20`)
      return Response.json(state.current);
    if (path.endsWith("/actions/workflows/7/runs"))
      return Response.json({
        total_count:
          (state.previous ? (state.middle ? 3 : 2) : 1) + (state.newer ? 1 : 0),
        workflow_runs: state.previous
          ? [
              ...(state.newer ? [state.newer] : []),
              state.current,
              ...(state.middle ? [state.middle] : []),
              state.previous,
            ]
          : [state.current],
      });
    if (path.endsWith("/runs/20/artifacts"))
      return Response.json({
        total_count: state.currentArtifact ? 1 : 0,
        artifacts: state.currentArtifact
          ? [{ ...state.artifact, ...state.currentArtifact }]
          : [],
      });
    if (path.endsWith("/runs/10/artifacts"))
      return Response.json({
        total_count: state.missing ? 0 : 1,
        artifacts: state.missing ? [] : [state.artifact],
      });
    if (/\/runs\/(10|20)\/attempts\/[12]$/.test(path))
      return Response.json({
        conclusion: state.attemptSuccess ? "success" : "failure",
      });
    if (/\/runs\/(10|20)\/attempts\/[12]\/jobs$/.test(path))
      return Response.json({
        total_count: 1,
        jobs: [
          {
            steps: [
              {
                name: "Persist signed renewal checkpoint",
                conclusion: state.uploaded ? "success" : "skipped",
              },
            ],
          },
        ],
      });
    if (path.endsWith("/artifacts/99/zip")) return new Response(zip);
    throw Error("Unexpected fixture endpoint " + path);
  };
  return {
    root,
    state,
    calls,
    catalog,
    options: {
      repository: repo,
      runId: 20,
      runAttempt: state.current.run_attempt,
      branch: "main",
      token: "fixture-token",
      output: join(root, "restored"),
      fetchImpl,
      now,
      trust: {
        publisher: "daedlo",
        trustedKeys: [{ id: "fixture", publicKey }],
      },
    },
  };
}
test("restores authenticated checkpoint from a failed publication run and writes only public exact files", async (t) => {
  const f = await fixture(t);
  const result = await restoreCheckpoint(f.options);
  assert.equal(result.generation, 2);
  assert.equal(
    await fs.readFile(join(f.root, "restored/catalog.json"), "utf8"),
    f.catalog,
  );
  assert.deepEqual((await fs.readdir(join(f.root, "restored"))).sort(), [
    "catalog.json",
    "receipt.json",
  ]);
});
for (const [name, change, pattern] of [
  [
    "wrong workflow origin",
    (s) => {
      s.previous.workflow_id = 8;
    },
    /workflow|origin/i,
  ],
  [
    "wrong event",
    (s) => {
      s.previous.event = "pull_request";
    },
    /event|origin/i,
  ],
  [
    "expired retained artifact",
    (s) => {
      s.artifact.expired = true;
    },
    /expired/i,
  ],
  [
    "missing checkpoint after successful upload",
    (s) => {
      s.missing = true;
    },
    /missing/i,
  ],
  [
    "tampered signed catalog",
    (s) => {
      s.files["catalog.json"] = s.files["catalog.json"].replace(
        'generation":2',
        'generation":3',
      );
    },
    /signature|receipt/i,
  ],
  [
    "private or traversing ZIP member",
    (s) => {
      s.files["../private.pem"] = "private";
    },
    /archive|entry|inventory/i,
  ],
  [
    "receipt with private extra field",
    (s) => {
      const r = JSON.parse(s.files["receipt.json"]);
      r.privateKey = "/private/key";
      s.files["receipt.json"] = JSON.stringify(r);
    },
    /receipt/i,
  ],
])
  test(`rejects ${name} before writing checkpoint`, async (t) => {
    const f = await fixture(t, change);
    await assert.rejects(restoreCheckpoint(f.options), pattern);
    await assert.rejects(fs.stat(f.options.output), { code: "ENOENT" });
  });
test("restores prior attempt high-water checkpoint in the current run", async (t) => {
  const f = await fixture(t, (s) => {
    s.current.run_attempt = 2;
    s.currentArtifact = {
      workflow_run: { id: 20, head_branch: "main", repository_id: 1 },
    };
  });
  const r = await restoreCheckpoint(f.options);
  assert.equal(r.runId, 20);
  assert.equal(r.generation, 2);
});
test("bootstrap is allowed only for first ever eligible run", async (t) => {
  const f = await fixture(t, (s) => {
    s.previous = null;
    s.current.run_number = 1;
  });
  assert.equal((await restoreCheckpoint(f.options)).bootstrap, true);
  const g = await fixture(t, (s) => {
    s.missing = true;
    s.uploaded = false;
  });
  await assert.rejects(
    restoreCheckpoint(g.options),
    /bootstrap|prior|missing/i,
  );
});

test("missing newer-attempt checkpoint cannot fall back to an older artifact", async (t) => {
  const f = await fixture(t, (s) => {
    s.current.run_attempt = 3;
    s.currentArtifact = {
      workflow_run: { id: 20, head_branch: "main", repository_id: 1 },
    };
  });
  await assert.rejects(restoreCheckpoint(f.options), /missing/i);
  await assert.rejects(fs.stat(f.options.output), { code: "ENOENT" });
});

test("missing successful-attempt checkpoint refuses incomplete step history", async (t) => {
  const f = await fixture(t, (s) => {
    s.current.run_attempt = 3;
    s.currentArtifact = {
      workflow_run: { id: 20, head_branch: "main", repository_id: 1 },
    };
    s.uploaded = false;
    s.attemptSuccess = true;
  });
  await assert.rejects(restoreCheckpoint(f.options), /successful|missing/i);
});
test("deleted workflow run cannot silently roll the durable high-water mark back", async (t) => {
  const f = await fixture(t, (s) => {
    s.current.run_number = 3;
  });
  await assert.rejects(restoreCheckpoint(f.options), /gap|history/i);
  await assert.rejects(fs.stat(f.options.output), { code: "ENOENT" });
});

test("safely skipped nondefault run preserves contiguous workflow history", async (t) => {
  const f = await fixture(t, (s) => {
    s.current.run_number = 3;
    s.middle = {
      ...s.previous,
      id: 15,
      run_number: 2,
      head_branch: "feature",
      conclusion: "skipped",
    };
  });
  assert.equal((await restoreCheckpoint(f.options)).generation, 2);
});

test("rerunning an older workflow run cannot ignore a newer durable checkpoint", async (t) => {
  const f = await fixture(t, (s) => {
    s.current.run_attempt = 2;
    s.currentArtifact = {
      workflow_run: { id: 20, head_branch: "main", repository_id: 1 },
    };
    s.newer = { ...s.previous, id: 30, run_number: 3 };
  });
  await assert.rejects(
    restoreCheckpoint(f.options),
    /newer|stale|fresh dispatch/i,
  );
  await assert.rejects(fs.stat(f.options.output), { code: "ENOENT" });
});

// Public GitHub API record of the reviewed first production attempt. The
// recovery must recognize this evidence, never an arbitrary failed run.
async function bootstrapRecoveryFixture(t, change = () => {}) {
  const root = await fs.mkdtemp(join(tmpdir(), "ninja-bootstrap-recovery-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const previous = {
    id: 39946067474,
    run_number: 1,
    run_attempt: 1,
    workflow_id: 393961684,
    path: ".github/workflows/ninja-renew.yml",
    event: "workflow_dispatch",
    head_branch: "main",
    head_sha: "e5e47d97c8226ff0f3a3f390e8c95926e7c44039",
    head_repository: { full_name: repo },
    status: "completed",
    conclusion: "failure",
  };
  const current = {
    ...previous,
    id: 39946067475,
    run_number: 2,
    head_sha: "a".repeat(40),
    status: "in_progress",
    conclusion: null,
  };
  const steps = [
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
    [
      7,
      "Prepare verified public renewal with temporary signing key",
      "failure",
    ],
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
  ].map(([number, name, conclusion]) => ({
    number,
    name,
    conclusion,
    status: "completed",
  }));
  const state = {
    previous,
    current,
    attempt: structuredClone(previous),
    workflow: { id: 393961684, path: ".github/workflows/ninja-renew.yml" },
    runs: [current, previous],
    previousArtifacts: { total_count: 0, artifacts: [] },
    currentArtifacts: { total_count: 0, artifacts: [] },
    jobs: {
      total_count: 1,
      jobs: [
        {
          id: 120388922333,
          run_id: previous.id,
          run_attempt: 1,
          head_sha: previous.head_sha,
          name: "renew",
          status: "completed",
          conclusion: "failure",
          steps,
        },
      ],
    },
  };
  change(state);
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/actions/workflows/ninja-renew.yml"))
      return Response.json(state.workflow);
    if (path.endsWith(`/actions/runs/${current.id}`))
      return Response.json(state.current);
    if (path.endsWith(`/actions/workflows/${state.workflow.id}/runs`))
      return Response.json({
        total_count: state.runs.length,
        workflow_runs: state.runs,
      });
    if (path.endsWith(`/runs/${current.id}/artifacts`))
      return Response.json(state.currentArtifacts);
    if (path.endsWith(`/runs/${previous.id}/artifacts`))
      return Response.json(state.previousArtifacts);
    if (path.includes(`/runs/${previous.id}/attempts/`))
      return Response.json(path.endsWith("/jobs") ? state.jobs : state.attempt);
    // A second current attempt is deliberately not eligible for recovery.
    if (path.endsWith(`/runs/${current.id}/attempts/1`))
      return Response.json({ ...current, conclusion: "failure" });
    if (path.endsWith(`/runs/${current.id}/attempts/1/jobs`))
      return Response.json(state.jobs);
    throw Error("Unexpected recovery fixture endpoint " + path);
  };
  return {
    state,
    options: {
      runId: current.id,
      runAttempt: current.run_attempt,
      branch: "main",
      token: "fixture-token",
      output: join(root, "restored"),
      fetchImpl,
      trust: { publisher: "daedlo", trustedKeys: [] },
    },
  };
}

test("exact reviewed failed initial bootstrap permits only fresh run two without manufacturing a checkpoint", async (t) => {
  const f = await bootstrapRecoveryFixture(t);
  assert.deepEqual(await restoreCheckpoint(f.options), {
    bootstrap: true,
    recovery: {
      failedRunId: 39946067474,
      failedRunAttempt: 1,
      failedHeadSha: "e5e47d97c8226ff0f3a3f390e8c95926e7c44039",
      requiredGeneration: 1,
      requiredCatalogPayloadSha256:
        "bde773d01a3cb0bb33330b74b17dd7e5068e33fb650a55d558d446a10f5bbad0",
    },
  });
  await assert.rejects(fs.stat(f.options.output), { code: "ENOENT" });
});

test("reviewed bootstrap recovery rejects current attempt drift between API snapshots", async (t) => {
  const f = await bootstrapRecoveryFixture(t, (s) => {
    s.runs[0] = { ...s.current, run_attempt: 2 };
  });
  await assert.rejects(restoreCheckpoint(f.options), /bootstrap|recovery/i);
  await assert.rejects(fs.stat(f.options.output), { code: "ENOENT" });
});

const recoveryRefusals = [
  [
    "different historical run",
    (s) => {
      s.previous.id += 10;
    },
  ],
  [
    "different historical source",
    (s) => {
      s.previous.head_sha = "b".repeat(40);
    },
  ],
  [
    "different historical workflow",
    (s) => {
      s.previous.workflow_id++;
    },
  ],
  [
    "different historical repository",
    (s) => {
      s.previous.head_repository.full_name = "other/repo";
    },
  ],
  [
    "different historical branch",
    (s) => {
      s.previous.head_branch = "feature";
    },
  ],
  [
    "different historical event",
    (s) => {
      s.previous.event = "schedule";
    },
  ],
  [
    "different historical run number",
    (s) => {
      s.previous.run_number = 0;
    },
  ],
  [
    "rerun historical attempt",
    (s) => {
      s.previous.run_attempt = 2;
    },
  ],
  [
    "current listing source drift",
    (s) => {
      s.runs[0] = { ...s.current, head_sha: "b".repeat(40) };
    },
  ],
  [
    "current listing status drift",
    (s) => {
      s.runs[0] = { ...s.current, status: "completed", conclusion: "failure" };
    },
  ],
  [
    "historical success",
    (s) => {
      s.previous.conclusion = "success";
    },
  ],
  [
    "incomplete historical run",
    (s) => {
      s.previous.status = "in_progress";
    },
  ],
  [
    "different attempt identity",
    (s) => {
      s.attempt.id++;
    },
  ],
  [
    "different attempt source",
    (s) => {
      s.attempt.head_sha = "c".repeat(40);
    },
  ],
  [
    "different attempt number",
    (s) => {
      s.attempt.run_attempt = 2;
    },
  ],
  [
    "successful attempt",
    (s) => {
      s.attempt.conclusion = "success";
    },
  ],
  [
    "wrong job identity",
    (s) => {
      s.jobs.jobs[0].id++;
    },
  ],
  [
    "wrong job run",
    (s) => {
      s.jobs.jobs[0].run_id++;
    },
  ],
  [
    "wrong job source",
    (s) => {
      s.jobs.jobs[0].head_sha = "d".repeat(40);
    },
  ],
  [
    "wrong job attempt",
    (s) => {
      s.jobs.jobs[0].run_attempt = 2;
    },
  ],
  [
    "successful job",
    (s) => {
      s.jobs.jobs[0].conclusion = "success";
    },
  ],
  [
    "missing job",
    (s) => {
      s.jobs = { total_count: 0, jobs: [] };
    },
  ],
  [
    "duplicate job",
    (s) => {
      s.jobs.jobs.push(structuredClone(s.jobs.jobs[0]));
      s.jobs.total_count++;
    },
  ],
  [
    "incomplete job inventory",
    (s) => {
      s.jobs.total_count++;
    },
  ],
  [
    "missing step",
    (s) => {
      s.jobs.jobs[0].steps.splice(8, 1);
    },
  ],
  [
    "duplicate step",
    (s) => {
      s.jobs.jobs[0].steps[8] = { ...s.jobs.jobs[0].steps[7] };
    },
  ],
  [
    "changed step number",
    (s) => {
      s.jobs.jobs[0].steps[8].number++;
    },
  ],
  [
    "incomplete step",
    (s) => {
      s.jobs.jobs[0].steps[8].status = "queued";
    },
  ],
  [
    "unrelated historical artifact",
    (s) => {
      s.previousArtifacts = { total_count: 1, artifacts: [{ name: "other" }] };
    },
  ],
  [
    "unrelated current artifact",
    (s) => {
      s.currentArtifacts = { total_count: 1, artifacts: [{ name: "other" }] };
    },
  ],
  [
    "incomplete artifact inventory",
    (s) => {
      s.previousArtifacts.total_count = 1;
    },
  ],
  [
    "expired checkpoint",
    (s) => {
      s.previousArtifacts = {
        total_count: 1,
        artifacts: [
          {
            name: "ninja-renewal-checkpoint-1",
            expired: true,
            workflow_run: { id: s.previous.id, head_branch: "main" },
          },
        ],
      };
    },
  ],
  [
    "second current attempt",
    (s) => {
      s.current.run_attempt = 2;
    },
  ],
  [
    "third current run",
    (s) => {
      s.current.run_number = 3;
    },
  ],
  [
    "different current workflow",
    (s) => {
      s.current.workflow_id++;
    },
  ],
  [
    "scheduled recovery",
    (s) => {
      s.current.event = "schedule";
    },
  ],
  [
    "deleted initial history",
    (s) => {
      s.runs = [s.current];
    },
  ],
  [
    "newer run",
    (s) => {
      s.runs.unshift({ ...s.current, id: s.current.id + 1, run_number: 3 });
    },
  ],
];
for (const stepIndex of [5, 6, 7, 8, 9, 10, 11, 12, 13]) {
  recoveryRefusals.push([
    `changed outcome for historical step ${stepIndex + 1}`,
    (s) => {
      s.jobs.jobs[0].steps[stepIndex].conclusion = "neutral";
    },
  ]);
}
for (const [name, change] of recoveryRefusals) {
  test(`reviewed bootstrap recovery rejects ${name}`, async (t) => {
    const f = await bootstrapRecoveryFixture(t, change);
    await assert.rejects(
      restoreCheckpoint(f.options),
      /bootstrap|recovery|prior|missing|workflow|origin|event|gap|history|artifact|inventory|successful|newer|running/i,
    );
    await assert.rejects(fs.stat(f.options.output), { code: "ENOENT" });
  });
}
