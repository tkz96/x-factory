// src/pipeline.ts — Workflow stage orchestration and pipeline runner.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createImplementationSession,
  type PiAgentSession,
} from "./agents/pi.js";
import { createAzurePullRequest } from "./azure/pr.js";
import { publishAzureCommitStatus } from "./azure/status.js";
import type { RunEventBus } from "./events.js";
import * as git from "./git.js";
import { createPullRequest } from "./github.js";
import { reviewRun } from "./review.js";
import { loadSettings } from "./settings.js";
import type { InternalRun, RunStore } from "./store.js";
import type {
  ImplementationContext,
  PullRequest,
  VerificationResult,
} from "./types.js";
import {
  buildImplementationContext,
  buildImplementationPrompt,
} from "./understand.js";
import {
  buildRepairPrompt,
  MAX_REPAIR_ATTEMPTS,
  runVerification,
} from "./verification.js";

export interface PipelineDependencies {
  branchExists: typeof git.branchExists;
  createBranch: typeof git.createBranch;
  createWorktree: typeof git.createWorktree;
  recordBaseline: typeof git.recordBaseline;
  getDiff: typeof git.getDiff;
  safeCommitAll: typeof git.safeCommitAll;
  push: typeof git.push;
  createPullRequest: typeof createPullRequest;
  createAzurePullRequest: typeof createAzurePullRequest;
  publishStatus: typeof publishAzureCommitStatus;
  createImplementationSession: typeof createImplementationSession;
  runVerification: typeof runVerification;
  reviewRun: typeof reviewRun;
  buildImplementationContext: typeof buildImplementationContext;
  buildImplementationPrompt: typeof buildImplementationPrompt;
}

export const defaultPipelineDeps: PipelineDependencies = {
  branchExists: git.branchExists,
  createBranch: git.createBranch,
  createWorktree: git.createWorktree,
  recordBaseline: git.recordBaseline,
  getDiff: git.getDiff,
  safeCommitAll: git.safeCommitAll,
  push: git.push,
  createPullRequest,
  createAzurePullRequest,
  publishStatus: publishAzureCommitStatus,
  createImplementationSession,
  runVerification,
  reviewRun,
  buildImplementationContext,
  buildImplementationPrompt,
};

export const pipelineDeps: PipelineDependencies = { ...defaultPipelineDeps };

async function promptSession(
  run: InternalRun,
  session: PiAgentSession,
  promptText: string,
  errorPrefix: string,
  eventBus: RunEventBus,
  store: RunStore,
): Promise<boolean> {
  try {
    await session.prompt(promptText);
    return true;
  } catch (err: unknown) {
    if (run.status === "stopped") return false;
    const msg = err instanceof Error ? err.message : String(err);
    store.transition(run, "failed");
    eventBus.emit(run.id, { type: "error", text: `${errorPrefix}: ${msg}` });
    return false;
  }
}

async function executePrepareStage(
  run: InternalRun,
  eventBus: RunEventBus,
  deps: PipelineDependencies = pipelineDeps,
): Promise<string> {
  const { id } = run;
  const project = run._project;

  eventBus.emit(id, { type: "info", text: `Preparing branch ${run.branch}…` });
  const exists = await deps.branchExists(project.repositoryPath, run.branch);
  if (!exists) {
    await deps.createBranch(
      project.repositoryPath,
      run.branch,
      project.defaultBranch,
    );
  }

  eventBus.emit(id, {
    type: "info",
    text: "Creating dedicated external worktree…",
  });
  const worktreePath = await deps.createWorktree(
    project.repositoryPath,
    run.branch,
    project.id,
    id,
  );
  run.worktreePath = worktreePath;

  const baseline = await deps.recordBaseline(worktreePath);
  run._baseline = baseline;

  eventBus.emitStageEvidence(
    id,
    "prepare",
    `Worktree created at external path; branch ${run.branch}; baseline recorded.`,
  );
  return worktreePath;
}

