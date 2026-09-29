// src/executors/execute.ts — ExecuteExecutor: Autonomous Ralph Loop execution (Ticket 02).

import { spawn } from "node:child_process";
import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import * as git from "../git.js";
import { loadSettings } from "../settings.js";
import type { Project, Ticket } from "../shared/types.js";
import type { StageContext, StageExecutor, StageResult } from "./types.js";

export interface ExecuteDependencies {
  spawn: typeof spawn;
  getDiff: typeof git.getDiff;
  writeFile: typeof writeFile;
  mkdir: typeof mkdir;
  access: typeof access;
  chmod: typeof chmod;
  loadSettings: typeof loadSettings;
}

export const defaultExecuteDeps: ExecuteDependencies = {
  spawn,
  getDiff: git.getDiff,
  writeFile,
  mkdir,
  access,
  chmod,
  loadSettings,
};

export const DEFAULT_RALPH_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail

AGENT="pi"
ITERATIONS=25

while [[ $# -gt 0 ]]; do
  case $1 in
    --agent)
      AGENT="$2"
      shift 2
      ;;
    -n)
      ITERATIONS="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

echo "Starting Ralph Loop: agent=$AGENT, iterations=$ITERATIONS"

for (( i=1; i<=ITERATIONS; i++ )); do
  echo "Iteration $i of $ITERATIONS"

  if command -v sbx &>/dev/null; then
    sbx run --name "ralph-\${AGENT}-$\${RANDOM}" "\${AGENT}" .
  else
    echo "Executing iteration with \${AGENT}..."
    if command -v pi &>/dev/null; then
      pi --prompt "$(< .agent/PROMPT.md)"
    else
      echo "Error: No usable execution mechanism exists for agent \${AGENT}." >&2
      exit 1
    fi
  fi

  if [[ -f .agent/tasks.md ]]; then
    if ! grep -q '\\- \\[ \\]' .agent/tasks.md; then
      echo "All tasks completed successfully."
      exit 0
    fi
  else
    echo "No .agent/tasks.md found, finishing early."
    exit 0
  fi
done

echo "Maximum iterations ($ITERATIONS) reached."
exit 1
`;

/**
 * Formats a plan or ticket into a Ralph Loop-compatible .agent/tasks.md checklist.
 */
export function formatTasksMarkdown(plan: string, ticket?: Ticket): string {
  const trimmed = plan.trim();
  if (trimmed.startsWith("# Task List")) {
    return trimmed;
  }

  const lines = trimmed
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const tasks: Array<{ title: string; steps: string[] }> = [];
  let currentTask: { title: string; steps: string[] } | null = null;

  for (const line of lines) {
    if (
      line.startsWith("## Task") ||
      line.startsWith("### Task") ||
      /^#+\s+Task/i.test(line)
    ) {
      const title = line.replace(/^#+\s+/i, "");
      currentTask = { title, steps: [] };
      tasks.push(currentTask);
    } else if (/^\d+\.\s+/.test(line)) {
      const title = line.replace(/^\d+\.\s+/, "");
      currentTask = { title: `Task ${tasks.length + 1}: ${title}`, steps: [] };
      tasks.push(currentTask);
    } else if (/^(Step|Task)\s+\d+[:.]/i.test(line)) {
      currentTask = { title: line, steps: [line] };
      tasks.push(currentTask);
    } else if (line.startsWith("- [ ]") || line.startsWith("- [x]")) {
      const step = line.replace(/^-\s+\[[ x]\]\s+/i, "");
      if (!currentTask) {
        currentTask = {
          title: `Task ${tasks.length + 1}: ${ticket?.title || "Implementation"}`,
          steps: [],
        };
        tasks.push(currentTask);
      }
      currentTask.steps.push(step);
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      const step = line.replace(/^[-*]\s+/, "");
      if (!currentTask) {
        currentTask = {
          title: `Task ${tasks.length + 1}: ${ticket?.title || "Implementation"}`,
          steps: [],
        };
        tasks.push(currentTask);
      }
      currentTask.steps.push(step);
    } else {
      if (!currentTask) {
        currentTask = {
          title: `Task ${tasks.length + 1}: ${line}`,
          steps: [line],
        };
        tasks.push(currentTask);
      } else {
        currentTask.steps.push(line);
      }
    }
  }

  if (tasks.length === 0) {
    tasks.push({
      title: `Task 1: ${ticket?.title || "Execute Ticket Implementation"}`,
      steps:
        ticket?.acceptanceCriteria && ticket.acceptanceCriteria.length > 0
          ? ticket.acceptanceCriteria
          : ["Implement required changes according to specifications"],
    });
  }

  let output = "# Task List\n\n";
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (!t) continue;
    const taskHeader = t.title.startsWith("Task ")
      ? `## ${t.title}`
      : `## Task ${i + 1}: ${t.title}`;
    output += `${taskHeader}\n`;
    if (t.steps.length === 0) {
      output += `- [ ] ${t.title}\n`;
    } else {
      for (const step of t.steps) {
        output += `- [ ] ${step}\n`;
      }
    }
    output += "\n";
  }

  return output.trim();
}

