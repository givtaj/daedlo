export const MODEL = { id: "seeruntime-playback", version: "068d573-v1" };

export async function readMetrics(page) {
  return page.evaluate(() => ({
    phase: document.querySelector("#phase-state")?.textContent ?? "",
    event: Number(document.querySelector("#event-current")?.textContent ?? NaN),
    timeline: Number(document.querySelector("#timeline")?.value ?? NaN),
    active: document.querySelectorAll('#event-strip [aria-current="step"]')
      .length,
  }));
}

export function createSeeRuntimeAdapter(page) {
  let before;
  let lastEvidence;
  const observe = async () => ({
    connected: !page.isClosed(),
    session: new URL(page.url()).origin,
    facts: await page.evaluate(() => {
      const q = (id) => document.getElementById(id);
      const selected = document.querySelector(
        '.model-card[aria-pressed="true"]',
      );
      const phase = q("phase-state")?.textContent;
      const loop = q("loop")?.getAttribute("aria-pressed");
      return {
        model: selected?.id.replace(/^model-/, "") ?? "",
        scenario: q("scenario")?.value ?? "",
        play_label: q("play")?.getAttribute("aria-label") ?? "",
        ready: q("phase-state")?.textContent === "Ready",
        complete: q("phase-state")?.textContent === "Complete",
        controls: [
          "play",
          "reset",
          "step",
          "scenario",
          "model-node",
          "loop",
          "speed",
        ].every((id) => q(id) && !q(id).disabled),
        scene: Boolean(
          q("stage")?.querySelector("canvas") && q("scene-error")?.hidden,
        ),
        phase_present:
          ["Ready", "Complete"].includes(phase) ||
          [...document.querySelectorAll("#event-strip .event-pill")].some(
            (pill) => pill.textContent === phase,
          ),
        looping: loop === "true" ? true : loop === "false" ? false : null,
        speed: q("speed")?.value ?? "",
        event_total: Number(q("event-total")?.textContent ?? 0),
      };
    }),
  });
  const action = (selector) => async (_params, execution) => {
    before = await readMetrics(page);
    await execution.click(page.locator(selector));
  };
  return {
    model: MODEL,
    observe,
    handlers: {
      select_io: async (_params, execution) => {
        before = await readMetrics(page);
        await execution.click(page.locator("#model-node"));
        await execution.select(page.locator("#scenario"), "io");
      },
      step: action("#step"),
      play: action("#play"),
      pause: action("#play"),
      reset: action("#reset"),
    },
    beginRun: () => {
      before = undefined;
      lastEvidence = undefined;
    },
    async evidence() {
      const after = await readMetrics(page);
      // This is a temporal assertion sample, not a blind retry or readiness delay.
      await page.waitForTimeout(240);
      const later = await readMetrics(page);
      lastEvidence = { before, after, later };
      return lastEvidence;
    },
    effectStatus: () => ({ status: "not_attempted" }),
    acceptance: { evidence: () => structuredClone(lastEvidence) },
  };
}
