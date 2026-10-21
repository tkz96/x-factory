// src/shared/types.ts — Shared domain types consumed by both backend and frontend.

import type { DiffSummary } from "./diff-summary.js";
import type { FailureReason } from "./failure-reason.js";

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
  project?: string | undefined;
  requiredLabel?: string | undefined;
}

export interface GitHubTrackerConfig {
  repo?: string | undefined;
  repoOwner?: string | undefined;
  repository?: string | undefined;
  baseUrl?: string | undefined;
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
  /**
   * The ticket's own labels, as the tracker reported them (`TrackerTicket`
   * carries them; a provider that does not map labels simply omits the field).
   * The Tickets list renders them as tags.
   */
  labels?: string[] | undefined;
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
  /**
   * Present (true) only when the command was never run — the project sets no
   * test command. A skipped command did not pass (`passed` is false), and it
   * does not fail verification either.
   */
  skipped?: boolean;
  /** Why a skipped command was not run, in plain words. */
  skipReason?: string;
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
 * One acceptance criterion as the Reviewer assessed it. `not_assessed` means the
 * Reviewer never judged the criterion; it is never recorded as a pass, and any
 * not-assessed criterion fails the review.
 */
export type ReviewCriterionStatus = "pass" | "fail" | "not_assessed";

export interface ReviewCriterionResult {
  criterion: string;
  status: ReviewCriterionStatus;
  notes?: string | undefined;
}

/**
 * Review result produced by evaluating against acceptance criteria.
 */
export interface ReviewResult {
  passed: boolean;
  findings: Finding[];
  criteriaChecked: ReviewCriterionResult[];
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
  category?: string | undefined;
  /** Present on a `failed` status: why it failed and what to do about it (#256). */
  failure?: FailureReason | undefined;
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
  /** The model that wrote the reply, when one did (#279). */
  model?: ModelUse | undefined;
  usage?: ModelUsage | undefined;
}

/** Which model did some work: a role's model on a connection, as it was then (#279). */
export interface ModelUse {
  role: ModelRoleName;
  connectionId: string;
  connectionName: string;
  apiType: string;
  modelId: string;
}

/** Tokens and cost a provider reported for some work (#279). */
export interface ModelUsage {
  tokensIn?: number | undefined;
  tokensOut?: number | undefined;
  /** USD, from the provider's report or the model's prices. */
  costUsd?: number | undefined;
}

/** One model step of a stage attempt, with its usage, as recorded when it ran (#279). */
export interface StageModelUse extends ModelUse, ModelUsage {
  stage: string;
  /**
   * The work this model did: the stage itself, or "review" for the review the
   * execute stage runs after coding.
   */
  step: string;
  attempt: number;
  startedAt: string;
}

/** A model step of a stage attempt started (#279). */
export interface StageStartedPayload {
  stage: string;
  /** The step within the stage; absent on events recorded before steps existed. */
  step?: string | undefined;
  attempt: number;
  model: ModelUse;
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
  /** 1-based loop iteration this line belongs to; every progress event carries one (#256). */
  iteration: number;
}

export type InfoEventPayload = {
  text: string;
  /** Set when the line is a warning the run page must show as one (#275). */
  warning?: "unsandboxed" | undefined;
};

export interface ErrorEventPayload {
  message: string;
}

/** The plan a stage produced, streamed as it lands rather than only at the gate (#256). */
export interface PlanReadyPayload {
  plan: string;
}

/** What changed in one run's diff (#256), parsed by the module the run page also reads. */
export type DiffSummaryPayload = DiffSummary;

/** Activity from the read-only review session, forwarded instead of dropped (#256). */
export interface ReviewActivityPayload {
  /** The tool the reviewer ran, when the activity is a tool call. */
  tool?: string | undefined;
  text?: string | undefined;
}

export interface PrMergedPayload {
  url: string;
  mergedAt: string;
  mergedBy?: string | undefined;
}

export interface PrClosedPayload {
  url: string;
  closedAt: string;
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
  plan_ready: PlanReadyPayload;
  diff_summary: DiffSummaryPayload;
  review_activity: ReviewActivityPayload;
  info: InfoEventPayload;
  error: ErrorEventPayload;
  stage_started: StageStartedPayload;
  pr_merged: PrMergedPayload;
  pr_closed: PrClosedPayload;
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
 * App-wide event stream envelope (#257, spec #241).
 * Carries the global run-events ID as its envelope ID and SSE `id:`,
 * plus run ID, per-run sequence, type, payload, creation time, ticket and project.
 */
export interface AppEventEnvelope<T extends RunEventType = RunEventType> {
  id: number;
  runId: string;
  sequence: number;
  type: T;
  payload: RunEventPayloadMap[T];
  time: string;
  ticket: Ticket;
  project: Pick<Project, "id" | "name">;
}

/**
 * App-wide events snapshot (#257, spec #241).
 * Consistent read of current run statuses, Needs-you trigger events (no age limit),
 * and Finished history (7 days, max 100) with cursor inside one SQLite read transaction.
 */
export interface EventsSnapshot {
  cursor: number;
  runs: Run[];
  needsYou: AppEventEnvelope[];
  finished: AppEventEnvelope[];
}

/**
 * Pull request outcome recorded when a PR is merged or closed.
 */
export interface PullRequestOutcome {
  status: "merged" | "closed";
  state?: "merged" | "closed" | undefined;
  url: string;
  mergedAt?: string | undefined;
  mergedBy?: string | undefined;
  closedAt?: string | undefined;
}

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
  updatedAt: string;
  implementationContext: ImplementationContext | null;
  verification: VerificationResult | null;
  review: ReviewResult | null;
  artifacts: Artifact[];
  diff: string | null;
  pullRequest: PullRequest | null;
  /** PR outcome when known (merged or closed without merging) (#271). */
  pullRequestOutcome?: PullRequestOutcome | undefined;
  repairAttempts: number;
  artifactsDir: string;
  worktreePath: string;
  /** Which model each stage attempt used, oldest first (#279). */
  stageModels?: StageModelUse[] | undefined;
  /**
   * True while the run's job is waiting for a worker: no worker holds it (it is pending, or
   * its lease has run out). Set on the run read only; a stage label must not claim work is
   * under way while this is true.
   */
  waitingForWorker?: boolean | undefined;
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

// ─── HTTP wire contract (#182) ─────────────────────────────────────────────
// Request and response types for a route are declared ONCE, here. The
// controller that serves the route and the API client that calls it are both
// annotated against these types, so changing a response shape on either side
// fails the typecheck. The route table (#192) consumes them later.

export type ThemeName = "default" | "graphite" | "sandstone";
export type AppearanceSetting = "automatic" | "auto" | "light" | "dark";
export type ResolvedAppearance = "light" | "dark";
export type ContrastSetting = "standard" | "more";

/**
 * Workbench settings shape — the body of `GET /api/settings`, the response of
 * `POST /api/settings`, and the on-disk `settings.json` contract.
 */
export interface WorkbenchSettings {
  /** Visual theme (#248, #249): Default, Graphite, Sandstone. */
  theme?: ThemeName | "dark" | "light" | undefined;
  /** Appearance (#248): Automatic (follows OS), Light, Dark. */
  appearance?: AppearanceSetting | undefined;

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
  allowUnsandboxed?: boolean | undefined;
  /** Desktop notifications for runs that need you (#265). Off by default. */
  desktopNotifications?: boolean | undefined;
  /** Which model each role uses (#278); replaces models.sessionA/sessionB. */
  roles?: ModelRoles | undefined;
}

/** A role's model: a model ID on a model connection (#278). */
export interface RoleAssignment {
  connectionId: string;
  modelId: string;
}

/** Builder: understand, plan, code, chat. Reviewer: review (#278). */
export interface ModelRoles {
  builder?: RoleAssignment | undefined;
  reviewer?: RoleAssignment | undefined;
}

export type ModelRoleName = keyof ModelRoles;

/** Request body of `POST /api/settings`: a patch merged into stored settings. */
/** Request body of `POST /api/settings`: a patch merged into stored settings; a role set to `null` is cleared (#278). */
export type SettingsUpdateRequest = Partial<
  Omit<WorkbenchSettings, "roles">
> & {
  roles?: { [K in keyof ModelRoles]?: ModelRoles[K] | null } | undefined;
};

/** One named check inside a readiness response. */
export interface ReadinessCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

/** Response body of `GET /api/ready` (503 when unavailable) and `GET /api/readiness`. */
export interface ReadinessResponse {
  ready?: boolean | undefined;
  status: "ready" | "unavailable";
  database: {
    status: "ready" | "unavailable";
    version?: number | undefined;
    journalMode?: string | undefined;
    error?: string | undefined;
  };
  worker: {
    status: "ready" | "unavailable";
    activeWorkers: number;
    reason?: string | undefined;
  };
  checks?: ReadinessCheck[] | undefined;
  timestamp: string;
}

/** Response body of `GET /api/diagnostics`. */
export interface DiagnosticsResponse {
  status: string;
  system: {
    uptime: number;
    nodeVersion: string;
    memory: Record<string, number>;
  };
  database: {
    status: string;
    version: number;
    runs: { total: number; active: number };
    jobs: {
      total: number;
      pending: number;
      claimed: number;
      completed: number;
      failed: number;
      stale: number;
    };
  };
  worker: {
    status: string;
    activeCount: number;
    fleet: Array<{ workerId: string; lastHeartbeatAt: string; ageMs: number }>;
  };
  timestamp: string;
}

/**
 * The envelope the run-mutation routes share (#182): `ok` reports success and
 * `run` is the run the operation changed, written straight into the query
 * cache. Resume, abandon, transitions and stop all answer with it, so it is
 * named once here rather than re-declared per route.
 */
export interface RunOkResponse {
  ok: boolean;
  run: Run;
}

/** Request body of `POST /api/runs`: what the operator filled into the New Run form. */
export interface CreateRunRequest {
  projectId: string;
  ticketId?: string | undefined;
  ticketTitle?: string | undefined;
  plan?: string | undefined;
  /** The wire accepts the criteria as a pre-split array or one newline string. */
  acceptanceCriteria?: string[] | string | undefined;
  description?: string | undefined;
  branch?: string | undefined;
}

/** Response body of `POST /api/runs` (201): the created run. */
export type CreateRunResponse = Run;

/** `POST /api/runs/:id/resume` carries no request body. */
export type ResumeRunRequest = Record<string, never>;

/** Response body of `POST /api/runs/:id/resume`. */
export type ResumeRunResponse = RunOkResponse;

/**
 * Request body of `POST /api/runs/:id/abandon`: an optional reason the server
 * records on the run's status event and the cancelled job text. The reason is
 * trimmed and must be at most 500 characters with no control characters
 * (CR and LF included); a longer or control-character reason is a 400. A
 * bodyless POST from an older client is still accepted.
 */
export interface AbandonRunRequest {
  reason?: string | undefined;
}

/** Response body of `POST /api/runs/:id/abandon`. */
export type AbandonRunResponse = RunOkResponse;

/** Request body of `POST /api/runs/:id/chat`. */
export interface ChatWithRunRequest {
  message: string;
}

/**
 * Response body of `POST /api/runs/:id/chat`. `ok: true` carries the agent's reply (stored as a chat_agent event).
 * `ok: false` carries the plain reason the model could not reply (stored as an error event, never an agent message, #263).
 */
export interface ChatWithRunResponse {
  ok: boolean;
  message: string;
}

/** The operator actions the transition route accepts. */
export type RunTransitionAction = "approve" | "restart" | "abort" | "requeue";

/** Request body of `POST /api/runs/:id/transitions`. */
export interface TransitionRunRequest {
  action: RunTransitionAction;
  payload?: Record<string, unknown> | undefined;
}

/** Response body of `POST /api/runs/:id/transitions`. */
export type TransitionRunResponse = RunOkResponse;

/**
 * Response body of `POST /api/runs/:id/stop` (#182): the stop command returns
 * the run it stopped, so the caller can write it straight into the query
 * cache instead of refetching.
 */
export type StopRunResponse = RunOkResponse;

/** `POST /api/runs/:id/pr` carries no request body. */
export type PrRunRequest = Record<string, never>;

/**
 * Response body of `POST /api/runs/:id/pr`: `queued` while delivery is
 * pending, `completed` with the pull request once it exists.
 */
export interface PrRunResponse {
  ok: boolean;
  queued?: boolean | undefined;
  completed?: boolean | undefined;
  prUrl?: string | undefined;
  pullRequest?: PullRequest | undefined;
}

/** One document entry in the in-app docs catalog. */
export interface DocItem {
  slug: string;
  title: string;
  description: string;
  path: string;
}

/** One Diátaxis docs category (tutorials, how-to, reference, …). */
export interface DocCategory {
  id: string;
  name: string;
  description: string;
  docs: DocItem[];
}

/** Response body of `GET /api/docs`. */
export interface DocsCatalogResponse {
  categories: DocCategory[];
}

/** One matched heading inside a docs search result. */
export interface DocSearchMatch {
  heading: string;
  headingId: string;
  snippet: string;
  matchCount: number;
}

/** One matched document in a docs search response. */
export interface DocSearchResult {
  category: string;
  categoryName: string;
  slug: string;
  title: string;
  totalMatches: number;
  sections: DocSearchMatch[];
}

/** Response body of `GET /api/docs/search?q=…`. */
export interface DocsSearchResponse {
  query: string;
  totalMatches: number;
  results: DocSearchResult[];
}

/** Response body of `GET /api/docs/:category/:slug`. */
export interface DocDetailResponse {
  category: string;
  slug: string;
  title: string;
  description: string;
  markdown: string;
}
