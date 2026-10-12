// src/executors/deliver.ts — DeliverExecutor: Safe commit, remote push, and PR creation with operation ledger (XFM-28, XFM-32, XFM-33).

import * as git from "../git.js";
import { loadProjectEnv } from "../project-env.js";
import { renderAcceptanceCriteria, renderTicketHeading } from "../prompts.js";
import type { ProviderPullRequest } from "../providers/contract.js";
import { resolveProjectConnection } from "../providers/project-connections.js";
import {
  PROVIDER_REGISTRY,
  type ProviderRegistry,
} from "../providers/registry.js";
import type { Project, PullRequest } from "../shared/types.js";
import { baselinePathFor, loadRecordedBaseline } from "../worktree-state.js";
import type { StageContext, StageExecutor, StageOutcome } from "./types.js";

export interface PrMetadata {
  commitMsg: string;
  prTitle: string;
  prBody: string;
}

export function buildPrMetadata(
  ticket: {
    id: string;
    title: string;
    acceptanceCriteria: string[];
  },
  project?: Project,
): PrMetadata {
  const commitMsg = `[X-Factory] ${ticket.id}: ${ticket.title}`;
  const prTitle = commitMsg;
  const closing = project ? githubClosingLine(ticket.id, project) : undefined;
  const prBody = `Implemented by X-Factory.\n\nTicket: ${renderTicketHeading(ticket, { hash: false })}\n\nAcceptance Criteria:\n${renderAcceptanceCriteria(ticket, { fallback: "None specified" })}${closing ? `\n\n${closing}` : ""}`;
  return { commitMsg, prTitle, prBody };
}

/** `owner/repo` from a GitHub connection's config, or "" when it names none. */
function githubCoordinate(config: Record<string, unknown>): string {
  const owner = typeof config.repoOwner === "string" ? config.repoOwner : "";
  const repo = typeof config.repository === "string" ? config.repository : "";
  return owner.trim() && repo.trim() ? `${owner.trim()}/${repo.trim()}` : "";
}

/** `owner/repo` from a git remote URL (HTTPS or SSH), or "". */
function remoteCoordinate(remote: string | undefined): string {
  const match = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(remote ?? "");
  return match ? `${match[1]}/${match[2]}` : "";
}

/**
 * The line that makes GitHub close the ticket's issue when the pull request
 * merges: `Closes #1` for an issue in the pull request's repository, or
 * `Closes owner/repo#1` for one in another. Only a GitHub issue (`GH-<n>`)
 * tracked by a GitHub connection, delivered to GitHub, gets one.
 */
function githubClosingLine(
  ticketId: string,
  project: Project,
): string | undefined {
  const issue = /^GH-(\d+)$/.exec(ticketId)?.[1];
  if (!issue) return undefined;
  const connections = project.connections ?? [];
  const tracker = connections.find((c) => c.roles.includes("tracker"));
  const gitHost = connections.find((c) => c.roles.includes("gitHost"));
  if (tracker?.providerId !== "github" || gitHost?.providerId !== "github") {
    return undefined;
  }
  if (tracker === gitHost) return `Closes #${issue}`;
  const issueRepo = githubCoordinate(tracker.config);
  const primary =
    project.repositories.find((r) => r.path === project.repositoryPath) ??
    project.repositories[0];
  const prRepo =
    githubCoordinate(gitHost.config) || remoteCoordinate(primary?.remote);
  if (!issueRepo || issueRepo.toLowerCase() === prRepo.toLowerCase()) {
    return `Closes #${issue}`;
  }
  return `Closes ${issueRepo}#${issue}`;
}

/** The project's git host connection, with its saved secrets merged in (#172). */
async function resolveGitHostConnection(
  project: Project,
  registry: ProviderRegistry,
) {
  const env = await loadProjectEnv(project.id);
  const connection = resolveProjectConnection(
    project,
    "gitHost",
    env,
    registry,
  );
  if (!connection) {
    throw new Error(`Project "${project.id}" has no git host connection.`);
  }
  return connection;
}

export async function defaultCreatePullRequest(
  project: Project,
  params: {
    branch: string;
    worktree: string;
    prTitle: string;
    prBody: string;
  },
  registry: ProviderRegistry = PROVIDER_REGISTRY,
  signal?: AbortSignal | undefined,
): Promise<string> {
  const { provider, config, repository } = await resolveGitHostConnection(
    project,
    registry,
  );

  const existing = await provider.findExistingPullRequest?.(
    config,
    {
      repository,
      sourceBranch: params.branch,
    },
    signal,
  );
  if (existing?.url) {
    return existing.url;
  }

  const pr = await provider.createPullRequest(
    config,
    {
      repository,
      title: params.prTitle,
      description: params.prBody,
      sourceBranch: params.branch,
      targetBranch: project.defaultBranch,
    },
    signal,
  );

  return pr.url;
}

