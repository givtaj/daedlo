const $ = (selector) => document.querySelector(selector);
const sessionKey = "daedlo-universal-access";
const locationUrl = new URL(location.href);
const fragmentToken = new URLSearchParams(locationUrl.hash.slice(1)).get(
  "token",
);
let token = fragmentToken;
try {
  if (fragmentToken && /^[a-f0-9]{32,128}$/i.test(fragmentToken))
    sessionStorage.setItem(sessionKey, fragmentToken);
  else token = sessionStorage.getItem(sessionKey);
} catch {
  /* A private link remains usable when browser storage is unavailable. */
}
if (locationUrl.hash) {
  locationUrl.hash = "";
  history.replaceState(null, "", locationUrl);
}

let catalogVersion = null;
let currentRun = null,
  knowledgeView = false,
  knowledgeGeneration = 0,
  evidenceGeneration = 0;
let recordBusy = false,
  evidenceBusy = false,
  reviewLoading = false,
  editingRecord = null,
  retainedSourceRefs = [],
  evidenceItems = [],
  previewUrl = null;
let recordsCursor = null,
  loadedRecords = [],
  evidenceCursor = null,
  evidencePending = [];

let liveLaunch = true;
let targets = [],
  selected = null,
  generation = 0,
  listGeneration = 0,
  detailGeneration = 0;
let cursors = [null],
  pageIndex = 0,
  nextCursor = null,
  indexing = false,
  launching = false,
  listBusy = false;
const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined && text !== null) element.textContent = String(text);
  if (className) element.className = className;
  return element;
};
const words = (value) =>
  typeof value === "string" && value ? value.replaceAll("_", " ") : "Unknown";
const effectStatus = (value) =>
  words(typeof value === "string" ? value : value?.status);
