// src/executors/deliver.ts — DeliverExecutor: Safe commit, remote push, and PR creation with operation ledger (XFM-28, XFM-32, XFM-33).

import * as git from "../git.js";
import {
  hasCapability,
  type ProviderPullRequest,
} from "../providers/contract.js";
import { resolveProjectProvider } from "../providers/project-config.js";
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

export async function defaultCreatePullRequest(
  project: Project,
  params: {
    branch: string;
    worktree: string;
    prTitle: string;
    prBody: string;
  },
): Promise<string> {
  const { provider, config, repository } = resolveProjectProvider(project);

  if (hasCapability(provider, "findExistingPullRequest")) {
    const existing = await provider.findExistingPullRequest(config, {
      repository,
      sourceBranch: params.branch,
    });
    if (existing?.url) {
      return existing.url;
    }
  }

  if (!hasCapability(provider, "createPullRequest")) {
    throw new Error(
      `Provider "${provider.id}" does not support createPullRequest capability.`,
    );
  }

  const pr = await provider.createPullRequest(config, {
    repository,
    title: params.prTitle,
    description: params.prBody,
    sourceBranch: params.branch,
    targetBranch: project.defaultBranch,
  });

  return pr.url;
}

export async function defaultFindExistingPullRequest(
  project: Project,
  params: {
    branch: string;
    worktree: string;
  },
): Promise<ProviderPullRequest | null> {
  const { provider, config, repository } = resolveProjectProvider(project);

  if (!hasCapability(provider, "findExistingPullRequest")) {
    return null;
  }

  return provider.findExistingPullRequest(config, {
    repository,
    sourceBranch: params.branch,
  });
}

export async function createPullRequestWithFallback(
  params: {
    project: Project;
    branch: string;
    worktree: string;
    prTitle: string;
    prBody: string;
  },
  deps: DeliverDependencies,
): Promise<string> {
  const { project, branch, worktree, prTitle, prBody } = params;

  // External PR Crash Recovery: check for existing PR first
  const existing = await deps.findExistingPullRequest(project, {
    branch,
    worktree,
  });
  if (existing?.url) {
    return existing.url;
  }

  return deps.createPullRequest(project, {
    branch,
    worktree,
    prTitle,
    prBody,
  });
}

export interface DeliverDependencies {
  recordBaseline: typeof git.recordBaseline;
  safeCommitAll: typeof git.safeCommitAll;
  push: typeof git.push;
  createPullRequest: (
    project: Project,
    input: {
      branch: string;
      worktree: string;
      prTitle: string;
      prBody: string;
    },
  ) => Promise<string>;
  findExistingPullRequest: (
    project: Project,
    input: {
      branch: string;
      worktree: string;
    },
  ) => Promise<ProviderPullRequest | null>;
  getHeadMessage: typeof git.getHeadMessage;
  getHeadSha: typeof git.getHeadSha;
  getParentSha: typeof git.getParentSha;
  getRemoteBranchSha: typeof git.getRemoteBranchSha;
  findCommitByMessageAndParent: typeof git.findCommitByMessageAndParent;
}

export const defaultDeliverDeps: DeliverDependencies = {
  recordBaseline: git.recordBaseline,
  safeCommitAll: git.safeCommitAll,
  push: git.push,
  createPullRequest: defaultCreatePullRequest,
  findExistingPullRequest: defaultFindExistingPullRequest,
  getHeadMessage: git.getHeadMessage,
  getHeadSha: git.getHeadSha,
  getParentSha: git.getParentSha,
  getRemoteBranchSha: git.getRemoteBranchSha,
  findCommitByMessageAndParent: git.findCommitByMessageAndParent,
};

export class DeliverExecutor implements StageExecutor {
  readonly stage = "deliver";
  private deps: DeliverDependencies;

  constructor(deps: Partial<DeliverDependencies> = {}) {
    this.deps = { ...defaultDeliverDeps, ...deps };
  }

