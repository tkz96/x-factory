// public/js/runs.ts — Execution workbench, SSE streaming, workflow stepper, steering, and PR delivery.

import type {
  Finding,
  PullRequest,
  ReviewResult,
  Run,
  RunEvent,
  RunEventPayload,
  RunStatus,
  VerificationResult,
  WorkflowStage,
} from "../../src/shared/types.js";
import { clearElement, el, renderDiffElements } from "./dom.js";
import { updateKnowledgeStatus } from "./projects.js";
import { loadWorkQueue } from "./queue.js";
import { closeNewRunModal, openNewRunModal } from "./router.js";
import { state } from "./state.js";
import { $, $$, api, hideError, showError } from "./utils.js";

const STAGE_ORDER: WorkflowStage[] = [
  "prepare",
  "understand",
  "implement",
  "verify",
  "review",
  "deliver",
];

const STATUS_TO_STAGE: Record<RunStatus, WorkflowStage | null> = {
  queued: "prepare",
  preparing: "prepare",
  understanding: "understand",
  implementing: "implement",
  verifying: "verify",
  reviewing: "review",
  ready_for_pr: "deliver",
  pr_created: "deliver",
  recovery_required: null,
  failed: null,
  stopped: null,
};

function getStepClass(
  status: RunStatus,
  idx: number,
  currentIdx: number,
): string {
  if (status === "failed" && idx === currentIdx) return "failed";
  if (status === "pr_created" || (currentIdx !== -1 && idx < currentIdx))
    return "completed";
  if (currentIdx !== -1 && idx === currentIdx) return "active";
  return "";
}

function updateStepper(status: RunStatus): void {
  const currentStage = STATUS_TO_STAGE[status] || null;
  const currentIdx = currentStage ? STAGE_ORDER.indexOf(currentStage) : -1;

  $$<HTMLElement>(".workflow-stepper .step").forEach((elStep) => {
    const stage = elStep.dataset.stage as WorkflowStage | undefined;
    const idx = stage ? STAGE_ORDER.indexOf(stage) : -1;

    elStep.classList.remove("active", "completed", "failed");
    const cls = getStepClass(status, idx, currentIdx);
    if (cls) elStep.classList.add(cls);
  });
}

function updateEvidenceText(stage: string, summary: string): void {
  const runEl = $(`#evidence-${stage}`);
  if (runEl) runEl.textContent = summary;
  const resEl = $(`#res-evidence-${stage}`);
  if (resEl) resEl.textContent = summary;
}

