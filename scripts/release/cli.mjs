#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { runReleaseCli } from "./commands.mjs";
await runReleaseCli(process.argv.slice(2), {
  repoRoot: fileURLToPath(new URL("../../", import.meta.url)),
});
