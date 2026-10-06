// test/frontend-wizard-skeleton.test.tsx — Wizard skeleton, 5-step navigation, Basics step & client drafts journey tests (spec #133, #142).

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
import type { ProviderDescriptor } from "../src/frontend/connection/types.js";
import {
  ModalProvider,
  useModal,
} from "../src/frontend/context/ModalContext.js";
import { api } from "../src/frontend/lib/api-client.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import { clearWizardDraft } from "../src/frontend/wizard/storage.js";
import { WIZARD_SCHEMA_VERSION } from "../src/frontend/wizard/types.js";
import { WizardModal } from "../src/frontend/wizard/WizardModal.js";

function typeInput(input: HTMLElement, value: string) {
  act(() => {
    input.focus();
    fireEvent.change(input, { target: { value } });
    fireEvent.keyUp(input);
  });
}

function getEl<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
}

function Harness() {
  const { openOnboardingModal, closeOnboardingModal, isOnboardingOpen } =
    useModal();

  return (
    <div>
      <button type="button" id="btn-open-wizard" onClick={openOnboardingModal}>
        Open
      </button>
      <button
        type="button"
        id="btn-close-wizard"
        onClick={closeOnboardingModal}
      >
        Close
      </button>
      <span id="wizard-open-status">
        {isOnboardingOpen ? "open" : "closed"}
      </span>
      <WizardModal />
    </div>
  );
}

const stubManifest: ProviderDescriptor[] = [
  {
    id: "stub-provider",
    displayName: "Stub Provider",
    roles: ["tracker", "gitHost"],
    iconRef: "provider-stub",
    capabilities: [],
    configFields: [],
  },
];

function renderWizard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(queryKeys.providers(), stubManifest);

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

