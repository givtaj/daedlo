import fs from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  resolve,
  sep,
} from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const inside = (parent, child) =>
  parent === child ||
  child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
const overlap = (a, b) => inside(a, b) || inside(b, a);
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
function toolsOwnershipRoot() {
  // Source tools own their source directory. A portable package owns its root;
  // npm-installed tools own the versioned prefix above node_modules as well.
  if (basename(moduleDirectory) !== "lib") return moduleDirectory;
  const packageRoot = dirname(moduleDirectory);
  for (
    let ancestor = dirname(packageRoot);
    ancestor !== dirname(ancestor);
    ancestor = dirname(ancestor)
  )
    if (basename(ancestor) === "node_modules") return dirname(ancestor);
  return packageRoot;
}
const toolsRoot = toolsOwnershipRoot();
const fail = (code, message) => {
  throw Object.assign(Error(message), { code });
};

/** Read a verified runtime's declared capability before replacing a running owner. */
export async function assertJournalRuntime(installation) {
  let handle;
  try {
    handle = await fs.open(
      join(dirname(installation.runtimePath), "capabilities.json"),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 8192) throw Error("Invalid capabilities");
    const bytes = await handle.readFile();
    if (bytes.length > 8192 || JSON.parse(bytes).runJournal !== 1)
      throw Error("Unsupported capabilities");
  } catch {
    fail(
      "journal_runtime_required",
      "This workspace requires a runtime with guarded run-journal support. Retain the current installation and select a compatible runtime.",
    );
  } finally {
    await handle?.close();
  }
}

/** Schema 2 is explicit so legacy tools cannot silently ignore workspace settings. */
export function workspaceConfiguration(config) {
  if (config?.schemaVersion === 1) {
    if (Object.hasOwn(config, "workspace"))
      fail(
        "workspace_config",
        "Workspace settings require bootstrap schema 2.",
      );
    return null;
  }
  if (
    config?.schemaVersion !== 2 ||
    !object(config.workspace) ||
    !["id,root", "id,journal,root"].includes(
      Object.keys(config.workspace).sort().join(","),
    ) ||
    (Object.hasOwn(config.workspace, "journal") &&
      config.workspace.journal !== 1) ||
    typeof config.workspace.id !== "string" ||
    !idPattern.test(config.workspace.id) ||
    typeof config.registration?.projectId !== "string" ||
    !idPattern.test(config.registration.projectId) ||
    [config.workspace.root, config.store, config.registration.sourceRoot].some(
      (path) => typeof path !== "string" || !isAbsolute(path),
    )
  )
    fail(
      "workspace_config",
      "Bootstrap schema 2 requires an explicit workspace ID/root, project ID and absolute source/store paths.",
    );
  const root = resolve(config.workspace.root);
  const store = resolve(config.store);
  const source = resolve(config.registration.sourceRoot);
  if (
    overlap(root, store) ||
    overlap(root, source) ||
    overlap(root, toolsRoot) ||
    overlap(store, source)
  )
    fail(
      "workspace_path",
      "Workspace data must be disjoint from tools, the managed store and authored source.",
    );
  return Object.freeze({
    root,
    id: config.workspace.id,
    projectId: config.registration.projectId,
    ...(config.workspace.journal === 1
      ? {
          journal: 1,
          journalRoot: join(
            root,
            "projects",
            config.registration.projectId,
            "run-journals",
          ),
        }
      : {}),
    evidenceRoot: join(
      root,
      "projects",
      config.registration.projectId,
      "run-reports",
    ),
  });
}

// All existing ancestors are checked even when the leaf does not exist.
async function directory(path, { create = false } = {}) {
  path = resolve(path);
  let current = parse(path).root;
  for (const part of path.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    if (create)
      await fs.mkdir(current, { mode: 0o700 }).catch((error) => {
        if (error.code !== "EEXIST") throw error;
      });
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (!create && error.code === "ENOENT") return null;
      throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink())
      fail(
        "workspace_path",
        "Workspace paths cannot contain links or non-directories.",
      );
  }
  return fs.lstat(path);
}

const expectedManifest = (descriptor) => ({
  schemaVersion: 1,
  kind: "daedlo-workspace",
  workspaceId: descriptor.id,
  formats: {
    managedRun: 1,
    ...(descriptor.journal === 1 ? { runJournal: 1 } : {}),
  },
});

