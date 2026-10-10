// test/provider-registry-errors.test.ts — Every capability call on a provider
// handed out by the registry throws a normalized ProviderError (#184).
//
// The seam is the registry (`wrapProvider` / `requireProvider`). Providers are
// the real GitHub, Jira and Azure modules over a transport that fails every
// request with raw provider text; the text must never reach the error.

import { describe, expect, test } from "bun:test";
import { createAzureProvider } from "../src/providers/azure-module.js";
import {
  hasCapability,
  type Provider,
  type ProviderConfig,
  type ProviderErrorContext,
} from "../src/providers/contract.js";
import { ProviderError } from "../src/providers/errors.js";
import { githubConfigSchema } from "../src/providers/github/config.js";
import { createGithubProvider } from "../src/providers/github-module.js";
import { createJiraProvider } from "../src/providers/jira-module.js";
import {
  type ProviderRegistry,
  requireProvider,
  wrapProvider,
} from "../src/providers/registry.js";
import {
  createInMemoryTransport,
  textResponse,
} from "./helpers/provider-test-helper.js";

const RAW = "RAW-PROVIDER-TEXT-9f2c internal trace";

function failing401() {
  return createInMemoryTransport([], textResponse(RAW, { status: 401 }));
}

const PR_INPUT = {
  repository: "acme/repo",
  title: "feat: something",
  description: "desc",
  sourceBranch: "feat",
  targetBranch: "main",
};

type Capability =
  | "verifyCredentials"
  | "verifyScopes"
  | "listRepositories"
  | "listTickets"
  | "createPullRequest"
  | "findExistingPullRequest";

const CONTEXT_OF: Record<Capability, ProviderErrorContext> = {
  verifyCredentials: "VERIFY",
  verifyScopes: "VERIFY",
  listRepositories: "DISCOVERY",
  listTickets: "TICKETS",
  createPullRequest: "PR",
  findExistingPullRequest: "PR",
};

const AUTH_INVALID_COPY: Record<ProviderErrorContext, string> = {
  VERIFY: "The credentials were rejected. Check the token and try again.",
  DISCOVERY:
    "The credentials were rejected while discovering repositories. Check the token and try again.",
  TICKETS:
    "The credentials were rejected while loading tickets. Check the token and try again.",
  PR: "The credentials were rejected while creating the pull request. Check the token and try again.",
};

const CONFIGS: Record<string, ProviderConfig> = {
  github: { token: "bad", repoOwner: "acme", repository: "repo" },
  jira: {
    host: "https://acme.atlassian.net",
    email: "dev@example.com",
    apiToken: "bad",
    project: "ACME",
  },
  azure: {
    orgUrl: "https://dev.azure.com/acme",
    project: "Proj",
    pat: "bad",
  },
};

/**
 * Azure's scope probe reports a rejected token as findings, not as a thrown
 * failure, so its raw failure comes from a connection with no token at all.
 */
function configFor(id: string, capability: Capability): ProviderConfig {
  const config = CONFIGS[id] ?? {};
  if (id === "azure" && capability === "verifyScopes") {
    const { pat: _pat, ...withoutToken } = config;
    return withoutToken;
  }
  return config;
}

function call(
  provider: Provider,
  capability: Capability,
  config: ProviderConfig,
): Promise<unknown> {
  switch (capability) {
    case "verifyCredentials":
      return provider.verifyCredentials(config);
    case "verifyScopes":
      return provider.verifyScopes?.(config) ?? Promise.resolve();
    case "listRepositories":
      return provider.listRepositories?.(config) ?? Promise.resolve();
    case "listTickets":
      return (
        provider.listTickets?.(config, { requiredLabel: "agentic-workflow" }) ??
        Promise.resolve()
      );
    case "createPullRequest":
      return (
        provider.createPullRequest?.(config, PR_INPUT) ?? Promise.resolve()
      );
    case "findExistingPullRequest":
      return (
        provider.findExistingPullRequest?.(config, {
          repository: "acme/repo",
          sourceBranch: "feat",
        }) ?? Promise.resolve()
      );
  }
}

const PROVIDERS: Array<[string, () => Provider]> = [
  [
    "github",
    () => wrapProvider(createGithubProvider({ fetchFn: failing401() })),
  ],
  ["jira", () => wrapProvider(createJiraProvider({ fetchFn: failing401() }))],
  ["azure", () => wrapProvider(createAzureProvider({ fetchFn: failing401() }))],
];

const CAPABILITIES = Object.keys(CONTEXT_OF) as Capability[];

