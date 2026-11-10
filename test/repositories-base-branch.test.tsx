/// <reference lib="dom" />
import { registerHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  ProviderDescriptor,
  RepositoriesEnvelope,
} from "../src/frontend/connection/types.js";
import {
  ModalProvider,
  useModal,
} from "../src/frontend/context/ModalContext.js";
import { api } from "../src/frontend/lib/api-client.js";
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
  saveWizardDraft(
    {
      step: 3,
      maxStepVisited: 3,
      basics: {
        name: "Rocket",
        id: "rocket",
        description: "",
        workspacePath: "/work/rocket",
      },
      connect: {
        // Step 1's repository URL (#268): present, so the step that holds it
        // still validates when navigation returns to it.
        quickUrl: "https://git.example.com/acme/rocket",
        // Configuration is keyed by PROVIDER (correction 2, #133): the git-host
        // role's card and its discovery read this one entry.
        providerConfigs: {
          "generic-tracker": {},
          "generic-githost":
            (overrides.gitHost?.config as
              | Record<string, unknown>
              | undefined) ?? GIT_HOST_CONFIG,
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
    },
    manifestFixture,
  );
}

/** Flushes the discovery query's fetch → render cycle (needs a real tick). */
async function flushDiscovery() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

describe("Repositories Step — base branch of each selected repository", () => {
  let listBranches: ReturnType<typeof mock>;

  beforeEach(() => {
    clearWizardDraft();
    api.providers.getManifest = mock(async () => manifestFixture);
    api.providers.listRepositories = mock(async () =>
      discoveryEnvelope([
        {
          id: "repo-app",
          name: "rocket-app",
          remote: "r1",
          defaultBranch: "main",
        },
        {
          id: "repo-api",
          name: "rocket-api",
          remote: "r2",
          defaultBranch: "trunk",
        },
      ]),
    ) as never;
    listBranches = mock(async () => ({
      providerId: "generic-githost",
      branches: ["develop", "main", "trunk"],
    }));
    api.providers.listBranches = listBranches as never;
  });

  afterEach(() => {
    cleanup();
    clearWizardDraft();
  });

  async function openStepAndSelectApi() {
    setupStep3Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));
    await flushDiscovery();
    act(() => {
      fireEvent.click(getEl("repo-select-repo-api"));
    });
  }

  it("shows the provider's default branch for a selected repository only, and lists nothing yet", async () => {
    await openStepAndSelectApi();
    expect(getEl("repo-base-branch-repo-api").textContent).toContain("trunk");
    expect(document.getElementById("repo-base-branch-repo-app")).toBeNull();
    expect(listBranches).not.toHaveBeenCalled();
  });

  it("loads the branches on demand and records the chosen base branch", async () => {
    await openStepAndSelectApi();
    act(() => {
      fireEvent.click(getEl("btn-base-branch-change-repo-api"));
    });
    await flushDiscovery();
    expect(listBranches).toHaveBeenCalledTimes(1);
    const call = listBranches.mock.calls[0]?.[0] as {
      repository: { id: string };
      config: unknown;
    };
    expect(call.repository.id).toBe("repo-api");
    expect(call.config).toMatchObject({ gitUrl: GIT_HOST_CONFIG.gitUrl });

    act(() => {
      fireEvent.change(getEl("base-branch-select-repo-api"), {
        target: { value: "develop" },
      });
    });
    expect(getEl("repo-base-branch-repo-api").textContent).toContain("develop");
  });

  it("falls back to a typed branch name when listing fails", async () => {
    listBranches = mock(async () => ({
      code: "AUTH_INVALID",
      context: "DISCOVERY",
    }));
    api.providers.listBranches = listBranches as never;
    await openStepAndSelectApi();
    act(() => {
      fireEvent.click(getEl("btn-base-branch-change-repo-api"));
    });
    await flushDiscovery();
    expect(document.getElementById("base-branch-select-repo-api")).toBeNull();
    typeInput(getEl("base-branch-input-repo-api"), "release/2");
    expect(getEl("repo-base-branch-repo-api").textContent).toContain(
      "release/2",
    );
  });
});
