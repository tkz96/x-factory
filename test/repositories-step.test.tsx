// test/repositories-step.test.tsx — Repositories step: discovery-sourced
// selection journey tests (spec #133, ticket #144).
//
// Follows test/connect-step.test.tsx: the REAL wizard is rendered and the only
// mocked module is the api-client seam. Every state of the discovery region is
// asserted through the feedback primitives, and no test reaches into a child
// component or hook.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  ERROR_COPY,
  REPOSITORIES_COPY,
  STATE_COPY,
} from "../src/frontend/components/feedback/copy-map.js";
import type {
  ProviderDescriptor,
  RepositoriesEnvelope,
} from "../src/frontend/connection/types.js";
import {
  ModalProvider,
  useModal,
} from "../src/frontend/context/ModalContext.js";
import { api } from "../src/frontend/lib/api-client.js";
import { connectionConfigFingerprint } from "../src/frontend/lib/connection-fingerprint.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import {
  useWizard,
  WizardProvider,
} from "../src/frontend/wizard/state/wizardContext.js";
import { RepositoriesStep } from "../src/frontend/wizard/steps/RepositoriesStep.js";
import { useRepositoryDiscovery } from "../src/frontend/wizard/steps/useRepositoryDiscovery.js";
import {
  clearWizardDraft,
  saveWizardDraft,
} from "../src/frontend/wizard/storage.js";
import { WizardModal } from "../src/frontend/wizard/WizardModal.js";

const manifestFixture: ProviderDescriptor[] = [
  {
    id: "generic-tracker",
    displayName: "Generic Tracker Service",
    roles: ["tracker"],
    iconRef: "icon-custom-tracker",
    capabilities: ["listTickets"],
    configFields: [
      {
        name: "endpointHost",
        label: "Endpoint Host",
        type: "url",
        required: true,
      },
    ],
  },
  {
    id: "generic-githost",
    displayName: "Generic Git Host Service",
    roles: ["gitHost"],
    iconRef: "icon-custom-git",
    capabilities: ["listRepositories", "createPullRequest"],
    configFields: [
      {
        name: "gitUrl",
        label: "Git URL",
        type: "url",
        required: true,
        placeholder: "https://git.example.com",
      },
      {
        name: "token",
        label: "Access Token",
        type: "secret",
        required: true,
        secret: true,
        placeholder: "tok_...",
      },
    ],
  },
];

const GIT_HOST_CONFIG = { gitUrl: "https://git.example.com", token: "tok-a" };

const REPOSITORIES = [
  {
    id: "repo-app",
    name: "rocket-app",
    remote: "https://git.example.com/acme/rocket-app.git",
    defaultBranch: "main",
    webUrl: "https://git.example.com/acme/rocket-app",
  },
  {
    id: "repo-api",
    name: "rocket-api",
    remote: "https://git.example.com/acme/rocket-api.git",
    defaultBranch: "main",
  },
];

function discoveryEnvelope(repositories = REPOSITORIES): RepositoriesEnvelope {
  return {
    providerId: "generic-githost",
    roles: ["gitHost"],
    repositories,
  };
}

function getEl<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
}

function typeInput(input: HTMLElement, value: string) {
  act(() => {
    input.focus();
    fireEvent.change(input, { target: { value } });
    fireEvent.keyUp(input);
  });
}

function Harness() {
  const { openOnboardingModal } = useModal();
  return (
    <div>
      <button type="button" id="btn-open-wizard" onClick={openOnboardingModal}>
        Open Wizard
      </button>
      <WizardModal />
    </div>
  );
}

/**
 * The imperative cache APIs the app could reach for. Watched per test so a
 * route that expressed "the inputs changed" by invalidating the cache instead
 * of by keying the render graph is visible (#148 criterion 3).
 */
let cacheInvalidations: ReturnType<typeof mock>;
let cacheRefetches: ReturnType<typeof mock>;

function renderWizard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(queryKeys.providers(), manifestFixture);
  cacheInvalidations = mock(() => Promise.resolve());
  cacheRefetches = mock(() => Promise.resolve());
  queryClient.invalidateQueries = cacheInvalidations as never;
  queryClient.refetchQueries = cacheRefetches as never;

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ModalProvider>
          <Harness />
        </ModalProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function gitHostState(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    providerId: "generic-githost",
    verified: true,
    ...extra,
  };
}

function setupStep3Draft(
  overrides: {
    gitHost?: Record<string, unknown>;
    repositories?: Record<string, unknown>;
  } = {},
) {
  saveWizardDraft({
    step: 3,
    maxStepVisited: 3,
    basics: {
      name: "Rocket",
      id: "rocket",
      description: "",
      workspacePath: "/work/rocket",
    },
    connect: {
      quickUrl: "",
      // Configuration is keyed by PROVIDER (correction 2, #133): the git-host
      // role's card and its discovery read this one entry.
      providerConfigs: {
        "generic-tracker": {},
        "generic-githost":
          (overrides.gitHost?.config as Record<string, unknown> | undefined) ??
          GIT_HOST_CONFIG,
      },
      tracker: { providerId: "generic-tracker", verified: true },
      gitHost: gitHostState(
        (overrides.gitHost ?? {}) as Record<string, unknown>,
      ) as never,
    },
    repositories: {
      selectedRepoIds: [],
      primaryRepoId: null,
      repoConfigs: {},
      selectionFingerprint: null,
      ...(overrides.repositories ?? {}),
    },
    inspection: { acknowledged: false },
    review: { confirmed: false },
  });
}

function setupStep2Draft() {
  saveWizardDraft({
    step: 2,
    maxStepVisited: 2,
    basics: {
      name: "Rocket",
      id: "rocket",
      description: "",
      workspacePath: "/work/rocket",
    },
    connect: {
      quickUrl: "",
      providerConfigs: {},
      tracker: {
        providerId: null,
        verified: false,
      },
      gitHost: {
        providerId: null,
        verified: false,
      },
    },
    repositories: {
      selectedRepoIds: [],
      primaryRepoId: null,
      repoConfigs: {},
      selectionFingerprint: null,
    },
    inspection: { acknowledged: false },
    review: { confirmed: false },
  });
}

/** Selects both providers on the Connect step and verifies them. */
async function verifyBothConnections() {
  act(() => {
    fireEvent.change(getEl("select-tracker-provider"), {
      target: { value: "generic-tracker" },
    });
    fireEvent.change(getEl("select-gitHost-provider"), {
      target: { value: "generic-githost" },
    });
  });
  await act(async () => {
    fireEvent.click(getEl("btn-verify-all"));
  });
}

