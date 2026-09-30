/// <reference lib="dom" />
import "./setup-happy-dom.js";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { OnboardingWizardModal } from "../src/frontend/components/modals/OnboardingWizardModal.js";
import {
  ModalProvider,
  useModal,
} from "../src/frontend/context/ModalContext.js";

function TestWrapper() {
  const { openOnboardingModal } = useModal();
  useEffect(() => openOnboardingModal(), [openOnboardingModal]);
  return <OnboardingWizardModal />;
}

// biome-ignore lint/suspicious/noExplicitAny: test mock
let userEvent: any;

// biome-ignore lint/suspicious/noExplicitAny: test mock
let mockProjects: any[] = [];
// biome-ignore lint/suspicious/noExplicitAny: test mock
const mockGetProjects = mock<any>(async () => mockProjects);
// biome-ignore lint/suspicious/noExplicitAny: test mock
const mockTestAzureScopes = mock<any>(async () => ({ ok: true }));
// biome-ignore lint/suspicious/noExplicitAny: test mock
let mockDiscoveredRepositories: any[] = [];
// biome-ignore lint/suspicious/noExplicitAny: test mock
const mockDiscoverRepositories = mock<any>(async () => ({
  repositories: mockDiscoveredRepositories,
}));
// biome-ignore lint/suspicious/noExplicitAny: test mock
const mockTestConnection = mock<any>(async () => ({ ok: true }));
// biome-ignore lint/suspicious/noExplicitAny: test mock
const mockInspectRepository = mock<any>(async () => ({
  existsLocally: true,
  isGitRepository: true,
  gitRemotes: [],
  isInitialized: false,
}));

mock.module("../src/frontend/lib/api-client.js", () => ({
  api: {
    getProjects: mockGetProjects,
    testAzureScopes: mockTestAzureScopes,
    discoverRepositories: mockDiscoverRepositories,
    testConnection: mockTestConnection,
    inspectRepository: mockInspectRepository,
  },
}));

