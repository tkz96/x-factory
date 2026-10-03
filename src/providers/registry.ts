// src/providers/registry.ts — Explicit static provider registry.
//
// Built-in providers are imported statically: adding a provider is one new
// directory under `src/providers/<name>/` plus one entry in `BUILT_INS` —
// no other file changes (wayfinder #127, acceptance gate b). There is no
// public runtime registration and this module has no import side effects.
// Tests inject alternative registries through the optional `registry`
// parameter instead of mutating this one.

import { azureProvider } from "./azure-module.js";
import type { Provider, ProviderId } from "./contract.js";

/**
 * Provider lookup id: `ProviderId` literals get editor autocomplete while
 * `string & {}` keeps registry injection open to test providers with ids
 * outside the production union.
 */
export type ProviderLookupId = ProviderId | (string & {});

/** A set of providers keyed by id. Injectable so tests can use stubs. */
export type ProviderRegistry = ReadonlyMap<string, Provider>;

/** Built-in providers. The three real providers land in their own tickets. */
const BUILT_INS: readonly Provider<ProviderId>[] = [
  // github — added with the github provider module
  azureProvider,
  // jira — added with the jira provider module
];

/** The static registry used by production code. */
export const PROVIDER_REGISTRY: ProviderRegistry = new Map<string, Provider>(
  BUILT_INS.map((provider) => [provider.id, provider]),
);

/** Lists every registered provider. */
export function listProviders(
  registry: ProviderRegistry = PROVIDER_REGISTRY,
): readonly Provider[] {
  return [...registry.values()];
}

/** Resolves a provider by id, or `undefined` when not registered. */
export function getProvider(
  id: ProviderLookupId,
  registry: ProviderRegistry = PROVIDER_REGISTRY,
): Provider | undefined {
  return registry.get(id);
}

/** Resolves a provider by id; throws for unknown ids. */
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
  return provider;
}
