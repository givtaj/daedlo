import { createManagedLaunch as launch } from "./launch-selected.mjs";

export function createManagedLaunch(options) {
  const { fixture } = options;
  return launch({
    ...options,
    fixture: { ...fixture, input: fixture.input.selectedCase },
  });
}
