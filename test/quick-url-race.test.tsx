// test/quick-url-race.test.tsx — Deterministic regression tests for Quick-URL async race handling & generation discipline (#133, #158).

/// <reference lib="dom" />

import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import React from "react";
import type {
  ParseUrlResult,
  ProviderDescriptor,
} from "../src/frontend/connection/types.js";
import { api } from "../src/frontend/lib/api-client.js";
import { useQuickUrlIntake } from "../src/frontend/wizard/steps/useQuickUrlIntake.js";
import type {
  WizardAction,
  WizardConnectionRole,
} from "../src/frontend/wizard/types.js";

const ORIGINAL_PARSE_URL = api.providers.parseUrl;

const sampleManifest: ProviderDescriptor[] = [
  {
    id: "github-provider",
    displayName: "GitHub",
    roles: ["gitHost"],
    iconRef: "icon-github",
    capabilities: ["listRepositories", "createPullRequest"],
    configFields: [],
  },
  {
    id: "jira-provider",
    displayName: "Jira",
    roles: ["tracker"],
    iconRef: "icon-jira",
    capabilities: ["listTickets"],
    configFields: [],
  },
];

interface QuickUrlProbe {
  quickUrl: string;
  setQuickUrl: (val: string) => void;
  isParsingUrl: boolean;
  quickUrlMissMessage: string | null;
  handleQuickUrlSubmit: (url: string) => Promise<void>;
  bumpParseGeneration: () => void;
}

function ProbeComponent({
  probeRef,
  manifest,
  basicsName,
  dispatch,
  updateBasics,
  onResetVerifications,
  parseGenRef,
}: {
  probeRef: { current: QuickUrlProbe | undefined };
  manifest: ProviderDescriptor[];
  basicsName: string;
  dispatch: (action: WizardAction) => void;
  updateBasics: (patch: { name: string; id: string }) => void;
  onResetVerifications: (roles: WizardConnectionRole[]) => void;
  parseGenRef?: React.MutableRefObject<number> | undefined;
}) {
  const result = useQuickUrlIntake({
    initialUrl: "",
    manifest,
    basicsName,
    dispatch,
    updateBasics,
    onResetVerifications,
    parseGenRef,
  });

  React.useEffect(() => {
    probeRef.current = result;
  });

  return null;
}

function renderQuickUrlHook(options?: {
  manifest?: ProviderDescriptor[];
  basicsName?: string;
  parseGenRef?: React.MutableRefObject<number>;
}) {
  const actions: WizardAction[] = [];
  const basicsUpdates: Array<{ name: string; id: string }> = [];
  const resetVerifications: WizardConnectionRole[][] = [];
  const probeRef: { current: QuickUrlProbe | undefined } = {
    current: undefined,
  };

  render(
    React.createElement(ProbeComponent, {
      probeRef,
      manifest: options?.manifest ?? sampleManifest,
      basicsName: options?.basicsName ?? "",
      dispatch: (action: WizardAction) => {
        actions.push(action);
      },
      updateBasics: (patch: { name: string; id: string }) => {
        basicsUpdates.push(patch);
      },
      onResetVerifications: (roles: WizardConnectionRole[]) => {
        resetVerifications.push(roles);
      },
      parseGenRef: options?.parseGenRef,
    }),
  );

  return {
    actions,
    basicsUpdates,
    resetVerifications,
    probe: () => {
      if (probeRef.current === undefined) {
        throw new Error("Probe has not rendered");
      }
      return probeRef.current;
    },
  };
}

afterEach(() => {
  api.providers.parseUrl = ORIGINAL_PARSE_URL;
  cleanup();
});

afterAll(async () => {
  await unregisterHappyDom();
});

