// src/providers/contract.ts — The provider contract.
//
// Decided in wayfinder resolution #127 (contract) and #129 (error envelope,
// amended with AUTH_LOCKED). This module is the canonical home of the
// provider contract: provider ids, the required workflow label, the
// normalized ticket shape, the error envelope, the degraded-verification
// channel, and the Provider interface with its optional capabilities.
//
// Invariants:
// - No provider-generated message, body text, header name, or terminology
//   crosses the provider/API boundary; all status/body/header interpretation
//   lives inside each provider's `toUserError` (#129).
// - Optional capabilities are detected only via the `hasCapability`
//   type-guard, never via truthiness checks (#127).
// - X-Factory never merges, closes, or abandons pull requests — the
//   create-only safety invariant lives here (PR_CREATE_ONLY).

import type { z } from "zod/v4";
import type { Ticket } from "../types.js";

// ---------------------------------------------------------------------------
// Identities and roles
// ---------------------------------------------------------------------------

/** The three supported provider ids — exactly three, per #127. */
export type ProviderId = "github" | "azure" | "jira";

/** A provider may serve as the issue tracker, the git host, or both. */
export type ProviderRole = "tracker" | "gitHost";

// ---------------------------------------------------------------------------
// Shared conventions (#127 §9)
// ---------------------------------------------------------------------------

/**
 * The required workflow label. Callers pass it to `listTickets` through
 * `TicketQueryOptions.requiredLabel`; it never gets baked into providers.
 */
export const REQUIRED_WORKFLOW_LABEL = "agentic-workflow";

/** Normalized ticket shape shared by all providers. */
export interface TrackerTicket extends Ticket {
  labels: string[];
  url: string;
  provider: ProviderId;
  updatedAt?: string;
}

/** Options for `listTickets`. */
export interface TicketQueryOptions {
  requiredLabel: string;
}

// ---------------------------------------------------------------------------
// Error envelope (#129)
// ---------------------------------------------------------------------------

/**
 * Declares one of the contract's closed string sets from a single literal
 * list: a readonly tuple whose members derive the union via
 * `(typeof set.values)[number]`, plus the runtime membership set — the two
 * can never drift apart.
 */
function defineContractValues<const T extends readonly string[]>(
  ...values: T
): Readonly<{ values: T; set: ReadonlySet<string> }> {
  return { values, set: new Set<string>(values) };
}

const PROVIDER_ERROR_CODES = defineContractValues(
  "AUTH_INVALID", // credential rejected (bad token, 401)
  "AUTH_LOCKED", // auth temporarily blocked (e.g. Jira CAPTCHA) — different remediation
  "NOT_FOUND", // resource doesn't exist or isn't visible to the token
  "RATE_LIMITED", // provider throttling (incl. GitHub 403 + x-ratelimit-remaining: 0)
  "PERMISSION", // authenticated but unauthorized (scopes)
  "UNKNOWN",
);

export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES.values)[number];

const PROVIDER_ERROR_CONTEXTS = defineContractValues(
  "VERIFY",
  "DISCOVERY",
  "TICKETS",
  "PR",
);

/** The failed operation. Required — there is no fallback context. */
export type ProviderErrorContext =
  (typeof PROVIDER_ERROR_CONTEXTS.values)[number];

/**
 * Structured error envelope. `retryAfterMs` is provider-computed, positive,
 * milliseconds and is present only when actually known.
 */
export interface ProviderError {
  code: ProviderErrorCode;
  context: ProviderErrorContext;
  retryAfterMs?: number;
}

/** Runtime guard for values crossing the API boundary as error envelopes. */
export function isProviderError(value: unknown): value is ProviderError {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<ProviderError>;
  return (
    typeof candidate.code === "string" &&
    typeof candidate.context === "string" &&
    PROVIDER_ERROR_CODES.set.has(candidate.code) &&
    PROVIDER_ERROR_CONTEXTS.set.has(candidate.context) &&
    (candidate.retryAfterMs === undefined ||
      (typeof candidate.retryAfterMs === "number" &&
        candidate.retryAfterMs > 0))
  );
}

