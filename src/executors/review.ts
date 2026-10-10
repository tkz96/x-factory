// src/executors/review.ts — ReviewExecutor: Automated code review and PR readiness gate (XFM-28).

import { type ReviewSessionFactory, reviewRun } from "../review.js";
import { loadSettings } from "../settings.js";
import type {
  StageContext,
  StageExecutor,
  StageOutcome,
  StageRecord,
} from "./types.js";

export interface ReviewDependencies {
  loadSettings: typeof loadSettings;
  /** Test seam: replaces the Pi review session that reviewRun creates. */
  sessionFactory?: ReviewSessionFactory | undefined;
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

  async execute(context: StageContext): Promise<StageOutcome> {
    const { run } = context;
    const worktreePath = run.worktreePath || run.artifactsDir;

    context.emit("info", { text: "Conducting automated code review…" });

    if (!run.verification) {
      return {
        outcome: "error",
        error:
          "Deterministic verification is missing. ReviewExecutor cannot fabricate a successful result.",
      };
    }

    const settings = await this.deps.loadSettings(false);
    // reviewRun owns review.json; this executor only records the result.
    const rResult = await reviewRun({
      worktreePath,
      artifactsDir: run.artifactsDir,
      ticket: run.ticket,
      plan: run.plan,
      diff: run.diff || "",
      verification: run.verification,
      understanding: run.implementationContext,
      modelConfig: settings.models?.sessionB,
      signal: context.signal,
      sessionFactory: this.deps.sessionFactory,
    });

    // The review record and its events are committed by the runner with the transition.
    const record: StageRecord = {
      run: { review: rResult },
      events: [
        { type: "review", payload: { result: rResult } },
        {
          type: "stage_evidence",
          payload: {
            stage: "review",
            evidence: rResult.passed
              ? `Review approved: ${rResult.summary}`
              : `Review rejected: ${rResult.summary}`,
          },
        },
      ],
    };

    if (rResult.passed) {
      return {
        outcome: "passed",
        output: {
          passed: true,
          summary: rResult.summary,
        },
        record,
      };
    }

    return {
      outcome: "rejected",
      reason: `Code review was not approved: ${rResult.summary}`,
      record,
    };
  }
}
