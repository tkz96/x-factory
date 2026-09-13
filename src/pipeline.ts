// src/pipeline.ts — Workflow stage orchestration and pipeline runner.

import path from "node:path";
import { writeFile } from "node:fs/promises";
import type {
  Ticket,
  RunStatus,
  ImplementationContext,
  VerificationResult,
  PullRequest,
} from "./types.js";
import * as git from "./git.js";
import { createImplementationSession, type PiAgentSession } from "./agents/pi.js";
import { buildImplementationContext, buildImplementationPrompt } from "./understand.js";
import { runVerification, buildRepairPrompt, MAX_REPAIR_ATTEMPTS } from "./verification.js";
import { reviewRun } from "./review.js";
import { ensureDir } from "./paths.js";
import { canTransition } from "./state-machine.js";
import type { InternalRun, RunStore } from "./store.js";
import type { RunEventBus } from "./events.js";

export function transitionRunState(
  run: InternalRun,
  newStatus: RunStatus,
  store?: RunStore
): void {
  if (!canTransition(run.status, newStatus)) {
    console.warn(`Invalid state transition: ${run.status} → ${newStatus} (run ${run.id})`);
    return;
  }
  run.status = newStatus;
  if (store) {
    store.persistRun(run).catch(() => {});
  }
}

export async function initializeRunArtifacts(
  artifactsDir: string,
  ticket: Ticket,
  plan: string
): Promise<void> {
  await ensureDir(artifactsDir);
  const ticketContent = `# Ticket ${ticket.id}: ${ticket.title}\n\n${ticket.description || ""}\n\n### Acceptance Criteria:\n${ticket.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}`;
  await writeFile(path.join(artifactsDir, "ticket.md"), ticketContent, "utf-8");
  await writeFile(path.join(artifactsDir, "plan.md"), plan, "utf-8");
}

async function promptSession(
  run: InternalRun,
  session: PiAgentSession,
  promptText: string,
  errorPrefix: string,
  eventBus: RunEventBus,
  store: RunStore
): Promise<boolean> {
  try {
    await session.prompt(promptText);
    return true;
  } catch (err: unknown) {
    if (run.status === "stopped") return false;
    const msg = err instanceof Error ? err.message : String(err);
    transitionRunState(run, "failed", store);
    eventBus.emit(run.id, { type: "error", text: `${errorPrefix}: ${msg}` });
    return false;
  }
}

async function executePrepareStage(
  run: InternalRun,
  eventBus: RunEventBus
): Promise<string> {
  const { id } = run;
  const project = run._project;

  eventBus.emit(id, { type: "info", text: `Preparing branch ${run.branch}…` });
  const exists = await git.branchExists(project.repositoryPath, run.branch);
  if (!exists) {
    await git.createBranch(project.repositoryPath, run.branch, project.defaultBranch);
  }

  eventBus.emit(id, { type: "info", text: "Creating dedicated external worktree…" });
  const worktreePath = await git.createWorktree(project.repositoryPath, run.branch, project.id, id);
  run.worktreePath = worktreePath;

  const baseline = await git.recordBaseline(worktreePath);
  run._baseline = baseline;

  eventBus.emitStageEvidence(
    id,
    "prepare",
    `Worktree created at external path; branch ${run.branch}; baseline recorded.`
  );
  return worktreePath;
}

async function executeUnderstandStage(
  run: InternalRun,
  worktreePath: string,
  eventBus: RunEventBus,
  store: RunStore
): Promise<ImplementationContext> {
  const { id } = run;
  const project = run._project;

  transitionRunState(run, "understanding", store);
  eventBus.emit(id, {
    type: "status",
    status: "understanding",
    text: "Analyzing codebase & synthesizing context…",
  });

  const context = await buildImplementationContext(worktreePath, project, run.ticket, run.plan);
  run.implementationContext = context;

  await writeFile(
    path.join(run.artifactsDir, "implementation-context.json"),
    JSON.stringify(context, null, 2),
    "utf-8"
  );

  eventBus.emitStageEvidence(
    id,
    "understand",
    `Identified ${context.relevantFiles.length} relevant files, ${context.constraints.length} constraints.`
  );
  return context;
}