async function executeUnderstandStage(
  run: InternalRun,
  worktreePath: string,
  eventBus: RunEventBus,
  store: RunStore,
  deps: PipelineDependencies = pipelineDeps,
): Promise<ImplementationContext> {
  const { id } = run;
  const project = run._project;

  store.transition(run, "understanding");
  eventBus.emit(id, {
    type: "status",
    status: "understanding",
    text: "Analyzing codebase & synthesizing context…",
  });

  const context = await deps.buildImplementationContext(
    worktreePath,
    project,
    run.ticket,
    run.plan,
  );
  run.implementationContext = context;

  await writeFile(
    path.join(run.artifactsDir, "implementation-context.json"),
    JSON.stringify(context, null, 2),
    "utf-8",
  );

  eventBus.emitStageEvidence(
    id,
    "understand",
    `Identified ${context.relevantFiles.length} relevant files, ${context.constraints.length} constraints.`,
  );
  return context;
}

function attachImplementationListeners(
  session: PiAgentSession,
  runId: string,
  eventBus: RunEventBus,
): void {
  session.subscribe((e) => {
    if (e.type === "text" && e.text) {
      eventBus.emit(runId, {
        type: "pi_text",
        text: e.text,
        role: "implementer",
      });
    } else if (e.type === "tool" && e.tool) {
      eventBus.emit(runId, {
        type: "pi_tool",
        tool: e.tool,
        input: e.input,
        role: "implementer",
      });
    } else if (e.type === "done") {
      eventBus.emit(runId, { type: "pi_done", role: "implementer" });
    } else if (e.type === "error" && e.error) {
      eventBus.emit(runId, {
        type: "pi_error",
        error: e.error,
        role: "implementer",
      });
    }
  });
}

async function executeImplementStage(
  run: InternalRun,
  worktreePath: string,
  context: ImplementationContext,
  eventBus: RunEventBus,
  store: RunStore,
  deps: PipelineDependencies = pipelineDeps,
): Promise<boolean> {
  const { id } = run;
  const project = run._project;

  store.transition(run, "implementing");
  eventBus.emit(id, {
    type: "status",
    status: "implementing",
    text: "Pi is implementing ticket…",
  });

  const settings = await loadSettings(false);
  const prompt = await deps.buildImplementationPrompt(
    project,
    run.ticket,
    run.plan,
    context,
  );
  const session = await deps.createImplementationSession(
    worktreePath,
    settings.models?.sessionA,
  );
  run._session = session;

  attachImplementationListeners(session, id, eventBus);

  const ok = await promptSession(
    run,
    session,
    prompt,
    "Pi implementation failed",
    eventBus,
    store,
  );
  if (!ok) return false;

  const initialDiff = await deps.getDiff(worktreePath);
  eventBus.emitStageEvidence(
    id,
    "implement",
    `Implementation complete; ${initialDiff.filesChanged.length} files modified.`,
  );
  return true;
}

async function persistVerificationArtifacts(
  artifactsDir: string,
  vResult: VerificationResult,
): Promise<void> {
  await writeFile(
    path.join(artifactsDir, "verification.json"),
    JSON.stringify(vResult, null, 2),
    "utf-8",
  );
  await writeFile(path.join(artifactsDir, "diff.patch"), vResult.diff, "utf-8");
}

async function attemptAutomatedRepair(
  run: InternalRun,
  vResult: VerificationResult,
  eventBus: RunEventBus,
  store: RunStore,
): Promise<boolean> {
  store.transition(run, "implementing");
  eventBus.emit(run.id, {
    type: "status",
    status: "implementing",
    text: `Verification checks failed. Triggering automated repair (attempt ${run.repairAttempts + 1}/${MAX_REPAIR_ATTEMPTS})…`,
  });

  const repairPrompt = buildRepairPrompt(
    run.ticket,
    run.plan,
    vResult,
    run.repairAttempts,
  );
  if (!run._session) {
    throw new Error(
      "Cannot attempt automated repair: Pi session is not active",
    );
  }
  return promptSession(
    run,
    run._session,
    repairPrompt,
    "Repair failed",
    eventBus,
    store,
  );
}

