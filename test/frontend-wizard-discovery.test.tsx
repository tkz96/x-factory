/// <reference lib="dom" />
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import React from "react";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectProvider } from "../src/frontend/context/ProjectContext.js";
import { OnboardingWizardModal } from "../src/frontend/components/modals/OnboardingWizardModal.js";
import { api } from "../src/frontend/lib/api-client.js";

// We'll import userEvent dynamically to ensure it runs AFTER GlobalRegistrator sets up window/document
let userEvent: any;

// Mock the API client
const mockDiscoverRepositories = mock(async () => {
  return { repositories: [] };
});
const mockTestAzureScopes = mock(async () => {
  return { ok: true, overPrivileged: false, scopes: {} };
});
// Mock fetch for createProject
const mockFetch = mock(async () => {
  return new Response(JSON.stringify({ id: "test-id" }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
global.fetch = mockFetch as any;

mock.module("../src/frontend/lib/api-client.js", () => {
  return {
    api: {
      discoverRepositories: mockDiscoverRepositories,
      discoverRepositories: mockDiscoverRepositories,
      testAzureScopes: mockTestAzureScopes,
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
      <ProjectProvider>
        <MemoryRouter>
          <OnboardingWizardModal />
        </MemoryRouter>
      </ProjectProvider>
    </QueryClientProvider>
  );
}

describe("Frontend Wizard Discovery (Step 3)", () => {
  beforeEach(async () => {
    if (!userEvent) {
      const module = await import("@testing-library/user-event");
      userEvent = module.default;
    }
    mockDiscoverRepositories.mockClear();
    mockTestAzureScopes.mockClear();
    mockFetch.mockClear();
  });

  async function advanceToStep3(container: HTMLElement) {
    // Step 1
    // Fill Project Name and ID
    const nameInput = container.querySelector('#onboard-proj-name') as HTMLInputElement;
    const idInput = container.querySelector('#onboard-proj-id') as HTMLInputElement;
    
    await act(async () => {
      await userEvent.type(nameInput, 'Test Project');
      await userEvent.type(idInput, 'test-project');
    });
    
    const step1Next = container.querySelector('#btn-step-1-next') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step1Next);
    });

    console.log(container.innerHTML); // DEBUG

    // Step 2
    const orgInput = container.querySelector('#onboard-azure-org-url') as HTMLInputElement;
    const projInput = container.querySelector('#onboard-tracker-project') as HTMLInputElement;
    const patInput = container.querySelector('#onboard-azure-pat') as HTMLInputElement;
    
    // For Azure: Org URL, Project Name, PAT
    expect(orgInput).not.toBeNull();
    expect(projInput).not.toBeNull();
    expect(patInput).not.toBeNull();

    await act(async () => {
      await userEvent.type(orgInput, 'https://dev.azure.com/xynotech');
      await userEvent.type(projInput, 'Converso');
      await userEvent.type(patInput, 'fake-pat');
    });

    const step2Next = container.querySelector('#btn-step-2-next') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step2Next);
    });
  }

  it("triggers discovery exactly once and prevents duplicates, preserving repository metadata", async () => {
    mockDiscoverRepositories.mockResolvedValueOnce({
      repositories: [
        { id: "1", name: "repo1", defaultBranch: "main", remote: "remote1" },
        { id: "2", name: "repo2", defaultBranch: "master", remote: "remote2" },
      ]
    });

    const { container } = render(<TestWrapper />);
    await advanceToStep3(container);

    await waitFor(() => {
      expect(mockDiscoverRepositories).toHaveBeenCalledTimes(1);
    });

    // Verify correct payload
    expect(mockDiscoverRepositories.mock.calls[0][0]).toEqual({
      provider: "azure",
      orgUrl: "https://dev.azure.com/xynotech",
      project: "Converso",
      pat: "fake-pat",
      workspacePath: "/Users/talhazuberi/projects",
    });

    // Check successful discovery state
    expect(container.textContent).toContain("2 repositories discovered");

    // Click back to step 2
    const step3Actions = container.querySelector('#onboard-step-3 .modal-actions') as HTMLElement;
    const backBtn = step3Actions.querySelector('.btn-secondary') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(backBtn);
    });

    await waitFor(() => {
      expect(container.querySelector('#btn-step-2-next')).not.toBeNull();
    });

    // Click next to step 3 again
    const step2Next = container.querySelector('#btn-step-2-next') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step2Next);
    });

    // Discovery should NOT be called again because inputs didn't change and result is cached
    expect(mockDiscoverRepositories).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("2 repositories discovered");
    
    // Proceed to Step 4
    const step3Next = container.querySelector('#btn-step-3-next') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step3Next);
    });
    
    await waitFor(() => {
      expect(container.textContent).toContain("Configure Repositories");
    });
  });

  it("handles empty discovery results properly", async () => {
    mockDiscoverRepositories.mockResolvedValueOnce({
      repositories: []
    });

    const { container } = render(<TestWrapper />);
    await advanceToStep3(container);

    await waitFor(() => {
      expect(mockDiscoverRepositories).toHaveBeenCalledTimes(1);
    });

    // Should show empty state
    expect(container.textContent).toContain("No repositories found.");

    // Step 3 Next button should NOT be disabled
    const step3Next = container.querySelector('#btn-step-3-next') as HTMLButtonElement;
    expect(step3Next.disabled).toBe(false);

    // Explicit Retry should run discovery again
    const retryBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Retry Discovery');
    expect(retryBtn).toBeDefined();
    await act(async () => {
      fireEvent.click(retryBtn!);
    });
    
    expect(mockDiscoverRepositories).toHaveBeenCalledTimes(2);
  });

  it("protects against stale concurrent responses", async () => {
    // We will simulate two requests where the first is slow and the second is fast
    let resolveFirst: any, resolveSecond: any;
    const promise1 = new Promise((resolve) => { resolveFirst = resolve; });
    const promise2 = new Promise((resolve) => { resolveSecond = resolve; });

    mockDiscoverRepositories
      .mockReturnValueOnce(promise1 as any)
      .mockReturnValueOnce(promise2 as any);

    const { container } = render(<TestWrapper />);
    await advanceToStep3(container); // Triggers request 1

    expect(mockDiscoverRepositories).toHaveBeenCalledTimes(1);

    // Go back to Step 2, change inputs, and go next to trigger request 2
    const backBtn = container.querySelector('#onboard-step-3 .btn-secondary') as HTMLButtonElement;
    fireEvent.click(backBtn);
    
    const projInput = container.querySelector('#onboard-tracker-project') as HTMLInputElement;
    await act(async () => {
      await userEvent.clear(projInput);
      await userEvent.type(projInput, 'Converso2');
    });

    const step2Next = container.querySelector('#btn-step-2-next') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step2Next);
    });

    expect(mockDiscoverRepositories).toHaveBeenCalledTimes(2);

    // Resolve second request first (Fast)
    await act(async () => {
      resolveSecond({
        repositories: [{ id: "2", name: "repo-fast" }]
      });
    });

    // Verify it shows repo-fast
    expect(container.textContent).toContain("1 repositories discovered");

    // Resolve first request later (Slow)
    await act(async () => {
      resolveFirst({
        repositories: [{ id: "1", name: "repo-slow" }]
      });
    });

    // Verify it STILL shows repo-fast, not overwritten by slow
    expect(container.textContent).toContain("1 repositories discovered");
    
    await waitFor(() => {
      expect(container.querySelector('#btn-step-3-next')).not.toBeNull();
    });
    const step3Next = container.querySelector('#btn-step-3-next') as HTMLButtonElement;
    fireEvent.click(step3Next);
    
    expect(container.textContent).toContain("Configure Repositories");
  });

  it("ensures PAT is not stored in final creation payload", async () => {
    mockDiscoverRepositories.mockResolvedValue({
      repositories: [{ id: "1", name: "repo1", defaultBranch: "main", remote: "remote1" }]
    });

    const { container } = render(<TestWrapper />);
    await advanceToStep3(container);
    
    await waitFor(() => {
      expect(mockDiscoverRepositories).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(container.querySelector('#btn-step-3-next')).not.toBeNull();
    });
    // Go to step 4
    const step3Next = container.querySelector('#btn-step-3-next') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step3Next);
    });

    await waitFor(() => {
      expect(container.querySelector('#btn-step-4-next')).not.toBeNull();
    });
    // Step 4 (Repositories) -> check the repo, click Next
    const step4Next = container.querySelector('#btn-step-4-next') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step4Next);
    });

    await waitFor(() => {
      expect(container.querySelector('#btn-step-5-next')).not.toBeNull();
    });
    // Step 5 (Run Configuration) -> Next
    const step5Next = container.querySelector('#btn-step-5-next') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step5Next);
    });

    await waitFor(() => {
      expect(container.querySelector('#btn-onboard-submit')).not.toBeNull();
    });

    // Step 6 (Final) -> Submit
    const step6Next = container.querySelector('#btn-onboard-submit') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step6Next);
    });

    // Check createProject payload
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toBe("/api/projects");
    const payload = JSON.parse(callArgs[1].body);
    
    // PAT should NOT be in the issue tracker configuration
    expect(payload.issueTracker?.azure?.pat).toBeUndefined();
    expect(callArgs[1].body).not.toContain("fake-pat");
  });
});
