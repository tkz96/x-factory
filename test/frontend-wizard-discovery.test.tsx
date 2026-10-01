/// <reference lib="dom" />
import { GlobalRegistrator } from "@happy-dom/global-registrator";

try {
  GlobalRegistrator.register();
} catch {
  // already registered
}

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
import { useEffect, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import {
  OnboardingWizardModal,
  Step4Repositories,
} from "../src/frontend/components/modals/OnboardingWizardModal.js";
import {
  type DiscoveredRepositoryLike,
  deriveConfiguredRepositories,
  type RepoItemConfig,
  validateRepositorySelection,
} from "../src/frontend/lib/wizard-repositories.js";
import type { ProjectRepository } from "../src/shared/types.js";

// We'll import userEvent dynamically to ensure it runs AFTER GlobalRegistrator sets up window/document
let userEvent: any;

// Mock the API client
const mockDiscoverRepositories = mock<any>(async () => {
  return { repositories: [] };
});
const mockTestAzureScopes = mock<any>(async () => {
  return { ok: true, overPrivileged: false, scopes: {} };
});
let mockProjects: any[] = [];
const mockGetProjects = mock<any>(async () => mockProjects);

// Mock fetch for createProject
const mockFetch = mock<any>(async () => {
  return new Response(JSON.stringify({ id: "test-id" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

const mockInspectRepository = mock<any>(async ({ path }: { path: string }) => {
  return {
    path,
    exists: true,
    isGitRepo: true,
    defaultBranch: "main",
    detectedCommands: { test: "bun test" },
    detectedTooling: ["bun"],
    readiness: {
      status: "ready",
      message: "Ready",
    },
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

mock.module("../src/frontend/context/ModalContext.js", () => {
  return {
    useModal: () => ({
      isOnboardingOpen: true,
      closeOnboardingModal: () => {},
    }),
    ModalProvider: ({ children }: any) => <div>{children}</div>,
  };
});

function TestWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OnboardingWizardModal />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Frontend Wizard Discovery (Step 3)", () => {
  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 100));
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  beforeEach(async () => {
    if (!userEvent) {
      const module = await import("@testing-library/user-event");
      userEvent = module.default;
    }
    mockProjects = [];
    mockGetProjects.mockClear();
    mockDiscoverRepositories.mockClear();
    mockTestAzureScopes.mockClear();
    mockFetch.mockClear();
  });

  async function advanceToStep3(container: HTMLElement) {
    // Step 1
    // Fill Project Name and ID
    const nameInput = container.querySelector(
      "#onboard-proj-name",
    ) as HTMLInputElement;
    const idInput = container.querySelector(
      "#onboard-proj-id",
    ) as HTMLInputElement;

    await act(async () => {
      await userEvent.type(nameInput, "Test Project");
      await userEvent.clear(idInput);
      await userEvent.type(idInput, "test-project");
    });

    const step1Next = container.querySelector(
      "#btn-step-1-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step1Next);
    });

    // Step 2
    const orgInput = container.querySelector(
      "#onboard-azure-org-url",
    ) as HTMLInputElement;
    const projInput = container.querySelector(
      "#onboard-tracker-project",
    ) as HTMLInputElement;
    const patInput = container.querySelector(
      "#onboard-azure-pat",
    ) as HTMLInputElement;

    // For Azure: Org URL, Project Name, PAT
    expect(orgInput).not.toBeNull();
    expect(projInput).not.toBeNull();
    expect(patInput).not.toBeNull();

    await act(async () => {
      await userEvent.type(orgInput, "https://dev.azure.com/xynotech");
      await userEvent.type(projInput, "Converso");
      await userEvent.type(patInput, "fake-pat");
    });

    const step2Next = container.querySelector(
      "#btn-step-2-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step2Next);
    });
  }

  it("triggers discovery exactly once and prevents duplicates, preserving repository metadata", async () => {
    const fourteenRepos = [
      {
        id: "1",
        name: "ai-engine",
        defaultBranch: "main",
        remote: "remote1",
        webUrl: "https://dev.azure.com/1",
      },
      {
        id: "2",
        name: "Vendifai-Custom",
        defaultBranch: "master",
        remote: "remote2",
      },
      { id: "3", name: "ai-docs", defaultBranch: "main", remote: "remote3" },
      {
        id: "4",
        name: "Shopify-Plugin",
        defaultBranch: "main",
        remote: "remote4",
      },
      {
        id: "5",
        name: "Converso-Front-End",
        defaultBranch: "main",
        remote: "remote5",
      },
      {
        id: "6",
        name: "VendifAi-Extension",
        defaultBranch: "main",
        remote: "remote6",
      },
      {
        id: "7",
        name: "converso-infra-prod",
        defaultBranch: "main",
        remote: "remote7",
      },
      {
        id: "8",
        name: "converso-portal",
        defaultBranch: "main",
        remote: "remote8",
      },
      {
        id: "9",
        name: "ticket-agent",
        defaultBranch: "main",
        remote: "remote9",
      },
      { id: "10", name: "RBRE", defaultBranch: "main", remote: "remote10" },
      {
        id: "11",
        name: "Vendifai-pulse",
        defaultBranch: "main",
        remote: "remote11",
      },
      { id: "12", name: "Converso", defaultBranch: "main", remote: "remote12" },
      {
        id: "13",
        name: "vendifiai-test-automation",
        defaultBranch: "main",
        remote: "remote13",
      },
      {
        id: "14",
        name: "converso-infra",
        defaultBranch: "main",
        remote: "remote14",
      },
    ];
    mockDiscoverRepositories.mockResolvedValueOnce({
      repositories: fourteenRepos,
    });

    const { container } = render(<TestWrapper />);
    await advanceToStep3(container);

    await waitFor(() => {
      expect(mockDiscoverRepositories).toHaveBeenCalledTimes(1);
    });

    // Verify correct payload
    const callArg = (mockDiscoverRepositories.mock.calls[0] as any)[0];
    expect(callArg).toEqual({
      provider: "azure",
      orgUrl: "https://dev.azure.com/xynotech",
      project: "Converso",
      pat: "fake-pat",
      workspacePath: "/Users/talhazuberi/projects",
    });

    // Check successful discovery state
    expect(container.textContent).toContain("14 repositories discovered");

    // Assert repository metadata is preserved
    const result0 = mockDiscoverRepositories.mock.results[0];
    if (!result0) throw new Error("mockDiscoverRepositories not called");
    const callRes = await result0.value;
    expect(callRes.repositories.length).toBe(14);
    const aiEngine = callRes.repositories.find(
      (r: any) => r.name === "ai-engine",
    );
    expect(aiEngine.id).toBe("1");
    expect(aiEngine.name).toBe("ai-engine");
    expect(aiEngine.defaultBranch).toBe("main");
    expect(aiEngine.remote).toBe("remote1");
    expect(aiEngine.webUrl).toBe("https://dev.azure.com/1");

    // Click back to step 2
    const step3Actions = container.querySelector(
      "#onboard-step-3 .modal-actions",
    ) as HTMLElement;
    const backBtn = step3Actions.querySelector(
      ".btn-secondary",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(backBtn);
    });

    await waitFor(() => {
      expect(container.querySelector("#btn-step-2-next")).not.toBeNull();
    });

    // Click next to step 3 again
    const step2Next = container.querySelector(
      "#btn-step-2-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step2Next);
    });

    // Discovery should NOT be called again because inputs didn't change and result is cached
    expect(mockDiscoverRepositories).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("14 repositories discovered");

    // Proceed to Step 4
    const step3Next = container.querySelector(
      "#btn-step-3-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step3Next);
    });

    await waitFor(() => {
      expect(container.textContent).toContain("Configure Repositories");
    });

    // Verify repositories and metadata are rendered in Step 4
    expect(container.textContent).toContain("ai-engine (remote1)");
    expect(container.textContent).toContain("Converso-Front-End (remote5)");
    expect(container.textContent).toContain("converso-infra (remote14)");
  });

  it("handles discovery failure, prevents next step, and recovers on retry", async () => {
    // 1. Mock rejection
    mockDiscoverRepositories.mockRejectedValueOnce(new Error("Network Error"));
    const { container } = render(<TestWrapper />);

    // Step 1 & 2
    await advanceToStep3(container);

    // 2 & 3. Request fails and Loading ends
    await waitFor(() => {
      expect(mockDiscoverRepositories).toHaveBeenCalledTimes(1);
      expect(container.textContent).toContain(
        "Discovery failed: Network Error",
      );
    });

    // 4. Error message is shown
    expect(container.textContent).toContain("Discovery failed: Network Error");

    // 5. Continue button is disabled
    const step3Next = container.querySelector(
      "#btn-step-3-next",
    ) as HTMLButtonElement;
    expect(step3Next.disabled).toBe(true);

    // 6. Retry is available
    const retryBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Retry",
    );
    expect(retryBtn).toBeDefined();

    // 7. Clicking Retry performs exactly one new discovery request
    mockDiscoverRepositories.mockResolvedValueOnce({
      repositories: [{ id: "1", name: "ai-engine" }],
    });

    await act(async () => {
      fireEvent.click(retryBtn!);
    });

    // 8. Successful retry clears error and shows new discovery result
    await waitFor(() => {
      expect(mockDiscoverRepositories).toHaveBeenCalledTimes(2);
      expect(container.textContent).not.toContain("Discovery failed");
      expect(container.textContent).toContain("1 repositories discovered");
    });

    // Next button should be enabled
    expect(step3Next.disabled).toBe(false);
  });

  it("handles empty discovery results properly", async () => {
    mockDiscoverRepositories.mockResolvedValueOnce({
      repositories: [],
    });

    const { container } = render(<TestWrapper />);
    await advanceToStep3(container);

    await waitFor(() => {
      expect(mockDiscoverRepositories).toHaveBeenCalledTimes(1);
    });

    // Should show empty state
    expect(container.textContent).toContain("No repositories found.");

    // Step 3 Next button should NOT be disabled
    const step3Next = container.querySelector(
      "#btn-step-3-next",
    ) as HTMLButtonElement;
    expect(step3Next.disabled).toBe(false);

    // Go back to Step 2 and return to Step 3, empty state should be cached
    const step3Actions = container.querySelector(
      "#onboard-step-3 .modal-actions",
    ) as HTMLElement;
    const backBtn = step3Actions.querySelector(
      ".btn-secondary",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(backBtn);
    });

    await waitFor(() => {
      expect(container.querySelector("#btn-step-2-next")).not.toBeNull();
    });

    const step2Next = container.querySelector(
      "#btn-step-2-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step2Next);
    });

    expect(mockDiscoverRepositories).toHaveBeenCalledTimes(1);

    // Explicit Retry should run discovery again
    const retryBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Retry Discovery",
    );
    expect(retryBtn).toBeDefined();
    await act(async () => {
      fireEvent.click(retryBtn!);
    });

    expect(mockDiscoverRepositories).toHaveBeenCalledTimes(2);
  });

  it("protects against stale concurrent responses", async () => {
    // We will simulate two requests where the first is slow and the second is fast
    let resolveFirst: any, resolveSecond: any;
    const promise1 = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const promise2 = new Promise((resolve) => {
      resolveSecond = resolve;
    });

    mockDiscoverRepositories
      .mockReturnValueOnce(promise1 as any)
      .mockReturnValueOnce(promise2 as any);

    const { container } = render(<TestWrapper />);
    await advanceToStep3(container); // Triggers request 1

    expect(mockDiscoverRepositories).toHaveBeenCalledTimes(1);

    // Go back to Step 2, change inputs, and go next to trigger request 2
    const backBtn = container.querySelector(
      "#onboard-step-3 .btn-secondary",
    ) as HTMLButtonElement;
    fireEvent.click(backBtn);

    const projInput = container.querySelector(
      "#onboard-tracker-project",
    ) as HTMLInputElement;
    await act(async () => {
      await userEvent.clear(projInput);
      await userEvent.type(projInput, "Converso2");
    });

    const step2Next = container.querySelector(
      "#btn-step-2-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step2Next);
    });

    expect(mockDiscoverRepositories).toHaveBeenCalledTimes(2);

    // Resolve second request first (Fast)
    await act(async () => {
      resolveSecond({
        repositories: [{ id: "2", name: "repo-fast" }],
      });
    });

    // Verify it shows repo-fast
    expect(container.textContent).toContain("1 repositories discovered");

    // Resolve first request later (Slow)
    await act(async () => {
      resolveFirst({
        repositories: [{ id: "1", name: "repo-slow" }],
      });
    });

    // Verify it STILL shows repo-fast, not overwritten by slow
    expect(container.textContent).toContain("1 repositories discovered");

    await waitFor(() => {
      expect(container.querySelector("#btn-step-3-next")).not.toBeNull();
    });
    const step3Next = container.querySelector(
      "#btn-step-3-next",
    ) as HTMLButtonElement;
    fireEvent.click(step3Next);

    expect(container.textContent).toContain("Configure Repositories");
  });

  it("invalidates discovery when the PAT changes", async () => {
    mockDiscoverRepositories.mockResolvedValueOnce({
      repositories: [{ id: "1", name: "repo1" }],
    });

    const { container } = render(<TestWrapper />);
    await advanceToStep3(container);

    await waitFor(() => {
      expect(mockDiscoverRepositories).toHaveBeenCalledTimes(1);
    });

    expect(container.textContent).toContain("1 repositories discovered");

    // Go back to Step 2
    const step3Actions = container.querySelector(
      "#onboard-step-3 .modal-actions",
    ) as HTMLElement;
    const backBtn = step3Actions.querySelector(
      ".btn-secondary",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(backBtn);
    });

    await waitFor(() => {
      expect(container.querySelector("#btn-step-2-next")).not.toBeNull();
    });

    // Change the PAT
    const patInput = container.querySelector(
      "#onboard-azure-pat",
    ) as HTMLInputElement;
    await act(async () => {
      await userEvent.clear(patInput);
      await userEvent.type(patInput, "new-pat");
    });

    // Mock next discovery
    mockDiscoverRepositories.mockResolvedValueOnce({
      repositories: [{ id: "2", name: "repo2" }],
    });

    // Go to Step 3
    const step2Next = container.querySelector(
      "#btn-step-2-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step2Next);
    });

    // Discovery should be called again because the PAT change invalidated the state
    await waitFor(() => {
      expect(mockDiscoverRepositories).toHaveBeenCalledTimes(2);
    });

    // Verify it sent the new PAT
    const callArg2 = (mockDiscoverRepositories.mock.calls[1] as any)[0];
    expect(callArg2.pat).toBe("new-pat");
  });

  it("ensures PAT is not stored in final creation payload", async () => {
    mockDiscoverRepositories.mockResolvedValue({
      repositories: [
        { id: "1", name: "repo1", defaultBranch: "main", remote: "remote1" },
      ],
    });

    const { container } = render(<TestWrapper />);
    await advanceToStep3(container);

    await waitFor(() => {
      expect(mockDiscoverRepositories).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(container.querySelector("#btn-step-3-next")).not.toBeNull();
    });
    // Go to step 4
    const step3Next = container.querySelector(
      "#btn-step-3-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step3Next);
    });

    await waitFor(() => {
      expect(container.querySelector("#btn-step-4-next")).not.toBeNull();
    });
    // Step 4 (Repositories) -> check the repo, click Next
    const step4Next = container.querySelector(
      "#btn-step-4-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step4Next);
    });

    await waitFor(() => {
      expect(container.querySelector("#btn-step-5-next")).not.toBeNull();
    });
    // Step 5 (Run Configuration) -> Next
    const step5Next = container.querySelector(
      "#btn-step-5-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step5Next);
    });

    await waitFor(() => {
      expect(container.querySelector("#btn-onboard-submit")).not.toBeNull();
    });

    // Step 6 (Final) -> Submit
    const step6Next = container.querySelector(
      "#btn-onboard-submit",
    ) as HTMLButtonElement;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;
    try {
      await act(async () => {
        fireEvent.click(step6Next);
      });

      // Check createProject payload
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callArgs = mockFetch.mock.calls[0] as any;
      expect(callArgs[0]).toBe("/api/projects");
      const payload = JSON.parse(callArgs[1].body);

      // PAT should NOT be in the issue tracker configuration
      expect(payload.issueTracker?.azure?.pat).toBeUndefined();
      expect(callArgs[1].body).not.toContain("fake-pat");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  async function advanceToStep6(container: HTMLElement) {
    await advanceToStep3(container);

    await waitFor(() => {
      expect(container.querySelector("#btn-step-3-next")).not.toBeNull();
    });
    const step3Next = container.querySelector(
      "#btn-step-3-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step3Next);
    });

    await waitFor(() => {
      expect(container.querySelector("#btn-step-4-next")).not.toBeNull();
    });
    const step4Next = container.querySelector(
      "#btn-step-4-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step4Next);
    });

    await waitFor(() => {
      expect(container.querySelector("#btn-step-5-next")).not.toBeNull();
    });
    const step5Next = container.querySelector(
      "#btn-step-5-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step5Next);
    });

    await waitFor(() => {
      expect(container.querySelector("#btn-onboard-submit")).not.toBeNull();
    });
  }

  it("Wizard UI disables Create for an ID collision and shows warning", async () => {
    mockProjects = [
      {
        id: "test-project",
        name: "Existing Test Project",
        issueTracker: { provider: "azure" },
        repositories: [],
      },
    ];

    const { container } = render(<TestWrapper />);
    await advanceToStep6(container);

    await waitFor(() => {
      const warningCard = container.querySelector(".duplicate-warning-card");
      expect(warningCard).not.toBeNull();
      expect(warningCard?.textContent).toContain(
        'Project ID "test-project" is already in use.',
      );
      expect(warningCard?.textContent).toContain(
        "Existing project: Existing Test Project",
      );
    });

    const submitBtn = container.querySelector(
      "#btn-onboard-submit",
    ) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);

    const link = container.querySelector(
      ".duplicate-warning-card a",
    ) as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toBe("/projects/test-project");
    expect(link.textContent).toContain("Open Existing Project");
  });

  it("Wizard UI disables Create for an external match, shows details, and renders existing project link", async () => {
    mockProjects = [
      {
        id: "existing-converso-id",
        name: "Converso Production",
        archived: true,
        issueTracker: {
          provider: "azure",
          azure: {
            orgUrl: "https://dev.azure.com/xynotech",
            project: "Converso",
          },
        },
        repositories: [],
      },
    ];

    const { container } = render(<TestWrapper />);
    await advanceToStep6(container);

    await waitFor(() => {
      const warningCard = container.querySelector(".duplicate-warning-card");
      expect(warningCard).not.toBeNull();
      expect(warningCard?.textContent).toContain(
        "This project is already onboarded.",
      );
      expect(warningCard?.textContent).toContain(
        "Existing project: Converso Production",
      );
      expect(warningCard?.textContent).toContain("(Archived)");
      expect(warningCard?.textContent).toContain(
        "Azure DevOps: xynotech / Converso",
      );
    });

    const submitBtn = container.querySelector(
      "#btn-onboard-submit",
    ) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);

    const link = container.querySelector(
      ".duplicate-warning-card a",
    ) as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toBe("/projects/existing-converso-id");
    expect(link.textContent).toContain("Open Existing Project");
  });

  it("Changing ID clears previous duplicate warning in the wizard UI", async () => {
    mockProjects = [
      {
        id: "test-project",
        name: "Existing Test Project",
        issueTracker: { provider: "github", github: { repo: "other/repo" } },
        repositories: [],
      },
    ];

    const { container } = render(<TestWrapper />);
    await advanceToStep6(container);

    await waitFor(() => {
      expect(container.querySelector(".duplicate-warning-card")).not.toBeNull();
    });
    const submitBtn = container.querySelector(
      "#btn-onboard-submit",
    ) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);

    // Navigate back to Step 1
    for (let i = 6; i >= 2; i--) {
      const backBtn = Array.from(
        container.querySelectorAll(".modal-actions button.btn-secondary"),
      ).find((b) => b.textContent?.includes("Back")) as HTMLButtonElement;
      expect(backBtn).toBeDefined();
      await act(async () => {
        fireEvent.click(backBtn);
      });
      await waitFor(() => {
        expect(
          container.querySelector(`#onboard-step-${i - 1}`),
        ).not.toBeNull();
      });
    }

    // Now on Step 1, change Project ID to something unique
    const idInput = container.querySelector(
      "#onboard-proj-id",
    ) as HTMLInputElement;
    await act(async () => {
      await userEvent.clear(idInput);
      await userEvent.type(idInput, "unique-new-project-id");
    });

    // Advance forward back to Step 6
    const step1Next = container.querySelector(
      "#btn-step-1-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step1Next);
    });

    await waitFor(() =>
      expect(container.querySelector("#btn-step-2-next")).not.toBeNull(),
    );
    const step2Next = container.querySelector(
      "#btn-step-2-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step2Next);
    });

    await waitFor(() =>
      expect(container.querySelector("#btn-step-3-next")).not.toBeNull(),
    );
    const step3Next = container.querySelector(
      "#btn-step-3-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step3Next);
    });

    await waitFor(() =>
      expect(container.querySelector("#btn-step-4-next")).not.toBeNull(),
    );
    const step4Next = container.querySelector(
      "#btn-step-4-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step4Next);
    });

    await waitFor(() =>
      expect(container.querySelector("#btn-step-5-next")).not.toBeNull(),
    );
    const step5Next = container.querySelector(
      "#btn-step-5-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step5Next);
    });

    // Step 6 reached
    await waitFor(() => {
      expect(container.querySelector("#btn-onboard-submit")).not.toBeNull();
    });

    // Warning card should be gone and submit button should be enabled
    expect(container.querySelector(".duplicate-warning-card")).toBeNull();
    const submitBtnFinal = container.querySelector(
      "#btn-onboard-submit",
    ) as HTMLButtonElement;
    expect(submitBtnFinal.disabled).toBe(false);
  });

  it("Wizard blocks creation and disables button while all-projects query is loading", async () => {
    mockGetProjects.mockImplementationOnce(() => new Promise(() => {}));

    const { container } = render(<TestWrapper />);
    await advanceToStep6(container);

    await waitFor(() => {
      const card = container.querySelector(".duplicate-warning-card");
      expect(card).not.toBeNull();
      expect(card?.textContent).toContain("Checking for existing projects…");
    });

    const submitBtn = container.querySelector(
      "#btn-onboard-submit",
    ) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  it("Wizard blocks creation and disables button while all-projects query fails with error", async () => {
    mockGetProjects.mockRejectedValue(new Error("Database connection error"));

    const { container } = render(<TestWrapper />);
    await advanceToStep6(container);

    await waitFor(() => {
      const card = container.querySelector(".duplicate-warning-card");
      expect(card).not.toBeNull();
      expect(card?.textContent).toContain(
        "Unable to verify project uniqueness.",
      );
      expect(card?.textContent).toContain(
        "Failed to load existing projects. Please retry before creating.",
      );
    });

    const submitBtn = container.querySelector(
      "#btn-onboard-submit",
    ) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  it("triggers project-list refetch when entering Step 6, blocks Create while fetching, and uses refreshed duplicates", async () => {
    // 1. Initial project query resolves with no duplicate projects
    mockProjects = [];
    let resolveRefetch: ((data: any) => void) | undefined;
    const refetchPromise = new Promise((resolve) => {
      resolveRefetch = resolve;
    });

    const { container } = render(<TestWrapper />);

    // Advance through steps to Step 5
    await advanceToStep3(container);
    await waitFor(() =>
      expect(container.querySelector("#btn-step-3-next")).not.toBeNull(),
    );
    const step3Next = container.querySelector(
      "#btn-step-3-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step3Next);
    });

    await waitFor(() =>
      expect(container.querySelector("#btn-step-4-next")).not.toBeNull(),
    );
    const step4Next = container.querySelector(
      "#btn-step-4-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step4Next);
    });

    await waitFor(() =>
      expect(container.querySelector("#btn-step-5-next")).not.toBeNull(),
    );

    // Initial getProjects call occurred on mount
    expect(mockGetProjects).toHaveBeenCalledTimes(1);

    // Prepare mockGetProjects to return a pending promise when refetched on Step 6 transition
    mockGetProjects.mockImplementationOnce(() => refetchPromise);

    // Click Next on Step 5 to transition into Step 6
    const step5Next = container.querySelector(
      "#btn-step-5-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step5Next);
    });

    // 2. Entering Step 6 triggers refetchProjects()
    await waitFor(() => {
      expect(mockGetProjects).toHaveBeenCalledTimes(2);
    });

    // 3. Create remains disabled and "Checking for existing projects…" is shown while fetching
    const submitBtn = container.querySelector(
      "#btn-onboard-submit",
    ) as HTMLButtonElement;
    expect(submitBtn).not.toBeNull();
    expect(submitBtn.disabled).toBe(true);

    const checkingCard = container.querySelector(".duplicate-warning-card");
    expect(checkingCard).not.toBeNull();
    expect(checkingCard?.textContent).toContain(
      "Checking for existing projects…",
    );

    // 4. Resolve the refetch promise with a newly-added duplicate project (created concurrently)
    await act(async () => {
      resolveRefetch!([
        {
          id: "test-project",
          name: "Concurrent Test Project",
          issueTracker: { provider: "azure" },
          repositories: [],
        },
      ]);
    });

    // 5. Refreshed project data produces the duplicate warning, keeping Create blocked
    await waitFor(() => {
      const card = container.querySelector(".duplicate-warning-card");
      expect(card).not.toBeNull();
      expect(card?.textContent).toContain(
        'Project ID "test-project" is already in use.',
      );
      expect(card?.textContent).toContain(
        "Existing project: Concurrent Test Project",
      );
    });

    expect(submitBtn.disabled).toBe(true);

    // 6. Returning to Step 6 after editing triggers refetch again
    const backBtn = Array.from(
      container.querySelectorAll(".modal-actions button.btn-secondary"),
    ).find((b) => b.textContent?.includes("Back")) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(backBtn);
    });
    await waitFor(() =>
      expect(container.querySelector("#btn-step-5-next")).not.toBeNull(),
    );

    const step5NextAgain = container.querySelector(
      "#btn-step-5-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step5NextAgain);
    });

    await waitFor(() => {
      expect(mockGetProjects).toHaveBeenCalledTimes(3);
    });
  });

  describe("Wizard Step 4: Repository Selection and Configuration (#112)", () => {
    function TestStep4Wrapper({
      workspacePath = "/ws",
      projectId = "my-project",
      discoveredRepositories,
      onConfiguredChange,
    }: {
      workspacePath?: string;
      projectId?: string;
      discoveredRepositories: DiscoveredRepositoryLike[];
      onConfiguredChange?: (configured: ProjectRepository[]) => void;
    }) {
      const [repoConfigs, setRepoConfigs] = useState<
        Record<string, RepoItemConfig>
      >({});
      const [primaryRepoId, setPrimaryRepoId] = useState<string | null>(null);

      const configured = deriveConfiguredRepositories({
        discoveredRepositories,
        repoConfigs,
        primaryRepoId,
        workspacePath,
        projectId,
      });

      useEffect(() => {
        onConfiguredChange?.(configured);
      }, [configured, onConfiguredChange]);

      return (
        <Step4Repositories
          workspacePath={workspacePath}
          projectId={projectId}
          discoveredRepositories={discoveredRepositories}
          repoConfigs={repoConfigs}
          onRepoConfigsChange={setRepoConfigs}
          primaryRepoId={primaryRepoId}
          onPrimaryRepoIdChange={setPrimaryRepoId}
          onBack={() => {}}
          onNext={() => {}}
        />
      );
    }

    it("infers initial repository roles correctly based on naming conventions", () => {
      const repos = [
        { id: "1", name: "app-frontend", remote: "r1" },
        { id: "2", name: "core-api", remote: "r2" },
        { id: "3", name: "data-worker", remote: "r3" },
        { id: "4", name: "cloud-infra", remote: "r4" },
        { id: "5", name: "docs-knowledge", remote: "r5" },
        { id: "6", name: "general-tool", remote: "r6" },
      ];
      let latestConfig: ProjectRepository[] = [];
      const { container } = render(
        <TestStep4Wrapper
          workspacePath="/ws"
          projectId="my-project"
          discoveredRepositories={repos}
          onConfiguredChange={(cfg) => {
            latestConfig = cfg;
          }}
        />,
      );

      const getRole = (id: string) =>
        (container.querySelector(`#repo-role-${id}`) as HTMLSelectElement)
          .value;

      expect(getRole("1")).toBe("frontend");
      expect(getRole("2")).toBe("backend");
      expect(getRole("3")).toBe("worker");
      expect(getRole("4")).toBe("infrastructure");
      expect(getRole("5")).toBe("knowledge");
      expect(getRole("6")).toBe("other");

      expect(latestConfig.find((r) => r.id === "1")?.role).toBe("frontend");
      expect(latestConfig.find((r) => r.id === "2")?.role).toBe("backend");
      expect(latestConfig.find((r) => r.id === "3")?.role).toBe("worker");
    });

    it("supports selecting and deselecting multiple repositories independently", async () => {
      const repos = [
        { id: "r1", name: "api", remote: "rem1" },
        { id: "r2", name: "web", remote: "rem2" },
        { id: "r3", name: "worker", remote: "rem3" },
      ];
      let latestConfig: ProjectRepository[] = [];
      const { container } = render(
        <TestStep4Wrapper
          workspacePath="/ws"
          projectId="my-project"
          discoveredRepositories={repos}
          onConfiguredChange={(cfg) => {
            latestConfig = cfg;
          }}
        />,
      );

      // Initially all 3 are selected
      expect(latestConfig.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
      const card2 = container.querySelector('[data-repo-id="r2"]');
      expect(card2?.classList.contains("selected")).toBe(true);
      expect(card2?.classList.contains("deselected")).toBe(false);

      // Deselect r2
      const select2 = container.querySelector(
        "#repo-select-r2",
      ) as HTMLInputElement;
      expect(select2.checked).toBe(true);
      await act(async () => {
        fireEvent.click(select2);
      });

      expect(select2.checked).toBe(false);
      expect(card2?.classList.contains("deselected")).toBe(true);
      expect(card2?.classList.contains("selected")).toBe(false);
      expect(latestConfig.map((r) => r.id)).toEqual(["r1", "r3"]);

      // Deselect r3
      const select3 = container.querySelector(
        "#repo-select-r3",
      ) as HTMLInputElement;
      await act(async () => {
        fireEvent.click(select3);
      });

      expect(select3.checked).toBe(false);
      expect(latestConfig.map((r) => r.id)).toEqual(["r1"]);

      // Re-select r2
      await act(async () => {
        fireEvent.click(select2);
      });

      expect(select2.checked).toBe(true);
      expect(card2?.classList.contains("selected")).toBe(true);
      expect(card2?.classList.contains("deselected")).toBe(false);
      expect(latestConfig.map((r) => r.id)).toEqual(["r1", "r2"]);
    });

    it("places primary repository at index 0 and reorders when primary changes", async () => {
      const repos = [
        { id: "r1", name: "api", remote: "rem1" },
        { id: "r2", name: "web", remote: "rem2" },
        { id: "r3", name: "worker", remote: "rem3" },
      ];
      let latestConfig: ProjectRepository[] = [];
      const { container } = render(
        <TestStep4Wrapper
          workspacePath="/ws"
          projectId="my-project"
          discoveredRepositories={repos}
          onConfiguredChange={(cfg) => {
            latestConfig = cfg;
          }}
        />,
      );

      // Initial primary is r1 (index 0)
      expect(latestConfig[0]?.id).toBe("r1");
      expect(latestConfig.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);

      // Change primary to r3
      const primary3 = container.querySelector(
        "#repo-primary-r3",
      ) as HTMLInputElement;
      await act(async () => {
        fireEvent.click(primary3);
      });

      expect(primary3.checked).toBe(true);
      expect(latestConfig[0]?.id).toBe("r3");
      expect(latestConfig.map((r) => r.id)).toEqual(["r3", "r1", "r2"]);

      // Change primary to r2
      const primary2 = container.querySelector(
        "#repo-primary-r2",
      ) as HTMLInputElement;
      await act(async () => {
        fireEvent.click(primary2);
      });

      expect(primary2.checked).toBe(true);
      expect(latestConfig[0]?.id).toBe("r2");
      expect(latestConfig.map((r) => r.id)).toEqual(["r2", "r1", "r3"]);
    });

    it("ensures a primary repository cannot remain selected=false", async () => {
      const repos = [
        { id: "r1", name: "api", remote: "rem1" },
        { id: "r2", name: "web", remote: "rem2" },
      ];
      let latestConfig: ProjectRepository[] = [];
      const { container } = render(
        <TestStep4Wrapper
          workspacePath="/ws"
          projectId="my-project"
          discoveredRepositories={repos}
          onConfiguredChange={(cfg) => {
            latestConfig = cfg;
          }}
        />,
      );

      // Deselect r2
      const select2 = container.querySelector(
        "#repo-select-r2",
      ) as HTMLInputElement;
      await act(async () => {
        fireEvent.click(select2);
      });
      expect(select2.checked).toBe(false);

      // Click primary on r2
      const primary2 = container.querySelector(
        "#repo-primary-r2",
      ) as HTMLInputElement;
      await act(async () => {
        fireEvent.click(primary2);
      });

      // r2 is now primary AND r2 selection is now true
      expect(primary2.checked).toBe(true);
      expect(select2.checked).toBe(true);
      expect(latestConfig[0]?.id).toBe("r2");
    });

    it("allows manual role change and preserves it", async () => {
      const repos = [{ id: "r1", name: "api-service", remote: "rem1" }];
      let latestConfig: ProjectRepository[] = [];
      const { container } = render(
        <TestStep4Wrapper
          workspacePath="/ws"
          projectId="my-project"
          discoveredRepositories={repos}
          onConfiguredChange={(cfg) => {
            latestConfig = cfg;
          }}
        />,
      );

      const roleSelect = container.querySelector(
        "#repo-role-r1",
      ) as HTMLSelectElement;
      expect(roleSelect.value).toBe("backend");

      await act(async () => {
        fireEvent.change(roleSelect, { target: { value: "infrastructure" } });
      });

      expect(roleSelect.value).toBe("infrastructure");
      expect(latestConfig[0]?.role).toBe("infrastructure");
    });

    it("supports independent local paths and preserves them on selection toggle", async () => {
      const repos = [
        { id: "r1", name: "backend-api", remote: "rem1" },
        { id: "r2", name: "frontend-ui", remote: "rem2" },
      ];
      let latestConfig: ProjectRepository[] = [];
      const { container } = render(
        <TestStep4Wrapper
          workspacePath="/custom/workspace"
          projectId="my-project"
          discoveredRepositories={repos}
          onConfiguredChange={(cfg) => {
            latestConfig = cfg;
          }}
        />,
      );

      const path1 = container.querySelector(
        "#repo-path-r1",
      ) as HTMLInputElement;
      const path2 = container.querySelector(
        "#repo-path-r2",
      ) as HTMLInputElement;

      expect(path1.value).toBe("/custom/workspace/backend-api");
      expect(path2.value).toBe("/custom/workspace/frontend-ui");

      // Edit paths independently
      await act(async () => {
        await userEvent.clear(path1);
        await userEvent.type(path1, "/opt/repos/my-api");
        await userEvent.clear(path2);
        await userEvent.type(path2, "/opt/repos/my-ui");
      });

      expect(path1.value).toBe("/opt/repos/my-api");
      expect(path2.value).toBe("/opt/repos/my-ui");
      expect(latestConfig.find((r) => r.id === "r1")?.path).toBe(
        "/opt/repos/my-api",
      );
      expect(latestConfig.find((r) => r.id === "r2")?.path).toBe(
        "/opt/repos/my-ui",
      );

      // Toggle selection of r2 off and then on
      const select2 = container.querySelector(
        "#repo-select-r2",
      ) as HTMLInputElement;
      await act(async () => {
        fireEvent.click(select2);
      });
      expect(select2.checked).toBe(false);

      await act(async () => {
        fireEvent.click(select2);
      });
      expect(select2.checked).toBe(true);

      // Path must be preserved!
      expect(path2.value).toBe("/opt/repos/my-ui");
      expect(latestConfig.find((r) => r.id === "r2")?.path).toBe(
        "/opt/repos/my-ui",
      );
    });

    it("preserves discovered id, name, remote, and defaultBranch exactly", () => {
      const repos = [
        {
          id: "repo-999_SPECIAL",
          name: "Special-Repo_Name",
          remote: "git@github.com:my-org/Special-Repo_Name.git",
          defaultBranch: "release/v3.2.1",
        },
      ];
      let latestConfig: ProjectRepository[] = [];
      const { container } = render(
        <TestStep4Wrapper
          workspacePath="/ws"
          projectId="my-project"
          discoveredRepositories={repos}
          onConfiguredChange={(cfg) => {
            latestConfig = cfg;
          }}
        />,
      );

      expect(container.textContent).toContain("Special-Repo_Name");
      expect(container.textContent).toContain(
        "git@github.com:my-org/Special-Repo_Name.git",
      );
      expect(container.textContent).toContain("branch: release/v3.2.1");

      const configured = latestConfig[0];
      expect(configured?.id).toBe("repo-999_SPECIAL");
      expect(configured?.name).toBe("Special-Repo_Name");
      expect(configured?.remote).toBe(
        "git@github.com:my-org/Special-Repo_Name.git",
      );
      expect(configured?.defaultBranch).toBe("release/v3.2.1");
    });

    it("validates zero-selection and blocks Continue", async () => {
      const repos = [
        { id: "r1", name: "repo1", remote: "rem1" },
        { id: "r2", name: "repo2", remote: "rem2" },
      ];
      const { container } = render(
        <TestStep4Wrapper
          workspacePath="/ws"
          projectId="my-project"
          discoveredRepositories={repos}
        />,
      );

      const nextBtn = container.querySelector(
        "#btn-step-4-next",
      ) as HTMLButtonElement;
      expect(nextBtn.disabled).toBe(false);

      // Deselect both
      const s1 = container.querySelector("#repo-select-r1") as HTMLInputElement;
      const s2 = container.querySelector("#repo-select-r2") as HTMLInputElement;

      await act(async () => {
        fireEvent.click(s1);
        fireEvent.click(s2);
      });

      expect(nextBtn.disabled).toBe(true);
      const err = container.querySelector("#step-4-validation-error");
      expect(err).not.toBeNull();
      expect(err?.textContent).toContain(
        "At least one repository must be selected",
      );

      // Re-select r1
      await act(async () => {
        fireEvent.click(s1);
      });
      expect(nextBtn.disabled).toBe(false);
      expect(container.querySelector("#step-4-validation-error")).toBeNull();
    });

    it("validates invalid primary and blocks Continue when primary is unselected", async () => {
      const repos = [
        { id: "r1", name: "repo1", remote: "rem1" },
        { id: "r2", name: "repo2", remote: "rem2" },
      ];
      const { container } = render(
        <TestStep4Wrapper
          workspacePath="/ws"
          projectId="my-project"
          discoveredRepositories={repos}
        />,
      );

      const nextBtn = container.querySelector(
        "#btn-step-4-next",
      ) as HTMLButtonElement;
      expect(nextBtn.disabled).toBe(false);

      // r1 is primary. Uncheck r1.
      const s1 = container.querySelector("#repo-select-r1") as HTMLInputElement;
      await act(async () => {
        fireEvent.click(s1);
      });

      expect(s1.checked).toBe(false);
      expect(nextBtn.disabled).toBe(true);
      const err = container.querySelector("#step-4-validation-error");
      expect(err).not.toBeNull();
      expect(err?.textContent).toContain(
        "The primary repository must be selected",
      );

      // Fix by designating r2 as primary
      const p2 = container.querySelector(
        "#repo-primary-r2",
      ) as HTMLInputElement;
      await act(async () => {
        fireEvent.click(p2);
      });

      expect(nextBtn.disabled).toBe(false);
      expect(container.querySelector("#step-4-validation-error")).toBeNull();

      expect(
        validateRepositorySelection({
          selectedRepos: [{ id: "r1", name: "repo1" }],
          primaryRepoId: null,
        }),
      ).toBe("A primary repository must be designated.");
    });

    it("prevents duplicate repository IDs from entering configured list", () => {
      const duplicateRepos = [
        { id: "dup-id", name: "first-repo", remote: "rem1" },
        { id: "dup-id", name: "second-repo", remote: "rem2" },
        { id: "unique-id", name: "third-repo", remote: "rem3" },
      ];
      let latestConfig: ProjectRepository[] = [];
      const { container } = render(
        <TestStep4Wrapper
          workspacePath="/ws"
          projectId="my-project"
          discoveredRepositories={duplicateRepos}
          onConfiguredChange={(cfg) => {
            latestConfig = cfg;
          }}
        />,
      );

      // Should only have 2 configured repos (dup-id deduplicated)
      expect(latestConfig.length).toBe(2);
      expect(latestConfig.map((r) => r.id)).toEqual(["dup-id", "unique-id"]);
      expect(container.querySelectorAll('[data-repo-id="dup-id"]').length).toBe(
        1,
      );
    });

    it("deduplicates discovered repositories by exact ID on first-entry-wins through parent discovery path", async () => {
      const duplicateDiscoveryRepos = [
        {
          id: "dup-repo-1",
          name: "core-backend",
          defaultBranch: "main",
          remote: "https://git.example.com/core-backend.git",
        },
        {
          id: "dup-repo-1",
          name: "core-duplicate-ignored",
          defaultBranch: "develop",
          remote: "https://git.example.com/duplicate.git",
        },
        {
          id: "unique-repo-2",
          name: "web-frontend",
          defaultBranch: "main",
          remote: "https://git.example.com/web-frontend.git",
        },
      ];

      mockDiscoverRepositories.mockResolvedValueOnce({
        repositories: duplicateDiscoveryRepos,
      });

      const { container } = render(<TestWrapper />);
      await advanceToStep3(container);

      // Discovery finishes on Step 3
      await waitFor(() => {
        expect(container.textContent).toContain("discovered");
      });

      // Advance from Step 3 to Step 4
      const step3Next = container.querySelector(
        "#btn-step-3-next",
      ) as HTMLButtonElement;
      await act(async () => {
        fireEvent.click(step3Next);
      });

      // On Step 4, only 2 cards should be rendered
      await waitFor(() => {
        expect(container.querySelector("#onboard-step-4")).not.toBeNull();
      });

      const cards = container.querySelectorAll(".repo-config-card");
      expect(cards.length).toBe(2);

      // Verify first-entry-wins for dup-repo-1:
      // The displayed name must be "core-backend" (NOT "core-duplicate-ignored")
      const dupCard = container.querySelector('[data-repo-id="dup-repo-1"]');
      expect(dupCard).not.toBeNull();
      expect(dupCard?.textContent).toContain("core-backend");
      expect(dupCard?.textContent).not.toContain("core-duplicate-ignored");
      expect(dupCard?.textContent).toContain(
        "https://git.example.com/core-backend.git",
      );

      // Its initial path input must be derived from the first entry
      const pathInput = container.querySelector(
        "#repo-path-dup-repo-1",
      ) as HTMLInputElement;
      expect(pathInput.value).toBe("/Users/talhazuberi/projects/core-backend");

      // Its initial role must be derived from the first entry ("core-backend" -> "backend")
      const roleSelect = container.querySelector(
        "#repo-role-dup-repo-1",
      ) as HTMLSelectElement;
      expect(roleSelect.value).toBe("backend");
    });
  });
});