/** Flushes the discovery query's fetch → render cycle (needs a real tick). */
async function flushDiscovery() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** The region container the step reserves for discovery. */
function discoveryRegion(): HTMLElement {
  return getEl("repositories-discovery");
}

describe("Repositories Step: discovery-sourced selection (spec #133, ticket #144)", () => {
  let listRepositories: ReturnType<typeof mock>;

  beforeEach(() => {
    clearWizardDraft();
    api.providers.getManifest = mock(async () => manifestFixture);
    api.providers.verify = mock(async () => ({
      status: "ok" as const,
      warnings: [],
    }));
    api.providers.parseUrl = mock(async () => ({
      matched: false as const,
      url: "",
    }));
    listRepositories = mock(async () => discoveryEnvelope());
    api.providers.listRepositories = listRepositories as never;
  });

  afterEach(() => {
    cleanup();
    clearWizardDraft();
  });

  it("HAPPY JOURNEY: Basics → Connect verified → repositories discovered from the git host → select → Next reaches Inspection", async () => {
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    // Step 1 — Basics
    await typeInput(getEl("onboard-proj-name"), "Rocket");
    await typeInput(getEl("onboard-workspace-path"), "/work/rocket");
    fireEvent.click(getEl("btn-step-1-next"));
    expect(document.getElementById("onboard-step-2")).not.toBeNull();

    // Step 2 — Connect (both cards verified)
    await verifyBothConnections();
    fireEvent.click(getEl("btn-step-2-next"));
    expect(document.getElementById("onboard-step-3")).not.toBeNull();

    // Step 3 — discovery runs against the git-host connection only
    await flushDiscovery();
    expect(listRepositories).toHaveBeenCalledTimes(1);
    expect(listRepositories.mock.calls[0]?.[0]).toEqual({
      providerId: "generic-githost",
      role: "gitHost",
      config: {},
    });

    // Every row comes from the api-client envelope — no manual entry field exists
    expect(getEl("repo-select-repo-app")).not.toBeNull();
    expect(getEl("repo-select-repo-api")).not.toBeNull();
    expect(document.querySelectorAll(".repositories-list-item").length).toBe(2);
    // ...and there is no way to type a repository in by hand.
    expect(
      document.querySelectorAll("#onboard-step-3 input[type='text']").length,
    ).toBe(0);
    expect(document.querySelector("#onboard-step-3 textarea")).toBeNull();

    // The gate blocks until an application repository is selected
    expect(getEl<HTMLButtonElement>("btn-step-3-next").disabled).toBe(true);

    act(() => {
      fireEvent.click(getEl("repo-select-repo-app"));
    });
    expect(getEl<HTMLButtonElement>("btn-step-3-next").disabled).toBe(false);

    fireEvent.click(getEl("btn-step-3-next"));
    expect(document.getElementById("onboard-step-4")).not.toBeNull();

    // The selection is recorded role-tagged in wizard state, ready for the
    // creation payload: the role it was listed under, not a hand-assigned one.
    const draft = JSON.parse(
      window.localStorage.getItem("xf_wizard_draft_v1") ?? "{}",
    ) as {
      state: {
        repositories: {
          selectedRepoIds: string[];
          primaryRepoId: string | null;
          repoConfigs: Record<string, { role: string; roles: string[] }>;
          selectionFingerprint: string;
        };
      };
    };
    expect(draft.state.repositories.selectedRepoIds).toEqual(["repo-app"]);
    expect(draft.state.repositories.primaryRepoId).toBe("repo-app");
    expect(draft.state.repositories.repoConfigs["repo-app"]).toEqual({
      role: "gitHost",
      roles: ["gitHost"],
    });
    expect(draft.state.repositories.selectionFingerprint).toStartWith("cfp_");
  });

  it("LOADING: an indeterminate spinner fills a reserved region, and results land in the same region (no layout shift)", async () => {
    let resolveDiscovery!: (value: RepositoriesEnvelope) => void;
    listRepositories = mock(
      async () =>
        new Promise<RepositoriesEnvelope>((resolve) => {
          resolveDiscovery = resolve;
        }),
    );
    api.providers.listRepositories = listRepositories as never;

    setupStep3Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));
    expect(document.getElementById("onboard-step-3")).not.toBeNull();

    // Reserved loading region: spinner + canonical loading copy, no rows yet
    const region = discoveryRegion();
    const loading = region.querySelector(".async-region--loading");
    expect(loading).not.toBeNull();
    expect(loading?.getAttribute("role")).toBe("status");
    expect(loading?.querySelector("use")?.getAttribute("href")).toContain(
      "icon-loader-2",
    );
    expect(region.querySelectorAll(".repositories-list-item").length).toBe(0);

    // Results arrive...
    await act(async () => {
      resolveDiscovery(discoveryEnvelope());
    });
    await flushDiscovery();

    // ...in the very same region element: nothing was remounted underneath it,
    // so the reserved space the spinner occupied is the space results occupy.
    expect(discoveryRegion()).toBe(region);
    expect(region.querySelectorAll(".repositories-list-item").length).toBe(2);
    expect(region.querySelector(".async-region--loading")).toBeNull();
  });

  it("EMPTY: a connection that lists zero repositories shows guidance copy, not a blank panel", async () => {
    listRepositories = mock(async () => discoveryEnvelope([]));
    api.providers.listRepositories = listRepositories as never;

    setupStep3Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));
    await flushDiscovery();

    const region = discoveryRegion();
    const empty = region.querySelector(".async-region--empty");
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain(REPOSITORIES_COPY.empty);
    expect(region.querySelectorAll(".repositories-list-item").length).toBe(0);
    expect(getEl<HTMLButtonElement>("btn-step-3-next").disabled).toBe(true);
  });
});

