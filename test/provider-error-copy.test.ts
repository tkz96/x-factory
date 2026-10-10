// test/provider-error-copy.test.ts — one provider error copy table (#184).
//
// Seam: the copy the provider layer and the frontend copy map resolve. The
// frontend must never import src/providers, so the table lives in the shared
// layer and both sides re-export it. This suite pins the single definition and
// the byte-identical strings both entry points serve.

import { describe, expect, it } from "bun:test";
import {
  ERROR_COPY,
  getErrorCopy,
} from "../src/frontend/components/feedback/copy-map.js";
import {
  getProviderErrorMessage,
  PROVIDER_ERROR_MESSAGES,
} from "../src/providers/errors.js";
import {
  getProviderErrorCopy,
  PROVIDER_ERROR_COPY,
} from "../src/shared/provider-error-copy.js";

const CODES = [
  "AUTH_INVALID",
  "AUTH_LOCKED",
  "NOT_FOUND",
  "RATE_LIMITED",
  "PERMISSION",
  "UNKNOWN",
] as const;

const CONTEXTS = ["VERIFY", "DISCOVERY", "TICKETS", "PR"] as const;

describe("one provider error copy table (#184)", () => {
  it("hands the provider layer and the frontend the same table object", () => {
    // Reference identity, not just equal strings: two tables that happen to
    // match can drift apart again. One definition means one object.
    expect(ERROR_COPY).toBe(PROVIDER_ERROR_MESSAGES);
    expect(PROVIDER_ERROR_COPY).toBe(PROVIDER_ERROR_MESSAGES);
  });

  it("resolves byte-identical copy through both entry points", () => {
    for (const code of CODES) {
      for (const context of CONTEXTS) {
        const shared = PROVIDER_ERROR_COPY[code][context];
        expect(getProviderErrorCopy(code, context)).toBe(shared);
        expect(getProviderErrorMessage(code, context)).toBe(shared);
        expect(getErrorCopy(code, context)).toBe(shared);
      }
    }
  });

  it("pins the canonical strings on the shared table", () => {
    expect(PROVIDER_ERROR_COPY.AUTH_INVALID.VERIFY).toBe(
      "The credentials were rejected. Check the token and try again.",
    );
    expect(PROVIDER_ERROR_COPY.AUTH_LOCKED.DISCOVERY).toBe(
      "Sign-in is temporarily locked, so repositories could not load. Wait a moment, then try again.",
    );
    expect(PROVIDER_ERROR_COPY.NOT_FOUND.TICKETS).toBe(
      "The tickets source could not be found. Check the project and repository addresses.",
    );
    expect(PROVIDER_ERROR_COPY.RATE_LIMITED.PR).toBe(
      "The provider is limiting requests, so the pull request could not be created. Wait a moment, then try again.",
    );
    expect(PROVIDER_ERROR_COPY.PERMISSION.VERIFY).toBe(
      "The token does not have the permissions required to verify this connection.",
    );
    expect(PROVIDER_ERROR_COPY.UNKNOWN.VERIFY).toBe(
      "An unexpected error occurred while verifying the connection. Try again.",
    );
    expect(Object.keys(PROVIDER_ERROR_COPY)).toEqual([
      "AUTH_INVALID",
      "AUTH_LOCKED",
      "NOT_FOUND",
      "RATE_LIMITED",
      "PERMISSION",
      "UNKNOWN",
    ]);
  });
});
