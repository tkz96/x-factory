// src/frontend/connection/deferred-checks.ts — Which unconfirmed capabilities
// are a fault, and which are only a check that waits for first use.
//
// The server reports every capability it could not confirm as one warning kind
// (`CAPABILITY_UNCONFIRMED`) with status "degraded". Some providers cannot
// check pull request creation without opening a pull request. That is expected,
// and retrying cannot change it. So a pull request capability with no missing
// scopes is a DEFERRED CHECK: the connection reads as verified, with one calm
// note. Every other unconfirmed capability, and any capability with missing
// scopes, is a real warning and keeps the warning tone.

/** Capabilities a provider cannot check before first use. */
const DEFERRED_CHECK_CAPABILITIES: readonly string[] = ["createPullRequest"];

/** True when the capability cannot be checked before first use and no scope is provably missing. */
export function isDeferredCheck(
  capability: string,
  missingScopes?: readonly string[] | undefined,
): boolean {
  return (
    DEFERRED_CHECK_CAPABILITIES.includes(capability) &&
    (missingScopes === undefined || missingScopes.length === 0)
  );
}

interface UnconfirmedWarning {
  capability: string;
  missingScopes?: readonly string[] | undefined;
}

/** Splits warnings into deferred checks and real problems. */
export function splitWarnings<T extends UnconfirmedWarning>(
  warnings: readonly T[],
): { deferred: T[]; real: T[] } {
  const deferred: T[] = [];
  const real: T[] = [];
  for (const w of warnings) {
    (isDeferredCheck(w.capability, w.missingScopes) ? deferred : real).push(w);
  }
  return { deferred, real };
}

/** True when persisted evidence holds at least one real (not deferred) unconfirmed capability. */
export function hasRealUnconfirmed(evidence: {
  unconfirmedCapabilities?: readonly string[] | undefined;
  missingScopes?: Readonly<Record<string, string[]>> | undefined;
}): boolean {
  return (evidence.unconfirmedCapabilities ?? []).some(
    (capability) =>
      !isDeferredCheck(capability, evidence.missingScopes?.[capability]),
  );
}
