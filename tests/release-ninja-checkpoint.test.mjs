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