describe("Wizard: duplicate detection logic", () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    userEvent = (await import("@testing-library/user-event")).default;
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mockGetProjects.mockClear();
    mockProjects = [];
    mockDiscoveredRepositories = [];
  });

  async function fillStep1(container: HTMLElement, name: string, id: string) {
    const nameInput = container.querySelector(
      "#onboard-proj-name",
    ) as HTMLInputElement;
    const idInput = container.querySelector(
      "#onboard-proj-id",
    ) as HTMLInputElement;
    await act(async () => {
      await userEvent.clear(nameInput);
      await userEvent.type(nameInput, name);
      await userEvent.clear(idInput);
      await userEvent.type(idInput, id);
    });
    const next = container.querySelector(
      "#btn-step-1-next",
    ) as HTMLButtonElement;
    await act(async () => fireEvent.click(next));
  }

  async function fillStep2(
    container: HTMLElement,
    org: string,
    proj: string,
    pat: string,
  ) {
    await waitFor(() => {
      expect(container.querySelector("#onboard-azure-org-url")).not.toBeNull();
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
      await userEvent.clear(orgInput);
      await userEvent.type(orgInput, org);
      await userEvent.clear(projInput);
      await userEvent.type(projInput, proj);
      await userEvent.clear(patInput);
      await userEvent.type(patInput, pat);
    });
    const next = container.querySelector(
      "#btn-step-2-next",
    ) as HTMLButtonElement;
    await act(async () => fireEvent.click(next));
  }

  async function nextStep3(container: HTMLElement) {
    await waitFor(() => {
      const btn = container.querySelector(
        "#btn-step-3-next",
      ) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
    const next = container.querySelector(
      "#btn-step-3-next",
    ) as HTMLButtonElement;
    await act(async () => fireEvent.click(next));
  }

  async function nextStep4(container: HTMLElement) {
    const next = container.querySelector(
      "#btn-step-4-next",
    ) as HTMLButtonElement;
    await act(async () => fireEvent.click(next));
  }

  async function nextStep5(container: HTMLElement) {
    const next = container.querySelector(
      "#btn-step-5-next",
    ) as HTMLButtonElement;
    await act(async () => fireEvent.click(next));
  }

  it("Exact ID collision disables create button", async () => {
    mockProjects = [
      {
        id: "converso",
        name: "converso",
        issueTracker: { provider: "azure" },
        repositories: [],
      },
    ];

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ModalProvider>
          <TestWrapper />
        </ModalProvider>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(container.querySelector("#onboard-proj-name")).not.toBeNull(),
    );
    await fillStep1(container, "converso", "converso");
    await fillStep2(container, "https://dev.azure.com/x", "p", "pat");
    await nextStep3(container);
    await nextStep4(container);
    await nextStep5(container);

    await waitFor(() => {
      const errorMsg = container.querySelector(".duplicate-warning-card");
      expect(errorMsg).not.toBeNull();
      expect(errorMsg?.textContent).toContain("already in use");
    });

    const submitBtn = container.querySelector(
      "#btn-onboard-submit",
    ) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  it("Same Azure external project disables create button", async () => {
    mockProjects = [
      {
        id: "converso-existing",
        name: "Converso",
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

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ModalProvider>
          <TestWrapper />
        </ModalProvider>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(container.querySelector("#onboard-proj-name")).not.toBeNull(),
    );
    await fillStep1(container, "my-new-project", "my-new-project");
    // Different casing, trailing slash
    await fillStep2(
      container,
      "https://dev.azure.com/XynoTech/",
      "converso",
      "pat",
    );
    await nextStep3(container);
    await nextStep4(container);
    await nextStep5(container);

    await waitFor(() => {
      const errorMsg = container.querySelector(".duplicate-warning-card");
      expect(errorMsg).not.toBeNull();
      expect(errorMsg?.textContent).toContain("already onboarded");
      expect(errorMsg?.textContent).toContain("xynotech / Converso");
    });

    const submitBtn = container.querySelector(
      "#btn-onboard-submit",
    ) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  it("Same local ID but different Azure target reports ID conflict", async () => {
    mockProjects = [
      {
        id: "converso",
        name: "Converso",
        issueTracker: {
          provider: "azure",
          azure: {
            orgUrl: "https://dev.azure.com/company-a",
            project: "Converso",
          },
        },
        repositories: [],
      },
    ];

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ModalProvider>
          <TestWrapper />
        </ModalProvider>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(container.querySelector("#onboard-proj-name")).not.toBeNull(),
    );
    await fillStep1(container, "converso", "converso");
    await fillStep2(
      container,
      "https://dev.azure.com/xynotech",
      "converso",
      "pat",
    );
    await nextStep3(container);
    await nextStep4(container);
    await nextStep5(container);

    await waitFor(() => {
      const errorMsg = container.querySelector(".duplicate-warning-card");
      expect(errorMsg).not.toBeNull();
      expect(errorMsg?.textContent).toContain("already in use");
    });
  });

  it("Archived project duplicates still block creation", async () => {
    mockProjects = [
      {
        id: "old-project",
        name: "Old Project",
        archived: true,
        issueTracker: {
          provider: "azure",
          azure: {
            orgUrl: "https://dev.azure.com/xynotech",
            project: "converso",
          },
        },
        repositories: [],
      },
    ];

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ModalProvider>
          <TestWrapper />
        </ModalProvider>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(container.querySelector("#onboard-proj-name")).not.toBeNull(),
    );
    await fillStep1(container, "new-project", "new-project");
    await fillStep2(
      container,
      "https://dev.azure.com/xynotech",
      "converso",
      "pat",
    );
    await nextStep3(container);
    await nextStep4(container);
    await nextStep5(container);

    await waitFor(() => {
      const errorMsg = container.querySelector(".duplicate-warning-card");
      expect(errorMsg).not.toBeNull();
      expect(errorMsg?.textContent).toContain("(Archived)");
    });
  });

  it("Remote match prevents creation", async () => {
    mockProjects = [
      {
        id: "existing-repo-project",
        name: "Repo Project",
        issueTracker: { provider: "azure" },
        repositories: [{ remote: "https://github.com/owner/repo" }],
      },
    ];
    mockDiscoveredRepositories = [
      { id: "repo-1", name: "repo", remote: "git@github.com:owner/repo.git" },
    ];

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ModalProvider>
          <TestWrapper />
        </ModalProvider>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(container.querySelector("#onboard-proj-name")).not.toBeNull(),
    );
    await fillStep1(container, "new-project", "new-project");
    await fillStep2(
      container,
      "https://dev.azure.com/xynotech",
      "different-board",
      "pat",
    );
    await nextStep3(container);
    await nextStep4(container);
    await nextStep5(container);

    await waitFor(() => {
      const errorMsg = container.querySelector(".duplicate-warning-card");
      expect(errorMsg).not.toBeNull();
      expect(errorMsg?.textContent).toContain("already onboarded");
    });
  });

  it("Identity change clears duplicate warning", async () => {
    mockProjects = [
      {
        id: "converso",
        name: "converso",
        issueTracker: { provider: "azure" },
        repositories: [],
      },
    ];

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ModalProvider>
          <TestWrapper />
        </ModalProvider>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(container.querySelector("#onboard-proj-name")).not.toBeNull(),
    );
    await fillStep1(container, "converso", "converso");
    await fillStep2(container, "https://dev.azure.com/x", "p", "pat");
    await nextStep3(container);
    await nextStep4(container);
    await nextStep5(container);

    await waitFor(() => {
      const errorMsg = container.querySelector(".duplicate-warning-card");
      expect(errorMsg).not.toBeNull();
    });

    // Go back to step 1
    const backBtn6 = container.querySelector(
      "#onboard-step-6 .modal-actions .btn-secondary",
    );
    if (backBtn6) {
      await act(async () => fireEvent.click(backBtn6));
    } // To 5
    await waitFor(() =>
      expect(
        container.querySelector(
          "#onboard-step-5 .modal-actions .btn-secondary",
        ),
      ).not.toBeNull(),
    );
    const backBtn5 = container.querySelector(
      "#onboard-step-5 .modal-actions .btn-secondary",
    );
    if (backBtn5) {
      await act(async () => fireEvent.click(backBtn5));
    } // To 4
    await waitFor(() =>
      expect(
        container.querySelector(
          "#onboard-step-4 .modal-actions .btn-secondary",
        ),
      ).not.toBeNull(),
    );
    const backBtn4 = container.querySelector(
      "#onboard-step-4 .modal-actions .btn-secondary",
    );
    if (backBtn4) {
      await act(async () => fireEvent.click(backBtn4));
    } // To 3
    await waitFor(() =>
      expect(
        container.querySelector(
          "#onboard-step-3 .modal-actions .btn-secondary",
        ),
      ).not.toBeNull(),
    );
    const backBtn3 = container.querySelector(
      "#onboard-step-3 .modal-actions .btn-secondary",
    );
    if (backBtn3) {
      await act(async () => fireEvent.click(backBtn3));
    } // To 2
    await waitFor(() =>
      expect(
        container.querySelector(
          "#onboard-step-2 .modal-actions .btn-secondary",
        ),
      ).not.toBeNull(),
    );
    const backBtn2 = container.querySelector(
      "#onboard-step-2 .modal-actions .btn-secondary",
    );
    if (backBtn2) {
      await act(async () => fireEvent.click(backBtn2));
    } // To 1

    await fillStep1(container, "converso-new", "converso-new");
    const next2 = container.querySelector(
      "#btn-step-2-next",
    ) as HTMLButtonElement;
    await act(async () => fireEvent.click(next2));
    await nextStep3(container);
    await nextStep4(container);
    await nextStep5(container);

    await waitFor(() => {
      expect(container.querySelector(".duplicate-warning-card")).toBeNull();
    });
  });
});
