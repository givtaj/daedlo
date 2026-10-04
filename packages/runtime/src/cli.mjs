#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import {
  createDriverSession,
  createResourceScope,
  createViewer,
} from "./index.mjs";

const usage = `browser-driver --project PATH [--port NUMBER] [--headed] [--report PATH]

Start a trusted project's local browser-driver integration.
The project module exports createProject({resources}) and returns:
  {url, enginePath, createAdapter({page,context}), identity?}
The CLI owns its new browser and registered fixture resources. Ctrl+C cleans them.
Existing attached resources are preserved. No commands execute on startup.
`;
function options(args) {
  const result = { port: 0, headed: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") return { help: true };
    if (args[i] === "--headed") {
      result.headed = true;
      continue;
    }
    if (!["--project", "--port", "--report"].includes(args[i]))
      throw Error(`Unknown option: ${args[i]}`);
    const key = args[i].slice(2),
      value = args[++i];
    if (!value || value.startsWith("--")) throw Error(`Missing --${key} value`);
    if (key === "port") {
      if (!/^\d+$/.test(value) || Number(value) > 65535)
        throw Error("Port must be 0..65535");
      result.port = Number(value);
    } else result[key] = resolve(value);
  }
  if (!result.project)
    throw Error("--project is required. Use --help for the project contract.");
  return result;
}
async function main() {
  const opt = options(process.argv.slice(2));
  if (opt.help) {
    console.log(usage);
    return;
  }
  const resources = createResourceScope();
  let session,
    stopping = false,
    shutdownPromise,
    finish;
  const lifetime = new Promise((r) => (finish = r));
  const checkStop = () => {
    if (stopping) throw Error("Startup interrupted.");
  };
  const startup = (async () => {
    const projectModule = await import(pathToFileURL(opt.project).href);
    checkStop();
    if (typeof projectModule.createProject !== "function")
      throw Error("Project must export createProject.");
    const project = await projectModule.createProject({ resources });
    checkStop();
    if (
      !project.url ||
      !project.enginePath ||
      typeof project.createAdapter !== "function"
    )
      throw Error("Project has an incomplete integration contract.");
    const browser = await chromium.launch({ headless: !opt.headed });
    resources.own(browser, {
      label: "controlled browser",
      close: (b) => b.close(),
    });
    checkStop();
    const context = await browser.newContext({
        viewport: { width: 1100, height: 780 },
      }),
      page = await context.newPage();
    await page.goto(project.url);
    checkStop();
    const adapter = await project.createAdapter({ page, context });
    session = await createDriverSession({
      page,
      context,
      enginePath: project.enginePath,
      adapter,
      identity: project.identity,
    });
    resources.own(session, {
      label: "driver session",
      close: (s) => s.close(),
    });
    checkStop();
    const viewer = await createViewer({
      page,
      context,
      session,
      port: opt.port,
    });
    resources.own(viewer, { label: "live viewer", close: (v) => v.close() });
    checkStop();
    console.log(`Browser-driver monitor: ${viewer.url}`);
    console.log(
      `Model: ${adapter.model.id}@${adapter.model.version} · protocol 1 · Ctrl+C to close`,
    );
    return viewer;
  })();
  const shutdown = () =>
    (shutdownPromise ??= (async () => {
      stopping = true;
      session?.stop();
      await startup.catch(() => {});
      try {
        if (opt.report && session)
          await writeFile(
            opt.report,
            JSON.stringify(session.report(), null, 2) + "\n",
          );
      } finally {
        try {
          await resources.close();
        } finally {
          finish();
        }
      }
    })());
  const signal = () => {
    shutdown().catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", signal);
  process.once("SIGTERM", signal);
  try {
    await startup;
    await lifetime;
  } catch (error) {
    await shutdown();
    throw error;
  } finally {
    process.off("SIGINT", signal);
    process.off("SIGTERM", signal);
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
