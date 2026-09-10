// public/app.js — X-Factory frontend logic.

const $ = (sel) => document.querySelector(sel);

// ── State ──────────────────────────────────────────────────────────────────────

let currentRunId = null;
let eventSource = null;
let projects = [];

// ── Elements ───────────────────────────────────────────────────────────────────

const viewSetup  = $("#view-setup");
const viewRun    = $("#view-run");
const viewResult = $("#view-result");

const selectProject  = $("#select-project");
const inputTicketId  = $("#input-ticket-id");
const inputTicketTitle = $("#input-ticket-title");
const inputPlan      = $("#input-plan");
const knowledgeStatus = $("#knowledge-status");
const btnStart       = $("#btn-start");
const setupError     = $("#setup-error");

const runTitle   = $("#run-title");
const runStatus  = $("#run-status");
const eventLog   = $("#event-log");
const inputSteer = $("#input-steer");
const btnSteer   = $("#btn-steer");
const steerBar   = $("#steer-bar");
const btnStop    = $("#btn-stop");
const runError   = $("#run-error");

const resultTests      = $("#result-tests");
const resultTestOutput = $("#result-test-output");
const resultBranch     = $("#result-branch");
const btnPr            = $("#btn-pr");
const prSteps          = $("#pr-steps");
const prResult         = $("#pr-result");
const prLink           = $("#pr-link");
const btnNew           = $("#btn-new");
const resultError      = $("#result-error");

// ── View switching ─────────────────────────────────────────────────────────────

function showView(view) {
  viewSetup.classList.remove("active");
  viewRun.classList.remove("active");
  viewResult.classList.remove("active");
  view.classList.add("active");
}

// ── API helpers ────────────────────────────────────────────────────────────────

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
      opt.textContent = p.name;
      selectProject.appendChild(opt);
    }
  } catch (err) {
    selectProject.innerHTML = '<option value="" disabled selected>Failed to load projects</option>';
    showError(setupError, err.message);
  }
  updateStartButton();
}

// ── Setup view ─────────────────────────────────────────────────────────────────

function updateStartButton() {
  btnStart.disabled = !(
    selectProject.value &&
    inputTicketId.value.trim() &&
    inputPlan.value.trim()
  );
}

selectProject.addEventListener("change", () => {
  updateStartButton();
  // Update knowledge status.
  const project = projects.find((p) => p.id === selectProject.value);
  if (project?.knowledgeRepositoryPath) {
    knowledgeStatus.innerHTML = '<span class="check">✓</span> Knowledge repository configured';
  } else {
    knowledgeStatus.innerHTML = '<span class="missing">—</span> No knowledge repository';
  }
});

inputTicketId.addEventListener("input", updateStartButton);
inputPlan.addEventListener("input", updateStartButton);

btnStart.addEventListener("click", async () => {
  btnStart.disabled = true;
  hideError(setupError);

  try {
    const run = await api("POST", "/runs", {
      projectId: selectProject.value,
      ticketId: inputTicketId.value.trim(),
      ticketTitle: inputTicketTitle.value.trim() || inputTicketId.value.trim(),
      plan: inputPlan.value,
    });
    currentRunId = run.id;
    startRunView(run);
  } catch (err) {
    showError(setupError, err.message);
    btnStart.disabled = false;
  }
});

// ── Run view ───────────────────────────────────────────────────────────────────

function startRunView(run) {
  showView(viewRun);
  runTitle.textContent = `Run — #${run.ticket.id}`;
  setStatus(run.status);
  eventLog.innerHTML = "";
  hideError(runError);
  steerBar.style.display = "flex";
  btnStop.style.display = "inline-block";

  // Connect SSE.
  connectSSE(run.id);
}

function connectSSE(runId) {
  if (eventSource) eventSource.close();

  eventSource = new EventSource(`/api/runs/${runId}/events`);

  eventSource.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data);
      handleEvent(event);
    } catch { /* ignore malformed */ }
  };

  eventSource.onerror = () => {
    // SSE disconnected — poll once to get current state.
    setTimeout(() => pollRunState(runId), 2000);
  };
}

function handleEvent(event) {
  // Update status badge.
  if (event.type === "status") {
    setStatus(event.status);

    // Transition to result view when ready.
    if (event.status === "ready_for_pr" || event.status === "failed" || event.status === "stopped") {
      transitionToResult(event.status);
    }
  }

  // Append to log.
  appendEvent(event);
}

