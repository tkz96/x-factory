// src/executors/prepare.ts — PrepareExecutor: Branch, external worktree, and baseline initialization (XFM-28, XFM-32, XFM-33, XFM-35).

import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as git from "../git.js";
import { ensureDir, getWorktreePath } from "../paths.js";
import { renderTicketDoc } from "../prompts.js";
import type { Project } from "../shared/types.js";
import { baselinePathFor, recordBaseline } from "../worktree-state.js";
import { resolveWorktreeBaseline } from "./baseline.js";
import type {
  StageContext,
  StageExecutor,
  StageLedger,
  StageOutcome,
} from "./types.js";

export interface PrepareDependencies {
  branchExists: typeof git.branchExists;
  createBranch: typeof git.createBranch;
  createWorktree: typeof git.createWorktree;
  worktreeExists: (worktreePath: string) => Promise<boolean>;
  recordBaseline: typeof recordBaseline;
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
  recordBaseline,
  writeFile: async (p, d, enc) => {
    await writeFile(p, d, enc);
  },
  readFile: async (p, enc) => readFile(p, enc || "utf-8"),
};

export async function prepareBranch(
  ledger: StageLedger,
  project: Project,
  branch: string,
  branchExistsFn: typeof git.branchExists,
  createBranchFn: typeof git.createBranch,
  signal?: AbortSignal | undefined,
): Promise<void> {
  await ledger.execute("create_branch", async () => {
    const branchExists = await branchExistsFn(
      project.repositoryPath,
      branch,
      signal,
    );
    if (!branchExists) {
      await createBranchFn(
        project.repositoryPath,
        branch,
        project.defaultBranch,
        signal,
      );
    }
    return {
      externalId: branch,
      result: { branch },
    };
  });
}

export async function prepareWorktree(
  ledger: StageLedger,
  runId: string,
  project: Project,
  branch: string,
  expectedWorktreePath: string,
  worktreeExistsFn: (path: string) => Promise<boolean>,
  createWorktreeFn: typeof git.createWorktree,
  signal?: AbortSignal | undefined,
): Promise<string> {
  const worktreeResult = await ledger.execute<{
    worktreePath: string;
  }>("create_worktree", async () => {
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
      signal,
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
  await writeFileFn(
    path.join(artifactsDir, "ticket.md"),
    renderTicketDoc(ticket),
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

  async execute(context: StageContext): Promise<StageOutcome> {
    const { run, project, ledger, signal } = context;

    context.emit("info", { text: `Preparing branch ${run.branch}…` });

    // 1. Idempotent Git branch verification/creation (XFM-32, XFM-33)
    await prepareBranch(
      ledger,
      project,
      run.branch,
      this.deps.branchExists,
      this.deps.createBranch,
      signal,
    );

    // 2. Idempotent external worktree creation (XFM-32, XFM-33)
    context.emit("info", { text: "Creating dedicated external worktree…" });

    const expectedWorktreePath =
      run.worktreePath || getWorktreePath(project.id, run.id);

    const worktreePath = await prepareWorktree(
      ledger,
      run.id,
      project,
      run.branch,
      expectedWorktreePath,
      this.deps.worktreeExists,
      this.deps.createWorktree,
      signal,
    );

    // 3. Reconstructable baseline tracking (XFM-35)
    await ensureDir(run.artifactsDir);
    const baseline = await resolveWorktreeBaseline(
      baselinePathFor(run.artifactsDir),
      worktreePath,
      this.deps.readFile,
      (worktree) => this.deps.recordBaseline(worktree, signal),
      this.deps.writeFile,
    );

    // 4. Initialize ticket and plan files in artifactsDir
    await initializeArtifactFiles(
      run.artifactsDir,
      run.ticket,
      run.plan,
      this.deps.writeFile,
    );

    // 5. The run record gets its worktreePath when the runner commits this outcome.
    return {
      outcome: "passed",
      output: {
        worktreePath,
        branch: run.branch,
        trackedFilesCount: baseline.trackedFiles.size,
      },
      record: {
        run: { worktreePath },
        events: [
          {
            type: "stage_evidence",
            payload: {
              stage: "prepare",
              evidence: `Worktree ready at external path; branch ${run.branch}; baseline recorded.`,
            },
          },
        ],
      },
    };
  }
}
