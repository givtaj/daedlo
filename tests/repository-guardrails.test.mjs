import assert from "node:assert/strict";
import test from "node:test";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  githubRequest,
  runGuardrails,
} from "../scripts/repository-guardrails.mjs";

const root = "repos/givtaj/daedlo";
const mainSha = "a".repeat(40);

test("CI covers PR updates, main pushes and manual runs without duplicate topic pushes", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const triggers = workflow.match(/^on:\n((?:[ \t].*\n|\n)*)/m)?.[1];
  assert.ok(triggers, "The CI workflow must declare its trigger policy");
  assert.match(
    triggers,
    /^  push:\n    branches:\n      - main\n(?=  \w|\n|$)/m,
    "Only main pushes should start CI; PR updates already cover topic branches",
  );
  assert.match(triggers, /^  pull_request:\n(?=  \w|\n|$)/m);
  assert.match(triggers, /^  workflow_dispatch:\n(?=  \w|\n|$)/m);
  assert.deepEqual(
    [...triggers.matchAll(/^  (\w+):/gm)].map((match) => match[1]).sort(),
    ["pull_request", "push", "workflow_dispatch"],
  );
  assert.doesNotMatch(
    triggers,
    /(?:branches-ignore|paths(?:-ignore)?|tags(?:-ignore)?|types|pull_request_target):/,
    "CI must retain unfiltered PR checks and must not add tag or privileged triggers",
  );
});

function fixture(overrides = {}) {
  const calls = [];
  const replies = {
    [root]: {
      status: 200,
      data: {
        id: 1391092739,
        full_name: "givtaj/daedlo",
        private: true,
        visibility: "private",
        default_branch: "main",
      },
    },
    [`${root}/branches/main`]: {
      status: 200,
      data: { protected: false, commit: { sha: mainSha } },
    },
    [`${root}/branches/main/protection`]: {
      status: 403,
      data: {
        message:
          "Upgrade to GitHub Pro or make this repository public to enable this feature.",
      },
    },
    [`${root}/rulesets?includes_parents=true&per_page=100`]: {
      status: 403,
      data: {
        message:
          "Upgrade to GitHub Pro or make this repository public to enable this feature.",
      },
    },
    [`${root}/actions/permissions`]: {
      status: 200,
      data: {
        enabled: true,
        allowed_actions: "selected",
        sha_pinning_required: true,
      },
    },
    [`${root}/actions/permissions/selected-actions`]: {
      status: 200,
      data: {
        github_owned_allowed: true,
        verified_allowed: false,
        patterns_allowed: [],
      },
    },
    [`${root}/actions/permissions/workflow`]: {
      status: 200,
      data: {
        default_workflow_permissions: "read",
        can_approve_pull_request_reviews: false,
      },
    },
    [`${root}/actions/permissions/fork-pr-workflows-private-repos`]: {
      status: 200,
      data: {
        run_workflows_from_fork_pull_requests: false,
        send_write_tokens_to_workflows: false,
        send_secrets_and_variables: false,
        require_approval_for_fork_pr_workflows: false,
      },
    },
    [`${root}/vulnerability-alerts`]: { status: 204 },
    [`${root}/actions/permissions/fork-pr-contributor-approval`]: {
      status: 422,
      data: {
        errors: "Fork PR approval is not allowed for private repositories.",
      },
    },
    [`${root}/commits/${mainSha}/check-runs?per_page=100`]: {
      status: 200,
      data: {
        total_count: 3,
        check_runs: [
          "Source and packaged consumer (Node 22)",
          "Source and packaged consumer (Node 24)",
          "Public metadata and secrets",
        ].map((name) => ({
          name,
          status: "completed",
          conclusion: "success",
          app: { id: 15368 },
        })),
      },
    },
    ...overrides,
  };
  return {
    calls,
    replies,
    async request(call) {
      calls.push(structuredClone(call));
      assert.equal(call.method, "GET", "Audit must not perform writes");
      assert.ok(
        Object.hasOwn(replies, call.path),
        `Unexpected API path: ${call.path}`,
      );
      return structuredClone(replies[call.path]);
    },
  };
}

function publicFixture(
  approval = {
    status: 200,
    data: { approval_policy: "all_external_contributors" },
  },
) {
  const expected = JSON.parse(
    readFileSync(new URL("../.github/main-ruleset.json", import.meta.url)),
  );
  return fixture({
    [root]: {
      status: 200,
      data: {
        id: 1391092739,
        full_name: "givtaj/daedlo",
        private: false,
        visibility: "public",
        default_branch: "main",
      },
    },
    [`${root}/branches/main/protection`]: { status: 404 },
    [`${root}/rulesets?includes_parents=true&per_page=100`]: {
      status: 200,
      data: [{ name: expected.name, id: 42 }],
    },
    [`${root}/rulesets/42`]: { status: 200, data: expected },
    [`${root}/rules/branches/main?per_page=100`]: {
      status: 200,
      data: expected.rules.map((rule) => ({ ...rule, ruleset_id: 42 })),
    },
    [`${root}/actions/permissions/fork-pr-contributor-approval`]: approval,
  });
}

