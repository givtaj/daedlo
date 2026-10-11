// Browser Driver adaptation of the Roots driver: generalized model, execution and viewer interfaces; later lifecycle and reporting changes. See THIRD_PARTY_NOTICES.md and licenses/Apache-2.0.txt at the package root.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { DriverError } from "./errors.mjs";

export function createEngineClient(enginePath, { timeoutMs = 5000 } = {}) {
  if (typeof enginePath !== "string" || !enginePath)
    throw new DriverError(
      "engine_path",
      "An explicit engine executable is required.",
    );
  const child = spawn(enginePath, [], {
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
  });
  const pending = new Map();
  let next = 1,
    dead = false,
    didExit = false,
    closePromise;
  let exited;
  const exit = new Promise((resolve) => {
    exited = resolve;
  });
  const lines = createInterface({ input: child.stdout });
  function fail(code, message) {
    if (dead) return;
    dead = true;
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new DriverError(code, message));
    }
    pending.clear();
    child.kill();
  }
  child.on("error", () => {
    fail("engine_unavailable", "The configured engine could not start.");
    if (!child.pid) {
      didExit = true;
      exited();
    }
  });
  child.on("exit", () => {
    didExit = true;
    fail(
      "engine_disconnected",
      "The engine disconnected; no command was replayed.",
    );
    exited();
  });
  child.stdin.on("error", () =>
    fail("engine_disconnected", "The engine input closed."),
  );
  // Drain diagnostics privately: arbitrary model stderr is not safe viewer content.
  child.stderr.on("data", () => {});
  let buffered = 0;
  child.stdout.on("data", (chunk) => {
    buffered += chunk.length;
    if (buffered > 1024 * 1024)
      fail("protocol_error", "Engine response exceeded the size limit.");
    if (chunk.includes(10)) buffered = chunk.length - chunk.lastIndexOf(10) - 1;
  });
  lines.on("line", (line) => {
    if (dead) return;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      fail("protocol_error", "Malformed engine response.");
      return;
    }
    if (
      Buffer.byteLength(line) > 1024 * 1024 ||
      value?.protocol !== 1 ||
      !Number.isSafeInteger(value?.id) ||
      !pending.has(value.id) ||
      typeof value.ok !== "boolean"
    ) {
      fail("protocol_error", "Incompatible or uncorrelated engine response.");
      return;
    }
    const p = pending.get(value.id);
    pending.delete(value.id);
    clearTimeout(p.timer);
    p.resolve(value);
  });
  return {
    connected: () => !dead,
    request(payload) {
      if (dead)
        return Promise.reject(
          new DriverError("engine_disconnected", "Engine is disconnected."),
        );
      return new Promise((resolve, reject) => {
        const id = next++;
        const timer = setTimeout(
          () =>
            fail(
              "engine_timeout",
              "Engine timed out; execution stopped without replay.",
            ),
          timeoutMs,
        );
        pending.set(id, { resolve, reject, timer });
        const line = JSON.stringify({ ...payload, protocol: 1, id }) + "\n";
        if (Buffer.byteLength(line) > 1024 * 1024) {
          pending.delete(id);
          clearTimeout(timer);
          reject(
            new DriverError(
              "request_too_large",
              "Engine request exceeded the size limit.",
            ),
          );
          return;
        }
        child.stdin.write(line, (error) => {
          if (error)
            fail("engine_disconnected", "Could not send the engine request.");
        });
      });
    },
    close() {
      return (closePromise ??= (async () => {
        fail("closed", "Driver engine closed.");
        lines.close();
        async function waitForExit() {
          if (didExit) return true;
          let timer;
          await Promise.race([
            exit,
            new Promise((resolve) => {
              timer = setTimeout(resolve, 1500);
            }),
          ]);
          clearTimeout(timer);
          return didExit;
        }
        if (await waitForExit()) return;
        child.kill("SIGKILL");
        if (!(await waitForExit()))
          throw new DriverError(
            "cleanup_incomplete",
            "Engine process exit is unconfirmed; retry cleanup.",
          );
      })().catch((error) => {
        closePromise = undefined;
        throw error;
      }));
    },
  };
}