function appendEvent(event) {
  const div = document.createElement("div");
  div.className = `event event-${event.type}`;

  switch (event.type) {
    case "status":
      div.textContent = event.text;
      break;
    case "pi_text":
      // Accumulate text deltas into the last text node if it exists.
      const last = eventLog.lastElementChild;
      if (last && last.dataset.type === "pi_text") {
        last.textContent += event.text;
        eventLog.scrollTop = eventLog.scrollHeight;
        return;
      }
      div.dataset.type = "pi_text";
      div.textContent = event.text;
      break;
    case "pi_tool":
      div.className += " event-tool";
      div.innerHTML = `<span class="event-prefix">▸</span>${escapeHtml(event.tool)}${event.input ? " " + escapeHtml(event.input) : ""}`;
      break;
    case "pi_done":
      div.textContent = "Pi finished.";
      div.className += " event-status";
      break;
    case "pi_error":
      div.textContent = `Pi error: ${event.error}`;
      div.className += " event-error";
      break;
    case "error":
      div.textContent = event.text;
      div.className += " event-error";
      break;
    case "info":
      div.textContent = event.text;
      break;
    case "steer":
      div.innerHTML = `<span class="event-prefix">→</span>${escapeHtml(event.text)}`;
      break;
    case "test_result":
      div.textContent = event.text;
      div.className += event.passed ? " event-status" : " event-error";
      break;
    case "pr_step":
      div.textContent = event.text;
      break;
    default:
      div.textContent = event.text || JSON.stringify(event);
  }

  eventLog.appendChild(div);
  eventLog.scrollTop = eventLog.scrollHeight;
}

function setStatus(status) {
  runStatus.textContent = status.replace(/_/g, " ");
  runStatus.dataset.status = status;

  // Hide steer/stop when no longer implementing.
  if (status !== "implementing") {
    steerBar.style.display = "none";
    btnStop.style.display = "none";
  }
}

// Steer.
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

// Stop.
btnStop.addEventListener("click", async () => {
  if (!currentRunId) return;
  try {
    await api("POST", `/runs/${currentRunId}/stop`);
  } catch (err) {
    showError(runError, err.message);
  }
});

// ── Result view ────────────────────────────────────────────────────────────────

async function transitionToResult(status) {
  if (eventSource) eventSource.close();

  // Fetch final run state.
  let run;
  try {
    run = await api("GET", `/runs/${currentRunId}`);
  } catch {
    return; // Stay on run view.
  }

  showView(viewResult);
  hideError(resultError);
  prSteps.hidden = true;
  prResult.hidden = true;
  btnPr.style.display = "inline-block";

  // Branch.
  resultBranch.textContent = run.branch;

  // Tests.
  if (run.tests) {
    if (run.tests.exitCode === 0) {
      resultTests.textContent = "passed";
      resultTests.dataset.status = "passed";
    } else {
      resultTests.textContent = "failed";
      resultTests.dataset.status = "failed";
    }
    if (run.tests.stdout || run.tests.stderr) {
      resultTestOutput.textContent = run.tests.stdout || run.tests.stderr;
      resultTestOutput.hidden = false;
    }
  } else {
    resultTests.textContent = "—";
    resultTests.dataset.status = "";
    resultTestOutput.hidden = true;
  }

  // Show/hide PR button based on status.
  if (status === "ready_for_pr") {
    btnPr.style.display = "inline-block";
  } else {
    btnPr.style.display = "none";
  }

  // If PR already created.
  if (run.pullRequest) {
    showPrResult(run.pullRequest.url);
  }
}

// Create PR.
btnPr.addEventListener("click", async () => {
  if (!currentRunId) return;
  btnPr.disabled = true;
  hideError(resultError);
  prSteps.hidden = false;
  prSteps.innerHTML = "";

  // Connect SSE for PR steps.
  const prEventSource = new EventSource(`/api/runs/${currentRunId}/events`);
  prEventSource.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data);
      if (event.type === "pr_step") {
        const line = document.createElement("div");
        line.textContent = event.text;
        prSteps.appendChild(line);
      }
      if (event.type === "status" && event.status === "pr_created") {
        prEventSource.close();
      }
    } catch { /* ignore */ }
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
  btnPr.style.display = "none";
  prResult.hidden = false;
  prLink.href = url;
  prLink.textContent = url;
}

// New run.
btnNew.addEventListener("click", () => {
  currentRunId = null;
  if (eventSource) eventSource.close();
  inputTicketId.value = "";
  inputTicketTitle.value = "";
  inputPlan.value = "";
  updateStartButton();
  showView(viewSetup);
});

// ── Fallback polling ───────────────────────────────────────────────────────────

async function pollRunState(runId) {
  if (runId !== currentRunId) return;
  try {
    const run = await api("GET", `/runs/${runId}`);
    setStatus(run.status);
    if (["ready_for_pr", "failed", "stopped", "pr_created"].includes(run.status)) {
      transitionToResult(run.status);
    } else {
      // Reconnect SSE.
      connectSSE(runId);
    }
  } catch { /* ignore */ }
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
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

// ── Go ─────────────────────────────────────────────────────────────────────────

init();
