// test/connection-verification-feedback.test.tsx — Regression tests for Issue #162: Connection verification and scope feedback.

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
  CONNECTIONS_COPY,
  DEGRADED_CAPABILITY_COPY,
  ERROR_COPY,
  STATE_COPY,
} from "../src/frontend/components/feedback/copy-map.js";
import type { ProviderDescriptor } from "../src/frontend/connection/types.js";
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

const testManifest: ProviderDescriptor[] = [
  {
    id: "github",
    displayName: "GitHub",
    roles: ["tracker", "gitHost"],
    iconRef: "icon-brand-github",
    capabilities: [
      "verifyScopes",
      "listRepositories",
      "listTickets",
      "createPullRequest",
    ],
    configFields: [
      {
        name: "token",
        label: "Personal Access Token",
        type: "secret",
        required: true,
        secret: true,
        placeholder: "ghp_...",
        help: "Personal Access Token with required scopes: 'repo' (code, pull requests) and 'workflow' (GitHub Actions).",
      },
      {
        name: "repoOwner",
        label: "Owner / Organization",
        type: "text",
        required: false,
        placeholder: "octocat",
      },
      {
        name: "repository",
        label: "Repository",
        type: "text",
        required: false,
        placeholder: "hello-world",
        roles: ["tracker"],
      },
    ],
  },
  {
    id: "azure",
    displayName: "Azure DevOps",
    roles: ["tracker", "gitHost"],
    iconRef: "icon-brand-azure",
    capabilities: [
      "verifyScopes",
      "listRepositories",
      "listTickets",
      "createPullRequest",
    ],
    configFields: [
      {
        name: "orgUrl",
        label: "Organization URL",
        type: "url",
        required: true,
        placeholder: "https://dev.azure.com/org",
      },
      {
        name: "pat",
        label: "Personal Access Token",
        type: "secret",
        required: false,
        secret: true,
        placeholder: "••••••••",
        help: "Personal Access Token with required scopes: Code (Read & Write) and Work Items (Read & Write).",
      },
    ],
  },
];

function getEl<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
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
  queryClient.setQueryData(queryKeys.providers(), testManifest);

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

function setupStep2Draft() {
  saveWizardDraft({
    step: 2,
    maxStepVisited: 2,
    basics: {
      name: "Test App",
      id: "test-app",
      description: "Test description",
      workspacePath: "/workspace/test",
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
      selectedRepoIds: ["repo-1"],
      primaryRepoId: "repo-1",
      repoConfigs: { repo_1: { role: "gitHost", roles: ["gitHost"] } },
    },
    inspection: { acknowledged: false },
    review: { confirmed: false },
  });
}