describe("useQuickUrlIntake — async race condition & generation discipline (#133, #158)", () => {
  it("when request A starts and then request B starts, A resolving does NOT clear isParsingUrl while B is active", async () => {
    let resolveA!: (val: ParseUrlResult) => void;
    let resolveB!: (val: ParseUrlResult) => void;

    const promiseA = new Promise<ParseUrlResult>((resolve) => {
      resolveA = resolve;
    });
    const promiseB = new Promise<ParseUrlResult>((resolve) => {
      resolveB = resolve;
    });

    let callCount = 0;
    api.providers.parseUrl = mock(async () => {
      callCount += 1;
      if (callCount === 1) return promiseA;
      return promiseB;
    }) as never;

    const { actions, probe } = renderQuickUrlHook();

    // Trigger request A
    act(() => {
      void probe().handleQuickUrlSubmit("https://github.com/org/repo-a");
    });
    expect(probe().isParsingUrl).toBe(true);

    // Trigger request B while A is in flight
    act(() => {
      void probe().handleQuickUrlSubmit(
        "https://jira.example.com/browse/PROJ-1",
      );
    });
    expect(probe().isParsingUrl).toBe(true);

    // Request A resolves. A must NOT clear isParsingUrl because B is still active!
    await act(async () => {
      resolveA({
        matched: true,
        providerId: "github-provider",
        configDraft: { url: "https://github.com/org/repo-a" },
        inferredName: "repo-a",
      });
    });

    // PENDING STATE PRESERVED: isParsingUrl is STILL true!
    expect(probe().isParsingUrl).toBe(true);
    // Request A was superseded, so no action was dispatched for A
    expect(actions).toHaveLength(0);

    // Now Request B resolves
    await act(async () => {
      resolveB({
        matched: true,
        providerId: "jira-provider",
        configDraft: { url: "https://jira.example.com" },
        inferredName: "PROJ-1",
      });
    });

    // B alone controls the final pending state and clears it
    expect(probe().isParsingUrl).toBe(false);
    // B's result alone is dispatched
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: "APPLY_PROVIDER_MATCH",
      providerId: "jira-provider",
      url: "https://jira.example.com/browse/PROJ-1",
    });
  });

  it("when request A starts and then request B starts, A rejecting does NOT clear isParsingUrl or set error message", async () => {
    let rejectA!: (err: Error) => void;
    let resolveB!: (val: ParseUrlResult) => void;

    const promiseA = new Promise<ParseUrlResult>((_, reject) => {
      rejectA = reject;
    });
    const promiseB = new Promise<ParseUrlResult>((resolve) => {
      resolveB = resolve;
    });

    let callCount = 0;
    api.providers.parseUrl = mock(async () => {
      callCount += 1;
      if (callCount === 1) return promiseA;
      return promiseB;
    }) as never;

    const { actions, probe } = renderQuickUrlHook();

    // Request A starts
    act(() => {
      void probe().handleQuickUrlSubmit("https://flaky-network.com/a");
    });
    expect(probe().isParsingUrl).toBe(true);

    // Request B starts
    act(() => {
      void probe().handleQuickUrlSubmit("https://github.com/org/repo-b");
    });
    expect(probe().isParsingUrl).toBe(true);

    // Request A rejects with a network error
    await act(async () => {
      rejectA(new Error("Network connection dropped"));
    });

    // A rejecting must NOT clear isParsingUrl and must NOT display error message!
    expect(probe().isParsingUrl).toBe(true);
    expect(probe().quickUrlMissMessage).toBeNull();
    expect(actions).toHaveLength(0);

    // Request B resolves successfully
    await act(async () => {
      resolveB({
        matched: true,
        providerId: "github-provider",
        configDraft: {},
        inferredName: "repo-b",
      });
    });

    expect(probe().isParsingUrl).toBe(false);
    expect(probe().quickUrlMissMessage).toBeNull();
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: "APPLY_PROVIDER_MATCH",
      providerId: "github-provider",
    });
  });

  it("when newer request B completes before older request A, late A does not overwrite state or re-enable pending", async () => {
    let resolveA!: (val: ParseUrlResult) => void;
    let resolveB!: (val: ParseUrlResult) => void;

    const promiseA = new Promise<ParseUrlResult>((resolve) => {
      resolveA = resolve;
    });
    const promiseB = new Promise<ParseUrlResult>((resolve) => {
      resolveB = resolve;
    });

    let callCount = 0;
    api.providers.parseUrl = mock(async () => {
      callCount += 1;
      if (callCount === 1) return promiseA;
      return promiseB;
    }) as never;

    const { actions, probe } = renderQuickUrlHook();

    act(() => {
      void probe().handleQuickUrlSubmit("https://slow-request.com/a");
    });
    act(() => {
      void probe().handleQuickUrlSubmit("https://fast-request.com/b");
    });
    expect(probe().isParsingUrl).toBe(true);

    // B finishes FIRST
    await act(async () => {
      resolveB({
        matched: true,
        providerId: "jira-provider",
        configDraft: {},
      });
    });

    expect(probe().isParsingUrl).toBe(false);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ providerId: "jira-provider" });

    // Slow A finishes later
    await act(async () => {
      resolveA({
        matched: true,
        providerId: "github-provider",
        configDraft: {},
      });
    });

    // Late A does NOT set isParsingUrl back to false (or true), does NOT dispatch, does NOT overwrite
    expect(probe().isParsingUrl).toBe(false);
    expect(actions).toHaveLength(1);
  });

  it("when bumpParseGeneration is called to cancel in-flight parse, transient state is cleared immediately", async () => {
    let resolveA!: (val: ParseUrlResult) => void;
    const promiseA = new Promise<ParseUrlResult>((resolve) => {
      resolveA = resolve;
    });
    api.providers.parseUrl = mock(async () => promiseA) as never;

    const { actions, probe } = renderQuickUrlHook();

    act(() => {
      void probe().handleQuickUrlSubmit("https://github.com/org/repo-cancel");
    });
    expect(probe().isParsingUrl).toBe(true);

    // Manual cancellation via bumpParseGeneration()
    act(() => {
      probe().bumpParseGeneration();
    });

    // Transient state immediately cleaned up
    expect(probe().isParsingUrl).toBe(false);
    expect(probe().quickUrlMissMessage).toBeNull();

    // In-flight parse resolves later
    await act(async () => {
      resolveA({
        matched: true,
        providerId: "github-provider",
        configDraft: {},
      });
    });

    // Result discarded, no dispatch, isParsingUrl remains false
    expect(probe().isParsingUrl).toBe(false);
    expect(actions).toHaveLength(0);
  });

  it("stale miss and error messages do not overwrite newer active request state", async () => {
    let resolveA!: (val: ParseUrlResult) => void;
    let resolveB!: (val: ParseUrlResult) => void;

    const promiseA = new Promise<ParseUrlResult>((resolve) => {
      resolveA = resolve;
    });
    const promiseB = new Promise<ParseUrlResult>((resolve) => {
      resolveB = resolve;
    });

    let callCount = 0;
    api.providers.parseUrl = mock(async () => {
      callCount += 1;
      if (callCount === 1) return promiseA;
      return promiseB;
    }) as never;

    const { actions, probe } = renderQuickUrlHook();

    // Request A starts
    act(() => {
      void probe().handleQuickUrlSubmit("https://unmatched-url.com");
    });
    // Request B starts
    act(() => {
      void probe().handleQuickUrlSubmit("https://valid-url.com");
    });

    // A resolves as unmatched
    await act(async () => {
      resolveA({
        code: "UNKNOWN",
        context: "https://unmatched-url.com",
        matched: false,
        url: "https://unmatched-url.com",
      });
    });

    // A's miss message is discarded because B is active
    expect(probe().quickUrlMissMessage).toBeNull();
    expect(probe().isParsingUrl).toBe(true);

    // B resolves successfully
    await act(async () => {
      resolveB({
        matched: true,
        providerId: "github-provider",
        configDraft: {},
      });
    });

    expect(probe().quickUrlMissMessage).toBeNull();
    expect(probe().isParsingUrl).toBe(false);
    expect(actions).toHaveLength(1);
  });
});
