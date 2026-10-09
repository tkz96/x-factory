// src/providers/registry.ts — Explicit static provider registry.
//
// Built-in providers are imported statically: adding a provider is one new
// directory under `src/providers/<name>/` plus one entry in `BUILT_INS` —
// no other file changes (wayfinder #127, acceptance gate b). There is no
// public runtime registration and this module has no import side effects.
// Tests inject alternative registries through the optional `registry`
// parameter instead of mutating this one.
//
// Every provider handed out by this registry is wrapped so capability calls
// throw already-normalized ProviderError tagged with operation context (#184).

import { azureProvider } from "./azure-module.js";
import type { Provider, ProviderErrorContext, ProviderId } from "./contract.js";
import { ProviderError } from "./errors.js";
import { githubProvider } from "./github-module.js";
import { jiraProvider } from "./jira-module.js";

/**
 * Provider lookup id: `ProviderId` literals get editor autocomplete while
 * `string & {}` keeps registry injection open to test providers with ids
 * outside the production union.
 */
export type ProviderLookupId = ProviderId | (string & {});

/** A set of providers keyed by id. Injectable so tests can use stubs. */
export type ProviderRegistry = ReadonlyMap<string, Provider>;

const WRAPPED_SYMBOL = Symbol.for("x-factory.provider.wrapped");

const CAPABILITY_CONTEXTS: Readonly<
  Record<
    | "verifyCredentials"
    | "verifyScopes"
    | "listRepositories"
    | "listTickets"
    | "createPullRequest"
    | "findExistingPullRequest",
    ProviderErrorContext
  >
> = {
  verifyCredentials: "VERIFY",
  verifyScopes: "VERIFY",
  listRepositories: "DISCOVERY",
  listTickets: "TICKETS",
  createPullRequest: "PR",
  findExistingPullRequest: "PR",
};

/**
 * Wraps a provider instance so that every capability call throws an
 * already-normalized `ProviderError` tagged with its context (#184).
 *
 * In-place wrapping with an idempotent symbol marker preserves referential
 * equality (`provider === stubProvider`).
 */
export function wrapProvider<P extends Provider>(provider: P): P {
  if (
    (provider as unknown as Record<symbol, unknown>)[WRAPPED_SYMBOL] === true
  ) {
    return provider;
  }

  for (const [methodName, context] of Object.entries(CAPABILITY_CONTEXTS)) {
    const original = (provider as unknown as Record<string, unknown>)[
      methodName
    ];
    if (typeof original === "function") {
      (provider as unknown as Record<string, unknown>)[methodName] = async (
        ...args: unknown[]
      ) => {
        try {
          return await (
            original as (...args: unknown[]) => Promise<unknown>
          ).apply(provider, args);
        } catch (err: unknown) {
          if (err instanceof ProviderError) {
            throw err;
          }
          const normalized = provider.toUserError(err, context);
          throw new ProviderError(normalized.code, normalized.context, {
            retryAfterMs: normalized.retryAfterMs,
            cause: err,
          });
        }
      };
    }
  }

  Object.defineProperty(provider, WRAPPED_SYMBOL, {
    value: true,
    enumerable: false,
    configurable: false,
  });

  return provider;
}

/** Built-in providers, wrapped with normalized errors (#184). */
const BUILT_INS: readonly Provider<ProviderId>[] = [
  wrapProvider(githubProvider),
  wrapProvider(azureProvider),
  wrapProvider(jiraProvider),
];

/** The static registry used by production code. */
export const PROVIDER_REGISTRY: ProviderRegistry = new Map<string, Provider>(
  BUILT_INS.map((provider) => [provider.id, provider]),
);

/** Lists every registered provider, wrapped with normalized errors (#184). */
export function listProviders(
  registry: ProviderRegistry = PROVIDER_REGISTRY,
): readonly Provider[] {
  return [...registry.values()].map((provider) => wrapProvider(provider));
}

/** Resolves a provider by id, or `undefined` when not registered. Returns wrapped provider. */
export function getProvider(
  id: ProviderLookupId,
  registry: ProviderRegistry = PROVIDER_REGISTRY,
): Provider | undefined {
  const provider = registry.get(id);
  return provider ? wrapProvider(provider) : undefined;
}

/** Resolves a provider by id; throws for unknown ids. Returns wrapped provider. */
export function requireProvider(
  id: ProviderLookupId,
  registry: ProviderRegistry = PROVIDER_REGISTRY,
): Provider {
  const provider = registry.get(id);
  if (!provider) {
    const known = [...registry.keys()].join(", ") || "(none)";
    throw new Error(
      `Unknown provider "${id}". Registered providers: ${known}.`,
    );
  }
  return wrapProvider(provider);
}
