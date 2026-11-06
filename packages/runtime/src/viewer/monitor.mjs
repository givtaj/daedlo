// Browser Driver adaptation of the Roots driver: generalized model, execution and viewer interfaces; later lifecycle and reporting changes. See THIRD_PARTY_NOTICES.md and licenses/Apache-2.0.txt at the package root.
import { groupRecipePaths } from "./recipe-paths.mjs";

const $ = (id) => document.getElementById(id);
const text = (value) =>
  value === null || value === undefined
    ? "—"
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
const title = (value) =>
  text(value)
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
const node = (tag, className, content) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = text(content);
  return element;
};
let latest,
  descriptorKey,
  presentationKey,
  pending = false,
  startingPresentation = false,
  advancePending = false,
  streamFailed = false,
  awaitingStream = false,
  lastStreamRetry = 0;
const commandViews = new Map(),
  recipeViews = new Map(),
  presentationViews = new Map(),
  stateViews = new Map();

function message(value, failed = false) {
  $("action-message").textContent = value || "";
  $("action-message").hidden = !value;
  $("action-message").classList.toggle("error", failed);
}

async function mutate(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      result.error ||
        result.reason ||
        `Request ${result.execution || "rejected"}`,
    );
  return result;
}

function displayResult(result) {
  if (!result) return;
  const outcome = result.outcome;
  $("outcome-label").textContent =
    outcome?.label ||
    result.error ||
    result.reason ||
    (result.execution === "rejected"
      ? "Command rejected before execution"
      : "No confirmed application outcome");
  $("outcome-kind").textContent = title(outcome?.kind || "unknown");
  $("outcome-kind").hidden = false;
  $("outcome-kind").className = `pill outcome-${outcome?.kind || "unknown"}`;
  const effect = result.effect;
  const effectText =
    typeof effect === "object" && effect
      ? effect.label || effect.status || effect.kind || text(effect)
      : effect;
  $("effect-label").textContent =
    `Execution: ${title(result.execution || "unknown")}${effectText ? ` · Application effect: ${title(effectText)}` : " · Persistence not confirmed by this result"}`;
  if (result.cleanupFailed)
    $("effect-label").textContent += " · Owned transient cleanup incomplete";
  const operations = $("effect-operations");
  operations.replaceChildren();
  for (const operation of effect?.operations || []) {
    const item = node(
      "li",
      "",
      `${operation.label}: ${title(operation.status)}`,
    );
    item.dataset.operationId = operation.id;
    operations.append(item);
  }
  operations.hidden = !operations.children.length;
  $("last-result").dataset.outcome = outcome?.kind || "unknown";
}

// Render ownership from one snapshot. A command response can arrive after a
// different client starts the next run, so it must not replace this view.
function currentFinalization(driver) {
  const finalization = driver.finalization;
  return driver.busy &&
    driver.runId &&
    finalization?.runId === driver.runId &&
    ["effect_evidence", "run_cleanup"].includes(finalization.phase) &&
    ["pending", "stalled"].includes(finalization.status)
    ? finalization
    : null;
}

