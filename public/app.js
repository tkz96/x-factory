// fallow-ignore-file coverage-gaps
// public/app.js — X-Factory frontend logic for the Apple HIG developer workbench.

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ── State ──────────────────────────────────────────────────────────────────────

let currentRunId = null;
let eventSource = null;
let projects = [];
let allRuns = [];

// ── Elements ───────────────────────────────────────────────────────────────────

const toolbarTitle    = $("#toolbar-title");
const toolbarSubtitle = $("#toolbar-subtitle");
const btnOpenNewRun   = $("#btn-open-new-run");
const modalNewRun     = $("#modal-new-run");
const btnCloseModal   = $("#btn-close-modal");
const btnCancelModal  = $("#btn-cancel-modal");
const btnQueueManual  = $("#btn-queue-manual");
const btnRunsStart    = $("#btn-runs-start");
const activeRunsBadge = $("#active-runs-badge");
const queueBadge      = $("#queue-badge");
const queueTicketsList = $("#queue-tickets-list");
const queueSearch      = $("#queue-search");
let cachedTickets      = [];

const viewSetup  = $("#view-setup");
const viewRun    = $("#view-run");
const viewResult = $("#view-result");
const runsStandby = $("#runs-standby");
const workflowStepper = $("#workflow-stepper");


const selectProject    = $("#select-project");
const inputTicketId    = $("#input-ticket-id");
const inputTicketTitle = $("#input-ticket-title");
const inputBranch      = $("#input-branch");
const inputCriteria    = $("#input-criteria");
const inputPlan        = $("#input-plan");
const knowledgeStatus  = $("#knowledge-status");
const btnStart         = $("#btn-start");
const setupError       = $("#setup-error");

const runTitle         = $("#run-title");
const runBranch        = $("#run-branch");
const runStatus        = $("#run-status");
const eventLog         = $("#event-log");
const inputSteer       = $("#input-steer");
const btnSteer         = $("#btn-steer");
const steerBar         = $("#steer-bar");
const btnStop          = $("#btn-stop");
const runError         = $("#run-error");
const runDiffCard      = $("#run-diff-card");
const runDiffFiles     = $("#run-diff-files");
const runDiffContent   = $("#run-diff-content");

const resultStatusBadge   = $("#result-status-badge");
const resultTests         = $("#result-tests");
const resultRepairCount   = $("#result-repair-count");
const resultTestOutput    = $("#result-test-output");
const resultReviewBadge   = $("#result-review-badge");
const resultReviewSummary = $("#result-review-summary");
const criteriaChecklist   = $("#criteria-checklist");
const findingsList        = $("#findings-list");
const resultDiffCount     = $("#result-diff-count");
const resultDiff          = $("#result-diff");
const deliveryCheckpoint  = $("#delivery-checkpoint");
const btnPr               = $("#btn-pr");
const prSteps             = $("#pr-steps");
const prResult            = $("#pr-result");
const prLink              = $("#pr-link");
const btnNew              = $("#btn-new");
const resultError         = $("#result-error");

const historyContainer  = $("#history-runs-container");
const projectsContainer = $("#projects-container");

// Settings Elements
const settingTrackerProvider = $("#setting-tracker-provider");
const trackerGroupGithub     = $("#tracker-group-github");
const trackerGroupJira       = $("#tracker-group-jira");
const trackerGroupAzure      = $("#tracker-group-azure");

const settingGithubToken     = $("#setting-github-token");
const settingGithubRepo      = $("#setting-github-repo");

const settingJiraHost        = $("#setting-jira-host");
const settingJiraEmail       = $("#setting-jira-email");
const settingJiraToken       = $("#setting-jira-token");
const settingJiraProject     = $("#setting-jira-project");

const settingAzureOrg        = $("#setting-azure-org");
const settingAzureProject    = $("#setting-azure-project");
const settingAzurePat        = $("#setting-azure-pat");

const settingModelAProvider  = $("#setting-model-a-provider");
const settingModelAModel     = $("#setting-model-a-model");
const settingModelBProvider  = $("#setting-model-b-provider");
const settingModelBModel     = $("#setting-model-b-model");

const btnSaveSettings        = $("#btn-save-settings");
const settingsStatus         = $("#settings-status");


// ── Areas & Routing ────────────────────────────────────────────────────────────

const AREA_METADATA = {
  queue: { title: "Work Queue", subtitle: "Tickets ready for agentic implementation" },
  runs: { title: "Active Runs", subtitle: "Live execution and verification workbench" },
  history: { title: "Run History", subtitle: "Previous factory runs and results" },
  projects: { title: "Projects", subtitle: "Codebases configured for factory automation" },
  settings: { title: "Settings", subtitle: "Issue trackers, model runtime, and workspace settings" },
};