/**
 * Builds .agent/PROMPT.md injecting Matt Pocock's TDD & implementation protocols.
 */
export function buildRalphPrompt(
  ticket: Ticket,
  plan: string,
  project: Project,
): string {
  const acList =
    ticket.acceptanceCriteria && ticket.acceptanceCriteria.length > 0
      ? ticket.acceptanceCriteria.map((ac) => `- ${ac}`).join("\n")
      : "- Ensure all tests pass and implementation meets ticket description.";

  const testCmd = project.testCommand || "bun test";
  const typecheckCmd = project.typecheckCommand
    ? `- Typecheck Command: \`${project.typecheckCommand}\``
    : "";
  const lintCmd = project.lintCommand
    ? `- Lint Command: \`${project.lintCommand}\``
    : "";

  return `# Ralph Loop Task Execution Protocol (Matt Pocock TDD Protocol)

## Ticket: #${ticket.id} — ${ticket.title}
${ticket.description ? `${ticket.description}\n` : ""}
### Acceptance Criteria:
${acList}

### Verification Commands:
- Test Command: \`${testCmd}\`
${typecheckCmd}
${lintCmd}

---

## Approved Execution Plan:
${plan}

---

## Autonomous Execution Rules

You are the autonomous coding agent (Pi) executing tasks iteratively inside Ralph Loop.
Follow these rules strictly:

### 1. Test-Driven Development (TDD) Loop (Red-Green-Refactor)
For EVERY task in \`.agent/tasks.md\`:
1. **Red**: Write a failing test first that specifies the expected behavior.
   - Run the test suite using the project's test command (\`${testCmd}\`).
   - Verify that the test fails for the expected reason.
2. **Green**: Write the minimal amount of implementation code to make the test pass.
   - Do NOT add unnecessary abstractions or speculative code.
   - Run the test suite and verify that the test passes.
3. **Refactor**: Clean up the code.
   - Run typecheck and lint to ensure code quality.
   - Ensure all existing tests still pass.

### 2. One Task Per Iteration
- Open \`.agent/tasks.md\`.
- Find the first unchecked \`- [ ]\` task or step.
- Implement ONLY that task. Do not jump ahead or combine tasks.
- When all steps for that task are verified and all tests pass, update \`.agent/tasks.md\` by checking off that task: change \`- [ ]\` to \`- [x]\`.

### 3. Invariants
- Never delete or disable existing tests to make a test pass.
- All commands (test, typecheck, lint) must exit cleanly with code 0 before completing a task.
- When all tasks in \`.agent/tasks.md\` are marked \`[x]\`, conclude your work.
`;
}

export class ExecuteExecutor implements StageExecutor {
  readonly stage = "execute";
  private deps: ExecuteDependencies;

  constructor(deps: Partial<ExecuteDependencies> = {}) {
    this.deps = { ...defaultExecuteDeps, ...deps };
  }

