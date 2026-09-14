// fallow-ignore-file coverage-gaps
// public/js/runs.js — Execution workbench, SSE streaming, workflow stepper, steering, and PR delivery.

import { $, $$, escapeHtml, formatDiff, showError, hideError, api } from "./utils.js";
import { state } from "./state.js";
import { closeNewRunModal, openNewRunModal } from "./router.js";
import { updateKnowledgeStatus } from "./projects.js";
import { loadWorkQueue } from "./queue.js";

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

export function syncRunsView() {
  const runsStandby = $("#runs-standby");
  const workflowStepper = $("#workflow-stepper");
  const viewRun = $("#view-run");
  const viewResult = $("#view-result");

  if (!state.currentRunId) {
    if (runsStandby) runsStandby.hidden = false;
    if (workflowStepper) workflowStepper.style.display = "none";
    if (viewRun) viewRun.style.display = "none";
    if (viewResult) viewResult.style.display = "none";
  } else {
    if (runsStandby) runsStandby.hidden = true;
    if (workflowStepper) workflowStepper.style.display = "block";
  }
}

function setStatus(status) {
  const runStatus = $("#run-status");
  const steerBar = $("#steer-bar");
  const btnStop = $("#btn-stop");

  if (runStatus) {
    runStatus.textContent = status.replace(/_/g, " ");
    runStatus.dataset.status = status;
  }

  if (status !== "implementing" && status !== "understanding") {
    if (steerBar) steerBar.style.display = "none";
    if (btnStop) btnStop.style.display = "none";
  }
}

function renderPiTextEvent(div, event) {
  const eventLog = $("#event-log");
  const last = eventLog?.lastElementChild;
  const rolePrefix = event.role === "reviewer" ? "[Reviewer] " : "";
  if (last && last.dataset.type === "pi_text" && last.dataset.role === event.role) {
    last.textContent += event.text;
    if (eventLog) eventLog.scrollTop = eventLog.scrollHeight;
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

function appendEvent(event) {
  const eventLog = $("#event-log");
  if (!eventLog) return;
  const div = document.createElement("div");
  div.className = `event event-${event.type}`;
  const renderer = EVENT_RENDERERS[event.type];
  const shouldAppend = renderer ? renderer(div, event) : (div.textContent = event.text || JSON.stringify(event), true);
  if (shouldAppend) {
    eventLog.appendChild(div);
    eventLog.scrollTop = eventLog.scrollHeight;
  }
}

function handleEvent(event) {
  const runDiffCard = $("#run-diff-card");
  const runDiffFiles = $("#run-diff-files");
  const runDiffContent = $("#run-diff-content");

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
    if (event.result.diff && runDiffCard && runDiffFiles && runDiffContent) {
      runDiffCard.hidden = false;
      runDiffFiles.textContent = `${event.result.filesChanged.length} files`;
      runDiffContent.innerHTML = formatDiff(event.result.diff);
    }
  }

  appendEvent(event);
}

function connectSSE(runId) {
  if (state.eventSource) state.eventSource.close();

  state.eventSource = new EventSource(`/api/runs/${runId}/events`);

  state.eventSource.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data);
      handleEvent(event);
    } catch {
      // ignore parse error
    }
  };

  state.eventSource.onerror = () => {
    setTimeout(async () => {
      try {
        const run = await api("GET", `/runs/${runId}`);
        handleEvent({ type: "status", status: run.status });
      } catch {
        // ignore
      }
    }, 2000);
  };
}