function navigate(areaName) {
  const area = AREA_METADATA[areaName] ? areaName : "queue";

  $$(".sidebar-nav .nav-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.area === area);
  });

  $$(".area-view").forEach((el) => {
    el.classList.toggle("active", el.id === `area-${area}`);
  });

  if (toolbarTitle && AREA_METADATA[area]) {
    toolbarTitle.textContent = AREA_METADATA[area].title;
    toolbarSubtitle.textContent = AREA_METADATA[area].subtitle;
  }

  if (area === "queue") loadWorkQueue();
  if (area === "history") loadHistory();
  if (area === "projects") renderProjectsList();
  if (area === "runs") syncRunsView();
  if (area === "settings") loadSettingsView();
}



function handleHashChange() {
  const hash = window.location.hash.replace(/^#\/?/, "") || "queue";
  navigate(hash);
}

window.addEventListener("hashchange", handleHashChange);

function syncRunsView() {
  if (!currentRunId) {
    if (runsStandby) runsStandby.hidden = false;
    if (workflowStepper) workflowStepper.style.display = "none";
    if (viewRun) viewRun.style.display = "none";
    if (viewResult) viewResult.style.display = "none";
  } else {
    if (runsStandby) runsStandby.hidden = true;
    if (workflowStepper) workflowStepper.style.display = "block";
  }
}

// ── Legacy showView for test compatibility ────────────────────────────────────

function showView(view) {
  if (view === viewSetup) {
    openNewRunModal();
  } else if (view === viewRun) {
    window.location.hash = "#/runs";
    if (runsStandby) runsStandby.hidden = true;
    if (workflowStepper) workflowStepper.style.display = "block";
    viewRun.style.display = "block";
    viewResult.style.display = "none";
  } else if (view === viewResult) {
    window.location.hash = "#/runs";
    if (runsStandby) runsStandby.hidden = true;
    viewRun.style.display = "none";
    viewResult.style.display = "block";
  }
}

// ── Modal Dialog Controls ──────────────────────────────────────────────────────

function openNewRunModal() {
  if (modalNewRun) modalNewRun.hidden = false;
  inputTicketId.focus();
}

function closeNewRunModal() {
  if (modalNewRun) modalNewRun.hidden = true;
  hideError(setupError);
}

if (btnOpenNewRun) btnOpenNewRun.addEventListener("click", openNewRunModal);
if (btnQueueManual) btnQueueManual.addEventListener("click", openNewRunModal);
if (btnRunsStart) btnRunsStart.addEventListener("click", openNewRunModal);
if (btnCloseModal) btnCloseModal.addEventListener("click", closeNewRunModal);
if (btnCancelModal) btnCancelModal.addEventListener("click", closeNewRunModal);

if (modalNewRun) {
  modalNewRun.addEventListener("click", (e) => {
    if (e.target === modalNewRun) closeNewRunModal();
  });
}

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modalNewRun && !modalNewRun.hidden) {
    closeNewRunModal();
  }
});

// ── Settings Tabs ──────────────────────────────────────────────────────────────

$$(".settings-tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tabName = btn.dataset.tab;
    $$(".settings-tab-btn").forEach((b) => b.classList.remove("active"));
    $$(".settings-pane").forEach((p) => p.classList.remove("active"));

    btn.classList.add("active");
    const pane = $(`#tab-${tabName}`);
    if (pane) pane.classList.add("active");
  });
});

// ── API Helpers ────────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ── Theme (Apple Dark / Light) ───────────────────────────────────────────────

function initTheme() {
  const saved = localStorage.getItem("xf_theme");
  const prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
  const theme = saved || (prefersLight ? "light" : "dark");
  document.documentElement.setAttribute("data-theme", theme);

  const toggle = $("#theme-toggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "dark";
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("xf_theme", next);
      api("POST", "/settings", { theme: next }).catch(() => {});
    });
  }
}

// ── Init ───────────────────────────────────────────────────────────────────────

