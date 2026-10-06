// src/frontend/lib/connection-fingerprint.ts — Connection identity digest
// (spec #133, ticket #144).
//
// Query keys must change when a connection's provider id or any non-secret
// config value changes, so a config edit can never reuse the previous
// configuration's results. The key identity is the same value the Repositories
// step records next to a selection to decide whether that selection is still current.
//
// It is a NON-REVERSIBLE digest rather than the config itself: connection
// configs carry credentials (tokens, PATs), and neither query keys, nor wizard
// state, nor the client draft may ever hold a secret. Two configs compare
// equal iff their provider id and canonicalised non-secret values are equal.

import type { ProviderDescriptor } from "../connection/types.js";

const FNV_PRIME = 16777619;
const FNV_OFFSET_BASIS = 2166136261;

const ENV_KEY_PATTERN = /^env_?key$/i;

/** One 32-bit FNV-1a pass over the canonical string, seeded at the end. */
function digestPass(input: string, offsetBasis: number, seed: number): string {
  let hash = offsetBasis;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  hash = Math.imul(hash ^ seed, FNV_PRIME) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

/** Key-sorted deep copy, so two equal configs serialise identically. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const ordered: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      ordered[key] = canonicalize(source[key]);
    }
    return ordered;
  }
  return value === undefined ? null : value;
}

function resolveDescriptor(
  providerId: string | null,
  descriptorOrDescriptors:
    | ProviderDescriptor
    | readonly ProviderDescriptor[]
    | ReadonlySet<string>
    | undefined,
): {
  secretNames?: ReadonlySet<string>;
  nonSecretNames?: ReadonlySet<string>;
} {
  if (!descriptorOrDescriptors) {
    return {};
  }

  if (
    typeof (descriptorOrDescriptors as ReadonlySet<string>).has ===
      "function" &&
    !("configFields" in descriptorOrDescriptors)
  ) {
    return {
      secretNames: descriptorOrDescriptors as ReadonlySet<string>,
    };
  }

  let desc: ProviderDescriptor | undefined;
  if (Array.isArray(descriptorOrDescriptors)) {
    const list = descriptorOrDescriptors as readonly ProviderDescriptor[];
    desc =
      (providerId !== null
        ? list.find((d) => d.id === providerId)
        : undefined) ?? (list.length === 1 ? list[0] : undefined);
  } else if (
    "configFields" in descriptorOrDescriptors &&
    Array.isArray((descriptorOrDescriptors as ProviderDescriptor).configFields)
  ) {
    desc = descriptorOrDescriptors as ProviderDescriptor;
  }

  if (desc && Array.isArray(desc.configFields)) {
    const secretNames = new Set<string>();
    const nonSecretNames = new Set<string>();
    for (const field of desc.configFields) {
      if (field.secret === true || field.type === "secret") {
        secretNames.add(field.name);
      } else {
        nonSecretNames.add(field.name);
      }
    }
    return { secretNames, nonSecretNames };
  }

  return {};
}

function stripSecrets(
  value: unknown,
  secretNames: ReadonlySet<string> | undefined,
  nonSecretNames: ReadonlySet<string> | undefined,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripSecrets(item, secretNames, nonSecretNames));
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const clean: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(source)) {
      if (ENV_KEY_PATTERN.test(key)) {
        continue;
      }
      if (secretNames?.has(key)) {
        continue;
      }
      if (nonSecretNames !== undefined) {
        if (nonSecretNames.has(key)) {
          clean[key] = stripSecrets(val, secretNames, nonSecretNames);
        }
        continue;
      }
      clean[key] = stripSecrets(val, secretNames, nonSecretNames);
    }
    return clean;
  }
  return value;
}

/**
 * A stable, non-reversible digest of a connection's provider id and non-secret config
 * values, used as query-key identity and as the "which inputs produced this"
 * marker for staleness comparisons.
 *
 * Secret fields (passwords, tokens, PATs, envKey) are stripped before digesting so:
 * - Credentials never participate in query keys or client-visible markers
 * - Rotating credentials does not invalidate selections or trigger cache thrash
 * - Changing non-secret configuration (host, project, repo) produces a different fingerprint
 */
export function connectionConfigFingerprint(
  providerId: string | null,
  config: Record<string, unknown>,
  descriptorOrDescriptors?:
    | ProviderDescriptor
    | readonly ProviderDescriptor[]
    | ReadonlySet<string>,
): string {
  const { secretNames, nonSecretNames } = resolveDescriptor(
    providerId,
    descriptorOrDescriptors,
  );
  const strippedConfig = stripSecrets(
    config,
    secretNames,
    nonSecretNames,
  ) as Record<string, unknown>;

  const canonical = JSON.stringify([providerId, canonicalize(strippedConfig)]);
  const high = digestPass(canonical, FNV_OFFSET_BASIS, 0x9e3779b9);
  const low = digestPass(canonical, FNV_OFFSET_BASIS ^ 0x5bf03635, 0x85ebca6b);
  return `cfp_${high}${low}`;
}
