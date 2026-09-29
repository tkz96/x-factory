import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DEFAULT_RALPH_SCRIPT } from "../src/executors/execute";

const execFileAsync = promisify(execFile);

describe("Ralph Loop Script", () => {
  let workDir: string;
  let binDir: string;
  let originalPath: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "ralph-script-test-"));
    binDir = join(workDir, "bin");
    await mkdir(binDir, { recursive: true });

    // Create the .agent directory
    await mkdir(join(workDir, ".agent"), { recursive: true });
    await writeFile(join(workDir, ".agent", "PROMPT.md"), "Test prompt");

    originalPath = process.env.PATH || "";
    process.env.PATH = `${binDir}:${originalPath}`;
  });

  afterEach(async () => {
    process.env.PATH = originalPath;
    await rm(workDir, { recursive: true, force: true });
  });

  async function createMockAgent(behaviorScript: string) {
    const mockAgentPath = join(binDir, "sbx");
    const script = `#!/usr/bin/env bash\n${behaviorScript}\n`;
    await writeFile(mockAgentPath, script);
    await chmod(mockAgentPath, 0o755);
  }

  async function runRalph(args: string[] = []) {
    const ralphPath = join(workDir, "ralph.sh");
    await writeFile(ralphPath, DEFAULT_RALPH_SCRIPT);
    await chmod(ralphPath, 0o755);

    try {
      const result = await execFileAsync(ralphPath, args, { cwd: workDir });
      return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
    } catch (error: unknown) {
      const err = error as Error & {
        stdout?: string;
        stderr?: string;
        code?: number;
      };
      return {
        stdout: err.stdout || "",
        stderr: err.stderr || "",
        exitCode: err.code || 1,
      };
    }
  }

  it("-n 3 results in at most 3 agent invocations", async () => {
    // Write 5 tasks so the loop tries to continue beyond 3
    const tasks = [
      "- [ ] Task 1",
      "- [ ] Task 2",
      "- [ ] Task 3",
      "- [ ] Task 4",
      "- [ ] Task 5",
    ].join("\n");
    await writeFile(join(workDir, ".agent", "tasks.md"), tasks);

    // Mock agent just prints its execution
    await createMockAgent(`
      echo "Agent executed"
    `);

    const { stdout, exitCode } = await runRalph(["-n", "3"]);

    const agentExecutions = (stdout.match(/Agent executed/g) || []).length;
    expect(agentExecutions).toBe(3);
    expect(stdout).toContain("Maximum iterations (3) reached.");
    expect(exitCode).not.toBe(0);
  });

  it("incomplete tasks after -n 3 produce failure", async () => {
    const tasks = [
      "- [ ] Task 1",
      "- [ ] Task 2",
      "- [ ] Task 3",
      "- [ ] Task 4",
      "- [ ] Task 5",
    ].join("\n");
    await writeFile(join(workDir, ".agent", "tasks.md"), tasks);

    await createMockAgent(`
      echo "Agent executed"
    `);

    const { stdout, exitCode } = await runRalph(["-n", "3"]);

    expect(stdout).toContain("Maximum iterations (3) reached.");
    expect(exitCode).not.toBe(0);
  });

  it("multiple iterations actually occur when unchecked tasks remain", async () => {
    const tasks = ["- [ ] Task 1", "- [ ] Task 2"].join("\n");
    await writeFile(join(workDir, ".agent", "tasks.md"), tasks);

    // Mock agent checks off one task per invocation
    await createMockAgent(`
      echo "Agent executed"
      awk '/- \\[ \\]/ && !done { sub(/- \\[ \\]/, "- [x]"); done=1 } 1' .agent/tasks.md > .agent/tasks.md.tmp
      mv .agent/tasks.md.tmp .agent/tasks.md
    `);

    const { stdout, exitCode } = await runRalph(["-n", "5"]);

    const agentExecutions = (stdout.match(/Agent executed/g) || []).length;
    expect(agentExecutions).toBe(2);
    expect(stdout).toContain("All tasks completed successfully.");
    expect(exitCode).toBe(0);
  });

  it("execution stops early when all tasks are checked", async () => {
    const tasks = ["- [x] Task 1", "- [x] Task 2"].join("\n");
    await writeFile(join(workDir, ".agent", "tasks.md"), tasks);

    await createMockAgent(`
      echo "Agent executed"
    `);

    const { stdout, exitCode } = await runRalph(["-n", "5"]);

    const agentExecutions = (stdout.match(/Agent executed/g) || []).length;
    expect(agentExecutions).toBe(1);
    expect(stdout).toContain("All tasks completed successfully.");
    expect(exitCode).toBe(0);
  });

  it("a non-zero agent exit stops the loop", async () => {
    const tasks = ["- [ ] Task 1"].join("\n");
    await writeFile(join(workDir, ".agent", "tasks.md"), tasks);

    // Mock agent fails
    await createMockAgent(`
      echo "Agent failed"
      exit 1
    `);

    const { stdout, exitCode } = await runRalph(["-n", "5"]);

    const agentExecutions = (stdout.match(/Agent failed/g) || []).length;
    expect(agentExecutions).toBe(1);
    expect(exitCode).not.toBe(0);
  });

  it("iteration progress is emitted", async () => {
    const tasks = ["- [ ] Task 1", "- [ ] Task 2"].join("\n");
    await writeFile(join(workDir, ".agent", "tasks.md"), tasks);

    await createMockAgent(`
      awk '/- \\[ \\]/ && !done { sub(/- \\[ \\]/, "- [x]"); done=1 } 1' .agent/tasks.md > .agent/tasks.md.tmp
      mv .agent/tasks.md.tmp .agent/tasks.md
    `);

    const { stdout } = await runRalph(["-n", "5"]);

    expect(stdout).toContain("Iteration 1 of 5");
    expect(stdout).toContain("Iteration 2 of 5");
  });

  it("the configured iteration count is respected", async () => {
    const tasks = ["- [ ] Task 1", "- [ ] Task 2"].join("\n");
    await writeFile(join(workDir, ".agent", "tasks.md"), tasks);

    await createMockAgent(`
      echo "Agent executed"
    `);

    const { stdout, exitCode } = await runRalph(["-n", "1"]);

    const agentExecutions = (stdout.match(/Agent executed/g) || []).length;
    expect(agentExecutions).toBe(1);
    expect(stdout).toContain("Maximum iterations (1) reached.");
    expect(exitCode).not.toBe(0);
  });

  it("missing sandbox fails closed", async () => {
    const tasks = ["- [ ] Task 1"].join("\n");
    await writeFile(join(workDir, ".agent", "tasks.md"), tasks);

    // DO NOT create mock agent to simulate missing execution mechanism

    const { stderr, stdout, exitCode } = await runRalph(["-n", "1"]);

    expect(stderr).toContain(
      "Error: Sandbox execution environment (sbx) is required but not found.",
    );
    expect(exitCode).not.toBe(0);
    expect(stdout).not.toContain("Agent executed");
  });
});
