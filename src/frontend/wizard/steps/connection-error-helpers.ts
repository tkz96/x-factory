// src/frontend/wizard/steps/connection-error-helpers.ts — Helpers for error extraction and the card's derived connection state.
//
// The card's state is derived HERE, in one place, from two sources whose
// authority is defined (correction 5, #133):
//
//   * the wizard state's evidence for the role — WHETHER the connection is
//     verified, and which capabilities could not be confirmed;
//   * the hook's transient payload — the result just received, the error just
//     surfaced, whether an attempt is in flight.
//
// The evidence is authoritative for the FACT. `WizardModal` renders only the
// ACTIVE step, so leaving Connect unmounts the step and the hook with it: a
// remount must not be able to turn a role the state records as verified back
// into an unverified one, which is what deriving the fact from the transient
// result alone did.

// THE definition of whether a connection is usable/verified (#133, ticket #146)
// — the same predicate the Review gate reads, so the card's progression and the
// gate that eventually blocks the user can never disagree.
import { isConnectionUsable } from "../../components/connections/connection-state.js";
import type { VerificationResult } from "../../connection/types.js";
import { ApiError } from "../../lib/api-client.js";
import type { WizardConnectionRoleState } from "../types.js";

/**
 * The status the card displays. Precedence, in order:
 *   1. an attempt in flight                   → "pending";
 *   2. the error just surfaced                → "error";
 *   3. evidence the state no longer holds     → "idle". A provider change, a
 *      configuration write or a Quick-URL match clears it, and a result still
 *      in hand then belongs to a configuration nobody verified any more.
 *   4. the result just received               → "ok" / "degraded" from it;
 *   5. the evidence the state persisted       → "degraded" when capabilities
 *      were left unconfirmed, otherwise "ok".
 *
 * Steps 4 and 5 read the same fact from the two sources it can come from, which
 * is what makes it survive a remount: step 5 is reachable with no local state
 * at all.
 */
export function deriveVerificationStatus(
  isPending: boolean,
  verification: VerificationResult | null,
  error: unknown,
  evidence: WizardConnectionRoleState,
): "idle" | "pending" | "ok" | "degraded" | "error" {
  if (isPending) return "pending";
  if (error) return "error";
  if (!isConnectionUsable(evidence)) return "idle";
  if (verification?.status === "degraded") return "degraded";
  if (verification?.status === "ok") return "ok";
  return (evidence.unconfirmedCapabilities?.length ?? 0) > 0
    ? "degraded"
    : "ok";
}

/**
 * The verification payload the card DISPLAYS: the result just received as it
 * is, or — when a remount lost it — the degraded payload reconstructed from the
 * capability names the state persisted, so the partial state survives
 * navigation with the verified flag it belongs to.
 *
 * Nothing is mirrored into the state by this: the payload is derived FROM the
 * evidence, never written back to it.
 */
export function resolveVerificationDisplay(
  verification: VerificationResult | null,
  evidence: WizardConnectionRoleState,
): VerificationResult | null {
  if (!isConnectionUsable(evidence)) return null;
  if (verification) return verification;
  const unconfirmed = evidence.unconfirmedCapabilities ?? [];
  if (unconfirmed.length === 0 && !evidence.overPrivileged) return null;
  return {
    status: unconfirmed.length > 0 ? "degraded" : "ok",
    warnings: unconfirmed.map((capability) => ({
      kind: "CAPABILITY_UNCONFIRMED" as const,
      capability,
      ...(evidence.missingScopes?.[capability]
        ? { missingScopes: evidence.missingScopes[capability] }
        : {}),
    })),
    ...(evidence.overPrivileged ? { overPrivileged: true } : {}),
  };
}

function asRecord(val: unknown): Record<string, unknown> | null {
  return typeof val === "object" && val !== null
    ? (val as Record<string, unknown>)
    : null;
}

export function extractApiErrors(error: unknown): {
  fieldErrors: Record<string, string> | null;
  formErrors: string[] | null;
} {
  if (!(error instanceof ApiError) || error.status !== 409) {
    return { fieldErrors: null, formErrors: null };
  }
  const data = asRecord(error.data);
  const fieldErrors = asRecord(data?.fieldErrors) as Record<
    string,
    string
  > | null;
  const formErrors = Array.isArray(data?.formErrors)
    ? (data.formErrors as string[])
    : null;
  return { fieldErrors, formErrors };
}