function renderResults(driver) {
  const result = driver.lastResult;
  const active = Boolean(driver.busy);
  const sameRun = Boolean(driver.runId && result?.runId === driver.runId);
  const finalization = currentFinalization(driver);
  $("active-result").hidden = !active;
  $("active-result").dataset.runId = driver.runId || "";
  $("active-run-identity").textContent = driver.runId
    ? `Run ${text(driver.runId)}`
    : "Run identity unavailable";
  $("active-outcome-label").textContent = finalization
    ? `${finalization.phase === "effect_evidence" ? "Waiting for effect evidence" : "Waiting for run cleanup"}; final application outcome pending`
    : sameRun
      ? "Finalizing this run; final application outcome pending"
      : "Run in progress; final application outcome pending";
  const detail = $("finalization-detail");
  detail.hidden = !finalization;
  detail.classList.toggle("stalled", finalization?.status === "stalled");
  detail.textContent = finalization
    ? [
        finalization.status === "stalled"
          ? "Taking longer than expected. This run remains active; no new action can start."
          : "This run stays active until evidence and cleanup finish.",
        finalization.stopRequested
          ? "Stop requested; waiting for this work to settle. Completed writes are not undone."
          : "",
      ]
        .filter(Boolean)
        .join(" ")
    : "";

  // lastResult can already refer to this run while endRun is still pending.
  // Wait for finalization, including cleanup, before presenting its final result.
  $("last-result").hidden = active && (!result || sameRun);
  if (result && !(active && sameRun)) {
    const attribution = !result.runId
      ? "unattributed"
      : sameRun
        ? "current"
        : driver.runId
          ? "previous"
          : "recorded";
    $("last-result").dataset.attribution = attribution;
    $("result-heading").textContent = {
      current: "Current run result",
      previous: "Previous run result",
      recorded: "Recorded run result",
      unattributed: "Retained result",
    }[attribution];
    $("result-identity").textContent = [
      result.runId ? `Run ${text(result.runId)}` : "Run identity unavailable",
      result.finishedAt
        ? `Finished ${text(result.finishedAt)}`
        : "Completion time unavailable",
    ].join(" · ");
    displayResult(result);
  } else {
    delete $("last-result").dataset.attribution;
    delete $("last-result").dataset.outcome;
    $("result-heading").textContent = "Application outcome";
    $("result-identity").textContent = "";
    $("outcome-label").textContent = active
      ? "Run in progress; final application outcome pending"
      : "No action has run yet";
    $("effect-label").textContent =
      "Results appear after the application is observed.";
    $("outcome-kind").hidden = true;
    $("outcome-kind").className = "pill";
    $("effect-operations").replaceChildren();
    $("effect-operations").hidden = true;
  }
}

async function run(id, params, recipe = false) {
  if (
    !latest?.driver?.revision ||
    pending ||
    latest.driver.busy ||
    !latest.connected
  )
    return;
  const revision = latest.driver.revision;
  pending = true;
  message("Running the selected action…");
  updateAvailability();
  try {
    const body = recipe
      ? { id, revision, recipe: true }
      : { id, params, revision };
    const result = await mutate("/command", body);
    message(
      result.execution === "failed"
        ? result.error || "Execution failed; inspect the observed outcome."
        : "",
      result.execution === "failed",
    );
  } catch (error) {
    message(error.message, true);
  } finally {
    pending = false;
    await refresh();
  }
}

async function present(id) {
  if (
    !latest?.driver?.revision ||
    pending ||
    latest.driver.busy ||
    latest.driver.paused ||
    !latest.connected
  )
    return;
  const revision = latest.driver.revision;
  pending = true;
  startingPresentation = true;
  message("Starting the presentation…");
  updateAvailability();
  try {
    const result = await mutate("/presentation", { id, revision });
    message(
      result.execution === "failed"
        ? result.error ||
            result.reason ||
            "Presentation halted; inspect the observed outcome."
        : "",
      result.execution === "failed",
    );
  } catch (error) {
    message(error.message, true);
  } finally {
    pending = false;
    startingPresentation = false;
    await refresh();
  }
}

function buildPresentations(presentations) {
  presentationViews.clear();
  $("presentations").replaceChildren();
  $("presentation-catalog").hidden = !presentations.length;
  for (const presentation of presentations) {
    const card = node("div", "recipe-card");
    const button = node("button", "recipe-button presentation-button");
    button.type = "button";
    button.dataset.presentation = presentation.id;
    button.append(
      node("span", "recipe-icon", "▷"),
      node("strong", "", `Start ${presentation.title}`),
    );
    const explanation = node(
      "p",
      "presentation-description",
      presentation.explanation,
    );
    const reason = node("p", "command-reason");
    reason.id = `presentation-reason-${presentation.id}`;
    button.setAttribute("aria-describedby", reason.id);
    button.addEventListener("click", () => void present(presentation.id));
    card.append(button, explanation, reason);
    $("presentations").append(card);
    presentationViews.set(presentation.id, { button, reason });
  }
}

