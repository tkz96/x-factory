// test/connection-identity-hook.test.tsx — THE connection-identity read
// (spec #133 story 34).
//
// One hook serves every surface: the wizard's Review step asks it from the
// draft configuration, the post-creation surfaces from a project's recorded
// connections. What is asserted here is the behaviour those surfaces depend on:
//
//   - one describe call per CONNECTION CONFIGURATION, and a cached answer
//     reused for an unchanged configuration;
//   - a config EDIT is a different key, so the new identity is fetched rather
//     than the previous configuration's identity being shown;
//   - a role with no provider (and a provider that answers `null`) renders
//     nothing — the plain display name — never an error and never "null";
//   - the configuration itself — which carries credentials — never reaches a
//     query key.
//
// Only the api-client seam is mocked, following test/post-creation-surfacing.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import React from "react";
import {
  type ConnectionIdentityTarget,
  identitiesByRole,
  identityConfig,
} from "../src/frontend/components/connections/connection-state.js";
import type { ProviderDescriptor } from "../src/frontend/connection/types.js";
import {
  type ConnectionLine,
  useConnectionIdentities,
  useConnectionLines,
} from "../src/frontend/hooks/useConnectionIdentity.js";
import { api } from "../src/frontend/lib/api-client.js";
import { azureProvider } from "../src/providers/azure-module.js";
import { githubProvider } from "../src/providers/github-module.js";
import { jiraProvider } from "../src/providers/jira-module.js";
import { serializeProvider } from "../src/providers/serializer.js";

const ORIGINAL_DESCRIBE = api.providers.describe;

/** Distinctive synthetic markers — never real credentials. */
const CONFIG_SECRET_MARKER = "tok_identity_hook_marker_4c19";
const EDITED_CONFIG_SECRET_MARKER = "tok_identity_hook_edited_7b52";

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

/** A probe that renders exactly what a surface passes to the combo line. */
function IdentityProbe({
  targets,
  descriptors,
}: {
  targets: readonly ConnectionIdentityTarget[];
  descriptors?:
    | ProviderDescriptor
    | readonly ProviderDescriptor[]
    | ReadonlySet<string>
    | undefined;
}) {
  const lookup = useConnectionIdentities(targets, descriptors);
  const identities = identitiesByRole(targets, lookup);
  return (
    <span data-testid="identities">
      {JSON.stringify({
        tracker: identities.tracker ?? null,
        gitHost: identities.gitHost ?? null,
      })}
    </span>
  );
}

function renderProbe(
  client: QueryClient,
  targets: readonly ConnectionIdentityTarget[],
  descriptors?:
    | ProviderDescriptor
    | readonly ProviderDescriptor[]
    | ReadonlySet<string>
    | undefined,
) {
  return render(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(IdentityProbe, { targets, descriptors }),
    ),
  );
}

interface DescribedCall {
  providerId: string;
  config: Record<string, unknown>;
}

/** Records every describe request, answering with a per-provider identity. */
function installDescribe(
  answer: (call: DescribedCall) => {
    providerId: string;
    identity: string | null;
  },
): DescribedCall[] {
  const calls: DescribedCall[] = [];
  api.providers.describe = mock(async (payload: unknown) => {
    const described = payload as DescribedCall;
    calls.push(described);
    return answer(described);
  }) as never;
  return calls;
}

/** The targets both producers build: one per role, with its configuration. */
function targetsFor(
  trackerConfig: Record<string, unknown>,
  gitHostConfig: Record<string, unknown>,
): ConnectionIdentityTarget[] {
  return [
    { role: "tracker", providerId: "tracker-one", config: trackerConfig },
    { role: "gitHost", providerId: "githost-one", config: gitHostConfig },
  ];
}

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  api.providers.describe = ORIGINAL_DESCRIBE;
  await unregisterHappyDom();
});