describe("registry providers throw normalized ProviderErrors (#184)", () => {
  for (const [id, build] of PROVIDERS) {
    for (const capability of CAPABILITIES) {
      const present = hasCapability(
        build(),
        capability as Exclude<Capability, "verifyCredentials">,
      );
      if (capability !== "verifyCredentials" && !present) {
        if (capability === "createPullRequest") {
          test(`${id}.createPullRequest absent: throws the canonical PR error and is not reported as a capability`, async () => {
            const provider = build();
            expect(hasCapability(provider, "createPullRequest")).toBe(false);
            let caught: unknown;
            try {
              await provider.createPullRequest?.(CONFIGS[id] ?? {}, PR_INPUT);
            } catch (err) {
              caught = err;
            }
            expect(caught).toBeInstanceOf(ProviderError);
            const err = caught as ProviderError;
            expect(err.context).toBe("PR");
            expect(err.code).toBe("UNKNOWN");
            expect(err.message).toBe(
              "An unexpected error occurred while creating the pull request. Try again.",
            );
          });
        } else {
          test(`${id}.${capability} is absent and stays absent`, () => {
            expect(build()[capability]).toBeUndefined();
          });
        }
        continue;
      }
      test(`${id}.${capability} turns a raw 401 into a ProviderError with ${CONTEXT_OF[capability]} context and canonical copy`, async () => {
        const provider = build();
        let caught: unknown;
        try {
          await call(provider, capability, configFor(id, capability));
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(ProviderError);
        const err = caught as ProviderError;
        expect(err.code).toBe("AUTH_INVALID");
        expect(err.context).toBe(CONTEXT_OF[capability]);
        expect(err.message).toBe(AUTH_INVALID_COPY[CONTEXT_OF[capability]]);
        expect(err.message).not.toContain("RAW-PROVIDER-TEXT");
        expect(JSON.stringify({ ...err, message: err.message })).not.toContain(
          "RAW-PROVIDER-TEXT",
        );
      });
    }
  }

  test("an already-thrown ProviderError is re-tagged with the capability's context", async () => {
    const stub: Provider = {
      ...createJiraProvider({ fetchFn: failing401() }),
      async listTickets() {
        throw new ProviderError("RATE_LIMITED", "VERIFY", {
          retryAfterMs: 5000,
        });
      },
    };
    let caught: unknown;
    try {
      await wrapProvider(stub).listTickets?.(CONFIGS.jira ?? {}, {
        requiredLabel: "x",
      });
    } catch (err) {
      caught = err;
    }
    const err = caught as ProviderError;
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.context).toBe("TICKETS");
    expect(err.retryAfterMs).toBe(5000);
    expect(err.message).toBe(
      "The provider is limiting requests, so tickets could not load. Wait a moment, then try again.",
    );
  });

  test("wrapping returns a fresh wrapper once and leaves the provider object untouched", async () => {
    const original = createJiraProvider({ fetchFn: failing401() });
    const originalListTickets = original.listTickets;
    const wrapped = wrapProvider(original);
    expect(wrapped).not.toBe(original);
    expect(original.listTickets).toBe(originalListTickets);
    expect(wrapProvider(original)).toBe(wrapped);
    expect(wrapProvider(wrapped)).toBe(wrapped);
    // The untouched provider still throws its raw error.
    let rawCaught: unknown;
    try {
      await original.listTickets?.(CONFIGS.jira ?? {}, { requiredLabel: "x" });
    } catch (err) {
      rawCaught = err;
    }
    expect(rawCaught).not.toBeInstanceOf(ProviderError);
  });

  test("requireProvider on an injected registry hands out the wrapper", () => {
    const stub = createJiraProvider({ fetchFn: failing401() });
    const registry: ProviderRegistry = new Map([["jira", stub]]);
    expect(requireProvider("jira", registry)).not.toBe(stub);
    expect(requireProvider("jira", registry)).toBe(
      requireProvider("jira", registry),
    );
  });

  test("the wrapper forwards the pull-request cancellation signal to the provider (#163)", async () => {
    const received: Array<AbortSignal | undefined> = [];
    const provider: Provider = {
      id: "signalspy",
      displayName: "Signal spy",
      roles: ["gitHost"],
      iconRef: "provider-github",
      configSchema: githubConfigSchema,
      async verifyCredentials() {
        return { status: "ok", warnings: [] };
      },
      toUserError(_raw, context) {
        return { code: "UNKNOWN", context };
      },
      async createPullRequest(_config, _input, signal) {
        received.push(signal);
        return {
          url: "https://example.test/pr/1",
          status: "open",
          sourceBranch: "feat",
          targetBranch: "main",
        };
      },
      async findExistingPullRequest(_config, _input, signal) {
        received.push(signal);
        return null;
      },
    };
    const wrapped = wrapProvider(provider);
    const controller = new AbortController();

    await wrapped.createPullRequest({}, PR_INPUT, controller.signal);
    await wrapped.findExistingPullRequest?.(
      {},
      { repository: "acme/repo", sourceBranch: "feat" },
      controller.signal,
    );

    expect(received).toEqual([controller.signal, controller.signal]);
  });
});
