// src/frontend/components/feedback/copy-map.ts — THE canonical copy map (#135).
//
// Decided in #135 (spec #133, resolution #129): this module is the ONLY place
// canonical feedback copy lives. It carries the (code, context) → message map
// for the normalized error envelope, the five-state guidance strings, and the
// retry/refresh/countdown labels. Feedback components must not declare copy
// inline; screens override copy only through props when a region needs
// bespoke guidance. Localization stays possible because every string lives
// here (spec #133 §Out of scope).
//
// Unknown error payloads NEVER render their raw message — anything that is
// not a normalized envelope gets `STATE_COPY.errorFallback` (spec #133:
// "never a raw provider body").

import type {
  FeedbackErrorCode,
  FeedbackErrorContext,
  NormalizedError,
} from "./types.js";

type GitIdentityScope = import("../../../shared/types.js").GitIdentityScope;

/**
 * The (code, context) → message map. Codes and contexts mirror the provider
 * contract's closed sets (#129); context names the failed operation so the
 * message can say what broke without provider-specific terminology.
 */
export const ERROR_COPY: Readonly<
  Record<FeedbackErrorCode, Readonly<Record<FeedbackErrorContext, string>>>
> = {
  AUTH_INVALID: {
    VERIFY: "The credentials were rejected. Check the token and try again.",
    DISCOVERY:
      "The credentials were rejected while discovering repositories. Check the token and try again.",
    TICKETS:
      "The credentials were rejected while loading tickets. Check the token and try again.",
    PR: "The credentials were rejected while creating the pull request. Check the token and try again.",
  },
  AUTH_LOCKED: {
    VERIFY:
      "Sign-in is temporarily locked by the provider. Wait a moment, then try again.",
    DISCOVERY:
      "Sign-in is temporarily locked, so repositories could not load. Wait a moment, then try again.",
    TICKETS:
      "Sign-in is temporarily locked, so tickets could not load. Wait a moment, then try again.",
    PR: "Sign-in is temporarily locked, so the pull request could not be created. Wait a moment, then try again.",
  },
  NOT_FOUND: {
    VERIFY:
      "The account or workspace is not visible to this token. Check the address and token.",
    DISCOVERY:
      "The organization, project, or workspace could not be found. Check the URL.",
    TICKETS:
      "The tickets source could not be found. Check the project and repository addresses.",
    PR: "The pull request target could not be found. Check the repository and branches.",
  },
  RATE_LIMITED: {
    VERIFY:
      "The provider is limiting requests, so the connection check failed. Wait a moment, then try again.",
    DISCOVERY:
      "The provider is limiting requests, so repositories could not load. Wait a moment, then try again.",
    TICKETS:
      "The provider is limiting requests, so tickets could not load. Wait a moment, then try again.",
    PR: "The provider is limiting requests, so the pull request could not be created. Wait a moment, then try again.",
  },
  PERMISSION: {
    VERIFY:
      "The token does not have the permissions required to verify this connection.",
    DISCOVERY:
      "The token does not have the permissions required to discover repositories.",
    TICKETS:
      "The token does not have the permissions required to load tickets.",
    PR: "The token does not have the permissions required to create the pull request.",
  },
  UNKNOWN: {
    VERIFY:
      "An unexpected error occurred while verifying the connection. Try again.",
    DISCOVERY:
      "An unexpected error occurred while discovering repositories. Try again.",
    TICKETS: "An unexpected error occurred while loading tickets. Try again.",
    PR: "An unexpected error occurred while creating the pull request. Try again.",
  },
};

/** Canonical copy for the five-state taxonomy and the uniform actions. */
export const STATE_COPY = {
  /** Loading: rendered beside the indeterminate spinner in its reserved region. */
  loading: "Loading…",
  /** Empty: guidance text, overridable per region via props. */
  empty: "Nothing here yet.",
  /** Partial: banner title naming that some results failed. */
  partial: "Some results could not load.",
  /** Stale: the visible out-of-date badge (#132). */
  stale: "Out of date",
  /** The uniform retry affordance label. */
  retry: "Try again",
  /** The stale-region refresh label. */
  refresh: "Refresh",
  /** Fallback for any error that is not a normalized envelope. */
  errorFallback: "The request failed. Try again.",
} as const;

