// src/shared/connection-identity.ts — How a provider-owned connection identity
// becomes a renderable string (#133 story 34).
//
// ONE rule, two consumers: the describe route trims the provider's answer before
// it goes on the wire, and the identity read trims it before attaching it to a
// line. A provider that reports an empty — or whitespace-only — identity is
// reporting NOTHING, so both must answer `null`; an empty string would render as
// `"GitHub ()"`, which names a connection the provider could not identify.
//
// Shared rather than duplicated because the two sides must agree: a route that
// published `""` while the reader discarded it (or vice versa) is exactly the
// drift that makes one surface render an identity another refuses to.

/**
 * The identity as a surface renders it: a non-empty, trimmed string, or `null`.
 */
export function presentableIdentity(
  identity: string | null | undefined,
): string | null {
  return typeof identity === "string" && identity.trim() !== ""
    ? identity.trim()
    : null;
}
