// src/frontend/wizard/state/connectConfig.ts — THE Connect step's connection
// model: configuration per PROVIDER, selection and verification per ROLE
// (spec #133, correction 2).
//
// The defect this module closes: configuration used to live on each role, so a
// provider serving both roles could be configured twice, verified twice against
// two different configurations, and then submitted once — carrying whichever
// role's copy the payload builder happened to pick. A "verified" tracker
// connection could therefore be submitted with a configuration nobody verified.
//
// Configuration is now stored once per provider id (`providerConfigs`), and the
// roles hold only what is genuinely per role: which provider was selected, and
// whether THAT role's verification of that one configuration succeeded. Every
// write below is a whole-state transition, so the invariant is a property of
// the state model rather than a discipline each call site has to remember:
//
//   * a provider has ONE configuration, whichever roles name it;
//   * a configuration edit clears the verification of EVERY role naming it;
//   * a configuration no role references is dropped.
//
// Provider-agnostic: these functions compare PROVIDER IDS between the two role
// selections. They never know a provider by name.

import {
  type ConnectionIdentityTarget,
  identityConfig,
} from "../../components/connections/connection-state.js";
import type { ProviderDescriptor } from "../../connection/types.js";
import type { WizardConnectionRole, WizardConnectState } from "../types.js";

/** The roles the Connect step collects, in a stable order. */
export const CONNECTION_ROLES: readonly WizardConnectionRole[] = [
  "tracker",
  "gitHost",
];

/** The opposite role. */
function otherRole(role: WizardConnectionRole): WizardConnectionRole {
  return role === "tracker" ? "gitHost" : "tracker";
}

/**
 * The connections the Connect step's configuration can identify: one target per
 * role, carrying the provider that role selected and that provider's ONE
 * configuration (#133 story 34), reduced to its NON-SECRET fields.
 *
 * The draft configuration carries the credentials the user typed, and this read
 * is presentation-only: `identityConfig` keeps only the fields the manifest
 * declares and drops every field it declares `secret`, so a credential never
 * leaves the draft for an identity read (#133 correction 1).
 *
 * A dual-role provider therefore yields two targets holding the SAME provider
 * and configuration — the identity hook queries it once, and both roles of the
 * combo line show the identity of the one connection they are. A role with no
 * provider is a target with no provider id, which the hook does not query.
 */
export function connectionIdentityTargets(
  connect: WizardConnectState,
  descriptors: readonly ProviderDescriptor[],
): ConnectionIdentityTarget[] {
  return CONNECTION_ROLES.map((role) => {
    const providerId = connect[role].providerId;
    return {
      role,
      providerId,
      config:
        providerId === null
          ? {}
          : identityConfig(
              providerId,
              providerConfig(connect, providerId),
              descriptors,
            ),
    };
  });
}

/**
 * The authoritative configuration of a provider. Both roles naming the provider
 * read this same record, so there is exactly one configuration per provider.
 */
export function providerConfig(
  connect: WizardConnectState,
  providerId: string,
): Record<string, unknown> {
  return connect.providerConfigs[providerId] ?? {};
}

/**
 * THE generation of a provider's configuration (correction 1, #133): the counter
 * bumped by every write below, whichever card made it. A verification attempt
 * captures this value and the reducer records its evidence only while the value
 * is still current, so a write from the PARTNER card invalidates the attempt too
 * — a per-card counter cannot see the other card's write, which is the hole this
 * token closes.
 *
 * A provider with no entry reads generation 0: a configuration that was never
 * written has never been replaced. The map is session-scoped and absent in a
 * restored draft, so the absent case must stay meaningful.
 */
export function configGeneration(
  connect: WizardConnectState,
  providerId: string,
): number {
  return connect.providerConfigGenerations?.[providerId] ?? 0;
}

/** Bumps a provider's configuration generation — one bump per write. */
function bumpConfigGeneration(
  connect: WizardConnectState,
  providerId: string,
): Record<string, number> {
  return {
    ...connect.providerConfigGenerations,
    [providerId]: configGeneration(connect, providerId) + 1,
  };
}

/**
 * The configuration the role's selected provider holds. This is the working
 * form for a card and for anything that acts for one role: it is a VIEW onto
 * the provider's configuration, never a copy of it.
 */
export function roleConfig(
  connect: WizardConnectState,
  role: WizardConnectionRole,
): Record<string, unknown> {
  const providerId = connect[role].providerId;
  return providerId === null ? {} : providerConfig(connect, providerId);
}

