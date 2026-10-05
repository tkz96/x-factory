// test/connect-step.test.tsx — Connect step dual connection cards, Quick-URL & parallel verification tests (spec #133, ticket #143).

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
import {
  ERROR_COPY,
  STATE_COPY,
} from "../src/frontend/components/feedback/copy-map.js";
import type {
  ProviderDescriptor,
  VerificationResult,
} from "../src/frontend/connection/types.js";
import {
  ModalProvider,
  useModal,
} from "../src/frontend/context/ModalContext.js";
import { ApiError, api } from "../src/frontend/lib/api-client.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import {
  clearWizardDraft,
  saveWizardDraft,
} from "../src/frontend/wizard/storage.js";
import { WizardModal } from "../src/frontend/wizard/WizardModal.js";

const genericManifestFixture: ProviderDescriptor[] = [
  {
    id: "generic-tracker",
    displayName: "Generic Tracker Service",
    roles: ["tracker"],
    iconRef: "icon-custom-tracker",
    capabilities: ["listTickets"],
    configFields: [
      {
        name: "endpointHost",
        label: "Endpoint Host",
        type: "url",
        required: true,
        placeholder: "https://tracker.example.com",
        help: "Server hostname for tracker issues.",
      },
      {
        name: "accessCredential",
        label: "Access Credential",
        type: "secret",
        required: true,
        secret: true,
        placeholder: "sec_...",
        help: "Secret credential for tracker authentication.",
      },
      {
        name: "workspaceSlug",
        label: "Workspace Slug",
        type: "text",
        required: false,
        placeholder: "team-alpha",
        help: "Team workspace slug.",
      },
    ],
  },
  {
    id: "generic-githost",
    displayName: "Generic Git Host Service",
    roles: ["gitHost"],
    iconRef: "icon-custom-git",
    capabilities: ["listRepositories", "createPullRequest"],
    configFields: [
      {
        name: "gitUrl",
        label: "Git URL",
        type: "url",
        required: true,
        placeholder: "https://git.example.com",
      },
      {
        name: "token",
        label: "Access Token",
        type: "secret",
        required: true,
        secret: true,
        placeholder: "tok_...",
      },
    ],
  },
  {
    id: "dual-service",
    displayName: "Dual Role Service",
    roles: ["tracker", "gitHost"],
    iconRef: "icon-custom-dual",
    capabilities: ["listTickets", "listRepositories", "createPullRequest"],
    configFields: [
      {
        name: "serviceUrl",
        label: "Service URL",
        type: "url",
        required: true,
        placeholder: "https://dual.example.com",
      },
      {
        name: "pat",
        label: "Personal Access Token",
        type: "secret",
        required: true,
        secret: true,
        placeholder: "pat_...",
      },
    ],
  },
];

function getEl<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
}

function typeInput(input: HTMLElement, value: string) {
  act(() => {
    input.focus();
    fireEvent.change(input, { target: { value } });
    fireEvent.keyUp(input);
  });
}

function Harness() {
  const { openOnboardingModal } = useModal();
  return (
    <div>
      <button type="button" id="btn-open-wizard" onClick={openOnboardingModal}>
        Open Wizard
      </button>
      <WizardModal />
    </div>
  );
}

function renderWizard(manifestData = genericManifestFixture) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(queryKeys.providers(), manifestData);

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

function setupStep2Draft(overrides?: Record<string, unknown>) {
  saveWizardDraft({
    step: 2,
    maxStepVisited: 2,
    basics: {
      name: "Test App",
      id: "test-app",
      description: "Test description",
      workspacePath: "/workspace/test",
    },
    connect: {
      quickUrl: "",
      tracker: {
        providerId: null,
        config: {},
        verified: false,
      },
      gitHost: {
        providerId: null,
        config: {},
        verified: false,
      },
    },
    repositories: {
      selectedRepoIds: [],
      primaryRepoId: null,
      repoConfigs: {},
    },
    inspection: {
      acknowledged: false,
    },
    review: {
      confirmed: false,
    },
    ...overrides,
  });
}

