import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// An installed consumer supplies its exact installed public runtime entrypoint.
// Playwright is resolved from that package, never silently from a source checkout.
export const runtimeUrl = process.env.DAEDLO_STARTER_RUNTIME
  ? pathToFileURL(resolve(process.env.DAEDLO_STARTER_RUNTIME)).href
  : new URL("../../packages/runtime/src/index.mjs", import.meta.url).href;
export const runtime = await import(runtimeUrl);
const require = createRequire(runtimeUrl);
export const { chromium } = require("playwright");