function renderPresentation(driver, connected) {
  const presentation = driver.presentation;
  document.body.classList.toggle("presenting", Boolean(presentation));
  $("presentation-panel").hidden = !presentation;
  if (!presentation) return;
  const running = presentation.status === "running";
  const holding = running && presentation.phase === "holding";
  $("presentation-panel").dataset.status = presentation.status;
  $("presentation-title").textContent = presentation.title;
  $("presentation-phase").textContent =
    running && !connected
      ? "Connection unavailable"
      : running && driver.paused
        ? "Paused by presenter"
        : running
          ? holding
            ? "Holding for explanation"
            : "Executing stage"
          : title(presentation.status);
  $("presentation-progress").textContent =
    `Stage ${presentation.stage} of ${presentation.total}`;
  $("presentation-meter").max = presentation.total || 1;
  $("presentation-meter").value =
    presentation.status === "completed"
      ? presentation.total
      : Math.max(
          0,
          presentation.stage - (presentation.phase === "executing" ? 1 : 0),
        );
  $("presentation-stage").textContent = presentation.stageTitle;
  $("presentation-explanation").textContent = presentation.explanation;
  $("presentation-hold").textContent =
    running && !connected
      ? "Observation unavailable; inspect the connection."
      : holding
        ? presentation.manual
          ? "Waiting for Advance"
          : `${Math.ceil(Math.max(0, presentation.remainingMs) / 1000)}s remaining${driver.paused ? " · countdown paused" : " · or Advance when ready"}`
        : running
          ? "Observing and executing guarded application actions…"
          : "Presentation finished. Inspect the application outcome below.";
  $("presentation-reason").textContent = presentation.reason || "";
  $("presentation-reason").hidden = !presentation.reason;
}

function buildParameter(id, name, parameter) {
  const wrapper = node(
    "div",
    parameter.type === "boolean" ? "parameter boolean-parameter" : "parameter",
  );
  const label = node("label", "", parameter.label || name);
  const inputId = `parameter-${id}-${name}`;
  label.htmlFor = inputId;
  let input;
  if (parameter.type === "select") {
    input = node("select");
    if (!parameter.required && parameter.default === undefined) {
      const blank = node("option", "", "Choose…");
      blank.value = "";
      input.append(blank);
    }
    for (const [index, option] of (parameter.options || []).entries()) {
      const item = node("option", "", option.label);
      item.value = String(index);
      if (option.value === parameter.default) item.selected = true;
      input.append(item);
    }
  } else {
    input = node("input");
    input.type =
      parameter.type === "boolean"
        ? "checkbox"
        : parameter.type === "number"
          ? "number"
          : "text";
    if (parameter.type === "boolean")
      input.checked = parameter.default ?? false;
    else
      input.value =
        parameter.default === undefined ? "" : text(parameter.default);
    if (parameter.type === "number") {
      input.step = "any";
      if (parameter.minimum !== undefined) input.min = parameter.minimum;
      if (parameter.maximum !== undefined) input.max = parameter.maximum;
    }
    if (parameter.type === "text" && parameter.maxLength !== undefined)
      input.maxLength = parameter.maxLength;
  }
  input.id = inputId;
  input.name = name;
  let touched = false;
  input.addEventListener("input", () => {
    touched = true;
  });
  // Required boolean means the value must be supplied; false remains a valid value.
  if (parameter.type !== "boolean")
    input.required = Boolean(parameter.required);
  if (parameter.type === "boolean") wrapper.append(input, label);
  else wrapper.append(label, input);
  return {
    wrapper,
    input,
    value: () =>
      parameter.type === "boolean"
        ? input.checked
        : input.value === ""
          ? parameter.type === "text" && touched
            ? ""
            : undefined
          : parameter.type === "number"
            ? Number(input.value)
            : parameter.type === "select"
              ? parameter.options[Number(input.value)]?.value
              : input.value,
  };
}

