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
import {
  markCapabilityAbsent,
  type Provider,
  type ProviderErrorContext,
  type ProviderId,
} from "./contract.js";
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

type CapabilityName = keyof typeof CAPABILITY_CONTEXTS;

const CAPABILITY_CONTEXTS = {
  verifyCredentials: "VERIFY",
  verifyScopes: "VERIFY",
  listRepositories: "DISCOVERY",
  listTickets: "TICKETS",
  createPullRequest: "PR",
  findExistingPullRequest: "PR",
} as const satisfies Record<string, ProviderErrorContext>;

/**
 * A provider as the registry hands it out. `createPullRequest` is always
 * callable: when the underlying provider lacks it, the call throws a
 * normalized `ProviderError` (`hasCapability` still reports it as absent), so
 * callers never re-check the capability themselves.
 */
export type RegisteredProvider<Id extends string = string> = Provider<Id> &
  Required<Pick<Provider, "createPullRequest">>;

/** Every registry-made wrapper, so a wrapper is never wrapped again. */
const WRAPPERS = new WeakSet<object>();
/** One wrapper per provider object, so identity is stable across lookups. */
const WRAPPER_OF = new WeakMap<object, RegisteredProvider>();

function normalizeFailure(
  provider: Provider,
  err: unknown,
  context: ProviderErrorContext,
): ProviderError {
  if (err instanceof ProviderError) {
    return new ProviderError(err.code, context, {
      retryAfterMs: err.retryAfterMs,
      cause: err.cause,
    });
  }
  const normalized = provider.toUserError(err, context);
  return new ProviderError(normalized.code, context, {
    retryAfterMs: normalized.retryAfterMs,
    cause: err,
  });
}

/**
 * Returns a wrapper around `provider` in which every capability call throws an
 * already-normalized `ProviderError` tagged with its context (#184). The
 * provider object itself is never modified; the wrapper is built once per
 * provider and reused.
 */
export function wrapProvider<Id extends string>(
  provider: Provider<Id>,
): RegisteredProvider<Id> {
  if (WRAPPERS.has(provider)) return provider as RegisteredProvider<Id>;
  const cached = WRAPPER_OF.get(provider);
  if (cached) return cached as RegisteredProvider<Id>;

  const wrapper = Object.create(provider) as Record<string, unknown>;
  for (const name of Object.keys(CAPABILITY_CONTEXTS) as CapabilityName[]) {
    const context = CAPABILITY_CONTEXTS[name];
    const original = provider[name] as
      | ((...args: unknown[]) => Promise<unknown>)
      | undefined;
    if (typeof original === "function") {
      wrapper[name] = async (...args: unknown[]) => {
        try {
          return await original.apply(provider, args);
        } catch (err: unknown) {
          throw normalizeFailure(provider, err, context);
        }
      };
    }
  }
  if (typeof provider.createPullRequest !== "function") {
    wrapper.createPullRequest = markCapabilityAbsent(async () => {
      throw new ProviderError("UNKNOWN", "PR");
    });
  }

  WRAPPERS.add(wrapper);
  WRAPPER_OF.set(provider, wrapper as unknown as RegisteredProvider);
  return wrapper as unknown as RegisteredProvider<Id>;
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
): readonly RegisteredProvider[] {
  return [...registry.values()].map((provider) => wrapProvider(provider));
}

/** Resolves a provider by id, or `undefined` when not registered. Returns wrapped provider. */
export function getProvider(
  id: ProviderLookupId,
  registry: ProviderRegistry = PROVIDER_REGISTRY,
): RegisteredProvider | undefined {
  const provider = registry.get(id);
  return provider ? wrapProvider(provider) : undefined;
}

/** Resolves a provider by id; throws for unknown ids. Returns wrapped provider. */
export function requireProvider(
  id: ProviderLookupId,
  registry: ProviderRegistry = PROVIDER_REGISTRY,
): RegisteredProvider {
  const provider = registry.get(id);
  if (!provider) {
    const known = [...registry.keys()].join(", ") || "(none)";
    throw new Error(
      `Unknown provider "${id}". Registered providers: ${known}.`,
    );
  }
  return wrapProvider(provider);
}