test("public repository read-only audit verifies effective controls without private-fork requests", async () => {
  const f = publicFixture();
  const report = await runGuardrails(f);
  assert.equal(report.visibility, "public");
  assert.equal(report.mode, "read-only");
  assert.equal(report.status, "PASS");
  assert.equal(report.controls.privateForks.status, "NOT_APPLICABLE");
  assert.equal(report.controls.publicForkApproval.status, "PASS");
  assert.equal(report.controls.mainProtection.status, "PASS");
  assert.deepEqual(report.mutations, []);
  assert.ok(f.calls.every((call) => call.method === "GET"));
  assert.ok(
    !f.calls.some((call) =>
      call.path.endsWith("fork-pr-workflows-private-repos"),
    ),
  );
});

test("public audit accepts GitHub's observed pull-request defaults and rejects changes to them", async () => {
  // GitHub returned these fields after creating the reviewed ruleset on 2026-11-10.
  // Keep the API response independent of omissions in the prepared policy.
  const observedDefaults = {
    required_reviewers: [],
    require_extra_approval_for_unattributed_changes: true,
    allowed_merge_methods: ["merge", "squash", "rebase"],
  };
  function roundtrip(changes = {}) {
    const f = publicFixture();
    for (const rules of [
      f.replies[`${root}/rulesets/42`].data.rules,
      f.replies[`${root}/rules/branches/main?per_page=100`].data,
    ]) {
      Object.assign(
        rules.find((rule) => rule.type === "pull_request").parameters,
        structuredClone(observedDefaults),
        changes,
      );
    }
    return f;
  }
  const f = roundtrip();
  const report = await runGuardrails(f);
  assert.equal(
    report.controls.mainProtection.status,
    "PASS",
    `Observed GitHub defaults must match the prepared policy: ${report.controls.mainProtection.reason}`,
  );
  assert.equal(report.status, "PASS");
  assert.deepEqual(report.mutations, []);
  assert.ok(f.calls.every((call) => call.method === "GET"));

  for (const change of [
    { required_reviewers: [{ type: "Team", id: 42 }] },
    { require_extra_approval_for_unattributed_changes: false },
    { allowed_merge_methods: ["merge"] },
  ]) {
    const changed = await runGuardrails(roundtrip(change));
    assert.equal(changed.status, "NOT_READY");
    assert.deepEqual(changed.controls.mainProtection, {
      status: "FAIL",
      reason: "MAIN_POLICY_DIFFERS",
    });
    assert.deepEqual(changed.mutations, []);
  }
});

test("public audit refuses weaker or unobserved external-contributor approval", async () => {
  for (const [response, status] of [
    [
      { status: 200, data: { approval_policy: "first_time_contributors" } },
      "FAIL",
    ],
    [
      { status: 403, data: { message: "PRIVATE_RESPONSE_SENTINEL" } },
      "UNAVAILABLE",
    ],
  ]) {
    const report = await runGuardrails(publicFixture(response));
    assert.equal(report.controls.publicForkApproval.status, status);
    assert.equal(report.status, "NOT_READY");
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE_RESPONSE_SENTINEL/);
  }
});

test("read-only audit refuses a visibility change during readback", async () => {
  const f = publicFixture();
  let identityReads = 0;
  await assert.rejects(
    runGuardrails({
      request: async (call) => {
        const reply = await f.request(call);
        if (call.path === root && ++identityReads === 2) {
          reply.data.private = true;
          reply.data.visibility = "private";
        }
        return reply;
      },
    }),
    /visibility changed/i,
  );
});

test("read-only audit refuses an inconsistent visibility response", async () => {
  const f = publicFixture();
  f.replies[root].data.private = true;
  await assert.rejects(runGuardrails(f), /visibility could not be verified/i);
  assert.equal(f.calls.length, 1);
});

test("safe apply rechecks private visibility before its first write", async () => {
  const f = fixture({
    [`${root}/actions/permissions`]: {
      status: 200,
      data: {
        enabled: true,
        allowed_actions: "all",
        sha_pinning_required: false,
      },
    },
  });
  let identityReads = 0;
  await assert.rejects(
    runGuardrails({
      applySafeActions: true,
      request: async (call) => {
        const reply = await f.request(call);
        if (call.path === root && ++identityReads === 2) {
          reply.data.private = false;
          reply.data.visibility = "public";
        }
        return reply;
      },
    }),
    /remain private/i,
  );
  assert.ok(f.calls.every((call) => call.method === "GET"));
});