function buildDescriptor(descriptor) {
  commandViews.clear();
  recipeViews.clear();
  stateViews.clear();
  $("model-name").textContent = descriptor.label || descriptor.id;
  $("model-version").textContent = `${descriptor.id} · v${descriptor.version}`;
  $("state-tree").replaceChildren();
  const states = descriptor.states || [];
  const emitted = new Set();
  const appendState = (state, container, ancestors = []) => {
    if (emitted.has(state.id)) return;
    emitted.add(state.id);
    const li = node("li");
    const entry = node(
      "div",
      `tree-entry${state.support === "planned" ? " planned" : ""}`,
    );
    entry.dataset.state = state.id;
    entry.append(
      node("span", "tree-dot"),
      node("span", "tree-label", state.label),
    );
    if (state.support === "planned")
      entry.append(node("span", "planned-label", "Planned"));
    li.append(entry);
    container.append(li);
    stateViews.set(state.id, { entry, ancestors });
    const children = states.filter((child) => child.parent === state.id);
    if (children.length) {
      const ul = node("ul");
      li.append(ul);
      for (const child of children)
        appendState(child, ul, [...ancestors, state.id]);
    }
  };
  for (const state of states.filter(
    (item) => !item.parent || !states.some((other) => other.id === item.parent),
  ))
    appendState(state, $("state-tree"));
  for (const state of states)
    if (!emitted.has(state.id)) appendState(state, $("state-tree"));
  $("commands").replaceChildren();
  for (const command of descriptor.commands || []) {
    if (command.recipeOnly) continue;
    const form = node("form", "command-card");
    form.dataset.commandId = command.id;
    const header = node("div", "command-heading");
    header.append(
      node("span", "command-icon", "↗"),
      node("h3", "", command.label),
    );
    form.append(header);
    const fields = new Map();
    for (const [name, parameter] of Object.entries(command.params || {})) {
      const field = buildParameter(command.id, name, parameter);
      fields.set(name, field);
      form.append(field.wrapper);
    }
    const reason = node("p", "command-reason");
    reason.id = `reason-${command.id}`;
    const button = node("button", "command-button", command.label);
    button.type = "submit";
    button.dataset.command = command.id;
    button.setAttribute("aria-describedby", reason.id);
    form.append(reason, button);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const params = {};
      for (const [name, field] of fields) {
        const value = field.value();
        if (value !== undefined) params[name] = value;
      }
      void run(command.id, params);
    });
    commandViews.set(command.id, { form, button, reason, fields });
    $("commands").append(form);
  }
  if (!commandViews.size)
    $("commands").append(
      node("p", "empty-state", "This model has no commands."),
    );
  $("recipes").replaceChildren();
  const commandLabels = new Map(
    (descriptor.commands || []).map((command) => [command.id, command.label]),
  );
  const stepLabel = (step) => commandLabels.get(step.command) || step.command;
  const appendRecipe = (recipe, parent, sharedCount = 0) => {
    const container = node("div", "recipe-card");
    const button = node("button", "recipe-button");
    button.type = "button";
    button.dataset.recipe = recipe.id;
    const label = node("span");
    label.append(
      node("strong", "", recipe.label),
      node("small", "", `${recipe.steps?.length ?? 0} steps`),
    );
    button.append(
      node("span", "recipe-icon", "▷"),
      label,
      node("span", "recipe-arrow", "→"),
    );
    const reason = node("p", "command-reason");
    reason.id = `recipe-reason-${recipe.id}`;
    button.setAttribute("aria-describedby", reason.id);
    button.addEventListener("click", () => void run(recipe.id, {}, true));
    container.append(button, reason);
    const preview = node("details", "recipe-step-preview");
    preview.append(node("summary", "", "Preview steps"));
    const steps = node("ol", "recipe-step-list");
    steps.setAttribute("aria-label", `Full sequence for ${recipe.label}`);
    for (const [index, step] of (recipe.steps || []).entries()) {
      const item = node("li", "");
      item.append(node("span", "", stepLabel(step)));
      if (index < sharedCount)
        item.append(node("small", "shared-step-label", "Shared step"));
      steps.append(item);
    }
    preview.append(steps);
    if (!steps.children.length)
      preview.append(node("p", "empty-state", "No authored steps."));
    container.append(preview);
    parent.append(container);
    recipeViews.set(recipe.id, { button, reason });
  };
  for (const path of groupRecipePaths(descriptor.recipes || [])) {
    if (!path.sharedSteps.length) {
      for (const recipe of path.recipes) appendRecipe(recipe, $("recipes"));
      continue;
    }
    const group = node("details", "recipe-path-group");
    group.dataset.flowGroup = path.recipes[0].id;
    group.open = true;
    const summary = node("summary", "recipe-path-summary");
    const heading = node("span", "recipe-path-heading");
    heading.append(
      node("small", "", "Shared path"),
      node("strong", "", stepLabel(path.sharedSteps[0])),
    );
    summary.append(
      heading,
      node("span", "recipe-path-count", `${path.recipes.length} flows`),
    );
    group.append(summary);
    const content = node("div", "recipe-path-content");
    content.append(node("p", "shared-path-caption", "Shared starting steps"));
    const sharedSteps = node("ol", "shared-path-steps");
    for (const step of path.sharedSteps)
      sharedSteps.append(node("li", "", stepLabel(step)));
    content.append(
      sharedSteps,
      node(
        "p",
        "shared-path-note",
        "Each flow runs its full sequence with fresh checks.",
      ),
    );
    const branches = node("div", "recipe-path-branches");
    for (const recipe of path.recipes)
      appendRecipe(recipe, branches, path.sharedSteps.length);
    content.append(branches);
    group.append(content);
    $("recipes").append(group);
  }
  if (!recipeViews.size)
    $("recipes").append(node("p", "empty-state", "No authored recipes."));
}

