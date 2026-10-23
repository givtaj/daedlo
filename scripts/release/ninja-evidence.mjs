import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { ninjaDirectory, ninjaWrite } from "./ninja-manager.mjs";

/** Archive the existing runtime's completed reports without changing run outcomes. */
export function createNinjaEvidence({ root, installation }) {
  const directory = resolve(root);
  const retained = new Map();
  let queue = Promise.resolve();
  let lastRunId = null;
  const identity = structuredClone({
    id: installation.id,
    version: installation.version,
    sourceSha256: installation.sourceSha256,
    model: installation.model,
  });
  function status() {
    const pending = [...retained.values()].filter(
      (item) => item.pending,
    ).length;
    const failed = retained.size - pending;
    return {
      directory,
      pending,
      failed,
      lastRunId,
      ...(failed
        ? {
            error: {
              code: "evidence_incomplete",
              message:
                "Completed-run evidence could not be saved. Repair the local archive and retry evidence before continuing.",
            },
          }
        : {}),
    };
  }
  function fail(code, message) {
    const error = Error(message);
    error.code = code;
    throw error;
  }
  function capture(item) {
    const report = item.read();
    if (
      report?.format !== "browser-driver-report/1" ||
      report.runId !== item.runId ||
      report.lastResult?.runId !== item.runId
    )
      fail("evidence_incomplete", "The completed run report is unavailable.");
    item.report = structuredClone(report);
    item.read = null;
  }
  function enqueue(item) {
    item.pending = true;
    queue = queue.then(async () => {
      try {
        if (!item.report) capture(item);
        await ninjaDirectory(directory, { create: true });
        await ninjaWrite(join(directory, `${item.id}.json`), {
          schemaVersion: 1,
          kind: "daedlo-managed-run",
          installation: identity,
          recordedAt: item.recordedAt,
          report: item.report,
        });
        retained.delete(item.runId);
        lastRunId = item.runId;
      } catch {
        // Retain the detached report and its filename for an explicit retry.
        // Filesystem errors must never rewrite the application's effect/result.
        item.pending = false;
      }
    });
    return queue;
  }
  return {
    status,
    assertCanRun() {
      const current = status();
      if (current.failed) fail("evidence_incomplete", current.error.message);
      if (current.pending)
        fail(
          "evidence_pending",
          "The previous completed-run evidence is still being saved.",
        );
    },
    retain(result, read) {
      // Immediate refusals are not runs and have no completed report.
      if (typeof result?.runId !== "string" || !result.runId)
        return Promise.resolve();
      if (retained.has(result.runId) || lastRunId === result.runId)
        return queue;
      const item = {
        id: randomUUID(),
        runId: result.runId,
        recordedAt: new Date().toISOString(),
        read,
      };
      retained.set(item.runId, item);
      try {
        // Copy synchronously when the run promise settles, before another run
        // can evict it from the runtime's bounded in-memory archive.
        capture(item);
      } catch {
        item.pending = false;
        return Promise.resolve();
      }
      return enqueue(item);
    },
    async drain() {
      await queue;
      const current = status();
      if (current.failed) fail("evidence_incomplete", current.error.message);
    },
    async retry() {
      await queue;
      for (const item of retained.values()) enqueue(item);
      await queue;
      return status();
    },
  };
}