// ---------------------------------------------------------------------------
// Degraded-verification channel (#129) — separate from errors
// ---------------------------------------------------------------------------

/** Contract capability names a verification probe can leave unconfirmed. */
const VERIFIABLE_CAPABILITIES = [
  "verifyScopes",
  "listRepositories",
  "listTickets",
  "createPullRequest",
] as const;

export type VerifiableCapability = (typeof VERIFIABLE_CAPABILITIES)[number];

export interface VerificationWarning {
  /** Sole warning kind initially; extensible without frontend conditionals. */
  kind: "CAPABILITY_UNCONFIRMED";
  /** Contract capability name — never provider scope terminology. */
  capability: VerifiableCapability;
}

/**
 * Best-effort verification outcome. Probe degradation is evidence
 * collection, not the authoritative auth result — never a ProviderError.
 */
export interface VerificationResult {
  status: "ok" | "degraded";
  warnings: VerificationWarning[];
}

// ---------------------------------------------------------------------------
// Scope verification (#127 §1)
// ---------------------------------------------------------------------------

export type ScopeStatus = "confirmed" | "missing" | "unconfirmed";

/** A per-capability finding from `verifyScopes`, in contract capability names. */
export interface ScopeFinding {
  capability: VerifiableCapability;
  status: ScopeStatus;
}

export interface ScopeVerificationReport {
  findings: ScopeFinding[];
  /** The credential grants broader permissions than the workflow requires. */
  overPrivileged: boolean;
}

// ---------------------------------------------------------------------------
// Provider-owned configuration (#127 §4, #128)
// ---------------------------------------------------------------------------

/** A provider's zod config schema; parsed output is a flat config record. */
export type ProviderConfigSchema = z.ZodType<Record<string, unknown>>;

/** Provider configuration as passed to capability methods. */
export type ProviderConfig = Record<string, unknown>;

export type ProviderConfigUiType = "text" | "secret" | "url" | "email";

/**
 * Presentation metadata attached to zod fields via `.meta(...)`.
 * Requiredness comes from the schema itself — never from metadata.
 * Declared as a type alias so it satisfies zod's `.meta()` index signature.
 */
export type ProviderConfigFieldMeta = {
  label: string;
  uiType: ProviderConfigUiType;
  /** `true` marks a secret: rendered as a password input, routed to env storage. */
  secret?: boolean;
  /**
   * Environment variable key used to route secret values into per-project
   * env storage (#131). Server/provider metadata only — never serialized
   * into the client-facing manifest (#137).
   */
  envKey?: string;
  placeholder?: string;
  help?: string;
  /** Restricts the field to specific connection roles; defaults to all roles. */
  roles?: ProviderRole[];
};

// ---------------------------------------------------------------------------
// Quick-URL intake (#127 §6)
// ---------------------------------------------------------------------------

/** Config draft returned by `parseQuickUrl`; the wizard merges it generically. */
export interface QuickUrlDraft {
  configDraft: ProviderConfig;
  inferredName?: string;
}

// ---------------------------------------------------------------------------
// Repositories and pull requests
// ---------------------------------------------------------------------------

export interface ProviderRepository {
  id: string;
  name: string;
  remote: string;
  defaultBranch?: string;
  webUrl?: string;
}

/**
 * Safety invariant (#127 §7): X-Factory creates pull requests and posts
 * check statuses — it NEVER merges, closes, or abandons them. The contract
 * deliberately exposes no PR mutation capability; this constant makes the
 * policy explicit and testable.
 */
export const PR_CREATE_ONLY = "create-only" as const;

export interface CreatePullRequestInput {
  /**
   * Repository coordinate as returned by `listRepositories`;
   * semantics are provider-internal.
   */
  repository: string;
  title: string;
  description: string;
  sourceBranch: string;
  targetBranch: string;
}

export interface FindPullRequestInput {
  repository: string;
  sourceBranch: string;
}