  async deliver(context: StageContext): Promise<PullRequest> {
    const result = await this.execute(context);
    if (result.status !== "success" || !result.output) {
      throw new Error(result.error || "Deliver failed without output");
    }
    return result.output as PullRequest;
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
        context.eventRepo.appendEvent(run.id, "pr_step", {
          step: "git_commit",
          text: "Committing verified changes safely…",
        });

        const baseline = await this.deps.recordBaseline(worktree);
        await this.deps.safeCommitAll(worktree, commitMsg, baseline);

        return {
          externalId: commitMsg,
          result: { committed: true, message: commitMsg },
        };
      },
      async (metadata) => {
        const preCommitSha = (metadata as { preCommitSha?: string | null })
          ?.preCommitSha;
        if (!preCommitSha) {
          throw new Error(
            "Cannot safely reconcile git_commit without preCommitSha metadata.",
          );
        }

        const headMsg = await this.deps.getHeadMessage(worktree);
        const headSha = await this.deps.getHeadSha(worktree);
        const parentSha = await this.deps.getParentSha(worktree);

        if (
          headMsg === commitMsg &&
          parentSha === preCommitSha &&
          headSha !== preCommitSha
        ) {
          return {
            externalId: commitMsg,
            result: { committed: true, message: commitMsg },
          };
        }
        const matchedSha = await this.deps.findCommitByMessageAndParent(
          worktree,
          commitMsg,
          preCommitSha,
        );
        if (matchedSha) {
          return {
            externalId: commitMsg,
            result: { committed: true, message: commitMsg },
          };
        }

        if (headSha !== preCommitSha) {
          throw new Error(
            "Git HEAD has advanced since git_commit was prepared. Failing closed to prevent duplicate commits.",
          );
        }

        return null; // Not matching and HEAD hasn't advanced -> allow mutation
      },
      async () => {
        const preCommitSha = await this.deps.getHeadSha(worktree);
        return { preCommitSha };
      },
    );

    // 2. Idempotent Git remote push (XFM-32, XFM-33)
    await operationLedgerRepo.executeWithLedger(
      run.id,
      "git_push",
      async () => {
        context.eventRepo.appendEvent(run.id, "pr_step", {
          step: "git_push",
          text: "Pushing branch to remote…",
        });
        await this.deps.push(worktree, run.branch);
        return {
          externalId: run.branch,
          result: { pushed: true, branch: run.branch },
        };
      },
      async () => {
        const headSha = await this.deps.getHeadSha(worktree);
        const remoteSha = await this.deps.getRemoteBranchSha(
          worktree,
          "origin",
          run.branch,
        );
        if (headSha === remoteSha) {
          return {
            externalId: run.branch,
            result: { pushed: true, branch: run.branch },
          };
        }
        return null;
      },
    );

    // 3. Idempotent Pull Request creation (XFM-32, XFM-33)
    const pr = await operationLedgerRepo.executeWithLedger<PullRequest>(
      run.id,
      "create_pr",
      async () => {
        context.eventRepo.appendEvent(run.id, "pr_step", {
          step: "create_pr",
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
      async () => {
        // We only want to recover, not mutate. So we call the finder directly.
        const currentHeadSha = await this.deps
          .getHeadSha(worktree)
          .catch(() => null);
        if (!currentHeadSha) {
          throw new Error(
            "Cannot safely reconcile create_pr without a valid local HEAD SHA.",
          );
        }

        const existing = await this.deps.findExistingPullRequest(project, {
          branch: run.branch,
          worktree,
        });

        if (existing) {
          const raw = existing as unknown as Record<string, unknown>;
          const branchMatches =
            !existing.sourceBranch ||
            existing.sourceBranch === run.branch ||
            raw.headRefName === run.branch ||
            raw.sourceRefName === `refs/heads/${run.branch}`;
          const commitMatches =
            existing.lastMergeSourceCommit === currentHeadSha ||
            raw.headRefOid === currentHeadSha;

          if (branchMatches && commitMatches) {
            const recovered: PullRequest = {
              url: existing.url.trim(),
              branch: run.branch,
              baseBranch: project.defaultBranch,
              title: prTitle,
            };
            return { externalId: recovered.url, result: recovered };
          }
        }
        return null;
      },
    );

    // Note: State finalization (updating pullRequest, stage evidence, transition to pr_created)
    // is delegated to finalizeDeliver in src/services/deliver-service.ts to ensure single-transaction atomicity.
    return {
      status: "success",
      output: pr,
    };
  }
}