async function readManifest(descriptor) {
  let handle;
  try {
    handle = await fs.open(
      join(descriptor.root, "workspace.json"),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 8192)
      fail("workspace_incompatible", "The workspace format record is invalid.");
    const bytes = await handle.readFile();
    if (bytes.length > 8192)
      fail("workspace_incompatible", "The workspace format record is invalid.");
    let manifest;
    try {
      manifest = JSON.parse(bytes.toString("utf8"));
    } catch {
      fail(
        "workspace_incompatible",
        "The workspace format record is incomplete or invalid.",
      );
    }
    if (
      !object(manifest) ||
      manifest.schemaVersion !== 1 ||
      manifest.kind !== "daedlo-workspace" ||
      !isDeepStrictEqual(
        manifest.formats,
        expectedManifest(descriptor).formats,
      ) ||
      Object.keys(manifest).sort().join(",") !==
        "formats,kind,schemaVersion,workspaceId"
    )
      fail(
        "workspace_incompatible",
        "This tools version cannot open the workspace format; retain the data and use compatible tools.",
      );
    if (manifest.workspaceId !== descriptor.id)
      fail(
        "workspace_ownership_changed",
        "The workspace belongs to a different identity.",
      );
    return { bytes, stat };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (["ELOOP", "EMLINK"].includes(error.code))
      fail("workspace_path", "The workspace format record cannot be a link.");
    throw error;
  } finally {
    await handle?.close();
  }
}

async function inspect(config) {
  const descriptor = workspaceConfiguration(config);
  if (!descriptor) return null;
  await directory(config.store);
  await directory(config.registration.sourceRoot);
  const rootStat = await directory(descriptor.root);
  if (!rootStat) return { descriptor, exists: false };
  const record = await readManifest(descriptor);
  if (!record) {
    if ((await fs.readdir(descriptor.root)).length)
      fail(
        "workspace_unowned",
        "Refusing a nonempty workspace without a compatible ownership record.",
      );
    return { descriptor, exists: false };
  }
  await directory(descriptor.evidenceRoot);
  if (descriptor.journalRoot) await directory(descriptor.journalRoot);
  return { descriptor, exists: true, rootStat, record };
}

/** Read-only compatibility inspection. Missing or empty workspaces stay untouched. */
export async function inspectWorkspace(config) {
  const result = await inspect(config);
  return result
    ? Object.freeze({ ...result.descriptor, exists: result.exists })
    : null;
}

/** Open only existing data; every writer/start boundary can recheck this identity. */
export async function openWorkspace(config) {
  const capturedConfig = structuredClone(config);
  const opened = await inspect(capturedConfig);
  if (!opened) return null;
  if (!opened.exists)
    fail(
      "workspace_unowned",
      "Initialize the explicit workspace before opening it.",
    );
  return Object.freeze({
    ...opened.descriptor,
    exists: true,
    async assertCompatible() {
      const current = await inspect(capturedConfig);
      if (
        !current?.exists ||
        !sameFile(current.rootStat, opened.rootStat) ||
        !current.record.bytes.equals(opened.record.bytes)
      )
        fail(
          "workspace_ownership_changed",
          "The workspace was replaced or its ownership record changed; preserve it for inspection.",
        );
    },
  });
}

/** Explicit adoption only: no release update migrates or rewrites existing data. */
export async function initializeWorkspace(config) {
  const capturedConfig = structuredClone(config);
  const inspected = await inspect(capturedConfig);
  if (!inspected) return null;
  if (inspected.exists) return openWorkspace(capturedConfig);
  const descriptor = inspected.descriptor;
  const rootStat = await directory(descriptor.root, { create: true });
  // Recheck after creating ancestors; another initializer may already have won.
  const rechecked = await inspect(capturedConfig);
  if (rechecked.exists) return openWorkspace(capturedConfig);
  const temporary = join(descriptor.root, `.workspace-${randomUUID()}.tmp`);
  let handle;
  let temporaryStat;
  try {
    handle = await fs.open(temporary, "wx", 0o600);
    temporaryStat = await handle.stat();
    await handle.writeFile(
      JSON.stringify(expectedManifest(descriptor), null, 2) + "\n",
    );
    await handle.sync();
    await handle.close();
    handle = null;
    const currentRoot = await directory(descriptor.root);
    if (!currentRoot || !sameFile(currentRoot, rootStat))
      fail(
        "workspace_ownership_changed",
        "Workspace ownership changed during initialization.",
      );
    try {
      // Publish a complete record atomically without replacing a competing owner.
      await fs.link(temporary, join(descriptor.root, "workspace.json"));
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      await readManifest(descriptor);
    }
    const parent = await fs.open(descriptor.root, "r");
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
  } finally {
    try {
      await handle?.close();
      if (temporaryStat) {
        const owned = await fs.lstat(temporary).catch((error) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
        if (owned && sameFile(owned, temporaryStat)) await fs.unlink(temporary);
        else if (owned)
          fail(
            "workspace_ownership_changed",
            "Workspace initialization cleanup lost ownership.",
          );
      }
    } catch (cause) {
      throw Object.assign(
        Error(
          "Workspace initialization cleanup is incomplete; retain the temporary record for explicit repair.",
          { cause },
        ),
        { code: "workspace_cleanup_incomplete", retainedPath: temporary },
      );
    }
  }
  return openWorkspace(capturedConfig);
}
