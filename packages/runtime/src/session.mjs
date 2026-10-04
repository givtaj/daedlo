import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { createEngineClient } from "./engine-client.mjs";
import { validateDescriptor, validateParams } from "./catalog.mjs";
import { DriverError, reject } from "./errors.mjs";
import { executableHash, runtimeIdentity } from "./identity.mjs";
import { publicEffectReport } from "./effects.mjs";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const speeds = {
  slow: { move: 18, key: 55, wait: 220 },
  normal: { move: 8, key: 22, wait: 65 },
  fast: { move: 1, key: 0, wait: 0 },
};
const publicError = (error) =>
  error instanceof DriverError
    ? { error_code: error.code, error: error.message }
    : {
        error_code: "adapter_error",
        error:
          "Application adapter failed. Inspect its private local diagnostics.",
      };

export async function createDriverSession({
  page,
  context,
  enginePath,
  adapter,
  identity = {},
  resources,
}) {
  if (!page || !adapter || typeof adapter.observe !== "function")
    reject(
      "invalid_adapter",
      "A browser page and observation adapter are required.",
    );
  const buildIdentity = {
    ...runtimeIdentity(),
    engineSha256: executableHash(enginePath),
  };
  const engine = createEngineClient(enginePath);
  let descriptor;
  const checked = (r) => {
    if (!r.ok)
      reject(
        r.error_code ?? "model_error",
        r.error ?? "Model rejected the operation.",
      );
    return r;
  };
  try {
    descriptor = validateDescriptor(
      checked(await engine.request({ op: "hello" })).descriptor,
      adapter,
    );
  } catch (error) {
    await engine.close();
    throw error;
  }
  const commands = new Map(descriptor.commands.map((c) => [c.id, c]));
  let busy = false,
    paused = false,
    stopping = false,
    closed = false,
    closing = false,
    speed = "normal",
    execution = "idle",
    runId = null,
    lastResult = null,
    active = null,
    closePromise;
  const completedCleanup = new Set();
  let progress = { step: 0, total: 0, lastAction: null },
    lastState = null;
  const waiters = new Set(),
    events = [],
    completedRuns = new Map();
  const emit = (type, detail = {}) => {
    events.push({
      sequence: (events.at(-1)?.sequence ?? 0) + 1,
      at: new Date().toISOString(),
      runId,
      type,
      ...detail,
    });
    if (events.length > 200) events.shift();
  };
  const wake = () => {
    for (const resolve of waiters) resolve();
    waiters.clear();
  };
  async function raw() {
    if (closed || page.isClosed?.() || !engine.connected())
      reject("disconnected", "Browser or engine is disconnected.");
    let observation;
    try {
      observation = await adapter.observe();
    } catch (error) {
      if (error instanceof DriverError) throw error;
      reject("observation_failed", "Application observation is unavailable.");
    }
    if (
      !observation ||
      typeof observation.connected !== "boolean" ||
      typeof observation.session !== "string" ||
      !observation.facts ||
      typeof observation.facts !== "object" ||
      Array.isArray(observation.facts)
    )
      reject(
        "invalid_observation",
        "Adapter returned an invalid observation envelope.",
      );
    return structuredClone(observation);
  }
  async function inspect(observation) {
    const r = checked(await engine.request({ op: "observe", observation }));
    if (
      !descriptor.states.some(
        (s) => s.id === r.state?.id && s.support === "supported",
      ) ||
      typeof r.fingerprint !== "string"
    )
      reject("unknown_state", "The model did not observe a supported state.");
    for (const choice of r.commands ?? [])
      if (!commands.has(choice.id))
        reject("invalid_catalog", "Engine advertised an unknown command.");
    lastState = {
      connected: observation.connected,
      state: r.state,
      revision: r.fingerprint,
      commands: r.commands ?? [],
      recipes: r.recipes ?? [],
      display: r.display ?? [],
    };
    return { observation, response: r };
  }
  async function read() {
    return inspect(await raw());
  }
  const base = () => ({
    descriptor: structuredClone(descriptor),
    execution,
    busy,
    paused,
    speed,
    runId,
    progress: { ...progress },
    lastResult: structuredClone(lastResult),
    identity: {
      ...identity,
      ...buildIdentity,
      protocol: 1,
      model: { id: descriptor.id, version: descriptor.version },
    },
  });
  async function snapshot() {
    try {
      await read();
      return { ...lastState, ...base() };
    } catch (error) {
      return {
        ...base(),
        connected: false,
        state: null,
        revision: null,
        commands: [],
        recipes: [],
        display: [],
        ...publicError(error),
      };
    }
  }
  async function boundary() {
    if (stopping || closed) reject("stopped", "Stopped at an action boundary.");
    while (paused) {
      execution = "paused";
      await new Promise((resolve) => waiters.add(resolve));
      if (stopping || closed)
        reject("stopped", "Stopped at an action boundary.");
    }
    execution = "running";
  }
  async function authorize(id, params, expected, boundSession) {
    await boundary();
    const observation = await raw();
    if (boundSession !== undefined && observation.session !== boundSession)
      reject(
        "session_changed",
        "Application session changed; execution cannot continue.",
      );
    const authorized = checked(
      await engine.request({
        op: "command",
        observation,
        fingerprint: expected,
        command: id,
        params,
      }),
    );
    if (!isDeepStrictEqual(authorized.action, { id, params }))
      reject(
        "invalid_action",
        "Engine authorization does not match the requested command and parameters.",
      );
    return observation;
  }
  async function perform(id, params, revision, boundSession, onEffect) {
    const c = commands.get(id);
    let before = await authorize(id, params, revision, boundSession),
      expected = revision;
    const originalSession = before.session;
    let actionSession = originalSession;
    const currentCheck = () =>
      authorize(id, params, expected, boundSession ?? actionSession);
    async function effect(fn) {
      await boundary();
      await currentCheck();
      onEffect();
      emit("effect_started", { command: id });
      await fn();
      const next = await read();
      expected = next.response.fingerprint;
      if (
        (boundSession !== undefined &&
          next.observation.session !== boundSession) ||
        (!c.changesSession && next.observation.session !== originalSession)
      )
        reject(
          "session_changed",
          "Application session changed during the action.",
        );
      actionSession = next.observation.session;
      emit("effect_finished", { command: id });
    }
    async function move(locator) {
      await boundary();
      await currentCheck();
      if (locator.scrollIntoViewIfNeeded)
        await locator.scrollIntoViewIfNeeded();
      const box = await locator.boundingBox?.();
      if (box && page.mouse)
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
          steps: speeds[speed].move,
        });
      await delay(speeds[speed].wait);
      // A human edit during visible motion or pause must invalidate the click.
      await boundary();
      await currentCheck();
    }
    const x = {
      boundary,
      effect,
      click: async (locator) => {
        await move(locator);
        await effect(() => locator.click({ timeout: 12000 }));
      },
      fill: async (locator, value) => {
        await move(locator);
        await effect(() => locator.fill(String(value), { timeout: 12000 }));
      },
      select: async (locator, value) => {
        await move(locator);
        await effect(() => locator.selectOption(value, { timeout: 12000 }));
      },
      press: async (locator, key) => {
        await move(locator);
        await effect(() => locator.press(key, { timeout: 12000 }));
      },
      getSpeed: () => speed,
    };
    await adapter.handlers[id](params, x);
    if (adapter.settle) await adapter.settle();
    await boundary();
    const after = await raw();
    if (after.session !== originalSession && !c.changesSession)
      reject(
        "session_changed",
        "Application session changed during verification.",
      );
    let evidence = {};
    if (adapter.evidence) evidence = await adapter.evidence(id, before, after);
    const verification = checked(
      await engine.request({
        op: "verify",
        before,
        observation: after,
        command: id,
        params,
        evidence: evidence ?? {},
      }),
    );
    if (
      !["success", "validation", "recoverable_error", "unknown"].includes(
        verification.outcome?.kind,
      )
    )
      reject("invalid_outcome", "Engine returned an unsupported outcome.");
    emit("verified", { command: id, outcome: verification.outcome.kind });
    // Carry the exact verified observation into the next recipe step. Reading
    // the browser again here could silently adopt an intervening human edit.
    const verified = await inspect(after);
    return {
      outcome: verification.outcome,
      revision: verified.response.fingerprint,
      session: after.session,
    };
  }
  async function effectReport(attempted) {
    if (!attempted) return { status: "not_attempted" };
    if (adapter.effectStatus) {
      try {
        return publicEffectReport(await adapter.effectStatus());
      } catch {}
    }
    return { status: attempted ? "uncertain" : "not_attempted" };
  }
  function start(id, params, revision, recipe) {
    // Unknown user input is not public command metadata.
    const command = (
      recipe ? descriptor.recipes.some((r) => r.id === id) : commands.has(id)
    )
      ? id
      : null;
    const startedAt = new Date().toISOString();
    const refused = (code, message) => ({
      ok: false,
      execution: "rejected",
      error_code: code,
      error: message,
      effect: { status: "not_attempted" },
      command,
      recipe,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
    if (closed || closing)
      return Promise.resolve(refused("closed", "Driver is closed or closing."));
    if (busy)
      return Promise.resolve(refused("busy", "Another command is running."));
    if (paused)
      return Promise.resolve(
        refused("paused", "Resume before starting a command."),
      );
    if (typeof revision !== "string" || !revision)
      return Promise.resolve(
        refused("revision_required", "An observed revision is required."),
      );
    busy = true;
    stopping = false;
    execution = "running";
    runId = randomUUID();
    progress = { step: 0, total: 1, lastAction: null };
    emit("run_started", { command, recipe });
    const firstEvent = events.at(-1).sequence;
    const runIdentity = structuredClone(base().identity);
    active = (async () => {
      let attempted = false;
      try {
        if (adapter.beginRun)
          await adapter.beginRun({ runId, command: id, recipe });
        let outcome;
        if (recipe) {
          const initial = await raw();
          const plan = checked(
            await engine.request({
              op: "recipe",
              observation: initial,
              fingerprint: revision,
              recipe: id,
            }),
          ).plan;
          const canonical = descriptor.recipes
            .find((r) => r.id === id)
            ?.steps.map((step) => ({
              command: step.command,
              params: validateParams(commands.get(step.command), step.params),
            }));
          if (!canonical || !isDeepStrictEqual(plan, canonical))
            reject(
              "invalid_recipe",
              "Engine plan differs from its declared recipe.",
            );
          const session = initial.session;
          progress.total = plan.length;
          let expected = revision;
          for (const [index, step] of plan.entries()) {
            await boundary();
            const command = commands.get(step.command);
            const values = validateParams(command, step.params);
            progress.step = index;
            progress.lastAction = step.command;
            const result = await perform(
              step.command,
              values,
              expected,
              session,
              () => (attempted = true),
            );
            outcome = result.outcome;
            if (outcome.kind !== "success") break;
            progress.step = index + 1;
            expected = result.revision;
            if (result.session !== session)
              reject(
                "session_changed",
                "Recipe cannot continue in another session.",
              );
          }
        } else {
          const command = commands.get(id);
          if (!command) reject("unknown_command", "Unknown command.");
          const values = validateParams(command, params);
          progress.lastAction = id;
          outcome = (
            await perform(
              id,
              values,
              revision,
              undefined,
              () => (attempted = true),
            )
          ).outcome;
          progress.step = 1;
        }
        execution = "completed";
        lastResult = {
          ok: true,
          execution,
          runId,
          outcome,
          effect: await effectReport(attempted),
        };
        emit("run_completed", { outcome: outcome.kind });
      } catch (error) {
        execution =
          error?.code === "stopped"
            ? "stopped"
            : attempted
              ? "failed"
              : "rejected";
        lastResult = {
          ok: false,
          execution,
          runId,
          ...publicError(error),
          effect: await effectReport(attempted),
        };
        emit("run_finished", { execution, error_code: lastResult.error_code });
      } finally {
        try {
          // Release only owned transient fixture resources. Stop must not leave
          // a fault installed, and finalization must never replay app actions.
          await adapter.endRun?.({ runId, command: id, recipe });
        } catch {
          lastResult.ok = false;
          lastResult.cleanupFailed = true;
          lastResult.cleanupError = {
            error_code: "cleanup_incomplete",
            error: "Owned transient cleanup is incomplete.",
          };
          emit("cleanup_failed", { error_code: "cleanup_incomplete" });
        }
        lastResult.command = command;
        lastResult.recipe = recipe;
        lastResult.startedAt = startedAt;
        lastResult.finishedAt = new Date().toISOString();
        const runEvents = events.filter(
          (event) => event.runId === runId && event.sequence >= firstEvent,
        );
        completedRuns.set(
          runId,
          structuredClone({
            format: "browser-driver-report/1",
            identity: runIdentity,
            runId,
            lastResult,
            events: runEvents,
            eventRange: {
              first: firstEvent,
              last: runEvents.at(-1).sequence,
              retainedFirst: runEvents[0].sequence,
              truncated: runEvents[0].sequence > firstEvent,
            },
            resources: resources?.snapshot?.() ?? [],
          }),
        );
        if (completedRuns.size > 16)
          completedRuns.delete(completedRuns.keys().next().value);
        busy = false;
        active = null;
      }
      return structuredClone(lastResult);
    })();
    return active;
  }
  const api = {
    observe: snapshot,
    snapshot,
    execute: (id, params = {}, revision) => start(id, params, revision, false),
    runRecipe: (id, revision) => start(id, {}, revision, true),
    command: (request) =>
      request?.recipe
        ? start(request.id, {}, request.revision, true)
        : start(request?.id, request?.params ?? {}, request?.revision, false),
    pause() {
      if (closed) return { ok: false };
      paused = true;
      if (busy) execution = "paused";
      emit("paused");
      return { ok: true, paused };
    },
    resume() {
      paused = false;
      wake();
      emit("resumed");
      return { ok: true, paused };
    },
    stop() {
      stopping = true;
      paused = false;
      wake();
      if (!busy) execution = "stopped";
      emit("stop_requested");
      return { ok: true };
    },
    setSpeed(value) {
      if (!Object.hasOwn(speeds, value))
        reject("invalid_speed", "Speed must be slow, normal or fast.");
      speed = value;
      return { ok: true, speed };
    },
    report: ({ runId: completedId } = {}) =>
      completedId !== undefined
        ? structuredClone(completedRuns.get(completedId) ?? null)
        : structuredClone({
            format: "browser-driver-report/1",
            identity: base().identity,
            runId,
            lastResult: structuredClone(lastResult),
            events: structuredClone(events),
            resources: resources?.snapshot?.() ?? [],
            completedRunIds: [...completedRuns.keys()],
          }),
    close() {
      closing = true;
      return (closePromise ??= (async () => {
        api.stop();
        if (active) await active;
        closed = true;
        const errors = [];
        for (const [name, cleanup] of [
          ["adapter", () => adapter.close?.()],
          ["engine", () => engine.close()],
          ["resources", () => resources?.close()],
        ]) {
          if (completedCleanup.has(name)) continue;
          try {
            await cleanup();
            completedCleanup.add(name);
          } catch (error) {
            errors.push(error);
          }
        }
        if (errors.length) {
          closePromise = null;
          throw new AggregateError(errors, "Driver cleanup incomplete.");
        }
      })());
    },
  };
  emit("attached");
  return api;
}