  async execute(context: StageContext): Promise<StageResult> {
    const { run, project, signal } = context;
    const worktreePath = run.worktreePath || run.artifactsDir;

    context.eventRepo.appendEvent(run.id, "info", {
      text: "Preparing Ralph Loop workspace and artifacts…",
    });

    // 1. Ensure .agent directory exists in the worktree
    const agentDir = path.join(worktreePath, ".agent");
    await this.deps.mkdir(agentDir, { recursive: true });

    // 2. Format plan into .agent/tasks.md and write to disk
    const tasksMd = formatTasksMarkdown(run.plan || "", run.ticket);
    await this.deps.writeFile(
      path.join(agentDir, "tasks.md"),
      tasksMd,
      "utf-8",
    );

    // 3. Inject Matt Pocock's skills into .agent/PROMPT.md
    const promptMd = buildRalphPrompt(run.ticket, run.plan || "", project);
    await this.deps.writeFile(
      path.join(agentDir, "PROMPT.md"),
      promptMd,
      "utf-8",
    );

    // 4. Ensure ralph.sh script exists in worktree and is executable
    const ralphPath = path.join(worktreePath, "ralph.sh");
    try {
      await this.deps.access(ralphPath);
    } catch {
      await this.deps.writeFile(ralphPath, DEFAULT_RALPH_SCRIPT, {
        mode: 0o755,
      });
      try {
        await this.deps.chmod(ralphPath, 0o755);
      } catch {
        // Ignore chmod failures on non-POSIX filesystems
      }
    }

    const iterations = 25;
    context.eventRepo.appendEvent(run.id, "status", {
      status: "executing",
      text: `Spawning Ralph Loop (${iterations} iterations) with Pi agent…`,
    });

    context.eventRepo.appendEvent(run.id, "ralph_progress", {
      text: `Ralph Loop started with ${iterations} iterations`,
      iteration: 1,
    });

    let stdoutAccumulator = "";
    let stderrAccumulator = "";
    let timedOut = false;
    const timeoutMs = 15 * 60 * 1000; // 15 minutes execution timeout

    const allowedEnvKeys = [
      "PATH",
      "HOME",
      "USER",
      "LANG",
      "LC_ALL",
      "PI_API_KEY",
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "GEMINI_API_KEY",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "NO_PROXY",
    ];

    const sanitizedEnv: Record<string, string> = {};
    for (const key of allowedEnvKeys) {
      const val = process.env[key];
      if (val !== undefined) {
        sanitizedEnv[key] = val;
      }
    }

    try {
      const child = this.deps.spawn(
        "./ralph.sh",
        ["--agent", "pi", "-n", String(iterations)],
        {
          cwd: worktreePath,
          env: sanitizedEnv,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGTERM");
          setTimeout(() => {
            try {
              child.kill("SIGKILL");
            } catch {
              // Ignore kill errors
            }
          }, 1000);
        } catch {
          // Ignore kill errors
        }
      }, timeoutMs);

      const abortHandler = () => {
        try {
          child.kill("SIGTERM");
          setTimeout(() => {
            try {
              child.kill("SIGKILL");
            } catch {
              // Ignore kill errors
            }
          }, 1000);
        } catch {
          // Ignore kill errors
        }
      };

      if (signal) {
        signal.addEventListener("abort", abortHandler, { once: true });
      }

      child.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf-8");
        stdoutAccumulator += text;

        // Parse any Ralph progress lines
        const lines = text.split("\n");
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;
          if (
            trimmedLine.includes("Starting Ralph Loop") ||
            trimmedLine.includes("Task") ||
            trimmedLine.includes("Iteration")
          ) {
            context.eventRepo.appendEvent(run.id, "ralph_progress", {
              text: trimmedLine,
            });
          }
        }

        // Stream output as chunks
        context.eventRepo.appendEvent(run.id, "pi_output_chunk", {
          role: "ralph",
          text,
        });
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf-8");
        stderrAccumulator += text;
      });

      const exitCode = await new Promise<number>((resolve, reject) => {
        child.on("error", (err) => {
          clearTimeout(timeoutTimer);
          reject(err);
        });
        child.on("close", (code) => {
          clearTimeout(timeoutTimer);
          resolve(code ?? 0);
        });
      });

      if (signal) {
        signal.removeEventListener("abort", abortHandler);
      }

      if (timedOut) {
        return {
          status: "failed",
          error: `Ralph Loop execution timed out after ${timeoutMs}ms`,
        };
      }

      if (exitCode !== 0) {
        context.eventRepo.appendEvent(run.id, "error", {
          message: `Ralph Loop failed with exit code ${exitCode}`,
        });
        return {
          status: "failed",
          error: `Ralph Loop exited with code ${exitCode}: ${
            stderrAccumulator.trim() ||
            stdoutAccumulator.trim() ||
            "Unknown error"
          }`,
        };
      }

      // Inspect diff in the worktree
      const diff = await this.deps.getDiff(worktreePath);

      context.runRepo.update(run.id, {
        diff: diff.diff,
        expectedRevision: run.revision,
      });

      context.eventRepo.appendEvent(run.id, "stage_evidence", {
        stage: "execute",
        evidence: `Ralph Loop completed; ${diff.filesChanged.length} files modified.`,
      });

      return {
        status: "success",
        nextStage: undefined,
        nextRunStatus: "awaiting_review",
        output: {
          filesChanged: diff.filesChanged.length,
          iterations,
        },
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        status: "failed",
        error: `Ralph Loop execution failed: ${errorMsg}`,
      };
    }
  }
}
