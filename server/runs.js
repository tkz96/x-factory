// server/runs.js — Run lifecycle, state machine, and in-memory store.

import { randomUUID } from "node:crypto";
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import * as git from "./git.js";
import * as pi from "./pi.js";

// ── State machine ──────────────────────────────────────────────────────────────

const TRANSITIONS = {
  preparing:     ["implementing", "failed"],
  implementing:  ["testing", "failed", "stopped"],
  testing:       ["ready_for_pr", "failed"],
  ready_for_pr:  ["pr_created", "failed"],
  pr_created:    [],
  failed:        [],
  stopped:       [],
};

function canTransition(from, to) {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

// ── In-memory store ────────────────────────────────────────────────────────────

/** @type {Map<string, object>} */
const runs = new Map();

/** @type {Map<string, Set<(event: object) => void>>} SSE listeners per run. */
const listeners = new Map();

// ── Public API ─────────────────────────────────────────────────────────────────

export function getRun(id) {
  return runs.get(id) || null;
}

export function listRuns() {
  return [...runs.values()].map(summarize);
}

/**
 * Create and start a new run.
 *
 * @param {object} project — Project config object from projects.json.
 * @param {string} ticketId — Short ticket identifier (e.g. "123").
 * @param {string} ticketTitle — Human-readable ticket title.
 * @param {string} plan — Implementation plan text.
 * @returns {object} The created run (summary).
 */
export async function createRun(project, ticketId, ticketTitle, plan) {
  // Validate.
  if (!project) throw new Error("Project is required.");
  if (!ticketId) throw new Error("Ticket ID is required.");
  if (!plan) throw new Error("Implementation plan is required.");

  await git.validateRepo(project.repositoryPath);

  const id = randomUUID().slice(0, 8);
  const branchName = `x-factory/${ticketId}`;

  const run = {
    id,
    project: { id: project.id, name: project.name },
    ticket: { id: ticketId, title: ticketTitle },
    plan,
    branch: branchName,
    status: "preparing",
    events: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
    tests: null,
    pullRequest: null,
    // Internal — not serialised to clients.
    _session: null,
    _worktreePath: null,
    _project: project,
  };

  runs.set(id, run);
  addEvent(id, { type: "status", status: "preparing", text: "Preparing run…" });

  // Kick off the async preparation. Don't await — let the caller return immediately.
  prepareAndRun(run).catch((err) => {
    transitionState(id, "failed");
    addEvent(id, { type: "error", text: err.message });
  });

  return summarize(run);
}

/** Send a steering instruction to the running Pi session. */
export async function steerRun(id, message) {
  const run = runs.get(id);
  if (!run) throw new Error(`Run ${id} not found.`);
  if (!run._session) throw new Error("No active Pi session to steer.");
  if (run.status !== "implementing") throw new Error(`Cannot steer in status "${run.status}".`);

  addEvent(id, { type: "steer", text: message });
  await pi.steer(run._session, message);
}

/** Stop a running Pi session. */
export async function stopRun(id) {
  const run = runs.get(id);
  if (!run) throw new Error(`Run ${id} not found.`);
  if (run.status !== "implementing") throw new Error(`Cannot stop in status "${run.status}".`);

  await pi.stop(run._session);
  transitionState(id, "stopped");
  run.finishedAt = new Date().toISOString();
  addEvent(id, { type: "status", status: "stopped", text: "Run stopped by user." });
}

/** Commit, push, and create a PR. */
export async function createPR(id) {
  const run = runs.get(id);
  if (!run) throw new Error(`Run ${id} not found.`);
  if (run.status !== "ready_for_pr") {
    throw new Error(`Cannot create PR in status "${run.status}". Status must be "ready_for_pr".`);
  }

  const worktree = run._worktreePath;
  const project = run._project;
  const commitMsg = `[X-Factory] ${run.ticket.id}: ${run.ticket.title}`;
  const prTitle = commitMsg;
  const prBody = `Implemented by X-Factory.\n\nTicket: ${run.ticket.id} — ${run.ticket.title}`;

  addEvent(id, { type: "pr_step", text: "Committing changes…" });
  await git.commitAll(worktree, commitMsg);

  addEvent(id, { type: "pr_step", text: "Pushing branch…" });
  await git.push(worktree, run.branch);

  addEvent(id, { type: "pr_step", text: "Creating pull request…" });
  const prUrl = await git.createPullRequest(worktree, prTitle, prBody, project.defaultBranch);

  run.pullRequest = { url: prUrl.trim() };
  transitionState(id, "pr_created");
  run.finishedAt = new Date().toISOString();
  addEvent(id, { type: "status", status: "pr_created", text: `Pull request created: ${prUrl.trim()}` });

  return run.pullRequest;
}

/** Subscribe to run events (for SSE). Returns an unsubscribe function. */
export function subscribe(id, listener) {
  if (!listeners.has(id)) listeners.set(id, new Set());
  listeners.get(id).add(listener);
  return () => listeners.get(id)?.delete(listener);
}

// ── Internal ───────────────────────────────────────────────────────────────────

async function prepareAndRun(run) {
  const { id } = run;
  const project = run._project;

  // 1. Create branch.
  addEvent(id, { type: "info", text: `Creating branch ${run.branch}…` });
  const branchAlreadyExists = await git.branchExists(project.repositoryPath, run.branch);
  if (!branchAlreadyExists) {
    await git.createBranch(project.repositoryPath, run.branch, project.defaultBranch);
  }

  // 2. Create worktree.
  addEvent(id, { type: "info", text: "Creating worktree…" });
  const worktreePath = await git.createWorktree(project.repositoryPath, run.branch, id);
  run._worktreePath = worktreePath;

  // 3. Build the prompt.
  const prompt = await buildPrompt(run);

  // 4. Transition to implementing.
  transitionState(id, "implementing");
  addEvent(id, { type: "status", status: "implementing", text: "Pi is working…" });

  // 5. Start Pi.
  const { session, done } = await pi.startSession(worktreePath, prompt, (event) => {
    addEvent(id, event);
  });
  run._session = session;

  // 6. Wait for Pi to finish.
  try {
    await done;
  } catch (err) {
    // If the run was already stopped, don't override.
    if (run.status === "stopped") return;
    transitionState(id, "failed");
    addEvent(id, { type: "error", text: `Pi failed: ${err.message}` });
    return;
  }

  // If stopped while Pi was running, don't continue.
  if (run.status === "stopped") return;

  // 7. Run tests.
  transitionState(id, "testing");
  addEvent(id, { type: "status", status: "testing", text: "Running tests…" });

  const testResult = await runTests(worktreePath, project.testCommand);
  run.tests = testResult;

  if (testResult.exitCode !== 0) {
    transitionState(id, "failed");
    addEvent(id, {
      type: "test_result",
      passed: false,
      text: `Tests failed (exit ${testResult.exitCode}).`,
      stdout: testResult.stdout,
      stderr: testResult.stderr,
    });
    return;
  }

  // 8. Ready for PR.
  transitionState(id, "ready_for_pr");
  addEvent(id, {
    type: "test_result",
    passed: true,
    text: "Tests passed.",
    stdout: testResult.stdout,
  });
  addEvent(id, { type: "status", status: "ready_for_pr", text: "Ready to create pull request." });
}

async function buildPrompt(run) {
  const project = run._project;
  const templatePath = path.join(process.cwd(), "prompts", "implementation.md");
  let template = await readFile(templatePath, "utf-8");

  // Fill in ticket.
  const ticketBlock = `#${run.ticket.id} — ${run.ticket.title}`;
  template = template.replace("{{TICKET}}", ticketBlock);

  // Fill in plan.
  template = template.replace("{{PLAN}}", run.plan);

  // Fill in knowledge note.
  let knowledgeNote = "No knowledge repository is available for this project.";
  if (project.knowledgeRepositoryPath) {
    try {
      await access(project.knowledgeRepositoryPath);
      knowledgeNote = `The knowledge repository is available at: ${project.knowledgeRepositoryPath}\nUse it to understand the codebase when helpful.`;
    } catch {
      knowledgeNote = "The knowledge repository path is configured but the directory does not exist. Proceed without it.";
    }
  }
  template = template.replace("{{KNOWLEDGE_NOTE}}", knowledgeNote);

  return template;
}

function runTests(cwd, testCommand) {
  return new Promise((resolve) => {
    const [cmd, ...args] = testCommand.split(" ");
    execFile(cmd, args, { cwd, maxBuffer: 10 * 1024 * 1024, timeout: 5 * 60 * 1000 }, (err, stdout, stderr) => {
      resolve({
        exitCode: err ? (err.code ?? 1) : 0,
        stdout: stdout?.slice(0, 50000) || "",
        stderr: stderr?.slice(0, 50000) || "",
      });
    });
  });
}

function transitionState(id, newStatus) {
  const run = runs.get(id);
  if (!run) return;
  if (!canTransition(run.status, newStatus)) {
    console.warn(`Invalid state transition: ${run.status} → ${newStatus} (run ${id})`);
    return;
  }
  run.status = newStatus;
}

function addEvent(id, event) {
  const run = runs.get(id);
  if (!run) return;
  const full = { ...event, timestamp: event.timestamp || Date.now() };
  run.events.push(full);
  // Notify SSE listeners.
  const subs = listeners.get(id);
  if (subs) {
    for (const fn of subs) {
      try { fn(full); } catch { /* ignore */ }
    }
  }
}

/** Strip internal fields for client responses. */
function summarize(run) {
  const { _session, _worktreePath, _project, ...rest } = run;
  return rest;
}
