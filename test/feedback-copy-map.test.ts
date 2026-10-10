// test/feedback-copy-map.test.ts — The canonical copy map: (code, context)
// resolution, runtime envelope guard, fallbacks, and rate-limit countdown copy.

import { describe, expect, it } from "bun:test";
import {
  CONNECTIONS_COPY,
  DEGRADED_CAPABILITY_COPY,
  ERROR_COPY,
  formatRetryCountdown,
  getErrorCopy,
  isNormalizedError,
  resolveErrorCopy,
  resolveFormValidationError,
  STATE_COPY,
  unwrapNormalizedError,
  VALIDATION_FALLBACK_COPY,
} from "../src/frontend/components/feedback/copy-map.js";
import type {
  FeedbackErrorCode,
  FeedbackErrorContext,
} from "../src/frontend/components/feedback/types.js";
import { ApiError } from "../src/frontend/lib/api-client.js";

const CODES: readonly FeedbackErrorCode[] = [
  "AUTH_INVALID",
  "AUTH_LOCKED",
  "NOT_FOUND",
  "RATE_LIMITED",
  "PERMISSION",
  "UNKNOWN",
];

const CONTEXTS: readonly FeedbackErrorContext[] = [
  "VERIFY",
  "DISCOVERY",
  "TICKETS",
  "PR",
];

