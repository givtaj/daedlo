import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const readJson = async (path) =>
  JSON.parse(await readFile(path, "utf8"));
export const writeJson = async (path, value) =>
  writeFile(path, JSON.stringify(value, null, 2) + "\n");
export async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
export async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200, url);
  return response.json();
}
export async function waitFor(label, check, timeout = 30000) {
  const end = Date.now() + timeout;
  do {
    const result = await check();
    if (result) return result;
    await delay(100);
  } while (Date.now() < end);
  throw Error(label + " timed out");
}
export async function startFixture({ appRoot, seed, output }) {
  await mkdir(output, { recursive: true });
  const data = join(output, "data");
  await mkdir(data);
  const dataPath = join(data, "workspace.json");
  await writeJson(dataPath, seed);
  const port = await freePort(),
    origin = `http://127.0.0.1:${port}`;
  const log = createWriteStream(join(output, "application.log"), {
    flags: "wx",
  });
  const child = spawn(process.execPath, [join(appRoot, "server.mjs")], {
    cwd: appRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      ARCHITECTURE_PORT: String(port),
      ARCHITECTURE_TEST_DATA_DIR: data,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      log.end();
      resolve({ code, signal });
    });
  });
  const resource = {
    pid: child.pid,
    port,
    origin,
    appRoot,
    data,
    status: "owned",
  };
  await writeJson(join(output, "application-owner.json"), resource);
  const close = async () => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGTERM");
    let timer;
    const result = await Promise.race([
      exited,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error("Owned application cleanup incomplete")),
          10000,
        );
      }),
    ]).finally(() => clearTimeout(timer));
    assert.deepEqual(result, { code: 0, signal: null });
    resource.status = "closed";
    await writeJson(join(output, "application-owner.json"), resource);
  };
  try {
    const health = await waitFor(
      "Owned Architecture Studio readiness",
      async () => {
        if (child.exitCode !== null || child.signalCode !== null)
          throw Error("Owned app exited before readiness");
        try {
          return await getJson(origin + "/api/health");
        } catch (error) {
          if (error instanceof TypeError) return null;
          throw error;
        }
      },
    );
    assert.equal(health.root, appRoot + "/");
    assert.equal(health.data, data);
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
  return {
    origin,
    appRoot,
    dataPath,
    evidencePath: join(output, "browser-runs.jsonl"),
    resource,
    close,
  };
}
export async function storage(settings) {
  const api = await getJson(settings.origin + "/api/workspace"),
    disk = await readJson(settings.dataPath);
  assert.deepEqual(api, disk, "Independent API and disk agree exactly");
  assert.equal(api.models.length, 1);
  assert.equal(api.models[0].id, "daedlo-first-flow");
  return api;
}
export async function runEvidence(path, runId) {
  const rows = (await readFile(path, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse)
    .filter((row) => row.run.runId === runId);
  assert.equal(
    rows.length,
    1,
    "Exactly one private evidence receipt per completed run",
  );
  return rows[0];
}
export async function assertAcceptedFlow({
  command,
  observe,
  settings,
  label,
}) {
  const original = await storage(settings);
  await command("open_editor");
  const invalid = await command("set_name", { value: "" }, "validation");
  const state = await observe();
  assert.equal(state.state.id, "Workspace::Editing::Invalid");
  assert.equal(state.commands.find((c) => c.id === "save").enabled, false);
  assert.equal(state.commands.find((c) => c.id === "reload").enabled, false);
  assert.equal(
    (await runEvidence(settings.evidencePath, invalid.runId))
      .workspacePutRequests,
    0,
  );
  assert.deepEqual(await storage(settings), original);
  const name = "Ninja preserved model — " + label,
    notes = "Isolated upgrade acceptance — " + label;
  await command("set_name", { value: name });
  await command("set_notes", { value: notes });
  const saved = await command("save"),
    write = await runEvidence(settings.evidencePath, saved.runId);
  assert.equal(saved.effect.status, "saved");
  assert.equal(write.workspacePutRequests, 1);
  assert.equal(write.saveEvidence.persisted, true);
  assert.equal(write.saveEvidence.save_status, 200);
  const persisted = await storage(settings);
  assert.equal(persisted.revision, original.revision + 1);
  assert.equal(persisted.models[0].name, name);
  assert.equal(persisted.models[0].notes, notes);
  const reload = await command("reload");
  assert.equal(
    (await runEvidence(settings.evidencePath, reload.runId))
      .workspacePutRequests,
    0,
  );
  assert.deepEqual(await storage(settings), persisted);
  const reopened = await command("open_editor");
  assert.equal(
    reopened.outcome.label,
    "Editor opened with persisted model fields",
  );
  assert.deepEqual(await storage(settings), persisted);
  return { original, persisted, invalid, saved, write, reload, reopened };
}
