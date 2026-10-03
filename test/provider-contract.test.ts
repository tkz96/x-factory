// test/provider-contract.test.ts — Provider contract and registry tests (#134).
//
// Proves the wayfinder #127 acceptance gates:
// (a) a stub provider functions via registry injection with zero edits
//     outside its module;
// (b) the registry is explicit and static, with no public runtime
//     registration and no import side effects.

import { describe, expect, test } from "bun:test";
import {
  hasCapability,
  isProviderError,
  PR_CREATE_ONLY,
  type Provider,
  type ProviderError,
  REQUIRED_WORKFLOW_LABEL,
  type VerificationResult,
} from "../src/providers/contract.js";
import {
  getProvider,
  listProviders,
  PROVIDER_REGISTRY,
  requireProvider,
} from "../src/providers/registry.js";
import { stubConfigSchema, stubProvider } from "./fixtures/stub-provider.js";

describe("provider contract", () => {
  test("required workflow label stays the shared contract constant", () => {
    expect(REQUIRED_WORKFLOW_LABEL).toBe("agentic-workflow");
  });

  test("PR lifecycle policy is create-only", () => {
    expect(PR_CREATE_ONLY).toBe("create-only");
  });

  test("capability detection uses type-guards, never truthiness", () => {
    expect(hasCapability(stubProvider, "verifyScopes")).toBe(true);
    expect(hasCapability(stubProvider, "parseQuickUrl")).toBe(true);
    expect(hasCapability(stubProvider, "listRepositories")).toBe(false);
    expect(hasCapability(stubProvider, "listTickets")).toBe(false);
    expect(hasCapability(stubProvider, "createPullRequest")).toBe(false);
    expect(hasCapability(stubProvider, "findExistingPullRequest")).toBe(false);
  });

  test("type-guard narrows to the callable capability", () => {
    const provider: Provider = stubProvider;
    if (!hasCapability(provider, "parseQuickUrl")) {
      throw new Error("stub must be quick-url capable");
    }
    const draft = provider.parseQuickUrl("https://stub.example/acme/rocket");
    expect(draft?.inferredName).toBe("rocket");
    expect(draft?.configDraft).toEqual({
      host: "https://stub.example",
      project: "rocket",
    });
    expect(provider.parseQuickUrl("https://elsewhere.example/x")).toBeNull();
  });
});

describe("provider error envelope", () => {
  test("all six codes are valid, including AUTH_LOCKED", () => {
    const codes = [
      "AUTH_INVALID",
      "AUTH_LOCKED",
      "NOT_FOUND",
      "RATE_LIMITED",
      "PERMISSION",
      "UNKNOWN",
    ] as const;
    for (const code of codes) {
      expect(isProviderError({ code, context: "VERIFY" })).toBe(true);
    }
  });

  test("rejects malformed envelopes", () => {
    expect(isProviderError(null)).toBe(false);
    expect(isProviderError("AUTH_INVALID")).toBe(false);
    expect(isProviderError({ code: "BOGUS", context: "VERIFY" })).toBe(false);
    expect(
      isProviderError({ code: "AUTH_INVALID", context: "SOMEWHERE" }),
    ).toBe(false);
    expect(isProviderError({ code: "AUTH_INVALID" })).toBe(false);
    expect(
      isProviderError({
        code: "RATE_LIMITED",
        context: "DISCOVERY",
        retryAfterMs: "soon",
      }),
    ).toBe(false);
  });

  test("accepts retryAfterMs when actually known", () => {
    const envelope: ProviderError = {
      code: "RATE_LIMITED",
      context: "DISCOVERY",
      retryAfterMs: 30_000,
    };
    expect(isProviderError(envelope)).toBe(true);
  });
});

describe("static registry", () => {
  test("is empty during prefactoring; real providers land in their own tickets", () => {
    // Adding a provider = one new directory + one BUILT_INS entry (#138–#140).
    expect(listProviders()).toEqual([]);
    expect(getProvider("github")).toBeUndefined();
    expect(PROVIDER_REGISTRY.size).toBe(0);
  });

  test("requireProvider throws a normalized error for unknown ids", () => {
    expect(() => requireProvider("does-not-exist")).toThrow(/Unknown provider/);
  });
});

describe("registry-injection extensibility gate (#127 acceptance a)", () => {
  const injected: ReadonlyMap<string, Provider> = new Map([
    [stubProvider.id, stubProvider],
  ]);

  test("a stub provider functions with zero edits outside its module", async () => {
    const provider = requireProvider("stub", injected);
    expect(provider).toBe(stubProvider);
    expect(typeof provider.verifyCredentials).toBe("function");
    expect(typeof provider.toUserError).toBe("function");
    expect(getProvider("stub", injected)).toBe(stubProvider);
    // The stub is NOT in the static registry — no production file was touched.
    expect(getProvider("stub")).toBeUndefined();

    const verification: VerificationResult = await provider.verifyCredentials(
      {},
    );
    expect(verification).toEqual({ status: "ok", warnings: [] });

    expect(provider.toUserError(new Error("boom"), "VERIFY")).toEqual({
      code: "AUTH_INVALID",
      context: "VERIFY",
    });

    if (!hasCapability(provider, "verifyScopes")) {
      throw new Error("stub must be scope-verifiable");
    }
    const report = await provider.verifyScopes({});
    expect(report.findings).toEqual([
      { capability: "listTickets", status: "confirmed" },
    ]);
    expect(report.overPrivileged).toBe(false);
  });

  test("stub config schema declares secret-field metadata", () => {
    const token = stubConfigSchema.shape.apiToken;
    expect(token.meta()).toMatchObject({ secret: true, uiType: "secret" });
  });
});
