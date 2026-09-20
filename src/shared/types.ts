// src/shared/types.ts — Shared domain types consumed by both backend and frontend.

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
  | "queued"
  | "preparing"
  | "understanding"
  | "implementing"
  | "verifying"
  | "reviewing"
  | "ready_for_pr"
  | "pr_created"
  | "failed"
  | "stopped"
  | "recovery_required";

/**
 * Role metadata for a repository inside a project.
 */
export type RepositoryRole =
  | "frontend"
  | "backend"
  | "service"
  | "worker"
  | "mobile"
  | "infrastructure"
  | "documentation"
  | "knowledge"
  | "other";

/**
 * Repository-specific build and test verification commands.
 */
export interface RepositoryCommands {
  test?: string | undefined;
  typecheck?: string | undefined;
  lint?: string | undefined;
  build?: string | undefined;
}

/**
 * Individual codebase repository configuration.
 */
export interface ProjectRepository {
  id: string;
  name: string;
  remote?: string | undefined;
  path: string;
  defaultBranch: string;
  role?: RepositoryRole | undefined;
  commands?: RepositoryCommands | undefined;
}

/**
 * First-class knowledge repository configuration.
 */
export interface KnowledgeRepository {
  repositoryId: string;
  path: string;
  type: "graphify";
}

export type IssueTrackerProvider = "azure" | "jira" | "github";

export interface AzureTrackerConfig {
  orgUrl: string;
  project: string;
  requiredLabel?: string | undefined;
}

export interface JiraTrackerConfig {
  host: string;
  email: string;
  project: string;
  requiredLabel?: string | undefined;
}

export interface GitHubTrackerConfig {
  repo: string;
  requiredLabel?: string | undefined;
}

/**
 * Issue tracker association for a project.
 */
export interface ProjectIssueTracker {
  provider: IssueTrackerProvider;
  azure?: AzureTrackerConfig | undefined;
  jira?: JiraTrackerConfig | undefined;
  github?: GitHubTrackerConfig | undefined;
  /** @deprecated For backwards compatibility during migration */
  connectionId?: string | undefined;
  /** @deprecated For backwards compatibility during migration */
  projectId?: string | undefined;
}

/**
 * Readiness and health status of an individual repository.
 */
export interface RepositoryReadiness {
  repositoryId: string;
  isGitRepo: boolean;
  remoteMatches: boolean;
  branchDetected: boolean;
  commandsDetected: boolean;
  existsLocally: boolean;
  status: "ready" | "pending_setup" | "error";
  message?: string | undefined;
}

/**
 * Overall readiness assessment for a project.
 */
export interface ProjectReadiness {
  projectId: string;
  ready: boolean;
  readyCount: number;
  totalCount: number;
  repositories: RepositoryReadiness[];
  knowledgeReady?: boolean | undefined;
  issues: string[];
}

/**
 * Project configuration representing a software product.
 */
export interface Project {
  id: string;
  name: string;
  workspacePath?: string | undefined;
  issueTracker: ProjectIssueTracker;
  repositories: ProjectRepository[];
  knowledgeRepository?: KnowledgeRepository | undefined;
  commandTimeoutMs?: number | undefined;

  archived?: boolean | undefined;
  archivedAt?: string | undefined;
  successorId?: string | undefined; // ID of the migrated project
  predecessorId?: string | undefined; // ID of the project this was migrated from

  // Backwards-compatibility fields for single-repository operations
  repositoryPath: string;
  defaultBranch: string;
  testCommand: string;
  typecheckCommand?: string | undefined;
  lintCommand?: string | undefined;
  knowledgeRepositoryPath?: string | undefined;
}

/**
 * Ticket representation.
 */
export interface Ticket {
  id: string;
  title: string;
  description?: string | undefined;
  acceptanceCriteria: string[];
  provider?: string | undefined;
  url?: string | undefined;
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
  typecheck?: CommandResult | undefined;
  lint?: CommandResult | undefined;
  diff: string;
  filesChanged: string[];
  hasPollution: boolean;
  pollutionDetails?: string[] | undefined;
  summary: string;
}

/**
 * Structured review finding produced by the read-only review session.
 */
export interface Finding {
  severity: "info" | "warning" | "error";
  message: string;
  file?: string | undefined;
  line?: number | undefined;
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
    notes?: string | undefined;
  }>;
  summary: string;
}

/**
 * Generic artifact descriptor.
 */
interface Artifact {
  id: string;
  type:
    | "implementation_context"
    | "diff"
    | "test_output"
    | "verification"
    | "review"
    | "plan";
  path?: string | undefined;
  content?: string | undefined;
  data?: Record<string, unknown> | undefined;
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
  | {
      type: "pi_tool";
      tool: string;
      input?: string | undefined;
      role: "implementer" | "reviewer";
    }
  | { type: "pi_done"; role: "implementer" | "reviewer" }
  | { type: "pi_error"; error: string; role: "implementer" | "reviewer" }
  | { type: "steer"; text: string }
  | { type: "verification"; result: VerificationResult }
  | { type: "review"; result: ReviewResult }
  | { type: "pr_step"; text: string }
  | { type: "server_shutdown"; text: string };

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

/**
 * Discovered repository metadata.
 */
export interface DiscoveredRepo {
  id?: string | undefined;
  name: string;
  remote?: string | undefined;
  defaultBranch?: string | undefined;
  webUrl?: string | undefined;
  role?: RepositoryRole | undefined;
  isPrimary?: boolean | undefined;
}

/**
 * Azure DevOps connection test response shape.
 */
export interface AzureConnectionResult {
  ok: boolean;
  error?: string | undefined;
  authType?: string | undefined;
  repositories?: string[] | undefined;
}

/**
 * Workbench settings shape.
 */
export interface WorkbenchSettings {
  theme?: string | undefined;
  models?:
    | {
        sessionA?:
          | { provider?: string | undefined; model?: string | undefined }
          | undefined;
        sessionB?:
          | { provider?: string | undefined; model?: string | undefined }
          | undefined;
      }
    | undefined;
}
