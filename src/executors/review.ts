// src/executors/review.ts — ReviewExecutor: Automated code review and PR readiness gate (XFM-28).

import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { RunRecord } from "../db/run-repository.js";
import { reviewRun } from "../review.js";
import { loadSettings } from "../settings.js";
import type { StageContext, StageExecutor, StageResult } from "./types.js";

export interface ReviewDependencies {
  loadSettings: typeof loadSettings;
  reviewRun: typeof reviewRun;
  writeFile: typeof writeFile;
}

export const defaultReviewDeps: ReviewDependencies = {
  loadSettings,
  reviewRun,
  writeFile,
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
    if (currentRun) {
      if (!currentRun.verification && run.verification) {
        currentRun.verification = run.verification;
      }
      context.run = currentRun;
    }

    if (!context.run.verification) {
      return {
        status: "failed",
        nextRunStatus: "failed",
        error:
          "Deterministic verification is missing. ReviewExecutor cannot fabricate a successful result.",
      };
    }

    const settings = await this.deps.loadSettings(false);
    const rResult = await this.deps.reviewRun({
      projectId: context.project.id,
      runId: run.id,
      worktreePath,
      ticket: context.run.ticket,
      plan: context.run.plan,
      diff: context.run.diff || "",
      verification: context.run.verification,
      modelConfig: settings.models?.sessionB,
    });

    // Save review.json artifact
    await this.deps.writeFile(
      path.join(run.artifactsDir, "review.json"),
      JSON.stringify(rResult, null, 2),
      "utf-8",
    );

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
