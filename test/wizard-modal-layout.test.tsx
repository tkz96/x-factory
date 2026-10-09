// test/wizard-modal-layout.test.tsx — Setup modal structural/layout guarantees (#159).
//
// The setup wizard must behave like a real modal dialog: the background page is
// scroll-locked while it is open (so the page behind never becomes the scroll
// container), the lock persists across step transitions, and it is released when
// the wizard closes. These are the DOM-testable parts of the modal contract; the
// geometric guarantees (stable dimensions, internal scroll region, persistent
// header/footer, responsive sizes) are verified in the real browser.

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
import { WizardModal } from "../src/frontend/wizard/WizardModal.js";

function getEl<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
}

function Harness() {
  const { openOnboardingModal, closeOnboardingModal } = useModal();
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

function bodyOverflow(): string {
  return document.body.style.overflow;
}

describe("Setup modal layout contract (#159)", () => {
  beforeEach(() => {
    clearWizardDraft();
    document.body.style.overflow = "";
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
      repositories: [],
    }));
  });

  afterEach(() => {
    cleanup();
    document.body.style.overflow = "";
  });

  afterAll(async () => {
    await unregisterHappyDom();
  });

  it("scroll-locks the background page while the wizard is open", () => {
    expect(bodyOverflow()).not.toBe("hidden");
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    // Background must be locked so the page behind never scrolls.
    expect(bodyOverflow()).toBe("hidden");
  });

  it("keeps the background locked across a step transition", async () => {
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));
    expect(bodyOverflow()).toBe("hidden");

    // Advance to step 2: fill the required name (auto-fills the id).
    const nameInput = getEl<HTMLInputElement>("onboard-proj-name");
    await act(async () => {
      nameInput.focus();
      fireEvent.change(nameInput, { target: { value: "Titan" } });
      fireEvent.keyUp(nameInput);
      await Promise.resolve();
    });
    expect(nameInput.value).toBe("Titan");
    const nextBtn = getEl<HTMLButtonElement>("btn-step-1-next");
    expect(nextBtn.disabled).toBe(false);
    fireEvent.click(nextBtn);
    expect(document.getElementById("onboard-step-2")).not.toBeNull();

    // The lock must not be released by navigating between steps.
    expect(bodyOverflow()).toBe("hidden");
  });

  it("releases the background scroll lock when the wizard closes", () => {
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));
    expect(bodyOverflow()).toBe("hidden");

    fireEvent.click(getEl("btn-close-wizard"));
    expect(document.getElementById("onboarding-wizard-modal")).toBeNull();
    expect(bodyOverflow()).not.toBe("hidden");
  });

  it("composes the shared modal: step actions sit in the fixed footer, not the scrolling body", () => {
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    const next = getEl("btn-step-1-next");
    expect(next.closest(".modal-footer")).not.toBeNull();
    expect(next.closest(".modal-body")).toBeNull();
    expect(getEl("onboarding-wizard-modal").closest(".modal-backdrop")).toBe(
      getEl("onboarding-wizard-modal-overlay"),
    );
  });

  it("closes on Escape through the shared modal", () => {
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.getElementById("onboarding-wizard-modal")).toBeNull();
    expect(bodyOverflow()).not.toBe("hidden");
  });

  it("exposes accessible dialog semantics on the wizard surface", () => {
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    const overlay = getEl("onboarding-wizard-modal-overlay");
    expect(overlay.getAttribute("role")).toBe("dialog");
    expect(overlay.getAttribute("aria-modal")).toBe("true");
    const labelledBy = overlay.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy as string)).not.toBeNull();
  });
});
