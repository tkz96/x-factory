// src/frontend/hooks/useConnectionIdentity.ts — THE connection-identity read
// (spec #133 story 34).
//
// A connection's identity is provider-owned: the server asks the provider's
// `describeConnection` capability (POST /api/providers/describe) and this hook
// brings the answer to the surfaces. It is the ONE hook for the job — the
// wizard's Review step asks it from the draft configuration in
// `connect.providerConfigs`, and every post-creation surface asks it from a
// project's recorded connections — so the identity a user sees during
// onboarding and the one they see afterwards come from exactly one place.
//
// The query key is the connection CONFIGURATION's fingerprint (#144's
// non-reversible digest): editing a field is a different key, so an identity
// can never be shown for a configuration that did not produce it, and the
// configuration itself — which carries credentials — never enters a key, a
// cache entry's name, or a devtools panel.
//
// Everything here is presentation metadata: nothing is persisted, nothing is
// logged, and an identity that cannot be produced is simply absent.
//
// The hook answers with a LOOKUP rather than a role-keyed map, so a surface
// that renders MANY projects (the settings registry, the project list) makes
// one call for all of them and resolves each row's own configuration — two
// projects on the same provider never share an identity that way.

import { useQueries } from "@tanstack/react-query";
// The ONE definition of a presentable identity, shared with the route that
// publishes it: a provider that reports nothing shows nothing, on either side.
import { presentableIdentity } from "../../shared/connection-identity.js";
import type {
  ConnectionComboSlot,
  ConnectionIdentityLookup,
  ConnectionIdentityTarget,
} from "../components/connections/connection-state.js";
import {
  identitiesByRole,
  withConnectionIdentities,
} from "../components/connections/connection-state.js";
import type { ProviderDescriptor } from "../connection/types.js";
import { api } from "../lib/api-client.js";
import { connectionConfigFingerprint } from "../lib/connection-fingerprint.js";
import { QUERY_POLICIES, queryKeys } from "../lib/query-policies.js";

/**
 * The identity wiring of ONE line, as ONE call: the line's slots in, the same
 * slots out with each role's provider-owned identity attached.
 *
 * This is the only place the three-step wiring lives (the targets a surface
 * derived → the read → attaching the answers to the slots). Every surface calls
 * it — the wizard's Review step with the slots it derives from draft evidence,
 * the post-creation surfaces with the slots they derive from a project's record
 * — so no surface can wire it differently and no surface can forget the
 * read: a line is always rendered with the identities that were actually
 * fetched for it.
 */
export function useConnectionLine(
  slots: readonly ConnectionComboSlot[],
  targets: readonly ConnectionIdentityTarget[],
  descriptors?:
    | ProviderDescriptor
    | readonly ProviderDescriptor[]
    | ReadonlySet<string>,
): ConnectionComboSlot[] {
  const lookup = useConnectionIdentities(targets, descriptors);
  return withConnectionIdentities(slots, identitiesByRole(targets, lookup));
}

/** One line's inputs: the slots a surface renders, and the reads they need. */
export interface ConnectionLine {
  readonly slots: readonly ConnectionComboSlot[];
  readonly targets: readonly ConnectionIdentityTarget[];
}

/**
 * The identity wiring of MANY lines in ONE batched read — the settings registry
 * renders a line per project and must not make one round of requests per row.
 * The batching rule (every line's targets in one call, each line taking its own
 * answers back) consequently lives here too, rather than in that one surface.
 */
export function useConnectionLines(
  lines: readonly ConnectionLine[],
  descriptors?:
    | ProviderDescriptor
    | readonly ProviderDescriptor[]
    | ReadonlySet<string>,
): ConnectionComboSlot[][] {
  const lookup = useConnectionIdentities(
    lines.flatMap((line) => line.targets),
    descriptors,
  );
  return lines.map((line) =>
    withConnectionIdentities(
      line.slots,
      identitiesByRole(line.targets, lookup),
    ),
  );
}

/**
 * Reads the provider-owned identity of every connection a surface is about to
 * render, and answers with the lookup that attaches them to the line's slots.
 *
 * Each connection is queried by its own configuration, so a dual-role provider
 * — one connection serving both roles — asks once and shows the same identity
 * for both. A role the hook cannot answer for renders the plain display name;
 * asking is never allowed to break a surface.
 *
 * Surfaces do not call this directly: they call `useConnectionLine`, which owns
 * the whole wiring. It is exported because it is the seam the wiring is tested
 * through.
 */
export function useConnectionIdentities(
  targets: readonly ConnectionIdentityTarget[],
  descriptors?:
    | ProviderDescriptor
    | readonly ProviderDescriptor[]
    | ReadonlySet<string>,
): ConnectionIdentityLookup {
  // Deduplicate targets before passing queries to useQueries so queries are
  // created and executed only for unique (providerId, config) pairs. A dual-role
  // connection — or identical configurations across batched lines — makes
  // exactly one request to describe.
  const uniqueTargets: Array<{
    target: ConnectionIdentityTarget;
    fingerprint: string;
  }> = [];
  const seenFingerprints = new Set<string>();

  for (const target of targets) {
    const fingerprint = connectionConfigFingerprint(
      target.providerId,
      target.config,
      descriptors,
    );
    if (!seenFingerprints.has(fingerprint)) {
      seenFingerprints.add(fingerprint);
      uniqueTargets.push({ target, fingerprint });
    }
  }

  const results = useQueries({
    queries: uniqueTargets.map(({ target }) => ({
      queryKey: queryKeys.providerIdentity(
        target.providerId,
        target.config,
        descriptors,
      ),
      queryFn: () => {
        const providerId = target.providerId;
        if (providerId === null) {
          // `enabled: false` keeps this from running; it exists so the query fn
          // is total, never so an identity is invented.
          return { providerId: "", identity: null };
        }
        return api.providers.describe({
          providerId,
          config: { ...target.config },
        });
      },
      enabled: target.providerId !== null,
      ...QUERY_POLICIES.providerIdentity,
    })),
  });

  const answered = new Map<string, string | null>();
  uniqueTargets.forEach(({ fingerprint }, index) => {
    answered.set(
      fingerprint,
      presentableIdentity(results[index]?.data?.identity),
    );
  });

  return (target) =>
    answered.get(
      connectionConfigFingerprint(
        target.providerId,
        target.config,
        descriptors,
      ),
    ) ?? null;
}
