// src/executors/prepare.ts — PrepareExecutor: Branch, external worktree, and baseline initialization (XFM-28, XFM-32, XFM-33, XFM-35).

import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OperationLedgerRepository } from "../db/operation-ledger-repository.js";
import * as git from "../git.js";
import { ensureDir, getWorktreePath } from "../paths.js";
import type { Project } from "../shared/types.js";
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

export async function prepareBranch(
  operationLedgerRepo: OperationLedgerRepository,
  runId: string,
  project: Project,
  branch: string,
  branchExistsFn: typeof git.branchExists,
  createBranchFn: typeof git.createBranch,
): Promise<void> {
  await operationLedgerRepo.executeWithLedger(
    runId,
    "create_branch",
    async () => {
      const branchExists = await branchExistsFn(project.repositoryPath, branch);
      if (!branchExists) {
        await createBranchFn(
          project.repositoryPath,
          branch,
          project.defaultBranch,
        );
      }
      return {
        externalId: branch,
        result: { branch },
      };
    },
  );
}

export async function prepareWorktree(
  operationLedgerRepo: OperationLedgerRepository,
  runId: string,
  project: Project,
  branch: string,
  expectedWorktreePath: string,
  worktreeExistsFn: (path: string) => Promise<boolean>,
  createWorktreeFn: typeof git.createWorktree,
): Promise<string> {
  const worktreeResult = await operationLedgerRepo.executeWithLedger<{
    worktreePath: string;
  }>(runId, "create_worktree", async () => {
    const exists = await worktreeExistsFn(expectedWorktreePath);
    if (exists) {
      return {
        externalId: expectedWorktreePath,
        result: { worktreePath: expectedWorktreePath },
      };
    }

    const wtPath = await createWorktreeFn(
      project.repositoryPath,
      branch,
      project.id,
      runId,
    );
    return {
      externalId: wtPath,
      result: { worktreePath: wtPath },
    };
  });

  return worktreeResult.worktreePath;
}

export async function initializeArtifactFiles(
  artifactsDir: string,
  ticket: {
    id: string;
    title: string;
    description?: string | undefined;
    acceptanceCriteria: string[];
  },
  plan: string,
  writeFileFn: (
    path: string,
    data: string,
    encoding?: BufferEncoding,
  ) => Promise<void>,
): Promise<void> {
  const ticketContent = `# Ticket ${ticket.id}: ${ticket.title}\n\n${ticket.description || ""}\n\n### Acceptance Criteria:\n${ticket.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}`;
  await writeFileFn(
    path.join(artifactsDir, "ticket.md"),
    ticketContent,
    "utf-8",
  );
  await writeFileFn(path.join(artifactsDir, "plan.md"), plan, "utf-8");
}

export class PrepareExecutor implements StageExecutor {
  readonly stage = "prepare";
  private deps: PrepareDependencies;

  constructor(deps: Partial<PrepareDependencies> = {}) {
    this.deps = { ...defaultPrepareDeps, ...deps };
  }

  async execute(context: StageContext): Promise<StageResult> {
    const { run, project, operationLedgerRepo } = context;

    context.eventRepo.appendEvent(run.id, "info", {
      text: `Preparing branch ${run.branch}…`,
    });

    // 1. Idempotent Git branch verification/creation (XFM-32, XFM-33)
    await prepareBranch(
      operationLedgerRepo,
      run.id,
      project,
      run.branch,
      this.deps.branchExists,
      this.deps.createBranch,
    );

    // 2. Idempotent external worktree creation (XFM-32, XFM-33)
    context.eventRepo.appendEvent(run.id, "info", {
      text: "Creating dedicated external worktree…",
    });

    const expectedWorktreePath =
      run.worktreePath || getWorktreePath(project.id, run.id);

    const worktreePath = await prepareWorktree(
      operationLedgerRepo,
      run.id,
      project,
      run.branch,
      expectedWorktreePath,
      this.deps.worktreeExists,
      this.deps.createWorktree,
    );

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
    await initializeArtifactFiles(
      run.artifactsDir,
      run.ticket,
      run.plan,
      this.deps.writeFile,
    );

    // 5. Update run record in SQLite with worktreePath
    context.run = context.runRepo.update(run.id, {
      worktreePath,
    });

    context.eventRepo.appendEvent(run.id, "stage_evidence", {
      stage: "prepare",
      evidence: `Worktree ready at external path; branch ${run.branch}; baseline recorded.`,
    });

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
