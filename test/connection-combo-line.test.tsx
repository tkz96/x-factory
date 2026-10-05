// test/connection-combo-line.test.tsx — THE connection combo line
// (spec #133, tickets #146/#147; collapsed into one rendering by #148).
//
// One presentational component reports the selected tracker and git host on
// every surface that shows a project's connections: the wizard's Review step
// (draft verification evidence, the producer exercised here) and the
// post-creation project surfaces (persisted connections, exercised by
// test/post-creation-surfacing.test.tsx). It is driven by the providers
// manifest descriptor, so a provider the component has never heard of renders
// correctly — there is no id → name table anywhere.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { ConnectionComboLine } from "../src/frontend/components/connections/ConnectionComboLine.js";
import {
  type ConnectionEvidence,
  comboEvidenceTone,
  comboSlotFromEvidence,
} from "../src/frontend/components/connections/connection-state.js";
import { CONNECTIONS_COPY } from "../src/frontend/components/feedback/copy-map.js";
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

/** Renders the line the way the wizard's Review step does: from draft evidence. */
function renderCombo(overrides: {
  tracker?: Partial<ConnectionEvidence> & { providerId: string | null };
  gitHost?: Partial<ConnectionEvidence> & { providerId: string | null };
}) {
  const slots = [
    comboSlotFromEvidence(
      "tracker",
      evidence(overrides.tracker ?? { providerId: "quasar-board" }),
    ),
    comboSlotFromEvidence(
      "gitHost",
      evidence(overrides.gitHost ?? { providerId: "nimbus-forge" }),
    ),
  ];
  render(
    <ConnectionComboLine
      id="combo-summary"
      slots={slots}
      tone={comboEvidenceTone(slots)}
      descriptors={MANIFEST}
    />,
  );
}

describe("ConnectionComboLine — one line, three states per role", () => {
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
      CONNECTIONS_COPY.stateLabel.connected,
    );
    expect(getEl("combo-gitHost-state").textContent).toBe(
      CONNECTIONS_COPY.stateLabel.connected,
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
      CONNECTIONS_COPY.stateLabel.degraded,
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
      CONNECTIONS_COPY.stateLabel.degradedAccepted,
    );
    expect(getEl("combo-tracker-state").dataset.connectionState).toBe(
      "degraded",
    );
  });

  it("reports an unselected or unverified role as DISCONNECTED rather than naming a provider", () => {
    renderCombo({ tracker: { providerId: null, verified: false } });

    expect(getEl("combo-tracker-state").textContent).toBe(
      CONNECTIONS_COPY.stateLabel.disconnected,
    );
    expect(getEl("combo-tracker-state").dataset.connectionState).toBe(
      "disconnected",
    );
    expect(getEl("combo-tracker-name").textContent).toBe(
      CONNECTIONS_COPY.notRecorded,
    );
    // A role that is not connected is the line's error tone — never silent.
    expect(
      getEl("combo-summary").classList.contains("connection-combo-line--error"),
    ).toBe(true);
  });

  it("reports a connection with a provider selected but no verification in this session as DISCONNECTED", () => {
    renderCombo({ gitHost: { providerId: "nimbus-forge", verified: false } });

    expect(getEl("combo-gitHost-state").dataset.connectionState).toBe(
      "disconnected",
    );
  });

  it("tones a degraded line as a warning, never as an error", () => {
    renderCombo({
      gitHost: {
        providerId: "tandem",
        verified: true,
        degradedAccepted: false,
        unconfirmedCapabilities: ["listRepositories"],
      },
    });

    const line = getEl("combo-summary");
    expect(line.classList.contains("connection-combo-line--warning")).toBe(
      true,
    );
    expect(line.classList.contains("connection-combo-line--error")).toBe(false);
  });

  it("resolves a provider the component has never heard of from the manifest alone", () => {
    const unseen: ProviderDescriptor = {
      id: "gitlab-later",
      displayName: "GitLab Issues",
      roles: ["tracker", "gitHost"],
      iconRef: "icon-gitlab",
      capabilities: ["listTickets", "listRepositories"],
      configFields: [],
    };
    const slots = [
      comboSlotFromEvidence(
        "tracker",
        evidence({ providerId: "gitlab-later" }),
      ),
      comboSlotFromEvidence(
        "gitHost",
        evidence({ providerId: "gitlab-later" }),
      ),
    ];
    render(
      <ConnectionComboLine
        slots={slots}
        tone={comboEvidenceTone(slots)}
        descriptors={[unseen]}
      />,
    );

    expect(document.body.textContent).toContain("GitLab Issues");
    expect(document.body.textContent).not.toContain("gitlab-later");
  });

  it("restricts the rendered slots to the roles the surface asks for", () => {
    const slots = [
      comboSlotFromEvidence(
        "tracker",
        evidence({ providerId: "quasar-board" }),
      ),
      comboSlotFromEvidence(
        "gitHost",
        evidence({ providerId: "nimbus-forge" }),
      ),
    ];
    render(
      <ConnectionComboLine
        slots={slots}
        tone={comboEvidenceTone(slots)}
        descriptors={MANIFEST}
        roles={["tracker"]}
      />,
    );

    expect(document.getElementById("combo-tracker")).not.toBeNull();
    expect(document.getElementById("combo-gitHost")).toBeNull();
  });
});
