// test/connection-combo-line.test.tsx — THE connection combo line
// (spec #133, tickets #146/#147; collapsed into one rendering by #148).
//
// One presentational component reports the selected tracker and git host on
// every surface that shows a project's connections: the wizard's Review step
// (draft verification evidence, derived here through the ONE connection view,
// #176) and the post-creation project surfaces (persisted connections, exercised
// by test/post-creation-surfacing.test.tsx). It is driven by the providers
// manifest descriptor, so a provider the component has never heard of renders
// correctly — there is no id → name table anywhere.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { ConnectionComboLine } from "../src/frontend/components/connections/ConnectionComboLine.js";
import {
  type ConnectionComboSlot,
  type ConnectionEvidence,
  type ConnectionIdentities,
  comboTone,
  withConnectionIdentities,
} from "../src/frontend/components/connections/connection-state.js";
import {
  connectionComboSlots,
  connectionViewSlots,
  deriveConnectionView,
} from "../src/frontend/components/connections/connection-view.js";
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
    unconfirmedCapabilities: [],
    ...overrides,
  };
}

/**
 * The line's slots the way the producers build them: through the ONE
 * connection view's DRAFT input (#176), over THE one role list.
 */
function draftSlots(
  tracker: ConnectionEvidence,
  gitHost: ConnectionEvidence,
): ConnectionComboSlot[] {
  return connectionComboSlots(
    connectionViewSlots(
      deriveConnectionView({ kind: "draft", evidence: { tracker, gitHost } }),
    ),
  );
}