describe("Issue #162: Connection Verification and Scope Feedback", () => {
  beforeEach(() => {
    clearWizardDraft();
  });

  afterEach(() => {
    cleanup();
    clearWizardDraft();
  });

  afterAll(async () => {
    await unregisterHappyDom();
  });

  it("AC1: Connection form clearly lists required token scopes in user-friendly terms", async () => {
    setupStep2Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    // Select GitHub on GitHost card
    act(() => {
      fireEvent.change(getEl("select-gitHost-provider"), {
        target: { value: "github" },
      });
    });

    const gitHostCard = getEl("connection-card-gitHost");
    // Form must list required scopes in user-friendly terms (e.g. repo, workflow)
    expect(gitHostCard.textContent).toContain("repo");
    expect(gitHostCard.textContent).toContain("workflow");
    // Must outline required permissions / scopes
    const scopesGuide = gitHostCard.querySelector(
      "#connection-required-scopes-gitHost",
    );
    expect(scopesGuide).not.toBeNull();
    expect(scopesGuide?.textContent).toContain("Required");
  });

  it("AC2: Verification errors explicitly state which scopes are missing, map failed capability, and provide update instructions", async () => {
    setupStep2Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    act(() => {
      fireEvent.change(getEl("select-gitHost-provider"), {
        target: { value: "github" },
      });
    });

    // Valid PAT lacking 'repo' scope -> degraded with createPullRequest unconfirmed and missingScopes
    api.providers.verify = mock(async () => ({
      status: "degraded" as const,
      warnings: [
        {
          kind: "CAPABILITY_UNCONFIRMED" as const,
          capability: "createPullRequest",
          missingScopes: ["repo"],
        },
      ],
    }));

    await act(async () => {
      fireEvent.click(getEl("btn-verify-gitHost"));
    });

    const gitHostCard = getEl("connection-card-gitHost");
    // Explicitly states connection has limited access using exact canonical lead copy
    expect(gitHostCard.textContent).toContain(CONNECTIONS_COPY.degradedLead);
    // Maps createPullRequest to human-readable permission requirement and states missing scope
    expect(gitHostCard.textContent).toContain(
      "Pull request creation — Missing: repo",
    );
    expect(gitHostCard.textContent).not.toContain("createPullRequest");
    // Form still lists required scopes from provider descriptor (e.g. repo)
    expect(gitHostCard.textContent).toContain("repo");
    // Provides actionable instructions on updating the token from copy map
    expect(gitHostCard.textContent).toContain(
      CONNECTIONS_COPY.degradedRemediation,
    );
  });

  it("Unconfirmed permissions: shows neutral advice when permissions cannot be confirmed without write", async () => {
    setupStep2Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    act(() => {
      fireEvent.change(getEl("select-gitHost-provider"), {
        target: { value: "github" },
      });
    });

    // Unconfirmed without write (e.g., fine-grained PAT or Azure where scopes are not visible):
    api.providers.verify = mock(async () => ({
      status: "degraded" as const,
      warnings: [
        {
          kind: "CAPABILITY_UNCONFIRMED" as const,
          capability: "createPullRequest",
        },
      ],
    }));

    await act(async () => {
      fireEvent.click(getEl("btn-verify-gitHost"));
    });

    const gitHostCard = getEl("connection-card-gitHost");
    // States limited access
    expect(gitHostCard.textContent).toContain(CONNECTIONS_COPY.degradedLead);
    // Unconfirmed capability notice from copy map
    expect(gitHostCard.textContent).toContain(
      DEGRADED_CAPABILITY_COPY.createPullRequest.unconfirmed,
    );
    expect(gitHostCard.textContent).not.toContain("Missing:");
    // Neutral copy explaining permission can only be confirmed upon PR creation
    expect(gitHostCard.textContent).toContain(
      CONNECTIONS_COPY.degradedRemediationUnconfirmed,
    );
    // Re-verify advice is not shown since re-verifying cannot confirm without write
    expect(gitHostCard.textContent).not.toContain(
      CONNECTIONS_COPY.degradedRemediation,
    );
  });

  it("Side-by-side warnings: tracker warning gets actionable advice, pull-request warning gets neutral unconfirmed advice", async () => {
    setupStep2Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    act(() => {
      fireEvent.change(getEl("select-tracker-provider"), {
        target: { value: "azure" },
      });
      fireEvent.change(getEl("select-gitHost-provider"), {
        target: { value: "github" },
      });
    });

    api.providers.verify = mock(async ({ role }) => {
      if (role === "tracker") {
        return {
          status: "degraded" as const,
          warnings: [
            {
              kind: "CAPABILITY_UNCONFIRMED" as const,
              capability: "listTickets",
            },
          ],
        };
      }
      return {
        status: "degraded" as const,
        warnings: [
          {
            kind: "CAPABILITY_UNCONFIRMED" as const,
            capability: "createPullRequest",
          },
        ],
      };
    });

    await act(async () => {
      fireEvent.click(getEl("btn-verify-tracker"));
      fireEvent.click(getEl("btn-verify-gitHost"));
    });

    const trackerCard = getEl("connection-card-tracker");
    const gitHostCard = getEl("connection-card-gitHost");

    // Tracker card: listTickets unconfirmed without missingScopes gets actionable re-verify advice
    expect(trackerCard.textContent).toContain(
      DEGRADED_CAPABILITY_COPY.listTickets.unconfirmed,
    );
    expect(trackerCard.textContent).toContain(
      CONNECTIONS_COPY.degradedRemediation,
    );
    expect(trackerCard.textContent).not.toContain(
      CONNECTIONS_COPY.degradedRemediationUnconfirmed,
    );

    // Git host card: createPullRequest unconfirmed without missingScopes gets neutral line
    expect(gitHostCard.textContent).toContain(
      DEGRADED_CAPABILITY_COPY.createPullRequest.unconfirmed,
    );
    expect(gitHostCard.textContent).toContain(
      CONNECTIONS_COPY.degradedRemediationUnconfirmed,
    );
    expect(gitHostCard.textContent).not.toContain(
      CONNECTIONS_COPY.degradedRemediation,
    );
  });

  it("Side-by-side warnings: listRepositories gets actionable advice, pull-request warning gets neutral unconfirmed advice", async () => {
    setupStep2Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    act(() => {
      fireEvent.change(getEl("select-tracker-provider"), {
        target: { value: "azure" },
      });
      fireEvent.change(getEl("select-gitHost-provider"), {
        target: { value: "github" },
      });
    });

    api.providers.verify = mock(async ({ role }) => {
      if (role === "tracker") {
        return {
          status: "degraded" as const,
          warnings: [
            {
              kind: "CAPABILITY_UNCONFIRMED" as const,
              capability: "createPullRequest",
            },
          ],
        };
      }
      return {
        status: "degraded" as const,
        warnings: [
          {
            kind: "CAPABILITY_UNCONFIRMED" as const,
            capability: "listRepositories",
          },
        ],
      };
    });

    await act(async () => {
      fireEvent.click(getEl("btn-verify-tracker"));
      fireEvent.click(getEl("btn-verify-gitHost"));
    });

    const trackerCard = getEl("connection-card-tracker");
    const gitHostCard = getEl("connection-card-gitHost");

    // Git host card: listRepositories unconfirmed without missingScopes gets actionable re-verify advice
    expect(gitHostCard.textContent).toContain(
      DEGRADED_CAPABILITY_COPY.listRepositories.unconfirmed,
    );
    expect(gitHostCard.textContent).toContain(
      CONNECTIONS_COPY.degradedRemediation,
    );
    expect(gitHostCard.textContent).not.toContain(
      CONNECTIONS_COPY.degradedRemediationUnconfirmed,
    );

    // Tracker card: createPullRequest unconfirmed without missingScopes gets neutral line
    expect(trackerCard.textContent).toContain(
      DEGRADED_CAPABILITY_COPY.createPullRequest.unconfirmed,
    );
    expect(trackerCard.textContent).toContain(
      CONNECTIONS_COPY.degradedRemediationUnconfirmed,
    );
    expect(trackerCard.textContent).not.toContain(
      CONNECTIONS_COPY.degradedRemediation,
    );
  });

  it("AC3: Warning is shown if a token is heavily over-privileged", async () => {
    setupStep2Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    act(() => {
      fireEvent.change(getEl("select-gitHost-provider"), {
        target: { value: "github" },
      });
    });

    // Over-privileged token verified (e.g., has admin or delete permissions)
    api.providers.verify = mock(async () => ({
      status: "ok" as const,
      warnings: [],
      overPrivileged: true,
    }));

    await act(async () => {
      fireEvent.click(getEl("btn-verify-gitHost"));
    });

    const gitHostCard = getEl("connection-card-gitHost");
    // Shows verified status AND over-privileged warning from copy map
    expect(gitHostCard.textContent).toContain("Connection verified");
    expect(gitHostCard.textContent).toContain(CONNECTIONS_COPY.overPrivileged);
  });

  it("AC4: Technical errors (like GraphQL mutation names) are hidden or translated into actionable advice", async () => {
    setupStep2Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    act(() => {
      fireEvent.change(getEl("select-gitHost-provider"), {
        target: { value: "github" },
      });
    });

    // 1. Realistic server error shape (NormalizedError from provider controller)
    api.providers.verify = mock(async () => ({
      code: "PERMISSION" as const,
      context: "VERIFY" as const,
    }));

    await act(async () => {
      fireEvent.click(getEl("btn-verify-gitHost"));
    });

    const gitHostCard = getEl("connection-card-gitHost");
    const errorBanner = gitHostCard.querySelector(".feedback-banner--error");
    expect(errorBanner).not.toBeNull();
    // Displays exact canonical copy from ERROR_COPY
    const messageEl = errorBanner?.querySelector(".feedback-banner-message");
    expect(messageEl?.textContent).toBe(ERROR_COPY.PERMISSION.VERIFY);
    expect(errorBanner?.textContent).not.toContain("createPullRequest");

    // 2. Exception whose message contains raw technical text (e.g. GraphQL error)
    api.providers.verify = mock(async () => {
      throw new Error("createPullRequest mutation failed: insufficient_scope");
    });

    await act(async () => {
      fireEvent.click(getEl("btn-verify-gitHost"));
    });

    const updatedBanner = gitHostCard.querySelector(".feedback-banner--error");
    expect(updatedBanner).not.toBeNull();
    // Raw technical text is completely hidden; exact canonical errorFallback is displayed
    const updatedMessageEl = updatedBanner?.querySelector(
      ".feedback-banner-message",
    );
    expect(updatedMessageEl?.textContent).toBe(STATE_COPY.errorFallback);
    expect(updatedBanner?.textContent).not.toContain(
      "createPullRequest mutation failed",
    );
    expect(updatedBanner?.textContent).not.toContain("insufficient_scope");
  });

  it("State persistence: over-privileged warning and degraded scope notice persist across navigation", async () => {
    setupStep2Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    act(() => {
      fireEvent.change(getEl("select-tracker-provider"), {
        target: { value: "github" },
      });
      fireEvent.change(getEl("select-gitHost-provider"), {
        target: { value: "github" },
      });
    });

    api.providers.verify = mock(async () => ({
      status: "degraded" as const,
      warnings: [
        {
          kind: "CAPABILITY_UNCONFIRMED" as const,
          capability: "createPullRequest",
        },
      ],
      overPrivileged: true,
    }));

    await act(async () => {
      fireEvent.click(getEl("btn-verify-tracker"));
      fireEvent.click(getEl("btn-verify-gitHost"));
    });

    // Step 2 is degraded and verified -> navigate to step 3
    await act(async () => {
      fireEvent.click(getEl("btn-step-2-next"));
    });

    // Now on step 3 (Repositories) -> click Back to step 2
    await act(async () => {
      fireEvent.click(getEl("btn-step-3-back"));
    });

    // Check that GitHost card on step 2 still displays the degraded scope feedback and over-privileged warning
    const gitHostCard = getEl("connection-card-gitHost");
    expect(gitHostCard.textContent).toContain("Pull request creation");
    expect(gitHostCard.textContent).toContain(CONNECTIONS_COPY.overPrivileged);
  });

  it("Remount persistence: missingScopes and re-verify advice persist identical copy before and after navigation", async () => {
    setupStep2Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    act(() => {
      fireEvent.change(getEl("select-tracker-provider"), {
        target: { value: "github" },
      });
      fireEvent.change(getEl("select-gitHost-provider"), {
        target: { value: "github" },
      });
    });

    api.providers.verify = mock(async () => ({
      status: "degraded" as const,
      warnings: [
        {
          kind: "CAPABILITY_UNCONFIRMED" as const,
          capability: "createPullRequest",
          missingScopes: ["repo"],
        },
      ],
    }));

    await act(async () => {
      fireEvent.click(getEl("btn-verify-tracker"));
      fireEvent.click(getEl("btn-verify-gitHost"));
    });

    const gitHostCardBefore = getEl("connection-card-gitHost");
    // Before leaving Connect: card displays Missing: repo and re-verify advice
    expect(gitHostCardBefore.textContent).toContain("Missing: repo");
    expect(gitHostCardBefore.textContent).toContain(
      CONNECTIONS_COPY.degradedRemediation,
    );
    expect(gitHostCardBefore.textContent).not.toContain(
      CONNECTIONS_COPY.degradedRemediationUnconfirmed,
    );

    const beforeCopy = gitHostCardBefore.textContent;

    // Leave Connect step -> navigate to Step 3 (Repositories)
    await act(async () => {
      fireEvent.click(getEl("btn-step-2-next"));
    });

    // Remount Connect step -> navigate Back to Step 2
    await act(async () => {
      fireEvent.click(getEl("btn-step-3-back"));
    });

    const gitHostCardAfter = getEl("connection-card-gitHost");
    // Assert exact same copy before and after remount
    expect(gitHostCardAfter.textContent).toBe(beforeCopy);
    expect(gitHostCardAfter.textContent).toContain("Missing: repo");
    expect(gitHostCardAfter.textContent).toContain(
      CONNECTIONS_COPY.degradedRemediation,
    );
    expect(gitHostCardAfter.textContent).not.toContain(
      CONNECTIONS_COPY.degradedRemediationUnconfirmed,
    );
  });
});
