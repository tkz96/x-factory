// test/provider-contract.test.ts — Provider contract and registry tests (#134).
//
// Proves the wayfinder #127 acceptance gates:
// (a) a stub provider functions via registry injection with zero edits
//     outside its module;
// (b) the registry is explicit and static, with no public runtime
//     registration and no import side effects.

import { describe, expect, test } from "bun:test";
import {
  assertCreateOnlyInvariant,
  hasCapability,
  isProviderError,
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

describe("PR create-only invariant (registry level)", () => {
  test("every registered provider satisfies the create-only safety invariant", () => {
    const providers = listProviders();
    expect(providers.length).toBeGreaterThan(0);
    for (const provider of providers) {
      expect(
        () => assertCreateOnlyInvariant(provider),
        `provider "${provider.id}" exposes a forbidden PR mutation method`,
      ).not.toThrow();
    }
  });

  test("the same invariant governs providers injected through the registry seam", () => {
    expect(() => assertCreateOnlyInvariant(stubProvider)).not.toThrow();
  });

  test("the invariant rejects every forbidden PR mutation capability", () => {
    const forbiddenMutations = [
      "mergePullRequest",
      "closePullRequest",
      "abandonPullRequest",
      "deletePullRequest",
      "updatePullRequest",
    ] as const;

    for (const mutation of forbiddenMutations) {
      const mutatingProvider = {
        ...stubProvider,
        [mutation]: () => undefined,
      } as unknown as Provider;
      expect(
        () => assertCreateOnlyInvariant(mutatingProvider),
        `assertCreateOnlyInvariant must reject a provider exposing ${mutation}`,
      ).toThrow();
    }
  });
});

describe("provider contract", () => {
  test("required workflow label stays the shared contract constant", () => {
    expect(REQUIRED_WORKFLOW_LABEL).toBe("agentic-workflow");
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
    expect(
      isProviderError({
        code: "RATE_LIMITED",
        context: "DISCOVERY",
        retryAfterMs: 0,
      }),
    ).toBe(false);
    expect(
      isProviderError({
        code: "RATE_LIMITED",
        context: "DISCOVERY",
        retryAfterMs: -5,
      }),
    ).toBe(false);
  });

  test("rejects envelopes with extra fields", () => {
    expect(
      isProviderError({
        code: "AUTH_INVALID",
        context: "VERIFY",
        extra: "field",
      }),
    ).toBe(false);
    expect(
      isProviderError({
        code: "RATE_LIMITED",
        context: "DISCOVERY",
        retryAfterMs: 30_000,
        leaked: true,
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

describe("provider error normalization and raw-object guard (#184)", () => {
  test("an object with code, context and extra fields normalizes to UNKNOWN for every provider (closes Azure pass-through)", () => {
    const providers = listProviders();
    expect(providers.length).toBeGreaterThan(0);
    const impostors = [
      { code: "AUTH_INVALID", context: "VERIFY", extra: "leaked-secret" },
      { code: "PERMISSION", context: "PR", debugInfo: { internal: 123 } },
      {
        code: "RATE_LIMITED",
        context: "DISCOVERY",
        retryAfterMs: 5000,
        extraProp: "surprise",
      },
      { code: "NOT_FOUND", context: "TICKETS", internalPath: "/opt/app" },
    ];

    for (const provider of providers) {
      for (const impostor of impostors) {
        const normalized = provider.toUserError(impostor, "VERIFY");
        expect(normalized).toEqual({
          code: "UNKNOWN",
          context: "VERIFY",
        });
      }
    }
  });

  test("genuine provider errors without extra fields preserve code and retryAfterMs", () => {
    const providers = listProviders();
    for (const provider of providers) {
      const genuineRateLimit = {
        code: "RATE_LIMITED" as const,
        context: "DISCOVERY" as const,
        retryAfterMs: 5000,
      };
      const normalizedRateLimit = provider.toUserError(genuineRateLimit, "PR");
      expect(normalizedRateLimit).toEqual({
        code: "RATE_LIMITED",
        context: "PR",
        retryAfterMs: 5000,
      });

      const genuineAuth = {
        code: "AUTH_INVALID" as const,
        context: "VERIFY" as const,
      };
      const normalizedAuth = provider.toUserError(genuineAuth, "TICKETS");
      expect(normalizedAuth).toEqual({
        code: "AUTH_INVALID",
        context: "TICKETS",
      });
    }
  });
});

describe("static registry", () => {
  test("registers built-in providers (#138–#140)", () => {
    // Adding a provider = one new directory + one BUILT_INS entry (#138–#140).
    const providers = listProviders();
    expect(providers.map((p) => p.id)).toContain("github");
    expect(providers.map((p) => p.id)).toContain("azure");
    expect(providers.map((p) => p.id)).toContain("jira");
    expect(getProvider("github")).toBeDefined();
    expect(getProvider("azure")).toBeDefined();
    expect(getProvider("jira")).toBeDefined();
    expect(PROVIDER_REGISTRY.has("github")).toBe(true);
    expect(PROVIDER_REGISTRY.has("azure")).toBe(true);
    expect(PROVIDER_REGISTRY.has("jira")).toBe(true);
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
    expect(token.meta()).toMatchObject({
      secret: true,
      uiType: "secret",
      envKey: "STUB_API_TOKEN",
    });
    // envKey is secret-routing metadata only — non-secret fields never carry it.
    expect(stubConfigSchema.shape.host.meta()).not.toHaveProperty("envKey");
  });
});