describe("Connect Step: Dual Connection Cards & Quick-URL (spec #133, ticket #143)", () => {
  beforeEach(() => {
    clearWizardDraft();
    api.providers.getManifest = mock(async () => genericManifestFixture);
    api.providers.verify = mock(async () => ({
      status: "ok" as const,
      warnings: [],
    }));
    api.providers.parseUrl = mock(async () => ({
      matched: false as const,
      url: "",
    }));
  });

  afterEach(() => {
    cleanup();
    clearWizardDraft();
  });

  afterAll(async () => {
    await unregisterHappyDom();
  });

  it("EMPTY STATE: wizard opens on step 2 → both roles show no provider selected → generic choices from manifest fixture → nothing preselected", () => {
    setupStep2Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    expect(document.getElementById("onboard-step-2")).not.toBeNull();

    // Tracker card
    const trackerCard = getEl("connection-card-tracker");
    expect(trackerCard).not.toBeNull();
    const trackerSelect = getEl<HTMLSelectElement>("select-tracker-provider");
    expect(trackerSelect.value).toBe("");

    // Verify tracker select options: includes tracker and dual-role, excludes gitHost-only
    const trackerOptions = Array.from(trackerSelect.options).map(
      (o) => o.value,
    );
    expect(trackerOptions).toContain("");
    expect(trackerOptions).toContain("generic-tracker");
    expect(trackerOptions).toContain("dual-service");
    expect(trackerOptions).not.toContain("generic-githost");

    // Git Host card
    const gitHostCard = getEl("connection-card-gitHost");
    expect(gitHostCard).not.toBeNull();
    const gitHostSelect = getEl<HTMLSelectElement>("select-gitHost-provider");
    expect(gitHostSelect.value).toBe("");

    // Verify gitHost select options: includes gitHost and dual-role, excludes tracker-only
    const gitHostOptions = Array.from(gitHostSelect.options).map(
      (o) => o.value,
    );
    expect(gitHostOptions).toContain("");
    expect(gitHostOptions).toContain("generic-githost");
    expect(gitHostOptions).toContain("dual-service");
    expect(gitHostOptions).not.toContain("generic-tracker");

    // Next button is disabled
    const nextBtn = getEl<HTMLButtonElement>("btn-step-2-next");
    expect(nextBtn.disabled).toBe(true);
  });

  it("GENERIC FIELDS: renders descriptor labels/types/placeholders/help; secret renders as password; absent provider renders nothing", async () => {
    setupStep2Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    // Select generic-tracker
    const trackerSelect = getEl<HTMLSelectElement>("select-tracker-provider");
    act(() => {
      fireEvent.change(trackerSelect, { target: { value: "generic-tracker" } });
    });

    // Check fields rendered from descriptor
    const endpointInput = getEl<HTMLInputElement>("tracker-endpointHost");
    expect(endpointInput).not.toBeNull();
    expect(endpointInput.type).toBe("url");
    expect(endpointInput.placeholder).toBe("https://tracker.example.com");

    const endpointHint = getEl("tracker-endpointHost-hint");
    expect(endpointHint.textContent).toContain(
      "Server hostname for tracker issues.",
    );

    const credInput = getEl<HTMLInputElement>("tracker-accessCredential");
    expect(credInput).not.toBeNull();
    expect(credInput.type).toBe("password"); // Secret rendered as password control!
    expect(credInput.placeholder).toBe("sec_...");

    const credHint = getEl("tracker-accessCredential-hint");
    expect(credHint.textContent).toContain(
      "Secret credential for tracker authentication.",
    );

    const slugInput = getEl<HTMLInputElement>("tracker-workspaceSlug");
    expect(slugInput).not.toBeNull();
    expect(slugInput.type).toBe("text");
    expect(slugInput.placeholder).toBe("team-alpha");

    // Absent provider check: "github", "azure", "jira" are NOT in the fixture and render nothing
    expect(document.getElementById("tracker-pat")).toBeNull();
    expect(document.getElementById("tracker-orgUrl")).toBeNull();
    expect(document.getElementById("tracker-jiraHost")).toBeNull();
  });

  it("QUICK-URL SUCCESS ×3: three provider-shaped parse-url responses through API mock → correct provider selected, configDraft applied, inferred name applied", async () => {
    // Start with empty basics name so inferredName applies
    setupStep2Draft({
      basics: { name: "", id: "", description: "", workspacePath: "" },
    });

    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    const quickUrlInput = getEl<HTMLInputElement>("connect-quick-url");
    const submitBtn = getEl<HTMLButtonElement>("btn-quick-url-submit");

    // 1. Git Host URL shape
    api.providers.parseUrl = mock(async () => ({
      matched: true as const,
      providerId: "generic-githost",
      configDraft: {
        gitUrl: "https://git.example.com/org/repo",
        token: "tok-git-123",
      },
      inferredName: "git-inferred-repo",
    }));

    await typeInput(quickUrlInput, "https://git.example.com/org/repo");
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    // Git host card has provider selected and config applied
    const gitHostSelect = getEl<HTMLSelectElement>("select-gitHost-provider");
    expect(gitHostSelect.value).toBe("generic-githost");
    expect(getEl<HTMLInputElement>("gitHost-gitUrl").value).toBe(
      "https://git.example.com/org/repo",
    );
    expect(getEl<HTMLInputElement>("gitHost-token").value).toBe("tok-git-123");

    // Tracker card remains unselected
    const trackerSelect = getEl<HTMLSelectElement>("select-tracker-provider");
    expect(trackerSelect.value).toBe("");

    // 2. Tracker URL shape
    api.providers.parseUrl = mock(async () => ({
      matched: true as const,
      providerId: "generic-tracker",
      configDraft: {
        endpointHost: "https://tracker.example.com",
        accessCredential: "sec-tracker-999",
      },
      inferredName: "tracker-project",
    }));

    await typeInput(quickUrlInput, "https://tracker.example.com/issues");
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    // Tracker card has provider selected and config applied
    expect(trackerSelect.value).toBe("generic-tracker");
    expect(getEl<HTMLInputElement>("tracker-endpointHost").value).toBe(
      "https://tracker.example.com",
    );
    expect(getEl<HTMLInputElement>("tracker-accessCredential").value).toBe(
      "sec-tracker-999",
    );

    // 3. Dual-role URL shape
    api.providers.parseUrl = mock(async () => ({
      matched: true as const,
      providerId: "dual-service",
      configDraft: {
        serviceUrl: "https://dual.example.com/my-org",
        pat: "dual-pat-777",
      },
      inferredName: "dual-project",
    }));

    await typeInput(quickUrlInput, "https://dual.example.com/my-org");
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    // Both cards now have dual-service selected
    expect(trackerSelect.value).toBe("dual-service");
    expect(gitHostSelect.value).toBe("dual-service");
    expect(getEl<HTMLInputElement>("tracker-serviceUrl").value).toBe(
      "https://dual.example.com/my-org",
    );
    expect(getEl<HTMLInputElement>("gitHost-serviceUrl").value).toBe(
      "https://dual.example.com/my-org",
    );
  });

  it("QUICK-URL MISS: matched:false → no provider/config change, input value preserved", async () => {
    setupStep2Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    api.providers.parseUrl = mock(async () => ({
      matched: false as const,
      url: "https://unsupported.example.com/unknown",
    }));

    const quickUrlInput = getEl<HTMLInputElement>("connect-quick-url");
    await typeInput(quickUrlInput, "https://unsupported.example.com/unknown");

    await act(async () => {
      fireEvent.click(getEl("btn-quick-url-submit"));
    });

    // Input value is preserved
    expect(quickUrlInput.value).toBe("https://unsupported.example.com/unknown");

    // Neither provider is selected
    expect(getEl<HTMLSelectElement>("select-tracker-provider").value).toBe("");
    expect(getEl<HTMLSelectElement>("select-gitHost-provider").value).toBe("");

    // Feedback shows warning message
    expect(
      document.getElementById("quick-url-miss-feedback")?.textContent,
    ).toContain("not recognized");
  });

  it("QUICK-URL STALE CONFIG: changing provider via Quick-URL replaces config rather than leaking old provider keys", async () => {
    setupStep2Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    // 1. Select provider A ("dual-service") on tracker
    act(() => {
      fireEvent.change(getEl("select-tracker-provider"), {
        target: { value: "dual-service" },
      });
    });

    // Enter provider A config (credential field 'pat' and url 'serviceUrl')
    const serviceUrlInput = getEl<HTMLInputElement>("tracker-serviceUrl");
    await typeInput(serviceUrlInput, "https://dual.example.com/company");
    const patInput = getEl<HTMLInputElement>("tracker-pat");
    await typeInput(patInput, "secret-token-xyz");

    // 2. Submit a Quick-URL that parses to provider B ("generic-tracker")
    api.providers.parseUrl = mock(async () => ({
      matched: true as const,
      providerId: "generic-tracker",
      configDraft: {
        endpointHost: "https://jira.corp.internal",
        workspaceSlug: "core-team",
      },
      inferredName: "Project Core",
    }));

    const quickInput = getEl<HTMLInputElement>("connect-quick-url");
    await typeInput(quickInput, "https://jira.corp.internal/browse/PROJ-1");

    await act(async () => {
      fireEvent.click(getEl("btn-quick-url-submit"));
    });

    // 3. Verify provider was updated to provider B
    const trackerSelect = getEl<HTMLSelectElement>("select-tracker-provider");
    expect(trackerSelect.value).toBe("generic-tracker");

    // 4. Capture config sent to verify to inspect actual role state
    let capturedConfig: Record<string, unknown> | null = null;
    api.providers.verify = mock(
      async (payload: { config: Record<string, unknown> }) => {
        capturedConfig = payload.config;
        return { status: "ok" as const, warnings: [] };
      },
    );

    await act(async () => {
      fireEvent.click(getEl("btn-verify-tracker"));
    });

    expect(capturedConfig).not.toBeNull();
    // Must contain ONLY provider B's configDraft keys
    expect(capturedConfig as unknown as Record<string, unknown>).toEqual({
      endpointHost: "https://jira.corp.internal",
      workspaceSlug: "core-team",
    });
    // Explicitly assert stale keys from provider A are absent
    expect(capturedConfig).not.toHaveProperty("pat");
    expect(capturedConfig).not.toHaveProperty("serviceUrl");
  });

  it("VERIFICATION SUCCESS: verify → {status:'ok',warnings:[]} → connection shows verified", async () => {
    setupStep2Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    // Select tracker provider
    act(() => {
      fireEvent.change(getEl("select-tracker-provider"), {
        target: { value: "generic-tracker" },
      });
    });

    api.providers.verify = mock(async () => ({
      status: "ok" as const,
      warnings: [],
    }));

    // Trigger verify
    await act(async () => {
      fireEvent.click(getEl("btn-verify-tracker"));
    });

    // Connection shows verified
    expect(getEl("connection-card-tracker").textContent).toContain("Verified");
    expect(
      document.getElementById("tracker-verified-feedback")?.textContent,
    ).toContain("Connection verified");
  });

  it("VERIFICATION DEGRADED: verify → degraded + CAPABILITY_UNCONFIRMED → partial UI shows capability name and no raw provider text", async () => {
    setupStep2Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    act(() => {
      fireEvent.change(getEl("select-gitHost-provider"), {
        target: { value: "generic-githost" },
      });
    });

    api.providers.verify = mock(async () => ({
      status: "degraded" as const,
      warnings: [
        {
          kind: "CAPABILITY_UNCONFIRMED" as const,
          capability: "createPullRequest",
        },
      ],
    }));

    await act(async () => {
      fireEvent.click(getEl("btn-verify-gitHost"));
    });

    // Shows partial banner with capability name
    const gitHostCard = getEl("connection-card-gitHost");
    expect(gitHostCard.textContent).toContain("Degraded");
    expect(gitHostCard.textContent).toContain(STATE_COPY.partial);
    expect(gitHostCard.textContent).toContain("createPullRequest");
  });

  it("AUTH_LOCKED: ProviderError {code:'AUTH_LOCKED',context:'VERIFY'} → canonical copy-map remediation text renders verbatim", async () => {
    setupStep2Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    act(() => {
      fireEvent.change(getEl("select-tracker-provider"), {
        target: { value: "generic-tracker" },
      });
    });

    api.providers.verify = mock(async () => ({
      code: "AUTH_LOCKED" as const,
      context: "VERIFY" as const,
    }));

    await act(async () => {
      fireEvent.click(getEl("btn-verify-tracker"));
    });

    const trackerCard = getEl("connection-card-tracker");
    expect(trackerCard.textContent).toContain("Error");
    // Must assert the exact copy-map string, never raw provider text
    expect(trackerCard.textContent).toContain(ERROR_COPY.AUTH_LOCKED.VERIFY);
  });

  it("FIELD/FORM VALIDATION: 409 fieldErrors renders field-level message; 409 formErrors renders form-level message", async () => {
    setupStep2Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    act(() => {
      fireEvent.change(getEl("select-tracker-provider"), {
        target: { value: "generic-tracker" },
      });
    });

    // 1. 409 with fieldErrors
    api.providers.verify = mock(async () => {
      throw new ApiError("Conflict", 409, {
        fieldErrors: {
          endpointHost: "REQUIRED",
          accessCredential: "INVALID",
        },
      });
    });

    await act(async () => {
      fireEvent.click(getEl("btn-verify-tracker"));
    });

    const endpointError = document.getElementById("tracker-endpointHost-error");
    expect(endpointError?.textContent).toContain("Endpoint Host is required.");

    const credError = document.getElementById("tracker-accessCredential-error");
    expect(credError?.textContent).toContain("Access Credential is invalid.");

    // 2. 409 with formErrors
    api.providers.verify = mock(async () => {
      throw new ApiError("Conflict", 409, {
        formErrors: ["INCOMPATIBLE_CONFIGURATION"],
      });
    });

    await act(async () => {
      fireEvent.click(getEl("btn-verify-tracker"));
    });

    const trackerCard = getEl("connection-card-tracker");
    expect(trackerCard.textContent).toContain(
      "Incompatible configuration for the selected provider role.",
    );
  });

  it("PARALLEL VERIFICATION: two deferred promises prove concurrent execution without awaiting each other", async () => {
    setupStep2Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    // Select both providers
    act(() => {
      fireEvent.change(getEl("select-tracker-provider"), {
        target: { value: "generic-tracker" },
      });
      fireEvent.change(getEl("select-gitHost-provider"), {
        target: { value: "generic-githost" },
      });
    });

    let resolveTracker!: (val: VerificationResult) => void;
    const trackerDeferred = new Promise<VerificationResult>((resolve) => {
      resolveTracker = resolve;
    });

    let resolveGitHost!: (val: VerificationResult) => void;
    const gitHostDeferred = new Promise<VerificationResult>((resolve) => {
      resolveGitHost = resolve;
    });

    const verifyMock = mock(async (payload: { role: string }) => {
      if (payload.role === "tracker") return trackerDeferred;
      if (payload.role === "gitHost") return gitHostDeferred;
      return { status: "ok" as const, warnings: [] };
    });
    api.providers.verify = verifyMock;

    // Start verification for both concurrently via the top "Verify All Connections" button
    await act(async () => {
      fireEvent.click(getEl("btn-verify-all"));
    });

    // BOTH verify calls must have been invoked synchronously without awaiting the first!
    expect(verifyMock).toHaveBeenCalledTimes(2);
    expect(verifyMock.mock.calls[0]?.[0]?.role).toBe("tracker");
    expect(verifyMock.mock.calls[1]?.[0]?.role).toBe("gitHost");

    // Both cards show Verifying… state simultaneously
    expect(getEl("btn-verify-tracker").textContent).toContain("Verifying…");
    expect(getEl("btn-verify-gitHost").textContent).toContain("Verifying…");

    // Resolve gitHost first
    await act(async () => {
      resolveGitHost({ status: "ok", warnings: [] });
    });

    // GitHost is now verified, but Tracker is STILL pending!
    expect(getEl("connection-card-gitHost").textContent).toContain("Verified");
    expect(getEl("btn-verify-tracker").textContent).toContain("Verifying…");

    // Resolve tracker second
    await act(async () => {
      resolveTracker({ status: "ok", warnings: [] });
    });

    // Now both are verified!
    expect(getEl("connection-card-tracker").textContent).toContain("Verified");
    expect(getEl("connection-card-gitHost").textContent).toContain("Verified");
  });

  it("PROVIDER REUSE: a dual-role provider populates tracker and git-host independently with dual-role badge", () => {
    setupStep2Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    // Select dual-service on tracker
    act(() => {
      fireEvent.change(getEl("select-tracker-provider"), {
        target: { value: "dual-service" },
      });
    });

    // Dual-role badge appears on tracker card
    const trackerCard = getEl("connection-card-tracker");
    expect(trackerCard.textContent).toContain("Dual-role");

    // Select dual-service on git-host
    act(() => {
      fireEvent.change(getEl("select-gitHost-provider"), {
        target: { value: "dual-service" },
      });
    });

    // Dual-role badge appears on git-host card
    const gitHostCard = getEl("connection-card-gitHost");
    expect(gitHostCard.textContent).toContain("Dual-role");
  });

  it("STATE ISOLATION: changing tracker config leaves git-host config untouched, and vice versa", async () => {
    setupStep2Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    // Select dual-service on both
    act(() => {
      fireEvent.change(getEl("select-tracker-provider"), {
        target: { value: "dual-service" },
      });
      fireEvent.change(getEl("select-gitHost-provider"), {
        target: { value: "dual-service" },
      });
    });

    // Change tracker's serviceUrl
    const trackerUrlInput = getEl<HTMLInputElement>("tracker-serviceUrl");
    await typeInput(trackerUrlInput, "https://tracker-only.com");

    // Git-host's serviceUrl must remain untouched
    const gitHostUrlInput = getEl<HTMLInputElement>("gitHost-serviceUrl");
    expect(gitHostUrlInput.value).toBe("");

    // Change git-host's pat
    const gitHostPatInput = getEl<HTMLInputElement>("gitHost-pat");
    await typeInput(gitHostPatInput, "git-pat-secret");

    // Tracker's pat must remain untouched
    const trackerPatInput = getEl<HTMLInputElement>("tracker-pat");
    expect(trackerPatInput.value).toBe("");
  });

  it("NAVIGATION GATING: Next is blocked with missing selection, errored connection, or unaccepted degraded; enabled only when verified or degraded is explicitly accepted", async () => {
    setupStep2Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    const nextBtn = getEl<HTMLButtonElement>("btn-step-2-next");

    // 1. Missing selections -> Next is blocked
    expect(nextBtn.disabled).toBe(true);

    // Select both providers
    act(() => {
      fireEvent.change(getEl("select-tracker-provider"), {
        target: { value: "generic-tracker" },
      });
      fireEvent.change(getEl("select-gitHost-provider"), {
        target: { value: "generic-githost" },
      });
    });

    // Selected but not verified -> Next is STILL blocked
    expect(nextBtn.disabled).toBe(true);

    // 2. Errored connection -> Next is blocked
    api.providers.verify = mock(async (payload: { role: string }) => {
      if (payload.role === "tracker") {
        return { status: "ok" as const, warnings: [] };
      }
      return { code: "AUTH_LOCKED" as const, context: "VERIFY" as const };
    });

    await act(async () => {
      fireEvent.click(getEl("btn-verify-tracker"));
      fireEvent.click(getEl("btn-verify-gitHost"));
    });

    // One ok, one error -> Next is blocked!
    expect(nextBtn.disabled).toBe(true);

    // 3. Degraded connection -> requires explicit acceptance before continuation
    api.providers.verify = mock(async () => ({
      status: "degraded" as const,
      warnings: [
        {
          kind: "CAPABILITY_UNCONFIRMED" as const,
          capability: "createPullRequest",
        },
      ],
    }));

    await act(async () => {
      fireEvent.click(getEl("btn-verify-gitHost"));
    });

    // Tracker is ok, GitHost is degraded (unaccepted) -> Next is blocked!
    expect(nextBtn.disabled).toBe(true);

    // Accept degraded connection on GitHost
    await act(async () => {
      fireEvent.click(getEl("btn-accept-degraded-gitHost"));
    });

    // Tracker is ok, GitHost is degraded + accepted -> permitted! Next is ENABLED!
    expect(nextBtn.disabled).toBe(false);

    // 4. Click Next -> advances to Step 3 (Repositories)
    await act(async () => {
      fireEvent.click(nextBtn);
    });

    expect(document.getElementById("onboard-step-3")).not.toBeNull();
  });

  it("QUICK-URL NETWORK ERROR: parseUrl throwing shows fallback", async () => {
    setupStep2Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    const quickInput = getEl<HTMLInputElement>("connect-quick-url");
    await typeInput(quickInput, "https://throw.example.com");
    api.providers.parseUrl = mock(async () => {
      throw new Error("Network down");
    });

    await act(async () => {
      fireEvent.click(getEl("btn-quick-url-submit"));
    });

    expect(
      document.getElementById("quick-url-miss-feedback")?.textContent,
    ).toContain("Failed to parse URL");
  });

  it("VERIFICATION NETWORK ERROR: verify throwing an exception renders error banner", async () => {
    setupStep2Draft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    act(() => {
      fireEvent.change(getEl("select-gitHost-provider"), {
        target: { value: "generic-githost" },
      });
    });

    api.providers.verify = mock(async () => {
      throw new Error("Connection timed out");
    });

    await act(async () => {
      fireEvent.click(getEl("btn-verify-gitHost"));
    });

    const gitHostCard = getEl("connection-card-gitHost");
    expect(gitHostCard.textContent).toContain("Error");
  });

  describe("DEGRADED ACCEPTANCE & NAVIGATION (ticket #143 §5, §8)", () => {
    it("(a) ideal + ideal permits continuation", async () => {
      setupStep2Draft();
      renderWizard();
      fireEvent.click(getEl("btn-open-wizard"));

      act(() => {
        fireEvent.change(getEl("select-tracker-provider"), {
          target: { value: "generic-tracker" },
        });
        fireEvent.change(getEl("select-gitHost-provider"), {
          target: { value: "generic-githost" },
        });
      });

      api.providers.verify = mock(async () => ({
        status: "ok" as const,
        warnings: [],
      }));

      await act(async () => {
        fireEvent.click(getEl("btn-verify-tracker"));
        fireEvent.click(getEl("btn-verify-gitHost"));
      });

      const nextBtn = getEl<HTMLButtonElement>("btn-step-2-next");
      expect(nextBtn.disabled).toBe(false);
    });

    it("(b) ideal + degraded does NOT permit continuation until degraded is explicitly accepted", async () => {
      setupStep2Draft();
      renderWizard();
      fireEvent.click(getEl("btn-open-wizard"));

      act(() => {
        fireEvent.change(getEl("select-tracker-provider"), {
          target: { value: "generic-tracker" },
        });
        fireEvent.change(getEl("select-gitHost-provider"), {
          target: { value: "generic-githost" },
        });
      });

      api.providers.verify = mock(async (payload: { role: string }) => {
        if (payload.role === "tracker") {
          return { status: "ok" as const, warnings: [] };
        }
        return {
          status: "degraded" as const,
          warnings: [
            {
              kind: "CAPABILITY_UNCONFIRMED" as const,
              capability: "createPullRequest",
            },
          ],
        };
      });

      await act(async () => {
        fireEvent.click(getEl("btn-verify-tracker"));
        fireEvent.click(getEl("btn-verify-gitHost"));
      });

      const nextBtn = getEl<HTMLButtonElement>("btn-step-2-next");
      // Tracker is ideal (ok), GitHost is degraded (unaccepted) -> blocked!
      expect(nextBtn.disabled).toBe(true);

      const acceptBtn = getEl<HTMLButtonElement>("btn-accept-degraded-gitHost");
      expect(acceptBtn).not.toBeNull();
      expect(acceptBtn.textContent).toContain("Accept partial connection");
    });

    it("(c) accepting the degraded connection then permits continuation", async () => {
      setupStep2Draft();
      renderWizard();
      fireEvent.click(getEl("btn-open-wizard"));

      act(() => {
        fireEvent.change(getEl("select-tracker-provider"), {
          target: { value: "generic-tracker" },
        });
        fireEvent.change(getEl("select-gitHost-provider"), {
          target: { value: "generic-githost" },
        });
      });

      api.providers.verify = mock(async (payload: { role: string }) => {
        if (payload.role === "tracker") {
          return { status: "ok" as const, warnings: [] };
        }
        return {
          status: "degraded" as const,
          warnings: [
            {
              kind: "CAPABILITY_UNCONFIRMED" as const,
              capability: "createPullRequest",
            },
          ],
        };
      });

      await act(async () => {
        fireEvent.click(getEl("btn-verify-tracker"));
        fireEvent.click(getEl("btn-verify-gitHost"));
      });

      const nextBtn = getEl<HTMLButtonElement>("btn-step-2-next");
      expect(nextBtn.disabled).toBe(true);

      // Explicitly accept degraded connection on gitHost
      await act(async () => {
        fireEvent.click(getEl("btn-accept-degraded-gitHost"));
      });

      // Now continuation is permitted!
      expect(nextBtn.disabled).toBe(false);
      expect(getEl("btn-accept-degraded-gitHost").textContent).toContain(
        "Partial connection accepted",
      );

      // Advancing to step 3 succeeds
      await act(async () => {
        fireEvent.click(nextBtn);
      });
      expect(document.getElementById("onboard-step-3")).not.toBeNull();
    });

    it("(d) accepting degraded on tracker does not affect gitHost state", async () => {
      setupStep2Draft();
      renderWizard();
      fireEvent.click(getEl("btn-open-wizard"));

      act(() => {
        fireEvent.change(getEl("select-tracker-provider"), {
          target: { value: "generic-tracker" },
        });
        fireEvent.change(getEl("select-gitHost-provider"), {
          target: { value: "generic-githost" },
        });
      });

      api.providers.verify = mock(async () => ({
        status: "degraded" as const,
        warnings: [
          {
            kind: "CAPABILITY_UNCONFIRMED" as const,
            capability: "someCapability",
          },
        ],
      }));

      await act(async () => {
        fireEvent.click(getEl("btn-verify-tracker"));
        fireEvent.click(getEl("btn-verify-gitHost"));
      });

      const nextBtn = getEl<HTMLButtonElement>("btn-step-2-next");
      expect(nextBtn.disabled).toBe(true);

      // Both cards show unaccepted degraded buttons
      expect(getEl("btn-accept-degraded-tracker").textContent).toContain(
        "Accept partial connection",
      );
      expect(getEl("btn-accept-degraded-gitHost").textContent).toContain(
        "Accept partial connection",
      );

      // Accept degraded on tracker ONLY
      await act(async () => {
        fireEvent.click(getEl("btn-accept-degraded-tracker"));
      });

      // Tracker button updates
      expect(getEl("btn-accept-degraded-tracker").textContent).toContain(
        "Partial connection accepted",
      );

      // GitHost button remains unaccepted and untouched!
      const gitHostAcceptBtn = getEl<HTMLButtonElement>(
        "btn-accept-degraded-gitHost",
      );
      expect(gitHostAcceptBtn.textContent).toContain(
        "Accept partial connection",
      );
      expect(gitHostAcceptBtn.disabled).toBe(false);

      // Next is STILL blocked because gitHost degraded is not accepted!
      expect(nextBtn.disabled).toBe(true);
    });

    it("changing role provider or config resets degradedAccepted to false without touching other role", async () => {
      setupStep2Draft();
      renderWizard();
      fireEvent.click(getEl("btn-open-wizard"));

      act(() => {
        fireEvent.change(getEl("select-tracker-provider"), {
          target: { value: "generic-tracker" },
        });
        fireEvent.change(getEl("select-gitHost-provider"), {
          target: { value: "generic-githost" },
        });
      });

      api.providers.verify = mock(async () => ({
        status: "degraded" as const,
        warnings: [
          {
            kind: "CAPABILITY_UNCONFIRMED" as const,
            capability: "someCapability",
          },
        ],
      }));

      await act(async () => {
        fireEvent.click(getEl("btn-verify-tracker"));
        fireEvent.click(getEl("btn-verify-gitHost"));
      });

      // Accept both
      await act(async () => {
        fireEvent.click(getEl("btn-accept-degraded-tracker"));
        fireEvent.click(getEl("btn-accept-degraded-gitHost"));
      });

      const nextBtn = getEl<HTMLButtonElement>("btn-step-2-next");
      expect(nextBtn.disabled).toBe(false);

      // Edit tracker config field
      const trackerEndpointInput = getEl<HTMLInputElement>(
        "tracker-endpointHost",
      );
      await typeInput(trackerEndpointInput, "https://tracker-changed.com");

      // Tracker degraded acceptance is RESET!
      expect(nextBtn.disabled).toBe(true);

      // GitHost remains accepted!
      expect(getEl("btn-accept-degraded-gitHost").textContent).toContain(
        "Partial connection accepted",
      );
    });
  });

  describe("ASYNC OPERATION IDENTITY & GENERATION GUARDS (P1, P2)", () => {
    it("P1 (a): verification race guard — stale ok verification discarded if config changed in flight", async () => {
      setupStep2Draft();
      renderWizard();
      fireEvent.click(getEl("btn-open-wizard"));

      // Select generic-tracker
      act(() => {
        fireEvent.change(getEl("select-tracker-provider"), {
          target: { value: "generic-tracker" },
        });
      });

      const endpointInput = getEl<HTMLInputElement>("tracker-endpointHost");
      await typeInput(endpointInput, "https://initial.example.com");

      // Set up deferred verify promise
      let resolveVerify!: (val: VerificationResult) => void;
      const deferredPromise = new Promise<VerificationResult>((resolve) => {
        resolveVerify = resolve;
      });
      api.providers.verify = mock(async () => deferredPromise);

      // Trigger verification
      await act(async () => {
        fireEvent.click(getEl("btn-verify-tracker"));
      });

      // Provider and config fields must remain reachable/editable while verification is pending
      expect(endpointInput.disabled).toBe(false);
      expect(getEl<HTMLSelectElement>("select-tracker-provider").disabled).toBe(
        false,
      );

      // While pending, mutate tracker config
      await typeInput(endpointInput, "https://changed.example.com");

      // Now resolve the stale in-flight verification with ok
      await act(async () => {
        resolveVerify({ status: "ok" as const, warnings: [] });
      });

      // Tracker must NOT be reported verified and must not show stale ok state
      const trackerCard = getEl("connection-card-tracker");
      expect(trackerCard.textContent).not.toContain("Verified");
      expect(getEl<HTMLButtonElement>("btn-step-2-next").disabled).toBe(true);
    });

    it("P1 (b): Quick-URL race guard — stale parse result discarded if provider changed in flight & UI disabled while parsing", async () => {
      setupStep2Draft();
      renderWizard();
      fireEvent.click(getEl("btn-open-wizard"));

      // Set up deferred parse promise
      let resolveParse!: (val: {
        matched: true;
        providerId: string;
        configDraft: Record<string, unknown>;
        inferredName?: string;
      }) => void;
      const parseDeferred = new Promise<{
        matched: true;
        providerId: string;
        configDraft: Record<string, unknown>;
        inferredName?: string;
      }>((resolve) => {
        resolveParse = resolve;
      });
      api.providers.parseUrl = mock(async () => parseDeferred);

      const quickInput = getEl<HTMLInputElement>("connect-quick-url");
      await typeInput(quickInput, "https://github.com/myorg/myrepo");

      // Trigger parse
      await act(async () => {
        fireEvent.click(getEl("btn-quick-url-submit"));
      });

      // UI guards: controls must be disabled while parse is in flight
      const trackerSelect = getEl<HTMLSelectElement>("select-tracker-provider");
      const gitHostSelect = getEl<HTMLSelectElement>("select-gitHost-provider");
      const submitBtn = getEl<HTMLButtonElement>("btn-quick-url-submit");
      expect(trackerSelect.disabled).toBe(true);
      expect(gitHostSelect.disabled).toBe(true);
      expect(submitBtn.disabled).toBe(true);

      // Prove the guard: manual provider change happens while parse was in flight
      act(() => {
        fireEvent.change(trackerSelect, {
          target: { value: "dual-service" },
        });
      });
      expect(trackerSelect.value).toBe("dual-service");

      // Now resolve the stale parse with a generic-tracker result
      await act(async () => {
        resolveParse({
          matched: true,
          providerId: "generic-tracker",
          configDraft: { endpointHost: "https://late-parse.example.com" },
          inferredName: "Late Parse",
        });
      });

      // Role must keep the newer manual selection and NOT be overwritten by the late parse result
      expect(trackerSelect.value).toBe("dual-service");
      expect(getEl<HTMLInputElement>("tracker-serviceUrl")).not.toBeNull();
      expect(document.getElementById("tracker-endpointHost")).toBeNull();
    });

    it("P2: Quick-URL invalidates ONLY the affected role, preserving untouched role's verification", async () => {
      setupStep2Draft();
      renderWizard();
      fireEvent.click(getEl("btn-open-wizard"));

      // Select and configure both
      act(() => {
        fireEvent.change(getEl("select-tracker-provider"), {
          target: { value: "generic-tracker" },
        });
        fireEvent.change(getEl("select-gitHost-provider"), {
          target: { value: "generic-githost" },
        });
      });

      api.providers.verify = mock(async () => ({
        status: "ok" as const,
        warnings: [],
      }));

      // Verify both
      await act(async () => {
        fireEvent.click(getEl("btn-verify-tracker"));
        fireEvent.click(getEl("btn-verify-gitHost"));
      });

      // Both cards show verified and Next is enabled
      expect(getEl("connection-card-tracker").textContent).toContain(
        "Verified",
      );
      expect(getEl("connection-card-gitHost").textContent).toContain(
        "Verified",
      );
      expect(getEl<HTMLButtonElement>("btn-step-2-next").disabled).toBe(false);

      // Now submit a Quick-URL that matches ONLY generic-tracker (roles: ["tracker"])
      api.providers.parseUrl = mock(async () => ({
        matched: true as const,
        providerId: "generic-tracker",
        configDraft: { endpointHost: "https://new-tracker.example.com" },
        inferredName: "New Tracker",
      }));

      const quickInput = getEl<HTMLInputElement>("connect-quick-url");
      await typeInput(quickInput, "https://tracker.example.com/issue/123");

      await act(async () => {
        fireEvent.click(getEl("btn-quick-url-submit"));
      });

      // Tracker verification was reset
      expect(getEl("connection-card-tracker").textContent).not.toContain(
        "Verified",
      );

      // Git Host verification SURVIVED and is STILL verified!
      expect(getEl("connection-card-gitHost").textContent).toContain(
        "Verified",
      );
    });
  });
});
