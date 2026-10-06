// test/role-connection-hook.test.tsx — The verification lifecycle of ONE card
// (correction 1, #133), driven at the hook level.
//
// These are the card's own rules, unreachable from a rendered wizard because its
// Verify button is disabled while an attempt is pending:
//
//   * the NEWEST attempt on a card is the one that speaks. A superseded attempt
//     — still in flight when the user asks again — must not write the local
//     payload, must not record evidence, and must not clear `isPending` for the
//     attempt that replaced it;
//   * evidence is recorded through `RECORD_VERIFICATION`, carrying the
//     configuration generation the attempt asked about, read from the wizard
//     STATE. The reducer decides whether that generation is still current (its
//     own tests prove the cross-card discard); this file proves the hook sends
//     the right token and patches nothing directly.

/// <reference lib="dom" />

import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import React from "react";
import type { VerificationResult } from "../src/frontend/connection/types.js";
import { api } from "../src/frontend/lib/api-client.js";
import { useRoleConnection } from "../src/frontend/wizard/steps/useRoleConnection.js";
import type {
  WizardAction,
  WizardConnectState,
} from "../src/frontend/wizard/types.js";

const ORIGINAL_VERIFY = api.providers.verify;

const connectState: WizardConnectState = {
  quickUrl: "",
  providerConfigs: { "generic-githost": { gitUrl: "https://git.example" } },
  providerConfigGenerations: { "generic-githost": 3 },
  tracker: { providerId: null, verified: false },
  gitHost: { providerId: "generic-githost", verified: false },
};

interface Probe {
  verify: () => Promise<void>;
  isPending: boolean;
  status: string;
  error: unknown;
}

/** Renders ONE card's connection hook and exposes what it reports. */
function RoleProbe({
  onRender,
  dispatch,
}: {
  onRender: (probe: Probe) => void;
  dispatch: (action: WizardAction) => void;
}) {
  const connection = useRoleConnection(
    "gitHost",
    connectState,
    dispatch,
    () => {},
  );
  onRender({
    verify: connection.verify,
    isPending: connection.isPending,
    status: connection.status,
    error: connection.error,
  });
  return null;
}

/** Renders the probe and returns a live view of the hook's answers. */
function renderRoleHook() {
  const actions: WizardAction[] = [];
  let current: Probe | undefined;
  render(
    React.createElement(RoleProbe, {
      onRender: (probe: Probe) => {
        current = probe;
      },
      dispatch: (action: WizardAction) => {
        actions.push(action);
      },
    }),
  );
  return {
    actions,
    probe: () => {
      if (current === undefined) throw new Error("the hook has not rendered");
      return current;
    },
  };
}

afterEach(() => {
  api.providers.verify = ORIGINAL_VERIFY;
  cleanup();
});

afterAll(async () => {
  await unregisterHappyDom();
});

describe("useRoleConnection — the verification lifecycle of one card (#133 CORR-1)", () => {
  it("asks about the provider's CURRENT configuration generation, read from the wizard state", async () => {
    const { actions, probe } = renderRoleHook();
    const verifyMock = mock(
      async (_payload: {
        providerId: string;
        role: string;
        config: Record<string, unknown>;
      }) => ({ status: "ok" as const, warnings: [] }),
    );
    api.providers.verify = verifyMock as never;

    await act(async () => {
      await probe().verify();
    });

    // The request carried the provider's configuration as it is on record…
    expect(verifyMock.mock.calls).toHaveLength(1);
    expect(verifyMock.mock.calls[0]?.[0]).toMatchObject({
      providerId: "generic-githost",
      role: "gitHost",
      config: { gitUrl: "https://git.example" },
    });

    // …and the evidence was recorded through the dedicated action, carrying the
    // generation the reducer validates. The card never patches state directly:
    // there is no generic UPDATE_CONNECT action left to reach for.
    const recorded = actions.find((a) => a.type === "RECORD_VERIFICATION");
    expect(recorded).toMatchObject({
      type: "RECORD_VERIFICATION",
      role: "gitHost",
      providerId: "generic-githost",
      generation: 3,
      verified: true,
      unconfirmedCapabilities: [],
    });
    expect(actions.map((a) => a.type)).not.toContain("UPDATE_CONNECT");
  });

  it("discards a superseded attempt: only the NEWEST answer is shown, and only it is recorded", async () => {
    const resolvers: Array<(value: VerificationResult) => void> = [];
    api.providers.verify = mock(
      async () =>
        new Promise<VerificationResult>((resolve) => {
          resolvers.push(resolve);
        }),
    ) as never;

    const { actions, probe } = renderRoleHook();

    // Two attempts on the SAME configuration, both in flight.
    await act(async () => {
      void probe().verify();
      void probe().verify();
    });
    expect(resolvers).toHaveLength(2);
    expect(probe().isPending).toBe(true);

    // The FIRST answers `ok`. It is not the question on screen any more: no
    // payload, no evidence, and the newest attempt is still pending.
    await act(async () => {
      resolvers[0]?.({ status: "ok", warnings: [] });
    });
    expect(probe().isPending).toBe(true);
    expect(probe().status).toBe("pending");
    expect(
      actions.filter((a) => a.type === "RECORD_VERIFICATION"),
    ).toHaveLength(0);

    // The SECOND answers, and ITS outcome is the one the card reports.
    await act(async () => {
      resolvers[1]?.({ status: "degraded", warnings: [] });
    });
    expect(probe().isPending).toBe(false);
    const recorded = actions.filter((a) => a.type === "RECORD_VERIFICATION");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ generation: 3, verified: true });
  });

  it("sends the capabilities the provider could not confirm as the recorded evidence", async () => {
    api.providers.verify = mock(async () => ({
      status: "degraded" as const,
      warnings: [
        { kind: "CAPABILITY_UNCONFIRMED" as const, capability: "listTickets" },
        { kind: "CAPABILITY_UNCONFIRMED" as const, capability: "verifyScopes" },
      ],
    })) as never;

    const { actions, probe } = renderRoleHook();
    await act(async () => {
      await probe().verify();
    });

    const recorded = actions.find((a) => a.type === "RECORD_VERIFICATION");
    expect(recorded).toMatchObject({
      verified: true,
      unconfirmedCapabilities: ["listTickets", "verifyScopes"],
    });
    // The card's DISPLAY of a degraded outcome is derived from that evidence by
    // the reducer in a real wizard (`deriveVerificationStatus`), which the
    // rendered surfaces prove; this probe records the dispatch instead, and its
    // own evidence never becomes verified, so the card reports nothing yet.
    expect(probe().status).toBe("idle");
    expect(probe().error).toBeNull();
  });
});
