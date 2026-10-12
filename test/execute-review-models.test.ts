// test/execute-review-models.test.ts — The execute stage codes with the Builder
// and then reviews with the Reviewer, in one stage attempt. Each step keeps its
// own model and usage, so the run says which model coded and which reviewed,
// and each model's daily cost counts only its own tokens (Worker seam, real
// temp git repo, real review executor with a scripted session).

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRepositories } from "../src/composition-root.js";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrator.js";
import { ExecuteExecutor } from "../src/executors/execute.js";
import { ReviewExecutor } from "../src/executors/review.js";
import type { ResolvedModel } from "../src/model-roles.js";
import { execStrict } from "../src/proc.js";
import { getRun } from "../src/runs.js";
import type { ModelRoleName } from "../src/shared/types.js";
import { Worker } from "../src/worker.js";
import {
  baselinePathFor,
  recordBaseline,
  saveRecordedBaseline,
} from "../src/worktree-state.js";
import { testResolvedModel } from "./helpers/resolved-model.js";
import {
  PASSING_REVIEW_OUTPUT,
  scriptedReviewSession,
} from "./helpers/scripted-review-session.js";

const PROJECT_ID = "proj-exec-review-models";

const BUILDER: ResolvedModel = {
  ...testResolvedModel("builder"),
  modelId: "builder/model",
};
const REVIEWER: ResolvedModel = {
  ...testResolvedModel("reviewer"),
  connectionName: "Reviewer connection",
  modelId: "reviewer/model",
  details: { inputPricePerMTok: 1, outputPricePerMTok: 2 },
};

let tempDir: string;
let repo: string;
let artifactsDir: string;
let originalPath: string;
const previousDataDir = process.env.X_FACTORY_DATA_DIR;
const previousConfigPath = process.env.X_FACTORY_CONFIG_PATH;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "xf-exec-review-models-"));
  repo = path.join(tempDir, "repo");
  artifactsDir = path.join(tempDir, "artifacts");
  const binDir = path.join(tempDir, "bin");
  await mkdir(artifactsDir, { recursive: true });
  await mkdir(binDir, { recursive: true });
  originalPath = process.env.PATH || "";
  process.env.PATH = `${binDir}:${originalPath}`;
  process.env.X_FACTORY_DATA_DIR = path.join(tempDir, "data");
  process.env.X_FACTORY_CONFIG_PATH = path.join(tempDir, "projects.json");
  await writeFile(
    process.env.X_FACTORY_CONFIG_PATH,
    JSON.stringify({
      projects: [
        {
          id: PROJECT_ID,
          name: "Execute Review Models",
          repositoryPath: repo,
          defaultBranch: "main",
          testCommand: "true",
        },
      ],
    }),
  );

  await execStrict("git", ["init", "--initial-branch=main", repo], {
    envPolicy: "inherit",
  });
  await execStrict("git", ["config", "user.email", "test@xfactory.dev"], {
    envPolicy: "inherit",
    cwd: repo,
  });
  await execStrict("git", ["config", "user.name", "X-Factory Test"], {
    envPolicy: "inherit",
    cwd: repo,
  });
  await mkdir(path.join(repo, "src"), { recursive: true });
  await writeFile(path.join(repo, "src/app.ts"), "export const app = 1;\n");
  await execStrict("git", ["add", "-A"], { envPolicy: "inherit", cwd: repo });
  await execStrict("git", ["commit", "-m", "Initial commit"], {
    envPolicy: "inherit",
    cwd: repo,
  });
  await saveRecordedBaseline(
    baselinePathFor(artifactsDir),
    await recordBaseline(repo),
  );

  // A fake sandbox: the "agent" checks off its task and changes one file.
  const sbxPath = path.join(binDir, "sbx");
  await writeFile(
    sbxPath,
    `#!/usr/bin/env bash
awk '/- \\[ \\]/ && !done { sub(/- \\[ \\]/, "- [x]"); done=1 } 1' .agent/tasks.md > .agent/tasks.md.tmp && mv .agent/tasks.md.tmp .agent/tasks.md
printf 'export const app = 2;\\n' > src/app.ts
`,
  );
  await chmod(sbxPath, 0o755);
});