async function init() {
  initTheme();
  try {
    projects = await api("GET", "/projects");
    selectProject.innerHTML = '<option value="" disabled selected>Select a project…</option>';
    for (const p of projects) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.name} (${p.id})`;
      selectProject.appendChild(opt);
    }
    if (projects.length > 0 && !selectProject.value) {
      selectProject.value = projects[0].id;
    }
  } catch (err) {
    selectProject.innerHTML = '<option value="" disabled selected>Failed to load projects</option>';
    showError(setupError, err.message);
  }

  updateStartButton();
  refreshRunsList();
  handleHashChange();
}

// ── Setup / Modal View ─────────────────────────────────────────────────────────

function updateStartButton() {
  btnStart.disabled = !(
    selectProject.value &&
    inputTicketId.value.trim() &&
    inputPlan.value.trim()
  );
}

selectProject.addEventListener("change", () => {
  updateStartButton();
  loadWorkQueue();
  const project = projects.find((p) => p.id === selectProject.value);

  if (project?.knowledgeRepositoryPath) {
    knowledgeStatus.innerHTML = '<span class="check">✓</span> Knowledge repository configured';
  } else {
    knowledgeStatus.innerHTML = '<span class="missing">—</span> No knowledge repository configured';
  }
});

inputTicketId.addEventListener("input", updateStartButton);
inputPlan.addEventListener("input", updateStartButton);

btnStart.addEventListener("click", async () => {
  btnStart.disabled = true;
  hideError(setupError);

  const criteria = inputCriteria.value
    .split("\n")
    .map((s) => s.replace(/^[-*•\d.]+\s*/, "").trim())
    .filter(Boolean);

  try {
    const branchVal = inputBranch && inputBranch.value ? inputBranch.value.trim() : "";
    const run = await api("POST", "/runs", {
      projectId: selectProject.value,
      ticketId: inputTicketId.value.trim(),
      ticketTitle: inputTicketTitle.value.trim() || inputTicketId.value.trim(),
      plan: inputPlan.value,
      acceptanceCriteria: criteria,
      branch: branchVal || undefined,
    });
    currentRunId = run.id;
    closeNewRunModal();
    startRunView(run);
    refreshRunsList();
  } catch (err) {
    showError(setupError, err.message);
    btnStart.disabled = false;
  }
});

// ── Workflow Stepper ───────────────────────────────────────────────────────────

const STAGE_ORDER = ["prepare", "understand", "implement", "verify", "review", "deliver"];

const STATUS_TO_STAGE = {
  preparing: "prepare",
  understanding: "understand",
  implementing: "implement",
  verifying: "verify",
  reviewing: "review",
  ready_for_pr: "deliver",
  pr_created: "deliver",
  failed: null,
  stopped: null,
};

function getStepClass(status, idx, currentIdx) {
  if (status === "failed" && idx === currentIdx) return "failed";
  if (status === "pr_created" || (currentIdx !== -1 && idx < currentIdx)) return "completed";
  if (currentIdx !== -1 && idx === currentIdx) return "active";
  return "";
}

function updateStepper(status) {
  const currentStage = STATUS_TO_STAGE[status] || null;
  const currentIdx = currentStage ? STAGE_ORDER.indexOf(currentStage) : -1;

  $$(".workflow-stepper .step").forEach((el) => {
    const stage = el.dataset.stage;
    const idx = STAGE_ORDER.indexOf(stage);

    el.classList.remove("active", "completed", "failed");
    const cls = getStepClass(status, idx, currentIdx);
    if (cls) el.classList.add(cls);
  });
}

function updateEvidenceText(stage, summary) {
  const runEl = $(`#evidence-${stage}`);
  if (runEl) runEl.textContent = summary;
  const resEl = $(`#res-evidence-${stage}`);
  if (resEl) resEl.textContent = summary;
}

// ── Run View ───────────────────────────────────────────────────────────────────

function startRunView(run) {
  window.location.hash = "#/runs";
  if (runsStandby) runsStandby.hidden = true;
  if (workflowStepper) workflowStepper.style.display = "block";
  viewRun.style.display = "block";
  viewResult.style.display = "none";

  runTitle.textContent = `Run #${run.ticket.id} — ${run.ticket.title}`;
  runBranch.textContent = `Branch: ${run.branch}`;
  setStatus(run.status);
  updateStepper(run.status);

  eventLog.innerHTML = "";
  hideError(runError);
  steerBar.style.display = "flex";
  btnStop.style.display = "inline-block";
  runDiffCard.hidden = true;

  connectSSE(run.id);
}

function connectSSE(runId) {
  if (eventSource) eventSource.close();

  eventSource = new EventSource(`/api/runs/${runId}/events`);

  eventSource.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data);
      handleEvent(event);
    } catch {
      // ignore parse error
    }
  };

  eventSource.onerror = () => {
    setTimeout(() => pollRunState(runId), 2000);
  };
}

function handleEvent(event) {
  if (event.type === "status") {
    setStatus(event.status);
    updateStepper(event.status);
    refreshRunsList();

    if (event.status === "ready_for_pr" || event.status === "failed" || event.status === "stopped") {
      transitionToResult(event.status);
    }
  }

  if (event.type === "stage_evidence") {
    updateEvidenceText(event.stage, event.summary);
  }

  if (event.type === "verification" && event.result) {
    if (event.result.diff) {
      runDiffCard.hidden = false;
      runDiffFiles.textContent = `${event.result.filesChanged.length} files`;
      runDiffContent.innerHTML = formatDiff(event.result.diff);
    }
  }

  appendEvent(event);
}