function startRunView(run) {
  state.currentRunId = run.id;
  window.location.hash = "#/runs";
  const runsStandby = $("#runs-standby");
  const workflowStepper = $("#workflow-stepper");
  const viewRun = $("#view-run");
  const viewResult = $("#view-result");
  const runTitle = $("#run-title");
  const runBranch = $("#run-branch");
  const eventLog = $("#event-log");
  const runError = $("#run-error");
  const steerBar = $("#steer-bar");
  const btnStop = $("#btn-stop");
  const runDiffCard = $("#run-diff-card");

  if (runsStandby) runsStandby.hidden = true;
  if (workflowStepper) workflowStepper.style.display = "block";
  if (viewRun) viewRun.style.display = "block";
  if (viewResult) viewResult.style.display = "none";

  if (runTitle) runTitle.textContent = `Run #${run.ticket.id} — ${run.ticket.title}`;
  if (runBranch) runBranch.textContent = `Branch: ${run.branch}`;
  setStatus(run.status);
  updateStepper(run.status);

  if (eventLog) eventLog.innerHTML = "";
  hideError(runError);
  if (steerBar) steerBar.style.display = "flex";
  if (btnStop) btnStop.style.display = "inline-block";
  if (runDiffCard) runDiffCard.hidden = true;

  connectSSE(run.id);
}

function renderVerificationEvidence(verification) {
  const resultTests = $("#result-tests");
  const resultRepairCount = $("#result-repair-count");
  const resultTestOutput = $("#result-test-output");
  if (!verification || !resultTests) return;

  resultTests.textContent = verification.passed ? "PASSED" : "FAILED";
  resultTests.dataset.status = verification.passed ? "passed" : "failed";
  if (resultRepairCount) resultRepairCount.textContent = `Attempt ${verification.repairAttempt} of 3`;

  const out = [
    verification.tests.stdout,
    verification.tests.stderr,
    verification.typecheck?.stdout,
    verification.typecheck?.stderr,
    verification.lint?.stdout,
    verification.lint?.stderr,
  ].filter(Boolean).join("\n\n");

  if (resultTestOutput) {
    if (out) {
      resultTestOutput.textContent = out;
      resultTestOutput.hidden = false;
    } else {
      resultTestOutput.hidden = true;
    }
  }
}

function renderCriteriaRows(container, criteriaChecked) {
  if (!container) return;
  container.innerHTML = "";
  for (const item of criteriaChecked || []) {
    const row = document.createElement("div");
    row.className = "criteria-row";
    row.innerHTML = `<span class="criteria-icon ${item.satisfied ? "pass" : "fail"}">${item.satisfied ? "✓" : "✗"}</span><span>${escapeHtml(item.criterion)}</span>`;
    container.appendChild(row);
  }
}

function renderFindingItems(container, findings) {
  if (!container) return;
  container.innerHTML = "";
  for (const f of findings || []) {
    const item = document.createElement("div");
    item.className = `finding-item finding-${f.severity}`;
    item.innerHTML = `<span class="badge badge-${f.severity}">${f.severity.toUpperCase()}</span> <span>${escapeHtml(f.message)}</span>`;
    container.appendChild(item);
  }
}

function renderReviewEvidence(review) {
  const resultReviewBadge = $("#result-review-badge");
  const resultReviewSummary = $("#result-review-summary");
  const criteriaChecklist = $("#criteria-checklist");
  const findingsList = $("#findings-list");
  if (!review) return;

  if (resultReviewBadge) {
    resultReviewBadge.textContent = review.passed ? "APPROVED" : "BLOCKING ISSUES";
    resultReviewBadge.dataset.status = review.passed ? "passed" : "failed";
  }
  if (resultReviewSummary) resultReviewSummary.textContent = review.summary;

  renderCriteriaRows(criteriaChecklist, review.criteriaChecked);
  renderFindingItems(findingsList, review.findings);
}

function renderDiffEvidence(diff, verification) {
  const resultDiff = $("#result-diff");
  const resultDiffCount = $("#result-diff-count");
  if (!resultDiff) return;

  if (diff) {
    resultDiff.innerHTML = formatDiff(diff);
    if (resultDiffCount) resultDiffCount.textContent = `${verification?.filesChanged?.length || 0} files`;
  } else {
    resultDiff.textContent = "No git diff available.";
    if (resultDiffCount) resultDiffCount.textContent = "0 files";
  }
}