describe("useConnectionIdentities — one read, per connection configuration", () => {
  it("asks once per role's configuration and answers each role's identity", async () => {
    const calls = installDescribe(({ providerId }) => ({
      providerId,
      identity:
        providerId === "tracker-one" ? "board.example/ROCK" : "octo-org/rocket",
    }));

    const { getByTestId } = renderProbe(
      makeClient(),
      targetsFor(
        { host: "https://board.example", apiToken: CONFIG_SECRET_MARKER },
        { orgUrl: "https://dev.azure.com/acme", repo: "rocket" },
      ),
    );

    await waitFor(() => {
      expect(getByTestId("identities").textContent).toContain(
        "board.example/ROCK",
      );
    });
    expect(getByTestId("identities").textContent).toContain("octo-org/rocket");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.config.host).toBe("https://board.example");
  });

  it("reuses the cached identity for an unchanged configuration", async () => {
    const calls = installDescribe(({ providerId }) => ({
      providerId,
      identity: "octo-org/rocket",
    }));

    const client = makeClient();
    const targets = targetsFor(
      { host: "https://board.example" },
      { repo: "rocket" },
    );
    const first = renderProbe(client, targets);
    await waitFor(() => {
      expect(first.getByTestId("identities").textContent).toContain(
        "octo-org/rocket",
      );
    });
    first.unmount();

    // An equal-but-new configuration object is the SAME connection: no refetch.
    const second = renderProbe(
      client,
      targetsFor({ host: "https://board.example" }, { repo: "rocket" }),
    );
    await waitFor(() => {
      expect(second.getByTestId("identities").textContent).toContain(
        "octo-org/rocket",
      );
    });
    expect(calls).toHaveLength(2);
  });

  it("asks again — and shows the NEW identity — when the configuration is edited", async () => {
    const calls = installDescribe(({ providerId, config }) => ({
      providerId,
      identity:
        config.host === "https://board-old.example"
          ? "board.example/OLD"
          : "board.example/NEW",
    }));

    const client = makeClient();
    const first = renderProbe(
      client,
      targetsFor(
        { host: "https://board-old.example", apiToken: CONFIG_SECRET_MARKER },
        {},
      ),
    );
    await waitFor(() => {
      expect(first.getByTestId("identities").textContent).toContain(
        "board.example/OLD",
      );
    });
    first.unmount();

    const second = renderProbe(
      client,
      targetsFor(
        {
          host: "https://board-new.example",
          apiToken: EDITED_CONFIG_SECRET_MARKER,
        },
        {},
      ),
    );
    await waitFor(() => {
      expect(second.getByTestId("identities").textContent).toContain(
        "board.example/NEW",
      );
    });
    expect(second.getByTestId("identities").textContent).not.toContain(
      "board.example/OLD",
    );
    // The edited configuration was genuinely asked about: an identity keyed by
    // anything but the configuration could have reused the first answer.
    expect(
      calls.filter((call) => call.config.host === "https://board-new.example"),
    ).toHaveLength(1);
  });

  it("reuses cached identity when only secrets are rotated (#133 / PR #158)", async () => {
    const calls = installDescribe(({ providerId }) => ({
      providerId,
      identity: "board.example/SAME",
    }));

    const trackerDescriptor: ProviderDescriptor = {
      id: "tracker-one",
      displayName: "Tracker One",
      roles: ["tracker"],
      iconRef: "icon-custom-tracker",
      capabilities: ["describeConnection"],
      configFields: [
        { name: "host", label: "Host", type: "url", required: true },
        {
          name: "apiToken",
          label: "API Token",
          type: "secret",
          required: true,
          secret: true,
        },
      ],
    };

    const client = makeClient();
    const first = renderProbe(
      client,
      targetsFor(
        { host: "https://board.example", apiToken: CONFIG_SECRET_MARKER },
        {},
      ),
      [trackerDescriptor],
    );
    await waitFor(() => {
      expect(first.getByTestId("identities").textContent).toContain(
        "board.example/SAME",
      );
    });
    first.unmount();

    const second = renderProbe(
      client,
      targetsFor(
        {
          host: "https://board.example",
          apiToken: EDITED_CONFIG_SECRET_MARKER,
        },
        {},
      ),
      [trackerDescriptor],
    );
    await waitFor(() => {
      expect(second.getByTestId("identities").textContent).toContain(
        "board.example/SAME",
      );
    });
    // Because secrets are stripped from connection fingerprinting via descriptor, rotating apiToken
    // leaves the cache key identical and avoids spurious re-queries (2 initial calls from first render, 0 new calls).
    expect(calls).toHaveLength(2);
    expect(
      calls.filter((c) => c.config.apiToken === EDITED_CONFIG_SECRET_MARKER),
    ).toHaveLength(0);
  });

  it("asks nothing for a role with no provider, and renders no identity for it", async () => {
    const calls = installDescribe(({ providerId }) => ({
      providerId,
      identity: "octo-org/rocket",
    }));

    const { getByTestId } = renderProbe(makeClient(), [
      { role: "tracker", providerId: null, config: {} },
      {
        role: "gitHost",
        providerId: "githost-one",
        config: { repo: "rocket" },
      },
    ]);

    await waitFor(() => {
      expect(getByTestId("identities").textContent).toContain(
        "octo-org/rocket",
      );
    });
    expect(calls).toHaveLength(1);
    expect(getByTestId("identities").textContent).toContain('"tracker":null');
  });

  it('answers null — never an error, never "null" — when the provider has no identity', async () => {
    installDescribe(({ providerId }) => ({ providerId, identity: null }));

    const { getByTestId } = renderProbe(
      makeClient(),
      targetsFor({ host: "https://board.example" }, { repo: "rocket" }),
    );

    await waitFor(() => {
      expect(getByTestId("identities").textContent).toBe(
        '{"tracker":null,"gitHost":null}',
      );
    });
  });

  it("answers null when the read fails, so a surface still renders", async () => {
    api.providers.describe = mock(async () => {
      throw new Error("describe unavailable");
    }) as never;

    const { getByTestId } = renderProbe(
      makeClient(),
      targetsFor({ host: "https://board.example" }, {}),
    );

    await waitFor(() => {
      expect(getByTestId("identities").textContent).toBe(
        '{"tracker":null,"gitHost":null}',
      );
    });
  });

  it("never puts the configuration — which carries credentials — in a query key", async () => {
    installDescribe(({ providerId }) => ({
      providerId,
      identity: "board.example/ROCK",
    }));

    const client = makeClient();
    const { getByTestId } = renderProbe(
      client,
      targetsFor(
        { host: "https://board.example", apiToken: CONFIG_SECRET_MARKER },
        {},
      ),
    );

    await waitFor(() => {
      expect(getByTestId("identities").textContent).toContain(
        "board.example/ROCK",
      );
    });
    const keys = JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    );
    expect(keys).not.toContain(CONFIG_SECRET_MARKER);
    expect(keys).toContain("identity");
  });
});