/**
 * Repositories step copy (#144). Feedback strings CANNOT be inlined in the
 * step: the partial banner names the capability in contract terms, the empty
 * state gives guidance, and the stale state explains that a connection change
 * invalidated the selection.
 */
export const REPOSITORIES_COPY = {
  title: "Select Repositories",
  subtitle:
    "Repositories discovered from your Git Host connection. Choose at least one application repository to work in.",
  /** Empty: guidance when the connection lists zero repositories (story 29). */
  empty:
    "No repositories were found for this connection. Check that your token can see them, then refresh.",
  /** Partial: the capability that could not be confirmed, in contract terms. */
  discoveryUnconfirmed: "Repository discovery could not be confirmed.",
  /** Stale: the selection belongs to a connection that has since changed. */
  staleSelection:
    "The Git Host connection changed after these repositories were listed, so this selection is out of date.",
  /**
   * Stale results: rows listed for a connection that is no longer current stay
   * visible as placeholder content, but they cannot be selected — their ids
   * belong to the previous configuration.
   */
  staleResults:
    "These repositories were listed for the previous connection, so they cannot be selected. Refresh to load the current list.",
  /** Stale: the action that clears the out-of-date selection. */
  staleSelectionAction: "Start the selection again",
  /** Row label for a repository listed under the git-host role. */
  applicationRoleLabel: "Application repository",
  /** Row label for a repository listed only in another role. */
  noApplicationRoleLabel: "Not usable as an application repository",
  /** Live count of the current selection. */
  selectionSummary: (count: number) =>
    count === 1 ? "1 repository selected" : `${count} repositories selected`,
  /** Header control for bulk selection (#160). */
  selectAllLabel: "Select all",
  /** Live "N of M selected" count shown in the list header (#160). */
  selectedOfTotal: (selected: number, total: number) =>
    `${selected} of ${total} selected`,
  /** Inline reason shown beside Continue while the step is gated (#160). */
  needsApplicationRepository:
    "Select at least one application repository to continue.",
  /** Brief helper text explaining repository requirements (#160). */
  requirementsHelp:
    "An application repository is the primary codebase where workflows run. Select at least one to continue.",
  previous: "Back",
  next: "Continue to Inspection",
} as const;

/**
 * Connection surfacing — THE one vocabulary for the combo line (#146/#147),
 * shared by every surface that reports how a project is wired: the wizard's
 * Review step (draft verification evidence) and the post-creation surfaces
 * (persisted connections). One line, one rendering, one copy structure.
 *
 * The three distinctions are connected (the ideal), degraded (warnings present,
 * never a gate — #133 says degraded "progression never blocked"), and
 * disconnected. The no-tracker INTEGRITY FAILURE (spec #133 story 49) is an
 * error state with a repair path. Provider display names are never copy: they
 * come from the providers manifest.
 */
