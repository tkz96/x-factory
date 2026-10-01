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
  OnboardingWizardModal,
  Step6Review,
} from "../src/frontend/components/modals/OnboardingWizardModal.js";
import type { InspectRepositoryResponse } from "../src/frontend/lib/api-client.js";
import type { Project, ProjectRepository } from "../src/shared/types.js";

let userEvent: ReturnType<typeof userEventLib.setup>;

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
let mockProjects: Project[] = [];
const mockGetProjects = mock(async () => mockProjects);
const mockFetch = mock(async () => {
  return new Response(JSON.stringify({ id: "created-proj-id" }), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
});

const mockInspectRepository = mock(
  async ({ path }: { path: string }): Promise<InspectRepositoryResponse> => {
    return {
      path,
      exists: true,
      isGitRepo: true,
      currentBranch: "main",
      defaultBranch: "main",
      detectedCommands: { test: "bun test" },
      detectedTooling: ["bun"],
      readiness: {
        status: "ready",
        message: "Repository verified and ready.",
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

describe("Wizard Step 6: Accurate Review & Multi-Repository Project Creation (#114)", () => {
  afterAll(async () => {
    await unregisterHappyDom();
  });

  afterEach(() => {
    cleanup();
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
    mockFetch.mockClear();
  });

  describe("Unit: Step6Review Component", () => {
    it("renders single-repository review state accurately with all metadata", () => {
      const singleRepo: ProjectRepository[] = [
        {
          id: "repo-1",
          name: "web-app",
          path: "/workspace/web-app",
          defaultBranch: "main",
          remote: "https://github.com/org/web-app.git",
          role: "frontend",
        },
      ];

      const { container } = render(
        <Step6Review
          projectName="Web App Project"
          projectId="web-app-project"
          workspacePath="/workspace"
          provider="github"
          gitHost="github"
          tracker="github"
          quickUrl="https://github.com/org/web-app"
          repositories={singleRepo}
          primaryRepoId="repo-1"
          isSubmitting={false}
          duplicateStatus={{ isDuplicate: false }}
          onBack={() => {}}
          onSubmit={() => {}}
        />,
      );

      // Verify Project level metadata
      expect(container.querySelector("#review-project-name")?.textContent).toBe(
        "Web App Project",
      );
      expect(container.querySelector("#review-project-id")?.textContent).toBe(
        "web-app-project",
      );
      expect(
        container.querySelector("#review-workspace-path")?.textContent,
      ).toBe("/workspace");
      expect(container.querySelector("#review-provider")?.textContent).toBe(
        "github",
      );
      expect(container.querySelector("#review-tracker")?.textContent).toBe(
        "github",
      );
      expect(
        container.querySelector("#review-repository-count")?.textContent,
      ).toBe("1");
      expect(container.querySelector("#review-remote-url")?.textContent).toBe(
        "https://github.com/org/web-app",
      );

      // Verify Repository table details
      const table = container.querySelector("#review-repos-table");
      expect(table).not.toBeNull();
      const rows = container.querySelectorAll(".review-repo-row");
      expect(rows.length).toBe(1);

      const row = rows[0]!;
      expect(row.getAttribute("data-repo-id")).toBe("repo-1");
      expect(row.getAttribute("data-is-primary")).toBe("true");
      expect(row.textContent).toContain("web-app");
      expect(row.textContent).toContain("frontend");
      expect(row.textContent).toContain("Primary");
      expect(row.textContent).toContain("/workspace/web-app");
      expect(row.textContent).toContain("main");
      expect(row.textContent).toContain("https://github.com/org/web-app.git");
    });

    it("renders multi-repository review state with primary first and distinct roles", () => {
      const multiRepos: ProjectRepository[] = [
        {
          id: "r1",
          name: "core-service",
          path: "/code/core-service",
          defaultBranch: "master",
          remote: "https://git.example.com/core-service",
          role: "backend",
        },
        {
          id: "r2",
          name: "web-ui",
          path: "/code/web-ui",
          defaultBranch: "main",
          remote: "https://git.example.com/web-ui",
          role: "frontend",
        },
        {
          id: "r3",
          name: "job-worker",
          path: "/code/job-worker",
          defaultBranch: "main",
          remote: "https://git.example.com/job-worker",
          role: "worker",
        },
      ];

      const { container } = render(
        <Step6Review
          projectName="Platform Suite"
          projectId="platform-suite"
          workspacePath="/code"
          provider="azure"
          gitHost="azure"
          tracker="azure"
          quickUrl=""
          repositories={multiRepos}
          primaryRepoId="r1"
          isSubmitting={false}
          duplicateStatus={{ isDuplicate: false }}
          onBack={() => {}}
          onSubmit={() => {}}
        />,
      );

      expect(
        container.querySelector("#review-repository-count")?.textContent,
      ).toBe("3");
      const rows = container.querySelectorAll(".review-repo-row");
      expect(rows.length).toBe(3);

      // Row 0 is primary
      expect(rows[0]!.getAttribute("data-repo-id")).toBe("r1");
      expect(rows[0]!.getAttribute("data-is-primary")).toBe("true");
      expect(rows[0]!.textContent).toContain("core-service");
      expect(rows[0]!.textContent).toContain("backend");
      expect(rows[0]!.textContent).toContain("Primary");

      // Row 1 is secondary
      expect(rows[1]!.getAttribute("data-repo-id")).toBe("r2");
      expect(rows[1]!.getAttribute("data-is-primary")).toBe("false");
      expect(rows[1]!.textContent).toContain("web-ui");
      expect(rows[1]!.textContent).toContain("frontend");
      expect(rows[1]!.textContent).toContain("No");

      // Row 2 is secondary
      expect(rows[2]!.getAttribute("data-repo-id")).toBe("r3");
      expect(rows[2]!.getAttribute("data-is-primary")).toBe("false");
      expect(rows[2]!.textContent).toContain("job-worker");
      expect(rows[2]!.textContent).toContain("worker");
      expect(rows[2]!.textContent).toContain("No");
    });
  });

  describe("Integration: Wizard Full Flow, Review, and Project Creation", () => {
    async function advanceToStep3(
      container: HTMLElement,
      projName = "Converso",
      projId = "converso",
    ) {
      // Step 1
      const nameInput = container.querySelector(
        "#onboard-proj-name",
      ) as HTMLInputElement;
      const idInput = container.querySelector(
        "#onboard-proj-id",
      ) as HTMLInputElement;

      await act(async () => {
        await userEvent.clear(nameInput);
        await userEvent.type(nameInput, projName);
        await userEvent.clear(idInput);
        await userEvent.type(idInput, projId);
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

      await act(async () => {
        await userEvent.type(orgInput, "https://dev.azure.com/xynotech");
        await userEvent.type(projInput, "Converso");
        await userEvent.type(patInput, "secret-pat-12345");
      });

      const step2Next = container.querySelector(
        "#btn-step-2-next",
      ) as HTMLButtonElement;
      await act(async () => {
        fireEvent.click(step2Next);
      });
    }

    it("Single-repository review and creation payload sends real metadata", async () => {
      mockDiscoverRepositories.mockResolvedValueOnce({
        repositories: [
          {
            id: "repo-alpha",
            name: "alpha-api",
            defaultBranch: "main",
            remote: "https://git.example.com/alpha-api.git",
          },
        ],
      });

      const { container } = render(<TestWrapper />);
      await advanceToStep3(container, "Alpha API", "alpha-api");

      // Wait for discovery to complete on Step 3
      await waitFor(() => {
        expect(container.textContent).toContain("1 repositories discovered");
      });

      // Step 3 -> Step 4
      const step3Next = container.querySelector(
        "#btn-step-3-next",
      ) as HTMLButtonElement;
      await act(async () => {
        fireEvent.click(step3Next);
      });

      // Step 4 -> Step 5
      await waitFor(() => {
        expect(container.querySelector("#btn-step-4-next")).not.toBeNull();
      });
      const step4Next = container.querySelector(
        "#btn-step-4-next",
      ) as HTMLButtonElement;
      await act(async () => {
        fireEvent.click(step4Next);
      });

      // Step 5 -> Step 6
      await waitFor(() => {
        expect(container.querySelector("#btn-step-5-next")).not.toBeNull();
      });
      const step5Next = container.querySelector(
        "#btn-step-5-next",
      ) as HTMLButtonElement;
      await act(async () => {
        fireEvent.click(step5Next);
      });

      // Verify Step 6 review display
      await waitFor(() => {
        expect(container.querySelector("#onboard-step-6")).not.toBeNull();
      });

      expect(container.querySelector("#review-project-name")?.textContent).toBe(
        "Alpha API",
      );
      expect(container.querySelector("#review-project-id")?.textContent).toBe(
        "alpha-api",
      );
      expect(
        container.querySelector("#review-repository-count")?.textContent,
      ).toBe("1");

      const repoRow = container.querySelector(
        '.review-repo-row[data-repo-id="repo-alpha"]',
      );
      expect(repoRow).not.toBeNull();
      expect(repoRow?.textContent).toContain("alpha-api");
      expect(repoRow?.textContent).toContain("Primary");
      expect(repoRow?.textContent).toContain(
        "https://git.example.com/alpha-api.git",
      );

      // Submit project creation
      const submitBtn = container.querySelector(
        "#btn-onboard-submit",
      ) as HTMLButtonElement;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      try {
        await act(async () => {
          fireEvent.click(submitBtn);
        });

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const callArgs = mockFetch.mock.calls[0] as unknown as [
          string,
          RequestInit,
        ];
        expect(callArgs[0]).toBe("/api/projects");
        const payload = JSON.parse(callArgs[1].body as string);

        expect(payload.id).toBe("alpha-api");
        expect(payload.name).toBe("Alpha API");
        expect(payload.repositories).toHaveLength(1);
        expect(payload.repositories[0]).toEqual({
          id: "repo-alpha",
          name: "alpha-api",
          path: "/Users/talhazuberi/projects/alpha-api",
          defaultBranch: "main",
          remote: "https://git.example.com/alpha-api.git",
          role: "backend",
        });

        // Ensure credentials are never sent
        expect(callArgs[1].body).not.toContain("secret-pat-12345");
        expect(payload.issueTracker.azure?.pat).toBeUndefined();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("Multi-repository review: primary repository remains first and metadata is preserved", async () => {
      mockDiscoverRepositories.mockResolvedValueOnce({
        repositories: [
          {
            id: "svc-backend",
            name: "backend-service",
            defaultBranch: "develop",
            remote: "https://dev.azure.com/org/proj/_git/backend",
          },
          {
            id: "svc-frontend",
            name: "frontend-portal",
            defaultBranch: "main",
            remote: "https://dev.azure.com/org/proj/_git/frontend",
          },
          {
            id: "svc-worker",
            name: "queue-worker",
            defaultBranch: "main",
            remote: "https://dev.azure.com/org/proj/_git/worker",
          },
        ],
      });

      const { container } = render(<TestWrapper />);
      await advanceToStep3(container, "Multi Suite", "multi-suite");

      await waitFor(() => {
        expect(container.textContent).toContain("3 repositories discovered");
      });

      // Advance to Step 4
      const step3Next = container.querySelector(
        "#btn-step-3-next",
      ) as HTMLButtonElement;
      await act(async () => {
        fireEvent.click(step3Next);
      });

      await waitFor(() => {
        expect(container.querySelector("#onboard-step-4")).not.toBeNull();
      });

      // Change primary repository to svc-frontend
      const primaryFrontend = container.querySelector(
        "#repo-primary-svc-frontend",
      ) as HTMLInputElement;
      expect(primaryFrontend).not.toBeNull();
      await act(async () => {
        fireEvent.click(primaryFrontend);
      });

      // Change path on svc-worker
      const workerPathInput = container.querySelector(
        "#repo-path-svc-worker",
      ) as HTMLInputElement;
      await act(async () => {
        await userEvent.clear(workerPathInput);
        await userEvent.type(workerPathInput, "/custom/path/worker");
      });

      // Step 4 -> Step 5
      const step4Next = container.querySelector(
        "#btn-step-4-next",
      ) as HTMLButtonElement;
      await act(async () => {
        fireEvent.click(step4Next);
      });

      // Step 5 -> Step 6
      await waitFor(() => {
        expect(container.querySelector("#btn-step-5-next")).not.toBeNull();
      });
      const step5Next = container.querySelector(
        "#btn-step-5-next",
      ) as HTMLButtonElement;
      await act(async () => {
        fireEvent.click(step5Next);
      });

      // Step 6 reached
      await waitFor(() => {
        expect(container.querySelector("#onboard-step-6")).not.toBeNull();
      });

      // Step 6 displays repository count = 3
      expect(
        container.querySelector("#review-repository-count")?.textContent,
      ).toBe("3");

      const rows = container.querySelectorAll(".review-repo-row");
      expect(rows.length).toBe(3);

      // Primary repository must be first in the array/table!
      expect(rows[0]!.getAttribute("data-repo-id")).toBe("svc-frontend");
      expect(rows[0]!.getAttribute("data-is-primary")).toBe("true");
      expect(rows[0]!.textContent).toContain("Primary");
      expect(rows[0]!.textContent).toContain("frontend-portal");

      // Custom path for worker must be visible
      expect(rows[2]!.getAttribute("data-repo-id")).toBe("svc-worker");
      expect(rows[2]!.textContent).toContain("/custom/path/worker");

      // Submit and verify payload
      const submitBtn = container.querySelector(
        "#btn-onboard-submit",
      ) as HTMLButtonElement;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      try {
        await act(async () => {
          fireEvent.click(submitBtn);
        });

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const callArgs = mockFetch.mock.calls[0] as unknown as [
          string,
          RequestInit,
        ];
        const payload = JSON.parse(callArgs[1].body as string);

        expect(payload.repositories).toHaveLength(3);

        // Primary repository must be first in the payload array!
        expect(payload.repositories[0].id).toBe("svc-frontend");
        expect(payload.repositories[0].name).toBe("frontend-portal");
        expect(payload.repositories[0].role).toBe("frontend");

        // Subsequent repositories preserved
        expect(payload.repositories[1].id).toBe("svc-backend");
        expect(payload.repositories[1].defaultBranch).toBe("develop");

        expect(payload.repositories[2].id).toBe("svc-worker");
        expect(payload.repositories[2].path).toBe("/custom/path/worker");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("14-repository Azure/Converso scenario: all 14 survive, Step 6 displays all 14, primary is first, metadata preserved, creation payload contains all 14 without credentials", async () => {
      const fourteenRepos = [
        {
          id: "1",
          name: "ai-engine",
          defaultBranch: "main",
          remote: "https://dev.azure.com/xynotech/Converso/_git/ai-engine",
        },
        {
          id: "2",
          name: "Vendifai-Custom",
          defaultBranch: "master",
          remote:
            "https://dev.azure.com/xynotech/Converso/_git/Vendifai-Custom",
        },
        {
          id: "3",
          name: "ai-docs",
          defaultBranch: "main",
          remote: "https://dev.azure.com/xynotech/Converso/_git/ai-docs",
        },
        {
          id: "4",
          name: "Shopify-Plugin",
          defaultBranch: "main",
          remote: "https://dev.azure.com/xynotech/Converso/_git/Shopify-Plugin",
        },
        {
          id: "5",
          name: "Converso-Front-End",
          defaultBranch: "main",
          remote:
            "https://dev.azure.com/xynotech/Converso/_git/Converso-Front-End",
        },
        {
          id: "6",
          name: "VendifAi-Extension",
          defaultBranch: "main",
          remote:
            "https://dev.azure.com/xynotech/Converso/_git/VendifAi-Extension",
        },
        {
          id: "7",
          name: "converso-infra-prod",
          defaultBranch: "main",
          remote:
            "https://dev.azure.com/xynotech/Converso/_git/converso-infra-prod",
        },
        {
          id: "8",
          name: "converso-portal",
          defaultBranch: "main",
          remote:
            "https://dev.azure.com/xynotech/Converso/_git/converso-portal",
        },
        {
          id: "9",
          name: "ticket-agent",
          defaultBranch: "main",
          remote: "https://dev.azure.com/xynotech/Converso/_git/ticket-agent",
        },
        {
          id: "10",
          name: "RBRE",
          defaultBranch: "main",
          remote: "https://dev.azure.com/xynotech/Converso/_git/RBRE",
        },
        {
          id: "11",
          name: "Vendifai-pulse",
          defaultBranch: "main",
          remote: "https://dev.azure.com/xynotech/Converso/_git/Vendifai-pulse",
        },
        {
          id: "12",
          name: "Converso",
          defaultBranch: "main",
          remote: "https://dev.azure.com/xynotech/Converso/_git/Converso",
        },
        {
          id: "13",
          name: "vendifiai-test-automation",
          defaultBranch: "main",
          remote:
            "https://dev.azure.com/xynotech/Converso/_git/vendifiai-test-automation",
        },
        {
          id: "14",
          name: "converso-infra",
          defaultBranch: "main",
          remote: "https://dev.azure.com/xynotech/Converso/_git/converso-infra",
        },
      ];

      mockDiscoverRepositories.mockResolvedValueOnce({
        repositories: fourteenRepos,
      });

      const { container } = render(<TestWrapper />);
      await advanceToStep3(container, "Converso", "converso");

      await waitFor(() => {
        expect(container.textContent).toContain("14 repositories discovered");
      });

      // Step 3 -> Step 4
      const step3Next = container.querySelector(
        "#btn-step-3-next",
      ) as HTMLButtonElement;
      await act(async () => {
        fireEvent.click(step3Next);
      });

      await waitFor(() => {
        expect(container.querySelector("#onboard-step-4")).not.toBeNull();
      });

      // Verify all 14 rendered in Step 4
      const step4Cards = container.querySelectorAll(".repo-config-card");
      expect(step4Cards.length).toBe(14);

      // Verify repo '12' ("Converso") is designated as primary because project ID is 'converso'
      const primaryRadio12 = container.querySelector(
        "#repo-primary-12",
      ) as HTMLInputElement;
      expect(primaryRadio12).not.toBeNull();
      expect(primaryRadio12.checked).toBe(true);

      // Step 4 -> Step 5
      const step4Next = container.querySelector(
        "#btn-step-4-next",
      ) as HTMLButtonElement;
      await act(async () => {
        fireEvent.click(step4Next);
      });

      // Step 5 -> Step 6
      await waitFor(() => {
        expect(container.querySelector("#btn-step-5-next")).not.toBeNull();
      });
      const step5Next = container.querySelector(
        "#btn-step-5-next",
      ) as HTMLButtonElement;
      await act(async () => {
        fireEvent.click(step5Next);
      });

      // Step 6 reached
      await waitFor(() => {
        expect(container.querySelector("#onboard-step-6")).not.toBeNull();
      });

      // 1. Verify Project metadata displayed on Step 6
      expect(container.querySelector("#review-project-name")?.textContent).toBe(
        "Converso",
      );
      expect(container.querySelector("#review-project-id")?.textContent).toBe(
        "converso",
      );
      expect(container.querySelector("#review-provider")?.textContent).toBe(
        "azure",
      );
      expect(container.querySelector("#review-tracker")?.textContent).toBe(
        "azure",
      );
      expect(
        container.querySelector("#review-repository-count")?.textContent,
      ).toBe("14");

      // 2. Verify all 14 repositories are displayed on Step 6
      const step6Rows = container.querySelectorAll(".review-repo-row");
      expect(step6Rows.length).toBe(14);

      for (const expectedRepo of fourteenRepos) {
        const row = container.querySelector(
          `.review-repo-row[data-repo-id="${expectedRepo.id}"]`,
        );
        expect(row).not.toBeNull();
        expect(row?.textContent).toContain(expectedRepo.name);
        expect(row?.textContent).toContain(expectedRepo.remote);
        expect(row?.textContent).toContain(expectedRepo.defaultBranch);
      }

      // 3. Verify primary repository (Converso, id: "12") is first in Step 6
      expect(step6Rows[0]!.getAttribute("data-repo-id")).toBe("12");
      expect(step6Rows[0]!.getAttribute("data-is-primary")).toBe("true");
      expect(step6Rows[0]!.textContent).toContain("Converso");
      expect(step6Rows[0]!.textContent).toContain("Primary");

      // 4. Submit project creation
      const submitBtn = container.querySelector(
        "#btn-onboard-submit",
      ) as HTMLButtonElement;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      try {
        await act(async () => {
          fireEvent.click(submitBtn);
        });

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const callArgs = mockFetch.mock.calls[0] as unknown as [
          string,
          RequestInit,
        ];
        expect(callArgs[0]).toBe("/api/projects");
        const payload = JSON.parse(callArgs[1].body as string);

        // 5. Final API request contains all 14 repositories
        expect(payload.repositories).toHaveLength(14);

        // Primary repository is first in the array
        expect(payload.repositories[0].id).toBe("12");
        expect(payload.repositories[0].name).toBe("Converso");
        expect(payload.repositories[0].path).toBe(
          "/Users/talhazuberi/projects/Converso",
        );
        expect(payload.repositories[0].remote).toBe(
          "https://dev.azure.com/xynotech/Converso/_git/Converso",
        );

        // Verify remaining 13 repositories survive with real metadata
        const remainingIds = payload.repositories
          .slice(1)
          .map((r: { id: string }) => r.id);
        expect(remainingIds).toHaveLength(13);
        expect(remainingIds).not.toContain("12");

        for (const repo of payload.repositories) {
          expect(repo.id).toBeDefined();
          expect(repo.name).toBeDefined();
          expect(repo.path).toBeDefined();
          expect(repo.defaultBranch).toBeDefined();
          expect(repo.remote).toBeDefined();
          expect(repo.role).toBeDefined();
        }

        // 6. Tracker configuration is preserved
        expect(payload.issueTracker.provider).toBe("azure");
        expect(payload.issueTracker.azure.orgUrl).toBe(
          "https://dev.azure.com/xynotech",
        );
        expect(payload.issueTracker.azure.project).toBe("Converso");

        // 7. No sensitive credential is included
        expect(callArgs[1].body).not.toContain("secret-pat-12345");
        expect(payload.issueTracker.azure?.pat).toBeUndefined();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("Existing onboarding navigation and state does not regress when moving back and forth", async () => {
      mockDiscoverRepositories.mockResolvedValueOnce({
        repositories: [
          {
            id: "repo-nav-1",
            name: "nav-backend",
            defaultBranch: "main",
            remote: "https://git.example.com/nav-backend",
          },
          {
            id: "repo-nav-2",
            name: "nav-frontend",
            defaultBranch: "main",
            remote: "https://git.example.com/nav-frontend",
          },
        ],
      });

      const { container } = render(<TestWrapper />);
      await advanceToStep3(container, "Nav Project", "nav-project");

      await waitFor(() => {
        expect(container.textContent).toContain("2 repositories discovered");
      });

      // Step 3 -> 4 -> 5 -> 6
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
        expect(container.querySelector("#onboard-step-6")).not.toBeNull();
      });
      expect(
        container.querySelector("#review-repository-count")?.textContent,
      ).toBe("2");

      // Navigate Back: Step 6 -> Step 5
      const step6Back = container.querySelector(
        "#onboard-step-6 .modal-actions .btn-secondary",
      ) as HTMLButtonElement;
      await act(async () => {
        fireEvent.click(step6Back);
      });

      await waitFor(() => {
        expect(container.querySelector("#onboard-step-5")).not.toBeNull();
      });

      // Navigate Back: Step 5 -> Step 4
      const step5Back = container.querySelector(
        "#onboard-step-5 .modal-actions .btn-secondary",
      ) as HTMLButtonElement;
      await act(async () => {
        fireEvent.click(step5Back);
      });

      await waitFor(() => {
        expect(container.querySelector("#onboard-step-4")).not.toBeNull();
      });

      // Change role in Step 4
      const roleSelect = container.querySelector(
        "#repo-role-repo-nav-1",
      ) as HTMLSelectElement;
      await act(async () => {
        fireEvent.change(roleSelect, { target: { value: "infrastructure" } });
      });

      // Re-advance to Step 5 then Step 6
      const step4NextAgain = container.querySelector(
        "#btn-step-4-next",
      ) as HTMLButtonElement;
      await act(async () => {
        fireEvent.click(step4NextAgain);
      });

      await waitFor(() => {
        const btn = container.querySelector(
          "#btn-step-5-next",
        ) as HTMLButtonElement;
        expect(btn).not.toBeNull();
        expect(btn.disabled).toBe(false);
      });
      const step5NextAgain = container.querySelector(
        "#btn-step-5-next",
      ) as HTMLButtonElement;
      await act(async () => {
        fireEvent.click(step5NextAgain);
      });

      // Step 6 reflects updated role
      await waitFor(() => {
        expect(container.querySelector("#onboard-step-6")).not.toBeNull();
      });

      const updatedRow = container.querySelector(
        '.review-repo-row[data-repo-id="repo-nav-1"]',
      );
      expect(updatedRow?.textContent).toContain("infrastructure");
    });
  });
});