function updateAvailability() {
  const driver = latest?.driver;
  const blocked =
    pending || driver?.busy || driver?.paused || !latest?.connected;
  let available = 0;
  for (const [id, view] of commandViews) {
    const state = driver?.commands?.find((command) => command.id === id);
    const enabled = Boolean(state?.enabled);
    if (enabled) available++;
    view.button.disabled = Boolean(blocked || !enabled);
    view.form.classList.toggle("unavailable", !enabled);
    view.reason.textContent =
      state?.reason || (!enabled ? "Unavailable in the observed state" : "");
    view.reason.hidden = !view.reason.textContent;
    for (const field of view.fields.values())
      field.input.disabled = Boolean(blocked || !enabled);
  }
  $("command-count").textContent = `${available} available`;
  for (const [id, view] of recipeViews) {
    const state = driver?.recipes?.find((recipe) => recipe.id === id);
    view.button.disabled = Boolean(blocked || !state?.enabled);
    view.reason.textContent =
      state?.reason ||
      (!state?.enabled ? "Unavailable in the observed state" : "");
    view.reason.hidden = !view.reason.textContent;
  }
  for (const [id, view] of presentationViews) {
    const state = driver?.presentations?.find(
      (presentation) => presentation.id === id,
    );
    view.button.disabled = Boolean(blocked || !state?.enabled);
    view.reason.textContent =
      state?.reason ||
      (!state?.enabled ? "Unavailable in the observed state" : "");
    view.reason.hidden = !view.reason.textContent;
  }
  const presentation = driver?.presentation;
  $("advance").disabled = Boolean(
    advancePending ||
      !latest?.connected ||
      driver?.paused ||
      presentation?.status !== "running" ||
      presentation?.phase !== "holding",
  );
  $("pause").disabled = !latest?.connected || !driver?.busy;
  $("pause").hidden = Boolean(driver?.paused);
  $("resume").hidden = !driver?.paused;
  $("resume").disabled = !latest?.connected;
  $("stop").disabled = !latest?.connected || !driver?.busy;
  $("speed").disabled = !latest?.connected;
}

function fillFacts(target, values) {
  target.replaceChildren();
  for (const { label, value } of values)
    target.append(node("dt", "", label), node("dd", "", text(value)));
  if (!values.length) target.append(node("dt", "", "No additional facts"));
}

