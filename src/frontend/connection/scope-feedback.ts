// src/frontend/connection/scope-feedback.ts — Scope verification feedback and error translation (Issue #162).
//
// Provider-agnostic helpers for mapping contract capabilities to human-readable
// permission requirements, formatting capability status notices, and translating
// technical errors into actionable user advice.

import {
  DEGRADED_CAPABILITY_COPY,
  DEGRADED_CAPABILITY_FALLBACK,
} from "../components/feedback/copy-map.js";

function humanizeTechnicalName(technicalName: string): string {
  // Convert camelCase or snake_case identifier into a human-readable title
  const spaced = technicalName
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Maps a capability that could not be confirmed during verification into a
 * human-readable permission requirement using canonical copy from the copy map.
 * When specific required scopes are provably missing, renders provider-supplied scope names.
 */
export function formatDegradedCapabilityNotice(
  capability: string,
  missingScopes?: readonly string[] | string[],
): string {
  const mapping = DEGRADED_CAPABILITY_COPY[capability];
  if (missingScopes && missingScopes.length > 0) {
    const scopesStr = missingScopes.join(", ");
    return mapping
      ? mapping.missing(scopesStr)
      : DEGRADED_CAPABILITY_FALLBACK.missing(
          humanizeTechnicalName(capability),
          scopesStr,
        );
  }
  return mapping
    ? mapping.unconfirmed
    : DEGRADED_CAPABILITY_FALLBACK.unconfirmed(
        humanizeTechnicalName(capability),
      );
}
