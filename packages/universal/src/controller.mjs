import { loadTools } from "./tools.mjs";
import { assertTargetRegistration } from "./registration.mjs";
import { isDeepStrictEqual } from "node:util";

const fail = (code, message, extra = {}) => {
  throw Object.assign(Error(message), { code, ...extra });
};

export function createTargetController({
  root,
  catalog,
  nativeCommand,
  toolsLoader = loadTools,
}) {
  const owned = new Map(),
    busy = new Set();
  let closing = false,
    closed = false;
  return {
    async launch(targetId, { revision } = {}) {
      if (closed || closing || busy.has(targetId))
        fail(
          "operation_busy",
          "This target operation is unavailable while another operation completes.",
        );
      busy.add(targetId);
      try {
        const target = await catalog.getTarget(targetId);
        if (target.revision !== revision)
          fail(
            "target_changed",
            "Target registration changed; reload it before launching.",
          );
        const captured = await assertTargetRegistration(target, root);
        const assertCurrent = async () => {
          if (!isDeepStrictEqual(await catalog.getTarget(targetId), target))
            fail(
              "target_changed",
              "Target registration changed; reload it before launching.",
            );
        };
        await assertCurrent();
        const ninja = await toolsLoader("ninja");
        const guardedRead = async (path, options) => {
          if (path !== target.configPath)
            fail(
              "target_changed",
              "The requested configuration differs from the registered target.",
            );
          const actual = await ninja.readNinjaConfig(path, options);
          // Validate the object native/openNinja will actually consume. A guard
          // followed by an independent path read leaves a configuration race.
          if (!isDeepStrictEqual(actual.config, captured.config))
            fail(
              "target_changed",
              "Target configuration changed; review it before launching.",
            );
          await assertTargetRegistration(target, root);
          await assertCurrent();
          return actual;
        };
        const installationGuard = async (candidate) => {
          if (
            candidate?.sourceSha256 !== target.sourceSha256 ||
            !isDeepStrictEqual(candidate?.model, target.model)
          )
            fail(
              "target_changed",
              "The selected installation differs from this target's registered source or model.",
            );
          await assertTargetRegistration(target, root);
          await assertCurrent();
        };
        const command =
          nativeCommand ?? (await toolsLoader("native")).nativeCommand;
        const handle = await command("start", target.configPath, {
          readConfig: guardedRead,
          open: (path, options) =>
            ninja.openNinja(path, {
              ...options,
              readConfig: guardedRead,
              installationGuard,
            }),
        });
        if (typeof handle.close === "function") {
          const handles = owned.get(targetId) ?? new Set();
          handles.add(handle);
          owned.set(targetId, handles);
          handle.closed
            ?.then(() => {
              handles.delete(handle);
              if (handles.size === 0 && owned.get(targetId) === handles)
                owned.delete(targetId);
            })
            .catch(() => {});
        }
        // Reconnecting skips installation startup, so validate its observed
        // running identity too. Retain any owned handle before this can refuse.
        if (
          handle.result.viewerUrl &&
          handle.result.running?.sourceSha256 !== target.sourceSha256
        )
          fail(
            "target_changed",
            "The running installation differs from this target's registered source.",
          );
        return {
          status: handle.result.status,
          viewerUrl: handle.result.viewerUrl ?? null,
          reused: handle.result.reused === true,
        };
      } finally {
        busy.delete(targetId);
      }
    },
    async close() {
      if (closed) return;
      if (closing || busy.size)
        fail(
          "operation_busy",
          "Wait for pending target startup before closing Universal.",
        );
      closing = true;
      const pending = [];
      try {
        for (const [id, handles] of [...owned].reverse()) {
          for (const handle of [...handles].reverse()) {
            try {
              await handle.close();
              handles.delete(handle);
            } catch {
              if (!pending.includes(id)) pending.push(id);
            }
          }
          if (!handles.size && owned.get(id) === handles) owned.delete(id);
        }
        if (pending.length)
          fail(
            "cleanup_incomplete",
            "Some owned targets still need guarded cleanup. Their handles are retained; close can be retried.",
            { cleanupFailed: true, pendingTargets: pending },
          );
        closed = true;
      } finally {
        closing = false;
      }
    },
  };
}