function renderDeliveryCheckpoint(status, pullRequest) {
  const deliveryCheckpoint = $("#delivery-checkpoint");
  const btnPr = $("#btn-pr");
  if (!deliveryCheckpoint) return;

  if (status === "ready_for_pr") {
    deliveryCheckpoint.hidden = false;
    if (btnPr) btnPr.style.display = "inline-block";
  } else if (status === "pr_created") {
    deliveryCheckpoint.hidden = true;
    if (pullRequest) {
      showPrResult(pullRequest.url);
    }
  } else {
    deliveryCheckpoint.hidden = true;
  }
}

function showPrResult(url) {
  const deliveryCheckpoint = $("#delivery-checkpoint");
  const prResult = $("#pr-result");
  const prLink = $("#pr-link");
  if (deliveryCheckpoint) deliveryCheckpoint.hidden = true;
  if (prResult) prResult.hidden = false;
  if (prLink) {
    prLink.href = url;
    prLink.textContent = url;
  }
}

async function transitionToResult(status) {
  if (state.eventSource) state.eventSource.close();
  if (!state.currentRunId) return;

  let run;
  try {
    run = await api("GET", `/runs/${state.currentRunId}`);
  } catch {
    return;
  }

  window.location.hash = "#/runs";
  const runsStandby = $("#runs-standby");
  const viewRun = $("#view-run");
  const viewResult = $("#view-result");
  const resultError = $("#result-error");
  const prSteps = $("#pr-steps");
  const prResult = $("#pr-result");
  const resultStatusBadge = $("#result-status-badge");

  if (runsStandby) runsStandby.hidden = true;
  if (viewRun) viewRun.style.display = "none";
  if (viewResult) viewResult.style.display = "block";

  hideError(resultError);
  if (prSteps) prSteps.hidden = true;
  if (prResult) prResult.hidden = true;

  updateStepper(status);
  if (resultStatusBadge) {
    resultStatusBadge.textContent = status.replace(/_/g, " ");
    resultStatusBadge.dataset.status = status;
  }

  renderVerificationEvidence(run.verification);
  renderReviewEvidence(run.review);
  renderDiffEvidence(run.diff, run.verification);
  renderDeliveryCheckpoint(status, run.pullRequest);
}

