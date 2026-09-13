// src/types.ts — Core domain models and workflow types for X-Factory.

/**
 * The 6 canonical workflow stages displayed in the UI and executed by the runtime.
 */
export type WorkflowStage =
  | "prepare"
  | "understand"
  | "implement"
  | "verify"
  | "review"
  | "deliver";

/**
 * Finite state machine states for a run.
 */
export type RunStatus =
  | "preparing"
  | "understanding"
  | "implementing"
  | "verifying"
  | "reviewing"
  | "ready_for_pr"
  | "pr_created"
  | "failed"
  | "stopped";

/**
 * Project configuration loaded from config/projects.json.
 */
export interface Project {
  id: string;
  name: string;
  repositoryPath: string;
  knowledgeRepositoryPath?: string;
  defaultBranch: string;
  testCommand: string;
  typecheckCommand?: string;
  lintCommand?: string;
  commandTimeoutMs?: number;
}

/**
 * Ticket representation.
 */
export interface Ticket {
  id: string;
  title: string;
  description?: string;
  acceptanceCriteria: string[];
}

/**
 * Structured implementation context produced by the "understand" stage.
 */
export interface ImplementationContext {
  relevantFiles: string[];
  architecturalNotes: string;
  existingBehavior: string;
  constraints: string[];
  risks: string[];
}

/**
 * Result of executing an external command (tests, typecheck, lint, git, gh).
 */
export interface CommandResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  passed: boolean;
  durationMs: number;
}

/**
 * Deterministic verification result combining all checks and diff.
 */
export interface VerificationResult {
  passed: boolean;
  repairAttempt: number;
  tests: CommandResult;
  typecheck?: CommandResult;
  lint?: CommandResult;
  diff: string;
  filesChanged: string[];
  hasPollution: boolean;
  pollutionDetails?: string[];
  summary: string;
}

/**
 * Structured review finding produced by the read-only review session.
 */
export interface Finding {
  severity: "info" | "warning" | "error";
  message: string;
  file?: string;
  line?: number;
}

/**
 * Review result produced by evaluating against acceptance criteria.
 */
export interface ReviewResult {
  passed: boolean;
  findings: Finding[];
  criteriaChecked: Array<{
    criterion: string;
    satisfied: boolean;
    notes?: string;
  }>;
  summary: string;
}

/**
 * Generic artifact descriptor.
 */
export interface Artifact {
  id: string;
  type:
    | "implementation_context"
    | "diff"
    | "test_output"
    | "verification"
    | "review"
    | "plan";
  path?: string;
  content?: string;
  data?: Record<string, unknown>;
  createdAt: string;
}

/**
 * Pull request metadata after successful delivery.
 */
export interface PullRequest {
  url: string;
  branch: string;
  baseBranch: string;
  title: string;
}

/**
 * Run event payloads without timestamp.
 */
export type RunEventPayload =
  | { type: "status"; status: RunStatus; text: string }
  | { type: "stage_evidence"; stage: WorkflowStage; summary: string }
  | { type: "info"; text: string }
  | { type: "error"; text: string }
  | { type: "pi_text"; text: string; role: "implementer" | "reviewer" }
  | { type: "pi_tool"; tool: string; input?: string; role: "implementer" | "reviewer" }
  | { type: "pi_done"; role: "implementer" | "reviewer" }
  | { type: "pi_error"; error: string; role: "implementer" | "reviewer" }
  | { type: "steer"; text: string }
  | { type: "verification"; result: VerificationResult }
  | { type: "review"; result: ReviewResult }
  | { type: "pr_step"; text: string };

/**
 * Discriminated union of SSE events emitted to connected clients.
 */
export type RunEvent = RunEventPayload & { timestamp: number };

/**
 * Public run shape exposed via API.
 */
export interface Run {
  id: string;
  project: Pick<Project, "id" | "name">;
  ticket: Ticket;
  plan: string;
  branch: string;
  status: RunStatus;
  events: RunEvent[];
  startedAt: string;
  finishedAt: string | null;
  implementationContext: ImplementationContext | null;
  verification: VerificationResult | null;
  review: ReviewResult | null;
  artifacts: Artifact[];
  diff: string | null;
  pullRequest: PullRequest | null;
  repairAttempts: number;
  artifactsDir: string;
  worktreePath: string;
}
