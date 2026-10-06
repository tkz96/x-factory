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
} from "../src/frontend/components/connections/connection-state.js";
import { useConnectionIdentities } from "../src/frontend/hooks/useConnectionIdentity.js";
import { api } from "../src/frontend/lib/api-client.js";

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
}: {
  targets: readonly ConnectionIdentityTarget[];
}) {
  const lookup = useConnectionIdentities(targets);
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
) {
  return render(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(IdentityProbe, { targets }),
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
        config.apiToken === CONFIG_SECRET_MARKER
          ? "board.example/OLD"
          : "board.example/NEW",
    }));

    const client = makeClient();
    const first = renderProbe(
      client,
      targetsFor(
        { host: "https://board.example", apiToken: CONFIG_SECRET_MARKER },
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
          host: "https://board.example",
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
      calls.filter(
        (call) => call.config.apiToken === EDITED_CONFIG_SECRET_MARKER,
      ),
    ).toHaveLength(1);
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
