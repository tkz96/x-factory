// src/executors/review.ts — ReviewExecutor: Automated code review and PR readiness gate (XFM-28).

import type { ReadOnlySessionFactory } from "../agents/pi.js";
import {
  isBudgetReached,
  ModelUnavailableError,
  modelFailureReason,
  modelUse,
  resolveRole,
  usageWithCost,
} from "../model-roles.js";
import { reviewRun } from "../review.js";
import type {
  StageContext,
  StageExecutor,
  StageOutcome,
  StageRecord,
} from "./types.js";

export interface ReviewDependencies {
  resolveRole: typeof resolveRole;
  /** Test seam: replaces the Pi review session that reviewRun creates. */
  sessionFactory?: ReadOnlySessionFactory | undefined;
}

export const defaultReviewDeps: ReviewDependencies = {
  resolveRole,
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

    // The Reviewer role's model; a model that can't be used fails the stage
    // with its reason instead of falling back (#278).
    let rResult: Awaited<ReturnType<typeof reviewRun>>;
    try {
      const resolved = await this.deps.resolveRole("reviewer");
      context.assertBudget?.(resolved);
      context.recordModel(modelUse(resolved));
      // reviewRun owns review.json; this executor only records the result.
      let answer = "";
      rResult = await reviewRun({
        worktreePath,
        artifactsDir: run.artifactsDir,
        ticket: run.ticket,
        plan: run.plan,
        diff: run.diff || "",
        verification: run.verification,
        understanding: run.implementationContext,
        modelConfig: { resolved },
        assertBudget: context.assertBudget,
        // Session activity is forwarded as run events so the review is not a black box (#256).
        onEvent: (event) => {
          if (event.type === "error") {
            context.emit("error", {
              message: event.error ?? "The review session reported an error.",
            });
            return;
          }
          // Tool calls are forwarded as they happen; the streamed answer is
          // collected and recorded once, not one event per fragment.
          if (event.tool) {
            context.emit("review_activity", {
              tool: event.tool,
              ...(event.text ? { text: event.text } : {}),
            });
          } else if (event.text) {
            answer += event.text;
          }
        },
        onWait: (ms) =>
          context.emit("info", {
            text: `The provider is rate limiting ${resolved.modelId}; waiting ${Math.ceil(ms / 1000)} s before trying again.`,
          }),
        onUsage: (usage) => context.reportUsage(usageWithCost(resolved, usage)),
        signal: context.signal,
        sessionFactory: this.deps.sessionFactory,
      });
      if (answer.trim())
        context.emit("review_activity", { text: answer.trim() });
    } catch (err: unknown) {
      if (isBudgetReached(err)) {
        return { outcome: "paused", reason: err.message };
      }
      if (err instanceof ModelUnavailableError) {
        return { outcome: "error", error: modelFailureReason(err) };
      }
      throw err;
    }

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