export const CONNECTIONS_COPY = {
  /** The two connection roles, in combo-line order. */
  roleLabel: {
    tracker: "Issue tracker",
    gitHost: "Git host",
  },
  /** Slot states: connected is the ideal, degraded is a warning, disconnected drops out. */
  stateLabel: {
    connected: "Connected",
    /** Verified or recorded with warnings, which are listed on the line. */
    degraded: "Degraded — warnings listed",
    disconnected: "Not connected",
  },
  /** Shown for a role with no recorded connection at all. */
  notRecorded: "Not recorded",
  /**
   * Degraded-slot warnings. `deriveConnectionIntegrity` supplies the detail
   * (manifest field labels, the role, or a provider id) — never raw provider
   * text.
   */
  warningMessage: {
    ROLE_NOT_RECORDED: (role: string) =>
      `No ${role.toLowerCase()} connection is recorded on this project.`,
    CONFIG_INCOMPLETE: (fields: string) =>
      `Required configuration is not recorded: ${fields}.`,
    PROVIDER_UNKNOWN: (providerId: string) =>
      `The connected provider “${providerId}” is no longer registered.`,
  },
  /** The integrity failure: a project with no tracker, which is not a mode. */
  integrityFailure: {
    title: "Issue tracker connection missing",
    message:
      "This project has no issue tracker connection, so tickets cannot load. Reconnect an issue tracker to repair the project.",
  },
  /** The repair path offered by every integrity failure. */
  reconnect: "Reconnect",
  /** The settings connections registry (spec #133 story 50 surface). */
  registryTitle: "Tracker Connections",
  registrySubtitle:
    "Read-only registry of projects and their configured connections.",
  registryColumnProject: "Project",
  registryColumnConnections: "Connections",
  registryColumnStatus: "Status",
  registryColumnAction: "Action",
  registryStatusActive: "Active",
  registryStatusArchived: "Archived",
  registryLoading: "Loading connections…",
  registryEmpty: "No projects configured.",
  registryAction: "View Project →",
  onboardProject: "Onboard Project",
  /** The tracker card on the project detail surface. */
  trackerCardTitle: "Issue Tracker Connection",
  trackerCardSubtitle: "Automated ticket ingestion and PR linking.",
  /** Banner title when a connection's warnings leave it degraded. */
  degradedTitle: "This connection needs attention.",
  /** Ingestion: the workflow label tickets are picked up by. */
  ingestionLabel: "Ingestion label",
  workflowLabel: "agentic-workflow",
  /**
   * Scope verification diagnostics. The action is rendered from the
   * connection's declared capabilities (spec #133 §Provider-agnosticism),
   * never from a provider id.
   */
  verifyScopes: "Test Tracker Scopes",
  verifyScopesPending: "Testing Scopes…",
  verifyScopesOk: "Connection and permissions verified.",
  verifyScopesFailed: "Verification failed. Review the required permissions.",
  /** Positive feedback message when a connection verifies cleanly. */
  verified: "Connection verified",
  overPrivileged:
    "Notice: the token has broader access than the recommended minimum.",
  /** Banner lead when a connection is verified with warnings (limited access). */
  degradedLead:
    "Connection verified with limited access. The following permissions could not be confirmed:",
  /** Remediation advice when permissions or scopes are provably missing. */
  degradedRemediation:
    "Update your token in your provider settings to grant the required permissions, then click Re-verify to proceed.",
  /** Neutral advice when permission can only be confirmed upon write (e.g. pull request creation). */
  degradedRemediationUnconfirmed:
    "This permission can only be confirmed when X-Factory first creates a pull request.",
  /** Title for the required permissions and scopes informational panel. */
  requiredScopesTitle: "Required permissions & scopes",
  /** Fallback help text when a secret field does not define custom help. */
  requiredScopesFallbackHelp:
    "Ensure your credential has the required permissions for repository and issue tracking operations.",
} as const;

export type DegradedCapabilityCopyEntry = {
  readonly label: string;
  readonly unconfirmed: string;
  readonly missing: (scopes: string) => string;
  readonly remediation: string;
};

/**
 * Capability-keyed feedback copy for degraded connection verification notices.
 * Maps contract capability names to user-friendly permission labels and guidance.
 */
export const DEGRADED_CAPABILITY_COPY: Record<
  "createPullRequest" | "listRepositories" | "listTickets" | "verifyScopes",
  DegradedCapabilityCopyEntry
> &
  Record<string, DegradedCapabilityCopyEntry | undefined> = {
  createPullRequest: {
    label: "Pull request creation",
    unconfirmed: "Pull request creation — permission could not be confirmed.",
    missing: (scopes: string) => `Pull request creation — Missing: ${scopes}`,
    remediation: CONNECTIONS_COPY.degradedRemediationUnconfirmed,
  },
  listRepositories: {
    label: "Repository listing",
    unconfirmed:
      "Repository listing — permission could not be confirmed. Check your token settings to ensure repository read access is enabled.",
    missing: (scopes: string) => `Repository listing — Missing: ${scopes}`,
    remediation: CONNECTIONS_COPY.degradedRemediation,
  },
  listTickets: {
    label: "Issue tracking",
    unconfirmed:
      "Issue tracking — permission could not be confirmed. Check your token settings to ensure issue tracking access is enabled.",
    missing: (scopes: string) => `Issue tracking — Missing: ${scopes}`,
    remediation: CONNECTIONS_COPY.degradedRemediation,
  },
  verifyScopes: {
    label: "Scope verification",
    unconfirmed:
      "Scope verification — unable to verify token scopes. Check that your token has standard permissions in your provider settings.",
    missing: (scopes: string) => `Scope verification — Missing: ${scopes}`,
    remediation: CONNECTIONS_COPY.degradedRemediation,
  },
};

