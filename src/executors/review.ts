// src/executors/review.ts — ReviewExecutor: Automated code review and PR readiness gate (XFM-28).

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultEventBus } from "../events.js";
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

    defaultEventBus.emit(run.id, {
      type: "status",
      status: "reviewing",
      text: "Conducting automated code review…",
    });

    const settings = await this.deps.loadSettings(false);
    const rResult = await this.deps.reviewRun({
      projectId: context.project.id,
      runId: run.id,
      worktreePath,
      ticket: run.ticket,
      plan: run.plan,
      diff: run.diff || "",
      verification: run.verification || {
        passed: true,
        repairAttempt: 0,
        tests: {
          command: "test",
          exitCode: 0,
          stdout: "",
          stderr: "",
          passed: true,
          durationMs: 0,
        },
        diff: "",
        filesChanged: [],
        hasPollution: false,
        summary: "No verification result",
      },
      modelConfig: settings.models?.sessionB,
    });

    // Save review.json artifact
    await this.deps.writeFile(
      path.join(run.artifactsDir, "review.json"),
      JSON.stringify(rResult, null, 2),
      "utf-8",
    );

    // Update run record in SQLite
    context.runRepo.update(run.id, {
      review: rResult,
      expectedRevision: run.revision,
    });

    defaultEventBus.emit(run.id, {
      type: "review",
      result: rResult,
    });

    if (rResult.passed) {
      defaultEventBus.emitStageEvidence(
        run.id,
        "review",
        `Review approved: ${rResult.summary}`,
      );

      return {
        status: "success",
        nextStage: "deliver",
        nextRunStatus: "ready_for_pr",
        output: {
          passed: true,
          summary: rResult.summary,
        },
      };
    }

    defaultEventBus.emitStageEvidence(
      run.id,
      "review",
      `Review rejected: ${rResult.summary}`,
    );

    return {
      status: "failed",
      nextRunStatus: "failed",
      error: `Code review was not approved: ${rResult.summary}`,
    };
  }
}
