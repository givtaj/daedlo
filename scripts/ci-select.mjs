import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// These two records are not shipped documentation or executable test inputs.
// Every other path, including unknown future Markdown files, needs the full suite.
const recordOnlyPaths = new Set(["docs/plan.md", "docs/verification.md"]);
const shaPattern = /^[a-f0-9]{40}$/;
const full = (reason) => ({ full: true, reason });

export function classifyDiff(raw) {
  if (typeof raw !== "string" || !raw.endsWith("\0"))
    return full("unavailable-diff");
  const fields = raw.slice(0, -1).split("\0");
  if (fields.length < 2 || fields.length % 2 !== 0)
    return full("unavailable-diff");
  for (let index = 0; index < fields.length; index += 2) {
    // Require an ordinary edit to an existing regular file. Adds, deletes,
    // renames, type/mode changes and malformed Git output stay on the full path.
    if (
      !/^:100644 100644 [a-f0-9]{40} [a-f0-9]{40} M$/.test(fields[index]) ||
      !recordOnlyPaths.has(fields[index + 1])
    )
      return full("product-or-unknown-change");
  }
  return { full: false, reason: "planning-records-only" };
}

export function selectCi({ eventName, event, checkoutSha, git }) {
  if (eventName !== "pull_request")
    return full("main-or-manual-or-unknown-event");
  const base = event?.pull_request?.base?.sha;
  const head = event?.pull_request?.head?.sha;
  if (![base, head, checkoutSha].every((sha) => shaPattern.test(sha ?? "")))
    return full("unavailable-revisions");
  try {
    // Classify the actual merge checkout used by the consumer jobs. Include
    // base-side changes since the common ancestor, not just the PR's file list.
    const parents = git(["rev-list", "--parents", "-n", "1", "HEAD"])
      .trim()
      .split(" ");
    if (
      parents.length !== 3 ||
      parents[0] !== checkoutSha ||
      parents[1] !== base ||
      parents[2] !== head
    )
      return full("unverified-merge-checkout");
    const ancestor = git(["merge-base", base, head]).trim();
    if (!shaPattern.test(ancestor)) return full("unavailable-revisions");
    return classifyDiff(
      git([
        "diff",
        "--raw",
        "-z",
        "--no-renames",
        "--abbrev=40",
        ancestor,
        checkoutSha,
        "--",
      ]),
    );
  } catch {
    return full("unavailable-diff");
  }
}

export function runSelection(env = process.env) {
  let event;
  try {
    event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
  } catch {
    // Missing/malformed events must increase verification, never skip it.
  }
  const selection = selectCi({
    eventName: env.GITHUB_EVENT_NAME,
    event,
    checkoutSha: env.GITHUB_SHA,
    git: (args) =>
      execFileSync("git", args, {
        cwd: env.GITHUB_WORKSPACE ?? process.cwd(),
        encoding: "utf8",
        timeout: 30000,
        maxBuffer: 8 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      }),
  });
  if (env.GITHUB_OUTPUT)
    appendFileSync(
      env.GITHUB_OUTPUT,
      `full=${selection.full}\nreason=${selection.reason}\n`,
    );
  console.log(JSON.stringify(selection));
  return selection;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  runSelection();