function renderPiTextEvent(div, event) {
  const last = eventLog.lastElementChild;
  const rolePrefix = event.role === "reviewer" ? "[Reviewer] " : "";
  if (last && last.dataset.type === "pi_text" && last.dataset.role === event.role) {
    last.textContent += event.text;
    eventLog.scrollTop = eventLog.scrollHeight;
    return false;
  }
  div.dataset.type = "pi_text";
  div.dataset.role = event.role;
  div.textContent = `${rolePrefix}${event.text}`;
  return true;
}

function renderStatusEvent(div, event) {
  div.textContent = `[${event.status.toUpperCase()}] ${event.text}`;
  div.className += " event-status";
  return true;
}

function renderEvidenceEvent(div, event) {
  div.innerHTML = `<span class="event-prefix">✓</span><strong>${escapeHtml(event.stage.toUpperCase())}:</strong> ${escapeHtml(event.summary)}`;
  div.className += " event-evidence";
  return true;
}

function renderPiToolEvent(div, event) {
  div.className += " event-tool";
  div.innerHTML = `<span class="event-prefix">▸</span>${escapeHtml(event.tool)}${event.input ? " " + escapeHtml(event.input) : ""}`;
  return true;
}

function renderPiDoneEvent(div, event) {
  div.textContent = event.role === "reviewer" ? "Reviewer session finished." : "Implementation session finished.";
  div.className += " event-status";
  return true;
}

function renderErrorEvent(div, event) {
  div.textContent = event.error ? `Pi error: ${event.error}` : event.text;
  div.className += " event-error";
  return true;
}

function renderSteerEvent(div, event) {
  div.innerHTML = `<span class="event-prefix">→ Steer:</span> ${escapeHtml(event.text)}`;
  div.className += " event-steer";
  return true;
}

function renderCheckResultEvent(div, event) {
  const prefix = event.type === "verification" ? "Verification" : "Review";
  div.textContent = `${prefix}: ${event.result.summary}`;
  div.className += event.result.passed ? " event-status" : " event-error";
  return true;
}

const EVENT_RENDERERS = {
  status: renderStatusEvent,
  stage_evidence: renderEvidenceEvent,
  pi_text: renderPiTextEvent,
  pi_tool: renderPiToolEvent,
  pi_done: renderPiDoneEvent,
  pi_error: renderErrorEvent,
  error: renderErrorEvent,
  steer: renderSteerEvent,
  verification: renderCheckResultEvent,
  review: renderCheckResultEvent,
};

function populateEventElement(div, event) {
  const renderer = EVENT_RENDERERS[event.type];
  if (renderer) {
    return renderer(div, event);
  }
  div.textContent = event.text || JSON.stringify(event);
  return true;
}

function appendEvent(event) {
  const div = document.createElement("div");
  div.className = `event event-${event.type}`;
  const shouldAppend = populateEventElement(div, event);
  if (shouldAppend) {
    eventLog.appendChild(div);
    eventLog.scrollTop = eventLog.scrollHeight;
  }
}

function setStatus(status) {
  runStatus.textContent = status.replace(/_/g, " ");
  runStatus.dataset.status = status;

  if (status !== "implementing" && status !== "understanding") {
    steerBar.style.display = "none";
    btnStop.style.display = "none";
  }
}

// Steer
btnSteer.addEventListener("click", sendSteer);
inputSteer.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendSteer();
});

async function sendSteer() {
  const msg = inputSteer.value.trim();
  if (!msg || !currentRunId) return;
  inputSteer.value = "";

  try {
    await api("POST", `/runs/${currentRunId}/steer`, { message: msg });
  } catch (err) {
    showError(runError, err.message);
  }
}

// Stop
btnStop.addEventListener("click", async () => {
  if (!currentRunId) return;
  try {
    await api("POST", `/runs/${currentRunId}/stop`);
  } catch (err) {
    showError(runError, err.message);
  }
});

// ── Result View (Human Checkpoint) ─────────────────────────────────────────────

function renderVerificationEvidence(verification) {
  if (!verification) return;
  resultTests.textContent = verification.passed ? "PASSED" : "FAILED";
  resultTests.dataset.status = verification.passed ? "passed" : "failed";
  resultRepairCount.textContent = `Attempt ${verification.repairAttempt} of 3`;

  const out = [
    verification.tests.stdout,
    verification.tests.stderr,
    verification.typecheck?.stdout,
    verification.typecheck?.stderr,
    verification.lint?.stdout,
    verification.lint?.stderr,
  ].filter(Boolean).join("\n\n");

  if (out) {
    resultTestOutput.textContent = out;
    resultTestOutput.hidden = false;
  } else {
    resultTestOutput.hidden = true;
  }
}