export async function defaultFindExistingPullRequest(
  project: Project,
  params: {
    branch: string;
    worktree: string;
  },
  registry: ProviderRegistry = PROVIDER_REGISTRY,
  signal?: AbortSignal | undefined,
): Promise<ProviderPullRequest | null> {
  const { provider, config, repository } = await resolveGitHostConnection(
    project,
    registry,
  );

  return (
    (await provider.findExistingPullRequest?.(
      config,
      {
        repository,
        sourceBranch: params.branch,
      },
      signal,
    )) ?? null
  );
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
  signal?: AbortSignal | undefined,
): Promise<string> {
  const { project, branch, worktree, prTitle, prBody } = params;
  signal?.throwIfAborted();

  // External PR Crash Recovery: check for existing PR first
  const existing = await deps.findExistingPullRequest(
    project,
    {
      branch,
      worktree,
    },
    signal,
  );
  if (existing?.url) {
    return existing.url;
  }

  // A stop that landed during the lookup must not open a pull request.
  signal?.throwIfAborted();
  return deps.createPullRequest(
    project,
    {
      branch,
      worktree,
      prTitle,
      prBody,
    },
    signal,
  );
}

export interface DeliverDependencies {
  loadRecordedBaseline: typeof loadRecordedBaseline;
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
    signal?: AbortSignal | undefined,
  ) => Promise<string>;
  findExistingPullRequest: (
    project: Project,
    input: {
      branch: string;
      worktree: string;
    },
    signal?: AbortSignal | undefined,
  ) => Promise<ProviderPullRequest | null>;
  getHeadMessage: typeof git.getHeadMessage;
  getHeadSha: typeof git.getHeadSha;
  getParentSha: typeof git.getParentSha;
  getRemoteBranchSha: typeof git.getRemoteBranchSha;
  findCommitByMessageAndParent: typeof git.findCommitByMessageAndParent;
}

export const defaultDeliverDeps: DeliverDependencies = {
  loadRecordedBaseline,
  safeCommitAll: git.safeCommitAll,
  push: git.push,
  createPullRequest: (project, input, signal) =>
    defaultCreatePullRequest(project, input, PROVIDER_REGISTRY, signal),
  findExistingPullRequest: (project, input, signal) =>
    defaultFindExistingPullRequest(project, input, PROVIDER_REGISTRY, signal),
  getHeadMessage: git.getHeadMessage,
  getHeadSha: git.getHeadSha,
  getParentSha: git.getParentSha,
  getRemoteBranchSha: git.getRemoteBranchSha,
  findCommitByMessageAndParent: git.findCommitByMessageAndParent,
};

/** A delivered pull request as a stage outcome: what the stage runner commits for deliver. */
export function deliveredOutcome(pr: PullRequest): StageOutcome {
  return {
    outcome: "passed",
    output: pr,
    record: {
      run: { pullRequest: pr },
      events: [
        { type: "pr_step", payload: { step: "pr_created", url: pr.url } },
        {
          type: "stage_evidence",
          payload: {
            stage: "deliver",
            evidence: `Pull Request created: ${pr.url}`,
          },
        },
      ],
      statusPayload: {
        text: `Pull Request created: ${pr.url}`,
        pullRequest: pr,
      },
    },
  };
}

export class DeliverExecutor implements StageExecutor {
  readonly stage = "deliver";
  private deps: DeliverDependencies;

  constructor(deps: Partial<DeliverDependencies> = {}) {
    this.deps = { ...defaultDeliverDeps, ...deps };
  }

  async execute(context: StageContext): Promise<StageOutcome> {
    const { run, project, ledger, signal } = context;
    const worktree = run.worktreePath || run.artifactsDir;

    const { commitMsg, prTitle, prBody } = buildPrMetadata(run.ticket, project);

    // 1. Idempotent Git commit (XFM-32, XFM-33)
    await ledger.execute(
      "git_commit",
      async () => {
        context.emit("pr_step", {
          step: "git_commit",
          text: "Committing verified changes safely…",
        });

        const baseline = await this.deps.loadRecordedBaseline(
          baselinePathFor(run.artifactsDir),
        );
        await this.deps.safeCommitAll(worktree, commitMsg, baseline, signal);

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

        const headMsg = await this.deps.getHeadMessage(worktree, signal);
        const headSha = await this.deps.getHeadSha(worktree, signal);
        const parentSha = await this.deps.getParentSha(worktree, signal);

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
          signal,
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
        const preCommitSha = await this.deps.getHeadSha(worktree, signal);
        return { preCommitSha };
      },
    );

    // 2. Idempotent Git remote push (XFM-32, XFM-33)
    await ledger.execute(
      "git_push",
      async () => {
        context.emit("pr_step", {
          step: "git_push",
          text: "Pushing branch to remote…",
        });
        await this.deps.push(worktree, run.branch, signal);
        return {
          externalId: run.branch,
          result: { pushed: true, branch: run.branch },
        };
      },
      async () => {
        const headSha = await this.deps.getHeadSha(worktree, signal);
        const remoteSha = await this.deps.getRemoteBranchSha(
          worktree,
          "origin",
          run.branch,
          signal,
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
    // A stop that landed after the push must not open a pull request.
    signal.throwIfAborted();
    const pr = await ledger.execute<PullRequest>(
      "create_pr",
      async () => {
        context.emit("pr_step", {
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
          signal,
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
          .getHeadSha(worktree, signal)
          .catch(() => null);
        if (!currentHeadSha) {
          throw new Error(
            "Cannot safely reconcile create_pr without a valid local HEAD SHA.",
          );
        }

        const existing = await this.deps.findExistingPullRequest(
          project,
          {
            branch: run.branch,
            worktree,
          },
          signal,
        );

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

    // The run's pullRequest, the evidence, and the ready_for_pr -> pr_created transition are
    // committed by the stage runner, in one transaction with finishing the command.
    return deliveredOutcome(pr);
  }
}
