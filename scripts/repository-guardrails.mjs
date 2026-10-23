// Daedlo-only repository audit. No default writes, publication or plan changes.
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";

export const TARGET = Object.freeze({
  host: "github.com",
  repository: "givtaj/daedlo",
  id: 1391092739,
  branch: "main",
});
const base = `repos/${TARGET.repository}`;
export const ACTIONS_POLICY = Object.freeze({
  enabled: true,
  allowed_actions: "selected",
  sha_pinning_required: true,
});
export const SELECTED_ACTIONS_POLICY = Object.freeze({
  github_owned_allowed: true,
  verified_allowed: false,
  patterns_allowed: Object.freeze([]),
});
const actionsPath = `${base}/actions/permissions`;
const selectedPath = `${actionsPath}/selected-actions`;
const rulesetsPath = `${base}/rulesets?includes_parents=true&per_page=100`;
const ruleKeys = [
  "name",
  "target",
  "enforcement",
  "bypass_actors",
  "conditions",
  "rules",
];

class AuditError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
function fail(code, message) {
  throw new AuditError(code, message);
}
function matchesFields(actual, expected) {
  return (
    actual &&
    Object.entries(expected).every(([key, value]) =>
      isDeepStrictEqual(actual[key], value),
    )
  );
}
function control(matches, response) {
  return {
    status:
      response.status === 200 ? (matches ? "PASS" : "FAIL") : "UNAVAILABLE",
    httpStatus: response.status,
  };
}
function isPlanRestriction(response) {
  return (
    response.status === 403 &&
    /Upgrade to GitHub Pro or make this repository public/i.test(
      response.data?.message ?? "",
    )
  );
}

// Response data stays in memory; raw output, headers and stderr are never reported.
export function githubRequest({ method, path, body }) {
  const reads = [
    base,
    `${base}/branches/main`,
    `${base}/branches/main/protection`,
    rulesetsPath,
    `${base}/rules/branches/main?per_page=100`,
    actionsPath,
    selectedPath,
    `${actionsPath}/workflow`,
    `${actionsPath}/fork-pr-workflows-private-repos`,
    `${actionsPath}/fork-pr-contributor-approval`,
    `${base}/vulnerability-alerts`,
  ];
  const dynamicRead =
    path.startsWith(`${base}/`) &&
    (/^commits\/[a-f0-9]{40}\/check-runs\?per_page=100$/.test(
      path.slice(base.length + 1),
    ) ||
      /^rulesets\/[0-9]+$/.test(path.slice(base.length + 1)));
  const allowedWrite =
    method === "PUT" &&
    ((path === actionsPath && isDeepStrictEqual(body, ACTIONS_POLICY)) ||
      (path === selectedPath &&
        isDeepStrictEqual(body, SELECTED_ACTIONS_POLICY)));
  if (
    !(
      method === "GET" &&
      body === undefined &&
      (reads.includes(path) || dynamicRead)
    ) &&
    !allowedWrite
  )
    fail(
      "REQUEST_REFUSED",
      "Only the fixed Daedlo read endpoints and exact safe Actions policy are permitted.",
    );
  const result = spawnSync(
    "gh",
    [
      "api",
      "--hostname",
      TARGET.host,
      "--include",
      "--method",
      method,
      path,
      ...(body === undefined ? [] : ["--input", "-"]),
    ],
    {
      input: body === undefined ? undefined : JSON.stringify(body),
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, GH_HOST: TARGET.host },
    },
  );
  if (result.error || result.signal)
    fail(
      "TRANSPORT_FAILED",
      "GitHub API transport failed; no response data retained.",
    );
  const output = result.stdout ?? "";
  const header = /^HTTP\/\S+\s+(\d{3})[^\r\n]*\r?\n[\s\S]*?\r?\n\r?\n/.exec(
    output,
  );
  if (!header)
    fail(
      "TRANSPORT_FAILED",
      "GitHub API returned no readable HTTP status; no response data retained.",
    );
  const status = Number(header[1]);
  const text = output.slice(header[0].length).trim();
  let data;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    fail(
      "RESPONSE_INVALID",
      "GitHub API returned an invalid JSON response; no response data retained.",
    );
  }
  return { status, data };
}