function renderCriteriaRows(container, criteriaChecked) {
  container.innerHTML = "";
  for (const item of criteriaChecked || []) {
    const row = document.createElement("div");
    row.className = "criteria-row";
    row.innerHTML = `<span class="criteria-icon ${item.satisfied ? "pass" : "fail"}">${item.satisfied ? "✓" : "✗"}</span><span>${escapeHtml(item.criterion)}</span>`;
    container.appendChild(row);
  }
}

function renderFindingItems(container, findings) {
  container.innerHTML = "";
  for (const f of findings || []) {
    const item = document.createElement("div");
    item.className = `finding-item finding-${f.severity}`;
    item.innerHTML = `<span class="badge badge-${f.severity}">${f.severity.toUpperCase()}</span> <span>${escapeHtml(f.message)}</span>`;
    container.appendChild(item);
  }
}

function renderReviewEvidence(review) {
  if (!review) return;
  resultReviewBadge.textContent = review.passed ? "APPROVED" : "BLOCKING ISSUES";
  resultReviewBadge.dataset.status = review.passed ? "passed" : "failed";
  resultReviewSummary.textContent = review.summary;

  renderCriteriaRows(criteriaChecklist, review.criteriaChecked);
  renderFindingItems(findingsList, review.findings);
}

function renderDiffEvidence(diff, verification) {
  if (diff) {
    resultDiff.innerHTML = formatDiff(diff);
    resultDiffCount.textContent = `${verification?.filesChanged?.length || 0} files`;
  } else {
    resultDiff.textContent = "No git diff available.";
    resultDiffCount.textContent = "0 files";
  }
}

function renderDeliveryCheckpoint(status, pullRequest) {
  if (status === "ready_for_pr") {
    deliveryCheckpoint.hidden = false;
    btnPr.style.display = "inline-block";
  } else if (status === "pr_created") {
    deliveryCheckpoint.hidden = true;
    if (pullRequest) {
      showPrResult(pullRequest.url);
    }
  } else {
    deliveryCheckpoint.hidden = true;
  }
}

async function transitionToResult(status) {
  if (eventSource) eventSource.close();

  let run;
  try {
    run = await api("GET", `/runs/${currentRunId}`);
  } catch {
    return;
  }

  window.location.hash = "#/runs";
  if (runsStandby) runsStandby.hidden = true;
  viewRun.style.display = "none";
  viewResult.style.display = "block";

  hideError(resultError);
  prSteps.hidden = true;
  prResult.hidden = true;

  updateStepper(status);
  resultStatusBadge.textContent = status.replace(/_/g, " ");
  resultStatusBadge.dataset.status = status;

  renderVerificationEvidence(run.verification);
  renderReviewEvidence(run.review);
  renderDiffEvidence(run.diff, run.verification);
  renderDeliveryCheckpoint(status, run.pullRequest);
}

// ── PR Creation ────────────────────────────────────────────────────────────────

btnPr.addEventListener("click", async () => {
  if (!currentRunId) return;
  btnPr.disabled = true;
  hideError(resultError);
  prSteps.hidden = false;
  prSteps.innerHTML = "";

  const prEventSource = new EventSource(`/api/runs/${currentRunId}/events`);
  prEventSource.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data);
      if (event.type === "pr_step") {
        const line = document.createElement("div");
        line.textContent = `▸ ${event.text}`;
        prSteps.appendChild(line);
      }
      if (event.type === "status" && event.status === "pr_created") {
        prEventSource.close();
      }
    } catch {
      // ignore
    }
  };

  try {
    const pr = await api("POST", `/runs/${currentRunId}/pr`);
    showPrResult(pr.url);
    refreshRunsList();
  } catch (err) {
    showError(resultError, err.message);
    btnPr.disabled = false;
  } finally {
    prEventSource.close();
  }
});

function showPrResult(url) {
  deliveryCheckpoint.hidden = true;
  prResult.hidden = false;
  prLink.href = url;
  prLink.textContent = url;
}

// New Run
btnNew.addEventListener("click", () => {
  currentRunId = null;
  if (eventSource) eventSource.close();
  inputTicketId.value = "";
  inputTicketTitle.value = "";
  inputCriteria.value = "";
  inputPlan.value = "";
  updateStartButton();
  openNewRunModal();
});

// ── History & Active Runs Refresh ──────────────────────────────────────────────