describe("the identity read is SECRET-FREE by construction (#133 correction 1)", () => {
  // The three shipped providers, as the manifest publishes them. The projection
  // is driven by the descriptor's own `secret` declarations, so this test uses
  // the REAL descriptors rather than a fixture: a provider that starts declaring
  // a field secret is covered here with no edit.
  const descriptors: ProviderDescriptor[] = [
    githubProvider,
    azureProvider,
    jiraProvider,
  ].map((provider) => {
    const descriptor = serializeProvider(provider);
    if (descriptor === null) {
      throw new Error(`no descriptor for ${provider.id}`);
    }
    return {
      ...descriptor,
      capabilities: [...descriptor.capabilities],
    } satisfies ProviderDescriptor;
  });

  const SECRET = "tok_identity_projection_marker_08af";

  /** Each provider's connection: its real coordinates AND its real credential. */
  const connections = [
    {
      providerId: "github",
      secretField: "token",
      config: { token: SECRET, repoOwner: "octo-org", repository: "rocket" },
      kept: { repoOwner: "octo-org", repository: "rocket" },
    },
    {
      providerId: "azure",
      secretField: "pat",
      config: {
        pat: SECRET,
        orgUrl: "https://dev.azure.com/acme",
        project: "MyProject",
      },
      kept: { orgUrl: "https://dev.azure.com/acme", project: "MyProject" },
    },
    {
      providerId: "jira",
      secretField: "apiToken",
      config: {
        apiToken: SECRET,
        host: "https://acme.atlassian.net",
        project: "ROCK",
      },
      kept: { host: "https://acme.atlassian.net", project: "ROCK" },
    },
  ];

  it.each(connections)(
    "sends only $providerId's non-secret fields — the credential stays in the draft",
    async (connection) => {
      const calls = installDescribe(({ providerId }) => ({
        providerId,
        identity: "described",
      }));

      // The target a surface builds from the configuration a user typed — the
      // credential included — through the ONE projection.
      const targets = [
        {
          role: "tracker" as const,
          providerId: connection.providerId,
          config: identityConfig(
            connection.providerId,
            connection.config,
            descriptors,
          ),
        },
      ];
      const { getByTestId } = renderProbe(makeClient(), targets);

      await waitFor(() => {
        expect(getByTestId("identities").textContent).toContain("described");
      });

      expect(calls).toHaveLength(1);
      const sent = calls[0]?.config ?? {};
      // What remains is exactly the connection's non-secret configuration…
      expect(sent).toEqual(connection.kept);
      // …so the credential, its field NAME, and the raw marker are all absent
      // from the request body the frontend actually sends.
      expect(sent).not.toHaveProperty(connection.secretField);
      expect(JSON.stringify(sent)).not.toContain(SECRET);
    },
  );

  it("sends NOTHING for a provider the manifest has not declared, rather than a configuration whose secrets are unknown", async () => {
    const calls = installDescribe(({ providerId }) => ({
      providerId,
      identity: null,
    }));

    const { getByTestId } = renderProbe(makeClient(), [
      {
        role: "tracker" as const,
        providerId: "not-in-the-manifest",
        config: identityConfig(
          "not-in-the-manifest",
          { host: "https://unknown.example", secret: SECRET },
          descriptors,
        ),
      },
    ]);

    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]?.config).toEqual({});
    expect(JSON.stringify(calls[0]?.config)).not.toContain(SECRET);
    expect(getByTestId("identities").textContent).toBe(
      '{"tracker":null,"gitHost":null}',
    );
  });
});

