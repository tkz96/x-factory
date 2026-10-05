// src/providers/github-module.ts — GitHub provider module conforming to the provider contract (#138).

import type {
  CreatePullRequestInput,
  FindPullRequestInput,
  Provider,
  ProviderConfig,
  ProviderError,
  ProviderErrorContext,
  ProviderPullRequest,
  ProviderRepository,
  QuickUrlDraft,
  ScopeVerificationReport,
  TicketQueryOptions,
  TrackerTicket,
  VerificationResult,
} from "./contract.js";
import {
  detectGitHubConfigMismatch,
  githubConfigSchema,
  resolveGitHubConfig,
} from "./github/config.js";
import { GitHubHttpError, toGitHubUserError } from "./github/errors.js";
import {
  createGitHubPullRequest,
  findExistingGitHubPullRequest,
} from "./github/pull-requests.js";
import { listGitHubRepositories } from "./github/repositories.js";
import { listGitHubTickets } from "./github/tickets.js";
import { parseGitHubQuickUrl } from "./github/urls.js";
import {
  verifyGitHubCredentials,
  verifyGitHubScopes,
} from "./github/verification.js";

export interface GitHubProviderOptions {
  fetchFn?: typeof fetch | undefined;
}

/**
 * Factory creating a GitHub provider instance with optional dependency overrides.
 */
export function createGithubProvider(
  options: GitHubProviderOptions = {},
): Provider<"github"> {
  const fetchFn = options.fetchFn;

  return {
    id: "github",
    displayName: "GitHub",
    roles: ["tracker", "gitHost"],
    iconRef: "provider-github",
    configSchema: githubConfigSchema,

    verifyCredentials(config: ProviderConfig): Promise<VerificationResult> {
      return verifyGitHubCredentials(config, fetchFn);
    },

    verifyScopes(config: ProviderConfig): Promise<ScopeVerificationReport> {
      return verifyGitHubScopes(config, fetchFn);
    },

    listRepositories(config: ProviderConfig): Promise<ProviderRepository[]> {
      return listGitHubRepositories(config, fetchFn);
    },

    listTickets(
      config: ProviderConfig,
      queryOptions: TicketQueryOptions,
    ): Promise<TrackerTicket[]> {
      return listGitHubTickets(config, queryOptions, fetchFn);
    },

    parseQuickUrl(url: string): QuickUrlDraft | null {
      return parseGitHubQuickUrl(url);
    },

    createPullRequest(
      config: ProviderConfig,
      input: CreatePullRequestInput,
    ): Promise<ProviderPullRequest> {
      return createGitHubPullRequest(config, input, fetchFn);
    },

    findExistingPullRequest(
      config: ProviderConfig,
      input: FindPullRequestInput,
    ): Promise<ProviderPullRequest | null> {
      return findExistingGitHubPullRequest(config, input, fetchFn);
    },

    toUserError(error: unknown, context: ProviderErrorContext): ProviderError {
      return toGitHubUserError(error, context);
    },
  };
}

/**
 * Canonical singleton GitHub provider registered with the provider registry.
 */
export const githubProvider: Provider<"github"> = createGithubProvider();

export {
  detectGitHubConfigMismatch,
  GitHubHttpError,
  githubConfigSchema,
  parseGitHubQuickUrl,
  resolveGitHubConfig,
  toGitHubUserError,
};
