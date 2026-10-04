export function summarizeArchive(runs) {
  const scenarios = runs.flatMap((run) => run.scenarios || []);
  return {
    runs: runs.length,
    scenarios: scenarios.length,
    passed: scenarios.filter((row) => row.status === "PASS").length,
    failed: scenarios.filter((row) => row.status === "FAIL").length,
    findings: scenarios.filter((row) => row.status === "HISTORICAL_FINDING")
      .length,
    notRun: scenarios.filter((row) => row.status === "NOT RUN").length,
  };
}

export function filterRuns(
  runs,
  { source = "all", status = "all", search = "" } = {},
) {
  const needle = search.trim().toLowerCase();
  return runs.filter(
    (run) =>
      (source === "all" || (run.kind || "roots-original") === source) &&
      (status === "all" ||
        run.scenarios?.some((row) => row.status === status)) &&
      (!needle ||
        [
          run.title,
          run.summary,
          ...(run.scenarios || []).flatMap((row) => [row.name, row.assertion]),
        ]
          .join(" ")
          .toLowerCase()
          .includes(needle)),
  );
}

const labels = {
  PASS: "Pass",
  FAIL: "Fail",
  "NOT RUN": "Not run",
  HISTORICAL_FINDING: "Historical finding",
  FINDINGS: "Findings recorded",
  BASELINE_PASS: "Baseline passed",
  IN_PROGRESS: "In progress",
  SETUP_FAILURE: "Setup failure",
};
const text = (value) =>
  value === null || value === undefined
    ? "Not recorded"
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
const short = (value) => (value ? String(value).slice(0, 8) : "Not recorded");
const runKind = (run) =>
  run.kind === "standalone-candidate"
    ? "Standalone candidate"
    : "Roots original driver";

