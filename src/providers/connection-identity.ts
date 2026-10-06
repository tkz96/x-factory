// src/providers/connection-identity.ts — Shared, provider-owned helpers for the
// `describeConnection` capability (spec #133 story 34).
//
// Each provider composes its OWN identity form ("owner/repo",
// "organization/MyProject", "acme.atlassian.net/ROCK"); what is genuinely
// shared is how a configuration field is read, how a URL's scheme is stripped,
// and how the parts are joined. Sharing that here keeps the three provider
// modules from carrying three copies of the same three-line routine.
//
// Everything in this module is total and read-only over the configuration: it
// never throws and never touches a secret field — callers name the fields they
// read, and the secret fields of every provider are never named.

/**
 * A configuration field as a usable identifier: a non-empty, trimmed string, or
 * `null`. Any other value (absent, empty, whitespace, a number) identifies
 * nothing, so it is reported as nothing rather than rendered.
 */
export function identityField(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * A URL with its scheme and trailing slashes removed: `"https://acme.dev/"` →
 * `"acme.dev"`. A value that carries no scheme is returned unchanged (beyond
 * trimming), so a host typed without one reads identically. Returns `null` for
 * a value that is empty once stripped.
 */
export function schemeStripped(value: unknown): string | null {
  const trimmed = identityField(value);
  if (trimmed === null) {
    return null;
  }
  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const withoutTrailingSlashes = withoutScheme.replace(/\/+$/, "");
  return withoutTrailingSlashes === "" ? null : withoutTrailingSlashes;
}

/**
 * Joins the recorded parts with `separator`, dropping the absent ones: with
 * both present `"acme"` + `"ROCK"` → `"acme/ROCK"`, with one present that one
 * alone, and with none present `null`.
 */
export function joinIdentityParts(
  parts: readonly (string | null)[],
  separator: string,
): string | null {
  const present = parts.filter((part): part is string => part !== null);
  return present.length === 0 ? null : present.join(separator);
}
