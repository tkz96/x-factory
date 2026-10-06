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
import { ReviewExecutor } from "../src/executors/review.js";
import type { StageContext } from "../src/executors/types.js";
import type { loadSettings } from "../src/settings.js";
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
    // biome-ignore lint/suspicious/noExplicitAny: mock
    const baseExecuteMocks: any = {
      mkdir: async () => {},
      access: async () => {},
      chmod: async () => {},
      writeFile: async () => {},
      readFile: async () => "{}",
      resolveWorktreeBaseline: async () => ({
        trackedFiles: new Set(),
        untrackedFiles: new Set(),
      }),
      recordBaseline: async () => ({
        trackedFiles: new Set(),
        untrackedFiles: new Set(),
      }),
      runVerification: async () => ({
        passed: true,
        repairAttempt: 1,
        tests: {
          command: "test",
          exitCode: 0,
          stdout: "",
          stderr: "",
          passed: true,
          durationMs: 0,
        },
        filesChanged: [],
        hasPollution: false,
        summary: "All good",
        diff: "",
      }),
      buildRepairPrompt: () => "repair prompt",
      reviewExecutor: {
        stage: "review",
        execute: async () => ({
          status: "success",
          nextRunStatus: "awaiting_review",
          output: { passed: true, summary: "LGTM" },
        }),
      },
      getDiff: async () => ({ diff: "", filesChanged: [] }),
      MAX_REPAIR_ATTEMPTS: 3,
      spawn: ((_cmd: string, _args?: readonly string[]) => {
        const mockChild = new EventEmitter() as unknown as ChildProcess;
        // biome-ignore lint/suspicious/noExplicitAny: mock
        mockChild.stdout = new EventEmitter() as any;
        // biome-ignore lint/suspicious/noExplicitAny: mock
        mockChild.stderr = new EventEmitter() as any;
        // biome-ignore lint/suspicious/noExplicitAny: mock
        mockChild.kill = (() => true) as any;
        setTimeout(() => {
          mockChild.emit("close", 0);
        }, 10);
        return mockChild;
      }) as unknown as typeof spawn,
    };

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
        // biome-ignore lint/suspicious/noExplicitAny: mock
        readFile: (async () => "{}") as any,
        resolveWorktreeBaseline: async () => ({
          trackedFiles: new Set(),
          untrackedFiles: new Set(),
        }),
        recordBaseline: async () => ({
          trackedFiles: new Set(),
          untrackedFiles: new Set(),
        }),
        runVerification: async () => ({
          passed: true,
          repairAttempt: 1,
          tests: {
            command: "test",
            exitCode: 0,
            stdout: "",
            stderr: "",
            passed: true,
            durationMs: 0,
          },
          filesChanged: ["src/index.ts"],
          hasPollution: false,
          summary: "All good",
          diff: "diff --git a/src/index.ts b/src/index.ts\n+console.log('hello');",
        }),
        buildRepairPrompt: () => "repair prompt",
        reviewExecutor: {
          stage: "review",
          execute: async (_ctx) => ({
            status: "success",
            nextRunStatus: "awaiting_review",
            output: { passed: true, summary: "LGTM" },
          }),
        },
        MAX_REPAIR_ATTEMPTS: 3,
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
        // biome-ignore lint/suspicious/noExplicitAny: mock
        readFile: (async () => "{}") as any,
        resolveWorktreeBaseline: async () => ({
          trackedFiles: new Set(),
          untrackedFiles: new Set(),
        }),
        recordBaseline: async () => ({
          trackedFiles: new Set(),
          untrackedFiles: new Set(),
        }),
        runVerification: async () => ({
          passed: true,
          repairAttempt: 1,
          tests: {
            command: "test",
            exitCode: 0,
            stdout: "",
            stderr: "",
            passed: true,
            durationMs: 0,
          },
          filesChanged: [],
          hasPollution: false,
          summary: "All good",
          diff: "",
        }),
        buildRepairPrompt: () => "repair prompt",
        reviewExecutor: {
          stage: "review",
          execute: async () => ({
            status: "success",
            nextRunStatus: "awaiting_review",
            output: { passed: true, summary: "LGTM" },
          }),
        },
        MAX_REPAIR_ATTEMPTS: 3,
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
        // biome-ignore lint/suspicious/noExplicitAny: mock
        readFile: (async () => "{}") as any,
        resolveWorktreeBaseline: async () => ({
          trackedFiles: new Set(),
          untrackedFiles: new Set(),
        }),
        recordBaseline: async () => ({
          trackedFiles: new Set(),
          untrackedFiles: new Set(),
        }),
        runVerification: async () => ({
          passed: true,
          repairAttempt: 1,
          tests: {
            command: "test",
            exitCode: 0,
            stdout: "",
            stderr: "",
            passed: true,
            durationMs: 0,
          },
          filesChanged: [],
          hasPollution: false,
          summary: "All good",
          diff: "",
        }),
        buildRepairPrompt: () => "repair prompt",
        reviewExecutor: {
          stage: "review",
          execute: async () => ({
            status: "success",
            nextRunStatus: "awaiting_review",
            output: { passed: true, summary: "LGTM" },
          }),
        },
        MAX_REPAIR_ATTEMPTS: 3,
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

    it("spawns ralph with restricted environment, strictly isolating credentials and config", async () => {
      const { context } = setupTestContext("execute");

      // Inject wide array of secrets and config
      process.env.AWS_SECRET_ACCESS_KEY = "sensitive-secret-token";
      process.env.PI_API_KEY = "test-pi-key";
      process.env.HTTP_PROXY = "http://proxy:8080";
      process.env.HTTPS_PROXY = "http://proxy:8080";
      process.env.NO_PROXY = "localhost";
      process.env.OPENAI_API_KEY = "test-openai-key";
      process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
      process.env.GEMINI_API_KEY = "test-gemini-key";

      class MockSuccessChild extends EventEmitter {
        stdout = new EventEmitter();
        stderr = new EventEmitter();
        kill() {}
      }

      const mockChild = new MockSuccessChild();
      let capturedEnv: Record<string, string> | undefined;
      let capturedArgs: string[] | undefined;

      const executor = new ExecuteExecutor({
        mkdir: async () => {},
        access: async () => {},
        chmod: async () => {},
        writeFile: async () => {},
        // biome-ignore lint/suspicious/noExplicitAny: mock
        readFile: (async () => "{}") as any,
        resolveWorktreeBaseline: async () => ({
          trackedFiles: new Set(),
          untrackedFiles: new Set(),
        }),
        recordBaseline: async () => ({
          trackedFiles: new Set(),
          untrackedFiles: new Set(),
        }),
        runVerification: async () => ({
          passed: true,
          repairAttempt: 1,
          tests: {
            command: "test",
            exitCode: 0,
            stdout: "",
            stderr: "",
            passed: true,
            durationMs: 0,
          },
          filesChanged: [],
          hasPollution: false,
          summary: "All good",
          diff: "",
        }),
        buildRepairPrompt: () => "repair prompt",
        reviewExecutor: {
          stage: "review",
          execute: async () => ({
            status: "success",
            nextRunStatus: "awaiting_review",
            output: { passed: true, summary: "LGTM" },
          }),
        },
        MAX_REPAIR_ATTEMPTS: 3,
        loadSettings: async () =>
          ({
            models: { sessionA: { provider: "openai" } },
          }) as unknown as ReturnType<typeof loadSettings>,
        spawn: ((
          _command: string,
          args: string[],
          options: { env?: NodeJS.ProcessEnv },
        ) => {
          capturedArgs = args;
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
      expect(capturedArgs).toBeDefined();

      // 1. Credentials are not put into command arguments
      const argsStr = capturedArgs?.join(" ") ?? "";
      expect(argsStr).not.toContain("test-openai-key");
      expect(argsStr).not.toContain("test-pi-key");

      // 2. The selected provider credential is present
      expect(capturedEnv?.OPENAI_API_KEY).toBe("test-openai-key");

      // 3. PI_API_KEY is present
      expect(capturedEnv?.PI_API_KEY).toBe("test-pi-key");

      // 4. Irrelevant provider keys are absent
      expect(capturedEnv?.ANTHROPIC_API_KEY).toBeUndefined();
      expect(capturedEnv?.GEMINI_API_KEY).toBeUndefined();

      // 5. Unrelated secrets are absent
      expect(capturedEnv?.AWS_SECRET_ACCESS_KEY).toBeUndefined();

      // 6. Proxy variables are absent
      expect(capturedEnv?.HTTP_PROXY).toBeUndefined();
      expect(capturedEnv?.HTTPS_PROXY).toBeUndefined();
      expect(capturedEnv?.NO_PROXY).toBeUndefined();

      // Cleanup
      delete process.env.AWS_SECRET_ACCESS_KEY;
      delete process.env.PI_API_KEY;
      delete process.env.HTTP_PROXY;
      delete process.env.HTTPS_PROXY;
      delete process.env.NO_PROXY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.GEMINI_API_KEY;
    });

    it("Full success path (Loop -> Verify -> Review -> awaiting_review)", async () => {
      const { context } = setupTestContext("execute");
      const executor = new ExecuteExecutor(baseExecuteMocks);

      const result = await executor.execute(context);

      expect(result.status).toBe("success");
      expect(result.nextRunStatus).toBe("awaiting_review");
    });

    it("Verification failure -> Repair success -> Review -> awaiting_review", async () => {
      const { context } = setupTestContext("execute");
      let verificationCalls = 0;

      const executor = new ExecuteExecutor({
        ...baseExecuteMocks,
        runVerification: async () => {
          verificationCalls++;
          if (verificationCalls === 1) {
            return {
              passed: false,
              repairAttempt: 1,
              tests: {
                command: "test",
                exitCode: 1,
                stdout: "",
                stderr: "error",
                passed: false,
                durationMs: 0,
              },
              filesChanged: ["src/index.ts"],
              hasPollution: false,
              summary: "Failed test",
              diff: "some diff",
            };
          }
          return {
            passed: true,
            repairAttempt: 2,
            tests: {
              command: "test",
              exitCode: 0,
              stdout: "",
              stderr: "",
              passed: true,
              durationMs: 0,
            },
            filesChanged: ["src/index.ts"],
            hasPollution: false,
            summary: "Fixed",
            diff: "some diff",
          };
        },
      });

      const result = await executor.execute(context);

      expect(verificationCalls).toBe(2);
      expect(result.status).toBe("success");
      expect(result.nextRunStatus).toBe("awaiting_review");
    });

    it("Verification failure -> Repair exhaustion -> Failure (no review)", async () => {
      const { context } = setupTestContext("execute");
      let reviewCalled = false;

      const executor = new ExecuteExecutor({
        ...baseExecuteMocks,
        runVerification: async () => ({
          passed: false,
          repairAttempt: 1,
          tests: {
            command: "test",
            exitCode: 1,
            stdout: "",
            stderr: "error",
            passed: false,
            durationMs: 0,
          },
          filesChanged: ["src/index.ts"],
          hasPollution: false,
          summary: "Failed test",
          diff: "some diff",
        }),
        reviewExecutor: {
          stage: "review",
          execute: async () => {
            reviewCalled = true;
            return { status: "success", nextRunStatus: "awaiting_review" };
          },
        },
        MAX_REPAIR_ATTEMPTS: 2,
      });

      const result = await executor.execute(context);

      expect(result.status).toBe("failed");
      expect(result.error).toContain(
        "Verification did not pass after bounded repairs",
      );
      expect(reviewCalled).toBe(false);
    });

    it("Review failure -> No awaiting_review request", async () => {
      const { context } = setupTestContext("execute");

      const executor = new ExecuteExecutor({
        ...baseExecuteMocks,
        reviewExecutor: {
          stage: "review",
          execute: async () => ({
            status: "failed",
            error: "Review failed",
          }),
        },
      });

      const result = await executor.execute(context);

      expect(result.status).toBe("failed");
      expect(result.error).toContain("Review failed");
      expect(result.nextRunStatus).toBeUndefined();
    });

    it("Review success -> Receive exact verification result & Verification persisted before review", async () => {
      const { context, runRepo } = setupTestContext("execute");
      // biome-ignore lint/suspicious/noExplicitAny: test
      let runDiffBeforeReview: any = null;
      let runVerifBeforeReview: unknown = null;

      const verificationResult = {
        passed: true,
        repairAttempt: 1,
        tests: {
          command: "test",
          exitCode: 0,
          stdout: "",
          stderr: "",
          passed: true,
          durationMs: 0,
        },
        filesChanged: ["src/index.ts"],
        hasPollution: false,
        summary: "All good",
        diff: "diff --git a/file",
      };

      const executor = new ExecuteExecutor({
        ...baseExecuteMocks,
        getDiff: async () => ({
          diff: "diff --git a/file",
          filesChanged: ["src/index.ts"],
        }),
        runVerification: async () => verificationResult,
        reviewExecutor: new ReviewExecutor({
          reviewRun: async (input) => {
            const dbRun = runRepo.get(input.runId);
            runDiffBeforeReview = dbRun?.diff;
            runVerifBeforeReview = dbRun?.verification;
            return {
              passed: true,
              summary: "LGTM",
              findings: [],
              criteriaChecked: [],
            };
          },
          loadSettings: async () =>
            ({
              anthropicApiKey: "test-key",
            }) as unknown as ReturnType<typeof loadSettings>,
          writeFile: async () => {},
        }),
      });

      const result = await executor.execute(context);

      expect(result.status).toBe("success");
      expect(result.nextRunStatus).toBe("awaiting_review");

      // Verification persisted before review
      expect(runDiffBeforeReview).toBe("diff --git a/file");
      expect(runVerifBeforeReview).toEqual(verificationResult);

      // Review result is persisted successfully after verification
      const finalDbRun = runRepo.get(context.run.id);
      expect(finalDbRun?.review).toEqual({
        passed: true,
        summary: "LGTM",
        findings: [],
        criteriaChecked: [],
      });
    });
  });
});
