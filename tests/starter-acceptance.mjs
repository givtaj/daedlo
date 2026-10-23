import { resolve } from "node:path";
import { buildStarterModel } from "../examples/starter/build-model.mjs";
const output = resolve(
  process.env.DAEDLO_STARTER_OUTPUT ??
    `artifacts/alpha4-starter/check-${Date.now()}-${process.pid}`,
);
if (
  !process.env.DAEDLO_STARTER_ENGINE &&
  !process.env.DAEDLO_STARTER_INVALID_ENGINE
) {
  const build = await buildStarterModel({
    output: resolve(output, "build"),
    offline: true,
  });
  process.env.DAEDLO_STARTER_ENGINE = build.enginePath;
  process.env.DAEDLO_STARTER_INVALID_ENGINE = build.invalidEnginePath;
}
process.env.DAEDLO_STARTER_OUTPUT = output;
// Runs the same acceptance shipped with the portable starter.
await import("../examples/starter/acceptance.mjs");
