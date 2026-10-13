// src/pull-request-checker.ts — Polls git hosts for pull request outcomes and records them (#271).
//
// Only the worker executes this check (API process never runs work).
// Polling runs for runs in `pr_created` every 5 minutes, backs off on errors
// (honouring Retry-After and exponential backoff, mirroring src/model-gateway.ts),
// and stops for a run once its PR is merged or closed, or after 30 days.

import type { Repositories } from "./composition-root.js";
import { getProject } from "./config.js";
import type { EventRecord } from "./db/event-repository.js";
import { NotFoundError } from "./errors.js";
import { parseRetryDelayMs } from "./model-gateway.js";
import { loadProjectEnv } from "./project-env.js";
import { resolveProjectConnection } from "./providers/project-connections.js";
import {
  PROVIDER_REGISTRY,
  type ProviderRegistry,
} from "./providers/registry.js";
import type { Project, PullRequestOutcome } from "./shared/types.js";

export interface PullRequestCheckerClock {
  now(): number;
}

const systemClock: PullRequestCheckerClock = {
  now: () => Date.now(),
};

export interface PullRequestCheckerOptions {
  repos: Repositories;
  registry?: ProviderRegistry | undefined;
  resolveProject?: ((runId: string) => Promise<Project>) | undefined;
  clock?: PullRequestCheckerClock | undefined;
  pollIntervalMs?: number | undefined;
  thirtyDaysMs?: number | undefined;
  baseBackoffMs?: number | undefined;
  maxBackoffMs?: number | undefined;
  random?: (() => number) | undefined;
  onLog?: ((message: string) => void) | undefined;
  onError?: ((message: string, error?: unknown) => void) | undefined;
}

export type PullRequestCheckResult =
  | {
      checked: false;
      reason:
        | "not_found"
        | "not_pr_created"
        | "already_completed"
        | "expired_30_days"
        | "unsupported_provider"
        | "project_not_found";
    }
  | {
      checked: false;
      reason: "rate_limited" | "error";
      error: string;
      nextDueAt: number;
    }
  | { checked: true; status: "open"; nextDueAt: number }
  | {
      checked: true;
      status: "merged";
      outcome: PullRequestOutcome;
      event: EventRecord;
    }
  | {
      checked: true;
      status: "closed";
      outcome: PullRequestOutcome;
      event: EventRecord;
    };

export class PullRequestChecker {
  private readonly repos: Repositories;
  private readonly registry: ProviderRegistry;
  private readonly resolveProjectFn: (runId: string) => Promise<Project>;
  private readonly clock: PullRequestCheckerClock;
  readonly pollIntervalMs: number;
  readonly thirtyDaysMs: number;
  readonly baseBackoffMs: number;
  readonly maxBackoffMs: number;
  private readonly random: () => number;
  private readonly onLog?: ((message: string) => void) | undefined;
  private readonly onError?:
    | ((message: string, error?: unknown) => void)
    | undefined;

  /** Timestamp in ms when each runId is next eligible for polling or checking. */
  private readonly nextDueAt = new Map<string, number>();
  /** Number of consecutive errors encountered per runId. */
  private readonly consecutiveErrors = new Map<string, number>();
  /** Runs that cannot be checked because their project (or run row) is missing. */
  private readonly unresolvableRuns = new Set<string>();

  constructor(options: PullRequestCheckerOptions) {
    this.repos = options.repos;
    this.registry = options.registry ?? PROVIDER_REGISTRY;
    this.clock = options.clock ?? systemClock;
    this.pollIntervalMs = options.pollIntervalMs ?? 5 * 60 * 1000;
    this.thirtyDaysMs = options.thirtyDaysMs ?? 30 * 24 * 60 * 60 * 1000;
    this.baseBackoffMs = options.baseBackoffMs ?? 2_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 5 * 60 * 1000;
    this.random = options.random ?? Math.random;
    this.onLog = options.onLog;
    this.onError = options.onError;

    this.resolveProjectFn =
      options.resolveProject ??
      (async (runId: string) => {
        const run = this.repos.runs.get(runId);
        if (!run) throw new Error(`Run ${runId} not found`);
        const project = await getProject(run.project.id);
        if (!project) {
          throw new Error(`Project "${run.project.id}" not found.`);
        }
        return project;
      });
  }

