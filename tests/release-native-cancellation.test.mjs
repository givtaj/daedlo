import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
const nativeUrl = new URL("../scripts/release/native.mjs", import.meta.url)
  .href;
const supervisorUrl = new URL(
  "../scripts/release/ninja-supervisor.mjs",
  import.meta.url,
).href;
const resourcesUrl = new URL(
  "../packages/runtime/src/resources.mjs",
  import.meta.url,
).href;
async function until(fn, timeout = 4000) {
  const end = Date.now() + timeout;
  for (;;) {
    const result = await fn();
    if (result) return result;
    if (Date.now() > end)
      throw Error("Owned startup did not acknowledge cancellation or cleanup");
    await new Promise((done) => setTimeout(done, 20));
  }
}
async function read(path) {
  try {
    return await fs.readFile(path, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
async function fixture(t, mode) {
  const root = await fs.realpath(
      await fs.mkdtemp(join(tmpdir(), "native-cancel-")),
    ),
    store = join(root, "store");
  await fs.mkdir(store);
  await fs.writeFile(
    join(root, "runtime.mjs"),
    `export {createResourceScope} from ${JSON.stringify(resourcesUrl)};`,
  );
  await fs.writeFile(
    join(root, "launcher.mjs"),
    `import fs from 'node:fs/promises';import {join} from 'node:path';export async function createManagedLaunch({resources,sourceRoot,signal}) {resources.own({}, {label:'owned startup fixture',close:()=>fs.writeFile(join(sourceRoot,'closed'),'closed')});await fs.writeFile(join(sourceRoot,'entered'),'entered');await new Promise((_,reject)=>{if(signal?.aborted)reject(Error('cancelled'));else signal?.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});});}`,
  );
  const receipt = {
    id: "pending",
    version: "1",
    model: { id: "fixture", version: "1" },
    runtimePath: join(root, "runtime.mjs"),
    launcherPath: join(root, "launcher.mjs"),
    sourcePath: root,
  };
  const code = `import fs from 'node:fs/promises';import {join} from 'node:path';import {nativeCommand,runNativeCli} from ${JSON.stringify(nativeUrl)};import {createNinjaSupervisor} from ${JSON.stringify(supervisorUrl)};
 const root=${JSON.stringify(root)},store=join(root,'store');const supervisor=await createNinjaSupervisor({root:join(store,'supervisor'),timeoutMs:10000});
 const config={schemaVersion:1,store,registration:{projectId:'fixture',model:{id:'fixture',version:'1'}}};
 const state=()=>({project:{id:'fixture'},phase:'idle',selected:{id:'pending',version:'1'},running:null,blockers:[]});
 const manager={status:async()=>state(),start:()=>supervisor.start(${JSON.stringify(receipt)}),close:()=>supervisor.close(),check:async()=>{},prepare:async()=>{},activate:async()=>{},rollback:async()=>{}};
 const deps={readConfig:async()=>({config,keys:[]}),open:async()=>({manager,supervisor}),toolsSha256:'c'.repeat(64)};
 ${mode === "cli" ? `await runNativeCli(['start','--config',join(root,'config.json')],{command:(cmd,path,options)=>nativeCommand(cmd,path,{...deps,...options})});` : `await supervisor.start(${JSON.stringify(receipt)});`}`;
  await fs.writeFile(join(root, "worker.mjs"), code);
  const owner = spawn(process.execPath, [join(root, "worker.mjs")], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "";
  owner.stdout.on("data", (x) => (stdout += x));
  owner.stderr.on("data", (x) => (stderr += x));
  const exited = new Promise((done) =>
    owner.once("exit", (code, signal) => done({ code, signal })),
  );
  t.after(async () => {
    if (owner.exitCode === null && owner.signalCode === null)
      owner.kill("SIGKILL");
    await exited;
    const marker = await read(join(store, "supervisor/child.json"));
    if (marker) {
      const child = JSON.parse(marker);
      if (child.status !== "closed")
        try {
          process.kill(child.pid, "SIGKILL");
        } catch (e) {
          if (e.code !== "ESRCH") throw e;
        }
      // The closed receipt proves resource drainage, not process exit. The
      // orphan can still finish its final atomic receipt write. Preserve its
      // directory until the exact owned child has actually terminated.
      await until(() => {
        try {
          process.kill(child.pid, 0);
          return false;
        } catch (error) {
          if (error.code === "ESRCH") return true;
          throw error;
        }
      });
    }
    await fs.rm(root, { recursive: true, force: true });
  });
  await until(() => read(join(root, "entered"))).catch((e) => {
    throw Error(e.message + " " + stderr + " " + stdout, { cause: e });
  });
  return {
    root,
    store,
    owner,
    exited,
    stdout: () => stdout,
    stderr: () => stderr,
  };
}
for (const signal of ["SIGINT", "SIGTERM"])
  test(
    `native CLI ${signal} during startup aborts before readiness and waits for owned cleanup`,
    { timeout: 15000 },
    async (t) => {
      const f = await fixture(t, "cli");
      f.owner.kill(signal);
      await f.exited;
      await until(() => read(join(f.root, "closed")), 1500);
      assert.equal(
        JSON.parse(await read(join(f.store, "supervisor/child.json"))).status,
        "closed",
      );
      assert.equal(
        await read(join(f.store, "native-session.json")),
        null,
        "CLI waits for owner receipt removal",
      );
      assert.equal(f.stdout().includes('"status": "running"'), false);
    },
  );
test(
  "owner IPC disconnect aborts a blocked startup immediately so the child can drain owned resources",
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t, "supervisor");
    f.owner.kill("SIGKILL");
    await f.exited;
    await until(() => read(join(f.root, "closed")), 1500);
    await until(
      async () =>
        JSON.parse(await read(join(f.store, "supervisor/child.json")))
          .status === "closed",
    );
  },
);
