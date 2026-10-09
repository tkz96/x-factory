// test/provider-error-response.test.ts — One helper turns a ProviderError into
// an HTTP response (#184): fixed body shape, status chosen by code.

import { describe, expect, test } from "bun:test";
import {
  providerErrorResponse,
  translateDomainErrorToHttpResponse,
} from "../src/http/responses.js";
import { ProviderError } from "../src/providers/errors.js";

describe("providerErrorResponse", () => {
  test.each([
    ["AUTH_INVALID", 401],
    ["AUTH_LOCKED", 423],
    ["PERMISSION", 403],
    ["NOT_FOUND", 404],
    ["RATE_LIMITED", 429],
    ["UNKNOWN", 502],
  ] as const)("%s answers %i", async (code, status) => {
    const res = providerErrorResponse(new ProviderError(code, "TICKETS"));
    expect(res.status).toBe(status);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["code", "context", "error"]);
    expect(body.code).toBe(code);
    expect(body.context).toBe("TICKETS");
    expect(res.headers.get("Retry-After")).toBeNull();
  });

  test("a known wait is in the body in milliseconds and in Retry-After in whole seconds", async () => {
    const res = providerErrorResponse(
      new ProviderError("RATE_LIMITED", "PR", { retryAfterMs: 1500 }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("2");
    expect(await res.json()).toEqual({
      error:
        "The provider is limiting requests, so the pull request could not be created. Wait a moment, then try again.",
      code: "RATE_LIMITED",
      context: "PR",
      retryAfterMs: 1500,
    });
  });

  test("the domain-error ladder builds the same response", async () => {
    const err = new ProviderError("NOT_FOUND", "DISCOVERY", {
      cause: new Error("RAW-PROVIDER-TEXT"),
    });
    const res = translateDomainErrorToHttpResponse(err);
    expect(res?.status).toBe(404);
    expect(await res?.json()).toEqual({
      error:
        "The organization, project, or workspace could not be found. Check the URL.",
      code: "NOT_FOUND",
      context: "DISCOVERY",
    });
  });
});