export const DEGRADED_CAPABILITY_FALLBACK = {
  unconfirmed: (name: string) =>
    `${name} — permission could not be confirmed. Check your token settings to proceed.`,
  missing: (name: string, scopes: string) => `${name} — Missing: ${scopes}`,
  remediation: CONNECTIONS_COPY.degradedRemediation,
} as const;

/** Copy for the Work Queue read region (#147), including its integrity failure. */
export const QUEUE_COPY = {
  empty: "No tickets are waiting in this queue.",
  noMatches: (query: string) => `No tickets matched “${query}”.`,
  clearFilter: "Clear Filter",
  /** The manual path that stays open when the tracker cannot be reached. */
  manualRun: "Start Manual Run",
} as const;

/** Copy for the single-project detail surface (#147). */
export const PROJECT_DETAIL_COPY = {
  notFound: (projectId: string) =>
    `The project “${projectId}” does not exist or has been removed.`,
  backToProjects: "Back to Projects",
  allProjects: "All Projects",
  backToProjectsTitle: "Back to all projects",
  archived: "Archived",
  projectId: "Project ID",
  workspacePath: "Workspace Path",
  defaultWorkspace: "Default",
  defaultBranch: "Default Branch",
  defaultBranchFallback: "main",
  repositories: "Repositories",
  repositoriesConnected: (count: number) => `${count} connected`,
  repositoriesEmpty:
    "No separate sub-repositories configured. Using primary workspace repository.",
  repositoryNameColumn: "Repository Name",
  repositoryPathColumn: "Path",
  repositoryBranchColumn: "Default Branch",
} as const;

/** Copy for the project cards (#147). */
export const PROJECT_CARD_COPY = {
  viewDetailsLabel: (projectName: string) =>
    `View details for project ${projectName}`,
  id: "ID",
  workspace: "Workspace",
  workspaceFallback: "Configured",
  repositoryCount: (count: number) =>
    count === 1 ? "1 repo" : `${count} repos`,
  viewDetails: "View Details →",
} as const;

/**
 * Inspection step copy (#146). The step reports the git identity the agent will
 * commit with, read from the same git configuration the executor's worktree
 * resolves — so it can also say, honestly, that none could be resolved.
 */
export const INSPECTION_COPY = {
  title: "Git Identity Inspection",
  subtitle:
    "The git identity your agent commits with, read from the git configuration in effect for each selected repository.",
  /** Empty: nothing is selected to inspect yet. */
  emptyNoSelection:
    "No repository is selected yet. Choose at least one on the Repositories step, then inspect its git identity.",
  /** Empty: a selection exists, but there is no directory to read a config in. */
  emptyNoPath:
    "There is no local directory to read a git configuration in yet. Set a local workspace root on the Basics step, or a local path for the repository.",
  /** Partial: one item per repository whose directory resolved no identity. */
  unresolvedRepo: (name: string) =>
    `${name} — no git identity is configured for its directory`,
  /** Ready, but no complete identity is configured for the inspected directory. */
  identityMissing: (path?: string) =>
    path
      ? `A Git identity (author name and email) is needed for ${path} so X-Factory can author commits and open pull requests on your behalf.`
      : "A Git identity (author name and email) is needed so X-Factory can author commits and open pull requests on your behalf.",
  identityTitle: "Resolved git identity",
  nameLabel: "Name",
  emailLabel: "Email",
  pathLabel: "Read from",
  /** Explanatory guidance on what git identity is and why X-Factory needs it (#161). */
  identityExplanation:
    "Git identity consists of an author name and email used to sign commits. X-Factory needs this so autonomous agents can commit code and open pull requests on your behalf.",
  /** Form title and guidance (#161). */
  configureTitle: "Configure Git Identity",
  configureHint:
    "Set your author name and email below to configure your git identity.",
  authorNameLabel: "Author Name",
  authorNamePlaceholder: "e.g. Jane Doe",
  authorEmailLabel: "Author Email",
  authorEmailPlaceholder: "e.g. jane@example.com",
  nameRequiredError: "Author name is required.",
  nameInvalidError: "Author name cannot contain control characters.",
  emailRequiredError: "Author email is required.",
  emailInvalidError: "Enter a valid email address.",
  scopeLabel: "Configuration Scope",
  scopeLocalOption: (path: string) => `This repository only (${path})`,
  scopeWorkspaceOption: (path: string) => `This workspace (${path})`,
  scopeRepositoriesOption: (paths: string[]) =>
    `These repositories (${paths.join(", ")})`,
  scopeGlobalOption: "Global (~/.gitconfig — all repositories)",
  scopeHint: (scope: GitIdentityScope, path: string) =>
    scope === "global"
      ? "Applies globally to ~/.gitconfig for all git repositories on this system."
      : `Applies locally to ${path} only.`,
  notAGitRepository:
    "This path is not a git repository. Choose global scope to configure git globally.",
  blockingPathNotRepo: (path: string) =>
    `"${path}" is not a git repository. Choose global scope to configure git globally.`,
  blockingPathNotRepoRoot: (path: string) =>
    `"${path}" is not the root of a git repository. Choose global scope to configure git globally.`,
  directoryMissingError: "The specified directory does not exist.",
  notARepositoryError:
    "The target directory is not a git repository. Choose global scope to configure git globally.",
  notRepositoryRootError:
    "The target directory is not the root of a git repository. Choose global scope to configure git globally.",
  configureServerError:
    "Could not configure git identity. Please check your git configuration and permissions, or try setting it globally.",
  configurePartialError: (configured: string[], failed: string[]) =>
    `Configured git identity for ${configured.join(", ")}, but failed for ${failed.join(", ")}.`,
  configureButton: "Configure Git Identity",
  configuringButton: "Configuring…",
  /** The explicit re-inspection affordance (never an automatic retry loop). */
  inspectAction: "Inspect again",
  previous: "Back",
  next: "Continue to Review",
} as const;

