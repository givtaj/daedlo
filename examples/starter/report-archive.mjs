import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isAbsolute, join, parse, resolve, sep } from "node:path";

const failure = (code, message) => Object.assign(new Error(message), { code });

// This is a custom-runner example, not a replacement for native managed
// archiving. The caller must route every action through run(), inspect status(),
// and keep this owner alive while a failed capture is pending.
export function createReportArchive({ directory }) {
  if (typeof directory !== "string" || !isAbsolute(directory))
    throw failure(
      "invalid_archive",
      "Select an absolute private archive directory.",
    );
  directory = resolve(directory);
  let busy = false,
    pending = null,
    saved = 0;
  const status = () => ({
    busy,
    pending: pending !== null,
    saved,
    ...(pending
      ? {
          error: {
            code: "evidence_incomplete",
            message:
              "Completed-run evidence is not safely archived. Repair storage and retry evidence before another action.",
          },
        }
      : {}),
  });

  async function privateDirectory() {
    // Reject symlink traversal before creating a child directory. Existing
    // ancestor permissions are not changed; the selected archive must be private.
    let path = parse(directory).root;
    for (const part of directory
      .slice(path.length)
      .split(sep)
      .filter(Boolean)) {
      path = join(path, part);
      let entry;
      try {
        entry = await fs.lstat(path);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        await fs.mkdir(path, { mode: 0o700 });
        entry = await fs.lstat(path);
      }
      if (!entry.isDirectory() || entry.isSymbolicLink())
        throw failure(
          "invalid_archive",
          "Archive path must contain only real directories.",
        );
    }
    const entry = await fs.lstat(directory);
    if ((entry.mode & 0o077) !== 0)
      throw failure(
        "invalid_archive",
        "Archive directory must be private to its owner.",
      );
  }

  async function removeTemporary(item) {
    if (!item.temporary) return;
    const entry = await fs.lstat(item.temporary).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (
      entry &&
      (entry.dev !== item.temporaryIdentity.dev ||
        entry.ino !== item.temporaryIdentity.ino ||
        !entry.isFile() ||
        entry.isSymbolicLink())
    )
      throw failure(
        "archive_cleanup",
        "Owned archive temporary file was replaced.",
      );
    if (entry) await fs.unlink(item.temporary);
    item.temporary = null;
  }

  async function persist() {
    const item = pending;
    if (!item?.bytes) return;
    try {
      await privateDirectory();
      await removeTemporary(item);
      item.temporary = join(directory, `.${item.runId}.${randomUUID()}.tmp`);
      const handle = await fs.open(item.temporary, "wx", 0o600);
      item.temporaryIdentity = await handle.stat();
      try {
        await handle.writeFile(item.bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      const destination = join(directory, `${item.runId}.json`);
      try {
        await fs.link(item.temporary, destination);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        const entry = await fs.lstat(destination);
        if (
          !entry.isFile() ||
          entry.isSymbolicLink() ||
          (entry.mode & 0o077) !== 0 ||
          (await fs.readFile(destination, "utf8")) !== item.bytes
        )
          throw failure(
            "archive_conflict",
            "Existing immutable report differs from the captured run.",
          );
      }
      await removeTemporary(item);
      pending = null;
      saved++;
    } catch {
      // Keep the captured bytes and any failed cleanup handle. Do not change the
      // observed application result and do not replay its action during retry.
    }
  }

  return {
    status,
    async run(session, action) {
      if (busy)
        throw failure(
          "evidence_busy",
          "Another action or evidence save is still active.",
        );
      if (pending) throw failure("evidence_incomplete", status().error.message);
      if (typeof session?.report !== "function" || typeof action !== "function")
        throw failure(
          "invalid_capture",
          "Supply a session and an action function.",
        );
      busy = true;
      try {
        const result = await action();
        if (typeof result?.runId !== "string" || !result.runId) return result;
        pending = { runId: result.runId, bytes: null, temporary: null };
        try {
          const report = session.report({ runId: result.runId });
          if (
            !/^[A-Za-z0-9_-]{1,128}$/.test(result.runId) ||
            report?.format !== "browser-driver-report/1" ||
            report.runId !== result.runId ||
            report.lastResult?.runId !== result.runId
          )
            throw failure(
              "report_unavailable",
              "The canonical completed report is unavailable.",
            );
          // Capture before awaiting filesystem I/O or allowing another action.
          pending.bytes = JSON.stringify(report, null, 2) + "\n";
          await persist();
        } catch {
          /* Keep the missing-report condition visible and blocking. */
        }
        return result;
      } finally {
        busy = false;
      }
    },
    async retry() {
      if (busy)
        throw failure(
          "evidence_busy",
          "An action or evidence save is still active.",
        );
      busy = true;
      try {
        await persist();
      } finally {
        busy = false;
      }
      return status();
    },
  };
}