export interface ProviderPullRequest {
  url: string;
  status?: string;
  sourceBranch?: string;
  targetBranch?: string;
  lastMergeSourceCommit?: string;
}

// ---------------------------------------------------------------------------
// The Provider interface (#127 §1)
// ---------------------------------------------------------------------------

/** Names of the optional capability methods. */
const OPTIONAL_CAPABILITIES = [
  "verifyScopes",
  "listRepositories",
  "listTickets",
  "parseQuickUrl",
  "createPullRequest",
  "findExistingPullRequest",
] as const;

export type ProviderCapability = (typeof OPTIONAL_CAPABILITIES)[number];

/**
 * One provider. `verifyCredentials` and `toUserError` are required; every
 * other capability is optional and must be detected with `hasCapability`.
 * Capability methods throw raw errors on failure; callers normalize them
 * through `toUserError` with the failed operation's context.
 *
 * @param Id Narrow id type. Defaults to `string` so registry injection can
 *   accept test providers; the static registry binds built-ins to
 *   `ProviderId`.
 */
export interface Provider<Id extends string = string> {
  readonly id: Id;
  readonly displayName: string;
  /** Connection roles this provider can serve. */
  readonly roles: readonly ProviderRole[];
  /** Sprite icon reference shipped with the provider's registration. */
  readonly iconRef: string;
  /** The provider's zod config schema with `.meta(...)` presentation data. */
  readonly configSchema: ProviderConfigSchema;
  verifyCredentials(config: ProviderConfig): Promise<VerificationResult>;
  /**
   * Normalizes provider-specific status/body/header semantics into the
   * error envelope. The raw error never crosses the provider/API boundary.
   */
  toUserError(raw: unknown, context: ProviderErrorContext): ProviderError;
  /** Structured scope report with findings and an over-privilege signal. */
  verifyScopes?(config: ProviderConfig): Promise<ScopeVerificationReport>;
  /** Repository discovery. Optional — Jira Cloud has no repo-discovery API. */
  listRepositories?(config: ProviderConfig): Promise<ProviderRepository[]>;
  /** Ticket listing, filtered by the required workflow label. */
  listTickets?(
    config: ProviderConfig,
    options: TicketQueryOptions,
  ): Promise<TrackerTicket[]>;
  /** Recognizes a provider URL and returns a config draft, or `null`. */
  parseQuickUrl?(url: string): QuickUrlDraft | null;
  createPullRequest?(
    config: ProviderConfig,
    input: CreatePullRequestInput,
  ): Promise<ProviderPullRequest>;
  findExistingPullRequest?(
    config: ProviderConfig,
    input: FindPullRequestInput,
  ): Promise<ProviderPullRequest | null>;
}

/**
 * Capability detection type-guard. Consumers dispatch through this guard —
 * never through truthiness checks on the capability property.
 */
export function hasCapability<Capability extends ProviderCapability>(
  provider: Provider,
  capability: Capability,
): provider is Provider & Required<Pick<Provider, Capability>> {
  return typeof provider[capability] === "function";
}

/**
 * Verifies that a provider strictly adheres to the PR_CREATE_ONLY safety invariant.
 * Returns true if no PR mutation methods (merge, close, abandon, delete, update) are exposed.
 */
export function isCreateOnlyProvider(provider: Provider): boolean {
  const p = provider as unknown as Record<string, unknown>;
  const forbidden = [
    "mergePullRequest",
    "closePullRequest",
    "abandonPullRequest",
    "deletePullRequest",
    "updatePullRequest",
  ];
  return forbidden.every((method) => typeof p[method] !== "function");
}

/**
 * Asserts that a provider adheres to the PR_CREATE_ONLY invariant, throwing if any
 * forbidden PR mutation capabilities are defined.
 */
export function assertCreateOnlyInvariant(provider: Provider): void {
  if (!isCreateOnlyProvider(provider)) {
    throw new Error(
      "Provider violates PR_CREATE_ONLY invariant: pull request mutation methods are strictly forbidden.",
    );
  }
}
