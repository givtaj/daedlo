import fs from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { isDeepStrictEqual } from "node:util";
import { join, resolve, parse, sep } from "node:path";
import { verifyBundle } from "./manifest.mjs";
import { safeObservation } from "./native-session.mjs";

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
function fail(code, message) {
  const e = Error(message);
  e.code = code;
  throw e;
}
export async function ninjaDirectory(path, { create = false } = {}) {
  path = resolve(path);
  let current = parse(path).root;
  for (const part of path.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    if (create)
      await fs.mkdir(current, { mode: 0o700 }).catch((e) => {
        if (e.code !== "EEXIST") throw e;
      });
    const s = await fs.lstat(current);
    if (!s.isDirectory() || s.isSymbolicLink())
      fail(
        "unsafe_path",
        "Managed directories cannot contain links or non-directories.",
      );
  }
  return path;
}
export async function ninjaRead(path, { optional = false } = {}) {
  let handle;
  try {
    handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const s = await handle.stat();
    if (!s.isFile() || s.size > 8 * 1024 * 1024)
      fail("invalid_record", "Invalid managed record.");
    return JSON.parse(await handle.readFile("utf8"));
  } catch (e) {
    if (optional && e.code === "ENOENT") return null;
    throw e;
  } finally {
    await handle?.close();
  }
}
export async function ninjaWrite(path, value) {
  await ninjaDirectory(resolve(path, ".."));
  const tmp = path + "." + randomUUID() + ".tmp";
  const handle = await fs.open(tmp, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(value, null, 2) + "\n");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, path);
  const directory = await fs.open(resolve(path, ".."), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
async function projectLock(root, fn) {
  const path = join(root, "operation.lock");
  let handle;
  try {
    handle = await fs.open(path, "wx", 0o600);
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    const before = await fs.lstat(path);
    const owner = await ninjaRead(path);
    if (
      owner.host !== hostname() ||
      !Number.isSafeInteger(owner.pid) ||
      owner.pid <= 0
    )
      fail(
        "locked",
        "Project operation is locked; inspect its retained owner.",
      );
    let dead = false;
    try {
      process.kill(owner.pid, 0);
    } catch (err) {
      dead = err.code === "ESRCH";
    }
    if (!dead) fail("locked", "Another project operation is in progress.");
    const after = await fs.lstat(path);
    if (before.dev !== after.dev || before.ino !== after.ino)
      fail("locked", "Project lock ownership changed.");
    await fs.unlink(path);
    handle = await fs.open(path, "wx", 0o600);
  }
  const stat = await handle.stat();
  await handle.writeFile(
    JSON.stringify({ pid: process.pid, host: hostname(), nonce: randomUUID() }),
  );
  await handle.sync();
  try {
    return await fn();
  } finally {
    await handle.close();
    const now = await fs.lstat(path);
    if (now.dev !== stat.dev || now.ino !== stat.ino)
      fail(
        "cleanup_incomplete",
        "Project lock was replaced; retained for inspection.",
      );
    await fs.unlink(path);
  }
}
function publicReceipt(r) {
  return r
    ? {
        id: r.id,
        version: r.version,
        sourceSha256: r.sourceSha256,
        ...(r.historicalSnapshot ? { historicalSnapshot: true } : {}),
      }
    : null;
}
function retainsOwnPause(live, observation) {
  return (
    live.quiesced === true &&
    observation?.status === "available" &&
    live.busy === false &&
    live.dirty === false
  );
}

/** Trusted local dependencies are injected by the bootstrap CLI, never by HTTP input. */
export async function createNinjaManager({
  root,
  registration,
  provider,
  installer,
  supervisor,
  fault = async () => {},
  recover = true,
}) {
  if (!idPattern.test(registration?.projectId))
    fail("invalid_registration", "A stable project ID is required.");
  if (typeof registration.sourceRoot === "string") {
    const source = resolve(registration.sourceRoot),
      store = resolve(root);
    if (
      source === store ||
      source.startsWith(store + sep) ||
      store.startsWith(source + sep)
    )
      fail(
        "invalid_registration",
        "Managed store and authored project must be disjoint.",
      );
  }
  root = await ninjaDirectory(root, { create: true });
  const ownershipPath = join(root, ".ninja-project.json");
  await projectLock(root, async () => {
    const ownership = await ninjaRead(ownershipPath, { optional: true });
    if (ownership) {
      if (
        ownership.schemaVersion !== 1 ||
        ownership.kind !== "ninja-project-store" ||
        ownership.projectId !== registration.projectId
      )
        fail(
          "ownership_changed",
          "Managed store belongs to another project or format.",
        );
    } else {
      const entries = (await fs.readdir(root)).filter(
        (n) => n !== "operation.lock",
      );
      if (entries.length)
        fail(
          "unowned_store",
          "Refusing a nonempty store without Ninja-Update ownership.",
        );
      await ninjaWrite(ownershipPath, {
        schemaVersion: 1,
        kind: "ninja-project-store",
        projectId: registration.projectId,
        nonce: randomUUID(),
      });
    }
  });
  for (const name of ["installations", "downloads", "reports", "history"])
    await ninjaDirectory(join(root, name), { create: true });
  const statePath = join(root, "state.json"),
    journalPath = join(root, "transaction.json");
  const empty = {
    schemaVersion: 1,
    projectId: registration.projectId,
    generation: 0,
    current: null,
    previous: null,
    checkpoint: null,
    available: null,
    operation: null,
    phase: "idle",
    error: null,
  };
  async function read() {
    await assertOwnership();
    const s =
      (await ninjaRead(statePath, { optional: true })) ||
      structuredClone(empty);
    if (
      s.schemaVersion !== 1 ||
      s.projectId !== registration.projectId ||
      !Number.isSafeInteger(s.generation)
    )
      fail("invalid_record", "Project state identity is incompatible.");
    return s;
  }
  const rootIdentity = await fs.lstat(root);
  const ownership = await ninjaRead(ownershipPath);
  async function assertOwnership() {
    const current = await fs.lstat(root);
    if (
      current.dev !== rootIdentity.dev ||
      current.ino !== rootIdentity.ino ||
      current.isSymbolicLink() ||
      !isDeepStrictEqual(await ninjaRead(ownershipPath), ownership)
    )
      fail(
        "ownership_changed",
        "Managed project store was replaced; retained for inspection.",
      );
  }
  async function mutate(fn) {
    await assertOwnership();
    return projectLock(root, async () => {
      await assertOwnership();
      return fn();
    });
  }
  async function save(s) {
    await assertOwnership();
    await ninjaWrite(statePath, s);
  }
  function slot(id) {
    if (!idPattern.test(id)) fail("invalid_record", "Invalid installation ID.");
    return join(root, "installations", id);
  }
  async function receipt(id, checkSource = false) {
    return id
      ? installer.verify(slot(id), { registration, checkSource })
      : null;
  }
  async function view() {
    const s = await read();
    const live = await supervisor.status();
    const selected = s.current ? publicReceipt(await receipt(s.current)) : null;
    if (selected && s.historicalSnapshot) selected.historicalSnapshot = true;
    const blockers = [];
    const observation = safeObservation(live.observation);
    if (observation?.error) blockers.push(observation.error);
    if (live.busy || (live.paused && !retainsOwnPause(live, observation)))
      blockers.push({
        code: "busy",
        message: "Finish the active or paused run before restarting.",
      });
    if (live.dirty !== false)
      blockers.push({
        code: live.dirty === true ? "dirty_draft" : "draft_unknown",
        message:
          live.dirty === true
            ? "Save or discard browser drafts before restarting."
            : "Current draft safety is unknown. Obtain a fresh measurement before restarting.",
      });
    if (live.cleanupPending)
      blockers.push({
        code: "cleanup_incomplete",
        message: "Owned resources still require cleanup.",
      });
    return {
      project: {
        id: registration.projectId,
        label: registration.label || registration.projectId,
      },
      generation: s.generation,
      selected,
      running: publicReceipt(live.running),
      dirty: typeof live.dirty === "boolean" ? live.dirty : null,
      ...(observation ? { observation } : {}),
      phase: s.phase,
      available: s.available
        ? { id: s.available.id, version: s.available.version }
        : null,
      operation: s.operation
        ? { id: s.operation.id, status: s.operation.status }
        : null,
      canRollback: !!s.previous,
      blockers,
      error: s.error,
    };
  }
  async function recordError(s, e) {
    s.phase = e.cleanupFailed ? "recovery_required" : "failed";
    s.error = { code: e.code || "operation_failed", message: e.message };
    await save(s);
  }
  async function retainedKit(current, id) {
    if (
      !idPattern.test(current.version ?? "") ||
      current.release?.version !== current.version ||
      !/^[a-f0-9]{64}$/.test(current.release?.manifestSha256 ?? "")
    )
      fail(
        "invalid_installation",
        "The accepted installation lacks a verified retained release identity.",
      );
    const relative = `daedlo-${current.version}`;
    const source = join(root, "downloads", current.id, relative, "bundle");
    let verified;
    try {
      await ninjaDirectory(source);
      verified = await verifyBundle(source, {
        expectedManifestSha256: current.release.manifestSha256,
      });
    } catch (e) {
      if (e.code === "ENOENT")
        fail(
          "retained_bundle_missing",
          "The accepted release bundle is no longer retained. Restore its exact verified bytes before refreshing; no newer release was downloaded.",
        );
      fail(
        "retained_bundle_invalid",
        `The accepted retained release bundle failed verification: ${e.message}`,
      );
    }
    if (
      verified.manifest.version !== current.version ||
      verified.manifest.source.dirty
    )
      fail("invalid_installation", "Retained release identity changed.");
    // Keep the canonical retained-bundle layout for every new installation so
    // subsequent refreshes do not depend on another slot's download lifetime.
    const download = join(root, "downloads", id);
    await fs.mkdir(download, { mode: 0o700 });
    const bundlePath = join(download, relative, "bundle");
    await ninjaDirectory(bundlePath, { create: true });
    const entries = [
      ["manifest.json", 64 * 1024],
      ["SHA256SUMS", 4096],
      ...Object.values(verified.manifest.artifacts).map((a) => [
        a.file,
        a.bytes,
      ]),
    ];
    for (const [file, maximum] of entries) {
      const handle = await fs.open(
        join(source, file),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > maximum)
          fail("invalid_record", "Retained release entry changed.");
        const bytes = await handle.readFile();
        if (bytes.length > maximum)
          fail("invalid_record", "Retained release entry changed.");
        await fs.writeFile(join(bundlePath, file), bytes, {
          flag: "wx",
          mode: 0o600,
        });
      } finally {
        await handle.close();
      }
    }
    await verifyBundle(bundlePath, {
      expectedManifestSha256: current.release.manifestSha256,
    });
    return { bundlePath, identity: structuredClone(current.release) };
  }
  async function prepareCandidate(s, id, kit, expectedRelease) {
    s.phase = "validating";
    await save(s);
    const installed = await installer.prepare({
      registration,
      verifiedKit: kit,
      destination: slot(id),
    });
    if (installed.id !== id)
      fail(
        "invalid_installation",
        "Installation identity does not match its owned slot.",
      );
    if (
      expectedRelease &&
      (installed.version !== expectedRelease.version ||
        !isDeepStrictEqual(installed.release, expectedRelease))
    )
      fail(
        "invalid_installation",
        "Refresh must retain the accepted exact release identity.",
      );
    const current = await receipt(s.current);
    if (
      current &&
      !isDeepStrictEqual(
        current.handshake?.descriptor,
        installed.handshake?.descriptor,
      )
    )
      fail(
        "migration_required",
        "Candidate changes the accepted states, commands or flows.",
      );
    s.operation = { id, status: "ready", expectedCurrent: s.current };
    s.phase = "ready";
    await save(s);
    return view();
  }
  async function recoverJournal() {
    const journal = await ninjaRead(journalPath, { optional: true });
    if (!journal || ["committed", "recovered"].includes(journal.phase)) return;
    if (
      journal.schemaVersion !== 1 ||
      !idPattern.test(journal.id) ||
      !idPattern.test(journal.target) ||
      !["activate", "rollback"].includes(journal.kind) ||
      !["prepared", "booting"].includes(journal.phase) ||
      !journal.before ||
      ![journal.before.current, journal.before.previous].every(
        (v) => v === null || idPattern.test(v),
      )
    )
      fail(
        "invalid_record",
        "Invalid recovery transaction; inspection required.",
      );
    const live = await supervisor.status();
    if (live.running || live.cleanupPending)
      fail(
        "recovery_required",
        "Previous driver cleanup must complete before recovery.",
      );
    if (journal.before.current) await receipt(journal.before.current);
    const s = await read();
    Object.assign(s, journal.before, {
      phase: "recovered",
      operation: null,
      error: null,
      generation: s.generation + 1,
    });
    await save(s);
    await ninjaWrite(journalPath, { ...journal, phase: "recovered" });
    await ninjaWrite(join(root, "history", journal.id + ".json"), {
      ...journal,
      phase: "recovered",
    });
  }
  if (recover) await mutate(recoverJournal);
  async function switchTo(
    s,
    target,
    { rollback = false, acknowledgeRestart } = {},
  ) {
    if (acknowledgeRestart !== true)
      fail("restart_required", "Explicit restart acknowledgment is required.");
    const candidate = await receipt(target, !rollback);
    const live = await supervisor.status();
    const observation = safeObservation(live.observation);
    if (observation?.error)
      fail(observation.error.code, observation.error.message);
    if (live.busy || (live.paused && !retainsOwnPause(live, observation)))
      fail("busy", "Active or paused run blocks the safe boundary.");
    if (live.dirty !== false)
      fail(
        live.dirty === true ? "dirty_draft" : "draft_unknown",
        live.dirty === true
          ? "Unsaved draft state blocks the safe boundary."
          : "Unknown draft state blocks the safe boundary.",
      );
    if (live.cleanupPending)
      fail("cleanup_incomplete", "Owned resource cleanup is incomplete.");
    const id = randomUUID();
    const before = {
      current: s.current,
      previous: s.previous,
      historicalSnapshot: s.historicalSnapshot === true,
    };
    const journal = {
      schemaVersion: 1,
      id,
      kind: rollback ? "rollback" : "activate",
      before,
      target,
      phase: "prepared",
    };
    await supervisor.quiesce();
    try {
      if (live.running) {
        const report = await supervisor.report();
        await ninjaWrite(join(root, "reports", id + ".json"), report);
      }
    } catch (e) {
      await supervisor.unquiesce?.();
      throw e;
    }
    try {
      const cleanup = await supervisor.close({ requireSafe: true });
      if (live.running && cleanup?.report)
        await ninjaWrite(join(root, "reports", id + ".json"), cleanup.report);
    } catch (e) {
      e.cleanupFailed = ![
        "dirty_draft",
        "draft_unknown",
        "busy",
        "observation_failed",
      ].includes(e.code);
      if (e.cleanupFailed) await recordError(s, e);
      throw e;
    }
    await receipt(target, !rollback);
    await ninjaWrite(journalPath, journal);
    await fault("journal_prepared");
    try {
      s.current = target;
      s.previous = before.current;
      s.historicalSnapshot = rollback;
      s.phase = "activating";
      s.error = null;
      s.generation++;
      await save(s);
      await fault("selection_written");
      journal.phase = "booting";
      await ninjaWrite(journalPath, journal);
      await supervisor.start(candidate);
      await fault("candidate_started");
      const started = await supervisor.status();
      if (
        started.running?.id !== candidate.id ||
        started.busy ||
        started.cleanupPending
      )
        fail("boot_failed", "Selected installation did not become ready.");
      s.phase = rollback ? "rolled_back" : "updated";
      s.operation = null;
      s.available = null;
      await save(s);
      journal.phase = "committed";
      await ninjaWrite(journalPath, journal);
      await ninjaWrite(join(root, "history", id + ".json"), journal);
      await supervisor.accept?.();
    } catch (e) {
      if (e.simulatedCrash) throw e;
      if (journal.phase === "committed") {
        e.cleanupFailed = true;
        await recordError(s, e);
        throw e;
      }
      try {
        await supervisor.close();
        Object.assign(s, before, {
          generation: s.generation + 1,
          operation: null,
        });
        await save(s);
        if (before.current) {
          await supervisor.start(await receipt(before.current));
          await supervisor.accept?.();
        }
        journal.phase = "recovered";
        await ninjaWrite(journalPath, journal);
        await ninjaWrite(join(root, "history", id + ".json"), journal);
      } catch (recoveryError) {
        e.cleanupFailed = true;
        e.recoveryError = recoveryError.message;
        Object.assign(s, before, { operation: null });
        await save(s);
      }
      await recordError(s, e);
      throw e;
    }
    return view();
  }
  return {
    status: view,
    async check() {
      return mutate(async () => {
        await recoverJournal();
        const s = await read();
        s.available = null;
        await save(s);
        try {
          const result = await provider.check({
            previousState: s.checkpoint,
            currentVersion: (await receipt(s.current))?.version || null,
          });
          s.checkpoint = result.checkpoint;
          s.available = result.available || null;
          s.error = result.error || null;
          s.phase =
            s.operation?.status === "ready"
              ? "ready"
              : s.error
                ? "failed"
                : s.available
                  ? "available"
                  : "idle";
          await save(s);
          return view();
        } catch (e) {
          if (s.operation?.status === "ready") {
            s.error = {
              code: e.code || "operation_failed",
              message: e.message,
            };
            s.phase = "ready";
            await save(s);
          } else await recordError(s, e);
          throw e;
        }
      });
    },
    async prepare(releaseId) {
      return mutate(async () => {
        await recoverJournal();
        const s = await read();
        if (!s.available || releaseId !== s.available.id)
          fail(
            "stale_operation",
            "Check again before installing this release.",
          );
        const id = randomUUID();
        s.operation = { id, status: "preparing", expectedCurrent: s.current };
        s.phase = "preparing";
        s.error = null;
        await save(s);
        try {
          const kit = await provider.download(
            s.available,
            join(root, "downloads", id),
          );
          return await prepareCandidate(s, id, kit);
        } catch (e) {
          s.operation = { id, status: "failed", expectedCurrent: s.current };
          await recordError(s, e);
          throw e;
        }
      });
    },
    async refresh() {
      return mutate(async () => {
        await recoverJournal();
        const s = await read();
        if (!s.current)
          fail(
            "not_installed",
            "Refresh requires an accepted installation; prepare and activate it first.",
          );
        const current = await receipt(s.current);
        const id = randomUUID();
        s.operation = { id, status: "preparing", expectedCurrent: s.current };
        s.phase = "preparing";
        s.error = null;
        await save(s);
        try {
          const kit = await retainedKit(current, id);
          return await prepareCandidate(s, id, kit, current.release);
        } catch (e) {
          s.operation = { id, status: "failed", expectedCurrent: s.current };
          await recordError(s, e);
          throw e;
        }
      });
    },
    async activate(operationId, options) {
      return mutate(async () => {
        await recoverJournal();
        const s = await read();
        if (
          s.operation?.id !== operationId ||
          s.operation.status !== "ready" ||
          s.operation.expectedCurrent !== s.current
        )
          fail(
            "stale_operation",
            "Prepared operation no longer matches the current installation.",
          );
        return switchTo(s, operationId, options);
      });
    },
    async rollback(options) {
      return mutate(async () => {
        await recoverJournal();
        const s = await read();
        if (!s.previous)
          fail(
            "no_rollback",
            "No previous complete installation is available.",
          );
        return switchTo(s, s.previous, { ...options, rollback: true });
      });
    },
    async start() {
      return mutate(async () => {
        await recoverJournal();
        const s = await read();
        if (!s.current)
          fail(
            "not_installed",
            "Prepare and activate the initial installation first.",
          );
        if ((await supervisor.status()).running)
          fail("busy", "An installation is already running.");
        await supervisor.start(await receipt(s.current, !s.historicalSnapshot));
        await supervisor.accept?.();
        return view();
      });
    },
    async close() {
      return mutate(async () => {
        const live = await supervisor.status();
        const observation = safeObservation(live.observation);
        if (observation?.error)
          fail(observation.error.code, observation.error.message);
        if (live.dirty !== false)
          fail(
            live.dirty === true ? "dirty_draft" : "draft_unknown",
            "Current draft state blocks safe cleanup.",
          );
        if (live.busy || (live.paused && !retainsOwnPause(live, observation)))
          fail("busy", "Finish runs and drafts before closing the manager.");
        await supervisor.quiesce();
        const reportPath = join(root, "reports", randomUUID() + ".json");
        try {
          if (live.running)
            await ninjaWrite(reportPath, await supervisor.report());
        } catch (e) {
          await supervisor.unquiesce?.();
          throw e;
        }
        const cleanup = await supervisor.close({ requireSafe: true });
        if (live.running && cleanup?.report)
          await ninjaWrite(reportPath, cleanup.report);
      });
    },
  };
}
