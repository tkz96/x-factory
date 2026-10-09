// src/executors/execute.ts — ExecuteExecutor: events and persistence around the attempt loop (Ticket 02).

import { runAttemptLoop } from "../attempt-loop.js";
import type { RunRecord } from "../db/run-repository.js";
import { loadSettings } from "../settings.js";
import type { VerificationResult } from "../shared/types.js";
import { baselinePathFor, loadRecordedBaseline } from "../worktree-state.js";
import { ReviewExecutor } from "./review.js";
import type { StageContext, StageExecutor, StageOutcome } from "./types.js";

export interface ExecuteDependencies {
  loadSettings: typeof loadSettings;
  reviewExecutor: StageExecutor;
}

export const defaultExecuteDeps: ExecuteDependencies = {
  loadSettings,
  get reviewExecutor() {
    return new ReviewExecutor();
  },
};

function persistVerificationResult(
  context: StageContext,
  verification: VerificationResult,
): RunRecord {
  const currentRun = context.runRepo.get(context.run.id, context.db);
  const expectedRevision = currentRun
    ? currentRun.revision
    : context.run.revision;

  let updatedRun: RunRecord | undefined;
  const tx = context.db.transaction(() => {
    updatedRun = context.runRepo.update(
      context.run.id,
      {
        diff: verification.diff,
        verification,
        expectedRevision,
      },
      context.db,
    );

    context.eventRepo.appendEvent(
      context.run.id,
      "verification",
      {
        result: verification,
      },
      context.db,
    );
  });
  tx();

  return updatedRun ?? context.run;
}

export class ExecuteExecutor implements StageExecutor {
  readonly stage = "execute";
  private deps: ExecuteDependencies;

  constructor(deps: Partial<ExecuteDependencies> = {}) {
    this.deps = { ...defaultExecuteDeps, ...deps };
  }

  async execute(context: StageContext): Promise<StageOutcome> {
    const { run, project, signal } = context;
    const worktreePath = run.worktreePath || run.artifactsDir;

    context.eventRepo.appendEvent(run.id, "info", {
      text: "Preparing Ralph Loop workspace and artifacts…",
    });

    // The baseline is recorded once, at preparation; it is never re-taken here.
    let baseline: Awaited<ReturnType<typeof loadRecordedBaseline>>;
    try {
      baseline = await loadRecordedBaseline(baselinePathFor(run.artifactsDir));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        outcome: "error",
        error: `Execution failed: no baseline was recorded during preparation (${message})`,
      };
    }

    const settings = await this.deps.loadSettings();
    const provider = settings.models?.sessionA?.provider || "anthropic";

    let result: Awaited<ReturnType<typeof runAttemptLoop>>;
    try {
      result = await runAttemptLoop({
        worktreePath,
        artifactsDir: run.artifactsDir,
        ticket: run.ticket,
        plan: run.plan || "",
        project,
        understanding: run.implementationContext,
        baseline,
        provider,
        signal,
        emit: (type, payload) =>
          context.eventRepo.appendEvent(run.id, type, payload),
        onVerification: (verification) => {
          context.run = persistVerificationResult(context, verification);
        },
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        outcome: "error",
        error: `Ralph Loop execution failed: ${errorMsg}`,
      };
    }

    if (result.outcome === "aborted") {
      return { outcome: "error", error: "Execution stopped" };
    }
    if (result.outcome === "failed") {
      return { outcome: "error", error: result.error };
    }

    context.eventRepo.appendEvent(run.id, "stage_evidence", {
      stage: "execute",
      evidence: `Ralph Loop completed and verified; ${result.verification.filesChanged.length} files modified.`,
    });

    // Delegate to ReviewExecutor now that execution is verified
    return this.deps.reviewExecutor.execute(context);
  }
}
