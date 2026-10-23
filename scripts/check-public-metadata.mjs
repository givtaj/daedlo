import { execFileSync } from "node:child_process";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readlinkSync,
} from "node:fs";
import { join } from "node:path";

// Inspect current working-tree bytes for Git-index paths, including staged adds.
// This does not inspect index blobs, untracked files, Git history, or submodules.
// A customers path segment at any depth is rejected before opening the path.
// Rules recognize literal direct /c/ and /g/<id>[/project]/c/ conversation
// routes on the two ChatGPT hosts, plus Codex thread deep links. Public share
// URLs, bare UUIDs, and ordinary session/model identifiers are deliberately allowed.
// ASCII routes embedded in binary bytes are checked too. Encoded/obfuscated URLs,
// compressed archives, image text, and other private metadata need separate review.
// Run on a stable checkout: this is a focused review guard, not a complete secret
// scanner or a security boundary against hostile concurrent filesystem changes.
const rules = [
  {
    name: "private-chat-conversation",
    pattern:
      /(?:^|[^a-z0-9._-])(?:https?:\/\/)?(?:www\.)?(?:chatgpt\.com|chat\.openai\.com)\/(?:c\/|g\/[^/\s?#"'<>]+\/(?:project\/)?c\/)[a-z0-9_-]+/i,
  },
  {
    name: "private-codex-thread",
    pattern: /(?:^|[^a-z0-9+.-])codex:\/\/threads\/[a-z0-9_-]+/i,
  },
];

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  });
}

function trackedText(root, file) {
  // Never follow a tracked symlink or a directory replaced with a symlink into
  // untracked/customer data. A final symlink's path text is safe to inspect.
  const parts = file.split("/");
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    if (!lstatSync(current).isDirectory())
      throw Error("Non-directory ancestor");
  }
  const path = join(root, file);
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink()) return readlinkSync(path);
  if (metadata.isDirectory()) return ""; // Gitlinks are separate repositories.
  if (!metadata.isFile()) throw Error("Non-regular tracked file");
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!fstatSync(descriptor).isFile())
      throw Error("Non-regular tracked file");
    return readFileSync(descriptor).toString("utf8");
  } finally {
    closeSync(descriptor);
  }
}

function check() {
  const root = git(["rev-parse", "--show-toplevel"], process.cwd()).trimEnd();
  const files = [
    ...new Set(
      git(["ls-files", "--cached", "-z"], root).split("\0").filter(Boolean),
    ),
  ].sort();
  const findings = [];
  for (const file of files) {
    if (file.split("/").includes("customers")) {
      findings.push({ file, rule: "customer-path" });
      continue; // Reject by tracked name without opening any customer data.
    }
    let text;
    try {
      text = trackedText(root, file);
    } catch (error) {
      if (error.code === "ENOENT") continue; // Deleted from the working tree.
      findings.push({ file, rule: "unreadable-tracked-path" });
      continue;
    }
    for (const rule of rules) {
      if (rule.pattern.test(text)) findings.push({ file, rule: rule.name });
    }
  }
  if (findings.length) {
    console.error("Public metadata check failed:");
    for (const { file, rule } of findings) {
      // No matching line, URL, identifier, file contents, or raw error is printed.
      console.error(`${JSON.stringify(file)}: ${rule}`);
    }
    process.exitCode = 1;
  } else {
    console.log("Public metadata check passed.");
  }
}

try {
  check();
} catch {
  console.error(
    "Unable to inspect tracked files. Run from a readable Git checkout.",
  );
  process.exitCode = 2;
}
