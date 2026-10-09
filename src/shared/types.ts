// src/shared/types.ts — Shared domain types consumed by both backend and frontend.

/**
 * The 6 canonical workflow stages displayed in the UI and executed by the runtime.
 */
export type WorkflowStage =
  | "prepare"
  | "understand"
  | "plan"
  | "execute"
  | "review"
  | "deliver";

/**
 * Finite state machine states for a run.
 */
export type RunStatus =
  | "queued"
  | "preparing"
  | "understanding"
  | "awaiting_understanding_approval"
  | "planning"
  | "awaiting_plan_approval"
  | "executing"
  | "awaiting_review"
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
 * Connection roles a provider can serve on a project (#133/#131).
 */
export type ProjectConnectionRole = "tracker" | "gitHost";

/**
 * BOTH connection roles, in the order everything reports and renders them.
 *
 * THE list (#133): `ProjectConnectionRole` is the type, and this tuple is the
 * one runtime form of it — declared `satisfies` that type, so a role added to
 * one and not the other fails to compile rather than silently diverging. The
 * role-coverage rule (`REQUIRED_CONNECTION_ROLES`), the post-creation combo
 * line's render order and the wizard's Connect-step roles all read THIS, instead
 * of each writing its own pair.
 */
export const PROJECT_CONNECTION_ROLES = [
  "tracker",
  "gitHost",
] as const satisfies readonly ProjectConnectionRole[];

/**
 * One normalized provider connection on a project (#131).
 *
 * `config` is the provider's own configuration with every declared secret
 * field stripped: secret values live only in per-project env storage, keyed
 * by the provider schema's `envKey`.
 */
export interface ProjectConnection {
  providerId: string;
  roles: ProjectConnectionRole[];
  config: Record<string, unknown>;
}

/**
 * Project-level git identity used for commits and pull requests.
 * Never nested inside a connection (#131).
 */
export interface GitIdentity {
  name: string;
  email: string;
}

/**
 * Scope for git identity configuration (#161).
 */
export type GitIdentityScope = "local" | "global";

/**
 * Result of configuring git identity (#161).
 */
export interface ConfigureGitIdentityResult {
  gitIdentity: GitIdentity;
  scope: GitIdentityScope;
  path: string;
}

/**
 * Project configuration representing a software product.
 */
export interface Project {
  id: string;
  name: string;
  workspacePath?: string | undefined;
  issueTracker: ProjectIssueTracker;
  /** Normalized provider connections (#131). Additive to `issueTracker`. */
  connections?: ProjectConnection[] | undefined;
  /** Project-level git identity for authored commits. */
  gitIdentity?: GitIdentity | undefined;
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
  /** Present (true) only when the command was killed for exceeding its timeout. */
  timedOut?: boolean;
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

export interface StatusEventPayload {
  status: RunStatus;
  text?: string | undefined;
  reason?: string | undefined;
  pullRequest?: PullRequest | undefined;
}

export interface StageEvidencePayload {
  stage: WorkflowStage;
  evidence: string;
}

export type PrStepPayload =
  | {
      step: string;
      text: string;
      url?: undefined;
    }
  | {
      step: string;
      url: string;
      text?: undefined;
    };

export interface ChatUserPayload {
  text: string;
}

export interface ChatAgentPayload {
  text: string;
}

export interface UserFeedbackPayload {
  text: string;
  notes?: string | undefined;
  failingTasks?: string[] | undefined;
}

export interface PiOutputChunkPayload {
  text: string;
  role: string;
}

export interface VerificationEventPayload {
  result: VerificationResult;
}

export interface ReviewEventPayload {
  result: ReviewResult;
}

export interface RalphProgressPayload {
  text: string;
  iteration?: number | undefined;
}

export type InfoEventPayload = {
  text: string;
};

export interface ErrorEventPayload {
  message: string;
}

export interface SteerEventPayload {
  message: string;
}

export type RunEventPayloadMap = {
  status: StatusEventPayload;
  stage_evidence: StageEvidencePayload;
  pr_step: PrStepPayload;
  chat_user: ChatUserPayload;
  chat_agent: ChatAgentPayload;
  user_feedback: UserFeedbackPayload;
  pi_output_chunk: PiOutputChunkPayload;
  verification: VerificationEventPayload;
  review: ReviewEventPayload;
  ralph_progress: RalphProgressPayload;
  // TODO(#167): remove with steering
  steer: SteerEventPayload;
  info: InfoEventPayload;
  error: ErrorEventPayload;
};

export type RunEventType = keyof RunEventPayloadMap;

/**
 * Discriminated union of run event types and payloads matching what the server emits.
 */
export type RunEventPayload<T extends RunEventType = RunEventType> =
  T extends RunEventType
    ? {
        type: T;
        payload: RunEventPayloadMap[T];
      }
    : never;

/**
 * Discriminated union of SSE events emitted to connected clients.
 */
export type RunEvent<T extends RunEventType = RunEventType> =
  T extends RunEventType
    ? {
        id: number;
        timestamp: string;
        type: T;
        payload: RunEventPayloadMap[T];
      }
    : never;

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
