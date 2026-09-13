// fallow-ignore-file coverage-gaps
// public/app.js — X-Factory frontend logic for the 6-stage software factory runtime.

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ── State ──────────────────────────────────────────────────────────────────────

let currentRunId = null;
let eventSource = null;
let projects = [];

// ── Elements ───────────────────────────────────────────────────────────────────

const viewSetup  = $("#view-setup");
const viewRun    = $("#view-run");
const viewResult = $("#view-result");

const selectProject    = $("#select-project");
const inputTicketId    = $("#input-ticket-id");
const inputTicketTitle = $("#input-ticket-title");
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

// ── View Switching ─────────────────────────────────────────────────────────────

function showView(view) {
  viewSetup.classList.remove("active");
  viewRun.classList.remove("active");
  viewResult.classList.remove("active");
  view.classList.add("active");
}

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

// ── Init ───────────────────────────────────────────────────────────────────────

async function init() {
  try {
    projects = await api("GET", "/projects");
    selectProject.innerHTML = '<option value="" disabled selected>Select a project…</option>';
    for (const p of projects) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.name} (${p.id})`;
      selectProject.appendChild(opt);
    }
  } catch (err) {
    selectProject.innerHTML = '<option value="" disabled selected>Failed to load projects</option>';
    showError(setupError, err.message);
  }
  updateStartButton();
}

// ── Setup View ─────────────────────────────────────────────────────────────────

function updateStartButton() {
  btnStart.disabled = !(
    selectProject.value &&
    inputTicketId.value.trim() &&
    inputPlan.value.trim()
  );
}

selectProject.addEventListener("change", () => {
  updateStartButton();
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
    const run = await api("POST", "/runs", {
      projectId: selectProject.value,
      ticketId: inputTicketId.value.trim(),
      ticketTitle: inputTicketTitle.value.trim() || inputTicketId.value.trim(),
      plan: inputPlan.value,
      acceptanceCriteria: criteria,
    });
    currentRunId = run.id;
    startRunView(run);
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
  showView(viewRun);
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

  showView(viewResult);
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
  showView(viewSetup);
});

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