/** Renders the line the way the wizard's Review step does: from draft evidence. */
function renderCombo(overrides: {
  tracker?: Partial<ConnectionEvidence> & { providerId: string | null };
  gitHost?: Partial<ConnectionEvidence> & { providerId: string | null };
}) {
  const slots = draftSlots(
    evidence(overrides.tracker ?? { providerId: "quasar-board" }),
    evidence(overrides.gitHost ?? { providerId: "nimbus-forge" }),
  );
  render(
    <ConnectionComboLine
      id="combo-summary"
      slots={slots}
      tone={comboTone(slots, ["tracker", "gitHost"])}
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

  it("reports a verified connection with warnings as DEGRADED, with no accepted sub-state", () => {
    renderCombo({
      gitHost: {
        providerId: "tandem",
        verified: true,
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

  it("labels a degraded role identically with or without unconfirmed capabilities listed the same way", () => {
    renderCombo({
      tracker: {
        providerId: "tandem",
        verified: true,
        unconfirmedCapabilities: ["listTickets"],
      },
    });

    // One label per state, for every producer: no acknowledged/unacknowledged
    // split, because a degraded connection is never gated on an acknowledgement.
    expect(getEl("combo-tracker-state").textContent).toBe(
      CONNECTIONS_COPY.stateLabel.degraded,
    );
    expect(getEl("combo-tracker-state").dataset.connectionState).toBe(
      "degraded",
    );
  });

  it("tones a degraded line as a warning, and a disconnected line as an error", () => {
    renderCombo({
      gitHost: { providerId: "nimbus-forge", verified: false },
    });

    const line = getEl("combo-summary");
    expect(line.classList.contains("connection-combo-line--error")).toBe(true);
    expect(line.classList.contains("connection-combo-line--warning")).toBe(
      false,
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
    const slots = draftSlots(
      evidence({ providerId: "gitlab-later" }),
      evidence({ providerId: "gitlab-later" }),
    );
    render(
      <ConnectionComboLine
        slots={slots}
        tone={comboTone(slots, ["tracker", "gitHost"])}
        descriptors={[unseen]}
      />,
    );

    expect(document.body.textContent).toContain("GitLab Issues");
    expect(document.body.textContent).not.toContain("gitlab-later");
  });

  it("restricts the rendered slots to the roles the surface asks for", () => {
    const slots = draftSlots(
      evidence({ providerId: "quasar-board" }),
      evidence({ providerId: "nimbus-forge" }),
    );
    render(
      <ConnectionComboLine
        slots={slots}
        tone={comboTone(slots, ["tracker", "gitHost"])}
        descriptors={MANIFEST}
        roles={["tracker"]}
      />,
    );

    expect(document.getElementById("combo-tracker")).not.toBeNull();
    expect(document.getElementById("combo-gitHost")).toBeNull();
  });

  // ─── Provider-owned identity (#133 story 34) ────────────────────────────────
  //
  // The line renders `displayName (identity)` when a surface hands it one, and the
  // plain display name otherwise. It never derives an identity itself, so these
  // tests drive it exactly the way the producers do: slots with an identity
  // attached, and slots without one.

  describe("ConnectionComboLine — provider-owned identity", () => {
    afterEach(() => {
      cleanup();
    });

    afterAll(async () => {
      await unregisterHappyDom();
    });

    /** The line as a producer renders it: two slots, optionally given identities. */
    function renderWithIdentities(
      identities: ConnectionIdentities | undefined,
    ) {
      const slots = withConnectionIdentities(
        draftSlots(
          evidence({ providerId: "quasar-board" }),
          evidence({ providerId: "nimbus-forge" }),
        ),
        identities,
      );
      render(
        <ConnectionComboLine
          id="combo-summary"
          slots={slots}
          tone={comboTone(slots, ["tracker", "gitHost"])}
          descriptors={MANIFEST}
        />,
      );
    }

    it("renders displayName (identity) for each role that has one", () => {
      renderWithIdentities({
        tracker: "board.example/ROCK",
        gitHost: "octo-org/rocket",
      });

      expect(getEl("combo-tracker-name").textContent).toBe(
        "Quasar Board (board.example/ROCK)",
      );
      expect(getEl("combo-gitHost-name").textContent).toBe(
        "Nimbus Forge (octo-org/rocket)",
      );
      // The provider ids stay machine names a user never reads.
      expect(getEl("combo-summary").textContent).not.toContain("quasar-board");
      expect(getEl("combo-summary").textContent).not.toContain("nimbus-forge");
    });

    it("renders the plain display name when the identity is null, empty or absent", () => {
      renderWithIdentities({ tracker: null, gitHost: "   " });

      expect(getEl("combo-tracker-name").textContent).toBe("Quasar Board");
      expect(getEl("combo-gitHost-name").textContent).toBe("Nimbus Forge");
      // Never the string "null", and never empty parentheses.
      expect(getEl("combo-summary").textContent).not.toContain("null");
      expect(getEl("combo-summary").textContent).not.toContain("()");
    });

    it("renders the plain display name when the producer has no identity at all", () => {
      renderWithIdentities(undefined);

      expect(getEl("combo-tracker-name").textContent).toBe("Quasar Board");
      expect(getEl("combo-gitHost-name").textContent).toBe("Nimbus Forge");
      expect(getEl("combo-summary").textContent).not.toContain("null");
    });

    it("keeps notRecorded for a role with no provider id, whatever the identity map holds", () => {
      const slots = withConnectionIdentities(
        draftSlots(
          evidence({ providerId: null }),
          evidence({ providerId: "nimbus-forge" }),
        ),
        { tracker: "board.example/ROCK", gitHost: null },
      );
      render(
        <ConnectionComboLine
          id="combo-summary"
          slots={slots}
          tone={comboTone(slots, [])}
          descriptors={MANIFEST}
        />,
      );

      expect(getEl("combo-tracker-name").textContent).toBe(
        CONNECTIONS_COPY.notRecorded,
      );
    });

    it("shows one connection's identity under BOTH roles it serves (#133 dual role)", () => {
      // One provider serving both roles: the surfaces hand the SAME identity to
      // both slots, and the line renders one connection, not two.
      const shared = "tandem.example/team/rocket";
      const slots = withConnectionIdentities(
        draftSlots(
          evidence({ providerId: "tandem" }),
          evidence({ providerId: "tandem" }),
        ),
        { tracker: shared, gitHost: shared },
      );
      render(
        <ConnectionComboLine
          id="combo-summary"
          slots={slots}
          tone={comboTone(slots, ["tracker", "gitHost"])}
          descriptors={MANIFEST}
        />,
      );

      expect(getEl("combo-tracker-name").textContent).toBe(
        `Tandem Suite (${shared})`,
      );
      expect(getEl("combo-gitHost-name").textContent).toBe(
        `Tandem Suite (${shared})`,
      );
      // One connection, rendered as the line's two role slots — never doubled.
      expect(document.querySelectorAll(".connection-combo-slot")).toHaveLength(
        2,
      );
    });
  });
});
