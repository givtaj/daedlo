#!/usr/bin/env node
// Browser Driver adaptation of the Roots driver: generalized model, execution and viewer interfaces; later lifecycle and reporting changes. See THIRD_PARTY_NOTICES.md and licenses/Apache-2.0.txt at the package root.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { writeFile } from "node:fs/promises";
import {
  createDriverSession,
  createResourceScope,
  createViewer,
} from "./index.mjs";

const usage = `daedlo --project PATH [--port NUMBER] [--headed] [--report PATH]

Start a trusted project's local Daedlo integration.
The project module exports createProject({resources}) and returns:
  {url, enginePath, createAdapter({page,context}), identity?, presentations?}
or {url, createSession({page,context,resources,signal,ownSession})} returning a complete session.
The two creation routes are mutually exclusive. The CLI owns its new browser and registered fixture resources. Ctrl+C cleans them.
Existing attached resources are preserved. The CLI does not automatically dispatch commands.
Trusted project factories may perform explicitly configured startup actions.
Optional environment:
  PLAYWRIGHT_MODULE  Playwright module URL or path resolved from the working directory.
  CHROMIUM           Browser executable path, passed unchanged to Playwright.
Unset or empty values use Playwright defaults; selected module or launch failures do not fall back.
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
  const startupController = new AbortController();
  const ownedSessions = new WeakSet();
  let session,
    stopping = false,
    shutdownPromise,
    sessionClosePromise,
    sessionClosed = false,
    shutdownComplete = false,
    retryKeepalive,
    finish;
  const lifetime = new Promise((r) => (finish = r));
  const closeSession = () => {
    if (sessionClosed) return Promise.resolve();
    return (sessionClosePromise ??= (async () => {
      await session.close();
      sessionClosed = true;
    })());
  };
  const ownSession = (candidate) => {
    if (typeof candidate?.close !== "function")
      throw Error("Owned sessions require a close method.");
    if (!ownedSessions.has(candidate)) {
      resources.own(candidate, {
        label: "driver session",
        close: (value) => (value === session ? closeSession() : value.close()),
      });
      ownedSessions.add(candidate);
    }
    return candidate;
  };
  const checkStop = () => {
    if (stopping) throw Error("Startup interrupted.");
  };
  const startup = (async () => {
    const moduleOverride = process.env.PLAYWRIGHT_MODULE;
    const playwrightSpecifier = moduleOverride
      ? /^(file:|[a-z]+:)/i.test(moduleOverride)
        ? moduleOverride
        : pathToFileURL(resolve(moduleOverride)).href
      : "playwright";
    const { chromium } = await import(playwrightSpecifier);
    checkStop();
    if (typeof chromium?.launch !== "function")
      throw Error("Selected Playwright module must export chromium.launch.");
    const projectModule = await import(pathToFileURL(opt.project).href);
    checkStop();
    if (typeof projectModule.createProject !== "function")
      throw Error("Project must export createProject.");
    const project = await projectModule.createProject({ resources });
    checkStop();
    const customSession = typeof project?.createSession === "function";
    if (
      !project?.url ||
      (customSession && project.createAdapter !== undefined) ||
      (!customSession &&
        (project.createSession !== undefined ||
          !project.enginePath ||
          typeof project.createAdapter !== "function"))
    )
      throw Error(
        "Project must provide exactly one complete adapter or session creation route.",
      );
    const browser = await chromium.launch({
      headless: !opt.headed,
      ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
      // The CLI settles runs and preserves retryable cleanup before closing the
      // browser. Playwright's defaults would close it independently (and exit
      // the host process on SIGINT), bypassing that lifecycle.
      handleSIGINT: false,
      handleSIGTERM: false,
    });
    resources.own(browser, {
      label: "controlled browser",
      close: (b) => b.close(),
    });
    checkStop();
    const context = await browser.newContext({
      viewport: { width: 1100, height: 780 },
    });
    checkStop();
    const page = await context.newPage();
    checkStop();
    await page.goto(project.url);
    checkStop();
    let model;
    if (customSession) {
      const candidate = await project.createSession({
        page,
        context,
        resources,
        signal: startupController.signal,
        ownSession,
      });
      // Acquire a closable return before validation or an interruption check.
      // Invalid candidates never become active sessions: shutdown must not call
      // missing stop/report methods before their owned close can run.
      if (typeof candidate?.close === "function") ownSession(candidate);
      if (
        !candidate ||
        [
          "startPresentation",
          "advancePresentation",
          "observe",
          "snapshot",
          "execute",
          "runRecipe",
          "command",
          "pause",
          "resume",
          "stop",
          "setSpeed",
          "report",
          "close",
        ].some((method) => typeof candidate[method] !== "function")
      )
        throw Error(
          "Project createSession must return a complete DriverSession.",
        );
      session = candidate;
      checkStop();
      model = session.report()?.identity?.model;
      if (typeof model?.id !== "string" || typeof model?.version !== "string")
        throw Error("Custom session report must identify its model.");
    } else {
      const adapter = await project.createAdapter({ page, context });
      try {
        checkStop();
        session = await createDriverSession({
          page,
          context,
          enginePath: project.enginePath,
          adapter,
          identity: project.identity,
          presentations: project.presentations,
        });
      } catch (error) {
        // Until a session exists, the launcher still owns adapter cleanup.
        if (typeof adapter?.close === "function")
          resources.own(adapter, {
            label: "startup adapter",
            close: (a) => a.close(),
          });
        throw error;
      }
      resources.own(session, {
        label: "driver session",
        close: closeSession,
      });
      model = adapter.model;
    }
    checkStop();
    const viewer = await createViewer({
      page,
      context,
      session,
      port: opt.port,
      frontend: project.frontend,
    });
    resources.own(viewer, { label: "live viewer", close: (v) => v.close() });
    checkStop();
    console.log(`Daedlo monitor: ${viewer.url}`);
    console.log(
      `Model: ${model.id}@${model.version} · protocol 1 · Ctrl+C to close`,
    );
    return viewer;
  })();
  const shutdown = () => {
    if (shutdownComplete) return Promise.resolve();
    return (shutdownPromise ??= (async () => {
      stopping = true;
      startupController.abort(Error("Startup interrupted."));
      session?.stop();
      if (session) void closeSession().catch(() => {});
      await startup.catch(() => {});
      // Seal new commands and await the active run, including endRun. Share the
      // promise with the resource scope so failures are retried only on the next
      // shutdown attempt, never twice during this attempt.
      let cleanupError;
      if (session) {
        try {
          await closeSession();
        } catch (error) {
          // A bounded wait can expire while the original run or close hook
          // still needs its browser and fixture. Retain those dependencies as
          // well as the session; retry only after an explicit later signal.
          if (error?.cleanupPending === true) cleanupError = error;
        }
      }
      if (!cleanupError) {
        try {
          await resources.close();
        } catch (error) {
          cleanupError = error;
        }
      }
      try {
        if (opt.report && session)
          await writeFile(
            opt.report,
            JSON.stringify(
              { ...session.report(), resources: resources.snapshot() },
              null,
              2,
            ) + "\n",
          );
      } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
      }
      if (cleanupError) {
        sessionClosePromise = undefined;
        // Signal listeners do not keep Node alive once its other handles close.
        retryKeepalive ??= setInterval(() => {}, 1000);
        console.error(
          `${cleanupError.message} Send Ctrl+C or SIGTERM to retry.`,
        );
        return;
      }
      shutdownComplete = true;
      clearInterval(retryKeepalive);
      finish();
    })().finally(() => {
      shutdownPromise = undefined;
    }));
  };
  const signal = () => {
    shutdown().catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  };
  process.on("SIGINT", signal);
  process.on("SIGTERM", signal);
  try {
    try {
      await startup;
    } catch (error) {
      if (!stopping) {
        console.error(error.message);
        process.exitCode = 1;
      }
      await shutdown();
    }
    await lifetime;
  } finally {
    process.off("SIGINT", signal);
    process.off("SIGTERM", signal);
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