test("read-only audit reports the genuine plan blocker instead of protection success", async () => {
  const f = fixture();
  const report = await runGuardrails(f);
  assert.equal(report.controls.mainProtection?.status, "BLOCKED_BY_PLAN");
  assert.equal(report.status, "BLOCKED");
  assert.equal(report.controls.actions?.status, "PASS");
  assert.ok(f.calls.every((call) => call.method === "GET"));
});

test("an audit detects an unsafe Actions default without changing it", async () => {
  const f = fixture({
    [`${root}/actions/permissions`]: {
      status: 200,
      data: {
        enabled: true,
        allowed_actions: "all",
        sha_pinning_required: false,
      },
    },
  });
  const report = await runGuardrails(f);
  assert.equal(report.controls.actions.status, "FAIL");
  assert.deepEqual(report.mutations, []);
  assert.equal(report.publicForkApproval.httpStatus, 422);
  assert.equal(
    report.publicForkApproval.recommendedOnApprovedPublicTransition,
    "all_external_contributors",
  );
});

test("explicit safe apply writes only the two exact Actions policies and verifies readback", async () => {
  const f = fixture({
    [`${root}/actions/permissions`]: {
      status: 200,
      data: {
        enabled: true,
        allowed_actions: "all",
        sha_pinning_required: false,
      },
    },
  });
  const writes = [];
  const request = async (call) => {
    if (call.method === "GET") return f.request(call);
    writes.push(structuredClone(call));
    f.replies[call.path] = { status: 200, data: structuredClone(call.body) };
    return { status: 204 };
  };
  const report = await runGuardrails({ request, applySafeActions: true });
  assert.deepEqual(writes, [
    {
      method: "PUT",
      path: `${root}/actions/permissions`,
      body: {
        enabled: true,
        allowed_actions: "selected",
        sha_pinning_required: true,
      },
    },
    {
      method: "PUT",
      path: `${root}/actions/permissions/selected-actions`,
      body: {
        github_owned_allowed: true,
        verified_allowed: false,
        patterns_allowed: [],
      },
    },
  ]);
  assert.equal(report.controls.actions.status, "PASS");
  assert.equal(report.controls.mainProtection.status, "BLOCKED_BY_PLAN");
  assert.equal(report.mutations.length, 2);
  assert.equal(
    (await runGuardrails({ request, applySafeActions: true })).mutations.length,
    0,
  );
  assert.equal(
    writes.length,
    2,
    "Already compliant configuration must be a no-op",
  );
});

test("safe apply refuses to broaden an already narrower policy", async () => {
  const f = fixture({
    [`${root}/actions/permissions`]: {
      status: 200,
      data: {
        enabled: true,
        allowed_actions: "local_only",
        sha_pinning_required: true,
      },
    },
  });
  await assert.rejects(
    runGuardrails({ ...f, applySafeActions: true }),
    /refusing to broaden/,
  );
  assert.ok(f.calls.every((call) => call.method === "GET"));
});

test("a partial update refuses rollback to the former broad policy", async () => {
  const f = fixture({
    [`${root}/actions/permissions`]: {
      status: 200,
      data: {
        enabled: true,
        allowed_actions: "all",
        sha_pinning_required: false,
      },
    },
  });
  const writes = [];
  await assert.rejects(
    runGuardrails({
      applySafeActions: true,
      request: async (call) => {
        if (call.method === "GET") return f.request(call);
        writes.push(call);
        return {
          status: writes.length === 1 ? 204 : 403,
          data: { message: "PRIVATE_RESPONSE_SENTINEL" },
        };
      },
    }),
    /update is incomplete/,
  );
  assert.equal(writes.length, 2);
  assert.ok(writes.every((call) => call.body.allowed_actions !== "all"));
});

test("transport rejects arbitrary targets, methods and policy bodies before invoking gh", () => {
  for (const call of [
    { method: "GET", path: "repos/someone/other" },
    { method: "PATCH", path: root, body: { private: false } },
    {
      method: "PUT",
      path: `${root}/actions/permissions`,
      body: { enabled: true, allowed_actions: "all" },
    },
    { method: "PUT", path: `${root}/rulesets`, body: {} },
  ])
    assert.throws(() => githubRequest(call), /Only the fixed Daedlo/);
});

test("a same-name passing check from a different app does not satisfy CI policy", async () => {
  const f = fixture();
  f.replies[
    `${root}/commits/${mainSha}/check-runs?per_page=100`
  ].data.check_runs[0].app.id = 99;
  const report = await runGuardrails(f);
  assert.equal(report.controls.mainChecks.status, "FAIL");
  assert.equal(report.status, "NOT_READY");
});

