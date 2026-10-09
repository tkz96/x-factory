// test/connection-status-derivation.test.ts — The card's displayed connection
// state is derived from the state's evidence and the hook's transient payload
// in ONE place (correction 5, #133). These are the precedence rules themselves,
// with no rendered wizard around them: which source wins, and what a REMOUNT —
// no local payload at all — reports.

import { describe, expect, it } from "bun:test";
import { isConnectionUsable } from "../src/frontend/components/connections/connection-state.js";
import type { VerificationResult } from "../src/frontend/connection/types.js";
import {
  deriveVerificationStatus,
  resolveVerificationDisplay,
} from "../src/frontend/wizard/steps/connection-error-helpers.js";
import type { WizardConnectionRoleState } from "../src/frontend/wizard/types.js";

const okResult: VerificationResult = { status: "ok", warnings: [] };
const degradedResult: VerificationResult = {
  status: "degraded",
  warnings: [
    { kind: "CAPABILITY_UNCONFIRMED", capability: "createPullRequest" },
  ],
};

/** The evidence a successful verification leaves in the wizard state. */
const verified: WizardConnectionRoleState = {
  providerId: "generic-githost",
  verified: true,
  unconfirmedCapabilities: [],
};

/** The evidence a DEGRADED verification leaves: verified, with capabilities named. */
const verifiedDegraded: WizardConnectionRoleState = {
  providerId: "generic-githost",
  verified: true,
  unconfirmedCapabilities: ["createPullRequest"],
};

/**
 * What the reducer leaves behind after a provider change, a configuration write
 * or a Quick-URL match — the role's evidence is gone.
 */
const cleared: WizardConnectionRoleState = {
  providerId: null,
  verified: false,
  unconfirmedCapabilities: [],
};

describe("the fact of verification is read from the state alone (#146's predicate)", () => {
  it("is true for evidence the state still holds", () => {
    expect(isConnectionUsable(verified)).toBe(true);
    expect(isConnectionUsable(verifiedDegraded)).toBe(true);
  });

  it("is false for cleared evidence, for a role with no provider, and for a role never verified", () => {
    expect(isConnectionUsable(cleared)).toBe(false);
    expect(
      isConnectionUsable({
        providerId: null,
        verified: true,
        unconfirmedCapabilities: [],
      }),
    ).toBe(false);
    expect(isConnectionUsable({ providerId: "generic-githost" })).toBe(false);
    expect(
      isConnectionUsable({ providerId: "generic-githost", verified: false }),
    ).toBe(false);
  });

  // There is deliberately NO test here asserting that the card's status follows
  // `isConnectionUsable`: that restates the implementation (`deriveVerificationStatus`
  // calls the predicate) and would pass for any implementation that calls it.
  // The agreement it is meant to pin — the card showing "Verified"/"Degraded"
  // exactly while the Review gate lets the user through — is proven against the
  // rendered surfaces instead: `test/connect-step.test.tsx` (both cards, every
  // verification outcome, and the Next button) and `test/review-step.test.tsx`
  // (the gate and the submit).
});

describe("deriveVerificationStatus — one precedence for both sources of the fact", () => {
  it("reports VERIFIED after a remount: persisted evidence, no local payload at all", () => {
    expect(deriveVerificationStatus(false, null, null, verified)).toBe("ok");
  });

  it("reports DEGRADED after a remount: the persisted unconfirmed capabilities carry the partial state", () => {
    expect(deriveVerificationStatus(false, null, null, verifiedDegraded)).toBe(
      "degraded",
    );
  });

  it("reports the result just received while the evidence still holds", () => {
    expect(deriveVerificationStatus(false, okResult, null, verified)).toBe(
      "ok",
    );
    expect(
      deriveVerificationStatus(false, degradedResult, null, verified),
    ).toBe("degraded");
  });

  it("cannot display a result whose evidence the reducer has cleared", () => {
    // The result is still in hand when the OTHER card writes the shared
    // configuration, or the provider was changed on this card's own remount.
    expect(deriveVerificationStatus(false, okResult, null, cleared)).toBe(
      "idle",
    );
    expect(deriveVerificationStatus(false, degradedResult, null, cleared)).toBe(
      "idle",
    );
  });

  it("reports pending while an attempt is in flight, and the error once it fails", () => {
    expect(deriveVerificationStatus(true, okResult, null, verified)).toBe(
      "pending",
    );
    expect(
      deriveVerificationStatus(false, null, new Error("transport"), verified),
    ).toBe("error");
    expect(
      deriveVerificationStatus(false, null, new Error("transport"), cleared),
    ).toBe("error");
  });

  it("reports idle when there is neither evidence nor a result", () => {
    expect(deriveVerificationStatus(false, null, null, cleared)).toBe("idle");
    expect(
      deriveVerificationStatus(false, null, null, {
        providerId: "generic-githost",
      }),
    ).toBe("idle");
  });
});

describe("resolveVerificationDisplay — the payload a remount can still show", () => {
  it("reconstructs the degraded payload from the persisted capability names", () => {
    expect(resolveVerificationDisplay(null, verifiedDegraded)).toEqual(
      degradedResult,
    );
  });

  it("reconstructs the degraded payload with missingScopes per capability", () => {
    const verifiedWithMissingScopes: WizardConnectionRoleState = {
      providerId: "generic-githost",
      verified: true,
      unconfirmedCapabilities: ["createPullRequest"],
      missingScopes: { createPullRequest: ["repo"] },
    };
    expect(resolveVerificationDisplay(null, verifiedWithMissingScopes)).toEqual(
      {
        status: "degraded",
        warnings: [
          {
            kind: "CAPABILITY_UNCONFIRMED",
            capability: "createPullRequest",
            missingScopes: ["repo"],
          },
        ],
      },
    );
  });

  it("shows the result just received as it is", () => {
    expect(resolveVerificationDisplay(okResult, verified)).toBe(okResult);
    expect(resolveVerificationDisplay(degradedResult, verified)).toBe(
      degradedResult,
    );
  });

  it("hides whatever is still in hand once the evidence is cleared", () => {
    expect(resolveVerificationDisplay(okResult, cleared)).toBeNull();
    expect(resolveVerificationDisplay(degradedResult, cleared)).toBeNull();
    expect(resolveVerificationDisplay(null, cleared)).toBeNull();
  });

  it("has nothing to show for a verified connection nothing was unconfirmed on", () => {
    expect(resolveVerificationDisplay(null, verified)).toBeNull();
  });
});
