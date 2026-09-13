// src/runs.ts — Run lifecycle management, public service facade, and backward-compatible exports.

import { randomUUID } from "node:crypto";
import type {
  Project,
  Ticket,
  Run,
  RunEvent,
  PullRequest,
} from "./types.js";
import * as git from "./git.js";
import { getRunDir, getWorktreePath } from "./paths.js";
import { TRANSITIONS, canTransition } from "./state-machine.js";
import { defaultRunStore, type InternalRun } from "./store.js";
import { defaultEventBus } from "./events.js";
import {
  initializeRunArtifacts,
  runWorkflow,
  transitionRunState,
  executeDeliverStage,
} from "./pipeline.js";
import { loadProjects } from "./config.js";

// Re-export state machine for backward compatibility
export { TRANSITIONS, canTransition };

const runStore = defaultRunStore;
const eventBus = defaultEventBus;

let hydrationPromise: Promise<void> | null = null;

export async function initRuns(): Promise<void> {
  if (!hydrationPromise) {
    hydrationPromise = (async () => {
      try {
        const projects = await loadProjects();
        await runStore.hydrate(projects);
      } catch {
        // Hydration is best-effort on startup
      }
    })();
  }
  return hydrationPromise;
}

export function getRun(id: string): Run | null {
  const r = runStore.get(id);
  return r ? runStore.summarize(r) : null;
}

export function listRuns(): Run[] {
  return runStore.list();
}

function buildInitialRun(
  id: string,
  project: Project,
  ticket: Ticket,
  plan: string,
  branchName: string,
  artifactsDir: string,
  worktreePath: string
): InternalRun {
  return {
    id,
    project: { id: project.id, name: project.name },
    ticket,
    plan,
    branch: branchName,
    status: "preparing",
    events: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
    implementationContext: null,
    verification: null,
    review: null,
    artifacts: [],
    diff: null,
    pullRequest: null,
    repairAttempts: 0,
    artifactsDir,
    worktreePath,
    _session: null,
    _baseline: null,
    _project: project,
  };
}

export async function createRun(
  project: Project,
  ticketId: string,
  ticketTitle: string,
  plan: string,
  acceptanceCriteria: string[] = [],
  ticketDescription?: string
): Promise<Run> {
  if (!project) throw new Error("Project is required.");
  if (!ticketId || !ticketId.trim()) throw new Error("Ticket ID is required.");
  if (!plan || !plan.trim()) throw new Error("Implementation plan is required.");

  await git.validateRepo(project.repositoryPath);

  const id = randomUUID().slice(0, 8);
  const cleanTicketId = ticketId.trim().replace(/[^a-zA-Z0-9._-]/g, "-");
  const branchName = `xfactory/${cleanTicketId}-${id}`;

  const artifactsDir = getRunDir(project.id, id);
  const worktreePath = getWorktreePath(project.id, id);

  const ticket: Ticket = {
    id: cleanTicketId,
    title: ticketTitle.trim() || cleanTicketId,
    description: ticketDescription,
    acceptanceCriteria: acceptanceCriteria.map((c) => c.trim()).filter(Boolean),
  };

  const run = buildInitialRun(id, project, ticket, plan, branchName, artifactsDir, worktreePath);
  runStore.set(id, run);

  await initializeRunArtifacts(artifactsDir, ticket, plan);
  await runStore.persistRun(run);

  eventBus.emit(id, { type: "status", status: "preparing", text: "Preparing run workspace…" });

  runWorkflow(run, eventBus, runStore).catch((err: unknown) => {
    const errorMsg = err instanceof Error ? err.message : String(err);
    transitionRunState(run, "failed", runStore);
    eventBus.emit(id, { type: "error", text: `Workflow failed: ${errorMsg}` });
  });

  return runStore.summarize(run);
}

export async function steerRun(id: string, message: string): Promise<void> {
  const run = runStore.get(id);
  if (!run) throw new Error(`Run ${id} not found.`);
  if (!run._session) throw new Error("No active Pi session to steer.");
  if (run.status !== "implementing") {
    throw new Error(`Cannot steer in status "${run.status}".`);
  }

  eventBus.emit(id, { type: "steer", text: message });
  await run._session.steer(message);
}

export async function stopRun(id: string): Promise<void> {
  const run = runStore.get(id);
  if (!run) throw new Error(`Run ${id} not found.`);
  if (run.status !== "implementing" && run.status !== "understanding") {
    throw new Error(`Cannot stop in status "${run.status}".`);
  }

  if (run._session) {
    await run._session.abort();
  }
  transitionRunState(run, "stopped", runStore);
  run.finishedAt = new Date().toISOString();
  await runStore.persistRun(run);
  eventBus.emit(id, { type: "status", status: "stopped", text: "Run stopped by user." });
}

export async function createPR(id: string): Promise<PullRequest> {
  const run = runStore.get(id);
  if (!run) throw new Error(`Run ${id} not found.`);
  if (run.status !== "ready_for_pr") {
    throw new Error(`Cannot create PR in status "${run.status}". Status must be "ready_for_pr".`);
  }
  if (run.pullRequest) {
    throw new Error(`Pull request already created for run ${id}: ${run.pullRequest.url}`);
  }

  return executeDeliverStage(run, eventBus, runStore);
}

export function subscribe(id: string, listener: (event: RunEvent) => void): () => void {
  return eventBus.subscribe(id, listener);
}