test("a ruleset name alone cannot establish main protection", async () => {
  const expected = JSON.parse(
    readFileSync(new URL("../.github/main-ruleset.json", import.meta.url)),
  );
  const f = fixture({
    [`${root}/branches/main/protection`]: { status: 404 },
    [`${root}/rulesets?includes_parents=true&per_page=100`]: {
      status: 200,
      data: [{ name: expected.name, id: 42 }],
    },
    [`${root}/rulesets/42`]: {
      status: 200,
      data: {
        ...expected,
        bypass_actors: [
          { actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" },
        ],
      },
    },
  });
  assert.equal((await runGuardrails(f)).controls.mainProtection.status, "FAIL");
  f.replies[`${root}/rulesets/42`].data = expected;
  f.replies[`${root}/rules/branches/main?per_page=100`] = {
    status: 200,
    data: expected.rules.slice(1).map((rule) => ({ ...rule, ruleset_id: 42 })),
  };
  assert.equal((await runGuardrails(f)).controls.mainProtection.status, "FAIL");
  f.replies[`${root}/rules/branches/main?per_page=100`].data =
    expected.rules.map((rule) => ({ ...rule, ruleset_id: 42 }));
  assert.equal((await runGuardrails(f)).status, "PASS");
});

test("actual CLI uses read-only fixed-host requests and emits no raw response data", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "daedlo-guardrails-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const f = fixture();
  f.replies[root].data.private_note = "PRIVATE_RESPONSE_SENTINEL";
  const responses = join(directory, "responses.json"),
    calls = join(directory, "calls.jsonl"),
    executable = join(directory, "gh");
  writeFileSync(responses, JSON.stringify(f.replies));
  writeFileSync(
    executable,
    `#!${process.execPath}\nconst fs=require('node:fs'); const args=process.argv.slice(2); fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+'\\n'); const path=args[args.indexOf('--method')+2]; const response=JSON.parse(fs.readFileSync(${JSON.stringify(responses)}))[path]; if(!response)process.exit(9); process.stdout.write('HTTP/2.0 '+response.status+' Status\\r\\nx-example: PRIVATE_HEADER_SENTINEL\\r\\n\\r\\n'+(response.data===undefined?'':JSON.stringify(response.data))); process.stderr.write('PRIVATE_STDERR_SENTINEL'); process.exit(response.status>=400?1:0);\n`,
  );
  chmodSync(executable, 0o700);
  const script = fileURLToPath(
    new URL("../scripts/repository-guardrails.mjs", import.meta.url),
  );
  const env = {
    ...process.env,
    PATH: `${directory}:${process.env.PATH}`,
    GH_HOST: "other.invalid",
  };
  const result = spawnSync(process.execPath, [script], {
    env,
    encoding: "utf8",
    timeout: 15000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "BLOCKED");
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_.*SENTINEL/);
  const requests = readFileSync(calls, "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.ok(requests.length > 5);
  for (const args of requests) {
    assert.equal(args[args.indexOf("--hostname") + 1], "github.com");
    assert.equal(args[args.indexOf("--method") + 1], "GET");
  }
  const before = requests.length;
  const rejected = spawnSync(
    process.execPath,
    [script, "--repo", "someone/other"],
    { env, encoding: "utf8" },
  );
  assert.equal(rejected.status, 2);
  assert.equal(readFileSync(calls, "utf8").trim().split("\n").length, before);
});

for (const change of [
  { id: 1 },
  { private: false, visibility: "public" },
  { full_name: "someone/daedlo" },
  { default_branch: "other" },
]) {
  test(`refuses target drift before further requests or mutation: ${JSON.stringify(change)}`, async () => {
    const f = fixture({
      [root]: {
        status: 200,
        data: {
          id: 1391092739,
          full_name: "givtaj/daedlo",
          private: true,
          visibility: "private",
          default_branch: "main",
          ...change,
        },
      },
    });
    await assert.rejects(
      runGuardrails({ ...f, applySafeActions: true }),
      /identity|private|default branch/i,
    );
    assert.equal(f.calls.length, 1);
  });
}

test("an unrelated authorization failure is not mislabeled as a plan restriction", async () => {
  const denied = {
    status: 403,
    data: { message: "Resource not accessible by integration" },
  };
  const report = await runGuardrails(
    fixture({
      [`${root}/branches/main/protection`]: denied,
      [`${root}/rulesets?includes_parents=true&per_page=100`]: denied,
    }),
  );
  assert.equal(report.controls.mainProtection?.status, "UNAVAILABLE");
  assert.equal(report.status, "NOT_READY");
});

test("the Actions policy rejects broadening even when SHA pinning remains on", async () => {
  const report = await runGuardrails(
    fixture({
      [`${root}/actions/permissions/selected-actions`]: {
        status: 200,
        data: {
          github_owned_allowed: true,
          verified_allowed: true,
          patterns_allowed: ["*/*@*"],
        },
      },
    }),
  );
  assert.equal(report.controls.actions?.status, "FAIL");
  assert.equal(report.status, "NOT_READY");
});
