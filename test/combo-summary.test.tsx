// test/combo-summary.test.tsx — The shared connection combo line
// (spec #133, ticket #146).
//
// One presentational component reports the selected tracker and git host on
// every surface that shows a project's connections (the wizard today, the
// post-creation project surfaces tomorrow). It is driven by the providers
// manifest descriptor, so a provider the component has never heard of renders
// correctly — there is no id → name table anywhere.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { ComboSummary } from "../src/frontend/components/connections/ComboSummary.js";
import type { ConnectionEvidence } from "../src/frontend/components/connections/connection-state.js";
import { CONNECTION_STATE_COPY } from "../src/frontend/components/feedback/copy-map.js";
import type { ProviderDescriptor } from "../src/frontend/connection/types.js";

const MANIFEST: ProviderDescriptor[] = [
  {
    id: "quasar-board",
    displayName: "Quasar Board",
    roles: ["tracker"],
    iconRef: "icon-quasar",
    capabilities: ["listTickets"],
    configFields: [],
  },
  {
    id: "nimbus-forge",
    displayName: "Nimbus Forge",
    roles: ["gitHost"],
    iconRef: "icon-nimbus",
    capabilities: ["listRepositories"],
    configFields: [],
  },
  {
    id: "tandem",
    displayName: "Tandem Suite",
    roles: ["tracker", "gitHost"],
    iconRef: "icon-tandem",
    capabilities: ["listTickets", "listRepositories"],
    configFields: [],
  },
];

function getEl<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
}

/** A connection's verification evidence, as the wizard state carries it. */
function evidence(
  overrides: Partial<ConnectionEvidence> & { providerId: string | null },
): ConnectionEvidence {
  return {
    verified: true,
    degradedAccepted: false,
    unconfirmedCapabilities: [],
    ...overrides,
  };
}

function renderCombo(overrides: {
  tracker?: Partial<ConnectionEvidence> & { providerId: string | null };
  gitHost?: Partial<ConnectionEvidence> & { providerId: string | null };
}) {
  render(
    <ComboSummary
      manifest={MANIFEST}
      tracker={evidence(overrides.tracker ?? { providerId: "quasar-board" })}
      gitHost={evidence(overrides.gitHost ?? { providerId: "nimbus-forge" })}
    />,
  );
}

describe("ComboSummary — one line, three states per role", () => {
  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterHappyDom();
  });

  it("renders the descriptor display name for each role, never the raw provider id", () => {
    renderCombo({});

    expect(getEl("combo-summary")).not.toBeNull();
    expect(getEl("combo-tracker-name").textContent).toBe("Quasar Board");
    expect(getEl("combo-gitHost-name").textContent).toBe("Nimbus Forge");
    expect(getEl("combo-tracker-state").textContent).toBe(
      CONNECTION_STATE_COPY.connected,
    );
    expect(getEl("combo-gitHost-state").textContent).toBe(
      CONNECTION_STATE_COPY.connected,
    );
    // The ids are machine names; a user never sees them.
    expect(getEl("combo-summary").textContent).not.toContain("quasar-board");
    expect(getEl("combo-summary").textContent).not.toContain("nimbus-forge");
  });

  it("reports a verified connection with warnings as DEGRADED, distinguishing accepted from outstanding", () => {
    renderCombo({
      gitHost: {
        providerId: "tandem",
        verified: true,
        degradedAccepted: false,
        unconfirmedCapabilities: ["listRepositories"],
      },
    });

    expect(getEl("combo-gitHost-name").textContent).toBe("Tandem Suite");
    expect(getEl("combo-gitHost-state").textContent).toBe(
      CONNECTION_STATE_COPY.degraded,
    );
    expect(getEl("combo-gitHost-state").dataset.connectionState).toBe(
      "degraded",
    );
  });

  it("reports a degraded connection whose warnings were accepted as accepted", () => {
    renderCombo({
      tracker: {
        providerId: "tandem",
        verified: true,
        degradedAccepted: true,
        unconfirmedCapabilities: ["listTickets"],
      },
    });

    expect(getEl("combo-tracker-state").textContent).toBe(
      CONNECTION_STATE_COPY.degradedAccepted,
    );
    expect(getEl("combo-tracker-state").dataset.connectionState).toBe(
      "degraded",
    );
  });

  it("reports an unselected or unverified role as DISCONNECTED rather than naming a provider", () => {
    renderCombo({ tracker: { providerId: null, verified: false } });

    expect(getEl("combo-tracker-state").textContent).toBe(
      CONNECTION_STATE_COPY.disconnected,
    );
    expect(getEl("combo-tracker-state").dataset.connectionState).toBe(
      "disconnected",
    );
    expect(getEl("combo-tracker-name").textContent).toBe(
      CONNECTION_STATE_COPY.disconnected,
    );
  });

  it("reports a connection with a provider selected but no verification in this session as DISCONNECTED", () => {
    renderCombo({ gitHost: { providerId: "nimbus-forge", verified: false } });

    expect(getEl("combo-gitHost-state").dataset.connectionState).toBe(
      "disconnected",
    );
  });
});