describe("Repositories Step — degraded, error, stale & gate states (spec #133, ticket #144)", () => {
  let listRepositories: ReturnType<typeof mock>;

  beforeEach(() => {
    clearWizardDraft();
    api.providers.getManifest = mock(async () => manifestFixture);
    api.providers.verify = mock(async () => ({
      status: "ok" as const,
      warnings: [],
    }));
    api.providers.parseUrl = mock(async () => ({
      matched: false as const,
      url: "",
    }));
    listRepositories = mock(async () => discoveryEnvelope());
    api.providers.listRepositories = listRepositories as never;
  });

  afterEach(() => {
    cleanup();
    clearWizardDraft();
  });

  it("PARTIAL: a git-host connection whose discovery capability could not be confirmed shows the degraded banner and keeps the list", async () => {
    setupStep2Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    api.providers.verify = mock(async (payload: { role: string }) => {
      if (payload.role === "gitHost") {
        return {
          status: "degraded" as const,
          warnings: [
            {
              kind: "CAPABILITY_UNCONFIRMED" as const,
              capability: "listRepositories",
            },
          ],
        };
      }
      return { status: "ok" as const, warnings: [] };
    });

    await verifyBothConnections();
    // A degraded git host is verified: the partial state is shown and the step
    // moves on with no acknowledgement to give (#133 story 19).
    expect(document.getElementById("btn-accept-degraded-gitHost")).toBeNull();
    fireEvent.click(getEl("btn-step-2-next"));
    expect(document.getElementById("onboard-step-3")).not.toBeNull();
    await flushDiscovery();

    const region = discoveryRegion();
    const banner = region.querySelector(".feedback-banner--warning");
    expect(banner).not.toBeNull();
    // The banner names exactly which capability could not be confirmed,
    // in contract terms — never provider scope terminology.
    expect(banner?.textContent).toContain(
      REPOSITORIES_COPY.discoveryUnconfirmed,
    );
    expect(banner?.textContent).toContain("listRepositories");
    // Content still works: the discovered repositories stay on screen.
    expect(region.querySelectorAll(".repositories-list-item").length).toBe(2);
  });

  it("ERROR (200 normalized envelope): a provider failure envelope is treated as a failure, never as a list", async () => {
    // The discovery route returns a normalized envelope with HTTP 200 when the
    // provider call throws — the step must not mistake it for repositories.
    listRepositories = mock(
      async () => ({ code: "RATE_LIMITED", context: "DISCOVERY" }) as never,
    );
    api.providers.listRepositories = listRepositories as never;

    setupStep3Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));
    await flushDiscovery();

    const errorRegion = getEl("onboard-step-3").querySelector(
      ".async-region--error",
    );
    expect(errorRegion).not.toBeNull();
    expect(errorRegion?.textContent).toContain(
      ERROR_COPY.RATE_LIMITED.DISCOVERY,
    );
    expect(errorRegion?.textContent).not.toContain("RATE_LIMITED");
    expect(getEl<HTMLButtonElement>("btn-step-3-next").disabled).toBe(true);
  });

  it("ERROR + RETRY: a failed discovery shows canonical copy and the retry re-invokes the query in place", async () => {
    const discoveryError = { code: "AUTH_INVALID", context: "DISCOVERY" };
    listRepositories = mock(async () => {
      throw discoveryError;
    });
    api.providers.listRepositories = listRepositories as never;

    setupStep3Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));
    await flushDiscovery();

    const stepPane = getEl("onboard-step-3");
    const errorRegion = stepPane.querySelector(".async-region--error");
    expect(errorRegion).not.toBeNull();
    expect(errorRegion?.textContent).toContain(
      ERROR_COPY.AUTH_INVALID.DISCOVERY,
    );
    // Never the raw failure: no code or provider text is rendered.
    expect(errorRegion?.textContent).not.toContain("AUTH_INVALID");
    expect(stepPane.textContent).not.toContain("throw");
    expect(getEl<HTMLButtonElement>("btn-step-3-next").disabled).toBe(true);

    // Retry: the mock now succeeds, and the query is re-invoked
    listRepositories = mock(async () => discoveryEnvelope());
    api.providers.listRepositories = listRepositories as never;

    const retryButton = errorRegion?.querySelector(
      ".retry-action",
    ) as HTMLButtonElement;
    expect(retryButton.textContent).toContain(STATE_COPY.retry);
    const regionBeforeRetry = discoveryRegion();
    await act(async () => {
      fireEvent.click(retryButton);
    });
    await flushDiscovery();

    expect(listRepositories).toHaveBeenCalledTimes(1);
    // Same step pane and same region element: the wizard never remounted.
    expect(getEl("onboard-step-3")).toBe(stepPane);
    expect(discoveryRegion()).toBe(regionBeforeRetry);
    expect(
      discoveryRegion().querySelectorAll(".repositories-list-item").length,
    ).toBe(2);
  });
});

