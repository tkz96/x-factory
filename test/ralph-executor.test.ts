// test/ralph-executor.test.ts — Unit and integration tests for Autonomous Ralph Loop Execution (Ticket 02).

import { describe, expect, it } from "bun:test";
import type { ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createDatabase } from "../src/db/connection.js";
import { EventRepository } from "../src/db/event-repository.js";
import { JobRepository } from "../src/db/job-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { OperationLedgerRepository } from "../src/db/operation-ledger-repository.js";
import { type RunRecord, RunRepository } from "../src/db/run-repository.js";
import { StageAttemptRepository } from "../src/db/stage-attempt-repository.js";
import {
  buildRalphPrompt,
  DEFAULT_RALPH_SCRIPT,
  ExecuteExecutor,
  formatTasksMarkdown,
} from "../src/executors/execute.js";
import { PlanExecutor } from "../src/executors/plan.js";
import type { StageContext } from "../src/executors/types.js";
import type { Project } from "../src/shared/types.js";

describe("Autonomous Ralph Loop Execution (Ticket 02)", () => {
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
      artifactsDir: "/tmp/artifacts-ralph-1",
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

  describe("ExecuteExecutor (Autonomous Ralph Loop)", () => {
    it("generates artifacts, spawns ./ralph.sh, streams events, and pauses at awaiting_review", async () => {
      const { context, runRepo, eventRepo } = setupTestContext("execute");
      const writtenFiles: Record<string, string> = {};
      let spawnCalled = false;
      let spawnArgs: string[] = [];

      class MockChildProcess extends EventEmitter {
        stdout = new EventEmitter();
        stderr = new EventEmitter();
        kill() {}
      }

      const mockChild = new MockChildProcess();

      const executor = new ExecuteExecutor({
        mkdir: async () => {},
        access: async () => {
          throw new Error("File not found");
        },
        chmod: async () => {},
        writeFile: async (filePath, content) => {
          writtenFiles[filePath.toString()] = content.toString();
        },
        spawn: ((_cmd: string, args?: readonly string[]) => {
          spawnCalled = true;
          spawnArgs = [...(args || [])];
          setTimeout(() => {
            mockChild.stdout.emit(
              "data",
              Buffer.from("Starting Ralph Loop with agent=pi, iterations=25\n"),
            );
            mockChild.stdout.emit(
              "data",
              Buffer.from("Iteration 1: Working on Task 1\n"),
            );
            mockChild.emit("close", 0);
          }, 10);
          return mockChild as unknown as ChildProcess;
        }) as unknown as typeof spawn,
        getDiff: async () => ({
          diff: "diff --git a/src/index.ts b/src/index.ts\n+console.log('hello');",
          filesChanged: ["src/index.ts"],
        }),
      });

      const result = await executor.execute(context);

      // Verify artifacts written
      expect(writtenFiles["/tmp/worktree-ralph-1/.agent/tasks.md"]).toContain(
        "# Task List",
      );
      expect(writtenFiles["/tmp/worktree-ralph-1/.agent/PROMPT.md"]).toContain(
        "Matt Pocock TDD Protocol",
      );
      expect(writtenFiles["/tmp/worktree-ralph-1/ralph.sh"]).toBe(
        DEFAULT_RALPH_SCRIPT,
      );

      // Verify spawn arguments
      expect(spawnCalled).toBe(true);
      expect(spawnArgs).toEqual(["--agent", "pi", "-n", "25"]);

      // Verify result
      expect(result.status).toBe("success");
      expect(result.nextStage).toBeUndefined();
      expect(result.nextRunStatus).toBe("awaiting_review");

      // Verify SQLite run updated with diff
      const updatedRun = runRepo.get(context.run.id);
      expect(updatedRun?.diff).toContain("diff --git a/src/index.ts");

      // Verify progress events recorded in eventRepo
      const events = eventRepo.getEventsForRun(context.run.id);
      const ralphEvents = events.filter((e) => e.type === "ralph_progress");
      expect(ralphEvents.length).toBeGreaterThan(0);
    });

    it("catches non-zero exit codes from Ralph Loop and returns failed status", async () => {
      const { context } = setupTestContext("execute");

      class MockFailingChild extends EventEmitter {
        stdout = new EventEmitter();
        stderr = new EventEmitter();
        kill() {}
      }

      const mockChild = new MockFailingChild();

      const executor = new ExecuteExecutor({
        mkdir: async () => {},
        access: async () => {},
        chmod: async () => {},
        writeFile: async () => {},
        spawn: (() => {
          setTimeout(() => {
            mockChild.stderr.emit(
              "data",
              Buffer.from("Docker sandbox crashed: out of memory\n"),
            );
            mockChild.emit("close", 137);
          }, 10);
          return mockChild as unknown as ChildProcess;
        }) as unknown as typeof spawn,
        getDiff: async () => ({ diff: "", filesChanged: [] }),
      });

      const result = await executor.execute(context);

      expect(result.status).toBe("failed");
      expect(result.error).toContain("Ralph Loop exited with code 137");
      expect(result.error).toContain("out of memory");
    });

    it("catches spawn errors cleanly", async () => {
      const { context } = setupTestContext("execute");

      class MockErrorChild extends EventEmitter {
        stdout = new EventEmitter();
        stderr = new EventEmitter();
        kill() {}
      }

      const mockChild = new MockErrorChild();

      const executor = new ExecuteExecutor({
        mkdir: async () => {},
        access: async () => {},
        chmod: async () => {},
        writeFile: async () => {},
        spawn: (() => {
          setTimeout(() => {
            mockChild.emit("error", new Error("ENOENT: ralph.sh not found"));
          }, 10);
          return mockChild as unknown as ChildProcess;
        }) as unknown as typeof spawn,
        getDiff: async () => ({ diff: "", filesChanged: [] }),
      });

      const result = await executor.execute(context);

      expect(result.status).toBe("failed");
      expect(result.error).toContain("ENOENT");
    });

    it("spawns ralph with restricted environment, stripping sensitive host variables", async () => {
      const { context } = setupTestContext("execute");

      process.env.AWS_SECRET_ACCESS_KEY = "sensitive-secret-token";
      process.env.PI_API_KEY = "test-pi-key";

      class MockSuccessChild extends EventEmitter {
        stdout = new EventEmitter();
        stderr = new EventEmitter();
        kill() {}
      }

      const mockChild = new MockSuccessChild();
      let capturedEnv: Record<string, string> | undefined;

      const executor = new ExecuteExecutor({
        mkdir: async () => {},
        access: async () => {},
        chmod: async () => {},
        writeFile: async () => {},
        spawn: ((
          _command: string,
          _args: string[],
          options: { env?: NodeJS.ProcessEnv },
        ) => {
          capturedEnv = options.env as Record<string, string>;
          setTimeout(() => {
            mockChild.emit("close", 0);
          }, 10);
          return mockChild as unknown as ChildProcess;
        }) as unknown as typeof spawn,
        getDiff: async () => ({ diff: "", filesChanged: [] }),
      });

      await executor.execute(context);

      expect(capturedEnv).toBeDefined();
      expect(capturedEnv?.PI_API_KEY).toBe("test-pi-key");
      expect(capturedEnv?.AWS_SECRET_ACCESS_KEY).toBeUndefined();

      delete process.env.AWS_SECRET_ACCESS_KEY;
      delete process.env.PI_API_KEY;
    });
  });
});