describe("deduplicate same-provider identity reads (PR #158 / #133)", () => {
  it("same provider + same secret-free config => one request (dual-role scenario)", async () => {
    const calls = installDescribe(({ providerId, config }) => ({
      providerId,
      identity: `${config.repoOwner}/${config.repository}`,
    }));

    const client = makeClient();
    const sharedConfig = { repoOwner: "octo-org", repository: "rocket" };
    const targets: ConnectionIdentityTarget[] = [
      { role: "tracker", providerId: "github", config: sharedConfig },
      { role: "gitHost", providerId: "github", config: sharedConfig },
    ];

    const { getByTestId } = renderProbe(client, targets);

    await waitFor(() => {
      expect(getByTestId("identities").textContent).toBe(
        '{"tracker":"octo-org/rocket","gitHost":"octo-org/rocket"}',
      );
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      providerId: "github",
      config: { repoOwner: "octo-org", repository: "rocket" },
    });
  });

  it("same provider + different config => two requests", async () => {
    const calls = installDescribe(({ providerId, config }) => ({
      providerId,
      identity: `${config.repoOwner}/${config.repository}`,
    }));

    const client = makeClient();
    const targets: ConnectionIdentityTarget[] = [
      {
        role: "tracker",
        providerId: "github",
        config: { repoOwner: "octo-org", repository: "issues-repo" },
      },
      {
        role: "gitHost",
        providerId: "github",
        config: { repoOwner: "octo-org", repository: "code-repo" },
      },
    ];

    const { getByTestId } = renderProbe(client, targets);

    await waitFor(() => {
      expect(getByTestId("identities").textContent).toBe(
        '{"tracker":"octo-org/issues-repo","gitHost":"octo-org/code-repo"}',
      );
    });

    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.config.repository).sort()).toEqual([
      "code-repo",
      "issues-repo",
    ]);
  });

  it("different providers => independent requests", async () => {
    const calls = installDescribe(({ providerId, config }) => ({
      providerId,
      identity:
        providerId === "jira"
          ? `${config.host}/${config.project}`
          : `${config.repoOwner}/${config.repository}`,
    }));

    const client = makeClient();
    const targets: ConnectionIdentityTarget[] = [
      {
        role: "tracker",
        providerId: "jira",
        config: { host: "jira.example", project: "ROCK" },
      },
      {
        role: "gitHost",
        providerId: "github",
        config: { repoOwner: "octo-org", repository: "rocket" },
      },
    ];

    const { getByTestId } = renderProbe(client, targets);

    await waitFor(() => {
      expect(getByTestId("identities").textContent).toBe(
        '{"tracker":"jira.example/ROCK","gitHost":"octo-org/rocket"}',
      );
    });

    expect(calls).toHaveLength(2);
    expect(calls.find((c) => c.providerId === "jira")?.config).toEqual({
      host: "jira.example",
      project: "ROCK",
    });
    expect(calls.find((c) => c.providerId === "github")?.config).toEqual({
      repoOwner: "octo-org",
      repository: "rocket",
    });
  });

  it("failed identity read remains non-blocking (non-throwing, answers null/plain display name)", async () => {
    const calls = installDescribe(({ providerId, config }) => {
      if (providerId === "failing-provider") {
        throw new Error("connection reset by peer");
      }
      return {
        providerId,
        identity: `${config.repoOwner}/${config.repository}`,
      };
    });

    const client = makeClient();
    const targets: ConnectionIdentityTarget[] = [
      {
        role: "tracker",
        providerId: "failing-provider",
        config: { host: "https://down.example" },
      },
      {
        role: "gitHost",
        providerId: "github",
        config: { repoOwner: "octo-org", repository: "rocket" },
      },
    ];

    const { getByTestId } = renderProbe(client, targets);

    await waitFor(() => {
      expect(getByTestId("identities").textContent).toBe(
        '{"tracker":null,"gitHost":"octo-org/rocket"}',
      );
    });

    expect(calls).toHaveLength(2);
  });

  it("preserves multi-line batching behavior with cross-line deduplication", async () => {
    const calls = installDescribe(({ providerId, config }) => ({
      providerId,
      identity:
        providerId === "github"
          ? `${config.repoOwner}/${config.repository}`
          : `${config.host}/${config.project}`,
    }));

    const client = makeClient();
    const sharedGitHub = { repoOwner: "octo-org", repository: "shared" };

    function MultiLineProbe({ lines }: { lines: readonly ConnectionLine[] }) {
      const results = useConnectionLines(lines);
      return (
        <span data-testid="multi-lines">
          {JSON.stringify(
            results.map((slots) =>
              Object.fromEntries(
                slots.map((s) => [s.role, s.identity ?? null]),
              ),
            ),
          )}
        </span>
      );
    }

    const lines: ConnectionLine[] = [
      // Line 1: dual-role github (shared)
      {
        slots: [
          { role: "tracker", state: "connected", providerId: "github" },
          { role: "gitHost", state: "connected", providerId: "github" },
        ],
        targets: [
          { role: "tracker", providerId: "github", config: sharedGitHub },
          { role: "gitHost", providerId: "github", config: sharedGitHub },
        ],
      },
      // Line 2: tracker is jira, gitHost is the same shared github
      {
        slots: [
          { role: "tracker", state: "connected", providerId: "jira" },
          { role: "gitHost", state: "connected", providerId: "github" },
        ],
        targets: [
          {
            role: "tracker",
            providerId: "jira",
            config: { host: "jira.example", project: "PROJ" },
          },
          { role: "gitHost", providerId: "github", config: sharedGitHub },
        ],
      },
    ];

    const { getByTestId } = render(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(MultiLineProbe, { lines }),
      ),
    );

    await waitFor(() => {
      expect(getByTestId("multi-lines").textContent).toBe(
        JSON.stringify([
          { tracker: "octo-org/shared", gitHost: "octo-org/shared" },
          { tracker: "jira.example/PROJ", gitHost: "octo-org/shared" },
        ]),
      );
    });

    // Despite 4 total targets across 2 lines (3 github targets + 1 jira target),
    // there are only 2 unique configurations: github(shared) and jira(PROJ).
    expect(calls).toHaveLength(2);
  });
});
