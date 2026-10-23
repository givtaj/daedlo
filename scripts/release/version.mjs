import fs from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, parse, resolve, sep } from "node:path";

const files = [
  "packages/runtime/package.json",
  "package-lock.json",
  "Cargo.toml",
  "examples/notebook-engine/Cargo.toml",
  "integrations/roots/engine/Cargo.toml",
  "integrations/roots/edit/engine/Cargo.toml",
  "Cargo.lock",
  "integrations/roots/engine/Cargo.lock",
  "integrations/roots/edit/engine/Cargo.lock",
];

function semver(value) {
  const parts =
    typeof value === "string" &&
    value.match(
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/,
    );
  if (
    !parts ||
    parts[4]
      ?.split(".")
      .some(
        (part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"),
      )
  ) {
    throw Error(
      "Invalid release version: strict SemVer without build metadata is required.",
    );
  }
  return {
    core: parts.slice(1, 4).map(BigInt),
    pre: parts[4]?.split(".") ?? [],
  };
}
function compare(left, right) {
  for (let index = 0; index < 3; index++) {
    if (left.core[index] !== right.core[index])
      return left.core[index] > right.core[index] ? 1 : -1;
  }
  if (!left.pre.length || !right.pre.length)
    return left.pre.length === right.pre.length ? 0 : left.pre.length ? -1 : 1;
  for (
    let index = 0;
    index < Math.max(left.pre.length, right.pre.length);
    index++
  ) {
    const a = left.pre[index],
      b = right.pre[index];
    if (a === b) continue;
    if (a === undefined || b === undefined) return a === undefined ? -1 : 1;
    const numericA = /^\d+$/.test(a),
      numericB = /^\d+$/.test(b);
    if (numericA && numericB) return BigInt(a) > BigInt(b) ? 1 : -1;
    if (numericA !== numericB) return numericA ? -1 : 1;
    return a > b ? 1 : -1;
  }
  return 0;
}

async function regularPath(absolute) {
  let current = parse(absolute).root;
  const segments = absolute.slice(current.length).split(sep).filter(Boolean);
  for (let index = 0; index < segments.length; index++) {
    current = join(current, segments[index]);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink())
      throw Error("Version source paths must not contain symlinks.");
    if (index < segments.length - 1 && !stat.isDirectory())
      throw Error("Version source parent must be a directory.");
    if (index === segments.length - 1 && !stat.isFile())
      throw Error("Version source must be a regular file.");
  }
}
async function readSource(path) {
  await regularPath(path);
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw Error("Version source must be a regular file.");
    return { bytes: await handle.readFile(), mode: stat.mode & 0o777 };
  } finally {
    await handle.close();
  }
}

// Locate the exact JSON string token, preserving indentation, key order and all other bytes.
function jsonString(text, wanted) {
  JSON.parse(text);
  let offset = 0;
  const found = [];
  const whitespace = () => {
    while (/\s/.test(text[offset] ?? "") && offset < text.length) offset++;
  };
  const string = () => {
    const start = offset++;
    while (text[offset] !== '"') offset += text[offset] === "\\" ? 2 : 1;
    offset++;
    return { start, end: offset, value: JSON.parse(text.slice(start, offset)) };
  };
  function visit(path) {
    whitespace();
    if (text[offset] === '"') {
      const token = string();
      if (JSON.stringify(path) === JSON.stringify(wanted)) found.push(token);
    } else if (text[offset] === "{") {
      offset++;
      whitespace();
      const keys = new Set();
      while (text[offset] !== "}") {
        const key = string().value;
        if (keys.has(key)) throw Error("Duplicate JSON version source key.");
        keys.add(key);
        whitespace();
        offset++;
        visit([...path, key]);
        whitespace();
        if (text[offset] === "}") break;
        offset++;
        whitespace();
      }
      offset++;
    } else if (text[offset] === "[") {
      offset++;
      whitespace();
      let index = 0;
      while (text[offset] !== "]") {
        visit([...path, index++]);
        whitespace();
        if (text[offset] === "]") break;
        offset++;
        whitespace();
      }
      offset++;
    } else {
      while (offset < text.length && !/[\s,}\]]/.test(text[offset])) offset++;
    }
  }
  visit([]);
  if (found.length !== 1)
    throw Error("Missing or ambiguous JSON release version.");
  return found[0];
}