/** Every role that currently names the provider — the roles one config serves. */
export function rolesForProvider(
  connect: WizardConnectState,
  providerId: string,
): WizardConnectionRole[] {
  return CONNECTION_ROLES.filter(
    (role) => connect[role].providerId === providerId,
  );
}

/**
 * Drops configurations no role references, so the map holds one entry per
 * provider in use.
 *
 * The GENERATION of a dropped provider is deliberately KEPT: the counter must
 * never go backwards, because a verification in flight for a configuration that
 * was dropped and later re-created must still be recognised as stale. Pruning
 * it would let a re-created configuration reuse a generation an old attempt
 * carries.
 */
function pruneProviderConfigs(connect: WizardConnectState): WizardConnectState {
  const referenced = new Set(
    CONNECTION_ROLES.map((role) => connect[role].providerId).filter(
      (providerId): providerId is string => providerId !== null,
    ),
  );
  const entries = Object.entries(connect.providerConfigs).filter(([id]) =>
    referenced.has(id),
  );
  if (entries.length === Object.keys(connect.providerConfigs).length) {
    return connect;
  }
  return { ...connect, providerConfigs: Object.fromEntries(entries) };
}

/**
 * Writes a provider's configuration — the ONE way configuration changes. The
 * verification of EVERY role naming that provider is cleared: the credentials
 * those roles were verified with are no longer the credentials on record, and
 * an edit from either card must invalidate the other's evidence too.
 */
export function writeProviderConfig(
  connect: WizardConnectState,
  providerId: string,
  config: Record<string, unknown>,
): WizardConnectState {
  const next: WizardConnectState = {
    ...connect,
    providerConfigs: { ...connect.providerConfigs, [providerId]: config },
    // The write's generation: every verification in flight for this provider —
    // from either card — is about a configuration that no longer exists.
    providerConfigGenerations: bumpConfigGeneration(connect, providerId),
  };
  for (const role of rolesForProvider(connect, providerId)) {
    next[role] = {
      ...next[role],
      // Editing what was verified invalidates that verification, and nothing
      // carries over from the configuration that was replaced.
      verified: false,
      unconfirmedCapabilities: [],
    };
  }
  return next;
}

/**
 * Selects the provider for one role. The provider's configuration is REUSED
 * when the other role already names it — one provider, one configuration, and
 * the credentials the user entered are not wiped by a second selection of the
 * same provider. A provider that is not configured yet starts empty.
 *
 * Only the selecting role's verification is cleared: that role changed
 * provider, so its evidence belongs to a provider it no longer names. The other
 * role's evidence is untouched, because the configuration it verified is
 * unchanged (or, when it names the same provider, is exactly this one).
 */
export function selectProvider(
  connect: WizardConnectState,
  role: WizardConnectionRole,
  providerId: string | null,
): WizardConnectState {
  const shared =
    providerId !== null && connect[otherRole(role)].providerId === providerId;
  // A fresh provider's configuration entry is created EMPTY, which is still a
  // write to it: a verification of that provider in flight on the other card
  // asked about a configuration this selection just replaced.
  const writesConfig = providerId !== null && !shared;
  const providerConfigs = writesConfig
    ? { ...connect.providerConfigs, [providerId]: {} }
    : connect.providerConfigs;
  return pruneProviderConfigs({
    ...connect,
    providerConfigs,
    ...(writesConfig
      ? { providerConfigGenerations: bumpConfigGeneration(connect, providerId) }
      : {}),
    [role]: {
      providerId,
      // A different provider is unverified evidence until it is verified:
      // committing a project on the previous provider's verification would be
      // exactly the stale value the wizard must never carry forward.
      verified: false,
      unconfirmedCapabilities: [],
    },
  });
}

/**
 * Applies a URL that matched a provider: every role the descriptor serves is
 * pointed at that provider, with the drafted configuration applied on top of
 * the provider's own configuration. The match REPLACES the selection for those
 * roles, so the previous provider's configuration is dropped once no role
 * references it — it can never leak into the new provider's fields.
 */
export function applyProviderMatch(
  connect: WizardConnectState,
  providerId: string,
  draft: Record<string, unknown>,
  roles: readonly WizardConnectionRole[],
): WizardConnectState {
  let next = connect;
  for (const role of roles) {
    next = selectProvider(next, role, providerId);
  }
  return writeProviderConfig(next, providerId, {
    ...providerConfig(connect, providerId),
    ...draft,
  });
}