// This is a display of the runtime's canonical flow, never an execution plan.
// A viewer may join a run started by another client, so local button clicks are
// not a source of truth for either its identity or its completed steps.
function renderFlow(driver, connected) {
  const active = Boolean(driver.busy);
  // Evidence can remain pending before lastResult belongs to this run. Reuse
  // the result panel's validated run/phase/status guard instead of inferring
  // execution from retained results; keep the legacy same-run cleanup fallback.
  const finalizing = Boolean(
    currentFinalization(driver) ||
      (active && driver.runId && driver.lastResult?.runId === driver.runId),
  );
  const run = active
    ? driver.activeRun
    : driver.lastResult?.runId === driver.runId
      ? driver.lastResult
      : null;
  const descriptor = driver.descriptor;
  const recipe = run?.recipe
    ? descriptor?.recipes?.find(({ id }) => id === run.command)
    : null;
  const command = !run?.recipe
    ? descriptor?.commands?.find(({ id }) => id === run?.command)
    : null;
  const steps = recipe?.steps || (command ? [{ command: command.id }] : []);
  const progress = driver.progress;
  const completed = progress?.completed ?? progress?.index ?? progress?.step;
  const hasProgress =
    Number.isInteger(completed) &&
    completed >= 0 &&
    completed <= steps.length &&
    progress?.total === steps.length;
  const holding =
    active &&
    !finalizing &&
    driver.presentation?.phase === "holding" &&
    driver.presentation?.status === "running";
  const current = holding ? driver.presentation.stage - 1 : completed;
  const label = (id) =>
    descriptor?.commands?.find((item) => item.id === id)?.label || id;
  $("flow-title").textContent =
    recipe?.label ||
    command?.label ||
    driver.presentation?.title ||
    (active ? "Active run" : "Choose a command or flow");
  $("flow-panel").dataset.runId = driver.runId || "";
  $("flow-panel").dataset.observation = connected ? "current" : "stale";
  $("flow-run-identity").textContent = driver.runId
    ? `Run ${text(driver.runId)}`
    : "";
  const phase = finalizing
    ? "Finalizing"
    : active
      ? driver.paused
        ? "Paused"
        : holding
          ? "Holding"
          : "Running"
      : run
        ? title(run.execution || "unknown")
        : "Ready";
  $("flow-status").textContent =
    (!connected ? "Last observed · " : "") +
    (finalizing
      ? "Finalizing · Awaiting final outcome and cleanup"
      : steps.length && !hasProgress
        ? `${phase} · Step progress unavailable`
        : active && steps.length
          ? current < steps.length
            ? `${phase} · Step ${current + 1} of ${steps.length}: ${label(steps[current].command)}`
            : `${phase} · Finalizing ${steps.length} steps`
          : run && steps.length
            ? `${phase} · ${completed} of ${steps.length} steps finished`
            : active
              ? `${phase} · Flow details unavailable`
              : "Select an authored action to follow its progress here.");
  const list = $("flow-steps");
  // Keep scroll position stable across polls. Only replace the list when its
  // actual display changes, then reveal a new current step within this panel.
  const items = steps.map((step, index) => {
    const status = !hasProgress
      ? "unknown"
      : active && !finalizing && index === current
        ? "current"
        : index < completed
          ? "done"
          : active && !finalizing
            ? "upcoming"
            : index === completed && progress?.lastAction === step.command
              ? "interrupted"
              : "not-run";
    return { label: label(step.command), status };
  });
  const key = JSON.stringify([driver.runId, connected, items, holding]);
  if (list.dataset.renderKey !== key) {
    list.dataset.renderKey = key;
    list.replaceChildren();
    for (const [index, item] of items.entries()) {
      const row = node("li", "flow-step");
      row.dataset.stepStatus = item.status;
      if (item.status === "current" && connected)
        row.setAttribute("aria-current", "step");
      row.append(
        node("span", "flow-step-label", `${index + 1}. ${item.label}`),
        node(
          "span",
          "flow-step-state",
          {
            done: "Finished",
            current: !connected
              ? "Last observed"
              : holding
                ? "Holding"
                : "Current",
            upcoming: "Upcoming",
            interrupted: "Needs attention",
            "not-run": "Not run",
            unknown: "Not observed",
          }[item.status],
        ),
      );
      list.append(row);
    }
    const row = list.querySelector('[aria-current="step"]');
    if (row) {
      const rect = row.getBoundingClientRect();
      const container = list.getBoundingClientRect();
      if (rect.bottom > container.bottom)
        list.scrollTop += rect.bottom - container.bottom;
      else if (rect.top < container.top)
        list.scrollTop += rect.top - container.top;
    }
  }
  list.hidden = !items.length;
}

function renderObservation(driver, connected) {
  const stateId = driver.state?.id;
  const current = stateViews.get(stateId);
  document.querySelector(".sidebar").dataset.observation = connected
    ? "current"
    : "stale";
  $("observation-status").textContent = connected
    ? "Current observation"
    : "Last observed · disconnected";
  for (const [id, view] of stateViews) {
    view.entry.classList.toggle("active", connected && id === stateId);
    view.entry.classList.toggle(
      "ancestor",
      connected && Boolean(current?.ancestors.includes(id)),
    );
    if (id === stateId && connected)
      view.entry.setAttribute("aria-current", "true");
    else view.entry.removeAttribute("aria-current");
  }
  const stateLabel =
    driver.descriptor?.states?.find((state) => state.id === stateId)?.label ||
    stateId ||
    "Unknown application state";
  $("state-label").textContent = connected
    ? stateLabel
    : `Last observed: ${stateLabel}`;
}

