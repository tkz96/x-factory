// src/shared/legacy-tracker.ts — The ONE reader of the legacy `issueTracker`
// mirror (#172).
//
// Pure and dependency-free, so both the server (project connections) and the
// shared duplicate-identity module can read a legacy record the same way without
// the frontend bundle importing the provider registry. Nothing else reads the
// mirror.

/**
 * The provider id a LEGACY `issueTracker` record names, or `null` when it names
 * none.
 *
 * A legacy record names its tracker explicitly (`provider`, or its historical
 * alias `connectionId`), or implicitly through the namespaced view its
 * configuration lives under (`tracker[providerId] = config`). `isKnownProvider`
 * decides whether a view key is a provider identity.
 */
export function legacyTrackerProviderId(
  issueTracker: unknown,
  isKnownProvider: (id: string) => boolean,
): string | null {
  if (typeof issueTracker !== "object" || issueTracker === null) {
    return null;
  }
  const record = issueTracker as Record<string, unknown>;
  for (const key of ["provider", "connectionId"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }
  for (const [key, view] of Object.entries(record)) {
    if (
      view !== null &&
      typeof view === "object" &&
      !Array.isArray(view) &&
      isKnownProvider(key)
    ) {
      return key;
    }
  }
  return null;
}

/**
 * The configuration a legacy record holds for `providerId`: its namespaced view,
 * with the flat `projectId` filling in `project` when the view does not name one.
 */
export function legacyTrackerConfig(
  issueTracker: unknown,
  providerId: string,
): Record<string, unknown> {
  if (typeof issueTracker !== "object" || issueTracker === null) return {};
  const record = issueTracker as Record<string, unknown>;
  const view = record[providerId];
  const config: Record<string, unknown> =
    view !== null && typeof view === "object" && !Array.isArray(view)
      ? { ...(view as Record<string, unknown>) }
      : {};
  if (
    typeof config.project !== "string" &&
    typeof record.projectId === "string"
  ) {
    config.project = record.projectId;
  }
  return config;
}