async function refreshRunsList() {
  try {
    allRuns = await api("GET", "/runs");
    const activeRuns = allRuns.filter((r) =>
      ["preparing", "understanding", "implementing", "verifying", "reviewing"].includes(r.status)
    );

    if (activeRunsBadge) {
      if (activeRuns.length > 0) {
        activeRunsBadge.textContent = activeRuns.length;
        activeRunsBadge.hidden = false;
      } else {
        activeRunsBadge.hidden = true;
      }
    }
  } catch {
    // Non-fatal
  }
}

// ── Work Queue & Ticket Integration ───────────────────────────────────────────

function handleSelectTicket(ticket) {
  inputTicketId.value = ticket.id;
  inputTicketTitle.value = ticket.title;
  if (inputBranch) inputBranch.value = "";
  inputCriteria.value = (ticket.acceptanceCriteria || []).join("\n");
  if (!inputPlan.value) {
    inputPlan.value = `1. Understand ticket requirements\n2. Implement changes for ${ticket.title}\n3. Verify test suite passes without regressions\n4. Review and deliver`;
  }
  updateStartButton();
  openNewRunModal();
}

function createTicketCard(t) {
  const card = document.createElement("div");
  card.className = "ticket-card";

  const criteriaList = (t.acceptanceCriteria || [])
    .slice(0, 3)
    .map((c) => `<li>${escapeHtml(c)}</li>`)
    .join("");

  const extUrl = t.url
    ? `<a href="${escapeHtml(t.url)}" target="_blank" rel="noopener" class="text-muted" style="font-size:0.75rem;" onclick="event.stopPropagation()">View on ${escapeHtml(t.provider)} ↗</a>`
    : "";

  card.innerHTML = `
    <div class="ticket-card-header">
      <div class="ticket-badges">
        <span class="ticket-key">${escapeHtml(t.id)}</span>
        <span class="ticket-provider">${escapeHtml(t.provider)}</span>
      </div>
      <button class="btn-primary btn-sm btn-start-ticket" data-id="${escapeHtml(t.id)}">Start Run</button>
    </div>
    <h3 class="ticket-title">${escapeHtml(t.title)}</h3>
    ${criteriaList ? `<ul class="ticket-criteria">${criteriaList}</ul>` : ""}
    <div class="ticket-footer">
      <div class="ticket-tags">
        <span class="filter-pill" style="font-size:0.7rem; padding:0.2rem 0.5rem;">
          <span class="pill-dot"></span>agentic-workflow
        </span>
      </div>
      ${extUrl}
    </div>
  `;

  card.addEventListener("click", () => handleSelectTicket(t));
  const btnStartTicket = card.querySelector(".btn-start-ticket");
  if (btnStartTicket) {
    btnStartTicket.addEventListener("click", (e) => {
      e.stopPropagation();
      handleSelectTicket(t);
    });
  }
  return card;
}

function renderEmptyQueue() {
  if (!queueTicketsList) return;
  queueTicketsList.innerHTML = `
    <div class="empty-state card">
      <div class="empty-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
      </div>
      <h3>No Work Items in Queue</h3>
      <p>No open tickets with label <code>agentic-workflow</code> were found.</p>
      <button id="btn-queue-manual-empty" class="btn-secondary btn-sm" style="margin-top: 1rem;">Start Manual Run</button>
    </div>
  `;
  const btnManual = $("#btn-queue-manual-empty");
  if (btnManual) btnManual.addEventListener("click", openNewRunModal);
}

function renderTicketsList(tickets) {
  if (!queueTicketsList) return;
  if (!tickets || tickets.length === 0) {
    renderEmptyQueue();
    return;
  }

  queueTicketsList.innerHTML = "";
  for (const t of tickets) {
    queueTicketsList.appendChild(createTicketCard(t));
  }
}

function renderQueueError(msg) {
  if (!queueTicketsList) return;
  queueTicketsList.innerHTML = `
    <div class="empty-state card">
      <h3>Unable to load tickets</h3>
      <p class="error-message" style="display:inline-block; margin-top:0.5rem;">${escapeHtml(msg)}</p>
      <button id="btn-queue-retry" class="btn-secondary btn-sm" style="margin-top: 1rem;">Retry</button>
    </div>
  `;
  const btnRetry = $("#btn-queue-retry");
  if (btnRetry) btnRetry.addEventListener("click", loadWorkQueue);
}

function applyFetchedTickets(tickets) {
  cachedTickets = Array.isArray(tickets) ? tickets : [];
  if (queueSearch) {
    queueSearch.disabled = false;
    queueSearch.value = "";
  }
  renderTicketsList(cachedTickets);
  if (queueBadge) queueBadge.textContent = cachedTickets.length;
}

