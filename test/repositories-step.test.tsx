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

function renderWizard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(queryKeys.providers(), manifestFixture);

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
  config: Record<string, unknown> = GIT_HOST_CONFIG,
  extra: Record<string, unknown> = {},
) {
  return {
    providerId: "generic-githost",
    config,
    verified: true,
    degradedAccepted: false,
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
      tracker: {
        providerId: "generic-tracker",
        config: {},
        verified: true,
        degradedAccepted: false,
      },
      gitHost: gitHostState(
        (overrides.gitHost?.config as Record<string, unknown> | undefined) ??
          GIT_HOST_CONFIG,
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
      tracker: {
        providerId: null,
        config: {},
        verified: false,
        degradedAccepted: false,
      },
      gitHost: {
        providerId: null,
        config: {},
        verified: false,
        degradedAccepted: false,
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

    // The gate blocks until an application repository is selected
    expect(getEl<HTMLButtonElement>("btn-step-3-next").disabled).toBe(true);

    act(() => {
      fireEvent.click(getEl("repo-select-repo-app"));
    });
    expect(getEl<HTMLButtonElement>("btn-step-3-next").disabled).toBe(false);

    fireEvent.click(getEl("btn-step-3-next"));
    expect(document.getElementById("onboard-step-4")).not.toBeNull();
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
    await act(async () => {
      fireEvent.click(getEl("btn-accept-degraded-gitHost"));
    });
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
});

afterAll(async () => {
  await unregisterHappyDom();
});