  private isMissingProjectOrRunError(err: unknown): boolean {
    if (!err) return false;
    if (err instanceof NotFoundError) {
      return true;
    }
    const name = (err as { name?: string }).name;
    if (name === "NotFoundError" || name === "RunNotFoundError") {
      return true;
    }
    const message =
      err instanceof Error ? err.message : typeof err === "string" ? err : "";
    const lower = message.toLowerCase();
    if (
      lower.includes("project") &&
      (lower.includes("not found") ||
        lower.includes("not in the projects configuration") ||
        lower.includes("could not be loaded"))
    ) {
      return true;
    }
    if (lower.includes("run") && lower.includes("not found")) {
      return true;
    }
    return false;
  }

  /**
   * Calculates backoff wait duration in ms, mirroring model-gateway.ts.
   * If error carries a retry delay, uses it; otherwise computes exponential
   * backoff with jitter.
   */
  computeBackoffMs(err: unknown, errorCount: number): number {
    const errorObj = err as { retryAfterMs?: number; message?: string } | null;
    const retryAfter = errorObj?.retryAfterMs;
    if (typeof retryAfter === "number" && retryAfter > 0) {
      return retryAfter;
    }

    const message =
      err instanceof Error ? err.message : typeof err === "string" ? err : "";
    const parsedWait = parseRetryDelayMs(message);
    if (parsedWait !== undefined) {
      return parsedWait;
    }

    const exponential = Math.min(
      this.maxBackoffMs,
      this.baseBackoffMs * 2 ** Math.max(0, errorCount - 1),
    );
    return Math.round(exponential * (0.5 + this.random()));
  }

  /**
   * Checks whether a run is stopped due to terminal outcome, missing project, or exceeding 30 days.
   */
  isTerminalOrExpired(
    run: { id?: string; createdAt: string; status: string },
    now = this.clock.now(),
  ): boolean {
    if (run.id && this.unresolvableRuns.has(run.id)) return true;
    if (run.status !== "pr_created") return true;
    const createdTime = new Date(run.createdAt).getTime();
    return now - createdTime > this.thirtyDaysMs;
  }