async function loadWorkQueue() {
  if (!queueTicketsList) return;
  const projectId = selectProject?.value || projects[0]?.id;
  if (!projectId) return;

  queueTicketsList.innerHTML = '<div class="empty-state card"><p>Checking for agentic-workflow tickets…</p></div>';

  try {
    const tickets = await api("GET", `/projects/${projectId}/tickets`);
    applyFetchedTickets(tickets);
  } catch (err) {
    renderQueueError(err.message);
  }
}



if (queueSearch) {
  queueSearch.addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase().trim();
    if (!q) {
      renderTicketsList(cachedTickets);
      return;
    }
    const filtered = cachedTickets.filter((t) => {
      const matchTitle = (t.title || "").toLowerCase().includes(q);
      const matchId = (t.id || "").toLowerCase().includes(q);
      const matchCriteria = (t.acceptanceCriteria || []).some((c) => c.toLowerCase().includes(q));
      return matchTitle || matchId || matchCriteria;
    });
    renderTicketsList(filtered);
  });
}

function handleHistoryItemClick(r) {

  currentRunId = r.id;
  window.location.hash = "#/runs";
  if (["ready_for_pr", "failed", "stopped", "pr_created"].includes(r.status)) {
    transitionToResult(r.status);
  } else {
    startRunView(r);
  }
}

function createHistoryItem(r) {
  const item = document.createElement("div");
  item.className = "history-item";
  const ticketId = r.ticket?.id || r.id;
  const ticketTitle = r.ticket?.title || "Run";
  const projectName = r.project?.name || "";
  const dateStr = new Date(r.startedAt).toLocaleString();
  const statusLabel = r.status.replace(/_/g, " ");

  item.innerHTML = `
    <div class="history-meta">
      <span class="history-ticket">#${escapeHtml(ticketId)} — ${escapeHtml(ticketTitle)}</span>
      <span class="history-sub">${escapeHtml(projectName)} · ${escapeHtml(r.branch)} · ${dateStr}</span>
    </div>
    <span class="badge" data-status="${r.status}">${escapeHtml(statusLabel)}</span>
  `;
  item.addEventListener("click", () => handleHistoryItemClick(r));
  return item;
}

async function loadHistory() {
  if (!historyContainer) return;
  try {
    allRuns = await api("GET", "/runs");
    if (!allRuns || allRuns.length === 0) {
      historyContainer.innerHTML = `
        <div class="empty-state">
          <p>No factory runs found. Launch your first run to populate history.</p>
        </div>`;
      return;
    }

    historyContainer.innerHTML = "";
    for (const r of allRuns) {
      historyContainer.appendChild(createHistoryItem(r));
    }
  } catch (err) {
    historyContainer.innerHTML = `<div class="error-message">Failed to load history: ${escapeHtml(err.message)}</div>`;
  }
}


function renderProjectsList() {
  if (!projectsContainer) return;
  if (!projects || projects.length === 0) {
    projectsContainer.innerHTML = `<div class="empty-state"><p>No projects configured in config/projects.json.</p></div>`;
    return;
  }

  projectsContainer.innerHTML = "";
  for (const p of projects) {
    const card = document.createElement("div");
    card.className = "project-card";
    card.innerHTML = `
      <h3>${escapeHtml(p.name)}</h3>
      <div class="project-card-meta"><strong>ID:</strong> ${escapeHtml(p.id)}</div>
      <div class="project-card-meta"><strong>Path:</strong> <code>${escapeHtml(p.repositoryPath)}</code></div>
      <div class="project-card-meta"><strong>Default Branch:</strong> ${escapeHtml(p.defaultBranch)}</div>
      <div class="project-card-meta"><strong>Test Command:</strong> <code>${escapeHtml(p.testCommand)}</code></div>
    `;
    projectsContainer.appendChild(card);
  }
}

// ── Settings Management ────────────────────────────────────────────────────────

function setVal(id, val) {
  const el = $(id);
  if (el) el.value = val || "";
}

function getVal(id, fallback = "") {
  const el = $(id);
  return el ? el.value : fallback;
}

function updateTrackerProviderVisibility(provider) {
  if (trackerGroupGithub) trackerGroupGithub.hidden = provider !== "github";
  if (trackerGroupJira) trackerGroupJira.hidden = provider !== "jira";
  if (trackerGroupAzure) trackerGroupAzure.hidden = provider !== "azure";
}

if (settingTrackerProvider) {
  settingTrackerProvider.addEventListener("change", (e) => {
    updateTrackerProviderVisibility(e.target.value);
  });
}

