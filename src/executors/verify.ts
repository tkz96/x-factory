// src/executors/verify.ts — VerifyExecutor: Deterministic verification, reconstructable baseline & bounded repair routing (XFM-28, XFM-31, XFM-35).

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultEventBus } from "../events.js";
import * as git from "../git.js";
import { MAX_REPAIR_ATTEMPTS, runVerification } from "../verification.js";
import { resolveWorktreeBaseline } from "./baseline.js";
import type { StageContext, StageExecutor, StageResult } from "./types.js";

export interface VerifyDependencies {
  recordBaseline: typeof git.recordBaseline;
  runVerification: typeof runVerification;
  writeFile: (
    path: string,
    data: string,
    encoding?: BufferEncoding,
  ) => Promise<void>;
  readFile: (path: string, encoding?: BufferEncoding) => Promise<string>;
}

export const defaultVerifyDeps: VerifyDependencies = {
  recordBaseline: git.recordBaseline,
  runVerification,
  writeFile: async (p, d, enc) => {
    await writeFile(p, d, enc);
  },
  readFile: async (p, enc) => readFile(p, enc || "utf-8"),
};

export class VerifyExecutor implements StageExecutor {
  readonly stage = "verify";
  private deps: VerifyDependencies;

  constructor(deps: Partial<VerifyDependencies> = {}) {
    this.deps = { ...defaultVerifyDeps, ...deps };
  }

  async execute(context: StageContext): Promise<StageResult> {
    const { run, project } = context;
    const worktreePath = run.worktreePath || run.artifactsDir;

    defaultEventBus.emit(run.id, {
      type: "status",
      status: "verifying",
      text: "Running automated verification suite…",
    });

    // Reconstruct pre-implementation baseline state from artifactsDir (XFM-35)
    const baselineJsonPath = path.join(run.artifactsDir, "baseline.json");
    const baseline = await resolveWorktreeBaseline(
      baselineJsonPath,
      worktreePath,
      this.deps.readFile,
      this.deps.recordBaseline,
    );

    const attempt = (run.repairAttempts ?? 0) + 1;

    // Run deterministic verification checks
    const vResult = await this.deps.runVerification(
      worktreePath,
      project,
      baseline,
      attempt,
    );

    // Persist verification artifacts
    await this.deps.writeFile(
      path.join(run.artifactsDir, "verification.json"),
      JSON.stringify(vResult, null, 2),
      "utf-8",
    );
    await this.deps.writeFile(
      path.join(run.artifactsDir, "diff.patch"),
      vResult.diff,
      "utf-8",
    );

    // Update run record in SQLite
    context.runRepo.update(run.id, {
      verification: vResult,
      diff: vResult.diff,
      expectedRevision: run.revision,
    });

    defaultEventBus.emit(run.id, {
      type: "verification",
      result: vResult,
    });

    if (vResult.passed) {
      defaultEventBus.emitStageEvidence(
        run.id,
        "verify",
        `Verification checks passed: ${vResult.summary}`,
      );

      return {
        status: "success",
        nextStage: "review",
        nextRunStatus: "reviewing",
        output: {
          passed: true,
          summary: vResult.summary,
        },
      };
    }

    // Verification failed; check bounded automated repair (XFM-31)
    const currentRepairs = run.repairAttempts ?? 0;
    const nextRepairs = currentRepairs + 1;

    if (nextRepairs <= MAX_REPAIR_ATTEMPTS) {
      context.runRepo.update(run.id, {
        repairAttempts: nextRepairs,
      });

      defaultEventBus.emitStageEvidence(
        run.id,
        "verify",
        `Verification checks failed: ${vResult.summary}. Queuing repair attempt ${nextRepairs}/${MAX_REPAIR_ATTEMPTS}.`,
      );

      return {
        status: "retry",
        nextStage: "implement",
        nextRunStatus: "implementing",
        output: {
          passed: false,
          summary: vResult.summary,
          repairAttempt: nextRepairs,
        },
      };
    }

    // Repair attempts exhausted; fail run
    defaultEventBus.emitStageEvidence(
      run.id,
      "verify",
      `Verification failed after exhausting ${MAX_REPAIR_ATTEMPTS} repair attempts: ${vResult.summary}`,
    );

    return {
      status: "failed",
      nextRunStatus: "failed",
      error: `Verification checks failed after ${MAX_REPAIR_ATTEMPTS} repair attempt(s): ${vResult.summary}`,
    };
  }
}
