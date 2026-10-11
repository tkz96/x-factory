// src/executors/understand.ts — UnderstandExecutor: the Builder's analysis of the
// ticket, persisted as the run's ImplementationContext (#282). The model call is
// the stage's work: a model that can't be used, or an answer that names no file
// that exists, fails the stage with its reason — never a template.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { modelStageFailureReason } from "../agent-stage.js";
import type { ReadOnlySessionFactory } from "../agents/pi.js";
import { modelUse, resolveRole, usageWithCost } from "../model-roles.js";
import { understandRun } from "../understand.js";
import type { StageContext, StageExecutor, StageOutcome } from "./types.js";

export interface UnderstandDependencies {
  /** Resolves the Builder role's model (#282); a test seam. */
  resolveRole: typeof resolveRole;
  /** Test seam: replaces the Pi session the model call opens. */
  sessionFactory?: ReadOnlySessionFactory | undefined;
  writeFile: typeof writeFile;
}

export const defaultUnderstandDeps: UnderstandDependencies = {
  resolveRole,
  writeFile,
};

export class UnderstandExecutor implements StageExecutor {
  readonly stage = "understand";
  private deps: UnderstandDependencies;

  constructor(deps: Partial<UnderstandDependencies> = {}) {
    this.deps = { ...defaultUnderstandDeps, ...deps };
  }

  async execute(context: StageContext): Promise<StageOutcome> {
    const { run, project } = context;
    const worktreePath = run.worktreePath || run.artifactsDir;

    context.emit("info", {
      text: "Analyzing codebase & synthesizing context…",
    });

    // The Builder role's model; a model that can't be used fails the stage with
    // its reason instead of falling back (#278, #282).
    let understanding: Awaited<ReturnType<typeof understandRun>>;
    try {
      const resolved = await this.deps.resolveRole("builder");
      context.recordModel(modelUse(resolved));
      understanding = await understandRun({
        worktreePath,
        ticket: run.ticket,
        project,
        plan: run.plan,
        resolved,
        sessionFactory: this.deps.sessionFactory,
        emit: context.emit,
        onWait: (ms) =>
          context.emit("info", {
            text: `The provider is rate limiting ${resolved.modelId}; waiting ${Math.ceil(ms / 1000)} s before trying again.`,
          }),
        onUsage: (usage) => context.reportUsage(usageWithCost(resolved, usage)),
        signal: context.signal,
      });
    } catch (err: unknown) {
      const reason = modelStageFailureReason(err);
      if (reason) return { outcome: "error", error: reason };
      throw err;
    }

    const implContext = understanding.context;

    // Save implementation-context.json to artifacts directory
    await this.deps.writeFile(
      path.join(run.artifactsDir, "implementation-context.json"),
      JSON.stringify(implContext, null, 2),
      "utf-8",
    );

    return {
      outcome: "passed",
      output: {
        relevantFilesCount: implContext.relevantFiles.length,
        constraintsCount: implContext.constraints.length,
      },
      record: {
        run: { implementationContext: implContext },
        events: [
          {
            type: "stage_evidence",
            payload: {
              stage: "understand",
              evidence: `Identified ${implContext.relevantFiles.length} relevant files, ${implContext.constraints.length} constraints. ${understanding.summary}`,
            },
          },
        ],
      },
    };
  }
}