export function syncRunsView(): void {
  const runsStandby = $<HTMLElement>("#runs-standby");
  const workflowStepper = $<HTMLElement>("#workflow-stepper");
  const viewRun = $<HTMLElement>("#view-run");
  const viewResult = $<HTMLElement>("#view-result");

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

function setStatus(status: RunStatus): void {
  const runStatus = $<HTMLElement>("#run-status");
  const steerBar = $<HTMLElement>("#steer-bar");
  const btnStop = $<HTMLElement>("#btn-stop");

  if (runStatus) {
    runStatus.textContent = status.replace(/_/g, " ");
    runStatus.dataset.status = status;
  }

  if (status !== "implementing" && status !== "understanding") {
    if (steerBar) steerBar.style.display = "none";
    if (btnStop) btnStop.style.display = "none";
  }
}

function renderPiTextEvent(
  div: HTMLElement,
  event: Extract<RunEventPayload, { type: "pi_text" }>,
): boolean {
  const eventLog = $<HTMLElement>("#event-log");
  const last = eventLog?.lastElementChild as HTMLElement | null;
  const rolePrefix = event.role === "reviewer" ? "[Reviewer] " : "";
  if (
    last &&
    last.dataset.type === "pi_text" &&
    last.dataset.role === event.role
  ) {
    last.textContent += event.text;
    if (eventLog) eventLog.scrollTop = eventLog.scrollHeight;
    return false;
  }
  div.dataset.type = "pi_text";
  div.dataset.role = event.role;
  div.textContent = `${rolePrefix}${event.text}`;
  return true;
}

function renderStatusEvent(
  div: HTMLElement,
  event: Extract<RunEventPayload, { type: "status" }>,
): boolean {
  div.textContent = `[${event.status.toUpperCase()}] ${event.text}`;
  div.className += " event-status";
  return true;
}

function renderEvidenceEvent(
  div: HTMLElement,
  event: Extract<RunEventPayload, { type: "stage_evidence" }>,
): boolean {
  div.className += " event-evidence";
  div.appendChild(el("span", { className: "event-prefix", textContent: "✓" }));
  div.appendChild(
    el("strong", { textContent: `${event.stage.toUpperCase()}: ` }),
  );
  div.appendChild(document.createTextNode(event.summary));
  return true;
}

function renderPiToolEvent(
  div: HTMLElement,
  event: Extract<RunEventPayload, { type: "pi_tool" }>,
): boolean {
  div.className += " event-tool";
  div.appendChild(el("span", { className: "event-prefix", textContent: "▸" }));
  div.appendChild(document.createTextNode(event.tool));
  if (event.input) {
    div.appendChild(document.createTextNode(` ${event.input}`));
  }
  return true;
}

function renderPiDoneEvent(
  div: HTMLElement,
  event: Extract<RunEventPayload, { type: "pi_done" }>,
): boolean {
  div.textContent =
    event.role === "reviewer"
      ? "Reviewer session finished."
      : "Implementation session finished.";
  div.className += " event-status";
  return true;
}

function renderErrorEvent(
  div: HTMLElement,
  event:
    | Extract<RunEventPayload, { type: "pi_error" }>
    | Extract<RunEventPayload, { type: "error" }>,
): boolean {
  div.textContent =
    "error" in event && event.error
      ? `Pi error: ${event.error}`
      : "text" in event
        ? event.text
        : "Error occurred";
  div.className += " event-error";
  return true;
}

function renderSteerEvent(
  div: HTMLElement,
  event: Extract<RunEventPayload, { type: "steer" }>,
): boolean {
  div.className += " event-steer";
  div.appendChild(
    el("span", { className: "event-prefix", textContent: "→ Steer: " }),
  );
  div.appendChild(document.createTextNode(event.text));
  return true;
}

function renderCheckResultEvent(
  div: HTMLElement,
  event:
    | Extract<RunEventPayload, { type: "verification" }>
    | Extract<RunEventPayload, { type: "review" }>,
): boolean {
  const prefix = event.type === "verification" ? "Verification" : "Review";
  div.textContent = `${prefix}: ${event.result.summary}`;
  div.className += event.result.passed ? " event-status" : " event-error";
  return true;
}

function appendEvent(event: RunEventPayload): void {
  const eventLog = $<HTMLElement>("#event-log");
  if (!eventLog) return;
  const div = document.createElement("div");
  div.className = `event event-${event.type}`;

  let shouldAppend = true;
  switch (event.type) {
    case "status":
      shouldAppend = renderStatusEvent(div, event);
      break;
    case "stage_evidence":
      shouldAppend = renderEvidenceEvent(div, event);
      break;
    case "pi_text":
      shouldAppend = renderPiTextEvent(div, event);
      break;
    case "pi_tool":
      shouldAppend = renderPiToolEvent(div, event);
      break;
    case "pi_done":
      shouldAppend = renderPiDoneEvent(div, event);
      break;
    case "pi_error":
    case "error":
      shouldAppend = renderErrorEvent(div, event);
      break;
    case "steer":
      shouldAppend = renderSteerEvent(div, event);
      break;
    case "verification":
    case "review":
      shouldAppend = renderCheckResultEvent(div, event);
      break;
    default:
      div.textContent =
        "text" in event ? (event.text as string) : JSON.stringify(event);
  }

  if (shouldAppend) {
    eventLog.appendChild(div);
    eventLog.scrollTop = eventLog.scrollHeight;
  }
}

function handleEvent(event: RunEventPayload): void {
  const runDiffCard = $<HTMLElement>("#run-diff-card");
  const runDiffFiles = $<HTMLElement>("#run-diff-files");
  const runDiffContent = $<HTMLElement>("#run-diff-content");

  if (event.type === "status") {
    setStatus(event.status);
    updateStepper(event.status);
    void refreshRunsList();

    if (
      event.status === "ready_for_pr" ||
      event.status === "failed" ||
      event.status === "stopped"
    ) {
      void transitionToResult(event.status);
    }
  }

  if (event.type === "stage_evidence") {
    updateEvidenceText(event.stage, event.summary);
  }

  if (event.type === "verification" && event.result) {
    if (event.result.diff && runDiffCard && runDiffFiles && runDiffContent) {
      runDiffCard.hidden = false;
      runDiffFiles.textContent = `${event.result.filesChanged.length} files`;
      clearElement(runDiffContent);
      for (const line of renderDiffElements(event.result.diff)) {
        runDiffContent.appendChild(line);
        runDiffContent.appendChild(document.createTextNode("\n"));
      }
    }
  }

  appendEvent(event);
}

function connectSSE(runId: string): void {
  if (state.eventSource) state.eventSource.close();

  state.eventSource = new EventSource(`/api/runs/${runId}/events`);

  state.eventSource.onmessage = (e: MessageEvent) => {
    try {
      const event = JSON.parse(e.data) as RunEventPayload;
      handleEvent(event);
    } catch {
      // ignore parse error
    }
  };

  state.eventSource.onerror = () => {
    setTimeout(async () => {
      try {
        const run = await api<Run>("GET", `/runs/${runId}`);
        handleEvent({ type: "status", status: run.status, text: "" });
      } catch {
        // ignore
      }
    }, 2000);
  };
}

function startRunView(run: Run): void {
  state.currentRunId = run.id;
  window.location.hash = "#/runs";
  const runsStandby = $<HTMLElement>("#runs-standby");
  const workflowStepper = $<HTMLElement>("#workflow-stepper");
  const viewRun = $<HTMLElement>("#view-run");
  const viewResult = $<HTMLElement>("#view-result");
  const runTitle = $<HTMLElement>("#run-title");
  const runBranch = $<HTMLElement>("#run-branch");
  const eventLog = $<HTMLElement>("#event-log");
  const runError = $<HTMLElement>("#run-error");
  const steerBar = $<HTMLElement>("#steer-bar");
  const btnStop = $<HTMLElement>("#btn-stop");
  const runDiffCard = $<HTMLElement>("#run-diff-card");

  if (runsStandby) runsStandby.hidden = true;
  if (workflowStepper) workflowStepper.style.display = "block";
  if (viewRun) viewRun.style.display = "block";
  if (viewResult) viewResult.style.display = "none";

  if (runTitle) {
    runTitle.textContent = `Run #${run.ticket.id} — ${run.ticket.title}`;
  }
  if (runBranch) runBranch.textContent = `Branch: ${run.branch}`;
  setStatus(run.status);
  updateStepper(run.status);

  clearElement(eventLog);
  hideError(runError);
  if (steerBar) steerBar.style.display = "flex";
  if (btnStop) btnStop.style.display = "inline-block";
  if (runDiffCard) runDiffCard.hidden = true;

  connectSSE(run.id);
}

function renderVerificationEvidence(
  verification: VerificationResult | null,
): void {
  const resultTests = $<HTMLElement>("#result-tests");
  const resultRepairCount = $<HTMLElement>("#result-repair-count");
  const resultTestOutput = $<HTMLElement>("#result-test-output");
  if (!verification || !resultTests) return;

  resultTests.textContent = verification.passed ? "PASSED" : "FAILED";
  resultTests.dataset.status = verification.passed ? "passed" : "failed";
  if (resultRepairCount) {
    resultRepairCount.textContent = `Attempt ${verification.repairAttempt} of 3`;
  }

  const out = [
    verification.tests.stdout,
    verification.tests.stderr,
    verification.typecheck?.stdout,
    verification.typecheck?.stderr,
    verification.lint?.stdout,
    verification.lint?.stderr,
  ]
    .filter(Boolean)
    .join("\n\n");

  if (resultTestOutput) {
    if (out) {
      resultTestOutput.textContent = out;
      resultTestOutput.hidden = false;
    } else {
      resultTestOutput.hidden = true;
    }
  }
}

function renderCriteriaRows(
  container: HTMLElement | null,
  criteriaChecked: ReviewResult["criteriaChecked"],
): void {
  if (!container) return;
  clearElement(container);
  for (const item of criteriaChecked || []) {
    const row = el("div", { className: "criteria-row" }, [
      el("span", {
        className: `criteria-icon ${item.satisfied ? "pass" : "fail"}`,
        textContent: item.satisfied ? "✓" : "✗",
      }),
      el("span", { textContent: item.criterion }),
    ]);
    container.appendChild(row);
  }
}

function renderFindingItems(
  container: HTMLElement | null,
  findings: Finding[],
): void {
  if (!container) return;
  clearElement(container);
  for (const f of findings || []) {
    const item = el(
      "div",
      { className: `finding-item finding-${f.severity}` },
      [
        el("span", {
          className: `badge badge-${f.severity}`,
          textContent: f.severity.toUpperCase(),
        }),
        document.createTextNode(" "),
        el("span", { textContent: f.message }),
      ],
    );
    container.appendChild(item);
  }
}

function renderReviewEvidence(review: ReviewResult | null): void {
  const resultReviewBadge = $<HTMLElement>("#result-review-badge");
  const resultReviewSummary = $<HTMLElement>("#result-review-summary");
  const criteriaChecklist = $<HTMLElement>("#criteria-checklist");
  const findingsList = $<HTMLElement>("#findings-list");
  if (!review) return;

  if (resultReviewBadge) {
    resultReviewBadge.textContent = review.passed
      ? "APPROVED"
      : "BLOCKING ISSUES";
    resultReviewBadge.dataset.status = review.passed ? "passed" : "failed";
  }
  if (resultReviewSummary) resultReviewSummary.textContent = review.summary;

  renderCriteriaRows(criteriaChecklist, review.criteriaChecked);
  renderFindingItems(findingsList, review.findings);
}

function renderDiffEvidence(
  diff: string | null,
  verification: VerificationResult | null,
): void {
  const resultDiff = $<HTMLElement>("#result-diff");
  const resultDiffCount = $<HTMLElement>("#result-diff-count");
  if (!resultDiff) return;

  if (diff) {
    clearElement(resultDiff);
    for (const line of renderDiffElements(diff)) {
      resultDiff.appendChild(line);
      resultDiff.appendChild(document.createTextNode("\n"));
    }
    if (resultDiffCount) {
      resultDiffCount.textContent = `${verification?.filesChanged?.length || 0} files`;
    }
  } else {
    resultDiff.textContent = "No git diff available.";
    if (resultDiffCount) resultDiffCount.textContent = "0 files";
  }
}

function renderDeliveryCheckpoint(
  status: RunStatus,
  pullRequest: PullRequest | null,
): void {
  const deliveryCheckpoint = $<HTMLElement>("#delivery-checkpoint");
  const btnPr = $<HTMLButtonElement>("#btn-pr");
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

function showPrResult(url: string): void {
  const deliveryCheckpoint = $<HTMLElement>("#delivery-checkpoint");
  const prResult = $<HTMLElement>("#pr-result");
  const prLink = $<HTMLAnchorElement>("#pr-link");
  if (deliveryCheckpoint) deliveryCheckpoint.hidden = true;
  if (prResult) prResult.hidden = false;
  if (prLink) {
    prLink.href = url;
    prLink.textContent = url;
  }
}

async function transitionToResult(status: RunStatus): Promise<void> {
  if (state.eventSource) state.eventSource.close();
  if (!state.currentRunId) return;

  let run: Run;
  try {
    run = await api<Run>("GET", `/runs/${state.currentRunId}`);
  } catch {
    return;
  }

  window.location.hash = "#/runs";
  const runsStandby = $<HTMLElement>("#runs-standby");
  const viewRun = $<HTMLElement>("#view-run");
  const viewResult = $<HTMLElement>("#view-result");
  const resultError = $<HTMLElement>("#result-error");
  const prSteps = $<HTMLElement>("#pr-steps");
  const prResult = $<HTMLElement>("#pr-result");
  const resultStatusBadge = $<HTMLElement>("#result-status-badge");

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

export async function refreshRunsList(): Promise<void> {
  const activeRunsBadge = $<HTMLElement>("#active-runs-badge");
  try {
    state.allRuns = await api<Run[]>("GET", "/runs");
    const activeRuns = state.allRuns.filter((r) =>
      [
        "preparing",
        "understanding",
        "implementing",
        "verifying",
        "reviewing",
      ].includes(r.status),
    );

    if (activeRunsBadge) {
      if (activeRuns.length > 0) {
        activeRunsBadge.textContent = String(activeRuns.length);
        activeRunsBadge.hidden = false;
      } else {
        activeRunsBadge.hidden = true;
      }
    }
  } catch {
    // Non-fatal
  }
}

function handleHistoryItemClick(r: Run): void {
  state.currentRunId = r.id;
  window.location.hash = "#/runs";
  if (["ready_for_pr", "failed", "stopped", "pr_created"].includes(r.status)) {
    void transitionToResult(r.status);
  } else {
    startRunView(r);
  }
}

function createHistoryItem(r: Run): HTMLElement {
  const ticketId = r.ticket?.id || r.id;
  const ticketTitle = r.ticket?.title || "Run";
  const projectName = r.project?.name || "";
  const dateStr = new Date(r.startedAt).toLocaleString();
  const statusLabel = r.status.replace(/_/g, " ");

  return el(
    "div",
    {
      className: "history-item",
      onClick: () => handleHistoryItemClick(r),
    },
    [
      el("div", { className: "history-meta" }, [
        el("span", {
          className: "history-ticket",
          textContent: `#${ticketId} — ${ticketTitle}`,
        }),
        el("span", {
          className: "history-sub",
          textContent: `${projectName} · ${r.branch} · ${dateStr}`,
        }),
      ]),
      el("span", {
        className: "badge",
        attrs: { "data-status": r.status },
        textContent: statusLabel,
      }),
    ],
  );
}

export async function loadHistory(): Promise<void> {
  const historyContainer = $<HTMLElement>("#history-runs-container");
  if (!historyContainer) return;
  try {
    state.allRuns = await api<Run[]>("GET", "/runs");
    clearElement(historyContainer);
    if (!state.allRuns || state.allRuns.length === 0) {
      const btnStartRun = el("button", {
        className: "btn-primary btn-sm",
        style: { "margin-top": "1rem" },
        textContent: "Launch New Run",
        onClick: openNewRunModal,
      });

      historyContainer.appendChild(
        el("div", { className: "empty-state card" }, [
          el("p", {
            textContent:
              "No factory runs found. Launch your first run to populate history.",
          }),
          btnStartRun,
        ]),
      );
      return;
    }

    for (const r of state.allRuns) {
      historyContainer.appendChild(createHistoryItem(r));
    }
  } catch (err) {
    clearElement(historyContainer);
    historyContainer.appendChild(
      el("div", {
        className: "error-message",
        textContent: `Failed to load history: ${err instanceof Error ? err.message : String(err)}`,
      }),
    );
  }
}

export function updateStartButton(): void {
  const btnStart = $<HTMLButtonElement>("#btn-start");
  const selectProject = $<HTMLSelectElement>("#select-project");
  const inputTicketId = $<HTMLInputElement>("#input-ticket-id");
  const inputPlan = $<HTMLTextAreaElement>("#input-plan");

  if (!btnStart) return;
  btnStart.disabled = !(
    selectProject?.value &&
    inputTicketId?.value.trim() &&
    inputPlan?.value.trim()
  );
}

function wireProjectAndFormInputs(): void {
  const selectProject = $<HTMLSelectElement>("#select-project");
  const inputTicketId = $<HTMLInputElement>("#input-ticket-id");
  const inputPlan = $<HTMLTextAreaElement>("#input-plan");

  if (selectProject) {
    selectProject.addEventListener("change", () => {
      updateStartButton();
      void loadWorkQueue();
      updateKnowledgeStatus(selectProject.value);
    });
  }
  if (inputTicketId) inputTicketId.addEventListener("input", updateStartButton);
  if (inputPlan) inputPlan.addEventListener("input", updateStartButton);
}

function wireStartRunButton(): void {
  const btnStart = $<HTMLButtonElement>("#btn-start");
  const selectProject = $<HTMLSelectElement>("#select-project");
  const inputTicketId = $<HTMLInputElement>("#input-ticket-id");
  const inputTicketTitle = $<HTMLInputElement>("#input-ticket-title");
  const inputPlan = $<HTMLTextAreaElement>("#input-plan");
  const inputCriteria = $<HTMLTextAreaElement>("#input-criteria");
  const inputBranch = $<HTMLInputElement>("#input-branch");
  const setupError = $<HTMLElement>("#setup-error");

  if (!btnStart) return;
  btnStart.addEventListener("click", async () => {
    btnStart.disabled = true;
    hideError(setupError);

    const criteria = (inputCriteria?.value || "")
      .split("\n")
      .map((s) => s.replace(/^[-*•\d.]+\s*/, "").trim())
      .filter(Boolean);

    try {
      const branchVal = inputBranch?.value ? inputBranch.value.trim() : "";
      const run = await api<Run>("POST", "/runs", {
        projectId: selectProject?.value,
        ticketId: inputTicketId?.value.trim(),
        ticketTitle:
          inputTicketTitle?.value.trim() || inputTicketId?.value.trim(),
        plan: inputPlan?.value,
        acceptanceCriteria: criteria,
        branch: branchVal || undefined,
      });
      state.currentRunId = run.id;
      closeNewRunModal();
      startRunView(run);
      void refreshRunsList();
    } catch (err) {
      showError(setupError, err instanceof Error ? err.message : String(err));
      btnStart.disabled = false;
    }
  });
}

function wireSteerAndStop(): void {
  const btnSteer = $<HTMLButtonElement>("#btn-steer");
  const inputSteer = $<HTMLInputElement>("#input-steer");
  const btnStop = $<HTMLButtonElement>("#btn-stop");
  const runError = $<HTMLElement>("#run-error");

  async function sendSteer(): Promise<void> {
    const msg = inputSteer?.value.trim();
    if (!msg || !state.currentRunId) return;
    if (inputSteer) inputSteer.value = "";
    try {
      await api("POST", `/runs/${state.currentRunId}/steer`, { message: msg });
    } catch (err) {
      showError(runError, err instanceof Error ? err.message : String(err));
    }
  }

  if (btnSteer)
    btnSteer.addEventListener("click", () => {
      void sendSteer();
    });
  if (inputSteer) {
    inputSteer.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") void sendSteer();
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
}

function wirePrDelivery(): void {
  const btnPr = $<HTMLButtonElement>("#btn-pr");
  const resultError = $<HTMLElement>("#result-error");
  const prSteps = $<HTMLElement>("#pr-steps");

  if (!btnPr) return;
  btnPr.addEventListener("click", async () => {
    if (!state.currentRunId) return;
    btnPr.disabled = true;
    hideError(resultError);
    if (prSteps) {
      prSteps.hidden = false;
      clearElement(prSteps);
    }

    const prEventSource = new EventSource(
      `/api/runs/${state.currentRunId}/events`,
    );
    prEventSource.onmessage = (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data) as RunEvent;
        if (event.type === "pr_step" && prSteps) {
          prSteps.appendChild(el("div", { textContent: `▸ ${event.text}` }));
        }
        if (event.type === "status" && event.status === "pr_created") {
          prEventSource.close();
        }
      } catch {
        // ignore
      }
    };

    try {
      const pr = await api<PullRequest>(
        "POST",
        `/runs/${state.currentRunId}/pr`,
      );
      showPrResult(pr.url);
      void refreshRunsList();
    } catch (err) {
      showError(resultError, err instanceof Error ? err.message : String(err));
      btnPr.disabled = false;
    } finally {
      prEventSource.close();
    }
  });
}

function wireNewRunButton(): void {
  const btnNew = $<HTMLButtonElement>("#btn-new");
  const inputTicketId = $<HTMLInputElement>("#input-ticket-id");
  const inputTicketTitle = $<HTMLInputElement>("#input-ticket-title");
  const inputPlan = $<HTMLTextAreaElement>("#input-plan");
  const inputCriteria = $<HTMLTextAreaElement>("#input-criteria");

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

export function initRuns(): void {
  wireProjectAndFormInputs();
  wireStartRunButton();
  wireSteerAndStop();
  wirePrDelivery();
  wireNewRunButton();
}