function attachImplementationListeners(
  session: PiAgentSession,
  runId: string,
  eventBus: RunEventBus
): void {
  session.subscribe((e) => {
    if (e.type === "text" && e.text) {
      eventBus.emit(runId, { type: "pi_text", text: e.text, role: "implementer" });
    } else if (e.type === "tool" && e.tool) {
      eventBus.emit(runId, { type: "pi_tool", tool: e.tool, input: e.input, role: "implementer" });
    } else if (e.type === "done") {
      eventBus.emit(runId, { type: "pi_done", role: "implementer" });
    } else if (e.type === "error" && e.error) {
      eventBus.emit(runId, { type: "pi_error", error: e.error, role: "implementer" });
    }
  });
}

async function executeImplementStage(
  run: InternalRun,
  worktreePath: string,
  context: ImplementationContext,
  eventBus: RunEventBus,
  store: RunStore
): Promise<boolean> {
  const { id } = run;
  const project = run._project;

  transitionRunState(run, "implementing", store);
  eventBus.emit(id, { type: "status", status: "implementing", text: "Pi is implementing ticket…" });

  const prompt = await buildImplementationPrompt(project, run.ticket, run.plan, context);
  const session = await createImplementationSession(worktreePath);
  run._session = session;

  attachImplementationListeners(session, id, eventBus);

  const ok = await promptSession(run, session, prompt, "Pi implementation failed", eventBus, store);
  if (!ok) return false;

  const initialDiff = await git.getDiff(worktreePath);
  eventBus.emitStageEvidence(
    id,
    "implement",
    `Implementation complete; ${initialDiff.filesChanged.length} files modified.`
  );
  return true;
}

async function persistVerificationArtifacts(
  artifactsDir: string,
  vResult: VerificationResult
): Promise<void> {
  await writeFile(
    path.join(artifactsDir, "verification.json"),
    JSON.stringify(vResult, null, 2),
    "utf-8"
  );
  await writeFile(path.join(artifactsDir, "diff.patch"), vResult.diff, "utf-8");
}

async function attemptAutomatedRepair(
  run: InternalRun,
  vResult: VerificationResult,
  eventBus: RunEventBus,
  store: RunStore
): Promise<boolean> {
  transitionRunState(run, "implementing", store);
  eventBus.emit(run.id, {
    type: "status",
    status: "implementing",
    text: `Verification checks failed. Triggering automated repair (attempt ${run.repairAttempts + 1}/${MAX_REPAIR_ATTEMPTS})…`,
  });

  const repairPrompt = buildRepairPrompt(run.ticket, run.plan, vResult, run.repairAttempts);
  return promptSession(
    run,
    run._session!,
    repairPrompt,
    "Repair failed",
    eventBus,
    store
  );
}

async function executeVerifyAndRepairStage(
  run: InternalRun,
  worktreePath: string,
  eventBus: RunEventBus,
  store: RunStore
): Promise<boolean> {
  const { id } = run;
  const project = run._project;
  const baseline = run._baseline!;

  while (run.repairAttempts < MAX_REPAIR_ATTEMPTS) {
    transitionRunState(run, "verifying", store);
    eventBus.emit(id, {
      type: "status",
      status: "verifying",
      text: `Running deterministic checks (attempt ${run.repairAttempts + 1}/${MAX_REPAIR_ATTEMPTS})…`,
    });

    const vResult = await runVerification(worktreePath, project, baseline, run.repairAttempts + 1);
    run.verification = vResult;
    run.diff = vResult.diff;

    await persistVerificationArtifacts(run.artifactsDir, vResult);
    eventBus.emit(id, { type: "verification", result: vResult });

    if (vResult.passed) {
      eventBus.emitStageEvidence(
        id,
        "verify",
        `Passed deterministic checks: ${vResult.summary} (attempt ${vResult.repairAttempt}/${MAX_REPAIR_ATTEMPTS})`
      );
      return true;
    }

    run.repairAttempts += 1;
    if (run.repairAttempts < MAX_REPAIR_ATTEMPTS) {
      const ok = await attemptAutomatedRepair(run, vResult, eventBus, store);
      if (!ok) return false;
    } else {
      transitionRunState(run, "failed", store);
      eventBus.emitStageEvidence(
        id,
        "verify",
        `Failed after ${MAX_REPAIR_ATTEMPTS} repair attempts. Human intervention required.`
      );
      eventBus.emit(id, {
        type: "error",
        text: `Verification failed after ${MAX_REPAIR_ATTEMPTS} repair attempts: ${vResult.summary}`,
      });
      return false;
    }
  }

  return false;
}

