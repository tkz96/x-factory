// src/frontend/lib/connection-fingerprint.ts — Connection identity digest
// (spec #133, ticket #144).
//
// Query keys must change when a connection's provider id or any config value
// changes, so a config edit can never reuse the previous configuration's
// results. The key identity is the same value the Repositories step records
// next to a selection to decide whether that selection is still current.
//
// It is a NON-REVERSIBLE digest rather than the config itself: connection
// configs carry credentials (tokens, PATs), and neither query keys, nor wizard
// state, nor the client draft may ever hold a secret. Two configs compare
// equal iff their provider id and canonicalised values are equal.

const FNV_PRIME = 16777619;
const FNV_OFFSET_BASIS = 2166136261;

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

/**
 * A stable, non-reversible digest of a connection's provider id and config
 * values, used as query-key identity and as the "which inputs produced this"
 * marker for staleness comparisons.
 */
export function connectionConfigFingerprint(
  providerId: string | null,
  config: Record<string, unknown>,
): string {
  const canonical = JSON.stringify([providerId, canonicalize(config)]);
  const high = digestPass(canonical, FNV_OFFSET_BASIS, 0x9e3779b9);
  const low = digestPass(canonical, FNV_OFFSET_BASIS ^ 0x5bf03635, 0x85ebca6b);
  return `cfp_${high}${low}`;
}