async function identify(request) {
  const response = await request({ method: "GET", path: base });
  if (response.status !== 200)
    fail(
      "IDENTITY_UNAVAILABLE",
      "Repository identity could not be verified; no mutations permitted.",
    );
  const repo = response.data;
  if (repo?.id !== TARGET.id || repo.full_name !== TARGET.repository)
    fail(
      "IDENTITY_MISMATCH",
      "Repository identity mismatch; no mutations permitted.",
    );
  if (repo.private !== true || repo.visibility !== "private")
    fail(
      "PRIVATE_REQUIRED",
      "This command requires the repository to remain private; no mutations permitted.",
    );
  if (repo.default_branch !== TARGET.branch)
    fail(
      "BRANCH_MISMATCH",
      "Default branch differs from the reviewed policy; no mutations permitted.",
    );
}
async function readActions(request) {
  const policy = await request({ method: "GET", path: actionsPath });
  const selected =
    policy.status === 200 && policy.data?.allowed_actions === "selected"
      ? await request({ method: "GET", path: selectedPath })
      : { status: 409 };
  return { policy, selected };
}
function actionsMatch({ policy, selected }) {
  return (
    policy.status === 200 &&
    selected.status === 200 &&
    matchesFields(policy.data, ACTIONS_POLICY) &&
    matchesFields(selected.data, SELECTED_ACTIONS_POLICY)
  );
}
async function applyActions(request, current) {
  if (actionsMatch(current)) return [];
  const { policy, selected } = current;
  if (
    policy.status !== 200 ||
    policy.data?.enabled !== true ||
    !(
      policy.data.allowed_actions === "all" ||
      (policy.data.allowed_actions === "selected" &&
        selected.status === 200 &&
        selected.data?.github_owned_allowed === true)
    )
  )
    fail(
      "POLICY_REFUSED",
      "Existing Actions policy is unavailable or more restrictive; refusing to broaden it.",
    );
  const writes = [];
  for (const [path, body, matches] of [
    [actionsPath, ACTIONS_POLICY, matchesFields(policy.data, ACTIONS_POLICY)],
    [
      selectedPath,
      SELECTED_ACTIONS_POLICY,
      selected.status === 200 &&
        matchesFields(selected.data, SELECTED_ACTIONS_POLICY),
    ],
  ]) {
    if (matches) continue;
    await identify(request);
    const response = await request({
      method: "PUT",
      path,
      body: structuredClone(body),
    });
    if (response.status !== 204)
      fail(
        "SAFE_ACTIONS_INCOMPLETE",
        "Actions policy update is incomplete; run the read-only audit. No automatic rollback or weaker policy was applied.",
      );
    writes.push({ endpoint: path, httpStatus: 204 });
  }
  return writes;
}
async function inspectMain(request, expected, protection, rulesets) {
  if (isPlanRestriction(protection) && isPlanRestriction(rulesets))
    return {
      status: "BLOCKED_BY_PLAN",
      protectionHttpStatus: 403,
      rulesetsHttpStatus: 403,
    };
  if (rulesets.status !== 200 || !Array.isArray(rulesets.data))
    return {
      status: "UNAVAILABLE",
      protectionHttpStatus: protection.status,
      rulesetsHttpStatus: rulesets.status,
    };
  if (rulesets.data.length >= 100)
    return { status: "UNAVAILABLE", reason: "RULESET_INVENTORY_INCOMPLETE" };
  const candidates = rulesets.data.filter(
    (item) => item.name === expected.name,
  );
  if (candidates.length !== 1 || !Number.isSafeInteger(candidates[0].id))
    return { status: "FAIL", reason: "EXPECTED_RULESET_MISSING_OR_AMBIGUOUS" };
  const detail = await request({
    method: "GET",
    path: `${base}/rulesets/${candidates[0].id}`,
  });
  if (detail.status !== 200)
    return { status: "UNAVAILABLE", httpStatus: detail.status };
  if (
    !matchesFields(
      detail.data,
      Object.fromEntries(ruleKeys.map((key) => [key, expected[key]])),
    )
  )
    return { status: "FAIL", reason: "MAIN_POLICY_DIFFERS" };
  const effective = await request({
    method: "GET",
    path: `${base}/rules/branches/main?per_page=100`,
  });
  if (
    effective.status !== 200 ||
    !Array.isArray(effective.data) ||
    effective.data.length >= 100
  )
    return {
      status: "UNAVAILABLE",
      reason: "EFFECTIVE_RULES_UNVERIFIED",
      httpStatus: effective.status,
    };
  const enforced = expected.rules.every((rule) =>
    effective.data.some(
      (actual) =>
        actual.ruleset_id === candidates[0].id && matchesFields(actual, rule),
    ),
  );
  return {
    status: enforced ? "PASS" : "FAIL",
    reason: enforced
      ? "EXPECTED_RULESET_ACTIVE"
      : "EXPECTED_RULES_NOT_EFFECTIVE",
  };
}