async function executeVerifyAndRepairStage(
  run: InternalRun,
  worktreePath: string,
  eventBus: RunEventBus,
  store: RunStore,
  deps: PipelineDependencies = pipelineDeps,
): Promise<boolean> {
  const { id } = run;
  const project = run._project;
  const baseline = run._baseline;
  if (!baseline) {
    throw new Error("Cannot verify worktree: baseline snapshot not found");
  }

  while (run.repairAttempts < MAX_REPAIR_ATTEMPTS) {
    store.transition(run, "verifying");
    eventBus.emit(id, {
      type: "status",
      status: "verifying",
      text: `Running deterministic checks (attempt ${run.repairAttempts + 1}/${MAX_REPAIR_ATTEMPTS})…`,
    });

    const vResult = await deps.runVerification(
      worktreePath,
      project,
      baseline,
      run.repairAttempts + 1,
    );
    run.verification = vResult;
    run.diff = vResult.diff;

    await persistVerificationArtifacts(run.artifactsDir, vResult);
    eventBus.emit(id, { type: "verification", result: vResult });

    if (
      project.issueTracker?.provider === "azure" &&
      project.issueTracker?.azure
    ) {
      try {
        const headSha = await git.getHeadSha(worktreePath);
        const { orgUrl, project: azureProject } = project.issueTracker.azure;
        const repoName = project.name || project.id;
        await deps.publishStatus({
          orgUrl,
          project: azureProject,
          repoIdOrName: repoName,
          commitSha: headSha,
          state: vResult.passed ? "succeeded" : "failed",
          description: `Verification ${vResult.passed ? "passed" : "failed"}: ${vResult.summary.slice(0, 100)}`,
        });
      } catch {
        // Non-blocking status reporting
      }
    }

    if (vResult.passed) {
      eventBus.emitStageEvidence(
        id,
        "verify",
        `Passed deterministic checks: ${vResult.summary} (attempt ${vResult.repairAttempt}/${MAX_REPAIR_ATTEMPTS})`,
      );
      return true;
    }

    run.repairAttempts += 1;
    if (run.repairAttempts < MAX_REPAIR_ATTEMPTS) {
      const ok = await attemptAutomatedRepair(run, vResult, eventBus, store);
      if (!ok) return false;
    } else {
      store.transition(run, "failed");
      eventBus.emitStageEvidence(
        id,
        "verify",
        `Failed after ${MAX_REPAIR_ATTEMPTS} repair attempts. Human intervention required.`,
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
  store: RunStore,
  deps: PipelineDependencies = pipelineDeps,
): Promise<boolean> {
  const { id } = run;
  const project = run._project;

  store.transition(run, "reviewing");
  eventBus.emit(id, {
    type: "status",
    status: "reviewing",
    text: "Reviewing diff and acceptance criteria in fresh read-only session…",
  });

  const settings = await loadSettings(false);
  if (!run.verification) {
    throw new Error(
      "Cannot execute review stage: verification result not found",
    );
  }
  const reviewResult = await deps.reviewRun({
    projectId: project.id,
    runId: id,
    worktreePath,
    ticket: run.ticket,
    plan: run.plan,
    diff: run.diff || "",
    verification: run.verification,
    modelConfig: settings.models?.sessionB,
    onEvent: (e) => {
      if (e.type === "pi_text" && e.text) {
        eventBus.emit(id, { type: "pi_text", text: e.text, role: "reviewer" });
      } else if (e.type === "pi_tool" && e.tool) {
        eventBus.emit(id, {
          type: "pi_tool",
          tool: e.tool,
          input: e.text,
          role: "reviewer",
        });
      } else if (e.type === "pi_error" && e.error) {
        eventBus.emit(id, {
          type: "pi_error",
          error: e.error,
          role: "reviewer",
        });
      }
    },
  });

  run.review = reviewResult;
  eventBus.emit(id, { type: "review", result: reviewResult });

  if (!reviewResult.passed) {
    store.transition(run, "failed");
    eventBus.emitStageEvidence(
      id,
      "review",
      `Review failed: ${reviewResult.summary}`,
    );
    eventBus.emit(id, {
      type: "error",
      text: `Review rejected the changes: ${reviewResult.summary}. Human intervention required.`,
    });
    return false;
  }

  eventBus.emitStageEvidence(
    id,
    "review",
    `Review passed: ${reviewResult.summary}`,
  );
  return true;
}

export async function executeDeliverStage(
  run: InternalRun,
  eventBus: RunEventBus,
  store: RunStore,
  deps: PipelineDependencies = pipelineDeps,
): Promise<PullRequest> {
  const worktree = run.worktreePath;
  const project = run._project;
  const baseline = run._baseline || {
    trackedFiles: new Set(),
    untrackedFiles: new Set(),
  };

  const commitMsg = `[X-Factory] ${run.ticket.id}: ${run.ticket.title}`;
  const prTitle = commitMsg;
  const prBody = `Implemented by X-Factory.\n\nTicket: ${run.ticket.id} — ${run.ticket.title}\n\nAcceptance Criteria:\n${run.ticket.acceptanceCriteria.map((c) => `- ${c}`).join("\n") || "None specified"}`;

  eventBus.emit(run.id, {
    type: "pr_step",
    text: "Committing verified changes safely…",
  });
  await deps.safeCommitAll(worktree, commitMsg, baseline);

  eventBus.emit(run.id, { type: "pr_step", text: "Pushing branch to remote…" });
  await deps.push(worktree, run.branch);

  eventBus.emit(run.id, { type: "pr_step", text: "Creating pull request…" });
  let prUrl = "";
  if (
    project.issueTracker?.provider === "azure" &&
    project.issueTracker?.azure
  ) {
    const { orgUrl, project: azureProject } = project.issueTracker.azure;
    const repoName = project.name || project.id;
    const azPrResult = await deps.createAzurePullRequest({
      orgUrl,
      project: azureProject,
      repoIdOrName: repoName,
      sourceBranch: run.branch,
      targetBranch: project.defaultBranch,
      title: prTitle,
      description: prBody,
    });
    if (azPrResult.ok && azPrResult.url) {
      prUrl = azPrResult.url;
    } else {
      prUrl = await deps.createPullRequest(
        worktree,
        prTitle,
        prBody,
        project.defaultBranch,
      );
    }
  } else {
    prUrl = await deps.createPullRequest(
      worktree,
      prTitle,
      prBody,
      project.defaultBranch,
    );
  }

  const pr: PullRequest = {
    url: prUrl.trim(),
    branch: run.branch,
    baseBranch: project.defaultBranch,
    title: prTitle,
  };

  run.pullRequest = pr;
  store.transition(run, "pr_created");
  run.finishedAt = new Date().toISOString();

  eventBus.emitStageEvidence(
    run.id,
    "deliver",
    `Pull request created: ${pr.url}`,
  );
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
  store: RunStore,
  deps: PipelineDependencies = pipelineDeps,
): Promise<void> {
  const worktreePath = await executePrepareStage(run, eventBus, deps);
  const context = await executeUnderstandStage(
    run,
    worktreePath,
    eventBus,
    store,
    deps,
  );

  const implemented = await executeImplementStage(
    run,
    worktreePath,
    context,
    eventBus,
    store,
    deps,
  );
  if (!implemented) return;

  const verified = await executeVerifyAndRepairStage(
    run,
    worktreePath,
    eventBus,
    store,
    deps,
  );
  if (!verified) return;

  const reviewed = await executeReviewStage(
    run,
    worktreePath,
    eventBus,
    store,
    deps,
  );
  if (!reviewed) return;

  store.transition(run, "ready_for_pr");
  eventBus.emit(run.id, {
    type: "status",
    status: "ready_for_pr",
    text: "Ready for Pull Request. Awaiting human confirmation.",
  });
}