export async function refreshRunsList() {
  const activeRunsBadge = $("#active-runs-badge");
  try {
    state.allRuns = await api("GET", "/runs");
    const activeRuns = state.allRuns.filter((r) =>
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

function handleHistoryItemClick(r) {
  state.currentRunId = r.id;
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

export async function loadHistory() {
  const historyContainer = $("#history-runs-container");
  if (!historyContainer) return;
  try {
    state.allRuns = await api("GET", "/runs");
    if (!state.allRuns || state.allRuns.length === 0) {
      historyContainer.innerHTML = `
        <div class="empty-state">
          <p>No factory runs found. Launch your first run to populate history.</p>
        </div>`;
      return;
    }

    historyContainer.innerHTML = "";
    for (const r of state.allRuns) {
      historyContainer.appendChild(createHistoryItem(r));
    }
  } catch (err) {
    historyContainer.innerHTML = `<div class="error-message">Failed to load history: ${escapeHtml(err instanceof Error ? err.message : String(err))}</div>`;
  }
}

export function updateStartButton() {
  const btnStart = $("#btn-start");
  const selectProject = $("#select-project");
  const inputTicketId = $("#input-ticket-id");
  const inputPlan = $("#input-plan");

  if (!btnStart) return;
  btnStart.disabled = !(
    selectProject?.value &&
    inputTicketId?.value.trim() &&
    inputPlan?.value.trim()
  );
}

export function initRuns() {
  const btnStart = $("#btn-start");
  const selectProject = $("#select-project");
  const inputTicketId = $("#input-ticket-id");
  const inputTicketTitle = $("#input-ticket-title");
  const inputPlan = $("#input-plan");
  const inputCriteria = $("#input-criteria");
  const inputBranch = $("#input-branch");
  const setupError = $("#setup-error");
  const btnSteer = $("#btn-steer");
  const inputSteer = $("#input-steer");
  const btnStop = $("#btn-stop");
  const runError = $("#run-error");
  const btnPr = $("#btn-pr");
  const resultError = $("#result-error");
  const prSteps = $("#pr-steps");
  const btnNew = $("#btn-new");

  if (selectProject) {
    selectProject.addEventListener("change", () => {
      updateStartButton();
      loadWorkQueue();
      updateKnowledgeStatus(selectProject.value);
    });
  }

  if (inputTicketId) inputTicketId.addEventListener("input", updateStartButton);
  if (inputPlan) inputPlan.addEventListener("input", updateStartButton);

  if (btnStart) {
    btnStart.addEventListener("click", async () => {
      btnStart.disabled = true;
      hideError(setupError);

      const criteria = (inputCriteria?.value || "")
        .split("\n")
        .map((s) => s.replace(/^[-*•\d.]+\s*/, "").trim())
        .filter(Boolean);

      try {
        const branchVal = inputBranch && inputBranch.value ? inputBranch.value.trim() : "";
        const run = await api("POST", "/runs", {
          projectId: selectProject?.value,
          ticketId: inputTicketId?.value.trim(),
          ticketTitle: inputTicketTitle?.value.trim() || inputTicketId?.value.trim(),
          plan: inputPlan?.value,
          acceptanceCriteria: criteria,
          branch: branchVal || undefined,
        });
        state.currentRunId = run.id;
        closeNewRunModal();
        startRunView(run);
        refreshRunsList();
      } catch (err) {
        showError(setupError, err instanceof Error ? err.message : String(err));
        btnStart.disabled = false;
      }
    });
  }

  async function sendSteer() {
    const msg = inputSteer?.value.trim();
    if (!msg || !state.currentRunId) return;
    if (inputSteer) inputSteer.value = "";

    try {
      await api("POST", `/runs/${state.currentRunId}/steer`, { message: msg });
    } catch (err) {
      showError(runError, err instanceof Error ? err.message : String(err));
    }
  }

  if (btnSteer) btnSteer.addEventListener("click", sendSteer);
  if (inputSteer) {
    inputSteer.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendSteer();
    });
  }

  if (btnStop) {
    btnStop.addEventListener("click", async () => {
      if (!state.currentRunId) return;
      try {
        await api("POST", `/runs/${state.currentRunId}/stop`);
      } catch (err) {
        showError(runError, err instanceof Error ? err.message : String(err));
      }
    });
  }

  if (btnPr) {
    btnPr.addEventListener("click", async () => {
      if (!state.currentRunId) return;
      btnPr.disabled = true;
      hideError(resultError);
      if (prSteps) {
        prSteps.hidden = false;
        prSteps.innerHTML = "";
      }

      const prEventSource = new EventSource(`/api/runs/${state.currentRunId}/events`);
      prEventSource.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          if (event.type === "pr_step" && prSteps) {
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
        const pr = await api("POST", `/runs/${state.currentRunId}/pr`);
        showPrResult(pr.url);
        refreshRunsList();
      } catch (err) {
        showError(resultError, err instanceof Error ? err.message : String(err));
        btnPr.disabled = false;
      } finally {
        prEventSource.close();
      }
    });
  }

  if (btnNew) {
    btnNew.addEventListener("click", () => {
      state.currentRunId = null;
      if (state.eventSource) state.eventSource.close();
      if (inputTicketId) inputTicketId.value = "";
      if (inputTicketTitle) inputTicketTitle.value = "";
      if (inputCriteria) inputCriteria.value = "";
      if (inputPlan) inputPlan.value = "";
      updateStartButton();
      openNewRunModal();
    });
  }
}
