// src/executors/execute.ts — ExecuteExecutor: events and persistence around the attempt loop (Ticket 02).

import { runAttemptLoop } from "../attempt-loop.js";
import { loadSettings } from "../settings.js";
import type { VerificationResult } from "../shared/types.js";
import { baselinePathFor, loadRecordedBaseline } from "../worktree-state.js";
import { ReviewExecutor } from "./review.js";
import type {
  StageContext,
  StageExecutor,
  StageOutcome,
  StageRecord,
} from "./types.js";

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

export class ExecuteExecutor implements StageExecutor {
  readonly stage = "execute";
  private deps: ExecuteDependencies;

  constructor(deps: Partial<ExecuteDependencies> = {}) {
    this.deps = { ...defaultExecuteDeps, ...deps };
  }

  async execute(context: StageContext): Promise<StageOutcome> {
    const { run, project, signal } = context;
    const worktreePath = run.worktreePath || run.artifactsDir;

    context.emit("info", {
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

    // The latest verification is the stage's output; each one is also emitted as it happens.
    let latest: VerificationResult | undefined;
    const verificationRecord = (): StageRecord | undefined =>
      latest ? { run: { verification: latest, diff: latest.diff } } : undefined;

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
        emit: context.emit,
        onVerification: (verification) => {
          latest = verification;
          context.emit("verification", { result: verification });
        },
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        outcome: "error",
        error: `Ralph Loop execution failed: ${errorMsg}`,
        record: verificationRecord(),
      };
    }

    if (result.outcome === "aborted") {
      return {
        outcome: "error",
        error: "Execution stopped",
        record: verificationRecord(),
      };
    }
    if (result.outcome === "exhausted") {
      // The repair budget is the attempt cap: a spent budget is a verdict like a rejected
      // review, so the run ends and the job is not retried into more agent loops (#163).
      return {
        outcome: "rejected",
        reason: result.error,
        record: verificationRecord(),
      };
    }
    if (result.outcome === "failed") {
      return {
        outcome: "error",
        error: result.error,
        record: verificationRecord(),
      };
    }

    context.emit("stage_evidence", {
      stage: "execute",
      evidence: `Ralph Loop completed and verified; ${result.verification.filesChanged.length} files modified.`,
    });

    // Delegate to ReviewExecutor now that execution is verified. It reads the verification
    // from the run it is given, so hand it the run as this stage has updated it.
    const verified = {
      ...run,
      verification: result.verification,
      diff: result.verification.diff,
    };
    const review = await this.deps.reviewExecutor.execute({
      ...context,
      run: verified,
    });
    return {
      ...review,
      record: {
        ...review.record,
        run: { ...verificationRecord()?.run, ...review.record?.run },
      },
    };
  }
}