async function executeReviewStage(
  run: InternalRun,
  worktreePath: string,
  eventBus: RunEventBus,
  store: RunStore
): Promise<boolean> {
  const { id } = run;
  const project = run._project;

  transitionRunState(run, "reviewing", store);
  eventBus.emit(id, {
    type: "status",
    status: "reviewing",
    text: "Reviewing diff and acceptance criteria in fresh read-only session…",
  });

  const reviewResult = await reviewRun({
    projectId: project.id,
    runId: id,
    worktreePath,
    ticket: run.ticket,
    plan: run.plan,
    diff: run.diff || "",
    verification: run.verification!,
    onEvent: (e) => {
      if (e.type === "pi_text" && e.text) {
        eventBus.emit(id, { type: "pi_text", text: e.text, role: "reviewer" });
      } else if (e.type === "pi_tool" && e.tool) {
        eventBus.emit(id, { type: "pi_tool", tool: e.tool, input: e.text, role: "reviewer" });
      } else if (e.type === "pi_error" && e.error) {
        eventBus.emit(id, { type: "pi_error", error: e.error, role: "reviewer" });
      }
    },
  });

  run.review = reviewResult;
  eventBus.emit(id, { type: "review", result: reviewResult });

  if (!reviewResult.passed) {
    transitionRunState(run, "failed", store);
    eventBus.emitStageEvidence(id, "review", `Review failed: ${reviewResult.summary}`);
    eventBus.emit(id, {
      type: "error",
      text: `Review rejected the changes: ${reviewResult.summary}. Human intervention required.`,
    });
    return false;
  }

  eventBus.emitStageEvidence(id, "review", `Review passed: ${reviewResult.summary}`);
  return true;
}

export async function executeDeliverStage(
  run: InternalRun,
  eventBus: RunEventBus,
  store: RunStore
): Promise<PullRequest> {
  const worktree = run.worktreePath;
  const project = run._project;
  const baseline = run._baseline || { trackedFiles: new Set(), untrackedFiles: new Set() };

  const commitMsg = `[X-Factory] ${run.ticket.id}: ${run.ticket.title}`;
  const prTitle = commitMsg;
  const prBody = `Implemented by X-Factory.\n\nTicket: ${run.ticket.id} — ${run.ticket.title}\n\nAcceptance Criteria:\n${run.ticket.acceptanceCriteria.map((c) => `- ${c}`).join("\n") || "None specified"}`;

  eventBus.emit(run.id, { type: "pr_step", text: "Committing verified changes safely…" });
  await git.safeCommitAll(worktree, commitMsg, baseline);

  eventBus.emit(run.id, { type: "pr_step", text: "Pushing branch to remote…" });
  await git.push(worktree, run.branch);

  eventBus.emit(run.id, { type: "pr_step", text: "Creating pull request…" });
  const prUrl = await git.createPullRequest(worktree, prTitle, prBody, project.defaultBranch);

  const pr: PullRequest = {
    url: prUrl.trim(),
    branch: run.branch,
    baseBranch: project.defaultBranch,
    title: prTitle,
  };

  run.pullRequest = pr;
  transitionRunState(run, "pr_created", store);
  run.finishedAt = new Date().toISOString();

  eventBus.emitStageEvidence(run.id, "deliver", `Pull request created: ${pr.url}`);
  eventBus.emit(run.id, {
    type: "status",
    status: "pr_created",
    text: `Pull request created: ${pr.url}`,
  });

  return pr;
}

export async function runWorkflow(
  run: InternalRun,
  eventBus: RunEventBus,
  store: RunStore
): Promise<void> {
  const worktreePath = await executePrepareStage(run, eventBus);
  const context = await executeUnderstandStage(run, worktreePath, eventBus, store);

  const implemented = await executeImplementStage(run, worktreePath, context, eventBus, store);
  if (!implemented) return;

  const verified = await executeVerifyAndRepairStage(run, worktreePath, eventBus, store);
  if (!verified) return;

  const reviewed = await executeReviewStage(run, worktreePath, eventBus, store);
  if (!reviewed) return;

  transitionRunState(run, "ready_for_pr", store);
  eventBus.emit(run.id, {
    type: "status",
    status: "ready_for_pr",
    text: "Ready for Pull Request. Awaiting human confirmation.",
  });
}