function renderImage() {
  const connected = Boolean(latest?.connected);
  const received = $("browser-image").naturalWidth > 0;
  // A failed initial request can finish before this module installs its listener.
  if ($("browser-image").complete && !received) streamFailed = true;
  const state = !connected
    ? "disconnected"
    : streamFailed
      ? "unavailable"
      : received && !awaitingStream
        ? "live"
        : "waiting";
  document.querySelector(".browser-panel").dataset.imageState = state;
  $("mirror-status").textContent = {
    disconnected: received ? "Last captured frame" : "Disconnected",
    unavailable: "Image unavailable",
    waiting: "Waiting for image",
    live: "Live mirror",
  }[state];
  $("browser-image").alt =
    state === "live"
      ? "Live mirror of the controlled browser; use the command panel to interact"
      : "Last captured browser image; current appearance is not confirmed";
  $("stream-error").hidden = state === "live";
  $("stream-error-title").textContent = {
    disconnected: received
      ? "Last captured frame — disconnected"
      : "Browser disconnected — no image available",
    unavailable: "Browser image unavailable",
    waiting: "Waiting for a browser image",
    live: "",
  }[state];
  $("stream-error-detail").textContent =
    state === "disconnected"
      ? "The image and observation are not current. Reconnecting never replays commands."
      : state === "unavailable"
        ? "The driver is connected, but the browser image is unavailable."
        : "The controlled browser will appear here when an image arrives.";
  $("frame-status").textContent =
    state === "live"
      ? "Watching controlled session"
      : state === "disconnected"
        ? "Disconnected"
        : $("mirror-status").textContent;
}

function render(snapshot) {
  const frontend = snapshot.frontend;
  $("frontend-identity").hidden = !frontend;
  $("frontend-warning").hidden = true;
  if (frontend) {
    $("frontend-name").textContent = frontend.name;
    document.title = `${frontend.name} · Daedlo`;
    fillFacts($("frontend-details"), [
      { label: "Target", value: frontend.targetOrigin || "Not configured" },
      {
        label: "Observed origin",
        value: frontend.currentOrigin || "Unavailable",
      },
      {
        label: "Model",
        value: `${frontend.model.id}@${frontend.model.version}`,
      },
      { label: "Evidence", value: frontend.evidenceLocation },
      {
        label: "Ownership",
        value: `Browser: ${frontend.ownership.browser}; context: ${frontend.ownership.context}; application: ${frontend.ownership.application}`,
      },
    ]);
    const mismatch =
      frontend.matchesTarget === false || frontend.matchesModel === false;
    $("frontend-warning").hidden = !mismatch;
    $("frontend-warning").textContent = mismatch
      ? "Target or model mismatch. Commands are disabled for this frontend."
      : "";
  }
  const recovered = latest?.connected === false && snapshot.connected;
  latest = snapshot;
  if (recovered) reconnectImage();
  const driver = snapshot.driver || {};
  if (driver.descriptor) {
    const key = JSON.stringify(driver.descriptor);
    if (key !== descriptorKey) {
      buildDescriptor(driver.descriptor);
      descriptorKey = key;
    }
  }
  const presentations = driver.presentations || [];
  const catalogKey = JSON.stringify(
    presentations.map(({ id, title, explanation }) => ({
      id,
      title,
      explanation,
    })),
  );
  if (catalogKey !== presentationKey) {
    buildPresentations(presentations);
    presentationKey = catalogKey;
  }
  renderPresentation(driver, snapshot.connected);
  if (
    startingPresentation &&
    driver.busy &&
    driver.presentation?.status === "running"
  ) {
    startingPresentation = false;
    message("Presentation running…");
  }
  $("connection").textContent = snapshot.connected
    ? "Connected"
    : "Disconnected";
  $("connection").classList.toggle("connected", snapshot.connected);
  $("live-dot").classList.toggle("offline", !snapshot.connected);
  $("connection-error").hidden = snapshot.connected;
  $("connection-error").textContent =
    driver.error ||
    "The controlled browser or driver is unavailable. Commands are disabled.";
  $("frame-status").textContent = snapshot.connected
    ? "Watching controlled session"
    : "Connection unavailable";
  $("frame-count").textContent = `${snapshot.frames || 0} frames`;
  renderObservation(driver, snapshot.connected);
  fillFacts($("display-facts"), driver.display || []);
  fillFacts(
    $("identity-values"),
    Object.entries(driver.identity || {}).map(([label, value]) => ({
      label,
      value,
    })),
  );
  $("execution-state").textContent = currentFinalization(driver)
    ? "Finalizing"
    : driver.paused
      ? "Driver paused"
      : title(
          typeof driver.execution === "object"
            ? driver.execution.status
            : driver.execution || "idle",
        );
  $("run-id").textContent = driver.runId ? `Run ${text(driver.runId)}` : "";
  $("speed").value = driver.speed || "normal";
  const progress = driver.progress;
  const index = progress?.completed ?? progress?.index ?? progress?.step ?? 0;
  const total = progress?.total || 0;
  $("progress-bar").classList.toggle("running", Boolean(driver.busy));
  $("progress-bar").classList.toggle("paused", Boolean(driver.paused));
  $("progress-label").textContent =
    progress?.label ||
    (total
      ? `Step ${index} of ${total}`
      : driver.busy
        ? "Executing and observing the application…"
        : "Ready for a command");
  renderResults(driver);
  if (!snapshot.connected) {
    $("execution-state").textContent = "Connection unavailable";
    if (driver.busy)
      $("active-outcome-label").textContent =
        "Connection unavailable; final application outcome unknown";
  }
  renderFlow(driver, snapshot.connected);
  renderImage();
  updateAvailability();
  if (
    streamFailed &&
    snapshot.connected &&
    Date.now() - lastStreamRetry > 5000
  ) {
    reconnectImage();
  }
}