function time(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "medium",
      }).format(date)
    : "Time not recorded";
}
function errorMessage(error) {
  return (
    error?.message ||
    "Workspace history is unavailable. Try opening the workspace again."
  );
}
function notice(message) {
  $("#page-error").textContent = message || "";
  $("#page-error").hidden = !message;
}
async function api(path, body) {
  if (!token || !/^[a-f0-9]{32,128}$/i.test(token))
    throw Error(
      "Open the private workspace link returned by Daedlo Universal to access this history.",
    );
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    cache: "no-store",
    credentials: "omit",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok)
    throw Error(
      result.error?.message ||
        (response.status === 401
          ? "The workspace link is no longer valid. Open the current private workspace link."
          : "The workspace could not complete this request."),
    );
  return result;
}
const targetPath = (id) => `/api/targets/${encodeURIComponent(id)}`;
function updateUrl(runId, replace = false, sourceKind = "journal") {
  const url = new URL(location.href);
  if (selected) url.searchParams.set("target", selected.id);
  else url.searchParams.delete("target");
  if (runId) url.searchParams.set("run", runId);
  else url.searchParams.delete("run");
  if (runId && sourceKind === "archive")
    url.searchParams.set("source", "archive");
  else url.searchParams.delete("source");
  if (url.href !== location.href)
    history[replace ? "replaceState" : "pushState"](null, "", url);
}
function controls() {
  $("#launch").disabled = !selected || launching || !liveLaunch;
  $("#launch").textContent = !liveLaunch
    ? "Use container integration runner"
    : launching
      ? "Opening session…"
      : "Open live session";
  $("#refresh-history").disabled = !selected || indexing;
  $("#refresh-history").textContent = indexing
    ? "Refreshing…"
    : "Refresh history";
  $("#previous-page").disabled = listBusy || pageIndex === 0;
  $("#next-page").disabled = listBusy || !nextCursor;
  $("#page-number").textContent = `Page ${pageIndex + 1}`;
  reviewControls();
}
function resetDetail() {
  detailGeneration++;
  currentRun = null;
  const panel = $("#run-detail");
  delete panel.dataset.runId;
  delete panel.dataset.sourceKind;
  const empty = node("div", null, "empty detail-empty");
  empty.append(node("span", "≡", "empty-mark"));
  const title = node("h2", "Inspect a recorded run");
  title.id = "detail-heading";
  empty.append(
    title,
    node("p", "Choose a run to see its saved result and recording status."),
    node("p", "Live application state is unknown."),
  );
  panel.replaceChildren(empty);
}
function renderTarget() {
  $("#target-title").textContent = selected?.label || "Recorded work";
  $("#target-subtitle").textContent = selected
    ? `${selected.environment} · ${selected.origin}`
    : "Choose a target to inspect its saved runs.";
  const details = $("#target-details");
  details.replaceChildren();
  if (selected)
    for (const [label, value] of [
      ["Environment", selected.environment],
      ["Origin", selected.origin],
      ["Model", `${selected.model.id} · ${selected.model.version}`],
      ["Target ID", selected.id],
    ])
      details.append(node("dt", label), node("dd", value));
}
function renderRuns(runs) {
  const list = $("#history-list");
  list.replaceChildren();
  if (!runs.length) {
    list.append(
      node(
        "p",
        "No indexed runs for this target. Refresh history to include newly recorded work.",
        "empty",
      ),
    );
    return;
  }
  const table = node("table");
  const head = node("thead"),
    heading = node("tr");
  for (const label of ["Run", "Recording", "Execution", "Effect"])
    heading.append(node("th", label));
  head.append(heading);
  table.append(head);
  const body = node("tbody");
  for (const run of runs) {
    const row = node("tr"),
      description = node("td"),
      sourceKind = run.sourceKind === "archive" ? "archive" : "journal";
    row.dataset.sourceKind = sourceKind;
    const button = node("button", run.runId, "run-link");
    button.type = "button";
    button.title = run.runId;
    button.addEventListener("click", () => {
      updateUrl(run.runId, false, sourceKind);
      void loadRun(run.runId, sourceKind);
    });
    const command = words(
      typeof run.recipe === "string" ? run.recipe : run.command,
    );
    description.append(
      node(
        "span",
        sourceKind === "archive" && !run.command ? "Completed report" : command,
        "run-command",
      ),
      button,
      node(
        "span",
        sourceKind === "archive"
          ? `Archived ${time(run.archivedAt)}`
          : time(run.startedAt),
        "run-time",
      ),
    );
    row.append(description);
    for (const [label, value] of [
      [
        "Recording",
        sourceKind === "archive"
          ? "Imported report"
          : run.status === "finished"
            ? "Finished"
            : "Incomplete",
      ],
      ["Execution", words(run.execution)],
      ["Effect", effectStatus(run.effect)],
    ]) {
      const cell = node("td");
      cell.dataset.label = label;
      cell.append(
        node(
          "span",
          value,
          `status-badge${value === "Incomplete" || value === "uncertain" ? " attention" : ""}`,
        ),
      );
      row.append(cell);
    }
    body.append(row);
  }
  table.append(body);
  list.append(table);
}
async function loadRuns() {
  if (!selected) return;
  const current = generation,
    requestId = ++listGeneration,
    targetId = selected.id;
  listBusy = true;
  nextCursor = null;
  controls();
  const list = $("#history-list");
  list.setAttribute("aria-busy", "true");
  list.replaceChildren(node("p", "Loading saved runs…", "empty"));
  try {
    const params = new URLSearchParams({ limit: "20" });
    if (cursors[pageIndex]) params.set("cursor", cursors[pageIndex]);
    const result = await api(`${targetPath(targetId)}/runs?${params}`);
    if (current !== generation || requestId !== listGeneration) return;
    renderRuns(result.runs);
    nextCursor = result.nextCursor;
    list.dataset.targetId = targetId;
    $("#index-status").textContent = result.indexedAt
      ? `Last indexed ${time(result.indexedAt)}`
      : "This target has no indexed history yet.";
  } catch (error) {
    if (current !== generation || requestId !== listGeneration) return;
    list.replaceChildren(
      node(
        "p",
        "Saved history is unavailable. No application action was started.",
        "empty",
      ),
    );
    list.dataset.targetId = targetId;
    notice(errorMessage(error));
  } finally {
    if (current === generation && requestId === listGeneration) {
      listBusy = false;
      list.setAttribute("aria-busy", "false");
      controls();
    }
  }
}
function factList(entries) {
  const list = node("dl", null, "result-facts");
  for (const [label, value] of entries)
    list.append(node("dt", label), node("dd", value));
  return list;
}
function renderImportedReport(result, content) {
  content.classList.add("imported-detail");
  const report = result.report,
    last = report?.lastResult,
    provenance = result.provenance ?? {},
    installation = provenance.installation ?? {},
    source = provenance.source ?? {},
    limitations = new Set(provenance.limitations ?? []);
  content.querySelector(".eyebrow").textContent = "IMPORTED REPORT";
  content.querySelector("#detail-heading").textContent = "Imported report";
  content.append(
    factList([
      ["Recording", "Imported report"],
      ["Execution", words(last?.execution)],
      ["Application outcome", words(last?.outcome?.kind)],
      ["Effect evidence", effectStatus(last?.effect)],
      ["History", "Completed report only"],
      [
        "Source format",
        `Managed JSON report · schema ${source.schemaVersion ?? 1}`,
      ],
      ["Archived", time(provenance.recordedAt)],
      ["Imported", time(provenance.importedAt)],
      ["Installation", installation.id ?? "Not recorded"],
      ["Runtime version", installation.version ?? "Not recorded"],
      [
        "Model",
        installation.model
          ? `${installation.model.id} · ${installation.model.version}`
          : "Not recorded",
      ],
    ]),
    node(
      "p",
      "Completed report only. Journal start and intent history was not recorded. Import cannot reconstruct the missing journal history.",
      "notice attention",
    ),
    node(
      "p",
      "The target mapping was chosen explicitly during import. It does not verify historical origin or authentication.",
      "subtle",
    ),
  );
  if (last?.outcome?.label)
    content.append(node("p", last.outcome.label, "outcome-message"));
  if (report?.eventRange?.truncated || limitations.has("events_truncated"))
    content.append(
      node(
        "p",
        "The original report's event history was truncated. Missing events remain unavailable.",
        "notice attention",
      ),
    );
  if (!report?.eventRange || limitations.has("event_range_missing"))
    content.append(
      node(
        "p",
        "The original report does not declare its event range; event completeness is unknown.",
        "notice attention",
      ),
    );
  if (
    !installation.version ||
    !installation.sourceSha256 ||
    !installation.model
  )
    content.append(
      node(
        "p",
        "Some original installation metadata was not recorded. Current target settings have not been substituted.",
        "subtle",
      ),
    );
  if (limitations.has("run_timestamps_missing"))
    content.append(
      node(
        "p",
        "Run start or finish time was not recorded. Archive time is shown separately.",
        "subtle",
      ),
    );
  const events = Array.isArray(report?.events) ? report.events : [],
    detail = node("details", null, "event-details"),
    entries = node("ol", null, "events");
  detail.append(node("summary", `Retained report events (${events.length})`));
  for (const event of events) {
    const entry = node("li"),
      stamp = node("time", time(event.at), "subtle");
    if (Number.isSafeInteger(event.sequence) && event.sequence > 0)
      entry.value = event.sequence;
    if (typeof event.at === "string") stamp.dateTime = event.at;
    entry.append(node("span", words(event.type)), stamp);
    entries.append(entry);
  }
  if (!events.length)
    detail.append(
      node(
        "p",
        "No runtime events were retained in the original report.",
        "subtle",
      ),
    );
  detail.append(entries);
  content.append(
    detail,
    node(
      "p",
      "Choose a recorded journal run to attach evidence or propose findings. This imported report remains available here.",
      "subtle",
    ),
  );
}
async function loadRun(runId, sourceKind = "journal") {
  if (!selected) return;
  const current = generation,
    requestId = ++detailGeneration;
  if (currentRun?.runId !== runId || currentRun?.sourceKind !== sourceKind) {
    if (editingRecord) retainedSourceRefs = [];
    else resetCompose();
  }
  currentRun = null;
  evidenceItems = [];
  evidenceCursor = null;
  evidencePending = [];
  evidenceGeneration++;
  clearPreview();
  $("#evidence-list").replaceChildren();
  updateRunSource();
  const panel = $("#run-detail");
  delete panel.dataset.runId;
  delete panel.dataset.sourceKind;
  panel.replaceChildren(node("p", "Reading recorded run…", "empty"));
  try {
    const result = await api(
      `${targetPath(selected.id)}/${sourceKind === "archive" ? "imports" : "runs"}/${encodeURIComponent(runId)}`,
    );
    if (current !== generation || requestId !== detailGeneration) return;
    const content = node("div", null, "detail-content");
    content.append(node("p", "RECORDED RUN", "eyebrow"));
    const title = node("h2", "Recorded run");
    title.id = "detail-heading";
    content.append(
      title,
      node("p", runId, "run-id"),
      node("p", "Live application state is unknown.", "notice"),
    );
    if (sourceKind === "archive") {
      renderImportedReport(result, content);
      panel.replaceChildren(content);
      panel.dataset.runId = runId;
      panel.dataset.sourceKind = "archive";
      currentRun = { ...result, sourceKind };
      updateRunSource();
      if (knowledgeView) await loadEvidence();
      return;
    }
    const report = result.report,
      last = report?.lastResult;
    content.append(
      factList([
        ["Recording", result.status === "finished" ? "Finished" : "Incomplete"],
        ["Execution", words(last?.execution || result.recovery?.execution)],
        ["Application outcome", words(last?.outcome?.kind)],
        [
          "Effect evidence",
          effectStatus(last?.effect || result.recovery?.effect),
        ],
        [
          "History",
          result.historyComplete ? "Complete journal" : "Incomplete journal",
        ],
      ]),
    );
    if (last?.outcome?.label)
      content.append(node("p", last.outcome.label, "outcome-message"));
    if (!result.historyComplete)
      content.append(
        node(
          "p",
          "This recording is incomplete. Application effects may remain unresolved.",
          "notice attention",
        ),
      );
    if (result.partialTail)
      content.append(
        node(
          "p",
          "The journal ends with an incomplete record; the original data has been preserved.",
          "subtle",
        ),
      );
    if (report?.eventRange?.truncated)
      content.append(
        node(
          "p",
          "Detailed run events were truncated by the recording limit.",
          "subtle",
        ),
      );
    const events = node("details", null, "event-details");
    events.append(
      node("summary", `Recorded events (${result.events?.length ?? 0})`),
    );
    const entries = node("ol", null, "events");
    for (const event of result.events || []) {
      const entry = node("li");
      entry.append(
        node("span", words(event.type)),
        node("time", time(event.timestamp), "subtle"),
      );
      entries.append(entry);
    }
    events.append(entries);
    content.append(events);
    panel.replaceChildren(content);
    panel.dataset.runId = runId;
    panel.dataset.sourceKind = "journal";
    currentRun = { ...result, sourceKind: "journal" };
    const review = node(
      "button",
      "Review evidence & findings",
      "secondary compact",
    );
    review.type = "button";
    review.addEventListener("click", () => setWorkspaceView(true));
    content.append(review);
    updateRunSource();
    if (knowledgeView) await loadEvidence();
  } catch (error) {
    if (current !== generation || requestId !== detailGeneration) return;
    resetDetail();
    notice(errorMessage(error));
  }
}
async function selectTarget(
  id,
  { navigate = true, runId, sourceKind = "journal" } = {},
) {
  generation++;
  listGeneration++;
  selected = targets.find((target) => target.id === id) || null;
  indexing = false;
  launching = false;
  cursors = [null];
  pageIndex = 0;
  nextCursor = null;
  notice(null);
  resetDetail();
  resetReview();
  renderTarget();
  $("#live-link").hidden = true;
  $("#live-link").removeAttribute("href");
  $("#live-message").textContent =
    "Opening history does not start or control your application.";
  $("#target-select").value = selected?.id || "";
  controls();
  if (!selected) {
    $("#history-list").replaceChildren(
      node("p", "Choose a registered target to inspect its history.", "empty"),
    );
    $("#history-list").setAttribute("aria-busy", "false");
    if (id) notice("This target is not registered in the current workspace.");
    return;
  }
  if (navigate) updateUrl(runId, false, sourceKind);
  const current = generation;
  await loadRuns();
  if (runId && current === generation) await loadRun(runId, sourceKind);
  if (knowledgeView && current === generation) await loadKnowledge();
}
$("#target-select").addEventListener("change", (event) => {
  void selectTarget(event.target.value);
});
$("#next-page").addEventListener("click", () => {
  if (!nextCursor || listBusy) return;
  cursors = cursors.slice(0, pageIndex + 1);
  cursors.push(nextCursor);
  pageIndex++;
  void loadRuns();
});
$("#previous-page").addEventListener("click", () => {
  if (pageIndex && !listBusy) {
    pageIndex--;
    void loadRuns();
  }
});
$("#refresh-history").addEventListener("click", async () => {
  if (!selected || indexing) return;
  const current = generation,
    target = selected;
  indexing = true;
  notice(null);
  controls();
  try {
    await api(`${targetPath(target.id)}/index`, { revision: target.revision });
    if (current !== generation) return;
    cursors = [null];
    pageIndex = 0;
    await loadRuns();
  } catch (error) {
    if (current === generation) notice(errorMessage(error));
  } finally {
    if (current === generation) {
      indexing = false;
      controls();
    }
  }
});
$("#launch").addEventListener("click", async () => {
  if (!selected || launching) return;
  const current = generation,
    target = selected;
  launching = true;
  notice(null);
  controls();
  try {
    const result = await api(`${targetPath(target.id)}/launch`, {
      revision: target.revision,
    });
    if (current !== generation) return;
    const url = new URL(result.live.viewerUrl);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password
    )
      throw Error("The live session did not return a local viewer link.");
    $("#live-link").href = url.href;
    $("#live-link").hidden = false;
    $("#live-message").textContent = result.live.reused
      ? "Your existing session is ready. Open the live viewer to control it."
      : "The session is ready. Open the live viewer to control it.";
  } catch (error) {
    if (current === generation) notice(errorMessage(error));
  } finally {
    if (current === generation) {
      launching = false;
      controls();
    }
  }
});
addEventListener("popstate", () => {
  const url = new URL(location.href);
  void selectTarget(url.searchParams.get("target") || targets[0]?.id, {
    navigate: false,
    runId: url.searchParams.get("run"),
    sourceKind:
      url.searchParams.get("source") === "archive" ? "archive" : "journal",
  });
});

