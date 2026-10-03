import { queryClient } from "../src/frontend/lib/query-client.js";
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
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import type userEventLib from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import {
  DEFAULT_WORKSPACE_PATH,
  OnboardingWizardModal,
} from "../src/frontend/components/modals/OnboardingWizardModal.js";
import {
  ModalProvider,
  useModal,
} from "../src/frontend/context/ModalContext.js";
import type { InspectRepositoryResponse } from "../src/frontend/lib/api-client.js";

type DiscoverRepositoriesResponse = {
  provider?: string;
  repositories: Array<{
    id: string;
    name: string;
    remote?: string;
    defaultBranch?: string;
    webUrl?: string;
  }>;
};

type TestAzureScopesResponse = {
  ok: boolean;
  overPrivileged?: boolean;
  scopes?: Record<string, unknown>;
  warnings?: string[];
  error?: string;
};

let userEvent: ReturnType<typeof userEventLib.setup>;

// Mock the API client
const mockDiscoverRepositories = mock(
  async (): Promise<DiscoverRepositoriesResponse> => {
    return {
      repositories: [
        {
          id: "repo-1",
          name: "converso-core",
          remote: "https://dev.azure.com/xynotech/Converso/_git/converso-core",
          defaultBranch: "main",
        },
        {
          id: "repo-2",
          name: "converso-frontend",
          remote:
            "https://dev.azure.com/xynotech/Converso/_git/converso-frontend",
          defaultBranch: "main",
        },
      ],
    };
  },
);

const mockTestAzureScopes = mock(async (): Promise<TestAzureScopesResponse> => {
  return {
    ok: true,
    overPrivileged: true,
    scopes: {
      workItemsRead: true,
      codeRead: true,
      codeStatus: true,
      workItemsWriteDetected: true,
      codeFullDetected: false,
    },
    warnings: ["Token has elevated permissions"],
  };
});

let mockProjects: unknown[] = [];
const mockGetProjects = mock(async () => mockProjects);

const mockInspectRepository = mock(
  async ({ path }: { path: string }): Promise<InspectRepositoryResponse> => {
    return {
      path,
      exists: true,
      isGitRepo: true,
      defaultBranch: "main",
      detectedCommands: { test: "bun test" },
      detectedTooling: ["bun"],
      readiness: {
        status: "ready",
        message: "Ready for agentic operations",
      },
    };
  },
);

let invalidateProjectsHook: (() => Promise<void>) | null = null;
const mockInvalidateProjects = mock(async () => {
  if (invalidateProjectsHook) {
    await invalidateProjectsHook();
  }
});

mock.module("../src/frontend/lib/query-client.js", () => {
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
    invalidateProjects: mockInvalidateProjects,
    invalidateProject: mock(async () => {}),
    invalidateTickets: mock(async () => {}),
    invalidateRuns: mock(async () => {}),
    invalidateRun: mock(async () => {}),
    patchTicketInQueries: mock(() => {}),
    patchRunInQueries: mock(() => {}),
    applySsePatch: mock(() => {}),
  };
});

mock.module("../src/frontend/lib/api-client.js", () => {
  return {
    api: {
      discoverRepositories: mockDiscoverRepositories,
      testAzureScopes: mockTestAzureScopes,
      getProjects: mockGetProjects,
      inspectRepository: mockInspectRepository,
    },
  };
});

