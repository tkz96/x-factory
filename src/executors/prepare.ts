// src/executors/prepare.ts — PrepareExecutor: Branch, external worktree, and baseline initialization (XFM-28, XFM-32, XFM-33, XFM-35).

import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultEventBus } from "../events.js";
import * as git from "../git.js";
import { ensureDir, getWorktreePath } from "../paths.js";
import { resolveWorktreeBaseline } from "./baseline.js";
import type { StageContext, StageExecutor, StageResult } from "./types.js";

export interface PrepareDependencies {
  branchExists: typeof git.branchExists;
  createBranch: typeof git.createBranch;
  createWorktree: typeof git.createWorktree;
  worktreeExists: (worktreePath: string) => Promise<boolean>;
  recordBaseline: typeof git.recordBaseline;
  writeFile: (
    path: string,
    data: string,
    encoding?: BufferEncoding,
  ) => Promise<void>;
  readFile: (path: string, encoding?: BufferEncoding) => Promise<string>;
}

async function defaultPathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export const defaultPrepareDeps: PrepareDependencies = {
  branchExists: git.branchExists,
  createBranch: git.createBranch,
  createWorktree: git.createWorktree,
  worktreeExists: defaultPathExists,
  recordBaseline: git.recordBaseline,
  writeFile: async (p, d, enc) => {
    await writeFile(p, d, enc);
  },
  readFile: async (p, enc) => readFile(p, enc || "utf-8"),
};

export class PrepareExecutor implements StageExecutor {
  readonly stage = "prepare";
  private deps: PrepareDependencies;

  constructor(deps: Partial<PrepareDependencies> = {}) {
    this.deps = { ...defaultPrepareDeps, ...deps };
  }

  async execute(context: StageContext): Promise<StageResult> {
    const { run, project, operationLedgerRepo } = context;

    defaultEventBus.emit(run.id, {
      type: "info",
      text: `Preparing branch ${run.branch}…`,
    });

    // 1. Idempotent Git branch verification/creation (XFM-32, XFM-33)
    await operationLedgerRepo.executeWithLedger(
      run.id,
      "create_branch",
      async () => {
        const branchExists = await this.deps.branchExists(
          project.repositoryPath,
          run.branch,
        );
        if (!branchExists) {
          await this.deps.createBranch(
            project.repositoryPath,
            run.branch,
            project.defaultBranch,
          );
        }
        return {
          externalId: run.branch,
          result: { branch: run.branch },
        };
      },
    );

    // 2. Idempotent external worktree creation (XFM-32, XFM-33)
    defaultEventBus.emit(run.id, {
      type: "info",
      text: "Creating dedicated external worktree…",
    });

    const expectedWorktreePath =
      run.worktreePath || getWorktreePath(project.id, run.id);

    const worktreeResult = await operationLedgerRepo.executeWithLedger(
      run.id,
      "create_worktree",
      async () => {
        const exists = await this.deps.worktreeExists(expectedWorktreePath);
        if (exists) {
          return {
            externalId: expectedWorktreePath,
            result: { worktreePath: expectedWorktreePath },
          };
        }

        const wtPath = await this.deps.createWorktree(
          project.repositoryPath,
          run.branch,
          project.id,
          run.id,
        );
        return {
          externalId: wtPath,
          result: { worktreePath: wtPath },
        };
      },
    );

    const worktreePath = worktreeResult.worktreePath;

    // 3. Reconstructable baseline tracking (XFM-35)
    await ensureDir(run.artifactsDir);
    const baselineJsonPath = path.join(run.artifactsDir, "baseline.json");
    const baseline = await resolveWorktreeBaseline(
      baselineJsonPath,
      worktreePath,
      this.deps.readFile,
      this.deps.recordBaseline,
      this.deps.writeFile,
    );

    // 4. Initialize ticket and plan files in artifactsDir
    const ticketContent = `# Ticket ${run.ticket.id}: ${run.ticket.title}\n\n${run.ticket.description || ""}\n\n### Acceptance Criteria:\n${run.ticket.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}`;
    await this.deps.writeFile(
      path.join(run.artifactsDir, "ticket.md"),
      ticketContent,
      "utf-8",
    );
    await this.deps.writeFile(
      path.join(run.artifactsDir, "plan.md"),
      run.plan,
      "utf-8",
    );

    // 5. Update run record in SQLite with worktreePath
    context.run = context.runRepo.update(run.id, {
      worktreePath,
    });

    defaultEventBus.emitStageEvidence(
      run.id,
      "prepare",
      `Worktree ready at external path; branch ${run.branch}; baseline recorded.`,
    );

    return {
      status: "success",
      nextStage: "understand",
      nextRunStatus: "understanding",
      output: {
        worktreePath,
        branch: run.branch,
        trackedFilesCount: baseline.trackedFiles.size,
      },
    };
  }
}