function reconnectImage() {
  // Status recovery is not image recovery. Establish a new read-only stream and
  // wait for its first load before making a live-image claim again.
  awaitingStream = true;
  streamFailed = false;
  lastStreamRetry = Date.now();
  $("browser-image").src = `/stream?reconnect=${lastStreamRetry}`;
}

async function refresh() {
  try {
    const response = await fetch("/status", { cache: "no-store" });
    if (!response.ok) throw Error("Viewer status unavailable");
    render(await response.json());
  } catch {
    if (latest) latest = { ...latest, connected: false };
    $("connection").textContent = "Disconnected";
    $("connection").classList.remove("connected");
    $("connection-error").textContent =
      "The local viewer is unavailable. Existing commands are never replayed when it reconnects.";
    $("connection-error").hidden = false;
    $("live-dot").classList.add("offline");
    const driver = latest?.driver || {};
    renderPresentation(driver, false);
    renderObservation(driver, false);
    renderFlow(driver, false);
    renderImage();
    $("execution-state").textContent = "Connection unavailable";
    if (driver.busy)
      $("active-outcome-label").textContent =
        "Connection unavailable; final application outcome unknown";
    updateAvailability();
  }
}

for (const action of ["pause", "resume", "stop"])
  $("" + action).addEventListener("click", async () => {
    try {
      await mutate("/control", { action });
      await refresh();
    } catch (error) {
      message(error.message, true);
    }
  });
$("advance").addEventListener("click", async () => {
  const presentation = latest?.driver?.presentation;
  if (
    advancePending ||
    !latest?.connected ||
    latest.driver.paused ||
    presentation?.status !== "running" ||
    presentation?.phase !== "holding"
  )
    return;
  const stageId = presentation.stageId;
  advancePending = true;
  updateAvailability();
  try {
    await mutate("/control", { action: "advance", value: stageId });
    message("");
  } catch (error) {
    message(error.message, true);
  } finally {
    await refresh();
    advancePending = false;
    updateAvailability();
  }
});
$("speed").addEventListener("change", async () => {
  try {
    await mutate("/control", { action: "speed", value: $("speed").value });
  } catch (error) {
    message(error.message, true);
  }
  await refresh();
});
$("browser-image").addEventListener("error", () => {
  streamFailed = true;
  awaitingStream = false;
  renderImage();
});
$("browser-image").addEventListener("load", () => {
  streamFailed = false;
  awaitingStream = false;
  renderImage();
});
async function poll() {
  await refresh();
  setTimeout(poll, 500);
}
void poll();