function sections(text, heading) {
  const headers = [
    ...text.matchAll(/^[ \t]*(\[\[?[^\r\n]+?\]\]?)[ \t]*(?:#.*)?\r?$/gm),
  ];
  return headers.flatMap((match, index) =>
    match[1] === heading
      ? [
          {
            start: match.index + match[0].length,
            end: headers[index + 1]?.index ?? text.length,
          },
        ]
      : [],
  );
}
function one(items, description) {
  if (items.length !== 1) throw Error(`Missing or ambiguous ${description}.`);
  return items[0];
}
function quoted(text, region, key) {
  const matches = [
    ...text
      .slice(region.start, region.end)
      .matchAll(
        new RegExp(
          `^[ \\t]*${key}[ \\t]*=[ \\t]*("[^"\\r\\n]*")[ \\t]*(?:#.*)?\\r?$`,
          "gm",
        ),
      ),
  ];
  const match = one(matches, `${key} version field`);
  const start = region.start + match.index + match[0].indexOf(match[1]);
  return { start, end: start + match[1].length, value: JSON.parse(match[1]) };
}
function dependency(text) {
  const section = one(sections(text, "[dependencies]"), "dependencies section");
  const matches = [
    ...text
      .slice(section.start, section.end)
      .matchAll(
        /^[ \t]*daedlo-engine[ \t]*=[ \t]*\{[^\r\n]*\}[ \t]*(?:#.*)?\r?$/gm,
      ),
  ];
  const match = one(matches, "framework dependency");
  const version = one(
    [...match[0].matchAll(/\bversion[ \t]*=[ \t]*("[^"\r\n]*")/g)],
    "exact framework dependency version",
  );
  const start =
    section.start +
    match.index +
    version.index +
    version[0].indexOf(version[1]);
  return {
    start,
    end: start + version[1].length,
    value: JSON.parse(version[1]),
  };
}
function lockedPackage(text, name) {
  const packages = sections(text, "[[package]]").filter(
    (section) => quoted(text, section, "name").value === name,
  );
  const section = one(packages, `locked ${name} package`);
  if (/^[ \t]*source[ \t]*=/m.test(text.slice(section.start, section.end)))
    throw Error("Framework lock entry must be a local package.");
  return quoted(text, section, "version");
}
function replacements(path, text) {
  if (path === "packages/runtime/package.json") {
    if (JSON.parse(text).name !== "@daedlo/runtime")
      throw Error("Runtime package name mismatch.");
    return [jsonString(text, ["version"])];
  }
  if (path === "package-lock.json") {
    const lock = JSON.parse(text);
    if (
      lock.lockfileVersion !== 3 ||
      lock.packages?.["packages/runtime"]?.name !== "@daedlo/runtime"
    )
      throw Error("Runtime workspace lock metadata mismatch.");
    return [jsonString(text, ["packages", "packages/runtime", "version"])];
  }
  if (path === "Cargo.toml")
    return [
      quoted(
        text,
        one(sections(text, "[workspace.package]"), "workspace package section"),
        "version",
      ),
    ];
  if (path.endsWith("Cargo.toml"))
    return [{ ...dependency(text), exact: true }];
  const tokens = [lockedPackage(text, "daedlo-engine")];
  if (path === "Cargo.lock")
    tokens.push(lockedPackage(text, "notebook-engine"));
  return tokens;
}

async function stage(file, bytes) {
  const path = join(
    dirname(file.path),
    `.browser-driver-version-${randomUUID()}.tmp`,
  );
  const handle = await fs.open(path, "wx", file.mode);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await fs.unlink(path);
    throw error;
  }
  await handle.close();
  return path;
}

/** Prepare only this repository's known release version fields, without hooks or installs. */
export async function setReleaseVersion({ repoRoot, version }) {
  const requested = semver(version);
  if (
    typeof repoRoot !== "string" ||
    !repoRoot ||
    repoRoot.split(/[\\/]/).includes("..")
  )
    throw Error("An explicit repository root without traversal is required.");
  const root = resolve(repoRoot),
    planned = [];
  let previousVersion;
  for (const file of files) {
    const path = join(root, file),
      source = await readSource(path),
      text = source.bytes.toString("utf8");
    const tokens = replacements(file, text);
    previousVersion ??= tokens[0].value;
    for (const token of tokens) {
      if (
        token.value !== (token.exact ? `=${previousVersion}` : previousVersion)
      )
        throw Error(`Release version mismatch in ${file}.`);
    }
    const output = tokens
      .sort((a, b) => b.start - a.start)
      .reduce(
        (value, token) =>
          value.slice(0, token.start) +
          JSON.stringify(token.exact ? `=${version}` : version) +
          value.slice(token.end),
        text,
      );
    planned.push({ file, path, ...source, next: Buffer.from(output) });
  }
  if (compare(requested, semver(previousVersion)) <= 0)
    throw Error(
      "Release version must be strictly greater than the current version.",
    );
  const committed = [],
    temporary = new Set(),
    retained = new Set();
  let failure;
  try {
    for (const file of planned) {
      file.staged = await stage(file, file.next);
      temporary.add(file.staged);
      file.backup = await stage(file, file.bytes);
      temporary.add(file.backup);
    }
    for (const file of planned) {
      if (!(await readSource(file.path)).bytes.equals(file.bytes))
        throw Error(`Version source changed before writing ${file.file}.`);
    }
    for (const file of planned) {
      if (!(await readSource(file.path)).bytes.equals(file.bytes))
        throw Error(`Version source changed before writing ${file.file}.`);
      await fs.rename(file.staged, file.path);
      temporary.delete(file.staged);
      committed.push(file);
    }
  } catch (error) {
    failure = error;
    const rollbackFailed = [];
    for (const file of committed.reverse()) {
      try {
        if (!(await readSource(file.path)).bytes.equals(file.next))
          throw Error("Changed file cannot be overwritten during rollback.");
        await fs.rename(file.backup, file.path);
        temporary.delete(file.backup);
      } catch {
        retained.add(file.backup);
        rollbackFailed.push({ file: file.file, backup: file.backup });
      }
    }
    if (rollbackFailed.length) {
      failure = new Error(
        "Version preparation failed; rollback incomplete, original bytes retained in backups.",
        { cause: error },
      );
      failure.rollbackFailed = rollbackFailed;
    }
  } finally {
    const cleanupFailed = [];
    for (const path of temporary) {
      if (retained.has(path)) continue;
      try {
        await fs.unlink(path);
      } catch {
        cleanupFailed.push(path);
      }
    }
    if (cleanupFailed.length) {
      failure ??= new Error("Version preparation cleanup incomplete.");
      failure.cleanupFailed = cleanupFailed;
    }
  }
  if (failure) throw failure;
  return { previousVersion, version, files: [...files] };
}
