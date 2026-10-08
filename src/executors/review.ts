// src/executors/review.ts — ReviewExecutor: Automated code review and PR readiness gate (XFM-28).

import type { PiAgentSession, SessionOptions } from "../agents/pi.js";
import type { RunRecord } from "../db/run-repository.js";
import { reviewRun } from "../review.js";
import { loadSettings } from "../settings.js";
import type { StageContext, StageExecutor, StageResult } from "./types.js";

export interface ReviewDependencies {
  loadSettings: typeof loadSettings;
  /** Test seam: replaces the Pi review session that reviewRun creates. */
  sessionFactory?:
    | ((
        worktreePath: string,
        options?: SessionOptions,
      ) => Promise<PiAgentSession>)
    | undefined;
}

export const defaultReviewDeps: ReviewDependencies = {
  loadSettings,
};

export class ReviewExecutor implements StageExecutor {
  readonly stage = "review";
  private deps: ReviewDependencies;

  constructor(deps: Partial<ReviewDependencies> = {}) {
    this.deps = { ...defaultReviewDeps, ...deps };
  }

  async execute(context: StageContext): Promise<StageResult> {
    const { run } = context;
    const worktreePath = run.worktreePath || run.artifactsDir;

    context.eventRepo.appendEvent(run.id, "info", {
      text: "Conducting automated code review…",
    });

    const currentRun = context.runRepo.get(run.id);
    if (!currentRun?.verification) {
      return {
        status: "failed",
        nextRunStatus: "failed",
        error:
          "Deterministic verification is missing. ReviewExecutor cannot fabricate a successful result.",
      };
    }
    context.run = currentRun;

    const settings = await this.deps.loadSettings(false);
    // reviewRun owns review.json; this executor only records the result.
    const rResult = await reviewRun({
      projectId: context.project.id,
      runId: run.id,
      worktreePath,
      artifactsDir: run.artifactsDir,
      ticket: context.run.ticket,
      plan: context.run.plan,
      diff: context.run.diff || "",
      verification: currentRun.verification,
      modelConfig: settings.models?.sessionB,
      signal: context.signal,
      sessionFactory: this.deps.sessionFactory,
    });

    // Atomically update review record and append events (Phase 2, Section 31)
    let updatedRun: RunRecord | undefined;
    const tx = context.db.transaction(() => {
      updatedRun = context.runRepo.update(
        run.id,
        {
          review: rResult,
          expectedRevision: context.run.revision,
        },
        context.db,
      );

      context.eventRepo.appendEvent(
        run.id,
        "review",
        { result: rResult },
        context.db,
      );

      context.eventRepo.appendEvent(
        run.id,
        "stage_evidence",
        {
          stage: "review",
          evidence: rResult.passed
            ? `Review approved: ${rResult.summary}`
            : `Review rejected: ${rResult.summary}`,
        },
        context.db,
      );
    });
    tx();

    if (updatedRun) {
      context.run = updatedRun;
    }

    if (rResult.passed) {
      return {
        status: "success",
        nextStage: undefined,
        nextRunStatus: "awaiting_review",
        output: {
          passed: true,
          summary: rResult.summary,
        },
      };
    }

    return {
      status: "failed",
      nextRunStatus: "failed",
      error: `Code review was not approved: ${rResult.summary}`,
    };
  }
}