function TestHarness() {
  const { openOnboardingModal, closeOnboardingModal, isOnboardingOpen } =
    useModal();
  return (
    <div>
      <button
        type="button"
        id="ctrl-open-onboarding"
        onClick={openOnboardingModal}
      >
        Open Wizard
      </button>
      <button
        type="button"
        id="ctrl-close-onboarding"
        onClick={closeOnboardingModal}
      >
        Close Wizard
      </button>
      <div id="ctrl-modal-status">{isOnboardingOpen ? "open" : "closed"}</div>
      <OnboardingWizardModal />
    </div>
  );
}

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ModalProvider>
          <TestHarness />
        </ModalProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Wizard Explicit State Reset & Sensitive Fields (#116)", () => {
  afterAll(async () => {
    await unregisterHappyDom();
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    document.body.innerHTML = "";
  });

  beforeEach(async () => {
    const module = await import("@testing-library/user-event");
    userEvent = module.default.setup({ document: globalThis.document });
    mockProjects = [];
    mockGetProjects.mockClear();
    mockDiscoverRepositories.mockClear();
    mockTestAzureScopes.mockClear();
    mockInspectRepository.mockClear();
    invalidateProjectsHook = null;
    mockInvalidateProjects.mockClear();
  });

  it("explicitly resets all onboarding state and clears sensitive PAT when modal closes and reopens", async () => {
    const { container } = renderApp();

    // 1. Open the wizard
    const openBtn = container.querySelector(
      "#ctrl-open-onboarding",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(openBtn);
    });

    expect(container.querySelector("#modal-project-onboarding") !== null).toBe(true);
    expect(container.querySelector("#onboard-step-1") !== null).toBe(true);

    // 2. Fill project name, ID, and custom workspace path
    const nameInput = container.querySelector(
      "#onboard-proj-name",
    ) as HTMLInputElement;
    const idInput = container.querySelector(
      "#onboard-proj-id",
    ) as HTMLInputElement;
    const wsInput = container.querySelector(
      "#onboard-workspace-path",
    ) as HTMLInputElement;

    await act(async () => {
      await userEvent.type(nameInput, "Alpha Project");
      await userEvent.clear(idInput);
      await userEvent.type(idInput, "alpha-project");
      await userEvent.clear(wsInput);
      await userEvent.type(wsInput, "/custom/workspace/path");
    });

    expect(nameInput.value).toBe("Alpha Project");
    expect(idInput.value).toBe("alpha-project");
    expect(wsInput.value).toBe("/custom/workspace/path");

    // Advance to Step 2
    const step1Next = container.querySelector(
      "#btn-step-1-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step1Next);
    });

    expect(container.querySelector("#onboard-step-2") !== null).toBe(true);

    // 3. Enter Azure organization/project & 4. Enter fake PAT
    const orgInput = container.querySelector(
      "#onboard-azure-org-url",
    ) as HTMLInputElement;
    const projInput = container.querySelector(
      "#onboard-tracker-project",
    ) as HTMLInputElement;
    const patInput = container.querySelector(
      "#onboard-azure-pat",
    ) as HTMLInputElement;

    await act(async () => {
      await userEvent.type(orgInput, "https://dev.azure.com/xynotech");
      await userEvent.type(projInput, "Converso");
      await userEvent.type(patInput, "super-secret-pat-12345");
    });

    expect(patInput.value).toBe("super-secret-pat-12345");

    // 5. Run PAT verification state
    const verifyPatBtn = container.querySelector(
      "#btn-verify-azure-pat",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(verifyPatBtn);
    });

    await waitFor(() => {
      expect(
        container.querySelector("#azure-scope-diagnostic-card"),
      ).not.toBeNull();
    });

    // Acknowledge least privilege warning
    const ackCheckbox = container.querySelector(
      "#chk-pat-least-privilege-ack",
    ) as HTMLInputElement;
    expect(ackCheckbox).not.toBeNull();
    await act(async () => {
      fireEvent.click(ackCheckbox);
    });
    expect(ackCheckbox.checked).toBe(true);

    // Advance to Step 3 (triggers discovery)
    const step2Next = container.querySelector(
      "#btn-step-2-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step2Next);
    });

    // 6. Populate discovery state
    expect(container.querySelector("#onboard-step-3") !== null).toBe(true);
    await waitFor(() => {
      expect(mockDiscoverRepositories).toHaveBeenCalledTimes(1);
    });

    // 7. Advance to Step 4 and populate repository configuration state
    const step3Next = container.querySelector(
      "#btn-step-3-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step3Next);
    });

    expect(container.querySelector("#onboard-step-4") !== null).toBe(true);
    expect(container.querySelector("#discovered-repos-list") !== null).toBe(true);

    // 8. Reach later wizard steps (Step 5 Inspection, then Step 6 Review)
    const step4Next = container.querySelector(
      "#btn-step-4-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step4Next);
    });

    expect(container.querySelector("#onboard-step-5") !== null).toBe(true);
    await waitFor(() => {
      expect(mockInspectRepository).toHaveBeenCalled();
    });

    const step5Next = container.querySelector(
      "#btn-step-5-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step5Next);
    });

    expect(container.querySelector("#onboard-step-6") !== null).toBe(true);
    expect(container.querySelector("#review-project-name")?.textContent).toBe(
      "Alpha Project",
    );

    // 9. Close the wizard via modal header close button
    const closeBtn = container.querySelector(
      "#btn-close-onboard-modal",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(closeBtn);
    });

    // Modal is closed
    expect(container.querySelector("#modal-project-onboarding") === null).toBe(true);
    expect(container.querySelector("#ctrl-modal-status")?.textContent).toBe(
      "closed",
    );

    // 10. Reopen the wizard
    await act(async () => {
      fireEvent.click(openBtn);
    });

    expect(container.querySelector("#modal-project-onboarding") !== null).toBe(true);

    // 11. Verify the wizard starts at Step 1
    expect(container.querySelector("#onboard-step-1") !== null).toBe(true);
    expect(container.querySelector("#onboard-step-6") === null).toBe(true);
    expect(container.querySelector("#onboard-step-2") === null).toBe(true);

    // 12. Verify every onboarding field is back to its initial value
    const freshNameInput = container.querySelector(
      "#onboard-proj-name",
    ) as HTMLInputElement;
    const freshIdInput = container.querySelector(
      "#onboard-proj-id",
    ) as HTMLInputElement;
    const freshWsInput = container.querySelector(
      "#onboard-workspace-path",
    ) as HTMLInputElement;
    const freshQuickUrlInput = container.querySelector(
      "#onboard-quick-url",
    ) as HTMLInputElement;

    expect(freshNameInput.value).toBe("");
    expect(freshIdInput.value).toBe("");
    expect(freshQuickUrlInput.value).toBe("");
    expect(freshWsInput.value).toBe(DEFAULT_WORKSPACE_PATH);

    // Advance to Step 2 with new inputs to verify Step 2 fields
    await act(async () => {
      await userEvent.type(freshNameInput, "Second Session");
    });
    const freshStep1Next = container.querySelector(
      "#btn-step-1-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(freshStep1Next);
    });

    expect(container.querySelector("#onboard-step-2") !== null).toBe(true);

    const freshOrgInput = container.querySelector(
      "#onboard-azure-org-url",
    ) as HTMLInputElement;
    const freshProjInput = container.querySelector(
      "#onboard-tracker-project",
    ) as HTMLInputElement;
    const freshPatInput = container.querySelector(
      "#onboard-azure-pat",
    ) as HTMLInputElement;

    // 13. Verify the PAT is empty
    expect(freshPatInput.value).toBe("");
    expect(freshOrgInput.value).toBe("");
    expect(freshProjInput.value).toBe("");

    // 14. Verify PAT-derived state is cleared
    expect(
      container.querySelector("#scope-status-pill")?.textContent?.trim(),
    ).toBe("Awaiting Verification");
    expect(container.querySelector("#scope-overprivileged-warning") === null).toBe(true);
    expect(container.querySelector("#chk-pat-least-privilege-ack") === null).toBe(true);

    // 15 & 16. Verify discovery, repository configs, and inspection states are reset
    // Advance to Step 3 with minimal inputs
    await act(async () => {
      await userEvent.type(freshOrgInput, "https://dev.azure.com/fresh-org");
      await userEvent.type(freshProjInput, "FreshProject");
      await userEvent.type(freshPatInput, "fresh-pat-xyz");
    });
    const freshStep2Next = container.querySelector(
      "#btn-step-2-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(freshStep2Next);
    });

    expect(container.querySelector("#onboard-step-3") !== null).toBe(true);
    // Discovery runs anew for fresh session
    await waitFor(() => {
      expect(mockDiscoverRepositories).toHaveBeenCalledTimes(2);
    });
  });

  it("clears state when closing via the Step 1 Cancel button", async () => {
    const { container } = renderApp();

    const openBtn = container.querySelector(
      "#ctrl-open-onboarding",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(openBtn);
    });

    const nameInput = container.querySelector(
      "#onboard-proj-name",
    ) as HTMLInputElement;
    const wsInput = container.querySelector(
      "#onboard-workspace-path",
    ) as HTMLInputElement;

    await act(async () => {
      await userEvent.type(nameInput, "Cancelled Project");
      await userEvent.clear(wsInput);
      await userEvent.type(wsInput, "/cancelled/path");
    });

    const cancelBtn = container.querySelector(
      "#btn-step-1-cancel",
    ) as HTMLButtonElement;
    expect(cancelBtn).not.toBeNull();
    await act(async () => {
      fireEvent.click(cancelBtn);
    });

    expect(container.querySelector("#modal-project-onboarding") === null).toBe(true);

    // Reopen
    await act(async () => {
      fireEvent.click(openBtn);
    });

    const freshNameInput = container.querySelector(
      "#onboard-proj-name",
    ) as HTMLInputElement;
    const freshWsInput = container.querySelector(
      "#onboard-workspace-path",
    ) as HTMLInputElement;

    expect(freshNameInput.value).toBe("");
    expect(freshWsInput.value).toBe(DEFAULT_WORKSPACE_PATH);
  });

  it("17. ensures an outstanding async operation from an old session cannot restore stale data after reset", async () => {
    let resolveStaleScope: (val: TestAzureScopesResponse) => void = () => {};
    let resolveStaleDiscovery: (val: DiscoverRepositoriesResponse) => void =
      () => {};

    mockTestAzureScopes.mockImplementationOnce(() => {
      return new Promise<TestAzureScopesResponse>((resolve) => {
        resolveStaleScope = resolve;
      });
    });

    mockDiscoverRepositories.mockImplementationOnce(() => {
      return new Promise<DiscoverRepositoriesResponse>((resolve) => {
        resolveStaleDiscovery = resolve;
      });
    });

    const { container } = renderApp();

    // Open Session 1
    const openBtn = container.querySelector(
      "#ctrl-open-onboarding",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(openBtn);
    });

    // Fill Step 1
    const nameInput = container.querySelector(
      "#onboard-proj-name",
    ) as HTMLInputElement;
    await act(async () => {
      await userEvent.type(nameInput, "Session 1 Project");
    });
    const step1Next = container.querySelector(
      "#btn-step-1-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step1Next);
    });

    // Step 2: enter credentials & trigger in-flight PAT verification
    const orgInput = container.querySelector(
      "#onboard-azure-org-url",
    ) as HTMLInputElement;
    const projInput = container.querySelector(
      "#onboard-tracker-project",
    ) as HTMLInputElement;
    const patInput = container.querySelector(
      "#onboard-azure-pat",
    ) as HTMLInputElement;

    await act(async () => {
      await userEvent.type(orgInput, "https://dev.azure.com/stale-org");
      await userEvent.type(projInput, "StaleProject");
      await userEvent.type(patInput, "stale-secret-pat-999");
    });

    const verifyPatBtn = container.querySelector(
      "#btn-verify-azure-pat",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(verifyPatBtn);
    });

    // Advance to Step 3 while PAT verification is still in flight (to trigger in-flight discovery as well)
    const step2Next = container.querySelector(
      "#btn-step-2-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step2Next);
    });

    expect(container.querySelector("#onboard-step-3") !== null).toBe(true);

    // While both operations are in-flight, user closes the wizard
    const closeBtn = container.querySelector(
      "#btn-close-onboard-modal",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(closeBtn);
    });

    expect(container.querySelector("#modal-project-onboarding") === null).toBe(true);

    // Reopen for Session 2
    await act(async () => {
      fireEvent.click(openBtn);
    });

    expect(container.querySelector("#onboard-step-1") !== null).toBe(true);

    // Now Session 1's pending PAT verification promise and discovery promise resolve!
    await act(async () => {
      resolveStaleScope({
        ok: true,
        overPrivileged: true,
        scopes: {
          workItemsRead: true,
          codeRead: true,
          codeStatus: true,
          workItemsWriteDetected: true,
          codeFullDetected: false,
        },
        warnings: ["Stale Session 1 warning"],
      });
      resolveStaleDiscovery({
        repositories: [
          {
            id: "stale-repo-id",
            name: "stale-repo",
            remote: "https://dev.azure.com/stale/repo",
            defaultBranch: "main",
          },
        ],
      });
    });

    // Navigate to Step 2 in Session 2
    const freshNameInput = container.querySelector(
      "#onboard-proj-name",
    ) as HTMLInputElement;
    await act(async () => {
      await userEvent.type(freshNameInput, "Session 2 Project");
    });
    const freshStep1Next = container.querySelector(
      "#btn-step-1-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(freshStep1Next);
    });

    const freshPatInput = container.querySelector(
      "#onboard-azure-pat",
    ) as HTMLInputElement;

    // Must be completely empty - stale PAT cannot repopulate
    expect(freshPatInput.value).toBe("");

    // Scope status from Session 1 must NOT appear
    expect(
      container.querySelector("#scope-status-pill")?.textContent?.trim(),
    ).toBe("Awaiting Verification");
    expect(container.querySelector("#scope-overprivileged-warning") === null).toBe(true);
  });

  it("ensures a pending submission across close and reopen cannot close or reset the new session", async () => {
    const originalFetch = globalThis.fetch;
    const mockFetch = mock(async (url: string, init?: RequestInit) => {
      if (url === "/api/projects" && init?.method === "POST") {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    let resolveInvalidate: () => void = () => {};
    invalidateProjectsHook = () => {
      return new Promise<void>((resolve) => {
        resolveInvalidate = resolve;
      });
    };

    try {
      const { container } = renderApp();
      const openBtn = container.querySelector(
        "#ctrl-open-onboarding",
      ) as HTMLButtonElement;

      // 1. Open wizard and advance through steps to Step 6
      await act(async () => {
        fireEvent.click(openBtn);
      });

      // Fill Step 1
      const nameInput = container.querySelector(
        "#onboard-proj-name",
      ) as HTMLInputElement;
      await act(async () => {
        await userEvent.type(nameInput, "Session 1 Project");
      });
      await act(async () => {
        fireEvent.click(
          container.querySelector("#btn-step-1-next") as HTMLButtonElement,
        );
      });

      // Step 2: enter org, project, PAT
      await act(async () => {
        await userEvent.type(
          container.querySelector("#onboard-azure-org-url") as HTMLInputElement,
          "https://dev.azure.com/xynotech",
        );
        await userEvent.type(
          container.querySelector(
            "#onboard-tracker-project",
          ) as HTMLInputElement,
          "Converso",
        );
        await userEvent.type(
          container.querySelector("#onboard-azure-pat") as HTMLInputElement,
          "pat-123",
        );
      });
      // Verify PAT & acknowledge
      await act(async () => {
        fireEvent.click(
          container.querySelector("#btn-verify-azure-pat") as HTMLButtonElement,
        );
      });
      await waitFor(() => {
        expect(
          container.querySelector("#chk-pat-least-privilege-ack"),
        ).not.toBeNull();
      });
      await act(async () => {
        fireEvent.click(
          container.querySelector(
            "#chk-pat-least-privilege-ack",
          ) as HTMLInputElement,
        );
      });
      // Step 2 -> 3
      await act(async () => {
        fireEvent.click(
          container.querySelector("#btn-step-2-next") as HTMLButtonElement,
        );
      });
      // Step 3 -> 4
      await waitFor(() => {
        expect(container.querySelector("#onboard-step-3") !== null).toBe(true);
      });
      await act(async () => {
        fireEvent.click(
          container.querySelector("#btn-step-3-next") as HTMLButtonElement,
        );
      });
      // Step 4 -> 5
      await act(async () => {
        fireEvent.click(
          container.querySelector("#btn-step-4-next") as HTMLButtonElement,
        );
      });
      // Step 5 -> 6
      await waitFor(() => {
        expect(mockInspectRepository).toHaveBeenCalled();
      });
      await act(async () => {
        fireEvent.click(
          container.querySelector("#btn-step-5-next") as HTMLButtonElement,
        );
      });

      expect(container.querySelector("#onboard-step-6") !== null).toBe(true);

      // 2. Start submission (clicks submit button)
      const submitBtn = container.querySelector(
        "#btn-onboard-submit",
      ) as HTMLButtonElement;
      await act(async () => {
        fireEvent.click(submitBtn);
      });

      // Fetch has been called, and invalidateProjects is now pending
      expect(mockFetch).toHaveBeenCalled();
      expect(mockInvalidateProjects).toHaveBeenCalled();

      // 3. User closes the wizard while invalidateProjects is still pending
      const closeBtn = container.querySelector(
        "#btn-close-onboard-modal",
      ) as HTMLButtonElement;
      await act(async () => {
        fireEvent.click(closeBtn);
      });

      // Wizard is closed
      expect(container.querySelector("#modal-project-onboarding") === null).toBe(true);

      // Reopen for Session 2
      await act(async () => {
        fireEvent.click(openBtn);
      });

      // Session 2 is open at Step 1
      expect(
        container.querySelector("#modal-project-onboarding"),
      ).not.toBeNull();
      expect(container.querySelector("#onboard-step-1") !== null).toBe(true);

      // User starts typing in Session 2
      const freshNameInput = container.querySelector(
        "#onboard-proj-name",
      ) as HTMLInputElement;
      await act(async () => {
        await userEvent.type(freshNameInput, "Session 2 Project In Progress");
      });
      expect(freshNameInput.value).toBe("Session 2 Project In Progress");

      // 4. Resolve the old invalidateProjects() from Session 1
      await act(async () => {
        resolveInvalidate();
      });

      // 5. Verify that the new session remains open
      expect(
        container.querySelector("#modal-project-onboarding"),
      ).not.toBeNull();
      expect(container.querySelector("#onboard-step-1") !== null).toBe(true);

      // 6. Verify that Session 2 state was NOT closed or reset by the stale submission
      const currentNameInput = container.querySelector(
        "#onboard-proj-name",
      ) as HTMLInputElement;
      expect(currentNameInput.value).toBe("Session 2 Project In Progress");
      expect(container.querySelector("#ctrl-modal-status")?.textContent).toBe(
        "open",
      );
    } finally {
      globalThis.fetch = originalFetch;
      invalidateProjectsHook = null;
    }
  });
});