async function boot() {
  const $ = (id) => document.getElementById(id);
  const element = (tag, className, content) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = text(content);
    return node;
  };
  const badge = (status) =>
    element(
      "span",
      `badge status-${String(status).toLowerCase().replaceAll(" ", "-")}`,
      labels[status] || status,
    );
  let manifest,
    selected,
    filtered = [];

  function evidenceList(paths, parent) {
    const list = element("ul", "evidence-paths");
    for (const path of typeof paths === "string" ? [paths] : paths || [])
      list.append(element("li", "", path));
    parent.append(list);
  }

  function showImage(image) {
    $("gallery-image").src = `/archive/${image.path}`;
    $("gallery-image").alt = image.caption || "Historical Roots screenshot";
    $("gallery-caption").textContent = image.caption;
    $("gallery-source").textContent = `Original evidence: ${image.sourcePath}`;
    $("gallery").showModal();
  }

  function showRun(run) {
    selected = run?.id;
    for (const button of $("runs").querySelectorAll("[data-run]")) {
      button.classList.toggle("selected", button.dataset.run === selected);
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.run === selected),
      );
    }
    $("run-detail").replaceChildren();
    if (!run) {
      const blank = element("div", "detail-empty");
      blank.append(
        element("span", "empty-symbol", "○"),
        element("h3", "", "No archived runs match"),
        element(
          "p",
          "",
          "Change the filters to view the recorded Roots work. Candidate acceptance is documented separately.",
        ),
      );
      $("run-detail").append(blank);
      return;
    }
    const detail = $("run-detail");
    const heading = element("div", "detail-heading");
    const headingText = element("div");
    headingText.append(
      element(
        "span",
        "eyebrow",
        run.status === "IN_PROGRESS"
          ? "IN PROGRESS · BASELINE EVIDENCE ONLY"
          : "HISTORICAL RUN",
      ),
      element("h3", "", run.title),
    );
    heading.append(headingText, badge(run.status));
    detail.append(heading);
    detail.append(
      element(
        "p",
        "detail-meta",
        `${run.date} · ${runKind(run)} · ${run.testLevel}`,
      ),
    );
    detail.append(element("p", "detail-summary", run.summary));
    if (run.history?.length) {
      const history = element("details", "run-history");
      history.append(
        element(
          "summary",
          "",
          `Attempts & corrections · ${run.history.length} recorded stages`,
        ),
      );
      for (const item of run.history) {
        const stage = element("div", "history-item");
        stage.append(
          badge(item.status),
          element("strong", "", item.stage),
          element("p", "", item.detail),
        );
        if (item.evidence) evidenceList(item.evidence, stage);
        history.append(stage);
      }
      detail.append(history);
    }
    const scenarios = element("section", "scenarios");
    const scenarioHead = element("div", "section-heading");
    scenarioHead.append(
      element("h4", "", "Recorded checks"),
      element("span", "muted", `${run.scenarios.length} rows`),
    );
    scenarios.append(scenarioHead);
    for (const scenario of run.scenarios) {
      const row = element("details", "scenario");
      row.dataset.scenario = scenario.id;
      const summary = element("summary");
      summary.append(
        badge(scenario.status),
        element("span", "scenario-name", scenario.name),
        element("span", "expand", "+"),
      );
      const body = element("div", "scenario-body");
      body.append(element("p", "assertion", scenario.assertion));
      if (scenario.failure) {
        const finding = element("div", "finding");
        finding.append(
          element("strong", "", "What failed"),
          element("p", "", scenario.failure),
        );
        body.append(finding);
      }
      if (scenario.correction) {
        const correction = element("div", "correction");
        correction.append(
          element("strong", "", "Correction or follow-up"),
          element("p", "", scenario.correction),
        );
        body.append(correction);
      }
      for (const item of scenario.history || []) {
        const history = element("div", "history-item");
        history.append(
          badge(item.status),
          element("strong", "", item.stage),
          element("p", "", item.detail),
        );
        if (item.evidence) evidenceList(item.evidence, history);
        body.append(history);
      }
      if (scenario.evidence?.length) {
        body.append(element("span", "small-label", "ORIGINAL EVIDENCE"));
        evidenceList(scenario.evidence, body);
      }
      row.append(summary, body);
      scenarios.append(row);
    }
    detail.append(scenarios);
    if (run.images?.length) {
      const gallery = element("section", "screenshots");
      const header = element("div", "section-heading");
      header.append(
        element("h4", "", "Screenshots"),
        element("span", "muted", "Recorded images · not live"),
      );
      gallery.append(header);
      const images = element("div", "image-grid");
      for (const image of run.images) {
        const button = element("button", "screenshot");
        button.type = "button";
        button.dataset.image = image.path;
        const img = element("img");
        img.src = `/archive/${image.path}`;
        img.alt = image.caption;
        img.loading = "lazy";
        button.append(img, element("span", "", image.caption));
        button.addEventListener("click", () => showImage(image));
        images.append(button);
      }
      gallery.append(images);
      detail.append(gallery);
    }
    if (run.limitations?.length) {
      const limitations = element("div", "limitations");
      limitations.append(
        element("h4", "", "What this evidence does not claim"),
      );
      const list = element("ul");
      for (const limitation of run.limitations)
        list.append(element("li", "", limitation));
      limitations.append(list);
      detail.append(limitations);
    }
    const provenance = element("details", "provenance");
    provenance.append(
      element("summary", "", "Source versions & original evidence"),
    );
    const facts = element("dl", "source-facts");
    for (const [label, value] of [
      ["Application source", run.source.commit],
      ["Controller source", run.source.controllerCommit],
      ["Captured base source", run.source.capturedBaseCommit],
      ["Original evidence", run.source.evidencePath],
      ["Controller evidence", run.source.controllerEvidencePath],
    ])
      if (value)
        facts.append(element("dt", "", label), element("dd", "", value));
    provenance.append(facts);
    if (run.source.provenanceNote)
      provenance.append(
        element("p", "provenance-note", run.source.provenanceNote),
      );
    if (run.source.artifacts?.length) {
      provenance.append(element("h4", "", "Recorded artifacts"));
      evidenceList(
        run.source.artifacts.map(
          (artifact) =>
            `${artifact.path} · ${artifact.kind} · SHA256 ${artifact.sha256}`,
        ),
        provenance,
      );
    }
    detail.append(provenance);
  }

  function renderRuns() {
    filtered = filterRuns(manifest.runs, {
      source: $("source-filter").value,
      status: $("status-filter").value,
      search: $("search").value,
    });
    const totals = summarizeArchive(filtered);
    $("run-count").textContent = totals.runs;
    $("check-count").textContent = totals.scenarios;
    $("pass-count").textContent = totals.passed;
    $("finding-count").textContent = totals.findings + totals.failed;
    $("not-run-count").textContent = totals.notRun;
    $("filtered-count").textContent =
      `${totals.runs} of ${manifest.runs.length} archived runs`;
    $("runs").replaceChildren();
    for (const run of filtered) {
      const button = element("button", "run-card");
      button.type = "button";
      button.dataset.run = run.id;
      const metadata = element("span", "run-card-meta");
      metadata.append(element("span", "", run.date), badge(run.status));
      button.append(
        metadata,
        element("strong", "", run.title),
        element("span", "run-card-summary", run.summary),
      );
      const source = element("span", "run-card-source");
      source.append(
        element("span", "", runKind(run)),
        element("code", "", short(run.source.commit)),
      );
      button.append(source);
      button.addEventListener("click", () => showRun(run));
      $("runs").append(button);
    }
    showRun(
      filtered.find((run) => run.id === selected) ||
        filtered.find(
          (run) => run.id.includes("strains") && run.status !== "IN_PROGRESS",
        ) ||
        filtered.find((run) => run.status !== "IN_PROGRESS") ||
        filtered[0],
    );
  }

  async function refreshLive() {
    try {
      const response = await fetch("/api/live", { cache: "no-store" });
      if (!response.ok) throw Error("Live session status unavailable.");
      const live = await response.json();
      $("live-state").textContent = live.available
        ? "Session ready"
        : "Not connected";
      $("live-state").classList.toggle("ready", live.available);
      $("live-description").textContent = live.available
        ? "The actual Roots browser, controlled by its original QA driver. Open it to choose a command and watch it run."
        : live.reason;
      $("live-detail").textContent = live.available
        ? [live.currentState, live.execution].filter(Boolean).join(" · ") ||
          "Browser and driver connected"
        : "Historical evidence below is still available.";
      $("live-commit").textContent = live.available
        ? short(live.applicationCommit)
        : "—";
      $("live-frame-count").textContent =
        live.available && live.frames !== null ? String(live.frames) : "—";
      $("open-live").hidden = !live.available;
      $("live-offline").hidden = Boolean(live.available);
      if (live.available) $("open-live").href = live.viewerUrl;
      else $("open-live").removeAttribute("href");
      $("live-source").textContent = live.available
        ? `Roots original QA driver · application ${live.applicationCommit} · controller ${live.driverSourceCommit}`
        : "No substitute demo is started when a live session is unavailable.";
    } catch {
      $("live-state").textContent = "Status unavailable";
      $("live-state").classList.remove("ready");
      $("live-description").textContent =
        "The local status endpoint could not be reached.";
      $("open-live").hidden = true;
      $("open-live").removeAttribute("href");
      $("live-offline").hidden = false;
    }
    setTimeout(refreshLive, 3000);
  }

  $("close-gallery").addEventListener("click", () => $("gallery").close());
  $("gallery").addEventListener("click", (event) => {
    if (event.target === $("gallery")) $("gallery").close();
  });
  for (const filter of ["source-filter", "status-filter"])
    $(filter).addEventListener("change", renderRuns);
  $("search").addEventListener("input", renderRuns);
  void refreshLive();
  try {
    const response = await fetch("./archive/manifest.json", {
      cache: "no-store",
    });
    if (!response.ok) throw Error("The recorded archive could not be loaded.");
    manifest = await response.json();
    $("archive-description").textContent = manifest.description;
    $("current-source").textContent = short(manifest.currentSource.commit);
    $("current-source-note").textContent = manifest.currentSource.note;
    $("canonical-report").textContent = manifest.canonicalReportPath;
    $("archive-error").hidden = true;
    renderRuns();
  } catch (error) {
    $("archive-error").textContent = error.message;
    $("archive-error").hidden = false;
    for (const control of ["source-filter", "status-filter", "search"])
      $(control).disabled = true;
  }
}

if (typeof document !== "undefined") void boot();
