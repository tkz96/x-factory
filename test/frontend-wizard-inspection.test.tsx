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
import { MemoryRouter } from "react-router-dom";
import {
  OnboardingWizardModal,
  Step5Inspection,
} from "../src/frontend/components/modals/OnboardingWizardModal.js";
import type { InspectRepositoryResponse } from "../src/frontend/lib/api-client.js";
import type { ProjectRepository } from "../src/shared/types.js";

// Mock the API client
const mockDiscoverRepositories = mock(
  async (): Promise<{
    repositories: Array<{
      id: string;
      name: string;
      remote?: string;
      defaultBranch?: string;
      webUrl?: string;
    }>;
  }> => {
    return { repositories: [] };
  },
);
const mockTestAzureScopes = mock(async () => {
  return { ok: true, overPrivileged: false, scopes: {} };
});
const mockGetProjects = mock(async () => []);
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
        message: "Ready",
      },
    };
  },
);

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
    ModalProvider: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
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

let userEvent: typeof import("@testing-library/user-event").default;

describe("Wizard Step 5: Repository Inspection and Readiness (#113)", () => {
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
    mockDiscoverRepositories.mockClear();
    mockTestAzureScopes.mockClear();
    mockGetProjects.mockClear();
    mockInspectRepository.mockClear();
  });

  describe("Unit: Step5Inspection component", () => {
    it("inspects selected repository and renders 'ready' state with details", async () => {
      mockInspectRepository.mockResolvedValueOnce({
        path: "/code/repo-1",
        exists: true,
        isGitRepo: true,
        defaultBranch: "main",
        detectedCommands: { test: "bun test", lint: "biome check" },
        detectedTooling: ["bun", "biome"],
        readiness: {
          status: "ready",
          message: "Repository verified and ready.",
        },
      });

      const repos: ProjectRepository[] = [
        {
          id: "repo-1",
          name: "repo-1",
          path: "/code/repo-1",
          defaultBranch: "main",
          role: "backend",
        },
      ];

      const onBack = mock(() => {});
      const onNext = mock(() => {});

      const { container } = render(
        <Step5Inspection
          repositories={repos}
          primaryRepoId="repo-1"
          onBack={onBack}
          onNext={onNext}
        />,
      );

      // Verify API was called with repository path
      await waitFor(() => {
        expect(mockInspectRepository).toHaveBeenCalledTimes(1);
        expect(mockInspectRepository).toHaveBeenCalledWith({
          path: "/code/repo-1",
        });
      });

      // Verify UI displays ready status badge
      await waitFor(() => {
        const statusBadge = container.querySelector(
          '[data-testid="status-repo-1"]',
        );
        expect(statusBadge).not.toBeNull();
        expect(statusBadge?.textContent).toContain("Ready");
        expect(statusBadge?.className).toContain("ready");
      });

      // Verify explanation and details
      expect(container.textContent).toContain("Repository verified and ready.");
      expect(container.textContent).toContain("Default branch: main");
      expect(container.textContent).toContain("test: bun test");
      expect(container.textContent).toContain("lint: biome check");
      expect(container.textContent).toContain(
        "All selected repositories and prerequisites are verified and ready.",
      );

      // Verify Continue button is enabled
      const nextBtn = container.querySelector(
        "#btn-step-5-next",
      ) as HTMLButtonElement;
      expect(nextBtn.disabled).toBe(false);

      // Verify navigation on click
      fireEvent.click(nextBtn);
      expect(onNext).toHaveBeenCalledTimes(1);
    });

    it("handles 'pending_setup' for missing local checkout without blocking navigation", async () => {
      mockInspectRepository.mockResolvedValueOnce({
        path: "/code/missing-repo",
        exists: false,
        isGitRepo: false,
        detectedCommands: {},
        detectedTooling: [],
        readiness: {
          status: "pending_setup",
          message: "Local directory not found at /code/missing-repo",
        },
      });

      const repos: ProjectRepository[] = [
        {
          id: "missing-repo",
          name: "missing-repo",
          path: "/code/missing-repo",
          defaultBranch: "main",
          role: "backend",
        },
      ];

      const onBack = mock(() => {});
      const onNext = mock(() => {});

      const { container } = render(
        <Step5Inspection
          repositories={repos}
          primaryRepoId="missing-repo"
          onBack={onBack}
          onNext={onNext}
        />,
      );

      await waitFor(() => {
        const statusBadge = container.querySelector(
          '[data-testid="status-missing-repo"]',
        );
        expect(statusBadge?.textContent).toContain("Pending Setup");
        expect(statusBadge?.className).toContain("pending");
      });

      // Verify explanation of missing local checkout
      expect(container.textContent).toContain(
        "Local directory not found at /code/missing-repo",
      );
      expect(container.textContent).toContain(
        "Local checkout not found. This repository must be cloned or initialized before running workflows, but project creation can proceed.",
      );
      expect(container.textContent).toContain(
        "One or more repositories require local checkout setup. This does not block project onboarding; you may continue to review.",
      );

      // Critical requirement: pending_setup MUST NOT block navigation
      const nextBtn = container.querySelector(
        "#btn-step-5-next",
      ) as HTMLButtonElement;
      expect(nextBtn.disabled).toBe(false);

      fireEvent.click(nextBtn);
      expect(onNext).toHaveBeenCalledTimes(1);
    });

    it("handles 'error' for existing non-Git directory and blocks navigation", async () => {
      mockInspectRepository.mockResolvedValueOnce({
        path: "/code/non-git-dir",
        exists: true,
        isGitRepo: false,
        detectedCommands: {},
        detectedTooling: [],
        readiness: {
          status: "error",
          message: "Directory exists but is not a Git repository.",
        },
      });

      const repos: ProjectRepository[] = [
        {
          id: "non-git-repo",
          name: "non-git-dir",
          path: "/code/non-git-dir",
          defaultBranch: "main",
          role: "service",
        },
      ];

      const onBack = mock(() => {});
      const onNext = mock(() => {});

      const { container } = render(
        <Step5Inspection
          repositories={repos}
          primaryRepoId="non-git-repo"
          onBack={onBack}
          onNext={onNext}
        />,
      );

      await waitFor(() => {
        const statusBadge = container.querySelector(
          '[data-testid="status-non-git-repo"]',
        );
        expect(statusBadge?.textContent).toContain("Invalid Directory");
        expect(statusBadge?.className).toContain("error");
      });

      // Verify explanation
      expect(container.textContent).toContain(
        "Directory exists but is not a Git repository.",
      );
      expect(container.textContent).toContain(
        "A non-Git directory cannot be used for this repository.",
      );
      expect(container.textContent).toContain(
        "Configuration Error: One or more selected repositories point to a directory that is not a valid Git repository.",
      );

      // Critical requirement: invalid configuration MUST block navigation
      const nextBtn = container.querySelector(
        "#btn-step-5-next",
      ) as HTMLButtonElement;
      expect(nextBtn.disabled).toBe(true);

      fireEvent.click(nextBtn);
      expect(onNext).not.toHaveBeenCalled();
    });

    it("distinguishes inspection/API failure from repository readiness and blocks navigation", async () => {
      mockInspectRepository.mockRejectedValueOnce(
        new Error("Connection refused: 500 Internal Server Error"),
      );

      const repos: ProjectRepository[] = [
        {
          id: "failing-repo",
          name: "failing-repo",
          path: "/code/failing-repo",
          defaultBranch: "main",
          role: "backend",
        },
      ];

      const onBack = mock(() => {});
      const onNext = mock(() => {});

      const { container } = render(
        <Step5Inspection
          repositories={repos}
          primaryRepoId="failing-repo"
          onBack={onBack}
          onNext={onNext}
        />,
      );

      await waitFor(() => {
        const statusBadge = container.querySelector(
          '[data-testid="status-failing-repo"]',
        );
        expect(statusBadge?.textContent).toContain("Inspection Failed");
      });

      // Must NOT be displayed as repository readiness
      expect(container.textContent).not.toContain("✓ Ready");
      expect(container.textContent).not.toContain("Pending Setup");
      expect(container.textContent).toContain(
        "Inspection failure is not a repository readiness status.",
      );
      expect(container.textContent).toContain(
        "Connection refused: 500 Internal Server Error",
      );

      // Verify retry button exists
      const retryBtn = container.querySelector(
        '[data-testid="btn-retry-failing-repo"]',
      );
      expect(retryBtn).not.toBeNull();

      // Navigation must be blocked on inspection failure
      const nextBtn = container.querySelector(
        "#btn-step-5-next",
      ) as HTMLButtonElement;
      expect(nextBtn.disabled).toBe(true);
    });

    it("recovers from API failure when user clicks retry", async () => {
      // First attempt fails
      mockInspectRepository.mockRejectedValueOnce(
        new Error("Temporary network timeout"),
      );

      const repos: ProjectRepository[] = [
        {
          id: "retry-repo",
          name: "retry-repo",
          path: "/code/retry-repo",
          defaultBranch: "main",
          role: "backend",
        },
      ];

      const onBack = mock(() => {});
      const onNext = mock(() => {});

      const { container } = render(
        <Step5Inspection
          repositories={repos}
          primaryRepoId="retry-repo"
          onBack={onBack}
          onNext={onNext}
        />,
      );

      await waitFor(() => {
        expect(container.textContent).toContain("Inspection Failed");
      });

      const nextBtn = container.querySelector(
        "#btn-step-5-next",
      ) as HTMLButtonElement;
      expect(nextBtn.disabled).toBe(true);

      // Second attempt succeeds
      mockInspectRepository.mockResolvedValueOnce({
        path: "/code/retry-repo",
        exists: true,
        isGitRepo: true,
        defaultBranch: "main",
        detectedCommands: { test: "bun test" },
        detectedTooling: ["bun"],
        readiness: {
          status: "ready",
          message: "Ready",
        },
      });

      const retryBtn = container.querySelector(
        '[data-testid="btn-retry-retry-repo"]',
      ) as HTMLButtonElement;
      await act(async () => {
        fireEvent.click(retryBtn);
      });

      await waitFor(() => {
        const badge = container.querySelector(
          '[data-testid="status-retry-repo"]',
        );
        expect(badge?.textContent).toContain("Ready");
      });

      expect(nextBtn.disabled).toBe(false);
      fireEvent.click(nextBtn);
      expect(onNext).toHaveBeenCalledTimes(1);
    });

    it("permits navigation when one repo is 'ready' and another is 'pending_setup'", async () => {
      mockInspectRepository.mockImplementation(
        async ({ path }: { path: string }) => {
          if (path.includes("repo-ready")) {
            return {
              path,
              exists: true,
              isGitRepo: true,
              defaultBranch: "main",
              detectedCommands: {},
              detectedTooling: [],
              readiness: { status: "ready", message: "Ready" },
            };
          }
          return {
            path,
            exists: false,
            isGitRepo: false,
            detectedCommands: {},
            detectedTooling: [],
            readiness: {
              status: "pending_setup",
              message: "Missing local dir",
            },
          };
        },
      );

      const repos: ProjectRepository[] = [
        {
          id: "r1",
          name: "repo-ready",
          path: "/code/repo-ready",
          defaultBranch: "main",
          role: "backend",
        },
        {
          id: "r2",
          name: "repo-pending",
          path: "/code/repo-pending",
          defaultBranch: "main",
          role: "frontend",
        },
      ];

      const onBack = mock(() => {});
      const onNext = mock(() => {});

      const { container } = render(
        <Step5Inspection
          repositories={repos}
          primaryRepoId="r1"
          onBack={onBack}
          onNext={onNext}
        />,
      );

      await waitFor(() => {
        expect(mockInspectRepository).toHaveBeenCalledTimes(2);
      });

      await waitFor(() => {
        expect(
          container.querySelector('[data-testid="status-r1"]')?.textContent,
        ).toContain("Ready");
        expect(
          container.querySelector('[data-testid="status-r2"]')?.textContent,
        ).toContain("Pending Setup");
      });

      // Both cards rendered
      expect(container.querySelectorAll(".inspection-card").length).toBe(2);

      // Pending setup notice shown
      expect(container.textContent).toContain(
        "One or more repositories require local checkout setup. This does not block project onboarding",
      );

      // Continue button must NOT be disabled
      const nextBtn = container.querySelector(
        "#btn-step-5-next",
      ) as HTMLButtonElement;
      expect(nextBtn.disabled).toBe(false);

      fireEvent.click(nextBtn);
      expect(onNext).toHaveBeenCalledTimes(1);
    });

    it("blocks navigation when one repo is 'ready' and another is 'error'", async () => {
      mockInspectRepository.mockImplementation(
        async ({ path }: { path: string }) => {
          if (path.includes("repo-ready")) {
            return {
              path,
              exists: true,
              isGitRepo: true,
              defaultBranch: "main",
              detectedCommands: {},
              detectedTooling: [],
              readiness: { status: "ready", message: "Ready" },
            };
          }
          return {
            path,
            exists: true,
            isGitRepo: false,
            detectedCommands: {},
            detectedTooling: [],
            readiness: {
              status: "error",
              message: "Directory exists but is not a Git repository.",
            },
          };
        },
      );

      const repos: ProjectRepository[] = [
        {
          id: "r1",
          name: "repo-ready",
          path: "/code/repo-ready",
          defaultBranch: "main",
          role: "backend",
        },
        {
          id: "r2",
          name: "repo-invalid",
          path: "/code/repo-invalid",
          defaultBranch: "main",
          role: "frontend",
        },
      ];

      const { container } = render(
        <Step5Inspection
          repositories={repos}
          primaryRepoId="r1"
          onBack={() => {}}
          onNext={() => {}}
        />,
      );

      await waitFor(() => {
        expect(
          container.querySelector('[data-testid="status-r2"]')?.textContent,
        ).toContain("Invalid Directory");
      });

      const nextBtn = container.querySelector(
        "#btn-step-5-next",
      ) as HTMLButtonElement;
      expect(nextBtn.disabled).toBe(true);
    });

    it("renders empty state notice when repositories array is empty and blocks navigation", async () => {
      const { container } = render(
        <Step5Inspection
          repositories={[]}
          onBack={() => {}}
          onNext={() => {}}
        />,
      );

      expect(container.textContent).toContain(
        "No repositories configured or selected. Please return to Step 4 to select repositories.",
      );
      const nextBtn = container.querySelector(
        "#btn-step-5-next",
      ) as HTMLButtonElement;
      expect(nextBtn.disabled).toBe(true);
    });

    it("blocks navigation when one repo is 'ready' and another has 'api_error'", async () => {
      mockInspectRepository.mockImplementation(
        async ({ path }: { path: string }) => {
          if (path.includes("repo-ready")) {
            return {
              path,
              exists: true,
              isGitRepo: true,
              defaultBranch: "main",
              detectedCommands: {},
              detectedTooling: [],
              readiness: { status: "ready", message: "Ready" },
            };
          }
          throw new Error("HTTP 500 error inspecting repo");
        },
      );

      const repos: ProjectRepository[] = [
        {
          id: "r1",
          name: "repo-ready",
          path: "/code/repo-ready",
          defaultBranch: "main",
          role: "backend",
        },
        {
          id: "r2",
          name: "repo-failed",
          path: "/code/repo-failed",
          defaultBranch: "main",
          role: "frontend",
        },
      ];

      const { container } = render(
        <Step5Inspection
          repositories={repos}
          primaryRepoId="r1"
          onBack={() => {}}
          onNext={() => {}}
        />,
      );

      await waitFor(() => {
        expect(
          container.querySelector('[data-testid="status-r2"]')?.textContent,
        ).toContain("Inspection Failed");
      });

      const nextBtn = container.querySelector(
        "#btn-step-5-next",
      ) as HTMLButtonElement;
      expect(nextBtn.disabled).toBe(true);
      expect(container.textContent).toContain(
        "Inspection Failed: One or more repository inspections could not be completed",
      );
    });

    it("triggers full re-inspection when user clicks 'Re-inspect All'", async () => {
      mockInspectRepository.mockResolvedValue({
        path: "/code/repo-1",
        exists: true,
        isGitRepo: true,
        defaultBranch: "main",
        detectedCommands: {},
        detectedTooling: [],
        readiness: { status: "ready", message: "Ready" },
      });

      const repos: ProjectRepository[] = [
        {
          id: "r1",
          name: "repo-1",
          path: "/code/repo-1",
          defaultBranch: "main",
          role: "backend",
        },
      ];

      const { container } = render(
        <Step5Inspection
          repositories={repos}
          primaryRepoId="r1"
          onBack={() => {}}
          onNext={() => {}}
        />,
      );

      await waitFor(() => {
        expect(mockInspectRepository).toHaveBeenCalledTimes(1);
      });

      const recheckBtn = container.querySelector(
        "#btn-recheck-inspection",
      ) as HTMLButtonElement;
      expect(recheckBtn).not.toBeNull();

      await act(async () => {
        fireEvent.click(recheckBtn);
      });

      await waitFor(() => {
        expect(mockInspectRepository).toHaveBeenCalledTimes(2);
      });
    });

    it("renders command pills and tooling badges when detected by inspection", async () => {
      mockInspectRepository.mockResolvedValueOnce({
        path: "/code/full-repo",
        exists: true,
        isGitRepo: true,
        defaultBranch: "develop",
        detectedCommands: {
          test: "bun test",
          typecheck: "tsc --noEmit",
          build: "vite build",
        },
        detectedTooling: ["bun", "vite", "typescript"],
        readiness: { status: "ready", message: "Verified" },
      });

      const repos: ProjectRepository[] = [
        {
          id: "r1",
          name: "full-repo",
          path: "/code/full-repo",
          defaultBranch: "develop",
          role: "backend",
        },
      ];

      const { container } = render(
        <Step5Inspection
          repositories={repos}
          primaryRepoId="r1"
          onBack={() => {}}
          onNext={() => {}}
        />,
      );

      await waitFor(() => {
        expect(container.textContent).toContain("test: bun test");
      });

      expect(container.textContent).toContain("typecheck: tsc --noEmit");
      expect(container.textContent).toContain("build: vite build");
      expect(container.textContent).toContain(
        "Detected tooling: bun, vite, typescript",
      );
      expect(container.textContent).toContain("Default branch: develop");
      expect(container.querySelectorAll(".command-pill").length).toBe(3);
    });
  });

  describe("Integration: Wizard Step 5 Flow & State Preservation", () => {
    async function advanceToStep4(container: HTMLElement) {
      // Step 1
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
        await userEvent.type(nameInput, "Test Project");
        await userEvent.clear(idInput);
        await userEvent.type(idInput, "test-project");
        await userEvent.clear(wsInput);
        await userEvent.type(wsInput, "/Users/test/workspace");
      });

      const step1Next = container.querySelector(
        "#btn-step-1-next",
      ) as HTMLButtonElement;
      await act(async () => {
        fireEvent.click(step1Next);
      });

      // Step 2
      await waitFor(() => {
        expect(container.querySelector("#onboard-step-2")).not.toBeNull();
      });
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
        await userEvent.type(patInput, "fake-pat");
      });

      const step2Next = container.querySelector(
        "#btn-step-2-next",
      ) as HTMLButtonElement;
      await act(async () => {
        fireEvent.click(step2Next);
      });

      // Step 3
      await waitFor(() => {
        expect(container.querySelector("#onboard-step-3")).not.toBeNull();
      });
    }

    it("inspects only selected repositories from Step 4 and ignores unselected ones", async () => {
      mockDiscoverRepositories.mockResolvedValueOnce({
        repositories: [
          {
            id: "repo-alpha",
            name: "alpha-core",
            defaultBranch: "main",
            remote: "https://github.com/org/alpha.git",
          },
          {
            id: "repo-beta",
            name: "beta-service",
            defaultBranch: "main",
            remote: "https://github.com/org/beta.git",
          },
          {
            id: "repo-gamma",
            name: "gamma-docs",
            defaultBranch: "main",
            remote: "https://github.com/org/gamma.git",
          },
        ],
      });

      mockInspectRepository.mockImplementation(
        async ({ path }: { path: string }) => {
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
        },
      );

      const { container } = render(<TestWrapper />);
      await advanceToStep4(container);

      // Discovery completes on Step 3
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

      await waitFor(() => {
        expect(container.querySelector("#onboard-step-4")).not.toBeNull();
      });

      // On Step 4: 3 repo cards rendered. Uncheck repo-gamma!
      const cards = container.querySelectorAll(".repo-config-card");
      expect(cards.length).toBe(3);

      const gammaCheckbox = container.querySelector(
        "#repo-select-repo-gamma",
      ) as HTMLInputElement;
      expect(gammaCheckbox.checked).toBe(true);

      await act(async () => {
        fireEvent.click(gammaCheckbox);
      });
      expect(gammaCheckbox.checked).toBe(false);

      // Continue from Step 4 to Step 5 (Inspection)
      const step4Next = container.querySelector(
        "#btn-step-4-next",
      ) as HTMLButtonElement;
      await act(async () => {
        fireEvent.click(step4Next);
      });

      // Wait for Step 5 to mount
      await waitFor(() => {
        expect(container.querySelector("#onboard-step-5")).not.toBeNull();
      });

      // Wait for inspection calls to settle
      await waitFor(() => {
        expect(mockInspectRepository).toHaveBeenCalledTimes(2);
      });

      // Inspect calls MUST ONLY be for alpha and beta, NEVER for unselected gamma
      const calledPaths = mockInspectRepository.mock.calls.map(
        (call: unknown[]) => (call[0] as { path: string }).path,
      );
      expect(calledPaths).toContain("/Users/test/workspace/alpha-core");
      expect(calledPaths).toContain("/Users/test/workspace/beta-service");
      expect(calledPaths).not.toContain("/Users/test/workspace/gamma-docs");

      // Step 5 must display exactly 2 inspection cards
      const inspectionCards = container.querySelectorAll(".inspection-card");
      expect(inspectionCards.length).toBe(2);
      expect(
        container.querySelector("#inspection-card-repo-alpha"),
      ).not.toBeNull();
      expect(
        container.querySelector("#inspection-card-repo-beta"),
      ).not.toBeNull();
      expect(container.querySelector("#inspection-card-repo-gamma")).toBeNull();
    });

    it("preserves all Step 4 configuration state when navigating Back from Step 5", async () => {
      mockDiscoverRepositories.mockResolvedValueOnce({
        repositories: [
          {
            id: "repo-1",
            name: "app-core",
            defaultBranch: "main",
          },
          {
            id: "repo-2",
            name: "app-frontend",
            defaultBranch: "main",
          },
        ],
      });

      mockInspectRepository.mockImplementation(
        async ({ path }: { path: string }) => {
          return {
            path,
            exists: true,
            isGitRepo: true,
            defaultBranch: "main",
            detectedCommands: {},
            detectedTooling: [],
            readiness: { status: "ready", message: "Ready" },
          };
        },
      );

      const { container } = render(<TestWrapper />);
      await advanceToStep4(container);

      // Advance to Step 4
      await waitFor(() => {
        expect(container.textContent).toContain("discovered");
      });
      const step3Next = container.querySelector(
        "#btn-step-3-next",
      ) as HTMLButtonElement;
      await act(async () => {
        fireEvent.click(step3Next);
      });

      await waitFor(() => {
        expect(container.querySelector("#onboard-step-4")).not.toBeNull();
      });

      // In Step 4: customize repo-1 path to '/custom/app-path'
      const pathInput = container.querySelector(
        "#repo-path-repo-1",
      ) as HTMLInputElement;
      await act(async () => {
        await userEvent.clear(pathInput);
        await userEvent.type(pathInput, "/custom/app-path");
      });

      // Change repo-2 role to 'infrastructure'
      const roleSelect = container.querySelector(
        "#repo-role-repo-2",
      ) as HTMLSelectElement;
      fireEvent.change(roleSelect, {
        target: { value: "infrastructure" },
      });

      // Designate repo-2 as primary
      const primaryRadio2 = container.querySelector(
        "#repo-primary-repo-2",
      ) as HTMLInputElement;
      await act(async () => {
        fireEvent.click(primaryRadio2);
      });
      expect(primaryRadio2.checked).toBe(true);

      // Advance to Step 5
      const step4Next = container.querySelector(
        "#btn-step-4-next",
      ) as HTMLButtonElement;
      await act(async () => {
        fireEvent.click(step4Next);
      });

      await waitFor(() => {
        expect(container.querySelector("#onboard-step-5")).not.toBeNull();
      });

      // Verify custom path was inspected
      await waitFor(() => {
        const calledPaths = mockInspectRepository.mock.calls.map(
          (call: unknown[]) => (call[0] as { path: string }).path,
        );
        expect(calledPaths).toContain("/custom/app-path");
      });

      // Now click "← Back" on Step 5
      const backBtn = container.querySelector(
        "#onboard-step-5 .modal-actions .btn-secondary",
      ) as HTMLButtonElement;
      await act(async () => {
        fireEvent.click(backBtn);
      });

      // Step 4 is restored
      await waitFor(() => {
        expect(container.querySelector("#onboard-step-4")).not.toBeNull();
      });

      // Verify all Step 4 state is preserved exactly
      const restoredPath = container.querySelector(
        "#repo-path-repo-1",
      ) as HTMLInputElement;
      expect(restoredPath.value).toBe("/custom/app-path");

      const restoredRole = container.querySelector(
        "#repo-role-repo-2",
      ) as HTMLSelectElement;
      expect(restoredRole.value).toBe("infrastructure");

      const restoredPrimary2 = container.querySelector(
        "#repo-primary-repo-2",
      ) as HTMLInputElement;
      expect(restoredPrimary2.checked).toBe(true);
    });

    it("advances to Step 6 (Review) when all repositories are inspected and valid", async () => {
      mockDiscoverRepositories.mockResolvedValueOnce({
        repositories: [
          {
            id: "repo-1",
            name: "app-core",
            defaultBranch: "main",
          },
        ],
      });

      mockInspectRepository.mockResolvedValueOnce({
        path: "/Users/test/workspace/app-core",
        exists: true,
        isGitRepo: true,
        defaultBranch: "main",
        detectedCommands: { test: "bun test" },
        detectedTooling: ["bun"],
        readiness: { status: "ready", message: "Ready" },
      });

      const { container } = render(<TestWrapper />);
      await advanceToStep4(container);

      // Advance to Step 4
      await waitFor(() => {
        expect(container.textContent).toContain("discovered");
      });
      const step3Next = container.querySelector(
        "#btn-step-3-next",
      ) as HTMLButtonElement;
      await act(async () => {
        fireEvent.click(step3Next);
      });

      // Advance to Step 5
      await waitFor(() => {
        expect(container.querySelector("#onboard-step-4")).not.toBeNull();
      });
      const step4Next = container.querySelector(
        "#btn-step-4-next",
      ) as HTMLButtonElement;
      await act(async () => {
        fireEvent.click(step4Next);
      });

      await waitFor(() => {
        expect(container.querySelector("#onboard-step-5")).not.toBeNull();
      });

      // Wait for inspection and button enable
      const step5Next = container.querySelector(
        "#btn-step-5-next",
      ) as HTMLButtonElement;
      await waitFor(() => {
        expect(step5Next.disabled).toBe(false);
      });

      // Click "Continue to Review →"
      await act(async () => {
        fireEvent.click(step5Next);
      });

      // Step 6 (Review) is reached
      await waitFor(() => {
        expect(container.querySelector("#onboard-step-6")).not.toBeNull();
      });
    });
  });
});