export async function runGuardrails({
  request = githubRequest,
  applySafeActions = false,
} = {}) {
  if (typeof applySafeActions !== "boolean")
    fail("ARGUMENT_REFUSED", "Apply mode must be explicitly selected.");
  await identify(request);
  const expected = JSON.parse(
    await readFile(
      new URL("../.github/main-ruleset.json", import.meta.url),
      "utf8",
    ),
  );
  let actions = await readActions(request);
  const mutations = applySafeActions
    ? await applyActions(request, actions)
    : [];
  if (applySafeActions) actions = await readActions(request);
  const paths = [
    `${base}/branches/main`,
    `${base}/branches/main/protection`,
    rulesetsPath,
    `${actionsPath}/workflow`,
    `${actionsPath}/fork-pr-workflows-private-repos`,
    `${base}/vulnerability-alerts`,
    `${actionsPath}/fork-pr-contributor-approval`,
  ];
  const [
    branch,
    protection,
    rulesets,
    workflow,
    forks,
    alerts,
    contributorApproval,
  ] = await Promise.all(paths.map((path) => request({ method: "GET", path })));
  const sha =
    branch.status === 200 &&
    /^[a-f0-9]{40}$/.test(branch.data?.commit?.sha ?? "")
      ? branch.data.commit.sha
      : null;
  const checks = sha
    ? await request({
        method: "GET",
        path: `${base}/commits/${sha}/check-runs?per_page=100`,
      })
    : { status: 0 };
  const requiredChecks = expected.rules.find(
    (rule) => rule.type === "required_status_checks",
  ).parameters.required_status_checks;
  const checksComplete =
    checks.status === 200 &&
    Array.isArray(checks.data?.check_runs) &&
    checks.data.total_count === checks.data.check_runs.length &&
    checks.data.total_count < 100;
  const ciPassed =
    checksComplete &&
    requiredChecks.every((required) =>
      checks.data.check_runs.some(
        (check) =>
          check.name === required.context &&
          check.app?.id === required.integration_id &&
          check.status === "completed" &&
          check.conclusion === "success",
      ),
    );
  const controls = {
    actions: {
      status:
        actions.policy.status === 200 &&
        (actions.policy.data?.allowed_actions !== "selected" ||
          actions.selected.status === 200)
          ? actionsMatch(actions)
            ? "PASS"
            : "FAIL"
          : "UNAVAILABLE",
      policyHttpStatus: actions.policy.status,
      allowlistHttpStatus: actions.selected.status,
    },
    workflowDefaults: control(
      matchesFields(workflow.data, {
        default_workflow_permissions: "read",
        can_approve_pull_request_reviews: false,
      }),
      workflow,
    ),
    privateForks: control(
      matchesFields(forks.data, {
        run_workflows_from_fork_pull_requests: false,
        send_write_tokens_to_workflows: false,
        send_secrets_and_variables: false,
      }),
      forks,
    ),
    vulnerabilityAlerts: {
      status:
        alerts.status === 204
          ? "PASS"
          : alerts.status === 404
            ? "FAIL"
            : "UNAVAILABLE",
      httpStatus: alerts.status,
    },
    mainProtection: await inspectMain(request, expected, protection, rulesets),
    mainChecks: {
      status: !checksComplete ? "UNAVAILABLE" : ciPassed ? "PASS" : "FAIL",
      headSha: sha,
      required: requiredChecks,
    },
  };
  await identify(request);
  const statuses = Object.values(controls).map((item) => item.status);
  const status = statuses.every((value) => value === "PASS")
    ? "PASS"
    : statuses.every((value) => ["PASS", "BLOCKED_BY_PLAN"].includes(value))
      ? "BLOCKED"
      : "NOT_READY";
  const approvalValues = [
    "all_external_contributors",
    "first_time_contributors",
    "first_time_contributors_new_to_github",
  ];
  return {
    schemaVersion: 1,
    repository: TARGET.repository,
    repositoryId: TARGET.id,
    visibility: "private",
    mode: applySafeActions ? "apply-safe-actions" : "read-only",
    status,
    controls,
    mutations,
    publicForkApproval: {
      httpStatus: contributorApproval.status,
      observed: approvalValues.includes(
        contributorApproval.data?.approval_policy,
      )
        ? contributorApproval.data.approval_policy
        : null,
      recommendedOnApprovedPublicTransition: "all_external_contributors",
      appliedByThisCommand: false,
    },
    pendingMainRuleset: {
      appliedByThisCommand: false,
      configuration: expected,
    },
    limits: [
      "This command never changes visibility, history, billing, branch rules, release settings, secrets or security products.",
      "Passing available settings does not waive an unavailable main protection gate.",
      "Native secret/code scanning and private vulnerability reporting are outside this command; no enablement is claimed.",
    ],
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === "--help") {
      console.log(
        "Usage: node scripts/repository-guardrails.mjs [--apply-safe-actions]\nDefault: read-only audit of private givtaj/daedlo (ID 1391092739).\nThe explicit apply flag changes only the reviewed Actions allowlist and SHA pinning.\nExit: 0 all audited controls pass; 1 gaps/plan blockers; 2 refusal or transport error.",
      );
    } else {
      if (
        args.length > 1 ||
        (args.length === 1 && args[0] !== "--apply-safe-actions")
      )
        fail(
          "ARGUMENT_REFUSED",
          "Unsupported argument. This command has no repository, host, visibility or plan override.",
        );
      const report = await runGuardrails({
        applySafeActions: args[0] === "--apply-safe-actions",
      });
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = report.status === "PASS" ? 0 : 1;
    }
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          schemaVersion: 1,
          status: "ERROR",
          error:
            error instanceof AuditError
              ? { code: error.code, message: error.message }
              : {
                  code: "AUDIT_FAILED",
                  message:
                    "Audit could not be completed; raw response and exception data were not retained.",
                },
        },
        null,
        2,
      ),
    );
    process.exitCode = 2;
  }
}