function reviewNotice(message) {
  $("#knowledge-error").textContent = message || "";
  $("#knowledge-error").hidden = !message;
}
function reviewControls() {
  const writable = Boolean(selected && [2, 3, 4].includes(catalogVersion));
  const journalSelected = currentRun?.sourceKind === "journal";
  $("#save-evidence").disabled =
    !writable || !journalSelected || evidenceBusy || recordBusy;
  $("#save-evidence").textContent = evidenceBusy
    ? "Saving evidence…"
    : "Attach evidence";
  $("#save-record").disabled =
    !writable || !journalSelected || recordBusy || evidenceBusy;
  $("#save-record").textContent = recordBusy
    ? "Saving note…"
    : editingRecord
      ? "Propose revision"
      : "Propose note";
  $("#reload-knowledge").disabled =
    !selected || recordBusy || evidenceBusy || reviewLoading;
  $("#target-knowledge").setAttribute("aria-busy", String(reviewLoading));
  $("#record-kind").disabled = Boolean(editingRecord);
  for (const button of document.querySelectorAll("[data-review-mutation]"))
    button.disabled = !writable || recordBusy || evidenceBusy;
}
function clearPreview() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  $("#evidence-preview").replaceChildren();
  $("#evidence-preview").hidden = true;
}
function resetCompose() {
  editingRecord = null;
  retainedSourceRefs = [];
  $("#record-form").reset();
  $("#cancel-revision").hidden = true;
  $("#compose-heading").textContent = "Write a note";
  for (const checkbox of document.querySelectorAll(".evidence-select"))
    checkbox.checked = false;
  reviewControls();
}
function resetReview() {
  knowledgeGeneration++;
  evidenceGeneration++;
  recordBusy = false;
  evidenceBusy = false;
  reviewLoading = false;
  evidenceItems = [];
  loadedRecords = [];
  recordsCursor = null;
  clearPreview();
  resetCompose();
  $("#evidence-form").reset();
  $("#knowledge-summary").replaceChildren(
    node(
      "p",
      "Open Evidence & knowledge to read this target's reviewed notes.",
      "empty",
    ),
  );
  $("#knowledge-records").replaceChildren(
    node("p", "No saved notes loaded.", "empty"),
  );
  $("#evidence-list").replaceChildren(
    node("p", "Choose a recorded run in History.", "empty"),
  );
  reviewNotice(null);
  updateRunSource();
}
function updateRunSource() {
  if (currentRun?.sourceKind === "archive") {
    $("#evidence-run").textContent = `Imported report · ${currentRun.runId}`;
    $("#record-source").textContent =
      "Choose a recorded journal run to attach evidence or propose a note. Imported reports retain only their original completed-report history.";
    $("#record-event").replaceChildren(
      node("option", "No journal source selected"),
    );
    $("#record-event").firstChild.value = "";
    reviewControls();
    return;
  }
  $("#evidence-run").textContent = currentRun
    ? `Recorded run · ${currentRun.runId}`
    : "Choose a recorded run in History.";
  $("#record-source").textContent = currentRun
    ? `Source run: ${currentRun.runId}. Checked evidence files are linked to this note.${retainedSourceRefs.length ? " Earlier source references are retained. Choosing another run replaces the sources for this revision." : ""}`
    : "Choose a recorded run first. Checked evidence files are linked to this note.";
  const select = $("#record-event");
  select.replaceChildren(node("option", "Entire recorded run"));
  select.firstChild.value = "";
  for (const event of currentRun?.events || []) {
    const option = node("option", `${event.sequence} · ${words(event.type)}`);
    option.value = String(event.sequence);
    select.append(option);
  }
  reviewControls();
}
function setWorkspaceView(review) {
  knowledgeView = review;
  $("#history-view").hidden = review;
  $("#target-knowledge").hidden = !review;
  $("#history-tab").setAttribute("aria-pressed", String(!review));
  $("#knowledge-tab").setAttribute("aria-pressed", String(review));
  if (review) void loadKnowledge();
}
function sourceButtons(refs) {
  const links = node("div", null, "source-links");
  const seen = new Set();
  for (const ref of refs || []) {
    const key = `${ref.runId}:${ref.eventSequence ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const button = node(
      "button",
      `${ref.runId}${ref.eventSequence ? ` · event ${ref.eventSequence}` : ""}`,
    );
    button.type = "button";
    button.addEventListener("click", () => {
      updateUrl(ref.runId);
      setWorkspaceView(false);
      void loadRun(ref.runId);
    });
    links.append(button);
  }
  return links;
}
function renderSummary(result) {
  const container = $("#knowledge-summary");
  container.replaceChildren();
  container.dataset.targetId = selected.id;
  for (const record of result.items || []) {
    const item = node("article", null, "summary-item");
    item.dataset.recordId = record.id;
    item.append(
      node("h4", record.title),
      node("p", record.body),
      sourceButtons(record.refs),
    );
    container.append(item);
  }
  if (!result.items?.length)
    container.append(
      node(
        "p",
        "No accepted knowledge with current, available sources.",
        "empty",
      ),
    );
  if (result.excluded?.length)
    container.append(
      node(
        "p",
        `${result.excluded.length} accepted note${result.excluded.length === 1 ? " needs" : "s need"} revalidation or has unavailable sources. Review the notes below.`,
        "notice attention",
      ),
    );
}
function integrityLabel(value) {
  return (
    {
      available: "Verified file",
      missing: "File missing",
      corrupt: "File changed or corrupt",
      unproven: "File ownership unconfirmed",
    }[value] || "Integrity unknown"
  );
}
async function evidenceContent(item) {
  const response = await fetch(
    `${targetPath(selected.id)}/evidence/${encodeURIComponent(item.id)}/content`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      credentials: "omit",
    },
  );
  if (!response.ok) {
    const result = await response.json();
    throw Error(
      result.error?.message ||
        "Evidence could not be verified. Its retained bytes were preserved.",
    );
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 16 * 1024 * 1024)
    throw Error("The evidence exceeds the supported size.");
  return bytes;
}
async function inspectEvidence(item, download) {
  const current = generation,
    runId = currentRun?.runId;
  try {
    const bytes = await evidenceContent(item);
    if (current !== generation || runId !== currentRun?.runId) return;
    const blob = new Blob([bytes], { type: item.mediaType });
    if (download) {
      const url = URL.createObjectURL(blob),
        link = node("a");
      link.href = url;
      link.download = `${item.id}.${{ "image/png": "png", "image/jpeg": "jpg", "text/plain": "txt", "application/json": "json", "application/pdf": "pdf" }[item.mediaType] || "bin"}`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      return;
    }
    clearPreview();
    const panel = $("#evidence-preview");
    panel.hidden = false;
    panel.append(node("strong", item.label));
    if (["image/png", "image/jpeg"].includes(item.mediaType)) {
      previewUrl = URL.createObjectURL(blob);
      const img = node("img");
      img.src = previewUrl;
      img.alt = item.label;
      panel.append(img);
    } else if (["text/plain", "application/json"].includes(item.mediaType)) {
      const text = new TextDecoder().decode(bytes.slice(0, 65536));
      panel.append(node("pre", text));
      if (bytes.byteLength > 65536)
        panel.append(
          node(
            "p",
            "Preview shows the first 64 KiB. Download the verified file to read all its content.",
            "subtle",
          ),
        );
    } else
      panel.append(
        node(
          "p",
          "Download this verified file to inspect it locally.",
          "subtle",
        ),
      );
  } catch (error) {
    if (current === generation) reviewNotice(errorMessage(error));
  }
}
function renderEvidence(items, pending) {
  evidenceItems = items;
  const list = $("#evidence-list");
  list.replaceChildren();
  for (const item of items) {
    const row = node("article", null, "evidence-item");
    row.dataset.evidenceId = item.id;
    const label = node("label", null, "evidence-choice");
    const checkbox = node("input");
    checkbox.type = "checkbox";
    checkbox.value = item.id;
    checkbox.className = "evidence-select";
    checkbox.disabled = item.integrity !== "available";
    label.append(checkbox, node("span", item.label));
    row.append(label);
    row.append(
      node(
        "p",
        `${integrityLabel(item.integrity)} · ${item.mediaType} · ${item.bytes.toLocaleString()} bytes`,
        "subtle",
      ),
    );
    const actions = node("div", null, "evidence-actions");
    for (const [name, download] of [
      ["Preview", false],
      ["Download", true],
    ]) {
      const button = node("button", name, "secondary compact");
      button.type = "button";
      button.disabled = item.integrity !== "available";
      button.addEventListener(
        "click",
        () => void inspectEvidence(item, download),
      );
      actions.append(button);
    }
    row.append(actions);
    list.append(row);
  }
  for (const item of pending || []) {
    const row = node("article", null, "evidence-item");
    row.dataset.evidenceId = item.id;
    row.append(
      node("strong", item.label || "Retained evidence upload"),
      node(
        "p",
        `Not committed · ${integrityLabel(item.integrity)}. Retained bytes need explicit attention.`,
        "notice attention",
      ),
    );
    if (item.state === "uncommitted" && item.integrity === "available") {
      const retry = node(
        "button",
        "Retry evidence registration",
        "secondary compact",
      );
      retry.type = "button";
      retry.dataset.reviewMutation = "true";
      retry.addEventListener("click", async () => {
        if (evidenceBusy || recordBusy) return;
        const current = generation,
          target = selected;
        evidenceBusy = true;
        reviewControls();
        reviewNotice(null);
        try {
          await api(
            `${targetPath(target.id)}/evidence/${encodeURIComponent(item.id)}/retry`,
            { revision: target.revision },
          );
          if (current === generation) await loadEvidence();
        } catch (error) {
          if (current === generation) reviewNotice(errorMessage(error));
        } finally {
          if (current === generation) {
            evidenceBusy = false;
            reviewControls();
          }
        }
      });
      row.append(retry);
    }
    list.append(row);
  }
  if (!items.length && !pending?.length)
    list.append(node("p", "No evidence files attached to this run.", "empty"));
  if (evidenceCursor) {
    const more = node("button", "More evidence", "secondary compact");
    more.type = "button";
    more.addEventListener("click", () => void loadEvidence(true));
    list.append(more);
  }
  reviewControls();
}
async function loadEvidence(more = false) {
  const current = generation,
    requestId = ++evidenceGeneration,
    runId = currentRun?.runId;
  clearPreview();
  if (!selected || !runId || currentRun?.sourceKind === "archive") {
    evidenceItems = [];
    $("#evidence-list").replaceChildren(
      node("p", "Choose a recorded run in History.", "empty"),
    );
    return;
  }
  try {
    const query = new URLSearchParams({ runId, limit: "25" });
    if (more && evidenceCursor) query.set("cursor", evidenceCursor);
    const result = await api(`${targetPath(selected.id)}/evidence?${query}`);
    if (
      current !== generation ||
      requestId !== evidenceGeneration ||
      runId !== currentRun?.runId
    )
      return;
    const visible = new Set(evidenceItems.map((item) => item.id));
    const checked = new Set(
      [...document.querySelectorAll(".evidence-select:checked")].map(
        (input) => input.value,
      ),
    );
    for (const ref of retainedSourceRefs)
      if (ref.evidenceId && !visible.has(ref.evidenceId))
        checked.add(ref.evidenceId);
    evidenceCursor = result.nextCursor || null;
    evidencePending = (result.pending || []).filter(
      (item) => !item.runId || item.runId === runId,
    );
    renderEvidence(
      more
        ? [...evidenceItems, ...(result.evidence || [])]
        : result.evidence || [],
      evidencePending,
    );
    for (const checkbox of document.querySelectorAll(".evidence-select"))
      checkbox.checked = checked.has(checkbox.value);
  } catch (error) {
    if (current === generation && requestId === evidenceGeneration)
      reviewNotice(errorMessage(error));
  }
}
function recordCard(record, historical = false) {
  const card = node(
    "article",
    null,
    historical ? "revision-item" : "record-card",
  );
  card.dataset.recordId = record.id;
  card.dataset.revision = record.revision;
  card.dataset.state = record.state;
  const header = node("header");
  header.append(
    node(
      "span",
      `${words(record.kind)} · revision ${record.revision}`,
      "eyebrow",
    ),
  );
  const stale =
    record.needsRevalidation ||
    record.validation?.status === "needs_revalidation";
  const state = node(
    "span",
    words(record.state),
    `record-state ${record.state}`,
  );
  header.append(state);
  card.append(header);
  card.append(node("h4", record.title), node("p", record.body, "record-body"));
  if (stale)
    card.append(
      node(
        "p",
        "Needs revalidation for the current integration.",
        "notice attention record-revalidation",
      ),
    );
  const model = record.integration?.model;
  card.append(
    node(
      "p",
      `${model ? `${model.id} · ${model.version}` : "Integration recorded"} · ${time(record.createdAt)}`,
      "subtle record-meta",
    ),
    sourceButtons(record.refs),
  );
  if (
    record.validation?.status &&
    record.validation.status !== "valid" &&
    !stale
  )
    card.append(
      node(
        "p",
        "A source needs attention before this note can be accepted or used in the summary.",
        "notice attention",
      ),
    );
  if (historical && record.reviews?.length) {
    const reviews = node("ol", null, "review-decisions");
    for (const review of record.reviews)
      reviews.append(
        node(
          "li",
          `${words(review.state)} · ${time(review.reviewedAt)}${review.note ? ` · ${review.note}` : ""}`,
        ),
      );
    card.append(reviews);
  }
  if (!historical) {
    const actions = node("div", null, "record-actions");
    if (record.state === "proposed")
      for (const [label, decision] of [
        ["Accept", "accepted"],
        ["Reject", "rejected"],
      ]) {
        const button = node(
          "button",
          label,
          decision === "rejected" ? "secondary compact" : "compact",
        );
        button.type = "button";
        button.dataset.reviewMutation = "true";
        button.addEventListener(
          "click",
          () => void reviewRecord(record, decision),
        );
        actions.append(button);
      }
    const revise = node(
      "button",
      stale ? "Revalidate with new revision" : "Revise",
      "secondary compact",
    );
    revise.type = "button";
    revise.dataset.reviewMutation = "true";
    revise.addEventListener("click", () => void composeRevision(record));
    actions.append(revise);
    if (record.kind === "finding") {
      const use = node("button", "Use as knowledge", "secondary compact");
      use.type = "button";
      use.dataset.reviewMutation = "true";
      use.addEventListener("click", () => void composeRevision(record, true));
      actions.append(use);
    }
    card.append(actions);
    const history = node("details", null, "revision-history");
    history.append(node("summary", "Revision history"));
    history.addEventListener("toggle", async () => {
      if (!history.open || history.dataset.loaded || history.dataset.loading)
        return;
      const current = generation;
      history.dataset.loading = "true";
      try {
        const result = await api(
          `${targetPath(selected.id)}/records/${encodeURIComponent(record.id)}`,
        );
        if (current !== generation) return;
        const records = result.record.revisions || [result.record];
        for (const revision of records) {
          const item = node("article", null, "revision-item");
          item.dataset.revision = revision.revision;
          item.dataset.state = revision.state;
          item.append(
            node(
              "strong",
              `Revision ${revision.revision} · ${words(revision.state)}`,
            ),
            node("p", revision.title, "subtle"),
          );
          const inspect = node(
            "button",
            `Inspect revision ${revision.revision}`,
            "secondary compact",
          );
          inspect.type = "button";
          inspect.addEventListener("click", async () => {
            if (inspect.disabled) return;
            inspect.disabled = true;
            try {
              const detail = await api(
                `${targetPath(record.targetId)}/records/${encodeURIComponent(record.id)}?revision=${revision.revision}`,
              );
              if (current !== generation) return;
              item.replaceWith(recordCard(detail.record, true));
            } catch (error) {
              if (current === generation) reviewNotice(errorMessage(error));
              inspect.disabled = false;
            }
          });
          item.append(inspect);
          history.append(item);
        }
        history.dataset.loaded = "true";
      } catch (error) {
        if (current === generation) reviewNotice(errorMessage(error));
      } finally {
        delete history.dataset.loading;
      }
    });
    card.append(history);
  }
  return card;
}
function renderRecords() {
  const list = $("#knowledge-records");
  list.replaceChildren(...loadedRecords.map((value) => recordCard(value)));
  list.dataset.targetId = selected?.id || "";
  if (!loadedRecords.length)
    list.append(
      node("p", "No findings or knowledge saved for this target.", "empty"),
    );
  if (recordsCursor) {
    const more = node("button", "More notes", "secondary compact");
    more.type = "button";
    more.addEventListener("click", () => void loadKnowledge(true));
    list.append(more);
  }
  reviewControls();
}
async function loadKnowledge(more = false) {
  if (!selected) return;
  if (![2, 3, 4].includes(catalogVersion)) {
    reviewNotice(
      "This workspace needs an explicit storage upgrade before evidence and knowledge can be added. Stop Universal, run daedlo-universal upgrade --workspace ROOT, then reopen it. Existing history remains available.",
    );
    reviewControls();
    return;
  }
  const current = generation,
    requestId = ++knowledgeGeneration,
    targetId = selected.id;
  reviewLoading = true;
  reviewControls();
  reviewNotice(null);
  try {
    const params = new URLSearchParams({ limit: "50" });
    if (more && recordsCursor) params.set("cursor", recordsCursor);
    const [records, summary] = await Promise.all([
      api(`${targetPath(targetId)}/records?${params}`),
      api(`${targetPath(targetId)}/summary`),
    ]);
    if (current !== generation || requestId !== knowledgeGeneration) return;
    loadedRecords = more
      ? [...loadedRecords, ...records.records]
      : records.records;
    recordsCursor = records.nextCursor || null;
    renderRecords();
    renderSummary(summary);
    if (!more) await loadEvidence();
  } catch (error) {
    if (current === generation && requestId === knowledgeGeneration)
      reviewNotice(errorMessage(error));
  } finally {
    if (current === generation && requestId === knowledgeGeneration) {
      reviewLoading = false;
      reviewControls();
    }
  }
}
async function reviewRecord(record, decision) {
  if (recordBusy || evidenceBusy) return;
  const current = generation,
    target = selected;
  recordBusy = true;
  reviewControls();
  reviewNotice(null);
  try {
    await api(
      `${targetPath(target.id)}/records/${encodeURIComponent(record.id)}/review`,
      {
        revision: target.revision,
        expectedRevision: record.revision,
        decision,
      },
    );
    if (current === generation) await loadKnowledge();
  } catch (error) {
    if (current === generation) reviewNotice(errorMessage(error));
  } finally {
    if (current === generation) {
      recordBusy = false;
      reviewControls();
    }
  }
}
async function composeRevision(record, asKnowledge = false) {
  if (recordBusy || evidenceBusy) return;
  const current = generation;
  reviewNotice(null);
  try {
    const ref = record.refs?.[0];
    if (!ref) throw Error("This note has no available source reference.");
    await loadRun(ref.runId);
    if (current !== generation || currentRun?.runId !== ref.runId) return;
    updateUrl(ref.runId);
    editingRecord = asKnowledge
      ? null
      : { id: record.id, revision: record.revision };
    retainedSourceRefs = record.refs
      .filter((value, index) => index > 0 || value.evidenceId)
      .map(({ runId, eventSequence, evidenceId }) => ({
        runId,
        eventSequence,
        evidenceId,
      }));
    updateRunSource();
    $("#record-kind").value = asKnowledge ? "knowledge" : record.kind;
    $("#record-title").value = record.title;
    $("#record-body").value = record.body;
    $("#record-event").value = ref.eventSequence ?? "";
    const refs = new Set(
      record.refs.map((ref) => ref.evidenceId).filter(Boolean),
    );
    for (const checkbox of document.querySelectorAll(".evidence-select"))
      checkbox.checked = refs.has(checkbox.value);
    $("#compose-heading").textContent = asKnowledge
      ? "Propose knowledge"
      : `Revise note · revision ${record.revision + 1}`;
    $("#cancel-revision").hidden = !editingRecord;
    reviewControls();
    $("#record-title").focus();
  } catch (error) {
    if (current === generation) reviewNotice(errorMessage(error));
  }
}
$("#history-tab").addEventListener("click", () => setWorkspaceView(false));
$("#knowledge-tab").addEventListener("click", () => setWorkspaceView(true));
$("#choose-evidence-run").addEventListener("click", () => {
  setWorkspaceView(false);
  $("#history-heading").scrollIntoView({ block: "start" });
});
$("#reload-knowledge").addEventListener("click", () => void loadKnowledge());
$("#cancel-revision").addEventListener("click", resetCompose);
$("#record-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (
    recordBusy ||
    evidenceBusy ||
    !selected ||
    currentRun?.sourceKind !== "journal" ||
    ![2, 3, 4].includes(catalogVersion)
  )
    return;
  const current = generation,
    target = selected,
    editing = editingRecord;
  const checked = [
    ...document.querySelectorAll(".evidence-select:checked"),
  ].map((input) => evidenceItems.find((item) => item.id === input.value));
  if (checked.length > 7) {
    reviewNotice("Link up to seven evidence files per note.");
    return;
  }
  const visibleEvidence = new Set(evidenceItems.map((item) => item.id));
  const candidates = [
    {
      runId: currentRun.runId,
      eventSequence: $("#record-event").value
        ? Number($("#record-event").value)
        : null,
      evidenceId: null,
    },
    ...retainedSourceRefs.filter(
      (ref) => !ref.evidenceId || !visibleEvidence.has(ref.evidenceId),
    ),
    ...checked.map((item) => ({
      runId: item.runId,
      eventSequence: item.eventSequence,
      evidenceId: item.id,
    })),
  ];
  const refs = [
    ...new Map(candidates.map((ref) => [JSON.stringify(ref), ref])).values(),
  ];
  if (refs.length > 8) {
    reviewNotice(
      "Keep up to eight source references per note. Earlier sources remain retained in the saved revision.",
    );
    return;
  }
  const input = {
    revision: target.revision,
    ...(!editing ? { kind: $("#record-kind").value } : {}),
    title: $("#record-title").value.trim(),
    body: $("#record-body").value.trim(),
    refs,
    ...(editing ? { expectedRevision: editing.revision } : {}),
  };
  recordBusy = true;
  reviewControls();
  reviewNotice(null);
  try {
    await api(
      `${targetPath(target.id)}/records${editing ? `/${encodeURIComponent(editing.id)}/revise` : ""}`,
      input,
    );
    if (current !== generation) return;
    resetCompose();
    await loadKnowledge();
  } catch (error) {
    if (current === generation) reviewNotice(errorMessage(error));
  } finally {
    if (current === generation) {
      recordBusy = false;
      reviewControls();
    }
  }
});
$("#evidence-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (
    evidenceBusy ||
    recordBusy ||
    !selected ||
    currentRun?.sourceKind !== "journal" ||
    ![2, 3, 4].includes(catalogVersion)
  )
    return;
  const current = generation,
    target = selected,
    runId = currentRun.runId,
    file = $("#evidence-file").files[0];
  const allowed = [
    "image/png",
    "image/jpeg",
    "text/plain",
    "application/json",
    "application/pdf",
  ];
  if (!file || file.size > 16 * 1024 * 1024 || !allowed.includes(file.type)) {
    reviewNotice(
      "Choose a PNG, JPEG, plain text, JSON or PDF file up to 16 MiB.",
    );
    return;
  }
  evidenceBusy = true;
  reviewControls();
  reviewNotice(null);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (current !== generation || runId !== currentRun?.runId) return;
    let binary = "";
    for (let start = 0; start < bytes.length; start += 32768)
      binary += String.fromCharCode(...bytes.subarray(start, start + 32768));
    await api(`${targetPath(target.id)}/evidence`, {
      revision: target.revision,
      runId,
      eventSequence: null,
      label: $("#evidence-label").value.trim(),
      mediaType: file.type,
      base64: btoa(binary),
    });
    if (current !== generation || runId !== currentRun?.runId) return;
    $("#evidence-form").reset();
    await loadEvidence();
  } catch (error) {
    if (current === generation) reviewNotice(errorMessage(error));
  } finally {
    if (current === generation) {
      evidenceBusy = false;
      reviewControls();
    }
  }
});

try {
  const result = await api("/api/targets");
  liveLaunch = result.liveLaunch !== false;
  targets = result.targets;
  catalogVersion = result.catalogVersion ?? 1;
  $("#target-select").replaceChildren(
    ...targets.map((target) => {
      const option = node("option", `${target.label} · ${target.environment}`);
      option.value = target.id;
      return option;
    }),
  );
  $("#target-select").disabled = targets.length === 0;
  if (!targets.length) {
    $("#target-select").append(node("option", "No registered targets"));
    $("#index-status").textContent =
      "Register a target with Daedlo Universal to begin.";
  }
  const url = new URL(location.href);
  await selectTarget(url.searchParams.get("target") || targets[0]?.id, {
    navigate: false,
    runId: url.searchParams.get("run"),
    sourceKind:
      url.searchParams.get("source") === "archive" ? "archive" : "journal",
  });
  if (selected)
    updateUrl(
      url.searchParams.get("run"),
      true,
      url.searchParams.get("source") === "archive" ? "archive" : "journal",
    );
} catch (error) {
  $("#target-select").replaceChildren(node("option", "Workspace unavailable"));
  $("#history-list").replaceChildren(
    node(
      "p",
      "Open the current private workspace link to read recorded work.",
      "empty",
    ),
  );
  $("#history-list").setAttribute("aria-busy", "false");
  notice(errorMessage(error));
}