describe("feedback copy map", () => {
  it("maps every (code, context) pair to non-empty canonical copy", () => {
    for (const code of CODES) {
      for (const context of CONTEXTS) {
        expect(typeof getErrorCopy(code, context)).toBe("string");
        expect(getErrorCopy(code, context).length).toBeGreaterThan(0);
      }
    }
    expect(Object.keys(ERROR_COPY)).toHaveLength(6);
  });

  it("carries distinct remediation copy for the auth codes", () => {
    expect(getErrorCopy("AUTH_INVALID", "VERIFY")).toBe(
      "The credentials were rejected. Check the token and try again.",
    );
    expect(getErrorCopy("AUTH_LOCKED", "DISCOVERY")).toBe(
      "Sign-in is temporarily locked, so repositories could not load. Wait a moment, then try again.",
    );
  });

  it("keeps canonical state copy for all five states plus actions", () => {
    expect(STATE_COPY.loading).toBe("Loading…");
    expect(STATE_COPY.empty).toBe("Nothing here yet.");
    expect(STATE_COPY.partial).toBe("Some results could not load.");
    expect(STATE_COPY.stale).toBe("Out of date");
    expect(STATE_COPY.retry).toBe("Try again");
    expect(STATE_COPY.refresh).toBe("Refresh");
    expect(STATE_COPY.errorFallback).toBe("The request failed. Try again.");
  });

  describe("isNormalizedError", () => {
    it("accepts a valid envelope", () => {
      expect(
        isNormalizedError({ code: "RATE_LIMITED", context: "TICKETS" }),
      ).toBe(true);
    });

    it("accepts a positive retryAfterMs", () => {
      expect(
        isNormalizedError({
          code: "RATE_LIMITED",
          context: "TICKETS",
          retryAfterMs: 30_000,
        }),
      ).toBe(true);
    });

    it("rejects unknown codes, missing context, and bad payloads", () => {
      expect(isNormalizedError({ code: "NOPE", context: "VERIFY" })).toBe(
        false,
      );
      expect(isNormalizedError({ code: "AUTH_INVALID" })).toBe(false);
      expect(isNormalizedError(null)).toBe(false);
      expect(isNormalizedError("AUTH_INVALID")).toBe(false);
      expect(
        isNormalizedError({
          code: "AUTH_INVALID",
          context: "PR",
          retryAfterMs: 0,
        }),
      ).toBe(false);
      expect(
        isNormalizedError({
          code: "AUTH_INVALID",
          context: "PR",
          retryAfterMs: -5,
        }),
      ).toBe(false);
      expect(
        isNormalizedError({
          code: "AUTH_INVALID",
          context: "PR",
          retryAfterMs: "soon",
        }),
      ).toBe(false);
    });
  });

  describe("resolveErrorCopy", () => {
    it("resolves a normalized envelope through the map", () => {
      expect(
        resolveErrorCopy({ code: "PERMISSION", context: "DISCOVERY" }),
      ).toBe(
        "The token does not have the permissions required to discover repositories.",
      );
    });

    it("passes retryAfterMs through with the envelope", () => {
      expect(
        resolveErrorCopy({
          code: "RATE_LIMITED",
          context: "VERIFY",
          retryAfterMs: 5000,
        }),
      ).toBe(
        "The provider is limiting requests, so the connection check failed. Wait a moment, then try again.",
      );
    });

    it("never renders a raw error message — anything else gets the fallback", () => {
      expect(
        resolveErrorCopy(new Error("SyntaxError: raw provider body")),
      ).toBe(STATE_COPY.errorFallback);
      expect(resolveErrorCopy("500 Internal Server Error")).toBe(
        STATE_COPY.errorFallback,
      );
      expect(resolveErrorCopy(undefined)).toBe(STATE_COPY.errorFallback);
    });

    it("unwraps a normalized envelope from an ApiError instance with .data (#163)", () => {
      const apiErrLocked = new ApiError("Locked", 423, {
        error: "Sign-in locked",
        code: "AUTH_LOCKED",
        context: "TICKETS",
      });
      // isNormalizedError is a strict guard on the envelope itself; ApiError is unwrapped by unwrapNormalizedError
      expect(isNormalizedError(apiErrLocked)).toBe(false);
      expect(unwrapNormalizedError(apiErrLocked)).toMatchObject({
        error: "Sign-in locked",
        code: "AUTH_LOCKED",
        context: "TICKETS",
      });
      expect(resolveErrorCopy(apiErrLocked)).toBe(
        "Sign-in is temporarily locked, so tickets could not load. Wait a moment, then try again.",
      );

      const apiErrRateLimited = new ApiError("Too Many Requests", 429, {
        error: "Rate limited",
        code: "RATE_LIMITED",
        context: "VERIFY",
        retryAfterMs: 30000,
      });
      expect(isNormalizedError(apiErrRateLimited)).toBe(false);
      expect(unwrapNormalizedError(apiErrRateLimited)?.retryAfterMs).toBe(
        30000,
      );
      expect(resolveErrorCopy(apiErrRateLimited)).toBe(
        "The provider is limiting requests, so the connection check failed. Wait a moment, then try again.",
      );
    });
  });

  it("formats rate-limit countdown guidance in whole seconds", () => {
    expect(formatRetryCountdown(30_000)).toBe("Retry available in 30s");
    expect(formatRetryCountdown(1500)).toBe("Retry available in 2s");
    expect(formatRetryCountdown(1)).toBe("Retry available in 1s");
  });

  it("resolves both missing-role creation codes to their own guidance, never to the fallback", () => {
    // Both codes can arrive in one 409 envelope (#133), and the wizard renders
    // one banner item per code — a code without copy would fall back to the
    // generic line and tell the user nothing about which connection is missing.
    const tracker = resolveFormValidationError("MISSING_TRACKER_CONNECTION");
    const gitHost = resolveFormValidationError("MISSING_GIT_HOST_CONNECTION");

    for (const copy of [tracker, gitHost]) {
      expect(copy).not.toBe(VALIDATION_FALLBACK_COPY.form);
      expect(copy.length).toBeGreaterThan(0);
      expect(copy).not.toContain("MISSING_");
    }
    expect(tracker).not.toBe(gitHost);
  });

  it("carries canonical degraded connection copy constants and capability mappings", () => {
    expect(CONNECTIONS_COPY.verified).toBe("Connection verified");
    expect(CONNECTIONS_COPY.degradedLead).toBe(
      "Connection verified with limited access. The following permissions could not be confirmed:",
    );
    expect(CONNECTIONS_COPY.degradedRemediation).toBe(
      "Update your token in your provider settings to grant the required permissions, then click Re-verify to proceed.",
    );
    expect(CONNECTIONS_COPY.degradedRemediationUnconfirmed).toBe(
      "This permission can only be confirmed when X-Factory first creates a pull request.",
    );
    expect(CONNECTIONS_COPY.requiredScopesTitle).toBe(
      "Required permissions & scopes",
    );
    expect(CONNECTIONS_COPY.requiredScopesFallbackHelp).toBe(
      "Ensure your credential has the required permissions for repository and issue tracking operations.",
    );

    const capabilities = [
      "createPullRequest",
      "listRepositories",
      "listTickets",
      "verifyScopes",
    ] as const;
    for (const cap of capabilities) {
      const entry = DEGRADED_CAPABILITY_COPY[cap];
      expect(entry).toBeDefined();
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.unconfirmed).toContain(entry.label);
      expect(entry.missing("repo")).toContain(entry.label);
      expect(entry.missing("repo")).toContain("Missing: repo");
      expect(entry.remediation.length).toBeGreaterThan(0);
    }

    expect(DEGRADED_CAPABILITY_COPY.createPullRequest.remediation).toBe(
      CONNECTIONS_COPY.degradedRemediationUnconfirmed,
    );
    expect(DEGRADED_CAPABILITY_COPY.listRepositories.remediation).toBe(
      CONNECTIONS_COPY.degradedRemediation,
    );
    expect(DEGRADED_CAPABILITY_COPY.listTickets.remediation).toBe(
      CONNECTIONS_COPY.degradedRemediation,
    );
    expect(DEGRADED_CAPABILITY_COPY.verifyScopes.remediation).toBe(
      CONNECTIONS_COPY.degradedRemediation,
    );
  });
});
