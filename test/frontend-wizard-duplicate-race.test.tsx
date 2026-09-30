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
const mockGetProjects = mock<any>(async () => []);
// biome-ignore lint/suspicious/noExplicitAny: test mock
const mockTestAzureScopes = mock<any>(async () => ({ ok: true }));
// biome-ignore lint/suspicious/noExplicitAny: test mock
const mockDiscoverRepositories = mock<any>(async () => ({ repositories: [] }));

mock.module("../src/frontend/lib/api-client.js", () => ({
  api: {
    getProjects: mockGetProjects,
    testAzureScopes: mockTestAzureScopes,
    discoverRepositories: mockDiscoverRepositories,
  },
}));

describe("Wizard: duplicate race (Test 8)", () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    userEvent = (await import("@testing-library/user-event")).default;
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mockGetProjects.mockClear();

    // Original fetch is needed to intercept the final POST
    globalThis.fetch = mock(
      async (req: Request | string, init?: RequestInit) => {
        if (
          typeof req === "string" &&
          req === "/api/projects" &&
          init?.method === "POST"
        ) {
          return new Response(
            JSON.stringify({ error: "Project already exists (simulated 409)" }),
            { status: 409, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify([]));
      },
      // biome-ignore lint/suspicious/noExplicitAny: test mock
    ) as any;
  });

  it("handles backend 409 gracefully without closing or showing success", async () => {
    // Render the wizard already open
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ModalProvider>
          <TestWrapper />
        </ModalProvider>
      </QueryClientProvider>,
    );

    // Wait for the modal to open
    await waitFor(() => {
      expect(container.querySelector("#onboard-proj-name")).not.toBeNull();
    });

    // Step 1
    const nameInput = container.querySelector(
      "#onboard-proj-name",
    ) as HTMLInputElement;
    const idInput = container.querySelector(
      "#onboard-proj-id",
    ) as HTMLInputElement;
    await act(async () => {
      await userEvent.type(nameInput, "My Project");
      await userEvent.type(idInput, "my-project");
    });
    const step1Next = container.querySelector(
      "#btn-step-1-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step1Next);
    });

    // Wait for Step 2 to appear
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
      await userEvent.type(orgInput, "https://dev.azure.com/test");
      await userEvent.type(projInput, "testproj");
      await userEvent.type(patInput, "testpat");
    });
    const step2Next = container.querySelector(
      "#btn-step-2-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step2Next);
    });

    // Step 3
    await waitFor(() => {
      const step3Next = container.querySelector(
        "#btn-step-3-next",
      ) as HTMLButtonElement;
      expect(step3Next.disabled).toBe(false);
    });
    const step3Next = container.querySelector(
      "#btn-step-3-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step3Next);
    });

    // Step 4
    const step4Next = container.querySelector(
      "#btn-step-4-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step4Next);
    });

    // Step 5
    const step5Next = container.querySelector(
      "#btn-step-5-next",
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(step5Next);
    });

    // Step 6 - Submit
    const submitBtn = container.querySelector(
      "#btn-onboard-submit",
    ) as HTMLButtonElement;
    expect(submitBtn).not.toBeNull();

    await act(async () => {
      fireEvent.click(submitBtn);
    });

    // Wait for the 409 error to appear in the DOM
    await waitFor(() => {
      const errorMsg = container.querySelector(".error-message");
      expect(errorMsg).not.toBeNull();
      expect(errorMsg?.textContent).toContain(
        "Project already exists (simulated 409)",
      );
    });

    // Ensure the modal didn't close (Submit button still there, still on step 6)
    expect(container.querySelector("#btn-onboard-submit")).not.toBeNull();
  });
});