function populateTrackerFields(s) {
  const gh = s.github || {};
  const jira = s.jira || {};
  const az = s.azure || {};
  const tracker = s.activeTracker || "github";

  setVal("#setting-tracker-provider", tracker);
  updateTrackerProviderVisibility(tracker);

  const fields = {
    "#setting-github-token": gh.token,
    "#setting-github-repo": gh.repo,
    "#setting-jira-host": jira.host,
    "#setting-jira-email": jira.email,
    "#setting-jira-token": jira.token,
    "#setting-jira-project": jira.project,
    "#setting-azure-org": az.orgUrl,
    "#setting-azure-project": az.project,
    "#setting-azure-pat": az.pat,
  };
  Object.entries(fields).forEach(([id, val]) => setVal(id, val));
}

function populateModelFields(s) {
  setVal("#setting-model-a-provider", s.models?.sessionA?.provider || "anthropic");
  setVal("#setting-model-a-model", s.models?.sessionA?.model || "claude-3-7-sonnet");
  setVal("#setting-model-b-provider", s.models?.sessionB?.provider || "anthropic");
  setVal("#setting-model-b-model", s.models?.sessionB?.model || "claude-3-7-sonnet");
}

async function loadSettingsView() {
  try {
    const s = await api("GET", "/settings");
    if (!s) return;
    if (s.theme && !localStorage.getItem("xf_theme")) {
      document.documentElement.setAttribute("data-theme", s.theme);
      localStorage.setItem("xf_theme", s.theme);
    }
    populateTrackerFields(s);
    populateModelFields(s);
  } catch (err) {
    if (settingsStatus) settingsStatus.textContent = `Failed to load settings: ${err.message}`;
  }
}

function buildSettingsPayload() {
  return {
    theme: document.documentElement.getAttribute("data-theme") || "dark",
    activeTracker: getVal("#setting-tracker-provider", "github"),
    github: {
      token: getVal("#setting-github-token"),
      repo: getVal("#setting-github-repo"),
    },
    jira: {
      host: getVal("#setting-jira-host"),
      email: getVal("#setting-jira-email"),
      token: getVal("#setting-jira-token"),
      project: getVal("#setting-jira-project"),
    },
    azure: {
      orgUrl: getVal("#setting-azure-org"),
      project: getVal("#setting-azure-project"),
      pat: getVal("#setting-azure-pat"),
    },
    models: {
      sessionA: {
        provider: getVal("#setting-model-a-provider", "anthropic"),
        model: getVal("#setting-model-a-model", "claude-3-7-sonnet"),
      },
      sessionB: {
        provider: getVal("#setting-model-b-provider", "anthropic"),
        model: getVal("#setting-model-b-model", "claude-3-7-sonnet"),
      },
    },
  };
}


async function saveSettingsView() {
  if (!btnSaveSettings) return;
  btnSaveSettings.disabled = true;
  if (settingsStatus) settingsStatus.textContent = "Saving…";

  try {
    const payload = buildSettingsPayload();
    await api("POST", "/settings", payload);
    if (settingsStatus) {
      settingsStatus.textContent = "✓ Settings saved";
      setTimeout(() => {
        if (settingsStatus.textContent === "✓ Settings saved") {
          settingsStatus.textContent = "";
        }
      }, 3000);
    }
  } catch (err) {
    if (settingsStatus) settingsStatus.textContent = `Error: ${err.message}`;
  } finally {
    btnSaveSettings.disabled = false;
  }
}

if (btnSaveSettings) {
  btnSaveSettings.addEventListener("click", saveSettingsView);
}

// Fallback Polling

async function pollRunState(runId) {
  if (runId !== currentRunId) return;
  try {
    const run = await api("GET", `/runs/${runId}`);
    setStatus(run.status);
    updateStepper(run.status);
    if (["ready_for_pr", "failed", "stopped", "pr_created"].includes(run.status)) {
      transitionToResult(run.status);
    } else {
      connectSSE(runId);
    }
  } catch {
    // ignore
  }
}

// ── Syntax / Diff Utilities ────────────────────────────────────────────────────

function formatDiff(diffText) {
  if (!diffText) return "";
  const lines = diffText.split("\n");
  return lines
    .map((line) => {
      const esc = escapeHtml(line);
      if (line.startsWith("+") && !line.startsWith("+++")) {
        return `<span class="diff-line diff-add">${esc}</span>`;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        return `<span class="diff-line diff-del">${esc}</span>`;
      } else if (line.startsWith("@@")) {
        return `<span class="diff-line diff-hunk">${esc}</span>`;
      }
      return `<span class="diff-line">${esc}</span>`;
    })
    .join("\n");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function showError(el, msg) {
  el.textContent = msg;
  el.hidden = false;
}

function hideError(el) {
  el.hidden = true;
  el.textContent = "";
}

// ── Startup ────────────────────────────────────────────────────────────────────

init();
