import { createManagedLaunch as launchStarter } from "../managed-starter/managed-launch.mjs";
import { recordCase, selectCase } from "./select.mjs";

export async function createManagedLaunch(options) {
  const { fixture } = options;
  const origin = await selectCase(fixture, "live");
  const handle = await launchStarter({
    ...options,
    settings: { ...options.settings, origin },
  });
  await recordCase(fixture, { connected: true });
  return handle;
}
