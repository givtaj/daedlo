import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { fork, execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createNinjaManager } from "../scripts/release/ninja-manager.mjs";
import { createNinjaSupervisor } from "../scripts/release/ninja-supervisor.mjs";
import { sha256 } from "../scripts/release/manifest.mjs";

const managerUrl = new URL(
  "../scripts/release/ninja-manager.mjs",
  import.meta.url,
).href;
const supervisorUrl = new URL(
  "../scripts/release/ninja-supervisor.mjs",
  import.meta.url,
).href;
const resourceUrl = new URL(
  "../packages/runtime/src/resources.mjs",
  import.meta.url,
).href;
async function bounded(promise, label, milliseconds = 10000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(Error(`Timed out: ${label}`)),
        milliseconds,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}
async function until(check, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(20);
  }
  throw Error(`Timed out: ${label}`);
}
async function fixture(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "ninja-crash-")),
  );
  const workers = [],
    children = [];
  t.after(async () => {
    for (const { child, exited } of workers) {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await bounded(exited, "owned worker cleanup");
    }
    for (const { pid, title } of children) {
      if (!alive(pid)) continue;
      const command = execFileSync(
        "ps",
        ["-p", String(pid), "-o", "command="],
        { encoding: "utf8" },
      ).trim();
      if (!command.includes(title))
        throw Error(
          `Owned child identity changed; retained handle ${pid}, fixture ${root}`,
        );
      process.kill(pid, "SIGKILL");
      await until(() => !alive(pid), "owned child cleanup");
    }
    await fs.rm(root, { recursive: true });
  });
  async function worker(source) {
    const path = join(root, `worker-${workers.length}.mjs`);
    await fs.writeFile(path, source);
    const child = fork(path, [], {
      cwd: root,
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let stderr = "";
    child.stderr.on("data", (b) => {
      stderr = (stderr + b).slice(-8192);
    });
    const exited = new Promise((resolve) =>
      child.once("exit", (code, signal) => resolve({ code, signal })),
    );
    const message = new Promise((resolve, reject) => {
      child.once("message", resolve);
      child.once("error", reject);
      child.once("exit", (code, signal) =>
        reject(
          Error(
            `Worker exited before checkpoint (${code}/${signal}): ${stderr}`,
          ),
        ),
      );
    });
    workers.push({ child, exited });
    return { child, exited, message: bounded(message, "worker checkpoint") };
  }
  return { root, worker, children };
}

function fakeDependencies(root, events) {
  let running = null;
  return {
    registration: { projectId: "crash-fixture" },
    provider: {},
    installer: {
      async verify(path) {
        return JSON.parse(
          await fs.readFile(join(path, "receipt.json"), "utf8"),
        );
      },
    },
    supervisor: {
      async status() {
        return {
          running,
          busy: false,
          paused: false,
          dirty: false,
          cleanupPending: false,
        };
      },
      async start(receipt) {
        events.push(receipt.version);
        running = receipt;
      },
      async accept() {},
      async close() {
        running = null;
      },
    },
    root,
  };
}

test(
  "SIGKILL after selection write recovers a dead owner's lock and journal to the accepted installation",
  { timeout: 20000 },
  async (t) => {
    const f = await fixture(t);
    const store = join(f.root, "store"),
      starts = join(f.root, "starts.jsonl");
    const w =
      await f.worker(`import fs from 'node:fs/promises';import {join,basename} from 'node:path';import {createNinjaManager} from ${JSON.stringify(managerUrl)};
    const root=${JSON.stringify(store)},events=${JSON.stringify(starts)};let offered='1.0.0',running=null,crash=false;process.on('message',()=>{});
    const manager=await createNinjaManager({root,registration:{projectId:'crash-fixture'},
      provider:{async check(){return {checkpoint:{generation:1,sha256:'a'.repeat(64)},available:{id:offered,version:offered}}},async download(release){return release}},
      installer:{async prepare({verifiedKit,destination}){await fs.mkdir(destination);const receipt={id:basename(destination),version:verifiedKit.version,sourceSha256:'a'.repeat(64)};await fs.writeFile(join(destination,'receipt.json'),JSON.stringify(receipt));return receipt},async verify(path){return JSON.parse(await fs.readFile(join(path,'receipt.json'),'utf8'))}},
      supervisor:{async status(){return {running,busy:false,paused:false,dirty:false,cleanupPending:false}},async quiesce(){},async report(){return {preserved:true}},async close(){running=null},async start(r){await fs.appendFile(events,JSON.stringify({version:r.version})+'\\n');running=r},async accept(){}},
      fault:async point=>{if(crash&&point==='selection_written'){process.send({kind:'selected',pid:process.pid});await new Promise(()=>{})}}});
    await manager.check();let ready=await manager.prepare(offered);await manager.activate(ready.operation.id,{acknowledgeRestart:true});
    offered='2.0.0';await manager.check();ready=await manager.prepare(offered);crash=true;await manager.activate(ready.operation.id,{acknowledgeRestart:true});`);
    const checkpoint = await w.message;
    assert.equal(checkpoint.kind, "selected");
    assert.equal(checkpoint.pid, w.child.pid);
    const before = JSON.parse(
      await fs.readFile(join(store, "state.json"), "utf8"),
    );
    const selectedB = JSON.parse(
      await fs.readFile(
        join(store, "installations", before.current, "receipt.json"),
        "utf8",
      ),
    );
    assert.equal(selectedB.version, "2.0.0");
    const lock = JSON.parse(
      await fs.readFile(join(store, "operation.lock"), "utf8"),
    );
    assert.equal(lock.pid, w.child.pid);
    w.child.kill("SIGKILL");
    assert.equal(
      (await bounded(w.exited, "killed manager exit")).signal,
      "SIGKILL",
    );
    assert.equal(alive(lock.pid), false);
    assert.deepEqual(
      (await fs.readFile(starts, "utf8")).trim().split("\n").map(JSON.parse),
      [{ version: "1.0.0" }],
    );
    const events = [];
    const recovered = await createNinjaManager(fakeDependencies(store, events));
    const status = await recovered.status();
    assert.equal(status.phase, "recovered");
    assert.equal(status.selected.version, "1.0.0");
    assert.equal(status.running, null);
    assert.deepEqual(
      events,
      [],
      "Recovery must not launch a candidate or replay application effects",
    );
    await assert.rejects(fs.lstat(join(store, "operation.lock")), {
      code: "ENOENT",
    });
    const journal = JSON.parse(
      await fs.readFile(join(store, "transaction.json"), "utf8"),
    );
    assert.equal(journal.phase, "recovered");
    await recovered.start();
    assert.deepEqual(events, ["1.0.0"]);
  },
);

async function supervisorWorker(t) {
  const f = await fixture(t),
    title = `ninja-owned-${basename(f.root)}`;
  const executablePath = await fs.realpath(process.execPath);
  // Synthetic browser identity: these process tests do not launch a real browser.
  const browser = {
    version: process.version,
    executablePath,
    sha256: sha256(await fs.readFile(executablePath)),
  };
  const runtimePath = join(f.root, "runtime.mjs"),
    launcherPath = join(f.root, "launcher.mjs");
  await fs.writeFile(
    runtimePath,
    `import fs from 'node:fs/promises';export {createResourceScope} from ${JSON.stringify(resourceUrl)};process.title=${JSON.stringify(title)};
    export async function createDriverSession({resources}){let paused=false;return {snapshot:async()=>({busy:false,paused,connected:true,descriptor:{id:'fixture',version:'1'},identity:{runtime:'@browser-driver/runtime@1.0.0'}}),observe:async()=>({}),pause:()=>paused=true,resume:()=>paused=false,report:()=>({preserved:true}),close:async()=>{await resources.close();await fs.writeFile(${JSON.stringify(join(f.root, "closed.txt"))},'owned cleanup completed')}}}`,
  );
  await fs.writeFile(
    launcherPath,
    `export async function createManagedLaunch({runtime,installation}){await runtime.registerBrowser({browser:{version:()=>process.version},executablePath:installation.browser.executablePath});return {session:await runtime.createDriverSession({}),draftState:()=>false}}`,
  );
  const receipt = {
    id: "synthetic",
    version: "1.0.0",
    sourceSha256: "a".repeat(64),
    runtimePath,
    launcherPath,
    enginePath: join(f.root, "fake-engine"),
    sourcePath: f.root,
    model: { id: "fixture", version: "1" },
    browser,
  };
  const root = join(f.root, "supervisor"),
    marker = join(root, "child.json");
  const w =
    await f.worker(`import fs from 'node:fs/promises';import {createNinjaSupervisor} from ${JSON.stringify(supervisorUrl)};
    const supervisor=await createNinjaSupervisor({root:${JSON.stringify(root)},timeoutMs:3000});await supervisor.start(${JSON.stringify(receipt)});await supervisor.accept();
    process.send({kind:'ready',record:JSON.parse(await fs.readFile(${JSON.stringify(marker)},'utf8'))});process.on('message',()=>{});`);
  const info = await w.message;
  assert.equal(info.kind, "ready");
  assert.equal(info.record.status, "running");
  assert.equal(Number.isSafeInteger(info.record.pid), true);
  f.children.push({ pid: info.record.pid, title });
  return { ...f, w, marker, supervisorRoot: root, receipt, child: info.record };
}

test(
  "killing the supervisor parent triggers real IPC-disconnect cleanup and child exit",
  { timeout: 20000 },
  async (t) => {
    const f = await supervisorWorker(t);
    f.w.child.kill("SIGKILL");
    assert.equal(
      (await bounded(f.w.exited, "supervisor parent exit")).signal,
      "SIGKILL",
    );
    await until(
      async () =>
        JSON.parse(await fs.readFile(f.marker, "utf8")).status === "closed",
      "child cleanup receipt after IPC disconnect",
    );
    await until(
      () => !alive(f.child.pid),
      "managed child exit after IPC disconnect",
    );
    assert.equal(
      await fs.readFile(join(f.root, "closed.txt"), "utf8"),
      "owned cleanup completed",
    );
    const reopened = await createNinjaSupervisor({ root: f.supervisorRoot });
    assert.equal((await reopened.status()).cleanupPending, false);
  },
);

test(
  "unclean direct child kill retains its cleanup record and refuses adoption",
  { timeout: 20000 },
  async (t) => {
    const f = await supervisorWorker(t);
    const parentPid = Number(
      execFileSync("ps", ["-p", String(f.child.pid), "-o", "ppid="], {
        encoding: "utf8",
      }).trim(),
    );
    assert.equal(
      parentPid,
      f.w.child.pid,
      "Only the exact child of this owned worker may be signalled",
    );
    process.kill(f.child.pid, "SIGKILL");
    await until(() => !alive(f.child.pid), "unclean child exit");
    const retained = JSON.parse(await fs.readFile(f.marker, "utf8"));
    assert.equal(retained.status, "running");
    assert.equal(retained.token, f.child.token);
    await assert.rejects(fs.lstat(join(f.root, "closed.txt")), {
      code: "ENOENT",
    });
    const reopened = await createNinjaSupervisor({
      root: f.supervisorRoot,
      timeoutMs: 1000,
    });
    assert.equal((await reopened.status()).cleanupPending, true);
    await assert.rejects(reopened.start(f.receipt), /owns resources|cleanup/i);
    await assert.rejects(reopened.close(), /cleanup.*pending|retained child/i);
    assert.deepEqual(JSON.parse(await fs.readFile(f.marker, "utf8")), retained);
  },
);