/**
 * Review step copy (#146). The step is the single gate before creation: it
 * shows what was configured, and — when something downstream is no longer
 * current — explains exactly what, with no dismissal path (#133 stale rule).
 */
export const REVIEW_COPY = {
  title: "Review Project Setup",
  subtitle:
    "Confirm the configuration. Creating the project uses your connections and the resolved git identity.",
  projectSectionTitle: "Project",
  nameLabel: "Project Name",
  identifierLabel: "Identifier",
  descriptionLabel: "Description",
  workspacePathLabel: "Workspace Path",
  identitySectionTitle: "Git identity",
  identityNameLabel: "Name",
  identityEmailLabel: "Email",
  repositoriesSectionTitle: "Repositories",
  repositoryRolesLabel: "Listed as",
  primaryBadge: "Primary",
  unsetName: "Untitled",
  unsetValue: "—",
  defaultWorkspacePath: "(Default)",
  /** The blocked banner's title; the reasons are listed as its items. */
  blockedTitle: "This project cannot be created yet.",
  blocked: {
    trackerUnverified:
      "The issue tracker connection is not verified. Verify it on the Connect step.",
    gitHostUnverified:
      "The Git host connection is not verified. Verify it on the Connect step.",
    noApplicationRepository:
      "No application repository is selected. Choose at least one on the Repositories step.",
    selectionStale:
      "The repository selection was made for a different connection configuration. Select the repositories again.",
    inspectionMissing:
      "The git identity has not been inspected for this selection yet. Inspect it on the Inspection step.",
    inspectionStale:
      "The git identity was resolved for a different repository selection or workspace root. Inspect it again.",
    identityUnresolved:
      "No git identity could be resolved for the selected repositories: both a user.name and a user.email are required, and none will be invented.",
    identityPartial:
      "No git identity could be resolved for every selected repository. Configure one, or deselect the ones that have none.",
  },
  submit: "Create Project",
  submitting: "Creating project…",
  previous: "Back",
  /** The 409 envelope's own codes carry the detail as banner items. */
  conflictTitle: "The project could not be created.",
  /** Any other rejected request (400, 5xx): the request itself was refused. */
  requestRejectedTitle: "The request was rejected.",
  requestRejectedDetail:
    "The project was not created and nothing was saved. Check the configuration and try again.",
  /** The request never reached the server. */
  networkErrorTitle: "The server could not be reached.",
  networkErrorDetail:
    "The project was not created. Check your connection and try again.",
} as const;

/**
 * Canonical copy for server validation error codes returned in 409 envelopes.
 * Field errors format the field's human label; form errors provide form-level guidance.
 */
export const VALIDATION_FIELD_ERROR_COPY: Readonly<
  Record<string, (fieldLabel: string) => string>
