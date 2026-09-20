// src/executors/deliver.ts — DeliverExecutor: Safe commit, remote push, and PR creation with operation ledger (XFM-28, XFM-32, XFM-33).

import { createAzurePullRequest } from "../azure/pr.js";
import { defaultEventBus } from "../events.js";
import * as git from "../git.js";
import { createPullRequest } from "../github.js";
import type { Project, PullRequest } from "../shared/types.js";
import type { StageContext, StageExecutor, StageResult } from "./types.js";

export interface PrMetadata {
  commitMsg: string;
  prTitle: string;
  prBody: string;
}

export function buildPrMetadata(ticket: {
  id: string;
  title: string;
  acceptanceCriteria: string[];
}): PrMetadata {
  const commitMsg = `[X-Factory] ${ticket.id}: ${ticket.title}`;
  const prTitle = commitMsg;
  const prBody = `Implemented by X-Factory.\n\nTicket: ${ticket.id} — ${ticket.title}\n\nAcceptance Criteria:\n${ticket.acceptanceCriteria.map((c) => `- ${c}`).join("\n") || "None specified"}`;
  return { commitMsg, prTitle, prBody };
}

export async function createPullRequestWithFallback(
  params: {
    project: Project;
    branch: string;
    worktree: string;
    prTitle: string;
    prBody: string;
  },
  deps: {
    createAzurePullRequest: typeof createAzurePullRequest;
    createPullRequest: typeof createPullRequest;
  },
): Promise<string> {
  const { project, branch, worktree, prTitle, prBody } = params;
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
      sourceBranch: branch,
      targetBranch: project.defaultBranch,
      title: prTitle,
      description: prBody,
    });

    if (azPrResult.ok && azPrResult.url) {
      return azPrResult.url;
    }
  }

  return deps.createPullRequest(
    worktree,
    prTitle,
    prBody,
    project.defaultBranch,
  );
}

export interface DeliverDependencies {
  recordBaseline: typeof git.recordBaseline;
  safeCommitAll: typeof git.safeCommitAll;
  push: typeof git.push;
  createAzurePullRequest: typeof createAzurePullRequest;
  createPullRequest: typeof createPullRequest;
}

export const defaultDeliverDeps: DeliverDependencies = {
  recordBaseline: git.recordBaseline,
  safeCommitAll: git.safeCommitAll,
  push: git.push,
  createAzurePullRequest,
  createPullRequest,
};

export class DeliverExecutor implements StageExecutor {
  readonly stage = "deliver";
  private deps: DeliverDependencies;

  constructor(deps: Partial<DeliverDependencies> = {}) {
    this.deps = { ...defaultDeliverDeps, ...deps };
  }

  async execute(context: StageContext): Promise<StageResult> {
    const { run, project, operationLedgerRepo } = context;
    const worktree = run.worktreePath || run.artifactsDir;

    const { commitMsg, prTitle, prBody } = buildPrMetadata(run.ticket);

    // 1. Idempotent Git commit (XFM-32, XFM-33)
    await operationLedgerRepo.executeWithLedger(
      run.id,
      "git_commit",
      async () => {
        defaultEventBus.emit(run.id, {
          type: "pr_step",
          text: "Committing verified changes safely…",
        });

        const baseline = await this.deps.recordBaseline(worktree);
        await this.deps.safeCommitAll(worktree, commitMsg, baseline);

        return {
          externalId: commitMsg,
          result: { committed: true, message: commitMsg },
        };
      },
    );

    // 2. Idempotent Git remote push (XFM-32, XFM-33)
    await operationLedgerRepo.executeWithLedger(
      run.id,
      "git_push",
      async () => {
        defaultEventBus.emit(run.id, {
          type: "pr_step",
          text: "Pushing branch to remote…",
        });
        await this.deps.push(worktree, run.branch);
        return {
          externalId: run.branch,
          result: { pushed: true, branch: run.branch },
        };
      },
    );

    // 3. Idempotent Pull Request creation (XFM-32, XFM-33)
    const pr = await operationLedgerRepo.executeWithLedger<PullRequest>(
      run.id,
      "create_pr",
      async () => {
        defaultEventBus.emit(run.id, {
          type: "pr_step",
          text: "Creating pull request…",
        });

        const prUrl = await createPullRequestWithFallback(
          {
            project,
            branch: run.branch,
            worktree,
            prTitle,
            prBody,
          },
          this.deps,
        );

        const createdPr: PullRequest = {
          url: prUrl.trim(),
          branch: run.branch,
          baseBranch: project.defaultBranch,
          title: prTitle,
        };

        return {
          externalId: createdPr.url,
          result: createdPr,
        };
      },
    );

    // Update run record in SQLite with pull request info
    context.run = context.runRepo.update(run.id, {
      pullRequest: pr,
    });

    defaultEventBus.emitStageEvidence(
      run.id,
      "deliver",
      `Pull Request ready: ${pr.url}`,
    );

    return {
      status: "success",
      nextRunStatus: "pr_created",
      output: pr,
    };
  }
}
