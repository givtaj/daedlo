// Authored explanatory sketches only. No browser automation or application evidence.
const scenarios = {
  draft: {
    promise: "Your draft should survive a trip away and back.",
    steps: ["Write", "Leave", "Return", "Verify"],
    frames: [
      {
        state: "Draft ready",
        description: "A note is written. It has not been saved.",
        sampleLabel: "Illustrative draft",
        sample: "Keep this thought. I’ll be right back.",
        evidence: "No write attempted",
      },
      {
        state: "Away from the editor",
        description: "Navigate to another part of the application.",
        sampleLabel: "Expected behavior",
        sample: "Keep the unsaved draft available.",
        evidence: "Retention not checked yet",
      },
      {
        state: "Back in the editor",
        description: "Return and observe the draft that is actually present.",
        sampleLabel: "Illustrative observation",
        sample: "Keep this thought. I’ll be right back.",
        evidence: "Ready to compare",
      },
      {
        state: "The thought stayed",
        description:
          "Compare the observed draft with the text written before navigation.",
        sampleLabel: "Illustrated comparison",
        sample: "Original draft = observed draft",
        evidence: "Draft matches",
        tone: "confirmed",
      },
    ],
  },
  save: {
    promise: "A retry should recover the save without creating a duplicate.",
    steps: ["Prepare", "Save", "Lose reply", "Verify"],
    frames: [
      {
        state: "Ready to save",
        description:
          "A draft is ready. The application owns its save and retry behavior.",
        sampleLabel: "Expected behavior",
        sample: "Save this draft once, even after a retry.",
        evidence: "No write attempted",
      },
      {
        state: "Save dispatched",
        description:
          "The save action ran. That alone does not establish persistence.",
        sampleLabel: "Separate questions",
        sample: "Action ran. Was the record saved?",
        evidence: "Not established",
      },
      {
        state: "Response lost",
        description:
          "The response never arrived. The outcome is still uncertain.",
        sampleLabel: "Application recovery",
        sample: "Retain the draft and the same operation identity.",
        evidence: "Uncertain",
        tone: "uncertain",
      },
      {
        state: "Recovered, once",
        description:
          "Explicitly retry the same operation, then read back and check the record count.",
        sampleLabel: "Illustrated persistence check",
        sample: "Intended draft present · record count = 1",
        evidence: "One record confirmed",
        tone: "confirmed",
      },
    ],
  },
};
let active = "draft";
let step = 0;
const select = (selector) => document.querySelector(selector);
const setText = (selector, value) => {
  select(selector).textContent = value;
};
function render() {
  const scenario = scenarios[active];
  const frame = scenario.frames[step];
  document
    .querySelectorAll("[data-scenario]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.scenario === active),
      ),
    );
  setText("[data-promise]", scenario.promise);
  setText("[data-state]", frame.state);
  setText("[data-description]", frame.description);
  setText("[data-sample-label]", frame.sampleLabel);
  setText("[data-sample]", frame.sample);
  setText("[data-evidence-value]", frame.evidence);
  setText("[data-step-count]", `${String(step + 1).padStart(2, "0")} / 04`);
  select(".observation").dataset.tone = frame.tone || "neutral";
  select("[data-next]").disabled = step === scenario.frames.length - 1;
  select("[data-flow-path]").replaceChildren(
    ...scenario.steps.map((label, index) => {
      const item = document.createElement("li");
      const marker = document.createElement("span");
      marker.textContent = String(index + 1).padStart(2, "0");
      item.append(marker, document.createTextNode(label));
      if (index === step) {
        item.className = "current";
        item.setAttribute("aria-current", "step");
      }
      if (index < step) item.className = "complete";
      return item;
    }),
  );
}
document.querySelectorAll("[data-scenario]").forEach((button) =>
  button.addEventListener("click", () => {
    active = button.dataset.scenario;
    step = 0;
    render();
  }),
);
select("[data-next]").addEventListener("click", () => {
  step = Math.min(step + 1, scenarios[active].frames.length - 1);
  render();
});
select("[data-reset]").addEventListener("click", () => {
  step = 0;
  render();
});
render();