describe("Wizard Skeleton, Basics Step & Client Drafts (spec #133, #142)", () => {
  beforeEach(() => {
    clearWizardDraft();
    api.providers.getManifest = mock(async () => stubManifest);
    api.providers.verify = mock(async () => ({
      status: "ok" as const,
      warnings: [],
    }));
    api.providers.parseUrl = mock(async () => ({
      code: "UNKNOWN" as const,
      context: "",
      matched: false as const,
      url: "",
    }));
    api.providers.listRepositories = mock(async () => ({
      providerId: "stub-provider",
      roles: ["gitHost"],
      repositories: [
        {
          id: "repo-1",
          name: "titan-app",
          remote: "https://git.example.com/acme/titan-app.git",
        },
      ],
    }));
    // The Inspection step reads the configured git identity through the
    // api-client (#146), like every other async read in the wizard.
    api.inspectRepository = mock(async (payload: { path: string }) => ({
      path: payload.path,
      exists: true,
      isGitRepo: true,
      gitIdentity: { name: "Stub Owner", email: "stub@example.com" },
      detectedCommands: {},
      detectedTooling: [],
      readiness: { status: "ready" as const, message: "ready" },
    }));
  });

  afterEach(() => {
    cleanup();
    clearWizardDraft();
  });

  afterAll(async () => {
    await unregisterHappyDom();
  });

  it("modal is closed by default, opens upon trigger, and mounts thin orchestrator", () => {
    const { getByText, getByRole } = renderWizard();

    expect(getByText("closed")).toBeDefined();
    expect(document.getElementById("onboarding-wizard-modal")).toBeNull();

    fireEvent.click(getEl("btn-open-wizard"));

    expect(getByText("open")).toBeDefined();
    const modal = document.getElementById("onboarding-wizard-modal");
    expect(modal).not.toBeNull();
    expect(getByRole("heading", { name: "New Project Setup" })).toBeDefined();
  });

  it("Basics step renders all inputs and has NO hardcoded workspace path (S3 fixed)", () => {
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    expect(document.getElementById("onboard-step-1")).not.toBeNull();

    const nameInput = getEl<HTMLInputElement>("onboard-proj-name");
    const idInput = getEl<HTMLInputElement>("onboard-proj-id");
    const wsInput = getEl<HTMLInputElement>("onboard-workspace-path");
    const descInput = getEl<HTMLTextAreaElement>("onboard-proj-description");

    expect(nameInput).not.toBeNull();
    expect(idInput).not.toBeNull();
    expect(wsInput).not.toBeNull();
    expect(descInput).not.toBeNull();

    // S3 fix check: no hardcoded default path
    expect(wsInput.value).toBe("");
    expect(wsInput.value).not.toContain("talhazuberi");
    expect(wsInput.placeholder).toContain(
      "e.g. ~/projects or /path/to/workspace",
    );
  });

  it("enforces validation on Basics: disables Next until name & id are provided", async () => {
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    const nextBtn = getEl<HTMLButtonElement>("btn-step-1-next");
    expect(nextBtn.disabled).toBe(true);

    const nameInput = getEl<HTMLInputElement>("onboard-proj-name");
    await typeInput(nameInput, "Apollo Engine");

    // ID should auto-populate via normalizeProjectId
    const idInput = getEl<HTMLInputElement>("onboard-proj-id");
    expect(idInput.value).toBe("apollo-engine");

    // Next button becomes enabled
    expect(nextBtn.disabled).toBe(false);
  });

  it("progresses monotonically through 5 steps and preserves visited state on backward navigation", async () => {
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    // Fill Step 1
    const nameInput = getEl<HTMLInputElement>("onboard-proj-name");
    await typeInput(nameInput, "Project Titan");
    const wsInput = getEl<HTMLInputElement>("onboard-workspace-path");
    await typeInput(wsInput, "/work/titan");

    // Advance to Step 2: Connect
    fireEvent.click(getEl("btn-step-1-next"));
    expect(document.getElementById("onboard-step-2")).not.toBeNull();

    // Check StepNav: step 1 is marked completed, step 2 is active
    const step1Btn = getEl<HTMLButtonElement>("step-nav-basics");
    const step2Btn = getEl<HTMLButtonElement>("step-nav-connect");
    expect(step1Btn.className).toContain("completed");
    expect(step2Btn.className).toContain("active");

    // Fulfill Step 2 connection requirements (spec #133, ticket #143)
    fireEvent.change(getEl("select-tracker-provider"), {
      target: { value: "stub-provider" },
    });
    fireEvent.change(getEl("select-gitHost-provider"), {
      target: { value: "stub-provider" },
    });
    await act(async () => {
      fireEvent.click(getEl("btn-verify-tracker"));
      fireEvent.click(getEl("btn-verify-gitHost"));
    });

    // Advance to Step 3: Repositories
    fireEvent.click(getEl("btn-step-2-next"));
    expect(document.getElementById("onboard-step-3")).not.toBeNull();

    // Step 3 requires a discovered, selected application repository (#144).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    fireEvent.click(getEl("repo-select-repo-1"));

    // Advance to Step 4: Inspection
    fireEvent.click(getEl("btn-step-3-next"));
    expect(document.getElementById("onboard-step-4")).not.toBeNull();

    // Advance to Step 5: Review
    fireEvent.click(getEl("btn-step-4-next"));
    // The Inspection step's git-identity read lands after that step is left
    // (#146): let it settle inside the test's act scope.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.getElementById("onboard-step-5")).not.toBeNull();

    // Verify Review shows data from Step 1
    expect(document.getElementById("review-proj-name")?.textContent).toBe(
      "Project Titan",
    );
    expect(document.getElementById("review-proj-id")?.textContent).toBe(
      "project-titan",
    );
    expect(document.getElementById("review-workspace-path")?.textContent).toBe(
      "/work/titan",
    );

    // Navigate backward to Step 1 using StepNav
    fireEvent.click(step1Btn);
    expect(document.getElementById("onboard-step-1")).not.toBeNull();

    // Prior valid values are completely intact, not reset or corrupted
    const reloadedName = getEl<HTMLInputElement>("onboard-proj-name");
    const reloadedWs = getEl<HTMLInputElement>("onboard-workspace-path");
    expect(reloadedName.value).toBe("Project Titan");
    expect(reloadedWs.value).toBe("/work/titan");
  });

  it("persists client drafts at step boundaries and restores on next mount", async () => {
    const { unmount } = renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    // Set name and workspace path
    const nameInput = getEl<HTMLInputElement>("onboard-proj-name");
    await typeInput(nameInput, "Drafted App");
    const wsInput = getEl<HTMLInputElement>("onboard-workspace-path");
    await typeInput(wsInput, "/draft/path");

    // Step boundary: advance to Step 2
    fireEvent.click(getEl("btn-step-1-next"));
    expect(document.getElementById("onboard-step-2")).not.toBeNull();

    // Check localStorage has saved the draft envelope
    const raw = window.localStorage.getItem("xf_wizard_draft_v1");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw || "{}");
    // The schema version the code writes — a draft from an older, structurally
    // incompatible version is discarded by `loadWizardDraft` (correction 2
    // changed the connect section; see `test/wizard-storage.test.ts`).
    expect(parsed.version).toBe(WIZARD_SCHEMA_VERSION);
    expect(parsed.state.basics.name).toBe("Drafted App");
    expect(parsed.state.basics.workspacePath).toBe("/draft/path");

    // Unmount and remount (simulating reload)
    unmount();

    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    // Draft should restore to Step 2 with previous data
    expect(document.getElementById("onboard-step-2")).not.toBeNull();

    // Navigate back to check restored inputs
    const step1Btn = getEl<HTMLButtonElement>("step-nav-basics");
    fireEvent.click(step1Btn);

    const restoredName = getEl<HTMLInputElement>("onboard-proj-name");
    expect(restoredName.value).toBe("Drafted App");
  });

  it("closes cleanly via close button and cancel button", () => {
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));
    expect(document.getElementById("onboarding-wizard-modal")).not.toBeNull();

    // Cancel on step 1
    fireEvent.click(getEl("btn-step-1-cancel"));
    expect(document.getElementById("onboarding-wizard-modal")).toBeNull();

    // Reopen and close via header close button
    fireEvent.click(getEl("btn-open-wizard"));
    expect(document.getElementById("onboarding-wizard-modal")).not.toBeNull();
    fireEvent.click(getEl("btn-wizard-close"));
    expect(document.getElementById("onboarding-wizard-modal")).toBeNull();
  });
});
