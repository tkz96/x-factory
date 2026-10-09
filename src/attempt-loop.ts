// src/attempt-loop.ts — The attempt loop: scaffold the worktree, run X-Factory's own loop script, verify against the recorded baseline, and repair within one bounded budget.

import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execCommand, resolveSanitizedEnv } from "./proc.js";
import { buildRalphPrompt, buildRepairPrompt } from "./prompts.js";
import type {
  ImplementationContext,
  Project,
  Ticket,
  VerificationResult,
} from "./shared/types.js";
import { MAX_REPAIR_ATTEMPTS, runVerification } from "./verification.js";
import type { BaselineState } from "./worktree-state.js";

const LOOP_TIMEOUT_MS = 15 * 60 * 1000;
const FIRST_ATTEMPT_ITERATIONS = 25;
const REPAIR_ATTEMPT_ITERATIONS = 10;

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

if ! command -v sbx &>/dev/null; then
  echo "Error: Sandbox execution environment (sbx) is required but not found." >&2
  exit 1
fi

for (( i=1; i<=ITERATIONS; i++ )); do
  echo "Iteration $i of $ITERATIONS"

  sbx run --name "ralph-\${AGENT}-\${RANDOM}" "\${AGENT}" .

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

/** The repair checklist: a fresh unchecked task so the loop script runs the agent again. */
function formatRepairTasksMarkdown(attempt: number): string {
  return `# Task List

## Task 1: Repair attempt ${attempt}
- [ ] Fix the verification failures described in .agent/PROMPT.md
`;
}

export interface AttemptLoopInput {
  worktreePath: string;
  /** The run's artifacts directory; X-Factory's loop script is written here, never into the worktree. */
  artifactsDir: string;
  ticket: Ticket;
  plan: string;
  project: Project;
  /** What the understand stage learned; rendered into the loop and repair prompts. */
  understanding?: ImplementationContext | null | undefined;
  baseline: BaselineState;
  /** Provider of the implementation session (session A); its credentials reach the loop. */
  provider: string;
  signal?: AbortSignal | undefined;
  /** Loop timeout per attempt; defaults to 15 minutes. */
  timeoutMs?: number | undefined;
  emit: (type: string, payload: unknown) => void;
  /** Called after every verification, so the caller can persist the diff and result. */
  onVerification: (verification: VerificationResult) => void;
}

export type AttemptLoopResult =
  | { outcome: "verified"; verification: VerificationResult }
  | { outcome: "aborted" }
  | { outcome: "failed"; error: string };

async function scaffold(input: AttemptLoopInput): Promise<string> {
  const agentDir = path.join(input.worktreePath, ".agent");
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    path.join(agentDir, "tasks.md"),
    formatTasksMarkdown(input.plan, input.ticket),
    "utf-8",
  );
  await writeFile(
    path.join(agentDir, "PROMPT.md"),
    buildRalphPrompt(
      input.ticket,
      input.plan,
      input.project,
      input.understanding,
    ),
    "utf-8",
  );

  // Always X-Factory's own script, kept outside the worktree so a repository's ralph.sh is neither run nor overwritten.
  await mkdir(input.artifactsDir, { recursive: true });
  const scriptPath = path.join(input.artifactsDir, "ralph.sh");
  await writeFile(scriptPath, DEFAULT_RALPH_SCRIPT, { mode: 0o755 });
  await chmod(scriptPath, 0o755).catch(() => {
    // Ignore chmod failures on non-POSIX filesystems
  });
  return scriptPath;
}

/** Forwards whole stdout lines that mark loop progress. */
function progressLineForwarder(onLine: (line: string) => void) {
  let pending = "";
  return (chunk: string) => {
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (
        trimmed.includes("Starting Ralph Loop") ||
        trimmed.includes("Task") ||
        trimmed.includes("Iteration")
      ) {
        onLine(trimmed);
      }
    }
  };
}

/**
 * Runs the implementation loop and verifies it, repairing until verification passes or the single attempt cap
 * (`MAX_REPAIR_ATTEMPTS`) is spent. A stop signal ends the loop before any new attempt starts.
 */
export async function runAttemptLoop(
  input: AttemptLoopInput,
): Promise<AttemptLoopResult> {
  const { signal, emit } = input;
  const scriptPath = await scaffold(input);
  const agentDir = path.join(input.worktreePath, ".agent");
  const env = resolveSanitizedEnv(input.provider);
  const timeoutMs = input.timeoutMs ?? LOOP_TIMEOUT_MS;

  let verification: VerificationResult | null = null;

  for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    if (signal?.aborted) return { outcome: "aborted" };

    const iterations =
      attempt === 1 ? FIRST_ATTEMPT_ITERATIONS : REPAIR_ATTEMPT_ITERATIONS;
    if (attempt > 1) {
      emit("info", {
        text: `Starting repair attempt ${attempt} of ${MAX_REPAIR_ATTEMPTS}…`,
      });
    }
    const label = attempt === 1 ? "Ralph Loop" : "Repair Loop";
    emit("status", {
      status: "executing",
      text:
        attempt === 1
          ? `Spawning ${label} (${iterations} iterations) with Pi agent…`
          : `Spawning ${label} (${iterations} iterations)…`,
    });
    emit("ralph_progress", {
      text: `${label} started with ${iterations} iterations`,
      iteration: 1,
    });

    const forward = progressLineForwarder((line) =>
      emit("ralph_progress", { text: line }),
    );
    const loop = await execCommand(
      "bash",
      [scriptPath, "--agent", "pi", "-n", String(iterations)],
      {
        cwd: input.worktreePath,
        env,
        envPolicy: "sanitized",
        timeoutMs,
        signal,
        onOutputChunk: (chunk, stream) => {
          if (stream !== "stdout") return;
          forward(chunk);
          emit("pi_output_chunk", { role: "ralph", text: chunk });
        },
      },
    );

    if (signal?.aborted) return { outcome: "aborted" };
    if (loop.timedOut) {
      return {
        outcome: "failed",
        error: `Ralph Loop execution timed out after ${timeoutMs}ms`,
      };
    }
    if (loop.exitCode !== 0) {
      emit("error", {
        message: `Ralph Loop failed with exit code ${loop.exitCode}`,
      });
      return {
        outcome: "failed",
        error: `Ralph Loop exited with code ${loop.exitCode}: ${loop.stderr || loop.stdout || "Unknown error"}`,
      };
    }

    emit("info", {
      text: `Running deterministic verification (attempt ${attempt})…`,
    });
    verification = await runVerification(
      input.worktreePath,
      input.project,
      input.baseline,
      attempt,
      signal ? { signal } : undefined,
    );
    // An aborted verification comes back as a failure; it must never start a repair.
    if (signal?.aborted) return { outcome: "aborted" };

    input.onVerification(verification);
    if (verification.passed) return { outcome: "verified", verification };

    if (attempt < MAX_REPAIR_ATTEMPTS) {
      await writeFile(
        path.join(agentDir, "PROMPT.md"),
        buildRepairPrompt(
          input.ticket,
          input.plan,
          verification,
          attempt,
          input.understanding,
        ),
        "utf-8",
      );
      await writeFile(
        path.join(agentDir, "tasks.md"),
        formatRepairTasksMarkdown(attempt + 1),
        "utf-8",
      );
    }
  }

  emit("error", {
    message: `Deterministic verification failed after ${MAX_REPAIR_ATTEMPTS} attempts.`,
  });
  return {
    outcome: "failed",
    error: `Execution failed: Verification did not pass after bounded repairs. Summary: ${verification?.summary}`,
  };
}