afterEach(async () => {
  process.env.PATH = originalPath;
  if (previousDataDir === undefined) delete process.env.X_FACTORY_DATA_DIR;
  else process.env.X_FACTORY_DATA_DIR = previousDataDir;
  if (previousConfigPath === undefined)
    delete process.env.X_FACTORY_CONFIG_PATH;
  else process.env.X_FACTORY_CONFIG_PATH = previousConfigPath;
  await rm(tempDir, { recursive: true, force: true });
});

describe("execute stage models", () => {
  it("records coding on the Builder and review on the Reviewer, each with its own usage", async () => {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    const repos = createRepositories(db);
    const run = repos.runs.create({
      id: "run-exec-review-models",
      projectId: PROJECT_ID,
      projectName: "Execute Review Models",
      ticket: { id: "E-1", title: "Change app", acceptanceCriteria: [] },
      plan: "1. Change app",
      branch: "main",
      status: "executing",
      artifactsDir,
      worktreePath: repo,
    });
    repos.jobs.createJob({
      runId: run.id,
      stage: "execute",
      status: "pending",
    });

    const resolveRole = async (role: ModelRoleName) =>
      role === "builder" ? BUILDER : REVIEWER;
    const executor = new ExecuteExecutor({
      resolveRole,
      loadSettings: async () => ({}),
      reviewExecutor: new ReviewExecutor({
        resolveRole,
        sessionFactory: async () => ({
          ...scriptedReviewSession(PASSING_REVIEW_OUTPUT),
          usage: () => ({ tokensIn: 1000, tokensOut: 200 }),
        }),
      }),
    });
    const worker = new Worker({
      workerId: "worker-exec-review-models",
      db,
      getStageExecutor: () => executor,
    });
    const job = repos.jobs.claimNextJob("worker-exec-review-models", 30_000);
    if (!job) throw new Error("Expected a pending execute job");
    await worker.processJob(job);

    expect(repos.runs.get(run.id)?.status).toBe("awaiting_review");

    const models = getRun(repos, run.id)?.stageModels ?? [];
    expect(models).toHaveLength(2);
    const [coding, review] = models;
    expect(coding).toMatchObject({
      stage: "execute",
      step: "execute",
      attempt: 1,
      role: "builder",
      modelId: "builder/model",
    });
    // The coding loop reports no tokens, so the Builder step has none.
    expect(coding?.tokensIn).toBeUndefined();
    expect(coding?.costUsd).toBeUndefined();
    expect(review).toMatchObject({
      stage: "execute",
      step: "review",
      attempt: 1,
      role: "reviewer",
      connectionName: "Reviewer connection",
      modelId: "reviewer/model",
      tokensIn: 1000,
      tokensOut: 200,
    });
    expect(review?.costUsd).toBeCloseTo(0.0014, 10);

    // The review's cost counts against the Reviewer's budget only.
    expect(
      repos.stageAttempts.getDailyCostForModel(
        REVIEWER.connectionId,
        REVIEWER.modelId,
      ),
    ).toBeCloseTo(0.0014, 10);
    expect(
      repos.stageAttempts.getDailyCostForModel(
        BUILDER.connectionId,
        BUILDER.modelId,
      ),
    ).toBe(0);

    // The timeline announces each step with its own model.
    const started = repos.events
      .getEventsForRun(run.id)
      .filter((e) => e.type === "stage_started")
      .map((e) => e.payload);
    expect(started).toEqual([
      expect.objectContaining({
        stage: "execute",
        step: "execute",
        model: expect.objectContaining({ modelId: "builder/model" }),
      }),
      expect.objectContaining({
        stage: "execute",
        step: "review",
        model: expect.objectContaining({ modelId: "reviewer/model" }),
      }),
    ]);
  });
});
