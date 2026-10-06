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
} from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ProviderDescriptor } from "../src/frontend/connection/types.js";
import {
  useWizard,
  WizardProvider,
} from "../src/frontend/wizard/state/wizardContext.js";
import { createInitialWizardState } from "../src/frontend/wizard/state/wizardReducer.js";
import { clearWizardDraft } from "../src/frontend/wizard/storage.js";
import {
  WIZARD_SCHEMA_VERSION,
  type WizardSourceState,
} from "../src/frontend/wizard/types.js";

const githubDescriptor: ProviderDescriptor = {
  id: "github",
  displayName: "GitHub",
  roles: ["gitHost", "tracker"],
  iconRef: "icon-github",
  capabilities: [],
  configFields: [
    { name: "owner", label: "Owner", type: "text", required: true },
    { name: "repo", label: "Repo", type: "text", required: true },
    {
      name: "token",
      label: "Token",
      type: "secret",
      required: true,
      secret: true,
    },
  ],
};

function LifecycleProbe() {
  const { state, nextStep, updateBasics, dispatch } = useWizard();
  return (
    <div>
      <span data-testid="step">{state.step}</span>
      <span data-testid="provider-github-owner">
        {(state.connect.providerConfigs.github?.owner as string) ?? "none"}
      </span>
      <button
        type="button"
        data-testid="btn-set-basics"
        onClick={() => updateBasics({ name: "Valid App", id: "valid-app" })}
      >
        Set Basics
      </button>
      <button
        type="button"
        data-testid="btn-set-config"
        onClick={() => {
          dispatch({
            type: "UPDATE_PROVIDER_CONFIG",
            providerId: "github",
            config: { owner: "unpersisted-owner", repo: "unpersisted-repo" },
          });
        }}
      >
        Set Config
      </button>
      <button type="button" data-testid="btn-next" onClick={nextStep}>
        Next
      </button>
    </div>
  );
}

function renderWithClient(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe("Wizard Lifecycle Draft Persistence & Restoration (#133 / Requirement 4)", () => {
  afterAll(async () => {
    await unregisterHappyDom();
  });

  afterEach(() => {
    cleanup();
    clearWizardDraft();
  });

  beforeEach(() => {
    clearWizardDraft();
  });

  it("does not persist a draft containing provider config when required descriptors are unavailable", async () => {
    const { getByTestId } = renderWithClient(
      <WizardProvider descriptors={undefined}>
        <LifecycleProbe />
      </WizardProvider>,
    );

    // Enter valid basics and provider config
    await act(async () => {
      getByTestId("btn-set-basics").click();
      getByTestId("btn-set-config").click();
    });

    // Advance step while descriptors are unavailable
    await act(async () => {
      getByTestId("btn-next").click();
    });

    // Verify localStorage: the draft containing provider config was NOT persisted
    // without descriptors, preventing silent erasure of valid configuration
    const raw = window.localStorage.getItem("xf_wizard_draft_v1");
    expect(raw).toBeNull();
  });

  it("restores draft provider configuration once descriptors for the stored provider ids become available", async () => {
    // Seed localStorage with a saved draft containing valid github configuration
    const savedState: WizardSourceState = {
      ...createInitialWizardState(),
      step: 2,
      maxStepVisited: 2,
      basics: {
        name: "My Rocket",
        id: "my-rocket",
        description: "",
        workspacePath: "/work/rocket",
      },
      connect: {
        quickUrl: "",
        providerConfigs: {
          github: { owner: "stored-owner", repo: "stored-repo" },
        },
        tracker: { providerId: "github", verified: false },
        gitHost: { providerId: "github", verified: false },
      },
    };

    window.localStorage.setItem(
      "xf_wizard_draft_v1",
      JSON.stringify({
        version: WIZARD_SCHEMA_VERSION,
        savedAt: new Date().toISOString(),
        state: savedState,
      }),
    );

    // Initial mount without descriptors (e.g. query still in-flight)
    const { getByTestId, rerender } = renderWithClient(
      <WizardProvider descriptors={undefined}>
        <LifecycleProbe />
      </WizardProvider>,
    );

    // Provider config is not yet restored while descriptors are unavailable
    expect(getByTestId("provider-github-owner").textContent).toBe("none");

    // Descriptors arrive (query resolves)
    await act(async () => {
      rerender(
        <QueryClientProvider
          client={
            new QueryClient({
              defaultOptions: {
                queries: { retry: false, staleTime: Infinity },
              },
            })
          }
        >
          <WizardProvider descriptors={[githubDescriptor]}>
            <LifecycleProbe />
          </WizardProvider>
        </QueryClientProvider>,
      );
    });

    // Draft restoration used the descriptors for the stored provider ids, restoring provider config
    expect(getByTestId("provider-github-owner").textContent).toBe(
      "stored-owner",
    );
  });
});
