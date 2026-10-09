// test/ralph-executor.test.ts — Unit and integration tests for Autonomous Ralph Loop Execution (Ticket 02).

import { afterAll, describe, expect, it } from "bun:test";
import { formatTasksMarkdown } from "../src/attempt-loop.js";
import { createDatabase } from "../src/db/connection.js";
import { EventRepository } from "../src/db/event-repository.js";
import { JobRepository } from "../src/db/job-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { OperationLedgerRepository } from "../src/db/operation-ledger-repository.js";
import { type RunRecord, RunRepository } from "../src/db/run-repository.js";
import { StageAttemptRepository } from "../src/db/stage-attempt-repository.js";
import { PlanExecutor } from "../src/executors/plan.js";
import type { StageContext } from "../src/executors/types.js";
import { buildRalphPrompt } from "../src/prompts.js";
import type { Project } from "../src/shared/types.js";
import { tempArtifactsDirs } from "./helpers/scripted-review-session.js";

describe("Autonomous Ralph Loop Execution (Ticket 02)", () => {
  const artifactDirs = tempArtifactsDirs();
  afterAll(() => artifactDirs.cleanup());

  function setupTestContext(stage: string, overrides?: Partial<RunRecord>) {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    const runRepo = new RunRepository(db);
    const jobRepo = new JobRepository(db);
    const eventRepo = new EventRepository(db);
    const stageAttemptRepo = new StageAttemptRepository(db);
    const operationLedgerRepo = new OperationLedgerRepository(db);

    const project: Project = {
      id: "test-proj",
      name: "Test Project",
      workspacePath: "/tmp/test-proj",
      repositoryPath: "/tmp/test-proj-repo",
      defaultBranch: "main",
      testCommand: "bun test",
      typecheckCommand: "bun run typecheck",
      lintCommand: "bun run lint",
      repositories: [],
      issueTracker: { provider: "jira" },
    };

    const run = runRepo.create({
      id: "run-ralph-1",
      projectId: project.id,
      projectName: project.name,
      ticket: {
        id: "T-200",
        title: "Autonomous Ralph Ticket",
        description: "Implement TDD loop for Ralph",
        acceptanceCriteria: [
          "AC 1: Must run red-green-refactor",
          "AC 2: Must emit events",
        ],
      },
      plan: "Step 1: Write failing test\nStep 2: Implement logic\nStep 3: Refactor code",
      branch: "factory/T-200",
      status: "executing",
      artifactsDir: artifactDirs.make(),
      worktreePath: "/tmp/worktree-ralph-1",
      ...overrides,
    });

    const job = jobRepo.createJob({
      runId: run.id,
      stage,
    });

    const attempt = stageAttemptRepo.recordStart(run.id, stage, 1);

    const context: StageContext = {
      run,
      job,
      project,
      workerId: "test-worker-ralph",
      db,
      runRepo,
      jobRepo,
      eventRepo,
      stageAttemptRepo,
      operationLedgerRepo,
      attemptId: attempt.id,
    };

    return {
      context,
      runRepo,
      jobRepo,
      eventRepo,
      stageAttemptRepo,
      db,
      project,
    };
  }

  describe("formatTasksMarkdown", () => {
    it("converts plaintext steps into Ralph-compatible markdown checklist", () => {
      const plan = "Step 1: Write test\nStep 2: Implement\nStep 3: Refactor";
      const result = formatTasksMarkdown(plan);

      expect(result).toContain("# Task List");
      expect(result).toContain("## Task 1: Step 1: Write test");
      expect(result).toContain("- [ ] Step 1: Write test");
      expect(result).toContain("## Task 2: Step 2: Implement");
      expect(result).toContain("- [ ] Step 2: Implement");
      expect(result).toContain("## Task 3: Step 3: Refactor");
      expect(result).toContain("- [ ] Step 3: Refactor");
    });

    it("preserves already-formatted # Task List markdown", () => {
      const plan = `# Task List\n\n## Task 1: Custom Task\n- [ ] Substep A\n- [ ] Substep B`;
      const result = formatTasksMarkdown(plan);
      expect(result).toBe(plan);
    });

    it("generates default task list from ticket acceptance criteria when plan is empty", () => {
      const ticket = {
        id: "T-1",
        title: "Empty Plan Feature",
        acceptanceCriteria: ["Must pass all checks", "Must handle error"],
      };
      const result = formatTasksMarkdown("", ticket);

      expect(result).toContain("# Task List");
      expect(result).toContain("## Task 1: Empty Plan Feature");
      expect(result).toContain("- [ ] Must pass all checks");
      expect(result).toContain("- [ ] Must handle error");
    });
  });

  describe("buildRalphPrompt (Matt Pocock Skills Injection)", () => {
    it("injects Matt Pocock's TDD protocol and project commands into prompt", () => {
      const ticket = {
        id: "T-300",
        title: "TDD Feature",
        description: "Add user authentication",
        acceptanceCriteria: ["AC: JWT tokens valid", "AC: Refresh tokens work"],
      };
      const project: Project = {
        id: "p1",
        name: "P1",
        workspacePath: "/w",
        repositoryPath: "/r",
        defaultBranch: "main",
        testCommand: "bun test",
        typecheckCommand: "bun run typecheck",
        lintCommand: "bun run lint",
        repositories: [],
        issueTracker: { provider: "jira" },
      };

      const prompt = buildRalphPrompt(ticket, "Task 1: Auth", project);

      expect(prompt).toContain("Matt Pocock TDD Protocol");
      expect(prompt).toContain("Red-Green-Refactor");
      expect(prompt).toContain("1. **Red**: Write a failing test first");
      expect(prompt).toContain(
        "2. **Green**: Write the minimal amount of implementation code",
      );
      expect(prompt).toContain("3. **Refactor**: Clean up the code");
      expect(prompt).toContain("One Task Per Iteration");
      expect(prompt).toContain("Test Command: `bun test`");
      expect(prompt).toContain("Typecheck Command: `bun run typecheck`");
      expect(prompt).toContain("Lint Command: `bun run lint`");
    });
  });

  describe("PlanExecutor & Default Plan Synthesis", () => {
    it("generates structured execution plan when run.plan is missing", async () => {
      const { context, runRepo } = setupTestContext("plan", { plan: "" });
      const executor = new PlanExecutor();

      const result = await executor.execute(context);

      expect(result.status).toBe("success");
      expect(result.nextStage).toBeUndefined();
      expect(result.nextRunStatus).toBe("awaiting_plan_approval");

      const updatedRun = runRepo.get(context.run.id);
      expect(updatedRun?.plan).toContain("Execution Plan for #T-200");
      expect(updatedRun?.plan).toContain("Task 1: Setup & Tests");
      expect(updatedRun?.plan).toContain("Task 2: Core Implementation");
      expect(updatedRun?.plan).toContain(
        "Task 3: Quality Verification & Refactor",
      );
    });
  });
});