  /**
   * Checks the PR status for a single run, handling backoff and recording outcomes.
   */
  async checkRun(
    runId: string,
    signal?: AbortSignal,
  ): Promise<PullRequestCheckResult> {
    const run = this.repos.runs.get(runId);
    if (!run) {
      this.unresolvableRuns.add(runId);
      return { checked: false, reason: "not_found" };
    }
    if (run.status !== "pr_created") {
      return { checked: false, reason: "not_pr_created" };
    }

    const existingOutcome = this.repos.events.getPullRequestOutcome(runId);
    if (existingOutcome) {
      return { checked: false, reason: "already_completed" };
    }

    if (this.unresolvableRuns.has(runId)) {
      return { checked: false, reason: "project_not_found" };
    }

    const now = this.clock.now();
    if (this.isTerminalOrExpired(run, now)) {
      this.onLog?.(`Run ${runId} PR check skipped: exceeded 30 days cutoff.`);
      return { checked: false, reason: "expired_30_days" };
    }

    // Check if the run is currently in backoff / rate limit
    const due = this.nextDueAt.get(runId);
    if (due !== undefined && now < due) {
      return {
        checked: false,
        reason: "rate_limited",
        error: `Currently in backoff until ${new Date(due).toISOString()}`,
        nextDueAt: due,
      };
    }

    try {
      let project: Project;
      try {
        project = await this.resolveProjectFn(runId);
        if (!project) {
          this.unresolvableRuns.add(runId);
          this.onLog?.(`Run ${runId} PR check skipped: project not found.`);
          return { checked: false, reason: "project_not_found" };
        }
      } catch (err: unknown) {
        if (this.isMissingProjectOrRunError(err)) {
          this.unresolvableRuns.add(runId);
          this.onLog?.(`Run ${runId} PR check skipped: project not found.`);
          return { checked: false, reason: "project_not_found" };
        }
        throw err;
      }

      const env = await loadProjectEnv(project.id);
      const connection = resolveProjectConnection(
        project,
        "gitHost",
        env,
        this.registry,
      );

      if (!connection) {
        throw new Error(`Project "${project.id}" has no git host connection.`);
      }

      const { provider, config, repository } = connection;
      if (typeof provider.getPullRequestState !== "function") {
        this.onLog?.(
          `Provider "${connection.providerId}" does not support getPullRequestState.`,
        );
        return { checked: false, reason: "unsupported_provider" };
      }

      const prUrl = run.pullRequest?.url;
      const state = await provider.getPullRequestState(
        config,
        {
          repository,
          sourceBranch: run.branch,
          pullRequestUrl: prUrl,
        },
        signal,
      );

      // On successful check, reset error backoff
      this.consecutiveErrors.delete(runId);

      if (state?.status === "merged") {
        const mergedAt =
          state.mergedAt ?? new Date(this.clock.now()).toISOString();
        const outcomeUrl = state.url || prUrl || "";
        const event = this.repos.events.appendEvent(runId, "pr_merged", {
          url: outcomeUrl,
          mergedAt,
          mergedBy: state.mergedBy,
        });
        const outcome: PullRequestOutcome = {
          status: "merged",
          state: "merged",
          url: outcomeUrl,
          mergedAt,
          mergedBy: state.mergedBy,
        };
        this.onLog?.(`Run ${runId} PR merged at ${mergedAt}`);
        return { checked: true, status: "merged", outcome, event };
      }

      if (state?.status === "closed") {
        const closedAt =
          state.closedAt ?? new Date(this.clock.now()).toISOString();
        const outcomeUrl = state.url || prUrl || "";
        const event = this.repos.events.appendEvent(runId, "pr_closed", {
          url: outcomeUrl,
          closedAt,
        });
        const outcome: PullRequestOutcome = {
          status: "closed",
          state: "closed",
          url: outcomeUrl,
          closedAt,
        };
        this.onLog?.(`Run ${runId} PR closed at ${closedAt}`);
        return { checked: true, status: "closed", outcome, event };
      }

      // Still open: schedule next check in pollIntervalMs
      const nextDue = this.clock.now() + this.pollIntervalMs;
      this.nextDueAt.set(runId, nextDue);
      return { checked: true, status: "open", nextDueAt: nextDue };
    } catch (err: unknown) {
      const errorCount = (this.consecutiveErrors.get(runId) ?? 0) + 1;
      this.consecutiveErrors.set(runId, errorCount);
      const backoffMs = this.computeBackoffMs(err, errorCount);
      const nextDue = this.clock.now() + backoffMs;
      this.nextDueAt.set(runId, nextDue);

      const errorMessage = err instanceof Error ? err.message : String(err);
      this.onError?.(
        `Error checking PR for run ${runId} (attempt error ${errorCount}, backing off ${backoffMs}ms): ${errorMessage}`,
        err,
      );

      return {
        checked: false,
        reason: "error",
        error: errorMessage,
        nextDueAt: nextDue,
      };
    }
  }

  /**
   * Scans all runs in `pr_created` and checks any whose check is currently due.
   */
  async pollDueRuns(signal?: AbortSignal): Promise<PullRequestCheckResult[]> {
    const now = this.clock.now();
    const runs = this.repos.runs.list();
    const results: PullRequestCheckResult[] = [];

    for (const run of runs) {
      if (signal?.aborted) break;
      if (run.status !== "pr_created") continue;
      if (this.repos.events.getPullRequestOutcome(run.id)) continue;
      if (this.isTerminalOrExpired(run, now)) continue;

      const due = this.nextDueAt.get(run.id);
      if (due !== undefined && now < due) {
        continue; // Not due yet
      }

      const result = await this.checkRun(run.id, signal);
      results.push(result);
    }

    return results;
  }
}