> = {
  REQUIRED: (label) => `${label} is required.`,
  INVALID: (label) => `${label} is invalid.`,
};

export const VALIDATION_FORM_ERROR_COPY: Readonly<Record<string, string>> = {
  UNKNOWN_PROVIDER: "Unknown provider. Please select a registered provider.",
  INCOMPATIBLE_CONFIGURATION:
    "Incompatible configuration for the selected provider role.",
  SECRET_NOT_ACCEPTED:
    "A credential was sent with a request that must not carry one. Connections are identified by their non-secret settings only.",
  MISSING_TRACKER_CONNECTION:
    "An issue tracker connection is required. Add one on the Connect step — X-Factory does not create tracker-less projects.",
  MISSING_GIT_HOST_CONNECTION:
    "A git host connection is required. Add one on the Connect step — X-Factory does not create projects without a git host.",
};

export const VALIDATION_FALLBACK_COPY = {
  field: (label: string) => `${label} is invalid.`,
  form: "The configuration is invalid. Please check your settings.",
} as const;

/**
 * Resolves canonical field-level validation copy for a given error code and field label.
 * Unknown codes fall back to a generic fallback string — never rendering raw code or provider text.
 */
export function resolveFieldValidationError(
  code: string,
  fieldLabel: string,
): string {
  const formatter = VALIDATION_FIELD_ERROR_COPY[code];
  return formatter
    ? formatter(fieldLabel)
    : VALIDATION_FALLBACK_COPY.field(fieldLabel);
}

/**
 * Resolves canonical form-level validation copy for a given error code.
 * Unknown codes fall back to a generic fallback string — never rendering raw code or provider text.
 */
export function resolveFormValidationError(code: string): string {
  return VALIDATION_FORM_ERROR_COPY[code] ?? VALIDATION_FALLBACK_COPY.form;
}

/**
 * Runtime guard for values crossing the API boundary as error envelopes.
 * Unwraps from ApiError.data if an error wrapper is passed (#163).
 * Mirrors the provider contract's `isProviderError` (#129): a positive
 * `retryAfterMs` or none at all.
 */
export function isNormalizedError(value: unknown): value is NormalizedError {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = (
    "data" in value &&
    typeof (value as { data: unknown }).data === "object" &&
    (value as { data: unknown }).data !== null &&
    !("context" in value)
      ? (value as { data: unknown }).data
      : value
  ) as Partial<NormalizedError>;

  return (
    typeof candidate.code === "string" &&
    typeof candidate.context === "string" &&
    candidate.code in ERROR_COPY &&
    candidate.context in ERROR_COPY[candidate.code as FeedbackErrorCode] &&
    (candidate.retryAfterMs === undefined ||
      (typeof candidate.retryAfterMs === "number" &&
        candidate.retryAfterMs > 0))
  );
}

/**
 * Unwraps a normalized error envelope from an error payload, including from
 * ApiError.data (#163).
 */
export function unwrapNormalizedError(
  error: unknown,
): NormalizedError | undefined {
  if (error && typeof error === "object") {
    if (
      "data" in error &&
      isNormalizedError((error as { data: unknown }).data)
    ) {
      return (error as { data: NormalizedError }).data;
    }
    if (isNormalizedError(error)) {
      return error;
    }
  }
  return undefined;
}

/** Resolves canonical copy for a known (code, context) pair. */
export function getErrorCopy(
  code: FeedbackErrorCode,
  context: FeedbackErrorContext,
): string {
  return ERROR_COPY[code][context];
}

/**
 * Resolves canonical copy for any error payload. Normalized envelopes (including
 * those unwrapped from ApiError.data) go through the map; everything else gets
 * the fallback — a raw provider body or message is never rendered (#163).
 */
export function resolveErrorCopy(error: unknown): string {
  const normalized = unwrapNormalizedError(error);
  return normalized
    ? getErrorCopy(normalized.code, normalized.context)
    : STATE_COPY.errorFallback;
}

/**
 * Rate-limit timed guidance (#129): canonical countdown copy derived from the
 * envelope's `retryAfterMs`, in whole seconds. `FeedbackBanner` and
 * `AsyncRegion` tick the remaining window once per second via
 * `use-retry-countdown` so the retry un-disables itself.
 */
export function formatRetryCountdown(retryAfterMs: number): string {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return `Retry available in ${seconds}s`;
}
