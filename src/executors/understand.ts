// src/executors/understand.ts — UnderstandExecutor: Codebase analysis & context synthesis (XFM-28).

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { buildImplementationContext } from "../understand.js";
import type { StageContext, StageExecutor, StageResult } from "./types.js";

export interface UnderstandDependencies {
  buildImplementationContext: typeof buildImplementationContext;
  writeFile: typeof writeFile;
}

export const defaultUnderstandDeps: UnderstandDependencies = {
  buildImplementationContext,
  writeFile,
};

export class UnderstandExecutor implements StageExecutor {
  readonly stage = "understand";
  private deps: UnderstandDependencies;

  constructor(deps: Partial<UnderstandDependencies> = {}) {
    this.deps = { ...defaultUnderstandDeps, ...deps };
  }

  async execute(context: StageContext): Promise<StageResult> {
    const { run, project } = context;
    const worktreePath = run.worktreePath || run.artifactsDir;

    context.eventRepo.appendEvent(run.id, "info", {
      text: "Analyzing codebase & synthesizing context…",
    });

    const implContext = await this.deps.buildImplementationContext(
      worktreePath,
      project,
      run.ticket,
      run.plan,
    );

    // Save implementation-context.json to artifacts directory
    await this.deps.writeFile(
      path.join(run.artifactsDir, "implementation-context.json"),
      JSON.stringify(implContext, null, 2),
      "utf-8",
    );

    // Update run record in SQLite with synthesized context
    context.runRepo.update(run.id, {
      implementationContext: implContext,
      expectedRevision: run.revision,
    });

    context.eventRepo.appendEvent(run.id, "stage_evidence", {
      stage: "understand",
      evidence: `Identified ${implContext.relevantFiles.length} relevant files, ${implContext.constraints.length} constraints.`,
    });

    return {
      status: "success",
      nextStage: "implement",
      nextRunStatus: "implementing",
      output: {
        relevantFilesCount: implContext.relevantFiles.length,
        constraintsCount: implContext.constraints.length,
      },
    };
  }
}