describe("Repositories Step — stale selection & progression gate (spec #133, ticket #144)", () => {
  let listRepositories: ReturnType<typeof mock>;

  const selectionUnder = (config: Record<string, unknown>) => ({
    selectedRepoIds: ["repo-app"],
    primaryRepoId: "repo-app",
    repoConfigs: { "repo-app": { role: "gitHost", roles: ["gitHost"] } },
    selectionFingerprint: connectionConfigFingerprint(
      "generic-githost",
      config,
    ),
  });

  beforeEach(() => {
    clearWizardDraft();
    api.providers.getManifest = mock(async () => manifestFixture);
    api.providers.verify = mock(async () => ({
      status: "ok" as const,
      warnings: [],
    }));
    api.providers.parseUrl = mock(async () => ({
      matched: false as const,
      url: "",
    }));
    listRepositories = mock(async () => discoveryEnvelope());
    api.providers.listRepositories = listRepositories as never;
  });

  afterEach(() => {
    cleanup();
    clearWizardDraft();
  });

  it("PROGRESSION GATE: Next is disabled without an application repository and the wizard refuses to advance", async () => {
    setupStep3Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));
    await flushDiscovery();

    // Repositories are listed, but nothing is selected yet.
    expect(getEl("repo-select-repo-app")).not.toBeNull();
    const nextButton = getEl<HTMLButtonElement>("btn-step-3-next");
    expect(nextButton.disabled).toBe(true);

    // Clicking it anyway must not move the wizard past step 3.
    fireEvent.click(nextButton);
    expect(document.getElementById("onboard-step-3")).not.toBeNull();
    expect(document.getElementById("onboard-step-4")).toBeNull();

    // Backward navigation is unaffected by the gate.
    fireEvent.click(getEl("btn-step-3-back"));
    expect(document.getElementById("onboard-step-2")).not.toBeNull();
  });

  it("PROGRESSION GATE (deselect): un-checking the last application repository closes the gate again", async () => {
    setupStep3Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));
    await flushDiscovery();

    act(() => {
      fireEvent.click(getEl("repo-select-repo-app"));
      fireEvent.click(getEl("repo-select-repo-api"));
    });
    expect(getEl<HTMLButtonElement>("btn-step-3-next").disabled).toBe(false);

    act(() => {
      fireEvent.click(getEl("repo-select-repo-app"));
      fireEvent.click(getEl("repo-select-repo-api"));
    });
    expect(getEl<HTMLInputElement>("repo-select-repo-app").checked).toBe(false);
    expect(getEl<HTMLButtonElement>("btn-step-3-next").disabled).toBe(true);
    fireEvent.click(getEl("btn-step-3-next"));
    expect(document.getElementById("onboard-step-4")).toBeNull();
  });

  it("STALE (restored draft): a selection made under a different connection is out of date — badge, refresh, blocked Next; re-selecting clears it", async () => {
    setupStep3Draft({
      repositories: selectionUnder({ ...GIT_HOST_CONFIG, token: "tok-old" }),
    });
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));
    await flushDiscovery();

    const region = discoveryRegion();

    // The new fetch for the CURRENT connection ran and resolved...
    expect(listRepositories).toHaveBeenCalledTimes(1);
    // (A restored draft carries no secrets — the credential was stripped when
    // the draft was written, which is exactly why restored results are stale.)
    expect(listRepositories.mock.calls[0]?.[0]).toEqual({
      providerId: "generic-githost",
      role: "gitHost",
      config: { gitUrl: "https://git.example.com" },
    });
    expect(region.querySelectorAll(".repositories-list-item").length).toBe(2);

    // ...and the displayed selection is still flagged out of date.
    const badge = region.querySelector(".async-region-stale-badge");
    expect(badge?.textContent).toBe(STATE_COPY.stale);
    expect(region.querySelector(".retry-action")?.textContent).toContain(
      STATE_COPY.refresh,
    );
    expect(getEl("repositories-stale-selection").textContent).toContain(
      REPOSITORIES_COPY.staleSelection,
    );
    expect(getEl<HTMLButtonElement>("btn-step-3-next").disabled).toBe(true);
    expect(getEl<HTMLInputElement>("repo-select-repo-app").checked).toBe(true);

    // Starting the selection again clears the out-of-date choice...
    act(() => {
      fireEvent.click(getEl("btn-repositories-restart-selection"));
    });
    expect(getEl<HTMLInputElement>("repo-select-repo-app").checked).toBe(false);
    expect(getEl<HTMLButtonElement>("btn-step-3-next").disabled).toBe(true);

    // ...and re-selecting under the current connection unblocks the step.
    act(() => {
      fireEvent.click(getEl("repo-select-repo-app"));
    });
    expect(getEl<HTMLButtonElement>("btn-step-3-next").disabled).toBe(false);
    fireEvent.click(getEl("btn-step-3-next"));
    expect(document.getElementById("onboard-step-4")).not.toBeNull();
  });

  it("STALE (config edited after discovery): editing the git-host connection invalidates the selection and blocks the step", async () => {
    setupStep2Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    await verifyBothConnections();
    fireEvent.click(getEl("btn-step-2-next"));
    await flushDiscovery();
    expect(document.getElementById("onboard-step-3")).not.toBeNull();

    // Discover and select.
    act(() => {
      fireEvent.click(getEl("repo-select-repo-app"));
    });
    expect(getEl<HTMLButtonElement>("btn-step-3-next").disabled).toBe(false);

    // Go back and edit the git-host connection config.
    fireEvent.click(getEl("btn-step-3-back"));
    expect(document.getElementById("onboard-step-2")).not.toBeNull();
    await typeInput(getEl("gitHost-gitUrl"), "https://other.example.com");

    // Re-verify both cards (returning to Connect reset the in-memory
    // verification results) and return to Repositories.
    await act(async () => {
      fireEvent.click(getEl("btn-verify-gitHost"));
      fireEvent.click(getEl("btn-verify-tracker"));
    });
    fireEvent.click(getEl("btn-step-2-next"));
    expect(document.getElementById("onboard-step-3")).not.toBeNull();
    await flushDiscovery();

    // The fresh fetch for the edited connection resolved...
    expect(listRepositories.mock.calls.at(-1)?.[0]).toEqual({
      providerId: "generic-githost",
      role: "gitHost",
      config: { gitUrl: "https://other.example.com" },
    });
    expect(
      discoveryRegion().querySelectorAll(".repositories-list-item").length,
    ).toBe(2);

    // ...yet the selection from the previous connection is out of date and the
    // step refuses to advance: a project can never be created from it.
    expect(
      discoveryRegion().querySelector(".async-region-stale-badge")?.textContent,
    ).toBe(STATE_COPY.stale);
    expect(getEl("repositories-stale-selection")).not.toBeNull();
    expect(getEl<HTMLButtonElement>("btn-step-3-next").disabled).toBe(true);
    fireEvent.click(getEl("btn-step-3-next"));
    expect(document.getElementById("onboard-step-4")).toBeNull();
  });

  it("STEPNAV REGRESSION: forward jumps past unvalidated steps stay disabled while the gate is closed", async () => {
    setupStep3Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));
    await flushDiscovery();

    expect(getEl<HTMLButtonElement>("step-nav-basics").disabled).toBe(false);
    expect(getEl<HTMLButtonElement>("step-nav-connect").disabled).toBe(false);
    expect(getEl<HTMLButtonElement>("step-nav-inspection").disabled).toBe(true);
    expect(getEl<HTMLButtonElement>("step-nav-review").disabled).toBe(true);

    // A disabled forward jump is inert.
    fireEvent.click(getEl("step-nav-review"));
    expect(document.getElementById("onboard-step-3")).not.toBeNull();

    // After the gate opens and the wizard advances, only visited steps unlock.
    act(() => {
      fireEvent.click(getEl("repo-select-repo-app"));
    });
    fireEvent.click(getEl("btn-step-3-next"));
    expect(document.getElementById("onboard-step-4")).not.toBeNull();
    expect(getEl<HTMLButtonElement>("step-nav-review").disabled).toBe(true);
  });

  // ── Smoothness #2, #3, #6 (#148): selection, keying, and back-navigation ───
  describe("Smoothness — selection, config keying, and back-navigation (#148)", () => {
    it("SMOOTHNESS #2: selecting a row updates only what depends on the selection — no fetch, no rebuilt list", async () => {
      setupStep3Draft();
      renderWizard();
      fireEvent.click(getEl("btn-open-wizard"));
      await flushDiscovery();
      expect(listRepositories).toHaveBeenCalledTimes(1);

      const step = getEl("onboard-step-3");
      const region = discoveryRegion();
      const list = getEl("repositories-list");
      const appRow = getEl<HTMLInputElement>("repo-select-repo-app");
      const apiRow = getEl<HTMLInputElement>("repo-select-repo-api");

      const structural: MutationRecord[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === "childList") structural.push(record);
        }
      });
      observer.observe(step, { childList: true, subtree: true });

      act(() => {
        fireEvent.click(appRow);
      });
      // MutationObserver delivery is a microtask: let it run before reading.
      await act(async () => {
        await Promise.resolve();
      });
      observer.disconnect();

      // Nothing the selection does not depend on was rebuilt...
      expect(getEl("onboard-step-3")).toBe(step);
      expect(discoveryRegion()).toBe(region);
      expect(getEl("repositories-list")).toBe(list);
      expect(getEl("repo-select-repo-app")).toBe(appRow);
      expect(getEl("repo-select-repo-api")).toBe(apiRow);
      expect(list.querySelectorAll(".repositories-list-item").length).toBe(2);
      // ...and the only structural change is the selection summary.
      const added = structural.flatMap((record) => [...record.addedNodes]);
      expect(added.map((node) => (node as HTMLElement).className)).toEqual([
        "repositories-selection-summary",
      ]);

      // The selection never re-runs discovery: the list is already the source.
      expect(listRepositories).toHaveBeenCalledTimes(1);

      // What DOES depend on the selection updated in place.
      expect(getEl<HTMLInputElement>("repo-select-repo-app").checked).toBe(
        true,
      );
      expect(step.textContent).toContain(REPOSITORIES_COPY.selectionSummary(1));
      expect(getEl<HTMLButtonElement>("btn-step-3-next").disabled).toBe(false);
    });

    it("SMOOTHNESS #3: a config edit re-fetches by KEYING the render graph, with no imperative cache invalidation", async () => {
      // The step is entered from Connect so the git-host config can be edited.
      setupStep2Draft();
      renderWizard();
      fireEvent.click(getEl("btn-open-wizard"));

      act(() => {
        fireEvent.change(getEl("select-tracker-provider"), {
          target: { value: "generic-tracker" },
        });
        fireEvent.change(getEl("select-gitHost-provider"), {
          target: { value: "generic-githost" },
        });
      });
      await typeInput(getEl("gitHost-gitUrl"), "https://git.example.com");
      await typeInput(getEl("gitHost-token"), "tok-a");
      await act(async () => {
        fireEvent.click(getEl("btn-verify-all"));
      });
      fireEvent.click(getEl("btn-step-2-next"));
      await flushDiscovery();
      expect(listRepositories).toHaveBeenCalledTimes(1);
      expect(listRepositories.mock.calls[0]?.[0]).toEqual({
        providerId: "generic-githost",
        role: "gitHost",
        config: { gitUrl: "https://git.example.com", token: "tok-a" },
      });

      // A different connection is a different key, and therefore a new fetch.
      listRepositories = mock(async () => ({
        providerId: "generic-githost",
        roles: ["gitHost"],
        repositories: [
          {
            id: "repo-other",
            name: "other-repo",
            remote: "https://other.example.com/acme/other-repo.git",
          },
        ],
      }));
      api.providers.listRepositories = listRepositories as never;

      fireEvent.click(getEl("btn-step-3-back"));
      await typeInput(getEl("gitHost-gitUrl"), "https://other.example.com");
      await act(async () => {
        fireEvent.click(getEl("btn-verify-gitHost"));
        fireEvent.click(getEl("btn-verify-tracker"));
      });
      fireEvent.click(getEl("btn-step-2-next"));
      await flushDiscovery();

      // A NEW request for the NEW config — the key moved with the config.
      expect(listRepositories).toHaveBeenCalledTimes(1);
      expect(listRepositories.mock.calls[0]?.[0]).toEqual({
        providerId: "generic-githost",
        role: "gitHost",
        config: { gitUrl: "https://other.example.com", token: "tok-a" },
      });
      expect(
        discoveryRegion().querySelectorAll(".repositories-list-item").length,
      ).toBe(1);

      // And it was the render graph that asked for it: the app never reached
      // for an imperative cache invalidation to express "the config changed".
      expect(cacheInvalidations).not.toHaveBeenCalled();
      expect(cacheRefetches).not.toHaveBeenCalled();
    });

    it("SMOOTHNESS #6: Repositories → Connect → Repositories fires no second discovery request", async () => {
      setupStep2Draft();
      renderWizard();
      fireEvent.click(getEl("btn-open-wizard"));

      await verifyBothConnections();
      fireEvent.click(getEl("btn-step-2-next"));
      await flushDiscovery();
      expect(document.getElementById("onboard-step-3")).not.toBeNull();
      expect(listRepositories).toHaveBeenCalledTimes(1);

      // Back to Connect (which resets the in-memory verification) and forward
      // again — the journey a user makes to check what they typed.
      fireEvent.click(getEl("btn-step-3-back"));
      expect(document.getElementById("onboard-step-2")).not.toBeNull();
      await act(async () => {
        fireEvent.click(getEl("btn-verify-all"));
      });
      fireEvent.click(getEl("btn-step-2-next"));
      await flushDiscovery();

      // The repositories were already discovered for this very connection: the
      // cache answered, so no second identical request went out.
      expect(document.getElementById("onboard-step-3")).not.toBeNull();
      expect(listRepositories).toHaveBeenCalledTimes(1);
      expect(
        discoveryRegion().querySelectorAll(".repositories-list-item").length,
      ).toBe(2);
    });
  });
});

// ── #133 correction 4: a previous configuration's results are never selectable ─
//
// The defect: `keepPreviousData` keeps the previous configuration's envelope on
// screen while the newly edited configuration's fetch runs, and the rows built
// from it stayed clickable. A click recorded the OLD configuration's repository
// id stamped with the NEW configuration's fingerprint, so every later staleness
// check agreed the selection was current and Continue unblocked on results that
// belonged to a connection that no longer exists.

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("Repositories Step — a previous configuration's results are never selectable (#133 correction 4)", () => {
  // The draft the harness starts from was restored from storage, which strips
  // secrets — so configuration A carries no token. B is the edit the user makes
  // to the same connection.
  const A_CONFIG = { gitUrl: "https://git.example.com" };
  const B_CONFIG = { gitUrl: "https://other.example.com" };
  // The same two configurations as the Connect step collects them, credentials
  // included, for the journey that starts on Connect.
  const A_CONFIG_WITH_TOKEN = { ...A_CONFIG, token: "tok-a" };
  const B_CONFIG_WITH_TOKEN = { ...B_CONFIG, token: "tok-a" };
  const B_REPOSITORIES = [
    {
      id: "repo-other",
      name: "other-repo",
      remote: "https://other.example.com/acme/other-repo.git",
      defaultBranch: "main",
    },
  ];

  let listRepositories: ReturnType<typeof mock>;
  let bRequest: Deferred<RepositoriesEnvelope> | undefined;

  /**
   * The connection edit the Connect step makes, from inside the wizard tree:
   * the same provider, the same reducer action (`UPDATE_PROVIDER_CONFIG`), a
   * different configuration.
   */
  function ChangeConnection({ config }: { config: Record<string, unknown> }) {
    const { dispatch } = useWizard();
    return (
      <button
        type="button"
        id="btn-change-git-host-connection"
        onClick={() =>
          dispatch({
            type: "UPDATE_PROVIDER_CONFIG",
            providerId: "generic-githost",
            config,
          })
        }
      >
        Change Git Host connection
      </button>
    );
  }

  /**
   * The modal's own step switch: step 3's pane exists only while the wizard is
   * on step 3, so a refused Continue is observable as "still on step 3".
   */
  function Step3Pane() {
    const { state } = useWizard();
    if (state.step !== 3) {
      return <div id="advanced-past-step-3" />;
    }
    return <RepositoriesStep />;
  }

  /**
   * What the wizard has RECORDED, rendered as such: `<ids>|<fingerprint>`. This
   * is the value the step's gate and the creation payload read — the observable
   * an interaction must (not) change.
   */
  function RecordedSelectionProbe() {
    const { state } = useWizard();
    const { selectedRepoIds, selectionFingerprint } = state.repositories;
    return (
      <div id="probe-recorded-selection">
        <span>{selectedRepoIds.join(",")}</span>
        <span>|</span>
        <span>{selectionFingerprint ?? "none"}</span>
      </div>
    );
  }

  /**
   * The hook's own contract, driven directly and NOT through the DOM: whether
   * the displayed rows are selectable, and one button per displayed row that
   * toggles it by calling `toggleRepository` itself. Clicking a `disabled`
   * input can never reach a handler, so this is what proves the refusal is the
   * hook's and not the attribute's.
   */
  function DirectSelectionProbe() {
    const discovery = useRepositoryDiscovery();
    return (
      <div>
        <span id="probe-rows-selectable">
          {discovery.rowsSelectable ? "selectable" : "inert"}
        </span>
        {discovery.rows.map((discoveryRow) => (
          <button
            key={discoveryRow.id}
            type="button"
            id={`btn-probe-toggle-${discoveryRow.id}`}
            onClick={() => discovery.toggleRepository(discoveryRow)}
          >
            {`Toggle ${discoveryRow.id} directly`}
          </button>
        ))}
      </div>
    );
  }

  function recordedSelection() {
    const [ids, fingerprint] = (
      getEl("probe-recorded-selection").textContent ?? ""
    ).split("|");
    return {
      ids: ids === "" ? [] : (ids ?? "").split(","),
      fingerprint,
    };
  }

  /**
   * The REAL wizard (provider, draft, reducer, state machine) with the REAL
   * Repositories step on screen. The modal's navigation unmounts step 3 and a
   * remounted observer keeps no previous result — so the race this correction
   * guards (the previous configuration's rows on screen while the edited
   * configuration's fetch runs) is opened by editing the connection while the
   * step stays mounted. Only the api-client seam is a stand-in.
   */
  function renderRaceHarness(config: Record<string, unknown>) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <WizardProvider>
            <ChangeConnection config={config} />
            <RecordedSelectionProbe />
            <DirectSelectionProbe />
            <Step3Pane />
          </WizardProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  /** A repository row of the displayed configuration, as a labelled checkbox. */
  function row(id: string): HTMLInputElement {
    return getEl<HTMLInputElement>(`repo-select-${id}`);
  }

  function recordedDraft() {
    return JSON.parse(
      window.localStorage.getItem("xf_wizard_draft_v1") ?? "{}",
    ) as {
      state: {
        repositories: {
          selectedRepoIds: string[];
          primaryRepoId: string | null;
          repoConfigs: Record<string, { role: string; roles: string[] }>;
          selectionFingerprint: string | null;
        };
      };
    };
  }

  beforeEach(() => {
    clearWizardDraft();
    bRequest = undefined;
    // The whole api-client seam, so this describe stands alone: the race
    // harness needs discovery, and the reachable-journey test below runs the
    // real Connect step.
    api.providers.getManifest = mock(async () => manifestFixture);
    api.providers.verify = mock(async () => ({
      status: "ok" as const,
      warnings: [],
    }));
    api.providers.parseUrl = mock(async () => ({
      matched: false as const,
      url: "",
    }));
    // Configuration A answers immediately; configuration B's request is held
    // open so the window between the two is observable.
    listRepositories = mock(
      async (payload: { config: Record<string, unknown> }) => {
        if (payload.config.gitUrl === B_CONFIG.gitUrl) {
          bRequest = deferred<RepositoriesEnvelope>();
          return bRequest.promise;
        }
        return discoveryEnvelope();
      },
    );
    api.providers.listRepositories = listRepositories as never;
  });

  afterEach(() => {
    cleanup();
    clearWizardDraft();
  });

  it("THE RACE: the previous configuration's rows stay visible but inert while the new request runs, and only the new rows unlock Continue", async () => {
    setupStep3Draft();
    renderRaceHarness(B_CONFIG);
    await flushDiscovery();

    // Configuration A discovered: A's rows are on screen and selectable, and a
    // repository is selected under A.
    expect(listRepositories).toHaveBeenCalledTimes(1);
    expect(listRepositories.mock.calls[0]?.[0]).toEqual({
      providerId: "generic-githost",
      role: "gitHost",
      config: A_CONFIG,
    });
    expect(row("repo-app").disabled).toBe(false);
    act(() => {
      fireEvent.click(row("repo-app"));
    });
    expect(row("repo-app").checked).toBe(true);
    expect(getEl<HTMLButtonElement>("btn-step-3-next").disabled).toBe(false);

    // The connection changes to B while step 3 is on screen: B's request starts
    // and A's result is all the region has to show.
    act(() => {
      fireEvent.click(getEl("btn-change-git-host-connection"));
    });
    await flushDiscovery();
    expect(bRequest).toBeDefined();
    expect(listRepositories.mock.calls.at(-1)?.[0]).toEqual({
      providerId: "generic-githost",
      role: "gitHost",
      config: B_CONFIG,
    });

    // (i) A's repositories are still visible — the region never collapses to a
    // spinner — and are explained as out of date.
    const region = discoveryRegion();
    expect(region.querySelectorAll(".repositories-list-item").length).toBe(2);
    expect(getEl("repo-select-repo-app")).not.toBeNull();
    expect(region.querySelector(".async-region-stale-badge")?.textContent).toBe(
      STATE_COPY.stale,
    );
    expect(getEl("repositories-stale-results").textContent).toContain(
      REPOSITORIES_COPY.staleResults,
    );
    expect(region.querySelector(".async-region--loading")).toBeNull();

    // (ii) …and every one of them is NOT selectable.
    expect(row("repo-app").disabled).toBe(true);
    expect(row("repo-api").disabled).toBe(true);

    // (iii) A row of the previous configuration cannot become a selection the
    // wizard records, and the refusal does not depend on the DOM: the hook is
    // asked to toggle a placeholder row directly, and toggles nothing. (The
    // DOM click is checked too — a disabled control is inert to the user.)
    expect(getEl("probe-rows-selectable").textContent).toBe("inert");
    expect(recordedSelection().ids).toEqual(["repo-app"]);
    act(() => {
      fireEvent.click(row("repo-api"));
      getEl("btn-probe-toggle-repo-api").click();
    });
    expect(recordedSelection().ids).toEqual(["repo-app"]);
    expect(recordedSelection().fingerprint).toBe(
      connectionConfigFingerprint("generic-githost", A_CONFIG),
    );
    expect(region.textContent).toContain(REPOSITORIES_COPY.selectionSummary(1));

    // (iv) Continue cannot proceed on the previous configuration's data.
    expect(getEl<HTMLButtonElement>("btn-step-3-next").disabled).toBe(true);
    fireEvent.click(getEl("btn-step-3-next"));
    expect(document.getElementById("advanced-past-step-3")).toBeNull();

    // B's results arrive: they are the current configuration's rows, so they are
    // selectable, and Continue unblocks only on a selection made from them. The
    // very direct toggle that was refused a moment ago now records — so the
    // refusal was the placeholder rows', not the probe's.
    await act(async () => {
      bRequest?.resolve(discoveryEnvelope(B_REPOSITORIES));
    });
    await flushDiscovery();

    expect(document.getElementById("repo-select-repo-app")).toBeNull();
    expect(row("repo-other").disabled).toBe(false);
    expect(getEl("probe-rows-selectable").textContent).toBe("selectable");
    expect(document.getElementById("repositories-stale-results")).toBeNull();
    expect(getEl<HTMLButtonElement>("btn-step-3-next").disabled).toBe(true);

    act(() => {
      getEl("btn-probe-toggle-repo-other").click();
    });
    expect(recordedSelection().ids).toEqual(["repo-other"]);
    expect(recordedSelection().fingerprint).toBe(
      connectionConfigFingerprint("generic-githost", B_CONFIG),
    );
    expect(row("repo-other").checked).toBe(true);
    expect(getEl<HTMLButtonElement>("btn-step-3-next").disabled).toBe(false);
    fireEvent.click(getEl("btn-step-3-next"));
    expect(document.getElementById("advanced-past-step-3")).not.toBeNull();
  });

  it("PROVENANCE: after the race a selection holds only the current configuration's ids, under its fingerprint", async () => {
    setupStep3Draft();
    renderRaceHarness(B_CONFIG);
    await flushDiscovery();

    // A selection made under configuration A.
    act(() => {
      fireEvent.click(row("repo-app"));
    });
    expect(recordedSelection().ids).toEqual(["repo-app"]);

    // The connection changes; the window is open, so the previous list is on
    // screen. Neither a click nor a change event can extend it.
    act(() => {
      fireEvent.click(getEl("btn-change-git-host-connection"));
    });
    await flushDiscovery();
    expect(row("repo-app").disabled).toBe(true);
    act(() => {
      fireEvent.click(row("repo-api"));
      getEl("btn-probe-toggle-repo-api").click();
    });
    expect(recordedSelection().ids).toEqual(["repo-app"]);

    await act(async () => {
      bRequest?.resolve(discoveryEnvelope(B_REPOSITORIES));
    });
    await flushDiscovery();

    // Only B's rows are selectable, and the selection that reaches the draft is
    // made of B's ids, recorded under B's fingerprint. No id of the connection
    // that produced the placeholder rows survives as a valid selection.
    expect(row("repo-other").disabled).toBe(false);
    act(() => {
      fireEvent.click(row("repo-other"));
    });
    expect(recordedSelection().ids).toEqual(["repo-other"]);
    expect(recordedSelection().fingerprint).toBe(
      connectionConfigFingerprint("generic-githost", B_CONFIG),
    );
    fireEvent.click(getEl("btn-step-3-next"));

    const { repositories } = recordedDraft().state;
    expect(repositories.selectedRepoIds).toEqual(["repo-other"]);
    expect(repositories.selectedRepoIds).not.toContain("repo-app");
    expect(repositories.selectedRepoIds).not.toContain("repo-api");
    expect(repositories.primaryRepoId).toBe("repo-other");
    expect(repositories.selectionFingerprint).toBe(
      connectionConfigFingerprint("generic-githost", B_CONFIG),
    );
    expect(repositories.selectionFingerprint).not.toBe(
      connectionConfigFingerprint("generic-githost", A_CONFIG),
    );
  });

  it("FAILED NEW CONFIGURATION: the previous rows stay visible with stale + error diagnostics, still inert, Continue still blocked", async () => {
    setupStep3Draft();
    renderRaceHarness(B_CONFIG);
    await flushDiscovery();

    act(() => {
      fireEvent.click(row("repo-app"));
    });
    expect(getEl<HTMLButtonElement>("btn-step-3-next").disabled).toBe(false);

    act(() => {
      fireEvent.click(getEl("btn-change-git-host-connection"));
    });
    await flushDiscovery();
    const request = bRequest;
    expect(request).toBeDefined();
    await act(async () => {
      request?.reject({ code: "AUTH_INVALID", context: "DISCOVERY" });
    });
    await flushDiscovery();

    const region = discoveryRegion();

    // The list the user was reading survives a failed refresh of the new
    // configuration: the region does not blank, and it is not the error-only
    // state — the failure rides along as a diagnostic beside the content.
    expect(region.querySelectorAll(".repositories-list-item").length).toBe(2);
    expect(region.querySelector(".async-region--error")).toBeNull();
    const errorBanner = region.querySelector(".feedback-banner--error");
    expect(errorBanner?.textContent).toContain(
      ERROR_COPY.AUTH_INVALID.DISCOVERY,
    );
    expect(errorBanner?.textContent).not.toContain("AUTH_INVALID");

    // Still flagged out of date, and still explained as non-selectable.
    expect(region.querySelector(".async-region-stale-badge")?.textContent).toBe(
      STATE_COPY.stale,
    );
    expect(getEl("repositories-stale-results").textContent).toContain(
      REPOSITORIES_COPY.staleResults,
    );

    // Inert and blocked, exactly as while the new request was in flight.
    expect(getEl("probe-rows-selectable").textContent).toBe("inert");
    expect(row("repo-app").disabled).toBe(true);
    act(() => {
      fireEvent.click(row("repo-api"));
      getEl("btn-probe-toggle-repo-api").click();
    });
    expect(recordedSelection().ids).toEqual(["repo-app"]);
    expect(recordedSelection().fingerprint).toBe(
      connectionConfigFingerprint("generic-githost", A_CONFIG),
    );
    expect(getEl<HTMLButtonElement>("btn-step-3-next").disabled).toBe(true);
    fireEvent.click(getEl("btn-step-3-next"));
    expect(document.getElementById("advanced-past-step-3")).toBeNull();
  });

  it("CANADVANCE FOLD: a selection that is current for the connection does not unblock Continue while the rows on screen belong to another one", async () => {
    // The one state the wizard's own rule cannot see: the recorded selection IS
    // current for the connection as it stands (it was made under configuration
    // A, and A is what the connection now is), while the rows the region has to
    // show are configuration B's. State alone would allow advancing; the rows
    // on screen are not the connection's, so the step must not proceed.
    setupStep3Draft({
      gitHost: { config: B_CONFIG },
      repositories: {
        selectedRepoIds: ["repo-app"],
        primaryRepoId: "repo-app",
        repoConfigs: { "repo-app": { role: "gitHost", roles: ["gitHost"] } },
        selectionFingerprint: connectionConfigFingerprint(
          "generic-githost",
          A_CONFIG,
        ),
      },
    });

    // The connection the draft is on answers; the edit's request is held open.
    let aRequest: Deferred<RepositoriesEnvelope> | undefined;
    listRepositories = mock(
      async (payload: { config: Record<string, unknown> }) => {
        if (payload.config.gitUrl === A_CONFIG.gitUrl) {
          aRequest = deferred<RepositoriesEnvelope>();
          return aRequest.promise;
        }
        return discoveryEnvelope(B_REPOSITORIES);
      },
    );
    api.providers.listRepositories = listRepositories as never;

    renderRaceHarness(A_CONFIG);
    await flushDiscovery();

    // The draft's connection (B) discovered its own rows: they are current, and
    // the restored selection is out of date against them.
    expect(getEl("probe-rows-selectable").textContent).toBe("selectable");
    expect(getEl<HTMLButtonElement>("btn-step-3-next").disabled).toBe(true);

    // The connection changes to the one the selection was made under: the
    // recorded selection is CURRENT now, and the rows on screen are B's.
    act(() => {
      fireEvent.click(getEl("btn-change-git-host-connection"));
    });
    await flushDiscovery();

    expect(getEl("probe-rows-selectable").textContent).toBe("inert");
    expect(document.getElementById("repo-select-repo-other")).not.toBeNull();
    expect(document.getElementById("repo-select-repo-app")).toBeNull();
    expect(recordedSelection().ids).toEqual(["repo-app"]);
    expect(recordedSelection().fingerprint).toBe(
      connectionConfigFingerprint("generic-githost", A_CONFIG),
    );
    // Continuing here would create a project from a selection no row on screen
    // supports.
    expect(getEl<HTMLButtonElement>("btn-step-3-next").disabled).toBe(true);
    fireEvent.click(getEl("btn-step-3-next"));
    expect(document.getElementById("advanced-past-step-3")).toBeNull();

    // The connection's own results arrive: the same recorded selection is now
    // supported by the rows on screen, and the step can proceed.
    await act(async () => {
      aRequest?.resolve(discoveryEnvelope());
    });
    await flushDiscovery();

    expect(getEl("probe-rows-selectable").textContent).toBe("selectable");
    expect(row("repo-app").checked).toBe(true);
    expect(getEl<HTMLButtonElement>("btn-step-3-next").disabled).toBe(false);
  });

  it("REACHABLE JOURNEY: after editing the connection from Connect, the step's own rows are selectable", async () => {
    // The journey the modal allows: the edit happens on Connect (which unmounts
    // step 3), so the step returns with the new configuration's own request and
    // no older rows to show. The correction must not over-block that.
    setupStep2Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    act(() => {
      fireEvent.change(getEl("select-tracker-provider"), {
        target: { value: "generic-tracker" },
      });
      fireEvent.change(getEl("select-gitHost-provider"), {
        target: { value: "generic-githost" },
      });
    });
    await typeInput(getEl("gitHost-gitUrl"), A_CONFIG_WITH_TOKEN.gitUrl);
    await typeInput(getEl("gitHost-token"), A_CONFIG_WITH_TOKEN.token);
    await act(async () => {
      fireEvent.click(getEl("btn-verify-all"));
    });
    fireEvent.click(getEl("btn-step-2-next"));
    await flushDiscovery();
    expect(
      discoveryRegion().querySelectorAll(".repositories-list-item").length,
    ).toBe(2);

    // Back to Connect, edit the connection, return to Repositories.
    listRepositories = mock(async () => discoveryEnvelope(B_REPOSITORIES));
    api.providers.listRepositories = listRepositories as never;

    fireEvent.click(getEl("btn-step-3-back"));
    await typeInput(getEl("gitHost-gitUrl"), B_CONFIG_WITH_TOKEN.gitUrl);
    await act(async () => {
      fireEvent.click(getEl("btn-verify-gitHost"));
      fireEvent.click(getEl("btn-verify-tracker"));
    });
    fireEvent.click(getEl("btn-step-2-next"));
    await flushDiscovery();

    expect(listRepositories.mock.calls[0]?.[0]).toEqual({
      providerId: "generic-githost",
      role: "gitHost",
      config: B_CONFIG_WITH_TOKEN,
    });
    // The previous configuration's rows never appear, and the rows that do are
    // the current configuration's — selectable, with nothing to explain.
    expect(document.getElementById("repo-select-repo-app")).toBeNull();
    expect(document.getElementById("repositories-stale-results")).toBeNull();
    expect(row("repo-other").disabled).toBe(false);
    act(() => {
      fireEvent.click(row("repo-other"));
    });
    expect(getEl<HTMLButtonElement>("btn-step-3-next").disabled).toBe(false);
  });

  it("COMMIT-SAFE RETENTION: previous discovery results survive a failed refresh after commit", async () => {
    let callCount = 0;
    listRepositories = mock(async () => {
      callCount++;
      if (callCount === 1) {
        return discoveryEnvelope(REPOSITORIES);
      }
      throw { code: "NETWORK_ERROR", context: "DISCOVERY" };
    });
    api.providers.listRepositories = listRepositories as never;

    setupStep3Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));
    await flushDiscovery();

    const region = discoveryRegion();
    expect(region.querySelectorAll(".repositories-list-item").length).toBe(2);

    // Refresh fails
    const refreshBtn = region.querySelector(".async-region-action-btn");
    if (refreshBtn) {
      await act(async () => {
        fireEvent.click(refreshBtn);
      });
      await flushDiscovery();
    }

    // Previous results remain visible after refresh failure
    expect(region.querySelectorAll(".repositories-list-item").length).toBe(2);
  });
});

afterAll(async () => {
  await unregisterHappyDom();
});
